/**
 * Bitácora íntima: su diario. Vive aparte del corpus: no se busca, no entra a los prompts ni a la liga, y ningún
 * modelo la lee, salvo las entradas que él marca «compartir con Mastropiero». Puede cifrar una entrada con una clave
 * suya (AES-256-GCM, clave derivada con scrypt): la clave no se guarda en ningún lado; sin ella, ni el respaldo ni
 * quien abra la base puede leerla. Si la olvida, esa entrada se pierde.
 */
import crypto from 'node:crypto'
import { fechaLocal, type Db } from './db.ts'

export type Entrada = {
  id: number
  fecha: string
  texto: string | null // null si está cifrada y no se abrió
  cifrada: boolean
  compartida: boolean
  animo: number | null
  creadaEn: number
}

/** Preguntas para cuando no sabe por dónde empezar (fijas, sin modelo: rotan por día). */
export const DISPARADORES = [
  '¿Qué te sacó energía hoy y qué te la dio?',
  '¿Qué hiciste hoy que el vos de hace un año no habría hecho?',
  '¿Qué estás evitando? ¿Por qué?',
  '¿Con quién te gustaría haber hablado hoy?',
  '¿Qué decisión estás postergando?',
  'Si mañana fuera perfecto, ¿cómo sería la primera hora?',
  '¿Qué aprendiste hoy de vos?',
  '¿De qué estás orgulloso esta semana?',
  '¿Qué te preocupa que no le dijiste a nadie?',
  '¿Qué soltarías si nadie te mirara?',
  '¿Qué parte del día te gustaría repetir?',
  '¿Qué te está pidiendo el cuerpo?',
]
export const disparadorDe = (fecha = fechaLocal()) => DISPARADORES[Math.floor(Date.parse(`${fecha}T12:00:00`) / 86_400_000) % DISPARADORES.length]

const llave = (clave: string, sal: Buffer) => crypto.scryptSync(clave, sal, 32, { N: 16384, r: 8, p: 1 })

export function cifrar(texto: string, clave: string): string {
  const sal = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', llave(clave, sal), iv)
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return ['v1', sal.toString('base64'), iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':')
}

export function descifrar(sobre: string, clave: string): string {
  const [v, sal, iv, tag, datos] = sobre.split(':')
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido')
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', llave(clave, Buffer.from(sal, 'base64')), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8')
  } catch {
    throw new Error('Clave incorrecta')
  }
}

const deFila = (r: any, clave?: string | null): Entrada => {
  let texto: string | null = r.cifrada ? null : r.texto
  if (r.cifrada && clave) { try { texto = descifrar(r.texto, clave) } catch { texto = null } }
  return { id: r.id, fecha: r.fecha, texto, cifrada: !!r.cifrada, compartida: !!r.compartida, animo: r.animo, creadaEn: r.creada_en }
}

export function escribir(db: Db, e: { texto: string; fecha?: string; animo?: number | null; clave?: string | null; compartida?: boolean }, ahora = Date.now()): Entrada {
  const texto = String(e.texto ?? '').trim()
  if (!texto) throw new Error('La entrada está vacía')
  if (e.clave && e.compartida) throw new Error('Una entrada cifrada no se puede compartir (Mastropiero no tiene tu clave)')
  if (e.clave && e.clave.length < 6) throw new Error('La clave tiene que tener 6 caracteres o más')
  const animo = e.animo == null || (e.animo as any) === '' ? null : Math.max(1, Math.min(5, Math.round(Number(e.animo))))
  const fecha = e.fecha && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha) ? e.fecha : fechaLocal(ahora)
  const r = db.prepare('INSERT INTO bitacora (fecha, texto, cifrada, compartida, animo, creada_en, editada_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(fecha, e.clave ? cifrar(texto, e.clave) : texto, e.clave ? 1 : 0, e.compartida ? 1 : 0, animo, ahora, ahora)
  return deFila(db.prepare('SELECT * FROM bitacora WHERE id = ?').get(Number(r.lastInsertRowid)), e.clave)
}

/** Para su pantalla: las cifradas vienen sin texto, salvo que mande la clave (se usa y se olvida). */
export function leerBitacora(db: Db, o: { limite?: number; clave?: string | null } = {}): Entrada[] {
  return db.prepare('SELECT * FROM bitacora ORDER BY fecha DESC, id DESC LIMIT ?').all(o.limite ?? 60).map((r) => deFila(r, o.clave))
}

export function cambiarEntrada(db: Db, id: number, c: { compartida?: boolean; borrar?: boolean; texto?: string; animo?: number | null }, ahora = Date.now()) {
  const r = db.prepare('SELECT * FROM bitacora WHERE id = ?').get(id) as any
  if (!r) throw new Error(`No existe la entrada ${id}`)
  if (c.borrar) return void db.prepare('DELETE FROM bitacora WHERE id = ?').run(id)
  if (c.compartida !== undefined) {
    if (c.compartida && r.cifrada) throw new Error('Una entrada cifrada no se puede compartir')
    db.prepare('UPDATE bitacora SET compartida = ?, editada_en = ? WHERE id = ?').run(c.compartida ? 1 : 0, ahora, id)
  }
  if (c.texto !== undefined && !r.cifrada && c.texto.trim()) db.prepare('UPDATE bitacora SET texto = ?, editada_en = ? WHERE id = ?').run(c.texto.trim(), ahora, id)
  if (c.animo !== undefined) db.prepare('UPDATE bitacora SET animo = ?, editada_en = ? WHERE id = ?').run(c.animo == null ? null : Math.max(1, Math.min(5, Math.round(Number(c.animo)))), ahora, id)
}

/** Lo único que Mastropiero ve: las que él compartió (texto y ánimo). */
export function compartidas(db: Db, limite = 10): Entrada[] {
  return db.prepare('SELECT * FROM bitacora WHERE compartida = 1 AND cifrada = 0 ORDER BY fecha DESC, id DESC LIMIT ?').all(limite).map((r) => deFila(r))
}
