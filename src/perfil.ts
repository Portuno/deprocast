/**
 * El perfil (plan v35): quién es, cuánto gasta y lo que tiene conectado, en un solo lugar.
 * - su nombre (la entidad «yo»), su cuenta de Google y si es un usuario (Deprocast propio);
 * - el uso: tokens de hoy (lo que pidió él, la liga, lo que corre solo), del mes y de los últimos 14 días;
 * - los números de su Deprocast (piezas, entidades, misiones, agentes, mails).
 */
import { fechaLocal, type Db } from './db.ts'
import { tokensHoy, usoDelMes } from './nan.ts'
import { entidadDelJugador } from './personajes.ts'

const contar = (db: Db, sql: string): number | null => {
  try { return Number((db.prepare(sql).get() as { n: number }).n) } catch { return null }
}

/**
 * La velocidad del chat (plan v34, #129): por tipo de turno, la respuesta típica (mediana) y la lenta (p95), y en
 * promedio cuánto se fue en cada etapa (historial, archivo, prompt, la primera respuesta del modelo).
 */
export function velocidadChat(db: Db, dias = 7, ahora = Date.now()) {
  const filas = db.prepare(`SELECT tipo, total_ms, etapas, vueltas FROM chat_tiempos WHERE en >= ? ORDER BY total_ms`).all(ahora - dias * 86_400_000) as { tipo: string; total_ms: number; etapas: string; vueltas: number }[]
  const por = new Map<string, typeof filas>()
  for (const f of filas) por.set(f.tipo, [...(por.get(f.tipo) ?? []), f])
  const pct = (xs: number[], p: number) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null
  return [...por].map(([tipo, xs]) => {
    const totales = xs.map((x) => x.total_ms).sort((a, b) => a - b)
    const etapas: Record<string, number> = {}
    for (const x of xs) { try { for (const [k, v] of Object.entries(JSON.parse(x.etapas) as Record<string, number>)) etapas[k] = (etapas[k] ?? 0) + v / xs.length } catch { /* una fila rota no frena */ } }
    return { tipo, turnos: xs.length, tipico_ms: pct(totales, 0.5), lento_ms: pct(totales, 0.95), vueltas: Math.round((xs.reduce((s, x) => s + x.vueltas, 0) / xs.length) * 10) / 10, etapas_ms: Object.fromEntries(Object.entries(etapas).map(([k, v]) => [k, Math.round(v)])) }
  }).sort((a, b) => b.turnos - a.turnos)
}

export function perfil(db: Db, ahora = Date.now()) {
  const yo = entidadDelJugador(db)
  const nombre = yo ? ((db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(yo) as { nombre: string } | undefined)?.nombre ?? null) : null
  const hoy = tokensHoy(db, ahora)
  const mes = usoDelMes(db, ahora)
  // Los últimos 14 días, día por día (en su hora), separando lo suyo de lo de la liga.
  const desde = ahora - 14 * 86_400_000
  const filas = db.prepare(`SELECT en, clase = 'mastropiero' AS suyo, COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) AS t FROM llamadas WHERE en >= ?`).all(desde) as { en: number; suyo: number; t: number }[]
  const dias = new Map<string, { suyo: number; liga: number }>()
  for (let i = 13; i >= 0; i--) dias.set(fechaLocal(ahora - i * 86_400_000), { suyo: 0, liga: 0 })
  for (const f of filas) {
    const d = dias.get(fechaLocal(f.en))
    if (d) { if (f.suyo) d.suyo += f.t; else d.liga += f.t }
  }
  return {
    nombre,
    usuario: process.env.MASTRO_USUARIO ? Number(process.env.MASTRO_USUARIO) : null,
    uso: {
      hoy,
      mes: { tokens: mes.reduce((s, x) => s + x.tokens, 0), llamadas: mes.reduce((s, x) => s + x.llamadas, 0), errores: mes.reduce((s, x) => s + x.errores, 0), modelos: mes.slice(0, 5).map((x) => ({ modelo: x.modelo, tokens: x.tokens })) },
      dias: [...dias].map(([fecha, v]) => ({ fecha, ...v })),
      tope: Number(process.env.MASTRO_TOPE_DIA) || null,
    },
    numeros: {
      piezas: contar(db, 'SELECT COUNT(*) AS n FROM corpus'),
      entidades: contar(db, 'SELECT COUNT(*) AS n FROM entidades'),
      misiones: contar(db, `SELECT COUNT(*) AS n FROM misiones WHERE estado = 'activa' AND personaje = 'jugador'`),
      agentes: contar(db, `SELECT COUNT(*) AS n FROM agentes WHERE estado IN ('prueba', 'activo')`),
      correos: contar(db, 'SELECT COUNT(*) AS n FROM correos'),
    },
    chat: velocidadChat(db, 7, ahora),
    version: process.env.MASTRO_COMMIT ?? null,
  }
}
