'use strict'
// ─── vistas ─────────────────────────────────────────────────────────────

const VISTAS = {
  hoy: { montar: montarHoy, refrescar: refrescarHoy },
  misiones: { montar: montarMisionesVida, refrescar: refrescarMisionesVida },
  jugador: { montar: montarJugador, refrescar: refrescarJugador },
  personas: { montar: montarPersonas, refrescar: refrescarPersonas },
  linea: { montar: montarLinea, refrescar: refrescarLinea },
  calendario: { montar: montarCalendario, refrescar: () => {} },
  mapa: { montar: montarMapa, refrescar: () => {} },
  directo: { montar: montarDirecto, refrescar: refrescarDirecto },
  salud: { montar: montarSalud, refrescar: () => {} },
  aprender: { montar: montarAprender, refrescar: () => {} },
  idiomas: { montar: montarIdiomas, refrescar: () => {} },
  suenos: { montar: montarSuenos, refrescar: () => {} },
  radar: { montar: montarRadar, refrescar: refrescarRadar },
  discovery: { montar: montarDiscovery, refrescar: () => {} },
  taller: { montar: montarTaller, refrescar: refrescarTaller },
  estudio: { montar: montarEstudio, refrescar: refrescarEstudio },
  cuentas: { montar: montarCuentas, refrescar: refrescarCuentas },
  chat: { montar: montarChat, refrescar: () => pintarLado() },
  entidades: { montar: montarEntidades, refrescar: refrescarEntidades },
  liga: { montar: montarLiga, refrescar: refrescarLiga },
  forja: { montar: montarForja, refrescar: () => {} },
  encargos: { montar: montarMisiones, refrescar: refrescarTablero },
  corpus: { montar: montarCorpus, refrescar: refrescarCorpus },
  mano: { montar: montarMano, refrescar: () => {} },
  criba: { montar: montarCriba, refrescar: () => {} },
  cuadernos: { montar: montarCuadernos, refrescar: refrescarCuadernos },
  libreria: { montar: montarLibreria, refrescar: () => {} },
  fragua: { montar: montarFragua, refrescar: refrescarFragua },
  quantomos: { montar: montarQuantomos, refrescar: refrescarQuantomos },
  matriz: { montar: montarMatriz, refrescar: montarMatriz },
  cementerio: { montar: montarCementerio, refrescar: montarCementerio },
}

/**
 * La parte del estado que le importa a cada vista: si no cambió, la vista no vuelve a pedir ni a dibujar nada.
 * (Antes, cualquier cambio —el gasto de tokens, un momento del Directo— rehacía la vista entera y volvía a pedir sus datos.)
 * Las vistas que no están acá refrescan como siempre (las de «() => {}» no hacen nada).
 */
const FIRMA_VISTA = {
  personas: (e) => [e.entidades, e.liga?.corpus],
  linea: (e) => [e.liga?.corpus],
  cuadernos: (e) => [e.liga?.corpus],
  fragua: (e) => [e.propuestasAbiertas, e.hoy?.aviso?.id],
  encargos: (e) => [e.tareas.map((t) => [t.id, t.estado]), e.enEspera],
  liga: (e) => [e.roster.map((f) => [f.id, f.estado, f.nivel, f.exitos, f.fallos]), e.liga?.proyectos],
  corpus: (e) => [e.liga?.niveles, e.liga?.corpus, e.quantomos, e.cargas.map((c) => [c.id, c.estado])],
  quantomos: (e) => [e.quantomos],
  entidades: (e) => [e.entidades],
  chat: (e) => [e.roster.map((f) => [f.id, f.estado]), e.propuestasAbiertas, e.hoy?.aviso?.id],
  matriz: (e) => [e.roster.map((f) => [f.id, f.estado, f.nivel]), e.lapidas?.length],
  cementerio: (e) => [e.lapidas?.length],
  hoy: (e) => [e.hoy],
  directo: (e) => [e.hoy?.directo],
  radar: (e) => [e.hoy?.aviso],
}
const firmasVista = {}
const firmaDeVista = (v) => (FIRMA_VISTA[v] && E ? JSON.stringify(FIRMA_VISTA[v](E)) : null)

