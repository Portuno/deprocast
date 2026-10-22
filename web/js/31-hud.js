'use strict'
// El HUD de Hoy: el panel derecho como centro de mando (plan v22). Arriba, siempre, «Ahora»: lo que hay que hacer ya
// (la banda con su cuenta y ✓ ◐ ✗, el bloque guiado o lo próximo). Debajo, cuatro pestañas (Alt+1…4) que quedan como
// las dejaste, y acciones rápidas abajo (Alt+N/R/A/V/F). Lo que se hace desde acá deja una línea de registro discreta en
// el chat; Mastropiero sabe qué pestaña estás mirando cuando le preguntás «¿cómo voy?».

const HUD_MODOS = [['dia', 'Día', 'calendar'], ['cuerpo', 'Cuerpo', 'heart'], ['numeros', 'Números', 'activity'], ['oraculo', 'Oráculo', 'sparkles']]
const HUD_ACCIONES = [['tarea', '＋', 'Tarea', 'N'], ['run', '⚡', 'Run', 'R'], ['anotar', '◉', 'Anotar', 'A'], ['foco', '◎', 'Foco', 'F']]
let hudDatos = null
let hudPop = null


/** La pestaña que elegiste queda elegida (ya no cambia sola con la hora). Las de antes se traducen a las nuevas. */
const MODO_VIEJO = { run: 'dia', quests: 'dia', agenda: 'dia', stats: 'numeros' }
function modoHud() {
  const guardado = String(pref.leer('mastro-hud-modo', 'dia')).split('|').pop()
  const modo = MODO_VIEJO[guardado] ?? guardado
  return HUD_MODOS.some(([k]) => k === modo) ? modo : 'dia'
}
window.hudModoActual = () => (vista === 'hoy' ? modoHud() : null)

/**
 * Lo del HUD que no viene en /api/hoy (agenda, salud, plata…): cambia poco, así que se pide como mucho cada 60 s,
 * salvo que algo del HUD lo haya cambiado recién (hudPendiente).
 */
let hudEn = 0
let hudPendiente = false
async function traerHud(forzar = false) {
  if (forzar || !hudDatos || hudPendiente || Date.now() - hudEn > 60_000) {
    hudPendiente = false
    try { hudDatos = await api('/hoy/hud'); hudEn = Date.now() } catch { /* el HUD funciona con lo de /hoy */ }
  }
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
  // El esqueleto (estado, modos, chips, acciones) se arma de nuevo solo si cambió lo que muestra; si no, solo el widget.
  const clave = JSON.stringify([hoyDatos.fecha, estadoRun, modo, hoyDatos.tarjetasHoy, hoyDatos.manoNuevas])
  if (cont.dataset.hud === clave && $('#hud-cuerpo', cont)) return void pintarModoHud()
  cont.dataset.hud = clave
  cont.innerHTML = `<div class="hud-hoy">
    <div class="hoja-asa" id="hoja-asa" aria-hidden="true"></div>
    <header class="hud-estado">
      <div><b>${esc(mayuscula(fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })))}</b><small>${esc(estadoRun)}</small></div>
      <span class="hud-estado-acc">${hoyDatos.tarjetasHoy ? `<button class="btn btn-chico hud-tarjetas" id="hoy-tarjetas" title="Las tarjetas que tocan hoy (recuerdo activo)">🃏 ${hoyDatos.tarjetasHoy} para repasar</button>` : ''}${hoyDatos.manoNuevas ? `<button class="btn btn-chico hud-tarjetas" id="hoy-mano" title="Afirmaciones tuyas que no se parecen a nada que tengas: jugalas en La Mano">♤ ${hoyDatos.manoNuevas} nueva${hoyDatos.manoNuevas === 1 ? '' : 's'} para jugar</button>` : ''}<button class="btn btn-chico hud-hoja-btn" id="hud-hoja-btn" aria-expanded="false" aria-controls="hoy-dia">${ico('chevron-up')}<span>El día</span></button><button class="btn btn-chico btn-icono" id="hoy-ajustes" title="Ajustes: rutinas, plantillas, voz, Directo y tope de gasto" aria-label="Ajustes">${ico('settings')}</button><button class="btn btn-chico btn-icono" id="hoy-ocultar" title="Pantalla de foco: solo lo de ahora y el chat (Alt+F)" aria-label="Pantalla de foco">${ico('panel-right-close')}</button></span>
    </header>
    <section class="hud-ahora" id="hud-ahora" aria-label="Ahora"></section>
    <nav class="hud-modos" role="tablist" aria-label="Paneles del día">${HUD_MODOS.map(([k, n, ic], i) => `<button role="tab" data-hud="${k}" class="${k === modo ? 'on' : ''}" aria-selected="${k === modo}" tabindex="${k === modo ? 0 : -1}" title="${n} (Alt+${i + 1})">${ico(ic)}<span>${n}</span><kbd>${i + 1}</kbd></button>`).join('')}</nav>
    <section class="hud-cuerpo" id="hud-cuerpo" role="tabpanel"></section>
    <div class="hud-pop" id="hud-pop" hidden></div>
    <nav class="hud-rapidas">${HUD_ACCIONES.map(([k, ic, n, t]) => `<button data-hud-acc="${k}" title="${n} (Alt+${t})"><i>${ic}</i><span>${n}</span></button>`).join('')}</nav>
  </div>`
  $('#hoy-ajustes').onclick = modalAjustesHoy
  engancharHojaHoy()
  if ($('#hoy-tarjetas')) $('#hoy-tarjetas').onclick = () => repasarTarjetas()
  if ($('#hoy-mano')) $('#hoy-mano').onclick = () => irA('mano')
  $('#hoy-ocultar').onclick = () => window.ocultarDia?.()
  $$('[data-hud]', cont).forEach((b) => (b.onclick = () => cambiarModoHud(b.dataset.hud)))
  $$('[data-hud-acc]', cont).forEach((b) => (b.onclick = () => accionHud(b.dataset.hudAcc)))
  pintarModoHud()
}

