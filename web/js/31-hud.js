'use strict'
// El HUD de Hoy: el panel derecho como menú de juego. Una línea de estado, seis modos (Alt+1…6) que cambian el widget
// sin tocar el chat, y acciones rápidas abajo (Alt+N/R/A/V/F). Lo que se hace desde acá deja una línea de registro
// discreta en el chat; Mastropiero sabe qué modo estás mirando cuando le preguntás «¿cómo voy?».

const HUD_MODOS = [['run', 'Run', '⚔'], ['quests', 'Quests', '◎'], ['agenda', 'Agenda', '☷'], ['cuerpo', 'Cuerpo', '♥'], ['stats', 'Stats', '◈'], ['oraculo', 'Oráculo', '✦']]
const HUD_ACCIONES = [['tarea', '＋', 'Tarea', 'N'], ['run', '⚡', 'Run', 'R'], ['anotar', '◉', 'Anotar', 'A'], ['voto', '☑', 'Voto', 'V'], ['foco', '◎', 'Foco', 'F']]
const VERBOS_HUD = [['estudio', 'Estudio'], ['trabajo', 'Trabajo'], ['entreno', 'Entreno'], ['ensenio', 'Enseño'], ['construyo', 'Construyo'], ['disenio', 'Diseño']]
let hudDatos = null
let hudPop = null

const fechaHoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** El modo que toca solo: run en curso → Run; a la mañana → Oráculo (la brújula); a la noche → Cuerpo (voto y hábitos). */
function modoAutoHud() {
  if (hoyDatos?.run?.estado === 'en_curso') return 'run'
  const h = new Date().getHours()
  return h < 12 ? 'oraculo' : h >= 21 ? 'cuerpo' : 'quests'
}
/** El que elegiste a mano vale hasta mañana. */
function modoHud() {
  const [dia, modo] = String(pref.leer('mastro-hud-modo', '')).split('|')
  return dia === fechaHoyISO() && HUD_MODOS.some(([k]) => k === modo) ? modo : modoAutoHud()
}
window.hudModoActual = () => (vista === 'hoy' ? modoHud() : null)

async function traerHud() {
  try { hudDatos = await api('/hoy/hud') } catch { /* el HUD funciona con lo de /hoy */ }
  pintarModoHud()
}

/** Una línea de registro en el chat de Hoy (y se ve enseguida). */
async function registrarHud(texto) {
  try {
    await api('/hoy/evento', { texto })
    if (chat.actual?.modo === 'hoy') abrirConversacion(chat.actual.id)
  } catch { /* el registro es un plus */ }
}

/** Deja una pregunta armada en el chat de Hoy, para mandarla o editarla. */
function preguntarHud(texto) {
  const t = $('#chat-txt')
  if (!t) return
  t.value = texto
  t.focus()
  t.dispatchEvent(new Event('input'))
}

