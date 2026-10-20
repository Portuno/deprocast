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
    <div class="cabecera"><div class="cabecera-texto"><h1>Misiones</h1><p>La principal, las de la semana y lo que encargaste.</p></div>
      <div class="fila"><button class="btn btn-primario" id="mi-procesar" title="Lee tu memoria y tu material propio y propone historia, inventario, candidatas a misión principal y primarias">Procesarme</button></div></div>
    <div id="mi-bucles"></div>
    <div id="mis"></div>`
  $('#mi-procesar').onclick = () => procesarme($('#mi-procesar'))
  traerMisiones()
  pintarSeccionBucles($('#mi-bucles'))
}

/** «Cómo rendís», compacto: un anillo con la tasa general y lo mejor y lo peor de tus runs. */
async function pintarRendimiento() {
  const cont = $('#mi-rinde-cuerpo')
  if (!cont) return
  let p
  try { p = await api('/rendimiento') } catch { return void (cont.innerHTML = '<p class="tenue chico">No pude leer tus runs.</p>') }
  if (p.bandas < 3) return void (cont.innerHTML = '<p class="tenue chico">Todavía hay pocas bandas marcadas. Marcá las de tus runs (hecha, a medias, no) y esto se llena solo.</p>')
  const pct = Math.round((p.tasa ?? 0) * 100)
  const mejor = (gs) => [...gs].filter((g) => g.n >= 3).sort((a, b) => b.tasa - a.tasa)[0]
  const peor = (gs) => [...gs].filter((g) => g.n >= 3).sort((a, b) => a.tasa - b.tasa)[0]
  const fila = (etq, g) => g ? `<div class="mr-fila"><span>${etq}</span><span class="mr-barra"><i style="width:${Math.round(g.tasa * 100)}%"></i></span><b>${esc(g.clave)}</b></div>` : ''
  cont.innerHTML = `<div class="mr">
      <div class="mr-anillo" style="--p:${pct}"><b>${pct}%</b><small>de ${p.bandas} bandas</small></div>
      <div class="mr-datos">${fila('Mejor franja', mejor(p.porFranja))}${fila('Peor franja', peor(p.porFranja))}${fila('Mejor largo', mejor(p.porLargo))}${fila('Mejor día', mejor(p.porDia))}</div>
    </div>
    <details class="mr-mas"><summary>Detalle</summary><p class="tenue chico">${esc(p.texto.split('\n')[0])}</p></details>`
}

function refrescarMisionesVida() {
  const f = JSON.stringify(E.hoy)
  if (f !== misFirma) { misFirma = f; traerMisiones() }
}

async function procesarme(boton) {
  await trabajando(boton, 'Procesándote…', async () => {
    await api('/jugador/procesar', {})
    // Corre de fondo (tarda más de lo que espera Cloudflare): se pregunta cada 3 s hasta que termine.
    let r
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 3000))
      const e = await api('/jugador/procesar')
      if (e.activo) continue
      if (e.error) throw new Error(e.error)
      r = e.resultado
      break
    }
    toast(`Listo<small>${r.historia ? 'Historia sugerida · ' : ''}${r.inventario} ítems de inventario · ${r.principales} candidatas a principal · ${r.primarias} primarias. Todo como sugerencia.</small>`)
    await refrescar()
    if (vista === 'misiones') traerMisiones()
    if (vista === 'jugador') montarJugador()
  })
}

/** Un color estable por categoría (ventas, producto, cuerpo…), para la franja de cada tarjeta. */
const colorCategoria = (c) => { let h = 0; for (const ch of String(c ?? '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return c ? `hsl(${h} 55% 62%)` : 'var(--acento)' }
const ESTADO_PRIM = { sugerida: ['○', 'pendiente: aceptala o cambiala'], activa: ['◐', 'en progreso'], hecha: ['●', 'cumplida'], parcial: ['◑', 'a medias'], no: ['✕', 'no salió'] }

async function traerMisiones() {
  const cont = $('#mis')
  if (!cont) return
  try {
    const d = await api(`/misiones${misSemana ? `?semana=${misSemana}` : ''}`)
    misFirma = JSON.stringify(E.hoy)
    const prim = (m) => {
      const [ico, est] = ESTADO_PRIM[m.estado] ?? ['·', m.estado]
      return `<article class="mis-prim ${m.estado}" data-mid="${m.id}" style="--c:${colorCategoria(m.categoria)}">
        <div class="mp-top"><span class="mp-estado" title="${esc(est)}">${ico} ${esc(est.split(':')[0])}</span>${m.categoria ? `<span class="tipo-chip">${esc(m.categoria)}</span>` : ''}${m.ayudantes?.length ? `<span class="mp-ayu" title="Ayudantes de la liga">✦ ${m.ayudantes.length}</span>` : ''}</div>
        <h4 title="${esc(m.detalle ?? m.titulo)}">${esc(m.titulo)}</h4>
        ${m.estado === 'sugerida'
          ? `<div class="mp-acc"><button class="btn btn-chico btn-primario" data-m-estado="activa">Aceptar</button><button class="btn btn-chico" data-m-editar>Cambiar</button><button class="btn btn-chico" data-m-estado="descartada" title="Descartar">✕</button></div>`
          : `<div class="mp-avance"><span class="mp-barra"><i style="width:${m.avance.progreso}%"></i></span><b>${m.avance.progreso}%</b></div>
             <small class="tenue">${m.avance.bandas.total ? `${m.avance.bandas.hechas} bandas · ${m.avance.minutos} min` : 'sin bandas todavía'}</small>
             ${m.avance.previos?.length ? `<small class="mp-previo" title="${esc(m.avance.previos.map((p) => `${p.titulo}${p.fecha ? ` (${p.fecha})` : ''}`).join('\n'))}">↳ Ya empezaste: ${m.avance.previos.length} ${m.avance.previos.length === 1 ? 'cosa' : 'cosas'} de antes</small>` : ''}
             <div class="mp-acc">${m.estado === 'activa' ? '<button class="btn btn-chico" data-m-estado="hecha" title="Cumplida">✓</button>' : '<button class="btn btn-chico" data-m-estado="activa" title="Reabrir">↺</button>'}<button class="btn btn-chico" data-m-detalle title="Avance, ayudantes y aportes">⋯</button><button class="btn btn-chico" data-m-editar title="Cambiar">✎</button><button class="btn btn-chico" data-m-estado="descartada" title="Descartar">✕</button></div>`}
      </article>`
    }
    const huecos = Math.max(0, 6 - d.primarias.length)
    const nRuns = d.runs.length
    const semanales = d.reportes.filter((r) => r.tipo === 'semana')
    cont.innerHTML = `
      <div class="mis-tablero">
        <div class="mis-izq">
          <section class="mis-card mis-norte">
            <div class="mis-card-cab"><h3>North Star</h3><button class="btn btn-chico" id="mi-fijar">${d.principal ? 'Cambiar' : 'Fijarla'}</button></div>
            <small class="mis-etq">Misión principal</small>
            ${d.principal ? `<h2>◎ ${esc(d.principal.titulo)}</h2>${d.principal.detalle ? `<p class="recorte">${esc(d.principal.detalle)}</p>` : ''}` : '<h2 class="sin">Sin fijar</h2><p class="tenue">Tu objetivo de vida, en una frase. Solo vos la fijás.</p>'}
            ${d.candidatas.length ? `<div class="candidatas"><small>Mastropiero sugiere:</small>${d.candidatas.map((c) => `<div class="fila"><span class="cand-txt"><b>${esc(c.titulo)}</b>${c.detalle ? `<small class="tenue recorte una">${esc(c.detalle)}</small>` : ''}</span><button class="btn btn-chico" data-elegir="${c.id}">Elegir</button></div>`).join('')}</div>` : ''}
          </section>
          <section class="mis-card"><div class="mis-card-cab"><h3>Cómo rendís</h3></div><div id="mi-rinde-cuerpo"><p class="tenue chico">…</p></div></section>
        </div>
        <div class="mis-der">
          <div class="mis-semana">
            <button class="btn btn-chico btn-icono" data-sem="${d.anterior}" title="Semana anterior">‹</button>
            <h2>Semana ${esc(d.semana.split('-W')[1])} <small>${esc(fmtSemana(d))}</small></h2>
            <button class="btn btn-chico btn-icono" data-sem="${d.siguiente}" title="Semana siguiente">›</button>
            <span style="flex:1"></span>
            ${d.primarias.some((m) => m.ayudantes?.length) ? '<button class="btn btn-chico" id="mi-aportes" title="Cada ayudante deja un aporte ahora (gasta tokens, dentro del tope)">Pedir aportes</button>' : ''}
            <button class="btn btn-chico" id="mi-reporte">Reporte de la semana</button>
          </div>
          <section class="mis-card mis-semanal">
            <div class="mis-card-cab"><h3>Primarias de la semana <small class="tenue">${d.primarias.filter((m) => m.estado === 'activa').length} activas · ${d.primarias.filter((m) => m.estado === 'hecha').length} cumplidas</small></h3><button class="btn btn-chico" id="mi-proponer">✦ Proponer primarias</button></div>
            <div class="mis-prims">${d.primarias.map(prim).join('')}${Array.from({ length: huecos }, () => '<button class="mis-hueco" data-nueva-prim>+ Primaria</button>').join('')}</div>
          </section>
        </div>
      </div>
      <div class="mis-abajo">
        <section class="mis-card">
          <div class="mis-card-cab"><h3>Side quests <small class="tenue">${d.terciarias.length}</small></h3></div>
          <div class="mis-lista">${d.terciarias.map((m) => `<div class="sq ${m.estado}" data-mid="${m.id}"><span>⚑ ${esc(m.titulo)}${m.disparador ? `<small>${esc(Object.values(m.disparador).filter(Boolean).join(' · '))}</small>` : m.vence ? `<small class="${m.vence < E.hoy.fecha ? 'vencida' : ''}">${esc(m.vence)}</small>` : ''}${m.estado === 'sugerida' ? '<small class="sugerida">sugerida</small>' : ''}</span>
            <span class="fila">${m.vence && m.estado !== 'sugerida' ? '<button class="btn btn-chico" data-m-agendar title="Llevar a mi calendario">📅</button>' : ''}${m.estado === 'sugerida' ? '<button class="btn btn-chico" data-m-estado="activa">Aceptar</button>' : '<button class="btn btn-chico" data-m-estado="hecha" title="Cumplida">✓</button>'}<button class="btn btn-chico" data-m-estado="descartada" title="Descartar">✕</button></span></div>`).join('') || '<p class="tenue chico">Ninguna abierta. Las anota Mastropiero cuando contás algo de pasada («cuando pase por…»).</p>'}</div>
          <form class="mis-form" id="sq-form"><input class="campo-suelto" id="sq-titulo" placeholder="Qué hacer…"><input class="campo-suelto" id="sq-donde" placeholder="Dónde o cuándo se activa"><button class="btn btn-chico">Anotar</button></form>
        </section>
        <section class="mis-card">
          <div class="mis-card-cab"><h3>Lo que les encargaste a otros <small class="tenue">${d.deOtros.length}</small></h3></div>
          <div class="mis-lista">${d.deOtros.map((m) => `<div class="sq" data-mid="${m.id}"><span><b>${esc(m.quien)}</b>: ${esc(m.titulo)}${m.vence ? `<small class="${m.vence < E.hoy.fecha ? 'vencida' : ''}">vence ${esc(m.vence)}</small>` : ''}</span>
            <span class="fila"><button class="btn btn-chico" data-m-estado="hecha" title="Lo hizo">✓</button><button class="btn btn-chico" data-m-estado="descartada" title="Ya no">✕</button></span></div>`).join('') || '<p class="tenue chico">Nada pendiente de otros.</p>'}</div>
          <form class="mis-form" id="ot-form"><input class="campo-suelto" id="ot-quien" placeholder="Quién"><input class="campo-suelto" id="ot-que" placeholder="Qué tiene que hacer"><input class="campo-suelto" id="ot-vence" type="date" title="Para cuándo"><button class="btn btn-chico">Asignar</button></form>
        </section>
      </div>
      ${nRuns || semanales.length ? `<details class="mis-card mis-historial"><summary><b>Runs y reportes de la semana</b> <span class="tenue">${nRuns} run${nRuns === 1 ? '' : 's'}${semanales.length ? ` · ${semanales.length} reporte${semanales.length === 1 ? '' : 's'}` : ''}</span></summary>
        ${d.runs.map((r) => {
          const h = r.misiones.filter((m) => m.estado === 'hecha').length
          return `<details class="run-pasada"><summary><b>${esc(new Date(`${r.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }))}</b> ${r.inicio}–${r.fin} · ${h} de ${r.misiones.length} hechas${r.estado === 'en_curso' ? ' · en curso' : ''}</summary>
            <ol class="bandas">${r.misiones.map((m) => `<li class="banda ${m.estado}"><span class="b-hora">${m.inicio}</span><div class="b-cuerpo"><b>${esc(m.titulo)}</b>${m.feedback ? `<small class="b-nota">“${esc(m.feedback)}”</small>` : ''}</div><span>${MARCA[m.estado] ?? ''}</span></li>`).join('')}</ol>
            ${r.reporte ? `<div class="md">${md(r.reporte)}</div>` : ''}</details>`
        }).join('')}
        ${semanales.map((r) => `<details class="run-pasada"><summary>Reporte · ${esc(new Date(r.creadoEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }))}</summary><div class="md">${md(r.texto)}</div></details>`).join('')}
      </details>` : ''}`
    engancharMisiones(cont, d)
    pintarRendimiento()
  } catch (e) { error(e) }
}

