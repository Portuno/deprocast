/**
 * Actividad (Mobile 2.0): lo que antes era la tarjeta de pasos de Hoy, con lugar propio. Los pasos de hoy contra tu meta,
 * por hora, los últimos 7 días y el tiempo en el teléfono (pantalla, distracción, las apps que más usaste). Todo del
 * teléfono, sin red; la meta y el uso, del último paquete de Hoy. «Ver dónde caminé» abre el Mapa.
 */
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Actividad as ActividadApi, UsoHoy } from '../api'
import { leerActividad, leerUso } from '../almacen'
import { horasYMinutos } from '../logica/uso'
import type { Modulo } from '../modulos'
import { alCambiarPasos, cuentaConLaAppCerrada, horasDeHoy, pasosDeHoy, ultimosDias } from '../pasos'
import { alCambiar } from '../sincronizar'
import { ESP, LETRA, TOQUE, useTema } from '../tema'

const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function Actividad({ irA }: { irA: (m: Modulo) => void }) {
  const t = useTema()
  const [actividad, setActividad] = useState<ActividadApi | null>(null)
  const [uso, setUso] = useState<UsoHoy | null>(null)
  const [pasosLocal, setPasosLocal] = useState(0)
  const [horas, setHoras] = useState<number[]>([])
  const [dias, setDias] = useState<{ fecha: string; pasos: number }[]>([])

  const leer = useCallback(async () => {
    setActividad(await leerActividad())
    setUso(await leerUso())
    setPasosLocal(await pasosDeHoy())
    setHoras(await horasDeHoy())
    setDias(await ultimosDias(7))
  }, [])
  useEffect(() => {
    void leer()
    const a = alCambiar(() => { void leer() })
    const b = alCambiarPasos(() => { void leer() })
    return () => { a(); b() }
  }, [leer])

  // Los pasos: lo que contó el teléfono hoy o lo que sabe el servidor, lo que sea más.
  const deHoy = actividad?.fecha === hoyLocal() ? actividad : null
  const pasos = Math.max(pasosLocal, deHoy?.pasos ?? 0)
  const meta = actividad?.meta ?? 8000
  const avance = Math.min(100, Math.round((pasos / meta) * 100))
  const maxHora = Math.max(1, ...horas)

  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <View style={[s.caja, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Text style={[LETRA.chica, { color: t.tenue }]}>PASOS HOY</Text>
        <Text style={[LETRA.grande, { color: t.texto, fontWeight: '700' }]}>{pasos.toLocaleString('es-AR')}</Text>
        <View style={[s.barra, { backgroundColor: t.linea }]}><View style={[s.lleno, { backgroundColor: pasos >= meta ? t.ok : t.acento, width: `${avance}%` }]} /></View>
        <Text style={[LETRA.chica, { color: t.tenue }]}>
          {avance}% de {meta.toLocaleString('es-AR')}{deHoy?.km ? ` · ${deHoy.km} km` : ''}{deHoy?.minutosCaminando ? ` · ${deHoy.minutosCaminando} min caminando` : ''}
        </Text>
        <View style={s.horas}>
          {(horas.length ? horas : Array.from({ length: 24 }, () => 0)).map((n, i) => (
            <View key={i} style={[s.hora, { backgroundColor: n ? t.acento : t.linea, height: Math.max(ESP(1), Math.round((n / maxHora) * ESP(16))) }]} />
          ))}
        </View>
        <View style={s.eje}>{['0', '6', '12', '18', '24 h'].map((x) => <Text key={x} style={[LETRA.chica, { color: t.tenue }]}>{x}</Text>)}</View>
        <Pressable onPress={() => irA('mapa')} style={s.enlace} accessibilityRole="button">
          <Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Ver dónde caminé ›</Text>
        </Pressable>
      </View>

      <View style={[s.caja, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Text style={[LETRA.chica, { color: t.tenue }]}>ÚLTIMOS DÍAS</Text>
        {dias.length ? dias.map((x) => (
          <View key={x.fecha} style={s.dia}>
            <Text style={[LETRA.cuerpo, { color: t.texto, width: 110 }]}>{new Date(`${x.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })}</Text>
            <View style={[s.barraDia, { backgroundColor: t.linea }]}><View style={[s.lleno, { backgroundColor: x.pasos >= meta ? t.ok : t.acento, width: `${Math.min(100, Math.round((x.pasos / meta) * 100))}%` }]} /></View>
            <Text style={[LETRA.chica, s.numero, { color: x.pasos >= meta ? t.ok : t.texto }]}>{x.pasos.toLocaleString('es-AR')}</Text>
          </View>
        )) : <Text style={[LETRA.chica, { color: t.tenue }]}>Todavía sin días.</Text>}
        {!cuentaConLaAppCerrada() ? <Text style={[LETRA.chica, { color: t.tenue }]}>Este teléfono cuenta solo con la app abierta (o la escucha o el recorrido prendidos).</Text> : null}
      </View>

      {uso ? (
        <View style={[s.caja, { backgroundColor: t.panel, borderColor: t.linea }]}>
          <Text style={[LETRA.chica, { color: t.tenue }]}>EN EL TELÉFONO HOY</Text>
          <Text style={[LETRA.titulo, { color: t.texto, fontWeight: '700' }]}>{horasYMinutos(uso.pantallaMin)}</Text>
          <Text style={[LETRA.chica, { color: uso.distraccionMin ? t.mal : t.tenue }]}>{uso.distraccionMin ? `${horasYMinutos(uso.distraccionMin)} en distracción · ` : ''}{uso.desbloqueos} desbloqueos</Text>
          {uso.apps.map((a) => (
            <View key={a.nombre} style={s.dia}>
              <Text style={[LETRA.cuerpo, { color: a.distraccion ? t.mal : t.texto, flex: 1 }]} numberOfLines={1}>{a.nombre}</Text>
              <Text style={[LETRA.chica, { color: t.tenue }]}>{horasYMinutos(a.min)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(4), gap: ESP(3) },
  caja: { borderWidth: 1, borderRadius: 16, padding: ESP(4), gap: ESP(2) },
  barra: { height: ESP(3), borderRadius: ESP(2), overflow: 'hidden' },
  lleno: { height: '100%' },
  horas: { flexDirection: 'row', alignItems: 'flex-end', gap: ESP(1), height: ESP(16), marginTop: ESP(2) },
  hora: { flex: 1, borderRadius: 2 },
  eje: { flexDirection: 'row', justifyContent: 'space-between' },
  enlace: { minHeight: TOQUE, justifyContent: 'center' },
  dia: { flexDirection: 'row', alignItems: 'center', gap: ESP(3), minHeight: ESP(8) },
  barraDia: { flex: 1, height: ESP(2), borderRadius: ESP(1), overflow: 'hidden' },
  numero: { width: 64, textAlign: 'right' },
})
