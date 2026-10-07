/**
 * El roster: fichas vivas, la forja que las crea y la lápida que las retira.
 * Ciclo de vida: forja → prueba → activo ⇄ banca → retirado. Retirar no es mejorar: la ficha pasa a lapidas y no vuelve.
 */
import { ATRIBUTO_MAX, ATRIBUTOS, CLASES, PUNTOS_LIBRES, esClase, type Atributos, type ClaseId } from './clases.ts'
import { json, type Db } from './db.ts'
import { celda } from './geometria72.ts'
import { NIVEL_BAUTISMO, nivelDe } from './xp.ts'
import { especializacion } from './auditor.ts'
import { resolverMotor } from './motores.ts'

export type Estado = 'prueba' | 'activo' | 'banca'

export type Ficha = {
  id: string
  clase: ClaseId
  nombre: string | null
  xp: number
  estado: Estado
  creador: string
  proyectoId: string | null
  celda: number | null
  motor: string
  instrucciones: string
  atributos: Atributos
  exitos: number
  fallos: number
  rachaFallos: number
  creadoEn: number
  ultimaCorrida: number | null
}

/** Reglas de prueba: tres éxitos y entra al roster; tres fallos y se retira sin haber jugado. */
export const PRUEBA_EXITOS = 3
export const PRUEBA_FALLOS = 3
/** Un activo con esta racha de fallos va a la banca. */
export const RACHA_BANCA = 3
/** Una semana sin correr y se retira. */
export const DIAS_SIN_CORRER = 7
export const DIA_MS = 24 * 60 * 60 * 1000

function deFila(r: any): Ficha {
  return {
    id: r.id,
    clase: r.clase,
    nombre: r.nombre,
    xp: r.xp,
    estado: r.estado,
    creador: r.creador,
    proyectoId: r.proyecto_id,
    celda: r.celda,
    motor: r.motor,
    instrucciones: r.instrucciones,
    atributos: json<Atributos>(r.atributos, { ...CLASES[r.clase as ClaseId].base }),
    exitos: r.exitos,
    fallos: r.fallos,
    rachaFallos: r.racha_fallos,
    creadoEn: r.creado_en,
    ultimaCorrida: r.ultima_corrida,
  }
}

export function leer(db: Db, id: string): Ficha | null {
  const r = db.prepare('SELECT * FROM agentes WHERE id = ? COLLATE NOCASE OR nombre = ? COLLATE NOCASE').get(id, id)
  return r ? deFila(r) : null
}

export function listar(db: Db, filtro: { clase?: ClaseId; estado?: Estado; proyectoId?: string } = {}): Ficha[] {
  const where: string[] = []
  const args: (string | null)[] = []
  if (filtro.clase) where.push('clase = ?'), args.push(filtro.clase)
  if (filtro.estado) where.push('estado = ?'), args.push(filtro.estado)
  if (filtro.proyectoId) where.push('proyecto_id = ?'), args.push(filtro.proyectoId)
  const sql = `SELECT * FROM agentes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY xp DESC, id`
  return db.prepare(sql).all(...args).map(deFila)
}

export function nivel(f: Ficha): number {
  return nivelDe(f.xp)
}

/** Nombre visible: el bautizado o la designación. */
export function alias(f: Pick<Ficha, 'id' | 'nombre'>): string {
  return f.nombre ? `${f.nombre} (${f.id})` : f.id
}

// ─── Forja ───────────────────────────────────────────────────────────────

export type PedidoForja = {
  clase: string
  motor?: string
  instrucciones?: string
  /** Hasta PUNTOS_LIBRES puntos repartidos sobre la base de la clase. */
  reparto?: Partial<Atributos>
  creador?: string
  proyectoId?: string | null
  celda?: number | null
  /** La razón por la que nace. Se fija al forjar y no cambia nunca; si falta, sale de su oficio. */
  misionPrincipal?: string | null
  ahora?: number
}

export const MOTOR_DEFECTO = () => process.env.MASTRO_MOTOR ?? 'local'

export function validarPedido(p: PedidoForja): { clase: ClaseId; atributos: Atributos; motor: string } {
  if (p.clase === 'omnivoro' || p.clase === 'omnívoro') {
    throw new Error('Mastropiero no se forja: el Omnívoro es la liga entera, no una ficha.')
  }
  if (!esClase(p.clase)) throw new Error(`Clase desconocida: ${p.clase}`)
  const clase = p.clase
  const atributos = { ...CLASES[clase].base }
  let gastados = 0
  for (const a of ATRIBUTOS) {
    const extra = p.reparto?.[a.id] ?? 0
    if (!Number.isInteger(extra) || extra < 0) throw new Error(`Reparto inválido en ${a.nombre}`)
    gastados += extra
    atributos[a.id] += extra
    if (atributos[a.id] > ATRIBUTO_MAX) throw new Error(`${a.nombre} no puede pasar de ${ATRIBUTO_MAX}`)
  }
  if (gastados > PUNTOS_LIBRES) throw new Error(`Repartiste ${gastados} puntos; hay ${PUNTOS_LIBRES}`)
  const motor = p.motor ?? (clase === 'ejecutivo' ? '' : MOTOR_DEFECTO())
  // Un ejecutivo produce efectos: solo corre funciones registradas, nunca texto libre de un modelo.
  if (clase === 'ejecutivo' && !motor.startsWith('funcion:')) {
    throw new Error('Un ejecutivo necesita motor "funcion:<nombre>" (lista blanca de efectos)')
  }
  resolverMotor(motor)
  if (p.celda != null) celda(p.celda)
  return { clase, atributos, motor }
}

