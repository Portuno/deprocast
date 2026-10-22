/**
 * La cola del Taller (plan v23): todo lo que se crea —a mano, desde el chat o pedido por el tutor de la Academia— pasa
 * por acá y corre de a uno (ajuste taller_paralelo, como mucho 2), de fondo, para que crear no sature ni vuelva lento
 * a Deprocast. Cada trabajo deja su registro (de dónde vino, cuándo entró, empezó y terminó, tokens, error).
 * Los visuales del tutor tienen caché (tipo + concepto + nivel + dominio: lo que ya existe no se genera de nuevo) y se
 * degradan a solo texto si la cola está llena, se llegó al tope de tokens o no hay modelo. Al reiniciar, lo que quedó
 * a medias vuelve a la cola.
 */
import crypto from 'node:crypto'
import { ajuste, json, type Db } from './db.ts'
import { enFondo, nanConfigurado, topeAlcanzado } from './nan.ts'
import { crearSegun, crearVisual, iterarArtefacto, leerArtefacto, reservarVisual, type Artefacto } from './taller.ts'

export type Trabajo = {
  id: number; tipo: 'crear' | 'iterar' | 'visual'; args: Record<string, any>; titulo: string; artefactoId: number | null; prioridad: number
  clave: string | null; origen: string; estado: 'en_cola' | 'haciendo' | 'listo' | 'fallo'; error: string | null; tokens: number | null
  encoladoEn: number; empezadoEn: number | null; terminadoEn: number | null
}
const deFila = (r: any): Trabajo => ({
  id: r.id, tipo: r.tipo, args: json(r.args, {}), titulo: r.titulo, artefactoId: r.artefacto_id, prioridad: r.prioridad, clave: r.clave, origen: r.origen,
  estado: r.estado, error: r.error, tokens: r.tokens, encoladoEn: r.encolado_en, empezadoEn: r.empezado_en, terminadoEn: r.terminado_en,
})

/** Cuántos visuales automáticos pueden esperar: más que esto, la sesión sigue solo con texto. */
export const MAX_EN_ESPERA = 6
export const paralelo = (db: Db) => Math.max(1, Math.min(2, Number(ajuste(db, 'taller_paralelo')) || 1))

/** Correr un trabajo (inyectable para tests: sin modelo). */
let correr = async (db: Db, t: Trabajo): Promise<Artefacto | null> => {
  if (t.tipo === 'visual') return crearVisual(db, t.artefactoId!)
  if (t.tipo === 'iterar') return iterarArtefacto(db, Number(t.args.id), String(t.args.cambio ?? ''))
  return crearSegun(db, t.args)
}
export function _probarCola(f: typeof correr) { correr = f }

export const leerTrabajo = (db: Db, id: number) => { const r = db.prepare('SELECT * FROM taller_cola WHERE id = ?').get(id); return r ? deFila(r) : null }

