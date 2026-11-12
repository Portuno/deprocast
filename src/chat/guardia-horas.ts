/**
 * La guardia de las horas (Fragua #248): una reunión o una cita no se nombra con su hora sin su fecha absoluta. La regla
 * escrita (#245) no alcanzó —con la agenda de hoy vacía, el chat dijo «la reunión de las 15» y era la del 9/11—, así que
 * se hace cumplir acá, sin modelo: después de cada respuesta, toda frase que nombra una reunión con hora y sin fecha se
 * cruza con la agenda de verdad. Si hoy no hay nada a esa hora, queda un aviso en la charla (con la que sí hay, de qué
 * día es) y el caso se cuenta en los errores.
 */
import { fechaLocal, type Db } from '../db.ts'
import { verAgenda } from '../dia.ts'
import { diaSemana } from '../zona.ts'

const REUNION = /(?<!\p{L})(reuni[oó]n(es)?|cita|llamada|videollamada|meet(ing)?|entrevista|turno con|turno del|turno m[eé]dico|evento|charla con|call)(?!\p{L})/iu
const HORA = /(?<!\p{L})(?:a|de|desde|hasta|para)\s+las\s+(\d{1,2})(?:[:.](\d{2}))?(?!\d)|(?<![\d/])(\d{1,2})[:.](\d{2})(?!\d)|(?<![\d/])(\d{1,2})\s*(?:h|hs)(?!\p{L})/giu
// Una fecha absoluta en la misma frase: 9/11, «lunes 9», «9 de noviembre».
const FECHA = /(?<![\d/])\d{1,2}\/\d{1,2}(?![\d])|(?<!\p{L})(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|lun|mar|mi[eé]|jue|vie|s[aá]b|dom)\.?\s+\d{1,2}(?!\d)|\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/iu

export type HoraSinFecha = { hora: number; minuto: number; frase: string }

/** Las frases que nombran una reunión (o cita, llamada…) con una hora y sin fecha absoluta. */
export function horasSinFecha(texto: string): HoraSinFecha[] {
  const out: HoraSinFecha[] = []
  for (const frase of texto.split(/(?<=[.!?;])\s+|\n+/)) {
    if (!REUNION.test(frase) || FECHA.test(frase)) continue
    for (const m of frase.matchAll(HORA)) {
      const hora = Number(m[1] ?? m[3] ?? m[5]), minuto = Number(m[2] ?? m[4] ?? 0)
      if (hora > 23 || minuto > 59) continue
      if (!out.some((x) => x.hora === hora && x.minuto === minuto)) out.push({ hora, minuto, frase: frase.trim().slice(0, 200) })
    }
  }
  return out
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
const dmy = (fecha: string) => diaSemana(fecha)

/** Inyectable: la agenda de varios días (en los tests, sin calendario). */
let agenda = (db: Db, desde: string, hasta: string) => verAgenda(db, desde, hasta)
export function _probarGuardia(f: typeof agenda) { agenda = f }

/**
 * El aviso para lo que no está verificado, o null si está todo bien: cada hora nombrada sin fecha tiene que estar en la
 * agenda (o el horario fijo) de hoy. Si no está, se busca en la semana de antes y la de después, para decir cuál es.
 */
export async function verificarHoras(db: Db, texto: string, ahora = Date.now()): Promise<{ aviso: string; horas: HoraSinFecha[] } | null> {
  const horas = horasSinFecha(texto)
  if (!horas.length) return null
  const hoy = fechaLocal(ahora)
  const desde = fechaLocal(ahora - 7 * 86_400_000)
  const dias = await agenda(db, desde, fechaLocal(ahora + 6 * 86_400_000))
  const empieza = (rango: string, h: number) => new RegExp(`^${String(h).padStart(2, '0')}:`).test(rango) || new RegExp(`^${h}:`).test(rango)
  const deHoy = dias.find((d) => d.fecha === hoy)
  const malas: string[] = []
  for (const x of horas) {
    const hoyLaTiene = !!deHoy && (deHoy.eventos.some((e) => empieza(e.hora, x.hora)) || deHoy.fijo.some((f) => empieza(f.desde, x.hora)))
    if (hoyLaTiene) continue
    const otras = dias.flatMap((d) => d.eventos.filter((e) => d.fecha !== hoy && empieza(e.hora, x.hora)).map((e) => ({ ...e, fecha: d.fecha })))
    // La más cercana a hoy (lo más probable es que hable de esa).
    const cerca = otras.sort((a, b) => Math.abs(Date.parse(a.fecha) - Date.parse(hoy)) - Math.abs(Date.parse(b.fecha) - Date.parse(hoy)))[0]
    malas.push(cerca
      ? `la de las ${hhmm(x.hora, x.minuto)} que tengo es «${cerca.titulo}» del ${dmy(cerca.fecha)} (${cerca.hora})`
      : `no encuentro nada a las ${hhmm(x.hora, x.minuto)} en la agenda de esta semana ni la anterior`)
  }
  if (!malas.length) return null
  const vacia = deHoy && !deHoy.eventos.length ? ' (hoy no tiene eventos en la agenda)' : ''
  return { aviso: `Ojo con la hora: hoy, ${dmy(hoy)}, no hay ninguna reunión a esa hora${vacia}: ${malas.join('; ')}. Lo que dije no estaba verificado.`, horas }
}