/** El detalle de una primaria (avance, ayudantes de la liga y sus aportes), en un modal: la tarjeta queda chica. */
function detallePrimaria(m, recargar) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <div class="mis-detalle" data-mid="${m.id}">
      <small class="mis-etq">${esc(ESTADO_PRIM[m.estado]?.[1] ?? m.estado)}${m.categoria ? ` · ${esc(m.categoria)}` : ''}</small>
      <h2>${esc(m.titulo)}</h2>
      ${m.detalle ? `<p>${esc(m.detalle)}</p>` : ''}
      ${m.entidadId ? `<p><a href="#" class="ref" data-ref-ent="${m.entidadId}">ver el proyecto</a></p>` : ''}
      <div class="p-avance"><span class="mp-barra"><i style="width:${m.avance.progreso}%"></i></span><b>${m.avance.progreso}%</b><small class="tenue">${m.avance.auto ? 'según lo hecho' : 'lo fijaste vos'}</small>
        ${m.avance.auto ? '<button class="btn btn-chico" data-m-corregir title="Si el número no refleja lo que pasó">Corregir</button>' : '<button class="btn btn-chico" data-m-auto title="Que lo calcule de lo hecho">↺ Automático</button>'}</div>
      <div class="p-avance" data-m-slider hidden><input type="range" min="0" max="100" step="5" value="${m.avance.progreso}" data-m-prog><b>${m.avance.progreso}%</b></div>
      ${m.avance.auto && m.avance.senales ? `<small class="tenue">${senalesTexto(m.avance.senales)}</small><br>` : ''}
      <small class="tenue">${m.avance.bandas.total ? `${m.avance.bandas.hechas} bandas hechas${m.avance.bandas.parciales ? `, ${m.avance.bandas.parciales} a medias` : ''} · ${m.avance.minutos} min de foco` : 'Todavía sin bandas'}</small>
      ${m.estado === 'activa' ? ayudantesHTML(m) : ''}
    </div>`)
  engancharPrimaria($('#modal'), recargar)
  engancharRecortes($('#modal'))
}

// haceCuanto vive en 05-comun.js (lo usa también Hoy).

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

/** Lo de una primaria (estado, avance, ayudantes, aportes): sirve para el tablero y para el modal de detalle. */
function engancharPrimaria(raiz, recargar) {
  $$('[data-ayu-clase]', raiz).forEach((sel) => (sel.onchange = async () => {
    if (!sel.value) return
    const mid = sel.closest('[data-mid]').dataset.mid
    try {
      const r = await api(`/misiones/${mid}/ayudantes`, { clase: sel.value })
      toast(`${esc(r.agente)} ayuda en esta primaria<small>Nace en prueba. Pedile un aporte cuando quieras; con las rutinas prendidas, trabaja solo cada mañana.</small>`)
      cerrarModal()
      await recargar()
    } catch (e) { error(e); sel.value = '' }
  }))
  $$('[data-quitar-ayu]', raiz).forEach((b) => (b.onclick = async () => {
    try { await api(`/ayudantes/${b.dataset.quitarAyu}/quitar`, {}); cerrarModal(); await recargar() } catch (e) { error(e) }
  }))
  $$('[data-pedir-aporte]', raiz).forEach((b) => (b.onclick = () => trabajando(b, 'Trabajando…', async () => {
    const r = await api('/aportes', { primariaId: Number(b.closest('[data-mid]').dataset.mid) })
    toast(`${r.aportes.length} aporte${r.aportes.length === 1 ? '' : 's'} nuevo${r.aportes.length === 1 ? '' : 's'}${r.fallas.length ? `<small>${esc(r.fallas.join(' · '))}</small>` : ''}${r.frenado ? `<small>Frenado: ${esc(r.frenado)}</small>` : ''}`, r.aportes.length ? '' : 'suave')
    cerrarModal()
    await recargar()
  })))
  $$('[data-m-estado]', raiz).forEach((b) => (b.onclick = async () => {
    try { await api(`/misiones/${b.closest('[data-mid]').dataset.mid}`, { estado: b.dataset.mEstado }); await recargar() } catch (e) { error(e) }
  }))
  $$('[data-m-agendar]', raiz).forEach((b) => (b.onclick = () => trabajando(b, '…', async () => {
    await api('/calendario/llevar', { origen: 'mision', id: Number(b.closest('[data-mid]').dataset.mid) })
    toast('En tu calendario 📅', 'suave')
  }).catch(error)))
  $$('[data-m-corregir]', raiz).forEach((b) => (b.onclick = () => { const s = b.closest('[data-mid]').querySelector('[data-m-slider]'); s.hidden = !s.hidden }))
  $$('[data-m-auto]', raiz).forEach((b) => (b.onclick = async () => { try { await api(`/misiones/${b.closest('[data-mid]').dataset.mid}`, { progresoAuto: true }); recargar() } catch (e) { error(e) } }))
  $$('[data-m-prog]', raiz).forEach((r) => {
    r.oninput = () => (r.nextElementSibling.textContent = `${r.value}%`)
    r.onchange = async () => { try { await api(`/misiones/${r.closest('[data-mid]').dataset.mid}`, { progreso: Number(r.value) }); recargar() } catch (e) { error(e) } }
  })
}

function engancharMisiones(cont, d) {
  const recargar = async () => { await refrescar(); traerMisiones() }
  engancharPrimaria(cont, recargar)
  const deTarjeta = (b) => d.primarias.find((x) => x.id === Number(b.closest('[data-mid]').dataset.mid))
  $$('[data-m-detalle]', cont).forEach((b) => (b.onclick = () => detallePrimaria(deTarjeta(b), recargar)))
  $$('[data-m-editar]', cont).forEach((b) => (b.onclick = () => modalMision(deTarjeta(b), recargar)))
  $$('[data-nueva-prim]', cont).forEach((b) => (b.onclick = () => modalMision({ nivel: 'primaria', semana: d.semana }, recargar)))
  const todos = $('#mi-aportes', cont)
  if (todos) todos.onclick = () => trabajando(todos, 'Trabajando…', async () => {
    const r = await api('/aportes', {})
    toast(`${r.aportes.length} aporte${r.aportes.length === 1 ? '' : 's'} nuevo${r.aportes.length === 1 ? '' : 's'}${r.frenado ? `<small>Frenado: ${esc(r.frenado)}</small>` : ''}`, r.aportes.length ? '' : 'suave')
    await recargar()
  })
  $$('[data-sem]', cont).forEach((b) => (b.onclick = () => { misSemana = b.dataset.sem; traerMisiones() }))
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
  $('#mi-reporte').onclick = () => trabajando($('#mi-reporte'), 'Escribiendo…', async () => {
    const r = await api('/reportes/semana', { semana: d.semana })
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Semana ${esc(d.semana.split('-W')[1])}</h2><div class="md">${md(r.texto)}</div>`)
    await recargar()
  })
  $('#sq-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const titulo = $('#sq-titulo').value.trim()
    if (!titulo) return
    try { await api('/misiones', { nivel: 'terciaria', titulo, disparador: $('#sq-donde').value.trim() ? { zona: $('#sq-donde').value.trim() } : null }); await recargar() } catch (e) { error(e) }
  }
  $('#ot-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const quien = $('#ot-quien').value.trim()
    const que = $('#ot-que').value.trim()
    if (!quien || !que) return toast('Decime quién y qué', 'error')
    try { await api('/misiones', { asignarA: quien, titulo: que, vence: $('#ot-vence').value || null }); await recargar() } catch (e) { error(e) }
  }
  engancharRecortes(cont)
}

