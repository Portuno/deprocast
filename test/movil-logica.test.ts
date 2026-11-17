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
  assert.deepEqual(a, { todo: true, audio: true, ubicacion: true, soloParadas: false, pasos: true, uso: true, pagos: true, avisos: true })
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

test('Mobile 1.0.1: «solo las paradas» sube los puntos de una parada, descarta el recorrido en movimiento y deja esperar lo que todavía puede ser parada', () => {
  const MIN = 60_000, base = { lat: 39.4699, lon: -0.3763 }
  const puntos = [
    ...Array.from({ length: 7 }, (_, i) => ({ en: i * MIN, ...base })), // 6 min quieto: parada
    ...Array.from({ length: 4 }, (_, i) => ({ en: (7 + i) * MIN, lat: base.lat + (i + 1) * 0.003, lon: base.lon })), // caminando
    ...Array.from({ length: 3 }, (_, i) => ({ en: (11 + i) * MIN, lat: base.lat + 0.02, lon: base.lon })), // recién llega: puede ser parada
  ]
  const r = captura.separarParadas(puntos, 13 * MIN)
  assert.equal(r.subir.length, 7)
  assert.equal(r.descartar.length, 4, 'el recorrido en movimiento no se sube')
  assert.equal(r.esperar.length, 3)
})

