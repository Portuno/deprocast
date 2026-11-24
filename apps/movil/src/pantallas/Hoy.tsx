/**
 * Hoy, en el teléfono (local-first): se dibuja al instante con lo guardado; la sincronización de la app la mantiene al
 * día y esta pantalla se redibuja cuando termina. Tirando hacia abajo se sincroniza a mano. Lo que escribís aparece
 * enseguida; sin red, queda «en cola». Estados explícitos: cargando la primera vez, vacío, y el error con «Reintentar».
 *
 * Mobile 2.0:
 * - Lo adjunto se ve (logica/adjuntos.ts): las fotos como foto (tocala y se ve entera), los documentos como una ficha
 *   que se abre con la app que elijas. Lo que mandaste y todavía sube, como miniatura sobre la caja de texto.
 * - Arriba, nada más que lo necesario: el error de conexión (si hay), lo que espera tu ok y la charla en vivo si está
 *   prendida. Los pasos y el uso del teléfono se fueron a Actividad.
 * - En la caja: 📎 para fotos y videos, y 🎙 para charlar en vivo (hablás y te contesto en voz) cuando no escribiste nada.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Alert, FlatList, Image, Modal, Pressable, RefreshControl, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { File, Paths } from 'expo-file-system'
import { shareAsync } from 'expo-sharing'
import { useAltoTeclado } from '../teclado'
import { cabeceraDe, urlAdjunto, type Credenciales } from '../api'
import { archivosEnCola, encolar, estadoSincro, leerChat, type ArchivoEnCola, type EstadoSincro, type MensajeLocal } from '../almacen'
import { elegirArchivos } from '../archivos'
import { iconoArchivo, partesDe } from '../logica/adjuntos'
import { alCambiar, sincronizar } from '../sincronizar'
import { VIEJO_MS } from '../logica/sincro'
import type { Modulo } from '../modulos'
import { AREA_EXTRA, ESP, LETRA, TOQUE, useTema } from '../tema'
import { useEscuchaGlobal } from '../escuchaGlobal'
import { callar, decir } from '../voz'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** Baja un adjunto a la caché (con el token) y lo ofrece para abrir con otra app. */
async function abrirAdjunto(c: Credenciales, archivo: string, nombre: string) {
  const limpio = (nombre || archivo).replace(/[^\w.\- ]+/g, '_').slice(-80) || 'adjunto'
  const ext = /\.[a-z0-9]+$/i.exec(archivo)?.[0] ?? ''
  const destino = new File(Paths.cache, /\.[a-z0-9]+$/i.test(limpio) ? limpio : limpio + ext)
  const f = await File.downloadFileAsync(urlAdjunto(c, archivo), destino, { headers: cabeceraDe(c), idempotent: true })
  await shareAsync(f.uri, { dialogTitle: nombre })
}

