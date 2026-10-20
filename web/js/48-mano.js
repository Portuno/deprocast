'use strict'
// La Mano: cinco cartas (afirmaciones tuyas sin pesar) y una tecla por carta. Al jugarla, cae al lado de lo que ya
// sabías: con qué conecta, qué refuerza o con qué choca, y a qué misión sirve. Sin puntos: lo que se ve es tu mapa.

let manoCartas = []
let manoActiva = 0
let manoJugadas = {} // id de carta → respuesta del servidor
let manoSaltear = []
let manoEspera = null
// Las mismas teclas que la criba; c marca «choca con lo que ya sabía» y espacio pasa a la siguiente.
const TECLAS_MANO = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 10, q: 11, w: 12, '.': 11, ',': 11, Decimal: 11, Enter: 12 }

function montarMano() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>La Mano</h1><div class="fila"><span class="tenue" id="mn-mazo"></span><button class="btn btn-chico" id="mn-robar" title="r">Robar otra mano</button></div></div>
    <div class="mano-sorpresas" id="mn-sorpresas"></div>
    <div class="mano-mesa">
      <div class="mano">
        <div class="mano-tira" id="mn-tira"></div>
        <div class="criba-carta mano-carta" id="mn-carta"></div>
        <div class="criba-pesos" id="mn-pesos">
          <button class="btn" data-gesto="descartar" title="Descartar (x)">✕</button>
          ${Array.from({ length: 12 }, (_, i) => `<button class="btn" data-peso="${i + 1}" title="Tecla ${i + 1 === 10 ? '0' : i + 1 === 11 ? 'q' : i + 1 === 12 ? 'w' : i + 1}">${i + 1}</button>`).join('')}
        </div>
        <div class="fila" style="justify-content:center"><button class="btn btn-chico" data-gesto="choca" title="c">⚡ Choca con lo que ya sabía</button><button class="btn btn-chico" id="mn-pasar" title="Espacio">Pasar</button><button class="btn btn-chico" id="mn-deshacer" title="z">Deshacer</button></div>
        <input class="campo-suelto" id="mn-porque" placeholder="¿Por qué? (opcional: una línea, viaja con la carta)">
      </div>
      <aside class="mano-caida" id="mn-caida"><p class="tenue">Jugá una carta: acá aparece con qué conecta de lo que ya sabías.</p></aside>
    </div>`
  $$('#mn-pesos [data-peso]').forEach((b) => (b.onclick = () => jugarCarta({ gesto: 'peso', peso: Number(b.dataset.peso) })))
  $$('[data-gesto]').forEach((b) => (b.onclick = () => jugarCarta({ gesto: b.dataset.gesto })))
  $('#mn-robar').onclick = () => robarMano(true)
  $('#mn-pasar').onclick = pasarCarta
  $('#mn-deshacer').onclick = deshacerMano
  $('#mn-porque').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur() })
  engancharSorpresas($('#mn-caida'))
  robarMano(false)
}

async function robarMano(otra) {
  if (otra) manoSaltear.push(...manoCartas.map((c) => c.id))
  try {
    const r = await api(`/mano?${new URLSearchParams({ saltear: manoSaltear.slice(-200).join(',') })}`)
    manoCartas = r.cartas
    manoJugadas = {}
    manoActiva = 0
    pintarMazo(r.mazo)
    pintarSorpresas(r.sorpresas)
    pintarMano()
  } catch (e) { error(e) }
}

function pintarMazo(m) {
  const el = $('#mn-mazo')
  const t = m.sorpresas
  if (el) el.textContent = `Mazo: ${m.total.toLocaleString('es-AR')} sin pesar · ${m.nuevas.toLocaleString('es-AR')} nuevas · ${m.variaciones.toLocaleString('es-AR')} variaciones${t?.unaCada ? ` · sorpresas ≈ 1 de ${t.unaCada}` : ''}${m.jugadasHoy ? ` · hoy jugaste ${m.jugadasHoy}` : ''}`
}

// ─── las sorpresas: puente, la creencia que se cae y el combo ───────────

const SORPRESA = {
  puente: { cab: '⟡ Puente no obvio', botones: [['real', 'Es real'], ['casualidad', 'Casualidad']] },
  contradiccion: { cab: '⚡ ¿Se cae lo que creías?', botones: [['actualizo', 'Actualizo'], ['sostengo', 'Sostengo'], ['pruebo', 'Lo pruebo una semana']] },
  combo: { cab: '✦ Combo', botones: [['real', 'Vale'], ['casualidad', 'Casualidad']] },
}

const respondidaHTML = (s) => `<div class="mano-sorpresa respondida">${esc(SORPRESA[s.tipo].cab)}: <b>${esc(SORPRESA[s.tipo].botones.find(([k]) => k === s.estado)?.[1] ?? s.estado)}</b>${s.estado === 'pruebo' ? ' · quedó como side quest para dentro de una semana' : ''}</div>`

function sorpresaHTML(s) {
  const def = SORPRESA[s.tipo]
  if (s.estado !== 'pendiente' && s.estado !== 'sin_hipotesis') return respondidaHTML(s)
  const etiqueta = (c, i) => s.tipo === 'contradiccion' ? (i ? `Creías${c.peso ? ` (peso ${c.peso})` : ''}` : 'Lo nuevo') : ''
  const cartas = s.cartas.map((c, i) => `<li>${etiqueta(c, i) ? `<b>${etiqueta(c, i)}:</b> ` : ''}«${esc(corto(c.texto, 180))}»<small class="tenue">${[c.fuente, c.pieza && corto(c.pieza, 50), c.fecha].filter(Boolean).map(esc).join(' · ')}</small></li>`).join('')
  const esperando = s.tipo === 'combo' && !s.texto
  const cab = s.tipo === 'combo' && s.mundos.length ? `${def.cab} · cruza ${s.mundos.map(esc).join(' × ')}` : def.cab
  return `<div class="mano-sorpresa mano-s-${s.tipo}" data-sorpresa="${s.id}">
    <b>${cab}</b>
    ${s.texto ? `<p>${esc(s.texto).replace(/\n/g, '<br>')}</p>` : esperando ? '<p class="tenue">La hipótesis se está armando (en la nube)…</p>' : ''}
    <ul>${cartas}</ul>
    ${esperando ? '' : `<div class="fila">${def.botones.map(([k, n]) => `<button class="btn btn-chico" data-responder="${k}">${n}</button>`).join('')}</div>`}
  </div>`
}

/** Engancha los botones de las sorpresas que haya dentro de un contenedor (un solo listener por contenedor). */
function engancharSorpresas(cont) {
  if (!cont || cont.dataset.enganchado) return
  cont.dataset.enganchado = '1'
  cont.addEventListener('click', async (e) => {
    const choca = e.target.closest('[data-choca-con]')
    if (choca) {
      try {
        const s = await api('/mano/choque', { nueva: Number(choca.dataset.nueva), vieja: Number(choca.dataset.chocaCon) })
        choca.closest('.mano-choca').outerHTML = sorpresaHTML(s)
      } catch (err) { error(err) }
      return
    }
    const b = e.target.closest('[data-responder]')
    if (!b) return
    const caja = b.closest('[data-sorpresa]')
    try {
      const porque = $('#mn-porque')?.value.trim() || null
      const s = await api(`/mano/sorpresas/${caja.dataset.sorpresa}`, { respuesta: b.dataset.responder, porque })
      if ($('#mn-porque')) $('#mn-porque').value = ''
      caja.outerHTML = respondidaHTML(s)
      // Lo guardado de la mano también se entera (si vuelve a esa carta, no le ofrece responder de nuevo).
      for (const j of Object.values(manoJugadas)) for (const x of j.sorpresas ?? []) if (x.id === s.id) x.estado = s.estado
    } catch (err) { error(err) }
  })
}

function pintarSorpresas(xs) {
  const el = $('#mn-sorpresas')
  if (!el) return
  // Lo que ya está a la vista en la caída no se repite arriba.
  const ys = (xs ?? []).filter((x) => !$(`#mn-caida [data-sorpresa="${x.id}"]`))
  el.innerHTML = ys.length ? `<small class="tenue">Para responder</small>${ys.map(sorpresaHTML).join('')}` : ''
  engancharSorpresas(el)
}