function siguienteDesignacion(db: Db, clase: ClaseId): string {
  const sigla = CLASES[clase].sigla
  const r = db
    .prepare(
      `SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM (
         SELECT id FROM agentes WHERE id LIKE ? UNION ALL SELECT id FROM lapidas WHERE id LIKE ?)`,
    )
    .get(`${sigla}-%`, `${sigla}-%`) as { n: number | null }
  return `${sigla}-${String((r.n ?? 0) + 1).padStart(4, '0')}`
}

export function forjar(db: Db, p: PedidoForja): Ficha {
  const { clase, atributos, motor } = validarPedido(p)
  const id = siguienteDesignacion(db, clase)
  const instrucciones = p.instrucciones?.trim() || `Sos un ${CLASES[clase].nombre}: ${CLASES[clase].produce}.`
  db.prepare(
    `INSERT INTO agentes (id, clase, estado, creador, proyecto_id, celda, motor, instrucciones, atributos, creado_en)
     VALUES (?, ?, 'prueba', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, clase, p.creador ?? 'operador', p.proyectoId ?? null, p.celda ?? null, motor,
    instrucciones, JSON.stringify(atributos), p.ahora ?? Date.now(),
  )
  const mision = p.misionPrincipal?.trim() || `Producir ${CLASES[clase].produce}`
  db.prepare(
    `INSERT INTO misiones (personaje, asignada_por, nivel, titulo, detalle, estado, creada_por, creada_en) VALUES (?, ?, 'principal', ?, ?, 'activa', ?, ?)`,
  ).run(`agente:${id}`, p.creador ?? 'operador', mision.slice(0, 200), instrucciones, p.creador ?? 'operador', p.ahora ?? Date.now())
  return leer(db, id)!
}

// ─── Gestión del roster ──────────────────────────────────────────────────

export function cambiarEstado(db: Db, id: string, estado: Estado) {
  const f = leer(db, id)
  if (!f) throw new Error(`No existe ${id}`)
  if (f.estado === 'prueba' && estado !== 'prueba') {
    throw new Error(`${f.id} está en prueba: se gana el roster corriendo, no por decreto`)
  }
  db.prepare('UPDATE agentes SET estado = ?, racha_fallos = 0 WHERE id = ?').run(estado, f.id)
  if (estado === 'banca') liberarTareas(db, f.id)
}

export function bautizar(db: Db, id: string, nombre: string) {
  const f = leer(db, id)
  if (!f) throw new Error(`No existe ${id}`)
  if (f.nombre) throw new Error(`${f.id} ya se llama ${f.nombre}`)
  if (nivel(f) < NIVEL_BAUTISMO) throw new Error(`${f.id} es nivel ${nivel(f)}: el nombre se gana en nivel ${NIVEL_BAUTISMO}`)
  const limpio = nombre.trim()
  if (!limpio) throw new Error('Nombre vacío')
  const choque = db.prepare('SELECT 1 FROM agentes WHERE nombre = ? COLLATE NOCASE UNION SELECT 1 FROM lapidas WHERE nombre = ? COLLATE NOCASE').get(limpio, limpio)
  if (choque) throw new Error(`"${limpio}" ya fue usado en la liga`)
  db.prepare('UPDATE agentes SET nombre = ? WHERE id = ?').run(limpio, f.id)
}

/** Las tareas que tenía asignadas vuelven al bus. */
function liberarTareas(db: Db, id: string) {
  db.prepare(`UPDATE tareas SET estado = 'pendiente', asignada_a = NULL, asignada_por = NULL WHERE asignada_a = ? AND estado = 'asignada'`).run(id)
}

export function retirar(db: Db, id: string, causa: string, ahora = Date.now()) {
  const f = leer(db, id)
  if (!f) return
  db.prepare(
    `INSERT INTO lapidas (id, clase, nombre, xp, especializacion, causa, ficha, retirado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(f.id, f.clase, f.nombre, f.xp, especializacion(db, f.id), causa, JSON.stringify(f), ahora)
  liberarTareas(db, f.id)
  // Lo que tenía abierto muere con él; su misión principal queda como epitafio.
  db.prepare(`UPDATE misiones SET estado = 'descartada', feedback = COALESCE(feedback, 'el agente se retiró'), cerrada_en = ? WHERE personaje = ? AND nivel != 'principal' AND estado IN ('sugerida', 'activa')`)
    .run(ahora, `agente:${f.id}`)
  db.prepare('DELETE FROM agentes WHERE id = ?').run(f.id)
}

export function lapidas(db: Db) {
  return db.prepare('SELECT id, clase, nombre, xp, especializacion, causa, retirado_en FROM lapidas ORDER BY retirado_en DESC').all() as {
    id: string; clase: ClaseId; nombre: string | null; xp: number; especializacion: string | null; causa: string; retirado_en: number
  }[]
}
