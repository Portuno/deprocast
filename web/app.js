// Mastropiero · la pantalla de juego. Sin build: módulos nativos, render con template strings.

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(ruta, cuerpo) {
  const r = await fetch('/api' + ruta, cuerpo === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
  return j
}

let META = null
let E = null
let R = null
let vista = 'liga'
let auto = false
let tickEnCurso = false
let cronicaVista = 0
const nuevas = new Set()
const filtro = { clase: null, estado: null }
const forja = { clase: null, reparto: {}, motor: '', instrucciones: '', proyectoId: '', celda: null }
const mision = { clase: 'buscador', proyectoId: '' }

const claseDe = (id) => META.clases.find((c) => c.id === id)
const colorDe = (id) => `var(--${id})`
const ESTADOS_CORPUS = ['crudo', 'extraido', 'clasificado', 'disponible']
const OFICIOS = ['Input·Cuerpo', 'Input·Mente', 'Input·Alma', 'Proc·Cuerpo', 'Proc·Mente', 'Proc·Alma', 'Output·Cuerpo', 'Output·Mente', 'Output·Alma']
const ICONO = { purga: '✝', asigna: '→', recluta: '+', vacante: '?', corre: '✓', falla: '✗', nivel: '▲', bautismo: '★', promovido: '◆', banca: '⇣', retirado: '✝', publica: '↻' }

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

// ─── toasts y modal ─────────────────────────────────────────────────────

function toast(html, tipo = '') {
  const t = document.createElement('div')
  t.className = `toast ${tipo}`
  t.innerHTML = html
  $('#toasts').append(t)
  setTimeout(() => t.remove(), 3700)
}
const error = (e) => toast(esc(e.message ?? e), 'error')

function abrirModal(html) {
  $('#modal').innerHTML = html
  $('#velo').hidden = false
}
function cerrarModal() {
  $('#velo').hidden = true
  $('#modal').innerHTML = ''
}
$('#velo').addEventListener('click', (e) => { if (e.target.id === 'velo' || e.target.closest('[data-cerrar]')) cerrarModal() })
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarModal()
  const escribiendo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')
  if (e.code === 'Space' && !escribiendo && $('#velo').hidden) { e.preventDefault(); hacerTick() }
})

// ─── carta ──────────────────────────────────────────────────────────────

function pips(base, total, max = 6) {
  let s = ''
  for (let i = 0; i < max; i++) s += `<i class="${i < base ? 'b' : i < total ? 'x' : ''}"></i>`
  return `<span class="pips">${s}</span>`
}

function cartaHTML(f) {
  const c = claseDe(f.clase)
  const pct = f.xpTecho ? Math.max(0, Math.min(100, ((f.xp - f.xpPiso) / (f.xpTecho - f.xpPiso)) * 100)) : 100
  const nombre = f.nombre
    ? `<div class="nombre">${esc(f.nombre)}</div>`
    : f.puedeBautizar
      ? `<div class="nombre bautismo">★ bautismo pendiente</div>`
      : `<div class="nombre sin">sin nombre · se gana en nv ${R.NIVEL_BAUTISMO}</div>`
  const stats = META.atributos.map((a) => `<li>${a.sigla}${pips(c.base[a.id], f.atributos[a.id])}</li>`).join('')
  const cls = ['carta', `nv-${f.nivel}`, f.estado, nuevas.has(f.id) ? 'nueva' : ''].join(' ')
  return `<article class="${cls}" style="--c:${colorDe(f.clase)}" data-agente="${esc(f.id)}">
    <div class="tope"><span class="glifo">${c.glifo}</span><span>${esc(f.id)}</span><span class="nv" title="Nivel">${f.nivel}</span></div>
    <div class="arte">${f.estado === 'prueba' ? `<em class="cinta">PRUEBA ${f.exitos}/${R.PRUEBA_EXITOS}</em>` : ''}<span>${c.glifo}</span>${f.celdaInfo ? `<em class="celda72">⬡ ${f.celdaInfo.etiqueta}</em>` : ''}</div>
    ${nombre}
    <div class="clase">${esc(c.nombre)}${f.especializacion ? ` <em>· ${esc(f.especializacion)}</em>` : f.proyectoId ? ` <em>· ${esc(f.proyectoId)}</em>` : ''}</div>
    <div class="xp"><div style="width:${pct}%"></div></div>
    <div class="xp-txt"><span>${f.xp} XP</span><span>${f.xpTecho ? `→ ${f.xpTecho}` : 'MÁX'}</span></div>
    <ul class="stats">${stats}</ul>
    <footer><span class="pill ${f.estado}">${f.estado}</span><span>✓${f.exitos} ✗${f.fallos}</span><span class="motor" title="${esc(f.motor)}">${esc(f.motor)}</span></footer>
  </article>`
}

// ─── HUD y crónica ──────────────────────────────────────────────────────

function renderHud() {
  const r = E.roster
  const cuenta = (e) => r.filter((f) => f.estado === e).length
  const t = Object.fromEntries(E.liga.tareas.map((x) => [x.estado, x.n]))
  const tokens = E.uso.reduce((s, u) => s + u.tokens, 0)
  const stat = (k, v, extra = '') => `<div class="stat"><small>${k}</small><b>${v}</b>${extra ? `<em>${extra}</em>` : ''}</div>`
  $('#hud').innerHTML = [
    stat('Hoy', E.hoy.total ? `${E.hoy.hechos}/${E.hoy.total}` : '—', E.hoy.total ? 'bloques' : 'sin jornada'),
    stat('Memoria', E.memoriaSinRevisar || '✓', E.memoriaSinRevisar ? 'por revisar' : 'al día'),
    stat('Roster', r.length, `${cuenta('activo')} act · ${cuenta('prueba')} prueba`),
    stat('Bus', t.pendiente ?? 0, `pend · ${t.hecha ?? 0} hechas`),
    stat('NaN este mes', fmtTokens(tokens), 'tokens'),
    stat('Tick', E.nTick),
  ].join('')
}

function renderCronica() {
  const lista = E.cronica
  if (!lista.length) {
    $('#cronica-lista').innerHTML = `<p style="color:var(--tenue);font-size:13px;padding:0 6px">Todavía no pasó nada. Apretá <b>Tick</b> (o la barra espaciadora) y Mastropiero purga, reparte y hace correr a la liga.</p>`
    return
  }
  const grupos = new Map()
  lista.forEach((e, i) => {
    if (!grupos.has(e.tick)) grupos.set(e.tick, [])
    grupos.get(e.tick).push({ ...e, i })
  })
  $('#cronica-lista').innerHTML = [...grupos].reverse().map(([tick, evs]) => `
    <div class="tick-grupo"><small>TICK ${tick}</small>
      ${evs.map((e) => `<div class="ev ${e.tipo} ${e.i >= cronicaVista ? 'nuevo' : ''}"><i>${ICONO[e.tipo] ?? '·'}</i><span>${esc(e.texto)}</span></div>`).join('')}
    </div>`).join('')
  cronicaVista = lista.length
}

// ─── vistas ─────────────────────────────────────────────────────────────

const VISTAS = {
  hoy: { montar: montarHoy, refrescar: refrescarHoy },
  norte: { montar: montarNorte, refrescar: refrescarNorte },
  chat: { montar: montarChat, refrescar: () => pintarLado() },
  entidades: { montar: montarEntidades, refrescar: refrescarEntidades },
  liga: { montar: montarLiga, refrescar: refrescarLiga },
  forja: { montar: montarForja, refrescar: () => {} },
  misiones: { montar: montarMisiones, refrescar: refrescarTablero },
  corpus: { montar: montarCorpus, refrescar: refrescarCorpus },
  quantomos: { montar: montarQuantomos, refrescar: refrescarQuantomos },
  matriz: { montar: montarMatriz, refrescar: montarMatriz },
  cementerio: { montar: montarCementerio, refrescar: montarCementerio },
}

function irA(v) {
  vista = v
  $('#principal').classList.toggle('lleno', v === 'chat' || v === 'hoy')
  aplicarCronica()
  $$('#nav button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === (v === 'quantomos' ? 'corpus' : v)))
  VISTAS[v].montar()
  $('#principal').scrollTop = 0
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vista]')
  if (b) irA(b.dataset.vista)
})

// Liga

function montarLiga() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>La Liga</h1>
      <p>Las cartas vivas. Un agente que no corre en ${R.DIAS_SIN_CORRER} días se borra, no se mejora.</p>
      <div class="fila"><button class="btn" id="nuevo-proyecto">+ Proyecto</button><button class="btn btn-primario" id="ir-forja">⚒ Forjar</button></div>
    </div>
    <div id="liga-dyn"></div>`
  $('#ir-forja').onclick = () => irA('forja')
  $('#nuevo-proyecto').onclick = modalProyecto
  refrescarLiga()
}

function refrescarLiga() {
  const dyn = $('#liga-dyn')
  if (!dyn) return
  const r = E.roster
  if (!r.length) {
    const sinPartida = !E.liga.proyectos.length
    dyn.innerHTML = `<div class="vacio"><div class="gran">☿</div><h2>La liga está vacía</h2>
      <p>Mastropiero es la liga: ingiere todo, pero las cartas las forjás vos (o los reclutas que él mismo crea cuando falta alguien).</p>
      <div class="fila" style="justify-content:center;margin-top:18px">
        <button class="btn btn-primario" data-ir="forja">⚒ Forjar el primer agente</button>
        ${sinPartida ? '<button class="btn" id="ejemplo">Cargar partida de ejemplo</button>' : ''}
      </div></div>`
    dyn.querySelector('[data-ir]').onclick = () => irA('forja')
    const ej = $('#ejemplo')
    if (ej) ej.onclick = cargarEjemplo
    return
  }
  const proys = E.liga.proyectos.map((p) => {
    const g = r.find((f) => f.clase === 'gerente' && f.proyectoId === p.id)
    return `<div class="proyecto"><b>${esc(p.nombre)}</b><span style="color:var(--tenue)">${g ? `♛ ${esc(g.nombre ?? g.id)}` : 'sin gerente'}</span></div>`
  }).join('')
  const porClase = META.clases.map((c) => {
    const n = r.filter((f) => f.clase === c.id).length
    return n ? `<button class="chip ${filtro.clase === c.id ? 'on' : ''}" style="--c:${colorDe(c.id)}" data-fclase="${c.id}">${c.glifo} ${esc(c.nombre)} ${n}</button>` : ''
  }).join('')
  const porEstado = ['prueba', 'activo', 'banca'].map((e) => `<button class="chip ${filtro.estado === e ? 'on' : ''}" data-festado="${e}">${e}</button>`).join('')
  const visibles = r.filter((f) => (!filtro.clase || f.clase === filtro.clase) && (!filtro.estado || f.estado === filtro.estado))
  dyn.innerHTML = `
    ${proys ? `<div class="proyectos">${proys}</div>` : ''}
    <div class="chips">${porClase}<span style="width:12px"></span>${porEstado}</div>
    <div class="mazo">${visibles.map(cartaHTML).join('')}</div>`
  $$('[data-fclase]', dyn).forEach((b) => (b.onclick = () => { filtro.clase = filtro.clase === b.dataset.fclase ? null : b.dataset.fclase; refrescarLiga() }))
  $$('[data-festado]', dyn).forEach((b) => (b.onclick = () => { filtro.estado = filtro.estado === b.dataset.festado ? null : b.dataset.festado; refrescarLiga() }))
  nuevas.clear()
}

async function cargarEjemplo() {
  try {
    await api('/ejemplo', {})
    toast('Partida de ejemplo cargada<small>Ulpianito con su gerente, dos agentes y 4 piezas en la pipeline. Dale Tick.</small>')
    await refrescar()
  } catch (e) { error(e) }
}

function modalProyecto() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Nuevo proyecto</h2>
    <p style="color:var(--tenue)">Cada proyecto nace con su gerente: el entrenador que reparte sus misiones.</p>
    <label class="campo">Nombre<input id="p-nombre" placeholder="Ulpianito, Corruptopolis, Studianta…" autofocus></label>
    <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="p-crear">Crear con gerente</button></div>`)
  const crear = async () => {
    try {
      const r = await api('/proyectos', { nombre: $('#p-nombre').value })
      nuevas.add(r.gerente.id)
      cerrarModal()
      toast(`♛ ${esc(r.gerente.id)} entrena ${esc(r.id)}`)
      await refrescar()
    } catch (e) { error(e) }
  }
  $('#p-crear').onclick = crear
  $('#p-nombre').onkeydown = (e) => e.key === 'Enter' && crear()
}

// Forja

function montarForja() {
  if (!forja.clase) forja.clase = META.clases[0].id
  $('#principal').innerHTML = `
    <div class="titulo"><h1>La Forja</h1><p>Elegí clase, repartí ${R.PUNTOS_LIBRES} puntos y dale alma. Nace en prueba: ${R.PRUEBA_EXITOS} éxitos y juega; ${R.PRUEBA_FALLOS} fallos y se retira.</p></div>
    <div class="forja">
      <section class="panel"><h3>1 · Clase</h3><div class="clases" id="f-clases"></div>
        <div class="omni"><b>☿ Omnívoro</b> — la décima clase no se forja: es Mastropiero, la liga entera.</div></section>
      <section class="panel"><h3>2 · Atributos</h3><div id="f-atr"></div></section>
      <section class="panel alma"><h3>3 · Alma</h3>
        <label class="campo">Motor<select id="f-motor"></select></label>
        <label class="campo">Proyecto<select id="f-proy"></select></label>
        <div><label class="campo">Celda de la Matriz 72</label>
          <div class="fila" style="margin-top:5px"><button class="btn btn-chico" id="f-celda"></button><button class="btn btn-chico" id="f-celda-x">quitar</button></div></div>
        <label class="campo campo-ancho">Instrucciones<textarea id="f-instr" placeholder="Qué hace y cómo. Vacío = el contrato de la clase."></textarea></label>
      </section>
      <section class="vista-previa"><div id="f-prev"></div>
        <button class="btn btn-primario forjar" id="f-forjar">FORJAR</button></section>
    </div>`
  $('#f-instr').value = forja.instrucciones
  $('#f-instr').oninput = (e) => { forja.instrucciones = e.target.value }
  $('#f-proy').innerHTML = `<option value="">— agente libre (sirve a cualquiera) —</option>` + E.liga.proyectos.map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')
  $('#f-proy').value = forja.proyectoId
  $('#f-proy').onchange = (e) => { forja.proyectoId = e.target.value }
  $('#f-celda').onclick = () => modalMatriz((n) => { forja.celda = n; pintarForja() })
  $('#f-celda-x').onclick = () => { forja.celda = null; pintarForja() }
  $('#f-forjar').onclick = forjar
  pintarForja()
}

function gastados() {
  return Object.values(forja.reparto).reduce((s, v) => s + v, 0)
}

