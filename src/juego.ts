/**
 * La liga como juego (Fragua #262), con los códigos de los juegos de navegador, sobre lo que la liga ya tiene: la matriz
 * 6×6 de los arquetipos, la economía semanal, la banca y el Monedero.
 * - Roguelike: cada arquetipo tiene su corrida. Se pierde (se queda sin agentes activos, o quiebra dos semanas seguidas)
 *   y se vuelve a empezar, con algo que queda: un legado de influencia y los artefactos, que no se pierden nunca.
 * - Épocas: la corrida avanza por eras. Cada época son seis niveles geométricos de diez puntos (Punto, Línea, Triángulo,
 *   Cuadrado, Pentágono, Hexágono); al completar el Hexágono la época cierra con su sello. Lo de cada época (compras,
 *   drops) queda en el diario con su época: se archiva, no se borra.
 * - Neopets: el avatar del arquetipo es su figura del nivel. Cada nivel alcanzado en la corrida desbloquea una función
 *   real de la plataforma (la tienda, los drops, la red con sus vecinos, el fichaje, el indulto, las cuentas en libre).
 * - Ogame / Manager Zone: la influencia es el recurso. Se gana con los puntos, llega de los vecinos de la matriz (lo que
 *   gana uno aparece como recurso del otro) y se gasta en la tienda: entrenar, fichar, indultar.
 * - Gladiatus: los atributos de cada agente, que la tienda entrena (con su tope).
 * - Nada de rachas vacías: cada punto es una línea positiva de la economía (una tarea hecha, un aporte, una respuesta,
 *   una reunión, un cliente, una pieza suya que se usó). Las pérdidas no restan puntos: solo cuentan para quebrar.
 */
import { json, type Db } from './db.ts'
import { ATRIBUTO_MAX, ATRIBUTOS, CLASES, esClase } from './clases.ts'
import { balance, ventana } from './economia.ts'
import { semanaDe } from './misiones.ts'
import { alias, cambiarEstado, forjar, leer, listar, type Ficha } from './roster.ts'

export const PUNTOS_NIVEL = 10
export const NIVELES = 6
export const PUNTOS_EPOCA = PUNTOS_NIVEL * NIVELES
/** Lo que reparte a cada vecino un arquetipo en red (desde el Cuadrado): una décima de lo que gana. */
export const PARTE_VECINO = 0.1
/** Lo que se lleva una corrida nueva de la influencia que le quedaba a la anterior. */
export const PARTE_LEGADO = 0.25
/** Un hito: una línea de la economía que paga esto o más deja un artefacto (desde el Triángulo). */
export const HITO = 10

export const GEOMETRIA = [
  { n: 1, nombre: 'Punto', glifo: '•', desbloquea: 'La corrida existe: lo que hacen sus agentes suma puntos.' },
  { n: 2, nombre: 'Línea', glifo: '—', desbloquea: 'Abre la tienda: Entrenamiento (+1 a un atributo de un agente suyo).' },
  { n: 3, nombre: 'Triángulo', glifo: '△', desbloquea: 'Drops: cada hito real de sus agentes (un aporte, una respuesta, una reunión, un cliente) deja un artefacto.' },
  { n: 4, nombre: 'Cuadrado', glifo: '□', desbloquea: 'En red: una décima de lo que gana llega como influencia a sus vecinos de la matriz 6×6. Y el Fichaje: forjar un agente en su celda.' },
  { n: 5, nombre: 'Pentágono', glifo: '⬠', desbloquea: 'El Indulto (sacar a un agente suyo de la banca) y las cuentas de redes de sus agentes pueden ir en «libre».' },
  { n: 6, nombre: 'Hexágono', glifo: '⬡', desbloquea: 'Completarlo cierra la época con su sello: la corrida sigue en la siguiente, con todo lo desbloqueado.' },
] as const

