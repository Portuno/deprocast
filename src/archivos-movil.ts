/**
 * Fotos y videos desde el Hoy del teléfono (Mobile 1.2). Lo que mandás desde la galería o la cámara entra como si lo
 * mandaras por Telegram, pero sin salir de la app:
 * - una foto que es un registro (un plato, un ticket, la balanza) se anota sola y Mastropiero te lo dice en Hoy;
 * - cualquier otra foto se lee entera (texto, estructura, lo ilegible), queda como pieza tuya y la charlan en Hoy;
 * - un video: se guarda, se le saca el audio (se transcribe) y un cuadro (se lee), queda como pieza tuya y va a Hoy.
 * Todo queda con el lugar donde estabas (si lo mandó el teléfono) y va a tu Drive si está conectado. Responde enseguida
 * y procesa de fondo: lo que resulta aparece en Hoy.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fechaLocal, type Db } from './db.ts'

export type MetaArchivo = { nombre: string; mime: string; nota?: string | null; en?: number | null; lat?: number | null; lon?: number | null; dispositivo: string }

/** Un proceso (ffmpeg) sin trabar el servidor. */
function correr(cmd: string, args: string[], ms = 120_000): Promise<{ ok: boolean; salida: string }> {
  return new Promise((listo) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let salida = ''
    p.stderr.on('data', (b: Buffer) => { if (salida.length < 4000) salida += b.toString() })
    const reloj = setTimeout(() => p.kill('SIGKILL'), ms)
    p.on('error', (e) => { clearTimeout(reloj); listo({ ok: false, salida: e.message }) })
    p.on('close', (code) => { clearTimeout(reloj); listo({ ok: code === 0, salida }) })
  })
}

/** Para las pruebas: la lectura de imagen, la transcripción, ffmpeg y la charla. */
let externos = {
  leer: async (db: Db, img: { datos: Buffer; mime: string }) => (await import('./lectura-imagen.ts')).leerImagen(db, img),
  transcribir: async (db: Db, audio: Buffer, nombre: string) => (await import('./nan.ts')).nanTranscribir(db, audio, nombre),
  clasificar: async (db: Db, img: { datos: Buffer; mime: string }, texto: string | null) => (await import('./captura.ts')).clasificar(db, { imagen: img, texto }),
  ffmpeg: (args: string[]) => correr('ffmpeg', args),
  charlar: async (db: Db, texto: string) => { const c = await import('./chat/index.ts'); await c.enviar(db, c.conversacionHoy(db).id, texto) },
  avisar: async (db: Db, texto: string) => { const c = await import('./chat/index.ts'); c.mensajeDeMastropiero(db, c.conversacionHoy(db).id, texto) },
}
export function _probarArchivosMovil(o: Partial<typeof externos>) { externos = { ...externos, ...o } }

const lugarDe = (m: MetaArchivo) => (m.lat != null && m.lon != null && Number.isFinite(m.lat) && Number.isFinite(m.lon) ? { lat: Math.round(m.lat * 1e5) / 1e5, lon: Math.round(m.lon * 1e5) / 1e5 } : null)

/** Recibe el archivo: lo valida, lo deja en disco y lo procesa de fondo. Devuelve qué es. */
export function recibirArchivoMovil(db: Db, datos: Buffer, m: MetaArchivo): { tipo: 'imagen' | 'video'; bytes: number; trabajo: Promise<void> } {
  if (!datos.length) throw new Error('El archivo vino vacío')
  const tipo = /^image\//.test(m.mime) || /\.(jpe?g|png|webp|heic)$/i.test(m.nombre) ? 'imagen' : /^video\//.test(m.mime) || /\.(mp4|mov|3gp|webm|mkv)$/i.test(m.nombre) ? 'video' : null
  if (!tipo) throw new Error('Por ahora desde Hoy entran fotos y videos')
  const trabajo = (tipo === 'imagen' ? procesarFoto(db, datos, m) : procesarVideo(db, datos, m))
    .catch((e) => externos.avisar(db, `⚠ No pude procesar ${tipo === 'imagen' ? 'la foto' : 'el video'} «${m.nombre}»: ${e instanceof Error ? e.message : e}. Quedó guardado: mandalo de nuevo en un rato.`).catch(() => {}))
  return { tipo, bytes: datos.length, trabajo }
}