async function refrescarSorpresas() {
  if (vista !== 'mano') return
  try { pintarSorpresas((await api('/mano/sorpresas')).sorpresas) } catch { /* la próxima mano las trae */ }
}

const NOVEDAD = { nueva: ['✦', 'Nueva: no se parece a nada que tengas'], variacion: ['≈', 'Variación de algo que ya tenías'], repetida: ['=', 'Casi igual a algo que ya tenías'] }

function pintarMano() {
  const tira = $('#mn-tira')
  if (!tira) return
  tira.innerHTML = manoCartas.map((c, i) => {
    const j = manoJugadas[c.id]
    const marca = j ? (j.gesto === 'peso' ? j.carta.peso : j.gesto === 'choca' ? '⚡' : '✕') : NOVEDAD[c.novedad]?.[0] ?? '·'
    return `<button class="mano-mini${i === manoActiva ? ' on' : ''}${j ? ' jugada' : ''}" data-i="${i}" title="${esc(c.texto.slice(0, 140))}"><b>${esc(String(marca))}</b><span>${esc(c.texto.slice(0, 48))}</span></button>`
  }).join('')
  $$('.mano-mini', tira).forEach((b) => (b.onclick = () => { manoActiva = Number(b.dataset.i); pintarMano() }))
  const c = manoCartas[manoActiva]
  const el = $('#mn-carta')
  if (!c) {
    el.innerHTML = '<p class="vacio">No quedan afirmaciones sin pesar. Cuando Procesar destile más, vuelven a aparecer acá.</p>'
    return
  }
  const nov = NOVEDAD[c.novedad]
  const f = c.fuente
  const toca = c.toca
  el.innerHTML = `<div class="p-top">${nov ? `<span class="mano-novedad mano-${c.novedad}" title="${nov[1]}">${nov[0]} ${c.novedad === 'variacion' ? 'variación' : c.novedad}</span>` : '<span class="tenue">sin vector todavía</span>'}${f ? `<span title="${esc(f.titulo)}">de «${esc(corto(f.titulo, 50))}»${f.fecha ? ` · ${esc(f.fecha)}` : ''}</span>` : ''}</div>
    <h2 class="mano-texto">${esc(c.texto)}</h2>
    ${c.parecidaA ? `<small class="tenue">${c.novedad === 'repetida' ? 'Casi igual a' : 'Se parece a'}: «${esc(corto(c.parecidaA.texto, 140))}»</small>` : ''}
    <div class="mano-toca">${toca.primaria ? `→ Primaria: <b>${esc(toca.primaria.titulo)}</b>` : '→ <span class="tenue">suelta: no toca ninguna primaria</span>'}${toca.principal ? ` · Principal: ${esc(toca.principal)}` : ''}${toca.entidades.length ? `<br><span class="tenue">Habla de ${toca.entidades.map((e) => esc(e.nombre)).join(', ')}</span>` : ''}</div>`
  if (manoJugadas[c.id]) pintarCaida(manoJugadas[c.id])
}