/**
 * Los espacios (plan v22): 29 secciones agrupadas en 7 lugares (y La máquina), cada uno con sus secciones como pestañas.
 * El orden es fijo a propósito (la memoria de dónde está cada cosa vale más que reordenar); el uso real decide a qué
 * pestaña se entra la primera vez. Los links de siempre (#salud, #mano…) siguen andando. tecla: «g» + esa letra.
 */
const ESPACIOS = [
  { id: 'hoy', nombre: 'Hoy', ico: 'sun', tecla: 'h', vistas: [['hoy', 'Hoy'], ['directo', 'Directo']] },
  { id: 'chat', nombre: 'Chat', ico: 'message-circle', tecla: 'c', vistas: [['chat', 'Chat']] },
  { id: 'plan', nombre: 'Plan', ico: 'target', tecla: 'p', vistas: [['misiones', 'Misiones'], ['calendario', 'Calendario'], ['linea', 'Línea'], ['mapa', 'Mapa']] },
  { id: 'vida', nombre: 'Vida', ico: 'heart-pulse', tecla: 'v', vistas: [['salud', 'Salud'], ['personas', 'Personas'], ['jugador', 'Jugador'], ['suenos', 'Sueños']] },
  { id: 'aprender', nombre: 'Aprender', ico: 'graduation-cap', tecla: 'a', vistas: [['mano', 'La Mano'], ['idiomas', 'Idiomas'], ['aprender', 'Aprender'], ['criba', 'Criba']] },
  { id: 'saber', nombre: 'Saber', ico: 'library', tecla: 's', vistas: [['corpus', 'Corpus'], ['cuadernos', 'Cuadernos'], ['libreria', 'Librería'], ['entidades', 'Entidades']] },
  { id: 'afuera', nombre: 'Afuera', ico: 'globe', tecla: 'f', vistas: [['taller', 'Taller'], ['radar', 'Radar'], ['cuentas', 'Cuentas'], ['discovery', 'Discovery']] },
  { id: 'maquina', nombre: 'La máquina', ico: 'cog', tecla: 'm', vistas: [['fragua', 'La Fragua'], ['liga', 'Roster'], ['forja', 'Forja'], ['encargos', 'Encargos'], ['matriz', 'Matriz 72'], ['cementerio', 'Cementerio']] },
]
/** Las vistas que viven adentro de otra (se marcan como esa pestaña). */
const VISTA_PADRE = { quantomos: 'corpus', estudio: 'taller' }
const espacioDe = (v) => ESPACIOS.find((e) => e.vistas.some(([x]) => x === (VISTA_PADRE[v] ?? v))) ?? ESPACIOS[0]
const nombreDeVista = (v) => ESPACIOS.flatMap((e) => e.vistas).find(([x]) => x === v)?.[1] ?? v
/** Cuántas veces abrió cada vista (30 días): decide la pestaña de entrada de un espacio la primera vez. */
let usoVistas = {}
api('/uso/vistas').then((u) => (usoVistas = u ?? {})).catch(() => {})

function pintarNav() {
  $('#nav-espacios').innerHTML = ESPACIOS.map((e) => `<button data-espacio="${e.id}" class="${e.id === 'maquina' ? 'nav-maquina' : ''}" title="${esc(e.nombre)}${e.vistas.length > 1 ? ` · ${e.vistas.map(([, n]) => n).join(', ')}` : ''} (g ${e.tecla})">${ico(e.ico)}<span>${esc(e.nombre)}</span></button>`).join('')
}

/** Entrar a un espacio: a la última pestaña que abrió ahí; si nunca, a la que más usa (o la primera). */
function irAEspacio(id) {
  const e = ESPACIOS.find((x) => x.id === id)
  if (!e) return
  const ultima = pref.leer(`mastro-espacio-${id}`, '')
  const masUsada = [...e.vistas].sort((a, b) => (usoVistas[b[0]] ?? 0) - (usoVistas[a[0]] ?? 0))[0][0]
  irA(e.vistas.some(([v]) => v === ultima) ? ultima : masUsada)
}

