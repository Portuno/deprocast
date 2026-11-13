/**
 * Deprocast en el teléfono (plan v33, paso 2). Sin vincular: la pantalla de Vincular. Vinculado: Hoy (el chat,
 * local-first), Escucha (la conciencia acústica) y Mapa (el recorrido, aparte de la escucha desde 1.0.1). El menú ⋯: Captura y permisos (Mobile 1.0) y Desvincular (borra el token
 * y todo lo guardado en el teléfono).
 */
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { estadoRescate, leerCredenciales, olvidarCredenciales, type Credenciales } from './src/api'
import { borrarTodo, cuantoEnCola } from './src/almacen'
import { sincronizar, useSincronizacion } from './src/sincronizar'
import { recuperarTramos } from './src/tramos'
import { registrarCapas } from './src/capas'
import { registrarCaptura } from './src/captura'
import { Captura } from './src/pantallas/Captura'
import { Mapa } from './src/pantallas/Mapa'
import { registrarRecorrido } from './src/recorrido'
import { Vincular } from './src/pantallas/Vincular'
import { Hoy } from './src/pantallas/Hoy'
import { Escucha } from './src/pantallas/Escucha'
import { Rescate } from './src/pantallas/Rescate'
import { ESP, LETRA, TOQUE, useTema } from './src/tema'

type Pestana = 'hoy' | 'escucha' | 'mapa'
const NOMBRE_PESTANA: Record<Pestana, string> = { hoy: 'Hoy', escucha: 'Escucha', mapa: 'Mapa' }

export default function App() {
  const t = useTema()
  const [c, setC] = useState<Credenciales | null | undefined>(undefined)
  const [pestana, setPestana] = useState<Pestana>('hoy')
  const [rescate, setRescate] = useState(false)
  const [verCaptura, setVerCaptura] = useState(false)
  useEffect(() => { void leerCredenciales().then(setC) }, [])
  // Un teléfono recién vinculado (o que quedó a mitad) pasa primero por el rescate. Sin red, se sigue y se pregunta después.
  useEffect(() => { if (c) void estadoRescate(c).then((r) => setRescate(r.estado === 'rescate')).catch(() => {}) }, [c])
  // La sincronización es de la app, no de una pantalla (Mobile 1.0): corre en Hoy y en Escucha por igual.
  const hayPendientes = useCallback(async () => { const n = await cuantoEnCola(); return n.textos + n.voces > 0 }, [])
  useSincronizacion(c && !rescate ? c : null, hayPendientes)
  // Al abrir: lo que quedó a medias (la app se cerró grabando) vuelve a la cola, y las capas salen con cada sincronización.
  useEffect(() => {
    if (!c) return
    registrarCapas()
    registrarCaptura()
    registrarRecorrido()
    void recuperarTramos().then((n) => { if (n) void sincronizar(c) }).catch(() => {})
  }, [c])

  const menu = () => Alert.alert(c?.nombre ?? 'Este teléfono', undefined, [
    { text: 'Captura y permisos', onPress: () => setVerCaptura(true) },
    { text: 'Desvincular', style: 'destructive', onPress: desvincular },
    { text: 'Cancelar', style: 'cancel' },
  ])
  const desvincular = () => Alert.alert('¿Desvincular este teléfono?', 'Se borra el token y todo lo guardado acá. En Deprocast, revocalo también en Apps conectadas.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Desvincular', style: 'destructive', onPress: async () => { await olvidarCredenciales(); await borrarTodo(); setC(null) } },
  ])

  if (c === undefined) return <View style={{ flex: 1, backgroundColor: t.fondo }} />
  // La pantalla respeta las barras del sistema arriba y abajo (en Android, la de estado y la de navegación la tapaban).
  return (
    <SafeAreaProvider>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[s.raiz, { backgroundColor: t.fondo }]}>
      <StatusBar style="auto" />
      {!c ? <Vincular alVincular={(x) => { setC(x); setRescate(true) }} /> : rescate ? <Rescate c={c} alTerminar={() => setRescate(false)} /> : verCaptura ? <Captura cerrar={() => setVerCaptura(false)} /> : (
        <>
          <View style={[s.barra, { borderColor: t.linea }]}>
            {(['hoy', 'escucha', 'mapa'] as const).map((p) => (
              <Pressable key={p} onPress={() => setPestana(p)} style={[s.pestana, pestana === p && { borderColor: t.acento }]} accessibilityRole="tab" accessibilityState={{ selected: pestana === p }}>
                <Text style={[LETRA.cuerpo, { color: pestana === p ? t.texto : t.tenue, fontWeight: '600' }]}>{NOMBRE_PESTANA[p]}</Text>
              </Pressable>
            ))}
            <Pressable onPress={menu} style={s.menu} accessibilityLabel="Menú: captura y permisos, desvincular"><Text style={[LETRA.chica, { color: t.tenue }]} numberOfLines={1}>{c.nombre} ⋯</Text></Pressable>
          </View>
          {pestana === 'hoy' ? <Hoy c={c} /> : pestana === 'escucha' ? <Escucha c={c} /> : <Mapa c={c} />}
        </>
      )}
    </SafeAreaView>
    </SafeAreaProvider>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  barra: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingHorizontal: ESP(2) },
  pestana: { minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(4), borderBottomWidth: 2, borderColor: 'transparent' },
  menu: { marginLeft: 'auto', minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(3), flexShrink: 1 },
})