function lineaVecino(v) {
  return `<li><span>${esc(corto(v.texto, 160))}</span><small class="tenue">${v.peso ? `peso ${v.peso} · ` : ''}${Math.round(v.sim * 100)} % parecido${v.fecha ? ` · ${esc(v.fecha)}` : ''}</small></li>`
}

function pintarCaida(j) {
  const el = $('#mn-caida')
  if (!el) return
  const titulo = j.gesto === 'peso' ? `Pesada ${j.carta.peso}` : j.gesto === 'choca' ? '⚡ Marcada: choca con lo que ya sabías' : '✕ Descartada'
  el.innerHTML = `<h3>${titulo}</h3>
    ${(j.sorpresas ?? []).map(sorpresaHTML).join('')}
    ${j.refuerza.length ? `<div class="mano-refuerza"><b>Refuerza lo que ya creías</b><ul>${j.refuerza.map(lineaVecino).join('')}</ul></div>` : ''}
    ${j.chocaCon.length ? `<div class="mano-choca"><b>¿Con cuál choca?</b><ul>${j.chocaCon.map((v) => lineaVecino(v).replace('</li>', `<button class="btn btn-chico" data-choca-con="${v.id}" data-nueva="${j.carta.id}">Con esta</button></li>`)).join('')}</ul></div>` : j.gesto === 'choca' ? '<p class="tenue">No encontré nada pesado alto que se le parezca: puede que choque con algo que todavía no anotaste.</p>' : ''}
    ${j.gesto !== 'descartar' ? (j.vecinos.length ? `<b>Cae cerca de</b><ul class="mano-vecinos">${j.vecinos.map(lineaVecino).join('')}</ul>` : '<p class="tenue">No se parece a nada que hayas pesado: es territorio nuevo.</p>') : ''}
    <small class="tenue">${j.ms} ms</small>`
  el.classList.remove('cae')
  void el.offsetWidth // reinicia la animación
  el.classList.add('cae')
}

