/**
 * El reproceso: usar el cupo de NaN en lo que más mejora las respuestas, de fondo y en la nube.
 * - Pasajes: cada pieza, entera, en tramos con su vector (la búsqueda por sentido ve todo, no solo el principio).
 * - Recuerdos y quántomos con vector (la memoria del prompt va por sentido; los repetidos se juntan aunque cambien las palabras).
 * - Destilado de todo el corpus (lo que el Takeout ya tuvo): resumen, temas, ideas, decisiones, lo abierto, entidades
 *   enlazadas, lugares, eventos con fecha y relaciones entre personas.
 * - Con eso: la crónica de cada mes y la historia de cada proyecto (con todo el archivo, no solo el del Takeout).
 * Sin tope diario (NaN no lo tiene): corre hasta terminar, y lo que gasta no cuenta para el tope de la liga. Lo prende él;
 * en la compu no corre (gasta tokens).
 */
import { ajuste, fijarAjuste, json, type Db } from './db.ts'
import { nanConfigurado, tokensReproceso } from './nan.ts'
import { pasajesDe, vectorizarItems } from './semantica.ts'
import { estadoYoutube } from './youtube.ts'
import { destilarImportadoSiguiente, destilarUnidad, historiaDe, importadoPendiente, proyectosConHistoria, REPROCESO, takeoutTrabajando } from './takeout/nube.ts'
import { cronicaDelMes, mesesSinCronica } from './linea.ts'
import { cuantasFaltan, tarjetasDeLoConsumido } from './consumido.ts'
import { juntarBucles, resumenBucles } from './bucles.ts'

/** Solo en la nube (o si se fuerza para probar): todo esto gasta tokens. */
export const enLaNube = () => process.env.MASTRO_NUBE === '1' || process.env.MASTRO_REPROCESO_LOCAL === '1'

/** Lo que entra al destilado: su voz, su material y lo que investigó, con texto suficiente; no lo generado, lo descartado en la Criba ni lo que ya destiló el Takeout. */
const ELEGIBLES = `c.nivel IN ('propia', 'primaria', 'investigacion') AND LENGTH(c.contenido) >= 400 AND COALESCE(c.peso, 1) != 0
  AND COALESCE(c.origen_id, '') NOT LIKE 'takeout:%' AND COALESCE(c.origen_id, '') NOT LIKE 'linea:%'`

/** Suma a la cola lo que falta destilar (lo nuevo que entró también). Lo suyo primero. */
export function encolarReproceso(db: Db): number {
  return Number(db.prepare(`INSERT OR IGNORE INTO takeout_destilado (pieza_id, lote, prioridad, estado)
    SELECT c.id, '${REPROCESO}', CASE c.nivel WHEN 'propia' THEN 3 WHEN 'primaria' THEN 2 ELSE 1 END + MIN(COALESCE(c.peso, 0), 12) / 4, 'pendiente'
    FROM corpus c WHERE ${ELEGIBLES} AND NOT EXISTS (SELECT 1 FROM takeout_destilado d WHERE d.pieza_id = c.id)`).run().changes)
}


const fallo = (db: Db, pieza: number, paso: string, e: unknown) =>
  db.prepare(`INSERT INTO reproceso_fallos (pieza_id, paso, intentos, error) VALUES (?, ?, 1, ?) ON CONFLICT (pieza_id, paso) DO UPDATE SET intentos = intentos + 1, error = excluded.error`)
    .run(pieza, paso, e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400))

/** paso: el detalle (p. ej. la crónica de qué mes); carriles: qué hace cada carril ahora (para decir «ahora está…»). */
const estado = { trabajando: false, paso: '', carriles: [] as string[] }
const tomadas = new Set<number>() // piezas que un carril ya agarró para pasajes (que otro no las repita)
let enSintesis = false
let enItems = false

/** Las piezas que todavía no tienen pasajes (sin las que fallaron tres veces). */
function sinPasajes(db: Db, n: number): number[] {
  return (db.prepare(`SELECT c.id FROM corpus c WHERE NOT EXISTS (SELECT 1 FROM pasajes p WHERE p.pieza_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM reproceso_fallos f WHERE f.pieza_id = c.id AND f.paso = 'pasajes' AND f.intentos >= 3)
    ORDER BY c.nivel = 'propia' DESC, c.nivel = 'generada', COALESCE(c.peso, 0) DESC, c.id DESC LIMIT ?`).all(n + tomadas.size) as { id: number }[])
    .map((r) => r.id).filter((id) => !tomadas.has(id)).slice(0, n)
}

