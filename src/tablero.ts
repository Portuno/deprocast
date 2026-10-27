/**
 * Hoy como tablero (plan v29): abrir Hoy y ver de un vistazo qué se preparó de fondo, qué espera su ok y qué está
 * corriendo. Liviano y sin modelo: lee tablas y el estado en memoria. Cada cosa lleva a su vista.
 * - Listo para usted: lo que dejó «adelantar» (anotado en `preparado`), las clases y sesiones listas sin abrir y el
 *   informe de la semana.
 * - Le espera: 📥 por grupo y la campaña que viene.
 * - Corriendo: agentes trabajando ahora, misiones activas, temas del Observatorio en vivo y la próxima rutina.
 */
import { fechaLocal, type Db } from './db.ts'

export type Item = { texto: string; vista: string | null; n?: number; bandeja?: boolean }
export type Tablero = { listo: Item[]; espera: Item[]; corriendo: Item[] }

const DIA = 86_400_000

/** Lo que dejó listo un proceso de fondo (adelantar y las que vengan). */
export function anotarPreparado(db: Db, que: string, vista: string | null, ahora = Date.now()) {
  db.prepare('INSERT INTO preparado (que, vista, en) VALUES (?, ?, ?)').run(que, vista, ahora)
  db.prepare('DELETE FROM preparado WHERE en < ?').run(ahora - 14 * DIA)
}

export async function tablero(db: Db, ahora = Date.now()): Promise<Tablero> {
  const listo: Item[] = []
  const espera: Item[] = []
  const corriendo: Item[] = []
  const n = (sql: string, ...a: (string | number)[]) => Number((db.prepare(sql).get(...a) as { n: number | null }).n ?? 0)

  // Listo para usted.
  const preparado = db.prepare('SELECT que, vista, MAX(en) AS en FROM preparado WHERE en >= ? GROUP BY que, vista ORDER BY en DESC LIMIT 6').all(ahora - DIA) as { que: string; vista: string | null }[]
  for (const p of preparado) listo.push({ texto: p.que.charAt(0).toUpperCase() + p.que.slice(1), vista: p.vista })
  const clases = n(`SELECT COUNT(*) AS n FROM tutor_sesiones WHERE estado = 'lista'`)
  if (clases) listo.push({ texto: `${clases === 1 ? 'Una clase lista' : `${clases} clases listas`} para abrir`, vista: 'aprender', n: clases })
  const sesiones = n(`SELECT COUNT(*) AS n FROM idioma_sesiones WHERE estado = 'lista'`)
  if (sesiones) listo.push({ texto: `${sesiones === 1 ? 'Una sesión de idioma lista' : `${sesiones} sesiones de idioma listas`}`, vista: 'idiomas', n: sesiones })
  const informe = db.prepare(`SELECT id, metricas FROM reportes WHERE tipo = 'informe' AND creado_en >= ? AND json_extract(metricas, '$.tipo') = 'semanal' ORDER BY id DESC LIMIT 1`).get(ahora - 7 * DIA) as { id: number } | undefined
  if (informe) listo.push({ texto: 'Su informe de la semana', vista: 'informe' })

  // Le espera.
  const { bandeja } = await import('./sombra.ts')
  for (const g of bandeja(db, ahora).grupos.filter((x) => x.n > 0).sort((a, b) => b.peso - a.peso).slice(0, 5)) espera.push({ texto: g.nombre, vista: null, n: g.n, bandeja: true })
  const campana = db.prepare(`SELECT titulo, inicio FROM campanas WHERE estado != 'cerrada' AND inicio > ? AND inicio < ? ORDER BY inicio LIMIT 1`).get(ahora, ahora + 7 * DIA) as { titulo: string; inicio: number } | undefined
  if (campana) espera.push({ texto: `Campaña «${campana.titulo}» el ${new Date(campana.inicio).toLocaleString('es-AR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}`, vista: 'campanas' })

  // Corriendo.
  const { trabajandoAhora } = await import('./agentes/motor.ts')
  const trabajando = trabajandoAhora()
  if (trabajando.length) corriendo.push({ texto: `${trabajando.length === 1 ? `${trabajando[0].agenteId} está trabajando` : `${trabajando.length} agentes trabajando`} ahora`, vista: 'agsala', n: trabajando.length })
  const activas = n(`SELECT COUNT(*) AS n FROM agente_misiones WHERE estado = 'activa'`)
  if (activas) corriendo.push({ texto: `${activas === 1 ? 'Una misión activa' : `${activas} misiones activas`} de sus agentes`, vista: 'agmisiones', n: activas })
  const { enVivo } = await import('./observatorio.ts')
  const vivos = (db.prepare('SELECT nombre, intensivo_desde AS intensivoDesde, intensivo_hasta AS intensivoHasta FROM observatorio_temas WHERE activo = 1').all() as { nombre: string; intensivoDesde: number | null; intensivoHasta: number | null }[]).filter((t) => enVivo(t, ahora))
  for (const t of vivos) corriendo.push({ texto: `Observatorio en vivo: ${t.nombre}`, vista: 'observatorio' })
  const temas = n('SELECT COUNT(*) AS n FROM observatorio_temas WHERE activo = 1')
  if (temas && !vivos.length) corriendo.push({ texto: `El Observatorio sigue ${temas === 1 ? 'un tema' : `${temas} temas`}`, vista: 'observatorio', n: temas })
  const d = new Date(ahora)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const proxima = db.prepare(`SELECT nombre, hora FROM rutinas WHERE activa = 1 AND instr(dias, ?) > 0 AND hora > ? AND (ultima_fecha IS NULL OR ultima_fecha != ?) ORDER BY hora LIMIT 1`).get(String(d.getDay()), hhmm, fechaLocal(ahora)) as { nombre: string; hora: string } | undefined
  if (proxima) corriendo.push({ texto: `A las ${proxima.hora}: ${proxima.nombre}`, vista: null })

  return { listo, espera, corriendo }
}
