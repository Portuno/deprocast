/**
 * Cuentas y voz pública: cada cuenta del jugador tiene su modo. «lectura» (solo se lee, como su WhatsApp personal),
 * «redacta» (Mastropiero prepara y espera su ok: nunca publica solo) o «libre» (publica solo, dentro de horarios
 * y un tope por día). Las publicaciones son la auditoría: borrador → aprobada → publicada (o descartada, o fallo).
 * Publicar de verdad necesita un conector; sin conector, queda lista para que él la copie y la marque publicada.
 */
import { json, type Db } from './db.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'

export const MODOS = ['lectura', 'redacta', 'libre'] as const
export type Modo = (typeof MODOS)[number]
export type Reglas = { temas?: string; tono?: string; horas?: number[]; topeDia?: number; chatId?: string }
export type Cuenta = { id: number; red: string; usuario: string; modo: Modo; conector: string | null; reglas: Reglas; activa: boolean; creadaEn: number }
export type Publicacion = {
  id: number; cuentaId: number; texto: string; estado: 'borrador' | 'aprobada' | 'publicada' | 'descartada' | 'fallo'
  programadaPara: number | null; publicadaEn: number | null; url: string | null; origen: string; error: string | null; creadaEn: number
}

const deCuenta = (r: any): Cuenta => ({ id: r.id, red: r.red, usuario: r.usuario, modo: r.modo, conector: r.conector, reglas: json(r.reglas, {}), activa: r.activa === 1, creadaEn: r.creada_en })
const dePub = (r: any): Publicacion => ({ id: r.id, cuentaId: r.cuenta_id, texto: r.texto, estado: r.estado, programadaPara: r.programada_para, publicadaEn: r.publicada_en, url: r.url, origen: r.origen, error: r.error, creadaEn: r.creada_en })

export function listarCuentas(db: Db): Cuenta[] {
  return db.prepare('SELECT * FROM cuentas ORDER BY red, usuario').all().map(deCuenta)
}
export function leerCuenta(db: Db, id: number): Cuenta | null {
  const r = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(id)
  return r ? deCuenta(r) : null
}

/** Conectores de publicación que existen hoy. Los que no tienen API oficial (Instagram, WhatsApp personal) quedan en manual. */
export const CONECTORES: Record<string, string> = { manual: 'Manual (copiás y la marcás publicada)', telegram_canal: 'Canal de Telegram (con el bot de Mastropiero como admin)' }

export function guardarCuenta(db: Db, c: { id?: number; red: string; usuario: string; modo?: string; conector?: string | null; reglas?: Reglas; activa?: boolean }, ahora = Date.now()): Cuenta {
  const modo = MODOS.includes(c.modo as Modo) ? c.modo as Modo : 'redacta'
  const conector = c.conector && CONECTORES[c.conector] ? c.conector : 'manual'
  if (!c.red?.trim() || !c.usuario?.trim()) throw new Error('La cuenta necesita red y usuario')
  if (c.id) {
    if (!leerCuenta(db, c.id)) throw new Error(`No existe la cuenta ${c.id}`)
    db.prepare('UPDATE cuentas SET red = ?, usuario = ?, modo = ?, conector = ?, reglas = ?, activa = ? WHERE id = ?')
      .run(c.red.trim(), c.usuario.trim(), modo, conector, JSON.stringify(c.reglas ?? {}), c.activa === false ? 0 : 1, c.id)
    return leerCuenta(db, c.id)!
  }
  const r = db.prepare('INSERT INTO cuentas (red, usuario, modo, conector, reglas, activa, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.red.trim(), c.usuario.trim(), modo, conector, JSON.stringify(c.reglas ?? {}), c.activa === false ? 0 : 1, ahora)
  return leerCuenta(db, Number(r.lastInsertRowid))!
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
- Primera persona, como escribe él (según su memoria), adaptado a la red (largo, tono, hashtags solo si esa red los usa).
- Que aporte algo (una idea, una historia, algo útil o gracioso), no autobombo vacío. Variá formatos.
- Respetá los temas y el tono de la cuenta. Nada que él no diría. Nada inventado sobre hechos.
Forma: {"publicaciones": [{"texto": string}]}`

export async function redactarPublicaciones(db: Db, cuentaId: number, o: { n?: number; tema?: string | null; ahora?: number } = {}): Promise<Publicacion[]> {
  const ahora = o.ahora ?? Date.now()
  const c = leerCuenta(db, cuentaId)
  if (!c) throw new Error(`No existe la cuenta ${cuentaId}`)
  if (c.modo === 'lectura') throw new Error(`${c.red} (${c.usuario}) es solo de lectura: ahí no se publica`)
  const recientes = listarPublicaciones(db, { cuentaId, estados: ['publicada', 'aprobada'], limite: 8 }).map((p) => `- ${p.texto.slice(0, 200)}`)
  const { datos } = await pedirJson<{ publicaciones?: { texto?: string }[] }>({ db, clase: 'mastropiero', agenteId: 'cuentas' }, SISTEMA, [
    `Cuenta: ${c.red}, ${c.usuario}. Temas: ${c.reglas.temas ?? 'los suyos'}. Tono: ${c.reglas.tono ?? 'el suyo'}.`,
    o.tema ? `Esta vez, sobre: ${o.tema}` : '',
    recientes.length ? `Lo último que salió (no repitas):\n${recientes.join('\n')}` : '',
    `Cuántas: ${o.n ?? 3}.`,
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 50)}`,
  ].filter(Boolean).join('\n'), { temperatura: 0.8, maxTokens: 2500 })
  const alta = db.prepare(`INSERT INTO publicaciones (cuenta_id, texto, estado, origen, creada_en) VALUES (?, ?, ?, 'mastropiero', ?)`)
  const ids: number[] = []
  for (const p of (datos.publicaciones ?? []).slice(0, o.n ?? 3)) {
    if (typeof p?.texto !== 'string' || !p.texto.trim()) continue
    // En modo libre se aprueban solas (se publican en su horario); en «redacta» esperan su ok, siempre.
    ids.push(Number(alta.run(cuentaId, p.texto.trim(), c.modo === 'libre' ? 'aprobada' : 'borrador', ahora).lastInsertRowid))
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
