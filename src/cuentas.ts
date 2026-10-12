/**
 * Cuentas y voz pública: cada red puede tener varios agentes. «lectura» (solo se lee), «redacta» (prepara y
 * espera el ok: nunca publica solo) o «libre» (publica solo, dentro de horarios y el tope del día). El contexto
 * de cada agente es un Markdown en data/agentes/. La clave queda en la base local y no entra al modelo.
 * Publicar de verdad necesita un conector; sin conector, queda lista para copiar y marcar publicada.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { json, resolverRuta, type Db } from './db.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'

export const MODOS = ['lectura', 'redacta', 'libre'] as const
export type Modo = (typeof MODOS)[number]
export type Oficio = 'operador' | 'creador'
export type Reglas = { temas?: string; tono?: string; horas?: number[]; topeDia?: number; chatId?: string }
export type Cupo = { tipo: string; cantidad: number; clase: 'comentario' | 'pieza' }
export type Cuenta = {
  id: number; red: string; nombre: string | null; usuario: string; correo: string | null; tieneClave: boolean
  modo: Modo; conector: string | null; reglas: Reglas; oficio: Oficio | null; cupos: Cupo[]
  contexto: string | null; activa: boolean; creadaEn: number
}
export type Agente = Cuenta & { clave: string; markdown: string }
export type Publicacion = {
  id: number; cuentaId: number; texto: string; tipo: string | null; estado: 'borrador' | 'aprobada' | 'publicada' | 'descartada' | 'fallo'
  programadaPara: number | null; publicadaEn: number | null; url: string | null; origen: string; error: string | null; creadaEn: number
}

export const REDES: { id: string; nombre: string; oficio: Oficio }[] = [
  { id: 'linkedin', nombre: 'LinkedIn', oficio: 'operador' },
  { id: 'twitter', nombre: 'Twitter', oficio: 'operador' },
  { id: 'facebook', nombre: 'Facebook', oficio: 'operador' },
  { id: 'reddit', nombre: 'Reddit', oficio: 'operador' },
  { id: 'bluesky', nombre: 'Bluesky', oficio: 'operador' },
  { id: 'instagram', nombre: 'Instagram', oficio: 'creador' },
  { id: 'tiktok', nombre: 'TikTok', oficio: 'creador' },
]

export const CUPOS_DEFECTO: Record<Oficio, Cupo[]> = {
  operador: [
    { tipo: 'respuesta', cantidad: 5, clase: 'comentario' },
    { tipo: 'hilo', cantidad: 1, clase: 'comentario' },
    { tipo: 'reaccion', cantidad: 3, clase: 'comentario' },
  ],
  creador: [
    { tipo: 'publicacion', cantidad: 1, clase: 'pieza' },
    { tipo: 'guion', cantidad: 1, clase: 'pieza' },
    { tipo: 'video', cantidad: 1, clase: 'pieza' },
  ],
}

export function redDe(idONombre: string) {
  const t = idONombre.trim().toLowerCase()
  return REDES.find((r) => r.id === t || r.nombre.toLowerCase() === t) ?? null
}

export function cuposPorDefecto(oficio: Oficio | null): Cupo[] {
  return oficio ? CUPOS_DEFECTO[oficio].map((c) => ({ ...c })) : []
}

function normalizarCupos(v: unknown): Cupo[] {
  if (!Array.isArray(v)) return []
  const out: Cupo[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const tipo = String((x as { tipo?: unknown }).tipo ?? '').trim().slice(0, 40)
    const cantidad = Math.max(0, Math.min(50, Math.round(Number((x as { cantidad?: unknown }).cantidad))))
    const clase = (x as { clase?: unknown }).clase === 'pieza' ? 'pieza' : 'comentario'
    if (!tipo || !cantidad) continue
    out.push({ tipo, cantidad, clase })
  }
  return out.slice(0, 12)
}

const deCuenta = (r: any): Cuenta => ({
  id: r.id, red: r.red, nombre: r.nombre ?? null, usuario: r.usuario, correo: r.correo ?? null,
  tieneClave: typeof r.clave === 'string' && r.clave.length > 0, modo: r.modo, conector: r.conector,
  reglas: json(r.reglas, {}), oficio: r.oficio === 'operador' || r.oficio === 'creador' ? r.oficio : null,
  cupos: normalizarCupos(json(r.cupos, [])), contexto: r.contexto ?? null, activa: r.activa === 1, creadaEn: r.creada_en,
})
const dePub = (r: any): Publicacion => ({
  id: r.id, cuentaId: r.cuenta_id, texto: r.texto, tipo: r.tipo ?? null, estado: r.estado, programadaPara: r.programada_para,
  publicadaEn: r.publicada_en, url: r.url, origen: r.origen, error: r.error, creadaEn: r.creada_en,
})

/** Carpeta de los Markdown. Con la base en memoria (tests) cae en un temporal, salvo MASTRO_AGENTES. */
export function dirAgentes(): string {
  const env = (process.env.MASTRO_AGENTES ?? '').trim()
  if (env) return path.resolve(env)
  const db = resolverRuta()
  if (db === ':memory:') return path.join(os.tmpdir(), `mastro-agentes-${process.pid}`)
  return path.join(path.dirname(db), 'agentes')
}

