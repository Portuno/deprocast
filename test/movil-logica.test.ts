import { test } from 'node:test'
import assert from 'node:assert/strict'

// Con la ruta en una variable: Node los carga, y tsc no los mezcla con el servidor (la app no es ESM).
const deLaApp = (m: string): Promise<any> => import(`../apps/movil/src/logica/${m}.ts`)
const sincro = await deLaApp('sincro')

test('Mobile 1.0 · bloque 1: qué se reintenta y qué se descarta (un ítem roto no traba la cola)', () => {
  assert.equal(sincro.claseDe(null), 'reintentar', 'sin red')
  assert.equal(sincro.claseDe(201), 'ok')
  assert.equal(sincro.claseDe(422), 'descartar', 'un tramo sin voz')
  assert.equal(sincro.claseDe(400), 'descartar')
  assert.equal(sincro.claseDe(503), 'reintentar', 'la transcripción caída')
  assert.equal(sincro.claseDe(429), 'reintentar')
  assert.equal(sincro.claseDe(401), 'sin_sesion')
  assert.deepEqual([1, 2, 3, 6, 9].map(sincro.espera), [5_000, 10_000, 20_000, 120_000, 120_000])
})

test('Mobile 1.0 · bloque 1: una sola sincronización a la vez (dos pedidos simultáneos comparten la misma)', async () => {
  let corridas = 0
  const f = sincro.unaALaVez(async (x: number) => { corridas++; await new Promise((ok) => setTimeout(ok, 20)); return x * 2 })
  const [a, b] = await Promise.all([f(1), f(5)])
  assert.equal(corridas, 1)
  assert.deepEqual([a, b], [2, 2], 'la segunda espera la primera')
  assert.equal(await f(3), 6, 'terminada, la próxima corre de nuevo')
  assert.equal(corridas, 2)
  const g = sincro.unaALaVez(async () => { throw new Error('x') })
  await assert.rejects(g())
  await assert.rejects(g(), 'un error no la deja trabada')
})

test('Mobile 1.0 · bloque 1: lo que llega más viejo no pisa lo nuevo; las claves de envío no se repiten', () => {
  assert.equal(sincro.esMasNuevo(1000, 2000), false)
  assert.equal(sincro.esMasNuevo(2000, 1000), true)
  assert.equal(sincro.esMasNuevo(undefined, 1000), true, 'un servidor viejo sin la marca: como antes')
  const claves = new Set(Array.from({ length: 500 }, () => sincro.claveNueva()))
  assert.equal(claves.size, 500)
})

