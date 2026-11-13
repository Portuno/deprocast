/**
 * El hilo como fuente de verdad (Fragua #271). El historial que viaja al modelo se elide y se resume (historial.ts), y
 * una conversación como la de Hoy junta miles de mensajes: cuando él dice «traemela de vuelta», «la foto que te mandé»
 * o «estos eran», lo de unos turnos antes puede no estar en lo que el modelo ve, y contestaba «no me llegó nada»
 * aunque estuviera en la base. Esto busca en los mensajes guardados del hilo (los suyos y las respuestas de
 * Mastropiero), con sus adjuntos: la imagen (con su lectura y el número de pieza, si quedó en el corpus) o el archivo.
 */
import { fechaLocal, type Db } from '../db.ts'
import { MARCA, MARCA_ARCHIVO } from './adjuntos.ts'

export type Adjunto = { tipo: 'imagen' | 'archivo'; url: string; descripcion: string; pieza: number | null }
export type MensajeHilo = { id: number; quien: 'operador' | 'Mastropiero'; cuando: string; texto: string; adjuntos: Adjunto[] }

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const recorte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
/** Lo que no ayuda a buscar («la», «que», «foto» sí ayuda). */
const VACIAS = new Set(['que', 'los', 'las', 'del', 'una', 'uno', 'con', 'por', 'para', 'esa', 'ese', 'esto', 'esta', 'este', 'eso', 'mas', 'como', 'pero', 'sus', 'mis', 'tus', 'vos', 'te', 'me', 'lo', 'la', 'el', 'de', 'en', 'y'])

/** Los adjuntos de un mensaje: las marcas del chat web y las fotos que entraron por Telegram o WhatsApp. */
export function adjuntosDe(texto: string): Adjunto[] {
  const out: Adjunto[] = []
  for (const m of texto.matchAll(MARCA)) out.push({ tipo: 'imagen', url: m[1], descripcion: m[2], pieza: Number(/pieza #(\d+)/.exec(m[2])?.[1]) || null })
  for (const m of texto.matchAll(MARCA_ARCHIVO)) out.push({ tipo: 'archivo', url: m[1], descripcion: `${m[2]} (${m[3]})`, pieza: null })
  // Una foto por un canal: «(Te mandé una foto por Telegram[, ya leída entera y guardada en su corpus [#12]]. Lo que …»
  const canal = /\(Te mandé una foto por ([^,.)]+)(?:, ya leída entera y guardada en su corpus \[#(\d+)\])?\. Lo que (?:se ve|dice):\s*([\s\S]*?)\)(?:\n|$)/.exec(texto)
  if (canal) out.push({ tipo: 'imagen', url: '', descripcion: recorte(canal[3].trim(), 1200), pieza: Number(canal[2]) || null })
  return out
}

/** Sin las marcas (el adjunto ya va aparte). */
const limpio = (t: string) => t.replace(MARCA, '(imagen adjunta)').replace(MARCA_ARCHIVO, (_, __, nombre) => `(archivo adjunto «${nombre}»)`).trim()

/**
 * Busca en el hilo. Con `consulta`, por palabras (sin importar tildes ni mayúsculas): primero los que tienen todas, y
 * si no hay, los que tienen más. Con `adjuntos`, solo los mensajes que traían una imagen o un archivo. Sin nada, los
 * últimos. Del más nuevo al más viejo; `antesDe` (un id) pagina hacia atrás.
 */
export function buscarEnHilo(db: Db, conversacionId: number, o: { consulta?: string | null; adjuntos?: boolean; quien?: 'operador' | 'asistente' | null; antesDe?: number | null; limite?: number } = {}): { mensajes: MensajeHilo[]; total: number } {
  const limite = Math.max(1, Math.min(o.limite ?? 10, 30))
  const filas = db.prepare(
    `SELECT id, rol, texto, en FROM mensajes WHERE conversacion_id = ? AND rol IN ('operador', 'asistente') AND texto IS NOT NULL AND texto != '' AND id < ?
     ${o.quien ? 'AND rol = ?' : ''} ORDER BY id DESC LIMIT 20000`,
  ).all(...[conversacionId, o.antesDe ?? Number.MAX_SAFE_INTEGER, ...(o.quien ? [o.quien] : [])]) as { id: number; rol: string; texto: string; en: number }[]
  let xs = o.adjuntos ? filas.filter((f) => adjuntosDe(f.texto).length) : filas
  const terminos = sinTildes(o.consulta ?? '').split(/[^a-z0-9ñ]+/).filter((t) => t.length >= 2 && !VACIAS.has(t))
  if (terminos.length) {
    const puntaje = (t: string) => { const n = sinTildes(t); return terminos.filter((x) => n.includes(x)).length }
    const todas = xs.filter((f) => puntaje(f.texto) === terminos.length)
    xs = todas.length ? todas : xs.map((f) => ({ f, p: puntaje(f.texto) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p || b.f.id - a.f.id).map((x) => x.f)
  }
  return {
    total: xs.length,
    mensajes: xs.slice(0, limite).map((f) => ({
      id: f.id, quien: f.rol === 'operador' ? 'operador' : 'Mastropiero',
      cuando: f.en > 1e12 ? `${fechaLocal(f.en)} ${new Date(f.en).toTimeString().slice(0, 5)}` : '',
      texto: recorte(limpio(f.texto), 1500), adjuntos: adjuntosDe(f.texto),
    })),
  }
}