/**
 * En el celular, el panel del día es una hoja: cerrada muestra solo «Ahora»; abierta sube desde abajo con las
 * pestañas, y se baja arrastrando el asa (o con el mismo botón).
 */
function engancharHojaHoy() {
  const dia = $('#hoy-dia')
  const btn = $('#hud-hoja-btn')
  if (!dia || !btn) return
  const poner = (abierta) => { dia.classList.toggle('hoja', abierta); btn.setAttribute('aria-expanded', abierta); btn.querySelector('span').textContent = abierta ? 'Cerrar' : 'El día' }
  btn.onclick = () => poner(!dia.classList.contains('hoja'))
  poner(dia.classList.contains('hoja')) // si se redibujó abierta, el botón lo dice
  const asa = $('#hoja-asa')
  let y0 = null
  asa.onpointerdown = (e) => { y0 = e.clientY; try { asa.setPointerCapture(e.pointerId) } catch { /* igual anda */ } }
  asa.onpointerup = (e) => { if (y0 != null && e.clientY - y0 > 50) poner(false); y0 = null }
}

function cambiarModoHud(modo) {
  pref.guardar('mastro-hud-modo', modo)
  $$('[data-hud]').forEach((b) => { const on = b.dataset.hud === modo; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1 })
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

/** Lo próximo de la agenda que todavía no empezó (para cuando no hay banda ni bloque). */
function proximoEvento() {
  const ahora = Date.now()
  return (hudDatos?.agenda ?? []).filter((e) => !e.todoElDia && new Date(e.inicio).getTime() > ahora)
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))[0] ?? null
}

/** «en 25′», «en 2 h 10′». */
const enCuanto = (min) => (min < 60 ? `${Math.max(1, min)}′` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}′` : ''}`)
const MARCAS_BANDA = [['hecha', '✓ Hecha'], ['parcial', '◐ A medias'], ['no', '✗ No']]

/**
 * «Ahora»: lo único que importa en este momento, en un lugar fijo. Por orden: la banda de la run (con su cuenta y las
 * marcas), el bloque guiado, la run propuesta, o lo próximo de la agenda con cómo arrancar. `foco`: la versión de la
 * pantalla de foco (arriba del chat, con el botón para volver al panel).
 */