test('Mobile 1.0 · bloque 1: la sincronización es de la app (no solo de Hoy), Hoy se entera de los cambios y tiene sus estados', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync('apps/movil/App.tsx', 'utf8')
  assert.match(app, /useSincronizacion\(/)
  const hoy = fs.readFileSync('apps/movil/src/pantallas/Hoy.tsx', 'utf8')
  assert.match(hoy, /RefreshControl/, 'tirar para actualizar')
  assert.match(hoy, /alCambiar\(/, 'se redibuja cuando termina una sincronización')
  assert.match(hoy, /Cargando…[\s\S]*No pude traer Hoy[\s\S]*Todavía no hay nada hoy/, 'cargando, error y vacío')
  assert.doesNotMatch(hoy, /setInterval\(sync/, 'ya no sincroniza por su cuenta')
  const s = fs.readFileSync('apps/movil/src/sincronizar.ts', 'utf8')
  assert.match(s, /setInterval\(\(\) => \{ if \(activa\) void revisarCambio/, 'la marca cada 5 s con la app abierta')
  assert.match(fs.readFileSync('apps/movil/src/api.ts', 'utf8'), /AbortController/, 'ningún pedido se queda colgado')
})

const tramos = await deLaApp('tramos')

test('Mobile 1.0 · bloque 2: al abrir, lo que quedó grabándose (cierre forzado) y lo suelto vuelve a la cola; lo casi vacío se borra; lo que ya está en la cola no se toca', () => {
  const B = tramos.BYTES_POR_SEGUNDO
  const enCurso = [
    { id: 'a', uri: 'file:///doc/tramos/a.wav', inicio: 1_000_000, meta: { modo: 'dictado', caminando: true } },
    { id: 'b', uri: 'file:///doc/tramos/b.wav', inicio: 2_000_000, meta: { modo: 'dictado', caminando: false } },
    { id: 'c', uri: 'file:///doc/tramos/c.wav', inicio: 3_000_000, meta: { modo: 'pasivo', caminando: false, conv: true } },
  ]
  const archivos = [
    { uri: 'file:///doc/tramos/a.wav', bytes: 44 + 12 * B, modificado: null }, // 12 s grabados antes del cierre
    { uri: 'file:///doc/tramos/b.wav', bytes: 44 + 100, modificado: null }, // casi nada
    { uri: 'file:///doc/tramos/c.wav', bytes: 44 + 3 * B, modificado: null },
    { uri: 'file:///doc/tramos/suelto.wav', bytes: 44 + 5 * B, modificado: 9_000_000 },
    { uri: 'file:///doc/tramos/encola.wav', bytes: 44 + 5 * B, modificado: 9_000_000 },
  ]
  const d = tramos.recuperar(enCurso, archivos, new Set(['file:///doc/tramos/encola.wav']), 10_000_000)
  const por = Object.fromEntries(d.map((x: any) => [x.uri.split('/').pop(), x]))
  assert.deepEqual(por['a.wav'].meta, { id: 'a', modo: 'dictado', inicio: 1_000_000, fin: 1_012_000, caminando: true, recuperado: true })
  assert.equal(por['b.wav'].accion, 'borrar')
  assert.equal(por['c.wav'].meta!.modo, 'conversacion')
  assert.deepEqual(por['suelto.wav'].meta, { id: 'suelto', modo: 'pasivo', inicio: 8_995_000, fin: 9_000_000, caminando: false, recuperado: true })
  assert.equal(por['encola.wav'], undefined, 'ya estaba en la cola')
})

test('Mobile 1.0 · bloque 2: un tramo se cierra al dejar de hablar, al cambiar de app o al minuto (lo que pase primero; nunca más de 5 min)', () => {
  const t = { inicio: 0, ultimaVoz: 10_000, conv: false }
  assert.equal(tramos.debeCerrar(t, 10_500, 1500, false), null)
  assert.equal(tramos.debeCerrar(t, 12_000, 1500, false), 'silencio')
  assert.equal(tramos.debeCerrar(t, 10_500, 1500, true), 'app')
  assert.equal(tramos.debeCerrar({ ...t, ultimaVoz: 61_000 }, 61_000, 1500, false), 'maximo')
  assert.equal(tramos.debeCerrar({ inicio: 0, ultimaVoz: 21_000, conv: true }, 21_000, 800, false), 'maximo', 'en conversación, por turnos de 20 s')
  assert.ok(tramos.MAX_TRAMO_MS <= 5 * 60_000)
})

test('Mobile 1.0 · bloque 2: los tramos van a la carpeta de documentos, anotados en curso antes de grabar, a la cola en disco y con su clave', async () => {
  const fs = await import('node:fs')
  const e = fs.readFileSync('apps/movil/src/escucha.ts', 'utf8')
  assert.match(e, /anotarTramo\(id, uri, t, meta\)\.then\(\(\) => stream\.startFileRecordingAsync\(\{ format: 'wav', uri \}\)\)/, 'primero anotado, después a grabar, a su archivo')
  assert.match(e, /AppState\.addEventListener\('change'[\s\S]*cerrarTramo\(\)/, 'al cambiar de app se cierra')
  assert.doesNotMatch(e, /subirVoz\(/, 'nada se sube directo: primero a disco')
  assert.match(fs.readFileSync('apps/movil/src/tramos.ts', 'utf8'), /new Directory\(Paths\.document, 'tramos'\)/, 'no en la caché (el sistema la borra)')
  assert.match(fs.readFileSync('apps/movil/src/api.ts', 'utf8'), /\.\.\.\(m\.id \? \{ id: m\.id \} : \{\}\)/, 'la clave del tramo viaja al servidor')
  assert.match(fs.readFileSync('apps/movil/App.tsx', 'utf8'), /recuperarTramos\(\)/)
})

const captura = await deLaApp('captura')

test('Mobile 1.0 · bloque 4: un interruptor por función y uno que apaga todo; el audio espera sin red o con la batería baja', () => {
  const a = captura.leerAjustes(null)
  assert.deepEqual(a, { todo: true, audio: true, ubicacion: true, soloParadas: false, pasos: true })
  assert.equal(captura.capta({ ...a, ubicacion: false }, 'ubicacion'), false)
  assert.equal(captura.capta({ ...a, todo: false }, 'audio'), false, 'el general manda')
  assert.deepEqual(captura.leerAjustes('{roto'), a, 'un ajuste roto vuelve a los iniciales')
  assert.equal(captura.puedeSubirAudio({ nivel: 0.8, cargando: false, conectado: true }), true)
  assert.equal(captura.puedeSubirAudio({ nivel: 0.8, cargando: false, conectado: false }), false, 'sin red, espera en disco')
  assert.equal(captura.puedeSubirAudio({ nivel: 0.1, cargando: false, conectado: true }), false, 'batería baja: espera')
  assert.equal(captura.puedeSubirAudio({ nivel: 0.1, cargando: true, conectado: true }), true, 'cargando, sí')
  assert.equal(captura.puedeSubirAudio({ nivel: null, cargando: false, conectado: null }), true, 'sin datos: como antes')
})

test('Mobile 1.0 · bloque 4: la ubicación se adapta (quieto casi no marca; en movimiento cada 30 s) y «solo paradas» da el centro de donde te quedaste 5 min', () => {
  assert.deepEqual(captura.parametrosUbicacion(true), { timeInterval: 30_000, distanceInterval: 20 })
  assert.deepEqual(captura.parametrosUbicacion(false), { timeInterval: 600_000, distanceInterval: 100 })
  const p = captura.crearParadas()
  const base = { lat: 39.4699, lon: -0.3763 }
  assert.equal(p.sumar({ ...base, t: 0 }), null)
  assert.equal(p.sumar({ lat: base.lat + 0.0002, lon: base.lon, t: 2 * 60_000 }), null, 'todavía no son 5 minutos')
  const parada = p.sumar({ lat: base.lat + 0.0001, lon: base.lon + 0.0001, t: 6 * 60_000 })
  assert.ok(parada && captura.distancia(parada, base) < 30 && parada.desde === 0)
  assert.equal(p.sumar({ lat: base.lat + 0.01, lon: base.lon, t: 7 * 60_000 }), null, 'se fue: ya no es parada')
  assert.ok(Math.abs(captura.distancia({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111_195) < 50)
})

test('Mobile 1.0 · bloque 4: solo por conexión cifrada (https), salvo un servidor de tu red', () => {
  assert.equal(captura.servidorSeguro('mi-deprocast.apps.nan.builders/'), 'https://mi-deprocast.apps.nan.builders')
  assert.equal(captura.servidorSeguro('http://mi-deprocast.apps.nan.builders'), 'https://mi-deprocast.apps.nan.builders', 'http hacia afuera se pasa a https')
  assert.equal(captura.servidorSeguro('http://192.168.1.20:7272'), 'http://192.168.1.20:7272', 'tu compu en tu red')
  assert.equal(captura.servidorSeguro('https://x.y'), 'https://x.y')
})

test('Mobile 1.0 · bloque 4: no capta contactos; pasos con su permiso; la pantalla de captura dice qué capta, para qué y qué no', async () => {
  const fs = await import('node:fs')
  const app = JSON.parse(fs.readFileSync('apps/movil/app.json', 'utf8')).expo
  assert.ok(app.android.permissions.includes('android.permission.ACTIVITY_RECOGNITION'))
  assert.ok(app.android.blockedPermissions.includes('android.permission.READ_CONTACTS'))
  assert.ok(!JSON.stringify(app.plugins).includes('expo-contacts'))
  assert.ok(!fs.readFileSync('apps/movil/package.json', 'utf8').includes('expo-contacts'))
  assert.doesNotMatch(fs.readFileSync('apps/movil/src/pantallas/Rescate.tsx', 'utf8'), /expo-contacts/)
  const pantalla = fs.readFileSync('apps/movil/src/pantallas/Captura.tsx', 'utf8')
  assert.match(pantalla, /Lo que NO capta[\s\S]*El teclado, tus contactos, el contenido de otras apps ni capturas de pantalla/)
  assert.match(pantalla, /Un toque apaga todo/)
  for (const f of ['Micrófono', 'Ubicación', 'Pasos']) assert.match(pantalla, new RegExp(`titulo: '${f}', capta: '[^']+', para: '[^']+', permiso: '[^']+'`))
  const e = fs.readFileSync('apps/movil/src/escucha.ts', 'utf8')
  assert.match(e, /if \(!capta\(aj, 'audio'\)\) return setError/, 'la escucha respeta el interruptor')
  assert.match(e, /Pedometer\.watchStepCount/)
})
