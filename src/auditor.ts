/**
 * El log del auditor: input / decisión / output de cada corrida y de cada asignación.
 * Lo escribe la liga, no los agentes. Los agentes de clase Auditor lo leen y juzgan.
 */
import { json, type Db } from './db.ts'

/** Con menos de esto, nadie está especializado todavía. */
export const MIN_EXITOS_ESPECIALIDAD = 3

export type Asiento = {
  tareaId: number | null
  agenteId: string
  input?: unknown
  decision?: string
  output?: unknown
  ok: boolean
  dominio?: string | null
}

export function registrar(db: Db, a: Asiento, ahora = Date.now()) {
  db.prepare(
    `INSERT INTO auditoria (tarea_id, agente_id, input, decision, output, ok, dominio, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.tareaId, a.agenteId,
    a.input === undefined ? null : JSON.stringify(a.input),
    a.decision ?? null,
    a.output === undefined ? null : JSON.stringify(a.output),
    a.ok ? 1 : 0, a.dominio ?? null, ahora,
  )
}

/** Dominio donde más rindió, autodetectado del log. */
export function especializacion(db: Db, agenteId: string): string | null {
  const r = db
    .prepare(
      `SELECT dominio, COUNT(*) AS n FROM auditoria
       WHERE agente_id = ? AND ok = 1 AND dominio IS NOT NULL AND tarea_id IS NOT NULL
       GROUP BY dominio ORDER BY n DESC, dominio LIMIT 1`,
    )
    .get(agenteId) as { dominio: string; n: number } | undefined
  return r && r.n >= MIN_EXITOS_ESPECIALIDAD ? r.dominio : null
}

export function asientos(db: Db, filtro: { agenteId?: string; limite?: number } = {}) {
  const limite = filtro.limite ?? 30
  const rows = filtro.agenteId
    ? db.prepare('SELECT * FROM auditoria WHERE agente_id = ? ORDER BY id DESC LIMIT ?').all(filtro.agenteId, limite)
    : db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT ?').all(limite)
  return rows.map((r: any) => ({
    id: r.id as number,
    tareaId: r.tarea_id as number | null,
    agenteId: r.agente_id as string,
    input: json<unknown>(r.input, null),
    decision: r.decision as string | null,
    output: json<unknown>(r.output, null),
    ok: r.ok === 1,
    dominio: r.dominio as string | null,
    en: r.en as number,
  }))
}