function escribirContexto(id: number, markdown: string): string {
  const dir = dirAgentes()
  fs.mkdirSync(dir, { recursive: true })
  const ruta = path.join(dir, `${id}.md`)
  fs.writeFileSync(ruta, markdown)
  return ruta
}

function leerMarkdown(ruta: string | null): string {
  if (!ruta) return ''
  const abs = path.resolve(ruta)
  const dir = path.resolve(dirAgentes())
  if (abs !== dir && !abs.startsWith(dir + path.sep)) return ''
  if (!fs.existsSync(abs)) return ''
  return fs.readFileSync(abs, 'utf8')
}

export function listarCuentas(db: Db): Cuenta[] {
  return db.prepare('SELECT * FROM cuentas ORDER BY red, usuario').all().map(deCuenta)
}
export function leerCuenta(db: Db, id: number): Cuenta | null {
  const r = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(id)
  return r ? deCuenta(r) : null
}

/** La ficha para el editor: clave y Markdown. El listado no los trae. */
export function leerAgente(db: Db, id: number): Agente | null {
  const c = leerCuenta(db, id)
  if (!c) return null
  const row = db.prepare('SELECT clave FROM cuentas WHERE id = ?').get(id) as { clave: string | null } | undefined
  return { ...c, clave: row?.clave ?? '', markdown: leerMarkdown(c.contexto) }
}

/** Conectores de publicación que existen hoy. Los que no tienen API oficial quedan en manual. */
export const CONECTORES: Record<string, string> = { manual: 'Manual (copiás y la marcás publicada)', telegram_canal: 'Canal de Telegram (con el bot de Mastropiero como admin)' }

function claveGuardada(db: Db, id: number): string | null {
  const row = db.prepare('SELECT clave FROM cuentas WHERE id = ?').get(id) as { clave: string | null } | undefined
  return row?.clave ?? null
}