function pintarHud(cont) {
  const fecha = new Date(`${hoyDatos.fecha}T12:00:00`)
  const run = hoyDatos.run
  const estadoRun = run?.estado === 'en_curso' ? (() => { const { actual } = bandaDeAhora(run); return actual ? `⚔ ${Math.max(0, aMinJs(actual.fin) - minutosAhora())}′ en «${corto(actual.titulo, 28)}»` : `⚔ run ${run.inicio}–${run.fin}` })() : run?.estado === 'propuesta' ? 'run propuesta' : 'sin run'
  const modo = modoHud()
  cont.innerHTML = `<div class="hud-hoy">
    <header class="hud-estado">
      <div><b>${esc(mayuscula(fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })))}</b><small>${esc(estadoRun)}</small></div>
      <span class="hud-estado-acc"><button class="btn btn-chico btn-icono" id="hoy-ajustes" title="Rutinas, plantillas y tope de gasto">⚙</button><button class="btn btn-chico btn-icono" id="hoy-ocultar" title="Ocultar el panel (Alt+F)">⇥</button></span>
    </header>
    <nav class="hud-modos" role="tablist">${HUD_MODOS.map(([k, n, ic], i) => `<button role="tab" data-hud="${k}" class="${k === modo ? 'on' : ''}" title="${n} (Alt+${i + 1})"><i>${ic}</i><span>${n}</span><kbd>${i + 1}</kbd></button>`).join('')}</nav>
    <section class="hud-cuerpo" id="hud-cuerpo"></section>
    <div class="hud-pop" id="hud-pop" hidden></div>
    <nav class="hud-rapidas">${HUD_ACCIONES.map(([k, ic, n, t]) => `<button data-hud-acc="${k}" title="${n} (Alt+${t})"><i>${ic}</i><span>${n}</span></button>`).join('')}</nav>
  </div>`
  $('#hoy-ajustes').onclick = modalAjustesHoy
  $('#hoy-ocultar').onclick = () => window.ocultarDia?.()
  $$('[data-hud]', cont).forEach((b) => (b.onclick = () => cambiarModoHud(b.dataset.hud)))
  $$('[data-hud-acc]', cont).forEach((b) => (b.onclick = () => accionHud(b.dataset.hudAcc)))
  pintarModoHud()
}

function cambiarModoHud(modo) {
  pref.guardar('mastro-hud-modo', `${fechaHoyISO()}|${modo}`)
  $$('[data-hud]').forEach((b) => b.classList.toggle('on', b.dataset.hud === modo))
  cerrarPopHud()
  pintarModoHud()
}

const mayuscula = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
/** Un anillo de progreso (como en un juego): el valor en el centro y una línea abajo. */
const anilloHud = (v, max, centro, sub, clase = '') => `<div class="hud-anillo ${clase}" style="--p:${max ? Math.min(100, Math.round((v / max) * 100)) : 0}"><b>${centro}</b>${sub ? `<small>${sub}</small>` : ''}</div>`
/** Una ficha chica de número: etiqueta arriba, valor grande. */
const fichaHud = (etq, valor, sub = '') => `<div class="hud-ficha"><small>${etq}</small><b>${valor}</b>${sub ? `<em>${sub}</em>` : ''}</div>`
const barraHud = (v, max) => `<span class="hud-barra"><i style="width:${max ? Math.min(100, Math.round((v / max) * 100)) : 0}%"></i></span>`
const filaHud = (izq, der, extra = '') => `<div class="hud-fila ${extra}"><span>${izq}</span><span class="hud-num">${der}</span></div>`
const pieHud = (texto, ir, irNombre) => `<footer class="hud-pie">${ir ? `<a href="#" data-hud-ir="${ir}">${irNombre} →</a>` : '<span></span>'}<button class="btn-link" data-hud-preguntar="${esc(texto)}">Preguntarle ↗</button></footer>`