export const TIENDA = {
  entrenamiento: { nombre: 'Entrenamiento', nivel: 2, costo: 20, que: '+1 a un atributo de un agente del arquetipo (hasta el tope)' },
  fichaje: { nombre: 'Fichaje', nivel: 4, costo: 40, que: 'Forjar un agente nuevo en la celda del arquetipo' },
  indulto: { nombre: 'Indulto', nivel: 5, costo: 30, que: 'Sacar a un agente del arquetipo de la banca' },
} as const
export type Item = keyof typeof TIENDA

const r2 = (n: number) => Math.round(n * 100) / 100
const romano = (n: number) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] ?? String(n)

// ─── los puntos de cada semana (solo lo hecho de verdad) ────────────────────

type PuntosAgente = { agente: string; arquetipo: number | null; puntos: number; detalle: { motivo: string; monto: number }[]; neto: number }

/**
 * Los puntos de cada agente en una semana: la suma de sus líneas positivas de la economía. Una semana cerrada se guarda
 * (con el arquetipo de cada agente en ese momento) y no se recalcula: si después se retira o cambia de celda, lo que
 * sumó queda donde lo sumó.
 */
export function puntosDeSemana(db: Db, semana: string, ahora = Date.now()): PuntosAgente[] {
  const cerrada = semana < semanaDe(ahora)
  if (cerrada && db.prepare(`SELECT 1 FROM juego_semanas WHERE semana = ? AND agente = '*'`).get(semana)) {
    return (db.prepare(`SELECT * FROM juego_semanas WHERE semana = ? AND agente != '*'`).all(semana) as any[]).map((r) => {
      const d = json<{ lineas?: { motivo: string; monto: number }[]; neto?: number }>(r.detalle, {}) ?? {}
      return { agente: r.agente, arquetipo: r.arquetipo, puntos: r.puntos, detalle: d.lineas ?? [], neto: d.neto ?? r.puntos }
    })
  }
  const lineas = balance(db, semana)
  const celdas = new Map((db.prepare('SELECT id, celda FROM agentes').all() as { id: string; celda: number | null }[]).map((a) => [a.id, a.celda]))
  const por = new Map<string, PuntosAgente>()
  for (const l of lineas) {
    const x = por.get(l.agente) ?? { agente: l.agente, arquetipo: celdas.get(l.agente) ?? null, puntos: 0, detalle: [], neto: 0 }
    x.neto = r2(x.neto + l.monto)
    if (l.monto > 0) { x.puntos = r2(x.puntos + l.monto); x.detalle.push({ motivo: l.motivo, monto: l.monto }) }
    por.set(l.agente, x)
  }
  const out = [...por.values()]
  if (cerrada) {
    const ins = db.prepare('INSERT OR REPLACE INTO juego_semanas (semana, agente, arquetipo, puntos, detalle) VALUES (?, ?, ?, ?, ?)')
    for (const x of out) ins.run(semana, x.agente, x.arquetipo, x.puntos, JSON.stringify({ lineas: x.detalle, neto: x.neto }))
    ins.run(semana, '*', null, 0, null) // la marca: esta semana ya está guardada
  }
  return out
}

/** Las semanas ISO desde la de `desde` hasta la de `hasta`, en orden. */
function semanas(desde: number, hasta: number): string[] {
  const out: string[] = []
  let s = semanaDe(desde)
  const fin = semanaDe(hasta)
  for (let i = 0; i < 520 && s <= fin; i++) { out.push(s); s = semanaDe(ventana(s)[1] + 3_600_000) }
  return out
}

// ─── corridas ──────────────────────────────────────────────────────────────

export type Corrida = { id: number; arquetipo: number; numero: number; empezada: number; terminada: number | null; causa: string | null; legado: number }
const deCorrida = (r: any): Corrida => ({ id: r.id, arquetipo: r.arquetipo, numero: r.numero, empezada: r.empezada, terminada: r.terminada, causa: r.causa, legado: r.legado })

