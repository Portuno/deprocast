/**
 * Captura y permisos (Mobile 1.0, bloque 4): qué capta el teléfono y para qué, un permiso por función (con su estado y
 * un botón para darlo), un interruptor por función y uno que apaga todo de una. Abajo, lo que NO capta y lo que todavía
 * no puede (necesita módulos nativos que no entran en 1.0).
 */
import { useCallback, useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { ajustesCaptura, energiaYRed, guardarAjustesCaptura } from '../captura'
import { AJUSTES_INICIALES, type Ajustes } from '../logica/captura'
import { ESP, LETRA, TOQUE, useTema } from '../tema'

type Permiso = 'concedido' | 'pendiente' | 'negado' | 'no hace falta'
type Funcion = { clave: 'audio' | 'ubicacion' | 'pasos'; titulo: string; capta: string; para: string; permiso: string }

const FUNCIONES: Funcion[] = [
  { clave: 'audio', titulo: 'Micrófono', capta: 'Tu voz, en tramos cortos (se cortan al dejar de hablar, al cambiar de app o al minuto), también con la pantalla apagada.', para: 'El dictado (va al chat de Hoy) y la escucha (notas de voz). El audio se sube, se transcribe y se borra del teléfono.', permiso: 'Micrófono' },
  { clave: 'ubicacion', titulo: 'Ubicación', capta: 'Dónde estabas mientras escuchás: quieto casi no marca; caminando, cada 30–60 s. O solo las paradas.', para: 'Tu día en capas: qué dijiste y dónde, para encontrarlo después («lo que hablé en tal lugar»).', permiso: 'Ubicación mientras se usa la app' },
  { clave: 'pasos', titulo: 'Pasos', capta: 'Los pasos y si caminás, por el sensor del teléfono (no por GPS).', para: 'Cruzar lo que dijiste con cómo te movías.', permiso: 'Actividad física' },
]

export function Captura({ cerrar }: { cerrar: () => void }) {
  const t = useTema()
  const [a, setA] = useState<Ajustes>(AJUSTES_INICIALES)
  const [permisos, setPermisos] = useState<Record<string, Permiso>>({})
  const [energia, setEnergia] = useState<string>('')

  const leerPermisos = useCallback(async () => {
    const p: Record<string, Permiso> = {}
    const de = (r: { granted: boolean; canAskAgain?: boolean }) => (r.granted ? 'concedido' : r.canAskAgain === false ? 'negado' : 'pendiente') as Permiso
    try { p.audio = de(await (await import('expo-audio')).getRecordingPermissionsAsync()) } catch { p.audio = 'pendiente' }
    try { p.ubicacion = de(await (await import('expo-location')).getForegroundPermissionsAsync()) } catch { p.ubicacion = 'pendiente' }
    try { const { Pedometer } = await import('expo-sensors'); p.pasos = (await Pedometer.isAvailableAsync()) ? de(await Pedometer.getPermissionsAsync()) : 'no hace falta' } catch { p.pasos = 'pendiente' }
    setPermisos(p)
  }, [])

  useEffect(() => {
    void ajustesCaptura().then(setA)
    void leerPermisos()
    void energiaYRed().then((e) => setEnergia(`${e.nivel != null && e.nivel >= 0 ? `Batería ${Math.round(e.nivel * 100)} %${e.cargando ? ' (cargando)' : ''}` : 'Batería: sin dato'} · ${e.conectado === false ? 'sin conexión' : e.tipo ? `red: ${e.tipo.toLowerCase()}` : 'red: sin dato'}`))
  }, [leerPermisos])

  const cambiar = async (x: Partial<Ajustes>) => { const n = { ...a, ...x }; setA(n); await guardarAjustesCaptura(n) }
  const pedir = async (clave: Funcion['clave']) => {
    if (permisos[clave] === 'negado') return void Linking.openSettings()
    try {
      if (clave === 'audio') await (await import('expo-audio')).requestRecordingPermissionsAsync()
      if (clave === 'ubicacion') await (await import('expo-location')).requestForegroundPermissionsAsync()
      if (clave === 'pasos') await (await import('expo-sensors')).Pedometer.requestPermissionsAsync()
    } catch { /* sin el módulo */ }
    await leerPermisos()
  }

  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <View style={s.cab}>
        <Text style={[s.titulo, { color: t.texto }]}>Captura y permisos</Text>
        <Pressable onPress={cerrar} style={s.cerrar} accessibilityRole="button" accessibilityLabel="Cerrar"><Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Listo</Text></Pressable>
      </View>

      <View style={[s.fila, s.tarjeta, { backgroundColor: t.panel, borderColor: a.todo ? t.acento : t.mal }]}>
        <View style={{ flex: 1 }}>
          <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>{a.todo ? 'Captura prendida' : 'Todo apagado'}</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>Un toque apaga todo: micrófono, ubicación y pasos. Lo que ya estaba guardado sigue saliendo.</Text>
        </View>
        <Switch value={a.todo} onValueChange={(v) => cambiar({ todo: v })} trackColor={{ true: t.acento }} accessibilityLabel="Captura prendida" />
      </View>

      {FUNCIONES.map((f) => {
        const p = permisos[f.clave]
        return (
          <View key={f.clave} style={[s.tarjeta, { backgroundColor: t.panel, borderColor: t.linea, opacity: a.todo ? 1 : 0.6 }]}>
            <View style={s.fila}>
              <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700', flex: 1 }]}>{f.titulo}</Text>
              <Switch value={a[f.clave]} onValueChange={(v) => cambiar({ [f.clave]: v })} disabled={!a.todo} trackColor={{ true: t.acento }} accessibilityLabel={f.titulo} />
            </View>
            <Text style={[LETRA.chica, { color: t.texto }]}>Capta: {f.capta}</Text>
            <Text style={[LETRA.chica, { color: t.tenue }]}>Para: {f.para}</Text>
            <View style={s.fila}>
              <Text style={[LETRA.chica, { color: p === 'concedido' ? t.ok : p === 'negado' ? t.mal : t.tenue, flex: 1 }]}>Permiso «{f.permiso}»: {p ?? '…'}</Text>
              {p && p !== 'concedido' && p !== 'no hace falta' ? (
                <Pressable onPress={() => pedir(f.clave)} style={s.boton} accessibilityRole="button"><Text style={[LETRA.chica, { color: t.acento, fontWeight: '700' }]}>{p === 'negado' ? 'Abrir ajustes' : 'Dar permiso'}</Text></Pressable>
              ) : null}
            </View>
            {f.clave === 'ubicacion' ? (
              <View style={s.fila}>
                <Text style={[LETRA.chica, { color: t.texto, flex: 1 }]}>Solo las paradas (un lugar donde te quedaste 5 minutos o más), no toda la traza</Text>
                <Switch value={a.soloParadas} onValueChange={(v) => cambiar({ soloParadas: v })} disabled={!a.todo || !a.ubicacion} trackColor={{ true: t.acento }} accessibilityLabel="Solo las paradas" />
              </View>
            ) : null}
          </View>
        )
      })}

      <View style={[s.tarjeta, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>Batería y red</Text>
        <Text style={[LETRA.chica, { color: t.tenue }]}>Sin permiso. Para decidir cuándo subir: sin conexión, el audio espera en el teléfono; con la batería por debajo del 15 % y sin cargar, el audio espera a que cargues (los textos salen igual).</Text>
        {energia ? <Text style={[LETRA.chica, { color: t.texto }]}>Ahora: {energia}</Text> : null}
      </View>

      <View style={[s.tarjeta, { borderColor: t.linea }]}>
        <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>Lo que NO capta</Text>
        <Text style={[LETRA.chica, { color: t.tenue }]}>El teclado, tus contactos, el contenido de otras apps ni capturas de pantalla.</Text>
        <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>Cómo viaja y cuánto queda</Text>
        <Text style={[LETRA.chica, { color: t.tenue }]}>Solo por conexión cifrada (https). Cada registro lleva la hora del teléfono y la del servidor. El audio queda en el espacio privado de la app (que el sistema del teléfono cifra) y se borra apenas el servidor confirma que lo recibió; el servidor lo transcribe, deja una copia en tu Drive (si está conectado) y no lo conserva en Deprocast.</Text>
        <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>Todavía no (no entra en 1.0)</Text>
        <Text style={[LETRA.chica, { color: t.tenue }]}>La app en primer plano y su título, y el pulso y el sueño (Health Connect): necesitan módulos nativos que no entran en esta versión de estabilidad.</Text>
      </View>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(5), gap: ESP(3) },
  cab: { flexDirection: 'row', alignItems: 'center', gap: ESP(2) },
  titulo: { ...LETRA.titulo, fontWeight: '700', flex: 1 },
  cerrar: { minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(3) },
  tarjeta: { borderWidth: 1, borderRadius: 12, padding: ESP(4), gap: ESP(2) },
  fila: { flexDirection: 'row', alignItems: 'center', gap: ESP(3), minHeight: TOQUE },
  boton: { minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(2) },
})
