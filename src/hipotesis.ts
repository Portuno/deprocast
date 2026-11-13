/**
 * Las hipótesis de La Mano, a prueba: el primer paso hacia lo causal. Hasta ahora una hipótesis («Los días que duermo
 * poco, no termino las bandas») quedaba como texto con su «predice» y su «la tiraría abajo», y nadie la miraba contra
 * lo que pasó. Ahora se traduce a dos criterios que el gemelo ya sabe medir día por día —la CONDICIÓN («los días que…»)
 * y el RESULTADO («…pasa tal cosa»)— y durante tres semanas se comparan los días con la condición contra los días sin
 * ella. Al cerrar: confirmada (el resultado pasa claramente más con la condición), refutada (no hay diferencia, o va al
 * revés), dudosa (diferencia chica: se estira dos semanas una vez) o sin datos (faltaron días de algún lado).
 *
 * Es una comparación, no un experimento: los días no se eligieron al azar, así que «confirmada» quiere decir «sus datos
 * la sostienen», no «está probado que X causa Y». El veredicto lo dice así.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { criterioValido, evidencia, verificar, type Criterio } from './gemelo.ts'

export type EstadoPrueba = 'en_prueba' | 'confirmada' | 'refutada' | 'dudosa' | 'sin_datos'
export type Tabla = { con: { dias: number; paso: number }; sin: { dias: number; paso: number }; sinDato: number }
export type Prueba = {
  id: number; quantomoId: number | null; eventoId: number | null; hipotesis: string
  condicion: Criterio; resultado: Criterio; desde: string; hasta: string; estado: EstadoPrueba
  tabla: Tabla | null; veredicto: string | null; estirada: boolean; creadaEn: number; cerradaEn: number | null
}

export const DIAS_PRUEBA = 21
export const DIAS_ESTIRA = 14
/** Mínimo de días de cada lado (con y sin la condición) para opinar. */
export const MINIMO_POR_LADO = 4
/** Cuánto más tiene que pasar el resultado con la condición para confirmarla (en puntos de proporción). */
export const DIFERENCIA_CONFIRMA = 0.25
export const DIFERENCIA_REFUTA = 0.05

const deFila = (r: any): Prueba => ({
  id: r.id, quantomoId: r.quantomo_id, eventoId: r.evento_id, hipotesis: r.hipotesis,
  condicion: json(r.condicion, null as any), resultado: json(r.resultado, null as any), desde: r.desde, hasta: r.hasta, estado: r.estado,
  tabla: json(r.tabla, null), veredicto: r.veredicto, estirada: !!r.estirada, creadaEn: r.creada_en, cerradaEn: r.cerrada_en,
})
const sumarDias = (f: string, n: number) => fechaLocal(new Date(`${f}T12:00:00`).getTime() + n * 86_400_000)

/** Cómo se lee un criterio, en palabras (para el veredicto y la pantalla). */
export function textoDeCriterio(c: Criterio): string {
  switch (c.tipo) {
    case 'bandas_hechas': return `${c.op === '>=' ? 'al menos' : 'como mucho'} ${c.valor} bandas hechas`
    case 'run_arrancada': return c.valor ? 'arranca una run' : 'no arranca ninguna run'
    case 'primaria_avanza': return `avanza «${c.primaria}»`
    case 'habla_de': return `habla de «${c.texto}»`
    case 'directo_prendido': return c.valor ? 'prende el Directo' : 'no prende el Directo'
    case 'directo_minutos': return `${c.op === '>=' ? 'al menos' : 'como mucho'} ${c.valor} min de ${c.que}`
    case 'sueno_horas': return `duerme ${c.op === '>=' ? 'al menos' : 'como mucho'} ${c.valor} h`
    case 'ejercicio': return c.valor ? 'entrena' : 'no entrena'
    case 'kcal': return `come ${c.op === '>=' ? 'al menos' : 'como mucho'} ${c.valor} kcal`
  }
}

/** Abre la prueba (la condición y el resultado ya validados). Corre desde hoy, tres semanas. */
export function abrirPrueba(db: Db, p: { quantomoId?: number | null; eventoId?: number | null; hipotesis: string; condicion: unknown; resultado: unknown }, ahora = Date.now()): Prueba | null {
  const condicion = criterioValido(p.condicion), resultado = criterioValido(p.resultado)
  if (!condicion || !resultado || !p.hipotesis.trim()) return null
  if (p.quantomoId && db.prepare(`SELECT 1 FROM hipotesis_pruebas WHERE quantomo_id = ?`).get(p.quantomoId)) return null
  const desde = fechaLocal(ahora)
  const r = db.prepare(`INSERT INTO hipotesis_pruebas (quantomo_id, evento_id, hipotesis, condicion, resultado, desde, hasta, estado, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, 'en_prueba', ?)`)
    .run(p.quantomoId ?? null, p.eventoId ?? null, p.hipotesis.trim().slice(0, 500), JSON.stringify(condicion), JSON.stringify(resultado), desde, sumarDias(desde, DIAS_PRUEBA - 1), ahora)
  return leerPrueba(db, Number(r.lastInsertRowid))
}

