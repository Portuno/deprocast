'use strict'
// Hoy

let hoyDatos = null
let hoyFirma = ''
let hoyScrolleado = false
const DIA_LETRA = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const minutosAhora = () => new Date().getHours() * 60 + new Date().getMinutes()
const aMinJs = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

async function montarHoy() {
  $('#principal').classList.add('lleno')
  $('#principal').innerHTML = `<div class="hoy ${pref.leer('mastro-hoy-foco', 'no') === 'si' ? 'foco' : ''}" id="hoy" style="--hoy-dia:${Number(pref.leer('mastro-hoy-ancho', '400')) || 400}px">
    <section class="chat-main hoy-chat">${hiloHTMLBase()}<button class="hoy-mostrar" id="hoy-mostrar" title="Mostrar las tareas del día">⇤ ☀ <span id="hoy-mini"></span></button></section>
    <div class="hoy-divisor" id="hoy-divisor" title="Arrastrá para repartir el espacio entre el chat y las tareas (doble clic: ocultar las tareas)"></div>
    <section class="hoy-dia" id="hoy-dia"></section></div>`
  engancharSplitHoy()
  engancharCompositor()
  hoyScrolleado = false
  await traerHoy()
  await traerConversaciones()
  if (hoyDatos) await abrirConversacion(hoyDatos.conversacion)
}

/** El día y el chat comparten la pantalla: el divisor se arrastra (y se recuerda); el día se puede ocultar entero. */
function engancharSplitHoy() {
  const hoy = $('#hoy')
  const div = $('#hoy-divisor')
  const foco = (si) => {
    hoy.classList.toggle('foco', si)
    pref.guardar('mastro-hoy-foco', si ? 'si' : 'no')
    pintarMiniHoy()
  }
  $('#hoy-mostrar').onclick = () => foco(false)
  div.ondblclick = () => foco(true)
  div.onpointerdown = (e) => {
    e.preventDefault()
    div.setPointerCapture(e.pointerId)
    const x1 = hoy.getBoundingClientRect().right
    const mover = (ev) => {
      const ancho = Math.round(Math.min(Math.max(x1 - ev.clientX, 260), hoy.clientWidth * 0.7))
      hoy.style.setProperty('--hoy-dia', `${ancho}px`)
    }
    div.onpointermove = mover
    div.onpointerup = () => {
      div.onpointermove = null
      pref.guardar('mastro-hoy-ancho', parseInt(hoy.style.getPropertyValue('--hoy-dia')) || 400)
    }
  }
  window.ocultarDia = () => foco(true)
}

/** Con el día oculto, una pastilla dice qué banda toca. */
function pintarMiniHoy() {
  const mini = $('#hoy-mini')
  if (!mini || !hoyDatos) return
  const run = hoyDatos.run
  const actual = run?.misiones?.find((m) => m.id === hoyDatos.actual)
  mini.textContent = actual ? `${actual.inicio}–${actual.fin} · ${actual.titulo}` : run?.estado === 'en_curso' ? `Run ${run.inicio}–${run.fin}` : run?.estado === 'propuesta' ? `Run propuesta ${run.inicio}–${run.fin}` : 'El día'
}

function refrescarHoy() {
  const f = JSON.stringify(E.hoy)
  // Mientras escribís en el panel del día (una respuesta, una nota), no se redibuja: se pondría al día después.
  const escribiendo = document.activeElement?.closest?.('#hoy-dia') && /INPUT|TEXTAREA/.test(document.activeElement.tagName)
  if (f !== hoyFirma && !escribiendo) { hoyFirma = f; traerHoy() }
}

async function traerHoy() {
  try {
    hoyDatos = await api('/hoy')
    hoyFirma = JSON.stringify(E.hoy)
    pintarHoy()
  } catch (e) { error(e) }
}

