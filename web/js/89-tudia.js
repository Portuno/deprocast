'use strict'
// Tu día en capas (plan v38, fase 6; Fragua #133): lo que juntó la app del teléfono mientras escuchaba, minuto a minuto.
// Una línea de tiempo (habló / escuchó / caminó / quieto, y cuándo hablaba lejos del micrófono), los totales, el
// recorrido en el mapa y los consejos que van al audio de la mañana.

const FILAS_TUDIA = [['hablo', 'Hablaste'], ['escucho', 'Escuchaste'], ['camino', 'Caminaste'], ['quieto', 'Quieto'], ['lejos', 'Lejos del micrófono']]
const tudia = { fecha: null }

const durTudia = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)
const correrFecha = (f, dias) => { const [a, m, d] = f.split('-').map(Number); const x = new Date(a, m - 1, d + dias, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const hoyTudia = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

async function montarTuDia() {
  tudia.fecha ??= hoyTudia()
  $('#principal').innerHTML = `<div class="tudia">
    <div class="titulo"><h1>Tu día en capas</h1><p>Lo que oyó y midió la app del teléfono mientras escuchaba: cuándo hablaste, cuándo escuchaste, cuándo caminaste y cuándo estuviste quieto, y por dónde anduviste. Solo números: el audio nunca se guarda.</p></div>
    <div class="tudia-nav"><button class="btn btn-chico" id="td-antes" aria-label="Día anterior">‹</button><b id="td-fecha"></b><button class="btn btn-chico" id="td-despues" aria-label="Día siguiente">›</button></div>
    <div id="td-cuerpo"><p class="tenue">Cargando…</p></div>
  </div>`
  $('#td-antes').onclick = () => { tudia.fecha = correrFecha(tudia.fecha, -1); pintarTuDia() }
  $('#td-despues').onclick = () => { if (tudia.fecha < hoyTudia()) { tudia.fecha = correrFecha(tudia.fecha, 1); pintarTuDia() } }
  await pintarTuDia()
}

async function pintarTuDia() {
  const f = tudia.fecha
  $('#td-fecha').textContent = f === hoyTudia() ? 'Hoy' : new Date(`${f}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })
  $('#td-despues').disabled = f >= hoyTudia()
  let d
  try { d = await api(`/capas?fecha=${f}`) } catch (e) { return error(e) }
  const cuerpo = $('#td-cuerpo')
  if (!cuerpo) return
  const t = d.totales
  if (!t.minutos) {
    cuerpo.innerHTML = `<div class="vacio tarjeta"><h3>Sin capas este día</h3><p class="tenue">Se juntan mientras la app del teléfono está en <b>Escucha</b>. Prendela y dejala andar: cada minuto queda acá.</p></div>`
    return
  }
  const total = (n, que, extra = '') => `<div class="tarjeta tudia-total"><b>${n}</b><small>${que}${extra}</small></div>`
  cuerpo.innerHTML = `<div class="tudia-totales">
      ${total(durTudia(t.hablo), 'hablando')}${total(durTudia(t.escucho), 'escuchando')}${total(durTudia(t.camino), 'caminando')}
      ${total(t.pasos.toLocaleString('es-AR'), 'pasos')}${total(durTudia(t.quieto), 'quieto')}${total(durTudia(t.minutos), 'con datos')}
    </div>
    ${d.consejos.length ? `<section class="tarjeta tudia-consejos"><h3 class="sub">Para el audio de la mañana</h3><ul>${d.consejos.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>` : ''}
    <section class="tarjeta tudia-linea"><h3 class="sub">La línea del día</h3>${lineaTuDia(d)}
      <p class="tenue chico">${d.referenciaVoz == null ? 'La distancia al micrófono se estima cuando haya unos minutos en que le dictaste de cerca (es tu referencia).' : 'La distancia se estima con el nivel de tu voz contra el de cuando le dictás de cerca: 6 dB menos es el doble de lejos.'} Lo gris claro es tiempo sin datos (la app no estaba escuchando).</p></section>
    <section class="tarjeta tudia-linea"><h3 class="sub">Por dónde anduviste</h3>${d.recorrido.length ? '<div class="mp-lienzo tudia-mapa" id="td-mapa"></div>' : '<p class="tenue chico">Sin ubicación este día. La app la manda cuando tiene el permiso de ubicación (llega con la próxima versión instalada en el teléfono).</p>'}</section>`
  if (d.recorrido.length) void mapaTuDia(d.recorrido)
}

/** La línea de tiempo: una fila por capa (la etiqueta en HTML, la barra en SVG estirada de 0 a 24 h; cada minuto, una unidad). */
function lineaTuDia(d) {
  const filas = FILAS_TUDIA.filter(([k]) => k !== 'lejos' || d.capas.lejos.length)
  const rects = (ts, clase) => ts.map((t) => `<rect class="${clase}" x="${t.desde}" y="0" width="${Math.max(1, t.hasta - t.desde + 1)}" height="10"><title>${hhmmTudia(t.desde)}–${hhmmTudia(t.hasta + 1)}</title></rect>`).join('')
  return `<div class="tudia-filas" role="img" aria-label="La línea del día por capas">
    ${filas.map(([k, n]) => `<span class="tudia-etq">${n}</span><svg viewBox="0 0 1440 10" preserveAspectRatio="none" aria-hidden="true"><rect class="fondo-fila" x="0" y="0" width="1440" height="10"/>${rects(d.capas.sinDatos, 'sin')}${rects(d.capas[k], `c-${k}`)}${[3, 6, 9, 12, 15, 18, 21].map((h) => `<line class="eje" x1="${h * 60}" x2="${h * 60}" y1="0" y2="10"/>`).join('')}</svg>`).join('')}
    <span></span><div class="tudia-horas">${[0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<span>${String(h).padStart(2, '0')}h</span>`).join('')}</div>
  </div>`
}
const hhmmTudia = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

async function mapaTuDia(recorrido) {
  const el = $('#td-mapa')
  if (!el) return
  const L = await cargarLeaflet()
  if (el._mapa) el._mapa.remove()
  const mapa = L.map(el, { zoomControl: true })
  el._mapa = mapa
  capaBaseMapa(L).addTo(mapa)
  const acento = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim() || '#c4a062'
  const puntos = recorrido.map(([la, lo]) => [la, lo])
  L.polyline(puntos, { color: acento, weight: 4, opacity: 0.85 }).addTo(mapa)
  for (const [i, p] of [[0, recorrido[0]], [1, recorrido.at(-1)]]) L.circleMarker([p[0], p[1]], { radius: 7, color: acento, weight: 2, fillColor: acento, fillOpacity: i ? 1 : 0.3 }).bindTooltip(`${i ? 'Último' : 'Primero'} · ${p[2]}`).addTo(mapa)
  mapa.fitBounds(L.latLngBounds(puntos).pad(0.25), { maxZoom: 16 })
  setTimeout(() => mapa.invalidateSize(), 50)
}
