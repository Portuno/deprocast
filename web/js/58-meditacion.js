'use strict'
// Meditación: respiración guiada y binaural beats, hechos a medida. El sonido lo arma la pantalla con Web Audio: dos
// tonos (uno por oído) que difieren en el «pulso», ruido de fondo opcional, el volumen que sigue la respiración y una
// campanita suave en cada cambio de fase. Todo el tiempo de la sesión se programa de antemano en el reloj del audio:
// sigue exacto aunque la pestaña quede de fondo, y la pausa congela ese reloj.

const med = { d: null, sel: null, editando: null, sesion: null }
const NOMBRE_FASE = { inhalar: 'Inhalá', retener: 'Retené', exhalar: 'Exhalá', sostener: 'Sostené vacío' }
const ETIQUETA_FASE = { inhalar: 'Inhalar', retener: 'Retener', exhalar: 'Exhalar', sostener: 'Sostener vacío' }
const TONO_FASE = { inhalar: 528, retener: 440, exhalar: 396, sostener: 352 }
const NOMBRE_RUIDO = { ninguno: 'Sin ruido', blanco: 'Ruido blanco', rosa: 'Ruido rosa', marron: 'Ruido marrón' }

const cicloSeg = (e) => e.fases.reduce((s, f) => s + f.seg, 0)
function duracionSeg(e) {
  const c = cicloSeg(e)
  if (c && e.ciclos != null) return Math.round(e.ciclos * c)
  if (c && e.minutos != null) return Math.ceil((e.minutos * 60) / c) * c
  return Math.round((e.minutos ?? 10) * 60)
}
const medReloj = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const durTexto = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`)
const numero = (n) => String(n).replace('.', ',')
const banda = (hz) => (med.d?.bandas ?? []).find((b) => hz >= b.desde && hz < b.hasta) ?? (med.d?.bandas ?? []).at(-1)
const patron = (e) => (e.fases.length ? e.fases.map((f) => numero(f.seg)).join(' · ') : 'Respiración libre')
const sonidoTexto = (b) => (!b.activo ? 'Sin sonido' : `${banda(b.pulso)?.nombre ?? ''} ${numero(b.pulso)} Hz${b.pulsoFinal != null ? ` → ${banda(b.pulsoFinal)?.nombre ?? ''} ${numero(b.pulsoFinal)} Hz` : ''}${b.ruido !== 'ninguno' ? ` · ${NOMBRE_RUIDO[b.ruido].toLowerCase()}` : ''}`)

async function montarMeditacion() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Meditación</h1><p>Respiración guiada y binaural beats, hechos a tu medida. El binaural se siente con auriculares: cada oído escucha un tono y la diferencia es el pulso.</p><span class="tenue chico" id="med-resumen"></span></div>
    <div class="med-grilla"><div class="med-lista" id="med-lista"><p class="tenue">Cargando…</p></div><section class="med-detalle" id="med-detalle"></section></div>`
  try { med.d = await api('/meditacion') } catch (e) { return error(e) }
  const todos = [...med.d.mias, ...med.d.base]
  med.sel = todos.find((x) => x.id === vistaParam)?.id ?? (todos.some((x) => x.id === med.sel) ? med.sel : (med.d.mias[0] ?? med.d.base[0]).id)
  med.editando = null
  pintarMedLista()
  pintarMedDetalle()
}