/** El menú y las pestañas del espacio de la vista abierta. */
function pintarEspacio(v) {
  const e = espacioDe(v)
  const activa = VISTA_PADRE[v] ?? v
  $$('#nav-espacios button').forEach((b) => {
    b.classList.toggle('activo', b.dataset.espacio === e.id)
    if (b.dataset.espacio === e.id) b.setAttribute('aria-current', 'page')
    else b.removeAttribute('aria-current')
  })
  const tabs = $('#pestanas')
  tabs.hidden = e.vistas.length < 2
  tabs.innerHTML = e.vistas.length < 2 ? '' : e.vistas.map(([x, n]) => `<button role="tab" data-vista="${x}" aria-selected="${x === activa}" tabindex="${x === activa ? 0 : -1}">${esc(n)}</button>`).join('')
  pref.guardar(`mastro-espacio-${e.id}`, activa)
}

$('#nav-espacios').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-espacio]')
  if (b) irAEspacio(b.dataset.espacio)
})
$('#pestanas').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vista]')
  if (b && b.dataset.vista !== (VISTA_PADRE[vista] ?? vista)) irA(b.dataset.vista)
})
pintarNav()

/** «Más» en el celular: los 7 espacios (y La máquina) en una hoja que sube desde abajo. */
function hojaEspacios() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Ir a</h2>
    <div class="hoja-espacios">${ESPACIOS.map((e) => `<button class="hoja-espacio" data-hoja-espacio="${e.id}">${ico(e.ico, 'grande')}<b>${esc(e.nombre)}</b><small>${esc(e.vistas.map(([, n]) => n).join(' · '))}</small></button>`).join('')}</div>
    <div class="fila hoja-mas"><button class="btn" data-hoja-tema>${ico('sun-moon')} Tema</button><button class="btn" data-hoja-atajos>${ico('keyboard')} Atajos</button></div>`, { hoja: true })
  $$('[data-hoja-espacio]').forEach((b) => (b.onclick = () => { cerrarModal(); irAEspacio(b.dataset.hojaEspacio) }))
  $('[data-hoja-tema]').onclick = () => $('#btn-tema').click()
  $('[data-hoja-atajos]').onclick = () => mostrarAtajos()
}
$('#barra-abajo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-abajo]')
  if (!b) return
  const que = b.dataset.abajo
  if (que === 'hoy' || que === 'chat') irA(que)
  else if (que === 'buscar') abrirPaleta()
  else if (que === 'validar') modalBandeja()
  else hojaEspacios()
})

function irA(v) {
  if (!VISTAS[v]) v = 'hoy'
  vista = v
  firmasVista[v] = firmaDeVista(v) // recién montada: está al día
  if (location.hash.slice(1) !== v) history.replaceState(null, '', `#${v}`) // un link directo a cada vista
  document.body.classList.toggle('en-maquina', VISTAS_MAQUINA.has(v))
  if (E) renderHud()
  $('#principal').classList.toggle('lleno', v === 'chat' || v === 'hoy')
  aplicarCronica()
  pintarEspacio(v)
  $$('#barra-abajo [data-abajo]').forEach((b) => b.classList.toggle('activo', b.dataset.abajo === v || (b.dataset.abajo === 'mas' && v !== 'hoy' && v !== 'chat')))
  document.title = `${nombreDeVista(VISTA_PADRE[v] ?? v)} · Mastropiero`
  VISTAS[v].montar()
  $('#principal').scrollTop = 0
  api('/uso', { vista: v }).catch(() => {}) // qué usa de verdad (para rankear con datos)
}


// ─── tick ───────────────────────────────────────────────────────────────

function celebrar(eventos) {
  let n = 0
  for (const e of eventos) {
    const id = e.texto.match(/[A-Z]{3}-\d{4}/)?.[0]
    if (e.tipo === 'recluta') {
      const nuevo = e.texto.match(/forja ([A-Z]{3}-\d{4})/)?.[1]
      if (nuevo) nuevas.add(nuevo)
    }
    if (n >= 3) continue
    if (e.tipo === 'nivel') (toast(`▲ ${esc(e.texto)}`), n++)
    else if (e.tipo === 'bautismo') (toast(`★ ${esc(id)} se ganó un nombre<small>Abrí su carta para bautizarlo</small>`), n++)
    else if (e.tipo === 'promovido') (toast(`◆ ${esc(e.texto)}`), n++)
    else if (e.tipo === 'retirado' || e.tipo === 'purga') (toast(`✝ ${esc(e.texto)}`, 'error'), n++)
    else if (e.tipo === 'banca') (toast(`⇣ ${esc(e.texto)}`, 'suave'), n++)
    else if (e.tipo === 'publica' && /quántomo/.test(e.texto)) (toast(`⚛ ${esc(e.texto)}`), n++)
  }
  if (!eventos.length) toast('Tick sin novedades<small>El bus está vacío: publicá misiones o ingerí algo.</small>', 'suave')
}

