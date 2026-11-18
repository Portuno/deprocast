/**
 * Validar en 5 minutos: lo que más pesa de «Para validar», de a una tarjeta. Deslizá a la derecha para sí y a la
 * izquierda para no (un gesto marcado: no hay deshacer), o usá los botones; «Después» la deja para otra tanda.
 * Tandas de 10, y al terminar, otra si querés.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, Text, Vibration, View } from 'react-native'
import { responderTarjeta, traerTanda, type Credenciales, type Tarjeta } from '../api'
import { cierreDeTanda, decidirDeslizar } from '../logica/validar'
import { ESP, LETRA, TOQUE, useTema } from '../tema'

export function Validar({ c, alCambiar }: { c: Credenciales; alCambiar?: (quedan: number) => void }) {
  const t = useTema()
  const [tanda, setTanda] = useState<Tarjeta[] | null>(null)
  const [i, setI] = useState(0)
  const [quedan, setQuedan] = useState(0)
  const [respondidas, setRespondidas] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [mandando, setMandando] = useState(false)
  const pos = useRef(new Animated.ValueXY()).current
  const actual = useRef<{ tarjeta: Tarjeta | null; mandando: boolean }>({ tarjeta: null, mandando: false })

  const cargar = useCallback(async () => {
    setError(null)
    setTanda(null)
    try {
      const r = await traerTanda(c, 10)
      setTanda(r.tarjetas)
      setQuedan(r.total)
      setI(0)
      setRespondidas(0)
      alCambiar?.(r.total)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setTanda([]) }
  }, [c, alCambiar])
  useEffect(() => { void cargar() }, [cargar])

  const tarjeta = tanda?.[i] ?? null
  actual.current.tarjeta = tarjeta
  actual.current.mandando = mandando

  const siguiente = useCallback(() => { pos.setValue({ x: 0, y: 0 }); setI((x) => x + 1) }, [pos])

  const responder = useCallback(async (accion: 'aceptar' | 'descartar' | null) => {
    const x = actual.current.tarjeta
    if (!x || actual.current.mandando) return
    if (!accion) return siguiente()
    setMandando(true)
    try {
      await responderTarjeta(c, x, accion)
      Vibration.vibrate(12)
      setRespondidas((n) => n + 1)
      setQuedan((n) => { const q = Math.max(0, n - 1); alCambiar?.(q); return q })
      siguiente()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start()
    } finally { setMandando(false) }
  }, [c, alCambiar, pos, siguiente])

  const volar = useCallback((accion: 'aceptar' | 'descartar') => {
    Animated.timing(pos, { toValue: { x: accion === 'aceptar' ? 500 : -500, y: 0 }, duration: 180, useNativeDriver: false }).start(() => { void responder(accion) })
  }, [pos, responder])

  const gestos = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: Animated.event([null, { dx: pos.x }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      const d = actual.current.mandando ? null : decidirDeslizar(g.dx, g.vx)
      if (d) volar(d)
      else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start()
    },
    onPanResponderTerminate: () => Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(),
  })).current

  if (tanda == null) return <View style={s.centro}><ActivityIndicator color={t.acento} /></View>

  if (!tarjeta) {
    return (
      <View style={[s.centro, { gap: ESP(4) }]}>
        <Text style={[LETRA.titulo, { color: t.texto, textAlign: 'center' }]}>{tanda.length ? 'Listo' : 'Nada para validar'}</Text>
        <Text style={[LETRA.cuerpo, { color: t.tenue, textAlign: 'center' }]}>{tanda.length ? cierreDeTanda(respondidas, quedan) : quedan ? 'Lo que espera necesita la pantalla grande (pesar quántomos, nombres del archivo).' : 'Cuando Mastropiero proponga algo, aparece acá.'}</Text>
        {error ? <Text style={[LETRA.chica, { color: t.mal, textAlign: 'center' }]}>{error}</Text> : null}
        <Pressable onPress={() => void cargar()} style={[s.boton, s.ancho, { backgroundColor: t.acento }]} accessibilityRole="button">
          <Text style={[LETRA.cuerpo, { color: t.sobreAcento, fontWeight: '700' }]}>{tanda.length ? 'Otra tanda' : 'Buscar de nuevo'}</Text>
        </Pressable>
      </View>
    )
  }

  const giro = pos.x.interpolate({ inputRange: [-240, 0, 240], outputRange: ['-8deg', '0deg', '8deg'] })
  const si = pos.x.interpolate({ inputRange: [0, 110], outputRange: [0, 1], extrapolate: 'clamp' })
  const no = pos.x.interpolate({ inputRange: [-110, 0], outputRange: [1, 0], extrapolate: 'clamp' })
  return (
    <View style={s.raiz}>
      <Text style={[LETRA.chica, { color: t.tenue }]}>{i + 1} de {tanda.length} · quedan {quedan.toLocaleString('es-AR')} en total</Text>
      <Animated.View {...gestos.panHandlers} style={[s.tarjeta, { backgroundColor: t.panel, borderColor: t.linea, transform: [{ translateX: pos.x }, { rotate: giro }] }]} accessibilityHint="Deslizá a la derecha para sí, a la izquierda para no">
        <Animated.Text style={[LETRA.chica, s.sello, { color: t.ok, borderColor: t.ok, opacity: si, right: ESP(4) }]}>{tarjeta.si.toUpperCase()}</Animated.Text>
        <Animated.Text style={[LETRA.chica, s.sello, { color: t.mal, borderColor: t.mal, opacity: no, left: ESP(4) }]}>{tarjeta.no.toUpperCase()}</Animated.Text>
        <Text style={[LETRA.chica, { color: t.acento, fontWeight: '700' }]} numberOfLines={1}>{tarjeta.grupo}</Text>
        <Text style={[LETRA.titulo, { color: t.texto }]} numberOfLines={7}>{tarjeta.texto}</Text>
        {tarjeta.sub ? <Text style={[LETRA.cuerpo, { color: t.tenue }]} numberOfLines={6}>{tarjeta.sub}</Text> : null}
      </Animated.View>
      {error ? <Text style={[LETRA.chica, { color: t.mal }]}>{error}</Text> : null}
      <View style={s.botones}>
        <Pressable disabled={mandando} onPress={() => volar('descartar')} style={[s.boton, { borderColor: t.mal, borderWidth: 1 }]} accessibilityRole="button" accessibilityLabel={`No: ${tarjeta.no}`}>
          <Text style={[LETRA.cuerpo, { color: t.mal, fontWeight: '700' }]} numberOfLines={1}>✕ {tarjeta.no}</Text>
        </Pressable>
        <Pressable disabled={mandando} onPress={() => void responder(null)} style={[s.boton, { borderColor: t.linea, borderWidth: 1 }]} accessibilityRole="button">
          <Text style={[LETRA.cuerpo, { color: t.tenue }]}>Después</Text>
        </Pressable>
        <Pressable disabled={mandando} onPress={() => volar('aceptar')} style={[s.boton, { backgroundColor: t.ok }]} accessibilityRole="button" accessibilityLabel={`Sí: ${tarjeta.si}`}>
          <Text style={[LETRA.cuerpo, { color: t.sobreAcento, fontWeight: '700' }]} numberOfLines={1}>✓ {tarjeta.si}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1, padding: ESP(4), gap: ESP(4) },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: ESP(6) },
  tarjeta: { flex: 1, borderWidth: 1, borderRadius: 16, padding: ESP(5), paddingTop: ESP(10), gap: ESP(3), justifyContent: 'center' },
  sello: { position: 'absolute', top: ESP(4), borderWidth: 2, borderRadius: 8, paddingVertical: ESP(1), paddingHorizontal: ESP(2), fontWeight: '800', letterSpacing: 1 },
  botones: { flexDirection: 'row', gap: ESP(2) },
  boton: { flex: 1, minHeight: TOQUE, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: ESP(2) },
  ancho: { alignSelf: 'stretch' },
})