function pintarMedLista() {
  const r = med.d.resumen
  $('#med-resumen').textContent = r.mes.sesiones ? `Este mes: ${r.mes.dias} día${r.mes.dias === 1 ? '' : 's'} · ${r.mes.minutos} min` : ''
  const tarjeta = (e) => `<button class="med-tarjeta ${e.id === med.sel ? 'on' : ''}" data-med="${esc(e.id)}">
      <b>${esc(e.nombre)}</b><span class="tenue chico">${esc(e.intencion || '')}</span>
      <span class="med-chips"><span>${esc(patron(e))}</span><span>${durTexto(duracionSeg(e))}</span>${e.binaural.activo ? `<span>${esc(banda(e.binaural.pulso)?.nombre ?? '')}</span>` : ''}${e.usos ? `<span>${e.usos} ${e.usos === 1 ? 'vez' : 'veces'}</span>` : ''}</span>
    </button>`
  $('#med-lista').innerHTML = `<form class="med-amedida" id="med-amedida">
      <label class="tl-h" for="med-pedido">A tu medida</label>
      <textarea class="campo-suelto" id="med-pedido" rows="3" placeholder="Contá para qué: «algo para dormirme en 10 minutos», «bajar la ansiedad antes de una reunión», «foco para escribir 25 minutos, solo sonido»…"></textarea>
      <div class="fila"><button class="btn btn-primario" id="med-disenar">Diseñarlo</button><button type="button" class="btn" id="med-nuevo">Armarlo a mano</button></div>
    </form>
    ${med.d.mias.length ? `<h3 class="tl-h">Tuyos</h3><div class="med-tarjetas">${med.d.mias.map(tarjeta).join('')}</div>` : ''}
    <h3 class="tl-h">De base</h3><div class="med-tarjetas">${med.d.base.map(tarjeta).join('')}</div>`
  $$('[data-med]').forEach((b) => (b.onclick = () => { med.sel = b.dataset.med; med.editando = null; history.replaceState(null, '', rutaA('meditacion', med.sel)); pintarMedLista(); pintarMedDetalle(); verDetalle() }))
  $('#med-nuevo').onclick = () => { med.editando = { nombre: '', intencion: '', descripcion: '', fases: [{ tipo: 'inhalar', seg: 4 }, { tipo: 'exhalar', seg: 6 }], ciclos: 10, minutos: null, marcarFases: true, binaural: { activo: true, portadora: 200, pulso: 10, pulsoFinal: null, volumen: 0.35, ruido: 'ninguno', volumenRuido: 0.2, sigueRespiracion: true } }; pintarMedDetalle(); verDetalle() }
  $('#med-amedida').onsubmit = async (ev) => {
    ev.preventDefault()
    const pedido = $('#med-pedido').value.trim()
    if (!pedido) return $('#med-pedido').focus()
    const b = $('#med-disenar')
    b.disabled = true
    b.textContent = 'Diseñando…'
    try {
      const e = await api('/meditacion/a-medida', { pedido })
      med.d = await api('/meditacion')
      med.sel = e.id
      history.replaceState(null, '', rutaA('meditacion', e.id))
      pintarMedLista()
      pintarMedDetalle()
      toast(`Listo: «${esc(e.nombre)}»<small>${esc(e.intencion || 'Ya lo podés empezar')}</small>`, 'suave')
    } catch (e) { error(e); b.disabled = false; b.textContent = 'Diseñarlo' }
  }
}