function ahoraHTML(foco = false) {
  const run = hoyDatos?.run
  const bloque = typeof vivo !== 'undefined' ? vivo.bloque : null
  const volver = foco ? `<button class="btn btn-chico btn-fantasma ahora-panel" data-mostrar-dia title="Volver al panel del día (Alt+F)">${ico('panel-left-close')}<span>Panel</span></button>` : ''
  if (run?.estado === 'en_curso') {
    const { actual, proxima } = bandaDeAhora(run)
    const ms = run.misiones
    const hechas = ms.filter((m) => m.estado === 'hecha').length
    if (actual) {
      const dur = Math.max(1, aMinJs(actual.fin) - aMinJs(actual.inicio))
      const quedan = Math.max(0, aMinJs(actual.fin) - minutosAhora())
      return `<div class="ahora">${anilloHud(dur - quedan, dur, `${quedan}′`, 'quedan')}
        <div class="ahora-txt"><small class="hud-etq">Ahora · ${actual.inicio}–${actual.fin}</small><h3 class="hud-titulo">${esc(actual.titulo)}</h3>
          <small class="hud-texto">${proxima ? `Después: ${esc(corto(proxima.titulo, 40))} · ` : ''}${hechas} de ${ms.length} hechas</small></div>${volver}
        <div class="hud-marcas">${MARCAS_BANDA.map(([e, n]) => `<button data-hud-marcar="${e}" data-mid="${actual.id}" class="${actual.estado === e ? 'on' : ''}" aria-pressed="${actual.estado === e}">${n}</button>`).join('')}<button class="btn-link" data-dia="run">La run →</button></div></div>`
    }
    return `<div class="ahora"><div class="ahora-txt"><small class="hud-etq">Run ${run.inicio}–${run.fin} · entre bandas</small>
      <h3 class="hud-titulo">${proxima ? `Lo que sigue: ${esc(proxima.titulo)}` : 'Terminaste las bandas'}</h3><small class="hud-texto">${hechas} de ${ms.length} hechas${proxima ? ` · arranca ${proxima.inicio}` : ''}</small></div>${volver}
      <div class="hud-marcas"><button class="btn-link" data-dia="run">La run →</button></div></div>`
  }
  if (bloque) {
    const pct = Math.min(100, Math.round((bloque.lleva / bloque.minutos) * 100))
    return `<div class="ahora">${anilloHud(bloque.lleva, bloque.minutos, `${bloque.quedan}′`, 'quedan')}
      <div class="ahora-txt"><small class="hud-etq">Bloque de foco · ${bloque.lleva}′ de ${bloque.minutos}′</small><h3 class="hud-titulo">${esc(bloque.tema ?? 'Bloque de foco')}</h3>
        ${bloque.fuera && bloque.fuera.minutos >= 1 ? `<small class="vivo-alerta">Fuera del tema hace ${bloque.fuera.minutos}′ (${esc(bloque.fuera.donde)})</small>` : `<small class="hud-texto">${pct}% del bloque</small>`}</div>${volver}
      <div class="hud-marcas"><button data-ahora-cortar>Cortar el bloque</button></div></div>`
  }
  if (run?.estado === 'propuesta') {
    return `<div class="ahora"><div class="ahora-txt"><small class="hud-etq">Run propuesta · ${run.inicio}–${run.fin}</small><h3 class="hud-titulo">${run.misiones.length} bandas listas para arrancar</h3></div>${volver}
      <div class="hud-marcas"><button class="on" data-dia="run">▶ Ver y arrancar</button></div></div>`
  }
  const ev = proximoEvento()
  return `<div class="ahora ahora-libre"><div class="ahora-txt"><small class="hud-etq">Ahora · sin run</small>
      <h3 class="hud-titulo">${ev ? `Lo próximo: ${esc(corto(ev.titulo, 50))}` : '¿Qué hacemos?'}</h3>
      ${ev ? `<small class="hud-texto">${new Date(ev.inicio).toTimeString().slice(0, 5)} · en ${enCuanto(Math.round((new Date(ev.inicio) - Date.now()) / 60000))}</small>` : '<small class="hud-texto">Una run para el día o un bloque de foco para lo de ahora.</small>'}</div>${volver}
    <div class="hud-marcas">${(hoyDatos?.plantillas ?? []).slice(0, 3).map((p) => `<button data-plantilla="${p.id}">⚡ ${esc(p.nombre)}</button>`).join('')}<button id="run-nueva">Armar una run</button><button data-ahora-bloque>⏱ Bloque</button></div></div>`
}

/** Pinta «Ahora» en el panel y en la pantalla de foco (los dos lugares donde vive). */
function pintarAhora() {
  if (!hoyDatos) return
  for (const [sel, foco] of [['#hud-ahora', false], ['#hoy-ahora-foco', true]]) {
    const cont = $(sel)
    if (!cont) continue
    cont.innerHTML = ahoraHTML(foco)
    engancharWidgetHud(cont)
    $$('[data-ahora-bloque]', cont).forEach((b) => (b.onclick = () => modalBloque()))
    $$('[data-ahora-cortar]', cont).forEach((b) => (b.onclick = async () => { try { await api('/bloque/terminar', {}); await traerVivo(); traerLoNuevo() } catch (e) { error(e) } }))
    $$('[data-mostrar-dia]', cont).forEach((b) => (b.onclick = () => window.mostrarDia?.()))
  }
}
window.pintarAhora = pintarAhora

