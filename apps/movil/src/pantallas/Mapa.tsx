/**
 * El Mapa (Mobile 2.0): el mapa ocupa toda la pantalla y lo demás flota encima.
 * - Arriba: el recorrido (un toque lo prende o apaga) y el rango (Hoy, Ayer, 7 días, 30 días).
 * - El trazo se pinta por ritmo de pasos (logica/mapa.ts): los pasos que contó el teléfono, hora por hora, se ubican en
 *   los tramos que ibas a pie; así se ve DÓNDE caminaste (más fuerte = paso más firme; punteado = sin pasos: quieto o
 *   en un vehículo). Si hubo pasos sin recorrido, lo dice y cómo arreglarlo.
 * - Mantener apretado el mapa marca un lugar (casa, trabajo, una empresa, un destino…); los lugares donde parás seguido
 *   y no tienen nombre aparecen como círculos punteados: tocalos para nombrarlos.
 * - Abajo, la línea del día: paradas y trayectos con su hora, distancia y pasos. Tocá uno y el mapa va ahí.
 * La página del mapa se carga una sola vez; los datos se le pasan después (antes se recargaba entera cada minuto y
 * perdías el zoom).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { marcarLugar, traerLugaresPropios, traerMapa, traerMapaRango, type Credenciales, type DiaMapa, type Frecuente, type LugarPropio, type PuntoMapa, type TipoLugar } from '../api'
import { pasosDe, pasosHoraEntre } from '../almacen'
import { apagarRecorrido, prenderRecorrido, puntosEnCola, recorridoPrendido } from '../recorrido'
import { alCambiar, sincronizar } from '../sincronizar'
import { AREA_EXTRA, ESP, LETRA, TOQUE, useTema, type Tema } from '../tema'
import { lineaDelDia, pasosEnTramos, tramosPorRitmo, type Momento } from '../logica/mapa'

type Rango = 'hoy' | 'ayer' | 'semana' | 'mes'
const RANGOS: { clave: Rango; nombre: string }[] = [{ clave: 'hoy', nombre: 'Hoy' }, { clave: 'ayer', nombre: 'Ayer' }, { clave: 'semana', nombre: '7 d' }, { clave: 'mes', nombre: '30 d' }]
export const TIPOS: { clave: TipoLugar; nombre: string; icono: string }[] = [
  { clave: 'casa', nombre: 'Casa', icono: '🏠' }, { clave: 'trabajo', nombre: 'Trabajo', icono: '💼' }, { clave: 'empresa', nombre: 'Empresa', icono: '🏢' },
  { clave: 'destino', nombre: 'Destino', icono: '🎯' }, { clave: 'frecuente', nombre: 'Frecuente', icono: '⭐' }, { clave: 'otro', nombre: 'Otro', icono: '📍' },
]
const iconoDe = (tipo: TipoLugar | null) => TIPOS.find((x) => x.clave === tipo)?.icono ?? '📍'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`)
const fechaDe = (desplazamiento: number) => { const d = new Date(Date.now() + desplazamiento * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const miles = (n: number) => n.toLocaleString('es-AR')

/** La página del mapa (Leaflet + OpenStreetMap, sin cuentas ni claves). Se arma una vez; los datos llegan por pintar(). */
function paginaDelMapa(t: Tema): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{height:100%;margin:0;background:${t.fondo};font:13px system-ui}
.n{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${t.acento};color:${t.sobreAcento};font-weight:700;border:2px solid ${t.fondo};box-shadow:0 1px 4px #0006}
.l{font-size:22px;line-height:26px;text-align:center;filter:drop-shadow(0 1px 2px #0008)}
.etq{background:${t.panel};color:${t.texto};border:1px solid ${t.linea};border-radius:8px;padding:2px 6px;box-shadow:none}
.etq:before{display:none}
.leaflet-control-attribution{font-size:9px;opacity:.6}</style></head>
<body><div id="m"></div><script>
const m=L.map('m',{zoomControl:false,attributionControl:true}).setView([40.2,-3.6],5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(m);
const capa=L.layerGroup().addTo(m);
const post=(x)=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(x));
const estilo=[{color:'${t.tenue}',weight:3,opacity:.7,dashArray:'4 6'},{color:'${t.acento}',weight:5,opacity:.55},{color:'${t.acento}',weight:6,opacity:1},{color:'${t.ok}',weight:7,opacity:1}];
let conTexto=[];
const nivel=()=>{const cerca=m.getZoom()>=15;conTexto.forEach(([mk,txt])=>{if(cerca&&!mk.getTooltip())mk.bindTooltip(txt,{permanent:true,direction:'right',offset:[14,0],className:'etq'}).openTooltip();if(!cerca&&mk.getTooltip())mk.unbindTooltip()})};
m.on('zoomend',nivel);
m.on('contextmenu',(e)=>post({tipo:'marcar',lat:e.latlng.lat,lon:e.latlng.lng}));
window.pintar=(d,ajustar)=>{
  capa.clearLayers();conTexto=[];
  d.tramos.forEach((x)=>L.polyline(x.p,Object.assign({lineCap:'round',lineJoin:'round'},estilo[x.r])).addTo(capa));
  const pin=(p,color,txt)=>L.circleMarker(p,{radius:6,color:'${t.fondo}',weight:2,fillColor:color,fillOpacity:1}).addTo(capa).bindTooltip(txt,{permanent:true,direction:'right',offset:[10,0],className:'etq'});
  if(d.salida)pin(d.salida.p,'${t.ok}','Salida '+d.salida.h);
  if(d.llegada)pin(d.llegada.p,'${t.texto}','Último '+d.llegada.h);
  d.frecuentes.forEach((f)=>L.circle([f.lat,f.lon],{radius:70,color:'${t.acento}',weight:2,dashArray:'5 5',fillOpacity:.08}).addTo(capa).on('click',()=>post({tipo:'frecuente',i:f.i})));
  d.lugares.forEach((l)=>{const mk=L.marker([l.lat,l.lon],{icon:L.divIcon({className:'',html:'<div class="l">'+l.icono+'</div>',iconSize:[26,26],iconAnchor:[13,13]})}).addTo(capa);conTexto.push([mk,l.nombre])});
  d.paradas.forEach((p)=>{const mk=L.marker([p.lat,p.lon],{icon:L.divIcon({className:'',html:'<div class="n">'+p.n+'</div>',iconSize:[26,26],iconAnchor:[13,13]})}).addTo(capa).on('click',()=>post({tipo:'parada',n:p.n}));conTexto.push([mk,p.txt])});
  if(ajustar){if(d.todos.length)m.fitBounds(L.latLngBounds(d.todos).pad(.15),{maxZoom:17,paddingTopLeft:[0,60],paddingBottomRight:[0,120]});else if(d.lugares.length)m.setView([d.lugares[0].lat,d.lugares[0].lon],14)}
  nivel();
};
window.ir=(a,b)=>{if(b)m.fitBounds(L.latLngBounds([a,b]).pad(.3),{maxZoom:17});else m.setView(a,Math.max(m.getZoom(),16))};
post({tipo:'listo'});
</script></body></html>`
}

type Datos = { dia: DiaMapa; puntos: PuntoMapa[]; porTramo: number[]; sinUbicar: number; pasos: number; momentos: Momento[] }

export function Mapa({ c }: { c: Credenciales }) {
  const t = useTema()
  const alto = useWindowDimensions().height
  // El WebView está tipado como componente sin ref, pero la expone (injectJavaScript): se la toma con su forma mínima.
  const web = useRef<{ injectJavaScript: (js: string) => void } | null>(null)
  const conRef = { ref: web } as object
  const [listo, setListo] = useState(false)
  const [prendido, setPrendido] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [rango, setRango] = useState<Rango>('hoy')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [lugares, setLugares] = useState<LugarPropio[]>([])
  const [frecuentes, setFrecuentes] = useState<Frecuente[]>([])
  const [abierto, setAbierto] = useState(false)
  const [marcar, setMarcar] = useState<{ lat: number; lon: number; sugerido?: string } | null>(null)
  // El primer dibujo de cada rango encuadra el mapa; los que siguen (cada minuto, al sincronizar) no te mueven.
  const ajustar = useRef(true)
  const pagina = useMemo(() => paginaDelMapa(t), [t])

  const traer = useCallback(async () => {
    setPrendido(await recorridoPrendido())
    const cola = rango === 'hoy' ? await puntosEnCola().catch(() => []) : []
    const desde = fechaDe(rango === 'ayer' ? -1 : rango === 'semana' ? -6 : rango === 'mes' ? -29 : 0)
    const hasta = fechaDe(rango === 'ayer' ? -1 : 0)
    let dia: DiaMapa
    try {
      dia = rango === 'semana' || rango === 'mes'
        ? await traerMapaRango(c, desde, hasta).then((x) => ({ fecha: x.desde, puntos: x.puntos, paradas: x.paradas, distanciaKm: x.distanciaKm, fuentes: [], ultimo: x.puntos.at(-1) ?? null }))
        : await traerMapa(c, desde)
      setAviso((a) => (a?.startsWith('Sin conexión') ? null : a))
    } catch (e) {
      dia = { fecha: desde, puntos: [], paradas: [], distanciaKm: 0, fuentes: [], ultimo: null }
      setAviso(`Sin conexión: ${e instanceof Error ? e.message : String(e)}`)
    }
    // Lo de hoy que todavía no subió también se dibuja.
    const puntos = [...dia.puntos, ...cola].sort((a, b) => a.en - b.en)
    const horas = await pasosHoraEntre(desde, hasta).catch(() => [])
    const { porTramo, sinUbicar } = pasosEnTramos(puntos, horas)
    // El total: lo de las horas o, en un día suelto, lo del día (si el teléfono contó sin repartir por hora), lo que sea más.
    const porHoras = horas.reduce((s, h) => s + h.pasos, 0)
    const pasos = desde === hasta ? Math.max(porHoras, await pasosDe(desde).catch(() => 0)) : porHoras
    setDatos({ dia, puntos, porTramo, sinUbicar: sinUbicar + Math.max(0, pasos - porHoras), pasos, momentos: lineaDelDia(puntos, dia.paradas, porTramo) })
  }, [c, rango])

  const traerLugares = useCallback(async () => {
    try { const r = await traerLugaresPropios(c); setLugares(r.lugares); setFrecuentes(r.frecuentes) } catch { /* sin red: la próxima */ }
  }, [c])

  useEffect(() => { ajustar.current = true; void traer() }, [traer])
  useEffect(() => { void traerLugares() }, [traerLugares])
  useEffect(() => {
    const x = setInterval(traer, 60_000)
    const sacar = alCambiar(() => { void traer() })
    return () => { clearInterval(x); sacar() }
  }, [traer])

  // Los datos a la página (sin recargarla).
  useEffect(() => {
    if (!listo || !datos) return
    const ps = datos.puntos
    const d = {
      tramos: tramosPorRitmo(ps, datos.porTramo).map((x) => ({ r: x.ritmo, p: x.puntos.map((p) => [p.lat, p.lon]) })),
      salida: ps[0] ? { p: [ps[0].lat, ps[0].lon], h: hora(ps[0].en) } : null,
      llegada: ps.length > 1 ? { p: [ps.at(-1)!.lat, ps.at(-1)!.lon], h: hora(ps.at(-1)!.en) } : null,
      paradas: datos.dia.paradas.map((p, i) => ({ n: i + 1, lat: p.lat, lon: p.lon, txt: `${p.lugar ? p.lugar + ' · ' : ''}${hora(p.desde)}–${hora(p.hasta)}` })),
      lugares: lugares.map((l) => ({ id: l.id, nombre: l.nombre, lat: l.lat, lon: l.lon, icono: iconoDe(l.tipo) })),
      frecuentes: frecuentes.map((f, i) => ({ i, lat: f.lat, lon: f.lon })),
      todos: ps.map((p) => [p.lat, p.lon]),
    }
    web.current?.injectJavaScript(`window.pintar(${JSON.stringify(d)}, ${ajustar.current}); true;`)
    ajustar.current = false
  }, [listo, datos, lugares, frecuentes])

  const ir = (a: { lat: number; lon: number }, b?: { lat: number; lon: number }) => {
    web.current?.injectJavaScript(`window.ir([${a.lat},${a.lon}]${b ? `,[${b.lat},${b.lon}]` : ''}); true;`)
  }

  const alMensaje = (ev: WebViewMessageEvent) => {
    let x: { tipo: string; lat?: number; lon?: number; i?: number; n?: number }
    try { x = JSON.parse(ev.nativeEvent.data) } catch { return }
    if (x.tipo === 'listo') setListo(true)
    else if (x.tipo === 'marcar' && x.lat != null && x.lon != null) setMarcar({ lat: x.lat, lon: x.lon })
    else if (x.tipo === 'frecuente' && x.i != null && frecuentes[x.i]) { const f = frecuentes[x.i]; setMarcar({ lat: f.lat, lon: f.lon, sugerido: `${f.dias} días · ${f.horas} h acá este mes` }) }
    else if (x.tipo === 'parada') setAbierto(true)
  }

  const cambiar = async () => {
    setAviso(null)
    if (prendido) await apagarRecorrido()
    else { const r = await prenderRecorrido(); setAviso(r.aviso) }
    await traer()
  }

  const sinRecorrido = () => Alert.alert(
    `${miles(datos?.sinUbicar ?? 0)} pasos sin recorrido`,
    'El teléfono contó esos pasos pero el GPS no anotó por dónde. En Huawei pasa porque el sistema cierra el servicio: Ajustes → Batería → Inicio de aplicaciones → Deprocast → «Gestionar manualmente» con las tres opciones prendidas. Y la ubicación en «Permitir todo el tiempo».',
    [{ text: 'Abrir ajustes', onPress: () => void Linking.openSettings() }, { text: 'Listo', style: 'cancel' }],
  )

  const resumen = datos ? [`${datos.dia.distanciaKm} km`, datos.pasos ? `${miles(datos.pasos)} pasos` : null, `${datos.dia.paradas.length} parada${datos.dia.paradas.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') : 'Cargando…'

  return (
    <View style={[s.raiz, { backgroundColor: t.fondo }]}>
      <WebView {...conRef} originWhitelist={['*']} source={{ html: pagina }} style={[s.mapa, { backgroundColor: t.fondo }]} onMessage={alMensaje} setSupportMultipleWindows={false} onLoadStart={() => setListo(false)} />

      <View style={s.arriba} pointerEvents="box-none">
        <Pressable onPress={cambiar} style={[s.pastilla, { backgroundColor: t.panel, borderColor: prendido ? t.acento : t.linea }]} accessibilityRole="switch" accessibilityState={{ checked: prendido }} accessibilityLabel="Anotar mi recorrido">
          <View style={[s.punto, { backgroundColor: prendido ? t.acento : t.tenue }]} />
          <Text style={[LETRA.chica, { color: prendido ? t.texto : t.tenue, fontWeight: '700' }]}>{prendido ? 'Anotando' : 'Apagado'}</Text>
        </Pressable>
        <View style={[s.rangos, { backgroundColor: t.panel, borderColor: t.linea }]}>
          {RANGOS.map((r) => (
            <Pressable key={r.clave} onPress={() => setRango(r.clave)} style={[s.rango, rango === r.clave && { backgroundColor: t.acento }]} accessibilityRole="button" accessibilityState={{ selected: rango === r.clave }}>
              <Text style={[LETRA.chica, { color: rango === r.clave ? t.sobreAcento : t.texto, fontWeight: '700' }]}>{r.nombre}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {aviso ? (
        <Pressable onPress={() => setAviso(null)} style={[s.aviso, { backgroundColor: t.panel, borderColor: t.linea }]} accessibilityRole="button" accessibilityLabel="Cerrar el aviso">
          <Text style={[LETRA.chica, { color: t.texto }]} numberOfLines={3}>{aviso}</Text>
        </Pressable>
      ) : null}

      <View style={[s.hoja, { backgroundColor: t.panel, borderColor: t.linea, maxHeight: abierto ? alto * 0.55 : undefined }]}>
        <Pressable onPress={() => setAbierto((x) => !x)} style={s.cabeza} accessibilityRole="button" accessibilityLabel={abierto ? 'Cerrar la línea del día' : 'Ver la línea del día'}>
          <View style={[s.asa, { backgroundColor: t.linea }]} />
          <View style={s.filaResumen}>
            <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '700', flex: 1 }]} numberOfLines={1}>{resumen}</Text>
            <Text style={[LETRA.cuerpo, { color: t.tenue }]}>{abierto ? '▾' : '▴'}</Text>
          </View>
        </Pressable>
        {datos && datos.sinUbicar >= 300 ? (
          <Pressable onPress={sinRecorrido} style={s.renglon} accessibilityRole="button">
            <Text style={[LETRA.chica, { color: t.acento }]}>🚶 {miles(datos.sinUbicar)} pasos sin recorrido · ¿por qué?</Text>
          </Pressable>
        ) : null}
        {abierto ? (
          <ScrollView contentContainerStyle={s.lista}>
            <View style={s.leyenda}>
              <Text style={[LETRA.chica, { color: t.acento }]}>━ a pie</Text>
              <Text style={[LETRA.chica, { color: t.ok }]}>━ paso firme</Text>
              <Text style={[LETRA.chica, { color: t.tenue }]}>┅ sin pasos</Text>
            </View>
            {datos?.momentos.length ? datos.momentos.slice(0, 200).map((x, i) => (
              <Pressable key={i} onPress={() => (x.tipo === 'parada' ? ir(x) : ir(x.a, x.b))} style={[s.momento, { borderColor: t.linea }]} accessibilityRole="button">
                <Text style={LETRA.titulo}>{x.tipo === 'parada' ? '📍' : x.pasos ? '🚶' : '🚗'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '600' }]} numberOfLines={1}>
                    {x.tipo === 'parada' ? `${x.n}. ${x.lugar ?? 'Parada'}` : `${x.km} km${x.pasos ? ` · ${miles(x.pasos)} pasos` : ''}`}
                  </Text>
                  <Text style={[LETRA.chica, { color: t.tenue }]}>{rango === 'semana' || rango === 'mes' ? `${new Date(x.desde).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · ` : ''}{hora(x.desde)}–{hora(x.hasta)} · {dur(x.minutos)}</Text>
                </View>
                {x.tipo === 'parada' && !x.lugar ? (
                  <Pressable onPress={() => setMarcar({ lat: x.lat, lon: x.lon })} style={s.nombrar} hitSlop={AREA_EXTRA} accessibilityRole="button" accessibilityLabel="Marcar este lugar">
                    <Text style={[LETRA.chica, { color: t.acento, fontWeight: '700' }]}>Marcar</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            )) : <Text style={[LETRA.chica, { color: t.tenue }]}>{prendido ? 'Todavía nada: se va dibujando mientras te movés.' : 'Sin recorrido. Prendelo arriba a la izquierda.'}</Text>}
            <Text style={[LETRA.chica, { color: t.tenue }]}>Mantené apretado el mapa para marcar un lugar.</Text>
            <Pressable onPress={() => void sincronizar(c).then(traer)} style={s.renglon} accessibilityRole="button"><Text style={[LETRA.chica, { color: t.acento, fontWeight: '700' }]}>↻ Actualizar</Text></Pressable>
          </ScrollView>
        ) : null}
      </View>

      <MarcarLugar c={c} lugar={marcar} cerrar={(ok) => { setMarcar(null); if (ok) { void traerLugares(); void traer() } }} />
    </View>
  )
}

/** Marcar un lugar (casa, trabajo, una empresa…): queda como lugar tuyo en Deprocast, con su tipo. */
function MarcarLugar({ c, lugar, cerrar }: { c: Credenciales; lugar: { lat: number; lon: number; sugerido?: string } | null; cerrar: (ok: boolean) => void }) {
  const t = useTema()
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoLugar>('otro')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setNombre(''); setTipo('otro'); setError(null) }, [lugar])
  const guardar = async () => {
    if (!lugar) return
    const n = nombre.trim() || TIPOS.find((x) => x.clave === tipo)!.nombre
    try { await marcarLugar(c, { nombre: n, lat: lugar.lat, lon: lugar.lon, tipo }); cerrar(true) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <Modal visible={!!lugar} transparent animationType="slide" onRequestClose={() => cerrar(false)}>
      <Pressable style={s.velo} onPress={() => cerrar(false)} />
      <View style={[s.sobre, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Text style={[LETRA.titulo, { color: t.texto, fontWeight: '700' }]}>Marcar este lugar</Text>
        {lugar?.sugerido ? <Text style={[LETRA.chica, { color: t.tenue }]}>{lugar.sugerido}</Text> : null}
        <View style={s.tipos}>
          {TIPOS.map((x) => (
            <Pressable key={x.clave} onPress={() => setTipo(x.clave)} style={[s.tipo, { borderColor: tipo === x.clave ? t.acento : t.linea, backgroundColor: tipo === x.clave ? t.fondo : 'transparent' }]} accessibilityRole="radio" accessibilityState={{ selected: tipo === x.clave }}>
              <Text style={[LETRA.chica, { color: tipo === x.clave ? t.acento : t.texto, fontWeight: '700' }]}>{x.icono} {x.nombre}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput value={nombre} onChangeText={setNombre} placeholder="Nombre (opcional): «lo de Ana», «Mercadona»…" placeholderTextColor={t.tenue} style={[s.campo, { color: t.texto, borderColor: t.linea }]} />
        {error ? <Text style={[LETRA.chica, { color: t.mal }]}>{error}</Text> : null}
        <Pressable onPress={guardar} style={[s.guardar, { backgroundColor: t.acento }]} accessibilityRole="button">
          <Text style={[LETRA.cuerpo, { color: t.sobreAcento, fontWeight: '700' }]}>Guardar</Text>
        </Pressable>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  mapa: { flex: 1 },
  arriba: { position: 'absolute', top: ESP(3), left: ESP(3), right: ESP(3), flexDirection: 'row', alignItems: 'center', gap: ESP(2) },
  pastilla: { minHeight: TOQUE - ESP(1), flexDirection: 'row', alignItems: 'center', gap: ESP(2), borderWidth: 1, borderRadius: 999, paddingHorizontal: ESP(3), elevation: 3 },
  punto: { width: ESP(2) + 2, height: ESP(2) + 2, borderRadius: ESP(2) },
  rangos: { marginLeft: 'auto', flexDirection: 'row', borderWidth: 1, borderRadius: 999, padding: ESP(1), elevation: 3 },
  rango: { minHeight: TOQUE - ESP(3), minWidth: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 999, paddingHorizontal: ESP(2) },
  aviso: { position: 'absolute', top: ESP(16), left: ESP(3), right: ESP(3), minHeight: TOQUE, justifyContent: 'center', borderWidth: 1, borderRadius: 12, padding: ESP(3), elevation: 3 },
  hoja: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: ESP(4), paddingBottom: ESP(2), elevation: 8 },
  cabeza: { minHeight: TOQUE + ESP(2), justifyContent: 'center', gap: ESP(2), paddingTop: ESP(2) },
  asa: { alignSelf: 'center', width: ESP(10), height: ESP(1), borderRadius: ESP(1) },
  filaResumen: { flexDirection: 'row', alignItems: 'center', gap: ESP(2) },
  renglon: { minHeight: TOQUE, justifyContent: 'center' },
  lista: { gap: ESP(1), paddingBottom: ESP(4) },
  leyenda: { flexDirection: 'row', gap: ESP(4), paddingBottom: ESP(2) },
  momento: { minHeight: TOQUE + ESP(2), flexDirection: 'row', alignItems: 'center', gap: ESP(3), borderBottomWidth: 1, paddingVertical: ESP(2) },
  nombrar: { paddingHorizontal: ESP(2) },
  velo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sobre: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, padding: ESP(5), gap: ESP(3), paddingBottom: ESP(9) },
  tipos: { flexDirection: 'row', flexWrap: 'wrap', gap: ESP(2) },
  tipo: { minHeight: TOQUE, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: ESP(3) },
  campo: { ...LETRA.cuerpo, minHeight: TOQUE, borderWidth: 1, borderRadius: 10, paddingHorizontal: ESP(3) },
  guardar: { minHeight: TOQUE + ESP(2), justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
})