function engancharRecortes(raiz) {
  $$('.recorte:not(.una)', raiz).forEach((p) => {
    const largo = (p.textContent || '').trim().length > 140
    if (!largo && p.scrollHeight <= p.clientHeight + 2) return
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn-link'
    b.textContent = 'ver más'
    b.onclick = () => {
      const abierto = p.classList.toggle('abierto')
      b.textContent = abierto ? 'ver menos' : 'ver más'
    }
    p.after(b)
  })
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
    <div class="cabecera"><div class="cabecera-texto"><h1 id="j-nombre">Jugador</h1><p>Tu historia y lo que Mastropiero sabe de vos.</p></div>
      <div class="fila"><button class="btn" id="j-procesar" title="Lee tu memoria y tu material propio y propone historia, inventario, candidatas a misión principal y primarias">Procesarme</button></div></div>
    <div class="tabs" id="j-tabs">${[['historia', 'Historia'], ['evidencia', 'Evidencia'], ['modelos', 'Modelos'], ['inventario', 'Inventario'], ['memoria', 'Memoria'], ['bitacora', 'Bitácora'], ['plata', 'Plata']].map(([k, n]) => `<button data-tab="${k}" class="${jugTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div id="j-cuerpo"></div>`
  $('#j-procesar').onclick = () => procesarme($('#j-procesar'))
  $$('#j-tabs [data-tab]').forEach((b) => (b.onclick = () => { jugTab = b.dataset.tab; montarJugador() }))
  if (jugTab === 'memoria') montarNorte($('#j-cuerpo'))
  else if (jugTab === 'evidencia') montarEvidencia($('#j-cuerpo'))
  else if (jugTab === 'modelos') montarModelos($('#j-cuerpo'))
  else if (jugTab === 'plata') montarPlata($('#j-cuerpo'))
  else if (jugTab === 'bitacora') montarBitacora($('#j-cuerpo'))
  else fichaPersonaje($('#j-cuerpo'), 'jugador', {
    tabs: [jugTab],
    alCargar: (f) => {
      $('#j-nombre').textContent = f.personaje.nombre
      const p = $('#principal .cabecera p')
      if (p && f.personaje.entidadId) p.innerHTML += ` <a href="#" class="ref" data-ref-ent="${f.personaje.entidadId}">Tu entidad en el corpus</a> · <a href="#" onclick="irA('personas');return false">Quién soy (tu perfil)</a>`
      else if (p && !f.personaje.entidadId) p.innerHTML += ' <span class="tenue">Todavía no sé cuál de las personas del corpus sos: buscate en Entidades y tocá «Soy yo».</span>'
    },
  })
}

// Bitácora íntima: su diario. Fuera del corpus; Mastropiero solo ve lo que él comparte; lo cifrado, nadie sin su clave.

let bitClave = null // vive solo en esta pestaña, mientras la tenga abierta

async function montarBitacora(cont) {
  let d
  try { d = bitClave ? await api('/bitacora/abrir', { clave: bitClave }) : await api('/bitacora') } catch (e) { return error(e) }
  const cifradas = d.entradas.filter((e) => e.cifrada).length
  const cerradas = d.entradas.filter((e) => e.cifrada && e.texto == null).length
  cont.innerHTML = `
    <p class="tenue">Tu diario. No entra al corpus, ni a la liga, ni a ningún modelo: Mastropiero solo lee las entradas que marcás «compartir». Si la cifrás, ni el respaldo ni quien abra la base la puede leer sin tu clave (que no se guarda: si la olvidás, se pierde).</p>
    <form id="bit-form" class="seccion">
      <textarea name="texto" rows="6" placeholder="${esc(d.disparador)}" style="width:100%"></textarea>
      <div class="fila">
        <span class="tenue">Ánimo</span>${[1, 2, 3, 4, 5].map((n) => `<label class="chip"><input type="radio" name="animo" value="${n}" hidden>${['😞', '😕', '😐', '🙂', '😄'][n - 1]}</label>`).join('')}
        <label><input type="checkbox" name="compartida"> compartir con Mastropiero</label>
        <label><input type="checkbox" name="cifrar"> cifrar</label>
        <input type="password" name="clave" placeholder="clave (6+)" hidden autocomplete="new-password" style="width:9em">
        <button class="btn btn-primario">Guardar</button>
      </div>
    </form>
    ${cifradas ? `<div class="fila">${cerradas ? `<span class="tenue">🔒 ${cerradas} cifrada${cerradas > 1 ? 's' : ''}</span><input type="password" id="bit-clave" placeholder="tu clave" autocomplete="current-password" style="width:9em"><button class="btn btn-chico" id="bit-abrir">Abrir</button>` : `<button class="btn btn-chico" id="bit-cerrar">🔒 Volver a cerrar</button>`}</div>` : ''}
    <div id="bit-lista">${d.entradas.map((e) => `
      <div class="seccion bit" data-id="${e.id}">
        <div class="fila"><b>${esc(e.fecha)}</b>${e.animo ? `<span>${['😞', '😕', '😐', '🙂', '😄'][e.animo - 1]}</span>` : ''}${e.cifrada ? '<span class="chip">🔒 cifrada</span>' : ''}${e.compartida ? '<span class="chip">compartida</span>' : ''}
          <span style="flex:1"></span>${e.cifrada ? '' : `<button class="btn btn-chico" data-compartir="${e.compartida ? 0 : 1}">${e.compartida ? 'Dejar de compartir' : 'Compartir'}</button>`}<button class="btn btn-chico" data-borrar title="Borrar para siempre">✕</button></div>
        <div class="md">${e.texto == null ? '<span class="tenue">(cifrada)</span>' : esc(e.texto).replace(/\n/g, '<br>')}</div>
      </div>`).join('') || '<p class="vacio">Todavía nada. Arriba tenés una pregunta por si no sabés por dónde empezar.</p>'}</div>`
  const f = $('#bit-form')
  $$('input[name=animo]', f).forEach((r) => (r.onchange = () => $$('input[name=animo]', f).forEach((x) => x.parentElement.classList.toggle('on', x.checked))))
  f.cifrar.onchange = () => { f.clave.hidden = !f.cifrar.checked; if (f.cifrar.checked) { f.compartida.checked = false; f.clave.value = bitClave ?? '' } }
  f.compartida.onchange = () => { if (f.compartida.checked) { f.cifrar.checked = false; f.clave.hidden = true } }
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    const clave = f.cifrar.checked ? f.clave.value : null
    try {
      await api('/bitacora', { texto: f.texto.value, animo: f.animo.value || null, compartida: f.compartida.checked, clave })
      if (clave) bitClave = clave
      montarBitacora(cont)
    } catch (e) { error(e) }
  }
  if ($('#bit-abrir')) $('#bit-abrir').onclick = async () => {
    const c = $('#bit-clave').value
    try {
      const r = await api('/bitacora/abrir', { clave: c })
      if (r.entradas.some((e) => e.cifrada && e.texto == null)) { toast('Esa clave no abre todas<small>Las que no abrió quedan cerradas.</small>') }
      bitClave = c
      montarBitacora(cont)
    } catch (e) { error(e) }
  }
  if ($('#bit-cerrar')) $('#bit-cerrar').onclick = () => { bitClave = null; montarBitacora(cont) }
  $$('.bit', cont).forEach((el) => {
    const id = el.dataset.id
    const c = $('[data-compartir]', el)
    if (c) c.onclick = async () => { try { await api(`/bitacora/${id}`, { compartida: c.dataset.compartir === '1' }); montarBitacora(cont) } catch (e) { error(e) } }
    $('[data-borrar]', el).onclick = async () => {
      if (!confirm('¿Borrar esta entrada para siempre?')) return
      try { await api(`/bitacora/${id}`, { borrar: true }); montarBitacora(cont) } catch (e) { error(e) }
    }
  })
}

// Plata: sus números del mes, contra su meta y por proyecto. Movimientos a mano, por el chat, por foto (un ticket por
// Telegram) o del CSV del banco; cada uno se ata solo al proyecto que nombra, y si no, se asigna acá.

let plataMes = new Date().toISOString().slice(0, 7)
const eur = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`

async function montarPlata(cont) {
  let d, h, ents
  try { [d, h, ents] = await Promise.all([api(`/finanzas?mes=${plataMes}`), api('/hoy'), api('/entidades?limite=400').catch(() => ({ entidades: [] }))]) } catch (e) { return error(e) }
  const opciones = (ents.entidades ?? []).filter((e) => ['proyecto', 'agrupacion', 'persona'].includes(e.tipo))
    .sort((a, b) => (a.tipo === 'proyecto' ? 0 : 1) - (b.tipo === 'proyecto' ? 0 : 1) || a.nombre.localeCompare(b.nombre))
  const r = d.resumen
  const meta = h.ajustes?.meta_ingresos_mes || ''
  const cats = Object.entries(r.porCategoria)
  const max = Math.max(1, ...cats.map(([, v]) => v))
  cont.innerHTML = `
    <div class="fila"><button class="btn btn-chico" id="pl-ant">‹</button><b>${esc(plataMes)}</b><button class="btn btn-chico" id="pl-sig">›</button>
      <span class="tenue">Meta del mes</span><input id="pl-meta" type="number" min="0" step="50" value="${esc(meta)}" placeholder="€" style="width:7em"><button class="btn btn-chico" id="pl-meta-ok">Guardar</button></div>
    <div class="plata-stats">
      <div class="stat"><b>${eur(r.ingresos)}</b><small>entró</small></div>
      <div class="stat"><b>${eur(r.gastos)}</b><small>salió</small></div>
      <div class="stat"><b>${eur(r.neto)}</b><small>neto</small></div>
      ${r.meta ? `<div class="stat"><b>${r.avanceMeta}%</b><small>de la meta (${eur(r.meta)})</small></div>` : ''}
      ${d.ritmo?.falta ? `<div class="stat"><b>${eur(d.ritmo.porDia)}</b><small>por día para llegar (faltan ${eur(d.ritmo.falta)} en ${d.ritmo.diasQuedan} días)</small></div>` : ''}
    </div>
    ${d.porProyecto?.length ? `<div class="seccion"><h3>Por proyecto</h3><div class="tarjetas">${d.porProyecto.map((p) => `<article class="tarjeta"><h4>${esc(p.nombre)}</h4>
      <p>${p.ingresos ? `entró ${eur(p.ingresos)} · ` : ''}${p.gastos ? `salió ${eur(p.gastos)} · ` : ''}${p.movimientos} movimiento${p.movimientos === 1 ? '' : 's'}</p>
      <b style="color:${p.neto >= 0 ? 'var(--ok, #6c6)' : 'inherit'}">${p.neto >= 0 ? '+' : ''}${eur(p.neto)}</b></article>`).join('')}</div></div>` : ''}
    ${cats.length ? `<div class="seccion"><h3>En qué se fue</h3>${cats.map(([k, v]) => `<div class="fila"><span style="width:9em">${esc(k)}</span><span class="barrita" style="flex:1"><b style="width:${Math.round((v / max) * 100)}%"></b></span><span>${eur(v)}</span></div>`).join('')}</div>` : ''}
    ${d.sugeridos?.length ? `<div class="seccion pl-sugeridos"><h3>Lo que contaste · ${d.sugeridos.length}</h3><p class="tenue">Montos que dijiste charlando. Aceptalos y entran a Finanzas.</p>
      ${d.sugeridos.map((x) => `<div class="fila item" data-sug="${x.id}"><span class="tenue">${esc(x.fecha)}</span><span style="flex:1" title="${esc(x.dicho ?? '')}">${esc(x.descripcion)}${x.dicho ? `<small class="tenue"> · «${esc(x.dicho.slice(0, 80))}»</small>` : ''}</span>
        <b style="color:${x.monto > 0 ? 'var(--ok, #6c6)' : 'inherit'}">${eur(x.monto)}</b><button class="btn btn-chico btn-primario" data-sug-si>✓ Anotar</button><button class="btn btn-chico" data-sug-no title="No era un movimiento">✕</button></div>`).join('')}</div>` : ''}
    <div class="seccion"><h3>Anotar</h3>
      <form class="fila" id="pl-form"><input name="monto" type="number" step="0.01" placeholder="-20 o 800" required style="width:8em"><input name="descripcion" placeholder="En qué" required style="flex:1"><input name="fecha" type="date"><button class="btn">Anotar</button></form>
      <p class="tenue">O contáselo a Mastropiero en el chat («gasté 20 en el súper»), o subí el extracto del banco: <label class="btn btn-chico">CSV del banco<input type="file" accept=".csv,.txt,text/csv" hidden id="pl-csv"></label></p></div>
    <div class="seccion"><h3>Movimientos (${d.movimientos.length})</h3>
      ${d.movimientos.length ? d.movimientos.map((m) => `<div class="fila item"><span class="tenue">${esc(m.fecha)}</span>${m.foto ? `<a href="${esc(m.foto)}" target="_blank" title="El ticket"><img src="${esc(m.foto)}" alt="" class="pl-ticket"></a>` : ''}<span style="flex:1">${esc(m.descripcion)}</span><span class="chip">${esc(m.categoria)}</span>
        <select class="pl-proy" data-proy="${m.id}" title="De qué proyecto o persona es"><option value="">— proyecto —</option>${opciones.map((e) => `<option value="${e.id}" ${m.entidadId === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select>
        <b style="color:${m.monto > 0 ? 'var(--ok, #6c6)' : 'inherit'}">${eur(m.monto)}</b><button class="btn btn-chico" data-borrar="${m.id}" title="Borrar">✕</button></div>`).join('') : '<p class="vacio">Nada este mes todavía.</p>'}
    </div>`
  const otro = (n) => { const [a, m] = plataMes.split('-').map(Number); const f = new Date(a, m - 1 + n, 1); plataMes = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`; montarPlata(cont) }
  $('#pl-ant').onclick = () => otro(-1)
  $('#pl-sig').onclick = () => otro(1)
  $('#pl-meta-ok').onclick = async () => { try { await api('/ajustes', { meta_ingresos_mes: $('#pl-meta').value }); montarPlata(cont) } catch (e) { error(e) } }
  $('#pl-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { const m = await api('/finanzas', { ...f, monto: Number(f.monto), fecha: f.fecha || undefined }); if (m.repetido) toast('Ya estaba anotado'); montarPlata(cont) } catch (e) { error(e) }
  }
  $('#pl-csv').onchange = async (ev) => {
    const a = ev.target.files[0]
    if (!a) return
    try {
      const r2 = await fetch('/api/finanzas/csv', { method: 'POST', body: a }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
      toast(`Extracto leído<small>${r2.nuevos} nuevos · ${r2.repetidos} ya estaban · ${r2.ignorados} filas sin monto</small>`)
      montarPlata(cont)
    } catch (e) { error(e) }
  }
  $$('[data-sug]', cont).forEach((el) => {
    const ir = (accion) => async () => { try { await api(`/finanzas/sugeridos/${el.dataset.sug}`, { accion }); montarPlata(cont) } catch (e) { error(e) } }
    $('[data-sug-si]', el).onclick = ir('aceptar')
    $('[data-sug-no]', el).onclick = ir('descartar')
  })
  $$('[data-borrar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/finanzas/${b.dataset.borrar}`, { borrar: true }); montarPlata(cont) } catch (e) { error(e) } }))
  $$('[data-proy]', cont).forEach((s) => (s.onchange = async () => { try { await api(`/finanzas/${s.dataset.proy}`, { entidadId: s.value ? Number(s.value) : null }); montarPlata(cont) } catch (e) { error(e) } }))
}

