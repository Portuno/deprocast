/**
 * Audios (Mobile 2.0): todo lo que grabó la escucha queda en el teléfono (audios.ts). Acá se escucha (▶), se comparte
 * (a WhatsApp, al Drive, a donde quieras) o se borra (manteniéndolo apretado). Arriba, cuánto ocupa; y un botón para
 * liberar lugar con lo de hace más de 30 días, que pregunta antes.
 */
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { shareAsync } from 'expo-sharing'
import type { AudioGuardado } from '../almacen'
import { borrarAudio, borrarAudiosAntesDe, espacioAudios, todosLosAudios } from '../audios'
import { useEscuchaGlobal } from '../escuchaGlobal'
import { tocar, useSonando } from '../reproductor'
import { alCambiar } from '../sincronizar'
import { AREA_EXTRA, ESP, LETRA, TOQUE, useTema } from '../tema'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1e6))} MB`)
const MODO: Record<string, string> = { dictado: '→ chat', pasivo: 'nota', conversacion: 'charla' }

export function Audios() {
  const t = useTema()
  const { silenciar } = useEscuchaGlobal()
  const sonando = useSonando()
  const [audios, setAudios] = useState<AudioGuardado[] | null>(null)
  const [espacio, setEspacio] = useState({ n: 0, bytes: 0, desde: null as number | null })

  const leer = useCallback(async () => { setAudios(await todosLosAudios()); setEspacio(await espacioAudios()) }, [])
  useEffect(() => { void leer(); return alCambiar(() => { void leer() }) }, [leer])

  // Agrupados por día.
  const secciones: { title: string; data: AudioGuardado[] }[] = []
  for (const a of audios ?? []) {
    const dia = new Date(a.inicio).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })
    if (secciones.at(-1)?.title !== dia) secciones.push({ title: dia, data: [] })
    secciones.at(-1)!.data.push(a)
  }

  const borrar = (a: AudioGuardado) => Alert.alert('¿Borrar este audio?', 'Se borra del teléfono (lo transcripto queda en Deprocast). No se puede deshacer.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: () => void borrarAudio(a).then(leer) },
  ])
  const liberar = () => Alert.alert('¿Borrar los de hace más de 30 días?', 'Se borran del teléfono para liberar lugar. Lo transcripto queda en Deprocast. No se puede deshacer.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: () => void borrarAudiosAntesDe(Date.now() - 30 * 86_400_000).then((n) => { Alert.alert('Listo', `${n} audio${n === 1 ? '' : 's'} borrado${n === 1 ? '' : 's'}.`); return leer() }) },
  ])

  return (
    <SectionList
      style={{ backgroundColor: t.fondo }}
      contentContainerStyle={s.raiz}
      sections={secciones}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={
        <View style={[s.caja, { backgroundColor: t.panel, borderColor: t.linea }]}>
          <Text style={[LETRA.titulo, { color: t.texto, fontWeight: '700' }]}>{espacio.n} audio{espacio.n === 1 ? '' : 's'} · {mb(espacio.bytes)}</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>Quedan en este teléfono. Mantené apretado uno para borrarlo.</Text>
          {espacio.desde && Date.now() - espacio.desde > 30 * 86_400_000 ? (
            <Pressable onPress={liberar} style={s.enlace} accessibilityRole="button"><Text style={[LETRA.chica, { color: t.acento, fontWeight: '700' }]}>Liberar lugar (más de 30 días)</Text></Pressable>
          ) : null}
        </View>
      }
      ListEmptyComponent={<Text style={[LETRA.cuerpo, s.vacio, { color: t.tenue }]}>{audios ? 'Todavía no hay audios. Lo que grabe la escucha queda acá.' : 'Cargando…'}</Text>}
      renderSectionHeader={({ section }) => <Text style={[LETRA.chica, s.dia, { color: t.tenue, backgroundColor: t.fondo }]}>{section.title.toUpperCase()}</Text>}
      stickySectionHeadersEnabled
      renderItem={({ item: a }) => (
        <Pressable onPress={() => tocar(a.id, a.uri, silenciar)} onLongPress={() => borrar(a)} style={[s.audio, { borderColor: t.linea }]} accessibilityRole="button" accessibilityLabel={sonando === a.id ? 'Parar' : 'Escuchar'}>
          <View style={[s.play, { backgroundColor: sonando === a.id ? t.acento : t.panel, borderColor: t.linea }]}>
            <Text style={[LETRA.cuerpo, { color: sonando === a.id ? t.sobreAcento : t.acento, fontWeight: '700' }]}>{sonando === a.id ? '■' : '▶'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[LETRA.chica, { color: t.tenue }]}>
              {hora(a.inicio)}{a.fin ? ` · ${Math.max(1, Math.round((a.fin - a.inicio) / 1000))} s` : ''} · {MODO[a.modo] ?? a.modo}{a.hablante ? ` · ${a.hablante}` : ''}
            </Text>
            <Text style={[LETRA.cuerpo, { color: a.texto ? t.texto : t.tenue }]} numberOfLines={3}>{a.texto || 'Sin transcripción'}</Text>
          </View>
          <Pressable onPress={() => void shareAsync(a.uri, { mimeType: 'audio/wav' }).catch(() => {})} style={s.compartir} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel="Compartir el audio">
            <Text style={[LETRA.cuerpo, { color: t.tenue }]}>↗</Text>
          </Pressable>
        </Pressable>
      )}
    />
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(4), gap: ESP(2) },
  caja: { borderWidth: 1, borderRadius: 16, padding: ESP(4), gap: ESP(1), marginBottom: ESP(2) },
  enlace: { minHeight: TOQUE, justifyContent: 'center' },
  vacio: { textAlign: 'center', padding: ESP(6) },
  dia: { paddingTop: ESP(3), paddingBottom: ESP(1), letterSpacing: 1 },
  audio: { minHeight: TOQUE + ESP(4), flexDirection: 'row', alignItems: 'center', gap: ESP(3), borderBottomWidth: 1, paddingVertical: ESP(2) },
  play: { width: TOQUE, height: TOQUE, borderRadius: TOQUE, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  compartir: { paddingHorizontal: ESP(2) },
})
