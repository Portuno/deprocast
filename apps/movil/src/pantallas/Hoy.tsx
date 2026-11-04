/**
 * Hoy, en el teléfono (local-first): se dibuja al instante con lo guardado, después sincroniza (y cada 15 s mientras
 * está abierta). Lo que escribís aparece enseguida; si no hay red, queda «en cola» y sale solo.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Credenciales } from '../api'
import { encolar, leerChat, type MensajeLocal } from '../almacen'
import { sincronizar } from '../sincronizar'
import { useTema } from '../tema'

export function Hoy({ c }: { c: Credenciales }) {
  const t = useTema()
  const [mensajes, setMensajes] = useState<MensajeLocal[]>([])
  const [paraValidar, setParaValidar] = useState(0)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<string | null>(null)
  const lista = useRef<FlatList<MensajeLocal>>(null)

  const pintar = useCallback(async () => { const l = await leerChat(); setMensajes(l.mensajes); setParaValidar(l.paraValidar) }, [])
  const sync = useCallback(async () => {
    const r = await sincronizar(c)
    setEstado(r.ok ? null : `Sin conexión: ${r.error}`)
    await pintar()
  }, [c, pintar])

  useEffect(() => {
    void pintar().then(sync) // primero lo guardado (instantáneo), después la red
    const cada = setInterval(sync, 15_000)
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') void sync() })
    return () => { clearInterval(cada); app.remove() }
  }, [pintar, sync])

  const mandar = async () => {
    const x = texto.trim()
    if (!x) return
    setTexto('')
    await encolar(x)
    await pintar()
    void sync()
  }

  return (
    <KeyboardAvoidingView style={[s.raiz, { backgroundColor: t.fondo }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={60}>
      {estado ? <Text style={[s.aviso, { color: t.tenue, borderColor: t.linea }]}>{estado}</Text> : null}
      {paraValidar ? <Text style={[s.aviso, { color: t.acento, borderColor: t.linea }]}>📥 {paraValidar} esperan tu ok (se validan en la compu)</Text> : null}
      <FlatList
        ref={lista}
        data={mensajes}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.lista}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: false })}
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
  aviso: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  lista: { padding: 12, gap: 8 },
  burbuja: { maxWidth: '86%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  mia: { alignSelf: 'flex-end' },
  suya: { alignSelf: 'flex-start', borderWidth: 1 },
  pendiente: { fontSize: 11, opacity: 0.7, marginTop: 2 },
  compositor: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 10, borderWidth: 1, borderRadius: 14, padding: 6 },
  entrada: { flex: 1, fontSize: 16, maxHeight: 140, paddingHorizontal: 8, paddingVertical: 8 },
  enviar: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
})
