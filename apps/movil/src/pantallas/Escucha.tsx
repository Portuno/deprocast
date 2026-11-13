/**
 * Escucha (plan v33): el micrófono con la conciencia acústica.
 * - Normal: solo tu voz (dictado → chat de Hoy, pensar en voz alta → nota).
 * - Modo conversación (lo prendés vos, con aviso visible): graba a todos y corta por turnos; cada turno vuelve con su
 *   hablante (Hablante 1, 2… o su nombre si ya lo vinculaste). Tocando un hablante le ponés nombre: «soy yo» o una
 *   persona de tus entidades. Desde ahí lo reconoce.
 * Abajo, «Lo que se dijo»: la lista con la hora, quién y qué.
 */
import { useCallback, useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { destinoDe, type Estado } from '../conciencia/acustica'
import { buscarPersonas, olvidarHablante, traerTurnos, vincularHablante, type Credenciales, type Hablante, type Turno } from '../api'
import { useEscucha } from '../escucha'
import { AREA_EXTRA, ESP, LETRA, TOQUE, useTema } from '../tema'

const NOMBRE: Record<Estado, string> = { dictado: 'Dictado', escucha: 'Escucha pasiva', silencio_intencional: 'Silencio intencional', ruido: 'Solo ruido' }
const QUE_HACE: Record<Estado, string> = {
  dictado: 'Lo acercaste y le hablás: va al chat de Hoy.',
  escucha: 'Pensás en voz alta con el teléfono lejos: queda como nota de voz.',
  silencio_intencional: 'Caminás callado: no se manda nada.',
  ruido: 'Ruido de fondo o voces de otros: no se manda ni se guarda.',
}
const quien = (h: Hablante | null) => (h ? h.nombre ?? h.etiqueta : 'Sin identificar')
const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export function Escucha({ c }: { c: Credenciales }) {
  const t = useTema()
  const { activa, lectura: l, enCola, error, empezar, parar, conversacion, setConversacion, ultimo } = useEscucha(c)
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [elegido, setElegido] = useState<Hablante | null>(null)

  const traer = useCallback(async () => { try { setTurnos((await traerTurnos(c, Date.now() - 24 * 3_600_000)).turnos) } catch { /* sin red: queda lo que había */ } }, [c])
  useEffect(() => { void traer() }, [traer, ultimo])
  useEffect(() => { if (!activa) return; const x = setInterval(traer, 8000); return () => clearInterval(x) }, [activa, traer])

  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <Text style={[s.titulo, { color: t.texto }]}>Conciencia acústica</Text>
      <View style={[s.tarjeta, { backgroundColor: t.panel, borderColor: activa ? t.acento : t.linea }]}>
        <Text style={[s.estado, { color: activa ? t.acento : t.tenue }]}>{activa ? (conversacion ? 'Conversación' : l ? NOMBRE[l.estado] : 'Escuchando…') : 'Apagada'}</Text>
        <Text style={[s.texto, { color: t.texto }]}>{!activa ? 'Tocá «Escuchar». Sigue aunque bloquees el teléfono (con un aviso fijo).' : conversacion ? 'Grabo a todos y separo por turnos y por voz. Avisales a los demás que estás grabando.' : l ? QUE_HACE[l.estado] : ''}</Text>
        {activa && l ? <Text style={[s.dato, { color: t.tenue }]}>fuente: {l.fuente === 'voz_directa' ? 'tu voz' : l.fuente} · distancia: {l.distancia} · señal/ruido: {l.snr} dB · se manda: {conversacion ? 'todo lo que se dice' : destinoDe(l.estado) ?? 'nada'}</Text> : null}
      </View>
      <View style={[s.fila, { borderColor: t.linea }]}>
        <View style={{ flex: 1 }}>
          <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '600' }]}>Modo conversación</Text>
          <Text style={[s.dato, { color: t.tenue }]}>Graba también a los demás y reconoce quién habla. El audio se borra; las huellas de voz quedan solo en tu Deprocast.</Text>
        </View>
        <Switch value={conversacion} onValueChange={setConversacion} trackColor={{ true: t.acento }} />
      </View>
      {error ? <Text style={[s.texto, { color: t.mal }]}>{error}</Text> : null}
      <Pressable onPress={activa ? parar : empezar} style={[s.boton, { backgroundColor: activa ? t.panel : t.acento, borderColor: t.linea }]} accessibilityRole="button">
        <Text style={[LETRA.cuerpo, { color: activa ? t.texto : t.sobreAcento, fontWeight: '700' }]}>{activa ? '■ Dejar de escuchar' : '● Escuchar'}</Text>
      </Pressable>
      {enCola ? <Text style={[s.dato, { color: t.tenue }]}>{enCola} tramo(s) guardados en el teléfono: salen solos cuando haya red.</Text> : null}

      <Text style={[s.sub, { color: t.tenue }]}>Lo que se dijo (últimas 24 h)</Text>
      {turnos.length ? [...turnos].reverse().map((x) => (
        <View key={x.id} style={[s.turno, { borderColor: t.linea }]}>
          <View style={s.cabTurno}>
            <Text style={[s.dato, { color: t.tenue }]}>{hora(x.inicio)}</Text>
            <Pressable onPress={() => x.hablante && setElegido(x.hablante)} style={[s.chip, { borderColor: x.hablante?.nombre ? t.acento : t.linea }]} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel={`Ponerle nombre a ${quien(x.hablante)}`}>
              <Text style={[LETRA.chica, { color: x.hablante?.nombre ? t.acento : t.texto, fontWeight: '600' }]}>{quien(x.hablante)}</Text>
            </Pressable>
            <Text style={[s.dato, { color: t.tenue }]}>{x.modo === 'dictado' ? '→ chat' : x.modo === 'pasivo' ? '→ nota' : ''}</Text>
          </View>
          <Text style={[LETRA.cuerpo, { color: t.texto }]}>{x.texto}</Text>
        </View>
      )) : <Text style={[s.dato, { color: t.tenue }]}>Todavía nada.</Text>}

      <ElegirPersona c={c} h={elegido} cerrar={(cambio) => { setElegido(null); if (cambio) void traer() }} />
    </ScrollView>
  )
}