async function procesarFoto(db: Db, datos: Buffer, m: MetaArchivo) {
  const { guardarFoto } = await import('./chat/adjuntos.ts')
  const foto = guardarFoto(m.nombre, datos)
  // ¿Es un registro? (un plato, un ticket, la balanza): se anota solo.
  const c = await externos.clasificar(db, { datos: foto.datos, mime: foto.mime }, m.nota ?? null).catch(() => null)
  const { umbralCaptura } = await import('./sombra.ts')
  if (c && c.tipo !== 'otro' && c.confianza >= umbralCaptura(db)) {
    const { registrarCaptura } = await import('./captura.ts')
    const r = registrarCaptura(db, c, { foto: foto.url, fuente: 'teléfono' })
    if (r) { await externos.avisar(db, `📸 ${r.resumen} (desde la foto que mandaste${m.nota ? `: «${m.nota}»` : ''}). Si no es así, decime y lo corrijo.`); return }
  }
  const { guardarLectura } = await import('./lectura-imagen.ts')
  const { comoLectura } = await import('./chat/adjuntos.ts')
  const lectura = comoLectura(await externos.leer(db, { datos: foto.datos, mime: foto.mime }))
  const pieza = guardarLectura(db, lectura, { datos: foto.datos, url: foto.url, canal: m.dispositivo, nota: m.nota ?? null })
  const lugar = lugarDe(m)
  if (lugar) db.prepare(`UPDATE corpus SET meta = json_set(COALESCE(meta, '{}'), '$.lugar', json(?)) WHERE id = ?`).run(JSON.stringify(lugar), pieza)
  void import('./google/drive.ts').then((d) => d.alDrive(db, { datos, nombre: m.nombre, tipo: 'imagen', origen: m.dispositivo, descripcion: [m.nota, lectura.titulo, lectura.descripcion].filter(Boolean).join('\n\n') })).catch(() => {})
  const { lecturaComoTexto } = await import('./lectura-imagen.ts')
  await externos.charlar(db, `(Te mandé una foto desde ${m.dispositivo}, ya leída entera y guardada en su corpus [#${pieza}]. Lo que dice:\n${lecturaComoTexto(lectura).slice(0, 12_000)})${m.nota ? `\n${m.nota}` : ''}`)
}

async function procesarVideo(db: Db, datos: Buffer, m: MetaArchivo) {
  if (datos.length > 300 * 1024 * 1024) throw new Error('El video pesa más de 300 MB')
  const { dirAdjuntos } = await import('./chat/adjuntos.ts')
  const ext = (path.extname(m.nombre).toLowerCase() || '.mp4').slice(0, 6)
  const archivo = `${Date.now()}-${crypto.createHash('sha1').update(datos).digest('hex').slice(0, 10)}${ext}`
  fs.mkdirSync(dirAdjuntos(), { recursive: true })
  const ruta = path.join(dirAdjuntos(), archivo)
  fs.writeFileSync(ruta, datos)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-video-'))
  try {
    // El audio (para transcribir) y un cuadro del primer segundo (para leer qué se ve).
    const audio = path.join(tmp, 'audio.mp3'), cuadro = path.join(tmp, 'cuadro.jpg')
    const a = await externos.ffmpeg(['-y', '-i', ruta, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio])
    const f = await externos.ffmpeg(['-y', '-ss', '1', '-i', ruta, '-frames:v', '1', '-q:v', '3', cuadro])
    let texto = ''
    if (a.ok && fs.existsSync(audio) && fs.statSync(audio).size > 1000) texto = (await externos.transcribir(db, fs.readFileSync(audio), 'audio.mp3').catch(() => '')).trim()
    let visto: { titulo: string; descripcion: string; texto: string } | null = null
    if (f.ok && fs.existsSync(cuadro)) {
      const { comoLectura } = await import('./chat/adjuntos.ts')
      const l = comoLectura(await externos.leer(db, { datos: fs.readFileSync(cuadro), mime: 'image/jpeg' }).catch(() => ''))
      visto = { titulo: l.titulo, descripcion: l.descripcion, texto: l.texto }
    }
    if (!a.ok && !f.ok) throw new Error('no pude abrir el video (¿falta ffmpeg en el servidor?)')
    const { asegurarFuente, insertar } = await import('./corpus.ts')
    asegurarFuente(db, { id: 'videos', nombre: 'Videos', nivel: 'propia', descripcion: 'Los videos que mandaste desde el teléfono: lo que se dice (transcripto) y lo que se ve.' })
    const fecha = fechaLocal(m.en ?? Date.now())
    const contenido = [m.nota ? `> ${m.nota}` : '', visto?.descripcion ? `## Lo que se ve\n${visto.descripcion}${visto.texto ? `\n\n${visto.texto}` : ''}` : '', texto ? `## Lo que se dice\n${texto}` : '## Lo que se dice\n(sin voz)', `Video: /adjuntos/${archivo}`].filter(Boolean).join('\n\n')
    const lugar = lugarDe(m)
    const pieza = insertar(db, {
      fuente: 'videos', nivel: 'propia', tipo: 'materia', estado: 'disponible', titulo: `Video · ${fecha} · ${visto?.titulo || (texto ? texto.slice(0, 50) : m.nombre)}`, contenido, fecha,
      etiquetas: ['video'], origenId: `video:${archivo}`, datos: { archivo: m.nombre, url: `/adjuntos/${archivo}`, canal: m.dispositivo, bytes: datos.length }, meta: lugar ? { lugar } : null,
    })!
    void import('./google/drive.ts').then((d) => d.alDrive(db, { datos, nombre: m.nombre, tipo: 'archivo', origen: m.dispositivo, descripcion: [m.nota, texto.slice(0, 2000)].filter(Boolean).join('\n\n') })).catch(() => {})
    await externos.charlar(db, `(Te mandé un video desde ${m.dispositivo}, ya guardado en su corpus [#${pieza}].${visto?.descripcion ? ` Lo que se ve: ${visto.descripcion}` : ''}${texto ? `\nLo que se dice: ${texto.slice(0, 8000)}` : ' No tiene voz.'})${m.nota ? `\n${m.nota}` : ''}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
