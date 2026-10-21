/**
 * La voz de Mastropiero en la charla: lo que el operador dice (se transcribe y entra al chat como suyo, marcado 🎙) y lo
 * que Mastropiero contesta en voz alta (kokoro, frase por frase, con caché para no pedir dos veces lo mismo).
 * Con el Directo prendido, lo que dice en la charla también cuenta como un momento de voz del Directo.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ajuste, type Db } from './db.ts'
import { nanTranscribir } from './nan.ts'
import { esRuido, sesionActiva } from './directo.ts'
import { enviar } from './chat/index.ts'

/** Las voces castellanas de kokoro. Santa por defecto (grave): la del maestro, hasta tener una mejor. */
export const VOCES_MASTROPIERO: Record<string, string> = { em_santa: 'Santa (grave)', em_alex: 'Alex', ef_dora: 'Dora' }
export const vozDeMastropiero = (db: Db) => {
  const v = ajuste(db, 'voz_mastropiero')
  return v && VOCES_MASTROPIERO[v] ? v : 'em_santa'
}

let sintetizar = async (texto: string, voz: string): Promise<Buffer> => (await import('./taller.ts')).sintetizar(texto, voz)
let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre, 'es')
export function _probarVoz(o: { sintetizar?: typeof sintetizar; transcribir?: typeof transcribir }) {
  if (o.sintetizar) sintetizar = o.sintetizar
  if (o.transcribir) transcribir = o.transcribir
}

/** Lo que no se lee en voz alta: las citas [#id], el markdown, los links. */
export function paraDecir(texto: string): string {
  return texto
    .replace(/\[#\d+\]/g, '')
    .replace(/https?:\/\/\S+/g, 'el link')
    .replace(/[*_`#>|]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** El audio de una frase con la voz de Mastropiero (guardado: la misma frase no se pide dos veces). */
export async function decir(db: Db, texto: string, dir: string, voz = vozDeMastropiero(db)): Promise<string | null> {
  const t = paraDecir(texto).slice(0, 600)
  if (!t) return null
  const archivo = `tts-${crypto.createHash('sha1').update(`${voz}|${t}`).digest('hex').slice(0, 16)}.mp3`
  const ruta = path.join(dir, archivo)
  if (!fs.existsSync(ruta)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(ruta, await sintetizar(t, voz))
  }
  return `/adjuntos/${archivo}`
}

/**
 * Un tramo de voz del operador en una conversación: se transcribe; si es ruido (silencio, música, las alucinaciones de
 * Whisper) no pasa nada. Si dijo algo, entra al chat como suyo (marcado voz) y Mastropiero contesta como siempre.
 * Con el Directo prendido, además queda como momento de voz del Directo (así el informe lo incluye y no se graba dos veces).
 */
export async function escucharTurno(db: Db, cid: number, audio: Buffer, o: { nombre?: string; segundos?: number | null; hud?: string | null; extra?: string | null; ahora?: number } = {}): Promise<{ texto: string | null }> {
  const ahora = o.ahora ?? Date.now()
  if (audio.length < 1500) return { texto: null }
  const texto = (await transcribir(db, audio, o.nombre || 'voz.webm')).trim()
  if (!texto || esRuido(texto)) return { texto: null }
  const s = sesionActiva(db)
  if (s) {
    db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, texto) VALUES (?, 'voz', ?, ?, ?)`)
      .run(s.id, ahora - Math.max(1, o.segundos ?? 5) * 1000, ahora, texto.slice(0, 8000))
    db.prepare('UPDATE directo_sesiones SET ultimo = ? WHERE id = ?').run(ahora, s.id)
  }
  void enviar(db, cid, texto, { hud: o.hud ?? null, via: 'voz', extra: o.extra ?? null })
  return { texto }
}