async function hacerPasajes(db: Db): Promise<boolean> {
  const ids = sinPasajes(db, 8)
  if (!ids.length) return false
  for (const id of ids) tomadas.add(id)
  estado.paso = 'pasajes'
  try {
    await pasajesDe(db, ids)
  } catch (e) {
    // De a una, para saber cuál es la que no sale.
    for (const id of ids) await pasajesDe(db, [id]).catch((err) => fallo(db, id, 'pasajes', err))
  } finally {
    for (const id of ids) tomadas.delete(id)
  }
  return true
}

async function hacerItems(db: Db): Promise<boolean> {
  if (enItems) return false
  enItems = true
  try {
    estado.paso = 'recuerdos y quántomos'
    return (await vectorizarItems(db, 128)) > 0
  } finally {
    enItems = false
  }
}

async function hacerDestilado(db: Db): Promise<boolean> {
  const fila = db.prepare(`SELECT d.pieza_id, d.lote, d.intentos FROM takeout_destilado d JOIN corpus c ON c.id = d.pieza_id WHERE d.lote = ? AND d.estado = 'pendiente' ORDER BY d.prioridad DESC, c.fecha DESC LIMIT 1`).get(REPROCESO) as { pieza_id: number; lote: string; intentos: number } | undefined
  if (!fila) return false
  // Tomarla de forma atómica: si otro carril la agarró primero, no se repite.
  if (!db.prepare(`UPDATE takeout_destilado SET estado = 'procesando', intentos = intentos + 1 WHERE pieza_id = ? AND estado = 'pendiente'`).run(fila.pieza_id).changes) return true
  estado.paso = 'destilado'
  try {
    await destilarUnidad(db, fila, Date.now())
  } catch (e) {
    db.prepare(`UPDATE takeout_destilado SET estado = ?, error = ? WHERE pieza_id = ?`).run(fila.intentos + 1 >= 3 ? 'fallo' : 'pendiente', e instanceof Error ? e.message.slice(0, 500) : String(e), fila.pieza_id)
  }
  return true
}

/** Lo que miró o leyó y valió la pena: sus tarjetas de recuerdo activo (una pieza por vuelta). */
async function hacerTarjetas(db: Db): Promise<boolean> {
  estado.paso = 'tarjetas de lo que miraste'
  return tarjetasDeLoConsumido(db)
}

/** Lo abierto que sigue volviendo: se cuenta y se junta por sentido (de a 40 menciones). */
let enBucles = false
async function hacerBucles(db: Db): Promise<boolean> {
  if (enBucles) return false
  enBucles = true
  try {
    estado.paso = 'lo que sigue volviendo'
    return (await juntarBucles(db, { limite: 40 })) > 0
  } finally {
    enBucles = false
  }
}

async function hacerImportado(db: Db): Promise<boolean> {
  estado.paso = 'destilando lo importado'
  return destilarImportadoSiguiente(db)
}

/** Cuando el destilado se vació: la crónica de los meses con material nuevo y, si hubo bastante nuevo, la historia de cada proyecto. */
async function hacerSintesis(db: Db): Promise<boolean> {
  if (enSintesis) return false
  if (db.prepare(`SELECT 1 FROM takeout_destilado WHERE lote = ? AND estado IN ('pendiente', 'procesando')`).get(REPROCESO)) return false
  enSintesis = true
  try {
    const meses = mesesSinCronica(db)
    if (meses.length) {
      estado.paso = `crónica de ${meses[0].mes}`
      // Si no sale, queda anotada en cronica_fallos (y lo loguea ahí, sin repetir): a los 3 intentos ese mes se deja.
      try { await cronicaDelMes(db, meses[0].mes) } catch { return true }
      return true
    }
    const hechos = (db.prepare(`SELECT COUNT(*) AS n FROM takeout_destilado WHERE estado = 'hecho'`).get() as { n: number }).n
    const antes = Number(ajuste(db, 'reproceso_historia_n') ?? 0)
    if (hechos < antes + 25) return false
    const proyectos = proyectosConHistoria(db, REPROCESO)
    for (const [i, x] of proyectos.entries()) {
      if (!estado.trabajando) return true
      estado.paso = `historia de ${x.nombre} (${i + 1} de ${proyectos.length})`
      try { await historiaDe(db, REPROCESO, x, false, Date.now()) } catch (e) { console.error('  reproceso historia:', e instanceof Error ? e.message : e) }
    }
    fijarAjuste(db, 'reproceso_historia_n', String(hechos))
    return proyectos.length > 0
  } finally {
    enSintesis = false
  }
}

