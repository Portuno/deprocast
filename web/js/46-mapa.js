'use strict'
// El mapa: un componente que usan la sección Mapa y el Radar (y lo que venga). Leaflet se carga solo cuando hace falta.

const CAPAS_MAPA_UI = {
  lugar: { nombre: 'Lugares', color: '#b9a37a', icono: '⌖' },
  linea: { nombre: 'Línea', color: '#7aa2d6', icono: '⟿' },
  radar: { nombre: 'Radar', color: '#e0a64f', icono: '◍' },
  mision: { nombre: 'Misiones', color: '#86c08a', icono: '⚔' },
  google: { nombre: 'Mi calendario', color: '#c58ad6', icono: '▦' },
}

let leafletListo = null
/** Carga Leaflet (cdnjs) una sola vez. */
function cargarLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (leafletListo) return leafletListo
  leafletListo = new Promise((ok, mal) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
    js.onload = () => ok(window.L)
    js.onerror = () => { leafletListo = null; mal(new Error('No pude cargar el mapa (¿sin internet?)')) }
    document.head.appendChild(js)
  })
  return leafletListo
}

const temaClaro = () => document.documentElement.dataset.tema === 'claro'
const fechaCorta = (f) => (f ? new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: f.slice(0, 4) !== String(new Date().getFullYear()) ? 'numeric' : undefined }) : '')

/**
 * Pinta puntos en un contenedor. Los que se tocan en pantalla se juntan en una burbuja con su cuenta (se abre al acercar).
 * o.alAccion(accion, punto): lo que hacen los botones de la ventanita («ver», «agendar»…).
 */
