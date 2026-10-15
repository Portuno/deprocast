/**
 * Su horario fijo (el trabajo, una clase de todas las semanas): bloques por día de la semana que el día ya tiene
 * tomados. Las runs no ponen bandas encima, el chat sabe cuáles son sus ventanas libres y el gemelo lo tiene en cuenta.
 * Vive en el ajuste «horario_fijo» (JSON) y arranca vacío: lo carga él (por el chat o en los ajustes de Hoy).
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'

export type Bloque = { dias: number[]; desde: string; hasta: string; que: string }

const HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const dosDig = (s: string) => s.replace(/^(\d):/, '0$1:')

export function leerHorario(db: Db): Bloque[] {
  try {
    const v = JSON.parse(ajuste(db, 'horario_fijo') ?? '[]')
    return Array.isArray(v) ? v.filter(valido) : []
  } catch {
    return []
  }
}

const valido = (b: any): b is Bloque => b && Array.isArray(b.dias) && b.dias.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) && HORA.test(b.desde) && HORA.test(b.hasta) && hm(b.desde) < hm(b.hasta)

/** Reemplaza el horario entero. Vacío lo borra. */
export function fijarHorario(db: Db, bloques: unknown[]): Bloque[] {
  const bs = (bloques ?? []).map((b: any) => ({ dias: [...new Set((b?.dias ?? []).map(Number))].sort() as number[], desde: dosDig(String(b?.desde ?? '').trim()), hasta: dosDig(String(b?.hasta ?? '').trim()), que: String(b?.que ?? 'Ocupado').trim().slice(0, 60) || 'Ocupado' }))
  const malos = bs.filter((b) => !valido(b))
  if (malos.length) throw new Error('Cada bloque necesita días (0 = domingo … 6 = sábado) y un horario «HH:MM» de inicio menor que el fin')
  fijarAjuste(db, 'horario_fijo', JSON.stringify(bs))
  return bs
}

const LETRAS: Record<string, number> = { d: 0, l: 1, m: 2, x: 3, j: 4, v: 5, s: 6 }
const NOMBRES: Record<string, number> = { dom: 0, lun: 1, mar: 2, mie: 3, mié: 3, jue: 4, vie: 5, sab: 6, sáb: 6 }

/** «L-J 08:30-17:30 Trabajo; V 08:30-14:30 Trabajo» → bloques (lo que escribe en los ajustes). */
export function horarioDeTexto(texto: string): Bloque[] {
  return texto.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = /^(.+?)\s+(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})\s*(.*)$/i.exec(p)
    if (!m) throw new Error(`No entiendo «${p}»: escribilo como «L-J 08:30-17:30 Trabajo»`)
    const dias = new Set<number>()
    for (const parte of m[1].toLowerCase().split(/[,\s]+/).filter(Boolean)) {
      const r = parte.split('-').map((x) => NOMBRES[x.slice(0, 3)] ?? LETRAS[x[0]])
      if (r.some((x) => x == null)) throw new Error(`No entiendo los días «${parte}» (L M X J V S D)`)
      if (r.length === 2) for (let d = r[0]; ; d = (d + 1) % 7) { dias.add(d); if (d === r[1]) break }
      else dias.add(r[0])
    }
    return { dias: [...dias].sort(), desde: dosDig(m[2]), hasta: dosDig(m[3]), que: m[4].trim() || 'Ocupado' }
  })
}

const LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
/** Lo inverso: para mostrarlo en el campo de texto. */
export function horarioComoTexto(bs: Bloque[]): string {
  return bs.map((b) => {
    const ds = [...b.dias].sort()
    const corrido = ds.length > 2 && ds.every((d, i) => i === 0 || d === ds[i - 1] + 1)
    return `${corrido ? `${LETRA[ds[0]]}-${LETRA[ds.at(-1)!]}` : ds.map((d) => LETRA[d]).join(',')} ${b.desde}-${b.hasta} ${b.que}`
  }).join('; ')
}

/** Los bloques de un día (YYYY-MM-DD), en orden. */
export function bloquesDelDia(db: Db, fecha: string): { desde: string; hasta: string; que: string }[] {
  const dia = new Date(`${fecha}T12:00:00`).getDay()
  return leerHorario(db).filter((b) => b.dias.includes(dia)).map(({ desde, hasta, que }) => ({ desde, hasta, que })).sort((a, b) => hm(a.desde) - hm(b.desde))
}

/** Lo que el chat sabe de ese día: qué tiene fijo y cuáles son sus ventanas libres. */
export function horarioParaPrompt(db: Db, fecha: string): string {
  const bs = bloquesDelDia(db, fecha)
  if (!leerHorario(db).length) return ''
  if (!bs.length) return 'Hoy no tiene nada fijo (su horario fijo no toca hoy): el día es suyo.'
  const libres: string[] = []
  let cursor = 0
  for (const b of bs) { if (hm(b.desde) - cursor >= 30) libres.push(cursor === 0 ? `antes de las ${b.desde}` : `de ${aHora(cursor)} a ${b.desde}`); cursor = Math.max(cursor, hm(b.hasta)) }
  if (cursor < 23 * 60) libres.push(`después de las ${aHora(cursor)}`)
  return `Hoy tiene fijo: ${bs.map((b) => `${b.que} ${b.desde}–${b.hasta}`).join(', ')}. Ventanas libres: ${libres.join(', ')}. No le propongas cosas de escritorio adentro de lo fijo.`
}

const aHora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
