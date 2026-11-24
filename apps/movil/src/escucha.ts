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
 * voz y del ambiente, los pasos y dónde estabas (el último punto del recorrido, si está prendido en la pestaña Mapa: la
 * ubicación va aparte desde 1.0.1). Solo números, a la cola en disco.
 *
 * Mobile 2.0: la conversación ya no es un interruptor. Por defecto (Auto) la escucha se da cuenta sola de que estás en una
 * charla (logica/escucha.ts): graba la voz de los demás solo si hablaste hace poco, y un tramo con otra voz de verdad va
 * como conversación (por turnos, con quién dijo qué). «Solo yo» y «Charla» quedan como preferencias fijas. Y el audio
 * ya no se borra: después de subir, queda guardado en el teléfono (audios.ts).
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
import { capta } from './logica/captura'
import { apagarAvisoEscucha, prenderAvisoEscucha, ultimoPunto } from './recorrido'
import { ajustesCaptura } from './captura'
import { corteEntre, resumenRetorno, sesionNueva, textoDeCierre, type Sesion } from './logica/vigia'
import { cuentaComoVoz, enCharla, modoDelTramo, OTRA_VOZ_CONVERSACION, type Preferencia } from './logica/escucha'
import { fijarAjuste, leerAjuste } from './almacen'

export type Envio = { en: number; modo: string; texto: string | null; error?: string }
const CUADRO_MS = 100
const FIN_MS = 1500 // sin tu voz directa este tiempo, el tramo se cierra
const MIN_MS = 700 // menos que esto no es habla
// En conversación se corta por turnos: una pausa más corta (para saber quién dijo qué).
const FIN_CONV_MS = 800

type Acumulado = { minuto: number; hablo: number; escucho: number; ruido: number; silencio: number; voz: number; vozN: number; cerca: number; cercaN: number; piso: number; pisoN: number; pasos0: number; caminando: number }
const nuevoMinuto = (t: number, pasos: number): Acumulado => ({ minuto: Math.floor(t / 60_000) * 60_000, hablo: 0, escucho: 0, ruido: 0, silencio: 0, voz: 0, vozN: 0, cerca: 0, cercaN: 0, piso: 0, pisoN: 0, pasos0: pasos, caminando: 0 })
const prom = (s: number, n: number) => (n ? Math.round((s / n) * 10) / 10 : null)
type Tramo = { id: string; uri: string; inicio: number; ultimaVoz: number; dictado: number; escucha: number; ruido: number; voz: number; otras: number; caminando: boolean; conv: boolean; grabando: Promise<unknown> }
const CLAVE_PREF = 'escucha_preferencia'

