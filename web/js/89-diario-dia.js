'use strict'
// El Diario del día (Mobile 2.2): todo lo que se capturó de un día, en una línea de tiempo. Arriba los números, al
// costado el mapa del día con las paradas, abajo los pasos por hora, y la línea: sueño, agenda, paradas y trayectos,
// fotos, charlas, comidas, ánimo y gastos, cada cosa con su hora. Sale de /api/diario-dia (src/diario-dia.ts).

const ddia = { fecha: null, mapa: null }
const hoyDdia = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const correrDdia = (f, dias) => { const [a, m, d] = f.split('-').map(Number); const x = new Date(a, m - 1, d + dias, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const hmDdia = (t) => new Date(t).toTimeString().slice(0, 5)
const durDdia = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)

async function montarDiarioDia() {
  ddia.fecha ??= hoyDdia()
  $('#principal').innerHTML = `<div class="ddia">
    <div class="ddia-cab"><h1>Diario del día</h1>
      <div class="ddia-nav"><button class="btn btn-chico" id="dd-antes" aria-label="Día anterior">‹</button><b id="dd-fecha"></b><button class="btn btn-chico" id="dd-despues" aria-label="Día siguiente">›</button></div></div>
    <div id="dd-cuerpo"><p class="tenue">Cargando…</p></div>
  </div>`
  $('#dd-antes').onclick = () => { ddia.fecha = correrDdia(ddia.fecha, -1); pintarDiarioDia() }
  $('#dd-despues').onclick = () => { if (ddia.fecha < hoyDdia()) { ddia.fecha = correrDdia(ddia.fecha, 1); pintarDiarioDia() } }
  await pintarDiarioDia()
}

async function pintarDiarioDia() {
  const f = ddia.fecha
  $('#dd-fecha').textContent = f === hoyDdia() ? 'Hoy' : new Date(`${f}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })
  $('#dd-despues').disabled = f >= hoyDdia()
  let d
  try { d = await api(`/diario-dia?fecha=${f}`) } catch (e) { return error(e) }
  const cuerpo = $('#dd-cuerpo')
  if (!cuerpo || ddia.fecha !== f) return
  const r = d.resumen
  const num = (valor, que) => (valor == null || valor === 0 || valor === '0' ? '' : `<div class="tarjeta ddia-num"><b>${valor}</b><small>${que}</small></div>`)
  const nums = [
    num(r.pasos ? r.pasos.toLocaleString('es-AR') : 0, 'pasos'), num(r.km ? `${String(r.km).replace('.', ',')} km` : 0, 'recorridos'),
    num(r.suenoHoras ? `${String(r.suenoHoras).replace('.', ',')} h` : null, 'de sueño'), num(r.animo ? `${String(r.animo).replace('.', ',')}/5` : null, 'ánimo'),
    num(r.pantallaMin != null ? durDdia(r.pantallaMin) : null, 'de pantalla'), num(r.gastos ? `${r.gastos.toLocaleString('es-ES')} €` : 0, 'gastados'),
    num(r.fotos, `foto${r.fotos === 1 ? '' : 's'}`), num(r.charlas, `charla${r.charlas === 1 ? '' : 's'}`), num(r.paradas, `parada${r.paradas === 1 ? '' : 's'}`),
  ].join('')
  const max = Math.max(1, ...d.pasosPorHora)
  const barras = d.pasosPorHora.some((x) => x) ? `<div class="ddia-horas" title="Pasos por hora">${d.pasosPorHora.map((x, h) => `<i style="height:${Math.max(4, Math.round((x / max) * 100))}%" class="${x ? 'con' : ''}" title="${h} h · ${x.toLocaleString('es-AR')} pasos"></i>`).join('')}</div><div class="ddia-eje tenue"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 h</span></div>` : ''
  const linea = d.momentos.length ? d.momentos.map((m) => `
    <li class="ddia-m ddia-${m.tipo}" ${m.lat != null ? `data-lat="${m.lat}" data-lon="${m.lon}"` : ''}>
      <span class="ddia-hora">${hmDdia(m.en)}</span><span class="ddia-ico">${m.icono}</span>
      <div class="ddia-txt"><b>${esc(m.titulo)}</b>${m.sub ? `<small>${esc(m.sub)}</small>` : ''}
        ${m.foto ? `<a href="${esc(m.foto)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(m.foto)}?ancho=480" alt=""></a>` : ''}</div>
    </li>`).join('') : '<li class="vacio">Nada capturado este día. Con la app del teléfono (recorrido, escucha, fotos) se va llenando solo.</li>'
  cuerpo.innerHTML = `${nums ? `<div class="ddia-nums">${nums}</div>` : ''}
    <div class="ddia-grilla">
      <section class="tarjeta"><h3 class="sub">El día</h3>${barras}<ol class="ddia-linea">${linea}</ol></section>
      ${d.mapa.puntos.length || d.mapa.paradas.length ? '<section class="tarjeta ddia-mapa"><div id="dd-mapa"></div></section>' : ''}
    </div>`
  if (d.mapa.puntos.length || d.mapa.paradas.length) await pintarMapaDdia(d)
  // Tocar algo con lugar lo muestra en el mapa.
  for (const li of cuerpo.querySelectorAll('.ddia-m[data-lat]')) li.onclick = () => ddia.mapa?.setView([Number(li.dataset.lat), Number(li.dataset.lon)], 16)
}

async function pintarMapaDdia(d) {
  try { await cargarLeaflet() } catch { $('#dd-mapa').innerHTML = '<p class="tenue">Sin el mapa (¿sin internet?).</p>'; return }
  ddia.mapa?.remove()
  const m = ddia.mapa = L.map('dd-mapa', { zoomControl: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
  const acento = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim() || '#c4a062'
  if (d.mapa.puntos.length > 1) L.polyline(d.mapa.puntos, { color: acento, weight: 4, opacity: 0.9 }).addTo(m)
  for (const p of d.mapa.paradas) L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'ddia-pin', html: String(p.n), iconSize: [24, 24] }) }).addTo(m).bindTooltip(p.lugar ?? `Parada ${p.n}`)
  const todos = [...d.mapa.puntos, ...d.mapa.paradas.map((p) => [p.lat, p.lon])]
  m.fitBounds(L.latLngBounds(todos).pad(0.15), { maxZoom: 16 })
}