/** Encola algo para crear (a mano o desde el chat). Arranca en cuanto haya lugar. */
export function encolarTaller(db: Db, t: { tipo: Trabajo['tipo']; args: Record<string, any>; titulo: string; prioridad?: number; clave?: string | null; origen?: string; artefactoId?: number | null }, ahora = Date.now()): Trabajo {
  const id = Number(db.prepare('INSERT INTO taller_cola (tipo, args, titulo, artefacto_id, prioridad, clave, origen, encolado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(t.tipo, JSON.stringify(t.args), t.titulo.slice(0, 160), t.artefactoId ?? null, t.prioridad ?? 5, t.clave ?? null, t.origen ?? 'pantalla', ahora).lastInsertRowid)
  void trabajarTaller(db)
  return leerTrabajo(db, id)!
}

/** La clave de la caché de un visual: la misma idea, al mismo nivel, en el mismo dominio, es el mismo visual. */
export const claveVisual = (v: { clase: string; concepto: string; nivel?: number | null; dominioId?: number | null }) =>
  crypto.createHash('sha1').update([v.clase, v.concepto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(), v.nivel ?? '', v.dominioId ?? ''].join('|')).digest('hex').slice(0, 16)

export type PedidoVisual = { artefactoId: number | null; desdeCache: boolean; degradado: string | null }

/**
 * Lo que pide el tutor: un visual para un concepto. Si ya existe (la caché, prefiriendo el sellado), se reusa; si ya se
 * está haciendo, se espera ese; si la cola está llena o no hay con qué, la sesión sigue solo con texto.
 */
export function pedirVisual(db: Db, v: { clase: string; pedido: string; concepto: string; nivel?: number | null; dominio?: string | null; dominioId?: number | null; origen?: string; prioridad?: number }, ahora = Date.now()): PedidoVisual {
  const clave = claveVisual(v)
  const hechos = (db.prepare(`SELECT id, meta FROM artefactos WHERE tipo = 'visual' AND estado = 'listo' AND json_extract(meta, '$.clave') = ? ORDER BY id DESC`).all(clave) as { id: number; meta: string }[])
  if (hechos.length) {
    const sellado = hechos.find((h) => json<any>(h.meta, {}).sellado)
    return { artefactoId: (sellado ?? hechos[0]).id, desdeCache: true, degradado: null }
  }
  const enCurso = db.prepare(`SELECT artefacto_id FROM taller_cola WHERE clave = ? AND estado IN ('en_cola', 'haciendo') ORDER BY id DESC LIMIT 1`).get(clave) as { artefacto_id: number } | undefined
  if (enCurso) return { artefactoId: enCurso.artefacto_id, desdeCache: false, degradado: null }
  if (!nanConfigurado()) return { artefactoId: null, desdeCache: false, degradado: 'sin modelo para dibujar' }
  const tope = topeAlcanzado(db, ahora)
  if (tope) return { artefactoId: null, desdeCache: false, degradado: 'se llegó al tope de tokens de hoy' }
  const espera = (db.prepare(`SELECT COUNT(*) AS n FROM taller_cola WHERE estado = 'en_cola'`).get() as { n: number }).n
  if (espera >= MAX_EN_ESPERA) return { artefactoId: null, desdeCache: false, degradado: 'la cola del Taller está llena' }
  const a = reservarVisual(db, { ...v, clave }, ahora)
  encolarTaller(db, { tipo: 'visual', args: { clase: v.clase }, titulo: v.concepto, prioridad: v.prioridad ?? 5, clave, origen: v.origen ?? 'tutor', artefactoId: a.id }, ahora)
  return { artefactoId: a.id, desdeCache: false, degradado: null }
}

let corriendo = 0

/** El trabajador: toma lo de más prioridad (y más viejo) mientras haya lugar. Lo automático cuenta como de fondo. */
export async function trabajarTaller(db: Db): Promise<void> {
  while (corriendo < paralelo(db)) {
    const r = db.prepare(`SELECT * FROM taller_cola WHERE estado = 'en_cola' ORDER BY prioridad DESC, id LIMIT 1`).get()
    if (!r) return
    const t = deFila(r)
    const tomado = db.prepare(`UPDATE taller_cola SET estado = 'haciendo', empezado_en = ? WHERE id = ? AND estado = 'en_cola'`).run(Date.now(), t.id)
    if (!tomado.changes) continue // otro lo tomó
    corriendo++
    void (async () => {
      const desde = Date.now()
      try {
        const correrlo = () => correr(db, t)
        const a = t.origen.startsWith('tutor') ? await enFondo(correrlo) : await correrlo()
        const fallo = a?.estado === 'fallo' ? (a.progreso ?? 'falló') : null
        const tokens = (db.prepare(`SELECT COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS t FROM llamadas WHERE agente_id = 'taller' AND en >= ?`).get(desde) as { t: number }).t
        db.prepare(`UPDATE taller_cola SET estado = ?, error = ?, artefacto_id = COALESCE(artefacto_id, ?), tokens = ?, terminado_en = ? WHERE id = ?`)
          .run(fallo ? 'fallo' : 'listo', fallo, a?.id ?? null, tokens || null, Date.now(), t.id)
      } catch (e) {
        db.prepare(`UPDATE taller_cola SET estado = 'fallo', error = ?, terminado_en = ? WHERE id = ?`).run(e instanceof Error ? e.message : String(e), Date.now(), t.id)
      } finally {
        corriendo--
        void trabajarTaller(db)
      }
    })()
  }
}

/** Al arrancar: lo que quedó haciéndose vuelve a la cola, y lo del Taller que se cortó sin cola se marca como cortado. */
export function retomarTaller(db: Db): number {
  const n = db.prepare(`UPDATE taller_cola SET estado = 'en_cola', empezado_en = NULL WHERE estado = 'haciendo'`).run().changes
  db.prepare(`UPDATE artefactos SET estado = 'fallo', progreso = 'Se cortó (se reinició el servidor): pedilo de nuevo' WHERE estado = 'haciendo'
    AND id NOT IN (SELECT artefacto_id FROM taller_cola WHERE estado = 'en_cola' AND artefacto_id IS NOT NULL)`).run()
  void trabajarTaller(db)
  return Number(n)
}

/** Para la pantalla: lo que está en el horno, lo que espera y lo último que salió (con cuánto tardó). */
export function estadoCola(db: Db) {
  const fila = (t: Trabajo) => {
    const a = t.artefactoId ? leerArtefacto(db, t.artefactoId) : null
    return { id: t.id, tipo: t.tipo, titulo: t.titulo, origen: t.origen, artefacto: t.artefactoId, progreso: a?.progreso ?? null, encolado: t.encoladoEn, empezado: t.empezadoEn, terminado: t.terminadoEn, ms: t.empezadoEn && t.terminadoEn ? t.terminadoEn - t.empezadoEn : null, tokens: t.tokens, error: t.error, estado: t.estado }
  }
  const de = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map(deFila).map(fila)
  return {
    paralelo: paralelo(db),
    haciendo: de(`SELECT * FROM taller_cola WHERE estado = 'haciendo' ORDER BY empezado_en`),
    enEspera: de(`SELECT * FROM taller_cola WHERE estado = 'en_cola' ORDER BY prioridad DESC, id`),
    ultimos: de(`SELECT * FROM taller_cola WHERE estado IN ('listo', 'fallo') ORDER BY terminado_en DESC LIMIT 10`),
  }
}
