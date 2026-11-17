/**
 * Contestar también en audio, por canal (Fragua #311). Cada canal tiene su preferencia (Telegram y WhatsApp aparte):
 * «0» solo escrito, «1» en audio cuando él manda un audio, «siempre». Y el audio nunca reemplaza un dato que hay que leer:
 * - el texto sale siempre escrito, entero; el audio lo acompaña;
 * - el audio lleva solo el marco: sin listas, tablas, código ni las frases con números u horas (eso se lee);
 * - un turno corto (dos líneas) no lleva audio, ni lo que queda si al sacar los datos no hay nada que decir.
 */
import type { DatabaseSync } from 'node:sqlite'
import { ajuste, fijarAjuste } from './db.ts'

type Db = DatabaseSync
export type CanalVoz = 'telegram' | 'whatsapp'
export type PreferenciaVoz = '0' | '1' | 'siempre'
const CLAVE: Record<CanalVoz, string> = { telegram: 'telegram_voz', whatsapp: 'whatsapp_voz' }
const DEFECTO: Record<CanalVoz, PreferenciaVoz> = { telegram: '0', whatsapp: '1' }

export const canalVoz = (nombre: string | null | undefined): CanalVoz => (/whatsapp/i.test(String(nombre ?? '')) ? 'whatsapp' : 'telegram')
export function vozDelCanal(db: Db, c: CanalVoz): PreferenciaVoz {
  const v = ajuste(db, CLAVE[c])
  return v === '0' || v === '1' || v === 'siempre' ? v : DEFECTO[c]
}
export function fijarVozDelCanal(db: Db, c: CanalVoz, v: string) {
  if (!['0', '1', 'siempre'].includes(v)) throw new Error('La voz va «0», «1» o «siempre»')
  fijarAjuste(db, CLAVE[c], v)
}
/** ¿Esta respuesta va también en audio, por este canal? */
export const tocaVoz = (pref: PreferenciaVoz, porVoz: boolean) => pref === 'siempre' || (pref === '1' && porVoz)

const MIN_LINEAS = 3
const MIN_CARACTERES = 140
const MAX_CARACTERES = 2500
const esDato = /\d/
const esLista = /^\s*(?:[-*•·]|\d+[.)]|[a-z][.)])\s+/i
const sinMarcas = (md: string) => md.replace(/\[#\d+\]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[*_`#>~]+/g, '')

/**
 * Lo que se dice en audio de una respuesta: el marco, sin los datos. null si no hace falta audio (turno corto o todo
 * datos). Si se sacó algo, termina avisando que el detalle está escrito.
 */
export function marcoParaVoz(texto: string): string | null {
  const t = String(texto ?? '').replace(/```[\s\S]*?```/g, '\n').trim()
  const lineas = t.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lineas.length < MIN_LINEAS && t.length < 300) return null
  let saco = false
  const prosa: string[] = []
  for (const l of lineas) {
    if (esLista.test(l) || l.includes('|') || /^_.*_$/.test(l)) { saco = true; continue }
    const frases = sinMarcas(l).split(/(?<=[.!?…])\s+/).map((f) => f.trim()).filter(Boolean)
    const quedan = frases.filter((f) => !esDato.test(f))
    if (quedan.length < frases.length) saco = true
    // Una frase que presenta una lista («Te dejo tres opciones:») sin la lista no se entiende: va solo si cierra.
    const juntas = quedan.join(' ').replace(/:\s*$/, '.').trim()
    if (juntas) prosa.push(juntas)
  }
  const dicho = prosa.join(' ').replace(/\s+/g, ' ').trim()
  if (dicho.length < MIN_CARACTERES) return null
  const corte = dicho.length > MAX_CARACTERES ? `${dicho.slice(0, dicho.lastIndexOf('.', MAX_CARACTERES) + 1 || MAX_CARACTERES)}` : dicho
  return saco ? `${corte} El detalle te lo dejé escrito.` : corte
}
