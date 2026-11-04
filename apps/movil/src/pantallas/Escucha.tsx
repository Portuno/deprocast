/**
 * Escucha (plan v33, paso 3): el micrófono de verdad con la conciencia acústica. Prendés y apagás; mientras escucha se
 * ve el estado en vivo (dictado, escucha pasiva, silencio intencional, solo ruido), lo que se mandó y a dónde fue.
 * En segundo plano sigue escuchando, con el aviso fijo de Android.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { destinoDe, type Estado } from '../conciencia/acustica'
import type { Credenciales } from '../api'
import { useEscucha } from '../escucha'
import { useTema } from '../tema'

const NOMBRE: Record<Estado, string> = { dictado: 'Dictado', escucha: 'Escucha pasiva', silencio_intencional: 'Silencio intencional', ruido: 'Solo ruido' }
const QUE_HACE: Record<Estado, string> = {
  dictado: 'Lo acercaste y le hablás: va al chat de Hoy.',
  escucha: 'Pensás en voz alta con el teléfono lejos: queda como nota de voz.',
  silencio_intencional: 'Caminás callado: no se manda nada.',
  ruido: 'Ruido de fondo o voces de otros: no se manda ni se guarda.',
}

export function Escucha({ c }: { c: Credenciales }) {
  const t = useTema()
  const { activa, lectura: l, envios, error, empezar, parar } = useEscucha(c)
  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <Text style={[s.titulo, { color: t.texto }]}>Conciencia acústica</Text>
      <Text style={[s.texto, { color: t.tenue }]}>Escucho con el micrófono y el acelerómetro y decido acá, en el teléfono, si me estás hablando, pensando en voz alta o caminando callado. Solo sale tu voz: se transcribe y el audio se borra.</Text>
      <View style={[s.tarjeta, { backgroundColor: t.panel, borderColor: activa ? t.acento : t.linea }]}>
        <Text style={[s.estado, { color: activa ? t.acento : t.tenue }]}>{activa ? (l ? NOMBRE[l.estado] : 'Escuchando…') : 'Apagada'}</Text>
        <Text style={[s.texto, { color: t.texto }]}>{activa && l ? QUE_HACE[l.estado] : 'Tocá «Escuchar». Sigue aunque bloquees el teléfono (con un aviso fijo).'}</Text>
        {activa && l ? <Text style={[s.dato, { color: t.tenue }]}>fuente: {l.fuente === 'voz_directa' ? 'tu voz' : l.fuente} · distancia: {l.distancia} · señal/ruido: {l.snr} dB · piso: {l.piso} dB · se manda: {destinoDe(l.estado) ?? 'nada'}</Text> : null}
      </View>
      {error ? <Text style={[s.texto, { color: t.mal }]}>{error}</Text> : null}
      <Pressable onPress={activa ? parar : empezar} style={[s.boton, { backgroundColor: activa ? t.panel : t.acento, borderColor: t.linea }]} accessibilityRole="button">
        <Text style={{ color: activa ? t.texto : t.sobreAcento, fontWeight: '700', fontSize: 16 }}>{activa ? '■ Dejar de escuchar' : '● Escuchar'}</Text>
      </Pressable>
      {envios.length ? <Text style={[s.sub, { color: t.tenue }]}>Lo último que salió</Text> : null}
      {envios.map((e) => (
        <View key={e.en} style={[s.envio, { borderColor: t.linea }]}>
          <Text style={[s.dato, { color: t.tenue }]}>{new Date(e.en).toTimeString().slice(0, 5)} · {e.modo === 'dictado' ? 'al chat' : 'nota de voz'}{e.error ? ' · en cola (sin red)' : ''}</Text>
          {e.texto ? <Text style={{ color: t.texto, fontSize: 15 }}>{e.texto}</Text> : null}
        </View>
      ))}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  raiz: { padding: 20, gap: 14 },
  titulo: { fontSize: 22, fontWeight: '700' },
  texto: { fontSize: 15, lineHeight: 21 },
  sub: { fontSize: 13, marginTop: 8 },
  tarjeta: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  estado: { fontSize: 26, fontWeight: '700' },
  dato: { fontSize: 12, lineHeight: 18 },
  boton: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', borderWidth: 1 },
  envio: { borderBottomWidth: 1, paddingVertical: 8, gap: 4 },
})
