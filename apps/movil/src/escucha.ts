/**
 * La escucha con conciencia (plan v33, paso 3). El micrófono en PCM (AudioStream, 16 kHz mono) se corta en cuadros de
 * 100 ms → rasgos (nivel, banda de voz, cruces por cero) → la conciencia acústica, junto con el acelerómetro (caminando,
 * levantado). La grabación de un tramo arranca apenas aparece tu voz directa (así no se pierden las primeras sílabas) y
 * se cierra cuando dejás de hablar; el modo se decide al cerrar, por lo que predominó: dictado → chat de Hoy, escucha →
 * nota de voz. Un ruido suelto se descarta. Cada WAV se sube y se borra; sin red, espera en la cola (y se borra al subir).
 *
 * Tu día en capas (plan v38, fase 6): mientras escucha, junta cada minuto cuánto hablaste, cuánto escuchaste, ruido y
 * silencio, el nivel de tu voz y del ambiente, los pasos y (si diste el permiso) dónde estabas. Solo números: cada 5
 * minutos salen al servidor; sin red, esperan (hasta 12 horas).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream, type AudioStreamBuffer } from 'expo-audio'
import { Accelerometer } from 'expo-sensors'
import { crearConciencia, type Lectura } from './conciencia/acustica'
import { crearRasgos } from './conciencia/rasgos'
import { crearMovimiento } from './conciencia/movimiento'
import { subirCapas, subirVoz, type Credenciales, type MinutoCapa } from './api'
import { encolarVoz } from './almacen'

export type Envio = { en: number; modo: 'dictado' | 'pasivo' | 'conversacion'; texto: string | null; error?: string }
const CUADRO_MS = 100
const FIN_MS = 1500 // sin tu voz directa este tiempo, el tramo se cierra
const MAX_MS = 60_000 // un tramo larguísimo se corta igual
const MIN_MS = 700 // menos que esto no es habla
// En conversación se corta por turnos: una pausa más corta y tramos más cortos (para saber quién dijo qué).
const FIN_CONV_MS = 800
const MAX_CONV_MS = 20_000
const CAPAS_CADA = 5 // minutos juntos por envío
const CAPAS_TOPE = 720 // sin red, hasta 12 horas esperando

type Acumulado = { minuto: number; hablo: number; escucho: number; ruido: number; silencio: number; voz: number; vozN: number; cerca: number; cercaN: number; piso: number; pisoN: number; pasos0: number; caminando: number }
const nuevoMinuto = (t: number, pasos: number): Acumulado => ({ minuto: Math.floor(t / 60_000) * 60_000, hablo: 0, escucho: 0, ruido: 0, silencio: 0, voz: 0, vozN: 0, cerca: 0, cercaN: 0, piso: 0, pisoN: 0, pasos0: pasos, caminando: 0 })
const prom = (s: number, n: number) => (n ? Math.round((s / n) * 10) / 10 : null)

export function useEscucha(c: Credenciales | null) {
  const [activa, setActiva] = useState(false)
  const [conversacion, setConversacion] = useState(false)
  const modoConv = useRef(false)
  useEffect(() => { modoConv.current = conversacion }, [conversacion])
  const [ultimo, setUltimo] = useState(0)
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [envios, setEnvios] = useState<Envio[]>([])
  const [error, setError] = useState<string | null>(null)
  const estado = useRef({
    conciencia: crearConciencia(), rasgos: null as ReturnType<typeof crearRasgos> | null, mov: crearMovimiento(),
    pendiente: new Float32Array(0), sr: 16000, t0: 0, caminando: false as boolean | null, levantado: false,
    tramo: null as null | { inicio: number; ultimaVoz: number; dictado: number; escucha: number; ruido: number; voz: number; caminando: boolean; conv: boolean },
    ocupado: false,
    pasos: 0, acum: null as Acumulado | null, capas: [] as MinutoCapa[], ubic: null as null | { lat: number; lon: number; precision: number | null; t: number },
    ubicSub: null as null | { remove: () => void }, enviando: false,
  })

  /** Cierra el minuto en curso y, cada tanto, manda lo juntado (sin red queda esperando). */
  const enviarCapas = useCallback(async (todo = false) => {
    const e = estado.current
    if (!c || e.enviando || !e.capas.length || (!todo && e.capas.length < CAPAS_CADA)) return
    e.enviando = true
    const lote = e.capas.slice(0, 240)
    try { await subirCapas(c, lote); e.capas.splice(0, lote.length) } catch { /* sin red: siguen esperando */ } finally { e.enviando = false }
  }, [c])
  const cerrarMinuto = useCallback((t: number) => {
    const e = estado.current
    const a = e.acum
    e.acum = nuevoMinuto(t, e.pasos)
    if (!a) return
    const u = e.ubic && t - e.ubic.t < 180_000 ? e.ubic : null
    const seg = (n: number) => Math.min(60, Math.round(n / 10)) // cuadros de 100 ms → segundos
    e.capas.push({
      minuto: a.minuto, hablo: seg(a.hablo), escucho: seg(a.escucho), ruido: seg(a.ruido), silencio: seg(a.silencio),
      vozDb: prom(a.voz, a.vozN), vozCercaDb: prom(a.cerca, a.cercaN), pisoDb: prom(a.piso, a.pisoN),
      pasos: Math.max(0, e.pasos - a.pasos0), caminando: seg(a.caminando), lat: u?.lat ?? null, lon: u?.lon ?? null, precision: u?.precision ?? null,
    })
    if (e.capas.length > CAPAS_TOPE) e.capas.splice(0, e.capas.length - CAPAS_TOPE)
    void enviarCapas()
  }, [enviarCapas])

  const cerrarTramo = useCallback(async () => {
    const e = estado.current
    const tramo = e.tramo
    e.tramo = null
    if (!tramo) return
    let uri: string
    try { uri = (await stream.stopFileRecordingAsync()).uri } catch { return }
    const dur = tramo.ultimaVoz - tramo.inicio
    const modo = tramo.conv ? 'conversacion' as const : tramo.dictado >= tramo.escucha ? 'dictado' as const : 'pasivo' as const
    const { File } = await import('expo-file-system')
    const poca = tramo.conv ? tramo.voz < 4 : tramo.dictado + tramo.escucha < 4
    if (dur < MIN_MS || poca || !c) { try { new File(uri).delete() } catch { /* ya no está */ } return }
    const meta = { modo, inicio: tramo.inicio, fin: tramo.ultimaVoz, caminando: tramo.caminando }
    try {
      const r = await subirVoz(c, uri, meta)
      setEnvios((xs) => [{ en: Date.now(), modo, texto: r.texto }, ...xs].slice(0, 20))
      setUltimo(Date.now()) // la lista de lo que se dijo se pone al día
      try { new File(uri).delete() } catch { /* ya no está */ }
    } catch (err) {
      await encolarVoz(uri, meta) // sin red: queda en la cola y sale en la próxima sincronización
      setEnvios((xs) => [{ en: Date.now(), modo, texto: null, error: err instanceof Error ? err.message : String(err) }, ...xs].slice(0, 20))
    }
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
        e.tramo = { inicio: t, ultimaVoz: t, dictado: 0, escucha: 0, ruido: 0, voz: 0, caminando: !!e.caminando, conv }
        e.ocupado = true
        void stream.startFileRecordingAsync({ format: 'wav' }).catch(() => { e.tramo = null }).finally(() => { e.ocupado = false })
        return
      }
      e.tramo.ultimaVoz = t
    }
    if (e.tramo) {
      if (hayVoz) e.tramo.voz++
      if (l.estado === 'dictado') e.tramo.dictado++
      else if (l.estado === 'escucha') e.tramo.escucha++
      else e.tramo.ruido++
      if (t - e.tramo.ultimaVoz > (e.tramo.conv ? FIN_CONV_MS : FIN_MS) || t - e.tramo.inicio > (e.tramo.conv ? MAX_CONV_MS : MAX_MS)) {
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
      estado.current.pasos = r.pasos
    })
    return () => sub.remove()
  }, [activa])

  const empezar = useCallback(async () => {
    setError(null)
    const p = await requestRecordingPermissionsAsync()
    if (!p.granted) return setError('Sin permiso de micrófono no puedo escuchar.')
    await setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: true, shouldPlayInBackground: true })
    const e = estado.current
    e.conciencia = crearConciencia()
    e.rasgos = null
    e.pendiente = new Float32Array(0)
    e.acum = null
    try { await stream.start(); setActiva(true) } catch (err) { return setError(err instanceof Error ? err.message : String(err)) }
    // La ubicación, si la app la tiene (llega con la versión instalada que trae el módulo) y diste el permiso.
    try {
      const L = await import('expo-location')
      const pl = await L.requestForegroundPermissionsAsync()
      if (pl.granted) e.ubicSub = await L.watchPositionAsync({ accuracy: L.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 25 }, (p) => { e.ubic = { lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy ?? null, t: Date.now() } })
    } catch { /* sin el módulo o sin permiso: las capas van sin ubicación */ }
  }, [stream])

  const parar = useCallback(async () => {
    const e = estado.current
    if (e.tramo) await cerrarTramo()
    stream.stop()
    if (e.acum) { cerrarMinuto(Date.now()); e.acum = null }
    void enviarCapas(true)
    e.ubicSub?.remove(); e.ubicSub = null
    setActiva(false)
    setLectura(null)
  }, [stream, cerrarTramo, cerrarMinuto, enviarCapas])

  return { activa, lectura, envios, error, empezar, parar, conversacion, setConversacion, ultimo }
}
