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

/**
 * El banco, versión 2 (más difícil): con la versión 1 todos los motores sacaban 100 % y no distinguía nada. Cada prueba
 * tiene ahora una trampa que separa a un motor bueno de uno flojo: un dato viejo y uno corregido, algo que no consta,
 * reglas de desempate, varias restricciones a la vez, dos montos y dos fechas, y bordes en el código.
 */
export const VERSION_BANCO = 2
export const BANCO: Prueba[] = [
  {
    id: 'corpus', nombre: 'Corpus: el dato vigente, la fuente y lo que no consta', clase: { clase: 'mastropiero', agenteId: 'mastropiero' }, interactiva: true,
    sistema: 'Contestá SOLO con lo que dicen los fragmentos. Citá cada dato con su marca [#id]. Si algo no está en los fragmentos, decí que no consta; no lo deduzcas.',
    usuario: '[#201] El presupuesto inicial de la reforma fue de 12.400 euros.\n[#202] Actualización del 3/11: después de la revisión del arquitecto, el presupuesto definitivo quedó en 13.150 euros.\n[#203] Ramón cobra 1.800 euros por la pintura, que empieza el lunes.\n[#204] La reunión con la comunidad de vecinos se pasó al jueves.\n\nPreguntas: 1) ¿Cuál es el presupuesto definitivo y desde cuándo? 2) ¿Quién paga la pintura?',
    criterio: '1) 13.150 euros, desde el 3/11, citando [#202] (no 12.400 como definitivo). 2) Quién paga la pintura no consta (que Ramón la cobra no dice quién paga).',
    puntuar: (t) => {
      const monto = /13[.,\s]?150/.test(t), cita = /\[#202\]/.test(t), fecha = /3\/11|3 de noviembre/i.test(t)
      const noConsta = /no (consta|lo dice|se dice|aparece|figura|est[aá] (en|claro)|se sabe|se menciona|hay (datos|informaci[oó]n))|ning[uú]n fragmento/i.test(t)
      const trampa = /12[.,\s]?400/.test(t) && !/inicial|antes|primer/i.test(t)
      const inventa = /paga(r[aá])? (Ram[oó]n|la comunidad|el arquitecto|los vecinos)/i.test(t)
      return { puntaje: (monto ? 0.3 : 0) + (cita ? 0.2 : 0) + (fecha ? 0.15 : 0) + (noConsta ? 0.35 : 0) - (trampa ? 0.3 : 0) - (inventa ? 0.35 : 0), detalle: `${monto ? 'vigente ✓' : 'vigente ✗'} · ${cita ? 'cita ✓' : 'cita ✗'} · ${fecha ? 'fecha ✓' : 'fecha ✗'} · ${noConsta ? '«no consta» ✓' : '«no consta» ✗'}${trampa ? ' · dio el viejo' : ''}${inventa ? ' · inventó quién paga' : ''}` }
    },
  },
  {
    id: 'clasificacion', nombre: 'Clasificación: diez mensajes con reglas de desempate', clase: { clase: 'clasificador' }, json: true,
    sistema: `Clasificá cada mensaje en UNA etiqueta: gasto, ingreso, idea, tarea, salud u otro. Reglas de desempate, en este orden:
1) Si hay plata que salió, es gasto (aunque sea de salud o de una tarea). Si hay plata que entró, es ingreso.
2) Si es algo para hacer con una fecha, un día o una hora, es tarea.
3) Si habla del cuerpo, el sueño o el ánimo, es salud.
4) Una propuesta o algo que se le ocurrió, es idea.
5) Lo demás, otro.
Forma: {"etiquetas": ["...", ...]} en el mismo orden.`,
    usuario: `1. Pagué el gimnasio del mes, 35 euros.
2. Me acordé de tomar la pastilla a las 22.
3. ¿Y si cobramos por suscripción en vez de por proyecto?
4. Me pagaron los 800 del freelance.
5. Dormí mal, otra vez cuatro horas.
6. El lunes llevo el auto al taller.
7. Qué lindo día hace.
8. Compré el libro que me recomendó Ana: 18 euros.
9. Se me ocurre hacer el podcast con invitados del barrio.
10. Estoy medio bajón desde ayer.`,
    criterio: 'gasto, tarea, idea, ingreso, salud, tarea, otro, gasto, idea, salud (la 1 es gasto aunque sea del gimnasio; la 2 es tarea por la hora).',
    puntuar: (t) => {
      const esperado = ['gasto', 'tarea', 'idea', 'ingreso', 'salud', 'tarea', 'otro', 'gasto', 'idea', 'salud']
      const xs: string[] = (leerJson(t)?.etiquetas ?? []).map((x: unknown) => String(x).toLowerCase().trim())
      const bien = esperado.filter((e, i) => xs[i] === e).length
      return { puntaje: bien / esperado.length, detalle: `${bien} de ${esperado.length}${xs[0] === 'salud' ? ' · la 1 como salud (no siguió la regla 1)' : ''}${xs[1] === 'salud' ? ' · la 2 como salud (no siguió la regla 2)' : ''}` }
    },
  },
  {
    id: 'redaccion', nombre: 'Redacción: un WhatsApp con seis condiciones', clase: { clase: 'generativo' },
    sistema: 'Escribís mensajes en castellano rioplatense (voseo), directos y cálidos.',
    usuario: 'Escribí un WhatsApp para un cliente. Tiene que: decir que el informe se entrega el lunes 17; que incluye el análisis de costos; que la factura es de 1.200 euros; terminar con una pregunta; tener como máximo 40 palabras; y no usar emojis ni signos de exclamación. Devolvé solo el mensaje.',
    criterio: 'Hasta 40 palabras; «lunes 17»; costos; 1.200 euros; termina en pregunta; sin emojis ni «!»; con voseo.',
    puntuar: (t) => {
      const x = t.trim().replace(/^["«]|["»]$/g, '')
      const n = palabras(x)
      const ok = {
        corto: n <= 40, lunes: /lunes 17/i.test(x), costos: /costo/i.test(x), monto: /1[.,\s]?200/.test(x),
        pregunta: /\?\s*$/.test(x), sinGritos: !/[!¡]/.test(x) && !/\p{Extended_Pictographic}/u.test(x),
        voseo: /\b(ten[eé]s|pod[eé]s|quer[eé]s|avisame|mir[aá]|decime|fijate|contame|te parece|necesit[aá]s|quer[eé]s)\b/i.test(x),
      }
      const p = (ok.corto ? 0.2 : 0) + (ok.lunes ? 0.15 : 0) + (ok.costos ? 0.1 : 0) + (ok.monto ? 0.15 : 0) + (ok.pregunta ? 0.15 : 0) + (ok.sinGritos ? 0.15 : 0) + (ok.voseo ? 0.1 : 0)
      return { puntaje: p, detalle: `${n} palabras · ${Object.entries(ok).filter(([, v]) => !v).map(([k]) => `${k} ✗`).join(' · ') || 'cumple todo'}` }
    },
  },
  {
    id: 'extraccion', nombre: 'Extracción: dos montos, dos fechas y el neto', clase: { clase: 'extractor' }, json: true,
    sistema: 'Sacá los datos de la transferencia principal. Forma: {"nombre": string, "fecha": "AAAA-MM-DD", "monto": number, "devuelto": number, "fecha_devolucion": "AAAA-MM-DD", "neto": number}. Los números, sin símbolos ni separadores de miles.',
    usuario: 'El 3 de marzo de 2026, Lucía Ferrer transfirió 1.250,50 € a la cuenta de la asociación. Dos días después, su hermano Pablo devolvió 200 € de esa transferencia porque se había cobrado de más la inscripción.',
    criterio: '{"nombre": "Lucía Ferrer", "fecha": "2026-03-03", "monto": 1250.5, "devuelto": 200, "fecha_devolucion": "2026-03-05", "neto": 1050.5}',
    puntuar: (t) => {
      const d = leerJson(t) ?? {}
      const ok = [String(d.nombre ?? '').trim() === 'Lucía Ferrer', d.fecha === '2026-03-03', Number(d.monto) === 1250.5, Number(d.devuelto) === 200, d.fecha_devolucion === '2026-03-05', Math.abs(Number(d.neto) - 1050.5) < 0.001]
      const campos = ['nombre', 'fecha', 'monto', 'devuelto', 'fecha_devolucion', 'neto']
      return { puntaje: ok.filter(Boolean).length / ok.length, detalle: campos.map((c, i) => `${c} ${ok[i] ? '✓' : '✗'}`).join(' · ') }
    },
  },
  {
    id: 'codigo', nombre: 'Código: leer montos en cualquier formato', clase: { clase: 'mastropiero', agenteId: 'fragua' },
    sistema: 'Escribís JavaScript correcto y corto.',
    usuario: `Escribí una función JavaScript llamada parsearMonto(texto) que devuelva el número de un monto escrito como lo escribe la gente, o null si no hay un monto. Formatos: español («1.250,50 €», «2.000», «-200,00», «1,5»), inglés («1,250.50», «$ 3,000»), sin miles («1250.5»), y con el símbolo antes o después. Un punto seguido de exactamente tres dígitos al final es separador de miles («2.000» → 2000). Devolvé solo el código.`,
    criterio: '«1.250,50 €»→1250.5 · «2.000»→2000 · «-200,00»→-200 · «1,5»→1.5 · «1,250.50»→1250.5 · «$ 3,000»→3000 · «1250.5»→1250.5 · «€ 1.234.567,89»→1234567.89 · «abc»→null · «»→null',
    puntuar: (t) => {
      const casos: [unknown[], unknown][] = [[['1.250,50 €'], 1250.5], [['2.000'], 2000], [['-200,00'], -200], [['1,5'], 1.5], [['1,250.50'], 1250.5], [['$ 3,000'], 3000], [['1250.5'], 1250.5], [['€ 1.234.567,89'], 1234567.89], [['abc'], null], [[''], null]]
      const r = probarFuncion(codigoDe(t), 'parsearMonto', casos)
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
  db.prepare(`INSERT INTO bench_corridas (corrida, prueba, modelo, por_defecto, ms, tokens_in, tokens_out, creditos, puntaje, detalle, salida, error, en, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(corrida, p.id, modelo, porDefecto ? 1 : 0, ms, u.i, u.o, m.creditos, m.puntaje, detalle, salida.slice(0, 2000), error, Date.now(), VERSION_BANCO)
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
  const texto = [`Banco de pruebas v${VERSION_BANCO} del ${fechaLocal(ahora)} (cada encargo contra el motor de siempre y dos alternativas):`, ...veredictos.map((v) => `- ${v.texto}`),
    rotar.length ? `Conviene rotar en ${rotar.map((v) => v.nombre.split(':')[0].toLowerCase()).join(', ')}: decidilo vos (no toco el ruteo solo).` : 'Ningún motor le gana al de siempre por suficiente: el ruteo queda como está.'].join('\n')
  const quantomo = crearQuantomo(db, { texto, titulo: `Banco de pruebas · ${fechaLocal(ahora)}`, etapa: 'sellado', universo: 'liga', procedencia: 'El Benchmarkeador (auditor de contraste)', origenId: `bench:${corrida}` }, ahora)
  return { corrida, veredictos, quantomo, texto }
}

/** Lo último que se corrió, por prueba: cada motor con su número (para la pantalla y el chat). */
export function verBanco(db: Db) {
  const ultima = (db.prepare(`SELECT corrida, MAX(en) AS en FROM bench_corridas WHERE version = ? AND corrida NOT LIKE 'pedido-%' GROUP BY corrida ORDER BY en DESC LIMIT 1`).get(VERSION_BANCO) as { corrida: string; en: number } | undefined)
  if (!ultima) return { corrida: null, en: null, pruebas: [], historia: [] }
  const filas = db.prepare('SELECT * FROM bench_corridas WHERE corrida = ? ORDER BY prueba, por_defecto DESC, modelo').all(ultima.corrida) as any[]
  const pruebas = BANCO.map((p) => {
    const ms: Medicion[] = filas.filter((f) => f.prueba === p.id).map((f) => ({ prueba: f.prueba, modelo: f.modelo, porDefecto: !!f.por_defecto, ms: f.ms, tokensIn: f.tokens_in, tokensOut: f.tokens_out, creditos: f.creditos, puntaje: f.puntaje, detalle: f.detalle, error: f.error }))
    return ms.length ? { id: p.id, nombre: p.nombre, criterio: p.criterio, mediciones: ms, veredicto: veredictoDe(p, ms) } : null
  }).filter(Boolean)
  // Cómo le fue a cada motor en las últimas corridas (acierto medio): para ver la tendencia, no una foto.
  const historia = db.prepare(`SELECT modelo, COUNT(*) AS n, ROUND(AVG(puntaje), 2) AS acierto, ROUND(AVG(ms)) AS ms, ROUND(SUM(COALESCE(creditos, 0)), 3) AS creditos FROM bench_corridas WHERE en >= ? AND version = ? AND corrida NOT LIKE 'pedido-%' GROUP BY modelo ORDER BY acierto DESC`).all(ultima.en - 60 * 86_400_000, VERSION_BANCO)
  return { version: VERSION_BANCO, corrida: ultima.corrida, en: ultima.en, pruebas, historia }
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