/** Ponerle nombre a una voz: «soy yo», una persona de tus entidades, o olvidarla. */
function ElegirPersona({ c, h, cerrar }: { c: Credenciales; h: Hablante | null; cerrar: (cambio: boolean) => void }) {
  const t = useTema()
  const [q, setQ] = useState('')
  const [personas, setPersonas] = useState<{ id: number; nombre: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setQ(''); setPersonas([]); setError(null) }, [h])
  useEffect(() => {
    if (!h || q.trim().length < 2) return setPersonas([])
    const x = setTimeout(() => { buscarPersonas(c, q).then((r) => setPersonas(r.personas)).catch(() => {}) }, 250)
    return () => clearTimeout(x)
  }, [q, c, h])
  const hacer = async (f: () => Promise<unknown>) => { try { await f(); cerrar(true) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  return (
    <Modal visible={!!h} transparent animationType="slide" onRequestClose={() => cerrar(false)}>
      <Pressable style={s.velo} onPress={() => cerrar(false)} />
      <View style={[s.hoja, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Text style={[s.titulo, { color: t.texto }]}>¿Quién es {h ? quien(h) : ''}?</Text>
        <Text style={[s.dato, { color: t.tenue }]}>{h ? `${h.tramos} tramo(s) de esta voz.` : ''} Al ponerle nombre, la reconozco de acá en más.</Text>
        <Pressable onPress={() => h && hacer(() => vincularHablante(c, h.id, { yo: true }))} style={[s.opcion, { borderColor: t.acento }]}><Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Soy yo</Text></Pressable>
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar en tus personas…" placeholderTextColor={t.tenue} style={[s.campo, { color: t.texto, borderColor: t.linea }]} autoCorrect={false} />
        {personas.map((p) => (
          <Pressable key={p.id} onPress={() => h && hacer(() => vincularHablante(c, h.id, { entidadId: p.id }))} style={[s.opcion, { borderColor: t.linea }]}><Text style={[LETRA.cuerpo, { color: t.texto }]}>{p.nombre}</Text></Pressable>
        ))}
        {error ? <Text style={[s.dato, { color: t.mal }]}>{error}</Text> : null}
        <Pressable onPress={() => h && hacer(() => olvidarHablante(c, h.id))} style={s.olvidar}><Text style={[LETRA.cuerpo, { color: t.mal }]}>Olvidar esta voz (borra su huella)</Text></Pressable>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(5), gap: ESP(4) },
  titulo: { ...LETRA.titulo, fontWeight: '700' },
  texto: { ...LETRA.cuerpo },
  sub: { ...LETRA.chica, marginTop: ESP(2) },
  tarjeta: { borderWidth: 1, borderRadius: 14, padding: ESP(4), gap: ESP(2) },
  estado: { ...LETRA.grande, fontWeight: '700' },
  dato: { ...LETRA.chica },
  fila: { flexDirection: 'row', alignItems: 'center', gap: ESP(3), borderWidth: 1, borderRadius: 12, padding: ESP(3), minHeight: TOQUE },
  boton: { minHeight: TOQUE + ESP(3), justifyContent: 'center', borderRadius: 12, paddingVertical: ESP(4), alignItems: 'center', borderWidth: 1 },
  turno: { borderBottomWidth: 1, paddingVertical: ESP(2), gap: ESP(1) },
  cabTurno: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: ESP(3), paddingVertical: ESP(1) },
  velo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  hoja: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, padding: ESP(5), gap: ESP(3), paddingBottom: ESP(9) },
  opcion: { minHeight: TOQUE, justifyContent: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: ESP(3) },
  campo: { ...LETRA.cuerpo, minHeight: TOQUE, borderWidth: 1, borderRadius: 10, paddingHorizontal: ESP(3), paddingVertical: ESP(2) },
  olvidar: { minHeight: TOQUE, justifyContent: 'center', alignItems: 'center' },
})
