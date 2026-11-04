/** Vincular este teléfono: el servidor y el código de 6 dígitos que da Deprocast (Apps conectadas → 📱 Tus dispositivos). */
import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { vincular, type Credenciales } from '../api'
import { useTema } from '../tema'

export function Vincular({ alVincular }: { alVincular: (c: Credenciales) => void }) {
  const t = useTema()
  const [servidor, setServidor] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState(Platform.OS === 'ios' ? 'Mi iPhone' : 'Mi Android')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const listo = servidor.trim().length > 3 && codigo.replace(/\D/g, '').length === 6

  const ir = async () => {
    setCargando(true)
    setError(null)
    try { alVincular(await vincular(servidor, codigo, nombre)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setCargando(false) }
  }
  const campo = [s.campo, { backgroundColor: t.panel, borderColor: t.linea, color: t.texto }]
  return (
    <KeyboardAvoidingView style={[s.raiz, { backgroundColor: t.fondo }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={[s.titulo, { color: t.texto }]}>☿ Deprocast</Text>
      <Text style={[s.texto, { color: t.tenue }]}>En tu Deprocast, abrí Apps conectadas → 📱 Tus dispositivos → «Vincular un teléfono» y escribí acá el código.</Text>
      <Text style={[s.etiqueta, { color: t.tenue }]}>Servidor</Text>
      <TextInput style={campo} value={servidor} onChangeText={setServidor} placeholder="tu-deprocast.apps.nan.builders" placeholderTextColor={t.tenue} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Text style={[s.etiqueta, { color: t.tenue }]}>Código</Text>
      <TextInput style={[campo, s.codigo]} value={codigo} onChangeText={setCodigo} placeholder="123 456" placeholderTextColor={t.tenue} keyboardType="number-pad" maxLength={7} />
      <Text style={[s.etiqueta, { color: t.tenue }]}>Nombre de este teléfono</Text>
      <TextInput style={campo} value={nombre} onChangeText={setNombre} placeholderTextColor={t.tenue} />
      {error ? <Text style={[s.texto, { color: t.mal }]}>{error}</Text> : null}
      <Pressable onPress={ir} disabled={!listo || cargando} style={[s.boton, { backgroundColor: t.acento, opacity: listo && !cargando ? 1 : 0.5 }]} accessibilityRole="button">
        {cargando ? <ActivityIndicator color={t.sobreAcento} /> : <Text style={[s.botonTexto, { color: t.sobreAcento }]}>Vincular</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1, padding: 24, justifyContent: 'center', gap: 8 },
  titulo: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  texto: { fontSize: 15, lineHeight: 21 },
  etiqueta: { fontSize: 13, marginTop: 12 },
  campo: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  codigo: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  boton: { marginTop: 20, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  botonTexto: { fontSize: 16, fontWeight: '700' },
})
