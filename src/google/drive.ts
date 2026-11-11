/**
 * Drive, en las dos direcciones (plan v35, fase 2).
 *
 * Hacia su Drive, la carpeta «Mastropiero» (Deprocast la crea y la usa libremente):
 * - Audios/, Imágenes/ y Archivos/ (por mes): lo que él manda por el chat, Telegram, WhatsApp o el teléfono, y lo que
 *   sube para procesar. Deprocast no guarda esos archivos (se procesan y se borran): quedan en SU Drive, con la
 *   transcripción o la descripción en la descripción del archivo. Pasan por una cola en disco, así un corte no los pierde.
 * - Conversaciones/ (por mes): un documento por conversación y por día, que se va actualizando.
 * - Documentos/: lo que Mastropiero guarda ahí cuando se lo pide (o cuando le sirve).
 *
 * Desde su Drive: las carpetas que él elige entran al corpus (Docs, Sheets, Slides, PDF y texto), y lo que cambia en
 * Drive se actualiza solo.
 *
 * Permisos: escribir pide drive.file (solo lo que crea Deprocast); leer, drive.readonly.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { comoTexto } from '../chat/adjuntos.ts'
import { asegurarFuente, piezaPorOrigen, retirarPieza } from '../corpus.ts'
import { ajuste, fechaLocal, fijarAjuste, resolverRuta, type Db } from '../db.ts'
import { ingerir } from '../mastropiero.ts'
import { googleConectado, llamarGoogle, llamarGoogleCrudo } from './oauth.ts'

const API = 'https://www.googleapis.com/drive/v3/files'
const SUBIR = 'https://www.googleapis.com/upload/drive/v3/files'
const CARPETA = 'application/vnd.google-apps.folder'
const DOC = 'application/vnd.google-apps.document'
export const RAIZ = 'Mastropiero'

const puedeEscribir = (db: Db) => (ajuste(db, 'google_alcances') ?? '').includes('drive.file')
const dirCola = () => path.join(path.dirname(resolverRuta()), 'drive-cola')
const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5).replace(':', '.')

// ─── carpetas y subidas ─────────────────────────────────────────────────

/** El id de una carpeta bajo «Mastropiero» (la crea si no existe; recuerda los ids). */
export async function carpeta(db: Db, ruta: string[] = []): Promise<string> {
  const clave = `drive_carpeta:${[RAIZ, ...ruta].join('/')}`
  const ya = ajuste(db, clave)
  if (ya) return ya
  const padre = ruta.length ? await carpeta(db, ruta.slice(0, -1)) : 'root'
  const nombre = ruta.length ? ruta.at(-1)! : RAIZ
  const r = await llamarGoogle<{ id: string }>(db, `${API}?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nombre, mimeType: CARPETA, parents: [padre] }) })
  fijarAjuste(db, clave, r.id)
  return r.id
}

/** Olvida los ids de carpetas (la borraron en Drive): se vuelven a crear. */
function olvidarCarpetas(db: Db) {
  db.prepare(`DELETE FROM ajustes WHERE clave LIKE 'drive_carpeta:%'`).run()
}

/** Sube un archivo (o lo convierte en un documento de Google, si comoDoc) a esa carpeta. */
export async function subir(db: Db, d: { datos: Buffer; nombre: string; mime: string; ruta: string[]; descripcion?: string | null; comoDoc?: boolean }): Promise<{ id: string; link: string }> {
  const intentar = async () => {
    const padre = await carpeta(db, d.ruta)
    const meta = { name: d.nombre, parents: [padre], ...(d.descripcion ? { description: d.descripcion.slice(0, 20_000) } : {}), ...(d.comoDoc ? { mimeType: DOC } : {}) }
    const borde = `deprocast${crypto.randomBytes(8).toString('hex')}`
    const cuerpo = Buffer.concat([
      Buffer.from(`--${borde}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${borde}\r\nContent-Type: ${d.mime}\r\n\r\n`),
      d.datos,
      Buffer.from(`\r\n--${borde}--`),
    ])
    const r = await llamarGoogle<{ id: string; webViewLink: string }>(db, `${SUBIR}?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${borde}` }, body: new Uint8Array(cuerpo) })
    return { id: r.id, link: r.webViewLink }
  }
  try { return await intentar() } catch (e) {
    // La carpeta ya no existe (la borró o la movió a la papelera): se crea de nuevo una vez.
    if ((e as { status?: number }).status !== 404) throw e
    olvidarCarpetas(db)
    return intentar()
  }
}

/** Reemplaza el contenido de un archivo (un documento de Google se reescribe con el texto nuevo). */
async function reemplazar(db: Db, id: string, datos: Buffer, mime: string) {
  await llamarGoogle(db, `${SUBIR}/${encodeURIComponent(id)}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'content-type': mime }, body: new Uint8Array(datos) })
}

