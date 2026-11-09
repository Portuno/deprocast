/**
 * El video como fuente (Fragua #165): un video que él manda (por WhatsApp, Telegram o la web) entra a una cola y se
 * procesa en orden, de a uno y de fondo:
 * - el audio se transcribe;
 * - de la imagen se sacan cuadros repartidos a lo largo del video y de cada uno se lee el texto que se ve (sirve para las
 *   páginas de un diario filmadas) o, si no hay texto, qué se ve;
 * - con eso se arma el material: en modo «fuente», partido en bloques por tema, cada uno una pieza del corpus (de ahí
 *   salen quántomos como de cualquier otra); en modo «prensa», va al diario propio (src/prensa.ts).
 * Al terminar avisa. El video se borra del servidor: lo que queda es el texto (y su copia en Drive, si la hay).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fechaLocal, resolverRuta, type Db } from './db.ts'
import { correr } from './proceso.ts'

export type Modo = 'fuente' | 'prensa'
export type ItemVideo = { id: number; nombre: string; modo: Modo; nota: string | null; estado: 'pendiente' | 'procesando' | 'hecho' | 'error'; piezas: number[]; notas: number; error: string | null; creado: number; terminado: number | null }
const deFila = (r: any): ItemVideo => ({ id: r.id, nombre: r.nombre, modo: r.modo, nota: r.nota, estado: r.estado, piezas: JSON.parse(r.piezas ?? '[]'), notas: r.notas ?? 0, error: r.error, creado: r.creado, terminado: r.terminado })

const dir = () => path.join(path.dirname(resolverRuta()), 'videos')
const avisos = new Map<number, (texto: string) => unknown>()

/** Lo inyectable (en los tests no hay ffmpeg ni modelo). */
const real = {
  sondear: async (ruta: string) => (await import('./estudio.ts')).sondear(ruta),
  extraerAudio: async (ruta: string, destino: string) => { const r = await correr('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ruta, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', destino], { timeout: 15 * 60_000 }); return !r.error && r.status === 0 && fs.existsSync(destino) },
  cuadros: async (ruta: string, carpeta: string, n: number, duracion: number) => {
    const r = await correr('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ruta, '-vf', `fps=${(n / Math.max(1, duracion)).toFixed(4)},scale='min(1600,iw)':-2`, '-frames:v', String(n), '-q:v', '4', path.join(carpeta, 'c%03d.jpg')], { timeout: 15 * 60_000 })
    if (r.error) throw new Error('Para leer videos hace falta ffmpeg en el servidor')
    return fs.readdirSync(carpeta).filter((f) => /^c\d+\.jpg$/.test(f)).sort().map((f) => path.join(carpeta, f))
  },
  transcribir: async (db: Db, audio: Buffer) => (await import('./nan.ts')).nanTranscribir(db, audio, 'audio.mp3', 'auto'),
  leerCuadro: async (db: Db, imagen: Buffer, prensa: boolean) => (await (await import('./nan.ts')).nanVision({ db, clase: 'mastropiero', agenteId: 'video' }, {
    sistema: prensa ? 'Es una página de diario (o parte). Transcribí TODO el texto legible tal cual, en su idioma original, respetando titulares y párrafos. Sin comentarios ni traducción.' : 'Transcribí todo el texto que se ve en la imagen, tal cual. Si no hay texto, describí la escena en una sola línea. Sin comentarios.',
    texto: 'Cuadro de un video:', imagen: `data:image/jpeg;base64,${imagen.toString('base64')}`, maxTokens: 2500,
  })).texto,
  segmentar: async (db: Db, texto: string) => (await (await import('./modelo.ts')).pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'video' }, `Partís el material de un video en BLOQUES por tema (de 1 a 12), en orden. Cada bloque: un título corto y su texto completo (lo dicho y lo que se ve en pantalla de ese tramo), sin resumir ni inventar.
Forma: {"titulo": "título del video entero", "bloques": [{"titulo": "...", "texto": "..."}]}`, texto.slice(0, 80_000), { temperatura: 0.2, maxTokens: 12_000, largo: true })).datos,
}
let p = { ...real }
export function _probarVideo(o: Partial<typeof real>) { p = { ...real, ...o } }

