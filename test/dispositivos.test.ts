import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const d = await import('../src/dispositivos.ts')
const { crearConciencia, destinoDe } = await import('../src/conciencia/acustica.ts')

const T = new Date(2026, 10, 4, 9).getTime()

test('Vincular un teléfono: código de 6 dígitos (10 min, 5 intentos), token una vez, autenticar y revocar', () => {
  const db = abrir(':memory:')
  assert.throws(() => d.vincular(db, { codigo: '123456' }, T), /No hay un código vigente/)
  const { codigo } = d.crearCodigo(db, T)
  assert.match(codigo, /^\d{6}$/)
  const malo = codigo === '000000' ? '000001' : '000000'
  assert.throws(() => d.vincular(db, { codigo: malo }, T), /no es/)
  const r = d.vincular(db, { codigo, nombre: 'Mi Pixel', plataforma: 'android' }, T + 1000)
  assert.match(r.token, /^dpd_/)
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM dispositivos').all()).includes(r.token), 'el token no queda guardado')
  assert.throws(() => d.vincular(db, { codigo }, T + 2000), /No hay un código vigente/, 'un código sirve una sola vez')
  assert.equal(d.autenticarDispositivo(db, `Bearer ${r.token}`)!.nombre, 'Mi Pixel')
  assert.equal(d.autenticarDispositivo(db, 'Bearer dpd_falsofalsofalsofalsofalso'), null)
  d.revocarDispositivo(db, r.dispositivo.id)
  assert.equal(d.autenticarDispositivo(db, `Bearer ${r.token}`), null, 'revocado no entra')
  // Vencido y por intentos.
  const v = d.crearCodigo(db, T)
  assert.throws(() => d.vincular(db, { codigo: v.codigo }, T + 11 * 60_000), /No hay un código vigente/)
  const x = d.crearCodigo(db, T)
  const otro = x.codigo === '999999' ? '999998' : '999999'
  for (let i = 0; i < 5; i++) assert.throws(() => d.vincular(db, { codigo: otro }, T))
  assert.throws(() => d.vincular(db, { codigo: x.codigo }, T), /No hay un código vigente/, 'con 5 intentos fallidos, el código se quema')
})

test('La voz: el audio se transcribe y se descarta; dictado va al chat de Hoy, pasivo queda como nota de voz', async () => {
  const db = abrir(':memory:')
  const pedidos: number[] = []
  d._probarDispositivos({ transcribir: async (_db, audio) => { pedidos.push(audio.length); return audio.length > 3 ? 'Recordame llamar a la imprenta mañana' : '' } })
  const { codigo } = d.crearCodigo(db, T)
  const { dispositivo } = d.vincular(db, { codigo, nombre: 'Teléfono' }, T)
  const nota = await d.recibirVoz(db, dispositivo, Buffer.from('audio pasivo'), 'a.m4a', { modo: 'pasivo', inicio: T, caminando: true }, T)
  assert.equal(nota.destino, 'nota')
  const pieza = db.prepare('SELECT titulo, contenido FROM corpus WHERE id = ?').get(nota.piezaId!) as any
  assert.match(pieza.titulo, /^Voz · .*caminando$/)
  assert.equal(pieza.contenido, 'Recordame llamar a la imprenta mañana')
  await assert.rejects(d.recibirVoz(db, dispositivo, Buffer.from('ab'), 'b.m4a', { modo: 'dictado' }, T), /no tenía voz/)
  const segs = db.prepare('SELECT modo, destino, texto FROM voz_segmentos').all() as any[]
  assert.deepEqual(segs.map((s) => [s.modo, s.destino]), [['pasivo', 'nota']])
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM voz_segmentos').all()).includes('audio pasivo'), 'el audio no se guarda en ningún lado')
})

test('Conciencia acústica: aprende el piso de ruido; voz directa y cerca = dictado; lejos = escucha; caminando callado = silencio intencional', () => {
  const c = crearConciencia()
  let t = 0
  const correr = (ms: number, x: { db: number; voz: number; cerca?: boolean | null; caminando?: boolean }) => { let l: any; for (let i = 0; i < ms / 100; i++) { t += 100; l = c.cuadro({ t, ...x }) } return l }
  // Calle: ruido de fondo a -45 dB, sin voz.
  let l = correr(3000, { db: -45, voz: 0.1 })
  assert.equal(l.estado, 'ruido')
  assert.ok(Math.abs(l.piso - -45) < 3, 'aprendió el piso')
  // Lo acercás y le hablás (sensor de proximidad).
  l = correr(1000, { db: -20, voz: 0.95, cerca: true })
  assert.equal(l.estado, 'dictado')
  assert.equal(l.distancia, 'cerca')
  // Una pausa corta al hablar no corta el dictado.
  l = correr(600, { db: -45, voz: 0.1, cerca: true })
  assert.equal(l.estado, 'dictado')
  // Lo bajás y seguís pensando en voz alta, lejos.
  l = correr(2000, { db: -34, voz: 0.9, cerca: false })
  assert.equal(l.estado, 'escucha')
  assert.equal(destinoDe(l.estado), 'pasivo')
  // Caminás callado: después de unos segundos, silencio intencional (no se manda nada).
  l = correr(8000, { db: -45, voz: 0.05, caminando: true })
  assert.equal(l.estado, 'silencio_intencional')
  assert.equal(destinoDe(l.estado), null)
  // Una voz de fondo (otra persona, lejos y floja) no es tuya: ruido.
  const c2 = crearConciencia()
  t = 0
  for (let i = 0; i < 30; i++) { t += 100; c2.cuadro({ t, db: -45, voz: 0.1 }) }
  for (let i = 0; i < 20; i++) { t += 100; l = c2.cuadro({ t, db: -41, voz: 0.8 }) }
  assert.equal(l.fuente, 'ruido')
  assert.equal(l.estado, 'ruido')
})