// ─── la cola de lo que va a su Drive ────────────────────────────────────

export type Medio = { datos: Buffer; nombre: string; mime?: string | null; tipo: 'audio' | 'imagen' | 'archivo'; origen: string; descripcion?: string | null }
const CARPETA_DE = { audio: 'Audios', imagen: 'Imágenes', archivo: 'Archivos' } as const
const MIME_DE: Record<string, string> = { ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', zip: 'application/zip' }

/** ¿Van sus audios, imágenes y archivos a Drive? (Sin el permiso de escribir, nada se encola: no se acumula en disco.) */
export function guardaMedios(db: Db) { return googleConectado(db) && puedeEscribir(db) && ajuste(db, 'drive_medios') !== '0' }

/**
 * Lo que él mandó, a su Drive (de fondo). Queda en una cola en disco hasta que sube; si Google no está conectado o él lo
 * apagó, no hace nada. Devuelve el id en la cola (o null).
 */
export function alDrive(db: Db, m: Medio, ahora = Date.now()): number | null {
  if (!guardaMedios(db) || !m.datos?.length) return null
  fs.mkdirSync(dirCola(), { recursive: true })
  const ext = (path.extname(m.nombre).slice(1) || (m.tipo === 'audio' ? 'ogg' : m.tipo === 'imagen' ? 'jpg' : 'bin')).toLowerCase()
  const archivo = path.join(dirCola(), `${ahora}-${crypto.randomBytes(4).toString('hex')}.${ext}`)
  fs.writeFileSync(archivo, m.datos)
  const base = path.basename(m.nombre, path.extname(m.nombre)).replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').slice(0, 60) || m.tipo
  const nombre = `${fechaLocal(ahora)} ${hora(ahora)} · ${m.origen} · ${base}.${ext}`
  const r = db.prepare(`INSERT INTO drive_cola (archivo, nombre, mime, carpeta, descripcion, origen, creado) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(archivo, nombre, m.mime || MIME_DE[ext] || 'application/octet-stream', JSON.stringify([CARPETA_DE[m.tipo], fechaLocal(ahora).slice(0, 7)]), m.descripcion ?? null, m.origen, ahora)
  void trabajarCola(db).catch(() => {})
  return Number(r.lastInsertRowid)
}

/** Para sumar la transcripción o la descripción cuando llega después de encolar. */
export function describirEnCola(db: Db, id: number | null, descripcion: string) {
  if (id) db.prepare('UPDATE drive_cola SET descripcion = ? WHERE id = ? AND hecho = 0').run(descripcion.slice(0, 20_000), id)
}

let enCurso: Promise<number> | null = null
/**
 * Sube lo que espera en la cola (de a uno; si falta el permiso o no hay red, espera la próxima vuelta). Si ya hay una
 * pasada en curso, se espera esa (y lo encolado mientras tanto lo toma la siguiente).
 */
export function trabajarCola(db: Db): Promise<number> {
  if (enCurso) return enCurso.then(() => (db.prepare('SELECT 1 FROM drive_cola WHERE hecho = 0 AND intentos < 6').get() ? trabajarCola(db) : 0))
  if (!googleConectado(db) || !puedeEscribir(db)) return Promise.resolve(0)
  enCurso = pasadaDeCola(db).finally(() => { enCurso = null })
  return enCurso
}

async function pasadaDeCola(db: Db): Promise<number> {
  let n = 0
  try {
    // Un instante: la transcripción (o la descripción) suele llegar enseguida y viaja con el archivo.
    await new Promise((ok) => setTimeout(ok, 1500))
    for (;;) {
      const f = db.prepare(`SELECT * FROM drive_cola WHERE hecho = 0 AND intentos < 6 ORDER BY id LIMIT 1`).get() as { id: number; archivo: string; nombre: string; mime: string; carpeta: string; descripcion: string | null } | undefined
      if (!f) break
      if (!fs.existsSync(f.archivo)) { db.prepare(`UPDATE drive_cola SET hecho = 1, error = 'el archivo ya no estaba' WHERE id = ?`).run(f.id); continue }
      try {
        const r = await subir(db, { datos: fs.readFileSync(f.archivo), nombre: f.nombre, mime: f.mime, ruta: JSON.parse(f.carpeta), descripcion: f.descripcion })
        db.prepare(`UPDATE drive_cola SET hecho = 1, file_id = ?, link = ?, error = NULL WHERE id = ?`).run(r.id, r.link, f.id)
        fs.rmSync(f.archivo, { force: true })
        n++
      } catch (e) {
        db.prepare(`UPDATE drive_cola SET intentos = intentos + 1, error = ? WHERE id = ?`).run(String(e instanceof Error ? e.message : e).slice(0, 300), f.id)
        break // la próxima vuelta sigue
      }
    }
    // Lo subido hace más de 30 días sale de la cola (en Drive queda).
    db.prepare(`DELETE FROM drive_cola WHERE hecho = 1 AND creado < ?`).run(Date.now() - 30 * 86_400_000)
  } catch (e) { console.error('  drive:', e instanceof Error ? e.message : e) }
  return n
}

// ─── las conversaciones ─────────────────────────────────────────────────

/** Cada conversación del día, como un documento en Conversaciones/AAAA-MM (se reescribe si cambió). */
export async function archivarConversaciones(db: Db, dia = fechaLocal()): Promise<number> {
  if (!googleConectado(db) || !puedeEscribir(db) || ajuste(db, 'drive_conversaciones') === '0') return 0
  const [a, m, d] = dia.split('-').map(Number)
  const desde = new Date(a, m - 1, d).getTime()
  const hasta = desde + 86_400_000
  const convs = db.prepare(`SELECT DISTINCT c.id, c.titulo, c.con FROM mensajes x JOIN conversaciones c ON c.id = x.conversacion_id WHERE x.en >= ? AND x.en < ? AND x.rol IN ('operador', 'asistente') AND x.texto IS NOT NULL`).all(desde, hasta) as { id: number; titulo: string | null; con: string }[]
  let n = 0
  for (const c of convs) {
    const ms = db.prepare(`SELECT rol, texto, en FROM mensajes WHERE conversacion_id = ? AND en >= ? AND en < ? AND rol IN ('operador', 'asistente') AND texto IS NOT NULL ORDER BY id`).all(c.id, desde, hasta) as { rol: string; texto: string; en: number }[]
    const quien = c.con === 'mastropiero' ? 'Mastropiero' : c.con
    const titulo = c.titulo?.trim() || (c.con === 'mastropiero' ? 'Mastropiero' : `Con ${c.con}`)
    const texto = `${titulo} · ${dia}\n\n${ms.map((x) => `[${new Date(x.en).toTimeString().slice(0, 5)}] ${x.rol === 'operador' ? 'Vos' : quien}:\n${comoTexto(x.texto).trim()}`).join('\n\n')}\n`
    const huella = crypto.createHash('sha1').update(texto).digest('hex')
    const clave = `drive_conv:${c.id}:${dia}`
    const ya = (() => { try { return JSON.parse(ajuste(db, clave) ?? 'null') as { id: string; huella: string } | null } catch { return null } })()
    if (ya?.huella === huella) continue
    const datos = Buffer.from(texto, 'utf8')
    if (ya?.id) {
      try { await reemplazar(db, ya.id, datos, 'text/plain'); fijarAjuste(db, clave, JSON.stringify({ id: ya.id, huella })); n++; continue } catch (e) { if ((e as { status?: number }).status !== 404) throw e }
    }
    const r = await subir(db, { datos, nombre: `${dia} · ${titulo}`.slice(0, 120), mime: 'text/plain', ruta: ['Conversaciones', dia.slice(0, 7)], comoDoc: true })
    fijarAjuste(db, clave, JSON.stringify({ id: r.id, huella }))
    n++
  }
  return n
}

// ─── lo que Mastropiero guarda ahí ──────────────────────────────────────

/** Un documento de Google en Mastropiero/Documentos (o una subcarpeta), con ese título y ese texto. */
export async function guardarDocumento(db: Db, titulo: string, contenido: string, subcarpeta?: string | null) {
  if (!puedeEscribir(db)) throw new Error('Para escribir en tu Drive hay que volver a conectar Google (Perfil → Apps conectadas).')
  if (!titulo.trim() || !contenido.trim()) throw new Error('Falta el título o el contenido.')
  const ruta = ['Documentos', ...(subcarpeta?.trim() ? [subcarpeta.trim().slice(0, 80)] : [])]
  const r = await subir(db, { datos: Buffer.from(contenido, 'utf8'), nombre: titulo.trim().slice(0, 150), mime: 'text/plain', ruta, comoDoc: true })
  return { id: r.id, link: r.link, carpeta: [RAIZ, ...ruta].join('/') }
}

// ─── leer de su Drive ───────────────────────────────────────────────────

const EXPORTAR: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
}
const TEXTO = /^text\/|application\/json$/
export const legible = (mime: string) => !!EXPORTAR[mime] || mime === 'application/pdf' || TEXTO.test(mime)

/** El texto de un archivo de Drive: exportado (Docs, Sheets, Slides), extraído (PDF) o tal cual (texto). */
export async function textoDeArchivo(db: Db, id: string, mime?: string): Promise<{ nombre: string; texto: string; link: string | null; modificado: string | null }> {
  const meta = await llamarGoogle<{ name: string; mimeType: string; webViewLink?: string; modifiedTime?: string }>(db, `${API}/${encodeURIComponent(id)}?fields=name,mimeType,webViewLink,modifiedTime`)
  const tipo = mime ?? meta.mimeType
  let texto: string
  if (EXPORTAR[tipo]) texto = (await llamarGoogleCrudo(db, `${API}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(EXPORTAR[tipo])}`)).toString('utf8')
  else if (tipo === 'application/pdf') texto = (await import('../cargas/pdf.ts')).textoDePdf(await llamarGoogleCrudo(db, `${API}/${encodeURIComponent(id)}?alt=media`))
  else if (TEXTO.test(tipo)) texto = (await llamarGoogleCrudo(db, `${API}/${encodeURIComponent(id)}?alt=media`)).toString('utf8')
  else throw new Error(`Ese archivo (${tipo}) no tiene texto que leer.`)
  return { nombre: meta.name, texto: texto.replace(/^﻿/, ''), link: meta.webViewLink ?? null, modificado: meta.modifiedTime ?? null }
}

/** El id de un archivo desde su link de Drive o Docs (o el id suelto). */
export function idDeArchivo(entrada: unknown): string {
  // Sin nada (el modelo mandó el link con otro nombre de parámetro) daba «Cannot read properties of undefined (reading
  // 'trim')» y no decía qué faltaba (Fragua #216).
  const x = String(entrada ?? '').trim()
  if (!x) throw new Error('Falta el archivo: pasá el link de Drive o su id.')
  const m = /\/d\/([a-zA-Z0-9_-]{15,})/.exec(x) ?? /[?&]id=([a-zA-Z0-9_-]{15,})/.exec(x) ?? /\/folders\/([a-zA-Z0-9_-]{15,})/.exec(x)
  const id = m?.[1] ?? x
  if (!/^[a-zA-Z0-9_-]{15,}$/.test(id)) throw new Error('No reconozco ese archivo: pasá el link de Drive o su id.')
  return id
}

// ─── carpetas de su Drive → el corpus ───────────────────────────────────

type Carpeta = { id: string; nombre: string }
export const carpetasCorpus = (db: Db): Carpeta[] => { try { return JSON.parse(ajuste(db, 'drive_corpus') ?? '[]') } catch { return [] } }
export function sumarCarpetaCorpus(db: Db, c: Carpeta) {
  const xs = carpetasCorpus(db).filter((x) => x.id !== c.id)
  fijarAjuste(db, 'drive_corpus', JSON.stringify([...xs, { id: idDeArchivo(c.id), nombre: String(c.nombre).slice(0, 120) }]))
  return carpetasCorpus(db)
}
export function sacarCarpetaCorpus(db: Db, id: string) {
  fijarAjuste(db, 'drive_corpus', JSON.stringify(carpetasCorpus(db).filter((x) => x.id !== id)))
  return carpetasCorpus(db)
}

type Archivo = { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string }
async function listar(db: Db, carpetaId: string, profundidad = 0, max = 400, out: (Archivo & { carpeta: string })[] = [], nombre = '', carpetas?: Map<string, string>): Promise<(Archivo & { carpeta: string })[]> {
  carpetas?.set(carpetaId, nombre)
  let pagina: string | undefined
  do {
    const q = new URLSearchParams({ q: `'${carpetaId}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)', pageSize: '200', ...(pagina ? { pageToken: pagina } : {}) })
    const r = await llamarGoogle<{ files: Archivo[]; nextPageToken?: string }>(db, `${API}?${q}`)
    for (const f of r.files ?? []) {
      if (out.length >= max) return out
      if (f.mimeType === CARPETA) { if (profundidad < 3) await listar(db, f.id, profundidad + 1, max, out, nombre ? `${nombre}/${f.name}` : f.name, carpetas) }
      else if (legible(f.mimeType)) out.push({ ...f, carpeta: nombre })
    }
    pagina = r.nextPageToken
  } while (pagina && out.length < max)
  return out
}

