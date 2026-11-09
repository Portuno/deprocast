/**
 * Tus dispositivos (plan v33, paso 1): la base para la app nativa de Deprocast (y para lo que venga, Morpheon incluido).
 * - Vincular: en la pantalla pedís un código de 6 dígitos (vale 10 minutos, 5 intentos); el teléfono lo manda con su
 *   nombre y recibe su propio token (`dpd_…`, se ve una vez; acá queda su hash). Se revoca desde la pantalla.
 * - Voz: el teléfono manda segmentos de TU voz (ya separados del ruido en el teléfono) con su modo:
 *   «dictado» (lo acercaste para hablarle) → va al chat de Hoy como si lo escribieras;
 *   «pasivo» (ibas pensando en voz alta) → queda como nota de voz tuya en el archivo.
 *   El audio se transcribe y se descarta: nunca se guarda.
 * - Sincronizar: lo mínimo para que la app abra al instante (el chat de Hoy y lo que espera tu ok).
 */
import crypto from 'node:crypto'
import type { Db } from './db.ts'

export type Dispositivo = { id: number; nombre: string; plataforma: string; prefijo: string; creadoEn: number; ultimaVez: number | null; revocadoEn: number | null }
export type ModoVoz = 'dictado' | 'pasivo' | 'conversacion'
export type MetaVoz = { modo: ModoVoz; inicio?: number; fin?: number; proximidad?: boolean; ruidoDb?: number; caminando?: boolean }

const CODIGO_MS = 10 * 60_000
const INTENTOS = 5
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
const deFila = (r: any): Dispositivo => ({ id: r.id, nombre: r.nombre, plataforma: r.plataforma, prefijo: r.prefijo, creadoEn: r.creado_en, ultimaVez: r.ultima_vez, revocadoEn: r.revocado_en })

let transcribir = async (db: Db, audio: Buffer, nombre: string) => (await import('./nan.ts')).nanTranscribir(db, audio, nombre)
export function _probarDispositivos(o: { transcribir?: typeof transcribir }) { if (o.transcribir) transcribir = o.transcribir }

export const listarDispositivos = (db: Db): Dispositivo[] => (db.prepare('SELECT * FROM dispositivos ORDER BY revocado_en IS NOT NULL, id DESC').all() as any[]).map(deFila)

/** Un código nuevo para vincular (los anteriores sin usar dejan de valer). */
export function crearCodigo(db: Db, ahora = Date.now()): { codigo: string; vence: number } {
  db.prepare('DELETE FROM dispositivo_codigos WHERE usado_en IS NULL').run()
  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  db.prepare('INSERT INTO dispositivo_codigos (codigo, creado_en, intentos) VALUES (?, ?, 0)').run(codigo, ahora)
  return { codigo, vence: ahora + CODIGO_MS }
}

/** El teléfono manda el código: si vale, nace el dispositivo y su token (que vuelve solo esta vez). */
export function vincular(db: Db, p: { codigo: string; nombre?: string; plataforma?: string }, ahora = Date.now()): { dispositivo: Dispositivo; token: string } {
  const vivo = db.prepare('SELECT * FROM dispositivo_codigos WHERE usado_en IS NULL ORDER BY creado_en DESC LIMIT 1').get() as { codigo: string; creado_en: number; intentos: number } | undefined
  if (!vivo || ahora - vivo.creado_en > CODIGO_MS || vivo.intentos >= INTENTOS) throw new Error('No hay un código vigente: pedí uno nuevo en Deprocast (Hoy → ⚙ → Dispositivos)')
  const dado = String(p.codigo ?? '').replace(/\D/g, '')
  const a = Buffer.from(dado.padEnd(6, 'x')), b = Buffer.from(vivo.codigo)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    db.prepare('UPDATE dispositivo_codigos SET intentos = intentos + 1 WHERE codigo = ?').run(vivo.codigo)
    throw new Error('Ese código no es')
  }
  db.prepare('UPDATE dispositivo_codigos SET usado_en = ? WHERE codigo = ?').run(ahora, vivo.codigo)
  const token = `dpd_${crypto.randomBytes(32).toString('base64url')}`
  const nombre = String(p.nombre ?? '').trim().slice(0, 60) || 'Mi teléfono'
  const plataforma = /^(ios|android|web)$/.test(String(p.plataforma)) ? String(p.plataforma) : 'otro'
  const id = Number(db.prepare('INSERT INTO dispositivos (nombre, plataforma, prefijo, token_hash, creado_en) VALUES (?, ?, ?, ?, ?)').run(nombre, plataforma, token.slice(0, 10), hash(token), ahora).lastInsertRowid)
  return { dispositivo: deFila(db.prepare('SELECT * FROM dispositivos WHERE id = ?').get(id)), token }
}

export function revocarDispositivo(db: Db, id: number, ahora = Date.now()) {
  if (!db.prepare('UPDATE dispositivos SET revocado_en = ? WHERE id = ? AND revocado_en IS NULL').run(ahora, id).changes) throw new Error('Ese dispositivo no existe o ya estaba revocado')
}