async function jugarCarta(g) {
  const c = manoCartas[manoActiva]
  if (!c) return
  // Una carta jugada no se vuelve a jugar con otra tecla (sería pisar sin querer): se deshace con z.
  if (manoJugadas[c.id]) return toast(manoCartas.every((x) => manoJugadas[x.id]) ? 'Mano jugada<small>R roba otra · Z deshace la última.</small>' : 'Ya la jugaste<small>Z deshace la última · espacio pasa a otra.</small>', 'suave')
  document.activeElement?.blur?.()
  const porque = $('#mn-porque')?.value.trim() || null
  try {
    const j = await api(`/mano/${c.id}`, { ...g, porque })
    if ($('#mn-porque')) $('#mn-porque').value = ''
    manoJugadas[c.id] = j
    pintarCaida(j)
    // Lo que se arma en la nube (la hipótesis de un combo, una contradicción que encontró el modelo) llega unos segundos después.
    if (g.gesto === 'peso') { clearTimeout(manoEspera); manoEspera = setTimeout(refrescarSorpresas, 7000) }
    const siguiente = manoCartas.findIndex((x, i) => i > manoActiva && !manoJugadas[x.id])
    if (siguiente >= 0) manoActiva = siguiente
    pintarMano()
    if (manoCartas.every((x) => manoJugadas[x.id])) toast('Mano jugada<small>R roba otra; lo que pesaste ya ordena lo que viene.</small>', 'suave')
  } catch (e) { error(e) }
}

function pasarCarta() {
  if (!manoCartas.length) return
  manoActiva = (manoActiva + 1) % manoCartas.length
  pintarMano()
}

async function deshacerMano() {
  try {
    const r = await api('/mano/deshacer', {})
    if (!r.quantomoId) return toast('No hay nada para deshacer', 'suave')
    delete manoJugadas[r.quantomoId]
    const i = manoCartas.findIndex((c) => c.id === r.quantomoId)
    if (i >= 0) manoActiva = i
    $('#mn-caida').innerHTML = '<p class="tenue">Deshecha: la carta volvió a como estaba.</p>'
    pintarMano()
  } catch (e) { error(e) }
}

document.addEventListener('keydown', (e) => {
  if (vista !== 'mano' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || !$('#velo').hidden) return
  if (e.key in TECLAS_MANO) { e.preventDefault(); jugarCarta({ gesto: 'peso', peso: TECLAS_MANO[e.key] }) }
  else if (e.key === 'x' || e.key === 'Backspace') { e.preventDefault(); jugarCarta({ gesto: 'descartar' }) }
  else if (e.key === 'c') { e.preventDefault(); jugarCarta({ gesto: 'choca' }) }
  else if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); pasarCarta() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); manoActiva = (manoActiva + manoCartas.length - 1) % Math.max(1, manoCartas.length); pintarMano() }
  else if (e.key === 'z') { e.preventDefault(); deshacerMano() }
  else if (e.key === 'r') { e.preventDefault(); robarMano(true) }
  else if (e.key === 'p') { e.preventDefault(); $('#mn-porque')?.focus() }
})
