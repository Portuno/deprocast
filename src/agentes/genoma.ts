/**
 * El genoma y la evolución de los agentes con misión (plan v26, fase 6).
 * - El genoma de un agente: sus instrucciones, su estrategia aprendida, sus atributos y su motor. La estrategia la
 *   escribe él mismo cada semana (en la nube) desde su diario y sus resultados: qué canales responden, qué tono funciona,
 *   qué descarta el operador. Entra a su prompt. Si el operador lo fija, no se toca.
 * - La evolución: al cierre de cada temporada, el mejor agente de una misión (con ganancia, activo, no fijado) puede
 *   tener un rival: un clon con una variación de estrategia (otro nicho, otro canal, otro tono) que trabaja la misma
 *   meta con sus propias pistas. La temporada siguiente decide cuál sigue: el que perdió deja la misión (va a la banca) y
 *   sus pistas vivas pasan al que ganó. Así la estrategia mejora por selección, no por decreto.
 */
import { type Db } from '../db.ts'
import { pedirJson } from '../modelo.ts'
import { CLASES, type ClaseId } from '../clases.ts'
import { alias, forjar, leer } from '../roster.ts'
import { anotarDiario, diarioDe, leerMisionAgente, listarMisionesAgente, type MisionAgente } from './misiones.ts'
import { NOMBRE_ETAPA, embudo, pistasDe } from './embudo.ts'

const DIA = 86_400_000

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'evolucion' }, sistema, usuario, { temperatura: 0.7, maxTokens: 1500 })).datos
let nube = async () => (await import('../reproceso.ts')).enLaNube()
export function _probarGenoma(o: { modelo?: typeof modelo; nube?: () => Promise<boolean> }) {
  if (o.modelo) modelo = o.modelo
  if (o.nube) nube = o.nube
}

/** Él fija (o suelta) el genoma de un agente: fijado, no reescribe su estrategia ni se clona con mutaciones. */
export function fijarGenoma(db: Db, agenteId: string, fijo: boolean) {
  const f = leer(db, agenteId)
  if (!f) throw new Error(`No existe el agente ${agenteId}`)
  db.prepare('UPDATE agentes SET genoma_fijo = ? WHERE id = ?').run(fijo ? 1 : 0, f.id)
  return leer(db, f.id)!
}

