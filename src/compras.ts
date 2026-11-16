/**
 * La lista de compras. Lo que él manda («comprar leche, huevos y pilas», una foto de una lista, un audio) queda como
 * ítems de verdad, con su cantidad y de dónde salió, en vez de perderse en el chat. Se marca comprado (o se descarta)
 * desde la página, el chat o el bot. Lo repetido no se duplica: si «leche» ya está pendiente, se suma la nota.
 * Las listas que mandó antes de que esto existiera se recuperan del hilo con importarDelHilo (una pasada del modelo).
 */
import type { Db } from './db.ts'

export type Compra = { id: number; item: string; cantidad: string | null; nota: string | null; estado: 'pendiente' | 'comprado' | 'descartado'; origen: string; creadaEn: number; resueltaEn: number | null }

const ESQUEMA = `CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  clave TEXT NOT NULL,
  cantidad TEXT,
  nota TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  origen TEXT NOT NULL DEFAULT 'chat',
  mensaje_id INTEGER,
  creada_en INTEGER NOT NULL,
  resuelta_en INTEGER
);
CREATE INDEX IF NOT EXISTS compras_estado ON compras(estado, clave);`
const listos = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listos.has(db)) return
  db.exec(ESQUEMA)
  listos.add(db)
}

/** Para comparar: sin tildes, sin mayúsculas, sin artículos ni plural simple («Los huevos» = «huevo»). */
export const claveDe = (item: string) => item.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^(el|la|los|las|un|una|unos|unas)\s+/, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(?<=[a-z]{3})(es|s)$/, '')

const deFila = (r: any): Compra => ({ id: r.id, item: r.item, cantidad: r.cantidad, nota: r.nota, estado: r.estado, origen: r.origen, creadaEn: r.creada_en, resueltaEn: r.resuelta_en })