/** En el teléfono la lista va arriba: al elegir uno, el detalle sube a la vista. */
const verDetalle = () => { if (matchMedia('(max-width: 1000px)').matches) $('#med-detalle')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

const medActual = () => [...med.d.mias, ...med.d.base].find((x) => x.id === med.sel)

function barraFases(e) {
  if (!e.fases.length) return '<div class="med-patron"><span class="med-f libre" style="flex:1">Respiración libre</span></div>'
  return `<div class="med-patron">${e.fases.map((f) => `<span class="med-f ${f.tipo}" style="flex:${f.seg}" title="${ETIQUETA_FASE[f.tipo]} ${numero(f.seg)} s">${ETIQUETA_FASE[f.tipo]}<b>${numero(f.seg)} s</b></span>`).join('')}</div>`
}

function pintarMedDetalle() {
  if (med.editando) return pintarMedEditor()
  const e = medActual()
  if (!e) return void ($('#med-detalle').innerHTML = '')
  const b = e.binaural
  const largo = e.fases.length ? (e.ciclos != null ? `${e.ciclos} ciclos de ${numero(cicloSeg(e))} s` : `${numero(e.minutos)} minutos`) : `${numero(e.minutos)} minutos`
  $('#med-detalle').innerHTML = `<div class="med-cab"><div><h2>${esc(e.nombre)}</h2>${e.intencion ? `<p class="med-intencion">${esc(e.intencion)}</p>` : ''}</div>
      <button class="btn btn-primario med-empezar" id="med-empezar">${ico('play')} Empezar</button></div>
    ${e.descripcion ? `<p class="med-desc">${esc(e.descripcion)}</p>` : ''}
    ${barraFases(e)}
    <dl class="med-datos">
      <div><dt>Dura</dt><dd>${durTexto(duracionSeg(e))} <span class="tenue">(${largo})</span></dd></div>
      <div><dt>Sonido</dt><dd>${esc(sonidoTexto(b))}${b.activo ? `<span class="tenue"> · portadora ${b.portadora} Hz${b.sigueRespiracion ? ' · sigue tu respiración' : ''}</span>` : ''}</dd></div>
      ${b.activo ? `<div><dt>Para</dt><dd>${esc(banda(b.pulso)?.para ?? '')}${b.pulsoFinal != null ? ` → ${esc(banda(b.pulsoFinal)?.para ?? '')}` : ''}</dd></div>` : ''}
      ${e.usos ? `<div><dt>Hecho</dt><dd>${e.usos} ${e.usos === 1 ? 'vez' : 'veces'}${e.ultima ? `, la última ${haceCuanto(e.ultima)}` : ''}</dd></div>` : ''}
      ${e.pedido ? `<div><dt>Lo pediste así</dt><dd class="tenue">«${esc(e.pedido)}»</dd></div>` : ''}
    </dl>
    <div class="fila">${e.origen === 'base' ? '<button class="btn" id="med-copiar">Copiar y ajustar</button>' : '<button class="btn" id="med-editar">Ajustar</button><button class="btn btn-peligro" id="med-borrar">Borrar</button>'}</div>
    ${b.activo ? '<p class="tenue chico">🎧 Con auriculares. Si te mareás en una retención, soltala y respirá normal.</p>' : '<p class="tenue chico">Si te mareás en una retención, soltala y respirá normal.</p>'}
    ${pintarMedResumen()}`
  $('#med-empezar').onclick = () => empezarSesion(e)
  if ($('#med-copiar')) $('#med-copiar').onclick = () => { med.editando = { ...structuredClone(e), id: null, nombre: `${e.nombre} (mía)` }; pintarMedDetalle() }
  if ($('#med-editar')) $('#med-editar').onclick = () => { med.editando = structuredClone(e); pintarMedDetalle() }
  if ($('#med-borrar')) $('#med-borrar').onclick = async () => {
    if (!(await confirmar(`¿Borrar «${e.nombre}»?`, { detalle: 'Las sesiones que hiciste con él quedan anotadas.', si: 'Borrar', peligro: true }))) return
    try { await api(`/meditacion/${e.id}/borrar`, {}); med.d = await api('/meditacion'); med.sel = (med.d.mias[0] ?? med.d.base[0]).id; pintarMedLista(); pintarMedDetalle() } catch (x) { error(x) }
  }
}

function pintarMedResumen() {
  const r = med.d.resumen
  if (!r.total.sesiones) return ''
  const an = r.mes.animos
  return `<section class="med-practica"><h3 class="tl-h">Tu práctica</h3>
    <p>Este mes, <b>${r.mes.dias}</b> día${r.mes.dias === 1 ? '' : 's'} y <b>${r.mes.minutos}</b> minutos${an.mejor || an.igual || an.peor ? ` · quedaste mejor ${an.mejor ?? 0} ${an.mejor === 1 ? 'vez' : 'veces'}` : ''}. En total, ${r.total.sesiones} ${r.total.sesiones === 1 ? 'sesión' : 'sesiones'}.</p>
    <ul class="med-ultimas">${r.ultimas.map((u) => `<li><span>${esc(u.nombre)}</span><span class="tenue">${esc(u.fecha.slice(8, 10))}/${esc(u.fecha.slice(5, 7))} · ${numero(u.minutos)} min${u.completa ? '' : ' · cortada'}${u.animo ? ` · ${esc(u.animo)}` : ''}</span></li>`).join('')}</ul></section>`
}

// ─── el editor ───────────────────────────────────────────────────────────

function pintarMedEditor() {
  const e = med.editando
  const b = e.binaural
  const deslizador = (id, etiqueta, min, max, paso, valor, salida) => `<label class="med-desl"><span>${etiqueta}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${paso}" value="${valor}"><output id="${id}-o">${salida}</output></label>`
  $('#med-detalle').innerHTML = `<form id="med-form" class="med-form">
    <h2>${e.id ? 'Ajustar' : 'Tu ejercicio'}</h2>
    <label class="campo">Nombre<input id="mf-nombre" value="${esc(e.nombre)}" required maxlength="80" placeholder="Para dormir los domingos"></label>
    <label class="campo">Para qué<input id="mf-intencion" value="${esc(e.intencion)}" maxlength="160" placeholder="Soltar el día"></label>
    <label class="campo">Cómo hacerlo<textarea id="mf-desc" maxlength="1200" rows="2">${esc(e.descripcion)}</textarea></label>
    <h3 class="tl-h">Respiración</h3>
    <div id="mf-fases" class="med-fases">${e.fases.map((f, i) => `<div class="med-fase fila" data-i="${i}"><select class="campo-suelto" data-tipo>${Object.entries(ETIQUETA_FASE).map(([k, v]) => `<option value="${k}" ${k === f.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select><input class="campo-suelto" type="number" min="1" max="30" step="0.5" value="${f.seg}" data-seg aria-label="Segundos"><span class="tenue chico">s</span><button type="button" class="btn btn-chico btn-icono" data-quitar title="Quitar">${ico('x')}</button></div>`).join('')}</div>
    <div class="fila"><button type="button" class="btn btn-chico" id="mf-mas">${ico('plus')} Fase</button><span class="tenue chico">${e.fases.length ? '' : 'Sin fases: solo sonido, respirás libre.'}</span></div>
    <div class="fila med-largo"><span>Largo</span>
      <label class="fila g-1"><input type="radio" name="mf-largo" value="ciclos" ${e.ciclos != null && e.fases.length ? 'checked' : ''} ${e.fases.length ? '' : 'disabled'}> ciclos</label>
      <label class="fila g-1"><input type="radio" name="mf-largo" value="minutos" ${e.ciclos == null || !e.fases.length ? 'checked' : ''}> minutos</label>
      <input class="campo-suelto" type="number" id="mf-cuanto" min="1" max="200" step="1" value="${e.ciclos ?? e.minutos ?? 10}" aria-label="Cuánto"></div>
    <label class="fila g-1"><input type="checkbox" id="mf-marcar" ${e.marcarFases !== false ? 'checked' : ''}> Una campanita suave en cada cambio de fase</label>
    <h3 class="tl-h">Sonido</h3>
    <label class="fila g-1"><input type="checkbox" id="mf-bin" ${b.activo ? 'checked' : ''}> Binaural beats</label>
    <div id="mf-bin-op" class="med-bin" ${b.activo ? '' : 'hidden'}>
      ${deslizador('mf-pulso', 'Pulso', 0.5, 45, 0.5, b.pulso, `${numero(b.pulso)} Hz · ${banda(b.pulso)?.nombre ?? ''}`)}
      <label class="fila g-1"><input type="checkbox" id="mf-rampa" ${b.pulsoFinal != null ? 'checked' : ''}> Ir llevándolo a otro pulso</label>
      <div id="mf-rampa-op" ${b.pulsoFinal != null ? '' : 'hidden'}>${deslizador('mf-final', 'Hasta', 0.5, 45, 0.5, b.pulsoFinal ?? 4, `${numero(b.pulsoFinal ?? 4)} Hz · ${banda(b.pulsoFinal ?? 4)?.nombre ?? ''}`)}</div>
      ${deslizador('mf-port', 'Portadora', 40, 1000, 5, b.portadora, `${b.portadora} Hz`)}
      ${deslizador('mf-vol', 'Volumen', 0, 1, 0.05, b.volumen, `${Math.round(b.volumen * 100)} %`)}
      <div class="fila"><span class="med-desl-et">Ruido</span><select class="campo-suelto" id="mf-ruido">${Object.entries(NOMBRE_RUIDO).map(([k, v]) => `<option value="${k}" ${k === b.ruido ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div id="mf-ruido-op" ${b.ruido === 'ninguno' ? 'hidden' : ''}>${deslizador('mf-vruido', 'Volumen del ruido', 0, 1, 0.05, b.volumenRuido, `${Math.round(b.volumenRuido * 100)} %`)}</div>
      <label class="fila g-1"><input type="checkbox" id="mf-sigue" ${b.sigueRespiracion ? 'checked' : ''}> Que el sonido siga la respiración (sube al inhalar, baja al exhalar)</label>
      <p class="tenue chico" id="mf-banda"></p>
    </div>
    <div class="fila"><button class="btn btn-primario">Guardar</button><button type="button" class="btn" id="mf-probar">${ico('headphones')} Probar 10 s</button><button type="button" class="btn" id="mf-cancelar">Cancelar</button></div>
  </form>`
  const leerForm = () => {
    const fases = $$('#mf-fases .med-fase').map((r) => ({ tipo: $('[data-tipo]', r).value, seg: Number($('[data-seg]', r).value) }))
    const porCiclos = fases.length && $('input[name="mf-largo"]:checked')?.value === 'ciclos'
    const cuanto = Number($('#mf-cuanto').value)
    return {
      id: e.id ?? null, nombre: $('#mf-nombre').value, intencion: $('#mf-intencion').value, descripcion: $('#mf-desc').value, fases,
      ciclos: porCiclos ? cuanto : null, minutos: porCiclos ? null : cuanto, marcarFases: $('#mf-marcar').checked,
      binaural: { activo: $('#mf-bin').checked, pulso: Number($('#mf-pulso').value), pulsoFinal: $('#mf-rampa').checked ? Number($('#mf-final').value) : null, portadora: Number($('#mf-port').value), volumen: Number($('#mf-vol').value), ruido: $('#mf-ruido').value, volumenRuido: Number($('#mf-vruido').value), sigueRespiracion: $('#mf-sigue').checked },
    }
  }
  const guardarBorrador = () => { med.editando = leerForm() }
  const bandaTexto = () => { const p = Number($('#mf-pulso').value); const f = $('#mf-rampa').checked ? Number($('#mf-final').value) : null; $('#mf-banda').textContent = `${banda(p)?.nombre}: ${banda(p)?.para}${f != null ? ` → ${banda(f)?.nombre}: ${banda(f)?.para}` : ''}.` }
  const salidas = { 'mf-pulso': (v) => `${numero(v)} Hz · ${banda(v)?.nombre ?? ''}`, 'mf-final': (v) => `${numero(v)} Hz · ${banda(v)?.nombre ?? ''}`, 'mf-port': (v) => `${v} Hz`, 'mf-vol': (v) => `${Math.round(v * 100)} %`, 'mf-vruido': (v) => `${Math.round(v * 100)} %` }
  for (const [id, f] of Object.entries(salidas)) $(`#${id}`).oninput = (ev) => { $(`#${id}-o`).textContent = f(Number(ev.target.value)); bandaTexto() }
  bandaTexto()
  $('#mf-bin').onchange = (ev) => { $('#mf-bin-op').hidden = !ev.target.checked }
  $('#mf-rampa').onchange = (ev) => { $('#mf-rampa-op').hidden = !ev.target.checked; bandaTexto() }
  $('#mf-ruido').onchange = (ev) => { $('#mf-ruido-op').hidden = ev.target.value === 'ninguno' }
  $('#mf-mas').onclick = () => { guardarBorrador(); const ult = med.editando.fases.at(-1)?.tipo; const sig = { inhalar: 'retener', retener: 'exhalar', exhalar: 'sostener', sostener: 'inhalar' }[ult] ?? 'inhalar'; med.editando.fases.push({ tipo: sig, seg: 4 }); if (med.editando.ciclos == null && med.editando.fases.length === 1) med.editando.ciclos = 10; pintarMedEditor() }
  $$('[data-quitar]').forEach((x) => (x.onclick = () => { guardarBorrador(); med.editando.fases.splice(Number(x.closest('.med-fase').dataset.i), 1); pintarMedEditor() }))
  $('#mf-cancelar').onclick = () => { med.editando = null; pintarMedDetalle() }
  $('#mf-probar').onclick = () => {
    const x = leerForm()
    if (!x.binaural.activo) return toast('Prendé el binaural para escucharlo', 'suave')
    const m = crearMotor({ ...x, fases: x.fases.length ? x.fases : [], ciclos: null, minutos: 10 / 60 }, 10)
    toast('Probando 10 segundos<small>Con auriculares se siente el pulso.</small>', 'suave')
    setTimeout(() => m.parar(), 10_000)
  }
  $('#med-form').onsubmit = async (ev) => {
    ev.preventDefault()
    try {
      const g = await api('/meditacion', leerForm())
      med.d = await api('/meditacion')
      med.sel = g.id
      med.editando = null
      history.replaceState(null, '', rutaA('meditacion', g.id))
      pintarMedLista()
      pintarMedDetalle()
      toast(`Guardado: «${esc(g.nombre)}»`, 'suave')
    } catch (x) { error(x) }
  }
}

// ─── el sonido ───────────────────────────────────────────────────────────

/** Un tramo de ruido (4 s, en loop): blanco parejo, rosa (más grave) o marrón (el más suave). */
function bufferDeRuido(ctx, tipo) {
  const n = ctx.sampleRate * 4
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ultimo = 0
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1
      if (tipo === 'rosa') { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926 }
      else if (tipo === 'marron') { ultimo = (ultimo + 0.02 * w) / 1.02; d[i] = ultimo * 3.5 }
      else d[i] = w * 0.5
    }
  }
  return buf
}

/** Las fases de toda la sesión, con su inicio y su fin (en segundos desde el arranque). */
function lineaDeTiempo(e, total) {
  const out = []
  if (!e.fases.length) return out
  for (let t = 0; t < total - 0.01;) for (const f of e.fases) { if (t >= total - 0.01) break; out.push({ tipo: f.tipo, desde: t, hasta: t + f.seg }); t += f.seg }
  return out
}

/**
 * El motor: binaural (con su rampa de pulso), ruido, el volumen que sigue la respiración y las campanitas, todo
 * programado de una vez en el reloj del audio. Arranca y termina con un fundido de 3 s.
 */
function crearMotor(e, total) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('Este navegador no tiene audio web: la respiración se guía igual, sin sonido')
  const ctx = new Ctx()
  // Algunos navegadores lo crean en pausa: sin esto el reloj no avanza y la sesión queda quieta.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const t0 = ctx.currentTime + 0.2
  const vol = ctx.createGain()
  vol.gain.value = 1
  vol.connect(ctx.destination)
  const fundido = ctx.createGain()
  fundido.gain.setValueAtTime(0, t0)
  fundido.gain.linearRampToValueAtTime(1, t0 + Math.min(3, total / 4))
  fundido.gain.setValueAtTime(1, t0 + Math.max(0, total - 3))
  fundido.gain.linearRampToValueAtTime(0, t0 + total)
  fundido.connect(vol)
  const aliento = ctx.createGain()
  aliento.connect(fundido)
  const b = e.binaural
  const linea = lineaDeTiempo(e, total)
  const fuentes = []
  if (b.activo) {
    const izq = ctx.createOscillator(), der = ctx.createOscillator()
    const gi = ctx.createGain(), gd = ctx.createGain()
    gi.gain.value = gd.gain.value = b.volumen * 0.5
    const mezcla = ctx.createChannelMerger(2)
    for (const [o, signo] of [[izq, -1], [der, 1]]) {
      o.type = 'sine'
      o.frequency.setValueAtTime(b.portadora + (signo * b.pulso) / 2, t0)
      if (b.pulsoFinal != null) o.frequency.linearRampToValueAtTime(b.portadora + (signo * b.pulsoFinal) / 2, t0 + total)
    }
    izq.connect(gi).connect(mezcla, 0, 0)
    der.connect(gd).connect(mezcla, 0, 1)
    mezcla.connect(aliento)
    fuentes.push(izq, der)
    if (b.ruido !== 'ninguno') {
      const r = ctx.createBufferSource()
      r.buffer = bufferDeRuido(ctx, b.ruido)
      r.loop = true
      const gr = ctx.createGain()
      gr.gain.value = b.volumenRuido * 0.5
      r.connect(gr).connect(aliento)
      fuentes.push(r)
    }
    // El volumen sigue la respiración: sube al inhalar, se queda arriba al retener, baja al exhalar, abajo al sostener.
    const ALTO = 1, BAJO = 0.45
    aliento.gain.setValueAtTime(b.sigueRespiracion && linea.length ? BAJO : 0.85, t0)
    if (b.sigueRespiracion) for (const f of linea) {
      if (f.tipo === 'inhalar') aliento.gain.linearRampToValueAtTime(ALTO, t0 + f.hasta)
      else if (f.tipo === 'exhalar') aliento.gain.linearRampToValueAtTime(BAJO, t0 + f.hasta)
      else aliento.gain.setValueAtTime(f.tipo === 'retener' ? ALTO : BAJO, t0 + f.hasta)
    }
    for (const s of fuentes) { s.start(t0); s.stop(t0 + total + 0.1) }
  }
  // La campanita de cada fase (un tono suave, distinto por fase), si la quiere.
  if (e.marcarFases !== false) {
    const campana = ctx.createGain()
    campana.gain.value = 0.9
    campana.connect(vol)
    let previo = null
    for (const f of linea) {
      if (f.tipo === previo && f.tipo !== 'inhalar') { previo = f.tipo; continue }
      previo = f.tipo
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = TONO_FASE[f.tipo]
      const t = t0 + f.desde
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.09, t + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
      o.connect(g).connect(campana)
      o.start(t)
      o.stop(t + 1)
    }
  }
  return {
    ctx, t0, linea, total,
    transcurrido: () => Math.max(0, Math.min(total, ctx.currentTime - t0)),
    pausar: () => ctx.suspend(),
    seguir: () => ctx.resume(),
    volumen: (v) => vol.gain.setTargetAtTime(v, ctx.currentTime, 0.05),
    parar: () => {
      try { vol.gain.setTargetAtTime(0, ctx.currentTime, 0.3) } catch { /* ya cerrado */ }
      setTimeout(() => ctx.close().catch(() => {}), 1200)
    },
  }
}

