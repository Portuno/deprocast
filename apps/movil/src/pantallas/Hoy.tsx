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
import { useTema } from '../tema'

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
          {sincro.error ? <Pressable onPress={actualizar} style={s.reintentar} accessibilityRole="button" accessibilityLabel="Reintentar"><Text style={{ color: t.acento, fontWeight: '700' }}>Reintentar</Text></Pressable> : null}
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
            <Text style={{ color: m.rol === 'operador' ? t.sobreAcento : t.texto, fontSize: 15, lineHeight: 21 }}>{m.texto}</Text>
            {m.pendiente ? <Text style={[s.pendiente, { color: t.sobreAcento }]}>en cola</Text> : null}
          </View>
        )}
      />
      <View style={[s.compositor, { borderColor: t.linea, backgroundColor: t.panel }]}>
        <TextInput style={[s.entrada, { color: t.texto }]} value={texto} onChangeText={setTexto} placeholder="Escribile a Mastropiero…" placeholderTextColor={t.tenue} multiline />
        <Pressable onPress={mandar} style={[s.enviar, { backgroundColor: t.acento }]} accessibilityRole="button" accessibilityLabel="Enviar">
          <Text style={{ color: t.sobreAcento, fontWeight: '700' }}>Enviar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderBottomWidth: 1 },
  avisoTexto: { flex: 1, fontSize: 13, paddingVertical: 8 },
  validar: { paddingHorizontal: 16, borderBottomWidth: 1 },
  reintentar: { paddingHorizontal: 8, paddingVertical: 8 },
  lista: { padding: 12, gap: 8 },
  listaVacia: { flexGrow: 1, justifyContent: 'center' },
  vacio: { textAlign: 'center', fontSize: 15, padding: 24 },
  burbuja: { maxWidth: '86%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  mia: { alignSelf: 'flex-end' },
  suya: { alignSelf: 'flex-start', borderWidth: 1 },
  pendiente: { fontSize: 11, opacity: 0.7, marginTop: 2 },
  compositor: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 10, borderWidth: 1, borderRadius: 14, padding: 6 },
  entrada: { flex: 1, fontSize: 16, maxHeight: 140, paddingHorizontal: 8, paddingVertical: 8 },
  enviar: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
})
