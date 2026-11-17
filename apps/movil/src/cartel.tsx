/**
 * Un cartel discreto arriba (Fragua #313): confirma algo («Mandado a Deprocast») sin tapar nada ni pedir que lo cierres.
 * Se va solo a los 2,5 s; no recibe toques (lo de abajo se sigue usando).
 */
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ESP, LETRA, useTema } from './tema'

export const DURA_CARTEL = 2500

export function Cartel({ texto, cerrar }: { texto: string | null; cerrar: () => void }) {
  const t = useTema()
  const bordes = useSafeAreaInsets()
  useEffect(() => {
    if (!texto) return
    const x = setTimeout(cerrar, DURA_CARTEL)
    return () => clearTimeout(x)
  }, [texto, cerrar])
  if (!texto) return null
  return (
    <View style={[s.cartel, { pointerEvents: 'none', top: bordes.top + ESP(1), backgroundColor: t.panel, borderColor: t.linea }]} accessibilityLiveRegion="polite">
      <Text style={[LETRA.chica, { color: t.texto }]} numberOfLines={2}>{texto}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  cartel: { position: 'absolute', left: ESP(4), right: ESP(4), borderWidth: 1, borderRadius: 12, paddingVertical: ESP(2), paddingHorizontal: ESP(3), elevation: 4, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
})