function refrescarJugador() {
  if (jugTab === 'memoria') refrescarNorte()
}

// Ficha de personaje: la misma para el jugador, las entidades, los agentes y Mastropiero

function elementosHTML(xs) {
  if (!xs?.length) return ''
  const corte = 8
  const mas = xs.length > corte
  return `<div class="elementos"><small>Elementos</small><div class="elementos-chips${mas ? ' cerrado' : ''}">${xs.map((x, i) => `<span${i >= corte ? ' class="elementos-extra"' : ''}>${esc(x)}</span>`).join('')}${mas ? `<button type="button" class="btn btn-chico" data-elementos-mas data-n="${xs.length}">ver todos (${xs.length})</button>` : ''}</div></div>`
}

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
      ${h.sugerencia ? `<div class="sugerencia"><small>Mastropiero sugiere</small><p>${esc(h.sugerencia.texto)}</p>${elementosHTML(h.sugerencia.elementos)}
        <div class="fila"><button class="btn btn-chico btn-primario" data-hist="aceptar">Aceptar</button><button class="btn btn-chico" data-hist="descartar">Descartar</button></div></div>` : ''}
      ${h.texto ? `<div class="historia">${md(h.texto)}</div>` : h.derivada ? `<p class="tenue historia-derivada">${esc(h.derivada)}</p>` : `<p class="tenue">Sin historia todavía.${clave === 'jugador' ? ' «Procesarme» propone una a partir de lo que sabe de vos.' : ''}</p>`}
      ${elementosHTML(h.elementos)}
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
  $$('[data-elementos-mas]', cont).forEach((b) => (b.onclick = () => {
    const cerrado = b.parentElement.classList.toggle('cerrado')
    b.textContent = cerrado ? `ver todos (${b.dataset.n})` : 'ver menos'
  }))
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

/** De dónde sale el % inferido, en una línea. */
function senalesTexto(s) {
  const n = (x, uno, varios) => (x ? `${String(x).replace('.5', '½')} ${x === 1 ? uno : varios}` : '')
  const partes = [n(s.bandas, 'banda', 'bandas'), n(s.aportes, 'aporte', 'aportes'), n(s.misiones, 'misión del proyecto', 'misiones del proyecto'), n(s.piezas, 'pieza tuya', 'piezas tuyas'), n(s.movimientos, 'movimiento', 'movimientos')].filter(Boolean)
  return partes.length ? `Sale de: ${partes.join(' · ')}` : 'Todavía no hay nada hecho que la empuje.'
}
