'use strict'
// Norte

const TIPO_REC = { meta: 'meta', vision: 'visión', sueño: 'sueño', preferencia: 'preferencia', hecho: 'hecho', correccion: 'corrección' }
const HORIZ = [['castillo', 'Castillo', 'años · estrategia'], ['campamento', 'Campamento', 'semanas y meses'], ['trinchera', 'Trinchera', 'días']]

function montarNorte(cont = $('#principal')) {
  cont.innerHTML = `
    <div class="titulo titulo-chico"><p>Tu visión, tus metas y lo que Mastropiero sabe de vos. Se escribe solo con lo que le contás; acá lo corregís.</p>
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

// Misiones (las de la vida: principal, primarias, side quests, lo que otros deben)

let misSemana = null
let misFirma = ''
const fmtSemana = (d) => `${new Date(`${d.desde}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} – ${new Date(`${d.hasta}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`

function montarMisionesVida() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Misiones</h1><p>Tu misión principal, las primarias de la semana, tus side quests y lo que les encargaste a otros. Lo que propone Mastropiero aparece como sugerencia: vos decidís.</p>
      <div class="fila"><button class="btn" id="mi-procesar" title="Lee tu memoria y tu material propio y propone historia, inventario, candidatas a misión principal y primarias">Procesarme</button></div></div>
    <div id="mis"></div>`
  $('#mi-procesar').onclick = () => procesarme($('#mi-procesar'))
  traerMisiones()
}

function refrescarMisionesVida() {
  const f = JSON.stringify(E.hoy)
  if (f !== misFirma) { misFirma = f; traerMisiones() }
}

async function procesarme(boton) {
  await trabajando(boton, 'Procesándote…', async () => {
    const r = await api('/jugador/procesar', {})
    toast(`Listo<small>${r.historia ? 'Historia sugerida · ' : ''}${r.inventario} ítems de inventario · ${r.principales} candidatas a principal · ${r.primarias} primarias. Todo como sugerencia.</small>`)
    await refrescar()
    if (vista === 'misiones') traerMisiones()
    if (vista === 'jugador') montarJugador()
  })
}

async function traerMisiones() {
  const cont = $('#mis')
  if (!cont) return
  try {
    const d = await api(`/misiones${misSemana ? `?semana=${misSemana}` : ''}`)
    misFirma = JSON.stringify(E.hoy)
    const prim = (m) => `<div class="prim ${m.estado}" data-mid="${m.id}">
      <div class="p-top">${m.categoria ? `<span class="tipo-chip">${esc(m.categoria)}</span>` : ''}${m.estado === 'sugerida' ? '<span class="nivel-badge">sugerida</span>' : m.estado !== 'activa' ? `<span class="tipo-chip">${esc(m.estado)}</span>` : ''}</div>
      <h3>${esc(m.titulo)}</h3>
      ${m.detalle ? `<p>${esc(m.detalle)}</p>` : ''}
      ${m.entidadId ? `<a href="#" class="ref" data-ref-ent="${m.entidadId}">ver el proyecto</a>` : ''}
      ${m.estado === 'sugerida'
        ? `<div class="fila p-acc"><button class="btn btn-chico btn-primario" data-m-estado="activa">Aceptar</button><button class="btn btn-chico" data-m-editar>Cambiar</button><button class="btn btn-chico" data-m-estado="descartada">Descartar</button></div>`
        : `<div class="p-avance"><input type="range" min="0" max="100" step="5" value="${m.avance.progreso}" data-m-prog><b>${m.avance.progreso}%</b></div>
           <small class="tenue">${m.avance.bandas.total ? `${m.avance.bandas.hechas} bandas hechas${m.avance.bandas.parciales ? `, ${m.avance.bandas.parciales} a medias` : ''} · ${m.avance.minutos} min de foco` : 'Todavía sin bandas'}</small>
           <div class="fila p-acc">${m.estado === 'activa' ? '<button class="btn btn-chico" data-m-estado="hecha">✓ Cumplida</button>' : '<button class="btn btn-chico" data-m-estado="activa">Reabrir</button>'}<button class="btn btn-chico" data-m-editar>✎</button><button class="btn btn-chico" data-m-estado="descartada" title="Descartar">✕</button></div>
           ${m.estado === 'activa' ? ayudantesHTML(m) : ''}`}
    </div>`
    cont.innerHTML = `
      <section class="panel mi-principal">
        <small>Misión principal</small>
        ${d.principal ? `<h2>◎ ${esc(d.principal.titulo)}</h2>${d.principal.detalle ? `<p>${esc(d.principal.detalle)}</p>` : ''}` : '<h2 class="tenue">Sin fijar</h2><p class="tenue">Tu objetivo de vida, en una frase. Solo vos la fijás.</p>'}
        ${d.candidatas.length ? `<div class="candidatas"><small>Mastropiero sugiere:</small>${d.candidatas.map((c) => `<div class="fila"><span>${esc(c.titulo)}${c.detalle ? ` <small class="tenue">— ${esc(c.detalle)}</small>` : ''}</span><button class="btn btn-chico" data-elegir="${c.id}">Elegir esta</button></div>`).join('')}</div>` : ''}
        <div class="fila"><button class="btn btn-chico" id="mi-fijar">${d.principal ? 'Cambiar' : 'Fijarla'}</button></div>
      </section>
      <div class="mi-semana-cab">
        <button class="btn btn-chico btn-icono" data-sem="${d.anterior}" title="Semana anterior">‹</button>
        <h2>Semana ${esc(d.semana.split('-W')[1])} <small>${esc(fmtSemana(d))}</small></h2>
        <button class="btn btn-chico btn-icono" data-sem="${d.siguiente}" title="Semana siguiente">›</button>
        <span style="flex:1"></span>
        <button class="btn btn-chico" id="mi-proponer">Proponer primarias</button>
        <button class="btn btn-chico" id="mi-nueva">+ Primaria</button>
        <button class="btn btn-chico" id="mi-reporte">Reporte de la semana</button>
        ${d.primarias.some((m) => m.ayudantes?.length) ? '<button class="btn btn-chico" id="mi-aportes" title="Cada ayudante deja un aporte ahora (gasta tokens de la liga, dentro del tope)">Pedir aportes a todos</button>' : ''}
      </div>
      ${d.primarias.length ? `<div class="prim-grid">${d.primarias.map(prim).join('')}</div>` : `<div class="vacio"><div class="gran">⚔</div><h2>Sin primarias esta semana</h2><p>Hasta seis focos para la semana. Pedile a Mastropiero que te las proponga, o anotalas vos.</p></div>`}
      <div class="mi-cols">
        <section class="panel"><h3>Side quests</h3>
          ${d.terciarias.map((m) => `<div class="sq ${m.estado}" data-mid="${m.id}"><span>⚑ ${esc(m.titulo)}${m.disparador ? `<small>${esc(Object.values(m.disparador).filter(Boolean).join(' · '))}</small>` : ''}${m.estado === 'sugerida' ? '<small class="sugerida">sugerida</small>' : ''}</span>
            <span class="fila">${m.estado === 'sugerida' ? '<button class="btn btn-chico" data-m-estado="activa">Aceptar</button>' : '<button class="btn btn-chico" data-m-estado="hecha" title="Cumplida">✓</button>'}<button class="btn btn-chico" data-m-estado="descartada" title="Descartar">✕</button></span></div>`).join('') || '<p class="tenue chico">Ninguna abierta. Las anota Mastropiero cuando contás algo de pasada («cuando pase por…»).</p>'}
          <div class="form-sq"><input class="campo-suelto" id="sq-titulo" placeholder="Qué hacer…"><input class="campo-suelto" id="sq-donde" placeholder="Dónde o cuándo se activa (zona, lugar, actividad)"><button class="btn btn-chico" id="sq-agregar">Anotar</button></div>
        </section>
        <section class="panel"><h3>Lo que les encargaste a otros</h3>
          ${d.deOtros.map((m) => `<div class="sq" data-mid="${m.id}"><span><b>${esc(m.quien)}</b>: ${esc(m.titulo)}${m.vence ? `<small class="${m.vence < E.hoy.fecha ? 'vencida' : ''}">vence ${esc(m.vence)}</small>` : ''}</span>
            <span class="fila"><button class="btn btn-chico" data-m-estado="hecha" title="Lo hizo">✓</button><button class="btn btn-chico" data-m-estado="descartada" title="Ya no">✕</button></span></div>`).join('') || '<p class="tenue chico">Nada pendiente de otros.</p>'}
          <div class="form-sq"><input class="campo-suelto" id="ot-quien" placeholder="Quién"><input class="campo-suelto" id="ot-que" placeholder="Qué tiene que hacer"><input class="campo-suelto" id="ot-vence" type="date"><button class="btn btn-chico" id="ot-agregar">Asignar</button></div>
        </section>
      </div>
      <h3 class="sub">Runs de la semana</h3>
      ${d.runs.length ? d.runs.map((r) => {
        const h = r.misiones.filter((m) => m.estado === 'hecha').length
        return `<details class="run-pasada"><summary><b>${esc(new Date(`${r.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }))}</b> ${r.inicio}–${r.fin} · ${h} de ${r.misiones.length} hechas${r.estado === 'en_curso' ? ' · en curso' : ''}</summary>
          <ol class="bandas">${r.misiones.map((m) => `<li class="banda ${m.estado}"><span class="b-hora">${m.inicio}</span><div class="b-cuerpo"><b>${esc(m.titulo)}</b>${m.feedback ? `<small class="b-nota">“${esc(m.feedback)}”</small>` : ''}</div><span>${MARCA[m.estado] ?? ''}</span></li>`).join('')}</ol>
          ${r.reporte ? `<div class="md">${md(r.reporte)}</div>` : ''}</details>`
      }).join('') : '<p class="tenue chico">Ninguna todavía.</p>'}
      ${d.reportes.filter((r) => r.tipo === 'semana').length ? `<h3 class="sub">Reportes semanales</h3>${d.reportes.filter((r) => r.tipo === 'semana').map((r) => `<details class="run-pasada"><summary>${esc(new Date(r.creadoEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }))}</summary><div class="md">${md(r.texto)}</div></details>`).join('')}` : ''}`
    engancharMisiones(cont, d)
  } catch (e) { error(e) }
}

const haceCuanto = (ms) => {
  const min = Math.round((Date.now() - ms) / 60000)
  return min < 60 ? `hace ${Math.max(1, min)} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} d`
}

function ayudantesHTML(m) {
  const ays = m.ayudantes ?? []
  return `<div class="ayudantes">
    <small>Ayudantes de la liga</small>
    <div class="fila">${ays.map((a) => `<span class="ayu">${a.agente ? `<a href="#" data-ver-agente="${esc(a.agente.id)}">${claseDe(a.agente.clase)?.glifo ?? ''} ${esc(a.agente.nombre ?? a.agente.id)}</a>` : '—'}${a.ultimoAporte ? `<em>${haceCuanto(a.ultimoAporte)}</em>` : ''}<button data-quitar-ayu="${a.mision}" title="Sacar de esta primaria">✕</button></span>`).join('')}
      <select class="campo-suelto" data-ayu-clase title="Un agente que trabaja en esto entre runs"><option value="">+ Ayudante…</option><option value="generativo">✦ Generativo: borradores y próximos pasos</option><option value="buscador">⌕ Buscador: lo que hay en tu corpus</option><option value="explorador">◍ Explorador: sale a la web (comunidades, eventos, gente)</option></select>
      ${ays.length ? '<button class="btn btn-chico" data-pedir-aporte>Pedir aporte</button>' : ''}</div>
    ${m.aportes?.length ? `<details class="aportes"><summary>${m.aportes.length === 3 ? 'Últimos aportes' : `${m.aportes.length} aporte${m.aportes.length > 1 ? 's' : ''}`} · ${haceCuanto(m.aportes[0].en)}</summary>
      ${m.aportes.map((a) => `<div class="aporte"><small>${esc(a.autor ?? a.agente)} · ${new Date(a.en).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · <a href="#" class="ref" data-pieza="${a.id}">abrir</a></small><div class="md">${md(a.contenido)}</div></div>`).join('')}</details>` : ''}
  </div>`
}

function engancharMisiones(cont, d) {
  const recargar = async () => { await refrescar(); traerMisiones() }
  $$('[data-ayu-clase]', cont).forEach((sel) => (sel.onchange = async () => {
    if (!sel.value) return
    const mid = sel.closest('[data-mid]').dataset.mid
    try {
      const r = await api(`/misiones/${mid}/ayudantes`, { clase: sel.value })
      toast(`${esc(r.agente)} ayuda en esta primaria<small>Nace en prueba. Pedile un aporte cuando quieras; con las rutinas prendidas, trabaja solo cada mañana.</small>`)
      await recargar()
    } catch (e) { error(e); sel.value = '' }
  }))
  $$('[data-quitar-ayu]', cont).forEach((b) => (b.onclick = async () => {
    try { await api(`/ayudantes/${b.dataset.quitarAyu}/quitar`, {}); await recargar() } catch (e) { error(e) }
  }))
  const pedir = (boton, primariaId) => trabajando(boton, 'Trabajando…', async () => {
    const r = await api('/aportes', primariaId ? { primariaId } : {})
    toast(`${r.aportes.length} aporte${r.aportes.length === 1 ? '' : 's'} nuevo${r.aportes.length === 1 ? '' : 's'}${r.fallas.length ? `<small>${esc(r.fallas.join(' · '))}</small>` : ''}${r.frenado ? `<small>Frenado: ${esc(r.frenado)}</small>` : ''}`, r.aportes.length ? '' : 'suave')
    await recargar()
  })
  $$('[data-pedir-aporte]', cont).forEach((b) => (b.onclick = () => pedir(b, Number(b.closest('[data-mid]').dataset.mid))))
  const todos = $('#mi-aportes', cont)
  if (todos) todos.onclick = () => pedir(todos)
  $$('[data-sem]', cont).forEach((b) => (b.onclick = () => { misSemana = b.dataset.sem; traerMisiones() }))
  $$('[data-m-estado]', cont).forEach((b) => (b.onclick = async () => {
    try { await api(`/misiones/${b.closest('[data-mid]').dataset.mid}`, { estado: b.dataset.mEstado }); await recargar() } catch (e) { error(e) }
  }))
  $$('[data-m-prog]', cont).forEach((r) => {
    r.oninput = () => (r.nextElementSibling.textContent = `${r.value}%`)
    r.onchange = async () => { try { await api(`/misiones/${r.closest('[data-mid]').dataset.mid}`, { progreso: Number(r.value) }) } catch (e) { error(e) } }
  })
  $$('[data-m-editar]', cont).forEach((b) => (b.onclick = () => {
    const m = d.primarias.find((x) => x.id === Number(b.closest('[data-mid]').dataset.mid))
    modalMision(m, recargar)
  }))
  $$('[data-elegir]', cont).forEach((b) => (b.onclick = async () => {
    if (!confirm('¿Esta pasa a ser tu misión principal?')) return
    try { await api('/personajes/jugador/principal', { id: Number(b.dataset.elegir) }); await recargar() } catch (e) { error(e) }
  }))
  $('#mi-fijar').onclick = async () => {
    const t = prompt('Tu misión principal, en una frase:', d.principal?.titulo ?? '')
    if (!t?.trim()) return
    try { await api('/personajes/jugador/principal', { titulo: t.trim() }); await recargar() } catch (e) { error(e) }
  }
  $('#mi-proponer').onclick = () => trabajando($('#mi-proponer'), 'Pensando…', async () => {
    const texto = prompt('¿Algo que quieras que tenga en cuenta? (vacío = lo que ya sabe de vos)') ?? ''
    const r = await api('/misiones/primarias', { semana: d.semana, texto })
    toast(`${r.length} primarias sugeridas`, 'suave')
    await recargar()
  })
  $('#mi-nueva').onclick = () => modalMision({ nivel: 'primaria', semana: d.semana }, recargar)
  $('#mi-reporte').onclick = () => trabajando($('#mi-reporte'), 'Escribiendo…', async () => {
    const r = await api('/reportes/semana', { semana: d.semana })
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Semana ${esc(d.semana.split('-W')[1])}</h2><div class="md">${md(r.texto)}</div>`)
    await recargar()
  })
  $('#sq-agregar').onclick = async () => {
    const titulo = $('#sq-titulo').value.trim()
    if (!titulo) return
    try { await api('/misiones', { nivel: 'terciaria', titulo, disparador: $('#sq-donde').value.trim() ? { zona: $('#sq-donde').value.trim() } : null }); await recargar() } catch (e) { error(e) }
  }
  $('#ot-agregar').onclick = async () => {
    const quien = $('#ot-quien').value.trim()
    const que = $('#ot-que').value.trim()
    if (!quien || !que) return toast('Decime quién y qué', 'error')
    try { await api('/misiones', { asignarA: quien, titulo: que, vence: $('#ot-vence').value || null }); await recargar() } catch (e) { error(e) }
  }
}

