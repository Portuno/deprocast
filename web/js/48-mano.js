'use strict'
// La Mano: cinco cartas (afirmaciones tuyas sin pesar) y una tecla por carta. Al jugarla, cae al lado de lo que ya
// sabías: con qué conecta, qué refuerza o con qué choca, y a qué misión sirve. Sin puntos: lo que se ve es tu mapa.

let manoCartas = []
let manoActiva = 0
let manoJugadas = {} // id de carta → respuesta del servidor
let manoSaltear = []
let manoEspera = null
// Predecir antes de ver: ¿esta carta conecta con algo que ya pesaste? Se califica al jugarla (calibración).
let manoPredecir = false
let manoPrediccion = {} // id de carta → probabilidad elegida
const PREDICCIONES = [['j', 0.9, 'Seguro que conecta'], ['k', 0.5, 'Puede'], ['l', 0.1, 'Seguro que no']]
// Las mismas teclas que la criba; c marca «choca con lo que ya sabía» y espacio pasa a la siguiente.
const TECLAS_MANO = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 10, q: 11, w: 12, '.': 11, ',': 11, Decimal: 11, Enter: 12 }

function montarMano() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>La Mano</h1><div class="fila"><span class="tenue" id="mn-mazo"></span><button class="btn btn-chico" id="mn-robar" title="r">Robar otra mano</button></div></div>
    <div class="mano-barra" id="mn-barra"></div>
    <div class="mano-sorpresas" id="mn-sorpresas"></div>
    <div class="mano-mesa">
      <div class="mano">
        <div class="mano-tira" id="mn-tira"></div>
        <div class="criba-carta mano-carta" id="mn-carta"></div>
        <div class="criba-pesos" id="mn-pesos">
          <button class="btn" data-gesto="descartar" title="Descartar (x)">✕</button>
          ${Array.from({ length: 12 }, (_, i) => `<button class="btn" data-peso="${i + 1}" title="Tecla ${i + 1 === 10 ? '0' : i + 1 === 11 ? 'q' : i + 1 === 12 ? 'w' : i + 1}">${i + 1}</button>`).join('')}
        </div>
        <div class="mano-prediccion" id="mn-pred" hidden><span>🎯 ¿Conecta con algo que ya pesaste?</span>${PREDICCIONES.map(([k, p, n]) => `<button class="btn btn-chico" data-pred="${p}" title="${k}">${n} <small class="tenue">${Math.round(p * 100)} %</small></button>`).join('')}</div>
        <div class="fila" style="justify-content:center"><button class="btn btn-chico" id="mn-predecir" title="a">🎯 Predecir antes de ver</button><button class="btn btn-chico" data-gesto="choca" title="c">⚡ Choca con lo que ya sabía</button><button class="btn btn-chico" id="mn-pasar" title="Espacio">Pasar</button><button class="btn btn-chico" id="mn-deshacer" title="z">Deshacer</button></div>
        <input class="campo-suelto" id="mn-porque" placeholder="¿Por qué? (opcional: una línea, viaja con la carta)">
      </div>
      <aside class="mano-caida" id="mn-caida"><p class="tenue">Jugá una carta: acá aparece con qué conecta de lo que ya sabías.</p></aside>
    </div>`
  $$('#mn-pesos [data-peso]').forEach((b) => (b.onclick = () => jugarCarta({ gesto: 'peso', peso: Number(b.dataset.peso) })))
  $$('[data-gesto]').forEach((b) => (b.onclick = () => jugarCarta({ gesto: b.dataset.gesto })))
  $('#mn-robar').onclick = () => robarMano(true)
  $('#mn-pasar').onclick = pasarCarta
  manoPredecir = pref.leer('mastro-mano-predecir', 'no') === 'si'
  $('#mn-predecir').onclick = alternarPredecir
  $$('#mn-pred [data-pred]').forEach((b) => (b.onclick = () => predecir(Number(b.dataset.pred))))
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
    manoPrediccion = {}
    manoActiva = 0
    pintarMazo(r.mazo)
    pintarBarra(r)
    pintarSorpresas(r.sorpresas)
    pintarMano()
  } catch (e) { error(e) }
}

function pintarMazo(m) {
  const el = $('#mn-mazo')
  const t = m.sorpresas
  if (el) el.textContent = `Mazo: ${m.total.toLocaleString('es-AR')} sin pesar · ${m.nuevas.toLocaleString('es-AR')} nuevas · ${m.variaciones.toLocaleString('es-AR')} variaciones${t?.unaCada ? ` · sorpresas ≈ 1 de ${t.unaCada}` : ''}${m.jugadasHoy ? ` · hoy jugaste ${m.jugadasHoy}` : ''}`
}

// ─── la Pesquisa, el dial y la ascensión ────────────────────────────────

let manoPesquisa = null
const DIAL = [['auto', 'Auto'], ['suave', 'Hoy suave'], ['pelea', 'Hoy pelea']]

function pintarBarra(r) {
  manoPesquisa = r.pesquisa
  const el = $('#mn-barra')
  if (!el) return
  const p = r.pesquisa
  const a = r.ascension
  el.innerHTML = `<div class="mano-pesquisa">${p
    ? `<span>🔎 <b>${esc(p.pregunta)}</b> <small class="tenue">${p.pesadas} pesada${p.pesadas === 1 ? '' : 's'} · ${p.sorpresas} sorpresa${p.sorpresas === 1 ? '' : 's'}${p.fuentes.length ? ` · de ${p.fuentes.map(esc).join(', ')}` : ''}${p.jokers.length ? ` · jokers: ${p.jokers.map((j) => esc(j.nombre)).join(', ')}` : ''}</small></span><button class="btn btn-chico" id="mn-cerrar-pq">Cerrar la Pesquisa</button>`
    : '<span class="tenue">Sin Pesquisa: robás de todo. Con una pregunta, la mano trae lo que tiene que ver.</span><button class="btn btn-chico" id="mn-abrir-pq">🔎 Abrir una Pesquisa</button>'}</div>
    <div class="mano-nivel"><span title="${esc(a.proximo ?? 'Llegaste a la última por ahora')}">Ascensión <b>${a.nivel}</b>${a.proximo ? ` <small class="tenue">· ${esc(a.proximo)}</small>` : ''}</span>
      <button class="btn btn-chico" id="mn-progreso">📈 Cómo venís</button><span class="mano-dial">${DIAL.map(([k, n]) => `<button class="btn btn-chico${r.modo.dial === k ? ' on' : ''}" data-dial="${k}">${n}</button>`).join('')}<small class="tenue" title="${esc(r.modo.porque)}">→ ${r.modo.modo}</small></span></div>`
  $('#mn-abrir-pq')?.addEventListener('click', modalAbrirPesquisa)
  $('#mn-cerrar-pq')?.addEventListener('click', modalCerrarPesquisa)
  $('#mn-progreso')?.addEventListener('click', modalProgresoMano)
  $$('[data-dial]', el).forEach((b) => (b.onclick = async () => { try { await api('/mano/dial', { dial: b.dataset.dial }); robarMano(true) } catch (e) { error(e) } }))
}

async function modalAbrirPesquisa() {
  let o
  try { o = await api('/mano/opciones') } catch (e) { return error(e) }
  const sugerencias = [...o.bucles.map((b) => ({ origen: 'bucle', id: b.id, texto: b.texto, nota: `vuelve hace ${b.veces} veces` })), ...o.preguntas.map((q) => ({ origen: 'pregunta', id: q.id, texto: q.texto, nota: 'pregunta pendiente' }))]
  abrirModal(`<h2>🔎 Abrir una Pesquisa</h2>
    <p class="tenue">Una pregunta, de 3 a 5 manos sobre ella y una síntesis. La build es tuya: de dónde robar y quién opina al cerrar.</p>
    <label>La pregunta<input class="campo" id="pq-pregunta" placeholder="¿Qué querés entender?" autofocus></label>
    ${sugerencias.length ? `<div class="pq-sug">${sugerencias.map((x, i) => `<button class="btn btn-chico" data-sug="${i}" title="${esc(x.nota)}">${esc(corto(x.texto, 70))}</button>`).join('')}</div>` : ''}
    ${o.fuentes.length ? `<fieldset class="pq-grupo"><legend>Robar de (nada marcado = de todo)</legend>${o.fuentes.map((f) => `<label><input type="checkbox" value="${esc(f.id)}" data-fuente> ${esc(f.nombre)} <small class="tenue">${f.n}</small></label>`).join('')}</fieldset>` : ''}
    ${o.jokers.length ? `<fieldset class="pq-grupo"><legend>Jokers (hasta 3, de tu consejo de modelos)</legend>${o.jokers.map((j) => `<label title="${j.conManual ? '' : 'Sin manual todavía: no opina hasta que lo armes'}"><input type="checkbox" value="${j.id}" data-joker> ${esc(j.nombre)}${j.conManual ? '' : ' <small class="tenue">(sin manual)</small>'}</label>`).join('')}</fieldset>` : '<p class="tenue">Sin jokers: sumá personas a tu consejo de modelos (Jugador → Modelos) para que opinen al cerrar.</p>'}
    <div class="fila"><button class="btn" id="pq-abrir">Abrir</button><button class="btn" data-cerrar>Cancelar</button></div>`)
  let elegida = { origen: 'libre', id: null }
  $$('#modal [data-sug]').forEach((b) => (b.onclick = () => { const x = sugerencias[Number(b.dataset.sug)]; elegida = { origen: x.origen, id: x.id }; $('#pq-pregunta').value = x.texto }))
  $('#pq-pregunta').oninput = () => { elegida = { origen: 'libre', id: null } }
  $$('#modal [data-joker]').forEach((c) => (c.onchange = () => { if ($$('#modal [data-joker]:checked').length > 3) { c.checked = false; toast('Hasta 3 jokers', 'suave') } }))
  $('#pq-abrir').onclick = async () => {
    try {
      await api('/mano/pesquisa', { pregunta: $('#pq-pregunta').value, origen: elegida.origen, origenId: elegida.id, fuentes: $$('#modal [data-fuente]:checked').map((c) => c.value), jokers: $$('#modal [data-joker]:checked').map((c) => Number(c.value)) })
      cerrarModal()
      manoSaltear = []
      robarMano(false)
    } catch (e) { error(e) }
  }
}

function modalCerrarPesquisa() {
  const p = manoPesquisa
  if (!p) return
  abrirModal(`<h2>Cerrar la Pesquisa</h2><p><b>${esc(p.pregunta)}</b></p>
    <p class="tenue">${p.pesadas} carta${p.pesadas === 1 ? '' : 's'} pesada${p.pesadas === 1 ? '' : 's'}${p.pesadas < 3 ? ' (con menos de 3 es difícil que salga un combo: no pasa nada, queda lo que faltó)' : ''}.</p>
    ${p.origen === 'bucle' ? `<fieldset class="pq-grupo"><legend>Y el bucle, ¿qué hacés?</legend>${[['', 'Lo dejo abierto'], ['ya', 'Ya (side quest para hoy)'], ['agendar', 'Lo agendo (mañana)'], ['soltar', 'Lo suelto']].map(([k, n]) => `<label><input type="radio" name="pq-dec" value="${k}"${k ? '' : ' checked'}> ${n}</label>`).join('')}</fieldset>` : ''}
    <div class="fila"><button class="btn" id="pq-cerrar">Cerrar y ver la síntesis</button><button class="btn" data-cerrar>Seguir jugando</button></div>`)
  $('#pq-cerrar').onclick = async (e) => {
    e.target.disabled = true
    e.target.textContent = 'Cerrando…'
    try {
      const c = await api(`/mano/pesquisa/${p.id}/cerrar`, { decision: $('#modal [name=pq-dec]:checked')?.value || null })
      pintarSintesis(c)
    } catch (err) { error(err); e.target.disabled = false; e.target.textContent = 'Cerrar y ver la síntesis' }
  }
}

function pintarSintesis(c) {
  const s = c.sintesis
  abrirModal(`<h2>Síntesis</h2><p class="tenue">${esc(c.pregunta)}</p>
    ${s.hipotesis ? `<div class="mano-sorpresa"><b>✦ Hipótesis</b><p>${esc(s.hipotesis.texto).replace(/\n/g, '<br>')}</p><small class="tenue">Quedó como carta: la pesás en una mano.</small></div>` : ''}
    ${s.falto ? `<div class="mano-sorpresa respondida"><b>Lo que faltó</b><p>${esc(s.falto.texto)}</p><small class="tenue">No salió un combo: queda como pregunta. La próxima tiene más sentido.</small></div>` : ''}
    ${s.contra ? `<div class="mano-sorpresa mano-s-contradiccion"><b>⚖ El abogado del diablo</b><p>${esc(s.contra)}</p></div>` : ''}
    ${s.jokers.map((j) => `<div class="mano-sorpresa respondida"><b>🃏 ${esc(j.modelo)}</b><p>${esc(j.haria)}</p><small class="tenue">${esc(j.porQue)}</small></div>`).join('')}
    ${s.nota ? `<p class="tenue">${esc(s.nota)}</p>` : ''}
    <h3>¿Y ahora?</h3>
    <div class="pq-sig">${(c.siguiente ?? []).map((o, i) => `<button class="btn" data-sig="${i}"><small class="tenue">${{ hipotesis: 'Poner a prueba', bucle: 'Lo que vuelve', pregunta: 'Pregunta pendiente' }[o.origen]}</small>${esc(corto(o.texto, 120))}</button>`).join('')}<button class="btn" data-sig="saltar">Saltar</button></div>`)
  $$('#modal [data-sig]').forEach((b) => (b.onclick = async () => {
    try {
      await api(`/mano/pesquisa/${c.id}/siguiente`, { eleccion: b.dataset.sig })
      cerrarModal()
      manoSaltear = []
      robarMano(false)
    } catch (e) { error(e) }
  }))
}

/** Cómo venís: si te estás volviendo mejor (calibración y retención), tu territorio y la honestidad de las sorpresas. Sin puntos. */
async function modalProgresoMano() {
  let p
  try { p = await api('/mano/progreso') } catch (e) { return error(e) }
  const c = p.calibracion
  const r = p.retencion
  const h = p.honestidad
  const NOMBRE = { puente: '⟡ Puentes', contradiccion: '⚡ Creencias que se caen', combo: '✦ Combos' }
  abrirModal(`<h2>📈 Cómo venís</h2>
    <div class="mano-progreso">
      <section><h3>🎯 Calibración</h3>${c.predicciones ? `<p><b>Acertás el ${c.conocimiento} %</b> de lo que predecís <small class="tenue">(${c.predicciones} predicci${c.predicciones === 1 ? 'ón' : 'ones'} · 0 % es tirar una moneda, 100 % es acertar todo)</small></p>` : '<p class="tenue">Todavía sin predicciones: prendé «🎯 Predecir antes de ver» (tecla A) en La Mano.</p>'}</section>
      <section><h3>🃏 Retención</h3>${r.porcentaje != null ? `<p><b>Recordás el ${r.porcentaje} %</b> de lo que pesaste 9 o más <small class="tenue">(${r.repasadas} de ${r.tarjetas} tarjetas repasadas)</small></p>` : r.tarjetas ? `<p>${r.tarjetas} tarjeta${r.tarjetas === 1 ? '' : 's'} de lo que pesaste alto, esperando su primer repaso (🃏 en Hoy).</p>` : '<p class="tenue">Lo que pesés 9 o más va quedando como tarjeta de repaso.</p>'}</section>
      <section><h3>Ascensión ${p.ascension.nivel}</h3><p class="tenue">${esc(p.ascension.proximo ?? 'Llegaste a la última por ahora.')}</p></section>
      <section><h3>🗺 Tu territorio</h3>${p.territorio.length ? `<table class="mano-territorio"><tr><th>Fuente</th><th>Sellado</th><th>Fronteras movidas</th><th>Niebla</th></tr>${p.territorio.map((t) => `<tr><td>${esc(t.nombre)}</td><td>${t.selladas}</td><td>${t.fronteras || ''}</td><td><span class="mano-niebla"><i style="width:${t.niebla}%"></i></span> ${t.niebla} %</td></tr>`).join('')}</table>` : '<p class="tenue">Todavía no hay afirmaciones con su fuente.</p>'}</section>
      <section><h3>⚖ Honestidad de las sorpresas</h3>${h.porTipo.length ? `<table class="mano-territorio"><tr><th></th><th>Salieron</th><th>Valieron</th><th>No</th><th>Sin responder</th></tr>${h.porTipo.map((t) => `<tr><td>${NOMBRE[t.tipo] ?? esc(t.tipo)}</td><td>${t.mostradas}</td><td>${t.valieron}</td><td>${t.no_valieron}</td><td>${t.pendientes}</td></tr>`).join('')}</table>` : '<p class="tenue">Todavía no salió ninguna.</p>'}
        <p class="tenue">${h.unaCada ? `Una sorpresa cada ${h.unaCada} cartas pesadas · ` : ''}umbral del puente: ${Math.round(h.umbralPuente * 100)} % de parecido (sube solo si salen demasiadas o si las marcás casualidad).</p></section>
    </div>
    <div class="fila"><button class="btn" data-cerrar>Listo</button></div>`)
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
  el.innerHTML = `<div class="p-top">${nov ? `<span class="mano-novedad mano-${c.novedad}" title="${nov[1]}">${nov[0]} ${c.novedad === 'variacion' ? 'variación' : c.novedad}</span>` : '<span class="tenue">sin vector todavía</span>'}${c.desafio ? '<span class="mano-desafio" title="Ascensión 1: es una variación de algo que pesaste alto">⚔ puede chocar con lo que creés</span>' : ''}${c.relevancia != null ? `<span class="tenue" title="Cuánto tiene que ver con la pregunta de la Pesquisa">↳ ${Math.round(c.relevancia * 100)} % con la pregunta</span>` : ''}${f ? `<span title="${esc(f.titulo)}">de «${esc(corto(f.titulo, 50))}»${f.fecha ? ` · ${esc(f.fecha)}` : ''}</span>` : ''}</div>
    <h2 class="mano-texto">${esc(c.texto)}</h2>
    ${c.parecidaA && !(manoPredecir && manoPrediccion[c.id] == null && !manoJugadas[c.id]) ? `<small class="tenue">${c.novedad === 'repetida' ? 'Casi igual a' : 'Se parece a'}: «${esc(corto(c.parecidaA.texto, 140))}»</small>` : ''}
    <div class="mano-toca">${toca.primaria ? `→ Primaria: <b>${esc(toca.primaria.titulo)}</b>` : '→ <span class="tenue">suelta: no toca ninguna primaria</span>'}${toca.principal ? ` · Principal: ${esc(toca.principal)}` : ''}${toca.entidades.length ? `<br><span class="tenue">Habla de ${toca.entidades.map((e) => esc(e.nombre)).join(', ')}</span>` : ''}</div>`
  pintarPrediccion()
  if (manoJugadas[c.id]) pintarCaida(manoJugadas[c.id])
}

function lineaVecino(v) {
  return `<li><span>${esc(corto(v.texto, 160))}</span><small class="tenue">${v.peso ? `peso ${v.peso} · ` : ''}${Math.round(v.sim * 100)} % parecido${v.fecha ? ` · ${esc(v.fecha)}` : ''}</small></li>`
}

function pintarCaida(j) {
  const el = $('#mn-caida')
  if (!el) return
  const titulo = j.gesto === 'peso' ? `Pesada ${j.carta.peso}` : j.gesto === 'choca' ? '⚡ Marcada: choca con lo que ya sabías' : '✕ Descartada'
  const pr = j.prediccion
  const acierto = pr && pr.probabilidad !== 0.5 ? (pr.probabilidad > 0.5) === pr.conecto : null
  el.innerHTML = `<h3>${titulo}</h3>
    ${pr ? `<p class="mano-pred-res">🎯 Dijiste ${Math.round(pr.probabilidad * 100)} % · ${pr.conecto ? 'conectó' : 'no conectó'}${acierto == null ? '' : acierto ? ' · bien leído' : ' · a calibrar'}</p>` : ''}
    ${j.tarjetaId ? '<p class="tenue">🃏 Quedó como tarjeta para repasar: lo que importa también se recuerda.</p>' : ''}
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
  if (manoPredecir && g.gesto !== 'descartar' && manoPrediccion[c.id] == null) return toast('Primero predecí<small>J seguro que conecta · K puede · L seguro que no</small>', 'suave')
  document.activeElement?.blur?.()
  const porque = $('#mn-porque')?.value.trim() || null
  try {
    const j = await api(`/mano/${c.id}`, { ...g, porque, prediccion: g.gesto === 'descartar' ? null : manoPrediccion[c.id] ?? null })
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

function alternarPredecir() {
  manoPredecir = !manoPredecir
  pref.guardar('mastro-mano-predecir', manoPredecir ? 'si' : 'no')
  pintarMano()
}

function predecir(p) {
  const c = manoCartas[manoActiva]
  if (!c || manoJugadas[c.id] || !manoPredecir) return
  manoPrediccion[c.id] = p
  pintarMano()
}

function pintarPrediccion() {
  const fila = $('#mn-pred')
  const c = manoCartas[manoActiva]
  $('#mn-predecir')?.classList.toggle('on', manoPredecir)
  if (!fila) return
  fila.hidden = !manoPredecir || !c || !!manoJugadas[c.id]
  $$('[data-pred]', fila).forEach((b) => b.classList.toggle('on', c && manoPrediccion[c.id] === Number(b.dataset.pred)))
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
  else if (e.key === 'a') { e.preventDefault(); alternarPredecir() }
  else if (PREDICCIONES.some(([k]) => k === e.key)) { e.preventDefault(); predecir(PREDICCIONES.find(([k]) => k === e.key)[1]) }
  else if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); pasarCarta() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); manoActiva = (manoActiva + manoCartas.length - 1) % Math.max(1, manoCartas.length); pintarMano() }
  else if (e.key === 'z') { e.preventDefault(); deshacerMano() }
  else if (e.key === 'r') { e.preventDefault(); robarMano(true) }
  else if (e.key === 'p') { e.preventDefault(); $('#mn-porque')?.focus() }
})
