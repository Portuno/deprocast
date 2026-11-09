'use strict'
// Mapamundi (plan v38, fase 7): la historia como un tablero de hexágonos sobre el mapa real. Cada hexágono tiene un
// grande; cada arista, una disputa que se gana por la fuerza o por el discurso. Un solo estado y varias lentes, y la
// lente «Tu vida» trae lo del Mapa (tus lugares, tu línea, tus misiones y tu agenda) anclado a su hexágono.

const LENTES_MMU = [
  ['territorio', 'Territorio', 'Qué es tuyo, qué no y tus rutas.'],
  ['disputas', 'Disputas', 'Las aristas con su año: las que podés jugar se encienden.'],
  ['ideas', 'Ideas', 'La idea de cada grande y lo que se ganó con el discurso, sin ejército.'],
  ['cronologia', 'Cronología', 'El tablero teñido por siglo: qué fue al mismo tiempo.'],
  ['vida', 'Tu vida', 'Tus lugares, tu línea, tus misiones y la agenda de hoy, en su hexágono.'],
  ['economia', 'Economía', 'De dónde entra y sale tu plata, por zona.'],
]
const mmu = { datos: null, sel: null, disputa: null, resultado: null, capa: null }

const tokMmu = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'
const romano = (n) => [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']].reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v } return s }, '')
const sigloTexto = (s) => (s == null ? '' : s < 0 ? `siglo ${romano(-s)} a. C.` : `siglo ${romano(s)}`)
const plural = (n, s, p = `${s}s`) => `${n} ${n === 1 ? s : p}`

async function montarMapamundi() {
  $('#principal').innerHTML = `<div class="mmu">
    <div class="titulo"><h1>Mapamundi</h1><p>La historia como un tablero sobre el mapa. Cada hexágono tiene un grande; cada arista, una disputa con fecha y lugar. Cruzala desde lo tuyo y ganala por la fuerza o con quince palabras. Al cerrar, qué pasó de verdad y qué ley se saca.</p></div>
    <div id="mmu-cuerpo"><p class="tenue">Cargando…</p></div>
  </div>`
  await pintarMapamundi()
}

async function pintarMapamundi() {
  try { mmu.datos = await api('/mapamundi') } catch (e) { return error(e) }
  const d = mmu.datos
  const cuerpo = $('#mmu-cuerpo')
  if (!cuerpo) return
  if (!d.centro) {
    cuerpo.innerHTML = `<div class="tarjeta mmu-vacio">
      <h3>¿Dónde empieza tu tablero?</h3>
      <p class="tenue">El piloto: el hexágono del ${esc(d.piloto.nombre)} con su grande y ${d.piloto.disputas} disputas, jugable de punta a punta. O empezá en un lugar tuyo y el primer grande lo propone Mastropiero.</p>
      <div class="fila"><button class="btn btn-primario" id="mmu-piloto">Empezar con el piloto</button></div>
      <form class="fila" id="mmu-lugar"><input class="campo-suelto f1" name="lugar" placeholder="O un lugar: Valencia, Ruzafa, Buenos Aires…" autocomplete="off"><button class="btn">Empezar acá</button></form>
    </div>`
    $('#mmu-piloto').onclick = async () => { try { await api('/mapamundi/piloto', {}); pintarMapamundi() } catch (e) { error(e) } }
    $('#mmu-lugar').onsubmit = async (e) => {
      e.preventDefault()
      const b = e.target.querySelector('button'); b.disabled = true
      try { await api('/mapamundi/empezar', { lugar: e.target.lugar.value }); pintarMapamundi() } catch (err) { error(err) } finally { b.disabled = false }
    }
    return
  }
  if (!$('#mmu-mapa')) {
    cuerpo.innerHTML = `<div class="mmu-barra">
        <div class="mmu-lentes" role="tablist">${LENTES_MMU.map(([k, n, t]) => `<button class="chip-capa" role="tab" data-lente="${k}" title="${esc(t)}">${esc(n)}</button>`).join('')}</div>
        <div class="fila g-2"><small class="tenue" id="mmu-fuerza"></small><button class="btn btn-chico" id="mmu-a-mapa">${ico('map')} Tu Mapa</button></div>
      </div>
      <div class="mmu-cuerpo"><div class="mp-lienzo" id="mmu-mapa"></div><aside class="tarjeta mmu-panel" id="mmu-panel"></aside></div>
      <p class="tenue chico" id="mmu-nota"></p>`
    $$('[data-lente]').forEach((b) => (b.onclick = () => {
      mmu.datos.lente = b.dataset.lente
      mmu.sel = null; mmu.disputa = null; mmu.resultado = null
      void api('/mapamundi/lente', { lente: b.dataset.lente }).catch(() => {})
      dibujarMmu(); panelMmu()
    }))
    $('#mmu-a-mapa').onclick = () => irA('mapa')
    const L = await cargarLeaflet()
    const el = $('#mmu-mapa')
    const mapa = L.map(el, { zoomControl: true, attributionControl: true })
    el._mapa = mapa
    capaBaseMapa(L).addTo(mapa)
    mmu.capa = L.layerGroup().addTo(mapa)
    const conGrande = d.hexes.filter((h) => h.grande)
    mapa.fitBounds(L.latLngBounds((conGrande.length ? conGrande : d.hexes).flatMap((h) => h.vertices)).pad(0.2))
    setTimeout(() => mapa.invalidateSize(), 50)
  }
  $('#mmu-fuerza').textContent = `Tu fuerza: ${d.fuerza} · empieza en ${d.centro.nombre}`
  dibujarMmu()
  panelMmu()
}

/** Pinta el tablero con la lente elegida (el estado es uno solo). */
function dibujarMmu() {
  const d = mmu.datos
  const L = window.L
  if (!L || !mmu.capa) return
  const lente = d.lente
  $$('[data-lente]').forEach((b) => { b.classList.toggle('activo', b.dataset.lente === lente); b.setAttribute('aria-selected', b.dataset.lente === lente) })
  mmu.capa.clearLayers()
  const c = { acento: tokMmu('--acento'), tenue: tokMmu('--tenue'), linea: tokMmu('--linea-2'), ok: tokMmu('--ok'), mal: tokMmu('--mal'), viejo: tokMmu('--grafo-2'), nuevo: tokMmu('--grafo-1') }
  const porClave = new Map(d.hexes.map((h) => [h.clave, h]))
  const siglos = d.hexes.filter((h) => h.siglo != null).map((h) => h.siglo)
  const [smin, smax] = [Math.min(...siglos), Math.max(...siglos)]
  const maxVida = Math.max(1, ...d.hexes.map((h) => h.vida.length))
  const maxPlata = Math.max(1, ...d.hexes.map((h) => (h.plata ? Math.abs(h.plata.ingresos - h.plata.gastos) : 0)))
  const estilo = (h) => {
    const base = { color: c.linea, weight: 1, fillColor: c.tenue, fillOpacity: 0.04, dashArray: h.poblable ? '4 4' : null }
    if (lente === 'territorio' || lente === 'disputas' || lente === 'ideas') {
      if (h.control === 'tuyo') return { ...base, color: c.acento, weight: 2, fillColor: c.acento, fillOpacity: lente === 'territorio' ? 0.38 : 0.18 }
      if (h.grande) return { ...base, color: c.tenue, fillOpacity: lente === 'territorio' ? 0.16 : 0.08 }
      return base
    }
    if (lente === 'cronologia') {
      if (h.siglo == null) return base
      const t = smax === smin ? 0.5 : (h.siglo - smin) / (smax - smin)
      return { ...base, color: mezclarMmu(c.viejo, c.nuevo, t), weight: 2, fillColor: mezclarMmu(c.viejo, c.nuevo, t), fillOpacity: 0.42 }
    }
    if (lente === 'vida') {
      if (!h.vida.length) return base
      const hoy = h.vida.some((v) => v.hoy)
      return { ...base, color: hoy ? c.acento : c.ok, weight: hoy ? 3 : 1.5, fillColor: hoy ? c.acento : c.ok, fillOpacity: 0.12 + 0.45 * (h.vida.length / maxVida) }
    }
    if (!h.plata) return base
    const neto = h.plata.ingresos - h.plata.gastos
    return { ...base, color: neto >= 0 ? c.ok : c.mal, weight: 1.5, fillColor: neto >= 0 ? c.ok : c.mal, fillOpacity: 0.12 + 0.45 * (Math.abs(neto) / maxPlata) }
  }
  for (const h of d.hexes) {
    const pol = L.polygon(h.vertices, estilo(h)).addTo(mmu.capa)
    if (mmu.sel === h.clave) pol.setStyle({ weight: 3, color: c.acento })
    const etq = h.grande ? `${esc(h.grande)}${h.pais ? ` · ${esc(h.pais)}` : ''}${lente === 'ideas' && h.idea ? `<br><i>${esc(h.idea)}</i>` : lente === 'cronologia' ? `<br>${esc(sigloTexto(h.siglo))}` : ''}`
      : lente === 'vida' && h.vida.length ? `${h.vida.length} cosa${h.vida.length === 1 ? '' : 's'} tuya${h.vida.length === 1 ? '' : 's'}`
      : lente === 'economia' && h.plata ? `${h.plata.n} movimiento${h.plata.n === 1 ? '' : 's'}`
      : h.poblable ? 'Sin grande todavía' : ''
    if (etq) pol.bindTooltip(etq, { sticky: true })
    pol.on('click', () => { mmu.sel = h.clave; mmu.disputa = null; mmu.resultado = null; dibujarMmu(); panelMmu() })
    if (h.grande && ['territorio', 'disputas', 'ideas', 'cronologia'].includes(lente)) L.tooltip({ permanent: true, direction: 'center', className: 'mmu-etq' }).setLatLng(h.centro).setContent(esc(h.corto ?? h.grande.split(',')[0])).addTo(mmu.capa)
  }
  if (lente === 'territorio') for (const [a, b] of d.rutas) if (porClave.has(a) && porClave.has(b)) L.polyline([porClave.get(a).centro, porClave.get(b).centro], { color: c.acento, weight: 4, opacity: 0.85 }).addTo(mmu.capa)
  if (lente === 'disputas' || lente === 'ideas') {
    for (const x of d.disputas) {
      const [ha, hb] = [porClave.get(x.a), porClave.get(x.b)]
      if (!ha || !hb) continue
      if (lente === 'ideas' && !(x.via === 'discurso' || x.jugable)) continue
      const color = x.jugable ? c.acento : x.estado === 'ganada' ? c.ok : x.estado === 'perdida' ? c.mal : c.linea
      const linea = L.polyline([ha.centro, hb.centro], { color, weight: x.jugable ? 6 : 3, opacity: x.jugable ? 0.95 : 0.7, dashArray: x.estado === 'pendiente' && !x.jugable ? '6 6' : lente === 'ideas' && x.jugable ? '2 8' : null }).addTo(mmu.capa)
      linea.bindTooltip(`${esc(x.nombre)} · ${esc(x.anioTexto)}${x.jugable ? ' · se puede jugar' : x.estado !== 'pendiente' ? ` · ${x.estado}` : ''}`, { sticky: true })
      linea.on('click', () => { mmu.disputa = x.id; mmu.sel = null; mmu.resultado = null; panelMmu() })
    }
  }
  const nota = {
    territorio: `${plural(d.hexes.filter((h) => h.control === 'tuyo').length, 'hexágono tuyo', 'hexágonos tuyos')} · ${plural(d.rutas.length, 'ruta')}. Los punteados se pueden poblar.`,
    disputas: `${d.disputas.filter((x) => x.jugable).length} para jugar ahora · ${d.disputas.filter((x) => x.estado !== 'pendiente').length} cerradas.`,
    ideas: 'Pasá el mouse por un hexágono para ver la idea de su grande. Las líneas son lo que se juega o se ganó con el discurso.',
    cronologia: siglos.length ? `Del ${sigloTexto(smin)} (azul) al ${sigloTexto(smax)} (ámbar).` : '',
    vida: `${d.hexes.reduce((s, h) => s + h.vida.length, 0)} cosas tuyas en el tablero. Borde dorado: algo de hoy.`,
    economia: 'Verde: entra más de lo que sale. Rojo: al revés. Solo los movimientos atados a un lugar con posición.',
  }
  $('#mmu-nota').textContent = nota[lente] ?? ''
}

function mezclarMmu(a, b, t) {
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16))
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a
  const [ca, cb] = [p(a), p(b)]
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/** El panel de al lado: la disputa abierta, el hexágono elegido o el resumen de la lente. */
function panelMmu() {
  const d = mmu.datos
  const p = $('#mmu-panel')
  if (!p) return
  if (mmu.disputa) return panelDisputaMmu(p, d.disputas.find((x) => x.id === mmu.disputa))
  const h = mmu.sel && d.hexes.find((x) => x.clave === mmu.sel)
  if (h) return panelHexMmu(p, h)
  const lista = (xs, f) => (xs.length ? `<ul class="mmu-lista">${xs.map(f).join('')}</ul>` : '<p class="tenue chico">Nada todavía.</p>')
  const disp = (x) => `<li><button class="btn-link" data-disp="${x.id}">${esc(x.nombre)}</button> <small class="tenue">${esc(x.anioTexto)}${x.jugable ? ' · para jugar' : x.estado !== 'pendiente' ? ` · ${x.estado}` : ''}</small></li>`
  const lente = d.lente
  let html = ''
  if (lente === 'territorio' || lente === 'disputas') {
    html = `<h3 class="sub">Para jugar</h3>${lista(d.disputas.filter((x) => x.jugable), disp)}<h3 class="sub">Cerradas</h3>${lista(d.disputas.filter((x) => x.estado !== 'pendiente'), disp)}`
    if (lente === 'territorio') html += `<h3 class="sub">Tuyo</h3>${lista(d.hexes.filter((x) => x.control === 'tuyo'), (x) => `<li><button class="btn-link" data-hex="${x.clave}">${esc(x.grande)}</button> <small class="tenue">${esc(x.pais ?? '')}</small></li>`)}`
  } else if (lente === 'ideas') html = `<h3 class="sub">Las ideas</h3>${lista(d.hexes.filter((x) => x.idea), (x) => `<li><button class="btn-link" data-hex="${x.clave}">${esc(x.grande)}</button><p class="chico">${esc(x.idea)}</p></li>`)}`
  else if (lente === 'cronologia') html = `<h3 class="sub">Por siglo</h3>${lista([...d.hexes.filter((x) => x.siglo != null)].sort((a, b) => a.siglo - b.siglo), (x) => `<li><small class="tenue">${esc(sigloTexto(x.siglo))}</small> <button class="btn-link" data-hex="${x.clave}">${esc(x.grande)}</button></li>`)}
      <h3 class="sub">Disputas en orden</h3>${lista(d.disputas, disp)}`
  else if (lente === 'vida') {
    const hoy = d.hexes.flatMap((x) => x.vida.filter((v) => v.hoy).map((v) => ({ ...v, clave: x.clave })))
    html = `<h3 class="sub">Hoy</h3>${lista(hoy, (v) => `<li><button class="btn-link" data-hex="${v.clave}">${esc(v.titulo)}</button></li>`)}
      <h3 class="sub">Dónde pasa tu vida</h3>${lista([...d.hexes.filter((x) => x.vida.length)].sort((a, b) => b.vida.length - a.vida.length).slice(0, 8), (x) => `<li><button class="btn-link" data-hex="${x.clave}">${x.vida.length} cosa${x.vida.length === 1 ? '' : 's'}</button> <small class="tenue">${esc(x.vida.slice(0, 2).map((v) => v.titulo).join(' · '))}</small></li>`)}
      <p class="tenue chico">Sale de tu Mapa: lugares, Línea, misiones con lugar y tu calendario.</p>`
  } else {
    const zonas = [...d.hexes.filter((x) => x.plata)].sort((a, b) => Math.abs(b.plata.ingresos - b.plata.gastos) - Math.abs(a.plata.ingresos - a.plata.gastos))
    html = `<h3 class="sub">Por zona (último año)</h3>${lista(zonas.slice(0, 10), (x) => `<li><button class="btn-link" data-hex="${x.clave}">${esc(x.grande ?? x.vida[0]?.titulo ?? `Zona ${x.clave}`)}</button> <small class="tenue">+${Math.round(x.plata.ingresos)} / −${Math.round(x.plata.gastos)} €</small></li>`)}
      <p class="tenue chico">Entran los movimientos atados a un lugar (por la entidad o porque lo nombran).</p>`
  }
  p.innerHTML = `<p class="tenue chico">${esc(LENTES_MMU.find(([k]) => k === lente)?.[2] ?? '')}</p>${html}`
  enlazarPanelMmu(p)
}

