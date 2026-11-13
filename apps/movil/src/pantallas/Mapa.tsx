/**
 * El Mapa (Mobile 1.0.1): la ubicación va aparte de la escucha. Arriba, el interruptor del recorrido (anota por dónde
 * andás aunque la app esté cerrada, con un aviso fijo); abajo, el mapa del día (OpenStreetMap, sin cuentas ni claves),
 * con el recorrido, las paradas y el último punto, y la lista de paradas con su hora y cuánto estuviste.
 */
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { traerMapa, type Credenciales, type DiaMapa } from '../api'
import { apagarRecorrido, prenderRecorrido, puntosEnCola, recorridoPrendido } from '../recorrido'
import { alCambiar, sincronizar } from '../sincronizar'
import { ESP, LETRA, TOQUE, useTema, type Tema } from '../tema'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const fechaDe = (desplazamiento: number) => { const d = new Date(Date.now() + desplazamiento * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** La página del mapa (Leaflet + OpenStreetMap), con los datos adentro. */
function paginaDelMapa(d: DiaMapa, t: Tema): string {
  const datos = JSON.stringify({ puntos: d.puntos.map((p) => [p.lat, p.lon]), paradas: d.paradas.map((p) => ({ lat: p.lat, lon: p.lon, txt: `${hora(p.desde)}–${hora(p.hasta)} · ${p.minutos} min${p.lugar ? ` · ${p.lugar}` : ''}` })), ultimo: d.ultimo ? [d.ultimo.lat, d.ultimo.lon] : null }).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0;background:${t.fondo}}.leaflet-popup-content{font:14px system-ui}</style></head>
<body><div id="m"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const d=${datos};const m=L.map('m');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(m);
if(d.puntos.length){L.polyline(d.puntos,{color:'${t.acento}',weight:4,opacity:.85}).addTo(m);m.fitBounds(L.latLngBounds(d.puntos).pad(0.25),{maxZoom:17})}else{m.setView([40.2,-3.6],5)}
d.paradas.forEach(p=>L.circleMarker([p.lat,p.lon],{radius:9,color:'${t.acento}',weight:2,fillOpacity:.55}).addTo(m).bindPopup(p.txt));
if(d.ultimo)L.circleMarker(d.ultimo,{radius:7,color:'#ffffff',weight:2,fillColor:'#2b7bd6',fillOpacity:1}).addTo(m).bindPopup('Último punto');
</script></body></html>`
}

export function Mapa({ c }: { c: Credenciales }) {
  const t = useTema()
  const [prendido, setPrendido] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [dia, setDia] = useState(0)
  const [datos, setDatos] = useState<DiaMapa | null>(null)
  const [enCola, setEnCola] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const traer = useCallback(async () => {
    setPrendido(await recorridoPrendido())
    const cola = await puntosEnCola().catch(() => [])
    setEnCola(cola.length)
    try {
      const d = await traerMapa(c, fechaDe(dia))
      // Lo de hoy que todavía no subió también se dibuja.
      if (dia === 0 && cola.length) { d.puntos = [...d.puntos, ...cola].sort((a, b) => a.en - b.en); d.ultimo = d.puntos.at(-1) ?? d.ultimo }
      setDatos(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (dia === 0 && cola.length) setDatos({ fecha: fechaDe(0), puntos: cola, paradas: [], distanciaKm: 0, fuentes: [], ultimo: cola.at(-1) ?? null })
    }
  }, [c, dia])

  useEffect(() => {
    void traer()
    const x = setInterval(traer, 60_000)
    const sacar = alCambiar(() => { void traer() })
    return () => { clearInterval(x); sacar() }
  }, [traer])

  const cambiar = async (v: boolean) => {
    setAviso(null)
    if (v) { const r = await prenderRecorrido(); setAviso(r.aviso) } else await apagarRecorrido()
    await traer()
  }

  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <View style={[s.tarjeta, { backgroundColor: t.panel, borderColor: prendido ? t.acento : t.linea }]}>
        <View style={s.fila}>
          <View style={{ flex: 1 }}>
            <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>{prendido ? 'Anotando tu recorrido' : 'Recorrido apagado'}</Text>
            <Text style={[LETRA.chica, { color: t.tenue }]}>Aparte de la escucha. Sigue con la app cerrada (con un aviso fijo). Quieto casi no marca; caminando, cada 30 s.</Text>
          </View>
          <Switch value={prendido} onValueChange={cambiar} trackColor={{ true: t.acento }} accessibilityLabel="Anotar mi recorrido" />
        </View>
        {aviso ? <Text style={[LETRA.chica, { color: t.acento }]}>{aviso}</Text> : null}
      </View>

      <View style={s.fila}>
        {[0, -1].map((x) => (
          <Pressable key={x} onPress={() => setDia(x)} style={[s.chip, { borderColor: dia === x ? t.acento : t.linea }]} accessibilityRole="button">
            <Text style={[LETRA.chica, { color: dia === x ? t.acento : t.texto, fontWeight: '700' }]}>{x === 0 ? 'Hoy' : 'Ayer'}</Text>
          </Pressable>
        ))}
        <Text style={[LETRA.chica, { color: t.tenue, flex: 1, textAlign: 'right' }]} numberOfLines={2}>
          {datos ? `${datos.paradas.length} parada${datos.paradas.length === 1 ? '' : 's'} · ${datos.distanciaKm} km${datos.ultimo ? ` · último ${hora(datos.ultimo.en)}` : ''}` : 'Cargando…'}
        </Text>
      </View>
      {enCola ? <Text style={[LETRA.chica, { color: t.tenue }]}>{enCola} punto(s) en el teléfono: salen solos con la próxima sincronización.</Text> : null}
      {error ? <Text style={[LETRA.chica, { color: t.mal }]}>No pude traer el mapa: {error}</Text> : null}

      <View style={[s.mapa, { borderColor: t.linea }]}>
        {datos ? <WebView originWhitelist={['*']} source={{ html: paginaDelMapa(datos, t) }} style={{ backgroundColor: t.fondo }} setSupportMultipleWindows={false} /> : null}
      </View>

      <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>Paradas</Text>
      {datos?.paradas.length ? datos.paradas.map((p, i) => (
        <View key={i} style={[s.parada, { borderColor: t.linea }]}>
          <Text style={[LETRA.cuerpo, { color: t.texto }]}>{hora(p.desde)}–{hora(p.hasta)} · {p.minutos} min</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>{p.lugar ?? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`}</Text>
        </View>
      )) : <Text style={[LETRA.chica, { color: t.tenue }]}>{datos?.puntos.length ? 'Todavía ninguna (una parada es quedarte 5 minutos o más en un lugar).' : 'Sin recorrido este día. Prendé «Anotar mi recorrido» arriba.'}</Text>}
      <Pressable onPress={() => void sincronizar(c).then(traer)} style={s.boton} accessibilityRole="button"><Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Actualizar</Text></Pressable>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(4), gap: ESP(3) },
  tarjeta: { borderWidth: 1, borderRadius: 12, padding: ESP(4), gap: ESP(2) },
  fila: { flexDirection: 'row', alignItems: 'center', gap: ESP(3), minHeight: TOQUE },
  chip: { minHeight: TOQUE, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: ESP(4) },
  mapa: { height: 360, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  parada: { borderBottomWidth: 1, paddingVertical: ESP(2), gap: ESP(1) },
  boton: { minHeight: TOQUE, justifyContent: 'center', alignItems: 'center' },
})
