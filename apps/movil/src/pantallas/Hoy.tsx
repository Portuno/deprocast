/**
 * Hoy, en el teléfono (local-first): se dibuja al instante con lo guardado; la sincronización de la app la mantiene al
 * día (la marca cada 5 s con la app abierta, enseguida al volver del segundo plano) y esta pantalla se redibuja cuando
 * termina. Tirando hacia abajo se sincroniza a mano. Lo que escribís aparece enseguida; sin red, queda «en cola».
 * Estados explícitos (Mobile 1.0): cargando la primera vez, vacío, y el error con «Reintentar» (nunca un spinner eterno).
 * Mobile 1.2: arriba, la actividad del día (pasos contra tu meta, minutos caminando, km); en el compositor, 📎 para mandar
 * fotos y videos (de la galería, varios a la vez, o la cámara), con lo escrito como nota; lo que espera subir se ve.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAltoTeclado } from '../teclado'
import type { Actividad, Credenciales, UsoHoy } from '../api'
import { archivosEnCola, encolar, estadoSincro, leerActividad, leerChat, leerUso, type EstadoSincro, type MensajeLocal } from '../almacen'
import { elegirArchivos } from '../archivos'
import { horasYMinutos } from '../logica/uso'
import { alCambiarPasos, cuentaConLaAppCerrada, horasDeHoy, pasosDeHoy, ultimosDias } from '../pasos'
import { alCambiar, sincronizar } from '../sincronizar'
import { VIEJO_MS } from '../logica/sincro'
import { AREA_EXTRA, ESP, LETRA, TOQUE, useTema } from '../tema'
import { useEscuchaGlobal } from '../escuchaGlobal'
import { callar, decir } from '../voz'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/**
 * La charla en vivo (Mobile 1.1, Fragua #285): con la escucha prendida, lo que decís cerca del teléfono entra acá como
 * mensaje (con su hora y su lugar) y, con «Contestar en voz», lo que responde Mastropiero se dice en voz alta. Así se
 * charla caminando sin mirar la pantalla: pedís «seis cosas para pensar» y te las va dando de a una.
 */
function BarraEscucha({ irAEscucha, enVoz, setEnVoz }: { irAEscucha: () => void; enVoz: boolean; setEnVoz: (v: boolean) => void }) {
  const t = useTema()
  const e = useEscuchaGlobal()
  const prender = async () => { setEnVoz(true); await e.empezar() }
  return (
    <View style={[s.escucha, { borderColor: e.activa ? t.acento : t.linea }]}>
      {e.activa ? (
        <>
          <Pressable onPress={irAEscucha} style={s.verEscucha} accessibilityRole="button" accessibilityLabel="Ver la escucha">
            <Text style={[LETRA.chica, { color: e.grabando ? t.mal : t.acento, fontWeight: '700' }]} numberOfLines={1}>{e.grabando ? '● Te escucho…' : '● Escuchando · charla en vivo'}</Text>
            <Text style={[LETRA.chica, { color: t.tenue }]} numberOfLines={1}>Lo que digas cerca entra acá{e.sesion ? ` · desde las ${hora(e.sesion.desde)}` : ''}</Text>
          </Pressable>
          <Text style={[LETRA.chica, { color: t.tenue }]}>Voz</Text>
          <Switch value={enVoz} onValueChange={(v) => { setEnVoz(v); if (!v) callar() }} trackColor={{ true: t.acento }} accessibilityLabel="Contestar en voz alta" />
        </>
      ) : (
        <Pressable onPress={prender} style={s.prender} accessibilityRole="button" accessibilityLabel="Charlar en vivo con la escucha">
          <Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>🎙 Charlar en vivo</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>Hablás caminando y te contesto en voz.</Text>
        </Pressable>
      )}
    </View>
  )
}