async function pintarMapa(el, puntos, o = {}) {
  const L = await cargarLeaflet()
  if (el._mapa) { el._mapa.remove(); el._mapa = null }
  const mapa = L.map(el, { zoomControl: true, worldCopyJump: true, attributionControl: true })
  el._mapa = mapa
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${temaClaro() ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png`, {
    maxZoom: 19, subdomains: 'abcd', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(mapa)
  const capa = L.layerGroup().addTo(mapa)
  const popup = (p) => {
    const c = CAPAS_MAPA_UI[p.capa] ?? { nombre: p.capa, color: '#999', icono: '·' }
    return `<div class="mp-pop"><small style="color:${c.color}">${c.icono} ${esc(c.nombre)}${p.aprox ? ' · aprox.' : ''}</small><b>${esc(p.titulo)}</b>${p.fecha ? `<span>${esc(fechaCorta(p.fecha))}</span>` : ''}${p.detalle ? `<em>${esc(String(p.detalle).slice(0, 160))}</em>` : ''}
      <div class="mp-acc">${(o.acciones?.(p) ?? accionesDePunto(p)).map(([a, t]) => `<button class="btn btn-chico" data-mp="${a}" data-id="${esc(p.id)}">${t}</button>`).join('')}</div></div>`
  }
  const dibujar = () => {
    capa.clearLayers()
    // Agrupar lo que queda a menos de 28 px.
    const grupos = []
    for (const p of puntos) {
      const xy = mapa.latLngToLayerPoint([p.lat, p.lon])
      const g = grupos.find((x) => x.xy.distanceTo(xy) < 28)
      if (g) g.ps.push(p)
      else grupos.push({ xy, ps: [p] })
    }
    for (const g of grupos) {
      if (g.ps.length === 1) {
        const p = g.ps[0]
        const c = CAPAS_MAPA_UI[p.capa] ?? { color: '#999' }
        L.circleMarker([p.lat, p.lon], { radius: 7 + Math.min(8, Math.log2(1 + (p.peso ?? 0)) * 1.6), color: c.color, weight: 2, fillColor: c.color, fillOpacity: p.aprox ? 0.35 : 0.7 })
          .bindPopup(popup(p), { maxWidth: 280 }).bindTooltip(esc(p.titulo), { direction: 'top', offset: [0, -6] }).addTo(capa)
      } else {
        const lat = g.ps.reduce((s, p) => s + p.lat, 0) / g.ps.length
        const lon = g.ps.reduce((s, p) => s + p.lon, 0) / g.ps.length
        const colores = [...new Set(g.ps.map((p) => CAPAS_MAPA_UI[p.capa]?.color ?? '#999'))]
        const icono = L.divIcon({ className: 'mp-grupo', html: `<span style="background:${colores.length === 1 ? colores[0] : `conic-gradient(${colores.map((c, i) => `${c} ${(i / colores.length) * 100}% ${((i + 1) / colores.length) * 100}%`).join(',')})`}">${g.ps.length}</span>`, iconSize: [30, 30] })
        L.marker([lat, lon], { icon: icono }).on('click', () => mapa.fitBounds(L.latLngBounds(g.ps.map((p) => [p.lat, p.lon])).pad(0.4))).bindTooltip(g.ps.slice(0, 6).map((p) => esc(p.titulo)).join('<br>') + (g.ps.length > 6 ? `<br>y ${g.ps.length - 6} más` : ''), { direction: 'top' }).addTo(capa)
      }
    }
  }
  mapa.on('zoomend', dibujar)
  mapa.on('popupopen', (e) => {
    $$('[data-mp]', e.popup.getElement()).forEach((b) => (b.onclick = () => {
      const p = puntos.find((x) => x.id === b.dataset.id)
      if (p) (o.alAccion ?? accionDePunto)(b.dataset.mp, p)
    }))
  })
  if (puntos.length) mapa.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lon])).pad(0.15), { maxZoom: 13 })
  else mapa.setView(o.centro ?? [30, 0], o.zoom ?? 2)
  dibujar()
  setTimeout(() => mapa.invalidateSize(), 50)
  return mapa
}

/** Lo que se puede hacer con cada punto desde su ventanita. */
function accionesDePunto(p) {
  const r = p.ref ?? {}
  return [
    r.tipo === 'pieza' ? ['pieza', 'Ver de dónde salió'] : null,
    r.tipo === 'entidad' ? ['entidad', 'Ver el lugar'] : null,
    r.tipo === 'oportunidad' ? ['radar', 'Ver en el Radar'] : null,
    p.url ? ['abrir', 'Abrir ↗'] : null,
  ].filter(Boolean)
}
function accionDePunto(accion, p) {
  if (accion === 'pieza') modalPieza(Number(p.ref.id))
  else if (accion === 'entidad') cargarScript('50-saber.js').then(() => { filtroEnt.sel = Number(p.ref.id); irA('entidades') })
  else if (accion === 'radar') irA('radar')
  else if (accion === 'abrir' && p.url) window.open(p.url, '_blank', 'noopener')
}

// ─── la sección Mapa ────────────────────────────────────────────────────

const mapaEstado = { capas: new Set((() => { try { return JSON.parse(localStorage.getItem('mastro-mapa-capas') ?? 'null') } catch { return null } })() ?? Object.keys(CAPAS_MAPA_UI)) }

async function montarMapa() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Mapa</h1><p>Dónde pasa lo de tu mundo: los lugares que aparecen en tu archivo, los eventos de tu Línea, lo que encontró el Radar, tus side quests y tu calendario.</p></div>
    <div class="mp-barra">
      <div class="mp-capas">${Object.entries(CAPAS_MAPA_UI).map(([k, c]) => `<button class="chip-capa ${mapaEstado.capas.has(k) ? 'activo' : ''}" data-capa="${k}" style="--c:${c.color}">${c.icono} ${esc(c.nombre)} <small data-cuenta="${k}"></small></button>`).join('')}</div>
      <div class="fila"><input class="campo-suelto" id="mp-buscar" placeholder="Buscar un lugar…"><button class="btn btn-chico" id="mp-yo" title="Centrar en donde estás">◎ Centrar en mí</button></div>
    </div>
    <div class="mp-lienzo" id="mp-mapa"></div>
    <p class="tenue chico" id="mp-nota"></p>`
  $$('[data-capa]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.capa
    mapaEstado.capas.has(k) ? mapaEstado.capas.delete(k) : mapaEstado.capas.add(k)
    try { localStorage.setItem('mastro-mapa-capas', JSON.stringify([...mapaEstado.capas])) } catch {}
    b.classList.toggle('activo')
    pintarSeccionMapa()
  }))
  $('#mp-buscar').onkeydown = async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return
    try {
      const r = await api(`/mapa/buscar?q=${encodeURIComponent(e.target.value.trim())}`)
      if (!r.lugar) return toast('No encontré ese lugar', 'suave')
      $('#mp-mapa')._mapa?.flyTo([r.lugar.lat, r.lugar.lon], 13)
    } catch (err) { error(err) }
  }
  $('#mp-yo').onclick = () => {
    if (!navigator.geolocation) return toast('Este navegador no da la ubicación')
    navigator.geolocation.getCurrentPosition((p) => $('#mp-mapa')._mapa?.flyTo([p.coords.latitude, p.coords.longitude], 13), () => toast('No me diste permiso para ver dónde estás', 'suave'))
  }
  await pintarSeccionMapa()
}

async function pintarSeccionMapa() {
  const el = $('#mp-mapa')
  if (!el) return
  try {
    const d = await api(`/mapa?capas=${[...mapaEstado.capas].join(',') || 'ninguna'}`)
    for (const k of Object.keys(CAPAS_MAPA_UI)) { const s = $(`[data-cuenta="${k}"]`); if (s) s.textContent = mapaEstado.capas.has(k) ? d.puntos.filter((p) => p.capa === k).length : '' }
    $('#mp-nota').textContent = d.puntos.length
      ? `${d.puntos.length} puntos.${d.sinUbicar ? ` Buscando ${d.sinUbicar} lugares más en el mapa (aparecen en un rato).` : ''} Los marcados «aprox.» tienen la posición que dedujo Mastropiero.`
      : 'Todavía no hay nada con lugar en estas capas.'
    await pintarMapa(el, d.puntos)
  } catch (e) { el.innerHTML = `<p class="tenue" style="padding:20px">${esc(e.message)}</p>` }
}
