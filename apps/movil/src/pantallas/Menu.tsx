/**
 * El Menú (Mobile 2.0): todos los módulos a un toque, de a dos por fila, cada uno con su estado en una línea (lo que
 * importa de un vistazo: si escucha, si anota el recorrido, cuántos pasos, cuánto espera tu ok). Abajo, lo del
 * teléfono: cuándo sincronizó, lo que espera salir, y desvincular.
 */
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Credenciales } from '../api'
import { archivosEnCola, cuantoEnCola, estadoSincro, leerChat, resumenAudios } from '../almacen'
import { useEscuchaGlobal } from '../escuchaGlobal'
import { EN_MENU, MODULOS, type Modulo } from '../modulos'
import { pasosDeHoy } from '../pasos'
import { recorridoPrendido } from '../recorrido'
import { alCambiar, sincronizar } from '../sincronizar'
import { ESP, LETRA, TOQUE, useTema } from '../tema'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1e6))} MB`)

type Estado = { validar: number; pasos: number; recorrido: boolean; audios: { n: number; bytes: number }; sincro: number | null; error: string | null; espera: number }

export function Menu({ c, irA, desvincular }: { c: Credenciales; irA: (m: Modulo) => void; desvincular: () => void }) {
  const t = useTema()
  const e = useEscuchaGlobal()
  const [x, setX] = useState<Estado | null>(null)
  const [sincronizando, setSincronizando] = useState(false)

  const leer = useCallback(async () => {
    const [chat, pasos, recorrido, audios, sincro, cola, archivos] = await Promise.all([leerChat(), pasosDeHoy(), recorridoPrendido(), resumenAudios(), estadoSincro(), cuantoEnCola(), archivosEnCola()])
    setX({ validar: chat.paraValidar, pasos, recorrido, audios, sincro: sincro.sincronizadoEn, error: sincro.error, espera: cola.textos + cola.voces + archivos.length })
  }, [])
  useEffect(() => { void leer(); return alCambiar(() => { void leer() }) }, [leer])

  const estadoDe = (m: Modulo): string => {
    if (!x) return ''
    switch (m) {
      case 'hoy': return 'Charlar'
      case 'mapa': return x.recorrido ? 'Anotando' : 'Recorrido apagado'
      case 'escucha': return e.activa ? (e.grabando ? '● Grabando' : 'Escuchando') : 'Apagada'
      case 'validar': return x.validar ? `${x.validar} esperan` : 'Nada pendiente'
      case 'actividad': return `${x.pasos.toLocaleString('es-AR')} pasos`
      case 'audios': return x.audios.n ? `${x.audios.n} · ${mb(x.audios.bytes)}` : 'Ninguno todavía'
      case 'captura': return 'Qué capta'
      default: return ''
    }
  }
  const resaltar = (m: Modulo) => (m === 'escucha' && e.activa) || (m === 'mapa' && !!x?.recorrido) || (m === 'validar' && !!x?.validar)

  // De a dos por fila.
  const filas: Modulo[][] = []
  for (let i = 0; i < EN_MENU.length; i += 2) filas.push(EN_MENU.slice(i, i + 2))

  const actualizar = async () => { setSincronizando(true); try { await sincronizar(c) } finally { setSincronizando(false); void leer() } }

  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <Text style={[LETRA.grande, s.titulo, { color: t.texto }]}>Deprocast</Text>
      {filas.map((fila, i) => (
        <View key={i} style={s.fila}>
          {fila.map((m) => (
            <Pressable key={m} onPress={() => irA(m)} style={[s.modulo, { backgroundColor: t.panel, borderColor: resaltar(m) ? t.acento : t.linea }]} accessibilityRole="button" accessibilityLabel={`${MODULOS[m].nombre}: ${estadoDe(m)}`}>
              <Text style={LETRA.titulo}>{MODULOS[m].icono}</Text>
              <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>{MODULOS[m].nombre}</Text>
              <Text style={[LETRA.chica, { color: resaltar(m) ? t.acento : t.tenue }]} numberOfLines={1}>{estadoDe(m)}</Text>
            </Pressable>
          ))}
          {fila.length === 1 ? <View style={s.hueco} /> : null}
        </View>
      ))}

      <Text style={[LETRA.chica, s.seccion, { color: t.tenue }]}>ESTE TELÉFONO · {c.nombre}</Text>
      <View style={[s.caja, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Pressable onPress={actualizar} style={s.renglon} accessibilityRole="button" accessibilityLabel="Sincronizar ahora">
          <View style={{ flex: 1 }}>
            <Text style={[LETRA.cuerpo, { color: x?.error ? t.mal : t.texto }]} numberOfLines={1}>
              {sincronizando ? 'Sincronizando…' : x?.error ? 'Sin conexión con Deprocast' : x?.sincro ? `Al día · ${hora(x.sincro)}` : 'Sin sincronizar'}
            </Text>
            {x?.espera ? <Text style={[LETRA.chica, { color: t.tenue }]}>{x.espera} esperando salir</Text> : null}
          </View>
          <Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>↻</Text>
        </Pressable>
        <View style={[s.separador, { backgroundColor: t.linea }]} />
        <Pressable onPress={desvincular} style={s.renglon} accessibilityRole="button">
          <Text style={[LETRA.cuerpo, { color: t.mal }]}>Desvincular</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(4), gap: ESP(3) },
  titulo: { fontWeight: '700', marginBottom: ESP(1) },
  fila: { flexDirection: 'row', gap: ESP(3) },
  modulo: { flex: 1, minHeight: TOQUE * 2 + ESP(4), borderWidth: 1, borderRadius: 16, padding: ESP(4), gap: ESP(1), justifyContent: 'flex-end' },
  hueco: { flex: 1 },
  seccion: { marginTop: ESP(4), letterSpacing: 1 },
  caja: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  renglon: { minHeight: TOQUE + ESP(2), flexDirection: 'row', alignItems: 'center', paddingHorizontal: ESP(4), gap: ESP(3) },
  separador: { height: 1 },
})
