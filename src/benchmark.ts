/**
 * El Benchmarkeador (Fragua #236): un auditor de contraste. Mide motores contra referencia en vez de opinar.
 * - El banco de pruebas: cinco encargos representativos y fijos (uno de corpus, uno de clasificación, uno de redacción,
 *   uno de extracción y uno de código), genéricos (nada suyo), cada uno con su criterio de éxito declarado antes de correr
 *   y su caso de referencia guardado acá. Se corre cada semana contra el motor por defecto de esa clase de trabajo y dos
 *   alternativas: tiempo, tokens, créditos y acierto. El veredicto (qué conviene para qué, y si conviene rotar) queda como
 *   quántomo sellado, para que quede el rastro de qué se probó y qué motor ganó.
 * - Comparar a pedido: un encargo cualquiera mandado a varios motores, con un criterio fijado antes; un juez puntúa.
 * No toca el ruteo: propone. Rotar es decisión suya.
 */
import vm from 'node:vm'
import { fechaLocal, type Db } from './db.ts'
import { llamarModelo, pedirJson } from './modelo.ts'
import { cadenaPara, creditosDe, M } from './nan.ts'
import { crearQuantomo } from './quantomos.ts'

type ClaseLlamada = Parameters<typeof cadenaPara>[0]
export type Prueba = {
  id: string; nombre: string; clase: ClaseLlamada
  /** Se usa mientras él espera (el chat): un motor bastante más lento no conviene aunque sea más barato. */
  interactiva?: boolean
  sistema: string; usuario: string; json?: boolean
  /** Lo que se espera, en palabras (queda en el informe). */
  criterio: string
  /** 0 a 1, con el detalle de qué cumplió. */
  puntuar: (salida: string) => { puntaje: number; detalle: string }
}

const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const leerJson = (t: string) => { try { const i = t.indexOf('{'); return i >= 0 ? JSON.parse(t.slice(i, t.lastIndexOf('}') + 1)) : null } catch { return null } }