function pintarHoy() {
  const cont = $('#hoy-dia')
  if (!cont || !hoyDatos) return
  const { fecha, jornada: j, progreso: p, semana, run, calendarios } = hoyDatos
  const fechaTxt = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const barras = semana.map((d) => {
    const dia = new Date(`${d.fecha}T12:00:00`)
    return `<div class="sem-dia ${d.fecha === fecha ? 'hoy' : ''}" title="${dia.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' })}: ${d.hechos} de ${d.total} bandas">
      <span><i style="height:${d.total ? Math.round((d.hechos / d.total) * 100) : 0}%"></i></span><small>${DIA_LETRA[dia.getDay()]}</small></div>`
  }).join('')
  const avisoNotif = 'Notification' in window && Notification.permission === 'default'
  cont.innerHTML = `
    <header class="hoy-cab">
      <div><small>Hoy</small><h1>${esc(fechaTxt)}</h1>
        <p class="tenue">${p.total ? `${p.hechos} de ${p.total} bandas${p.parciales ? ` · ${p.parciales} a medias` : ''}` : 'Todavía sin bandas trabajadas'}</p></div>
      <div class="semana" title="Bandas hechas por día">${barras}</div>
    </header>
    <div class="fila hoy-acciones">
      <button class="btn btn-chico btn-icono" id="hoy-ajustes" title="Rutinas, plantillas y tope de gasto">⚙</button>
      <button class="btn btn-chico" id="hoy-ocultar" title="Ocultar las tareas: el chat ocupa toda la pantalla">Ocultar tareas ⇥</button>
      ${avisoNotif ? '<button class="btn btn-chico" id="hoy-notif">Activar avisos</button>' : ''}
    </div>
    <div id="pregunta-caja"></div>
    ${run?.estado === 'en_curso' ? runEnCursoHTML(run) : run?.estado === 'propuesta' ? runPropuestaHTML(run) : sinRunHTML()}
    ${hoyDatos.proximas?.length ? `<section class="hoy-semana"><h3 class="sub">Próximas runs</h3>${hoyDatos.proximas.map((r) => `<details class="run-pasada"><summary><b>${esc(new Date(`${r.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }))}</b> ${r.inicio}–${r.fin} · ${r.misiones.length} bandas · propuesta</summary>
      ${r.resumen ? `<p class="hoy-resumen">${esc(r.resumen)}</p>` : ''}<ol class="bandas">${r.misiones.map((m) => bandaHTML(m, { propuesta: true })).join('')}</ol>
      <p class="tenue chico">Ese día aparece en Hoy para arrancarla (o rehacerla).</p></details>`).join('')}</section>` : ''}
    <section class="hoy-semana" id="gemelo-caja"></section>
    ${semanaHoyHTML()}
    ${j?.cierre ? `<div class="hoy-cierre"><small>Tu cierre</small><p>${esc(j.cierre)}</p></div>` : ''}
    ${calendarios ? '' : `<p class="hoy-nota">Para que tenga en cuenta tu agenda: en Google Calendar, Configuración del calendario → «Dirección secreta en formato iCal», y pegala en <code>.env</code> como <code>GCAL_ICS_URLS</code>.</p>`}`
  $('#hoy-ajustes').onclick = modalAjustesHoy
  $('#hoy-ocultar').onclick = () => window.ocultarDia?.()
  pintarMiniHoy()
  const nb = $('#hoy-notif')
  if (nb) nb.onclick = async () => { await Notification.requestPermission(); pintarHoy() }
  engancharRun(cont, run)
  engancharSemanaHoy(cont)
  traerPregunta()
  traerGemelo()
  if (!hoyScrolleado) {
    hoyScrolleado = true
    $('.banda.ahora', cont)?.scrollIntoView({ block: 'center' })
  }
}

const MARCA = { hecha: '✓', parcial: '◐', no: '✗' }
let cuentaRegresiva = null

function bandaHTML(m, { propuesta = false, actual = null } = {}) {
  const ahora = minutosAhora()
  const clase = [m.estado, m.id === actual ? 'ahora' : '', !propuesta && aMinJs(m.fin) <= ahora && m.estado === 'activa' ? 'pasado' : '', m.fijada ? 'fijada' : ''].join(' ')
  return `<li class="banda ${clase}" data-mid="${m.id}">
    <span class="b-hora">${m.inicio}<small>${m.minutos}′</small></span>
    <div class="b-cuerpo"><b>${esc(m.titulo)}</b>${m.detalle ? `<small>${esc(m.detalle)}</small>` : ''}
      ${m.feedback ? `<small class="b-nota">“${esc(m.feedback)}”</small>` : ''}
      ${[m.categoria, m.con && `con ${m.con}`, m.gasto != null && `${m.gasto}`].filter(Boolean).map((x) => `<em>${esc(x)}</em>`).join('')}</div>
    ${propuesta
      ? `<span class="b-acc"><button data-fijar title="${m.fijada ? 'Soltar' : 'Fijar: rehacer la conserva'}" class="${m.fijada ? 'on' : ''}">★</button></span>`
      : `<span class="b-acc">${Object.entries(MARCA).map(([e, g]) => `<button data-marcar="${e}" title="${e === 'parcial' ? 'A medias' : e === 'no' ? 'No salió' : 'Hecha'}" class="${m.estado === e ? 'on' : ''}">${g}</button>`).join('')}<button data-nota title="Nota">✎</button></span>`}
  </li>`
}

function runEnCursoHTML(run) {
  const ms = run.misiones
  const actual = ms.find((m) => m.id === hoyDatos.actual)
  const marcadas = ms.filter((m) => m.estado !== 'activa').length
  const hechas = ms.filter((m) => m.estado === 'hecha').length
  return `<section class="run en-curso">
    <div class="run-cab"><small>Run · ${run.inicio}–${run.fin}</small><span>${hechas} de ${ms.length} hechas</span></div>
    <div class="run-barra"><i style="width:${ms.length ? Math.round((marcadas / ms.length) * 100) : 0}%"></i></div>
    ${actual ? `<div class="mision-actual" data-mid="${actual.id}">
        <div class="ma-top"><span>${actual.inicio}–${actual.fin}</span><span class="ma-cuenta" id="ma-cuenta" data-fin="${actual.fin}"></span></div>
        <h2>${esc(actual.titulo)}</h2>
        ${actual.detalle ? `<p>${esc(actual.detalle)}</p>` : ''}
        <div class="ma-acc">
          <button class="btn ${actual.estado === 'hecha' ? 'btn-primario' : ''}" data-marcar="hecha">✓ Hecha</button>
          <button class="btn ${actual.estado === 'parcial' ? 'btn-primario' : ''}" data-marcar="parcial">◐ A medias</button>
          <button class="btn ${actual.estado === 'no' ? 'btn-primario' : ''}" data-marcar="no">✗ No salió</button>
        </div>
        <input class="campo-suelto" id="ma-nota" placeholder="Una nota para calibrar (qué trabó, qué funcionó)…" value="${esc(actual.feedback ?? '')}">
      </div>`
      : `<div class="mision-actual entre"><p class="tenue">${minutosAhora() < aMinJs(run.inicio) ? `Arranca a las ${run.inicio}.` : 'Entre bandas. Respirá.'}</p></div>`}
    <ol class="bandas">${ms.map((m) => bandaHTML(m, { actual: actual?.id })).join('')}</ol>
    <div class="fila run-pie">
      <button class="btn btn-chico" id="run-rehacer">Rehacer lo que sigue</button>
      <button class="btn btn-chico" id="run-cerrar">Cerrar la run</button>
    </div>
  </section>`
}

function runPropuestaHTML(run) {
  const ms = run.misiones
  return `<section class="run propuesta">
    <div class="run-cab"><small>Run propuesta · ${run.inicio}–${run.fin}</small><span>${ms.length} misiones</span></div>
    ${run.resumen ? `<p class="hoy-resumen">${esc(run.resumen)}</p>` : ''}
    ${run.agentes?.length ? `<p class="run-agentes">La armó Mastropiero con ${run.agentes.map((a) => `<a href="#" data-ver-agente="${esc(a.id)}">${esc(a.nombre)}</a>${a.ok ? '' : ' (no pudo)'}`).join(', ')}.</p>` : ''}
    ${run.fijos?.length ? `<p class="run-agentes">Respeta tu agenda: ${run.fijos.map((f) => `${f.inicio} ${esc(f.titulo)}`).join(' · ')}.</p>` : ''}
    <ol class="bandas">${ms.map((m) => bandaHTML(m, { propuesta: true })).join('')}</ol>
    <div class="run-iterar">
      <input class="campo-suelto" id="run-cambio" placeholder="¿Algo para cambiar? «más corta», «sacá lo de X», «más creativas»…">
      <button class="btn" id="run-rehacer">Rehacer</button>
    </div>
    <div class="fila run-pie">
      <button class="btn btn-primario" id="run-arrancar">▶ Arrancar</button>
      <button class="btn btn-chico" id="run-descartar">Descartar</button>
      <button class="btn btn-chico" id="run-plantilla" title="Guardar este pedido para reusarlo">Guardar pedido como plantilla</button>
    </div>
  </section>`
}

function sinRunHTML() {
  return `<section class="run vacia">
    <h2>¿Arrancamos una run?</h2>
    <p class="tenue">La diseñás vos: cuánto tiempo, cómo estás, qué querés meter y cómo querés ver las tareas. Mastropiero arma las misiones.</p>
    <div class="fila">
      <button class="btn btn-primario" id="run-nueva">Nueva run</button>
      ${hoyDatos.plantillas.map((p) => `<button class="chip" data-plantilla="${p.id}" title="Armar con esta plantilla, sin más">${esc(p.nombre)}</button>`).join('')}
    </div>
  </section>`
}

function semanaHoyHTML() {
  const { primarias, principal, terciarias, seguimientos, reporte } = hoyDatos
  const activas = primarias.filter((m) => m.estado !== 'sugerida')
  const sugeridas = primarias.filter((m) => m.estado === 'sugerida')
  return `<section class="hoy-semana">
    ${principal ? `<p class="principal-linea" title="Tu misión principal">◎ ${esc(principal.titulo)}</p>` : ''}
    <h3 class="sub">Primarias de la semana <a href="#" class="ref" data-ir="misiones">ver todo</a></h3>
    ${activas.length ? `<div class="prim-mini">${activas.map((m) => `<div class="pm ${m.estado}">
        <span>${esc(m.titulo)}</span><i class="barrita"><b style="width:${m.avance.progreso}%"></b></i><small>${m.avance.bandas.hechas ? `${m.avance.bandas.hechas} bandas` : ''}</small></div>`).join('')}</div>`
      : `<p class="tenue chico">${sugeridas.length ? `Mastropiero te sugirió ${sugeridas.length}: aceptalas en <a href="#" class="ref" data-ir="misiones">Misiones</a>.` : 'Sin primarias esta semana. <a href="#" class="ref" data-ir="misiones">Proponer</a>'}</p>`}
    ${terciarias.filter((m) => m.estado === 'activa').length ? `<h3 class="sub">Side quests</h3>${terciarias.filter((m) => m.estado === 'activa').map((m) => `<div class="sq" data-mid="${m.id}">
        <span>⚑ ${esc(m.titulo)}${m.disparador ? `<small>${esc(Object.values(m.disparador).filter(Boolean).join(' · '))}</small>` : ''}</span>
        <button class="btn btn-chico" data-sq-hecha title="Cumplida">✓</button></div>`).join('')}` : ''}
    ${seguimientos.length ? `<h3 class="sub">Te deben</h3>${seguimientos.map((m) => `<div class="sq"><span>↻ <b>${esc(m.quien)}</b>: ${esc(m.titulo)}<small>vencía ${esc(m.vence)}</small></span></div>`).join('')}` : ''}
    ${hoyDatos.aportes?.length ? `<h3 class="sub">De tus ayudantes</h3>${hoyDatos.aportes.map((a) => `<div class="sq"><span><a href="#" data-pieza="${a.id}">${esc(a.titulo.split(' · ').slice(1).join(' · ') || a.titulo)}</a><small>${esc(a.autor ?? a.agente)} · ${haceCuanto(a.en)}</small></span></div>`).join('')}` : ''}
    ${reporte && reporte.tipo !== 'hora' ? `<details class="hoy-reporte"><summary>Último reporte (${reporte.tipo === 'run' ? 'run' : 'semana'})</summary><div class="md">${md(reporte.texto)}</div></details>` : ''}
  </section>`
}

// El gemelo: lo que predijo del día (sellado), cómo le fue y cuánto te conoce

async function traerGemelo() {
  const caja = $('#gemelo-caja')
  if (!caja) return
  try {
    const g = await api('/gemelo')
    const pend = [...g.ayer, ...g.predicciones].filter((p) => p.estado === 'para_el_jugador')
    const pts = g.curva.puntos.filter((p) => p.conocimiento != null)
    const spark = pts.length > 1 ? `<svg class="spark" viewBox="0 0 ${(pts.length - 1) * 10} 30" preserveAspectRatio="none"><polyline points="${pts.map((p, i) => `${i * 10},${30 - (p.conocimiento / 100) * 28 - 1}`).join(' ')}"/></svg>` : ''
    const pred = (p, conMarcas) => `<div class="pred ${p.resultado === 1 ? 'si' : p.resultado === 0 ? 'no' : ''}" data-pred="${p.id}">
      <span class="prob">${Math.round(p.probabilidad * 100)}%</span><span>${esc(p.texto)}${p.nota ? `<small>${esc(p.nota)}</small>` : ''}</span>
      ${conMarcas ? '<span class="fila"><button class="btn btn-chico" data-paso="1" title="Pasó">✓</button><button class="btn btn-chico" data-paso="0" title="No pasó">✗</button></span>' : p.resultado != null ? `<span class="res">${p.resultado ? '✓' : '✗'}</span>` : ''}</div>`
    caja.innerHTML = `<h3 class="sub">El gemelo ${g.curva.total != null ? `<span class="conozco">te conozco ${g.curva.total}%</span>` : ''}</h3>
      ${spark}
      ${pend.length ? `<p class="tenue chico">No puedo saber solo si pasaron: ¿sí o no?</p>${pend.map((p) => pred(p, true)).join('')}` : ''}
      ${g.predicciones.length ? `<details class="sellado"><summary>${g.predicciones.length} predicciones para hoy ${g.predicciones.every((p) => p.estado === 'abierta') ? '(selladas: abrilas solo si querés)' : ''}</summary>${g.predicciones.filter((p) => p.estado !== 'para_el_jugador').map((p) => pred(p, false)).join('')}</details>`
        : '<p class="tenue chico">Todavía no predije hoy. <a href="#" class="ref" id="gemelo-predecir">Predecí mi día</a></p>'}`
    $$('[data-paso]', caja).forEach((b) => (b.onclick = async () => {
      try { await api(`/gemelo/${b.closest('[data-pred]').dataset.pred}`, { paso: b.dataset.paso === '1' }); traerGemelo() } catch (e) { error(e) }
    }))
    const pr = $('#gemelo-predecir', caja)
    if (pr) pr.onclick = (e) => { e.preventDefault(); trabajando(null, '', async () => { await api('/gemelo/predecir', {}); toast('Predicciones selladas<small>A la noche me califico.</small>', 'suave'); traerGemelo() }) }
  } catch { caja.innerHTML = '' }
}

// Mastropiero pregunta: una por vez, se contesta con un toque o una línea

let preguntaActual = null
async function traerPregunta() {
  const caja = $('#pregunta-caja')
  if (!caja) return
  try {
    const r = await api('/preguntas/siguiente')
    preguntaActual = r.pregunta
    pintarPregunta(r)
  } catch { caja.innerHTML = '' }
}

function pintarPregunta(r) {
  const caja = $('#pregunta-caja')
  if (!caja) return
  const p = r.pregunta
  if (!p) {
    caja.innerHTML = r.generando ? '<div class="pregunta vacia"><small>Mastropiero pregunta</small><p class="tenue">Pensando qué preguntarte…</p></div>' : ''
    if (r.generando) setTimeout(() => vista === 'hoy' && traerPregunta(), 6000)
    return
  }
  caja.innerHTML = `<div class="pregunta" data-pregunta="${p.id}">
    <small>Mastropiero pregunta${r.respondidas ? ` · ${r.respondidas} respondidas` : ''}</small>
    <p class="p-texto">${esc(p.texto)}</p>
    ${p.porQue ? `<p class="p-porque">${esc(p.porQue)}</p>` : ''}
    ${p.tipo === 'opciones' ? `<div class="chips">${p.opciones.map((o) => `<button class="chip" data-opcion="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
    <div class="fila p-resp">
      <input class="campo-suelto" id="p-resp" ${p.tipo === 'numero' ? 'inputmode="decimal"' : ''} placeholder="${p.tipo === 'opciones' ? 'O escribí otra cosa…' : 'Tu respuesta…'}">
      <button class="btn btn-chico btn-primario" id="p-enviar">Responder</button>
      <button class="btn btn-chico" id="p-saltar" title="Ahora no">Saltear</button>
    </div>
  </div>`
  const responder = async (respuesta) => {
    try {
      const r2 = await api(`/preguntas/${p.id}`, { respuesta })
      if (respuesta) toast('Anotado<small>Lo guardo en lo que sé de vos.</small>', 'suave')
      pintarPregunta({ pregunta: r2.siguiente, generando: !r2.siguiente, respondidas: (r.respondidas ?? 0) + (respuesta ? 1 : 0) })
    } catch (e) { error(e) }
  }
  $$('[data-opcion]', caja).forEach((b) => (b.onclick = () => responder(b.dataset.opcion)))
  $('#p-enviar').onclick = () => { const v = $('#p-resp').value.trim(); if (v) responder(v) }
  $('#p-resp').onkeydown = (e) => { if (e.key === 'Enter' && $('#p-resp').value.trim()) responder($('#p-resp').value.trim()) }
  $('#p-saltar').onclick = () => responder(null)
}

function engancharSemanaHoy(cont) {
  $$('[data-ir]', cont).forEach((a) => (a.onclick = (e) => { e.preventDefault(); irA(a.dataset.ir) }))
  $$('[data-sq-hecha]', cont).forEach((b) => (b.onclick = async () => {
    try { await api(`/misiones/${b.closest('[data-mid]').dataset.mid}`, { estado: 'hecha' }); toast('Side quest cumplida', 'suave'); await traerHoy() } catch (e) { error(e) }
  }))
}

async function trabajando(boton, texto, f) {
  const antes = boton?.textContent
  if (boton) { boton.disabled = true; boton.textContent = texto }
  document.body.classList.add('jugando')
  try { return await f() } catch (e) { error(e) } finally {
    document.body.classList.remove('jugando')
    if (boton && document.body.contains(boton)) { boton.disabled = false; boton.textContent = antes }
  }
}

function engancharRun(cont, run) {
  clearInterval(cuentaRegresiva)
  const nueva = $('#run-nueva', cont)
  if (nueva) nueva.onclick = () => modalRun()
  $$('[data-plantilla]', cont).forEach((b) => (b.onclick = () => trabajando(b, 'Armando…', async () => {
    const r = await api('/runs/preparar', { pedido: { plantilla: Number(b.dataset.plantilla) } })
    if (r.avisos?.length) toast(esc(r.avisos.join(' ')), 'suave')
    await traerHoy()
  })))
  if (!run) return
  const marcar = async (id, estado, nota) => {
    try {
      await api(`/misiones/${id}/marcar`, { estado, nota: nota ?? null })
      await refrescar()
      await traerHoy()
    } catch (e) { error(e) }
  }
  $$('.banda [data-marcar]', cont).forEach((b) => (b.onclick = () => {
    const m = run.misiones.find((x) => x.id === Number(b.closest('[data-mid]').dataset.mid))
    marcar(m.id, m.estado === b.dataset.marcar ? 'activa' : b.dataset.marcar)
  }))
  $$('.banda [data-nota]', cont).forEach((b) => (b.onclick = () => {
    const m = run.misiones.find((x) => x.id === Number(b.closest('[data-mid]').dataset.mid))
    const nota = prompt(`Nota sobre «${m.titulo}» (para calibrar):`)
    if (nota?.trim()) marcar(m.id, m.estado === 'activa' ? 'parcial' : m.estado, nota.trim())
  }))
  $$('.banda [data-fijar]', cont).forEach((b) => (b.onclick = async () => {
    const m = run.misiones.find((x) => x.id === Number(b.closest('[data-mid]').dataset.mid))
    try { await api(`/misiones/${m.id}`, { fijada: !m.fijada }); await traerHoy() } catch (e) { error(e) }
  }))
  const ma = $('.mision-actual[data-mid]', cont)
  if (ma) {
    $$('[data-marcar]', ma).forEach((b) => (b.onclick = () => marcar(Number(ma.dataset.mid), b.dataset.marcar, $('#ma-nota').value.trim() || null)))
    const reloj = $('#ma-cuenta')
    const tic = () => {
      const [h, mi] = reloj.dataset.fin.split(':').map(Number)
      const fin = new Date()
      fin.setHours(h, mi, 0, 0)
      const s = Math.round((fin - Date.now()) / 1000)
      if (s <= 0) { clearInterval(cuentaRegresiva); traerHoy(); return }
      reloj.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }
    tic()
    cuentaRegresiva = setInterval(tic, 1000)
  }
  const rehacer = $('#run-rehacer', cont)
  if (rehacer) rehacer.onclick = () => {
    const cambio = run.estado === 'propuesta' ? $('#run-cambio').value.trim() : prompt('¿Qué cambio querés en lo que sigue? (vacío = rearmar igual)')
    if (cambio === null) return
    trabajando(rehacer, 'Rehaciendo…', async () => { await api(`/runs/${run.id}/rehacer`, { cambio }); await traerHoy() })
  }
  const cambio = $('#run-cambio', cont)
  if (cambio) cambio.onkeydown = (e) => e.key === 'Enter' && rehacer.click()
  const arrancar = $('#run-arrancar', cont)
  if (arrancar) arrancar.onclick = () => trabajando(arrancar, 'Arrancando…', async () => { await api(`/runs/${run.id}/arrancar`, {}); hoyScrolleado = false; await refrescar(); await traerHoy() })
  const descartar = $('#run-descartar', cont)
  if (descartar) descartar.onclick = async () => { try { await api(`/runs/${run.id}/descartar`, {}); await traerHoy() } catch (e) { error(e) } }
  const cerrar = $('#run-cerrar', cont)
  if (cerrar) cerrar.onclick = () => {
    if (!confirm('¿Cerrar la run? Escribo el reporte con lo que marcaste.')) return
    trabajando(cerrar, 'Escribiendo el reporte…', async () => {
      const r = await api(`/runs/${run.id}/cerrar`, {})
      abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Reporte de la run</h2><div class="md">${md(r.texto)}</div>`)
      await refrescar()
      await traerHoy()
    })
  }
  const plantilla = $('#run-plantilla', cont)
  if (plantilla) plantilla.onclick = async () => {
    const nombre = prompt('Nombre de la plantilla (ej. «Tarde creativa»):', run.pedido.plantillaNombre && run.pedido.texto ? '' : run.pedido.plantillaNombre ?? '')
    if (!nombre?.trim()) return
    const { incluir, plantillaNombre, inicio, fin, ...pedido } = run.pedido
    try { await api('/plantillas', { nombre: nombre.trim(), pedido: { ...pedido, incluir: (incluir ?? []).map((e) => e.id) } }); toast(`Plantilla «${esc(nombre.trim())}» guardada`, 'suave'); await traerHoy() } catch (e) { error(e) }
  }
}

