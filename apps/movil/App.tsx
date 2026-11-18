/**
 * Deprocast en el teléfono (plan v33, paso 2). Desde Mobile 1.1 la escucha es de la app (EscuchaGlobal): sigue viva al cambiar de pestaña.
 * Sin vincular: la pantalla de Vincular. Vinculado: Hoy (el chat,
 * local-first), Escucha (la conciencia acústica) y Mapa (el recorrido, aparte de la escucha desde 1.0.1). El menú ⋯: Captura y permisos (Mobile 1.0) y Desvincular (borra el token
 * y todo lo guardado en el teléfono).
 * Mobile 1.3: «Compartir → Deprocast» desde cualquier app abre la pantalla Compartir; al abrir se registran la tarea de
 * fondo (pasos, uso del teléfono y avisos) y los avisos.
 */
import { useCallback, useEffect, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { esPedidoDeDictado, pestanaDelLink } from './src/logica/atajo'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useIncomingShare } from 'expo-sharing'
import { estadoRescate, leerCredenciales, olvidarCredenciales, type Credenciales } from './src/api'
import { borrarTodo, cuantoEnCola } from './src/almacen'
import { sincronizar, useSincronizacion } from './src/sincronizar'
import { recuperarTramos } from './src/tramos'
import { registrarCapas } from './src/capas'
import { registrarCaptura } from './src/captura'
import { Captura } from './src/pantallas/Captura'
import { Mapa } from './src/pantallas/Mapa'
import { registrarRecorrido } from './src/recorrido'
import { registrarArchivos } from './src/archivos'
import { registrarPasos } from './src/pasos'
import { registrarFondo } from './src/fondo'
import { registrarAvisos } from './src/avisos'
import { registrarPagos } from './src/pagos'
import { subirUsoTelefono } from './src/uso'
import { Compartir } from './src/pantallas/Compartir'
import { Validar } from './src/pantallas/Validar'
import { Cartel } from './src/cartel'
import { Vincular } from './src/pantallas/Vincular'
import { Hoy } from './src/pantallas/Hoy'
import { Escucha } from './src/pantallas/Escucha'
import { EscuchaGlobal } from './src/escuchaGlobal'
import { Rescate } from './src/pantallas/Rescate'
import { ESP, LETRA, TOQUE, useTema } from './src/tema'

type Pestana = 'hoy' | 'validar' | 'escucha' | 'mapa'
const NOMBRE_PESTANA: Record<Pestana, string> = { hoy: 'Hoy', validar: 'Validar', escucha: 'Escucha', mapa: 'Mapa' }

export default function App() {
  const t = useTema()
  const [c, setC] = useState<Credenciales | null | undefined>(undefined)
  const [pestana, setPestana] = useState<Pestana>('hoy')
  const [rescate, setRescate] = useState(false)
  const [verCaptura, setVerCaptura] = useState(false)
  // La confirmación de lo compartido (Fragua #313): un cartel arriba que se va solo, no un diálogo que tapa Hoy.
  const [cartel, setCartel] = useState<string | null>(null)
  const cerrarCartel = useCallback(() => setCartel(null), [])
  // Lo que llega por «Compartir → Deprocast» (con los archivos ya copiados a la caché de la app).
  const compartido = useIncomingShare()
  // El icono rápido «Dictar a Deprocast» (Fragua #300): abre la app por deprocast://dictar → Hoy con la escucha prendida.
  const [dictar, setDictar] = useState(0)
  useEffect(() => {
    const ver = (url: string | null | undefined) => {
      if (esPedidoDeDictado(url)) { setPestana('hoy'); setVerCaptura(false); setDictar(Date.now()); return }
      // El widget: Validar abre la tanda; tocarlo, Hoy.
      const p = pestanaDelLink(url)
      if (p) { setPestana(p); setVerCaptura(false) }
    }
    void Linking.getInitialURL().then(ver).catch(() => {})
    const x = Linking.addEventListener('url', (e) => ver(e.url))
    return () => x.remove()
  }, [])
  const items = compartido.resolvedSharedPayloads.length ? compartido.resolvedSharedPayloads : compartido.sharedPayloads
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
    registrarArchivos()
    void registrarPasos().then(() => registrarFondo())
    void registrarAvisos(c).catch(() => {})
    registrarPagos()
    void subirUsoTelefono(c).catch(() => null)
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
      {!c ? <Vincular alVincular={(x) => { setC(x); setRescate(true) }} /> : rescate ? <Rescate c={c} alTerminar={() => setRescate(false)} /> : items.length ? (
        <Compartir c={c} items={items} resolviendo={compartido.isResolving} listo={(m) => { compartido.clearSharedPayloads(); setPestana('hoy'); setCartel(m) }} />
      ) : verCaptura ? <Captura cerrar={() => { setVerCaptura(false); void registrarFondo(); if (c) void registrarAvisos(c).catch(() => {}) }} /> : (
        <EscuchaGlobal c={c}>
          <View style={[s.barra, { borderColor: t.linea }]}>
            {(['hoy', 'validar', 'escucha', 'mapa'] as const).map((p) => (
              <Pressable key={p} onPress={() => setPestana(p)} style={[s.pestana, pestana === p && { borderColor: t.acento }]} accessibilityRole="tab" accessibilityState={{ selected: pestana === p }}>
                <Text style={[LETRA.cuerpo, { color: pestana === p ? t.texto : t.tenue, fontWeight: '600' }]}>{NOMBRE_PESTANA[p]}</Text>
              </Pressable>
            ))}
            <Pressable onPress={menu} style={s.menu} accessibilityLabel="Menú: captura y permisos, desvincular"><Text style={[LETRA.chica, { color: t.tenue }]} numberOfLines={1}>{c.nombre} ⋯</Text></Pressable>
          </View>
          {pestana === 'hoy' ? <Hoy c={c} irAEscucha={() => setPestana('escucha')} dictar={dictar} /> : pestana === 'validar' ? <Validar c={c} /> : pestana === 'escucha' ? <Escucha c={c} /> : <Mapa c={c} />}
        </EscuchaGlobal>
      )}
    </SafeAreaView>
    <Cartel texto={cartel} cerrar={cerrarCartel} />
    </SafeAreaProvider>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  barra: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingHorizontal: ESP(2) },
  pestana: { minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(3), borderBottomWidth: 2, borderColor: 'transparent' },
  menu: { marginLeft: 'auto', minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(3), flexShrink: 1 },
})