/** El dispositivo del pedido (Authorization: Bearer dpd_…), o null. */
export function autenticarDispositivo(db: Db, autorizacion: string | undefined, ahora = Date.now()): Dispositivo | null {
  const m = /^Bearer\s+(dpd_[A-Za-z0-9_-]{20,100})\s*$/.exec(String(autorizacion ?? ''))
  if (!m) return null
  const h = Buffer.from(hash(m[1]), 'hex')
  const fila = (db.prepare('SELECT * FROM dispositivos WHERE prefijo = ? AND revocado_en IS NULL').all(m[1].slice(0, 10)) as any[])
    .find((f) => { const x = Buffer.from(String(f.token_hash), 'hex'); return x.length === h.length && crypto.timingSafeEqual(x, h) })
  if (!fila) return null
  db.prepare('UPDATE dispositivos SET ultima_vez = ? WHERE id = ?').run(ahora, fila.id)
  return deFila(fila)
}

/**
 * Un segmento de voz: se transcribe (el audio no se guarda) y va a donde corresponde según el modo. Devuelve el texto y
 * a dónde fue.
 */
export async function recibirVoz(db: Db, d: Dispositivo, audio: Buffer, nombre: string, meta: MetaVoz, ahora = Date.now()): Promise<{ texto: string; destino: 'chat' | 'nota' | 'conversacion'; piezaId?: number; hablante?: import('./hablantes.ts').Hablante | null }> {
  if (!audio.length) throw new Error('El audio vino vacío')
  const texto = (await transcribir(db, audio, nombre || 'voz.m4a')).trim()
  if (!texto) throw new Error('El audio no tenía voz que transcribir')
  if (meta.modo !== 'conversacion') void import('./google/drive.ts').then((d) => d.alDrive(db, { datos: audio, nombre: nombre || 'voz.m4a', tipo: 'audio', origen: 'teléfono', descripcion: texto })).catch(() => {})
  const datos = JSON.stringify({ ...meta, dispositivo: d.nombre })
  // Quién habló: la huella de la voz (si el audio es un WAV que se entiende) contra los hablantes conocidos.
  const { huellaDe, leerWav } = await import('./conciencia/huella.ts')
  const voces = await import('./hablantes.ts')
  const wav = leerWav(new Uint8Array(audio))
  // La huella sale de 15 s del medio: alcanza para reconocer la voz, y sobre el audio entero trababa el servidor
  // segundos (Fragua #134: «bloqueo de 5545 ms (POST /api/dispositivo/voz)»).
  const tramo = wav ? Math.min(wav.muestras.length, wav.sr * 15) : 0
  const desde = wav ? Math.max(0, Math.floor((wav.muestras.length - tramo) / 2)) : 0
  const huella = wav ? huellaDe(wav.muestras.subarray(desde, desde + tramo), wav.sr) : null
  const quien = huella ? voces.identificar(db, huella, ahora) : null
  voces.anotarTurno(db, { dispositivoId: d.id, hablanteId: quien?.hablante.id ?? null, texto, inicio: meta.inicio ?? ahora, fin: meta.fin, modo: meta.modo }, ahora)
  if (meta.modo === 'conversacion') {
    db.prepare('INSERT INTO voz_segmentos (dispositivo_id, modo, texto, meta, destino, creado_en) VALUES (?, ?, ?, ?, ?, ?)').run(d.id, meta.modo, texto, datos, 'conversacion', ahora)
    return { texto, destino: 'conversacion', hablante: quien?.hablante ?? null }
  }
  if (meta.modo === 'dictado') {
    const { conversacionHoy, enviar } = await import('./chat/index.ts')
    void enviar(db, conversacionHoy(db).id, texto).catch((e) => console.error('  voz → chat:', e instanceof Error ? e.message : e))
    db.prepare('INSERT INTO voz_segmentos (dispositivo_id, modo, texto, meta, destino, creado_en) VALUES (?, ?, ?, ?, ?, ?)').run(d.id, meta.modo, texto, datos, 'chat', ahora)
    return { texto, destino: 'chat' }
  }
  // Lo que nombra en una nota de voz también puede ir a su Librería (Fragua #181).
  void import('./obras-menciones.ts').then((o) => o.detectarObras(db, texto, 'nota de voz')).catch(() => {})
  const { ingerir } = await import('./mastropiero.ts')
  const cuando = new Date(meta.inicio ?? ahora)
  const titulo = `Voz · ${cuando.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${meta.caminando ? ' · caminando' : ''}`
  const { corpusId } = ingerir(db, { fuente: 'operador', titulo, contenido: texto, dominio: 'voz', origenId: `voz:${d.id}:${meta.inicio ?? ahora}`, meta: { voz: { ...meta, dispositivo: d.nombre } } }, ahora)
  db.prepare('INSERT INTO voz_segmentos (dispositivo_id, modo, texto, meta, destino, pieza_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(d.id, meta.modo, texto, datos, 'nota', corpusId, ahora)
  return { texto, destino: 'nota', piezaId: corpusId }
}

/** Lo mínimo para que la app abra al instante: el chat de Hoy (lo último) y cuántas cosas esperan tu ok. */
export async function paqueteHoy(db: Db, o: { mensajes?: number } = {}) {
  const { conversacionHoy, ultimosMensajes } = await import('./chat/index.ts')
  const c = conversacionHoy(db)
  const { bandeja } = await import('./sombra.ts')
  const ms = ultimosMensajes(db, c.id, o.mensajes ?? 30).mensajes
  return { conversacion: c.id, mensajes: ms.filter((m) => (m.rol === 'operador' || m.rol === 'asistente') && m.texto).map((m) => ({ id: m.id, rol: m.rol, texto: m.texto, en: m.en })), paraValidar: bandeja(db).total }
}