function pintarForja() {
  const c = claseDe(forja.clase)
  $('#f-clases').innerHTML = META.clases.map((k) => `
    <button class="clase-btn ${k.id === forja.clase ? 'on' : ''}" style="--c:${colorDe(k.id)}" data-clase="${k.id}">
      <b>${k.glifo}</b><strong>${esc(k.nombre)}</strong><small>${esc(k.produce)}</small></button>`).join('')
  $$('[data-clase]').forEach((b) => (b.onclick = () => {
    if (forja.clase !== b.dataset.clase) { forja.clase = b.dataset.clase; forja.reparto = {}; forja.motor = '' }
    pintarForja()
  }))

  const libres = R.PUNTOS_LIBRES - gastados()
  $('#f-atr').innerHTML = `
    <div class="puntos"><span style="color:var(--tenue);font-size:13px">Puntos libres</span><span class="orbes">${Array.from({ length: R.PUNTOS_LIBRES }, (_, i) => `<i class="${i < libres ? 'lleno' : ''}"></i>`).join('')}</span></div>
    <div class="atr-lista">${META.atributos.map((a) => {
      const base = c.base[a.id]
      const extra = forja.reparto[a.id] ?? 0
      return `<div class="atr" style="--c:${colorDe(c.id)}">
        <div class="nom"><em>${a.sigla}</em>${esc(a.nombre)}</div>
        <div class="ef">${esc(a.efecto)}</div>
        <div class="ctl"><button data-menos="${a.id}" ${extra ? '' : 'disabled'}>−</button>${pips(base, base + extra)}<button data-mas="${a.id}" ${libres && base + extra < R.ATRIBUTO_MAX ? '' : 'disabled'}>+</button></div>
      </div>`
    }).join('')}</div>`
  $$('[data-mas]').forEach((b) => (b.onclick = () => { forja.reparto[b.dataset.mas] = (forja.reparto[b.dataset.mas] ?? 0) + 1; pintarForja() }))
  $$('[data-menos]').forEach((b) => (b.onclick = () => { forja.reparto[b.dataset.menos] -= 1; pintarForja() }))

  const motores = META.motores.filter((m) => (c.id === 'ejecutivo') === m.startsWith('funcion:'))
  if (!motores.includes(forja.motor)) forja.motor = motores.includes(META.motorDefecto) ? META.motorDefecto : motores[0]
  $('#f-motor').innerHTML = motores.map((m) => `<option ${m === forja.motor ? 'selected' : ''}>${esc(m)}</option>`).join('')
  $('#f-motor').onchange = (e) => { forja.motor = e.target.value; pintarPrevia() }
  $('#f-celda').textContent = forja.celda ? `⬡ ${String(forja.celda).padStart(2, '0')} · elegir otra` : '⬡ elegir celda'
  pintarPrevia()
}

function pintarPrevia() {
  const c = claseDe(forja.clase)
  const atributos = Object.fromEntries(META.atributos.map((a) => [a.id, c.base[a.id] + (forja.reparto[a.id] ?? 0)]))
  const sigla = c.sigla
  const f = {
    id: `${sigla}-????`, clase: c.id, nombre: null, xp: 0, nivel: 1, xpPiso: 0, xpTecho: META.capas[1].xp, atributos,
    estado: 'prueba', exitos: 0, fallos: 0, motor: forja.motor, proyectoId: forja.proyectoId || null, especializacion: null,
    celdaInfo: forja.celda ? { etiqueta: String(forja.celda).padStart(2, '0') } : null, puedeBautizar: false,
  }
  const ruta = forja.motor === 'nan'
    ? (c.cadenaNan.length ? c.cadenaNan.map((m) => `<b>${esc(m)}</b>`).join(' → ') : 'no usa modelo')
    : forja.motor === 'local' ? 'sin modelo: determinístico' : esc(forja.motor)
  $('#f-prev').innerHTML = `${cartaHTML(f)}
    <div class="ruta">Ruta: ${ruta}<br>Contrato: <b>${esc(c.salida)}</b></div>
    <div class="reglas">XP +10 por misión cumplida. Nombre al nivel ${R.NIVEL_BAUTISMO}. Cada nivel abre una capa de contexto. ${R.RACHA_BANCA} fallos seguidos → banca.</div>`
}

async function forjar() {
  try {
    const f = await api('/forja', { clase: forja.clase, reparto: forja.reparto, motor: forja.motor, instrucciones: forja.instrucciones, proyectoId: forja.proyectoId, celda: forja.celda })
    nuevas.add(f.id)
    forja.reparto = {}
    forja.instrucciones = ''
    forja.celda = null
    await refrescar()
    abrirModal(`<div style="display:grid;grid-template-columns:240px 1fr;gap:22px;align-items:center">
      ${cartaHTML(f)}
      <div><h2>¡${esc(f.id)} fue forjado!</h2>
        <p style="color:var(--tenue)">Entra en <b>prueba</b>. Necesita ${R.PRUEBA_EXITOS} misiones cumplidas para ganarse el roster. Si en ${R.DIAS_SIN_CORRER} días no corre, se borra.</p>
        <div class="fila"><button class="btn" data-cerrar id="otra">Forjar otro</button><button class="btn" id="encargar">Encargarle una misión</button><button class="btn btn-primario" id="a-liga">Ir a la liga</button></div></div></div>`)
    $('#otra').onclick = () => { cerrarModal(); montarForja() }
    $('#a-liga').onclick = () => { cerrarModal(); nuevas.add(f.id); irA('liga') }
    $('#encargar').onclick = () => { cerrarModal(); mision.clase = f.clase; mision.proyectoId = f.proyectoId ?? ''; irA('misiones') }
  } catch (e) { error(e) }
}

// Misiones

