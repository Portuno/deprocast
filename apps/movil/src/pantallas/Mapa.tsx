/**
 * El Mapa (Mobile 1.0.1): la ubicación va aparte de la escucha. Arriba, el interruptor del recorrido (anota por dónde
 * andás aunque la app esté cerrada, con un aviso fijo); abajo, el mapa del día (OpenStreetMap, sin cuentas ni claves),
 * con el recorrido, las paradas y el último punto, y la lista de paradas con su hora y cuánto estuviste.
 */
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { guardarLugar, traerLugares, traerMapa, traerMapaRango, type Credenciales, type DiaMapa, type Frecuente } from '../api'
import { apagarRecorrido, prenderRecorrido, puntosEnCola, recorridoPrendido } from '../recorrido'
import { alCambiar, sincronizar } from '../sincronizar'
import { ESP, LETRA, TOQUE, useTema, type Tema } from '../tema'
import { simplificar, tramosPorHora } from '../logica/mapa'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const fechaDe = (desplazamiento: number) => { const d = new Date(Date.now() + desplazamiento * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/**
 * La página del mapa (Leaflet + OpenStreetMap), con los datos adentro. Mobile 1.1 (Fragua #287), un pase de diseño:
 * - el trazo va simplificado (sin la nube de puntos de cuando estabas quieto) y en cinco tramos que se encienden de la
 *   mañana a la noche: se lee el orden del día sin tocar nada;
 * - salida y llegada marcadas con su hora; las paradas numeradas (las mismas de la lista de abajo);
 * - de cerca (zoom 15 o más) cada parada muestra su hora y su lugar; de lejos, solo el número;
 * - una leyenda chica con el sentido del color, las paradas y los km.
 */
function paginaDelMapa(d: DiaMapa, t: Tema): string {
  const trazo = simplificar([...d.puntos].sort((a, b) => a.en - b.en), 12)
  const tramos = tramosPorHora(trazo, 5).map((x) => x.map((p) => [p.lat, p.lon]))
  const datos = JSON.stringify({
    tramos,
    salida: trazo[0] ? { p: [trazo[0].lat, trazo[0].lon], h: hora(trazo[0].en) } : null,
    llegada: trazo.length > 1 ? { p: [trazo.at(-1)!.lat, trazo.at(-1)!.lon], h: hora(trazo.at(-1)!.en) } : null,
    paradas: d.paradas.map((p, i) => ({ n: i + 1, lat: p.lat, lon: p.lon, txt: `${hora(p.desde)}–${hora(p.hasta)} · ${p.minutos} min${p.lugar ? ` · ${p.lugar}` : ''}` })),
    resumen: `${d.paradas.length} parada${d.paradas.length === 1 ? '' : 's'} · ${d.distanciaKm} km`,
    todos: trazo.map((p) => [p.lat, p.lon]),
  }).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0;background:${t.fondo};font:13px system-ui}
.n{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${t.acento};color:${t.sobreAcento};font-weight:700;border:2px solid ${t.fondo}}
.etq{background:${t.panel};color:${t.texto};border:1px solid ${t.linea};border-radius:8px;padding:2px 6px;box-shadow:none}
.etq:before{display:none}
.ley{background:${t.panel};color:${t.texto};border:1px solid ${t.linea};border-radius:10px;padding:6px 8px;line-height:1.4}
.bar{height:6px;width:96px;border-radius:3px;background:linear-gradient(90deg,${t.acento}55,${t.acento});margin:3px 0}</style></head>
<body><div id="m"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const d=${datos};const m=L.map('m',{zoomControl:false});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(m);
const op=[.35,.5,.65,.8,1];
d.tramos.forEach((x,i)=>L.polyline(x,{color:'${t.acento}',weight:5,opacity:op[Math.round(i*(op.length-1)/Math.max(1,d.tramos.length-1))],lineCap:'round',lineJoin:'round'}).addTo(m));
const etiqueta=(mk,txt)=>mk.bindTooltip(txt,{permanent:true,direction:'right',offset:[10,0],className:'etq'});
if(d.salida)etiqueta(L.circleMarker(d.salida.p,{radius:6,color:'${t.fondo}',weight:2,fillColor:'${t.ok}',fillOpacity:1}).addTo(m),'Salida '+d.salida.h);
if(d.llegada)etiqueta(L.circleMarker(d.llegada.p,{radius:7,color:'${t.fondo}',weight:2,fillColor:'${t.texto}',fillOpacity:1}).addTo(m),'Último '+d.llegada.h);
const conTexto=[];
d.paradas.forEach(p=>{const mk=L.marker([p.lat,p.lon],{icon:L.divIcon({className:'',html:'<div class="n">'+p.n+'</div>',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(m).bindPopup(p.n+'. '+p.txt);conTexto.push([mk,p])});
const nivel=()=>{const cerca=m.getZoom()>=15;conTexto.forEach(([mk,p])=>{if(cerca&&!mk.getTooltip())mk.bindTooltip(p.txt,{permanent:true,direction:'right',offset:[14,0],className:'etq'}).openTooltip();if(!cerca&&mk.getTooltip())mk.unbindTooltip()})};
m.on('zoomend',nivel);
const ley=L.control({position:'bottomleft'});ley.onAdd=()=>{const e=L.DomUtil.create('div','ley');e.innerHTML='<b>'+d.resumen+'</b><div class="bar"></div><span>más temprano → más tarde</span>';return e};ley.addTo(m);
if(d.todos.length){m.fitBounds(L.latLngBounds(d.todos).pad(0.2),{maxZoom:17})}else{m.setView([40.2,-3.6],5)}
nivel();
</script></body></html>`
}

export function Mapa({ c }: { c: Credenciales }) {
  const t = useTema()
  const [prendido, setPrendido] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  // Mobile 1.2 (Fragua #259): hoy, ayer, la semana o el mes.
  const [rango, setRango] = useState<'hoy' | 'ayer' | 'semana' | 'mes'>('hoy')
  const dia = rango === 'ayer' ? -1 : 0
  const [frecuentes, setFrecuentes] = useState<Frecuente[]>([])
  const [nombres, setNombres] = useState<Record<number, string>>({})
  const [datos, setDatos] = useState<DiaMapa | null>(null)
  const [enCola, setEnCola] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const traer = useCallback(async () => {
    setPrendido(await recorridoPrendido())
    const cola = await puntosEnCola().catch(() => [])
    setEnCola(cola.length)
    try {
      const d: DiaMapa = rango === 'semana' || rango === 'mes'
        ? await traerMapaRango(c, fechaDe(rango === 'semana' ? -6 : -29), fechaDe(0)).then((x) => ({ fecha: x.desde, puntos: x.puntos, paradas: x.paradas, distanciaKm: x.distanciaKm, fuentes: [], ultimo: x.puntos.at(-1) ?? null }))
        : await traerMapa(c, fechaDe(dia))
      // Lo de hoy que todavía no subió también se dibuja.
      if (rango === 'hoy' && cola.length) { d.puntos = [...d.puntos, ...cola].sort((a, b) => a.en - b.en); d.ultimo = d.puntos.at(-1) ?? d.ultimo }
      setDatos(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (rango === 'hoy' && cola.length) setDatos({ fecha: fechaDe(0), puntos: cola, paradas: [], distanciaKm: 0, fuentes: [], ultimo: cola.at(-1) ?? null })
    }
  }, [c, rango, dia])

  // Los lugares donde parás seguido y no tienen nombre: para ponérselo (quedan como lugares tuyos en Deprocast).
  const traerFrecuentes = useCallback(async () => { try { setFrecuentes((await traerLugares(c)).frecuentes) } catch { /* sin red: la próxima */ } }, [c])
  useEffect(() => { void traerFrecuentes() }, [traerFrecuentes])
  const nombrar = async (i: number, f: Frecuente) => {
    const nombre = (nombres[i] ?? '').trim()
    if (!nombre) return
    try { await guardarLugar(c, { nombre, lat: f.lat, lon: f.lon }); setNombres((x) => ({ ...x, [i]: '' })); await traerFrecuentes(); await traer() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

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
        {(['hoy', 'ayer', 'semana', 'mes'] as const).map((x) => (
          <Pressable key={x} onPress={() => setRango(x)} style={[s.chip, { borderColor: rango === x ? t.acento : t.linea }]} accessibilityRole="button">
            <Text style={[LETRA.chica, { color: rango === x ? t.acento : t.texto, fontWeight: '700' }]}>{{ hoy: 'Hoy', ayer: 'Ayer', semana: '7 días', mes: '30 días' }[x]}</Text>
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
          <Text style={[LETRA.cuerpo, { color: t.texto }]}><Text style={{ color: t.acento, fontWeight: '700' }}>{i + 1}.</Text> {rango === 'semana' || rango === 'mes' ? `${new Date(p.desde).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ` : ''}{hora(p.desde)}–{hora(p.hasta)} · {p.minutos} min</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>{p.lugar ?? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`}</Text>
        </View>
      )) : <Text style={[LETRA.chica, { color: t.tenue }]}>{datos?.puntos.length ? 'Todavía ninguna (una parada es quedarte 5 minutos o más en un lugar).' : 'Sin recorrido este día. Prendé «Anotar mi recorrido» arriba.'}</Text>}
      {frecuentes.length ? (
        <>
          <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700' }]}>Donde parás seguido</Text>
          <Text style={[LETRA.chica, { color: t.tenue }]}>Lugares donde estuviste 3 días o más este mes y no tienen nombre. Ponéselo y quedan como lugares tuyos (así tus audios y fotos de ahí quedan ubicados).</Text>
          {frecuentes.map((f, i) => (
            <View key={`${f.lat},${f.lon}`} style={[s.parada, { borderColor: t.linea }]}>
              <Text style={[LETRA.chica, { color: t.tenue }]}>{f.dias} días · {f.horas} h · {f.lat.toFixed(4)}, {f.lon.toFixed(4)}</Text>
              <View style={s.fila}>
                <TextInput value={nombres[i] ?? ''} onChangeText={(v) => setNombres((x) => ({ ...x, [i]: v }))} placeholder="¿Qué es? (la oficina, el gimnasio…)" placeholderTextColor={t.tenue} style={[s.campo, { color: t.texto, borderColor: t.linea }]} />
                <Pressable onPress={() => void nombrar(i, f)} style={s.guardar} accessibilityRole="button" accessibilityLabel="Guardar el nombre del lugar"><Text style={[LETRA.cuerpo, { color: t.acento, fontWeight: '700' }]}>Guardar</Text></Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}
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
  campo: { ...LETRA.cuerpo, flex: 1, minHeight: TOQUE, borderWidth: 1, borderRadius: 10, paddingHorizontal: ESP(3) },
  guardar: { minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: ESP(2) },
})
