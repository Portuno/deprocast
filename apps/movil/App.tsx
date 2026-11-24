/**
 * Deprocast en el teléfono. Mobile 2.0: la navegación se rehace alrededor de un menú directo.
 * - Abajo, cuatro botones fijos: Hoy (el chat), Mapa, Escucha y Menú.
 * - El Menú tiene todos los módulos a un toque, cada uno con su estado en una línea (Validar, Actividad, Audios,
 *   Captura y permisos…) y lo del teléfono (sincronización, desvincular).
 * La escucha sigue siendo de la app (EscuchaGlobal): no se apaga al cambiar de módulo, y el botón de Escucha lo dice con
 * un punto (dorado escuchando, rojo grabando).
 * Sin vincular: Vincular; recién vinculado: Rescate; lo que llega por «Compartir → Deprocast», Compartir.
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
import { registrarRecorrido } from './src/recorrido'
import { registrarArchivos } from './src/archivos'
import { registrarPasos } from './src/pasos'
import { registrarFondo } from './src/fondo'
import { registrarAvisos } from './src/avisos'
import { registrarPagos } from './src/pagos'
import { subirUsoTelefono } from './src/uso'
import { borrarCarpetaAudios } from './src/audios'
import { Captura } from './src/pantallas/Captura'
import { Mapa } from './src/pantallas/Mapa'
import { Compartir } from './src/pantallas/Compartir'
import { Validar } from './src/pantallas/Validar'
import { Vincular } from './src/pantallas/Vincular'
import { Hoy } from './src/pantallas/Hoy'
import { Escucha } from './src/pantallas/Escucha'
import { Rescate } from './src/pantallas/Rescate'
import { Menu } from './src/pantallas/Menu'
import { Actividad } from './src/pantallas/Actividad'
import { Audios } from './src/pantallas/Audios'
import { Cartel } from './src/cartel'
import { EscuchaGlobal, useEscuchaGlobal } from './src/escuchaGlobal'
import { type Modulo, MODULOS, BARRA } from './src/modulos'
import { ESP, LETRA, TOQUE, useTema } from './src/tema'

export default function App() {
  const t = useTema()
  const [c, setC] = useState<Credenciales | null | undefined>(undefined)
  const [modulo, setModulo] = useState<Modulo>('hoy')
  const [rescate, setRescate] = useState(false)
  // La confirmación de lo compartido (Fragua #313): un cartel arriba que se va solo, no un diálogo que tapa Hoy.
  const [cartel, setCartel] = useState<string | null>(null)
  const cerrarCartel = useCallback(() => setCartel(null), [])
  // Lo que llega por «Compartir → Deprocast» (con los archivos ya copiados a la caché de la app).
  const compartido = useIncomingShare()
  // El icono rápido «Dictar a Deprocast» (Fragua #300): abre la app por deprocast://dictar → Hoy con la escucha prendida.
  const [dictar, setDictar] = useState(0)
  useEffect(() => {
    const ver = (url: string | null | undefined) => {
      if (esPedidoDeDictado(url)) { setModulo('hoy'); setDictar(Date.now()); return }
      // El widget: Validar abre la tanda; tocarlo, Hoy.
      const p = pestanaDelLink(url)
      if (p) setModulo(p)
    }
    void Linking.getInitialURL().then(ver).catch(() => {})
    const x = Linking.addEventListener('url', (e) => ver(e.url))
    return () => x.remove()
  }, [])
  const items = compartido.resolvedSharedPayloads.length ? compartido.resolvedSharedPayloads : compartido.sharedPayloads
  useEffect(() => { void leerCredenciales().then(setC) }, [])
  // Un teléfono recién vinculado (o que quedó a mitad) pasa primero por el rescate. Sin red, se sigue y se pregunta después.
  useEffect(() => { if (c) void estadoRescate(c).then((r) => setRescate(r.estado === 'rescate')).catch(() => {}) }, [c])
  // La sincronización es de la app, no de una pantalla (Mobile 1.0).
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

  const desvincular = () => Alert.alert('¿Desvincular este teléfono?', 'Se borra el token y todo lo guardado acá, audios incluidos. En Deprocast, revocalo también en Apps conectadas.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Desvincular', style: 'destructive', onPress: async () => { await olvidarCredenciales(); await borrarTodo(); borrarCarpetaAudios(); setC(null) } },
  ])

  if (c === undefined) return <View style={{ flex: 1, backgroundColor: t.fondo }} />
  // La pantalla respeta las barras del sistema arriba y abajo (en Android, la de estado y la de navegación la tapaban).
  return (
    <SafeAreaProvider>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[s.raiz, { backgroundColor: t.fondo }]}>
      <StatusBar style="auto" />
      {!c ? <Vincular alVincular={(x) => { setC(x); setRescate(true) }} /> : rescate ? <Rescate c={c} alTerminar={() => setRescate(false)} /> : items.length ? (
        <Compartir c={c} items={items} resolviendo={compartido.isResolving} listo={(m) => { compartido.clearSharedPayloads(); setModulo('hoy'); setCartel(m) }} />
      ) : (
        <EscuchaGlobal c={c}>
          <View style={s.cuerpo}>
            {modulo === 'hoy' ? <Hoy c={c} irA={setModulo} dictar={dictar} />
              : modulo === 'mapa' ? <Mapa c={c} />
              : modulo === 'escucha' ? <Escucha c={c} />
              : modulo === 'validar' ? <Validar c={c} />
              : modulo === 'actividad' ? <Actividad irA={setModulo} />
              : modulo === 'audios' ? <Audios />
              : modulo === 'captura' ? <Captura cerrar={() => { setModulo('menu'); void registrarFondo(); void registrarAvisos(c).catch(() => {}) }} />
              : <Menu c={c} irA={setModulo} desvincular={desvincular} />}
          </View>
          <Barra actual={modulo} irA={setModulo} />
        </EscuchaGlobal>
      )}
    </SafeAreaView>
    <Cartel texto={cartel} cerrar={cerrarCartel} />
    </SafeAreaProvider>
  )
}

/** Los cuatro botones de abajo. Un módulo que no está en la barra ilumina «Menú». */
function Barra({ actual, irA }: { actual: Modulo; irA: (m: Modulo) => void }) {
  const t = useTema()
  const e = useEscuchaGlobal()
  return (
    <View style={[s.barra, { borderColor: t.linea, backgroundColor: t.panel }]} accessibilityRole="tablist">
      {BARRA.map((m) => {
        const activo = actual === m || (m === 'menu' && !BARRA.includes(actual))
        const punto = m === 'escucha' && e.activa ? (e.grabando ? t.mal : t.acento) : null
        return (
          <Pressable key={m} onPress={() => irA(m)} style={s.boton} accessibilityRole="tab" accessibilityState={{ selected: activo }} accessibilityLabel={MODULOS[m].nombre}>
            <View>
              <Text style={[LETRA.titulo, s.icono, { opacity: activo ? 1 : 0.55 }]}>{MODULOS[m].icono}</Text>
              {punto ? <View style={[s.punto, { backgroundColor: punto, borderColor: t.panel }]} /> : null}
            </View>
            <Text style={[LETRA.chica, { color: activo ? t.acento : t.tenue, fontWeight: activo ? '700' : '500' }]}>{MODULOS[m].nombre}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  cuerpo: { flex: 1 },
  barra: { flexDirection: 'row', borderTopWidth: 1 },
  boton: { flex: 1, minHeight: TOQUE + ESP(4), alignItems: 'center', justifyContent: 'center', paddingVertical: ESP(1) },
  icono: { textAlign: 'center' },
  punto: { position: 'absolute', top: 0, right: -ESP(2), width: ESP(3), height: ESP(3), borderRadius: ESP(2), borderWidth: 2 },
})
