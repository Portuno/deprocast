/**
 * El Menú general: todo Deprocast en una página. La pantalla pone qué es cada lugar; esto dice cuánto hay de verdad en
 * cada uno (de su base), para que se entienda de un vistazo dónde está todo y qué está vivo.
 */
import type { Db } from './db.ts'

const SQL: Record<string, string> = {
  corpus: 'SELECT COUNT(*) AS n FROM corpus',
  fuentes: 'SELECT COUNT(*) AS n FROM fuentes',
  entidades: 'SELECT COUNT(*) AS n FROM entidades',
  personas: `SELECT COUNT(*) AS n FROM entidades WHERE tipo = 'persona'`,
  proyectos: `SELECT COUNT(*) AS n FROM entidades WHERE tipo = 'proyecto'`,
  misiones: `SELECT COUNT(*) AS n FROM misiones WHERE estado IN ('activa', 'sugerida')`,
  agentes: 'SELECT COUNT(*) AS n FROM agentes',
  encargos: `SELECT COUNT(*) AS n FROM tareas WHERE estado NOT IN ('hecha', 'cancelada', 'fallida')`,
  dominios: `SELECT COUNT(*) AS n FROM aprendizajes WHERE estado IN ('activo', 'pausado', 'logrado')`,
  idiomas: 'SELECT COUNT(*) AS n FROM idiomas',
  salud: 'SELECT COUNT(*) AS n FROM salud',
  movimientos: 'SELECT COUNT(*) AS n FROM movimientos',
  suenos: 'SELECT COUNT(*) AS n FROM suenos',
  cuadernos: 'SELECT COUNT(*) AS n FROM cuadernos',
  obras: 'SELECT COUNT(*) AS n FROM obras',
  hojas: `SELECT COUNT(*) AS n FROM tandas WHERE tipo = 'pagina'`,
  cuadernosHuion: `SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(cuaderno), ''), '-')) AS n FROM tandas WHERE tipo = 'pagina'`,
  compras: `SELECT COUNT(*) AS n FROM compras WHERE estado = 'pendiente'`,
  reservas: `SELECT COUNT(*) AS n FROM reservas WHERE estado IN ('a_buscar', 'pedida')`,
  arquetiposNombrados: `SELECT COUNT(*) AS n FROM paginas WHERE tipo = 'arquetipo' AND nombre IS NOT NULL`,
  paginasConstruidas: 'SELECT COUNT(*) AS n FROM paginas WHERE construida_en IS NOT NULL',
  propuestas: `SELECT COUNT(*) AS n FROM propuestas WHERE estado = 'abierta'`,
  mensajes: 'SELECT COUNT(*) AS n FROM mensajes',
  conversaciones: 'SELECT COUNT(*) AS n FROM conversaciones WHERE archivada = 0',
  rutinas: 'SELECT COUNT(*) AS n FROM rutinas WHERE activa = 1',
  programados: 'SELECT COUNT(*) AS n FROM programados',
  quantomos: 'SELECT COUNT(*) AS n FROM quantomos',
}

/** Cuánto hay de cada cosa (una tabla que todavía no existe cuenta 0, no rompe el menú). */
export function menuGeneral(db: Db): { cuentas: Record<string, number> } {
  const cuentas: Record<string, number> = {}
  for (const [k, sql] of Object.entries(SQL)) {
    try { cuentas[k] = Number((db.prepare(sql).get() as { n?: number } | undefined)?.n ?? 0) } catch { cuentas[k] = 0 }
  }
  return { cuentas }
}
