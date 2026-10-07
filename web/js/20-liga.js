'use strict'
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
        <label class="campo campo-ancho">Misión principal<input id="f-mision" placeholder="La razón por la que nace. No cambia nunca. Vacío = la de su oficio."></label>
      </section>
      <section class="vista-previa"><div id="f-prev"></div>
        <button class="btn btn-primario forjar" id="f-forjar">FORJAR</button></section>
    </div>`
  $('#f-instr').value = forja.instrucciones
  $('#f-instr').oninput = (e) => { forja.instrucciones = e.target.value }
  $('#f-mision').value = forja.mision ?? ''
  $('#f-mision').oninput = (e) => { forja.mision = e.target.value }
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
    const f = await api('/forja', { clase: forja.clase, reparto: forja.reparto, motor: forja.motor, instrucciones: forja.instrucciones, proyectoId: forja.proyectoId, celda: forja.celda, misionPrincipal: forja.mision })
    nuevas.add(f.id)
    forja.reparto = {}
    forja.instrucciones = ''
    forja.mision = ''
    forja.celda = null
    await refrescar()
    abrirModal(`<div style="display:grid;grid-template-columns:240px 1fr;gap:22px;align-items:center">
      ${cartaHTML(f)}
      <div><h2>¡${esc(f.id)} fue forjado!</h2>
        <p style="color:var(--tenue)">Entra en <b>prueba</b>. Necesita ${R.PRUEBA_EXITOS} misiones cumplidas para ganarse el roster. Si en ${R.DIAS_SIN_CORRER} días no corre, se borra.</p>
        <div class="fila"><button class="btn" data-cerrar id="otra">Forjar otro</button><button class="btn" id="encargar">Encargarle algo</button><button class="btn btn-primario" id="a-liga">Ir a la liga</button></div></div></div>`)
    $('#otra').onclick = () => { cerrarModal(); montarForja() }
    $('#a-liga').onclick = () => { cerrarModal(); nuevas.add(f.id); irA('liga') }
    $('#encargar').onclick = () => { cerrarModal(); mision.clase = f.clase; mision.proyectoId = f.proyectoId ?? ''; irA('encargos') }
  } catch (e) { error(e) }
}

// Misiones

function montarMisiones() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Encargos</h1><p>El bus de la liga: una sola cola. Publicás para una clase; el gerente (o Mastropiero) elige quién lo corre. Nadie llama a nadie.</p></div>
    <div class="panel">
      <div class="form-mision">
        <label class="campo">Clase<select id="m-clase">${META.clases.map((c) => `<option value="${c.id}" ${c.id === mision.clase ? 'selected' : ''}>${c.glifo} ${esc(c.nombre)}</option>`).join('')}</select></label>
        <label class="campo">Encargo<input id="m-texto" placeholder="Qué hay que hacer…"></label>
        <label class="campo">Proyecto<select id="m-proy"><option value="">— libre —</option>${E.liga.proyectos.map((p) => `<option value="${esc(p.id)}" ${p.id === mision.proyectoId ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
        <label class="campo">Dominio<input id="m-dom" placeholder="derecho, captura…"></label>
        <button class="btn btn-primario" id="m-publicar">Publicar</button>
      </div>
      <div id="m-extra"></div>
    </div>
    <div class="fila ingesta-barra" id="ingesta-barra"></div>
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
      toast(`Encargo #${t.id} en el bus<small>Dale Tick para que alguien lo tome.</small>`, 'suave')
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
  const barra = $('#ingesta-barra')
  const ingesta = E.tareas.filter((t) => t.pipeline === 'ingesta' && (t.estado === 'pendiente' || t.estado === 'asignada')).length
  barra.innerHTML = `<span class="tenue chico">${E.enEspera ? `${E.enEspera.toLocaleString('es-AR')} encargos de ingesta en espera (no gastan).` : 'La ingesta corre con los ticks.'}</span>
    ${E.enEspera ? '<button class="btn btn-chico" data-ing="reanudar">Reanudar 20 (lo propio primero)</button>' : ''}
    ${ingesta || !E.enEspera ? '<button class="btn btn-chico" data-ing="pausar">Pausar la ingesta</button>' : ''}`
  $$('[data-ing]', barra).forEach((b) => (b.onclick = async () => {
    try {
      const r = b.dataset.ing === 'pausar' ? await api('/ingesta/pausar', {}) : await api('/ingesta/reanudar', { limite: 20 })
      toast(b.dataset.ing === 'pausar' ? `${r.enEspera} encargos en espera` : `${r.reanudados} encargos de vuelta al bus`, 'suave')
      await refrescar()
    } catch (e) { error(e) }
  }))
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
            <button class="btn" id="a-mision">Encargar algo a su clase</button>
            <button class="btn" id="a-hablar">☿ Hablar</button>
            <button class="btn btn-peligro" id="a-retirar">Retirar</button>
          </div>
          <div class="ficha-agente" id="a-ficha"></div>
          <h3 style="color:var(--tenue);font-size:12px;letter-spacing:.12em;margin-bottom:0">BITÁCORA DEL AUDITOR</h3>
          ${log.length ? `<table class="log">${log.map((a) => `<tr><td class="${a.ok ? 'ok' : 'mal'}">${a.ok ? '✓' : '✗'}</td>
            <td style="font:11px var(--mono);color:var(--tenue);white-space:nowrap">${a.tareaId ? `<a href="#" data-ver-tarea="${a.tareaId}" style="color:var(--tenue)">#${a.tareaId}</a>` : 'asigna'}</td>
            <td>${esc(a.decision ?? '')}</td></tr>`).join('')}</table>` : '<p style="color:var(--tenue)">Todavía no corrió.</p>'}
        </div>
      </div>`)
    fichaPersonaje($('#a-ficha'), `agente:${f.id}`)
    $$('[data-estado]').forEach((b) => (b.onclick = async () => {
      try { await api(`/agentes/${encodeURIComponent(f.id)}/estado`, { estado: b.dataset.estado }); await refrescar(); modalAgente(f.id) } catch (e) { error(e) }
    }))
    $('#a-mision').onclick = () => { cerrarModal(); mision.clase = f.clase; mision.proyectoId = f.proyectoId ?? ''; irA('encargos') }
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
  if (e.target.closest('[data-ir-jugador]')) { e.preventDefault(); cerrarModal(); return irA('jugador') }
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