function modalMision(m, luego) {
  const nueva = !m.id
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${nueva ? 'Nueva primaria' : 'Cambiar misión'}</h2>
    <div class="form-ing">
      <label class="campo campo-ancho">Título<input id="mm-titulo" value="${esc(m.titulo ?? '')}" placeholder="Publicar…, Escribir…, Cerrar…"></label>
      <label class="campo campo-ancho">Detalle<textarea id="mm-detalle" placeholder="Qué sería un buen avance">${esc(m.detalle ?? '')}</textarea></label>
      <label class="campo">Categoría<input id="mm-cat" value="${esc(m.categoria ?? '')}" placeholder="proyecto, salud, plata…"></label>
      <label class="campo">Proyecto o persona<input id="mm-ent" placeholder="nombre exacto (opcional)"></label>
    </div>
    <div class="fila" style="margin-top:12px"><button class="btn btn-primario" id="mm-guardar">Guardar</button></div>`)
  $('#mm-guardar').onclick = async () => {
    const cuerpo = { titulo: $('#mm-titulo').value.trim(), detalle: $('#mm-detalle').value.trim() || null, categoria: $('#mm-cat').value.trim() || null }
    try {
      let entidadId
      const ent = $('#mm-ent').value.trim()
      if (ent) {
        const r = await api(`/entidades?${new URLSearchParams({ q: ent, limite: 1 })}`)
        entidadId = r.entidades[0]?.id
        if (!entidadId) return toast(`No encuentro «${esc(ent)}» entre las entidades`, 'error')
      }
      if (nueva) await api('/misiones', { ...cuerpo, nivel: m.nivel, semana: m.semana, entidadId })
      else await api(`/misiones/${m.id}`, { ...cuerpo, ...(entidadId ? { entidadId } : {}), ...(m.estado === 'sugerida' ? { estado: 'activa' } : {}) })
      cerrarModal()
      luego()
    } catch (e) { error(e) }
  }
}

// Jugador: su ficha de personaje (historia, inventario) y su memoria (lo que era Norte)

let jugTab = 'historia'

function montarJugador() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1 id="j-nombre">Jugador</h1><p>Tu ficha de personaje: tu historia, tu inventario y lo que Mastropiero sabe de vos. Se escribe sola con lo que le contás; acá la corregís.</p>
      <div class="fila"><button class="btn" id="j-procesar" title="Lee tu memoria y tu material propio y propone historia, inventario, candidatas a misión principal y primarias">Procesarme</button></div></div>
    <div class="tabs" id="j-tabs">${[['historia', 'Historia'], ['inventario', 'Inventario'], ['memoria', 'Memoria']].map(([k, n]) => `<button data-tab="${k}" class="${jugTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div id="j-cuerpo"></div>`
  $('#j-procesar').onclick = () => procesarme($('#j-procesar'))
  $$('#j-tabs [data-tab]').forEach((b) => (b.onclick = () => { jugTab = b.dataset.tab; montarJugador() }))
  if (jugTab === 'memoria') montarNorte($('#j-cuerpo'))
  else fichaPersonaje($('#j-cuerpo'), 'jugador', {
    tabs: [jugTab],
    alCargar: (f) => {
      $('#j-nombre').textContent = f.personaje.nombre
      const p = $('#principal .titulo p')
      if (p && f.personaje.entidadId) p.innerHTML += ` <a href="#" class="ref" data-ref-ent="${f.personaje.entidadId}">Tu entidad en el corpus</a>`
      else if (p && !f.personaje.entidadId) p.innerHTML += ' <span class="tenue">Todavía no sé cuál de las personas del corpus sos: buscate en Entidades y tocá «Soy yo».</span>'
    },
  })
}