export function Hoy({ c, irA, dictar = 0 }: { c: Credenciales; irA: (m: Modulo) => void; dictar?: number }) {
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
  const [subiendo, setSubiendo] = useState<ArchivoEnCola[]>([])
  const [foto, setFoto] = useState<{ archivo: string; descripcion: string } | null>(null)
  const lista = useRef<FlatList<MensajeLocal>>(null)
  // El teclado (1.0.1): la pantalla le deja su lugar abajo, así lo que escribís queda a la vista.
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
    setSubiendo(await archivosEnCola())
  }, [])

  useEffect(() => {
    void pintar() // lo guardado, al instante
    return alCambiar(() => { void pintar() })
  }, [pintar])

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

  const charlar = async () => {
    if (escucha.activa) { void escucha.parar(); setEnVoz(false); return }
    setEnVoz(true)
    await escucha.empezar()
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
    Alert.alert('Mandar a Deprocast', texto.trim() ? 'Lo que escribiste va como nota.' : undefined, [
      { text: 'Galería', onPress: () => void elegir(false) },
      { text: 'Cámara', onPress: () => void elegir(true) },
      { text: 'Cancelar', style: 'cancel' },
    ])
  }

  const viejo = sincro.sincronizadoEn != null && Date.now() - sincro.sincronizadoEn > VIEJO_MS
  const abrir = useCallback((archivo: string, nombre: string) => { void abrirAdjunto(c, archivo, nombre).catch((e) => Alert.alert('No pude abrirlo', e instanceof Error ? e.message : String(e))) }, [c])

  return (
    <View style={[s.raiz, { backgroundColor: t.fondo, paddingBottom: teclado ? Math.max(0, teclado - bordes.bottom) : 0 }]}>
      {sincro.error ? (
        <View style={[s.franja, { borderColor: t.linea }]}>
          <Text style={[LETRA.chica, { color: t.mal, flex: 1 }]} numberOfLines={1}>Sin conexión{sincro.sincronizadoEn ? ` · lo de las ${hora(sincro.sincronizadoEn)}` : ''}</Text>
          <Pressable onPress={actualizar} style={s.accion} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel="Reintentar"><Text style={[LETRA.chica, { color: t.acento, fontWeight: '700' }]}>Reintentar</Text></Pressable>
        </View>
      ) : null}
      {escucha.activa ? (
        <View style={[s.franja, { borderColor: t.linea }]}>
          <Text style={[LETRA.chica, { color: escucha.grabando ? t.mal : t.acento, fontWeight: '700', flex: 1 }]} numberOfLines={1}>{escucha.grabando ? '● Te escucho…' : '● Charla en vivo'}</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>Voz</Text>
          <Switch value={enVoz} onValueChange={(v) => { setEnVoz(v); if (!v) callar() }} trackColor={{ true: t.acento }} accessibilityLabel="Contestar en voz alta" />
        </View>
      ) : null}
      {escucha.retorno ? (
        <Pressable onPress={escucha.cerrarRetorno} style={[s.franja, { borderColor: t.linea }]} accessibilityRole="button" accessibilityLabel="Cerrar el aviso de la escucha">
          <Text style={[LETRA.chica, { color: t.texto, flex: 1 }]} numberOfLines={2}>{escucha.retorno}</Text>
        </Pressable>
      ) : null}
      {paraValidar ? (
        <Pressable onPress={() => irA('validar')} style={[s.franja, { borderColor: t.linea }]} accessibilityRole="button">
          <Text style={[LETRA.chica, { color: t.acento, fontWeight: '700', flex: 1 }]}>✅ {paraValidar} esperan tu ok</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>Validar ›</Text>
        </Pressable>
      ) : null}
      <FlatList
        ref={lista}
        data={mensajes ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[s.lista, !mensajes?.length && s.listaVacia]}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: false })}
        refreshControl={<RefreshControl refreshing={tirando} onRefresh={actualizar} tintColor={t.acento} colors={[t.acento]} />}
        ListHeaderComponent={!sincro.error && viejo ? <Text style={[LETRA.chica, s.centrado, { color: t.tenue }]}>Actualizado {hora(sincro.sincronizadoEn!)} · tirá para actualizar</Text> : undefined}
        ListEmptyComponent={
          <Text style={[s.vacio, { color: t.tenue }]}>
            {mensajes == null || (!sincro.sincronizadoEn && !sincro.error) ? 'Cargando…' : sincro.error && !sincro.sincronizadoEn ? 'No pude traer Hoy. Tirá hacia abajo para reintentar.' : 'Todavía no hay nada hoy. Escribile a Mastropiero.'}
          </Text>
        }
        renderItem={({ item }) => <Burbuja m={item} c={c} verFoto={setFoto} abrir={abrir} />}
      />
      {subiendo.length ? (
        <View style={s.subiendo}>
          {subiendo.slice(0, 6).map((a) => (
            <View key={a.id} style={[s.mini, { borderColor: t.linea, backgroundColor: t.panel }]}>
              {a.tipo.startsWith('image/') ? <Image source={{ uri: a.uri }} style={s.miniImagen} /> : <Text style={LETRA.titulo}>{iconoArchivo(a.nombre)}</Text>}
            </View>
          ))}
          <Text style={[LETRA.chica, { color: t.tenue, flex: 1 }]} numberOfLines={1}>Subiendo {subiendo.length}…</Text>
        </View>
      ) : null}
      <View style={[s.compositor, { borderColor: t.linea, backgroundColor: t.panel }]}>
        <Pressable onPress={adjuntar} style={s.icono} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel="Mandar fotos o videos">
          <Text style={[LETRA.titulo, { color: t.acento }]}>📎</Text>
        </Pressable>
        <TextInput style={[s.entrada, { color: t.texto }]} value={texto} onChangeText={setTexto} placeholder="Escribile a Mastropiero…" placeholderTextColor={t.tenue} multiline keyboardAppearance={t.fondo === '#0f1012' ? 'dark' : 'light'} />
        {texto.trim() ? (
          <Pressable onPress={mandar} style={[s.enviar, { backgroundColor: t.acento }]} accessibilityRole="button" accessibilityLabel="Enviar">
            <Text style={[LETRA.titulo, { color: t.sobreAcento, fontWeight: '700' }]}>↑</Text>
          </Pressable>
        ) : (
          <Pressable onPress={charlar} style={[s.enviar, { backgroundColor: escucha.activa ? t.mal : t.fondo, borderColor: t.linea }]} accessibilityRole="button" accessibilityLabel={escucha.activa ? 'Dejar de charlar en vivo' : 'Charlar en vivo'}>
            <Text style={[LETRA.titulo, { color: escucha.activa ? t.sobreAcento : t.acento }]}>{escucha.activa ? '■' : '🎙'}</Text>
          </Pressable>
        )}
      </View>
      <VerFoto c={c} foto={foto} cerrar={() => setFoto(null)} />
    </View>
  )
}