const CARRILES = 4
/** Qué paso de la pantalla es cada cosa que hace un carril. */
const QUE_HACE = new Map<(db: Db) => Promise<boolean>, string>([[hacerPasajes, 'pasajes'], [hacerItems, 'recuerdos'], [hacerDestilado, 'destilado'], [hacerImportado, 'importado'], [hacerTarjetas, 'tarjetas'], [hacerBucles, 'bucles']])

/** Trabaja hasta que no quede nada o se pause. Si ya anda, no hace nada. */
export async function trabajarReproceso(db: Db): Promise<void> {
  if (estado.trabajando || !enLaNube() || !nanConfigurado()) return
  estado.trabajando = true
  try {
    db.prepare('DELETE FROM pasajes WHERE pieza_id NOT IN (SELECT id FROM corpus)').run()
    db.prepare(`UPDATE takeout_destilado SET estado = 'pendiente' WHERE lote = ? AND estado = 'procesando'`).run(REPROCESO)
    let vuelta = 0
    for (;;) {
      if (ajuste(db, 'reproceso_activo') !== '1') { estado.paso = 'en pausa'; break }
      if (vuelta++ % 20 === 0) encolarReproceso(db)
      // No espera al Takeout: los pasajes y los vectores siguen, y dos carriles ayudan a destilar lo importado
      // (lo importado primero: es lo que acabás de subir).
      const conImportado = takeoutTrabajando() || importadoPendiente(db).destilado > 0
      const hizo = await Promise.all(Array.from({ length: CARRILES }, async (_, carril) => {
        const pasos = carril === 0 ? [hacerPasajes, hacerItems, hacerDestilado]
          : conImportado && carril <= 2 ? [hacerImportado, hacerDestilado, hacerPasajes]
          // El último carril, antes de destilar: lo que se aprende de lo consumido y lo que sigue volviendo (no esperan a que se vacíe todo).
          : carril === CARRILES - 1 ? [hacerTarjetas, hacerBucles, hacerDestilado, hacerPasajes]
          : [hacerDestilado, hacerPasajes]
        try {
          for (const paso of pasos) {
            estado.carriles[carril] = QUE_HACE.get(paso) ?? ''
            if (await paso(db).catch((e) => { console.error('  reproceso:', e instanceof Error ? e.message : e); return false })) return true
          }
          return false
        } finally {
          estado.carriles[carril] = ''
        }
      }))
      if (!hizo.some(Boolean)) {
        estado.carriles = ['sintesis']
        const sintetizo = await hacerSintesis(db).catch(() => false)
        estado.carriles = []
        if (!sintetizo) { estado.paso = 'al día'; break }
      }
    }
  } finally {
    estado.trabajando = false
    estado.carriles = []
  }
}