function montarMisiones() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Misiones</h1><p>El bus: una sola cola. Publicás para una clase; el gerente (o Mastropiero) elige quién la corre. Nadie llama a nadie.</p></div>
    <div class="panel">
      <div class="form-mision">
        <label class="campo">Clase<select id="m-clase">${META.clases.map((c) => `<option value="${c.id}" ${c.id === mision.clase ? 'selected' : ''}>${c.glifo} ${esc(c.nombre)}</option>`).join('')}</select></label>
        <label class="campo">Misión<input id="m-texto" placeholder="Qué hay que hacer…"></label>
        <label class="campo">Proyecto<select id="m-proy"><option value="">— libre —</option>${E.liga.proyectos.map((p) => `<option value="${esc(p.id)}" ${p.id === mision.proyectoId ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
        <label class="campo">Dominio<input id="m-dom" placeholder="derecho, captura…"></label>
        <button class="btn btn-primario" id="m-publicar">Publicar</button>
      </div>
      <div id="m-extra"></div>
    </div>
    <div class="tablero" id="tablero"></div>`
  const extra = () => {
    mision.clase = $('#m-clase').value
    $('#m-extra').innerHTML = mision.clase === 'crawler'
      ? `<label class="campo">URL a traer<input id="m-url" placeholder="https://…"></label>`
      : mision.clase === 'auditor'
        ? `<label class="campo">Agente a auditar (opcional)<select id="m-ag"><option value="">— toda la liga —</option>${E.roster.map((f) => `<option>${esc(f.id)}</option>`).join('')}</select></label>`
        : ''
  }
  $('#m-clase').onchange = extra
  $('#m-proy').onchange = (e) => { mision.proyectoId = e.target.value }
  extra()
  const publicar = async () => {
    try {
      const t = await api('/tareas', {
        clase: $('#m-clase').value, texto: $('#m-texto').value, proyectoId: $('#m-proy').value, dominio: $('#m-dom').value,
        url: $('#m-url')?.value, agenteId: $('#m-ag')?.value,
      })
      $('#m-texto').value = ''
      toast(`Misión #${t.id} en el bus<small>Dale Tick para que alguien la tome.</small>`, 'suave')
      await refrescar()
    } catch (e) { error(e) }
  }
  $('#m-publicar').onclick = publicar
  $('#m-texto').onkeydown = (e) => e.key === 'Enter' && publicar()
  refrescarTablero()
}

function refrescarTablero() {
  const tab = $('#tablero')
  if (!tab) return
  const cols = [['pendiente', 'Pendientes'], ['asignada', 'Asignadas'], ['hecha', 'Cumplidas'], ['fallida', 'Fallidas']]
  tab.innerHTML = cols.map(([estado, titulo]) => {
    const ts = E.tareas.filter((t) => t.estado === estado)
    return `<div class="columna"><h3><span>${titulo}</span><span>${ts.length}</span></h3>
      ${ts.slice(0, 40).map((t) => {
        const c = claseDe(t.clase)
        const txt = t.payload?.texto || t.payload?.titulo || t.payload?.url || t.tipo
        return `<div class="mision" style="--c:${colorDe(t.clase)}" data-tarea="${t.id}">
          <div class="m-top"><span>#${t.id} ${c.glifo} ${esc(c.nombre)}</span><span>${esc(t.asignadaA ?? '')}</span></div>
          <div class="m-txt">${t.pipeline ? `<b style="color:var(--tenue)">ingesta ${t.etapa + 1}/3 ·</b> ` : ''}${esc(txt)}</div>
          ${t.error ? `<div class="m-err">✗ ${esc(t.error)}</div>` : ''}
        </div>`
      }).join('')}</div>`
  }).join('')
}

async function modalTarea(id) {
  try {
    const t = await api(`/tareas/${id}`)
    const c = claseDe(t.clase)
    const r = t.resultado
    let destacado = ''
    if (r?.respuesta) destacado = `<div class="respuesta">${esc(r.respuesta)}</div><p style="color:var(--tenue)">Citas: ${(r.citas ?? []).map((x) => `<b>[${x}]</b>`).join(' ')}</p>`
    else if (r?.texto) destacado = `<div class="respuesta">${esc(r.texto)}</div>`
    else if (r?.hallazgos) destacado = `<div class="respuesta"><b>${esc(r.veredicto)}</b>\n${r.hallazgos.map((h) => '• ' + esc(h)).join('\n')}</div>`
    else if (r?.efecto) destacado = `<div class="respuesta">${esc(r.efecto)}</div>`
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <h2 style="color:${colorDe(t.clase)}">${c.glifo} Misión #${t.id}</h2>
      <p style="color:var(--tenue)">${esc(c.nombre)} · ${esc(t.estado)} · ${t.intentos} intento(s) · publicada por ${esc(t.publicadaPor)}
        ${t.asignadaA ? ` · corrida por <a href="#" data-ver-agente="${esc(t.asignadaA)}" style="color:var(--oro-2)">${esc(t.asignadaA)}</a>` : ''}
        ${t.asignadaPor ? ` (asignó ${esc(t.asignadaPor)})` : ''}</p>
      ${t.error ? `<div class="respuesta" style="background:#2a1111;border-color:#5b2a2a">✗ ${esc(t.error)}</div>` : ''}
      ${destacado}
      <h3 style="color:var(--tenue);font-size:12px;letter-spacing:.12em">PAYLOAD</h3><pre class="json">${esc(JSON.stringify(t.payload, null, 2))}</pre>
      ${r ? `<h3 style="color:var(--tenue);font-size:12px;letter-spacing:.12em">RESULTADO</h3><pre class="json">${esc(JSON.stringify(r, (k, v) => (k === 'embedding' && Array.isArray(v) ? `[${v.length} dimensiones]` : v), 2))}</pre>` : ''}`)
  } catch (e) { error(e) }
}

// Hoy

let hoyDatos = null
let hoyFirma = ''
let hoyScrolleado = false
const DIA_LETRA = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const minutosAhora = () => new Date().getHours() * 60 + new Date().getMinutes()
const aMinJs = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

async function montarHoy() {
  $('#principal').classList.add('lleno')
  $('#principal').innerHTML = `<div class="hoy"><section class="hoy-dia" id="hoy-dia"></section><section class="chat-main hoy-chat">${hiloHTMLBase()}</section></div>`
  engancharCompositor()
  hoyScrolleado = false
  await traerHoy()
  await traerConversaciones()
  if (hoyDatos) await abrirConversacion(hoyDatos.conversacion)
}

function refrescarHoy() {
  const f = JSON.stringify(E.hoy)
  if (f !== hoyFirma) { hoyFirma = f; traerHoy() }
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
  const { fecha, jornada: j, progreso: p, semana, rutinas, calendarios } = hoyDatos
  const ahora = minutosAhora()
  const rutJ = rutinas.find((r) => r.id === 'jornada')
  const fechaTxt = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const barras = semana.map((d) => {
    const dia = new Date(`${d.fecha}T12:00:00`)
    return `<div class="sem-dia ${d.fecha === fecha ? 'hoy' : ''}" title="${dia.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' })}: ${d.hechos} de ${d.total}">
      <span><i style="height:${d.total ? Math.round((d.hechos / d.total) * 100) : 0}%"></i></span><small>${DIA_LETRA[dia.getDay()]}</small></div>`
  }).join('')
  const avisoNotif = 'Notification' in window && Notification.permission === 'default'
  cont.innerHTML = `
    <header class="hoy-cab">
      <div><small>Hoy</small><h1>${esc(fechaTxt)}</h1>
        <p class="tenue">${j ? `${p.hechos} de ${p.total} bloques${p.saltados ? ` · ${p.saltados} saltados` : ''}` : 'Todavía sin jornada'}</p></div>
      <div class="semana" title="Bloques hechos por día">${barras}</div>
    </header>
    <div class="fila hoy-acciones">
      <button class="btn btn-chico ${j ? '' : 'btn-primario'}" id="hoy-armar">${j ? 'Rehacer desde ahora' : 'Armar el día'}</button>
      <button class="btn btn-chico btn-icono" id="hoy-ajustes" title="Horarios y rutinas">⚙</button>
      ${avisoNotif ? '<button class="btn btn-chico" id="hoy-notif">Activar avisos</button>' : ''}
    </div>
    ${j?.resumen ? `<p class="hoy-resumen">${esc(j.resumen)}</p>` : ''}
    ${j ? `<ol class="bloques">${j.bloques.map((b) => {
      const ini = aMinJs(b.inicio)
      const fin = aMinJs(b.fin)
      const clase = [b.estado, ini <= ahora && ahora < fin ? 'ahora' : '', fin <= ahora && b.estado === 'pendiente' ? 'pasado' : ''].join(' ')
      return `<li class="bloque ${clase}" data-bloque="${esc(b.id)}">
        <span class="b-hora">${b.inicio}<small>${b.fin}</small></span>
        <div class="b-cuerpo"><b>${esc(b.titulo)}</b>${b.por_que ? `<small>${esc(b.por_que)}</small>` : ''}${b.proyecto ? `<em>${esc(b.proyecto)}</em>` : ''}</div>
        ${b.estado === 'fijo' ? '<span class="b-agenda">agenda</span>' : `<span class="b-acc"><button data-marcar="hecho" title="Hecho" class="${b.estado === 'hecho' ? 'on' : ''}">✓</button><button data-marcar="saltado" title="Saltar" class="${b.estado === 'saltado' ? 'on' : ''}">↷</button></span>`}
      </li>`
    }).join('')}</ol>`
    : `<div class="vacio hoy-vacio"><div class="gran">☀</div><h2>Todavía no armé tu día</h2>
        <p>${rutJ?.activa ? `Lo armo solo a las ${rutJ.hora}, o ahora si me lo pedís.` : 'Pedímelo cuando quieras.'} Uso lo que sé de vos, lo que hablamos y tu agenda.</p></div>`}
    ${j?.cierre ? `<div class="hoy-cierre"><small>Tu cierre</small><p>${esc(j.cierre)}</p></div>` : ''}
    ${calendarios ? '' : `<p class="hoy-nota">Para que tenga en cuenta tu agenda: en Google Calendar, Configuración del calendario → «Dirección secreta en formato iCal», y pegala en <code>.env</code> como <code>GCAL_ICS_URLS</code>.</p>`}`
  // Armar o rehacer: para hoy, siempre desde ahora (lo hecho y lo pasado se conserva).
  $('#hoy-armar').onclick = async () => {
    const b = $('#hoy-armar')
    b.disabled = true
    b.textContent = 'Armando…'
    document.body.classList.add('jugando')
    try {
      const r = await api('/jornada/armar', {})
      if (r.avisos?.length) toast(esc(r.avisos.join(' ')), 'suave')
      await refrescar()
      await traerHoy()
    } catch (e) { error(e); b.disabled = false } finally { document.body.classList.remove('jugando') }
  }
  $('#hoy-ajustes').onclick = modalAjustesHoy
  const nb = $('#hoy-notif')
  if (nb) nb.onclick = async () => { await Notification.requestPermission(); pintarHoy() }
  $$('.bloque [data-marcar]', cont).forEach((btn) => (btn.onclick = async () => {
    const li = btn.closest('[data-bloque]')
    const b = j.bloques.find((x) => x.id === li.dataset.bloque)
    const estado = b.estado === btn.dataset.marcar ? 'pendiente' : btn.dataset.marcar
    try {
      await api(`/jornada/${fecha}/bloques/${encodeURIComponent(b.id)}`, { estado })
      await refrescar()
      await traerHoy()
    } catch (e) { error(e) }
  }))
  if (!hoyScrolleado) {
    hoyScrolleado = true
    $('.bloque.ahora', cont)?.scrollIntoView({ block: 'center' })
  }
}

function modalAjustesHoy() {
  const a = hoyDatos.ajustes
  const r = hoyDatos.rutinas
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Tu día</h2>
    <p class="tenue">La ventana en la que Mastropiero arma bloques, de cuántos minutos, y a qué hora hace cada cosa solo.</p>
    <div class="form-ing">
      <label class="campo">Empieza<input id="aj-ini" type="time" value="${esc(a.jornada_inicio)}"></label>
      <label class="campo">Termina<input id="aj-fin" type="time" value="${esc(a.jornada_fin)}"></label>
      <label class="campo">Bloques (minutos)<input id="aj-min" value="${esc(a.bloques_minutos)}" placeholder="12,25,50"></label>
    </div>
    <h3 class="sub">Rutinas</h3>
    ${r.map((x) => `<div class="fila" style="margin:6px 0"><label class="fila" style="gap:6px;min-width:200px"><input type="checkbox" data-rut-activa="${x.id}" ${x.activa ? 'checked' : ''}> ${esc(x.nombre)}</label>
      <input class="campo-suelto" type="time" data-rut-hora="${x.id}" value="${esc(x.hora)}" style="width:120px;margin:0"></div>`).join('')}
    <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="aj-guardar">Guardar</button></div>`)
  $('#aj-guardar').onclick = async () => {
    try {
      await api('/ajustes', { jornada_inicio: $('#aj-ini').value, jornada_fin: $('#aj-fin').value, bloques_minutos: $('#aj-min').value })
      for (const x of r) await api(`/rutinas/${x.id}`, { hora: $(`[data-rut-hora="${x.id}"]`).value, activa: $(`[data-rut-activa="${x.id}"]`).checked })
      cerrarModal()
      toast('Guardado', 'suave')
      await traerHoy()
    } catch (e) { error(e) }
  }
}

// Norte

const TIPO_REC = { meta: 'meta', vision: 'visión', sueño: 'sueño', preferencia: 'preferencia', hecho: 'hecho', correccion: 'corrección' }
const HORIZ = [['castillo', 'Castillo', 'años · estrategia'], ['campamento', 'Campamento', 'semanas y meses'], ['trinchera', 'Trinchera', 'días']]

function montarNorte() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Norte</h1><p>Tu visión, tus metas y lo que Mastropiero sabe de vos. Se escribe solo con lo que le contás; acá lo corregís.</p>
      <div class="fila"><span class="tenue" id="n-aprende" style="font-size:12.5px"></span><button class="btn" id="n-aprender" title="Lee tus charlas con Mastropiero y tus piezas propias más pesadas (audios, notas, cuaderno) y anota lo que vale recordar">Aprender de lo que ya cargaste</button></div></div>
    <div id="norte"></div>
    <div class="panel" style="margin-top:18px"><h3>Agregar</h3>
      <div class="form-ing">
        <label class="campo campo-ancho">Qué<input id="n-texto" placeholder="Quiero… / Prefiero… / Mi sueño es…"></label>
        <label class="campo">Tipo<select id="n-tipo">${Object.entries(TIPO_REC).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="campo">Horizonte<select id="n-hor"><option value="">—</option>${HORIZ.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      </div>
      <div class="fila" style="margin-top:12px"><button class="btn btn-primario" id="n-agregar">Agregar</button></div>
    </div>`
  $('#n-aprender').onclick = async () => {
    const n = prompt('¿De cuántas cosas tuyas aprendo? (charlas con Mastropiero + tus piezas más pesadas; cada una es una llamada corta al modelo)', '40')
    if (!n) return
    try {
      const r = await api('/memoria/aprender', { limite: Number(n) })
      toast(`Aprendiendo de ${r.total} cosas tuyas<small>Los recuerdos nuevos van apareciendo acá marcados como «nuevo».</small>`, 'suave')
      await refrescar()
    } catch (e) { error(e) }
  }
  $('#n-agregar').onclick = async () => {
    try {
      await api('/memoria', { texto: $('#n-texto').value, tipo: $('#n-tipo').value, horizonte: $('#n-hor').value })
      $('#n-texto').value = ''
      await refrescar()
      traerNorte()
    } catch (e) { error(e) }
  }
  traerNorte()
}

let norteFirma = ''
/** Mientras aprende, el avance se ve y los recuerdos nuevos aparecen solos. */
function refrescarNorte() {
  const a = E.aprendiendo
  const t = $('#n-aprende')
  if (t) t.textContent = a && !a.terminado ? `Aprendiendo… ${a.hechos}/${a.total} · ${a.nuevos} recuerdos nuevos` : a?.terminado ? `Listo: ${a.nuevos} recuerdos nuevos de ${a.total} cosas leídas` : ''
  const btn = $('#n-aprender')
  if (btn) btn.disabled = !!(a && !a.terminado)
  const f = JSON.stringify([E.memoriaSinRevisar, a?.nuevos])
  if (f !== norteFirma) { norteFirma = f; traerNorte() }
}

async function traerNorte() {
  const cont = $('#norte')
  if (!cont) return
  try {
    const ms = await api('/memoria')
    const recuerdo = (r) => `<div class="recuerdo ${r.revisada ? '' : 'nuevo'}" data-rec="${r.id}">
      <p>${esc(r.texto)}</p>
      <div class="r-pie"><small>${esc(r.fecha)} · ${TIPO_REC[r.tipo] ?? r.tipo}${r.revisada ? '' : ' · nuevo'}${r.piezaId ? ` · <a class="ref" data-pieza="${r.piezaId}" title="Ver de qué salió">origen</a>` : ''}</small>
        <span class="r-acc">
          <select data-mover title="Horizonte"><option value="">—</option>${HORIZ.map(([k, n]) => `<option value="${k}" ${r.horizonte === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
          ${r.revisada ? '' : '<button data-revisar title="Está bien">✓</button>'}<button data-editar title="Corregir">✎</button><button data-archivar title="Olvidar">✕</button>
        </span></div></div>`
    const grandes = ms.filter((r) => ['meta', 'vision', 'sueño'].includes(r.tipo))
    const sinUbicar = grandes.filter((r) => !r.horizonte)
    const saber = ms.filter((r) => !['meta', 'vision', 'sueño'].includes(r.tipo))
    cont.innerHTML = !ms.length
      ? `<div class="vacio"><div class="gran">✧</div><h2>Todavía no sé nada de vos</h2><p>Contáselo a Mastropiero en el chat o en el diario: lo que quiere, lo que soñás, cómo te gusta trabajar. Se va guardando solo.</p></div>`
      : `<div class="norte-cols">${HORIZ.map(([k, n, d]) => `<section class="norte-col"><h3>${n}<small>${d}</small></h3>${grandes.filter((r) => r.horizonte === k).map(recuerdo).join('') || '<p class="tenue norte-vacio">—</p>'}</section>`).join('')}</div>
        ${sinUbicar.length ? `<h3 class="sub">Por ubicar</h3><div class="norte-lista">${sinUbicar.map(recuerdo).join('')}</div>` : ''}
        <h3 class="sub">Lo que sé de vos</h3><div class="norte-lista">${saber.map(recuerdo).join('') || '<p class="tenue">Nada todavía.</p>'}</div>`
    const accion = async (f) => { try { await f(); await refrescar(); traerNorte() } catch (e) { error(e) } }
    $$('[data-rec]', cont).forEach((el) => {
      const id = el.dataset.rec
      el.querySelector('[data-mover]').onchange = (e) => accion(() => api(`/memoria/${id}`, { horizonte: e.target.value || null }))
      const rv = el.querySelector('[data-revisar]')
      if (rv) rv.onclick = () => accion(() => api(`/memoria/${id}/revisar`, {}))
      el.querySelector('[data-editar]').onclick = () => {
        const actual = el.querySelector('p').textContent
        const nuevo = prompt('Corregir (la versión vieja queda guardada):', actual)
        if (nuevo && nuevo.trim() && nuevo.trim() !== actual) accion(() => api(`/memoria/${id}`, { texto: nuevo.trim() }))
      }
      el.querySelector('[data-archivar]').onclick = () => { if (confirm('¿Olvidar esto? Deja de usarse, pero queda archivado.')) accion(() => api(`/memoria/${id}/archivar`, {})) }
    })
  } catch (e) { error(e) }
}

// Corpus

const NIVEL_ORDEN = ['propia', 'primaria', 'investigacion', 'generada']
const NIVEL_GLIFO = { propia: '◉', primaria: '❖', investigacion: '⌬', generada: '✶' }
const TIPO_NOMBRE = { materia: 'materia', referencia: 'referencia', ficha: 'ficha', lista: 'lista', enlace: 'enlace' }
const filtroCorpus = { nivel: '', fuente: '', tipo: '', q: '', desde: 0, carga: '' }
let corpusFirma = ''
let corpusLista = { total: 0, piezas: [] }

function nivelBadge(n) {
  const m = META.niveles[n]
  return m ? `<span class="nivel-badge" style="--n:var(--nivel-${n})">${NIVEL_GLIFO[n]} ${m.numero} · ${esc(m.nombre)}</span>` : ''
}

function opcionesFuente(sel, { vacia = '', soloNivel = null } = {}) {
  const fs = E.fuentes
  const raiz = fs.filter((f) => !f.padreId)
  const hijas = (id) => fs.filter((f) => f.padreId === id)
  const op = (f, sangria) => `<option value="${esc(f.id)}" ${f.id === sel ? 'selected' : ''}>${sangria}${esc(f.nombre)} · ${META.niveles[f.nivel].numero}</option>`
  return (vacia ? `<option value="">${esc(vacia)}</option>` : '') +
    raiz.filter((f) => !soloNivel || f.nivel === soloNivel || hijas(f.id).length).map((f) => op(f, '') + hijas(f.id).map((h) => op(h, '  └ ')).join('')).join('') +
    `<option value="__nueva">＋ nueva fuente…</option>`
}

/** Un select de fuente con "＋ nueva fuente" que abre el alta en línea. */
function engancharFuente(select, nivelPorDefecto) {
  select.addEventListener('change', async () => {
    if (select.value !== '__nueva') return
    const nombre = prompt('Nombre de la fuente nueva (ej.: Gemini, Perplexity, Biblioteca de papers):')
    if (!nombre) { select.value = select.options[0].value; return }
    const nivel = nivelPorDefecto?.() ?? 'propia'
    const madre = E.fuentes.find((f) => /deprocast-0\.7$/.test(f.id)) && confirm('¿Cuelga de Deprocast 0.7? (Aceptar = sí, Cancelar = fuente independiente)') ? 'deprocast-0.7' : null
    try {
      const f = await api('/fuentes', { nombre, nivel, padreId: madre })
      await refrescar()
      select.innerHTML = opcionesFuente(f.id)
      toast(`Fuente «${esc(f.nombre)}» creada<small>Nivel ${META.niveles[f.nivel].numero} · ${esc(META.niveles[f.nivel].nombre)}</small>`, 'suave')
    } catch (e) { error(e); select.value = select.options[0].value }
  })
}

function montarCorpus() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Corpus</h1>
      <p>Todo lo que Mastropiero sabe, por la voz que habla en cada pieza. Lo estructurado entra listo; lo crudo pasa por extractor → clasificador → vectorizador.</p>
      <div class="fila"><button class="btn" id="c-quantomos" title="Las unidades mínimas que destila la pipeline">Quántomos</button><button class="btn" id="c-fuentes">Fuentes</button><button class="btn btn-primario" id="c-ingerir">＋ Ingerir</button></div>
    </div>
    <div class="niveles" id="c-niveles"></div>
    <div class="corpus-barra">
      <input class="campo-suelto" id="c-q" placeholder="Buscar en el corpus (sin importar tildes)…" value="${esc(filtroCorpus.q)}">
      <select class="campo-suelto" id="c-fuente"></select>
      <select class="campo-suelto" id="c-tipo"><option value="">todo tipo</option>${META.tipos.map((t) => `<option ${t === filtroCorpus.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <div class="corpus-grid">
      <section><div id="c-cuenta" class="cuenta"></div><div id="piezas"></div><div id="c-mas"></div></section>
      <aside class="panel"><h3>Cargas</h3><div id="c-cargas"></div></aside>
    </div>`
  $('#c-ingerir').onclick = () => modalIngesta()
  $('#c-fuentes').onclick = modalFuentes
  $('#c-quantomos').onclick = () => irA('quantomos')
  let espera
  $('#c-q').oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { filtroCorpus.q = e.target.value; filtroCorpus.desde = 0; traerPiezas() }, 250) }
  $('#c-fuente').onchange = (e) => {
    if (e.target.value === '__nueva') return
    filtroCorpus.fuente = e.target.value; filtroCorpus.desde = 0; traerPiezas()
  }
  engancharFuente($('#c-fuente'))
  $('#c-tipo').onchange = (e) => { filtroCorpus.tipo = e.target.value; filtroCorpus.desde = 0; traerPiezas() }
  corpusFirma = ''
  refrescarCorpus()
}

function refrescarCorpus() {
  if (!$('#c-niveles')) return
  const n = Object.fromEntries(E.liga.niveles.map((x) => [x.nivel, x.n]))
  const q = Object.fromEntries(E.quantomos.map((x) => [x.etapa, x.n]))
  $('#c-niveles').innerHTML = NIVEL_ORDEN.map((k) => `
    <button class="nivel-tile ${filtroCorpus.nivel === k ? 'on' : ''}" style="--n:var(--nivel-${k})" data-nivel="${k}">
      <span class="nt-glifo">${NIVEL_GLIFO[k]}</span><span class="nt-num">${META.niveles[k].numero}</span>
      <b>${esc(META.niveles[k].nombre)}</b><strong>${(n[k] ?? 0).toLocaleString('es-AR')}</strong><small>${esc(META.niveles[k].descripcion)}</small>
    </button>`).join('') + `
    <div class="nivel-tile extra"><span class="nt-glifo">⚛</span><b>Quántomos</b><strong>${((q.sellado ?? 0) + (q.proto ?? 0) + (q.propuesta ?? 0)).toLocaleString('es-AR')}</strong>
      <small>${q.proto ?? 0} proto · ${q.propuesta ?? 0} propuestas · ${q.sellado ?? 0} sellados</small></div>
    <div class="nivel-tile extra"><span class="nt-glifo">⚇</span><b>Entidades</b><strong>${E.liga.entidades.toLocaleString('es-AR')}</strong>
      <small>${E.entidades.slice(0, 4).map((e) => `${e.n} ${e.tipo}`).join(' · ') || 'personas, proyectos, lugares…'}</small></div>`
  $$('[data-nivel]').forEach((b) => (b.onclick = () => { filtroCorpus.nivel = filtroCorpus.nivel === b.dataset.nivel ? '' : b.dataset.nivel; filtroCorpus.desde = 0; refrescarCorpus(); traerPiezas() }))
  if ($('#c-fuente').value !== '__nueva') $('#c-fuente').innerHTML = opcionesFuente(filtroCorpus.fuente, { vacia: 'todas las fuentes' })
  $('#c-cargas').innerHTML = E.cargas.length ? E.cargas.map((c) => `
    <div class="carga-item ${c.estado}" data-carga="${c.id}">
      <div class="m-top"><span>#${c.id} · ${esc(c.importador)}</span><span class="pill ${c.estado === 'hecha' ? 'activo' : c.estado === 'analizada' ? 'prueba' : 'banca'}">${c.estado}</span></div>
      <div class="ci-tit">${esc(c.titulo ?? c.archivo)}</div>
      ${c.resumen ? `<div class="ci-res">${c.resumen.piezas} piezas · ${c.resumen.quantomos} quántomos · ${c.resumen.entidades} entidades${c.resumen.repetidas ? ` · ${c.resumen.repetidas} ya estaban` : ''}</div>` : ''}
    </div>`).join('') : '<p class="tenue">Ninguna todavía. Subí un archivo desde «＋ Ingerir».</p>'
  $$('[data-carga]').forEach((el) => (el.onclick = () => modalCarga(Number(el.dataset.carga))))
  const firma = JSON.stringify([E.liga.corpus, E.liga.niveles, E.cargas.map((c) => c.estado)])
  if (firma !== corpusFirma) { corpusFirma = firma; traerPiezas() }
}

async function traerPiezas(mas = false) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtroCorpus)) if (v !== '' && v != null) p.set(k, v)
  p.set('limite', 40)
  try {
    const r = await api(`/corpus?${p}`)
    corpusLista = mas ? { total: r.total, piezas: [...corpusLista.piezas, ...r.piezas] } : r
    pintarPiezas()
  } catch (e) { error(e) }
}