export function Hoy({ c, irAEscucha, dictar = 0 }: { c: Credenciales; irAEscucha: () => void; dictar?: number }) {
  const t = useTema()
  const escucha = useEscuchaGlobal()
  const [enVoz, setEnVoz] = useState(false)
  // Desde el icono rápido de la barra (Fragua #300): la escucha se prende sola, lista para hablar.
  useEffect(() => { if (dictar && !escucha.activa) { setEnVoz(true); void escucha.empezar() } }, [dictar]) // eslint-disable-line react-hooks/exhaustive-deps
  // Lo que ya estaba al abrir no se lee: solo lo que llega de acá en más.
  const leidos = useRef<Set<string> | null>(null)
  const vozRef = useRef(false)
  useEffect(() => { vozRef.current = enVoz && escucha.activa; if (!vozRef.current) callar() }, [enVoz, escucha.activa])
  const escuchaRef = useRef(escucha.silenciar)
  useEffect(() => { escuchaRef.current = escucha.silenciar }, [escucha.silenciar])
  const [mensajes, setMensajes] = useState<MensajeLocal[] | null>(null)
  const [paraValidar, setParaValidar] = useState(0)
  const [texto, setTexto] = useState('')
  const [sincro, setSincro] = useState<EstadoSincro>({ sincronizadoEn: null, error: null, marca: null })
  const [tirando, setTirando] = useState(false)
  const [actividad, setActividad] = useState<Actividad | null>(null)
  const [pasosLocal, setPasosLocal] = useState(0)
  const [uso, setUso] = useState<UsoHoy | null>(null)
  // Mobile 1.3: tocando la tarjeta, los pasos de hoy por hora y los últimos 7 días (todo del teléfono, sin red).
  const [verPasos, setVerPasos] = useState(false)
  const [horas, setHoras] = useState<number[]>([])
  const [dias, setDias] = useState<{ fecha: string; pasos: number }[]>([])
  const [subiendo, setSubiendo] = useState(0)
  const [, setAhora] = useState(Date.now())
  const lista = useRef<FlatList<MensajeLocal>>(null)
  // El teclado (1.0.1): la pantalla le deja su lugar abajo, así lo que escribís queda a la vista (antes lo tapaba).
  const teclado = useAltoTeclado()
  const bordes = useSafeAreaInsets()
  useEffect(() => { if (teclado) setTimeout(() => lista.current?.scrollToEnd({ animated: true }), 50) }, [teclado])

  const pintar = useCallback(async () => {
    const l = await leerChat()
    // Las respuestas nuevas de Mastropiero, en voz (si está la charla en vivo con «Voz» prendida).
    const nuevas = leidos.current ? l.mensajes.filter((m) => m.rol === 'asistente' && !leidos.current!.has(m.id)) : []
    leidos.current = new Set(l.mensajes.map((m) => m.id))
    if (vozRef.current) for (const m of nuevas) void decir(m.texto, escuchaRef.current)
    setMensajes(l.mensajes)
    setParaValidar(l.paraValidar)
    setSincro(await estadoSincro())
    setActividad(await leerActividad())
    setUso(await leerUso())
    setPasosLocal(await pasosDeHoy())
    setSubiendo((await archivosEnCola()).length)
  }, [])

  useEffect(() => {
    void pintar() // lo guardado, al instante
    const sacar = alCambiar(() => { void pintar() })
    const sacarPasos = alCambiarPasos((n) => { setPasosLocal(n); if (verPasosRef.current) void cargarPasos() })
    const reloj = setInterval(() => setAhora(Date.now()), 30_000) // para que «Actualizado» envejezca a la vista
    return () => { sacar(); sacarPasos(); clearInterval(reloj) }
  }, [pintar])

  const verPasosRef = useRef(false)
  useEffect(() => { verPasosRef.current = verPasos; if (verPasos) void cargarPasos() }, [verPasos])
  async function cargarPasos() { setHoras(await horasDeHoy()); setDias(await ultimosDias(7)) }

  const actualizar = async () => {
    setTirando(true)
    try { await sincronizar(c) } finally { setTirando(false); void pintar() }
  }

  const mandar = async () => {
    const x = texto.trim()
    if (!x) return
    setTexto('')
    await encolar(x)
    await pintar()
    void sincronizar(c)
  }

  /** 📎: la galería o la cámara. Lo escrito va como nota del archivo (no como mensaje aparte). */
  const adjuntar = () => {
    const elegir = async (camara: boolean) => {
      const nota = texto.trim() || null
      const res = await elegirArchivos(c, { camara, nota })
      if (res.encolados && nota) setTexto('')
      if (res.aviso) Alert.alert('Fotos y videos', res.aviso)
      void pintar()
    }
    Alert.alert('Mandar a Deprocast', texto.trim() ? 'Lo que escribiste va como nota.' : 'Fotos o videos: los leo, los anoto si son un registro y quedan en tu corpus.', [
      { text: 'Galería', onPress: () => void elegir(false) },
      { text: 'Cámara', onPress: () => void elegir(true) },
      { text: 'Cancelar', style: 'cancel' },
    ])
  }
  // Los pasos: lo que contó el teléfono hoy o lo que sabe el servidor (la escucha también cuenta), lo que sea más.
  const d = new Date()
  const hoyLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const deHoy = actividad?.fecha === hoyLocal ? actividad : null
  const pasos = Math.max(pasosLocal, deHoy?.pasos ?? 0)
  const meta = actividad?.meta ?? 8000

  const viejo = sincro.sincronizadoEn != null && Date.now() - sincro.sincronizadoEn > VIEJO_MS
  const aviso = sincro.error
    ? `No pude actualizar: ${sincro.error}${sincro.sincronizadoEn ? ` · lo de las ${hora(sincro.sincronizadoEn)}` : ''}`
    : sincro.sincronizadoEn ? `Actualizado ${hora(sincro.sincronizadoEn)}${viejo ? ' · tirá para actualizar' : ''}` : null

  return (
    <View style={[s.raiz, { backgroundColor: t.fondo, paddingBottom: teclado ? Math.max(0, teclado - bordes.bottom) : 0 }]}>
      {aviso ? (
        <View style={[s.aviso, { borderColor: t.linea }]}>
          <Text style={[s.avisoTexto, { color: sincro.error ? t.mal : t.tenue }]} numberOfLines={2}>{aviso}</Text>
          {sincro.error ? <Pressable onPress={actualizar} style={s.reintentar} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel="Reintentar"><Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Reintentar</Text></Pressable> : null}
        </View>
      ) : null}
      <BarraEscucha irAEscucha={irAEscucha} enVoz={enVoz} setEnVoz={setEnVoz} />
      {escucha.retorno ? (
        <Pressable onPress={escucha.cerrarRetorno} style={[s.aviso, { borderColor: t.linea }]} accessibilityRole="button" accessibilityLabel="Cerrar el aviso de la escucha">
          <Text style={[s.avisoTexto, { color: t.texto }]}>{escucha.retorno}</Text>
        </Pressable>
      ) : null}
      {pasos || deHoy?.km || uso ? (
        <Pressable onPress={() => setVerPasos((v) => !v)} style={[s.tarjetaPasos, { borderColor: t.linea }]} accessibilityRole="button" accessibilityLabel={`Hoy: ${pasos} pasos de ${meta}. Tocá para ver por hora y los últimos días`}>
        <View style={s.actividad}>
          <Text style={[LETRA.chica, { color: t.texto, fontWeight: '700' }]}>🚶 {pasos.toLocaleString('es-AR')} pasos</Text>
          <View style={[s.barraPasos, { backgroundColor: t.linea }]}><View style={[s.llenoPasos, { backgroundColor: t.acento, width: `${Math.min(100, Math.round((pasos / meta) * 100))}%` }]} /></View>
          <Text style={[LETRA.chica, { color: t.tenue }]}>{deHoy?.minutosCaminando ? `${deHoy.minutosCaminando} min · ` : ''}{deHoy?.km ? `${deHoy.km} km` : `meta ${meta.toLocaleString('es-AR')}`}</Text>
        </View>
        {uso ? (
          <Text style={[LETRA.chica, { color: t.tenue, marginTop: ESP(1) }]}>📱 {horasYMinutos(uso.pantallaMin)} de pantalla{uso.distraccionMin ? ` · ${horasYMinutos(uso.distraccionMin)} en distracción` : ''} · {uso.desbloqueos} desbloqueos</Text>
        ) : null}
        {verPasos ? (
          <View style={s.detallePasos}>
            {uso?.apps.length ? uso.apps.map((a) => (
              <Text key={a.nombre} style={[LETRA.chica, { color: a.distraccion ? t.mal : t.texto }]}>{a.nombre} · {horasYMinutos(a.min)}{a.distraccion ? ' (distracción)' : ''}</Text>
            )) : null}
            <View style={s.horas}>
              {(horas.length ? horas : Array.from({ length: 24 }, () => 0)).map((n, i, xs) => (
                <View key={i} style={[s.hora, { backgroundColor: n ? t.acento : t.linea, height: Math.max(ESP(1), Math.round((n / Math.max(1, ...xs)) * ESP(10))) }]} />
              ))}
            </View>
            <View style={s.ejeHoras}>{['0 h', '6 h', '12 h', '18 h', '24 h'].map((x) => <Text key={x} style={[LETRA.chica, { color: t.tenue }]}>{x}</Text>)}</View>
            {dias.map((x) => (
              <Text key={x.fecha} style={[LETRA.chica, { color: x.pasos >= meta ? t.acento : t.texto }]}>
                {new Date(`${x.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} · {x.pasos.toLocaleString('es-AR')} pasos{x.pasos >= meta ? ' ✓' : ''}
              </Text>
            ))}
            <Text style={[LETRA.chica, { color: t.tenue }]}>{cuentaConLaAppCerrada() ? 'Cuenta el teléfono, aunque la app esté cerrada.' : 'Este teléfono cuenta solo con la app abierta (o la escucha o el recorrido prendidos).'}</Text>
          </View>
        ) : null}
        </Pressable>
      ) : null}
      {subiendo ? <Text style={[s.avisoTexto, s.validar, { color: t.tenue, borderColor: t.linea }]}>📎 {subiendo} archivo{subiendo === 1 ? '' : 's'} esperando subir (salen solos con red)</Text> : null}
      {paraValidar ? <Text style={[s.avisoTexto, s.validar, { color: t.acento, borderColor: t.linea }]}>📥 {paraValidar} esperan tu ok (se validan en la compu)</Text> : null}
      <FlatList
        ref={lista}
        data={mensajes ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[s.lista, !mensajes?.length && s.listaVacia]}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: false })}
        refreshControl={<RefreshControl refreshing={tirando} onRefresh={actualizar} tintColor={t.acento} colors={[t.acento]} />}
        ListEmptyComponent={
          <Text style={[s.vacio, { color: t.tenue }]}>
            {mensajes == null || (!sincro.sincronizadoEn && !sincro.error) ? 'Cargando…' : sincro.error && !sincro.sincronizadoEn ? 'No pude traer Hoy. Tirá hacia abajo para reintentar.' : 'Todavía no hay nada hoy. Escribile a Mastropiero.'}
          </Text>
        }
        renderItem={({ item: m }) => (
          <View style={[s.burbuja, m.rol === 'operador' ? [s.mia, { backgroundColor: t.acento }] : [s.suya, { backgroundColor: t.panel, borderColor: t.linea }]]}>
            <Text style={[LETRA.cuerpo, { color: m.rol === 'operador' ? t.sobreAcento : t.texto }]}>{m.texto}</Text>
            {m.pendiente ? <Text style={[s.pendiente, { color: t.sobreAcento }]}>en cola</Text> : null}
          </View>
        )}
      />
      <View style={[s.compositor, { borderColor: t.linea, backgroundColor: t.panel }]}>
        <Pressable onPress={adjuntar} style={s.clip} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel="Mandar fotos o videos">
          <Text style={[LETRA.titulo, { color: t.acento }]}>📎</Text>
        </Pressable>
        <TextInput style={[s.entrada, { color: t.texto }]} value={texto} onChangeText={setTexto} placeholder="Escribile a Mastropiero…" placeholderTextColor={t.tenue} multiline keyboardAppearance={t.fondo === '#0f1012' ? 'dark' : 'light'} />
        <Pressable onPress={mandar} style={[s.enviar, { backgroundColor: t.acento }]} accessibilityRole="button" accessibilityLabel="Enviar">
          <Text style={[LETRA.cuerpo, { color: t.sobreAcento, fontWeight: '700' }]}>Enviar</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), paddingHorizontal: ESP(4), borderBottomWidth: 1, minHeight: TOQUE },
  avisoTexto: { ...LETRA.chica, flex: 1, paddingVertical: ESP(2) },
  validar: { paddingHorizontal: ESP(4), borderBottomWidth: 1 },
  reintentar: { minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(2) },
  lista: { padding: ESP(3), gap: ESP(2) },
  listaVacia: { flexGrow: 1, justifyContent: 'center' },
  vacio: { ...LETRA.cuerpo, textAlign: 'center', padding: ESP(6) },
  burbuja: { maxWidth: '86%', borderRadius: 14, paddingHorizontal: ESP(3), paddingVertical: ESP(2) },
  mia: { alignSelf: 'flex-end' },
  suya: { alignSelf: 'flex-start', borderWidth: 1 },
  pendiente: { ...LETRA.chica, opacity: 0.8, marginTop: ESP(1) },
  compositor: { flexDirection: 'row', alignItems: 'flex-end', gap: ESP(2), margin: ESP(3), borderWidth: 1, borderRadius: 14, padding: ESP(2) },
  entrada: { ...LETRA.cuerpo, flex: 1, maxHeight: 140, minHeight: TOQUE, paddingHorizontal: ESP(2), paddingVertical: ESP(2) },
  enviar: { minHeight: TOQUE, justifyContent: 'center', borderRadius: 10, paddingHorizontal: ESP(4) },
  tarjetaPasos: { marginHorizontal: ESP(3), marginTop: ESP(2), paddingHorizontal: ESP(3), paddingVertical: ESP(2), borderWidth: 1, borderRadius: 12, minHeight: TOQUE, justifyContent: 'center' },
  actividad: { flexDirection: 'row', alignItems: 'center', gap: ESP(2) },
  detallePasos: { marginTop: ESP(3), gap: ESP(1) },
  horas: { flexDirection: 'row', alignItems: 'flex-end', gap: ESP(1), height: ESP(10) },
  hora: { flex: 1, borderRadius: ESP(1) },
  ejeHoras: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: ESP(2) },
  barraPasos: { flex: 1, height: ESP(2), borderRadius: ESP(1), overflow: 'hidden' },
  llenoPasos: { height: '100%' },
  clip: { minHeight: TOQUE, minWidth: TOQUE, justifyContent: 'center', alignItems: 'center' },
  escucha: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), marginHorizontal: ESP(3), marginTop: ESP(2), borderWidth: 1, borderRadius: 12, paddingHorizontal: ESP(3), minHeight: TOQUE + ESP(2) },
  prender: { flex: 1, minHeight: TOQUE, justifyContent: 'center', paddingVertical: ESP(1) },
  verEscucha: { flex: 1, minHeight: TOQUE, justifyContent: 'center' },
})
