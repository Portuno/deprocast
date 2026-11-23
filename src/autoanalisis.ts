/**
 * El autoanálisis (Fragua #322): Mastropiero se mide a sí mismo y al sistema, y cada reporte es la línea base del
 * siguiente. Antes las métricas estaban dispersas (uso, teléfono, evidencia, salud, grafo, economía) y cada consulta se
 * leía sola, sin memoria de la anterior.
 * - Siempre los mismos bloques, en el mismo orden, declarados en un solo lugar (BLOQUES): cada métrica con su id, su
 *   unidad y hacia dónde es mejor. Un bloque o una métrica nueva no rompe la comparación (se compara por id).
 * - Cada número con la diferencia contra la corrida anterior y contra la primera (la línea base), con signo.
 * - Lo que no se puede medir dice «sin dato»: no se estima.
 * - Las tres cosas para cambiar salen de las métricas que más empeoraron, cada una con su número: nada de conclusiones
 *   sin el número al lado.
 * - Se guarda versionado (con la fecha en el título) en el corpus, citable; corre a pedido y solo los domingos.
 */
import { fechaLocal, json, type Db } from './db.ts'

type Rango = { desde: number; hasta: number; dDesde: string; dHasta: string }
type Metrica = { id: string; nombre: string; unidad?: string; mejor: 'mas' | 'menos' | null; calcular: (db: Db, r: Rango) => number | null }
type Lista = { id: string; nombre: string; calcular: (db: Db, r: Rango) => string[] }
type Bloque = { id: string; titulo: string; metricas: Metrica[]; listas?: Lista[] }

/** Un número de una consulta; null («sin dato») si la tabla no existe o no hay filas. */
const num = (db: Db, sql: string, ...a: (string | number)[]): number | null => {
  try {
    const r = db.prepare(sql).get(...a) as Record<string, unknown> | undefined
    const v = r ? Object.values(r)[0] : null
    return v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100
  } catch { return null }
}
const filas = <T,>(db: Db, sql: string, ...a: (string | number)[]): T[] => { try { return db.prepare(sql).all(...a) as T[] } catch { return [] } }
const mediana = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }
const contar = (db: Db, sql: string, ...a: (string | number)[]) => num(db, sql, ...a) ?? 0