function widgetQuests() {
  const prims = (hoyDatos.primarias ?? []).filter((m) => m.estado !== 'descartada').slice(0, 4)
  const lado = (hoyDatos.terciarias ?? []).filter((m) => m.estado === 'activa').slice(0, 3)
  return `<div class="hud-hero hud-norte"><small class="hud-etq">✦ North Star</small><h3 class="hud-titulo">${esc(hoyDatos.principal?.titulo ?? 'Sin fijar')}</h3></div>
    <small class="hud-etq">Primarias de la semana</small>
    ${prims.length ? `<div class="hud-prims">${prims.map((m) => `<div class="hud-prim ${m.estado}"><div class="hud-fila"><span>${m.estado === 'hecha' ? '●' : m.estado === 'sugerida' ? '○' : '◐'} ${esc(corto(m.titulo, 40))}</span><span class="hud-num">${m.avance.progreso}%</span></div>${barraHud(m.avance.progreso, 100)}</div>`).join('')}</div>` : '<p class="hud-texto">Sin primarias esta semana.</p>'}
    ${lado.length ? `<small class="hud-etq">Side quests</small>${lado.map((m) => `<div class="hud-fila hud-sq"><span>⚑ ${esc(corto(m.titulo, 36))}</span><button class="btn-link" data-hud-hecha="${m.id}" title="Cumplida">✓</button></div>`).join('')}` : ''}
    ${hudDatos?.bucles?.length ? `<small class="hud-etq">🔁 Sigue volviendo</small>${hudDatos.bucles.map((b) => filaBucle(b, true)).join('')}` : ''}
    ${pieHud('¿En qué primaria me conviene meter foco hoy?', 'misiones', 'Misiones')}`
}

function widgetAgenda() {
  const ahora = minutosAhora()
  const items = []
  const vistos = new Set() // el mismo evento en dos calendarios, una vez
  for (const e of (hudDatos?.agenda ?? []).filter((x) => !vistos.has(`${x.titulo}|${x.inicio}`) && vistos.add(`${x.titulo}|${x.inicio}`))) items.push({ min: e.todoElDia ? -1 : new Date(e.inicio).getHours() * 60 + new Date(e.inicio).getMinutes(), hora: e.todoElDia ? 'día' : new Date(e.inicio).toTimeString().slice(0, 5), titulo: e.titulo, tipo: 'evento' })
  for (const m of hoyDatos.run?.misiones ?? []) items.push({ min: aMinJs(m.inicio), hora: m.inicio, titulo: m.titulo, tipo: 'banda', hecha: m.estado === 'hecha' })
  for (const r of hudDatos?.rutinas ?? []) items.push({ min: aMinJs(r.hora), hora: r.hora, titulo: r.nombre, tipo: 'rutina' })
  for (const f of hudDatos?.fijo ?? []) items.push({ min: aMinJs(f.desde), hora: f.desde, titulo: `${f.que} (hasta ${f.hasta})`, tipo: 'fijo', hecha: aMinJs(f.hasta) < ahora })
  items.sort((a, b) => a.min - b.min)
  const futuras = items.filter((x) => x.min < 0 || x.min + 30 >= ahora)
  const lista = (futuras.length ? futuras : items).slice(0, 9)
  let marcado = false
  return `<small class="hud-etq">Hoy</small><ol class="hud-linea">${lista.map((x) => {
    const ahoraAca = !marcado && x.min >= 0 && x.min >= ahora ? (marcado = true, '<li class="hud-ahora"><span>ahora</span></li>') : ''
    return `${ahoraAca}<li class="${x.tipo} ${x.hecha ? 'hecha' : ''}"><span class="hud-num">${x.hora}</span><span>${esc(corto(x.titulo, 40))}</span><em>${x.tipo}</em></li>`
  }).join('') || '<li><span></span><span>Nada en la agenda.</span></li>'}</ol>
    ${hoyDatos.calendarios ? '' : '<p class="hud-texto">Sin calendario conectado: cargá GCAL_ICS_URLS en las variables.</p>'}
  `
}