function piezaHTML(p) {
  const fuente = E.fuentes.find((f) => f.id === p.fuente)
  return `<div class="pieza ${p.tipo}" style="--n:var(--nivel-${p.nivel})" data-pieza="${p.id}">
    <div class="p-top"><span>#${p.id}</span>${nivelBadge(p.nivel)}<span>${esc(fuente?.nombre ?? p.fuente)}</span>
      ${p.tipo !== 'materia' ? `<span class="tipo-chip">${TIPO_NOMBRE[p.tipo]}</span>` : ''}
      ${p.peso ? `<span class="peso-chip" title="peso">${p.peso}</span>` : ''}
      <span class="etapas">${p.estado === 'pendiente' ? '<i>por traer</i>' : p.estado === 'traido' ? '<i class="ok">traído</i>' : p.estado === 'disponible' ? '<i class="ok">disponible</i>' : ['EXT', 'CLA', 'VEC'].map((x, i) => `<i class="${ESTADOS_CORPUS.indexOf(p.estado) > i ? 'ok' : ''}">${x}</i>`).join('')}</span></div>
    <h4>${esc(p.titulo)}</h4>
    ${p.autor || p.fecha ? `<div class="p-autor">${esc(p.autor ?? '')}${p.autor && p.fecha ? ' · ' : ''}${esc(String(p.fecha ?? '').slice(0, 10))}</div>` : ''}
    <p>${esc(p.contenido.slice(0, 320))}</p>
    ${p.etiquetas.length ? `<div class="tags">${p.etiquetas.slice(0, 8).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
  </div>`
}

function pintarPiezas() {
  const cont = $('#piezas')
  if (!cont) return
  const hayFiltro = filtroCorpus.q || filtroCorpus.nivel || filtroCorpus.fuente || filtroCorpus.tipo || filtroCorpus.carga
  $('#c-cuenta').innerHTML = `${corpusLista.total.toLocaleString('es-AR')} pieza${corpusLista.total === 1 ? '' : 's'}${hayFiltro ? ' con este filtro' : ''}
    ${filtroCorpus.carga ? ` · carga #${filtroCorpus.carga} <a href="#" id="c-sin-carga">quitar</a>` : ''}`
  const sc = $('#c-sin-carga')
  if (sc) sc.onclick = (e) => { e.preventDefault(); filtroCorpus.carga = ''; traerPiezas() }
  if (!corpusLista.piezas.length) {
    cont.innerHTML = hayFiltro
      ? '<div class="vacio"><h2>Nada con ese filtro</h2></div>'
      : `<div class="vacio"><div class="gran">❦</div><h2>Corpus en blanco</h2><p>El sistema arranca sin nada tuyo. Ingerí una nota, una referencia o subí un archivo: respaldos y fichas de Deprocast, CSV, texto o Markdown.</p>
         <div class="fila" style="justify-content:center;margin-top:16px"><button class="btn btn-primario" id="vacio-ingerir">＋ Ingerir</button></div></div>`
    const b = $('#vacio-ingerir')
    if (b) b.onclick = () => modalIngesta()
    $('#c-mas').innerHTML = ''
    return
  }
  cont.innerHTML = corpusLista.piezas.map(piezaHTML).join('')
  $('#c-mas').innerHTML = corpusLista.piezas.length < corpusLista.total
    ? `<button class="btn" id="c-mas-btn" style="width:100%">Ver más (${corpusLista.total - corpusLista.piezas.length} restantes)</button>` : ''
  const m = $('#c-mas-btn')
  if (m) m.onclick = () => { filtroCorpus.desde = corpusLista.piezas.length; traerPiezas(true) }
}

async function modalPieza(id) {
  try {
    const { pieza: p, quantomos, entidades } = await api(`/corpus/${id}`)
    const fuente = E.fuentes.find((f) => f.id === p.fuente)
    const meta = p.meta ? Object.entries(p.meta).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)) : []
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <div class="p-top">${nivelBadge(p.nivel)}<span>${esc(fuente?.nombre ?? p.fuente)}</span><span class="tipo-chip">${p.tipo}</span><span>#${p.id} · ${esc(p.estado)}</span></div>
      <h2 style="margin-top:8px">${esc(p.titulo)}</h2>
      ${p.autor || p.fecha ? `<p class="tenue">${esc(p.autor ?? '')} ${esc(String(p.fecha ?? '').slice(0, 10))}</p>` : ''}
      ${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:var(--oro-2)">${esc(p.url)}</a></p>` : ''}
      ${p.tipo === 'enlace' && p.estado === 'pendiente' ? `<div class="fila" style="margin:10px 0"><button class="btn btn-primario" id="p-crawl">≋ Mandar a un crawler</button></div>` : ''}
      ${entidades.length ? `<div class="tags" style="margin:8px 0">${entidades.map((e) => `<span class="ent">${esc(e.tipo)} · ${esc(e.nombre)}</span>`).join('')}</div>` : ''}
      ${p.etiquetas.length ? `<div class="tags" style="margin:8px 0">${p.etiquetas.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="respuesta" style="max-height:42vh;overflow:auto;margin-top:12px">${esc(p.contenido)}</div>
      <h3 class="sub">Quántomos de esta pieza (${quantomos.length})</h3>
      ${quantomos.length ? `<div class="q-lista">${quantomos.map(quantomoHTML).join('')}</div>` : '<p class="tenue">Ninguno. Si pasa por la pipeline, el extractor propone proto-quántomos.</p>'}
      ${meta.length ? `<h3 class="sub">Metadatos</h3><pre class="json">${esc(JSON.stringify(Object.fromEntries(meta), null, 2))}</pre>` : ''}`)
    engancharQuantomos($('#modal'), () => modalPieza(id))
    const c = $('#p-crawl')
    if (c) c.onclick = async () => {
      try {
        const t = await api('/tareas', { clase: 'crawler', texto: `Traer ${p.url}`, url: p.url, corpusId: p.id })
        cerrarModal()
        toast(`Misión #${t.id} para un crawler<small>Dale Tick: lo traído entra como fuente primaria.</small>`, 'suave')
        await refrescar()
      } catch (e) { error(e) }
    }
  } catch (e) { error(e) }
}

function modalFuentes() {
  const fila = (f) => `<tr><td>${f.padreId ? '  └ ' : ''}<b>${esc(f.nombre)}</b><div class="tenue" style="font-size:12px">${esc(f.descripcion ?? '')}</div></td>
    <td>${nivelBadge(f.nivel)}</td><td style="font:12px var(--mono)">${f.piezas.toLocaleString('es-AR')}</td><td style="font:11px var(--mono);color:var(--tenue)">${esc(f.id)}${f.sistema ? ' · fábrica' : ''}</td></tr>`
  const raiz = E.fuentes.filter((f) => !f.padreId)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Fuentes</h2>
    <p class="tenue">Cada fuente tiene un nivel por defecto; cada pieza puede tener el suyo. El corpus tiene que poder comer de muchas más: sumá las que quieras.</p>
    <table class="log">${raiz.map((f) => fila(f) + E.fuentes.filter((h) => h.padreId === f.id).map(fila).join('')).join('')}</table>
    <h3 class="sub">Nueva fuente</h3>
    <div class="form-fuente">
      <label class="campo">Nombre<input id="nf-nombre" placeholder="Gemini, Perplexity, Kindle, Zotero…"></label>
      <label class="campo">Nivel por defecto<select id="nf-nivel">${NIVEL_ORDEN.map((n) => `<option value="${n}">${META.niveles[n].numero} · ${esc(META.niveles[n].nombre)}</option>`).join('')}</select></label>
      <label class="campo">Cuelga de<select id="nf-madre"><option value="">— ninguna —</option>${raiz.map((f) => `<option value="${esc(f.id)}">${esc(f.nombre)}</option>`).join('')}</select></label>
      <label class="campo campo-ancho">Descripción<input id="nf-desc" placeholder="Qué entra por acá"></label>
      <button class="btn btn-primario" id="nf-crear">Crear fuente</button>
    </div>`)
  $('#nf-crear').onclick = async () => {
    try {
      await api('/fuentes', { nombre: $('#nf-nombre').value, nivel: $('#nf-nivel').value, padreId: $('#nf-madre').value, descripcion: $('#nf-desc').value })
      await refrescar()
      modalFuentes()
    } catch (e) { error(e) }
  }
}

// ─── Ingesta ────────────────────────────────────────────────────────────

const INGESTA = {
  propia: { titulo: 'Algo mío', ayuda: 'Una nota, una idea, un texto propio. Entra crudo y la pipeline lo destila.' },
  primaria: { titulo: 'Una fuente primaria', ayuda: 'La obra de otro, tal cual: traerla de la web, anotar la referencia o pegar el documento.' },
  investigacion: { titulo: 'Una investigación', ayuda: 'Un informe o una curación hecha con ayuda (Perplexity, Grok, un pack). Su voz no es la tuya ni la del autor original.' },
  generada: { titulo: 'Algo generado', ayuda: 'Lo llenan los agentes solos: cada obra de un generativo entra acá. A mano: la salida de una IA externa.' },
}

function modalIngesta(nivel = null) {
  if (!nivel) {
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Ingerir</h2>
      <p class="tenue">¿De quién es la voz que habla en lo que vas a cargar?</p>
      <div class="ingesta-niveles">${NIVEL_ORDEN.map((n) => `
        <button class="nivel-tile" style="--n:var(--nivel-${n})" data-ing="${n}"><span class="nt-glifo">${NIVEL_GLIFO[n]}</span><span class="nt-num">${META.niveles[n].numero}</span>
          <b>${esc(INGESTA[n].titulo)}</b><small>${esc(INGESTA[n].ayuda)}</small></button>`).join('')}</div>
      <label class="soltar" id="soltar">
        <input type="file" id="ing-archivo" hidden>
        <b>⇪ Subir un archivo</b>
        <span>Respaldo o ficha de Deprocast 0.7 · CSV · texto · Markdown. Detecto el formato, lo parto en segmentos y elegís qué entra. Arrastralo acá.</span>
      </label>`)
    $$('[data-ing]').forEach((b) => (b.onclick = () => modalIngesta(b.dataset.ing)))
    const s = $('#soltar')
    $('#ing-archivo').onchange = (e) => e.target.files[0] && subirArchivo(e.target.files[0])
    s.ondragover = (e) => { e.preventDefault(); s.classList.add('encima') }
    s.ondragleave = () => s.classList.remove('encima')
    s.ondrop = (e) => { e.preventDefault(); s.classList.remove('encima'); const f = e.dataTransfer.files[0]; if (f) subirArchivo(f) }
    return
  }
  const fuenteDefecto = { propia: 'operador', primaria: E.fuentes.find((f) => f.nivel === 'primaria' && f.id !== 'web')?.id ?? 'operador', investigacion: E.fuentes.find((f) => f.nivel === 'investigacion')?.id ?? 'operador', generada: 'agentes' }[nivel]
  const proyectos = `<option value="">— ninguno —</option>${E.liga.proyectos.map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}`
  const campoFuente = `<label class="campo">Fuente<select id="i-fuente">${opcionesFuente(fuenteDefecto)}</select></label>`
  const comunes = `<label class="campo">Dominio<input id="i-dom" placeholder="huerta, derecho, cine…"></label><label class="campo">Proyecto<select id="i-proy">${proyectos}</select></label>`
  let cuerpo = ''
  if (nivel === 'propia') {
    cuerpo = `<div class="form-ing">
      <label class="campo campo-ancho">Título<input id="i-titulo" placeholder="Nota de voz, idea, borrador…"></label>
      <label class="campo campo-ancho">Contenido<textarea id="i-contenido" rows="9" placeholder="Pegá o escribí. Entra crudo y pasa por extractor → clasificador → vectorizador."></textarea></label>
      ${campoFuente}<label class="campo">Fecha<input id="i-fecha" type="date"></label>${comunes}</div>`
  } else if (nivel === 'primaria') {
    cuerpo = `<div class="pestanas" id="i-pest"><button class="on" data-p="url">≋ Traer una URL</button><button data-p="ref">❖ Referencia a una obra</button><button data-p="doc">▤ Documento</button></div>
      <div class="form-ing" data-panel="url"><label class="campo campo-ancho">URL<input id="i-url" placeholder="https://…"></label>${comunes}
        <p class="tenue campo-ancho">Se publica una misión para un crawler; lo que traiga entra como fuente primaria por la pipeline.</p></div>
      <div class="form-ing" data-panel="ref" hidden>
        <label class="campo campo-ancho">Título de la obra<input id="r-titulo" placeholder="Libro, paper, película, ley, repo…"></label>
        <label class="campo">Autor<input id="r-autor"></label><label class="campo">Año<input id="r-fecha" placeholder="1972"></label>
        <label class="campo">Clase<select id="r-clase">${['libro', 'paper', 'artículo', 'repositorio', 'película', 'serie', 'curso', 'ley', 'otro'].map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label class="campo">URL<input id="r-url" placeholder="opcional"></label>
        <label class="campo campo-ancho">Por qué importa<textarea id="r-notas" rows="4" placeholder="Qué tiene, para qué la querés."></textarea></label>
        ${campoFuente}${comunes}</div>
      <div class="form-ing" data-panel="doc" hidden>
        <label class="campo campo-ancho">Título<input id="d-titulo"></label><label class="campo">Autor<input id="d-autor"></label><label class="campo">URL<input id="d-url"></label>
        <label class="campo campo-ancho">Texto<textarea id="d-contenido" rows="8"></textarea></label>${campoFuente.replace('i-fuente', 'd-fuente')}${comunes.replace('i-dom', 'd-dom').replace('i-proy', 'd-proy')}</div>`
  } else if (nivel === 'investigacion') {
    cuerpo = `<div class="form-ing">
      <label class="campo campo-ancho">Título<input id="i-titulo" placeholder="Informe sobre…"></label>
      <label class="campo campo-ancho">Informe<textarea id="i-contenido" rows="9" placeholder="Pegá el informe, con sus citas si las tiene."></textarea></label>
      ${campoFuente}<label class="campo">Herramienta<input id="i-autor" placeholder="Perplexity, Grok, Gemini…"></label>${comunes}
      <p class="tenue campo-ancho">¿Es un repertorio en planilla? Subilo como CSV desde «⇪ Subir un archivo»: cada fila entra como referencia.</p></div>`
  } else {
    cuerpo = `<div class="form-ing">
      <p class="tenue campo-ancho">Los generativos de la liga ya escriben acá solos. Esto es para la salida de una IA externa que quieras sumar, marcada como generada.</p>
      <label class="campo campo-ancho">Título<input id="i-titulo"></label>
      <label class="campo campo-ancho">Contenido<textarea id="i-contenido" rows="9"></textarea></label>
      ${campoFuente}<label class="campo">Modelo o herramienta<input id="i-autor" placeholder="ChatGPT, Claude, Gemini…"></label>${comunes}</div>`
  }
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <div class="p-top"><a href="#" id="i-volver" class="tenue">← niveles</a>${nivelBadge(nivel)}</div>
    <h2 style="margin-top:8px">${esc(INGESTA[nivel].titulo)}</h2><p class="tenue">${esc(INGESTA[nivel].ayuda)}</p>
    ${cuerpo}
    <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="i-enviar">Ingerir</button></div>`)
  $('#i-volver').onclick = (e) => { e.preventDefault(); modalIngesta() }
  $$('#modal select[id$="fuente"]').forEach((s) => engancharFuente(s, () => nivel))
  let panel = 'url'
  $$('#i-pest button').forEach((b) => (b.onclick = () => {
    panel = b.dataset.p
    $$('#i-pest button').forEach((x) => x.classList.toggle('on', x === b))
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== panel))
  }))
  const v = (sel) => $(sel)?.value?.trim() ?? ''
  $('#i-enviar').onclick = async () => {
    try {
      if (nivel === 'primaria' && panel === 'url') {
        if (!v('#i-url')) throw new Error('Falta la URL')
        const t = await api('/tareas', { clase: 'crawler', texto: `Traer ${v('#i-url')}`, url: v('#i-url'), dominio: v('#i-dom'), proyectoId: v('#i-proy') })
        cerrarModal()
        toast(`Misión #${t.id} para un crawler<small>Dale Tick para que la traiga.</small>`, 'suave')
      } else {
        const b = nivel === 'primaria' && panel === 'ref'
          ? { tipo: 'referencia', titulo: v('#r-titulo'), autor: v('#r-autor'), fecha: v('#r-fecha'), url: v('#r-url'), contenido: [v('#r-notas'), `(${v('#r-clase')})`].filter(Boolean).join('\n'), fuente: v('#i-fuente'), dominio: v('#i-dom'), proyectoId: v('#i-proy') }
          : nivel === 'primaria'
            ? { titulo: v('#d-titulo'), autor: v('#d-autor'), url: v('#d-url'), contenido: v('#d-contenido'), fuente: v('#d-fuente'), dominio: v('#d-dom'), proyectoId: v('#d-proy') }
            : { titulo: v('#i-titulo'), contenido: v('#i-contenido'), autor: v('#i-autor'), fecha: v('#i-fecha'), fuente: v('#i-fuente'), dominio: v('#i-dom'), proyectoId: v('#i-proy') }
        if (b.fuente === '__nueva') throw new Error('Terminá de crear la fuente o elegí otra')
        const r = await api('/ingerir', { ...b, nivel })
        cerrarModal()
        toast(`Pieza ${r.corpusId} · ${esc(META.niveles[nivel].nombre)}<small>La pipeline arrancó: misión #${r.tarea.id} para un extractor.</small>`, 'suave')
      }
      await refrescar()
      if (vista === 'corpus') traerPiezas()
    } catch (e) { error(e) }
  }
}

