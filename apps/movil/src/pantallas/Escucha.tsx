/**
 * Escucha (plan v33). En el paso 2 muestra cómo va a decidir la conciencia acústica, con una simulación que corre el
 * mismo módulo que va a usar el micrófono real (src/conciencia/acustica.ts). El micrófono, el detector de voz y los
 * sensores llegan en el paso 3 (necesitan código nativo y un dev build).
 */
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { crearConciencia, destinoDe, type Estado, type Lectura } from '../conciencia/acustica'
import { useTema } from '../tema'

const NOMBRE: Record<Estado, string> = { dictado: 'Dictado', escucha: 'Escucha pasiva', silencio_intencional: 'Silencio intencional', ruido: 'Solo ruido' }
const QUE_HACE: Record<Estado, string> = {
  dictado: 'Lo acercaste y le hablás: va al chat de Hoy.',
  escucha: 'Pensás en voz alta con el teléfono lejos: queda como nota de voz.',
  silencio_intencional: 'Caminás callado: no se manda nada.',
  ruido: 'Ruido de fondo o voces de otros: no se manda ni se guarda.',
}
/** Una escena de prueba: calle, lo acercás y dictás, lo bajás y pensás en voz alta, caminás callado. */
const ESCENA = [
  { ms: 3000, db: -45, voz: 0.1 }, { ms: 2500, db: -20, voz: 0.95, cerca: true }, { ms: 3000, db: -34, voz: 0.9, cerca: false },
  { ms: 7000, db: -45, voz: 0.05, caminando: true },
]

export function Escucha() {
  const t = useTema()
  const [l, setL] = useState<Lectura | null>(null)
  const [corriendo, setCorriendo] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  const simular = () => {
    const c = crearConciencia()
    const cuadros = ESCENA.flatMap((e) => Array.from({ length: e.ms / 100 }, () => e))
    let i = 0
    setCorriendo(true)
    timer.current = setInterval(() => {
      const e = cuadros[i]
      if (!e) { clearInterval(timer.current!); setCorriendo(false); return }
      setL(c.cuadro({ t: (i + 1) * 100, db: e.db, voz: e.voz, cerca: 'cerca' in e ? e.cerca : null, caminando: 'caminando' in e ? e.caminando : null }))
      i++
    }, 50) // al doble de velocidad
  }

  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <Text style={[s.titulo, { color: t.texto }]}>Conciencia acústica</Text>
      <Text style={[s.texto, { color: t.tenue }]}>Deprocast va a escuchar con el micrófono y los sensores, decidir en el teléfono si le estás hablando, pensando en voz alta o caminando callado, y mandar solo tu voz (el audio se transcribe y se borra). El micrófono llega en el próximo paso; esto muestra cómo decide.</Text>
      <View style={[s.tarjeta, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Text style={[s.estado, { color: t.acento }]}>{l ? NOMBRE[l.estado] : '—'}</Text>
        <Text style={[s.texto, { color: t.texto }]}>{l ? QUE_HACE[l.estado] : 'Tocá «Simular una caminata».'}</Text>
        {l ? <Text style={[s.dato, { color: t.tenue }]}>fuente: {l.fuente === 'voz_directa' ? 'tu voz' : l.fuente} · distancia: {l.distancia} · señal/ruido: {l.snr} dB · piso: {l.piso} dB · se manda: {destinoDe(l.estado) ?? 'nada'}</Text> : null}
      </View>
      <Pressable onPress={simular} disabled={corriendo} style={[s.boton, { backgroundColor: t.acento, opacity: corriendo ? 0.5 : 1 }]} accessibilityRole="button">
        <Text style={{ color: t.sobreAcento, fontWeight: '700' }}>{corriendo ? 'Simulando…' : 'Simular una caminata'}</Text>
      </Pressable>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  raiz: { padding: 20, gap: 14 },
  titulo: { fontSize: 22, fontWeight: '700' },
  texto: { fontSize: 15, lineHeight: 21 },
  tarjeta: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  estado: { fontSize: 26, fontWeight: '700' },
  dato: { fontSize: 12, lineHeight: 18 },
  boton: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
})