export function guardarCuenta(db: Db, c: {
  id?: number; red: string; usuario: string; nombre?: string | null; correo?: string | null; clave?: string | null
  modo?: string; conector?: string | null; reglas?: Reglas; activa?: boolean; oficio?: string | null
  cupos?: Cupo[] | null; markdown?: string
}, ahora = Date.now()): Cuenta {
  const modo = MODOS.includes(c.modo as Modo) ? c.modo as Modo : 'redacta'
  const conector = c.conector && CONECTORES[c.conector] ? c.conector : 'manual'
  if (!c.red?.trim() || !c.usuario?.trim()) throw new Error('La cuenta necesita red y usuario')
  const previo = c.id ? leerCuenta(db, c.id) : null
  if (c.id && !previo) throw new Error(`No existe la cuenta ${c.id}`)
  const catalogo = redDe(c.red)
  const red = catalogo?.id ?? c.red.trim()
  const nombre = c.nombre === undefined ? (previo?.nombre ?? null) : (c.nombre?.trim() || null)
  const correo = c.correo === undefined ? (previo?.correo ?? null) : (c.correo?.trim() || null)
  const clave = c.clave === undefined ? (c.id ? claveGuardada(db, c.id) : null) : (typeof c.clave === 'string' && c.clave.trim() ? c.clave.trim() : null)
  const oficio: Oficio | null = c.oficio === 'operador' || c.oficio === 'creador' ? c.oficio : (previo?.oficio ?? catalogo?.oficio ?? null)
  const cupos = c.cupos !== undefined ? normalizarCupos(c.cupos) : (previo?.cupos.length ? previo.cupos : cuposPorDefecto(oficio))
  const reglas: Reglas = { ...(c.reglas ?? {}) }
  if (cupos.length) reglas.topeDia = cupos.reduce((s, x) => s + x.cantidad, 0)
  const activa = c.activa === false ? 0 : 1
  const pack = [red, nombre, c.usuario.trim(), correo, clave, modo, conector, JSON.stringify(reglas), oficio, JSON.stringify(cupos), activa]
  let id = c.id
  if (id) {
    db.prepare('UPDATE cuentas SET red = ?, nombre = ?, usuario = ?, correo = ?, clave = ?, modo = ?, conector = ?, reglas = ?, oficio = ?, cupos = ?, activa = ? WHERE id = ?')
      .run(...pack, id)
  } else {
    const r = db.prepare('INSERT INTO cuentas (red, nombre, usuario, correo, clave, modo, conector, reglas, oficio, cupos, activa, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...pack, ahora)
    id = Number(r.lastInsertRowid)
  }
  if (typeof c.markdown === 'string') {
    const ruta = path.join(dirAgentes(), `${id}.md`)
    if (c.markdown.trim()) {
      db.prepare('UPDATE cuentas SET contexto = ? WHERE id = ?').run(escribirContexto(id!, c.markdown), id)
    } else {
      if (fs.existsSync(ruta)) fs.unlinkSync(ruta)
      db.prepare('UPDATE cuentas SET contexto = NULL WHERE id = ?').run(id)
    }
  }
  return leerCuenta(db, id!)!
}

export function listarPublicaciones(db: Db, f: { cuentaId?: number; estados?: string[]; limite?: number } = {}): Publicacion[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.cuentaId != null) where.push('cuenta_id = ?'), args.push(f.cuentaId)
  if (f.estados?.length) where.push(`estado IN (${f.estados.map(() => '?').join(',')})`), args.push(...f.estados)
  return db.prepare(`SELECT * FROM publicaciones ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(programada_para, creada_en) DESC LIMIT ?`).all(...args, f.limite ?? 100).map(dePub)
}
const leerPub = (db: Db, id: number) => { const r = db.prepare('SELECT * FROM publicaciones WHERE id = ?').get(id); return r ? dePub(r) : null }

// ─── redactar ───────────────────────────────────────────────────────────

const SISTEMA = `Sos Mastropiero y redactás publicaciones para una cuenta del jugador, en SU voz.
- Primera persona, como escribe él (según su memoria y el Markdown del agente), adaptado a la red (largo, tono, hashtags solo si esa red los usa).
- Que aporte algo (una idea, una historia, algo útil o gracioso), no autobombo vacío. Variá formatos.
- Respetá los temas, el tono y los tipos pedidos. Nada que él no diría. Nada inventado sobre hechos. No uses ni cites contraseñas.
Forma: {"publicaciones": [{"texto": string, "tipo": string}]}`