// ─── la sesión ───────────────────────────────────────────────────────────

async function empezarSesion(e) {
  const total = duracionSeg(e)
  let motor
  try { motor = crearMotor(e, total) } catch (x) { return error(x) }
  const s = { e, motor, total, pausada: false, terminada: false, anotada: false, wake: null, fase: -1 }
  med.sesion = s
  try { s.wake = await navigator.wakeLock?.request('screen') } catch { /* la pantalla puede apagarse */ }
  const capa = document.createElement('div')
  capa.className = 'med-sesion'
  capa.id = 'med-sesion'
  capa.setAttribute('role', 'dialog')
  capa.setAttribute('aria-label', e.nombre)
  capa.innerHTML = `<div class="med-ses-cab"><b>${esc(e.nombre)}</b><button class="btn btn-chico btn-icono" id="ms-cerrar" title="Terminar (Esc)">${ico('x')}</button></div>
    <div class="med-ses-centro">
      <div class="med-circulo" id="ms-circulo"><div class="med-circulo-in"><span id="ms-fase">Preparate</span><b id="ms-cuenta"></b></div></div>
      <p class="med-ses-info" id="ms-info"></p>
      <div class="med-ses-barra"><i id="ms-barra"></i></div>
    </div>
    <div class="med-ses-pie">
      <button class="btn" id="ms-pausa">${ico('pause')} Pausa</button>
      ${e.binaural.activo ? `<label class="med-desl med-ses-vol"><span>${ico('headphones')}</span><input type="range" id="ms-vol" min="0" max="1.5" step="0.05" value="1" aria-label="Volumen"></label>` : ''}
      <button class="btn" id="ms-terminar">Terminar</button>
    </div>
    <div class="med-ses-fin" id="ms-fin" hidden></div>`
  document.body.append(capa)
  const pausa = () => {
    if (s.terminada) return
    s.pausada = !s.pausada
    s.pausada ? motor.pausar() : motor.seguir()
    $('#ms-pausa').innerHTML = s.pausada ? `${ico('play')} Seguir` : `${ico('pause')} Pausa`
    capa.classList.toggle('pausada', s.pausada)
  }
  $('#ms-pausa').onclick = pausa
  $('#ms-terminar').onclick = () => terminarSesion(false)
  $('#ms-cerrar').onclick = () => terminarSesion(false)
  if ($('#ms-vol')) $('#ms-vol').oninput = (ev) => motor.volumen(Number(ev.target.value))
  s.teclas = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); s.terminada ? cerrarSesion() : terminarSesion(false) }
    else if (ev.key === ' ' && !s.terminada && ev.target.tagName !== 'BUTTON' && ev.target.tagName !== 'INPUT') { ev.preventDefault(); pausa() }
  }
  document.addEventListener('keydown', s.teclas)
  const MIN = 0.55, MAX = 1
  const cuadro = () => {
    if (med.sesion !== s || s.terminada) return
    const t = motor.transcurrido()
    let escala = MIN, nombre = 'Respirá a tu ritmo', cuenta = medReloj(Math.ceil(total - t))
    const i = motor.linea.findIndex((f) => t >= f.desde && t < f.hasta)
    if (i >= 0) {
      const f = motor.linea[i]
      const p = (t - f.desde) / (f.hasta - f.desde)
      const suave = (x) => 0.5 - Math.cos(Math.PI * x) / 2
      escala = f.tipo === 'inhalar' ? (motor.linea[i - 1]?.tipo === 'inhalar' ? 0.85 + 0.15 * suave(p) : MIN + (MAX - MIN) * suave(p) * (motor.linea[i + 1]?.tipo === 'inhalar' ? 0.73 : 1)) : f.tipo === 'retener' ? MAX : f.tipo === 'exhalar' ? MAX - (MAX - MIN) * suave(p) : MIN
      nombre = NOMBRE_FASE[f.tipo]
      cuenta = String(Math.max(1, Math.ceil(f.hasta - t)))
      if (i !== s.fase) { s.fase = i; $('#ms-circulo').dataset.fase = f.tipo }
      const ciclo = cicloSeg(e)
      $('#ms-info').textContent = `Ciclo ${Math.min(Math.floor(t / ciclo) + 1, Math.round(total / ciclo))} de ${Math.round(total / ciclo)} · quedan ${medReloj(Math.ceil(total - t))}`
    } else if (!motor.linea.length) {
      escala = MIN + (MAX - MIN) * (0.5 - Math.cos((t / 10) * Math.PI * 2) / 2) * 0.5
      $('#ms-info').textContent = `${sonidoTexto(e.binaural)} · quedan ${medReloj(Math.ceil(total - t))}`
    }
    if (t < 0.05 && motor.linea.length) { nombre = 'Preparate'; cuenta = '' }
    $('#ms-circulo').style.transform = `scale(${escala.toFixed(4)})`
    $('#ms-fase').textContent = s.pausada ? 'En pausa' : nombre
    $('#ms-cuenta').textContent = s.pausada ? '' : cuenta
    $('#ms-barra').style.width = `${((t / total) * 100).toFixed(2)}%`
    if (t >= total - 0.05) return terminarSesion(true)
    requestAnimationFrame(cuadro)
  }
  // De fondo (pestaña oculta) el cuadro se frena: un reloj aparte cierra la sesión cuando termina el audio.
  s.vigia = setInterval(() => { if (motor.transcurrido() >= total - 0.05) terminarSesion(true) }, 1000)
  requestAnimationFrame(cuadro)
}