function enlazarPanelMmu(p) {
  $$('[data-disp]', p).forEach((b) => (b.onclick = () => { mmu.disputa = Number(b.dataset.disp); mmu.sel = null; mmu.resultado = null; panelMmu() }))
  $$('[data-hex]', p).forEach((b) => (b.onclick = () => {
    mmu.sel = b.dataset.hex; mmu.disputa = null; mmu.resultado = null
    const h = mmu.datos.hexes.find((x) => x.clave === b.dataset.hex)
    if (h) $('#mmu-mapa')._mapa?.panTo(h.centro)
    dibujarMmu(); panelMmu()
  }))
  $('[data-volver]', p)?.addEventListener('click', () => { mmu.sel = null; mmu.disputa = null; mmu.resultado = null; dibujarMmu(); panelMmu() })
}

function panelHexMmu(p, h) {
  const ds = mmu.datos.disputas.filter((x) => x.a === h.clave || x.b === h.clave)
  p.innerHTML = `<button class="btn-link chico" data-volver>← ${esc(LENTES_MMU.find(([k]) => k === mmu.datos.lente)?.[1] ?? '')}</button>
    ${h.grande ? `<h3>${esc(h.grande)}</h3><p class="tenue chico">${esc([h.pais, sigloTexto(h.siglo), h.control === 'tuyo' ? 'tuyo' : 'no es tuyo'].filter(Boolean).join(' · '))}</p>${h.idea ? `<p class="mmu-idea">${esc(h.idea)}</p>` : ''}`
      : `<h3>Sin grande todavía</h3>${h.poblable ? '<p class="tenue chico">Está al lado de lo que ya hay: Mastropiero puede proponer su grande y sus disputas con los vecinos.</p><button class="btn btn-primario" id="mmu-poblar">Poblar este hexágono</button>' : '<p class="tenue chico">Se puebla de a uno, al lado de lo que ya está.</p>'}`}
    ${ds.length ? `<h3 class="sub">Disputas</h3><ul class="mmu-lista">${ds.map((x) => `<li><button class="btn-link" data-disp="${x.id}">${esc(x.nombre)}</button> <small class="tenue">${esc(x.anioTexto)}${x.jugable ? ' · para jugar' : x.estado !== 'pendiente' ? ` · ${x.estado}` : ''}</small></li>`).join('')}</ul>` : ''}
    ${h.vida.length ? `<h3 class="sub">Tu vida acá</h3><ul class="mmu-lista">${h.vida.slice(0, 12).map((v) => `<li>${v.hoy ? '<b>Hoy</b> · ' : ''}${esc(v.titulo)} <small class="tenue">${esc(CAPAS_MAPA_UI[v.capa]?.nombre ?? v.capa)}${v.fecha ? ` · ${esc(fechaCorta(v.fecha))}` : ''}</small></li>`).join('')}</ul>` : ''}
    ${h.plata ? `<h3 class="sub">Plata acá (último año)</h3><p class="chico">Entró ${Math.round(h.plata.ingresos)} € · salió ${Math.round(h.plata.gastos)} € · ${h.plata.n} movimiento${h.plata.n === 1 ? '' : 's'}</p>` : ''}`
  enlazarPanelMmu(p)
  const b = $('#mmu-poblar', p)
  if (b) b.onclick = async () => {
    b.disabled = true; b.textContent = 'Buscando un grande…'
    try { const r = await api('/mapamundi/poblar', { clave: h.clave }); toast(`${esc(r.grande)} entra al tablero`, 'suave'); await pintarMapamundi() } catch (e) { error(e); b.disabled = false; b.textContent = 'Poblar este hexágono' }
  }
}

