/**
 * Los pasos con la app cerrada (Mobile 1.3), sin nada de React Native: se prueba desde el repo.
 * El teléfono da el total de pasos desde que se prendió (cuenta solo, aunque la app esté cerrada). Con dos lecturas se
 * sabe cuántos pasos hubo entre una y otra; se reparten por hora (proporcional al tiempo), así cada día y cada hora
 * se quedan con lo suyo aunque la app lea cada 15 minutos o recién al abrirla.
 * - Un reinicio del teléfono vuelve el total a cero: se nota porque cambió la hora de arranque o porque el total bajó;
 *   entonces los pasos nuevos son el total entero, contados desde el arranque.
 * - La primera lectura solo deja la marca (no se sabe cuándo se dieron los pasos de antes).
 * - Un salto absurdo (más de 60.000 entre dos lecturas) no se suma: se toma como marca nueva.
 */

export type Lectura = { total: number; arranque: number; en: number }
export type Reparto = { hora: string; pasos: number }[]

const MAX_SALTO = 60_000
const HORA = 3_600_000

const dos = (n: number) => String(n).padStart(2, '0')
/** La hora local, 'AAAA-MM-DDTHH'. */
export const horaDe = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}` }
/** El inicio de la hora local que contiene t. */
const inicioHora = (t: number) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime() }

/** Reparte n pasos entre desde y hasta, por hora local, proporcional al tiempo (la suma da n exacto). */
export function repartir(n: number, desde: number, hasta: number): Reparto {
  n = Math.round(n)
  if (!(n > 0)) return []
  if (!(hasta > desde)) return [{ hora: horaDe(hasta), pasos: n }]
  const tramos: { hora: string; ms: number }[] = []
  for (let a = desde; a < hasta;) {
    const fin = Math.min(hasta, inicioHora(a) + HORA)
    tramos.push({ hora: horaDe(a), ms: fin - a })
    a = fin
  }
  const total = hasta - desde
  const crudos = tramos.map((x) => (n * x.ms) / total)
  const enteros = crudos.map(Math.floor)
  let falta = n - enteros.reduce((a, b) => a + b, 0)
  // Lo que sobra del redondeo va a las horas con más resto.
  for (const i of crudos.map((c, i) => [c - enteros[i], i] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1])) {
    if (falta <= 0) break
    enteros[i]++; falta--
  }
  return tramos.map((x, i) => ({ hora: x.hora, pasos: enteros[i] })).filter((x) => x.pasos > 0)
}

/** Con la lectura anterior y la nueva: cuántos pasos hubo, repartidos por hora, y si el teléfono se reinició. */
export function contar(prev: Lectura | null, nueva: Lectura): { pasos: number; reparto: Reparto; reinicio: boolean } {
  if (!prev) return { pasos: 0, reparto: [], reinicio: false }
  const reinicio = Math.abs(nueva.arranque - prev.arranque) > 60_000 || nueva.total < prev.total
  const pasos = Math.round(reinicio ? nueva.total : nueva.total - prev.total)
  if (!(pasos > 0) || pasos > MAX_SALTO) return { pasos: 0, reparto: [], reinicio }
  const desde = reinicio ? Math.max(prev.en, nueva.arranque) : prev.en
  return { pasos, reparto: repartir(pasos, desde, nueva.en), reinicio }
}

/** Las 24 horas de un día ('AAAA-MM-DD') con sus pasos, a partir de las filas guardadas. */
export function horasDelDia(fecha: string, filas: { hora: string; pasos: number }[]): number[] {
  const out = Array.from({ length: 24 }, () => 0)
  for (const f of filas) if (f.hora.startsWith(fecha)) out[Number(f.hora.slice(11, 13))] += f.pasos
  return out
}
