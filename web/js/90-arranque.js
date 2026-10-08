'use strict'
// ─── vistas ─────────────────────────────────────────────────────────────

const VISTAS = {
  hoy: { montar: montarHoy, refrescar: refrescarHoy },
  misiones: { montar: montarMisionesVida, refrescar: refrescarMisionesVida },
  jugador: { montar: montarJugador, refrescar: refrescarJugador },
  personas: { montar: montarPersonas, refrescar: refrescarPersonas },
  directo: { montar: montarDirecto, refrescar: refrescarDirecto },
  radar: { montar: montarRadar, refrescar: refrescarRadar },
  taller: { montar: montarTaller, refrescar: refrescarTaller },
  cuentas: { montar: montarCuentas, refrescar: refrescarCuentas },
  chat: { montar: montarChat, refrescar: () => pintarLado() },
  entidades: { montar: montarEntidades, refrescar: refrescarEntidades },
  liga: { montar: montarLiga, refrescar: refrescarLiga },
  forja: { montar: montarForja, refrescar: () => {} },
  encargos: { montar: montarMisiones, refrescar: refrescarTablero },
  corpus: { montar: montarCorpus, refrescar: refrescarCorpus },
  quantomos: { montar: montarQuantomos, refrescar: refrescarQuantomos },
  matriz: { montar: montarMatriz, refrescar: montarMatriz },
  cementerio: { montar: montarCementerio, refrescar: montarCementerio },
}

function irA(v) {
  vista = v
  const enMaquina = VISTAS_MAQUINA.has(v)
  document.body.classList.toggle('en-maquina', enMaquina)
  if (enMaquina) abrirMaquina(true)
  if (E) renderHud()
  $('#principal').classList.toggle('lleno', v === 'chat' || v === 'hoy')
  aplicarCronica()
  $$('#nav button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === (v === 'quantomos' ? 'corpus' : v)))
  VISTAS[v].montar()
  $('#principal').scrollTop = 0
}
/** El grupo «La máquina»: plegado por defecto; se abre solo si entrás a una de sus vistas. */
function abrirMaquina(abierta) {
  $('#nav-sub-maquina').classList.toggle('abierta', abierta)
  $('#nav-maquina em').textContent = abierta ? '▾' : '▸'
}
$('#nav-maquina').onclick = () => {
  const abierta = !$('#nav-sub-maquina').classList.contains('abierta')
  abrirMaquina(abierta)
  pref.guardar('mastro-maquina', abierta ? 'si' : 'no')
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vista]')
  if (b) irA(b.dataset.vista)
})


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
abrirMaquina(pref.leer('mastro-maquina', 'no') === 'si')
function aplicarCronica() {
  // La crónica es de la liga: se ve en la máquina (si la querés), no en tus vistas.
  const ver = cronicaVisible && VISTAS_MAQUINA.has(vista)
  document.body.classList.toggle('sin-cronica', !ver)
  document.body.classList.toggle('con-cronica', ver)
  $('#btn-cronica').classList.toggle('on', cronicaVisible)
}
$('#btn-cronica').onclick = () => { cronicaVisible = !cronicaVisible; pref.guardar('mastro-cronica', cronicaVisible ? 'si' : 'no'); aplicarCronica() }
$('#btn-tema').onclick = () => {
  const claro = document.documentElement.dataset.tema !== 'claro'
  if (claro) document.documentElement.dataset.tema = 'claro'
  else delete document.documentElement.dataset.tema
  pref.guardar('mastro-tema', claro ? 'claro' : 'oscuro')
}

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

let firma = ''

/** Trae el estado y re-dibuja solo si cambió algo (el polling no debe pisar animaciones ni hovers). */
async function refrescar({ forzar = true } = {}) {
  const nuevo = await api('/estado')
  const f = JSON.stringify(nuevo)
  if (!forzar && f === firma) return
  firma = f
  E = nuevo
  renderHud()
  renderCronica()
  avisarSiHayNovedad()
  traerMencionables()
  pintarIndicadorDirecto()
  VISTAS[vista].refrescar()
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
  irA('hoy')
  firma = JSON.stringify(E)
  setInterval(() => { if (!tickEnCurso && $('#velo').hidden && vista !== 'forja') refrescar({ forzar: false }).catch(() => {}) }, 7000)
}

iniciar().catch(error)

// La app instalable (PWA): el service worker solo guarda la cáscara; los datos siempre van al servidor.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
if (new URLSearchParams(location.search).has('compartido')) {
  history.replaceState(null, '', '/')
  setTimeout(() => toast('Recibido<small>Lo guardé y se lo pasé a Mastropiero.</small>'), 1500)
}