function widgetCuerpo() {
  const s = hudDatos?.salud
  if (!s) return '<p class="hud-texto" role="status">Trayendo lo de tu cuerpo de hoy…</p>'
  const m = s.metas
  return `<div class="hud-anillos">${anilloHud(s.kcal, m.kcal ?? s.kcal ?? 1, `${s.kcal}`, m.kcal ? `de ${m.kcal} kcal` : 'kcal')}${anilloHud(s.proteina, m.proteina ?? s.proteina ?? 1, `${s.proteina}g`, m.proteina ? `de ${m.proteina} g prot.` : 'proteína', 'verde')}</div>
    <div class="hud-fichas">${fichaHud('Sueño', s.sueno?.horas != null ? `${s.sueno.horas}h` : '—', s.sueno?.calidad ? ['', 'mal', 'bien', 'muy bien'][s.sueno.calidad] : '')}${fichaHud('Entrenos', `${s.entrenosSemana}${m.entrenos ? `/${m.entrenos}` : ''}`, 'esta semana')}${fichaHud('Peso', s.peso ? `${s.peso.peso}` : '—', s.peso ? 'kg' : '')}</div>
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
    <div class="hud-fichas">${d?.foco?.hoy?.minutos ? fichaHud('Foco hoy', `${d.foco.hoy.bloqueMax}′`, d.foco.meta ? `meta ${d.foco.meta}′` : 'bloque más largo') : ''}${fichaHud('Bandas', `${hechas}/${total}`, 'esta semana')}${r ? fichaHud('Plata del mes', `${Math.round(r.ingresos)}€`, r.meta ? `de ${r.meta} €` : '') : ''}${d?.gasto ? fichaHud('Tokens hoy', fmtTokens(d.gasto.total), d.gasto.tope ? `tope ${fmtTokens(d.gasto.tope)}` : '') : ''}</div>
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

/** Día: la agenda (eventos, bandas, rutinas y lo fijo) y, debajo, la principal, las primarias y las tareas de hoy. */
const widgetDia = () => `${widgetAgenda()}${widgetQuests()}`
const WIDGETS = { dia: widgetDia, cuerpo: widgetCuerpo, numeros: widgetStats, oraculo: widgetOraculo }

function pintarModoHud() {
  pintarAhora()
  const cont = $('#hud-cuerpo')
  if (!cont || !hoyDatos) return
  const modo = modoHud()
  cont.innerHTML = `<div class="hud-widget">${WIDGETS[modo]()}</div>`
  engancharWidgetHud(cont)
}

function engancharWidgetHud(cont) {
  const listo = async (registro) => { if (registro) await registrarHud(registro); hudPendiente = true; await refrescar(); await traerHoy() }
  $$('[data-dia]', cont).forEach((b) => (b.onclick = () => abrirDia(b.dataset.dia)))
  $$('[data-hud-ir]', cont).forEach((a) => (a.onclick = (e) => { e.preventDefault(); irA(a.dataset.hudIr) }))
  $$('[data-hud-ir-btn]', cont).forEach((b) => (b.onclick = () => irA(b.dataset.hudIrBtn)))
  $$('[data-hud-preguntar]', cont).forEach((b) => (b.onclick = () => preguntarHud(b.dataset.hudPreguntar)))
  $$('[data-hud-marcar]', cont).forEach((b) => (b.onclick = async () => {
    const m = hoyDatos.run.misiones.find((x) => x.id === Number(b.dataset.mid))
    const estado = m.estado === b.dataset.hudMarcar ? 'activa' : b.dataset.hudMarcar
    try { await api(`/misiones/${m.id}/marcar`, { estado }); await listo(estado === 'activa' ? null : `${MARCA[estado]} banda «${m.titulo}» ${estado === 'parcial' ? 'a medias' : estado === 'no' ? 'no salió' : 'hecha'}`) } catch (e) { error(e) }
  }))
  if (hudDatos?.bucles?.length) engancharBucles(cont, hudDatos.bucles, () => traerHud(true))
  $$('[data-hud-hecha]', cont).forEach((b) => (b.onclick = async () => {
    try { const m = await api(`/misiones/${b.dataset.hudHecha}`, { estado: 'hecha' }); await listo(`✓ side quest «${m.titulo ?? ''}»`) } catch (e) { error(e) }
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
  if (cual === 'foco') return $('#hoy')?.classList.contains('foco') ? window.mostrarDia?.() : window.ocultarDia?.()
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
      traerHud(true)
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
