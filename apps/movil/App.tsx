/**
 * Deprocast en el teléfono (plan v33, paso 2). Sin vincular: la pantalla de Vincular. Vinculado: Hoy (el chat,
 * local-first) y Escucha (la conciencia acústica). Desvincular borra el token y todo lo guardado en el teléfono.
 */
import { useEffect, useState } from 'react'
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { leerCredenciales, olvidarCredenciales, type Credenciales } from './src/api'
import { borrarTodo } from './src/almacen'
import { Vincular } from './src/pantallas/Vincular'
import { Hoy } from './src/pantallas/Hoy'
import { Escucha } from './src/pantallas/Escucha'
import { useTema } from './src/tema'

type Pestana = 'hoy' | 'escucha'

export default function App() {
  const t = useTema()
  const [c, setC] = useState<Credenciales | null | undefined>(undefined)
  const [pestana, setPestana] = useState<Pestana>('hoy')
  useEffect(() => { void leerCredenciales().then(setC) }, [])

  const desvincular = () => Alert.alert('¿Desvincular este teléfono?', 'Se borra el token y todo lo guardado acá. En Deprocast, revocalo también en Apps conectadas.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Desvincular', style: 'destructive', onPress: async () => { await olvidarCredenciales(); await borrarTodo(); setC(null) } },
  ])

  if (c === undefined) return <View style={{ flex: 1, backgroundColor: t.fondo }} />
  return (
    <SafeAreaView style={[s.raiz, { backgroundColor: t.fondo }]}>
      <StatusBar style="auto" />
      {!c ? <Vincular alVincular={setC} /> : (
        <>
          <View style={[s.barra, { borderColor: t.linea }]}>
            {(['hoy', 'escucha'] as const).map((p) => (
              <Pressable key={p} onPress={() => setPestana(p)} style={[s.pestana, pestana === p && { borderColor: t.acento }]} accessibilityRole="tab" accessibilityState={{ selected: pestana === p }}>
                <Text style={{ color: pestana === p ? t.texto : t.tenue, fontWeight: '600' }}>{p === 'hoy' ? 'Hoy' : 'Escucha'}</Text>
              </Pressable>
            ))}
            <Pressable onPress={desvincular} style={s.menu} accessibilityLabel="Desvincular"><Text style={{ color: t.tenue }}>{c.nombre} ⋯</Text></Pressable>
          </View>
          {pestana === 'hoy' ? <Hoy c={c} /> : <Escucha c={c} />}
        </>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  barra: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingHorizontal: 8 },
  pestana: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderColor: 'transparent' },
  menu: { marginLeft: 'auto', padding: 12 },
})
