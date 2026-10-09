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
  const escribiendo = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.closest('#hoy-dia, #modal')
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
    <div class="hoy-cola" id="hoy-cola">
      <button type="button" class="cola-item" data-dia="pregunta" id="cola-pregunta"><small>Pregunta</small><b>Mirando…</b><em>Abrir</em></button>
      ${colaRunHTML()}
      <button type="button" class="cola-item" data-dia="gemelo" id="cola-gemelo"><small>Gemelo</small><b>Mirando el día…</b><em>Abrir</em></button>
    </div>
    ${brujulaHTML()}
    ${hoyDatos.proximas?.length ? `<section class="hoy-semana"><h3 class="sub">Próximas runs</h3>${hoyDatos.proximas.map((r) => `<details class="run-pasada"><summary><b>${esc(new Date(`${r.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }))}</b> ${r.inicio}–${r.fin} · ${r.misiones.length} bandas · propuesta</summary>
      ${r.resumen ? `<p class="hoy-resumen">${esc(r.resumen)}</p>` : ''}<ol class="bandas">${r.misiones.map((m) => bandaHTML(m, { propuesta: true })).join('')}</ol>
      <p class="tenue chico">Ese día aparece en Hoy para arrancarla (o rehacerla).</p></details>`).join('')}</section>` : ''}
    ${semanaHoyHTML()}
    ${j?.cierre ? `<div class="hoy-cierre"><small>Tu cierre</small><p>${esc(j.cierre)}</p></div>` : ''}
    ${calendarios ? '' : `<p class="hoy-nota">Para que tenga en cuenta tu agenda: en Google Calendar, Configuración del calendario → «Dirección secreta en formato iCal», y pegala en <code>.env</code> como <code>GCAL_ICS_URLS</code>.</p>`}`
  $('#hoy-ajustes').onclick = modalAjustesHoy
  const bru = $('#hoy-brujula')
  if (bru) bru.onclick = async () => { bru.disabled = true; bru.textContent = 'Mirando cómo venís…'; try { await api('/brujula', {}); traerHoy() } catch (e) { error(e); bru.disabled = false } }
  const det = $('#hoy-dia details.brujula')
  if (det) det.ontoggle = () => pref.guardar('mastro-brujula-caja', det.open ? 'si' : 'no')
  $('#hoy-ocultar').onclick = () => window.ocultarDia?.()
  pintarMiniHoy()
  const nb = $('#hoy-notif')
  if (nb) nb.onclick = async () => { await Notification.requestPermission(); pintarHoy() }
  engancharCola(cont)
  engancharSemanaHoy(cont)
  traerPregunta()
  traerGemelo(hoyDatos.fecha)
  if (diaAbierto && $('#modal .dia-modal') && !focoEnCampo()) pintarDiaModal()
  if (!hoyScrolleado) {
    hoyScrolleado = true
    $('.banda.ahora', cont)?.scrollIntoView({ block: 'center' })
  }
}

const corto = (s, n = 110) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || '')

function brujulaHTML() {
  const b = hoyDatos.brujula
  if (!b) return '<button type="button" class="btn btn-chico" id="hoy-brujula">Armar la brújula de hoy</button>'
  return `<details class="brujula" ${pref.leer('mastro-brujula-caja', 'no') === 'si' ? 'open' : ''}>
    <summary><small>Si hacés una sola cosa</small><b>${esc(b.foco)}</b></summary>
    <p><b>Cuerpo.</b> ${esc(b.cuerpo)}</p>
    <p><b>Mente.</b> ${esc(b.mente)}</p>
    <p><b>Alma.</b> ${esc(b.alma)}</p>
  </details>`
}