async function hacerTick() {
  if (tickEnCurso) return
  tickEnCurso = true
  document.body.classList.add('jugando')
  $('#btn-tick').disabled = true
  try {
    const r = await api('/tick', {})
    celebrar(r.eventos)
    await refrescar()
  } catch (e) {
    error(e)
    auto = false
    $('#btn-auto').classList.remove('on')
  } finally {
    tickEnCurso = false
    document.body.classList.remove('jugando')
    $('#btn-tick').disabled = false
  }
}

// Preferencias de esta pantalla (solo en este navegador).
const pref = {
  leer: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  guardar: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
let cronicaVisible = pref.leer('mastro-cronica', 'si') === 'si'
let navMini = pref.leer('mastro-nav-mini', 'no') === 'si'
function aplicarNav() {
  document.body.classList.toggle('nav-mini', navMini)
  $('#nav-plegar').textContent = navMini ? '›' : '‹'
  $('#nav-plegar').title = navMini ? 'Desplegar el menú' : 'Plegar el menú'
}
$('#nav-plegar').onclick = () => { navMini = !navMini; pref.guardar('mastro-nav-mini', navMini ? 'si' : 'no'); aplicarNav() }
$('#cronica-cerrar').onclick = () => { cronicaVisible = false; pref.guardar('mastro-cronica', 'no'); aplicarCronica() }
aplicarNav()
function aplicarCronica() {
  // La crónica es de la liga: se ve en la máquina (si la querés), no en tus vistas.
  const ver = cronicaVisible && VISTAS_MAQUINA.has(vista)
  document.body.classList.toggle('sin-cronica', !ver)
  document.body.classList.toggle('con-cronica', ver)
  $('#btn-cronica').classList.toggle('on', cronicaVisible)
}
$('#btn-cronica').onclick = () => { cronicaVisible = !cronicaVisible; pref.guardar('mastro-cronica', cronicaVisible ? 'si' : 'no'); aplicarCronica() }
// El tema: oscuro → claro → el del sistema (y vuelta). Con «sistema», sigue al sistema si cambia mientras está abierto.
const sistemaClaro = matchMedia('(prefers-color-scheme: light)')
function aplicarTema(t = pref.leer('mastro-tema', 'sistema')) {
  const claro = t === 'claro' || (t === 'sistema' && sistemaClaro.matches)
  if (claro) document.documentElement.dataset.tema = 'claro'
  else delete document.documentElement.dataset.tema
}
sistemaClaro.addEventListener('change', () => aplicarTema())
$('#btn-tema').onclick = () => {
  const orden = ['oscuro', 'claro', 'sistema']
  const t = orden[(orden.indexOf(pref.leer('mastro-tema', 'sistema')) + 1) % orden.length]
  pref.guardar('mastro-tema', t)
  aplicarTema(t)
  toast(`Tema: ${t === 'sistema' ? 'el del sistema' : t}`, 'suave')
}

$('#btn-validar').onclick = () => modalBandeja()
$('#btn-buscar').onclick = () => abrirPaleta()
$('#btn-tick').onclick = hacerTick
$('#btn-auto').onclick = async () => {
  auto = !auto
  $('#btn-auto').classList.toggle('on', auto)
  while (auto) {
    await hacerTick()
    const quieto = !E.tareas.some((t) => t.estado === 'pendiente' || t.estado === 'asignada')
    await dormir(quieto ? 6000 : 1800)
  }
}



// ─── arranque ───────────────────────────────────────────────────────────

let etagEstado = null
let firmaHud = ''
let firmaCronica = ''

/**
 * El estado, con ETag: si no cambió nada, el servidor contesta 304 sin cuerpo y no hay nada que leer ni comparar.
 * null = no cambió.
 */
async function traerEstado() {
  const r = await fetch('/api/estado', { cache: 'no-store', headers: etagEstado ? { 'if-none-match': etagEstado } : {} })
  if (r.status === 304) return null
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
  etagEstado = r.headers.get('etag')
  return j
}

/** Trae el estado y re-dibuja solo si cambió algo (el polling no debe pisar animaciones ni hovers). */
async function refrescar({ forzar = true } = {}) {
  const nuevo = await traerEstado()
  if (!nuevo && !forzar) return
  if (nuevo) E = nuevo
  // Cada parte se redibuja solo si cambió lo suyo (antes, cualquier cambio del estado rehacía el HUD y la crónica entera).
  const fHud = JSON.stringify([vista, E.roster.map((f) => f.estado), E.liga.tareas, E.uso, E.hoy.total, E.hoy.hechos, E.hoy.run?.estado, E.memoriaSinRevisar, E.enEspera, E.nTick, E.gasto])
  if (forzar || fHud !== firmaHud) { firmaHud = fHud; renderHud() }
  const ult = E.cronica.at(-1)
  const fCron = `${E.cronica.length}|${ult?.id ?? ''}|${ult?.texto ?? ''}`
  if (forzar || fCron !== firmaCronica) { firmaCronica = fCron; renderCronica() }
  avisarSiHayNovedad()
  traerMencionables()
  pintarIndicadorDirecto()
  const fv = firmaDeVista(vista)
  if (forzar || fv === null || fv !== firmasVista[vista]) {
    firmasVista[vista] = fv
    VISTAS[vista].refrescar()
  }
}

let ultimoAviso = 0
/** Si Mastropiero dejó algo solo en Hoy (la jornada, el cierre), avisa: toast y, si hay permiso, notificación del sistema. */
function avisarSiHayNovedad() {
  const a = E.hoy?.aviso
  if (!a || a.id <= ultimoAviso) return
  ultimoAviso = a.id
  const corto = a.texto.length > 140 ? `${a.texto.slice(0, 140)}…` : a.texto
  toast(`☿ Mastropiero<small>${esc(corto)}</small>`)
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      const n = new Notification('Mastropiero', { body: corto, tag: 'mastropiero-hoy' })
      n.onclick = () => { window.focus(); irA('hoy') }
    }
  } catch { /* sin notificaciones del sistema */ }
  if (vista === 'hoy' && chat.actual?.modo === 'hoy') abrirConversacion(chat.actual.id)
}