/** Para la pantalla: cuánto va de cada paso, lo gastado, lo que falta y lo último que destiló. */
export function estadoReproceso(db: Db, ahora = Date.now()) {
  const n = (sql: string, ...a: (string | number)[]) => (db.prepare(sql).get(...a) as { n: number }).n
  const destilado = Object.fromEntries((db.prepare(`SELECT estado, COUNT(*) AS n FROM takeout_destilado WHERE lote = ? GROUP BY estado`).all(REPROCESO) as { estado: string; n: number }[]).map((r) => [r.estado, r.n]))
  const porHacer = n(`SELECT COUNT(*) AS n FROM corpus c WHERE ${ELEGIBLES} AND NOT EXISTS (SELECT 1 FROM takeout_destilado d WHERE d.pieza_id = c.id)`)
  const ultimaHora = n(`SELECT COUNT(*) AS n FROM takeout_destilado WHERE lote = ? AND estado = 'hecho' AND hecho_en >= ?`, REPROCESO, ahora - 3_600_000)
  const pendientes = (destilado.pendiente ?? 0) + (destilado.procesando ?? 0) + porHacer
  const t = tokensReproceso(db, ahora)
  return {
    activo: ajuste(db, 'reproceso_activo') === '1', enLaNube: enLaNube(), trabajando: estado.trabajando, paso: estado.paso,
    // Qué se está haciendo en este momento: los carriles del Procesar y, si anda, el obrero del Takeout (imágenes, audios, destilado de lo importado).
    ahora: [...new Set([...estado.carriles.filter(Boolean), ...(takeoutTrabajando() ? ['takeout'] : [])])],
    pasajes: { piezas: n('SELECT COUNT(DISTINCT pieza_id) AS n FROM pasajes'), total: n('SELECT COUNT(*) AS n FROM corpus'), pasajes: n('SELECT COUNT(*) AS n FROM pasajes'), fallos: n(`SELECT COUNT(*) AS n FROM reproceso_fallos WHERE paso = 'pasajes' AND intentos >= 3`) },
    items: {
      hechos: n('SELECT COUNT(*) AS n FROM vec_items'),
      faltan: n(`SELECT COUNT(*) AS n FROM memoria m WHERE m.estado = 'vigente' AND NOT EXISTS (SELECT 1 FROM vec_items v WHERE v.tipo = 'memoria' AND v.id = m.id)`)
        + n(`SELECT COUNT(*) AS n FROM quantomos q WHERE q.etapa IN ('sellado', 'proto') AND NOT EXISTS (SELECT 1 FROM vec_items v WHERE v.tipo = 'quantomo' AND v.id = q.id)`),
    },
    destilado: { hechos: destilado.hecho ?? 0, pendientes, fallos: destilado.fallo ?? 0, porHora: ultimaHora, horasQueFaltan: ultimaHora ? Math.ceil(pendientes / ultimaHora) : null },
    eventos: n('SELECT COUNT(*) AS n FROM eventos'), relaciones: n(`SELECT COUNT(*) AS n FROM conexiones WHERE origen LIKE 'destilado:%'`),
    cronicas: n(`SELECT COUNT(*) AS n FROM corpus WHERE origen_id LIKE 'linea:mes:%'`),
    cronicasFallidas: n('SELECT COUNT(*) AS n FROM cronica_fallos WHERE intentos >= 3'),
    tokens: { hoy: t.hoy, total: t.total },
    tarjetas: { piezas: n('SELECT COUNT(*) AS n FROM tarjetas_piezas'), faltan: cuantasFaltan(db), hechas: n(`SELECT COUNT(*) AS n FROM tarjetas WHERE mazo = 'consumido'`) },
    bucles: resumenBucles(db),
    importado: importadoPendiente(db, ahora),
    youtube: estadoYoutube(db, ahora),
    ultimos: (db.prepare(`SELECT d.pieza_id AS id, c.titulo, d.salida, d.hecho_en FROM takeout_destilado d JOIN corpus c ON c.id = d.pieza_id WHERE d.lote = ? AND d.estado = 'hecho' ORDER BY d.hecho_en DESC LIMIT 6`).all(REPROCESO) as any[])
      .map((r) => ({ id: r.id, titulo: r.titulo, resumen: String(json<any>(r.salida, {})?.resumen ?? '').slice(0, 300), en: r.hecho_en })),
  }
}

/** Empezar, pausar o reintentar lo que falló. */
export function controlarReproceso(db: Db, accion: string) {
  if (accion === 'empezar') {
    if (!enLaNube()) throw new Error('El reproceso corre en la nube (gasta tokens de NaN): prendelo desde tu Deprocast en la nube.')
    fijarAjuste(db, 'reproceso_activo', '1')
    encolarReproceso(db)
    void trabajarReproceso(db).catch((e) => console.error('  reproceso:', e instanceof Error ? e.message : e))
  } else if (accion === 'pausar') fijarAjuste(db, 'reproceso_activo', '0')
  else if (accion === 'reintentar') {
    db.prepare(`UPDATE takeout_destilado SET estado = 'pendiente', intentos = 0, error = NULL WHERE lote = ? AND estado = 'fallo'`).run(REPROCESO)
    db.prepare('DELETE FROM reproceso_fallos').run()
    db.prepare('DELETE FROM cronica_fallos').run()
    if (ajuste(db, 'reproceso_activo') === '1') void trabajarReproceso(db).catch(() => {})
  } else throw new Error('Acción desconocida')
  return estadoReproceso(db)
}