function widgetRun() {
  const run = hoyDatos.run
  if (run?.estado === 'en_curso') {
    const { actual, proxima } = bandaDeAhora(run)
    const ms = run.misiones
    const hechas = ms.filter((m) => m.estado === 'hecha').length
    const siguientes = ms.filter((m) => aMinJs(m.inicio) > minutosAhora()).slice(0, 3)
    const dur = actual ? Math.max(1, aMinJs(actual.fin) - aMinJs(actual.inicio)) : 1
    const quedan = actual ? Math.max(0, aMinJs(actual.fin) - minutosAhora()) : 0
    return `<div class="hud-hero">
        <div class="hud-hero-fila">${anilloHud(actual ? dur - quedan : hechas, actual ? dur : ms.length, actual ? `${quedan}′` : `${hechas}/${ms.length}`, actual ? 'quedan' : 'hechas')}
          <div><small class="hud-etq">${actual ? `Banda actual · ${actual.inicio}–${actual.fin}` : `Run ${run.inicio}–${run.fin}`}</small>
          <h3 class="hud-titulo">${esc(actual ? actual.titulo : proxima ? `Lo que sigue: ${proxima.titulo}` : 'Terminaste las bandas')}</h3>
          <small class="hud-texto">${hechas} de ${ms.length} bandas hechas</small></div></div>
        ${actual ? `<div class="hud-marcas">${[['hecha', '✓ Hecha'], ['parcial', '◐ A medias'], ['no', '✗ No']].map(([e, n]) => `<button data-hud-marcar="${e}" data-mid="${actual.id}" class="${actual.estado === e ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
      </div>
      ${siguientes.length ? `<small class="hud-etq">Después</small><ol class="hud-linea">${siguientes.map((m) => `<li class="banda"><span class="hud-num">${m.inicio}</span><span>${esc(corto(m.titulo, 40))}</span><em>${m.minutos ?? ''}′</em></li>`).join('')}</ol>` : ''}
      <button class="btn btn-chico" data-dia="run">Abrir la run</button>
      ${pieHud('¿Cómo voy con la run?')}`
  }
  if (run?.estado === 'propuesta') {
    return `<div class="hud-hero"><small class="hud-etq">Run propuesta · ${run.inicio}–${run.fin}</small><h3 class="hud-titulo">${run.misiones.length} bandas listas para arrancar</h3>
      ${run.resumen ? `<p class="hud-texto">${esc(corto(run.resumen, 220))}</p>` : ''}
      <button class="btn btn-primario" data-dia="run">▶ Ver y arrancar</button></div>${pieHud('¿Esta run está bien armada para hoy?')}`
  }
  return `<div class="hud-hero hud-hero-centro"><span class="hud-glifo">⚔</span><h3 class="hud-titulo">¿Armamos una run?</h3>
      <p class="hud-texto">Elegí una plantilla o contale a Mastropiero cuánto tiempo tenés.</p>
      ${hoyDatos.plantillas?.length ? `<div class="hud-chips">${hoyDatos.plantillas.map((p) => `<button data-plantilla="${p.id}">⚡ ${esc(p.nombre)}</button>`).join('')}</div>` : ''}
      <button class="btn btn-chico" id="run-nueva">Armarla con palabras</button></div>
    ${hoyDatos.proximas?.length ? `<small class="hud-etq">Próximas</small>${hoyDatos.proximas.slice(0, 3).map((r) => filaHud(esc(new Date(`${r.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })), `${r.inicio}–${r.fin}`)).join('')}` : ''}
    ${pieHud('¿Qué run me conviene ahora?')}`
}

function widgetQuests() {
  const prims = (hoyDatos.primarias ?? []).filter((m) => m.estado !== 'descartada').slice(0, 4)
  const tareas = hudDatos?.plan?.tareas ?? []
  const lado = (hoyDatos.terciarias ?? []).filter((m) => m.estado === 'activa').slice(0, 3)
  return `<div class="hud-hero hud-norte"><small class="hud-etq">✦ North Star</small><h3 class="hud-titulo">${esc(hoyDatos.principal?.titulo ?? 'Sin fijar')}</h3></div>
    <small class="hud-etq">Primarias de la semana</small>
    ${prims.length ? `<div class="hud-prims">${prims.map((m) => `<div class="hud-prim ${m.estado}"><div class="hud-fila"><span>${m.estado === 'hecha' ? '●' : m.estado === 'sugerida' ? '○' : '◐'} ${esc(corto(m.titulo, 40))}</span><span class="hud-num">${m.avance.progreso}%</span></div>${barraHud(m.avance.progreso, 100)}</div>`).join('')}</div>` : '<p class="hud-texto">Sin primarias esta semana.</p>'}
    ${tareas.length ? `<small class="hud-etq">Para hoy</small>${tareas.slice(0, 3).map((t) => `<label class="hud-check"><input type="checkbox" data-hud-tarea="${t.id}" ${t.estado === 'hecha' ? 'checked' : ''}> ${t.hito ? '◆ ' : ''}${esc(corto(t.titulo, 44))}</label>`).join('')}` : ''}
    ${lado.length ? `<small class="hud-etq">Side quests</small>${lado.map((m) => `<div class="hud-fila hud-sq"><span>⚑ ${esc(corto(m.titulo, 36))}</span><button class="btn-link" data-hud-hecha="${m.id}" title="Cumplida">✓</button></div>`).join('')}` : ''}
    ${pieHud('¿En qué primaria me conviene meter foco hoy?', 'misiones', 'Misiones')}`
}

function widgetAgenda() {
  const ahora = minutosAhora()
  const items = []
  const vistos = new Set() // el mismo evento en dos calendarios, una vez
  for (const e of (hudDatos?.agenda ?? []).filter((x) => !vistos.has(`${x.titulo}|${x.inicio}`) && vistos.add(`${x.titulo}|${x.inicio}`))) items.push({ min: e.todoElDia ? -1 : new Date(e.inicio).getHours() * 60 + new Date(e.inicio).getMinutes(), hora: e.todoElDia ? 'día' : new Date(e.inicio).toTimeString().slice(0, 5), titulo: e.titulo, tipo: 'evento' })
  for (const m of hoyDatos.run?.misiones ?? []) items.push({ min: aMinJs(m.inicio), hora: m.inicio, titulo: m.titulo, tipo: 'banda', hecha: m.estado === 'hecha' })
  for (const r of hudDatos?.rutinas ?? []) items.push({ min: aMinJs(r.hora), hora: r.hora, titulo: r.nombre, tipo: 'rutina' })
  items.sort((a, b) => a.min - b.min)
  const futuras = items.filter((x) => x.min < 0 || x.min + 30 >= ahora)
  const lista = (futuras.length ? futuras : items).slice(0, 9)
  let marcado = false
  return `<small class="hud-etq">Hoy</small><ol class="hud-linea">${lista.map((x) => {
    const ahoraAca = !marcado && x.min >= 0 && x.min >= ahora ? (marcado = true, '<li class="hud-ahora"><span>ahora</span></li>') : ''
    return `${ahoraAca}<li class="${x.tipo} ${x.hecha ? 'hecha' : ''}"><span class="hud-num">${x.hora}</span><span>${esc(corto(x.titulo, 40))}</span><em>${x.tipo}</em></li>`
  }).join('') || '<li><span></span><span>Nada en la agenda.</span></li>'}</ol>
    ${hoyDatos.calendarios ? '' : '<p class="hud-texto">Sin calendario conectado: cargá GCAL_ICS_URLS en las variables.</p>'}
    ${pieHud('¿Cómo acomodo lo que queda del día?')}`
}

function widgetCuerpo() {
  const s = hudDatos?.salud
  if (!s) return '<p class="hud-texto">Cargando…</p>'
  const m = s.metas
  const habitos = hudDatos.plan?.habitos ?? []
  return `<div class="hud-anillos">${anilloHud(s.kcal, m.kcal ?? s.kcal ?? 1, `${s.kcal}`, m.kcal ? `de ${m.kcal} kcal` : 'kcal')}${anilloHud(s.proteina, m.proteina ?? s.proteina ?? 1, `${s.proteina}g`, m.proteina ? `de ${m.proteina} g prot.` : 'proteína', 'verde')}</div>
    <div class="hud-fichas">${fichaHud('Sueño', s.sueno?.horas != null ? `${s.sueno.horas}h` : '—', s.sueno?.calidad ? ['', 'mal', 'bien', 'muy bien'][s.sueno.calidad] : '')}${fichaHud('Entrenos', `${s.entrenosSemana}${m.entrenos ? `/${m.entrenos}` : ''}`, 'esta semana')}${fichaHud('Peso', s.peso ? `${s.peso.peso}` : '—', s.peso ? 'kg' : '')}</div>
    ${habitos.length ? `<small class="hud-etq">Hábitos de hoy</small>${habitos.slice(0, 5).map((h) => `<label class="hud-check"><input type="checkbox" data-hud-habito="${esc(h.id)}" ${h.hecho ? 'checked' : ''}> ${esc(corto(h.titulo, 40))} <em>${h.enSemana}/${h.porSemana}</em></label>`).join('')}` : ''}
    ${pieHud('¿Cómo viene mi cuerpo hoy?', 'salud', 'Salud')}`
}

function widgetStats() {
  const d = hudDatos
  const sem = hoyDatos.semana ?? []
  const hechas = sem.reduce((a, x) => a + x.hechos, 0)
  const total = sem.reduce((a, x) => a + x.total, 0)
  const r = d?.plata?.resumen
  const ritmo = d?.plata?.ritmo
  return `<div class="hud-hero hud-hero-fila">${anilloHud(d?.teConozco ?? 0, 100, d?.teConozco != null ? `${d.teConozco}%` : '—', 'te conozco')}
      <div><small class="hud-etq">El gemelo</small><p class="hud-texto">Cuánto acierta Mastropiero cuando predice tu día (últimas 3 semanas).</p></div></div>
    <div class="hud-fichas">${fichaHud('Bandas', `${hechas}/${total}`, 'esta semana')}${r ? fichaHud('Plata del mes', `${Math.round(r.ingresos)}€`, r.meta ? `de ${r.meta} €` : '') : ''}${d?.gasto ? fichaHud('Tokens hoy', fmtTokens(d.gasto.total), d.gasto.tope ? `tope ${fmtTokens(d.gasto.tope)}` : '') : ''}</div>
    <div class="hud-semana">${sem.map((x) => `<span title="${x.fecha}: ${x.hechos} de ${x.total}"><i style="height:${x.total ? Math.round((x.hechos / x.total) * 100) : 0}%"></i><small>${DIA_LETRA[new Date(`${x.fecha}T12:00:00`).getDay()]}</small></span>`).join('')}</div>
    ${r?.meta ? barraHud(r.ingresos, r.meta) : ''}${ritmo?.falta ? filaHud('Para llegar a la meta', `${Math.round(ritmo.porDia)} € por día`, 'tenue') : ''}
    ${pieHud('Leeme los números de la semana: ¿qué ves?')}`
}

function widgetOraculo() {
  const b = hoyDatos.brujula
  return `${b
    ? `<div class="hud-hero hud-norte"><small class="hud-etq">✦ Brújula · foco del día</small><h3 class="hud-titulo">${esc(b.foco)}</h3>
        <div class="hud-tridente"><p><i>♥</i><span><b>Cuerpo.</b> ${esc(corto(b.cuerpo, 120))}</span></p><p><i>◈</i><span><b>Mente.</b> ${esc(corto(b.mente, 120))}</span></p><p><i>✦</i><span><b>Alma.</b> ${esc(corto(b.alma, 120))}</span></p></div></div>`
    : `<div class="hud-hero hud-hero-centro"><span class="hud-glifo">✦</span><h3 class="hud-titulo">La brújula del día</h3><p class="hud-texto">Cuerpo, mente y alma en tres frases, y el foco que hace que el día valga.</p><button class="btn btn-primario" id="hoy-brujula">Pedirla</button></div>`}
    ${hudDatos?.pregunta ? `<button class="hud-tarjeta" data-dia="pregunta"><small>❓ Pregunta pendiente</small>${esc(corto(hudDatos.pregunta, 130))}</button>` : ''}
    <button class="hud-tarjeta" data-dia="gemelo"><small>◎ El gemelo</small>Qué predijo de tu día →</button>
    ${hudDatos?.directo ? `<button class="hud-tarjeta" data-hud-ir-btn="directo"><small>◉ Del Directo</small>${hudDatos.directo} propuesta${hudDatos.directo === 1 ? '' : 's'} para revisar →</button>` : ''}
    ${pieHud('¿Qué no estoy viendo de mi día?')}`
}

const WIDGETS = { run: widgetRun, quests: widgetQuests, agenda: widgetAgenda, cuerpo: widgetCuerpo, stats: widgetStats, oraculo: widgetOraculo }

function pintarModoHud() {
  const cont = $('#hud-cuerpo')
  if (!cont || !hoyDatos) return
  const modo = modoHud()
  cont.innerHTML = `<div class="hud-widget">${WIDGETS[modo]()}</div>`
  engancharWidgetHud(cont)
}

function engancharWidgetHud(cont) {
  const listo = async (registro) => { if (registro) await registrarHud(registro); await refrescar(); await traerHoy() }
  $$('[data-dia]', cont).forEach((b) => (b.onclick = () => abrirDia(b.dataset.dia)))
  $$('[data-hud-ir]', cont).forEach((a) => (a.onclick = (e) => { e.preventDefault(); irA(a.dataset.hudIr) }))
  $$('[data-hud-ir-btn]', cont).forEach((b) => (b.onclick = () => irA(b.dataset.hudIrBtn)))
  $$('[data-hud-preguntar]', cont).forEach((b) => (b.onclick = () => preguntarHud(b.dataset.hudPreguntar)))
  $$('[data-hud-marcar]', cont).forEach((b) => (b.onclick = async () => {
    const m = hoyDatos.run.misiones.find((x) => x.id === Number(b.dataset.mid))
    const estado = m.estado === b.dataset.hudMarcar ? 'activa' : b.dataset.hudMarcar
    try { await api(`/misiones/${m.id}/marcar`, { estado }); await listo(estado === 'activa' ? null : `${MARCA[estado]} banda «${m.titulo}» ${estado === 'parcial' ? 'a medias' : estado === 'no' ? 'no salió' : 'hecha'}`) } catch (e) { error(e) }
  }))
  $$('[data-hud-tarea]', cont).forEach((c) => (c.onchange = async () => {
    try { const m = await api(`/cien/tarea/${c.dataset.hudTarea}`, { hecha: c.checked }); await listo(c.checked ? `✓ ${m.titulo}` : null) } catch (e) { error(e) }
  }))
  $$('[data-hud-hecha]', cont).forEach((b) => (b.onclick = async () => {
    try { const m = await api(`/misiones/${b.dataset.hudHecha}`, { estado: 'hecha' }); await listo(`✓ side quest «${m.titulo ?? ''}»`) } catch (e) { error(e) }
  }))
  $$('[data-hud-habito]', cont).forEach((c) => (c.onchange = async () => {
    try { await api('/cien/habito', { fecha: hoyDatos.fecha, id: c.dataset.hudHabito, valor: c.checked }); await registrarHud(c.checked ? `☑ ${c.closest('label').textContent.trim().replace(/\s+\d+\/\d+$/, '')}` : ''); traerHud() } catch (e) { error(e) }
  }))
  $$('[data-plantilla]', cont).forEach((b) => (b.onclick = () => trabajando(b, 'Armando…', async () => {
    const r = await api('/runs/preparar', { pedido: { plantilla: Number(b.dataset.plantilla) } })
    if (r.avisos?.length) toast(esc(r.avisos.join(' ')), 'suave')
    await traerHoy()
  })))
  const nueva = $('#run-nueva', cont)
  if (nueva) nueva.onclick = () => modalRun()
  const bru = $('#hoy-brujula', cont)
  if (bru) bru.onclick = async () => { bru.disabled = true; bru.textContent = 'Mirando cómo venís…'; try { await api('/brujula', {}); traerHoy() } catch (e) { error(e); bru.disabled = false } }
}

// ─── acciones rápidas (popovers de una línea) ───────────────────────────

function cerrarPopHud() {
  const p = $('#hud-pop')
  if (p) { p.hidden = true; p.innerHTML = '' }
  hudPop = null
}

function accionHud(cual) {
  if (cual === 'foco') return window.ocultarDia?.()
  if (cual === 'run') return modalRun()
  const p = $('#hud-pop')
  if (!p) return
  if (hudPop === cual) return cerrarPopHud()
  hudPop = cual
  p.hidden = false
  if (cual === 'tarea') {
    p.innerHTML = '<form class="hud-pop-form" id="hp-f"><input id="hp-t" placeholder="Qué hacer… (Enter)" autocomplete="off"></form>'
    $('#hp-f').onsubmit = async (e) => {
      e.preventDefault()
      const titulo = $('#hp-t').value.trim()
      if (!titulo) return
      try { await api('/misiones', { nivel: 'terciaria', titulo }); cerrarPopHud(); await registrarHud(`＋ side quest «${titulo}»`); await traerHoy() } catch (err) { error(err) }
    }
  }
  if (cual === 'anotar') {
    p.innerHTML = `<form class="hud-pop-form" id="hp-f"><input id="hp-t" placeholder="Almorcé…, corrí…, gasté…, estudié… (Enter)" autocomplete="off"><label class="btn btn-chico" title="Una foto: el plato, el ticket, la balanza">📷<input type="file" accept="image/*" id="hp-foto" hidden></label></form>`
    const anotado = async (r) => {
      if (!r.registrado) return toast(`No me pareció algo para anotar${r.captura?.descripcion ? `<small>${esc(r.captura.descripcion)}</small>` : ''}`, 'suave')
      cerrarPopHud()
      await registrarHud(r.registrado.resumen)
      traerHud()
    }
    $('#hp-f').onsubmit = async (e) => {
      e.preventDefault()
      const texto = $('#hp-t').value.trim()
      if (!texto) return
      try { await anotado(await api('/captura', { texto })) } catch (err) { error(err) }
    }
    $('#hp-foto').onchange = async (e) => {
      const f = e.target.files?.[0]
      if (!f) return
      try {
        const r = await fetch(`/api/captura/foto?nombre=${encodeURIComponent(f.name || 'foto.jpg')}&texto=${encodeURIComponent($('#hp-t').value.trim())}`, { method: 'POST', body: f }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
        await anotado(r)
      } catch (err) { error(err) }
    }
  }
  if (cual === 'voto') {
    const verbos = hudDatos?.plan?.verbos ?? {}
    p.innerHTML = `<div class="hud-votos">${VERBOS_HUD.map(([k, n]) => `<button data-voto="${k}" class="${verbos[k] ? 'on' : ''}">${n}</button>`).join('')}</div>`
    $$('[data-voto]', p).forEach((b) => (b.onclick = async () => {
      try {
        const d = await api('/cien/voto', { fecha: hoyDatos.fecha, verbo: b.dataset.voto })
        const on = !!d.verbos[b.dataset.voto]
        b.classList.toggle('on', on)
        if (hudDatos?.plan) hudDatos.plan.verbos = d.verbos
        if (on) registrarHud(`🗳 votó ${b.textContent}`)
      } catch (err) { error(err) }
    }))
  }
  $('#hp-t', p)?.focus()
}

// ─── atajos ─────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (vista !== 'hoy') return
  if (e.key === 'Escape' && hudPop) return cerrarPopHud()
  if (!e.altKey || e.ctrlKey || e.metaKey) return
  const n = Number(e.key)
  if (n >= 1 && n <= HUD_MODOS.length) { e.preventDefault(); return cambiarModoHud(HUD_MODOS[n - 1][0]) }
  const acc = HUD_ACCIONES.find(([, , , t]) => t.toLowerCase() === e.key.toLowerCase())
  if (acc) { e.preventDefault(); accionHud(acc[0]) }
})
