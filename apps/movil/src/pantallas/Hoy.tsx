/**
 * Hoy, en el teléfono (local-first): se dibuja al instante con lo guardado; la sincronización de la app la mantiene al
 * día (la marca cada 5 s con la app abierta, enseguida al volver del segundo plano) y esta pantalla se redibuja cuando
 * termina. Tirando hacia abajo se sincroniza a mano. Lo que escribís aparece enseguida; sin red, queda «en cola».
 * Estados explícitos (Mobile 1.0): cargando la primera vez, vacío, y el error con «Reintentar» (nunca un spinner eterno).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Credenciales } from '../api'
import { encolar, estadoSincro, leerChat, type EstadoSincro, type MensajeLocal } from '../almacen'
import { alCambiar, sincronizar } from '../sincronizar'
import { VIEJO_MS } from '../logica/sincro'
import { AREA_EXTRA, ESP, LETRA, TOQUE, useTema } from '../tema'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export function Hoy({ c }: { c: Credenciales }) {
  const t = useTema()
  const [mensajes, setMensajes] = useState<MensajeLocal[] | null>(null)
  const [paraValidar, setParaValidar] = useState(0)
  const [texto, setTexto] = useState('')
  const [sincro, setSincro] = useState<EstadoSincro>({ sincronizadoEn: null, error: null, marca: null })
  const [tirando, setTirando] = useState(false)
  const [, setAhora] = useState(Date.now())
  const lista = useRef<FlatList<MensajeLocal>>(null)

  const pintar = useCallback(async () => {
    const l = await leerChat()
    setMensajes(l.mensajes)
    setParaValidar(l.paraValidar)
    setSincro(await estadoSincro())
  }, [])

  useEffect(() => {
    void pintar() // lo guardado, al instante
    const sacar = alCambiar(() => { void pintar() })
    const reloj = setInterval(() => setAhora(Date.now()), 30_000) // para que «Actualizado» envejezca a la vista
    return () => { sacar(); clearInterval(reloj) }
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

  const viejo = sincro.sincronizadoEn != null && Date.now() - sincro.sincronizadoEn > VIEJO_MS
  const aviso = sincro.error
    ? `No pude actualizar: ${sincro.error}${sincro.sincronizadoEn ? ` · lo de las ${hora(sincro.sincronizadoEn)}` : ''}`
    : sincro.sincronizadoEn ? `Actualizado ${hora(sincro.sincronizadoEn)}${viejo ? ' · tirá para actualizar' : ''}` : null

  return (
    <KeyboardAvoidingView style={[s.raiz, { backgroundColor: t.fondo }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={60}>
      {aviso ? (
        <View style={[s.aviso, { borderColor: t.linea }]}>
          <Text style={[s.avisoTexto, { color: sincro.error ? t.mal : t.tenue }]} numberOfLines={2}>{aviso}</Text>
          {sincro.error ? <Pressable onPress={actualizar} style={s.reintentar} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel="Reintentar"><Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Reintentar</Text></Pressable> : null}
        </View>
      ) : null}
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
        <TextInput style={[s.entrada, { color: t.texto }]} value={texto} onChangeText={setTexto} placeholder="Escribile a Mastropiero…" placeholderTextColor={t.tenue} multiline keyboardAppearance={t.fondo === '#0f1012' ? 'dark' : 'light'} />
        <Pressable onPress={mandar} style={[s.enviar, { backgroundColor: t.acento }]} accessibilityRole="button" accessibilityLabel="Enviar">
          <Text style={[LETRA.cuerpo, { color: t.sobreAcento, fontWeight: '700' }]}>Enviar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), paddingHorizontal: ESP(4), borderBottomWidth: 1 },
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
})