/** Un mensaje: su texto, sus fotos (miniatura que se toca) y sus documentos (una ficha que se abre). */
const Burbuja = memo(function Burbuja({ m, c, verFoto, abrir }: { m: MensajeLocal; c: Credenciales; verFoto: (f: { archivo: string; descripcion: string }) => void; abrir: (archivo: string, nombre: string) => void }) {
  const t = useTema()
  const ancho = Math.min(280, useWindowDimensions().width * 0.7)
  const mia = m.rol === 'operador'
  const color = mia ? t.sobreAcento : t.texto
  const partes = partesDe(m.texto)
  return (
    <View style={[s.burbuja, mia ? [s.mia, { backgroundColor: t.acento }] : [s.suya, { backgroundColor: t.panel, borderColor: t.linea }]]}>
      {partes.map((p, i) => p.tipo === 'texto' ? (
        <Text key={i} style={[LETRA.cuerpo, { color }]} selectable>{p.texto}</Text>
      ) : p.tipo === 'imagen' ? (
        <Pressable key={i} onPress={() => verFoto(p)} style={s.foto} accessibilityRole="imagebutton" accessibilityLabel={p.descripcion || 'Imagen adjunta'}>
          <Image source={{ uri: urlAdjunto(c, p.archivo, 640), headers: cabeceraDe(c) }} style={[s.imagen, { width: ancho, backgroundColor: t.linea }]} resizeMode="cover" />
        </Pressable>
      ) : (
        <Pressable key={i} onPress={() => abrir(p.archivo, p.nombre)} style={[s.ficha, { borderColor: mia ? t.sobreAcento : t.linea }]} accessibilityRole="button" accessibilityLabel={`Abrir ${p.nombre}`}>
          <Text style={LETRA.titulo}>{iconoArchivo(p.archivo)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[LETRA.cuerpo, { color, fontWeight: '600' }]} numberOfLines={2}>{p.nombre}</Text>
            {p.detalle ? <Text style={[LETRA.chica, { color, opacity: 0.75 }]}>{p.detalle}</Text> : null}
          </View>
        </Pressable>
      ))}
      {m.pendiente ? <Text style={[LETRA.chica, s.pendiente, { color: t.sobreAcento }]}>en cola</Text> : null}
    </View>
  )
})