const CAMBIOS = 'https://www.googleapis.com/drive/v3/changes'
const SEMANA = 7 * 86_400_000
type Resultado = { nuevos: number; actualizados: number; retirados: number; errores: number; modo: 'completo' | 'cambios' }

/** Un archivo de sus carpetas, al corpus: entra si es nuevo, se actualiza si cambió, no se toca si no. */
async function alCorpus(db: Db, f: Archivo & { carpeta: string }, raiz: string, res: Resultado) {
  const ya = piezaPorOrigen(db, `drive:${f.id}`)
  if (ya && (ya.meta as Record<string, unknown> | null)?.modificado === f.modifiedTime) return
  try {
    const { texto } = await textoDeArchivo(db, f.id, f.mimeType)
    const contenido = texto.trim().slice(0, 200_000)
    if (!contenido) return
    if (ya) {
      db.prepare(`UPDATE corpus SET contenido = ?, titulo = ?, meta = json_set(COALESCE(meta, '{}'), '$.modificado', ?) WHERE id = ?`).run(contenido, f.name.slice(0, 300), f.modifiedTime, ya.id)
      res.actualizados++
    } else {
      asegurarFuente(db, { id: 'drive', nombre: 'Su Drive', nivel: 'propia', descripcion: 'Los documentos de las carpetas de Google Drive que él eligió.' })
      ingerir(db, { fuente: 'drive', titulo: f.name, contenido, url: f.webViewLink ?? null, fecha: f.modifiedTime.slice(0, 10), origenId: `drive:${f.id}`, dominio: f.carpeta || raiz, meta: { modificado: f.modifiedTime, drive: f.id, carpeta: f.carpeta || raiz }, por: 'drive' })
      res.nuevos++
    }
  } catch (e) {
    res.errores++
    console.error('  drive → corpus:', f.name, e instanceof Error ? e.message : e)
  }
}