function subirArchivo(archivo) {
  abrirModal(`<h2>Subiendo ${esc(archivo.name)}</h2><p class="tenue">${(archivo.size / 1024 / 1024).toFixed(1)} MB</p>
    <div class="xp" style="height:10px;--c:var(--oro)"><div id="sub-barra" style="width:0%"></div></div><p class="tenue" id="sub-txt">Enviando…</p>`)
  const x = new XMLHttpRequest()
  x.open('POST', `/api/cargas?nombre=${encodeURIComponent(archivo.name)}`)
  x.upload.onprogress = (e) => {
    if (!e.lengthComputable) return
    $('#sub-barra').style.width = `${(e.loaded / e.total) * 100}%`
    if (e.loaded === e.total) $('#sub-txt').textContent = 'Leyendo y segmentando…'
  }
  x.onload = async () => {
    const r = JSON.parse(x.responseText || '{}')
    if (x.status !== 200) { cerrarModal(); return error(new Error(r.error ?? `HTTP ${x.status}`)) }
    await refrescar()
    modalCarga(r.id)
  }
  x.onerror = () => { cerrarModal(); error(new Error('No se pudo subir el archivo')) }
  x.send(archivo)
}

async function modalCarga(id) {
  try {
    const c = await api(`/cargas/${id}`)
    const a = c.analisis
    if (c.estado !== 'analizada') {
      const r = c.resumen
      abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Carga #${c.id} · ${esc(a.titulo)}</h2>
        <p class="tenue">${esc(c.archivo)} · ${esc(c.estado)}${c.hechaEn ? ` el ${new Date(c.hechaEn).toLocaleString('es-AR')}` : ''}</p>
        ${r ? `<div class="resumen-carga">
          <div><strong>${r.piezas.toLocaleString('es-AR')}</strong><small>piezas</small></div><div><strong>${r.quantomos.toLocaleString('es-AR')}</strong><small>quántomos</small></div>
          <div><strong>${r.entidades.toLocaleString('es-AR')}</strong><small>entidades</small></div><div><strong>${r.repetidas.toLocaleString('es-AR')}</strong><small>ya estaban</small></div>
          <div><strong>${r.tareas.toLocaleString('es-AR')}</strong><small>misiones</small></div></div>
          <table class="log">${a.segmentos.filter((s) => r.porSegmento[s.id]).map((s) => `<tr><td>${s.nivel ? nivelBadge(s.nivel) : '→'}</td><td>${esc(s.nombre)}</td><td style="font:12px var(--mono)">${r.porSegmento[s.id]}</td></tr>`).join('')}</table>
          <p class="tenue">Pipeline: ${esc(r.pipeline)} · ${r.segundos} s</p>` : ''}
        <div class="fila" style="margin-top:14px">
          ${c.estado === 'hecha' ? `<button class="btn" id="cg-ver">Ver sus piezas</button><button class="btn" id="cg-reetiquetar" title="Vuelve a calcular entidades y etiquetas con el importador actual. No toca piezas ni quántomos.">Recalcular etiquetas</button><button class="btn btn-peligro" id="cg-deshacer">Deshacer la carga</button>` : ''}
        </div>`)
      const ver = $('#cg-ver')
      if (ver) ver.onclick = () => { cerrarModal(); Object.assign(filtroCorpus, { carga: c.id, nivel: '', fuente: '', tipo: '', q: '', desde: 0 }); if (vista !== 'corpus') irA('corpus'); else traerPiezas() }
      const ret = $('#cg-reetiquetar')
      if (ret) ret.onclick = async () => {
        ret.disabled = true
        ret.textContent = 'Recalculando…'
        try {
          const r = await api(`/cargas/${c.id}/reetiquetar`, {})
          toast(`Etiquetas recalculadas<small>${r.piezas.toLocaleString('es-AR')} piezas revisadas, ${r.cambiadas.toLocaleString('es-AR')} corregidas.</small>`, 'suave')
          await refrescar()
        } catch (e) { error(e) } finally { ret.disabled = false; ret.textContent = 'Recalcular etiquetas' }
      }
      const des = $('#cg-deshacer')
      if (des) des.onclick = async () => {
        if (!confirm(`¿Sacar del corpus todo lo que entró con la carga #${c.id}? Las piezas, quántomos y entidades de esta carga se borran.`)) return
        try { await api(`/cargas/${c.id}/deshacer`, {}); toast(`Carga #${c.id} deshecha`, 'suave'); cerrarModal(); await refrescar() } catch (e) { error(e) }
      }
      return
    }
    const existe = E.fuentes.some((f) => f.id === a.fuente.id)
    const opcFuente = (existe || !a.fuente.id ? '' : `<option value="${esc(a.fuente.id)}" selected>(nueva) ${esc(a.fuente.nombre)} · ${META.niveles[a.fuente.nivel].numero}</option>`) + opcionesFuente(existe ? a.fuente.id : '', { vacia: a.fuente.id ? '' : '— elegí una fuente —' })
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <div class="p-top"><span>Carga #${c.id}</span><span class="tipo-chip">${esc(c.importador)}</span><span>${esc(c.archivo)} · ${(c.bytes / 1024 / 1024).toFixed(1)} MB</span></div>
      <h2 style="margin-top:8px">${esc(a.titulo)}</h2><p class="tenue">${esc(a.descripcion)}</p>
      ${a.avisos.map((x) => `<div class="aviso">! ${esc(x)}</div>`).join('')}
      <h3 class="sub">Segmentos · elegí qué entra</h3>
      <div class="segmentos">${a.segmentos.map((s) => `
        <label class="segmento ${s.cantidad ? '' : 'vacio-seg'}"><input type="checkbox" value="${s.id}" ${s.porDefecto && s.cantidad ? 'checked' : ''} ${s.cantidad ? '' : 'disabled'}>
          <div><div class="seg-top"><b>${esc(s.nombre)}</b><span class="seg-n">${s.cantidad.toLocaleString('es-AR')}</span>${s.nivel ? nivelBadge(s.nivel) : `<span class="tipo-chip">→ ${s.destino}</span>`}</div>
          <small>${esc(s.descripcion)}</small>${s.nota ? `<small class="seg-nota">${esc(s.nota)}</small>` : ''}</div></label>`).join('')}</div>
      <div class="form-ing" style="margin-top:14px">
        <label class="campo">Fuente<select id="cg-fuente">${opcFuente}</select></label>
        ${a.nivelEditable ? `<label class="campo">Nivel de las piezas<select id="cg-nivel">${NIVEL_ORDEN.map((n) => `<option value="${n}" ${n === a.segmentos[0]?.nivel ? 'selected' : ''}>${META.niveles[n].numero} · ${esc(META.niveles[n].nombre)}</option>`).join('')}</select></label>` : ''}
        ${a.umbralPeso ? `<label class="campo">Peso mínimo de la criba: <b id="cg-umbral-v">${a.umbralPeso}</b><input type="range" id="cg-umbral" min="1" max="12" value="${a.umbralPeso}"></label>` : ''}
      </div>
      <h3 class="sub">¿Pasa por la pipeline?</h3>
      <div class="pipeline-op">
        <label><input type="radio" name="cg-pipe" value="ninguna" checked><b>No</b><small>Lo estructurado entra listo para buscar. Sin gastar tokens.</small></label>
        <label><input type="radio" name="cg-pipe" value="vectorizar"><b>Solo vectorizar</b><small id="cg-est-v"></small></label>
        <label><input type="radio" name="cg-pipe" value="completa"><b>Completa</b><small id="cg-est-c"></small></label>
      </div>
      <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="cg-ejecutar">Cargar</button><button class="btn" id="cg-descartar">Descartar</button></div>`)
    const estimar = () => {
      const n = a.segmentos.filter((s) => s.destino === 'corpus' && s.id !== 'enlaces' && $(`.segmentos input[value="${s.id}"]`)?.checked).reduce((t, s) => t + s.cantidad, 0)
      $('#cg-est-v').textContent = `≈ ${n.toLocaleString('es-AR')} llamadas de embedding (una por pieza).`
      $('#cg-est-c').textContent = `≈ ${(n * 3).toLocaleString('es-AR')} misiones: extractor, clasificador y vectorizador por pieza. Con NaN, tokens de verdad.`
    }
    $$('.segmentos input').forEach((i) => (i.onchange = estimar))
    estimar()
    engancharFuente($('#cg-fuente'), () => $('#cg-nivel')?.value ?? a.fuente.nivel)
    const u = $('#cg-umbral')
    if (u) u.oninput = () => ($('#cg-umbral-v').textContent = u.value)
    $('#cg-descartar').onclick = async () => { try { await api(`/cargas/${c.id}/descartar`, {}); cerrarModal(); await refrescar() } catch (e) { error(e) } }
    $('#cg-ejecutar').onclick = async () => {
      const boton = $('#cg-ejecutar')
      boton.disabled = true
      boton.textContent = 'Cargando…'
      try {
        await api(`/cargas/${c.id}/ejecutar`, {
          segmentos: $$('.segmentos input:checked').map((i) => i.value), fuenteId: $('#cg-fuente').value,
          nivel: $('#cg-nivel')?.value, umbralPeso: u?.value, pipeline: $('input[name="cg-pipe"]:checked').value,
        })
        await refrescar()
        modalCarga(c.id)
      } catch (e) { boton.disabled = false; boton.textContent = 'Cargar'; error(e) }
    }
  } catch (e) { error(e) }
}

// Quántomos

const filtroQ = { etapa: '', q: '', desde: 0 }
let qLista = { total: 0, quantomos: [] }

function pesoHTML(q) {
  const p = q.peso ?? 0
  const sellable = q.etapa === 'proto' || q.etapa === 'propuesta'
  return `<span class="peso12 ${sellable ? 'sellable' : ''}" title="${sellable ? 'Clic en un punto: sellar con ese peso' : `peso ${p}`}">${Array.from({ length: 12 }, (_, i) =>
    `<i class="${i < p ? 'on' : ''}" ${sellable ? `data-sellar="${q.id}" data-peso="${i + 1}"` : ''}></i>`).join('')}<b>${p || '—'}</b></span>`
}

function quantomoHTML(q) {
  const haiku = q.facetas?.find((f) => f.tipo === 'haiku' && f.cara) ?? q.facetas?.find((f) => f.tipo === 'haiku')
  return `<div class="quantomo ${q.etapa}" data-q="${q.id}">
    <div class="q-top"><span class="pill ${q.etapa === 'sellado' ? 'activo' : q.etapa === 'propuesta' ? 'prueba' : 'banca'}">${q.etapa}</span>
      ${q.version > 1 ? `<span class="tipo-chip">v${q.version}</span>` : ''}${q.universo ? `<span class="tipo-chip">${esc(q.universo)}</span>` : ''}
      ${q.l72 ? `<span class="tipo-chip" title="sello L72 de la 0.7.1">L72</span>` : ''}<span class="tenue">#${q.id}${q.procedencia ? ` · ${esc(q.procedencia.slice(0, 60))}` : ''}</span></div>
    <div class="q-texto">${esc(q.texto)}</div>
    ${haiku ? `<div class="q-haiku">${haiku.versos.map(esc).join(' / ')}</div>` : ''}
    <div class="q-acciones">${pesoHTML(q)}
      ${q.etapa === 'sellado' ? `<button class="btn btn-chico" data-mejorar="${q.id}">✦ Pedir mejora</button>` : ''}
      ${q.etapa === 'propuesta' ? `<button class="btn btn-chico btn-primario" data-aceptar="${q.id}">Aceptar</button>` : ''}
      ${q.etapa !== 'descartado' && q.etapa !== 'superado' ? `<button class="btn btn-chico" data-descartar="${q.id}">Descartar</button>` : ''}
      ${q.piezaId ? `<button class="btn btn-chico" data-ver-pieza="${q.piezaId}">pieza #${q.piezaId}</button>` : ''}
      <button class="btn btn-chico" data-linaje="${q.id}">linaje</button>
    </div></div>`
}

/** Botones de un listado de quántomos; `luego` re-pinta donde estén. */
function engancharQuantomos(raiz, luego) {
  const hacer = (f) => async (e) => {
    e.stopPropagation()
    try { await f(e.currentTarget); await refrescar(); luego() } catch (err) { error(err) }
  }
  $$('[data-sellar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => {
    const q = qLista.quantomos.find((x) => x.id === Number(el.dataset.sellar))
    const ruta = q?.etapa === 'propuesta' ? 'aceptar' : 'sellar'
    await api(`/quantomos/${el.dataset.sellar}/${ruta}`, { peso: Number(el.dataset.peso) })
    toast(`⚛ Quántomo #${el.dataset.sellar} sellado con peso ${el.dataset.peso}`, 'suave')
  })))
  $$('[data-aceptar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => { await api(`/quantomos/${el.dataset.aceptar}/aceptar`, {}); toast('Propuesta aceptada: la versión anterior queda en el linaje', 'suave') })))
  $$('[data-descartar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => api(`/quantomos/${el.dataset.descartar}/descartar`, {}))))
  $$('[data-mejorar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => {
    const instruccion = prompt('¿Qué mejorar? (opcional: más corto, más preciso, sin jerga…)', '')
    if (instruccion === null) return
    const t = await api(`/quantomos/${el.dataset.mejorar}/mejora`, { instruccion })
    toast(`Misión #${t.id} para un generativo<small>Dale Tick: la versión nueva vuelve como propuesta.</small>`, 'suave')
  })))
  $$('[data-ver-pieza]', raiz).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); modalPieza(Number(b.dataset.verPieza)) }))
  $$('[data-linaje]', raiz).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); modalLinaje(Number(b.dataset.linaje)) }))
}