/** Parecidos: el mismo texto en dos cuadros seguidos (la cámara quieta sobre la misma página) cuenta una vez. */
const normal = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
function parecido(a: string, b: string) { const x = normal(a); const y = normal(b); return !!x && !!y && (x === y || (x.length > 40 && (y.includes(x.slice(0, Math.floor(x.length * 0.8))) || x.includes(y.slice(0, Math.floor(y.length * 0.8)))))) }

/** A la cola. aviso: cómo decirle cuando termine (por el canal por donde lo mandó). */
export function encolarVideo(db: Db, datos: Buffer, nombre: string, o: { modo?: Modo; nota?: string | null; aviso?: (texto: string) => unknown } = {}, ahora = Date.now()): { item: ItemVideo; antes: number } {
  if (!datos.length) throw new Error('El video vino vacío')
  fs.mkdirSync(dir(), { recursive: true })
  const nota = o.nota?.trim() || null
  const modo: Modo = o.modo ?? (nota && /\b(diario|peri[oó]dico|prensa|levante|las provincias)\b/i.test(nota) ? 'prensa' : 'fuente')
  const r = db.prepare(`INSERT INTO video_cola (nombre, modo, nota, estado, creado) VALUES (?, ?, ?, 'pendiente', ?)`).run(nombre.slice(0, 200), modo, nota, ahora)
  const id = Number(r.lastInsertRowid)
  fs.writeFileSync(path.join(dir(), `${id}${path.extname(nombre) || '.mp4'}`), datos)
  if (o.aviso) avisos.set(id, o.aviso)
  const antes = (db.prepare(`SELECT COUNT(*) AS n FROM video_cola WHERE estado IN ('pendiente', 'procesando') AND id < ?`).get(id) as { n: number }).n
  void trabajarVideos(db)
  return { item: deFila(db.prepare('SELECT * FROM video_cola WHERE id = ?').get(id)), antes }
}

export const listarVideos = (db: Db) => (db.prepare('SELECT * FROM video_cola ORDER BY id DESC LIMIT 30').all() as any[]).map(deFila)