function colaRunHTML() {
  const run = hoyDatos.run
  if (run?.estado === 'en_curso') {
    const ms = run.misiones
    const actual = ms.find((m) => m.id === hoyDatos.actual)
    const hechas = ms.filter((m) => m.estado === 'hecha').length
    const titulo = actual ? actual.titulo : minutosAhora() < aMinJs(run.inicio) ? `Arranca a las ${run.inicio}` : 'Entre bandas'
    return `<div class="cola-bloque">
      <button type="button" class="cola-item" data-dia="run">
        <small>Run · ${run.inicio}–${run.fin}</small>
        <b>${esc(titulo)}</b>
        <em>Abrir</em>
      </button>
      <div class="cola-pie">
        <i class="cola-barra" title="${hechas} de ${ms.length}"><b style="width:${ms.length ? Math.round((hechas / ms.length) * 100) : 0}%"></b></i>
        <span>${hechas}/${ms.length}</span>
        ${actual ? `<span class="cola-marcas">${[['hecha', '✓ Hecha'], ['parcial', '◐'], ['no', '✗']].map(([e, g]) => `<button type="button" data-cola-marcar="${e}" data-mid="${actual.id}" class="${actual.estado === e ? 'on' : ''}">${g}</button>`).join('')}</span>` : ''}
      </div>
    </div>`
  }
  if (run?.estado === 'propuesta') {
    return `<button type="button" class="cola-item pendiente" data-dia="run">
      <small>Run propuesta · ${run.inicio}–${run.fin}</small>
      <b>${esc(corto(run.resumen || `${run.misiones.length} bandas listas`, 120))}</b>
      <em>Abrir</em>
    </button>`
  }
  return `<button type="button" class="cola-item" data-dia="run"><small>Run</small><b>Sin run. Cuando quieras, la armamos.</b><em>Arrancar</em></button>`
}

function engancharCola(cont) {
  $$('[data-dia]', cont).forEach((b) => (b.onclick = () => abrirDia(b.dataset.dia)))
  $$('[data-cola-marcar]', cont).forEach((b) => (b.onclick = async () => {
    const m = hoyDatos.run?.misiones?.find((x) => x.id === Number(b.dataset.mid))
    if (!m) return
    try {
      await api(`/misiones/${m.id}/marcar`, { estado: m.estado === b.dataset.colaMarcar ? 'activa' : b.dataset.colaMarcar })
      await refrescar()
      await traerHoy()
    } catch (e) { error(e) }
  }))
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

// Pregunta, run y gemelo: el panel muestra tres tarjetas; se responden en un modal y se pasa de una a la otra.

const DIA_PARTES = ['pregunta', 'run', 'gemelo']
const DIA_NOMBRE = { pregunta: 'Pregunta', run: 'Run', gemelo: 'Gemelo' }
let diaAbierto = null
let preguntaVista = null
let gemeloCache = {}
let gemeloDia = null
let gemeloAuto = {}
let predCursor = 0
let predPreferida = null
let gemeloInfoAbierta = false

const focoEnCampo = () => {
  const a = document.activeElement
  return !!(a && /INPUT|TEXTAREA/.test(a.tagName) && a.closest('#modal, #hoy-dia'))
}
const fechaMas = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}
const fechaLinda = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

function abrirDia(cual) {
  diaAbierto = cual
  if (cual === 'gemelo') {
    const pend = gemeloCache[hoyDatos?.fecha]?.pendientes ?? []
    if (!gemeloDia || !gemeloCache[gemeloDia]) gemeloDia = pend[0]?.fecha || hoyDatos.fecha
    predCursor = 0
    gemeloInfoAbierta = false
    if (!gemeloCache[gemeloDia]) traerGemelo(gemeloDia)
  }
  pintarDiaModal(true)
}

function moverDia(delta) {
  const i = DIA_PARTES.indexOf(diaAbierto)
  diaAbierto = DIA_PARTES[(i + delta + DIA_PARTES.length) % DIA_PARTES.length]
  pintarDiaModal(true)
}

function pintarDiaModal(foco = false) {
  if (!diaAbierto || !hoyDatos) return
  const g = gemeloCache[hoyDatos.fecha]
  const pendGem = g?.pendientes?.length ?? 0
  const marcas = { pregunta: !!preguntaVista?.pregunta, run: hoyDatos.run?.estado === 'propuesta', gemelo: pendGem > 0 }
  const cuerpo = diaAbierto === 'pregunta' ? cuerpoPregunta() : diaAbierto === 'run' ? cuerpoRun() : cuerpoGemelo()
  abrirModal(`<div class="dia-modal">
    <header class="dia-top">
      <nav class="dia-tabs">${DIA_PARTES.map((k) => `<button type="button" data-dia-tab="${k}" class="${diaAbierto === k ? 'on' : ''} ${marcas[k] ? 'pendiente' : ''}">${DIA_NOMBRE[k]}</button>`).join('')}</nav>
      <button type="button" class="btn btn-chico cerrar" data-cerrar>✕</button>
    </header>
    <div class="dia-cuerpo">${cuerpo}</div>
    <footer class="dia-pie">
      <button type="button" data-dia-nav="-1">‹ Anterior</button>
      <small>← →</small>
      <button type="button" data-dia-nav="1">Siguiente ›</button>
    </footer>
  </div>`)
  engancharDiaModal()
  if (foco) setTimeout(() => {
    if (!$('#modal .dia-modal')) return
    if (diaAbierto === 'pregunta') $('#p-resp')?.focus()
    else if (document.activeElement?.closest('#modal') && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.dataset.sinFoco != null) document.activeElement.blur()
  }, 30)
}