async function modalLinaje(id) {
  try {
    const { linaje, pieza } = await api(`/quantomos/${id}`)
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>⚛ Linaje del quántomo</h2>
      <p class="tenue">Nada se pisa: cada mejora es una versión nueva; la anterior queda como superada.</p>
      ${linaje.map((q) => `<div class="linaje-paso ${q.etapa}"><div class="q-top"><span class="tipo-chip">v${q.version}</span><span class="pill ${q.etapa === 'sellado' ? 'activo' : 'banca'}">${q.etapa}</span><span class="tenue">${esc(q.procedencia ?? '')} · ${new Date(q.actualizadoEn).toLocaleString('es-AR')}</span></div><div class="q-texto">${esc(q.texto)}</div></div>`).join('<div class="linaje-flecha">↓</div>')}
      ${pieza ? `<h3 class="sub">Sale de</h3>${piezaHTML(pieza)}` : ''}`)
  } catch (e) { error(e) }
}

function montarQuantomos() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Quántomos</h1><p>La unidad mínima: una afirmación atómica. Los extractores y las cargas proponen; vos sellás con un peso de 1 a 12. Los generativos proponen mejoras y vos decidís.</p></div>
    <div class="chips" id="q-chips"></div>
    <div class="corpus-barra"><input class="campo-suelto" id="q-q" placeholder="Buscar quántomos…" value="${esc(filtroQ.q)}"></div>
    <div id="q-cuenta" class="cuenta"></div><div id="q-lista" class="q-lista"></div><div id="q-mas"></div>`
  let espera
  $('#q-q').oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { filtroQ.q = e.target.value; filtroQ.desde = 0; traerQuantomos() }, 250) }
  refrescarQuantomos()
  traerQuantomos()
}

function refrescarQuantomos() {
  if (!$('#q-chips')) return
  const n = Object.fromEntries(E.quantomos.map((x) => [x.etapa, x.n]))
  const etapas = [['', 'Vigentes', (n.proto ?? 0) + (n.sellado ?? 0) + (n.propuesta ?? 0)], ['propuesta', 'Propuestas', n.propuesta ?? 0], ['proto', 'Proto', n.proto ?? 0], ['sellado', 'Sellados', n.sellado ?? 0], ['superado', 'Superados', n.superado ?? 0], ['descartado', 'Descartados', n.descartado ?? 0]]
  $('#q-chips').innerHTML = etapas.map(([k, t, c]) => `<button class="chip ${filtroQ.etapa === k ? 'on' : ''}" data-etapa="${k}">${t} ${c.toLocaleString('es-AR')}</button>`).join('')
  $$('[data-etapa]').forEach((b) => (b.onclick = () => { filtroQ.etapa = b.dataset.etapa; filtroQ.desde = 0; refrescarQuantomos(); traerQuantomos() }))
}

async function traerQuantomos(mas = false) {
  const p = new URLSearchParams({ limite: 40, desde: filtroQ.desde })
  if (filtroQ.etapa) p.set('etapa', filtroQ.etapa)
  if (filtroQ.q) p.set('q', filtroQ.q)
  try {
    const r = await api(`/quantomos?${p}`)
    qLista = mas ? { total: r.total, quantomos: [...qLista.quantomos, ...r.quantomos] } : r
    const cont = $('#q-lista')
    if (!cont) return
    $('#q-cuenta').textContent = `${qLista.total.toLocaleString('es-AR')} quántomo${qLista.total === 1 ? '' : 's'}`
    cont.innerHTML = qLista.quantomos.length ? qLista.quantomos.map(quantomoHTML).join('')
      : `<div class="vacio"><div class="gran">⚛</div><h2>Sin quántomos${filtroQ.etapa ? ' en esta etapa' : ''}</h2><p>Nacen cuando el extractor destila una pieza o cuando cargás un respaldo que los trae.</p></div>`
    engancharQuantomos(cont, () => traerQuantomos())
    $('#q-mas').innerHTML = qLista.quantomos.length < qLista.total ? `<button class="btn" id="q-mas-btn" style="width:100%">Ver más</button>` : ''
    const m = $('#q-mas-btn')
    if (m) m.onclick = () => { filtroQ.desde = qLista.quantomos.length; traerQuantomos(true) }
  } catch (e) { error(e) }
}

// Chat

const chat = { conversaciones: [], actual: null, mensajes: [], pensando: false, sondeo: null, borrador: '' }

