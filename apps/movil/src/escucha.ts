/**
 * La escucha con conciencia (plan v33, paso 3). El micrófono en PCM (AudioStream, 16 kHz mono) se corta en cuadros de
 * 100 ms → rasgos (nivel, banda de voz, cruces por cero) → la conciencia acústica, junto con el acelerómetro (caminando,
 * levantado). La grabación de un tramo arranca apenas aparece tu voz directa (así no se pierden las primeras sílabas) y
 * se cierra cuando dejás de hablar; el modo se decide al cerrar, por lo que predominó: dictado → chat de Hoy, escucha →
 * nota de voz. Un ruido suelto se descarta.
 *
 * Mobile 1.0 (bloque 2): cada tramo se graba a su propio archivo en la carpeta de documentos y queda anotado «en curso»
 * antes de empezar (si la app se corta, al abrir se recupera); se cierra al dejar de hablar, al cambiar de app o al
 * minuto, lo que pase primero; al cerrarse entra a la cola en disco y sale con la sincronización de la app (con su clave:
 * si el teléfono reintenta, el servidor no lo duplica). Nada se sube directo: primero a disco, después a la red.
 *
 * Tu día en capas (plan v38, fase 6): cada minuto, cuánto hablaste, cuánto escuchaste, ruido y silencio, el nivel de tu
 * voz y del ambiente, los pasos y (si diste el permiso) dónde estabas. Solo números, a la cola en disco.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream, type AudioStreamBuffer } from 'expo-audio'
import { Accelerometer } from 'expo-sensors'
import { File } from 'expo-file-system'
import { crearConciencia, type Lectura } from './conciencia/acustica'
import { crearRasgos } from './conciencia/rasgos'
import { crearMovimiento } from './conciencia/movimiento'
import { type Credenciales, type MinutoCapa } from './api'
import { anotarTramo, cerrarTramoEnDisco, cuantoEnCola, guardarMinuto } from './almacen'
import { alCambiar, sincronizar } from './sincronizar'
import { archivoParaTramo } from './tramos'
import { claveNueva } from './logica/sincro'
import { debeCerrar } from './logica/tramos'
import { capta, crearParadas, parametrosUbicacion, SOSTENER_MS } from './logica/captura'
import { ajustesCaptura } from './captura'

export type Envio = { en: number; modo: string; texto: string | null; error?: string }
const CUADRO_MS = 100
const FIN_MS = 1500 // sin tu voz directa este tiempo, el tramo se cierra
const MIN_MS = 700 // menos que esto no es habla
// En conversación se corta por turnos: una pausa más corta (para saber quién dijo qué).
const FIN_CONV_MS = 800

type Acumulado = { minuto: number; hablo: number; escucho: number; ruido: number; silencio: number; voz: number; vozN: number; cerca: number; cercaN: number; piso: number; pisoN: number; pasos0: number; caminando: number }
const nuevoMinuto = (t: number, pasos: number): Acumulado => ({ minuto: Math.floor(t / 60_000) * 60_000, hablo: 0, escucho: 0, ruido: 0, silencio: 0, voz: 0, vozN: 0, cerca: 0, cercaN: 0, piso: 0, pisoN: 0, pasos0: pasos, caminando: 0 })
const prom = (s: number, n: number) => (n ? Math.round((s / n) * 10) / 10 : null)
type Tramo = { id: string; uri: string; inicio: number; ultimaVoz: number; dictado: number; escucha: number; ruido: number; voz: number; caminando: boolean; conv: boolean; grabando: Promise<unknown> }

export function useEscucha(c: Credenciales | null) {
  const [activa, setActiva] = useState(false)
  const [conversacion, setConversacion] = useState(false)
  const modoConv = useRef(false)
  useEffect(() => { modoConv.current = conversacion }, [conversacion])
  const [ultimo, setUltimo] = useState(0)
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [envios, setEnvios] = useState<Envio[]>([])
  const [enCola, setEnCola] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const estado = useRef({
    conciencia: crearConciencia(), rasgos: null as ReturnType<typeof crearRasgos> | null, mov: crearMovimiento(),
    pendiente: new Float32Array(0), sr: 16000, caminando: false as boolean | null, levantado: false,
    tramo: null as Tramo | null,
    ocupado: false,
    pasos: 0, acum: null as Acumulado | null, ubic: null as null | { lat: number; lon: number; precision: number | null; t: number },
    ubicSub: null as null | { remove: () => void },
    // Mobile 1.0, bloque 4: los pasos del sensor (si está y diste el permiso), el ritmo de la ubicación y las paradas.
    pedSub: null as null | { remove: () => void }, pasosSensor: null as number | null,
    ubicActiva: false, moviendoseUbic: false, moviendose: false, moviendoseDesde: 0, soloParadas: false, paradas: crearParadas(),
  })

  // Lo que sube la sincronización de la app (de cualquier pantalla) aparece en «lo que se dijo».
  useEffect(() => alCambiar((r) => {
    if (r.subidos.length) { setEnvios((xs) => [...r.subidos.map((s) => ({ en: Date.now(), modo: s.modo, texto: s.texto })), ...xs].slice(0, 20)); setUltimo(Date.now()) }
    void cuantoEnCola().then((n) => setEnCola(n.voces))
  }), [])

  /** Cierra el minuto en curso: a la cola en disco (sale con la próxima sincronización). */
  const cerrarMinuto = useCallback((t: number) => {
    const e = estado.current
    const a = e.acum
    e.acum = nuevoMinuto(t, e.pasos)
    if (!a) return
    const u = e.ubic && t - e.ubic.t < 15 * 60_000 ? e.ubic : null
    const seg = (n: number) => Math.min(60, Math.round(n / 10)) // cuadros de 100 ms → segundos
    const m: MinutoCapa = {
      minuto: a.minuto, hablo: seg(a.hablo), escucho: seg(a.escucho), ruido: seg(a.ruido), silencio: seg(a.silencio),
      vozDb: prom(a.voz, a.vozN), vozCercaDb: prom(a.cerca, a.cercaN), pisoDb: prom(a.piso, a.pisoN),
      pasos: Math.max(0, e.pasos - a.pasos0), caminando: seg(a.caminando), lat: u?.lat ?? null, lon: u?.lon ?? null, precision: u?.precision ?? null,
    }
    void guardarMinuto(m.minuto, m).catch(() => {})
  }, [])

  /** Cierra el tramo en curso: el archivo queda terminado y entra a la cola (o se borra, si no era habla). */
  const cerrarTramo = useCallback(async () => {
    const e = estado.current
    const tramo = e.tramo
    e.tramo = null
    if (!tramo) return
    await tramo.grabando.catch(() => {})
    try { await stream.stopFileRecordingAsync() } catch { /* no había grabación: el archivo, si existe, lo recupera el próximo arranque */ }
    const dur = tramo.ultimaVoz - tramo.inicio
    const modo = tramo.conv ? 'conversacion' as const : tramo.dictado >= tramo.escucha ? 'dictado' as const : 'pasivo' as const
    const poca = tramo.conv ? tramo.voz < 4 : tramo.dictado + tramo.escucha < 4
    if (dur < MIN_MS || poca || !c) {
      try { new File(tramo.uri).delete() } catch { /* ya no está */ }
      await cerrarTramoEnDisco(tramo.id, null)
      return
    }
    await cerrarTramoEnDisco(tramo.id, { uri: tramo.uri, meta: { id: tramo.id, modo, inicio: tramo.inicio, fin: tramo.ultimaVoz, caminando: tramo.caminando } })
    setEnCola((n) => n + 1)
    void sincronizar(c) // a disco primero; a la red, en cuanto se pueda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c])

  const alCuadro = useCallback((x: Float32Array) => {
    const e = estado.current
    if (!e.rasgos) return
    const t = Date.now()
    const r = e.rasgos.cuadro(x)
    const l = e.conciencia.cuadro({ t, db: r.db, voz: r.voz, cerca: null, caminando: e.caminando, levantado: e.levantado })
    setLectura(l)
    // La capa del minuto: qué se oyó en estos 100 ms.
    if (!e.acum || t - e.acum.minuto >= 60_000) cerrarMinuto(t)
    const a = e.acum!
    if (l.fuente === 'voz_directa') { a.hablo++; a.voz += r.db; a.vozN++; if (l.distancia === 'cerca') { a.cerca += r.db; a.cercaN++ } }
    else if (r.voz >= 0.6 && l.snr >= 3) a.escucho++
    else if (l.fuente === 'ruido') a.ruido++
    else a.silencio++
    a.piso += l.piso; a.pisoN++
    if (e.caminando) a.caminando++
    if (e.ocupado) return
    // En conversación vale cualquier voz (la tuya y la de los demás); si no, solo tu voz directa.
    const conv = modoConv.current
    const hayVoz = conv ? r.voz >= 0.6 && l.snr >= 3 : l.fuente === 'voz_directa'
    if (hayVoz) {
      if (!e.tramo) {
        const id = claveNueva(t)
        const uri = archivoParaTramo(id)
        const meta = { modo: l.estado === 'dictado' ? 'dictado' : 'pasivo', caminando: !!e.caminando, conv }
        // Primero anotado en disco, después a grabar: si la app se corta, el tramo se recupera al abrir.
        const grabando = anotarTramo(id, uri, t, meta).then(() => stream.startFileRecordingAsync({ format: 'wav', uri }))
        e.tramo = { id, uri, inicio: t, ultimaVoz: t, dictado: 0, escucha: 0, ruido: 0, voz: 0, caminando: !!e.caminando, conv, grabando }
        e.ocupado = true
        void grabando.catch(() => { if (e.tramo?.id === id) e.tramo = null; void cerrarTramoEnDisco(id, null) }).finally(() => { e.ocupado = false })
        return
      }
      e.tramo.ultimaVoz = t
    }
    if (e.tramo) {
      if (hayVoz) e.tramo.voz++
      if (l.estado === 'dictado') e.tramo.dictado++
      else if (l.estado === 'escucha') e.tramo.escucha++
      else e.tramo.ruido++
      if (debeCerrar(e.tramo, t, e.tramo.conv ? FIN_CONV_MS : FIN_MS, false)) {
        e.ocupado = true
        void cerrarTramo().finally(() => { e.ocupado = false })
      }
    }
  }, [cerrarTramo, cerrarMinuto])

  const onBuffer = useCallback((b: AudioStreamBuffer) => {
    const e = estado.current
    if (!e.rasgos || e.sr !== b.sampleRate) { e.sr = b.sampleRate; e.rasgos = crearRasgos(b.sampleRate) }
    let x = new Float32Array(b.data)
    if (b.channels > 1) x = x.filter((_, i) => i % b.channels === 0)
    const n = Math.round((e.sr * CUADRO_MS) / 1000)
    const junto = new Float32Array(e.pendiente.length + x.length)
    junto.set(e.pendiente)
    junto.set(x, e.pendiente.length)
    let i = 0
    for (; i + n <= junto.length; i += n) alCuadro(junto.subarray(i, i + n))
    e.pendiente = junto.slice(i)
  }, [alCuadro])

  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'float32', onBuffer })

  useEffect(() => {
    if (!activa) return
    Accelerometer.setUpdateInterval(50)
    const sub = Accelerometer.addListener((m) => {
      const r = estado.current.mov.medir({ t: Date.now(), x: m.x, y: m.y, z: m.z })
      estado.current.caminando = r.caminando
      estado.current.levantado = r.levantado
      const e = estado.current
      e.pasos = e.pasosSensor ?? r.pasos
      const ahora = Date.now()
      if (!!r.caminando !== e.moviendose) { e.moviendose = !!r.caminando; e.moviendoseDesde = ahora }
    })
    return () => sub.remove()
  }, [activa])

  const vigilarUbicacion = useCallback(async () => {
    const e = estado.current
    if (!e.ubicActiva) return
    const L = await import('expo-location')
    e.ubicSub?.remove()
    e.moviendoseUbic = e.moviendose
    e.ubicSub = await L.watchPositionAsync({ accuracy: e.moviendose ? L.Accuracy.Balanced : L.Accuracy.Low, ...parametrosUbicacion(e.moviendose) }, (p) => {
      const punto = { lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy ?? null, t: Date.now() }
      if (!e.soloParadas) { e.ubic = punto; return }
      const parada = e.paradas.sumar(punto)
      e.ubic = parada ? { lat: parada.lat, lon: parada.lon, precision: null, t: punto.t } : null
    })
  }, [])
  useEffect(() => {
    if (!activa) return
    const x = setInterval(() => {
      const e = estado.current
      if (e.ubicActiva && e.moviendose !== e.moviendoseUbic && Date.now() - e.moviendoseDesde >= SOSTENER_MS) void vigilarUbicacion().catch(() => {})
    }, 15_000)
    return () => clearInterval(x)
  }, [activa, vigilarUbicacion])

  // Al cambiar de app (o bloquear la pantalla), el tramo en curso se cierra: queda entero en la cola y la escucha sigue.
  useEffect(() => {
    if (!activa) return
    const app = AppState.addEventListener('change', (s) => {
      const e = estado.current
      if (s !== 'active' && e.tramo && !e.ocupado) { e.ocupado = true; void cerrarTramo().finally(() => { e.ocupado = false }) }
    })
    return () => app.remove()
  }, [activa, cerrarTramo])

  const empezar = useCallback(async () => {
    setError(null)
    const aj = await ajustesCaptura()
    if (!capta(aj, 'audio')) return setError(aj.todo ? 'El micrófono está apagado en Captura y permisos (⋯).' : 'La captura está toda apagada (⋯ → Captura y permisos).')
    const p = await requestRecordingPermissionsAsync()
    if (!p.granted) return setError('Sin permiso de micrófono no puedo escuchar.')
    await setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: true, shouldPlayInBackground: true })
    const e = estado.current
    e.conciencia = crearConciencia()
    e.rasgos = null
    e.pendiente = new Float32Array(0)
    e.acum = null
    try { await stream.start(); setActiva(true) } catch (err) { return setError(err instanceof Error ? err.message : String(err)) }
    // La ubicación (si está prendida y diste el permiso), con su ritmo según si te movés; o solo las paradas.
    e.soloParadas = aj.soloParadas
    e.paradas = crearParadas()
    e.ubic = null
    if (capta(aj, 'ubicacion')) {
      try {
        const L = await import('expo-location')
        if ((await L.requestForegroundPermissionsAsync()).granted) { e.ubicActiva = true; await vigilarUbicacion() }
      } catch { /* sin el módulo o sin permiso: las capas van sin ubicación */ }
    }
    // Los pasos por el sensor del teléfono (no por GPS), si está y diste el permiso; si no, el acelerómetro.
    e.pasosSensor = null
    if (capta(aj, 'pasos')) {
      try {
        const { Pedometer } = await import('expo-sensors')
        if ((await Pedometer.isAvailableAsync()) && (await Pedometer.requestPermissionsAsync()).granted) e.pedSub = Pedometer.watchStepCount((r) => { e.pasosSensor = r.steps })
      } catch { /* sin sensor: el acelerómetro */ }
    }
  }, [stream, vigilarUbicacion])

  const parar = useCallback(async () => {
    const e = estado.current
    if (e.tramo) await cerrarTramo()
    stream.stop()
    if (e.acum) { cerrarMinuto(Date.now()); e.acum = null }
    e.ubicSub?.remove(); e.ubicSub = null; e.ubicActiva = false
    e.pedSub?.remove(); e.pedSub = null; e.pasosSensor = null
    setActiva(false)
    setLectura(null)
    if (c) void sincronizar(c)
  }, [stream, cerrarTramo, cerrarMinuto, c])

  return { activa, lectura, envios, enCola, error, empezar, parar, conversacion, setConversacion, ultimo }
}