/** Anota ítems. Si ya hay uno pendiente igual, no se duplica (se completa la cantidad o la nota si faltaban). */
export function anotarCompras(db: Db, items: { item: string; cantidad?: string | number | null; nota?: string | null }[], o: { origen?: string; mensajeId?: number | null; ahora?: number } = {}) {
  asegurar(db)
  const ahora = o.ahora ?? Date.now()
  const nuevos: Compra[] = [], yaEstaban: Compra[] = []
  for (const x of items) {
    const item = String(x?.item ?? '').trim().replace(/^[-•*·\d.)\s]+/, '').slice(0, 120)
    const clave = claveDe(item)
    if (!clave) continue
    const cantidad = x.cantidad == null || x.cantidad === '' ? null : String(x.cantidad).slice(0, 40)
    const nota = x.nota?.trim().slice(0, 200) || null
    const hay = db.prepare(`SELECT * FROM compras WHERE clave = ? AND estado = 'pendiente' LIMIT 1`).get(clave) as any
    if (hay) {
      db.prepare('UPDATE compras SET cantidad = COALESCE(cantidad, ?), nota = COALESCE(nota, ?) WHERE id = ?').run(cantidad, nota, hay.id)
      yaEstaban.push(deFila(db.prepare('SELECT * FROM compras WHERE id = ?').get(hay.id)))
      continue
    }
    const id = Number(db.prepare('INSERT INTO compras (item, clave, cantidad, nota, origen, mensaje_id, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(item, clave, cantidad, nota, o.origen ?? 'chat', o.mensajeId ?? null, ahora).lastInsertRowid)
    nuevos.push(deFila(db.prepare('SELECT * FROM compras WHERE id = ?').get(id)))
  }
  return { nuevos, yaEstaban }
}

export function listarCompras(db: Db, o: { estado?: Compra['estado'] | 'todas'; limite?: number } = {}): Compra[] {
  asegurar(db)
  const estado = o.estado ?? 'pendiente'
  return (estado === 'todas'
    ? db.prepare('SELECT * FROM compras ORDER BY estado = \'pendiente\' DESC, COALESCE(resuelta_en, creada_en) DESC LIMIT ?').all(o.limite ?? 300)
    : db.prepare(`SELECT * FROM compras WHERE estado = ? ORDER BY ${estado === 'pendiente' ? 'creada_en' : 'resuelta_en DESC'} LIMIT ?`).all(estado, o.limite ?? 300)).map(deFila)
}

/** Marca por id o por nombre («la leche»). Devuelve los que cambió. */
export function marcarCompras(db: Db, que: (number | string)[], estado: Compra['estado'], ahora = Date.now()): Compra[] {
  asegurar(db)
  const cambiados: Compra[] = []
  for (const q of que) {
    const fila = typeof q === 'number' || /^\d+$/.test(String(q))
      ? db.prepare('SELECT * FROM compras WHERE id = ?').get(Number(q)) as any
      : (db.prepare(`SELECT * FROM compras WHERE clave = ? ORDER BY estado = 'pendiente' DESC, id DESC LIMIT 1`).get(claveDe(String(q)))
        ?? db.prepare(`SELECT * FROM compras WHERE estado = 'pendiente' AND clave LIKE ? ORDER BY id DESC LIMIT 1`).get(`%${claveDe(String(q))}%`)) as any
    if (!fila) continue
    db.prepare('UPDATE compras SET estado = ?, resuelta_en = ? WHERE id = ?').run(estado, estado === 'pendiente' ? null : ahora, fila.id)
    cambiados.push(deFila(db.prepare('SELECT * FROM compras WHERE id = ?').get(fila.id)))
  }
  return cambiados
}

/** Los mensajes suyos que parecen una lista de compras (para recuperar las que mandó antes). */
export const PARECE_COMPRAS = /\b(compr(ar|o|as|é|a)|lista de (la )?compras?|para el s[uú]per|del s[uú]per|super(mercado)?|mercadona|carrefour|lidl|consum|hay que comprar|me falta(n)?|se acab[oó])\b/i

let extraer = async (db: Db, texto: string): Promise<{ item: string; cantidad?: string | null }[]> => {
  const { pedirJson } = await import('./modelo.ts')
  const d = (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'compras' },
    `Sacás los ítems de una lista de compras de un mensaje del operador. Solo lo que él dice que hay que comprar (no lo que ya compró, ni ideas, ni tareas que no son comprar). Si no hay nada para comprar, lista vacía. No inventes ítems.
Forma: {"items": [{"item": string (corto, como lo diría en la lista), "cantidad": string | null}]}`, texto.slice(0, 4000), { temperatura: 0.1, maxTokens: 1500 })).datos
  return Array.isArray(d?.items) ? d.items : []
}
export function _probarCompras(f: typeof extraer) { extraer = f }

/**
 * Recupera las listas que mandó antes: recorre sus mensajes (los últimos `dias`) que parecen de compras, saca los ítems
 * y los anota (los que ya estaban no se duplican). Un mensaje ya importado no se vuelve a leer.
 */
export async function importarDelHilo(db: Db, o: { dias?: number; ahora?: number; max?: number } = {}) {
  asegurar(db)
  const ahora = o.ahora ?? Date.now()
  const desde = ahora - (o.dias ?? 120) * 86_400_000
  const vistos = new Set((db.prepare('SELECT DISTINCT mensaje_id FROM compras WHERE mensaje_id IS NOT NULL').all() as { mensaje_id: number }[]).map((r) => r.mensaje_id))
  const filas = (db.prepare(`SELECT id, texto, en FROM mensajes WHERE rol = 'operador' AND texto IS NOT NULL AND en >= ? ORDER BY id DESC LIMIT 5000`).all(desde) as { id: number; texto: string; en: number }[])
    .filter((m) => !vistos.has(m.id) && PARECE_COMPRAS.test(m.texto)).slice(0, o.max ?? 60)
  let mensajes = 0, nuevos = 0
  for (const m of filas.reverse()) {
    const items = await extraer(db, m.texto).catch(() => [])
    if (!items.length) continue
    mensajes++
    nuevos += anotarCompras(db, items, { origen: 'hilo', mensajeId: m.id, ahora: m.en }).nuevos.length
  }
  return { revisados: filas.length, mensajes, nuevos }
}