export function useEscucha(c: Credenciales | null) {
  const [activa, setActiva] = useState(false)
  // Auto, Solo yo o Charla (queda guardada en el teléfono). «conversacion»: si ahora mismo está en una charla.
  const [preferencia, setPref] = useState<Preferencia>('auto')
  const prefRef = useRef<Preferencia>('auto')
  useEffect(() => { void leerAjuste(CLAVE_PREF).then((v) => { if (v === 'auto' || v === 'yo' || v === 'charla') { prefRef.current = v; setPref(v) } }) }, [])
  const setPreferencia = useCallback((p: Preferencia) => { prefRef.current = p; setPref(p); void fijarAjuste(CLAVE_PREF, p) }, [])
  const [conversacion, setConversacion] = useState(false)
  const [ultimo, setUltimo] = useState(0)
  const [lectura, setLectura] = useState<Lectura | null>(null)
  // Lo que está haciendo, para decirlo claro (1.0.1): si está grabando un tramo, desde cuándo y a dónde va.
  const [grabando, setGrabando] = useState<{ desde: number; conv: boolean } | null>(null)
  const [enviadosHoy, setEnviadosHoy] = useState(0)
  const [envios, setEnvios] = useState<Envio[]>([])
  const [enCola, setEnCola] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Mobile 1.1: la sesión (desde cuándo, qué guardó), el cierre en palabras, lo que pasó mientras no mirabas y el aviso fijo.
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [cierre, setCierre] = useState<string | null>(null)
  const [retorno, setRetorno] = useState<string | null>(null)
  const [conAviso, setConAviso] = useState(false)
  const estado = useRef({
    sesion: null as Sesion | null, ultimoCuadro: null as number | null, fueraDesde: null as number | null,
    // Mientras Mastropiero habla (contestar en voz), no se graba: si no, se escucharía a sí mismo.
    silenciada: false, conUbicacion: false,
    conciencia: crearConciencia(), rasgos: null as ReturnType<typeof crearRasgos> | null, mov: crearMovimiento(),
    pendiente: new Float32Array(0), sr: 16000, caminando: false as boolean | null, levantado: false,
    tramo: null as Tramo | null,
    ocupado: false,
    pasos: 0, acum: null as Acumulado | null, ubic: null as null | { lat: number; lon: number; precision: number | null; t: number },
    // Mobile 1.0, bloque 4: los pasos del sensor (si está y diste el permiso).
    pedSub: null as null | { remove: () => void }, pasosSensor: null as number | null,
    // La lectura se muestra a lo sumo dos veces por segundo (antes diez: la pantalla temblaba).
    pintadoEn: 0, estadoPintado: '',
    // Mobile 2.0: la última vez que hablaste vos (para saber si estás en una charla) y lo último que se pintó.
    ultimaVozPropia: null as number | null, charlaPintada: false,
  })

  // Lo que sube la sincronización de la app (de cualquier pantalla) aparece en «lo que se dijo».
  useEffect(() => alCambiar((r) => {
    if (r.subidos.length) { setEnvios((xs) => [...r.subidos.map((s) => ({ en: Date.now(), modo: s.modo, texto: s.texto })), ...xs].slice(0, 20)); setUltimo(Date.now()); setEnviadosHoy((n) => n + r.subidos.length) }
    void cuantoEnCola().then((n) => setEnCola(n.voces))
  }), [])

  /** Cierra el minuto en curso: a la cola en disco (sale con la próxima sincronización). */
  const cerrarMinuto = useCallback((t: number) => {
    const e = estado.current
    const a = e.acum
    e.acum = nuevoMinuto(t, e.pasos)
    if (!a) return
    const p = e.conUbicacion ? ultimoPunto() : null
    const u = p && t - p.en < 15 * 60_000 ? p : null
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
    setGrabando(null)
    if (!tramo) return
    await tramo.grabando.catch(() => {})
    try { await stream.stopFileRecordingAsync() } catch { /* no había grabación: el archivo, si existe, lo recupera el próximo arranque */ }
    const dur = tramo.ultimaVoz - tramo.inicio
    const modo = modoDelTramo(prefRef.current, tramo)
    const poca = modo === 'conversacion' ? tramo.voz < 4 : tramo.dictado + tramo.escucha < 4
    const ses = e.sesion
    if (dur < MIN_MS || poca || !c) {
      try { new File(tramo.uri).delete() } catch { /* ya no está */ }
      await cerrarTramoEnDisco(tramo.id, null)
      if (ses) { ses.descartados++; setSesion({ ...ses }) }
      return
    }
    // Dónde se dijo (Fragua #285): el último lugar conocido, si la ubicación está prendida en Captura y permisos.
    const p = e.conUbicacion ? ultimoPunto() : null
    const lugar = p && tramo.inicio - p.en < 15 * 60_000 ? { lat: p.lat, lon: p.lon } : {}
    await cerrarTramoEnDisco(tramo.id, { uri: tramo.uri, meta: { id: tramo.id, modo, inicio: tramo.inicio, fin: tramo.ultimaVoz, caminando: tramo.caminando, ...lugar } })
    if (ses) { if (modo === 'dictado') ses.dictados++; else if (modo === 'pasivo') ses.notas++; else ses.charlas++; setSesion({ ...ses }) }
    setEnCola((n) => n + 1)
    void sincronizar(c) // a disco primero; a la red, en cuanto se pueda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c])

  const alCuadro = useCallback((x: Float32Array) => {
    const e = estado.current
    if (!e.rasgos) return
    const t = Date.now()
    // El vigía (Fragua #283): un hueco de más de 5 s entre cuadros es un corte, y queda anotado en la sesión.
    const corte = corteEntre(e.ultimoCuadro, t)
    if (corte && e.sesion) e.sesion.cortes.push(corte)
    e.ultimoCuadro = t
    const r = e.rasgos.cuadro(x)
    const l = e.conciencia.cuadro({ t, db: r.db, voz: r.voz, cerca: null, caminando: e.caminando, levantado: e.levantado })
    if (t - e.pintadoEn >= 500 || l.estado !== e.estadoPintado) { e.pintadoEn = t; e.estadoPintado = l.estado; setLectura(l) }
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
    if (e.silenciada && !e.tramo) return // Mastropiero está hablando: no se empieza a grabar
    // Tu voz directa siempre; la de los demás, solo si estás en una charla (Auto: hablaste hace poco; Charla: siempre).
    const pref = prefRef.current
    const directa = l.fuente === 'voz_directa'
    const otra = !directa && r.voz >= 0.6 && l.snr >= 3
    if (directa) e.ultimaVozPropia = t
    const charla = enCharla(pref, e.ultimaVozPropia, t)
    if (charla !== e.charlaPintada) { e.charlaPintada = charla; setConversacion(charla) }
    const hayVoz = cuentaComoVoz(pref, { directa, otra }, charla)
    const conv = pref === 'charla' || (pref === 'auto' && otra)
    if (hayVoz) {
      if (!e.tramo) {
        const id = claveNueva(t)
        const uri = archivoParaTramo(id)
        const meta = { modo: l.estado === 'dictado' ? 'dictado' : 'pasivo', caminando: !!e.caminando, conv }
        // Primero anotado en disco, después a grabar: si la app se corta, el tramo se recupera al abrir.
        const grabando = anotarTramo(id, uri, t, meta).then(() => stream.startFileRecordingAsync({ format: 'wav', uri }))
        e.tramo = { id, uri, inicio: t, ultimaVoz: t, dictado: 0, escucha: 0, ruido: 0, voz: 0, otras: 0, caminando: !!e.caminando, conv, grabando }
        setGrabando({ desde: t, conv })
        e.ocupado = true
        void grabando.catch(() => { if (e.tramo?.id === id) e.tramo = null; void cerrarTramoEnDisco(id, null) }).finally(() => { e.ocupado = false })
        return
      }
      e.tramo.ultimaVoz = t
    }
    if (e.tramo) {
      if (hayVoz) e.tramo.voz++
      if (otra) e.tramo.otras++
      // En Auto, el tramo pasa a conversación (se corta por turnos) en cuanto hubo otra voz de verdad.
      if (!e.tramo.conv && pref === 'auto' && e.tramo.otras >= OTRA_VOZ_CONVERSACION) { e.tramo.conv = true; setGrabando({ desde: e.tramo.inicio, conv: true }) }
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
    })
    return () => sub.remove()
  }, [activa])

  // Al cambiar de app (o bloquear la pantalla), el tramo en curso se cierra: queda entero en la cola y la escucha sigue.
  // Al volver (Fragua #283): se dice si siguió o desde qué minuto se cortó; si sigue cortada, se retoma (no a ciegas).
  useEffect(() => {
    if (!activa) return
    let reloj: ReturnType<typeof setTimeout> | null = null
    const app = AppState.addEventListener('change', (s) => {
      const e = estado.current
      if (s !== 'active') {
        e.fueraDesde ??= Date.now()
        if (e.tramo && !e.ocupado) { e.ocupado = true; void cerrarTramo().finally(() => { e.ocupado = false }) }
        return
      }
      const fueraDesde = e.fueraDesde
      e.fueraDesde = null
      if (fueraDesde == null) return
      // Un momento para que, si el micrófono siguió, llegue un cuadro fresco.
      reloj = setTimeout(async () => {
        const r = resumenRetorno({ fueraDesde, vuelta: Date.now(), ultimoCuadro: e.ultimoCuadro, cortes: e.sesion?.cortes ?? [] })
        if (!r) return
        if (r.cortadaAhora) {
          if (e.sesion) e.sesion.cortes.push({ desde: Math.max(e.ultimoCuadro ?? fueraDesde, fueraDesde), hasta: Date.now() })
          e.ultimoCuadro = null
          try { stream.stop() } catch { /* ya estaba parado */ }
          try { await stream.start() } catch (err) { setError(`No pude retomar la escucha: ${err instanceof Error ? err.message : String(err)}. Tocá «Dejar de escuchar» y volvé a prender.`) }
        }
        setRetorno(r.texto)
      }, 2500)
    })
    return () => { app.remove(); if (reloj) clearTimeout(reloj) }
  }, [activa, cerrarTramo, stream])

  const empezar = useCallback(async () => {
    setError(null)
    const aj = await ajustesCaptura()
    if (!capta(aj, 'audio')) return setError(aj.todo ? 'El micrófono está apagado en Menú → Permisos.' : 'La captura está toda apagada (Menú → Permisos).')
    const p = await requestRecordingPermissionsAsync()
    if (!p.granted) return setError('Sin permiso de micrófono no puedo escuchar.')
    await setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: true, shouldPlayInBackground: true })
    const e = estado.current
    e.conciencia = crearConciencia()
    e.rasgos = null
    e.pendiente = new Float32Array(0)
    e.acum = null
    e.conUbicacion = capta(aj, 'ubicacion')
    try { await stream.start(); setActiva(true) } catch (err) { return setError(err instanceof Error ? err.message : String(err)) }
    const ses = sesionNueva(Date.now())
    e.sesion = ses
    e.ultimoCuadro = null
    e.fueraDesde = null
    setSesion({ ...ses })
    setCierre(null)
    setRetorno(null)
    // El aviso fijo en la barra: sin él, Android corta el micrófono con la pantalla apagada (Fragua #283).
    setConAviso(await prenderAvisoEscucha())
    // Los pasos por el sensor del teléfono (no por GPS), si está y diste el permiso; si no, el acelerómetro.
    e.pasosSensor = null
    if (capta(aj, 'pasos')) {
      try {
        const { Pedometer } = await import('expo-sensors')
        if ((await Pedometer.isAvailableAsync()) && (await Pedometer.requestPermissionsAsync()).granted) e.pedSub = Pedometer.watchStepCount((r) => { e.pasosSensor = r.steps })
      } catch { /* sin sensor: el acelerómetro */ }
    }
  }, [stream])

  const parar = useCallback(async () => {
    const e = estado.current
    if (e.tramo) await cerrarTramo()
    stream.stop()
    if (e.acum) { cerrarMinuto(Date.now()); e.acum = null }
    e.pedSub?.remove(); e.pedSub = null; e.pasosSensor = null
    setActiva(false)
    setConversacion(false)
    e.charlaPintada = false
    e.ultimaVozPropia = null
    setLectura(null)
    setGrabando(null)
    // El cierre (Fragua #284): qué guardó y dónde, en palabras.
    if (e.sesion) setCierre(textoDeCierre(e.sesion, Date.now()))
    e.sesion = null
    setSesion(null)
    setRetorno(null)
    void apagarAvisoEscucha()
    setConAviso(false)
    if (c) void sincronizar(c)
  }, [stream, cerrarTramo, cerrarMinuto, c])

  /** Mientras Mastropiero habla, no se empieza a grabar (y lo que se estaba grabando se cierra). */
  const silenciar = useCallback((si: boolean) => {
    const e = estado.current
    e.silenciada = si
    if (si && e.tramo && !e.ocupado) { e.ocupado = true; void cerrarTramo().finally(() => { e.ocupado = false }) }
  }, [cerrarTramo])

  return { activa, lectura, envios, enCola, enviadosHoy, grabando, error, empezar, parar, conversacion, preferencia, setPreferencia, ultimo, sesion, cierre, retorno, cerrarRetorno: () => setRetorno(null), conAviso, silenciar }
}
