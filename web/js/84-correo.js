'use strict'
// El correo (plan v35): tu Gmail ordenado para atender. A la izquierda la lista (lo que pide respuesta primero, con una
// línea de qué es); a la derecha el mail con su hilo y una respuesta propuesta en tu voz, que editás y queda como
// borrador en Gmail. Nunca se envía nada desde acá.

const correo = { filtro: 'responder', q: '', abierto: null, datos: null }
const URGENCIA_CORREO = { alta: 'Urgente', media: 'Esta semana', baja: 'Sin apuro' }
const quienCorreo = (de) => esc(String(de ?? '').replace(/\s*<[^>]+>\s*/, '').replace(/^"|"$/g, '') || de || '')
const cuandoCorreo = (ms) => {
  const d = new Date(ms)
  const hoy = new Date()
  return d.toDateString() === hoy.toDateString() ? d.toTimeString().slice(0, 5) : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

async function montarCorreo() {
  let g = null
  try { g = await api('/google') } catch { /* sin Google */ }
  if (!g?.conectado) {
    $('#principal').innerHTML = `<div class="vacio"><div class="gran">✉</div><h2>Conectá tu Gmail</h2><p>Deprocast ordena tu bandeja (lo que pide respuesta primero) y te propone respuestas en tu voz, que quedan como borrador en Gmail.</p><button class="btn btn-primario" id="correo-ir-perfil">Ir a Perfil → Apps conectadas</button></div>`
    $('#correo-ir-perfil').onclick = () => irA('perfil')
    return
  }
  $('#principal').innerHTML = `<div class="correo">
    <div class="correo-lista-col">
      <div class="correo-barra">
        <div class="correo-filtros" role="tablist">
          ${[['responder', 'Para responder'], ['no_leidos', 'Sin leer'], ['todo', 'Todo'], ['enviados', 'Enviados']].map(([f, n]) => `<button role="tab" data-correo-filtro="${f}" aria-selected="${f === correo.filtro}">${n}<b data-correo-n="${f}"></b></button>`).join('')}
        </div>
        <form class="correo-buscar" id="correo-buscar"><input name="q" placeholder="Buscar en Gmail (from:, subject:, …)" value="${esc(correo.q)}" autocomplete="off"></form>
        <div class="correo-acciones"><button class="btn btn-chico" id="correo-sinc" title="Traer lo nuevo de Gmail y ordenarlo">${ico('arrow-up-down')} Traer lo nuevo</button><small class="tenue" id="correo-estado"></small></div>
      </div>
      <div class="correo-lista" id="correo-lista"><p class="tenue correo-cargando">Cargando…</p></div>
    </div>
    <div class="correo-lectura" id="correo-lectura"><div class="vacio"><div class="gran">✉</div><p>Elegí un mail.</p></div></div>
  </div>`
  $$('[data-correo-filtro]').forEach((b) => (b.onclick = () => { correo.filtro = b.dataset.correoFiltro; correo.q = ''; $('#correo-buscar').q.value = ''; pintarListaCorreo() }))
  $('#correo-buscar').onsubmit = (e) => { e.preventDefault(); correo.q = e.target.q.value.trim(); pintarListaCorreo() }
  $('#correo-sinc').onclick = async (e) => {
    e.target.disabled = true
    try {
      const r = await api('/google/sincronizar', {})
      $('#correo-estado').textContent = 'ordenando…'
      const t = await api('/correo/triar', {})
      toast(`Correo al día<small>${r.nuevos} nuevos${t.triados ? ` · ${t.triados} ordenados` : ''}</small>`, 'suave')
      pintarListaCorreo()
    } catch (x) { error(x) } finally { e.target.disabled = false }
  }
  pintarListaCorreo()
}

async function pintarListaCorreo() {
  const cont = $('#correo-lista')
  if (!cont) return
  $$('[data-correo-filtro]').forEach((b) => b.setAttribute('aria-selected', String(!correo.q && b.dataset.correoFiltro === correo.filtro)))
  let d
  try { d = await api(`/correo?filtro=${correo.filtro}${correo.q ? `&q=${encodeURIComponent(correo.q)}` : ''}`) } catch (e) { cont.innerHTML = `<p class="tenue">${esc(e.message ?? e)}</p>`; return }
  correo.datos = d
  const n = (k) => (d.cuantos[k] ? String(d.cuantos[k]) : '')
  const bn = $('[data-correo-n="responder"]'); if (bn) bn.textContent = n('responder')
  const bl = $('[data-correo-n="no_leidos"]'); if (bl) bl.textContent = n('no_leidos')
  const est = $('#correo-estado'); if (est) est.textContent = d.cuantos.sin_triar ? `${d.cuantos.sin_triar} sin ordenar todavía` : ''
  if (!d.correos.length) {
    cont.innerHTML = `<div class="vacio"><p>${correo.q ? 'Nada con esa búsqueda.' : correo.filtro === 'responder' ? 'Nada esperando respuesta. 🎉' : 'Nada por acá.'}</p></div>`
    return
  }
  cont.innerHTML = d.correos.map((m) => `<button class="correo-item ${m.leido ? '' : 'no-leido'} ${m.id === correo.abierto ? 'activo' : ''}" data-correo="${esc(m.id)}">
      <span class="correo-cab"><b>${correo.filtro === 'enviados' && !correo.q ? `Para ${quienCorreo(m.para)}` : quienCorreo(m.de)}</b><small>${cuandoCorreo(m.fecha)}</small></span>
      <span class="correo-asunto">${esc(m.asunto)}</span>
      <span class="correo-linea">${m.triaje ? `${m.triaje.pide_respuesta ? `<i class="correo-urg ${m.triaje.urgencia}">${URGENCIA_CORREO[m.triaje.urgencia]}</i>` : ''}${esc(m.triaje.resumen)}` : esc(m.extracto)}</span>
    </button>`).join('')
  $$('[data-correo]', cont).forEach((b) => (b.onclick = () => abrirCorreo(b.dataset.correo)))
}

async function abrirCorreo(id) {
  correo.abierto = id
  $$('.correo-item').forEach((b) => b.classList.toggle('activo', b.dataset.correo === id))
  document.querySelector('.correo')?.classList.add('leyendo')
  const cont = $('#correo-lectura')
  cont.innerHTML = '<p class="tenue correo-cargando">Abriendo…</p>'
  let m
  try { m = await api(`/correo/${encodeURIComponent(id)}`) } catch (e) { cont.innerHTML = `<p class="tenue">${esc(e.message ?? e)}</p>`; return }
  if (correo.abierto !== id) return
  const previo = (x) => `<details class="correo-previo"><summary><b>${x.suyo ? 'Vos' : quienCorreo(x.de)}</b> · ${cuandoCorreo(x.fecha)}</summary><div class="correo-texto">${esc(x.texto)}</div></details>`
  cont.innerHTML = `<article class="correo-mail">
    <button class="btn btn-chico correo-volver" id="correo-volver">← Volver</button>
    <header><h2>${esc(m.asunto)}</h2>
      <p class="tenue">${quienCorreo(m.de)} <small>${esc((/<([^>]+)>/.exec(m.de) ?? [])[1] ?? '')}</small> · ${new Date(m.fecha).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
      ${m.triaje ? `<p class="correo-triaje">${m.triaje.pide_respuesta ? `<i class="correo-urg ${m.triaje.urgencia}">${URGENCIA_CORREO[m.triaje.urgencia]}</i>` : ''}${esc(m.triaje.resumen)}</p>` : ''}
    </header>
    ${m.hilo_previo.length ? `<div class="correo-hilo">${m.hilo_previo.map(previo).join('')}</div>` : ''}
    <div class="correo-texto">${esc(m.cuerpo || '(sin texto)')}</div>
    ${m.hilo_despues.length ? `<div class="correo-hilo">${m.hilo_despues.map(previo).join('')}</div>` : ''}
    <div class="correo-botones">
      ${m.suyo ? '' : '<button class="btn btn-primario" id="correo-proponer">✎ Proponer respuesta</button>'}
      <a class="btn" href="${esc(m.link)}" target="_blank" rel="noopener">Abrir en Gmail</a>
      ${m.suyo ? '' : `<button class="btn" id="correo-listo">${m.atendido ? 'Volver a pendientes' : '✓ Listo'}</button>`}
    </div>
    <div id="correo-respuesta"></div>
  </article>`
  $('#correo-volver').onclick = () => { document.querySelector('.correo')?.classList.remove('leyendo'); correo.abierto = null }
  if ($('#correo-listo')) $('#correo-listo').onclick = async () => {
    try { await api(`/correo/${encodeURIComponent(id)}/atendido`, { atendido: !m.atendido }); toast(m.atendido ? 'Volvió a pendientes' : 'Listo', 'suave'); pintarListaCorreo(); abrirCorreo(id) } catch (e) { error(e) }
  }
  if ($('#correo-proponer')) $('#correo-proponer').onclick = () => pintarRespuestaCorreo(id, m)
}

/** La respuesta propuesta: una indicación opcional, el texto editable y «guardar como borrador en Gmail». */
function pintarRespuestaCorreo(id, m) {
  const cont = $('#correo-respuesta')
  cont.innerHTML = `<section class="correo-resp">
    <form id="correo-ind" class="fila"><input name="indicacion" placeholder="Indicación opcional: «decile que sí pero el jueves», «más corto»…" autocomplete="off"><button class="btn btn-primario">Proponer</button></form>
    <div id="correo-borrador"></div>
  </section>`
  const proponer = async (indicacion) => {
    const b = $('#correo-borrador')
    b.innerHTML = '<p class="tenue pensando">Escribiendo en tu voz…</p>'
    try {
      const r = await api(`/correo/${encodeURIComponent(id)}/proponer`, { indicacion })
      b.innerHTML = `<textarea id="correo-texto" rows="10">${esc(r.texto)}</textarea>
        <div class="correo-botones"><button class="btn btn-primario" id="correo-guardar">Guardar como borrador en Gmail</button><button class="btn" id="correo-otra">Otra versión</button><small class="tenue">Para ${quienCorreo(m.de)} · Re: ${esc(m.asunto)}</small></div>`
      $('#correo-texto').focus()
      $('#correo-otra').onclick = () => proponer($('#correo-ind').indicacion.value)
      $('#correo-guardar').onclick = async (e) => {
        e.target.disabled = true
        try {
          await api(`/correo/${encodeURIComponent(id)}/borrador`, { texto: $('#correo-texto').value })
          toast('Borrador en Gmail<small>Revisalo y mandalo desde Gmail. Lo saqué de pendientes.</small>')
          pintarListaCorreo()
          b.innerHTML = '<p class="correo-hecho">✓ Quedó en tus Borradores de Gmail.</p>'
        } catch (x) { error(x); e.target.disabled = false }
      }
    } catch (e) { b.innerHTML = ''; error(e) }
  }
  $('#correo-ind').onsubmit = (e) => { e.preventDefault(); proponer(e.target.indicacion.value) }
  proponer('')
}