function panelDisputaMmu(p, x) {
  if (!x) { mmu.disputa = null; return panelMmu() }
  const r = mmu.resultado
  const ficha = (f) => `<dl class="mmu-ficha"><dt>Qué pasó de verdad</dt><dd>${esc(f.verdad)}</dd><dt>Qué se llevó el ganador</dt><dd>${esc(f.botin)}</dd><dt>La ley</dt><dd>${esc(f.ley)}</dd></dl>`
  p.innerHTML = `<button class="btn-link chico" data-volver>← ${esc(LENTES_MMU.find(([k]) => k === mmu.datos.lente)?.[1] ?? '')}</button>
    <h3>${esc(x.nombre)}</h3><p class="tenue chico">${esc(x.anioTexto)}${x.lugar ? ` · ${esc(x.lugar)}` : ''}</p>
    ${r ? `<div class="mmu-resultado ${r.gano ? 'gano' : 'perdio'}"><b>${r.gano ? 'Ganaste' : 'Perdiste'}</b> ${r.via === 'discurso' ? `con ${r.puntaje}/10` : `(tenías ${Math.round(r.prob * 100)}%)`}${r.porQue ? `<p class="chico">${esc(r.porQue)}</p>` : ''}<p class="chico">${esc(r.cambio)}</p></div>${ficha(r.ficha)}`
      : x.jugable ? `<p class="chico"><b>${esc(x.rival ?? 'El rival')}</b> sostiene:</p><blockquote class="mmu-postura">${esc(x.postura)}</blockquote>
        ${x.tuPostura ? `<p class="tenue chico">Tu lado: ${esc(x.tuPostura)}</p>` : ''}
        <div class="mmu-jugar">
          <button class="btn" id="mmu-fuerza-b">${ico('swords')} Por la fuerza · ${x.prob}%</button>
          <form id="mmu-discurso" class="mmu-discurso"><label class="campo">Por el discurso: tu réplica, quince palabras como mucho<textarea name="texto" rows="2" placeholder="Contestale a esa postura…"></textarea></label>
            <div class="fila"><small class="tenue" id="mmu-cuenta">0 / 15</small><button class="btn btn-primario" id="mmu-replicar">Replicar</button></div></form>
        </div>`
      : x.ficha ? `${x.ultima ? `<p class="chico">${x.ultima.gano ? 'La ganaste' : 'La perdiste'} ${x.ultima.via === 'discurso' ? `con el discurso${x.ultima.puntaje != null ? ` (${x.ultima.puntaje}/10)` : ''}` : 'por la fuerza'}.${x.estado === 'perdida' ? ' La revancha se juega al día siguiente.' : ''}</p>${x.ultima.texto ? `<blockquote class="mmu-postura">${esc(x.ultima.texto)}</blockquote>` : ''}` : ''}${ficha(x.ficha)}`
      : '<p class="tenue chico">Se juega desde un hexágono tuyo hacia uno que no lo es. Ganá una vecina primero.</p>'}`
  enlazarPanelMmu(p)
  const jugarMmu = async (via, texto, boton) => {
    boton.disabled = true
    try { mmu.resultado = await api(`/mapamundi/disputas/${x.id}/jugar`, { via, texto }); await pintarMapamundi() } catch (e) { error(e); boton.disabled = false }
  }
  const f = $('#mmu-fuerza-b', p)
  if (f) f.onclick = () => jugarMmu('fuerza', undefined, f)
  const form = $('#mmu-discurso', p)
  if (form) {
    const n = () => form.texto.value.trim().split(/\s+/).filter(Boolean).length
    form.texto.oninput = () => { const k = n(); $('#mmu-cuenta').textContent = `${k} / 15`; $('#mmu-cuenta').classList.toggle('mal', k > 15); $('#mmu-replicar').disabled = k === 0 || k > 15 }
    form.texto.oninput()
    form.onsubmit = (e) => { e.preventDefault(); if (n() && n() <= 15) jugarMmu('discurso', form.texto.value, $('#mmu-replicar')) }
  }
}