function diario(db: Db, c: { corrida: number; epoca: number; tipo: string; texto: string; costo?: number | null; ref?: string | null }, ahora: number) {
  db.prepare('INSERT OR IGNORE INTO juego_diario (corrida_id, epoca, tipo, texto, costo, ref, en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.corrida, c.epoca, c.tipo, c.texto.slice(0, 400), c.costo ?? null, c.ref ?? null, ahora)
}

export function corridaAbierta(db: Db, arquetipo: number, ahora = Date.now(), legado = 0): Corrida {
  const ya = db.prepare('SELECT * FROM juego_corridas WHERE arquetipo = ? AND terminada IS NULL').get(arquetipo)
  if (ya) return deCorrida(ya)
  const numero = ((db.prepare('SELECT MAX(numero) AS n FROM juego_corridas WHERE arquetipo = ?').get(arquetipo) as { n: number | null }).n ?? 0) + 1
  const id = Number(db.prepare('INSERT INTO juego_corridas (arquetipo, numero, empezada, legado) VALUES (?, ?, ?, ?)').run(arquetipo, numero, ahora, r2(legado)).lastInsertRowid)
  diario(db, { corrida: id, epoca: 1, tipo: 'inicio', texto: `Empieza la corrida ${numero}${legado > 0 ? ` con ${r2(legado)} de influencia de legado` : ''}.` }, ahora)
  return deCorrida(db.prepare('SELECT * FROM juego_corridas WHERE id = ?').get(id))
}

/** Los arquetipos en juego: los que tienen agentes en su celda o una corrida abierta. */
function enJuego(db: Db): number[] {
  return (db.prepare(`SELECT DISTINCT celda AS n FROM agentes WHERE celda BETWEEN 1 AND 72 UNION SELECT arquetipo FROM juego_corridas WHERE terminada IS NULL ORDER BY 1`).all() as { n: number }[]).map((r) => r.n)
}

/** Los vecinos de un arquetipo en la matriz 6×6: los de su misma fila o su misma columna. */
export function vecinos(db: Db, n: number): number[] {
  let fs: { n: number; fila: number | null; columna: number | null }[] = []
  try { fs = db.prepare('SELECT n, fila, columna FROM arquetipo_fichas').all() as any[] } catch { return [] }
  const yo = fs.find((f) => f.n === n)
  if (!yo || yo.fila == null || yo.columna == null) return []
  return fs.filter((f) => f.n !== n && f.fila != null && f.columna != null && (f.fila === yo.fila || f.columna === yo.columna)).map((f) => f.n)
}

export type EstadoCorrida = Corrida & {
  puntos: number; epoca: number; nivel: number; enNivel: number; alcanzado: number; geometria: (typeof GEOMETRIA)[number]
  recibido: number; gastado: number; influencia: number; porSemana: { semana: string; puntos: number }[]
}

/**
 * Cómo va cada corrida abierta: sus puntos (de sus agentes, desde que empezó), la época y el nivel, el nivel más alto
 * alcanzado (lo que desbloquea), la influencia que le llegó de sus vecinos en red y la que gastó en la tienda.
 */
export function estados(db: Db, ahora = Date.now()): Map<number, EstadoCorrida> {
  const abiertas = enJuego(db).map((n) => corridaAbierta(db, n, ahora))
  if (!abiertas.length) return new Map()
  const todas = semanas(Math.min(...abiertas.map((c) => c.empezada)), ahora)
  const porSemana = new Map(todas.map((s) => [s, puntosDeSemana(db, s, ahora)]))
  // Primero lo propio de cada uno, semana a semana (y cuándo llegó a cada nivel).
  const propio = new Map<number, { semana: string; puntos: number; acumulado: number }[]>()
  for (const c of abiertas) {
    let acum = 0
    propio.set(c.arquetipo, todas.filter((s) => s >= semanaDe(c.empezada)).map((s) => {
      const p = r2((porSemana.get(s) ?? []).filter((x) => x.arquetipo === c.arquetipo).reduce((t, x) => t + x.puntos, 0))
      acum = r2(acum + p)
      return { semana: s, puntos: p, acumulado: acum }
    }))
  }
  const alcanzadoTras = (acum: number) => (acum >= PUNTOS_EPOCA ? NIVELES : Math.floor(acum / PUNTOS_NIVEL) + 1)
  // Lo que reparte cada uno en red: desde la semana en que llegó al Cuadrado, una décima de lo suyo a cada vecino.
  const recibido = new Map<number, number>()
  for (const c of abiertas) {
    const semanasC = propio.get(c.arquetipo)!
    const vs = vecinos(db, c.arquetipo).filter((v) => abiertas.some((x) => x.arquetipo === v))
    if (!vs.length) continue
    semanasC.forEach((w, i) => {
      const antes = i ? semanasC[i - 1].acumulado : 0
      if (alcanzadoTras(antes) < 4) return
      for (const v of vs) {
        const cv = abiertas.find((x) => x.arquetipo === v)!
        if (w.semana < semanaDe(cv.empezada)) continue
        recibido.set(v, r2((recibido.get(v) ?? 0) + w.puntos * PARTE_VECINO))
      }
    })
  }
  const out = new Map<number, EstadoCorrida>()
  for (const c of abiertas) {
    const ws = propio.get(c.arquetipo)!
    const puntos = ws.at(-1)?.acumulado ?? 0
    const epoca = Math.floor(puntos / PUNTOS_EPOCA) + 1
    const enEpoca = puntos - (epoca - 1) * PUNTOS_EPOCA
    const nivel = Math.min(NIVELES, Math.floor(enEpoca / PUNTOS_NIVEL) + 1)
    const gastado = (db.prepare(`SELECT COALESCE(SUM(costo), 0) AS s FROM juego_diario WHERE corrida_id = ? AND tipo = 'compra'`).get(c.id) as { s: number }).s
    const rec = recibido.get(c.arquetipo) ?? 0
    out.set(c.arquetipo, {
      ...c, puntos, epoca, nivel, enNivel: r2(enEpoca - (nivel - 1) * PUNTOS_NIVEL), alcanzado: alcanzadoTras(puntos), geometria: GEOMETRIA[nivel - 1],
      recibido: rec, gastado: r2(gastado), influencia: r2(c.legado + puntos + rec - gastado), porSemana: ws.map((w) => ({ semana: w.semana, puntos: w.puntos })),
    })
  }
  return out
}

/**
 * Lo que pasa solo al mirar: las épocas que se completaron dejan su sello, y desde el Triángulo cada hito real de sus
 * agentes deja un artefacto. Todo por su referencia (una vez cada cosa).
 */
export function avanzar(db: Db, ahora = Date.now()): { sellos: number; drops: number } {
  let sellos = 0, drops = 0
  for (const e of estados(db, ahora).values()) {
    for (let ep = 1; ep < e.epoca; ep++) {
      const ref = `epoca:${e.id}:${ep}`
      if (db.prepare('SELECT 1 FROM juego_artefactos WHERE ref = ?').get(ref)) continue
      db.prepare('INSERT INTO juego_artefactos (arquetipo, corrida_id, epoca, nombre, de_que, ref, en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(e.arquetipo, e.id, ep, `Sello de la época ${romano(ep)}`, `Completó el Hexágono de la época ${romano(ep)} en la corrida ${e.numero}`, ref, ahora)
      diario(db, { corrida: e.id, epoca: ep + 1, tipo: 'epoca', texto: `Cierra la época ${romano(ep)}: empieza la ${romano(ep + 1)}. Lo de la ${romano(ep)} queda archivado.`, ref: `diario:${ref}` }, ahora)
      sellos++
    }
    // Drops: los hitos de las semanas en que ya había llegado al Triángulo.
    let acum = 0
    for (const w of e.porSemana) {
      const antes = acum
      acum = r2(acum + w.puntos)
      if ((antes >= PUNTOS_EPOCA ? NIVELES : Math.floor(antes / PUNTOS_NIVEL) + 1) < 3 && (acum >= PUNTOS_EPOCA ? NIVELES : Math.floor(acum / PUNTOS_NIVEL) + 1) < 3) continue
      for (const x of puntosDeSemana(db, w.semana, ahora).filter((y) => y.arquetipo === e.arquetipo)) {
        for (const l of x.detalle.filter((d) => d.monto >= HITO)) {
          const ref = `drop:${w.semana}:${x.agente}:${l.motivo}`
          const epoca = Math.floor(acum / PUNTOS_EPOCA) + 1
          const r = db.prepare('INSERT OR IGNORE INTO juego_artefactos (arquetipo, corrida_id, epoca, nombre, de_que, ref, en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(e.arquetipo, e.id, Math.min(epoca, e.epoca), `Trofeo: ${l.motivo}`, `${x.agente}, semana ${w.semana}: ${l.motivo} (+${l.monto})`, ref, ahora)
          if (r.changes) { drops++; diario(db, { corrida: e.id, epoca: Math.min(epoca, e.epoca), tipo: 'drop', texto: `Drop: «Trofeo: ${l.motivo}» de ${x.agente}.`, ref: `diario:${ref}` }, ahora) }
        }
      }
    }
  }
  return { sellos, drops }
}

// ─── la tienda ─────────────────────────────────────────────────────────────

const agentesDe = (n: number, db: Db) => listar(db).filter((f) => f.celda === n)

/** Compra en la tienda del arquetipo: chequea el nivel alcanzado y la influencia, y hace el efecto de verdad. */
export function comprar(db: Db, arquetipo: number, item: string, args: { agente?: string; atributo?: string; clase?: string } = {}, ahora = Date.now()) {
  const t = TIENDA[item as Item]
  if (!t) throw new Error(`No hay «${item}» en la tienda (hay: ${Object.keys(TIENDA).join(', ')})`)
  const e = estados(db, ahora).get(arquetipo)
  if (!e) throw new Error(`El arquetipo ${arquetipo} no está en juego (no tiene agentes en su celda)`)
  if (e.alcanzado < t.nivel) throw new Error(`${t.nombre} se desbloquea en el ${GEOMETRIA[t.nivel - 1].nombre} (nivel ${t.nivel}); va por el ${GEOMETRIA[e.alcanzado - 1].nombre}`)
  if (e.influencia < t.costo) throw new Error(`${t.nombre} cuesta ${t.costo} de influencia; tiene ${e.influencia}`)
  let texto: string
  const suyo = (ref?: string): Ficha => {
    const f = ref ? leer(db, ref) : null
    if (!f || f.celda !== arquetipo) throw new Error(`Ese agente no es del arquetipo ${arquetipo}`)
    return f
  }
  if (item === 'entrenamiento') {
    const f = suyo(args.agente)
    const at = ATRIBUTOS.find((a) => a.id === args.atributo || a.sigla.toLowerCase() === String(args.atributo ?? '').toLowerCase() || a.nombre.toLowerCase() === String(args.atributo ?? '').toLowerCase())
    if (!at) throw new Error(`Falta el atributo (${ATRIBUTOS.map((a) => a.nombre).join(', ')})`)
    if ((f.atributos[at.id] ?? 0) >= ATRIBUTO_MAX) throw new Error(`${alias(f)} ya tiene ${at.nombre} al tope (${ATRIBUTO_MAX})`)
    db.prepare('UPDATE agentes SET atributos = ? WHERE id = ?').run(JSON.stringify({ ...f.atributos, [at.id]: (f.atributos[at.id] ?? 0) + 1 }), f.id)
    texto = `Entrenamiento: ${alias(f)} sube ${at.nombre} a ${(f.atributos[at.id] ?? 0) + 1}.`
  } else if (item === 'fichaje') {
    if (!args.clase || !esClase(args.clase) || ['ejecutivo', 'gerente'].includes(args.clase)) throw new Error(`Falta la clase del fichaje (${Object.keys(CLASES).filter((c) => !['ejecutivo', 'gerente'].includes(c)).join(', ')})`)
    const f = forjar(db, { clase: args.clase, celda: arquetipo, creador: 'operador', misionPrincipal: `Fichado por el arquetipo ${arquetipo}`, ahora })
    texto = `Fichaje: llega ${f.id} (${CLASES[f.clase].nombre}).`
  } else {
    const f = suyo(args.agente)
    if (f.estado !== 'banca') throw new Error(`${alias(f)} no está en la banca`)
    cambiarEstado(db, f.id, 'activo')
    texto = `Indulto: ${alias(f)} vuelve de la banca.`
  }
  diario(db, { corrida: e.id, epoca: e.epoca, tipo: 'compra', texto, costo: t.costo }, ahora)
  return { texto, influencia: r2(e.influencia - t.costo) }
}

/** ¿Las cuentas de redes de este agente pueden ir en «libre»? Solo si su arquetipo llegó al Pentágono en esta corrida. */
export function puedeLibre(db: Db, agenteId: string, ahora = Date.now()): { si: boolean; porQue?: string } {
  const f = leer(db, agenteId)
  if (!f?.celda) return { si: false, porQue: 'El agente no está en ningún arquetipo: sus cuentas van en «redacta» (ponelo en una celda y que su arquetipo llegue al Pentágono)' }
  const e = estados(db, ahora).get(f.celda)
  return e && e.alcanzado >= 5 ? { si: true } : { si: false, porQue: `Las cuentas de sus agentes van en «libre» desde el Pentágono (nivel 5); el arquetipo ${f.celda} va por el ${GEOMETRIA[(e?.alcanzado ?? 1) - 1].nombre}` }
}

// ─── perder y volver a empezar ─────────────────────────────────────────────

/**
 * Al cerrar la temporada: una corrida se pierde si su arquetipo se quedó sin agentes activos (y lleva una semana), o si
 * sus agentes quebraron dos semanas seguidas (el neto de la semana, pérdidas incluidas, en rojo). Empieza otra con un
 * cuarto de la influencia que le quedaba; los artefactos quedan.
 */
export function revisarCorridas(db: Db, semana: string, ahora = Date.now()): { perdidas: { arquetipo: number; causa: string }[] } {
  const perdidas: { arquetipo: number; causa: string }[] = []
  const anterior = semanaDe(ventana(semana)[0] - 3_600_000)
  const neto = (s: string, n: number) => puntosDeSemana(db, s, ahora).filter((x) => x.arquetipo === n).reduce((t, x) => t + x.neto, 0)
  for (const e of estados(db, ahora).values()) {
    const activos = agentesDe(e.arquetipo, db).filter((f) => f.estado !== 'banca')
    let causa: string | null = null
    if (!activos.length && ahora - e.empezada >= 7 * 86_400_000) causa = 'se quedó sin agentes activos'
    else if (semanaDe(e.empezada) <= anterior && puntosDeSemana(db, semana, ahora).some((x) => x.arquetipo === e.arquetipo) && neto(semana, e.arquetipo) < 0 && neto(anterior, e.arquetipo) < 0) causa = 'quebró dos semanas seguidas'
    if (!causa) continue
    db.prepare('UPDATE juego_corridas SET terminada = ?, causa = ? WHERE id = ?').run(ahora, causa, e.id)
    diario(db, { corrida: e.id, epoca: e.epoca, tipo: 'fin', texto: `Se pierde la corrida ${e.numero} en la época ${romano(e.epoca)}: ${causa}.` }, ahora)
    perdidas.push({ arquetipo: e.arquetipo, causa })
    // Sin agentes, no hay corrida nueva todavía: empieza cuando vuelva a tener alguno (con su legado guardado).
    const legado = Math.max(0, e.influencia) * PARTE_LEGADO
    if (activos.length || agentesDe(e.arquetipo, db).length) corridaAbierta(db, e.arquetipo, ahora + 1, legado)
    else db.prepare('UPDATE juego_corridas SET legado = ? WHERE id = ?').run(r2(legado), e.id)
  }
  return { perdidas }
}

// ─── el tablero ────────────────────────────────────────────────────────────

/** Todo para la pantalla: cada arquetipo en juego con su corrida, su avatar, su tienda y sus artefactos; los rankings. */
export async function tablero(db: Db, ahora = Date.now()) {
  avanzar(db, ahora)
  const { fichaDe } = await import('./arquetipos.ts')
  const { saldoSiExiste } = await import('./tesoro.ts')
  const est = estados(db, ahora)
  const semana = semanaDe(ahora)
  const arquetipos = [...est.values()].map((e) => {
    const f = fichaDe(db, e.arquetipo)
    const ags = agentesDe(e.arquetipo, db)
    const misiones = (db.prepare(`SELECT estado, COUNT(*) AS n FROM agente_misiones WHERE agente_id IN (${ags.map(() => '?').join(',') || "''"}) GROUP BY estado`).all(...ags.map((a) => a.id)) as { estado: string; n: number }[])
    return {
      ...e, nombre: f.nombre, oficio: f.oficio, elemento: f.elemento, fila: f.fila, columna: f.columna,
      agentes: ags.map((a) => ({ id: a.id, nombre: alias(a), clase: a.clase, estado: a.estado, atributos: a.atributos })),
      misiones: Object.fromEntries(misiones.map((m) => [m.estado, m.n])),
      vecinos: vecinos(db, e.arquetipo).filter((v) => est.has(v)),
      monedero: (() => { try { return saldoSiExiste(db, `arquetipo:${e.arquetipo}`) } catch { return 0 } })(),
      artefactos: (db.prepare('SELECT nombre, de_que, epoca, corrida_id, en FROM juego_artefactos WHERE arquetipo = ? ORDER BY en DESC LIMIT 30').all(e.arquetipo) as any[]),
      diario: (db.prepare('SELECT d.epoca, d.tipo, d.texto, d.costo, d.en, c.numero FROM juego_diario d JOIN juego_corridas c ON c.id = d.corrida_id WHERE c.arquetipo = ? ORDER BY d.en DESC, d.id DESC LIMIT 40').all(e.arquetipo) as any[]),
      anteriores: (db.prepare('SELECT numero, empezada, terminada, causa FROM juego_corridas WHERE arquetipo = ? AND terminada IS NOT NULL ORDER BY numero DESC').all(e.arquetipo) as any[]),
    }
  }).sort((a, b) => b.puntos - a.puntos || a.arquetipo - b.arquetipo)
  const estaSemana = puntosDeSemana(db, semana, ahora)
  const ranking = estaSemana.filter((x) => x.puntos > 0).map((x) => { const f = leer(db, x.agente); return { agente: x.agente, nombre: f ? alias(f) : x.agente, arquetipo: x.arquetipo, puntos: x.puntos, neto: x.neto, detalle: x.detalle.map((d) => `+${d.monto} ${d.motivo}`) } }).sort((a, b) => b.puntos - a.puntos)
  return { semana, geometria: GEOMETRIA, tienda: TIENDA, reglas: { puntosNivel: PUNTOS_NIVEL, niveles: NIVELES, parteVecino: PARTE_VECINO, parteLegado: PARTE_LEGADO, hito: HITO }, arquetipos, ranking, atributos: ATRIBUTOS, clases: Object.keys(CLASES).filter((c) => !['ejecutivo', 'gerente'].includes(c)) }
}