test('Mobile 1.0.1: el teclado ya no tapa lo que escribís; la ubicación va aparte de la escucha (pestaña Mapa, en segundo plano); la escucha dice qué hace sin saltar', async () => {
  const fs = await import('node:fs')
  const hoy = fs.readFileSync('apps/movil/src/pantallas/Hoy.tsx', 'utf8')
  assert.match(hoy, /useAltoTeclado\(\)[\s\S]*paddingBottom: teclado \? Math\.max\(0, teclado - bordes\.bottom\)/)
  assert.doesNotMatch(hoy, /KeyboardAvoidingView/)
  const e = fs.readFileSync('apps/movil/src/escucha.ts', 'utf8')
  assert.doesNotMatch(e, /expo-location|watchPositionAsync/, 'la escucha ya no maneja el GPS')
  assert.match(e, /ultimoPunto\(\)/, 'toma el último punto del recorrido')
  assert.match(fs.readFileSync('apps/movil/index.ts', 'utf8'), /import '\.\/src\/recorrido'/, 'la tarea de fondo se define al arrancar')
  const r = fs.readFileSync('apps/movil/src/recorrido.ts', 'utf8')
  assert.match(r, /TaskManager\.defineTask\(TAREA/)
  assert.match(r, /foregroundService: \{ notificationTitle: 'Deprocast anota tu recorrido'/)
  assert.match(fs.readFileSync('apps/movil/App.tsx', 'utf8'), /\['hoy', 'escucha', 'mapa'\]/)
  const app = JSON.parse(fs.readFileSync('apps/movil/app.json', 'utf8')).expo
  const loc = app.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-location')[1]
  assert.equal(loc.isAndroidBackgroundLocationEnabled, true)
  const pantalla = fs.readFileSync('apps/movil/src/pantallas/Escucha.tsx', 'utf8')
  assert.match(pantalla, /Grabando \$\{/, 'dice que está grabando y cuánto')
  assert.match(pantalla, /detalles \? '▾ Detalles' : '▸ Detalles'/, 'lo técnico, plegado')
  assert.match(pantalla, /numberOfLines=\{1\}>\s*\{l \?/, 'los datos técnicos en una línea fija')
})

test('Mobile 1.1 · el vigía: un hueco de más de 5 s es un corte; al volver dice si siguió, con cortes, o si sigue cortada', async () => {
  const v = await deLaApp('vigia')
  const T = Date.UTC(2026, 10, 16, 15, 0)
  assert.equal(v.corteEntre(null, T), null)
  assert.equal(v.corteEntre(T, T + 4000), null)
  assert.deepEqual(v.corteEntre(T, T + 60_000), { desde: T, hasta: T + 60_000 })
  // Un vistazo a otra app no merece aviso.
  assert.equal(v.resumenRetorno({ fueraDesde: T, vuelta: T + 10_000, ultimoCuadro: T + 9_900, cortes: [] }), null)
  // Siguió los 20 minutos.
  const siguio = v.resumenRetorno({ fueraDesde: T, vuelta: T + 20 * 60_000, ultimoCuadro: T + 20 * 60_000 - 100, cortes: [] })
  assert.equal(siguio.siguio, true)
  assert.match(siguio.texto, /Siguió escuchando los 20 min/)
  // Con un corte en el medio.
  const corte = v.resumenRetorno({ fueraDesde: T, vuelta: T + 30 * 60_000, ultimoCuadro: T + 30 * 60_000 - 100, cortes: [{ desde: T + 5 * 60_000, hasta: T + 12 * 60_000 }] })
  assert.equal(corte.siguio, false)
  assert.match(corte.texto, /con un corte: \d\d:\d\d–\d\d:\d\d \(7 min sin escuchar\)/)
  // Sigue cortada: desde el último cuadro.
  const cortada = v.resumenRetorno({ fueraDesde: T, vuelta: T + 25 * 60_000, ultimoCuadro: T + 3 * 60_000, cortes: [] })
  assert.equal(cortada.cortadaAhora, true)
  assert.match(cortada.texto, /se cortó a las \d\d:\d\d y estuvo 22 min sin escuchar/)
  // El cierre dice qué guardó y dónde.
  const s = { ...v.sesionNueva(T), dictados: 3, notas: 1, descartados: 2, cortes: [{ desde: T, hasta: T + 120_000 }] }
  assert.match(v.textoDeCierre(s, T + 40 * 60_000), /Escuchó 40 min .* Guardó 3 dictados al chat de Hoy, 1 nota de voz al corpus\. Descartó 2 ruidos sueltos\. Tuvo un corte \(2 min sin escuchar\)\./)
  assert.match(v.textoDeCierre(v.sesionNueva(T), T + 60_000), /No guardó nada: no hubo voz tuya cerca/)
})

test('Mobile 1.1 · el mapa: el trazo se simplifica sin perder las vueltas, y se corta en tramos en orden', async () => {
  const m = await deLaApp('mapa')
  // Una L: 50 puntos por una calle y 50 por la otra, con ruido de 2 m; quedan las esquinas.
  const ps = [] as { en: number; lat: number; lon: number }[]
  for (let i = 0; i < 50; i++) ps.push({ en: i, lat: 39.47 + i * 0.0001 + (i % 2 ? 0.00002 : 0), lon: -0.376 })
  for (let i = 0; i < 50; i++) ps.push({ en: 50 + i, lat: 39.47 + 49 * 0.0001, lon: -0.376 + i * 0.0001 })
  const s = m.simplificar(ps, 12)
  assert.ok(s.length <= 5, `quedan pocos puntos (${s.length})`)
  assert.deepEqual([s[0].en, s.at(-1).en], [0, 99], 'el primero y el último siempre')
  assert.ok(s.some((p: any) => p.en === 49 || p.en === 50), 'la esquina queda')
  assert.ok(Math.abs(m.metros({ lat: 39.47, lon: -0.376 }, { lat: 39.471, lon: -0.376 }) - 111) < 2, '0,001° de latitud ≈ 111 m')
  const t = m.tramosPorHora(ps, 5)
  assert.equal(t.length, 5)
  assert.deepEqual(t[0][0], ps[0])
  assert.deepEqual(t.at(-1).at(-1), ps.at(-1))
  assert.deepEqual(t[1][0], t[0].at(-1), 'los tramos se tocan (sin huecos en el trazo)')
  assert.deepEqual(m.tramosPorHora([], 5), [])
})

test('Mobile 1.1 · contestar en voz: se dice el texto, sin Markdown, links ni citas', async () => {
  const d = await deLaApp('decir')
  assert.equal(d.paraDecir('**Uno**: pensá en [esto](https://x.org) [#41, #42]\n- dos\n- tres https://y.org'), 'Uno: pensá en esto dos tres')
})

test('Mobile 1.2 · fotos y videos desde Hoy: nombre y tipo de lo elegido, y qué hacer con cada respuesta del servidor', async () => {
  const a = await deLaApp('archivos')
  const T = Date.UTC(2026, 10, 17, 10, 30)
  assert.deepEqual(a.nombreYTipo({ uri: 'file:///cache/ImagePicker/abc.jpg', mimeType: 'image/jpeg', type: 'image' }, T), { nombre: 'abc.jpg', tipo: 'image/jpeg', esVideo: false })
  assert.deepEqual(a.nombreYTipo({ uri: 'content://media/42', fileName: 'VID_2026.mp4', type: 'video' }, T), { nombre: 'VID_2026.mp4', tipo: 'video/mp4', esVideo: true })
  // La galería a veces no dice el tipo ni el nombre: se arma uno con la fecha.
  const sin = a.nombreYTipo({ uri: 'content://media/external/images/media/99', type: 'image' }, T)
  assert.equal(sin.tipo, 'image/jpeg')
  assert.match(sin.nombre, /\.jpg$/)
  assert.equal(a.nombreYTipo({ uri: 'file:///x/clip.MOV' }, T).tipo, 'video/quicktime')
  assert.equal(a.queHacer(202, 0), 'ok')
  assert.equal(a.queHacer(422, 0), 'descartar', 'no tiene arreglo (tipo, vacío)')
  assert.equal(a.queHacer(null, 0), 'reintentar', 'sin red, espera')
  assert.equal(a.queHacer(503, 2), 'reintentar')
  assert.equal(a.queHacer(503, 7), 'descartar', 'a los 8 intentos se deja')
})

const pasosL = await deLaApp('pasos')

test('Mobile 1.3 · pasos con la app cerrada: el contador del teléfono, repartido por hora; un reinicio no pierde ni duplica', () => {
  const T = (h: number, m = 0, dia = 16) => new Date(2026, 10, dia, h, m).getTime()
  const arranque = T(0, 0, 10)
  // La primera lectura solo deja la marca.
  assert.deepEqual(pasosL.contar(null, { total: 50_000, arranque, en: T(9) }), { pasos: 0, reparto: [], reinicio: false })
  // De 9:30 a 10:30: 1.000 pasos, mitad y mitad.
  const r = pasosL.contar({ total: 50_000, arranque, en: T(9, 30) }, { total: 51_000, arranque: arranque + 800, en: T(10, 30) })
  assert.equal(r.pasos, 1000)
  assert.equal(r.reinicio, false, 'la hora de arranque baila unos ms: no es un reinicio')
  assert.deepEqual(r.reparto, [{ hora: '2026-11-16T09', pasos: 500 }, { hora: '2026-11-16T10', pasos: 500 }])
  // Cruza la medianoche: cada día se queda con lo suyo, y la suma da exacto.
  const n = pasosL.contar({ total: 100, arranque, en: T(23, 50, 15) }, { total: 401, arranque, en: T(0, 20, 16) })
  assert.deepEqual(n.reparto.map((x: any) => x.hora), ['2026-11-15T23', '2026-11-16T00'])
  assert.equal(n.reparto.reduce((a: number, x: any) => a + x.pasos, 0), 301)
  // Reinicio a las 12: el total vuelve a contar desde cero; se cuentan desde el arranque.
  const z = pasosL.contar({ total: 51_000, arranque, en: T(10, 30) }, { total: 300, arranque: T(12), en: T(12, 30) })
  assert.equal(z.reinicio, true)
  assert.deepEqual(z.reparto, [{ hora: '2026-11-16T12', pasos: 300 }])
  // Un salto absurdo no se suma (queda de marca).
  assert.equal(pasosL.contar({ total: 0, arranque, en: T(8) }, { total: 90_000, arranque, en: T(9) }).pasos, 0)
  // Las 24 horas del día.
  const h = pasosL.horasDelDia('2026-11-16', [{ hora: '2026-11-16T09', pasos: 500 }, { hora: '2026-11-16T23', pasos: 7 }, { hora: '2026-11-15T09', pasos: 99 }])
  assert.equal(h.length, 24)
  assert.equal(h[9], 500)
  assert.equal(h[23], 7)
  assert.equal(h.reduce((a: number, b: number) => a + b, 0), 507)
})

const usoL = await deLaApp('uso')
const avisosL = await deLaApp('avisos')
const archivosL = await deLaApp('archivos')

test('Mobile 1.3 · uso del teléfono: se resume por día en minutos, sin el lanzador; avisos: qué se programa, qué se cancela y qué se avisa', () => {
  const [a, b] = usoL.rangoDelDia('2026-11-16', new Date(2026, 10, 16, 15).getTime())
  assert.equal(a, new Date(2026, 10, 16).getTime())
  assert.equal(b, new Date(2026, 10, 16, 15).getTime(), 'hoy: hasta ahora')
  const d = usoL.resumirUso('2026-11-16', { pantallaMs: 30 * 60_000, desbloqueos: 12, apps: [
    { paquete: 'com.instagram.android', nombre: 'Instagram', ms: 25 * 60_000, aperturas: 6 },
    { paquete: 'com.google.android.apps.nexuslauncher', nombre: 'Launcher', ms: 9 * 60_000, aperturas: 20 },
    { paquete: 'com.whatsapp', nombre: 'WhatsApp', ms: 20 * 60_000, aperturas: 9 },
    { paquete: 'com.x.chiquita', nombre: 'Chiquita', ms: 20_000, aperturas: 1 },
  ] })
  assert.deepEqual(d.apps.map((x: any) => [x.nombre, x.min]), [['Instagram', 25], ['WhatsApp', 20]])
  assert.equal(d.pantallaMin, 45, 'sin el dato de pantalla completo, al menos lo de las apps')
  assert.equal(usoL.horasYMinutos(190), '3 h 10 min')
  assert.equal(usoL.horasYMinutos(120), '2 h')

  const T = 1_000_000
  const p = avisosL.planDeAvisos(['ev:1:viejo', 'rec:3', 'otro-local'], [{ clave: 'rec:3', titulo: '', cuerpo: '', en: T + 10 }, { clave: 'ev:9:x', titulo: '', cuerpo: '', en: T - 10 }], T)
  assert.deepEqual(p.cancelar, ['ev:1:viejo'], 'lo que ya no está; lo local no se toca')
  assert.deepEqual(p.programar.map((x: any) => x.clave), ['rec:3'], 'lo que ya pasó no se programa')
  const ms = [{ id: 5, rol: 'operador', texto: 'hola' }, { id: 6, rol: 'asistente', texto: 'Uno' }, { id: 7, rol: 'asistente', texto: '**Listo**: cargué el ticket.' }]
  assert.deepEqual(avisosL.nuevosDeMastropiero(ms, null), { aviso: null, ultimo: 7 }, 'la primera vez solo marca')
  assert.deepEqual(avisosL.nuevosDeMastropiero(ms, 5), { aviso: { titulo: 'Mastropiero (2)', cuerpo: 'Listo: cargué el ticket.' }, ultimo: 7 })
  assert.equal(avisosL.nuevosDeMastropiero(ms, 7).aviso, null)
  assert.equal(avisosL.masParaValidar(null, 3), null)
  assert.equal(avisosL.masParaValidar(3, 2), null)
  assert.match(avisosL.masParaValidar(2, 3).cuerpo, /3 cosas para validar \(1 nueva\)/)
})

test('Mobile 1.3 · compartir: textos y links van juntos como mensaje (con la nota), los archivos aparte; el tipo de un audio o un PDF', () => {
  const a = archivosL.armarCompartido([
    { shareType: 'url', value: 'https://youtu.be/abc' },
    { shareType: 'text', value: 'mirá esto' },
    { shareType: 'image', value: 'content://x/1', contentUri: 'file:///cache/1.jpg', contentMimeType: 'image/jpeg', originalName: '1.jpg' },
  ], 'para el finde')
  assert.equal(a.mensaje, 'para el finde\n\nhttps://youtu.be/abc\n\nmirá esto')
  assert.deepEqual(a.archivos, [{ uri: 'file:///cache/1.jpg', nombre: '1.jpg', mime: 'image/jpeg' }])
  assert.equal(archivosL.armarCompartido([{ shareType: 'audio', contentUri: 'file:///c/PTT.opus' }], 'ojo').mensaje, null, 'solo archivos: la nota va con ellos')
  assert.equal(archivosL.armarCompartido([], 'solo nota').mensaje, 'solo nota')
  assert.deepEqual(archivosL.nombreYTipo({ uri: 'file:///c/PTT-2026.opus', type: 'file' }), { nombre: 'PTT-2026.opus', tipo: 'audio/ogg', esVideo: false })
  assert.equal(archivosL.nombreYTipo({ uri: 'file:///c/informe.pdf', mimeType: '*/*', type: 'file' }).tipo, 'application/pdf')
  assert.equal(archivosL.nombreYTipo({ uri: 'content://raro/77', type: 'file' }).tipo, 'application/octet-stream')
  assert.equal(captura.capta({ ...captura.leerAjustes(null), uso: false }, 'uso'), false)
  assert.equal(captura.avisa({ ...captura.leerAjustes(null), todo: false }), true, 'los avisos no son captura')
})

test('Fragua #298 · las sesiones de pantalla se juntan si las separa menos de un minuto', () => {
  assert.deepEqual(usoL.juntarSesiones([[100_000, 200_000], [0, 30_000], [230_000, 300_000], [500_000, 400_000]]), [[0, 30_000], [100_000, 300_000]])
  assert.deepEqual(usoL.resumirUso('2026-11-16', { pantallaMs: 0, desbloqueos: 0, apps: [] }).sesiones, [])
})

test('Fragua #300 · el icono rápido abre la app con deprocast://dictar', async () => {
  const atajo = await deLaApp('atajo')
  assert.equal(atajo.esPedidoDeDictado('deprocast://dictar'), true)
  assert.equal(atajo.esPedidoDeDictado('deprocast:///dictar?x=1'), true)
  assert.equal(atajo.esPedidoDeDictado('deprocast://expo-sharing'), false)
  assert.equal(atajo.esPedidoDeDictado(null), false)
})

test('Fragua #301 · compartir: la huella de lo compartido no depende del orden', () => {
  const a = [{ shareType: 'url', value: 'https://x.com/1' }, { shareType: 'image', value: 'content://m/2', originalName: 'f.jpg', contentMimeType: 'image/jpeg' }]
  assert.equal(archivosL.claveCompartido(a), archivosL.claveCompartido([...a].reverse()))
  assert.notEqual(archivosL.claveCompartido(a), archivosL.claveCompartido([a[0]]))
})