async function iniciar() {
  META = await api('/meta')
  R = META.reglas
  E = await api('/estado')
  cronicaVista = E.cronica.length
  renderHud()
  renderCronica()
  ultimoAviso = E.hoy.aviso?.id ?? 0
  await traerMencionables()
  $('#btn-directo').onclick = modalDirecto
  pintarIndicadorDirecto()
  irA(location.hash.slice(1) || 'hoy')
  window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== vista) irA(location.hash.slice(1)) })
  // Su hora, no la del servidor: la zona del navegador viaja una vez (o cuando cambia, si viaja).
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (z && pref.leer('mastro-zona', '') !== z) api('/zona', { zona: z }).then(() => pref.guardar('mastro-zona', z)).catch(() => {})
  } catch { /* sin Intl: queda la del servidor */ }
  // El polling: cada 7 s mientras la usás; cada ~30 s si la pantalla está quieta hace más de 5 minutos; nada con la
  // pestaña oculta (al volver, se pone al día enseguida).
  let ultimaActividad = Date.now()
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => (ultimaActividad = Date.now()), { passive: true })
  let vueltas = 0
  setInterval(() => {
    if (document.hidden || tickEnCurso || !$('#velo').hidden || vista === 'forja') return
    if (Date.now() - ultimaActividad > 5 * 60_000 && vueltas++ % 4) return
    refrescar({ forzar: false }).catch(() => {})
  }, 7000)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    ultimaActividad = Date.now()
    refrescar({ forzar: false }).catch(() => {})
  })
}

iniciar().catch(error)

// La app instalable (PWA): el service worker solo guarda la cáscara; los datos siempre van al servidor.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
if (new URLSearchParams(location.search).has('compartido')) {
  history.replaceState(null, '', '/')
  setTimeout(() => toast('Recibido<small>Lo guardé y se lo pasé a Mastropiero.</small>'), 1500)
}
