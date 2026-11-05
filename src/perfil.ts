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
    version: process.env.MASTRO_COMMIT ?? null,
  }
}
