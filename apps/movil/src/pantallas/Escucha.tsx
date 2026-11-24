/**
 * Escucha (Mobile 2.0): un botón grande que dice en qué está (Apagada, Escuchando, Grabando), cómo escucha (Auto, Solo
 * yo, Charla) y lo que se dijo. Nada más: la explicación larga se fue.
 * - Auto (por defecto): se da cuenta sola de que estás en una charla y graba también a los demás (logica/escucha.ts).
 * - Cada audio queda guardado en el teléfono: ▶ lo vuelve a tocar.
 * - Tocando quién habló le ponés nombre a esa voz («soy yo» o una persona tuya): desde ahí la reconoce.
 */
import { useCallback, useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { buscarPersonas, olvidarHablante, traerTurnos, vincularHablante, type Credenciales, type Hablante, type Turno } from '../api'
import type { AudioGuardado } from '../almacen'
import { audioCerca, audiosRecientes } from '../audios'
import { useEscuchaGlobal } from '../escuchaGlobal'
import { PREFERENCIAS } from '../logica/escucha'
import { tocar, useSonando } from '../reproductor'
import { AREA_EXTRA, ESP, LETRA, TOQUE, useTema } from '../tema'

const quien = (h: Hablante | null) => (h ? h.nombre ?? h.etiqueta : '¿Quién?')
const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const BOTON = 200

export function Escucha({ c }: { c: Credenciales }) {
  const t = useTema()
  const { activa, enCola, grabando, error, empezar, parar, conversacion, preferencia, setPreferencia, ultimo, sesion, retorno, cerrarRetorno, silenciar } = useEscuchaGlobal()
  const [, setTic] = useState(0)
  // Grabando, el contador de segundos avanza una vez por segundo.
  useEffect(() => { if (!grabando) return; const x = setInterval(() => setTic((n) => n + 1), 1000); return () => clearInterval(x) }, [grabando])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [audios, setAudios] = useState<AudioGuardado[]>([])
  const [elegido, setElegido] = useState<Hablante | null>(null)
  const sonando = useSonando()

  const traer = useCallback(async () => {
    setAudios(await audiosRecientes(24).catch(() => []))
    try { setTurnos((await traerTurnos(c, Date.now() - 24 * 3_600_000)).turnos) } catch { /* sin red: queda lo que había */ }
  }, [c])
  useEffect(() => { void traer() }, [traer, ultimo])
  useEffect(() => { if (!activa) return; const x = setInterval(traer, 8000); return () => clearInterval(x) }, [activa, traer])

  const color = grabando ? t.mal : activa ? t.acento : t.linea
  const segundos = grabando ? Math.max(0, Math.round((Date.now() - grabando.desde) / 1000)) : 0
  const titulo = !activa ? 'Apagada' : grabando ? `${segundos} s` : 'Escuchando'
  const bajada = !activa ? 'Tocá para escuchar' : grabando ? (grabando.conv ? '● Grabando la charla' : '● Grabando tu voz') : conversacion ? 'En una charla' : 'Atenta a tu voz'
  const cuenta = sesion ? [sesion.dictados && `${sesion.dictados} al chat`, sesion.notas && `${sesion.notas} nota${sesion.notas === 1 ? '' : 's'}`, sesion.charlas && `${sesion.charlas} de charla`, enCola && `${enCola} por subir`].filter(Boolean).join(' · ') : enCola ? `${enCola} por subir` : ''

  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <View style={s.centro}>
        <Pressable onPress={activa ? parar : empezar} style={[s.boton, { borderColor: color, backgroundColor: activa ? t.panel : 'transparent' }]} accessibilityRole="button" accessibilityLabel={activa ? 'Dejar de escuchar' : 'Escuchar'}>
          <View style={[s.nucleo, { backgroundColor: grabando ? t.mal : activa ? t.acento : t.panel }]}>
            <Text style={[LETRA.grande, { color: activa ? t.sobreAcento : t.tenue, fontWeight: '700' }]} numberOfLines={1}>{titulo}</Text>
          </View>
        </Pressable>
        <Text style={[LETRA.cuerpo, { color: grabando ? t.mal : activa ? t.acento : t.tenue, fontWeight: '600' }]} numberOfLines={1}>{bajada}</Text>
        {cuenta ? <Text style={[LETRA.chica, { color: t.tenue }]} numberOfLines={1}>{cuenta}</Text> : null}
      </View>

      <View style={[s.segmentos, { borderColor: t.linea }]} accessibilityRole="radiogroup">
        {PREFERENCIAS.map((p) => (
          <Pressable key={p.clave} onPress={() => setPreferencia(p.clave)} style={[s.segmento, preferencia === p.clave && { backgroundColor: t.acento }]} accessibilityRole="radio" accessibilityState={{ selected: preferencia === p.clave }}>
            <Text style={[LETRA.chica, { color: preferencia === p.clave ? t.sobreAcento : t.texto, fontWeight: '700' }]}>{p.nombre}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={[LETRA.chica, { color: t.mal, textAlign: 'center' }]}>{error}</Text> : null}
      {retorno ? (
        <Pressable onPress={cerrarRetorno} style={[s.aviso, { borderColor: t.linea }]} accessibilityRole="button" accessibilityLabel="Cerrar el aviso">
          <Text style={[LETRA.chica, { color: t.texto }]}>{retorno}</Text>
        </Pressable>
      ) : null}

      <Text style={[LETRA.chica, s.sub, { color: t.tenue }]}>LO QUE SE DIJO · 24 H</Text>
      {turnos.length ? [...turnos].reverse().map((x) => {
        const a = audioCerca(audios, x.inicio)
        return (
          <View key={x.id} style={[s.turno, { borderColor: t.linea }]}>
            <View style={s.cabTurno}>
              <Text style={[LETRA.chica, { color: t.tenue }]}>{hora(x.inicio)}</Text>
              <Pressable onPress={() => x.hablante && setElegido(x.hablante)} style={[s.chip, { borderColor: x.hablante?.nombre ? t.acento : t.linea }]} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel={`Ponerle nombre a ${quien(x.hablante)}`}>
                <Text style={[LETRA.chica, { color: x.hablante?.nombre ? t.acento : t.texto, fontWeight: '600' }]}>{quien(x.hablante)}</Text>
              </Pressable>
              <Text style={[LETRA.chica, { color: t.tenue, flex: 1 }]}>{x.modo === 'dictado' ? '→ chat' : x.modo === 'pasivo' ? '→ nota' : ''}</Text>
              {a ? (
                <Pressable onPress={() => tocar(a.id, a.uri, silenciar)} style={s.play} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel={sonando === a.id ? 'Parar' : 'Escuchar el audio'}>
                  <Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>{sonando === a.id ? '■' : '▶'}</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={[LETRA.cuerpo, { color: t.texto }]}>{x.texto}</Text>
          </View>
        )
      }) : <Text style={[LETRA.chica, { color: t.tenue }]}>Todavía nada.</Text>}

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
        <Text style={[LETRA.titulo, { color: t.texto, fontWeight: '700' }]}>¿Quién es {h ? quien(h) : ''}?</Text>
        <Pressable onPress={() => h && hacer(() => vincularHablante(c, h.id, { yo: true }))} style={[s.opcion, { borderColor: t.acento }]}><Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Soy yo</Text></Pressable>
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar en tus personas…" placeholderTextColor={t.tenue} style={[s.campo, { color: t.texto, borderColor: t.linea }]} autoCorrect={false} />
        {personas.map((p) => (
          <Pressable key={p.id} onPress={() => h && hacer(() => vincularHablante(c, h.id, { entidadId: p.id }))} style={[s.opcion, { borderColor: t.linea }]}><Text style={[LETRA.cuerpo, { color: t.texto }]}>{p.nombre}</Text></Pressable>
        ))}
        {error ? <Text style={[LETRA.chica, { color: t.mal }]}>{error}</Text> : null}
        <Pressable onPress={() => h && hacer(() => olvidarHablante(c, h.id))} style={s.olvidar}><Text style={[LETRA.cuerpo, { color: t.mal }]}>Olvidar esta voz</Text></Pressable>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(5), gap: ESP(4) },
  centro: { alignItems: 'center', gap: ESP(2), paddingVertical: ESP(4) },
  boton: { width: BOTON, height: BOTON, minHeight: TOQUE, borderRadius: BOTON, borderWidth: 2, padding: ESP(3), alignItems: 'center', justifyContent: 'center' },
  nucleo: { width: '100%', height: '100%', borderRadius: BOTON, alignItems: 'center', justifyContent: 'center', padding: ESP(4) },
  segmentos: { flexDirection: 'row', alignSelf: 'center', borderWidth: 1, borderRadius: 999, padding: ESP(1), gap: ESP(1) },
  segmento: { minHeight: TOQUE - ESP(2), minWidth: 88, justifyContent: 'center', alignItems: 'center', borderRadius: 999, paddingHorizontal: ESP(4) },
  aviso: { borderWidth: 1, borderRadius: 12, padding: ESP(3), minHeight: TOQUE, justifyContent: 'center' },
  sub: { marginTop: ESP(2), letterSpacing: 1 },
  turno: { borderBottomWidth: 1, paddingVertical: ESP(2), gap: ESP(1) },
  cabTurno: { flexDirection: 'row', alignItems: 'center', gap: ESP(2) },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: ESP(3), paddingVertical: ESP(1) },
  play: { minWidth: ESP(8), alignItems: 'center' },
  velo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  hoja: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, padding: ESP(5), gap: ESP(3), paddingBottom: ESP(9) },
  opcion: { minHeight: TOQUE, justifyContent: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: ESP(3) },
  campo: { ...LETRA.cuerpo, minHeight: TOQUE, borderWidth: 1, borderRadius: 10, paddingHorizontal: ESP(3), paddingVertical: ESP(2) },
  olvidar: { minHeight: TOQUE, justifyContent: 'center', alignItems: 'center' },
})