export const leerPrueba = (db: Db, id: number): Prueba | null => { const r = db.prepare('SELECT * FROM hipotesis_pruebas WHERE id = ?').get(id); return r ? deFila(r) : null }
export const listarPruebas = (db: Db, limite = 40): Prueba[] => (db.prepare(`SELECT * FROM hipotesis_pruebas ORDER BY estado = 'en_prueba' DESC, id DESC LIMIT ?`).all(limite) as any[]).map(deFila)

/** Los días de la prueba hasta «hasta» (incluido), con su condición y su resultado medidos. Un día sin dato no cuenta. */
export function medir(db: Db, p: Prueba, hasta: string): Tabla {
  const t: Tabla = { con: { dias: 0, paso: 0 }, sin: { dias: 0, paso: 0 }, sinDato: 0 }
  for (let f = p.desde; f <= hasta && f <= p.hasta; f = sumarDias(f, 1)) {
    const ev = evidencia(db, f)
    const c = verificar(p.condicion, ev), r = verificar(p.resultado, ev)
    if (c == null || r == null) { t.sinDato++; continue }
    const lado = c ? t.con : t.sin
    lado.dias++
    lado.paso += r
  }
  return t
}

const pct = (paso: number, dias: number) => `${Math.round((paso / dias) * 100)} % (${paso} de ${dias})`

/** El veredicto de una tabla: qué dicen los datos, en palabras, con los números. */
export function veredicto(p: Pick<Prueba, 'condicion' | 'resultado' | 'estirada'>, t: Tabla): { estado: Exclude<EstadoPrueba, 'en_prueba'>; texto: string } {
  const cond = textoDeCriterio(p.condicion), res = textoDeCriterio(p.resultado)
  if (t.con.dias < MINIMO_POR_LADO || t.sin.dias < MINIMO_POR_LADO) {
    const falta = t.con.dias < MINIMO_POR_LADO ? `días en que ${cond} (hubo ${t.con.dias})` : `días en que no (hubo ${t.sin.dias})`
    return { estado: 'sin_datos', texto: `No alcanzan los datos: faltaron ${falta}${t.sinDato ? `, y ${t.sinDato} días no tenían con qué medirlo` : ''}. Hacen falta al menos ${MINIMO_POR_LADO} de cada lado.` }
  }
  const p1 = t.con.paso / t.con.dias, p0 = t.sin.paso / t.sin.dias
  const comparacion = `Los días en que ${cond}, ${res} el ${pct(t.con.paso, t.con.dias)}; los demás días, el ${pct(t.sin.paso, t.sin.dias)}.`
  const aclara = 'Es una comparación de sus días, no un experimento: sus datos la sostienen o no, pero no prueban qué causa qué.'
  if (p1 - p0 >= DIFERENCIA_CONFIRMA) return { estado: 'confirmada', texto: `${comparacion} Sus datos la sostienen. ${aclara}` }
  if (p1 - p0 <= DIFERENCIA_REFUTA) return { estado: 'refutada', texto: `${comparacion} ${p1 < p0 ? 'Va al revés de lo que decía.' : 'No hay diferencia.'} Sus datos no la sostienen.` }
  return { estado: 'dudosa', texto: `${comparacion} Hay algo de diferencia, pero poca para decir que sí.${p.estirada ? '' : ` Sigue ${DIAS_ESTIRA} días más.`}` }
}

/**
 * Cada noche: las pruebas que terminaron se cierran con su veredicto (una dudosa se estira una vez). Lo confirmado
 * queda en su memoria como hecho medido; lo refutado descarta la hipótesis. Devuelve los veredictos de hoy, para
 * contárselos.
 */
export async function revisarPruebas(db: Db, ahora = Date.now()): Promise<{ prueba: Prueba; estado: EstadoPrueba; texto: string }[]> {
  const ayer = sumarDias(fechaLocal(ahora), -1)
  const out: { prueba: Prueba; estado: EstadoPrueba; texto: string }[] = []
  for (const p of (db.prepare(`SELECT * FROM hipotesis_pruebas WHERE estado = 'en_prueba'`).all() as any[]).map(deFila)) {
    const t = medir(db, p, ayer)
    db.prepare('UPDATE hipotesis_pruebas SET tabla = ? WHERE id = ?').run(JSON.stringify(t), p.id)
    if (ayer < p.hasta) continue // todavía corre
    const v = veredicto(p, t)
    if (v.estado === 'dudosa' && !p.estirada) {
      db.prepare('UPDATE hipotesis_pruebas SET hasta = ?, estirada = 1, veredicto = ? WHERE id = ?').run(sumarDias(p.hasta, DIAS_ESTIRA), v.texto, p.id)
      out.push({ prueba: p, estado: 'en_prueba', texto: v.texto })
      continue
    }
    db.prepare('UPDATE hipotesis_pruebas SET estado = ?, veredicto = ?, cerrada_en = ? WHERE id = ?').run(v.estado, v.texto, ahora, p.id)
    if (v.estado === 'confirmada') {
      const { recordar } = await import('./memoria.ts')
      recordar(db, { texto: `Medido en sus días (${p.desde} → ${p.hasta}): ${p.hipotesis} ${v.texto.split(' Sus datos')[0]}`, tipo: 'hecho', creadaPor: 'mastropiero', revisada: false })
    }
    if (v.estado === 'refutada' && p.quantomoId) (await import('./quantomos.ts')).descartar(db, p.quantomoId, ahora)
    out.push({ prueba: p, estado: v.estado, texto: v.texto })
  }
  return out
}