/** El código que devolvió, sin las comillas de bloque. */
export function codigoDe(t: string): string {
  const m = /```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/i.exec(t)
  return (m ? m[1] : t).trim()
}

/** Corre una función en una caja aparte (sin require ni process, con tiempo tope) contra sus casos. */
export function probarFuncion(codigo: string, nombre: string, casos: [unknown[], unknown][]): { pasan: number; total: number; error: string | null } {
  try {
    const ctx = vm.createContext({})
    new vm.Script(`${codigo}\n;globalThis.__f = typeof ${nombre} === 'function' ? ${nombre} : null`).runInContext(ctx, { timeout: 300 })
    const f = (ctx as any).__f
    if (typeof f !== 'function') return { pasan: 0, total: casos.length, error: `no definió ${nombre}` }
    let pasan = 0
    for (const [args, esperado] of casos) {
      try {
        ;(ctx as any).__args = args
        const r = new vm.Script('__f(...__args)').runInContext(ctx, { timeout: 300 })
        if (JSON.stringify(r) === JSON.stringify(esperado)) pasan++
      } catch { /* ese caso no pasa */ }
    }
    return { pasan, total: casos.length, error: null }
  } catch (e) {
    return { pasan: 0, total: casos.length, error: e instanceof Error ? e.message.slice(0, 120) : String(e) }
  }
}

export const BANCO: Prueba[] = [
  {
    id: 'corpus', nombre: 'Corpus: contestar desde fragmentos y citar', clase: { clase: 'mastropiero', agenteId: 'mastropiero' }, interactiva: true,
    sistema: 'Contestá la pregunta usando SOLO los fragmentos. Citá el fragmento de donde sale el dato con su marca [#id]. Una o dos oraciones.',
    usuario: '[#101] La reunión del comité de obra se pasó al jueves 14 a las 18 h, en el local de la calle Mayor.\n[#102] El presupuesto de la reforma quedó en 12.400 euros con el IVA incluido.\n[#103] La pintura la hace la cuadrilla de Ramón la semana que viene.\n\nPregunta: ¿cuánto quedó el presupuesto de la reforma y de dónde lo sacás?',
    criterio: 'Dice 12.400 euros y cita [#102] (y no otro fragmento como fuente).',
    puntuar: (t) => {
      const monto = /12[.,\s]?400/.test(t), cita = /\[#102\]/.test(t), otra = /\[#10[13]\]/.test(t)
      return { puntaje: (monto ? 0.6 : 0) + (cita ? 0.4 : 0) - (otra ? 0.2 : 0), detalle: `${monto ? 'monto ✓' : 'monto ✗'} · ${cita ? 'cita ✓' : 'cita ✗'}${otra ? ' · citó otro' : ''}` }
    },
  },
  {
    id: 'clasificacion', nombre: 'Clasificación: seis mensajes en cuatro etiquetas', clase: { clase: 'clasificador' }, json: true,
    sistema: 'Clasificá cada mensaje en UNA etiqueta: gasto, idea, tarea o salud. Forma: {"etiquetas": ["...", ...]} en el mismo orden.',
    usuario: '1. Pagué 40 euros de gasolina.\n2. Se me ocurrió un juego de mesa sobre la historia del barrio.\n3. Mañana tengo que llamar al gestor.\n4. Dormí cinco horas y me duele la cabeza.\n5. Compré el regalo de cumpleaños: 25 euros.\n6. Mandar el presupuesto al cliente antes del viernes.',
    criterio: 'gasto, idea, tarea, salud, gasto, tarea.',
    puntuar: (t) => {
      const esperado = ['gasto', 'idea', 'tarea', 'salud', 'gasto', 'tarea']
      const xs: string[] = (leerJson(t)?.etiquetas ?? []).map((x: unknown) => String(x).toLowerCase().trim())
      const bien = esperado.filter((e, i) => xs[i] === e).length
      return { puntaje: bien / esperado.length, detalle: `${bien} de ${esperado.length}` }
    },
  },
  {
    id: 'redaccion', nombre: 'Redacción: un WhatsApp corto, con voseo', clase: { clase: 'generativo' },
    sistema: 'Escribís mensajes en castellano rioplatense (voseo), directos y cálidos.',
    usuario: 'Escribí un mensaje de WhatsApp para un cliente avisando que el informe se entrega el lunes y que incluye el análisis de costos. Máximo 50 palabras, sin emojis. Devolvé solo el mensaje.',
    criterio: 'Hasta 50 palabras, nombra el lunes y los costos, sin emojis, con voseo.',
    puntuar: (t) => {
      const n = palabras(t), corto = n <= 50, lunes = /lunes/i.test(t), costos = /costo/i.test(t)
      const sinEmoji = !/\p{Extended_Pictographic}/u.test(t), voseo = /\b(ten[eé]s|pod[eé]s|quer[eé]s|avisame|mir[aá]|decime|fijate|contame|cualquier cosa me avis[aá]s)\b/i.test(t)
      return { puntaje: (corto ? 0.4 : 0) + (lunes ? 0.2 : 0) + (costos ? 0.2 : 0) + (sinEmoji ? 0.1 : 0) + (voseo ? 0.1 : 0), detalle: `${n} palabras · ${lunes ? 'lunes ✓' : 'lunes ✗'} · ${costos ? 'costos ✓' : 'costos ✗'}${sinEmoji ? '' : ' · con emoji'}${voseo ? ' · voseo ✓' : ''}` }
    },
  },
  {
    id: 'extraccion', nombre: 'Extracción: nombre, fecha y monto exactos', clase: { clase: 'extractor' }, json: true,
    sistema: 'Sacá los datos del texto. Forma: {"nombre": string, "fecha": "AAAA-MM-DD", "monto": number}.',
    usuario: 'El 3 de marzo de 2026 Lucía Ferrer transfirió 1.250,50 euros a la cuenta de la asociación.',
    criterio: '{"nombre": "Lucía Ferrer", "fecha": "2026-03-03", "monto": 1250.5}',
    puntuar: (t) => {
      const d = leerJson(t) ?? {}
      const ok = [String(d.nombre ?? '').trim() === 'Lucía Ferrer', d.fecha === '2026-03-03', Number(d.monto) === 1250.5]
      return { puntaje: ok.filter(Boolean).length / 3, detalle: `nombre ${ok[0] ? '✓' : '✗'} · fecha ${ok[1] ? '✓' : '✗'} · monto ${ok[2] ? '✓' : '✗'}` }
    },
  },
  {
    id: 'codigo', nombre: 'Código: una función que pasa sus pruebas', clase: { clase: 'mastropiero', agenteId: 'fragua' },
    sistema: 'Escribís JavaScript correcto y corto.',
    usuario: 'Escribí una función JavaScript llamada sumaPares(xs) que devuelva la suma de los números pares de un arreglo, ignorando todo lo que no sea de tipo number. Devolvé solo el código.',
    criterio: 'sumaPares([1,2,3,4]) = 6 · sumaPares([]) = 0 · sumaPares([2,"4",null,6]) = 8 · sumaPares([-2,3]) = -2',
    puntuar: (t) => {
      const r = probarFuncion(codigoDe(t), 'sumaPares', [[[[1, 2, 3, 4]], 6], [[[]], 0], [[[2, '4', null, 6]], 8], [[[-2, 3]], -2]])
      return { puntaje: r.pasan / r.total, detalle: r.error ? `no corrió: ${r.error}` : `${r.pasan} de ${r.total} casos` }
    },
  },
]

/** Las alternativas a probar contra el motor por defecto (las dos primeras que no sean él). */
const ALTERNATIVAS = [M.mimo, M.deepseek, M.qwen, M.glm]
export function motoresDe(p: Prueba): { porDefecto: string; motores: string[] } {
  const porDefecto = cadenaPara(p.clase)[0]
  return { porDefecto, motores: [porDefecto, ...ALTERNATIVAS.filter((m) => m !== porDefecto).slice(0, 2)] }
}

export type Medicion = { prueba: string; modelo: string; porDefecto: boolean; ms: number; tokensIn: number | null; tokensOut: number | null; creditos: number | null; puntaje: number; detalle: string; error: string | null }

/** Una prueba contra un motor (solo ese: la cadena se fija a él). */
async function medir(db: Db, corrida: string, p: Prueba, modelo: string, porDefecto: boolean): Promise<Medicion> {
  const agenteId = `benchmark:${p.id}`
  const desde = Date.now()
  const t0 = performance.now()
  let salida = '', error: string | null = null
  try {
    const r = await llamarModelo({ db, clase: p.clase.clase, agenteId, modelos: [modelo] }, {
      mensajes: [{ role: 'system', content: p.sistema }, { role: 'user', content: p.usuario }], herramientas: [], json: p.json, temperatura: 0.2, maxTokens: 1500,
    })
    salida = r.texto ?? ''
  } catch (e) { error = (e instanceof Error ? e.message : String(e)).slice(0, 300) }
  const ms = Math.round(performance.now() - t0)
  // Lo que costó: lo que anotó el motor para esta llamada (tokens y créditos de NaN).
  const u = db.prepare(`SELECT SUM(tokens_in) AS i, SUM(tokens_out) AS o, SUM(tokens_cache) AS c FROM llamadas WHERE agente_id = ? AND modelo = ? AND en >= ?`).get(agenteId, modelo, desde) as { i: number | null; o: number | null; c: number | null }
  const creditos = u.i != null ? creditosDe(modelo, u.i, u.c ?? 0, u.o ?? 0) : null
  const { puntaje, detalle } = error ? { puntaje: 0, detalle: `falló: ${error}` } : p.puntuar(salida)
  const m: Medicion = { prueba: p.id, modelo, porDefecto, ms, tokensIn: u.i, tokensOut: u.o, creditos: creditos != null ? +creditos.toFixed(4) : null, puntaje: +Math.max(0, Math.min(1, puntaje)).toFixed(2), detalle, error }
  db.prepare(`INSERT INTO bench_corridas (corrida, prueba, modelo, por_defecto, ms, tokens_in, tokens_out, creditos, puntaje, detalle, salida, error, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(corrida, p.id, modelo, porDefecto ? 1 : 0, ms, u.i, u.o, m.creditos, m.puntaje, detalle, salida.slice(0, 2000), error, Date.now())
  return m
}

export type Veredicto = { prueba: string; nombre: string; ganador: Medicion; porDefecto: Medicion; rotar: boolean; noDistingue: boolean; texto: string }

/** Gana el que más acierta; a igual acierto (±5 %), el que cuesta menos; después, el más rápido. Rotar: gana otro y no empeora. */
export function veredictoDe(p: Prueba, ms: Medicion[]): Veredicto {
  const costo = (m: Medicion) => m.creditos ?? Number.POSITIVE_INFINITY
  const orden = [...ms].sort((a, b) => (Math.abs(b.puntaje - a.puntaje) > 0.05 ? b.puntaje - a.puntaje : costo(a) - costo(b) || a.ms - b.ms))
  const ganador = orden[0], porDefecto = ms.find((m) => m.porDefecto) ?? ms[0]
  // Si todos aciertan (95 % o más), la prueba no distingue motores: se dice, y no se propone rotar solo por precio.
  const noDistingue = ms.length > 1 && ms.every((m) => m.puntaje >= 0.95)
  // En lo que él espera (el chat), un motor más de 1,4 veces más lento no conviene aunque sea más barato.
  const lento = !!p.interactiva && ganador.ms > porDefecto.ms * 1.4
  const rotar = !noDistingue && !lento && ganador.modelo !== porDefecto.modelo && ganador.puntaje >= porDefecto.puntaje && (ganador.puntaje - porDefecto.puntaje >= 0.1 || costo(ganador) < costo(porDefecto) * 0.7)
  const cr = (m: Medicion) => (m.creditos != null ? `${m.creditos} cr.` : '— cr.')
  const linea = (m: Medicion) => `${m.modelo} ${Math.round(m.puntaje * 100)} % · ${cr(m)} · ${(m.ms / 1000).toFixed(1)} s`
  const texto = `${p.nombre}: gana ${linea(ganador)}${ganador.modelo === porDefecto.modelo ? ' (el de siempre)' : ` · el de siempre: ${linea(porDefecto)}`}${rotar ? ' → conviene rotar' : noDistingue ? ' · todos aciertan: la prueba no distingue (hay que endurecerla)' : lento ? ' · más barato pero más lento para algo que se espera: no conviene' : ''}`
  return { prueba: p.id, nombre: p.nombre, ganador, porDefecto, rotar, noDistingue, texto }
}

/** La corrida semanal del banco entero. Deja el veredicto como quántomo sellado (el rastro de qué se probó y qué ganó). */
export async function correrBanco(db: Db, o: { pruebas?: string[]; ahora?: number } = {}): Promise<{ corrida: string; veredictos: Veredicto[]; quantomo: number | null; texto: string }> {
  const ahora = o.ahora ?? Date.now()
  const corrida = `${fechaLocal(ahora)}-${Math.random().toString(36).slice(2, 6)}`
  const veredictos: Veredicto[] = []
  for (const p of BANCO.filter((x) => !o.pruebas?.length || o.pruebas.includes(x.id))) {
    const { porDefecto, motores } = motoresDe(p)
    const ms: Medicion[] = []
    for (const m of motores) ms.push(await medir(db, corrida, p, m, m === porDefecto))
    veredictos.push(veredictoDe(p, ms))
  }
  const rotar = veredictos.filter((v) => v.rotar)
  const texto = [`Banco de pruebas del ${fechaLocal(ahora)} (cada encargo contra el motor de siempre y dos alternativas):`, ...veredictos.map((v) => `- ${v.texto}`),
    rotar.length ? `Conviene rotar en ${rotar.map((v) => v.nombre.split(':')[0].toLowerCase()).join(', ')}: decidilo vos (no toco el ruteo solo).` : 'Ningún motor le gana al de siempre por suficiente: el ruteo queda como está.'].join('\n')
  const quantomo = crearQuantomo(db, { texto, titulo: `Banco de pruebas · ${fechaLocal(ahora)}`, etapa: 'sellado', universo: 'liga', procedencia: 'El Benchmarkeador (auditor de contraste)', origenId: `bench:${corrida}` }, ahora)
  return { corrida, veredictos, quantomo, texto }
}

/** Lo último que se corrió, por prueba: cada motor con su número (para la pantalla y el chat). */
export function verBanco(db: Db) {
  const ultima = (db.prepare('SELECT corrida, MAX(en) AS en FROM bench_corridas GROUP BY corrida ORDER BY en DESC LIMIT 1').get() as { corrida: string; en: number } | undefined)
  if (!ultima) return { corrida: null, en: null, pruebas: [], historia: [] }
  const filas = db.prepare('SELECT * FROM bench_corridas WHERE corrida = ? ORDER BY prueba, por_defecto DESC, modelo').all(ultima.corrida) as any[]
  const pruebas = BANCO.map((p) => {
    const ms: Medicion[] = filas.filter((f) => f.prueba === p.id).map((f) => ({ prueba: f.prueba, modelo: f.modelo, porDefecto: !!f.por_defecto, ms: f.ms, tokensIn: f.tokens_in, tokensOut: f.tokens_out, creditos: f.creditos, puntaje: f.puntaje, detalle: f.detalle, error: f.error }))
    return ms.length ? { id: p.id, nombre: p.nombre, criterio: p.criterio, mediciones: ms, veredicto: veredictoDe(p, ms) } : null
  }).filter(Boolean)
  // Cómo le fue a cada motor en las últimas corridas (acierto medio): para ver la tendencia, no una foto.
  const historia = db.prepare(`SELECT modelo, COUNT(*) AS n, ROUND(AVG(puntaje), 2) AS acierto, ROUND(AVG(ms)) AS ms, ROUND(SUM(COALESCE(creditos, 0)), 3) AS creditos FROM bench_corridas WHERE en >= ? GROUP BY modelo ORDER BY acierto DESC`).all(ultima.en - 60 * 86_400_000)
  return { corrida: ultima.corrida, en: ultima.en, pruebas, historia }
}

// ─── comparar a pedido ──────────────────────────────────────────────────

const SISTEMA_JUEZ = `Sos un juez estricto. Te paso un encargo, el criterio de éxito que se fijó ANTES de correrlo y las respuestas de varios motores (anónimas, con una letra). Puntuá cada una de 0 a 10 SOLO según el criterio, con una frase de por qué.
Forma: {"puntajes": [{"letra": "A", "puntaje": number, "por_que": string}]}`

/** Un encargo cualquiera a varios motores, con su criterio; un juez (otro motor) puntúa sin saber quién es quién. */
export async function compararMotores(db: Db, c: { pedido: string; criterio: string; sistema?: string | null; motores?: string[] }) {
  const motores = (c.motores?.length ? c.motores : [cadenaPara({ clase: 'mastropiero', agenteId: 'mastropiero' })[0], M.mimo, M.qwen]).slice(0, 4)
  const p: Prueba = { id: 'pedido', nombre: 'A pedido', clase: { clase: 'mastropiero', agenteId: 'benchmark' }, sistema: c.sistema ?? 'Resolvé el encargo.', usuario: c.pedido, criterio: c.criterio, puntuar: () => ({ puntaje: 0, detalle: '' }) }
  const corrida = `pedido-${Date.now().toString(36)}`
  const salidas: { modelo: string; m: Medicion; salida: string }[] = []
  for (const modelo of [...new Set(motores)]) {
    const m = await medir(db, corrida, p, modelo, false)
    const salida = (db.prepare('SELECT salida FROM bench_corridas WHERE corrida = ? AND modelo = ? ORDER BY id DESC LIMIT 1').get(corrida, modelo) as { salida: string } | undefined)?.salida ?? ''
    salidas.push({ modelo, m, salida })
  }
  const letras = salidas.map((_, i) => String.fromCharCode(65 + i))
  const { datos } = await pedirJson<{ puntajes?: { letra: string; puntaje: number; por_que: string }[] }>({ db, clase: 'auditor', agenteId: 'benchmark-juez', modelos: [M.pro, M.deepseek] }, SISTEMA_JUEZ,
    `ENCARGO:\n${c.pedido}\n\nCRITERIO:\n${c.criterio}\n\n${salidas.map((s, i) => `RESPUESTA ${letras[i]}:\n${s.salida || `(falló: ${s.m.error})`}`).join('\n\n')}`, { temperatura: 0 })
  return salidas.map((s, i) => {
    const j = (datos.puntajes ?? []).find((x) => x.letra === letras[i])
    return { modelo: s.modelo, puntaje: j ? Math.max(0, Math.min(10, Number(j.puntaje))) : null, por_que: j?.por_que ?? null, ms: s.m.ms, creditos: s.m.creditos, tokensIn: s.m.tokensIn, tokensOut: s.m.tokensOut, respuesta: s.salida.slice(0, 600) }
  }).sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1))
}