function engancharDiaModal() {
  const raiz = $('#modal')
  $$('[data-dia-tab]', raiz).forEach((b) => (b.onclick = () => { diaAbierto = b.dataset.diaTab; pintarDiaModal(true) }))
  $$('[data-dia-nav]', raiz).forEach((b) => (b.onclick = () => moverDia(Number(b.dataset.diaNav))))
  if (diaAbierto === 'pregunta') engancharPreguntaModal(raiz)
  if (diaAbierto === 'run') engancharRun(raiz, hoyDatos.run)
  if (diaAbierto === 'gemelo') engancharGemeloModal(raiz)
}

document.addEventListener('keydown', (e) => {
  if (!diaAbierto || $('#velo').hidden || !$('#modal .dia-modal')) return
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) return
  if (e.key === 'ArrowRight') { e.preventDefault(); moverDia(1) }
  if (e.key === 'ArrowLeft') { e.preventDefault(); moverDia(-1) }
})

const _cerrarModalDia = cerrarModal
cerrarModal = () => { diaAbierto = null; clearInterval(cuentaRegresiva); _cerrarModalDia() }

// ─── pregunta ───────────────────────────────────────────────────────────

async function traerPregunta() {
  try {
    const r = await api('/preguntas/siguiente')
    preguntaVista = r
    pintarTarjetaPregunta(r)
    if (r.generando && !r.pregunta) setTimeout(() => vista === 'hoy' && traerPregunta(), 6000)
    if (diaAbierto === 'pregunta' && $('#modal .dia-modal') && !focoEnCampo()) pintarDiaModal()
  } catch { /* la tarjeta se queda en lo último que tuvo */ }
}

function pintarTarjetaPregunta(r) {
  const el = $('#cola-pregunta')
  if (!el) return
  const p = r?.pregunta
  el.querySelector('b').textContent = p ? corto(p.texto, 120) : r?.generando ? 'Pensando qué preguntarte…' : 'Nada por ahora'
  el.querySelector('em').textContent = p ? 'Responder' : 'Abrir'
  el.classList.toggle('pendiente', !!p)
}