let trabajando: Promise<void> | null = null
/** La cola, de a uno y en orden (lo que mandó primero, primero). */
export function trabajarVideos(db: Db): Promise<void> {
  if (trabajando) return trabajando
  trabajando = (async () => {
    try {
      for (;;) {
        const r = db.prepare(`SELECT * FROM video_cola WHERE estado IN ('pendiente', 'procesando') ORDER BY id LIMIT 1`).get()
        if (!r) break
        const it = deFila(r)
        db.prepare(`UPDATE video_cola SET estado = 'procesando' WHERE id = ?`).run(it.id)
        let mensaje: string
        try {
          const res = await procesar(db, it)
          db.prepare(`UPDATE video_cola SET estado = 'hecho', piezas = ?, notas = ?, terminado = ? WHERE id = ?`).run(JSON.stringify(res.piezas), res.notas, Date.now(), it.id)
          mensaje = it.modo === 'prensa'
            ? `🗞 Listo «${it.nombre}»: ${res.notas} nota${res.notas === 1 ? '' : 's'} al diario, traducidas. Marcá cuáles te importan en Saber → Diario.`
            : `🎬 Listo «${it.nombre}»: ${res.piezas.length} bloque${res.piezas.length === 1 ? '' : 's'} al corpus${res.piezas.length ? ` [#${res.piezas[0]}]` : ''}.`
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          db.prepare(`UPDATE video_cola SET estado = 'error', error = ?, terminado = ? WHERE id = ?`).run(err.slice(0, 500), Date.now(), it.id)
          mensaje = `No pude procesar el video «${it.nombre}»: ${err}`
        }
        fs.rmSync(archivoDe(it.id), { force: true })
        const aviso = avisos.get(it.id)
        avisos.delete(it.id)
        try {
          if (aviso) await aviso(mensaje)
          else { const c = await import('./chat/index.ts'); c.mensajeDeMastropiero(db, c.conversacionHoy(db).id, mensaje) }
        } catch { /* el aviso no frena la cola */ }
      }
    } finally { trabajando = null }
  })()
  return trabajando
}

const archivoDe = (id: number) => { const f = fs.existsSync(dir()) ? fs.readdirSync(dir()).find((x) => x.startsWith(`${id}.`)) : undefined; return path.join(dir(), f ?? `${id}.mp4`) }
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

async function procesar(db: Db, it: ItemVideo): Promise<{ piezas: number[]; notas: number }> {
  const ruta = archivoDe(it.id)
  if (!fs.existsSync(ruta)) throw new Error('El archivo del video ya no está (¿se reinició el servidor a mitad?): mandalo de nuevo')
  const info = await p.sondear(ruta)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `video-${it.id}-`))
  try {
    // Lo que se dice.
    let dicho = ''
    if (info.audio) {
      const mp3 = path.join(tmp, 'audio.mp3')
      if (await p.extraerAudio(ruta, mp3)) dicho = (await p.transcribir(db, fs.readFileSync(mp3))).trim()
    }
    // Lo que se ve: un cuadro cada ~10 s (de 3 a 24); en prensa, más seguido (cada página cuenta).
    const prensa = it.modo === 'prensa'
    const n = Math.max(3, Math.min(prensa ? 40 : 24, Math.round(info.duracion / (prensa ? 3 : 10))))
    const cuadros = await p.cuadros(ruta, tmp, n, info.duracion)
    const visto: { t: number; texto: string }[] = []
    for (const [i, c] of cuadros.entries()) {
      const t = (i + 0.5) * (info.duracion / Math.max(1, cuadros.length))
      let texto = ''
      try { texto = (await p.leerCuadro(db, fs.readFileSync(c), prensa)).trim() } catch { continue }
      if (texto && !(visto.length && parecido(visto.at(-1)!.texto, texto))) visto.push({ t, texto })
    }
    if (!dicho && !visto.length) throw new Error('No saqué nada: ni voz ni texto en pantalla')
    if (prensa) {
      const notas = await (await import('./prensa.ts')).procesarPrensa(db, [visto.map((v) => v.texto).join('\n\n'), dicho ? `(Lo que se dice en el video:)\n${dicho}` : ''].filter(Boolean).join('\n\n'), { fecha: fechaLocal(it.creado), origen: `video:${it.id}` })
      return { piezas: notas.map((x) => x.piezaId).filter((x): x is number => !!x), notas: notas.length }
    }
    const material = [dicho ? `## Lo que se dice\n${dicho}` : '', visto.length ? `## Lo que se ve en pantalla\n${visto.map((v) => `[${mmss(v.t)}] ${v.texto}`).join('\n\n')}` : ''].filter(Boolean).join('\n\n')
    let d: any = null
    try { d = await p.segmentar(db, `${it.nota ? `(Él lo mandó con esta nota: ${it.nota})\n\n` : ''}${material}`) } catch { /* sin bloques: va entero */ }
    const bloques = (Array.isArray(d?.bloques) ? d.bloques : []).map((b: any) => ({ titulo: String(b?.titulo ?? '').trim().slice(0, 160), texto: String(b?.texto ?? '').trim() })).filter((b: any) => b.texto).slice(0, 12)
    const titulo = String(d?.titulo ?? '').trim().slice(0, 160) || it.nombre
    const partes = bloques.length ? bloques : [{ titulo, texto: material }]
    const { asegurarFuente } = await import('./corpus.ts')
    const { ingerir } = await import('./mastropiero.ts')
    asegurarFuente(db, { id: 'video', nombre: 'Videos', nivel: 'primaria', descripcion: 'Videos que él mandó: lo que se dice y lo que se ve en pantalla.' })
    const piezas: number[] = []
    for (const [i, b] of partes.entries()) {
      const { corpusId } = ingerir(db, { fuente: 'video', titulo: partes.length > 1 ? `${titulo} · ${i + 1}. ${b.titulo}` : titulo, contenido: b.texto, fecha: fechaLocal(it.creado), origenId: `video:${it.id}:${i}`, meta: { video: { id: it.id, nombre: it.nombre, bloque: i + 1, de: partes.length, duracion: Math.round(info.duracion), nota: it.nota } }, por: 'video' })
      if (corpusId) piezas.push(corpusId)
    }
    return { piezas, notas: 0 }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