/** Una foto del chat, entera. */
function VerFoto({ c, foto, cerrar }: { c: Credenciales; foto: { archivo: string; descripcion: string } | null; cerrar: () => void }) {
  const t = useTema()
  return (
    <Modal visible={!!foto} transparent animationType="fade" onRequestClose={cerrar}>
      <View style={s.visor}>
        {foto ? <Image source={{ uri: urlAdjunto(c, foto.archivo), headers: cabeceraDe(c) }} style={s.entera} resizeMode="contain" /> : null}
        {foto?.descripcion ? <Text style={[LETRA.chica, s.pie]} numberOfLines={3}>{foto.descripcion}</Text> : null}
        <View style={s.botonesVisor}>
          <Pressable onPress={() => foto && void abrirAdjunto(c, foto.archivo, foto.archivo).catch(() => {})} style={[s.botonVisor, { borderColor: t.linea }]} accessibilityRole="button"><Text style={[LETRA.cuerpo, s.blanco]}>Compartir</Text></Pressable>
          <Pressable onPress={cerrar} style={[s.botonVisor, { borderColor: t.linea }]} accessibilityRole="button"><Text style={[LETRA.cuerpo, s.blanco]}>Cerrar</Text></Pressable>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  franja: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), paddingHorizontal: ESP(4), borderBottomWidth: 1, minHeight: TOQUE },
  accion: { paddingHorizontal: ESP(1) },
  lista: { padding: ESP(3), gap: ESP(2) },
  listaVacia: { flexGrow: 1, justifyContent: 'center' },
  centrado: { textAlign: 'center', paddingBottom: ESP(2) },
  vacio: { ...LETRA.cuerpo, textAlign: 'center', padding: ESP(6) },
  burbuja: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: ESP(3), paddingVertical: ESP(2), gap: ESP(2) },
  mia: { alignSelf: 'flex-end' },
  suya: { alignSelf: 'flex-start', borderWidth: 1 },
  pendiente: { opacity: 0.8 },
  foto: { minHeight: TOQUE, borderRadius: 12, overflow: 'hidden' },
  imagen: { height: 200, borderRadius: 12 },
  ficha: { minHeight: TOQUE, flexDirection: 'row', alignItems: 'center', gap: ESP(3), borderWidth: 1, borderRadius: 12, padding: ESP(3) },
  subiendo: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), paddingHorizontal: ESP(3), paddingTop: ESP(2) },
  mini: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
  miniImagen: { width: '100%', height: '100%' },
  compositor: { flexDirection: 'row', alignItems: 'flex-end', gap: ESP(2), margin: ESP(3), borderWidth: 1, borderRadius: 24, padding: ESP(1) },
  icono: { minHeight: TOQUE, minWidth: TOQUE, justifyContent: 'center', alignItems: 'center' },
  entrada: { ...LETRA.cuerpo, flex: 1, maxHeight: 140, minHeight: TOQUE, paddingHorizontal: ESP(1), paddingVertical: ESP(2) },
  enviar: { minHeight: TOQUE, minWidth: TOQUE, justifyContent: 'center', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'transparent' },
  visor: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center', padding: ESP(3), gap: ESP(3) },
  entera: { flex: 1, width: '100%' },
  pie: { color: '#ececee', textAlign: 'center' },
  botonesVisor: { flexDirection: 'row', gap: ESP(3), justifyContent: 'center', paddingBottom: ESP(4) },
  botonVisor: { minHeight: TOQUE, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: ESP(5) },
  blanco: { color: '#ececee' },
})