/** Markdown mínimo y seguro: se escapa todo primero; después se marcan bloques, tablas, listas y referencias. */
function md(texto) {
  const bloques = []
  // Citas al corpus: [#410] o [#410, #388] → notas al pie numeradas en el orden en que aparecen.
  const citas = new Map()
  let t = esc(texto ?? '')
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, c) => `\u0000${bloques.push(c) - 1}\u0000`)
    .replace(/\s?\[((?:#\d+\s*,?\s*)+)\]/g, (_, ids) => `<sup class="cita">${ids.match(/\d+/g).map((id) => {
      if (!citas.has(id)) citas.set(id, citas.size + 1)
      return `<a data-pieza="${id}" title="Ver la fuente">${citas.get(id)}</a>`
    }).join('')}</sup>`)
  const lineas = t.split('\n')
  const out = []
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1] ?? '')) {
      const celdas = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const cab = celdas(l)
      i += 2
      const filas = []
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]))
      i--
      out.push(`<table><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`)
    } else if (/^\s*[-*] /.test(l)) {
      const items = []
      while (i < lineas.length && /^\s*[-*] /.test(lineas[i])) items.push(lineas[i++].replace(/^\s*[-*] /, ''))
      i--
      out.push(`<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`)
    } else if (/^\s*\d+[.)] /.test(l)) {
      const items = []
      while (i < lineas.length && /^\s*\d+[.)] /.test(lineas[i])) items.push(lineas[i++].replace(/^\s*\d+[.)] /, ''))
      i--
      out.push(`<ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol>`)
    } else if (/^#{1,4} /.test(l)) out.push(`<h4>${l.replace(/^#+ /, '')}</h4>`)
    else if (/^&gt; /.test(l)) out.push(`<blockquote>${l.slice(5)}</blockquote>`)
    else if (!l.trim()) out.push('')
    else out.push(`<p>${l}</p>`)
  }
  return out.join('')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\b(misi[oó]n(?:es)?) #(\d+)/gi, '$1 <a class="ref" data-ver-tarea="$2">#$2</a>')
    .replace(/\b(qu[aá]ntomo(?:s)?(?: proto| sellado)?) #(\d+)/gi, '$1 <a class="ref" data-ref-q="$2">#$2</a>')
    .replace(/\b(carga) #(\d+)/gi, '$1 <a class="ref" data-ref-carga="$2">#$2</a>')
    .replace(/\b(propuesta(?: de mejora)?) #(\d+)/gi, '$1 <a class="ref" data-ref-propuestas>#$2</a>')
    .replace(/\b(entidad(?:es)?) #(\d+)/gi, '$1 <a class="ref" data-ref-ent="$2">#$2</a>')
    .replace(/(^|[\s(,[])#(\d+)\b(?![^<]*<\/a>)/g, '$1<a class="ref" data-pieza="$2">#$2</a>')
    .replace(/\b([A-Z]{3}-\d{4})\b(?![^<]*<\/a>)/g, '<a class="ref" data-agente="$1">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => `<pre><code>${bloques[Number(n)]}</code></pre>`)
}

function quienEs(c) {
  if (c?.modo === 'diario') return { glifo: '✎', nombre: 'Diario', sub: 'contale lo que quieras · Mastropiero escucha', color: 'var(--acento-texto)' }
  if (c?.modo === 'hoy') return { glifo: '☿', nombre: 'Mastropiero', sub: 'tu día · acá llega la jornada y el cierre', color: 'var(--acento-texto)' }
  if (!c || c.con === 'mastropiero') return { glifo: '☿', nombre: 'Mastropiero', sub: 'el agente omnívoro · opera toda la plataforma', color: 'var(--acento-texto)' }
  const f = E.roster.find((x) => x.id === c.con)
  const cl = f ? claseDe(f.clase) : null
  return {
    glifo: cl?.glifo ?? '✝', nombre: f ? (f.nombre ? `${f.nombre} · ${f.id}` : f.id) : `${c.con} (retirado)`,
    sub: f ? `${cl.nombre} · nivel ${f.nivel} · ${f.estado}${f.especializacion ? ` · ${f.especializacion}` : ''}` : 'ya no está en la liga',
    color: f ? colorDe(f.clase) : 'var(--debil)', vivo: !!f,
  }
}

const SUGERENCIAS_MASTRO = [
  '¿Cómo funciona la liga? Explicámelo corto.',
  '¿Qué hay en el corpus y de qué niveles?',
  'Creame un buscador que solo cite fuentes primarias.',
  'Corré un tick y contame qué pasó.',
  'Leé tus lineamientos y proponeme tres mejoras.',
  '¿Quién soy, según lo que cargué?',
  'Armame el día de mañana.',
]
const SUGERENCIAS_AGENTE = ['¿Qué hacés y cómo trabajás?', '¿Qué encontrás en el corpus sobre lo que más aparece?', '¿Qué misión te vendría bien?']

/** El hilo + el compositor: se usa en Chat y en Hoy (mismos ids, una vista a la vez). */
const hiloHTMLBase = () => `
  <header class="chat-cab" id="chat-cab"></header>
  <div class="chat-hilo" id="hilo"><div class="chat-col" id="hilo-col"></div></div>
  <div class="chat-compositor">
    ${E.chatConModelo ? '' : '<div class="aviso aviso-modelo">Sin modelo: Mastropiero necesita NAN_API_KEY en .env para conversar.</div>'}
    <form id="chat-form">
      <label class="btn btn-icono" id="chat-audio" title="Subir un audio: se transcribe y entra como lo que contás" hidden>🎙<input type="file" accept="audio/*" hidden id="chat-audio-in"></label>
      <textarea id="chat-txt" rows="1" placeholder="Escribile a Mastropiero…"></textarea><button class="btn btn-primario" id="chat-enviar">Enviar</button>
    </form>
    <small>Enter envía · Shift+Enter, nueva línea. Lo destructivo siempre te lo pregunta antes.</small>
  </div>`

function engancharCompositor() {
  const txt = $('#chat-txt')
  txt.value = chat.borrador
  const ajustar = () => { txt.style.height = 'auto'; txt.style.height = `${Math.min(txt.scrollHeight, 200)}px` }
  txt.oninput = () => { chat.borrador = txt.value; ajustar() }
  txt.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarChat() } }
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); enviarChat() }
  $('#chat-audio-in').onchange = async (e) => {
    const f = e.target.files[0]
    if (!f || !chat.actual) return
    e.target.value = ''
    toast(`Transcribiendo ${esc(f.name)}…`, 'suave')
    try {
      const r = await fetch(`/api/diario/audio?conversacion=${chat.actual.id}&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      chat.mensajes.push({ id: -1, rol: 'operador', texto: j.texto })
      chat.pensando = true
      pintarChat()
      seguirTurno()
    } catch (err) { error(err) }
  }
  ajustar()
}

async function montarChat() {
  $('#principal').classList.add('lleno')
  $('#principal').innerHTML = `<div class="chat"><aside class="chat-lado" id="chat-lado"></aside><section class="chat-main">${hiloHTMLBase()}</section></div>`
  engancharCompositor()
  await traerConversaciones()
  if (!chat.actual || chat.actual.modo === 'hoy' || !chat.conversaciones.some((c) => c.id === chat.actual.id)) {
    const ultima = chat.conversaciones.find((c) => c.con === 'mastropiero' && c.modo === 'chat')
    if (ultima) await abrirConversacion(ultima.id)
    else { chat.actual = null; chat.mensajes = []; pintarChat() }
  } else await abrirConversacion(chat.actual.id)
  $('#chat-txt').focus()
}

async function traerConversaciones() {
  try { chat.conversaciones = await api('/chat') } catch (e) { error(e) }
  pintarLado()
}

function pintarLado() {
  const lado = $('#chat-lado')
  if (!lado) return
  const item = (c) => {
    const q = quienEs(c)
    return `<button class="chat-item ${chat.actual?.id === c.id ? 'on' : ''}" data-conv="${c.id}"><i style="color:${q.color}">${q.glifo}</i>
      <span>${esc(c.titulo ?? 'Conversación nueva')}</span>${c.pensando ? '<em>…</em>' : ''}</button>`
  }
  const conMastro = chat.conversaciones.filter((c) => c.con === 'mastropiero' && c.modo === 'chat')
  const diario = chat.conversaciones.filter((c) => c.modo === 'diario')
  const conAgentes = chat.conversaciones.filter((c) => c.con !== 'mastropiero')
  lado.innerHTML = `
    <button class="btn btn-primario" id="chat-nueva">Nueva conversación</button>
    <button class="chat-item" data-ir-hoy><i>☀</i><span>Hoy</span><em>${E.hoy.total ? `${E.hoy.hechos}/${E.hoy.total}` : ''}</em></button>
    <h4>Con Mastropiero</h4>${conMastro.map(item).join('') || '<p class="tenue" style="margin:2px 8px;font-size:12.5px">Ninguna todavía.</p>'}
    <h4>Diario</h4>
    <button class="chat-item" id="diario-nuevo"><i>✎</i><span>Contale algo</span></button>
    ${diario.map(item).join('')}
    ${conAgentes.length ? `<h4>Con agentes</h4>${conAgentes.map(item).join('')}` : ''}
    <h4>Hablar con un agente</h4>
    ${E.roster.map((f) => `<button class="chat-item" data-hablar="${esc(f.id)}"><i style="color:${colorDe(f.clase)}">${claseDe(f.clase).glifo}</i><span>${esc(f.nombre ?? f.id)}</span><em>${esc(claseDe(f.clase).nombre.slice(0, 3).toLowerCase())}</em></button>`).join('') || '<p class="tenue" style="margin:2px 8px;font-size:12.5px">El roster está vacío. Pedile a Mastropiero que forje uno.</p>'}
    <h4>Propuestas de mejora</h4>
    <button class="chat-item" data-ref-propuestas><i>✎</i><span>Ver propuestas</span><em>${E.propuestasAbiertas || ''}</em></button>`
  $('#chat-nueva').onclick = () => nuevaConversacion('mastropiero')
  $('#diario-nuevo').onclick = () => nuevaConversacion('mastropiero', 'diario')
  $('[data-ir-hoy]', lado).onclick = () => irA('hoy')
  $$('[data-conv]', lado).forEach((b) => (b.onclick = () => abrirConversacion(Number(b.dataset.conv))))
  $$('[data-hablar]', lado).forEach((b) => (b.onclick = () => {
    const existente = chat.conversaciones.find((c) => c.con === b.dataset.hablar)
    existente ? abrirConversacion(existente.id) : nuevaConversacion(b.dataset.hablar)
  }))
}

async function nuevaConversacion(con, modo = 'chat') {
  try {
    const c = await api('/chat', { con, modo })
    chat.conversaciones.unshift({ ...c, pensando: false })
    await abrirConversacion(c.id)
  } catch (e) { error(e) }
}

async function abrirConversacion(id) {
  try {
    const r = await api(`/chat/${id}`)
    chat.actual = r.conversacion
    chat.mensajes = r.mensajes
    chat.pensando = r.pensando
    pintarLado()
    pintarChat()
    if (chat.pensando) seguirTurno()
  } catch (e) { error(e) }
}

function pintarChat() {
  const c = chat.actual
  const q = quienEs(c ?? { con: 'mastropiero' })
  $('#chat-cab').innerHTML = `<span class="avatar" style="--c:${q.color}">${q.glifo}</span><div><b>${esc(q.nombre)}</b><small>${esc(q.sub)}</small></div>
    <div class="fila">${c ? `<button class="btn btn-chico" id="chat-archivar" title="Sacar de la lista">Archivar</button>` : ''}</div>`
  const ar = $('#chat-archivar')
  if (ar) ar.onclick = async () => { await api(`/chat/${c.id}/archivar`, {}); chat.actual = null; await traerConversaciones(); pintarChat() }
  $('#chat-txt').placeholder = c && c.con !== 'mastropiero' ? `Escribile a ${q.nombre}…` : 'Escribile a Mastropiero…'
  const col = $('#hilo-col')
  $('#chat-audio').hidden = c?.modo !== 'diario'
  if (c?.modo === 'diario') $('#chat-txt').placeholder = 'Contá lo que quieras…'
  if (!c || !chat.mensajes.length) {
    const sug = c?.modo === 'diario' || c?.modo === 'hoy' ? [] : c && c.con !== 'mastropiero' ? SUGERENCIAS_AGENTE : SUGERENCIAS_MASTRO
    const texto = c?.modo === 'diario'
      ? 'Un espacio para contar tus cosas, escrito o en audio (🎙). Mastropiero escucha y pregunta poco; lo que contás queda como tu voz en el corpus y alimenta lo que sabe de vos.'
      : c?.modo === 'hoy'
        ? 'Acá llega tu jornada a la mañana y el cierre a la noche. Contale cómo va el día o pedile que lo reorganice.'
        : c && c.con !== 'mastropiero'
          ? 'Un agente de la liga. Contesta desde su oficio y puede leer el corpus según su nivel; no actúa sobre la plataforma.'
          : 'Mastropiero ve y opera todo: tu día, tu memoria, la liga y el corpus. Pedile lo que quieras en lenguaje natural; lo destructivo te lo confirma antes.'
    col.innerHTML = `<div class="chat-bienvenida"><div class="avatar" style="--c:${q.color}">${q.glifo}</div>
      <h2>${esc(q.nombre)}</h2><p>${texto}</p>
      ${sug.length ? `<div class="sugerencias">${sug.map((s) => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>`
    $$('[data-sug]', col).forEach((b) => (b.onclick = () => { $('#chat-txt').value = b.dataset.sug; enviarChat() }))
  } else col.innerHTML = hiloHTML(chat.mensajes, q, chat.pensando ? chat.vivo ?? {} : null)
  $('#chat-enviar').disabled = chat.pensando
  const hilo = $('#hilo')
  if (chat.pegado !== false) hilo.scrollTop = hilo.scrollHeight
}

/** Qué está haciendo, dicho en castellano y no en nombres de función. */
const VIVO = {
  buscar_corpus: (a) => `buscando «${a?.consulta ?? '…'}»`, leer_pieza: () => 'leyendo una fuente', ver_entidad: () => 'mirando una ficha',
  listar_entidades: () => 'repasando nombres', estado_general: () => 'mirando cómo está la liga', leer_lineamientos: () => 'releyendo sus lineamientos',
  listar_agentes: () => 'mirando el roster', ver_agente: (a) => `mirando a ${a?.id ?? 'un agente'}`, ver_bus: () => 'mirando el bus', ver_mision: () => 'leyendo una misión',
  listar_quantomos: () => 'repasando quántomos', listar_fuentes: () => 'mirando las fuentes', listar_cargas: () => 'mirando las cargas', ver_cronica: () => 'leyendo la crónica',
  forjar_agente: () => 'forjando un agente', hablar_con_agente: (a) => `hablando con ${a?.id ?? 'un agente'}`, correr_ticks: () => 'haciendo correr la liga',
  publicar_mision: () => 'publicando una misión', ingerir: () => 'guardando en el corpus', proponer_mejora: () => 'anotando una mejora', crear_proyecto: () => 'creando un proyecto',
}
const CONSULTA = {
  buscar_corpus: 'el corpus', leer_pieza: 'el corpus', listar_fuentes: 'el corpus', listar_entidades: 'quién es quién', ver_entidad: 'quién es quién',
  estado_general: 'la liga', listar_agentes: 'la liga', ver_agente: 'la liga', ver_bus: 'la liga', ver_mision: 'la liga', ver_cronica: 'la liga', listar_caidos: 'la liga',
  listar_cargas: 'las cargas', leer_lineamientos: 'sus lineamientos', listar_propuestas: 'las propuestas', listar_quantomos: 'los quántomos',
}
const listaY = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`)

function resumenActividad(herr) {
  const consultas = [...new Set(herr.map((m) => CONSULTA[m.herramienta]).filter(Boolean))]
  const acciones = herr.filter((m) => !CONSULTA[m.herramienta]).map((m) => m.resumen ?? m.herramienta.replace(/_/g, ' '))
  return [consultas.length ? `Consultó ${listaY(consultas)}` : '', ...acciones].filter(Boolean).join(' · ')
}

/** El hilo por turnos: lo que dijiste, una línea de lo que hizo, y lo que contestó (que se escribe en vivo). */
function hiloHTML(ms, q, vivo) {
  const turnos = []
  for (const m of ms) {
    if (m.rol === 'operador' || !turnos.length) turnos.push({ yo: m.rol === 'operador' ? m : null, herr: [], textos: [], errores: [], tokens: 0, modelo: null })
    const t = turnos.at(-1)
    if (m.rol === 'herramienta') t.herr.push(m)
    else if (m.rol === 'error') t.errores.push(m)
    else if (m.rol === 'asistente') {
      if (m.texto) t.textos.push(m.texto)
      t.tokens += m.tokens ?? 0
      t.modelo = m.modelo ?? t.modelo
    }
  }
  return turnos.map((t, i) => turnoHTML(t, q, i === turnos.length - 1 ? vivo : null)).join('')
}

function turnoHTML(t, q, vivo) {
  let h = t.yo ? `<div class="m m-yo"><div>${esc(t.yo.texto)}</div></div>` : ''
  const actividad = t.herr.length ? `<details class="actividad"><summary>${esc(resumenActividad(t.herr))}</summary><ul>${t.herr.map((m) => {
    let cuerpo = m.texto ?? ''
    try { cuerpo = JSON.stringify(JSON.parse(cuerpo), null, 2) } catch {}
    const falla = /^\{"error"/.test(m.texto ?? '') || /falló|no existe/.test(m.resumen ?? '')
    return `<li class="${falla ? 'falla' : ''}"><details><summary>${esc(m.resumen ?? m.herramienta)}</summary><pre>${esc(cuerpo.slice(0, 6000))}</pre></details></li>`
  }).join('')}</ul></details>` : ''
  const borrador = vivo?.borrador ?? ''
  const texto = [...t.textos, borrador].filter(Boolean).join('\n\n')
  const haciendo = vivo && !borrador
    ? `<div class="pensando"><span><i></i><i></i><i></i></span>${esc(vivo.herramienta ? (VIVO[vivo.herramienta]?.(vivo.argumentos) ?? 'trabajando') : t.herr.length ? 'pensando qué decirte' : 'pensando')}…</div>` : ''
  const meta = !vivo && t.modelo ? `<div class="m-meta">${esc(t.modelo)}${t.tokens ? ` · ${t.tokens.toLocaleString('es-AR')} tokens` : ''}</div>` : ''
  if (actividad || texto || haciendo) {
    h += `<div class="m m-el"><span class="avatar" style="--c:${q.color}">${q.glifo}</span><div>${actividad}
      ${texto ? `<div class="md">${md(texto)}${borrador ? '<span class="cursor"></span>' : ''}</div>` : ''}${haciendo}${meta}</div></div>`
  }
  return h + t.errores.map((m) => `<div class="m-error">${esc(m.texto)}</div>`).join('')
}

async function enviarChat() {
  const txt = $('#chat-txt')
  const texto = txt.value.trim()
  if (!texto || chat.pensando) return
  try {
    if (!chat.actual) {
      const c = await api('/chat', { con: 'mastropiero' })
      chat.actual = c
      chat.conversaciones.unshift(c)
    }
    await api(`/chat/${chat.actual.id}/mensajes`, { texto })
    txt.value = ''
    chat.borrador = ''
    txt.style.height = 'auto'
    chat.mensajes.push({ id: -1, rol: 'operador', texto })
    chat.pensando = true
    pintarChat()
    seguirTurno()
  } catch (e) { error(e) }
}

/** Mientras el turno corre, se leen los mensajes nuevos: las acciones aparecen a medida que pasan. */
function seguirTurno() {
  clearTimeout(chat.sondeo)
  const id = chat.actual?.id
  const paso = async () => {
    if (!id || chat.actual?.id !== id) return
    try {
      const r = await api(`/chat/${id}`)
      const antes = JSON.stringify([chat.mensajes.filter((m) => m.id > 0).length, chat.vivo, chat.pensando])
      chat.mensajes = r.mensajes
      chat.pensando = r.pensando
      chat.vivo = r.vivo
      const hilo = $('#hilo')
      // Si el operador subió a leer, no se lo arrastra para abajo.
      chat.pegado = !hilo || hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 80
      if ((vista === 'chat' || vista === 'hoy') && JSON.stringify([r.mensajes.length, r.vivo, r.pensando]) !== antes) pintarChat()
      if (r.pensando) chat.sondeo = setTimeout(paso, 300)
      else { chat.pegado = true; await refrescar(); await traerConversaciones(); if (vista === 'hoy') traerHoy() }
    } catch (e) { error(e) }
  }
  chat.sondeo = setTimeout(paso, 300)
}

async function modalPropuestas() {
  try {
    const ps = await api('/propuestas')
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Propuestas de mejora</h2>
      <p class="tenue">Las registra Mastropiero cuando ve algo para mejorar. No se aplican solas: aceptarlas es marcarlas para construir.</p>
      ${ps.length ? ps.map((p) => `<div class="quantomo ${p.estado === 'abierta' ? 'propuesta' : 'superado'}" style="margin-bottom:6px">
        <div class="q-top"><span class="pill ${p.estado === 'aceptada' ? 'activo' : p.estado === 'abierta' ? 'prueba' : 'banca'}">${p.estado}</span>
          ${p.area ? `<span class="tipo-chip">${esc(p.area)}</span>` : ''}${p.prioridad ? `<span class="tipo-chip">${esc(p.prioridad)}</span>` : ''}<span>#${p.id} · ${new Date(p.creada_en).toLocaleDateString('es-AR')}</span></div>
        <div class="q-texto"><b>${esc(p.titulo)}</b></div><div class="md tenue">${md(p.detalle)}</div>
        ${p.estado === 'abierta' ? `<div class="q-acciones"><button class="btn btn-chico btn-primario" data-prop="${p.id}" data-estado="aceptada">Aceptar</button><button class="btn btn-chico" data-prop="${p.id}" data-estado="descartada">Descartar</button></div>` : ''}
      </div>`).join('') : '<p class="tenue">Ninguna todavía. Pedile a Mastropiero que lea sus lineamientos y te proponga mejoras.</p>'}`)
    $$('[data-prop]').forEach((b) => (b.onclick = async () => {
      try { await api(`/propuestas/${b.dataset.prop}`, { estado: b.dataset.estado }); await refrescar(); modalPropuestas() } catch (e) { error(e) }
    }))
  } catch (e) { error(e) }
}

/** Abre el chat con Mastropiero con un mensaje listo para mandar. */
function preguntarAMastropiero(texto) {
  chat.borrador = texto
  chat.actual = chat.conversaciones.find((c) => c.con === 'mastropiero' && c.modo === 'chat') ?? null
  cerrarModal()
  irA('chat')
}

// Entidades

const TIPO_ENT = {
  persona: { glifo: '◐', nombre: 'Personas' }, proyecto: { glifo: '◆', nombre: 'Proyectos' }, agrupacion: { glifo: '⬡', nombre: 'Agrupaciones' },
  dominio: { glifo: '▦', nombre: 'Dominios' }, lugar: { glifo: '⌖', nombre: 'Lugares' }, concepto: { glifo: '✧', nombre: 'Conceptos' },
}
const filtroEnt = { tipo: '', q: '', sel: null }
let entLista = { total: 0, entidades: [] }

function montarEntidades() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Entidades</h1><p>Personas, proyectos, agrupaciones, dominios, lugares y conceptos que aparecen en el corpus, ordenados por cuántas piezas los mencionan.</p></div>
    <div class="chips" id="ent-tipos"></div>
    <div class="corpus-barra"><input class="campo-suelto" id="ent-q" placeholder="Buscar por nombre o alias…" value="${esc(filtroEnt.q)}"></div>
    <div class="ent-grid"><section><div id="ent-cuenta" class="cuenta"></div><div id="ent-lista"></div><div id="ent-mas"></div></section><aside class="ent-detalle" id="ent-detalle"></aside></div>`
  let espera
  $('#ent-q').oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { filtroEnt.q = e.target.value; traerEntidades() }, 250) }
  refrescarEntidades()
  traerEntidades()
  if (filtroEnt.sel) verEntidad(filtroEnt.sel)
  else $('#ent-detalle').innerHTML = ''
}

function refrescarEntidades() {
  const cont = $('#ent-tipos')
  if (!cont) return
  const n = Object.fromEntries(E.entidades.map((x) => [x.tipo, x.n]))
  const total = E.entidades.reduce((s, x) => s + x.n, 0)
  cont.innerHTML = `<button class="chip ${!filtroEnt.tipo ? 'on' : ''}" data-tipo-ent="">Todas ${total.toLocaleString('es-AR')}</button>` +
    Object.entries(TIPO_ENT).map(([k, t]) => `<button class="chip ${filtroEnt.tipo === k ? 'on' : ''}" data-tipo-ent="${k}">${t.glifo} ${t.nombre} ${(n[k] ?? 0).toLocaleString('es-AR')}</button>`).join('')
  $$('[data-tipo-ent]', cont).forEach((b) => (b.onclick = () => { filtroEnt.tipo = b.dataset.tipoEnt; refrescarEntidades(); traerEntidades() }))
}

async function traerEntidades(mas = false) {
  const p = new URLSearchParams({ limite: 60, desde: mas ? entLista.entidades.length : 0 })
  if (filtroEnt.tipo) p.set('tipo', filtroEnt.tipo)
  if (filtroEnt.q) p.set('q', filtroEnt.q)
  try {
    const r = await api(`/entidades?${p}`)
    entLista = mas ? { total: r.total, entidades: [...entLista.entidades, ...r.entidades] } : r
    const cont = $('#ent-lista')
    if (!cont) return
    $('#ent-cuenta').textContent = `${entLista.total.toLocaleString('es-AR')} entidad${entLista.total === 1 ? '' : 'es'}`
    cont.innerHTML = entLista.entidades.length ? `<div class="ent-lista">${entLista.entidades.map((e) => `
      <div class="ent-fila ${filtroEnt.sel === e.id ? 'sel' : ''}" data-ent="${e.id}"><i>${TIPO_ENT[e.tipo]?.glifo ?? '·'}</i>
        <div><b>${esc(e.nombre)}</b>${e.alias.length ? `<small>${esc(e.alias.slice(0, 4).join(' · '))}</small>` : ''}</div><em>${e.piezas}</em></div>`).join('')}</div>`
      : `<div class="vacio"><div class="gran">⚇</div><h2>Sin entidades${filtroEnt.tipo || filtroEnt.q ? ' con este filtro' : ''}</h2><p>Entran con las cargas: un respaldo de Deprocast trae personas, proyectos, agrupaciones, dominios y lugares.</p></div>`
    $$('[data-ent]', cont).forEach((el) => (el.onclick = () => verEntidad(Number(el.dataset.ent))))
    $('#ent-mas').innerHTML = entLista.entidades.length < entLista.total ? `<button class="btn" id="ent-mas-btn" style="width:100%;margin-top:8px">Ver más</button>` : ''
    const m = $('#ent-mas-btn')
    if (m) m.onclick = () => traerEntidades(true)
  } catch (e) { error(e) }
}

async function verEntidad(id) {
  filtroEnt.sel = id
  $$('.ent-fila').forEach((el) => el.classList.toggle('sel', Number(el.dataset.ent) === id))
  try {
    const { entidad: e, coocurrencias, total, piezas } = await api(`/entidades/${id}`)
    const det = $('#ent-detalle')
    if (!det) return
    const meta = e.meta ? Object.entries(e.meta).filter(([k, v]) => v != null && typeof v !== 'object' && k !== 'operador') : []
    det.innerHTML = `<div class="panel">
      <div class="p-top"><span class="tipo-chip">${TIPO_ENT[e.tipo]?.glifo ?? ''} ${esc(e.tipo)}</span>${e.meta?.operador ? '<span class="nivel-badge">el operador</span>' : ''}${meta.map(([k, v]) => `<span class="tipo-chip">${esc(k)}: ${esc(v)}</span>`).join('')}</div>
      <h2>${esc(e.nombre)}</h2>
      ${e.alias.length ? `<div class="tags">${e.alias.map((a) => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
      ${e.notas ? `<div class="notas">${esc(e.notas)}</div>` : ''}
      <div class="fila" style="margin:12px 0 4px"><button class="btn btn-chico btn-primario" id="ent-preguntar">☿ Preguntarle a Mastropiero</button></div>
      ${coocurrencias.length ? `<h3 class="sub">Aparece con</h3><div class="coocurre">${coocurrencias.map((x) => `<button data-co="${x.id}">${TIPO_ENT[x.tipo]?.glifo ?? ''} ${esc(x.nombre)}<em>${x.compartidas}</em></button>`).join('')}</div>` : ''}
      <h3 class="sub">Piezas que la mencionan · ${total.toLocaleString('es-AR')}</h3>
      ${piezas.length ? piezas.map(piezaHTML).join('') : '<p class="tenue">Ninguna pieza la menciona todavía.</p>'}
      ${total > piezas.length ? `<p class="tenue">Mostrando ${piezas.length}. En Corpus podés buscarla por nombre.</p>` : ''}
    </div>`
    $('#ent-preguntar').onclick = () => preguntarAMastropiero(`Contame sobre ${e.nombre} (entidad #${e.id}): qué es, con qué aparece y qué dice el corpus.`)
    $$('[data-co]', det).forEach((b) => (b.onclick = () => verEntidad(Number(b.dataset.co))))
  } catch (err) { error(err) }
}

// Matriz 72

function matrizHTML(mini, seleccion) {
  let html = `<div class="cab"></div>${OFICIOS.map((o) => `<div class="cab">${o}</div>`).join('')}`
  META.dominios72.forEach((d, di) => {
    html += `<div class="dom">${esc(d)}</div>`
    for (let o = 0; o < 9; o++) {
      const n = di * 9 + o + 1
      const ocupan = E.roster.filter((f) => f.celda === n)
      html += `<div class="celda ${ocupan.length ? 'llena' : ''} ${seleccion === n ? 'sel' : ''}" data-celda="${n}" title="${n} · ${esc(d)} · ${OFICIOS[o]}">
        <small>${String(n).padStart(2, '0')}</small>
        ${mini ? '' : `<span class="ocupa">${ocupan.map((f) => `<span style="color:${colorDe(f.clase)}" title="${esc(f.nombre ?? f.id)}">${claseDe(f.clase).glifo}</span>`).join('')}</span>`}
      </div>`
    }
  })
  return `<div class="matriz ${mini ? 'mini' : ''}">${html}</div>`
}

function montarMatriz() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Matriz 72</h1><p>8 dominios × 9 oficios (Input · Procesamiento · Output, por Cuerpo · Mente · Alma). La geometría de la 0.7.1. Varias cartas pueden compartir celda.</p></div>
    ${matrizHTML(false, null)}`
  $$('[data-celda]').forEach((c) => (c.onclick = () => {
    const n = Number(c.dataset.celda)
    const ocupan = E.roster.filter((f) => f.celda === n)
    if (ocupan.length === 1) return modalAgente(ocupan[0].id)
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Celda ${String(n).padStart(2, '0')}</h2>
      <p style="color:var(--tenue)">${esc(c.title)}</p>
      ${ocupan.length ? `<div class="mazo">${ocupan.map(cartaHTML).join('')}</div>` : '<p>Celda vacía: hay geometría, no hay acto.</p>'}
      <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="forjar-aqui">⚒ Forjar en esta celda</button></div>`)
    $('#forjar-aqui').onclick = () => { forja.celda = n; cerrarModal(); irA('forja') }
  }))
}