// ─── Nueva run ──────────────────────────────────────────────────────────

function modalRun(pre = {}) {
  const ps = hoyDatos?.plantillas ?? []
  const estado = { plantilla: pre.plantilla ?? ps[0]?.id ?? null, incluir: [], intensidad: null }
  const base = () => ps.find((p) => p.id === estado.plantilla)?.pedido ?? {}
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <h2>Nueva run</h2>
    <p class="tenue">Escribile como quieras: tiempo, energía, plata, qué meter, cómo querés ver las tareas. Lo que digas manda sobre la plantilla.</p>
    <div class="chips" id="r-plantillas">${ps.map((p) => `<button class="chip" data-p="${p.id}">${esc(p.nombre)}</button>`).join('')}</div>
    <p class="tenue chico" id="r-base"></p>
    <label class="campo">Tu pedido<textarea id="r-texto" rows="4" placeholder="Tengo dos horas y la cabeza a medias. 20 € para gastar. Quiero avanzar con el proyecto X y escribirle a Y. Bandas de 25 con una pausa en el medio."></textarea></label>
    <details class="r-mano"><summary>Ajustar a mano</summary>
      <div class="form-ing">
        <label class="campo">Duración (minutos)<input id="r-dur" type="number" min="10" step="5"></label>
        <label class="campo">Bandas (minutos)<input id="r-banda" placeholder="12 · 12,25 · libre"></label>
        <label class="campo">Cantidad<input id="r-cant" type="number" min="1" max="60"></label>
        <label class="campo">Plata para gastar<input id="r-dinero" type="number" min="0" step="1"></label>
        <div class="campo campo-ancho">Intensidad mental<div class="chips r-int">${[1, 2, 3, 4, 5].map((n) => `<button class="chip" data-int="${n}" title="${['cabeza apagada', 'liviana', 'normal', 'enfocada', 'modo profundo'][n - 1]}">${n}</button>`).join('')}</div></div>
        <label class="campo">Cómo estás<input id="r-energia" placeholder="cansado, disperso, a mil…"></label>
        <label class="campo">Recursos y contexto<input id="r-recursos" placeholder="en la oficina, sin poder llamar, con la notebook…"></label>
        <label class="campo">Excluir<input id="r-excluir" placeholder="mails, reuniones…"></label>
        <label class="campo">Formato<input id="r-formato" placeholder="verbos al principio, con pausas…"></label>
        <label class="campo campo-ancho">Meter proyectos o personas<input id="r-incluir-q" placeholder="Buscá una entidad, o escribí un nombre nuevo…" autocomplete="off"></label>
        <div class="campo-ancho"><div class="r-sugerencias" id="r-sug"></div><div class="tags" id="r-incluidos"></div></div>
        <label class="campo fila" style="gap:6px"><input id="r-sub" type="checkbox" checked> Con subdescripción</label>
      </div>
    </details>
    <div class="fila" style="margin-top:14px">
      <button class="btn btn-primario" id="r-armar">Armar</button>
      <button class="btn btn-chico" id="r-guardar">Guardar como plantilla</button>
    </div>`)
  const pintarBase = () => {
    $$('#r-plantillas [data-p]').forEach((b) => b.classList.toggle('on', Number(b.dataset.p) === estado.plantilla))
    const b = base()
    $('#r-base').textContent = `Base: ${b.duracion ?? 180} min${b.banda?.length ? ` en bandas de ${b.banda.join(' o ')}` : ', bandas libres'}${b.cantidad ? ` · ${b.cantidad} misiones` : ''}${b.subdescripcion === false ? ' · sin subdescripción' : ''}.`
  }
  $$('#r-plantillas [data-p]').forEach((b) => (b.onclick = () => { estado.plantilla = Number(b.dataset.p); pintarBase() }))
  $$('[data-int]').forEach((b) => (b.onclick = () => {
    estado.intensidad = estado.intensidad === Number(b.dataset.int) ? null : Number(b.dataset.int)
    $$('[data-int]').forEach((x) => x.classList.toggle('on', Number(x.dataset.int) === estado.intensidad))
  }))
  const pintarIncluidos = () => {
    $('#r-incluidos').innerHTML = estado.incluir.map((e, i) => `<span>${esc(e.nombre)}${e.nuevo ? ` <small>(${e.nuevo})</small>` : ''} <a href="#" data-sacar="${i}">✕</a></span>`).join('')
    $$('[data-sacar]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); estado.incluir.splice(Number(a.dataset.sacar), 1); pintarIncluidos() }))
  }
  let espera
  $('#r-incluir-q').oninput = (ev) => {
    clearTimeout(espera)
    const q = ev.target.value.trim()
    if (!q) return void ($('#r-sug').innerHTML = '')
    espera = setTimeout(async () => {
      try {
        const r = await api(`/entidades?${new URLSearchParams({ q, limite: 6 })}`)
        $('#r-sug').innerHTML = r.entidades.map((e) => `<button class="chip" data-ent-id="${e.id}" data-ent-nombre="${esc(e.nombre)}">${TIPO_ENT[e.tipo]?.glifo ?? ''} ${esc(e.nombre)}</button>`).join('') +
          ['proyecto', 'persona'].map((t) => `<button class="chip" data-ent-nuevo="${t}">+ «${esc(q)}» como ${t}</button>`).join('')
        $$('[data-ent-id]').forEach((b) => (b.onclick = () => { estado.incluir.push({ id: Number(b.dataset.entId), nombre: b.dataset.entNombre }); $('#r-incluir-q').value = ''; $('#r-sug').innerHTML = ''; pintarIncluidos() }))
        $$('[data-ent-nuevo]').forEach((b) => (b.onclick = () => { estado.incluir.push({ nombre: q, nuevo: b.dataset.entNuevo }); $('#r-incluir-q').value = ''; $('#r-sug').innerHTML = ''; pintarIncluidos() }))
      } catch (e) { error(e) }
    }, 220)
  }
  const pedido = () => {
    const p = { plantilla: estado.plantilla, texto: $('#r-texto').value.trim() || null }
    const n = (sel) => ($(sel).value === '' ? null : Number($(sel).value))
    if (n('#r-dur')) p.duracion = n('#r-dur')
    const banda = $('#r-banda').value.trim().toLowerCase()
    if (banda === 'libre') p.libre = true
    else if (banda) p.banda = banda.split(/[,\s]+/).map(Number).filter((x) => x > 0)
    if (n('#r-cant')) p.cantidad = n('#r-cant')
    if (n('#r-dinero') != null) p.dinero = n('#r-dinero')
    if (estado.intensidad) p.intensidad = estado.intensidad
    for (const [k, sel] of [['energia', '#r-energia'], ['recursos', '#r-recursos'], ['excluir', '#r-excluir'], ['formato', '#r-formato']]) if ($(sel).value.trim()) p[k] = $(sel).value.trim()
    if (estado.incluir.length) p.incluir = estado.incluir.map((e) => (e.id ? e.id : `${e.nuevo}:${e.nombre}`))
    if (!$('#r-sub').checked) p.subdescripcion = false
    return p
  }
  $('#r-armar').onclick = () => trabajando($('#r-armar'), 'Armando…', async () => {
    // Mientras espera, el botón dice en qué paso va.
    const reloj = setInterval(async () => {
      try { const p = await api('/runs/preparando'); const b = $('#r-armar'); if (p && b) b.textContent = `${p.paso[0].toUpperCase()}${p.paso.slice(1)}…` } catch { /* sigue */ }
    }, 1200)
    let r
    try { r = await api('/runs/preparar', { pedido: pedido() }) } finally { clearInterval(reloj) }
    cerrarModal()
    if (r.avisos?.length) toast(esc(r.avisos.join(' ')), 'suave')
    if (r.run.agentes?.length) toast(`La armé con ${esc(r.run.agentes.map((a) => a.nombre).join(', '))}`, 'suave')
    if (vista !== 'hoy') irA('hoy')
    else await traerHoy()
  })
  $('#r-guardar').onclick = async () => {
    const nombre = prompt('Nombre de la plantilla:')
    if (!nombre?.trim()) return
    const { texto, plantilla, ...resto } = pedido()
    try {
      await api('/plantillas', { nombre: nombre.trim(), pedido: { ...base(), ...resto } })
      toast(`Plantilla «${esc(nombre.trim())}» guardada`, 'suave')
      hoyDatos = await api('/hoy')
    } catch (e) { error(e) }
  }
  pintarBase()
  $('#r-texto').focus()
}

function modalAjustesHoy() {
  const r = hoyDatos.rutinas
  const ps = hoyDatos.plantillas
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Tu día</h2>
    <p class="tenue">A qué hora hace Mastropiero cada cosa solo, cuántas primarias te propone por semana y cuánto puede gastar la liga por día (lo que le pedís vos no se frena).</p>
    <div class="form-ing"><label class="campo">Primarias por semana<input id="aj-prim" type="number" min="1" max="12" value="${esc(hoyDatos.ajustes.primarias_semana ?? 6)}"></label>
      <label class="campo">Tope diario de la liga (tokens, 0 = sin tope)<input id="aj-tope" type="number" min="0" step="100000" value="${esc(hoyDatos.ajustes.tokens_dia_max ?? 1000000)}"></label>
      <label class="campo">Mastropiero piensa solo cada (horas, 0 = nunca)<input id="aj-pensar" type="number" min="0" max="24" value="${esc(hoyDatos.ajustes.pensar_cada_horas ?? 3)}"></label></div>
    <h3 class="sub">Rutinas</h3>
    ${r.map((x) => `<div class="fila" style="margin:6px 0"><label class="fila" style="gap:6px;min-width:260px"><input type="checkbox" data-rut-activa="${x.id}" ${x.activa ? 'checked' : ''}> ${esc(x.nombre)}</label>
      <input class="campo-suelto" type="time" data-rut-hora="${x.id}" value="${esc(x.hora)}" style="width:120px;margin:0"><small class="tenue">${x.dias === '0123456' ? 'todos los días' : x.dias.split('').map((d) => ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d]).join(', ')}</small></div>`).join('')}
    <h3 class="sub">Plantillas de run</h3>
    ${ps.map((p) => `<div class="fila" style="margin:4px 0"><span style="min-width:200px">${esc(p.nombre)}</span><small class="tenue">${esc(JSON.stringify(p.pedido))}</small>${p.sistema ? '' : `<button class="btn btn-chico btn-peligro" data-borrar-p="${p.id}">Borrar</button>`}</div>`).join('')}
    <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="aj-guardar">Guardar</button></div>`)
  $$('[data-borrar-p]').forEach((b) => (b.onclick = async () => {
    try { await api(`/plantillas/${b.dataset.borrarP}/borrar`, {}); await traerHoy(); modalAjustesHoy() } catch (e) { error(e) }
  }))
  $('#aj-guardar').onclick = async () => {
    try {
      await api('/ajustes', { primarias_semana: $('#aj-prim').value, tokens_dia_max: $('#aj-tope').value, pensar_cada_horas: $('#aj-pensar').value })
      for (const x of r) await api(`/rutinas/${x.id}`, { hora: $(`[data-rut-hora="${x.id}"]`).value, activa: $(`[data-rut-activa="${x.id}"]`).checked })
      cerrarModal()
      toast('Guardado', 'suave')
      await traerHoy()
    } catch (e) { error(e) }
  }
}