/** Los bloques: el formato cerrado, en un solo lugar. El orden es el del reporte. */
export const BLOQUES: Bloque[] = [
  {
    id: 'uso', titulo: '1. Uso: qué se usó de verdad', metricas: [
      { id: 'uso.herramientas', nombre: 'Herramientas distintas que usó Mastropiero', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(DISTINCT herramienta) FROM mensajes WHERE rol = 'herramienta' AND en >= ? AND en < ?`, r.desde, r.hasta) },
      { id: 'uso.llamadas', nombre: 'Llamadas a herramientas', mejor: null, calcular: (db, r) => num(db, `SELECT COUNT(*) FROM mensajes WHERE rol = 'herramienta' AND en >= ? AND en < ?`, r.desde, r.hasta) },
      { id: 'uso.vistas', nombre: 'Pantallas distintas que abriste', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(DISTINCT nombre) FROM uso WHERE tipo = 'vista' AND en >= ? AND en < ?`, r.desde, r.hasta) },
      { id: 'uso.mensajes', nombre: 'Mensajes tuyos', mejor: null, calcular: (db, r) => num(db, `SELECT COUNT(*) FROM mensajes WHERE rol = 'operador' AND en >= ? AND en < ?`, r.desde, r.hasta) },
    ],
    listas: [{ id: 'uso.sin_tocar', nombre: 'Grupos de herramientas que no se tocaron', calcular: (db, r) => gruposSinUso(db, r) }],
  },
  {
    id: 'velocidad', titulo: '2. Velocidad del chat', metricas: [
      { id: 'velocidad.mediana', nombre: 'Mediana por turno', unidad: 's', mejor: 'menos', calcular: (db, r) => { const m = mediana(filas<{ t: number }>(db, 'SELECT total_ms AS t FROM chat_tiempos WHERE en >= ? AND en < ?', r.desde, r.hasta).map((x) => x.t)); return m == null ? null : Math.round(m / 100) / 10 } },
      { id: 'velocidad.turnos', nombre: 'Turnos medidos', mejor: null, calcular: (db, r) => num(db, 'SELECT COUNT(*) FROM chat_tiempos WHERE en >= ? AND en < ?', r.desde, r.hasta) },
    ],
    listas: [{ id: 'velocidad.por_tipo', nombre: 'Mediana por tipo de turno', calcular: (db, r) => {
      const por = new Map<string, number[]>()
      for (const x of filas<{ tipo: string; t: number }>(db, 'SELECT tipo, total_ms AS t FROM chat_tiempos WHERE en >= ? AND en < ?', r.desde, r.hasta)) por.set(x.tipo, [...(por.get(x.tipo) ?? []), x.t])
      return [...por].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([t, xs]) => `${t}: ${Math.round(mediana(xs)! / 100) / 10} s (${xs.length} turnos)`)
    } }],
  },
  {
    id: 'aciertos', titulo: '3. Aciertos', metricas: [
      { id: 'aciertos.bandas_hechas', nombre: 'Bandas hechas', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM misiones WHERE nivel = 'secundaria' AND estado = 'hecha' AND cerrada_en >= ? AND cerrada_en < ?`, r.desde, r.hasta) },
      { id: 'aciertos.bandas_parciales', nombre: 'Bandas a medias', mejor: null, calcular: (db, r) => num(db, `SELECT COUNT(*) FROM misiones WHERE nivel = 'secundaria' AND estado = 'parcial' AND cerrada_en >= ? AND cerrada_en < ?`, r.desde, r.hasta) },
      { id: 'aciertos.bandas_no', nombre: 'Bandas que no salieron', mejor: 'menos', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM misiones WHERE nivel = 'secundaria' AND estado = 'no' AND cerrada_en >= ? AND cerrada_en < ?`, r.desde, r.hasta) },
      { id: 'aciertos.primarias_avanzadas', nombre: 'Primarias con alguna banda hecha', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(DISTINCT padre_id) FROM misiones WHERE nivel = 'secundaria' AND estado IN ('hecha', 'parcial') AND cerrada_en >= ? AND cerrada_en < ? AND padre_id IS NOT NULL`, r.desde, r.hasta) },
      { id: 'aciertos.propuestas_aceptadas', nombre: 'Propuestas de la Fragua aceptadas', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM propuestas WHERE estado = 'aceptada' AND resuelta_en >= ? AND resuelta_en < ?`, r.desde, r.hasta) },
      { id: 'aciertos.propuestas_descartadas', nombre: 'Propuestas descartadas', mejor: 'menos', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM propuestas WHERE estado = 'descartada' AND resuelta_en >= ? AND resuelta_en < ?`, r.desde, r.hasta) },
      { id: 'aciertos.sugerencias_rechazadas', nombre: 'Sugerencias que rechazaste', mejor: 'menos', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM decisiones WHERE accion = 'rechazada' AND en >= ? AND en < ?`, r.desde, r.hasta) },
    ],
  },
  {
    id: 'cuerpo', titulo: '4. Cuerpo', metricas: [
      { id: 'cuerpo.sueno', nombre: 'Sueño promedio', unidad: 'h', mejor: 'mas', calcular: (db, r) => num(db, `SELECT AVG(CAST(json_extract(datos, '$.horas') AS REAL)) FROM salud WHERE tipo = 'sueno' AND fecha >= ? AND fecha <= ? AND json_extract(datos, '$.horas') IS NOT NULL`, r.dDesde, r.dHasta) },
      { id: 'cuerpo.ejercicio', nombre: 'Días con ejercicio', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(DISTINCT fecha) FROM salud WHERE tipo = 'ejercicio' AND fecha >= ? AND fecha <= ?`, r.dDesde, r.dHasta) },
      { id: 'cuerpo.pantalla', nombre: 'Pantalla del teléfono por día', unidad: 'min', mejor: 'menos', calcular: (db, r) => num(db, `SELECT AVG(pantalla_min) FROM uso_telefono WHERE fecha >= ? AND fecha <= ?`, r.dDesde, r.dHasta) },
      { id: 'cuerpo.desbloqueos', nombre: 'Desbloqueos por día', mejor: 'menos', calcular: (db, r) => num(db, `SELECT AVG(desbloqueos) FROM uso_telefono WHERE fecha >= ? AND fecha <= ?`, r.dDesde, r.dHasta) },
      { id: 'cuerpo.pasos', nombre: 'Pasos por día (de los días anotados)', mejor: 'mas', calcular: (db, r) => num(db, `SELECT AVG(p) FROM (SELECT fecha, SUM(CAST(json_extract(datos, '$.pasos') AS REAL)) AS p FROM salud WHERE tipo = 'ejercicio' AND fecha >= ? AND fecha <= ? AND json_extract(datos, '$.pasos') IS NOT NULL GROUP BY fecha)`, r.dDesde, r.dHasta) },
      { id: 'cuerpo.peso', nombre: 'Peso (el último)', unidad: 'kg', mejor: null, calcular: (db, r) => num(db, `SELECT CAST(json_extract(datos, '$.peso') AS REAL) FROM salud WHERE tipo = 'medida' AND fecha >= ? AND fecha <= ? AND json_extract(datos, '$.peso') IS NOT NULL ORDER BY fecha DESC, id DESC LIMIT 1`, r.dDesde, r.dHasta) },
    ],
  },
  {
    id: 'archivo', titulo: '5. Archivo', metricas: [
      ...(['propia', 'primaria', 'investigacion', 'generada'] as const).map((nivel): Metrica => ({ id: `archivo.piezas_${nivel}`, nombre: `Piezas nuevas (${nivel})`, mejor: nivel === 'propia' ? 'mas' : null, calcular: (db, r) => num(db, `SELECT COUNT(*) FROM corpus WHERE nivel = ? AND creado_en >= ? AND creado_en < ?`, nivel, r.desde, r.hasta) })),
      { id: 'archivo.quantomos_sellados', nombre: 'Quántomos sellados', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM quantomos WHERE etapa = 'sellado' AND actualizado_en >= ? AND actualizado_en < ?`, r.desde, r.hasta) },
      { id: 'archivo.entidades_nuevas', nombre: 'Entidades nuevas', mejor: null, calcular: (db, r) => num(db, `SELECT COUNT(*) FROM entidades WHERE creada_en >= ? AND creada_en < ?`, r.desde, r.hasta) },
      { id: 'archivo.nombres_pendientes', nombre: 'Nombres del archivo esperando tu ok', mejor: 'menos', calcular: (db) => num(db, `SELECT COUNT(*) FROM takeout_nombres WHERE estado = 'propuesta'`) },
      { id: 'archivo.sin_pasajes', nombre: 'Piezas sin pasajes (el buscador no las ve por sentido)', mejor: 'menos', calcular: (db) => num(db, `SELECT COUNT(*) FROM corpus c WHERE c.estado != 'retirada' AND NOT EXISTS (SELECT 1 FROM pasajes p WHERE p.pieza_id = c.id)`) },
    ],
  },
  {
    id: 'liga', titulo: '6. Liga', metricas: [
      { id: 'liga.activos', nombre: 'Agentes activos', mejor: null, calcular: (db) => num(db, `SELECT COUNT(*) FROM agentes WHERE estado = 'activo'`) },
      { id: 'liga.creditos', nombre: 'Créditos gastados', mejor: 'menos', calcular: (db, r) => num(db, `SELECT SUM(creditos) FROM llamadas WHERE en >= ? AND en < ?`, r.desde, r.hasta) },
      { id: 'liga.tareas_hechas', nombre: 'Tareas hechas', mejor: 'mas', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM tareas WHERE estado = 'hecha' AND actualizada_en >= ? AND actualizada_en < ?`, r.desde, r.hasta) },
      { id: 'liga.tareas_fallidas', nombre: 'Tareas fallidas', mejor: 'menos', calcular: (db, r) => num(db, `SELECT COUNT(*) FROM tareas WHERE estado = 'fallida' AND actualizada_en >= ? AND actualizada_en < ?`, r.desde, r.hasta) },
    ],
    listas: [{ id: 'liga.por_que', nombre: 'Por qué fallaron (lo que más se repite)', calcular: (db, r) => filas<{ e: string; n: number }>(db, `SELECT substr(COALESCE(error, 'sin motivo'), 1, 90) AS e, COUNT(*) AS n FROM tareas WHERE estado = 'fallida' AND actualizada_en >= ? AND actualizada_en < ? GROUP BY e ORDER BY n DESC LIMIT 3`, r.desde, r.hasta).map((x) => `${x.e} (×${x.n})`) }],
  },
  {
    id: 'voz', titulo: '7. Su voz del período', metricas: [
      { id: 'voz.temas', nombre: 'Temas distintos en lo propio', mejor: null, calcular: (db, r) => num(db, `SELECT COUNT(DISTINCT t.clave) FROM temas_pulso t JOIN corpus c ON c.id = t.pieza_id WHERE c.nivel = 'propia' AND t.fecha >= ? AND t.fecha <= ?`, r.dDesde, r.dHasta) },
    ],
    listas: [
      { id: 'voz.mas', nombre: 'Lo que más apareció', calcular: (db, r) => filas<{ tema: string; n: number }>(db, `SELECT MIN(t.tema) AS tema, COUNT(*) AS n FROM temas_pulso t JOIN corpus c ON c.id = t.pieza_id WHERE c.nivel = 'propia' AND t.fecha >= ? AND t.fecha <= ? GROUP BY t.clave ORDER BY n DESC LIMIT 6`, r.dDesde, r.dHasta).map((x) => `${x.tema} (${x.n})`) },
      { id: 'voz.no_tocado', nombre: 'Lo que venía y esta vez no apareció', calcular: (db, r) => {
        const antes = fechaLocal(r.desde - 28 * 86_400_000)
        return filas<{ tema: string }>(db, `SELECT MIN(t.tema) AS tema FROM temas_pulso t JOIN corpus c ON c.id = t.pieza_id WHERE c.nivel = 'propia' AND t.fecha >= ? AND t.fecha < ? GROUP BY t.clave HAVING COUNT(*) >= 3
          AND t.clave NOT IN (SELECT clave FROM temas_pulso WHERE fecha >= ? AND fecha <= ?) ORDER BY COUNT(*) DESC LIMIT 5`, antes, r.dDesde, r.dDesde, r.dHasta).map((x) => x.tema)
      } },
    ],
  },
  {
    id: 'feed', titulo: '8. Feed', metricas: [
      { id: 'feed.votos', nombre: 'Ítems que puntuaste', mejor: null, calcular: (db, r) => num(db, `SELECT COUNT(*) FROM feed_items WHERE puntaje IS NOT NULL AND votado_en >= ? AND votado_en < ?`, r.desde, r.hasta) },
      { id: 'feed.promedio', nombre: 'Puntaje promedio de lo que te llegó', mejor: 'mas', calcular: (db, r) => num(db, `SELECT AVG(puntaje) FROM feed_items WHERE puntaje IS NOT NULL AND votado_en >= ? AND votado_en < ?`, r.desde, r.hasta) },
    ],
    listas: [
      { id: 'feed.rinden', nombre: 'Cuentas que rinden (promedio 4 o más)', calcular: (db) => rankingFeed(db).filter((x) => x.promedio >= 4 && x.votos >= 3).slice(0, 5).map((x) => `${x.cuenta} (${x.promedio}, ${x.votos} votos)`) },
      { id: 'feed.abajo', nombre: 'Cuentas que caen siempre abajo', calcular: (db) => rankingFeed(db).filter((x) => x.silenciar).slice(0, 5).map((x) => `${x.cuenta} (${x.promedio}, ${x.votos} votos)`) },
    ],
  },
]

let gruposDeHerramientas: Record<string, string[]> | null = null
/** Para las pruebas (y para no cargar todas las herramientas si no hace falta). */
export function _probarGrupos(g: Record<string, string[]>) { gruposDeHerramientas = g }
function gruposSinUso(db: Db, r: Rango): string[] {
  const usadas = new Set(filas<{ h: string }>(db, `SELECT DISTINCT herramienta AS h FROM mensajes WHERE rol = 'herramienta' AND en >= ? AND en < ?`, r.desde, r.hasta).map((x) => x.h))
  return Object.entries(gruposDeHerramientas ?? {}).filter(([, hs]) => !hs.some((h) => usadas.has(h))).map(([g]) => g)
}
/** El ranking del feed se carga una vez por corrida (correrAutoanalisis), antes de calcular los bloques. */
let rankingCache: { en: number; xs: any[] } | null = null
function rankingFeed(_db: Db): { cuenta: string; promedio: number; votos: number; silenciar: boolean }[] {
  return rankingCache?.xs ?? []
}

// ─── correr, comparar, guardar ─────────────────────────────────────────────

export type Corrida = { id: number; version: number; fecha: string; desde: number; hasta: number; metricas: Record<string, number | null>; listas: Record<string, string[]>; piezaId: number | null }
const deFila = (r: any): Corrida => { const d = json<any>(r.datos, {}) ?? {}; return { id: r.id, version: r.version, fecha: r.fecha, desde: r.desde, hasta: r.hasta, metricas: d.metricas ?? {}, listas: d.listas ?? {}, piezaId: r.pieza_id } }
export const corridas = (db: Db): Corrida[] => (db.prepare('SELECT * FROM autoanalisis ORDER BY version').all() as any[]).map(deFila)

const fmt = (v: number | null, unidad?: string) => (v == null ? 'sin dato' : `${v.toLocaleString('es-AR', { maximumFractionDigits: 2 })}${unidad ? ` ${unidad}` : ''}`)
const dif = (hoy: number | null, antes: number | null | undefined) => {
  if (hoy == null || antes == null) return 'sin dato'
  const d = Math.round((hoy - antes) * 100) / 100
  return d === 0 ? '=' : `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
}

/** Las tres métricas que más empeoraron contra la corrida anterior (según hacia dónde es mejor cada una), con su número. */
export function cambiosQueConvienen(hoy: Record<string, number | null>, antes: Record<string, number | null> | null): string[] {
  if (!antes) return []
  const todas = BLOQUES.flatMap((b) => b.metricas)
  return todas.filter((m) => m.mejor && hoy[m.id] != null && antes[m.id] != null)
    .map((m) => {
      const a = antes[m.id]!, h = hoy[m.id]!
      const cambio = (h - a) / Math.max(Math.abs(a), 1)
      return { m, a, h, peor: m.mejor === 'mas' ? -cambio : cambio }
    })
    .filter((x) => x.peor > 0.1)
    .sort((x, y) => y.peor - x.peor)
    .slice(0, 3)
    .map((x) => `**${x.m.nombre}** ${x.m.mejor === 'mas' ? 'bajó' : 'subió'} de ${fmt(x.a, x.m.unidad)} a ${fmt(x.h, x.m.unidad)} (${dif(x.h, x.a)}): ${x.m.mejor === 'mas' ? 'conviene que vuelva a subir' : 'conviene bajarlo'}.`)
}

/**
 * Corre el autoanálisis del período (por defecto, los últimos 7 días), lo compara con la corrida anterior y con la
 * primera, lo guarda versionado en el corpus y devuelve el Markdown.
 */
export async function correrAutoanalisis(db: Db, o: { dias?: number; ahora?: number } = {}): Promise<{ version: number; markdown: string; piezaId: number | null; metricas: Record<string, number | null> }> {
  const ahora = o.ahora ?? Date.now()
  const dias = Math.max(1, Math.min(90, o.dias ?? 7))
  const r: Rango = { desde: ahora - dias * 86_400_000, hasta: ahora, dDesde: fechaLocal(ahora - dias * 86_400_000), dHasta: fechaLocal(ahora) }
  if (!gruposDeHerramientas) try { gruposDeHerramientas = (await import('./chat/herramientas.ts')).GRUPOS } catch { gruposDeHerramientas = {} }
  try { const { rankingCuentas } = await import('./feed.ts'); rankingCache = { en: Date.now(), xs: rankingCuentas(db) } } catch { rankingCache = { en: Date.now(), xs: [] } }
  const metricas: Record<string, number | null> = {}
  const listas: Record<string, string[]> = {}
  for (const b of BLOQUES) {
    for (const m of b.metricas) { try { metricas[m.id] = m.calcular(db, r) } catch { metricas[m.id] = null } }
    for (const l of b.listas ?? []) { try { listas[l.id] = l.calcular(db, r) } catch { listas[l.id] = [] } }
  }
  const previas = corridas(db)
  const anterior = previas.at(-1) ?? null
  const base = previas[0] ?? null
  const version = (anterior?.version ?? 0) + 1
  const fecha = fechaLocal(ahora)
  const l: string[] = [
    `# Autoanálisis · ${fecha} · v${version}`,
    `_Del ${r.dDesde} al ${r.dHasta} (${dias} días). ${anterior ? `Comparado con la v${anterior.version} (${anterior.fecha})${base && base.id !== anterior.id ? ` y con la línea base, v${base.version} (${base.fecha})` : ' (que también es la línea base)'}` : 'Es la primera: queda como línea base.'}_`, '',
  ]
  for (const b of BLOQUES) {
    l.push(`## ${b.titulo}`, '', `| Métrica | Hoy | vs anterior | vs línea base |`, `|---|---|---|---|`)
    for (const m of b.metricas) l.push(`| ${m.nombre} | ${fmt(metricas[m.id], m.unidad)} | ${anterior ? dif(metricas[m.id], anterior.metricas[m.id]) : '—'} | ${base ? dif(metricas[m.id], base.metricas[m.id]) : '—'} |`)
    for (const li of b.listas ?? []) l.push('', `**${li.nombre}:** ${listas[li.id]?.length ? listas[li.id].join(' · ') : 'sin dato'}`)
    l.push('')
  }
  const cambios = cambiosQueConvienen(metricas, anterior?.metricas ?? null)
  l.push('## 9. Tres cosas que conviene cambiar', '', ...(cambios.length ? cambios.map((c, i) => `${i + 1}. ${c}`) : [anterior ? 'Ninguna métrica empeoró más de un 10 % contra la corrida anterior.' : 'Sin corrida anterior todavía: la próxima ya compara.']))
  const markdown = `${l.join('\n').trim()}\n`
  let piezaId: number | null = null
  try {
    const { asegurarFuente, insertar } = await import('./corpus.ts')
    asegurarFuente(db, { id: 'autoanalisis', nombre: 'Autoanálisis', nivel: 'generada', descripcion: 'Cómo viene Deprocast y cómo venís vos, por números, cada corrida contra la anterior y la línea base.' })
    piezaId = insertar(db, { fuente: 'autoanalisis', nivel: 'generada', titulo: `Autoanálisis · ${fecha} · v${version}`, contenido: markdown, fecha, etiquetas: ['autoanalisis'], origenId: `autoanalisis:v${version}`, meta: { autoanalisis: version } }, ahora) ?? null
  } catch (e) { console.error('  autoanálisis → corpus:', e instanceof Error ? e.message : e) }
  db.prepare('INSERT INTO autoanalisis (version, fecha, desde, hasta, datos, pieza_id, creado) VALUES (?, ?, ?, ?, ?, ?, ?)').run(version, fecha, r.desde, r.hasta, JSON.stringify({ metricas, listas }), piezaId, ahora)
  return { version, markdown, piezaId, metricas }
}