export function textoDeRevision(xs: Awaited<ReturnType<typeof revisarPruebas>>): string | null {
  if (!xs.length) return null
  const icono: Record<string, string> = { confirmada: '✓', refutada: '✗', sin_datos: '∅', en_prueba: '⏳' }
  return `🔬 Hipótesis a prueba:\n${xs.map((x) => `${icono[x.estado] ?? '·'} «${x.prueba.hipotesis}» — ${x.estado === 'en_prueba' ? 'dudosa, sigue' : x.estado.replace('_', ' ')}. ${x.texto}`).join('\n')}`
}

// ─── de una hipótesis a sus criterios ───────────────────────────────────

export const CRITERIOS_PARA_MODELO = `Los criterios que se pueden medir cada día (tipos exactos):
  {"tipo": "bandas_hechas", "op": ">=" | "<=", "valor": n} · {"tipo": "run_arrancada", "valor": true|false} · {"tipo": "primaria_avanza", "primaria": "título"}
  {"tipo": "habla_de", "texto": "palabra"} · {"tipo": "directo_prendido", "valor": true|false} · {"tipo": "directo_minutos", "que": "actividad o app", "op": ">="|"<=", "valor": min}
  {"tipo": "sueno_horas", "op": ">="|"<=", "valor": h} · {"tipo": "ejercicio", "valor": true|false} · {"tipo": "kcal", "op": ">="|"<=", "valor": kcal}`

const SISTEMA_CRITERIOS = `Te paso una hipótesis sobre la vida de una persona. Traducila a una prueba que se pueda medir con sus datos de cada día: una CONDICIÓN (lo que pasa ciertos días) y un RESULTADO (lo que la hipótesis dice que pasa esos días). Los dos con los criterios de abajo, y el resultado tiene que ser otra cosa que la condición.
${CRITERIOS_PARA_MODELO}
Si no se puede medir con esos criterios, devolvé {"condicion": null, "resultado": null, "porque": "por qué no"}.
Forma: {"condicion": object|null, "resultado": object|null, "porque": string}`

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> =>
  (await (await import('./modelo.ts')).pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'hipotesis' }, sistema, usuario, { temperatura: 0.1, maxTokens: 600 })).datos
export function _probarHipotesis(f: typeof modelo) { modelo = f }

/** Pone a prueba una hipótesis que ya existe (un quántomo de hipótesis, o un texto): el modelo la traduce a criterios. */
export async function probar(db: Db, h: { texto: string; quantomoId?: number | null; eventoId?: number | null; predice?: string | null }, ahora = Date.now()): Promise<{ prueba: Prueba | null; porque: string | null }> {
  const r = await modelo(db, SISTEMA_CRITERIOS, `Hipótesis: ${h.texto}${h.predice ? `\nPredice: ${h.predice}` : ''}`)
  const prueba = abrirPrueba(db, { quantomoId: h.quantomoId, eventoId: h.eventoId, hipotesis: h.texto, condicion: r?.condicion, resultado: r?.resultado }, ahora)
  return { prueba, porque: prueba ? null : String(r?.porque ?? 'No se pudo traducir a algo medible con sus datos de cada día.').slice(0, 300) }
}

/** Las hipótesis de La Mano que todavía no se probaron (de a pocas por noche: cada una es una llamada al modelo). */
export async function probarPendientes(db: Db, max = 3, ahora = Date.now()): Promise<number> {
  const xs = db.prepare(`SELECT q.id, q.texto, e.id AS evento, e.texto AS detalle FROM quantomos q LEFT JOIN mano_eventos e ON e.otro_id = q.id AND e.tipo = 'combo'
    WHERE q.universo = 'hipotesis' AND q.etapa != 'descartado' AND NOT EXISTS (SELECT 1 FROM hipotesis_pruebas p WHERE p.quantomo_id = q.id)
      AND NOT EXISTS (SELECT 1 FROM ajustes a WHERE a.clave = 'hipotesis_no_medible:' || q.id)
    ORDER BY q.id DESC LIMIT ?`).all(max) as { id: number; texto: string; evento: number | null; detalle: string | null }[]
  let n = 0
  for (const x of xs) {
    const predice = /Predice: ([^\n]+)/.exec(x.detalle ?? '')?.[1] ?? null
    const r = await probar(db, { texto: x.texto, quantomoId: x.id, eventoId: x.evento, predice }, ahora).catch(() => null)
    if (r?.prueba) n++
    // La que no se puede medir no se vuelve a intentar cada noche.
    else db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES (?, ?)`).run(`hipotesis_no_medible:${x.id}`, r?.porque ?? 'no medible')
  }
  return n
}