function modalMatriz(alElegir) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Elegí la celda</h2><p style="color:var(--tenue)">Es geometría de presentación: no cambia el contrato de la clase.</p>${matrizHTML(true, forja.celda)}`)
  $$('#modal [data-celda]').forEach((c) => (c.onclick = () => { alElegir(Number(c.dataset.celda)); cerrarModal() }))
}

// Cementerio

function montarCementerio() {
  const l = E.lapidas
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Cementerio</h1><p>Retirarse no es mejorar. Las designaciones y los nombres de los caídos no vuelven a usarse.</p></div>
    ${l.length ? `<div class="lapidas">${l.map((x) => {
      const c = claseDe(x.clase)
      return `<div class="lapida"><div class="cruz">✝</div><b>${esc(x.nombre ?? x.id)}</b>
        <div style="font:12px var(--mono)">${c.glifo} ${esc(c.nombre)} · ${x.xp} XP</div>
        <div style="font-size:12px">${esc(x.especializacion ?? 'sin especialidad')}</div>
        <div class="causa">${esc(x.causa)}</div>
        <div style="font:11px var(--mono);margin-top:6px">${new Date(x.retirado_en).toLocaleDateString('es-AR')}</div></div>`
    }).join('')}</div>` : `<div class="vacio"><div class="gran">✝</div><h2>Nadie cayó todavía</h2><p>Los reclutas que fallan ${R.PRUEBA_FALLOS} veces en prueba, y los que pasan ${R.DIAS_SIN_CORRER} días sin correr, terminan acá.</p></div>`}`
}

// Agente

async function modalAgente(id) {
  try {
    const { ficha: f, log, tareas } = await api(`/agentes/${encodeURIComponent(id)}`)
    const c = claseDe(f.clase)
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <div class="modal-agente">
        <div>${cartaHTML(f)}</div>
        <div>
          <h2 style="color:${colorDe(f.clase)}">${c.glifo} ${esc(f.nombre ?? f.id)}</h2>
          <p style="color:var(--tenue);margin:0">${esc(c.nombre)} — ${esc(c.produce)}</p>
          <p style="font-size:13.5px">Capa <b>${f.capa.nivel} · ${esc(f.capa.nombre)}</b>: ${esc(f.capa.abre)}.<br>
            Creador <b>${esc(f.creador)}</b> · Proyecto <b>${esc(f.proyectoId ?? 'libre')}</b> · Especialización <b>${esc(f.especializacion ?? '—')}</b>
            ${f.celdaInfo ? `<br>Celda <b>${f.celdaInfo.etiqueta} · ${esc(f.celdaInfo.dominio)} · ${esc(f.celdaInfo.ipo)}·${esc(f.celdaInfo.cma)}</b>` : ''}</p>
          <p style="font-size:13px;color:var(--tenue);font-style:italic">“${esc(f.instrucciones)}”</p>
          ${f.puedeBautizar ? `<div class="bautismo-box"><b>★ Se ganó un nombre.</b> Es único en la historia de la liga.
            <div class="fila" style="margin-top:8px"><input class="campo-suelto" id="a-nombre" placeholder="Nombre…" style="flex:1;margin:0"><button class="btn btn-primario" id="a-bautizar">Bautizar</button></div></div>` : ''}
          <div class="acciones-agente">
            ${f.estado === 'activo' ? '<button class="btn btn-peligro" data-estado="banca">⇣ Mandar a la banca</button>' : ''}
            ${f.estado === 'banca' ? '<button class="btn" data-estado="activo">⇡ Volver a jugar</button>' : ''}
            ${f.estado === 'prueba' ? `<span style="color:var(--aviso);font-size:13px">En prueba: ${f.exitos}/${R.PRUEBA_EXITOS} éxitos · ${f.fallos}/${R.PRUEBA_FALLOS} fallos.</span>` : ''}
            <button class="btn" id="a-mision">Encargar misión a su clase</button>
            <button class="btn" id="a-hablar">☿ Hablar</button>
            <button class="btn btn-peligro" id="a-retirar">Retirar</button>
          </div>
          <h3 style="color:var(--tenue);font-size:12px;letter-spacing:.12em;margin-bottom:0">BITÁCORA DEL AUDITOR</h3>
          ${log.length ? `<table class="log">${log.map((a) => `<tr><td class="${a.ok ? 'ok' : 'mal'}">${a.ok ? '✓' : '✗'}</td>
            <td style="font:11px var(--mono);color:var(--tenue);white-space:nowrap">${a.tareaId ? `<a href="#" data-ver-tarea="${a.tareaId}" style="color:var(--tenue)">#${a.tareaId}</a>` : 'asigna'}</td>
            <td>${esc(a.decision ?? '')}</td></tr>`).join('')}</table>` : '<p style="color:var(--tenue)">Todavía no corrió.</p>'}
        </div>
      </div>`)
    $$('[data-estado]').forEach((b) => (b.onclick = async () => {
      try { await api(`/agentes/${encodeURIComponent(f.id)}/estado`, { estado: b.dataset.estado }); await refrescar(); modalAgente(f.id) } catch (e) { error(e) }
    }))
    $('#a-mision').onclick = () => { cerrarModal(); mision.clase = f.clase; mision.proyectoId = f.proyectoId ?? ''; irA('misiones') }
    $('#a-hablar').onclick = () => {
      cerrarModal()
      const c = chat.conversaciones.find((x) => x.con === f.id)
      chat.actual = c ?? null
      irA('chat')
      if (!c) nuevaConversacion(f.id)
    }
    $('#a-retirar').onclick = async () => {
      if (!confirm(`¿Retirar a ${f.nombre ?? f.id} para siempre? Va al cementerio y su designación no vuelve.`)) return
      try { await api(`/agentes/${encodeURIComponent(f.id)}/retirar`, {}); cerrarModal(); toast(`✝ ${esc(f.nombre ?? f.id)} retirado`, 'suave'); await refrescar() } catch (err) { error(err) }
    }
    const bt = $('#a-bautizar')
    if (bt) {
      const bautizar = async () => {
        try {
          const g = await api(`/agentes/${encodeURIComponent(f.id)}/bautizar`, { nombre: $('#a-nombre').value })
          toast(`★ ${esc(f.id)} ahora se llama ${esc(g.nombre)}`)
          await refrescar()
          modalAgente(f.id)
        } catch (e) { error(e) }
      }
      bt.onclick = bautizar
      $('#a-nombre').onkeydown = (e) => e.key === 'Enter' && bautizar()
    }
  } catch (e) { error(e) }
}

document.addEventListener('click', (e) => {
  const carta = e.target.closest('[data-agente]')
  if (carta && !carta.closest('.vista-previa') && !carta.closest('.modal-agente')) return modalAgente(carta.dataset.agente)
  const verAg = e.target.closest('[data-ver-agente]')
  if (verAg) { e.preventDefault(); return modalAgente(verAg.dataset.verAgente) }
  const ref = e.target.closest('[data-ref-q], [data-ref-carga], [data-ref-propuestas], [data-ref-ent]')
  if (ref) {
    e.preventDefault()
    if (ref.dataset.refQ) return modalLinaje(Number(ref.dataset.refQ))
    if (ref.dataset.refCarga) return modalCarga(Number(ref.dataset.refCarga))
    if (ref.dataset.refEnt) { cerrarModal(); filtroEnt.sel = Number(ref.dataset.refEnt); return irA('entidades') }
    return modalPropuestas()
  }
  const pieza = e.target.closest('[data-pieza]')
  if (pieza && (!e.target.closest('a') || e.target.closest('a').dataset.pieza)) { e.preventDefault(); return modalPieza(Number(pieza.dataset.pieza)) }
  const verT = e.target.closest('[data-ver-tarea], [data-tarea]')
  if (verT) { e.preventDefault(); return modalTarea(verT.dataset.verTarea ?? verT.dataset.tarea) }
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
function aplicarCronica() {
  const ver = cronicaVisible && vista !== 'chat' && vista !== 'hoy'
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
  irA('hoy')
  firma = JSON.stringify(E)
  setInterval(() => { if (!tickEnCurso && $('#velo').hidden && vista !== 'forja') refrescar({ forzar: false }).catch(() => {}) }, 7000)
}

iniciar().catch(error)