/** Lo que pasó en la misión, en texto, para que el modelo lea resultados y no solo intenciones. */
function resultadosEnTexto(db: Db, m: MisionAgente): string {
  const e = embudo(db, m.id)
  const ps = pistasDe(db, { misionId: m.id })
  const decisiones = db.prepare(`SELECT d.accion, d.cambios, o.titulo FROM decisiones d JOIN oportunidades o ON o.id = CAST(d.ref AS INTEGER) WHERE d.tipo = 'agente:borrador' AND o.agente_mision_id = ? ORDER BY d.id DESC LIMIT 12`).all(m.id) as { accion: string; cambios: string | null; titulo: string }[]
  return [
    `Embudo: ${Object.entries(e).filter(([, n]) => n).map(([k, n]) => `${NOMBRE_ETAPA[k as keyof typeof NOMBRE_ETAPA]} ${n}`).join(' · ') || 'vacío'}`,
    ps.length ? `Pistas:\n${ps.slice(0, 25).map((p) => `- ${p.contacto.organizacion || p.titulo} (${p.contacto.canal}) [${NOMBRE_ETAPA[p.etapa]}]${p.notas ? ` — ${p.notas.split('\n').at(-1)}` : ''}`).join('\n')}` : '',
    decisiones.length ? `Sus borradores, según él:\n${decisiones.map((d) => `- ${d.titulo}: ${d.accion === 'aceptada' ? 'lo mandó tal cual' : d.accion === 'editada' ? 'lo mandó con cambios' : 'lo descartó'}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

const SISTEMA_ESTRATEGIA = `Sos un agente de la liga de Mastropiero que trabaja una misión para el operador. Releés tu diario y tus resultados de la semana y escribís TU ESTRATEGIA: lo que aprendiste que funciona y lo que no, en reglas cortas y accionables que vas a seguir desde ahora.
- De 3 a 8 reglas, concretas («Las productoras de bodas responden por Instagram, no por mail», «Borradores de menos de 80 palabras»), sacadas de lo que pasó (lo que él mandó, editó o descartó; lo que respondió), no genéricas.
- Lo que él indicó en el diario manda: si contradice algo tuyo, gana lo suyo.
- Si todavía no hay resultados, decí qué vas a probar y por qué.
Forma: {"estrategia": [string], "por_que": string}`

/** Un agente escribe su estrategia desde su diario y sus resultados (en la nube). Fijado, no se toca. */
export async function escribirEstrategia(db: Db, misionId: number, ahora = Date.now()): Promise<string | null> {
  const m = leerMisionAgente(db, misionId)
  const f = m ? leer(db, m.agenteId) : null
  if (!m || !f || f.genomaFijo) return null
  const diario = diarioDe(db, m.id, 80).reverse()
  if (!diario.length) return null
  const r = await modelo(db, SISTEMA_ESTRATEGIA, [
    `Misión: ${m.titulo}\n${m.brief}\nCriterio: ${m.criterio.texto}`,
    f.estrategia ? `Tu estrategia hasta ahora:\n${f.estrategia}` : 'Todavía no tenías estrategia escrita.',
    resultadosEnTexto(db, m),
    `Tu diario:\n${diario.map((d) => `[${d.tipo}] ${d.texto}`).join('\n')}`,
  ].join('\n\n'))
  const reglas = (Array.isArray(r?.estrategia) ? r.estrategia : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 8)
  if (!reglas.length) return null
  const texto = reglas.map((x: string) => `- ${x.slice(0, 240)}`).join('\n')
  db.prepare('UPDATE agentes SET estrategia = ? WHERE id = ?').run(texto, f.id)
  anotarDiario(db, m, 'reflexion', `Mi estrategia de ahora en más:\n${texto}${r?.por_que ? `\n(${String(r.por_que).slice(0, 300)})` : ''}`, null, ahora)
  return texto
}

/** La rutina del domingo: cada misión activa con diario escribe la suya. */
export async function escribirEstrategias(db: Db, ahora = Date.now()) {
  const { topeAlcanzado } = await import('../nan.ts')
  let n = 0
  for (const m of listarMisionesAgente(db, { estados: ['activa'] })) {
    if (topeAlcanzado(db, ahora)) break
    try { if (await escribirEstrategia(db, m.id, ahora)) n++ } catch (e) { console.error(`  estrategia ${m.id}:`, e instanceof Error ? e.message : e) }
  }
  return n
}

const SISTEMA_MUTACION = `Sos el criador de la liga de Mastropiero. Un agente viene ganando en su misión; vas a crear un rival: un clon con UNA variación de su estrategia, para ver si rinde más. Cambiá una sola cosa con sentido (otro nicho de clientes, otro canal, otro tono, otro tipo de propuesta), no todo; el resto de lo que funciona queda.
Forma: {"estrategia": [string], "mutacion": string (la diferencia, en una oración)}`

const neto = (db: Db, semana: string, agente: string) => (db.prepare('SELECT neto FROM temporadas WHERE semana = ? AND agente_id = ?').get(semana, agente) as { neto: number } | undefined)?.neto ?? 0

/**
 * Al cierre de la temporada: se resuelven las rivalidades que ya jugaron una semana entera y, en la nube, el mejor de
 * cada misión sin rival puede tener uno. Devuelve el texto para Hoy (o nada si no pasó nada).
 */
export async function evolucionar(db: Db, semana: string, ahora = Date.now()): Promise<string | null> {
  const partes: string[] = []
  // 1. Las rivalidades: la temporada decide.
  for (const rival of listarMisionesAgente(db, { estados: ['activa'] }).filter((m) => m.madreId)) {
    const madre = leerMisionAgente(db, rival.madreId!)
    if (!madre || madre.estado !== 'activa') { db.prepare('UPDATE agente_misiones SET madre_id = NULL WHERE id = ?').run(rival.id); continue }
    if (ahora - rival.creadaEn < 7 * DIA) continue
    const [gana, pierde] = neto(db, semana, rival.agenteId) > neto(db, semana, madre.agenteId) ? [rival, madre] : [madre, rival]
    const fg = leer(db, gana.agenteId), fp = leer(db, pierde.agenteId)
    db.prepare(`UPDATE agente_misiones SET estado = 'abandonada', actualizada_en = ? WHERE id = ?`).run(ahora, pierde.id)
    if (fp && fp.estado !== 'banca') db.prepare(`UPDATE agentes SET estado = 'banca' WHERE id = ?`).run(fp.id)
    // Lo que el perdedor tenía en marcha no se pierde: pasa al ganador.
    const pasan = db.prepare(`UPDATE oportunidades SET agente_mision_id = ? WHERE agente_mision_id = ? AND COALESCE(etapa, '') != 'descartada'`).run(gana.id, pierde.id).changes
    db.prepare('UPDATE agente_misiones SET madre_id = NULL, actualizada_en = ? WHERE id = ?').run(ahora, gana.id)
    const texto = `${fg ? alias(fg) : gana.agenteId} le ganó a ${fp ? alias(fp) : pierde.agenteId} en «${gana.titulo}»${pasan ? ` (se queda con ${pasan} pista${pasan === 1 ? '' : 's'} suya${pasan === 1 ? '' : 's'})` : ''}.`
    anotarDiario(db, gana, 'resultado', `Temporada ${semana}: ${texto}`, null, ahora)
    anotarDiario(db, pierde, 'resultado', `Temporada ${semana}: ${texto} Esta misión sigue en la del ganador.`, null, ahora)
    partes.push(texto)
  }
  // 2. Nuevos rivales (con modelo: solo en la nube y dentro del tope).
  const { topeAlcanzado } = await import('../nan.ts')
  if (await nube()) {
    for (const m of listarMisionesAgente(db, { estados: ['activa'] })) {
      if (topeAlcanzado(db, ahora)) break
      if (m.madreId || listarMisionesAgente(db, { estados: ['activa'] }).some((x) => x.madreId === m.id)) continue
      const f = leer(db, m.agenteId)
      if (!f || f.estado !== 'activo' || f.genomaFijo || ahora - m.creadaEn < 7 * DIA || neto(db, semana, f.id) <= 0) continue
      let r: any
      try { r = await modelo(db, SISTEMA_MUTACION, [`Misión: ${m.titulo}\n${m.brief}\nCriterio: ${m.criterio.texto}`, `Su estrategia:\n${f.estrategia ?? '(sin escribir todavía)'}`, resultadosEnTexto(db, m)].join('\n\n')) } catch { continue }
      const reglas = (Array.isArray(r?.estrategia) ? r.estrategia : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 8)
      const mutacion = String(r?.mutacion ?? '').trim().slice(0, 300)
      if (!reglas.length || !mutacion) continue
      const base = CLASES[f.clase as ClaseId].base as Record<string, number>
      const reparto = Object.fromEntries(Object.entries(f.atributos).map(([k, v]) => [k, Math.max(0, Number(v) - (base[k] ?? 0))]))
      const hijo = forjar(db, { clase: f.clase, motor: f.motor, reparto, instrucciones: f.instrucciones, creador: 'evolucion', misionPrincipal: `Rival de ${alias(f)}: ${mutacion}`, ahora })
      db.prepare('UPDATE agentes SET padre = ?, mutacion = ?, estrategia = ? WHERE id = ?').run(f.id, mutacion, reglas.map((x: string) => `- ${x.slice(0, 240)}`).join('\n'), hijo.id)
      const id = Number(db.prepare(`INSERT INTO agente_misiones (agente_id, titulo, brief, criterio, entidad_id, primaria_id, vence, estado, plan, creada_en, actualizada_en, madre_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'activa', '[]', ?, ?, ?)`)
        .run(hijo.id, m.titulo, m.brief, JSON.stringify(m.criterio), m.entidadId, m.primariaId, m.vence, ahora, ahora, m.id).lastInsertRowid)
      anotarDiario(db, m, 'resultado', `Nace un rival: ${hijo.id}, clon tuyo con una variación («${mutacion}»). La próxima temporada decide cuál sigue.`, { rival: id }, ahora)
      partes.push(`${alias(f)} tiene un rival en «${m.titulo}»: ${hijo.id} (${mutacion})`)
    }
  }
  return partes.length ? `🧬 **La evolución de tus agentes** (${semana}): ${partes.join(' · ')}` : null
}