export async function redactarPublicaciones(db: Db, cuentaId: number, o: { n?: number; tema?: string | null; ahora?: number } = {}): Promise<Publicacion[]> {
  const ahora = o.ahora ?? Date.now()
  const c = leerCuenta(db, cuentaId)
  if (!c) throw new Error(`No existe la cuenta ${cuentaId}`)
  if (c.modo === 'lectura') throw new Error(`${c.red} (${c.usuario}) es solo de lectura: ahí no se publica`)
  const recientes = listarPublicaciones(db, { cuentaId, estados: ['publicada', 'aprobada'], limite: 8 }).map((p) => `- ${p.texto.slice(0, 200)}`)
  const markdown = leerMarkdown(c.contexto).trim()
  const nombre = redDe(c.red)?.nombre ?? c.red
  const { datos } = await pedirJson<{ publicaciones?: { texto?: string; tipo?: string }[] }>({ db, clase: 'mastropiero', agenteId: 'cuentas' }, SISTEMA, [
    `Cuenta: ${nombre}${c.nombre ? ` · ${c.nombre}` : ''}, ${c.usuario}. Temas: ${c.reglas.temas ?? 'los suyos'}. Tono: ${c.reglas.tono ?? 'el suyo'}.`,
    markdown ? `Contexto del agente (Markdown):\n${markdown.slice(0, 8000)}` : '',
    o.tema ? `Esta vez, sobre: ${o.tema}` : '',
    recientes.length ? `Lo último que salió (no repitas):\n${recientes.join('\n')}` : '',
    c.cupos.length
      ? `Una pieza por tipo, sin pasarte de la cantidad:\n${c.cupos.map((x) => `- ${x.tipo} (${x.clase}): ${x.cantidad}`).join('\n')}\nEl campo tipo tiene que ser exactamente uno de: ${c.cupos.map((x) => x.tipo).join(', ')}.`
      : `Cuántas: ${o.n ?? 3}.`,
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 50)}`,
  ].filter(Boolean).join('\n'), { temperatura: 0.8, maxTokens: 2500 })
  const alta = db.prepare(`INSERT INTO publicaciones (cuenta_id, texto, estado, tipo, origen, creada_en) VALUES (?, ?, ?, ?, 'mastropiero', ?)`)
  const ids: number[] = []
  const estado = c.modo === 'libre' ? 'aprobada' : 'borrador'
  const guardar = (texto: string, tipo: string | null) => {
    ids.push(Number(alta.run(cuentaId, texto, estado, tipo, ahora).lastInsertRowid))
  }
  const items = (datos.publicaciones ?? []).filter((p) => typeof p?.texto === 'string' && p.texto.trim())
  if (c.cupos.length) {
    const usados = new Map<string, number>()
    for (const p of items) {
      const pedidoTipo = typeof p.tipo === 'string' ? p.tipo.trim() : ''
      const pedido = pedidoTipo ? c.cupos.find((x) => x.tipo === pedidoTipo) : undefined
      const tipo = pedido?.tipo ?? c.cupos.find((x) => (usados.get(x.tipo) ?? 0) < x.cantidad)?.tipo
      if (!tipo) continue
      const ya = usados.get(tipo) ?? 0
      const max = c.cupos.find((x) => x.tipo === tipo)!.cantidad
      if (ya >= max) continue
      usados.set(tipo, ya + 1)
      guardar(p.texto!.trim(), tipo)
    }
  } else {
    for (const p of items.slice(0, o.n ?? 3)) guardar(p.texto!.trim(), null)
  }
  if (c.modo === 'libre') for (const id of ids) programar(db, id, ahora)
  return ids.map((id) => leerPub(db, id)!)
}

/** El próximo horario libre de la cuenta (según sus horas) para una publicación aprobada. */
function programar(db: Db, id: number, ahora: number) {
  const p = leerPub(db, id)!
  const c = leerCuenta(db, p.cuentaId)!
  const horas = c.reglas.horas?.length ? c.reglas.horas : [10, 19]
  const ocupadas = new Set(listarPublicaciones(db, { cuentaId: c.id, estados: ['aprobada'] }).filter((x) => x.id !== id && x.programadaPara).map((x) => x.programadaPara))
  for (let d = 0; d < 30; d++) {
    for (const h of horas) {
      const t = new Date(ahora)
      t.setDate(t.getDate() + d)
      t.setHours(h, 0, 0, 0)
      if (t.getTime() > ahora && !ocupadas.has(t.getTime())) {
        db.prepare('UPDATE publicaciones SET programada_para = ? WHERE id = ?').run(t.getTime(), id)
        return
      }
    }
  }
}

/** Él aprueba (con fecha, o en el próximo horario de la cuenta), edita, descarta o marca publicada a mano. */
export function resolverPublicacion(db: Db, id: number, c: { accion: 'aprobar' | 'descartar' | 'publicada' | 'editar'; texto?: string; cuando?: number | null; url?: string | null }, ahora = Date.now()): Publicacion {
  const p = leerPub(db, id)
  if (!p) throw new Error(`No existe la publicación ${id}`)
  if (c.accion === 'editar') db.prepare('UPDATE publicaciones SET texto = ? WHERE id = ?').run(String(c.texto ?? p.texto).trim(), id)
  if (c.accion === 'descartar') db.prepare(`UPDATE publicaciones SET estado = 'descartada' WHERE id = ?`).run(id)
  if (c.accion === 'publicada') db.prepare(`UPDATE publicaciones SET estado = 'publicada', publicada_en = ?, url = ? WHERE id = ?`).run(ahora, c.url ?? null, id)
  if (c.accion === 'aprobar') {
    db.prepare(`UPDATE publicaciones SET estado = 'aprobada', programada_para = ? WHERE id = ?`).run(c.cuando ?? null, id)
    if (!c.cuando) programar(db, id, ahora)
  }
  return leerPub(db, id)!
}

// ─── publicar ───────────────────────────────────────────────────────────

type Conector = (c: Cuenta, texto: string) => Promise<{ url: string | null }>
const conectores: Record<string, Conector> = {
  async telegram_canal(c, texto) {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token || !c.reglas.chatId) throw new Error('Falta TELEGRAM_BOT_TOKEN o el chat del canal en las reglas de la cuenta')
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c.reglas.chatId, text: texto }) })
    const j: any = await r.json()
    if (!j.ok) throw new Error(`Telegram: ${j.description}`)
    return { url: null }
  },
}
export function _probarConectores(c: Record<string, Conector>) {
  Object.assign(conectores, c)
}

/**
 * Publica lo aprobado cuya hora llegó, en las cuentas con conector y activas. Una cuenta «redacta» solo publica
 * lo que él aprobó; una «libre», lo que se aprobó solo. Nunca más del tope del día.
 */
export async function publicarPendientes(db: Db, ahora = Date.now()): Promise<Publicacion[]> {
  const hechas: Publicacion[] = []
  for (const c of listarCuentas(db).filter((x) => x.activa && x.modo !== 'lectura' && x.conector && x.conector !== 'manual')) {
    const tope = c.reglas.topeDia ?? 3
    const inicio = new Date(ahora)
    inicio.setHours(0, 0, 0, 0)
    let hoy = (db.prepare(`SELECT COUNT(*) AS n FROM publicaciones WHERE cuenta_id = ? AND estado = 'publicada' AND publicada_en >= ?`).get(c.id, inicio.getTime()) as { n: number }).n
    for (const p of listarPublicaciones(db, { cuentaId: c.id, estados: ['aprobada'] }).filter((x) => x.programadaPara != null && x.programadaPara <= ahora).reverse()) {
      if (hoy >= tope) break
      try {
        const r = await conectores[c.conector!](c, p.texto)
        db.prepare(`UPDATE publicaciones SET estado = 'publicada', publicada_en = ?, url = ?, error = NULL WHERE id = ?`).run(ahora, r.url, p.id)
        hoy++
      } catch (e) {
        db.prepare(`UPDATE publicaciones SET estado = 'fallo', error = ? WHERE id = ?`).run(e instanceof Error ? e.message : String(e), p.id)
      }
      hechas.push(leerPub(db, p.id)!)
    }
  }
  return hechas
}