function cuerpoPregunta() {
  const r = preguntaVista
  const p = r?.pregunta
  if (!p) {
    return `<div class="dia-vacio"><small>Mastropiero pregunta</small><h2>${r?.generando ? 'Pensando qué preguntarte…' : 'Nada pendiente'}</h2><p class="tenue">${r?.generando ? 'En un rato aparece acá. Podés pasar a la run o al gemelo.' : 'Cuando tenga algo que no sabe de vos, va a estar acá.'}</p></div>`
  }
  return `<div class="pregunta" data-pregunta="${p.id}">
    <small>Mastropiero pregunta${r.respondidas ? ` · ${r.respondidas} respondidas` : ''}</small>
    <p class="p-texto">${esc(p.texto)}</p>
    ${p.porQue ? `<p class="p-porque">${esc(p.porQue)}</p>` : ''}
    ${p.tipo === 'opciones' ? `<div class="chips">${p.opciones.map((o) => `<button type="button" class="chip" data-opcion="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
    <div class="fila p-resp">
      <input class="campo-suelto" id="p-resp" ${p.tipo === 'numero' ? 'inputmode="decimal"' : ''} placeholder="${p.tipo === 'opciones' ? 'O escribí otra cosa…' : 'Tu respuesta…'}" autofocus>
      <button type="button" class="btn btn-primario" id="p-enviar">Responder</button>
      <button type="button" class="btn" id="p-saltar">Saltear</button>
    </div>
  </div>`
}

function engancharPreguntaModal(raiz) {
  const p = preguntaVista?.pregunta
  if (!p) return
  const responder = async (respuesta) => {
    try {
      const r2 = await api(`/preguntas/${p.id}`, { respuesta })
      if (respuesta) toast('Anotado<small>Lo guardo en lo que sé de vos.</small>', 'suave')
      preguntaVista = { pregunta: r2.siguiente, generando: !r2.siguiente, respondidas: (preguntaVista.respondidas ?? 0) + (respuesta ? 1 : 0) }
      pintarTarjetaPregunta(preguntaVista)
      if (!r2.siguiente) setTimeout(() => vista === 'hoy' && traerPregunta(), 6000)
      if (diaAbierto === 'pregunta') pintarDiaModal(true)
    } catch (e) { error(e) }
  }
  $$('[data-opcion]', raiz).forEach((b) => (b.onclick = () => responder(b.dataset.opcion)))
  const enviar = $('#p-enviar', raiz)
  const campo = $('#p-resp', raiz)
  if (enviar && campo) {
    enviar.onclick = () => { const v = campo.value.trim(); if (v) responder(v) }
    campo.onkeydown = (e) => { if (e.key === 'Enter' && campo.value.trim()) responder(campo.value.trim()) }
  }
  const saltar = $('#p-saltar', raiz)
  if (saltar) saltar.onclick = () => responder(null)
}

// ─── run dentro del modal ───────────────────────────────────────────────

function cuerpoRun() {
  const run = hoyDatos.run
  if (run?.estado === 'en_curso') return runEnCursoHTML(run)
  if (run?.estado === 'propuesta') return runPropuestaHTML(run)
  return sinRunHTML()
}

// ─── gemelo: día por día, validar, agregar info, mandar predicciones ──

async function traerGemelo(fecha) {
  const f = fecha || hoyDatos?.fecha
  if (!f) return
  try {
    const g = await api(`/gemelo?${new URLSearchParams({ fecha: f })}`)
    gemeloCache[f] = g
    if (f === hoyDatos.fecha) pintarTarjetaGemelo(g)
    if (f === hoyDatos.fecha && !g.predicciones.length && !gemeloAuto[f]) {
      gemeloAuto[f] = 'pidiendo'
      pintarTarjetaGemelo(g, true)
      if (diaAbierto === 'gemelo' && gemeloDia === f) pintarDiaModal()
      try {
        await api('/gemelo/predecir', { fecha: f })
        gemeloAuto[f] = 'listo'
        return traerGemelo(f)
      } catch (e) {
        gemeloAuto[f] = 'fallo'
        pintarTarjetaGemelo(gemeloCache[f], false, true)
        error(e)
      }
    }
    if (diaAbierto === 'gemelo' && gemeloDia === f && $('#modal .dia-modal') && !focoEnCampo()) pintarDiaModal()
  } catch (e) {
    const b = $('#cola-gemelo b')
    if (f === hoyDatos?.fecha && b) b.textContent = 'No pude mirar el gemelo'
  }
}

function pintarTarjetaGemelo(g, prediciendo = false, fallo = false) {
  const el = $('#cola-gemelo')
  if (!el || !g) return
  const pend = g.pendientes?.length ?? 0
  const n = g.predicciones?.length ?? 0
  const pct = g.curva?.total
  el.querySelector('small').textContent = `Gemelo${pct != null ? ` · ${pct}%` : ''}`
  el.querySelector('b').textContent = fallo ? 'No pude predecir. Abrí para reintentar.' : prediciendo ? 'Prediciendo el día…' : pend ? `${pend} ${pend === 1 ? 'predicción para validar' : 'predicciones para validar'}` : n ? `${n} ${n === 1 ? 'predicción de hoy' : 'predicciones de hoy'}` : 'Todavía sin predicciones'
  el.querySelector('em').textContent = pend ? 'Validar' : 'Abrir'
  el.classList.toggle('pendiente', pend > 0)
}

function ordenPredicciones(lista) {
  const peso = { para_el_jugador: 0, abierta: 1, calificada: 2 }
  return [...lista].sort((a, b) => (peso[a.estado] ?? 9) - (peso[b.estado] ?? 9) || a.id - b.id)
}

function cuerpoGemelo() {
  const f = gemeloDia || hoyDatos.fecha
  const g = gemeloCache[f]
  const hoy = f === hoyDatos.fecha
  const puedeDespues = f < hoyDatos.fecha
  const pct = g?.curva?.total
  const nav = `<div class="gem-fecha">
    <button type="button" id="gem-antes" title="Día anterior">‹</button>
    <div><b>${esc(fechaLinda(f))}</b><small>${hoy ? 'hoy' : ''}${pct != null ? `${hoy ? ' · ' : ''}te conozco ${pct}%` : ''}${g ? ` · ${g.predicciones.length} predicciones` : ''}</small></div>
    <button type="button" id="gem-despues" title="Día siguiente" ${puedeDespues ? '' : 'disabled'}>›</button>
  </div>`
  if (!g) return `${nav}<div class="dia-vacio"><h2>Mirando ese día…</h2></div>`
  const lista = ordenPredicciones(g.predicciones)
  if (predPreferida === 'siguiente') {
    const i = lista.findIndex((x) => x.estado === 'para_el_jugador')
    predCursor = i >= 0 ? i : Math.min(predCursor, Math.max(0, lista.length - 1))
    predPreferida = null
  } else if (typeof predPreferida === 'number') {
    const i = lista.findIndex((x) => x.id === predPreferida)
    if (i >= 0) predCursor = i
    predPreferida = null
  }
  if (predCursor >= lista.length) predCursor = Math.max(0, lista.length - 1)
  const p = lista[predCursor]
  const prediciendo = gemeloAuto[f] === 'pidiendo'
  const carta = !lista.length
    ? `<div class="dia-vacio"><h2>${prediciendo ? 'Prediciendo el día…' : gemeloAuto[f] === 'fallo' ? 'No pude predecir' : 'Este día no tiene predicciones'}</h2><p class="tenue">${prediciendo ? 'Las dejo selladas y a la noche me califico. Si ya sabés algo, mandame una.' : 'Mandame una, o pedime que prediga en base a lo que pasó.'}</p></div>`
    : `<article class="gem-carta ${p.resultado === 1 ? 'si' : p.resultado === 0 ? 'no' : ''}" data-pred="${p.id}">
        <div class="gem-carta-top"><small>${predCursor + 1} de ${lista.length}${p.estado === 'para_el_jugador' ? ' · para validar' : p.estado === 'calificada' ? ' · calificada' : ' · todavía abierta'}${p.tipo === 'jugador' ? ' · tuya' : ''}</small><b class="prob">${Math.round(p.probabilidad * 100)}%</b></div>
        <p class="texto">${esc(p.texto)}</p>
        ${p.nota ? `<p class="gem-nota">${esc(p.nota)}</p>` : ''}
        ${p.resultado != null ? `<p class="gem-res">${p.resultado ? 'Pasó' : 'No pasó'}${p.calificadaPor ? ` · ${esc(p.calificadaPor)}` : ''}</p>` : ''}
        <div class="gem-acc">
          <button type="button" class="si ${p.resultado === 1 ? 'on' : ''}" data-gem-paso="1">✓ Pasó</button>
          <button type="button" class="no ${p.resultado === 0 ? 'on' : ''}" data-gem-paso="0">✗ No pasó</button>
          <button type="button" id="gem-info" class="${gemeloInfoAbierta ? 'on' : ''}">＋ Info</button>
        </div>
        ${gemeloInfoAbierta ? `<div class="gem-info"><textarea id="gem-nota" data-sin-foco rows="3" placeholder="Qué pasó de verdad, un detalle, una corrección…">${esc(p.nota ?? '')}</textarea><button type="button" class="btn" id="gem-guardar-info">Guardar info</button></div>` : ''}
        ${lista.length > 1 ? `<div class="gem-pasar"><button type="button" id="gem-prev">‹</button><button type="button" id="gem-next">Siguiente predicción ›</button></div>` : ''}
      </article>`
  return `${nav}${g.curva ? sparkDe(g) : ''}${carta}
    <form class="gem-nueva" id="gem-nueva">
      <label>Sobre este día<textarea id="gem-texto" data-sin-foco rows="2" placeholder="Va a cerrar el acuerdo antes de las 18…"></textarea></label>
      <div class="gem-prob"><span>Si la mandás vos</span><input id="gem-prob" data-sin-foco type="range" min="5" max="95" value="60"><b id="gem-prob-n">60%</b></div>
      <div class="fila">
        <button type="submit" class="btn btn-primario">Enviar la mía</button>
        <button type="button" class="btn" id="gem-sumar">Que prediga en base a esto</button>
      </div>
      <p class="tenue chico">Vacío, «que prediga» mira el día y suma algunas. Con texto, predice a partir de lo que contás. «Enviar la mía» la anota tal cual, para este día.</p>
    </form>`
}

function sparkDe(g) {
  const pts = (g.curva?.puntos ?? []).filter((p) => p.conocimiento != null)
  if (pts.length < 2) return ''
  return `<svg class="spark" viewBox="0 0 ${(pts.length - 1) * 10} 28" preserveAspectRatio="none"><polyline points="${pts.map((p, i) => `${i * 10},${28 - (p.conocimiento / 100) * 26 - 1}`).join(' ')}"/></svg>`
}

function engancharGemeloModal(raiz) {
  const f = gemeloDia || hoyDatos.fecha
  const g = gemeloCache[f]
  const ir = (fecha) => {
    if (fecha > hoyDatos.fecha) return
    gemeloDia = fecha
    predCursor = 0
    gemeloInfoAbierta = false
    if (!gemeloCache[fecha]) pintarDiaModal()
    traerGemelo(fecha)
  }
  const antes = $('#gem-antes', raiz)
  const despues = $('#gem-despues', raiz)
  if (antes) antes.onclick = () => ir(fechaMas(f, -1))
  if (despues) despues.onclick = () => ir(fechaMas(f, 1))
  const lista = g ? ordenPredicciones(g.predicciones) : []
  const p = lista[predCursor]
  const notaCampo = () => $('#gem-nota', raiz)?.value.trim() || null
  const marcar = async (paso) => {
    if (!p) return
    try {
      await api(`/gemelo/${p.id}`, { paso, nota: notaCampo() })
      gemeloInfoAbierta = false
      predPreferida = paso == null ? p.id : 'siguiente'
      await traerGemelo(f)
    } catch (e) { error(e) }
  }
  $$('[data-gem-paso]', raiz).forEach((b) => (b.onclick = () => marcar(b.dataset.gemPaso === '1')))
  const info = $('#gem-info', raiz)
  if (info) info.onclick = () => { gemeloInfoAbierta = !gemeloInfoAbierta; pintarDiaModal(); $('#gem-nota')?.focus() }
  const guardar = $('#gem-guardar-info', raiz)
  if (guardar) guardar.onclick = () => marcar(null)
  const prev = $('#gem-prev', raiz)
  const next = $('#gem-next', raiz)
  if (prev) prev.onclick = () => { predCursor = (predCursor - 1 + lista.length) % lista.length; gemeloInfoAbierta = false; pintarDiaModal() }
  if (next) next.onclick = () => { predCursor = (predCursor + 1) % lista.length; gemeloInfoAbierta = false; pintarDiaModal() }
  const rango = $('#gem-prob', raiz)
  const rangoN = $('#gem-prob-n', raiz)
  if (rango && rangoN) rango.oninput = () => { rangoN.textContent = `${rango.value}%` }
  const form = $('#gem-nueva', raiz)
  if (form) form.onsubmit = (e) => {
    e.preventDefault()
    const texto = $('#gem-texto', raiz).value.trim()
    if (!texto) return
    const probabilidad = Number($('#gem-prob', raiz).value) / 100
    trabajando($('[type=submit]', form), 'Enviando…', async () => {
      await api('/gemelo/nueva', { fecha: f, texto, probabilidad })
      toast('Predicción anotada<small>La califico con las de ese día.</small>', 'suave')
      predCursor = 0
      await traerGemelo(f)
    })
  }
  const sumar = $('#gem-sumar', raiz)
  if (sumar) sumar.onclick = () => trabajando(sumar, 'Prediciendo…', async () => {
    const pista = $('#gem-texto', raiz).value.trim()
    await api('/gemelo/sumar', { fecha: f, pista: pista || null })
    toast(pista ? 'Predije en base a eso' : 'Sumé predicciones del día', 'suave')
    predCursor = 0
    await traerGemelo(f)
  })
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