function refrescarJugador() {
  if (jugTab === 'memoria') refrescarNorte()
}

// Ficha de personaje: la misma para el jugador, las entidades, los agentes y Mastropiero

const TIPO_INV = { capital: 'Capital', conexion: 'Conexiones', presencia: 'Presencia digital', conocimiento: 'Conocimiento', herramienta: 'Herramientas', acceso: 'Accesos', recurso: 'Recursos' }
const NIVEL_MIS = { principal: 'Principal', primaria: 'Primarias', secundaria: 'Secundarias', terciaria: 'Side quests' }

async function fichaPersonaje(cont, clave, { tabs = ['misiones', 'historia', 'inventario'], tab = tabs[0], alCargar } = {}) {
  let f
  try { f = await api(`/personajes/${encodeURIComponent(clave)}`) } catch (e) { cont.innerHTML = ''; return error(e) }
  alCargar?.(f)
  const otra = () => fichaPersonaje(cont, clave, { tabs, tab, alCargar })
  const h = f.historia
  const secciones = {
    historia: () => `<div class="ficha-sec">
      ${h.sugerencia ? `<div class="sugerencia"><small>Mastropiero sugiere</small><p>${esc(h.sugerencia.texto)}</p>${h.sugerencia.elementos?.length ? `<div class="tags">${h.sugerencia.elementos.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="fila"><button class="btn btn-chico btn-primario" data-hist="aceptar">Aceptar</button><button class="btn btn-chico" data-hist="descartar">Descartar</button></div></div>` : ''}
      ${h.texto ? `<div class="historia">${md(h.texto)}</div>` : h.derivada ? `<p class="tenue historia-derivada">${esc(h.derivada)}</p>` : `<p class="tenue">Sin historia todavía.${clave === 'jugador' ? ' «Procesarme» propone una a partir de lo que sabe de vos.' : ''}</p>`}
      ${h.elementos?.length ? `<div class="tags">${h.elementos.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="fila" style="margin-top:8px"><button class="btn btn-chico" data-hist-editar>✎ Escribirla</button></div></div>`,
    inventario: () => {
      const porTipo = Object.keys(TIPO_INV).map((t) => [t, [...f.inventario.filter((i) => i.tipo === t), ...f.derivado.filter((i) => i.tipo === t).map((i) => ({ ...i, derivado: true }))]]).filter(([, xs]) => xs.length)
      return `<div class="ficha-sec">
        ${porTipo.length ? porTipo.map(([t, xs]) => `<h3 class="sub">${TIPO_INV[t]}</h3><div class="inv">${xs.map((i) => `<div class="item ${i.estado ?? ''} ${i.derivado ? 'derivado' : ''}" ${i.id ? `data-item="${i.id}"` : ''}>
            <span><b>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.nombre)}</a>` : esc(i.nombre)}</b>${i.valor != null ? ` <em>${esc(i.valor.toLocaleString('es-AR'))}${i.unidad ? ` ${esc(i.unidad)}` : ''}</em>` : ''}${i.detalle ? `<small>${esc(i.detalle)}</small>` : ''}</span>
            ${i.derivado ? '' : `<span class="r-acc">${i.estado === 'sugerido' ? '<button data-inv="vigente" title="Es así">✓</button>' : '<button data-inv-editar title="Corregir">✎</button>'}<button data-inv="archivado" title="Sacar">✕</button></span>`}
          </div>`).join('')}</div>`).join('') : `<p class="tenue">Inventario vacío.${clave === 'jugador' ? ' Contale a Mastropiero con qué contás (plata, contactos, sitios, saberes) o tocá «Procesarme».' : ''}</p>`}
        <div class="form-inv">
          <select class="campo-suelto" id="inv-tipo">${Object.entries(TIPO_INV).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
          <input class="campo-suelto" id="inv-nombre" placeholder="Qué es">
          <input class="campo-suelto" id="inv-valor" type="number" placeholder="Valor">
          <input class="campo-suelto" id="inv-unidad" placeholder="Unidad">
          <input class="campo-suelto" id="inv-extra" placeholder="Link o detalle">
          <button class="btn btn-chico" id="inv-agregar">Agregar</button>
        </div></div>`
    },
    misiones: () => {
      const p = f.principal
      const porNivel = ['principal', 'primaria', 'terciaria', 'secundaria'].map((n) => [n, f.misiones.filter((m) => m.nivel === n)]).filter(([, xs]) => xs.length)
      return `<div class="ficha-sec">
        <div class="mi-principal-mini"><small>Misión principal${f.personaje.tipo === 'agente' ? ' · nació con ella, no cambia' : ''}</small><b>${p ? esc(p.titulo) : '<span class="tenue">sin fijar</span>'}</b>${p?.detalle ? `<small>${esc(p.detalle)}</small>` : ''}</div>
        ${porNivel.map(([n, xs]) => `<h3 class="sub">${n === 'principal' ? 'Candidatas a principal' : NIVEL_MIS[n]}</h3>${xs.map((m) => `<div class="sq ${m.estado}" data-mid="${m.id}"><span>${esc(m.titulo)}${m.vence ? `<small>vence ${esc(m.vence)}</small>` : ''}${m.asignadaPor !== f.personaje.clave && m.asignadaPor !== 'sistema' ? `<small>${m.asignadaPor === 'jugador' ? 'se la encargaste vos' : `de ${esc(m.asignadaPor)}`}</small>` : ''}${m.estado === 'sugerida' ? '<small class="sugerida">sugerida</small>' : ''}</span>
            <span class="fila">${m.estado === 'sugerida' ? '<button class="btn btn-chico" data-fm="activa">Aceptar</button>' : '<button class="btn btn-chico" data-fm="hecha" title="Cumplida">✓</button>'}<button class="btn btn-chico" data-fm="descartada" title="Descartar">✕</button></span></div>`).join('')}`).join('')}
        ${f.encargos?.length ? `<h3 class="sub">Encargos en el bus</h3>${f.encargos.slice(0, 6).map((t) => `<div class="sq"><span><a href="#" data-ver-tarea="${t.id}">#${t.id}</a> ${esc(JSON.parse(t.payload || '{}').texto?.slice(0, 90) ?? t.tipo)}<small>${esc(t.estado)}</small></span></div>`).join('')}` : ''}
        ${f.asignadasPorEl?.length ? `<h3 class="sub">Encargó a otros</h3>${f.asignadasPorEl.map((m) => `<div class="sq"><span><b>${esc(m.quien)}</b>: ${esc(m.titulo)}</span></div>`).join('')}` : ''}
        ${f.personaje.tipo === 'jugador' ? '' : `<div class="form-sq"><input class="campo-suelto" id="fm-titulo" placeholder="${f.personaje.tipo === 'entidad' && f.personaje.subtipo === 'persona' ? 'Qué tiene que hacer (se la encargás vos)' : 'Nueva misión'}"><input class="campo-suelto" id="fm-vence" type="date" title="Vence"><button class="btn btn-chico" id="fm-agregar">Agregar</button></div>`}
        ${f.personaje.tipo !== 'agente' && f.personaje.tipo !== 'jugador' ? `<div class="fila" style="margin-top:6px"><button class="btn btn-chico" id="fm-principal">${p ? 'Cambiar su misión principal' : 'Fijar su misión principal'}</button></div>` : ''}
      </div>`
    },
  }
  cont.innerHTML = `${tabs.length > 1 ? `<div class="tabs chicas">${tabs.map((t) => `<button data-ftab="${t}" class="${t === tab ? 'on' : ''}">${{ historia: 'Historia', inventario: 'Inventario', misiones: 'Misiones' }[t]}</button>`).join('')}</div>` : ''}${secciones[tab]()}`
  $$('[data-ftab]', cont).forEach((b) => (b.onclick = () => fichaPersonaje(cont, clave, { tabs, tab: b.dataset.ftab, alCargar })))
  const k = encodeURIComponent(clave)
  const accion = async (fn) => { try { await fn(); await refrescar(); otra() } catch (e) { error(e) } }
  $$('[data-hist]', cont).forEach((b) => (b.onclick = () => accion(() => api(`/personajes/${k}/historia/${b.dataset.hist}`, {}))))
  const he = $('[data-hist-editar]', cont)
  if (he) he.onclick = () => {
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Historia de ${esc(f.personaje.nombre)}</h2>
      <label class="campo">Trasfondo y origen<textarea id="hi-texto" rows="9">${esc(h.texto ?? h.sugerencia?.texto ?? '')}</textarea></label>
      <label class="campo">Elementos base (separados por coma)<input id="hi-elem" value="${esc((h.elementos ?? []).join(', '))}"></label>
      <div class="fila" style="margin-top:12px"><button class="btn btn-primario" id="hi-guardar">Guardar</button></div>`)
    $('#hi-guardar').onclick = () => accion(async () => {
      await api(`/personajes/${k}/historia`, { texto: $('#hi-texto').value, elementos: $('#hi-elem').value.split(',').map((x) => x.trim()).filter(Boolean) })
      cerrarModal()
    })
  }
  $$('[data-inv]', cont).forEach((b) => (b.onclick = () => accion(() => api(`/inventario/${b.closest('[data-item]').dataset.item}`, { estado: b.dataset.inv }))))
  $$('[data-inv-editar]', cont).forEach((b) => (b.onclick = () => {
    const i = f.inventario.find((x) => x.id === Number(b.closest('[data-item]').dataset.item))
    const detalle = prompt(`Detalle de «${i.nombre}»:`, i.detalle ?? '')
    if (detalle === null) return
    const valor = prompt('Valor (vacío = sin número):', i.valor ?? '')
    accion(() => api(`/inventario/${i.id}`, { detalle: detalle.trim() || null, valor: valor === null || valor.trim() === '' ? null : Number(valor) }))
  }))
  const ia = $('#inv-agregar', cont)
  if (ia) ia.onclick = () => {
    const extra = $('#inv-extra').value.trim()
    const esUrl = /^https?:\/\//.test(extra)
    accion(() => api(`/personajes/${k}/inventario`, {
      tipo: $('#inv-tipo').value, nombre: $('#inv-nombre').value, valor: $('#inv-valor').value === '' ? null : Number($('#inv-valor').value),
      unidad: $('#inv-unidad').value || null, url: esUrl ? extra : null, detalle: esUrl ? null : extra || null,
    }))
  }
  $$('[data-fm]', cont).forEach((b) => (b.onclick = () => accion(() => api(`/misiones/${b.closest('[data-mid]').dataset.mid}`, { estado: b.dataset.fm }))))
  const fa = $('#fm-agregar', cont)
  if (fa) fa.onclick = () => {
    const titulo = $('#fm-titulo').value.trim()
    if (!titulo) return
    accion(() => api('/misiones', f.personaje.tipo === 'entidad' && f.personaje.subtipo === 'persona'
      ? { asignarA: clave, titulo, vence: $('#fm-vence').value || null }
      : { personaje: clave, nivel: 'primaria', titulo, vence: $('#fm-vence').value || null }))
  }
  const fp = $('#fm-principal', cont)
  if (fp) fp.onclick = () => {
    const t = prompt(`La misión principal de ${f.personaje.nombre}:`, f.principal?.titulo ?? '')
    if (t?.trim()) accion(() => api(`/personajes/${k}/principal`, { titulo: t.trim() }))
  }
}
