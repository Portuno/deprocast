/**
 * Compartir → Deprocast (Mobile 1.3). Desde cualquier app (una foto, un link de YouTube o Instagram, un texto de WhatsApp,
 * una nota de voz reenviada, un PDF), «Compartir» y elegir Deprocast abre esta pantalla: se ve qué llegó, se le puede
 * agregar una nota y sale. Los textos y links van como mensaje a Mastropiero; fotos, videos, audios y documentos, a la
 * cola de archivos (sin red, esperan en el teléfono).
 */
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Credenciales } from '../api'
import { encolar } from '../almacen'
import { encolarCompartidos } from '../archivos'
import { sincronizar } from '../sincronizar'
import { armarCompartido, type Compartido } from '../logica/archivos'
import { ESP, LETRA, TOQUE, useTema } from '../tema'

const ICONO: Record<string, string> = { text: '💬', url: '🔗', image: '🖼', video: '🎬', audio: '🎧', file: '📄' }

export function Compartir({ c, items, resolviendo, listo }: { c: Credenciales; items: Compartido[]; resolviendo: boolean; listo: (mensaje: string | null) => void }) {
  const t = useTema()
  const [nota, setNota] = useState('')
  const [mandando, setMandando] = useState(false)
  const hayArchivos = items.some((x) => x.shareType && x.shareType !== 'text' && x.shareType !== 'url')

  const mandar = async () => {
    setMandando(true)
    try {
      const a = armarCompartido(items, nota)
      if (a.mensaje) await encolar(a.mensaje)
      // Con un mensaje, la nota ya va en él; si no, va con cada archivo.
      const n = a.archivos.length ? await encolarCompartidos(c, a.archivos, a.mensaje ? null : nota) : 0
      if (a.mensaje && !n) void sincronizar(c)
      const partes = [a.mensaje ? 'el mensaje' : null, n ? `${n} archivo${n === 1 ? '' : 's'}` : null].filter(Boolean)
      listo(partes.length ? `📤 Mandé a Deprocast ${partes.join(' y ')}${n ? ' (sale con red: lo que resulte aparece en Hoy)' : ''}.` : 'No había nada para mandar.')
    } catch (e) {
      listo(`No pude mandarlo: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setMandando(false) }
  }

  return (
    <View style={[s.raiz, { backgroundColor: t.fondo }]}>
      <View style={s.cab}>
        <Text style={[s.titulo, { color: t.texto }]}>Mandar a Deprocast</Text>
        <Pressable onPress={() => listo(null)} style={s.boton} accessibilityRole="button" accessibilityLabel="Cancelar"><Text style={[LETRA.cuerpo, { color: t.tenue }]}>Cancelar</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.lista}>
        {items.map((x, i) => {
          const tipo = x.shareType ?? 'text'
          const texto = tipo === 'text' || tipo === 'url' ? (x.value ?? '') : (x.originalName ?? x.contentMimeType ?? x.mimeType ?? 'archivo')
          return (
            <View key={i} style={[s.item, { borderColor: t.linea, backgroundColor: t.panel }]}>
              <Text style={LETRA.cuerpo}>{ICONO[tipo] ?? '📄'}</Text>
              <Text style={[LETRA.chica, { color: t.texto, flex: 1 }]} numberOfLines={6}>{texto}</Text>
            </View>
          )
        })}
        {resolviendo && hayArchivos ? <View style={s.fila}><ActivityIndicator color={t.acento} /><Text style={[LETRA.chica, { color: t.tenue }]}>Preparando los archivos…</Text></View> : null}
      </ScrollView>
      <TextInput
        value={nota}
        onChangeText={setNota}
        placeholder="Una nota (opcional): para qué es, qué querés que haga"
        placeholderTextColor={t.tenue}
        multiline
        style={[s.nota, { color: t.texto, borderColor: t.linea }]}
        accessibilityLabel="Nota"
      />
      <Pressable onPress={mandar} disabled={mandando || (resolviendo && hayArchivos)} style={[s.mandar, { backgroundColor: t.acento, opacity: mandando || (resolviendo && hayArchivos) ? 0.6 : 1 }]} accessibilityRole="button" accessibilityLabel="Mandar a Deprocast">
        <Text style={[LETRA.cuerpo, { color: t.sobreAcento, fontWeight: '700' }]}>{mandando ? 'Mandando…' : 'Mandar'}</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1, padding: ESP(4), gap: ESP(3) },
  cab: { flexDirection: 'row', alignItems: 'center', gap: ESP(2) },
  titulo: { ...LETRA.titulo, fontWeight: '700', flex: 1 },
  boton: { minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(2) },
  lista: { gap: ESP(2) },
  item: { flexDirection: 'row', gap: ESP(3), borderWidth: 1, borderRadius: 12, padding: ESP(3) },
  fila: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), minHeight: TOQUE },
  nota: { ...LETRA.cuerpo, borderWidth: 1, borderRadius: 12, padding: ESP(3), minHeight: TOQUE * 2, maxHeight: 160 },
  mandar: { minHeight: TOQUE, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
})
