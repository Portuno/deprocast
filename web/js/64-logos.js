'use strict'
// Agentes → Los Logos (Fragua #235): la familia de profesionales, uno por rubro. Cada uno con su ficha (qué sabe, qué
// no, sus fuentes del corpus y a quién deriva), una consulta que contesta solo desde sus fuentes (y que declara si no
// tiene), y la forja: plantillas de rubro, un rubro nuevo, o un agente que ya existe con su nombre propio.

const lg = { datos: null }

async function montarLogos() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Los Logos</h1><p>Profesionales por rubro. Cada uno contesta solo desde las fuentes de tu corpus que le asignes, citando; si no tiene fuente, lo dice antes de contestar. Lo que no es suyo, lo deriva.</p></div></div>
    <div id="lg-lista"><p class="tenue">Mirando…</p></div>
    <section class="lg-forja" id="lg-forja"></section>`
  await traerLogos()
}

async function traerLogos() {
  try { lg.datos = await api('/logos') } catch (e) { return error(e) }
  if (vista !== 'logos' || !$('#lg-lista')) return
  pintarLogos()
}

const fuenteLogos = (f) => `<span class="lg-fuente ${f.piezas ? '' : 'vacia'}" title="${f.piezas ? `${f.piezas} piezas` : 'Esta fuente no tiene piezas todavía'}">${f.vinculo.tipo === 'dominio' ? '#' : ''}${esc(f.vinculo.id)} · ${f.piezas}</span>`

function pintarLogos() {
  const d = lg.datos
  $('#lg-lista').innerHTML = d.logos.length ? `<div class="lg-grilla">${d.logos.map((l) => `<article class="lg-carta" data-lg="${esc(l.agenteId)}">
      <div class="lg-cab"><b>${esc(l.nombre)}</b><span class="tipo-chip">${esc(l.rubro)}</span>${l.nombrePropio ? '<span class="tipo-chip" title="Entró a la familia con su nombre">nombre propio</span>' : ''}</div>
      <div class="lg-fuentes">${l.fuentesEstado.length ? l.fuentesEstado.map(fuenteLogos).join('') : ''}${l.conFuente ? '' : '<span class="lg-sin">⚠ Sin fuente: lo declara al contestar</span>'}</div>
      ${l.sabe ? `<p class="lg-sabe"><small class="tenue">Sabe</small> ${esc(l.sabe)}</p>` : ''}
      ${l.noSabe ? `<p class="lg-sabe"><small class="tenue">No es suyo</small> ${esc(l.noSabe)}</p>` : ''}
      ${l.deriva.length ? `<p class="lg-sabe"><small class="tenue">Deriva a</small> ${l.deriva.map(esc).join(', ')}</p>` : ''}
      <form class="lg-preguntar" data-lg-preguntar="${esc(l.agenteId)}"><input class="campo-suelto" name="pregunta" placeholder="Una consulta de ${esc(l.rubro.toLowerCase())}…" required><button class="btn btn-chico btn-primario">Preguntar</button><button type="button" class="btn btn-chico" data-lg-editar="${esc(l.agenteId)}">Ficha</button></form>
      <div class="lg-respuesta" data-lg-resp="${esc(l.agenteId)}"></div>
    </article>`).join('')}</div>` : '<p class="tenue">Todavía no hay ningún Logos. Forjá el primero abajo.</p>'

  const forjados = new Set(d.logos.map((l) => l.rubro.toLowerCase()))
  const libres = d.plantillas.filter((p) => !forjados.has(p.rubro.toLowerCase()))
  $('#lg-forja').innerHTML = `<h3 class="tl-h">Forjar un Logos</h3>
    ${libres.length ? `<div class="chips">${libres.map((p) => `<button class="chip" data-lg-plantilla="${esc(p.rubro)}" title="${esc(p.sabe)}">+ ${esc(d.familia.regla.replace('{rubro}', p.rubro))}</button>`).join('')}</div>` : ''}
    <form class="lg-nuevo" id="lg-nuevo"><input class="campo-suelto" name="rubro" placeholder="Otro rubro (Urbanismo, Propiedad intelectual…)" required><input class="campo-suelto" name="sabe" placeholder="Qué sabe"><input class="campo-suelto" name="noSabe" placeholder="Qué no es suyo"><button class="btn btn-chico">Forjar</button></form>
    <details class="lg-propio"><summary class="tenue chico">Sumar un agente que ya existe, con su nombre propio</summary>
      <form class="lg-nuevo" id="lg-sumar"><input class="campo-suelto" name="agente" placeholder="Nombre o id del agente" required><input class="campo-suelto" name="rubro" placeholder="Su rubro" required><input class="campo-suelto" name="sabe" placeholder="Qué sabe"><button class="btn btn-chico">Sumar a Los Logos</button></form></details>`

  $$('[data-lg-plantilla]').forEach((b) => (b.onclick = () => forjarLogosDesdePantalla({ rubro: b.dataset.lgPlantilla })))
  $('#lg-nuevo').onsubmit = (ev) => { ev.preventDefault(); forjarLogosDesdePantalla(Object.fromEntries(new FormData(ev.target))) }
  $('#lg-sumar').onsubmit = (ev) => { ev.preventDefault(); forjarLogosDesdePantalla(Object.fromEntries(new FormData(ev.target))) }
  $$('[data-lg-preguntar]').forEach((f) => (f.onsubmit = (ev) => { ev.preventDefault(); preguntarLogosDesdePantalla(f.dataset.lgPreguntar, new FormData(f).get('pregunta'), f) }))
  $$('[data-lg-editar]').forEach((b) => (b.onclick = () => editarFichaLogos(b.dataset.lgEditar)))
}

async function forjarLogosDesdePantalla(cuerpo) {
  try {
    const l = await api('/logos', cuerpo)
    toast(`Forjado: ${esc(l.agente?.nombre ?? cuerpo.rubro)}<small>Asignale sus fuentes en «Ficha»: sin fuente, lo declara al contestar.</small>`, 'suave')
    await traerLogos()
    editarFichaLogos(l.agenteId)
  } catch (e) { error(e) }
}

async function preguntarLogosDesdePantalla(id, pregunta, form) {
  const caja = $(`[data-lg-resp="${id}"]`)
  const boton = form.querySelector('button')
  boton.disabled = true
  caja.innerHTML = '<p class="tenue chico">Buscando en sus fuentes…</p>'
  try {
    const r = await api(`/logos/${id}/preguntar`, { pregunta })
    const otro = r.fueraDeRubro && r.derivaA ? lg.datos.logos.find((l) => l.nombre === r.derivaA || l.rubro.toLowerCase() === String(r.derivaA).toLowerCase()) : null
    caja.innerHTML = `<div class="lg-texto md">${md(r.respuesta)}</div>
      ${r.fueraDeRubro ? `<p class="lg-deriva">↪ No es de ${esc(r.rubro)}: va a ${esc(r.derivaA ?? 'otro profesional')}${otro ? ` <button class="btn btn-chico" data-lg-deriva="${esc(otro.agenteId)}">Preguntarle</button>` : ''}</p>` : ''}
      ${r.pasajes.length ? `<p class="tenue chico">Leyó: ${r.pasajes.map((p) => `<a href="#" data-pieza="${p.id}">${esc(p.titulo)}</a>`).join(' · ')}</p>` : ''}`
    const b = caja.querySelector('[data-lg-deriva]')
    if (b) b.onclick = () => { const f = $(`[data-lg-preguntar="${b.dataset.lgDeriva}"]`); f.pregunta.value = pregunta; f.scrollIntoView({ block: 'center' }); f.requestSubmit() }
  } catch (e) { caja.innerHTML = ''; error(e) } finally { boton.disabled = false }
}

function editarFichaLogos(id) {
  const l = lg.datos.logos.find((x) => x.agenteId === id)
  if (!l) return
  const elegidas = new Set(l.fuentes.filter((f) => f.tipo === 'fuente').map((f) => f.id))
  const dominios = l.fuentes.filter((f) => f.tipo === 'dominio').map((f) => f.id).join(', ')
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <h2>${esc(l.nombre)}</h2><p class="tenue">Contesta solo desde estas fuentes de tu corpus. Sin ninguna con piezas, lo declara antes de contestar.</p>
    <form id="lg-ficha" class="lg-ficha">
      <label class="campo">Qué sabe<textarea name="sabe" rows="3">${esc(l.sabe ?? '')}</textarea></label>
      <label class="campo">Qué no es suyo<textarea name="noSabe" rows="2">${esc(l.noSabe ?? '')}</textarea></label>
      <label class="campo">Deriva a (separados por coma)<input name="deriva" value="${esc(l.deriva.join(', '))}"></label>
      <fieldset class="lg-elegir"><legend class="tenue chico">Fuentes de tu corpus</legend>
        ${lg.datos.fuentes.length ? lg.datos.fuentes.map((f) => `<label class="lg-opcion"><input type="checkbox" name="fuente" value="${esc(f.id)}" ${elegidas.has(f.id) ? 'checked' : ''}> ${esc(f.nombre)} <small class="tenue">${f.piezas}</small></label>`).join('') : '<p class="tenue chico">Tu corpus todavía no tiene fuentes.</p>'}
      </fieldset>
      <label class="campo">Bloques del corpus (etiquetas, separadas por coma)<input name="dominios" value="${esc(dominios)}" placeholder="laboral, igualdad"></label>
      <div class="fila"><button class="btn btn-primario">Guardar ficha</button></div>
    </form>`)
  $('#lg-ficha').onsubmit = async (ev) => {
    ev.preventDefault()
    const fd = new FormData(ev.target)
    const fuentes = [...fd.getAll('fuente').map((x) => ({ tipo: 'fuente', id: String(x) })), ...String(fd.get('dominios') ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => ({ tipo: 'dominio', id: x }))]
    try {
      await api(`/logos/${id}`, { sabe: fd.get('sabe'), noSabe: fd.get('noSabe'), deriva: String(fd.get('deriva') ?? '').split(',').map((x) => x.trim()).filter(Boolean), fuentes })
      cerrarModal()
      toast('Ficha guardada', 'suave')
      traerLogos()
    } catch (e) { error(e) }
  }
}