/**
 * Las carpetas elegidas, al corpus (Fragua #136). La primera vez (y una vez por semana, o si cambió qué carpetas
 * eligió) recorre todo y guarda un marcador de la API de cambios de Drive; las demás pide solo lo que cambió desde el
 * marcador: lo nuevo entra, lo editado se actualiza y lo que borró en Drive se retira del corpus (con su rastro).
 */
export async function sincronizarCorpus(db: Db, o: { completo?: boolean; ahora?: number } = {}): Promise<Resultado> {
  const ahora = o.ahora ?? Date.now()
  const res: Resultado = { nuevos: 0, actualizados: 0, retirados: 0, errores: 0, modo: 'cambios' }
  if (!googleConectado(db)) return res
  const propia = ajuste(db, `drive_carpeta:${RAIZ}`)
  const raices = carpetasCorpus(db).filter((c) => c.id !== propia)
  const firma = raices.map((c) => c.id).sort().join(',')
  const marcador = ajuste(db, 'drive_cambios_token')
  const conocidas = new Map<string, string>(Object.entries(JSON.parse(ajuste(db, 'drive_corpus_carpetas') ?? '{}')))
  const alDia = !o.completo && marcador && ajuste(db, 'drive_corpus_firma') === firma && ahora - (Number(ajuste(db, 'drive_completo_en')) || 0) < SEMANA
  if (alDia) {
    try {
      let pagina: string | undefined = marcador
      let nuevo: string | undefined
      while (pagina) {
        const q = new URLSearchParams({ pageToken: pagina, pageSize: '200', includeRemoved: 'true', spaces: 'drive', fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,webViewLink,parents,trashed))' })
        const r = await llamarGoogle<{ nextPageToken?: string; newStartPageToken?: string; changes?: { fileId: string; removed?: boolean; file?: Archivo & { parents?: string[]; trashed?: boolean } }[] }>(db, `${CAMBIOS}?${q}`)
        for (const ch of r.changes ?? []) {
          const f = ch.file
          if (ch.removed || f?.trashed) {
            const ya = piezaPorOrigen(db, `drive:${ch.fileId}`)
            if (ya && ya.estado !== 'retirada') { retirarPieza(db, ya.id, 'Se borró de su Drive', 'drive', ahora); res.retirados++ }
            continue
          }
          const padre = f?.parents?.find((x) => conocidas.has(x))
          if (!f || padre === undefined) continue
          const ruta = conocidas.get(padre)!
          if (f.mimeType === CARPETA) {
            // Una carpeta nueva adentro de las suyas: se recorre entera.
            for (const g of await listar(db, f.id, 1, 400, [], ruta ? `${ruta}/${f.name}` : f.name, conocidas)) await alCorpus(db, g, ruta, res)
          } else if (legible(f.mimeType)) await alCorpus(db, { ...f, carpeta: ruta }, ruta, res)
        }
        pagina = r.nextPageToken
        nuevo = r.newStartPageToken ?? nuevo
      }
      if (nuevo) fijarAjuste(db, 'drive_cambios_token', nuevo)
      fijarAjuste(db, 'drive_corpus_carpetas', JSON.stringify(Object.fromEntries(conocidas)))
      fijarAjuste(db, 'drive_sincronizado', String(ahora))
      return res
    } catch (e) {
      // Un marcador vencido o inválido: se rehace todo.
      if (![400, 404, 410].includes((e as { status?: number }).status ?? 0)) throw e
    }
  }
  res.modo = 'completo'
  // El marcador se pide ANTES de recorrer: lo que cambie mientras tanto entra en la próxima.
  const inicio = await llamarGoogle<{ startPageToken: string }>(db, `${CAMBIOS}/startPageToken`)
  const carpetas = new Map<string, string>()
  for (const c of raices) for (const f of await listar(db, c.id, 0, 400, [], c.nombre, carpetas)) await alCorpus(db, f, c.nombre, res)
  fijarAjuste(db, 'drive_cambios_token', inicio.startPageToken)
  fijarAjuste(db, 'drive_corpus_firma', firma)
  fijarAjuste(db, 'drive_corpus_carpetas', JSON.stringify(Object.fromEntries(carpetas)))
  fijarAjuste(db, 'drive_completo_en', String(ahora))
  fijarAjuste(db, 'drive_sincronizado', String(ahora))
  return res
}

// ─── el estado, para la pantalla ────────────────────────────────────────

export function estadoDrive(db: Db) {
  const raiz = ajuste(db, `drive_carpeta:${RAIZ}`)
  const cola = db.prepare(`SELECT SUM(CASE WHEN hecho = 0 THEN 1 ELSE 0 END) AS pendientes, SUM(hecho) AS subidos FROM drive_cola`).get() as { pendientes: number | null; subidos: number | null }
  const error = (db.prepare(`SELECT error FROM drive_cola WHERE hecho = 0 AND error IS NOT NULL ORDER BY id DESC LIMIT 1`).get() as { error: string } | undefined)?.error ?? null
  return {
    puedeEscribir: puedeEscribir(db),
    carpeta: raiz ? `https://drive.google.com/drive/folders/${raiz}` : null,
    medios: ajuste(db, 'drive_medios') !== '0',
    conversaciones: ajuste(db, 'drive_conversaciones') !== '0',
    cola: { pendientes: cola.pendientes ?? 0, subidos: cola.subidos ?? 0, error },
    corpus: carpetasCorpus(db),
    piezas: (db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'drive'`).get() as { n: number }).n,
    sincronizado: Number(ajuste(db, 'drive_sincronizado')) || null,
  }
}