async function terminarSesion(completa) {
  const s = med.sesion
  if (!s || s.terminada) return
  s.terminada = true
  clearInterval(s.vigia)
  const seg = Math.round(s.motor.transcurrido())
  s.motor.parar()
  try { await s.wake?.release() } catch { /* nada */ }
  s.segundos = seg
  s.completa = completa
  const fin = $('#ms-fin')
  if (!fin) return
  if (seg < 10) return cerrarSesion()
  fin.hidden = false
  fin.innerHTML = `<h2>${completa ? 'Listo' : 'Hasta acá'}</h2><p class="tenue">${durTexto(seg)} de «${esc(s.e.nombre)}».</p>
    <p>¿Cómo quedaste?</p><div class="fila med-animos"><button class="btn" data-animo="mejor">Mejor</button><button class="btn" data-animo="igual">Igual</button><button class="btn" data-animo="peor">Peor</button></div>
    <button class="btn btn-chico" id="ms-salir">Cerrar sin decir</button>`
  $$('[data-animo]', fin).forEach((b) => (b.onclick = () => cerrarSesion(b.dataset.animo)))
  $('#ms-salir').onclick = () => cerrarSesion()
  $('[data-animo="mejor"]', fin).focus()
}

async function cerrarSesion(animo = null) {
  const s = med.sesion
  if (!s) return
  med.sesion = null
  document.removeEventListener('keydown', s.teclas)
  $('#med-sesion')?.remove()
  if (!s.terminada) { s.terminada = true; clearInterval(s.vigia); s.segundos = Math.round(s.motor.transcurrido()); s.motor.parar() }
  if (s.segundos >= 10 && !s.anotada) {
    s.anotada = true
    try {
      await api('/meditacion/sesion', { ejercicio: s.e.id, segundos: s.segundos, completa: s.completa, animo })
      if (vista === 'meditacion') { med.d = await api('/meditacion'); pintarMedLista(); if (!med.editando) pintarMedDetalle() }
    } catch (e) { error(e) }
  }
}
