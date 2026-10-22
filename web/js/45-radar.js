'use strict'
// Radar: oportunidades que la liga encuentra afuera, con por qué te sirven y un borrador en tu voz.
// Se ven en lista (por estado y tipo), en el mapa o en el calendario.

const TIPO_OPOR = { comunidad: '◍', evento: '◷', convocatoria: '✉', beca: '✦', premio: '★', contacto: '◐', medio: '▤', otro: '·' }
const ESTADOS_OPOR = [['nueva', 'Nuevas'], ['me_interesa', 'Me interesan'], ['hecha', 'Hechas'], ['descartada', 'Descartadas']]
const radarVista = { estado: 'nueva', tipo: null, modo: (() => { try { return localStorage.getItem('mastro-radar-modo') || 'lista' } catch { return 'lista' } })() }
let radarFirma = ''
let radarDatos = null
let calConectado = null

async function montarRadar() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Radar</h1><p>Lo que la liga encuentra afuera para tus metas: comunidades, eventos, convocatorias, becas, medios, contactos. Cada una con por qué te sirve y, si querés, un borrador en tu voz. Nada se manda solo.</p></div>
    <div class="panel radar-buscar">
      <div class="fila">
        <input class="campo-suelto" id="rd-texto" placeholder="¿Qué busco? «gente que juegue juegos de mesa políticos», «festivales de cortos en Valencia»… (vacío: según tus metas)">
        <select class="campo-suelto" id="rd-mision"><option value="">Para mis metas en general</option></select>
        <button class="btn btn-primario" id="rd-buscar">Salir a buscar</button>
      </div>
      <p class="tenue chico" id="rd-cuotas"></p>
    </div>
    <div id="rd-barra"></div>
    <div id="rd-cuerpo"></div>`
  $('#rd-buscar').onclick = () => trabajando($('#rd-buscar'), 'Buscando…', async () => {
    const r = await api('/radar/buscar', { texto: $('#rd-texto').value.trim() || null, misionId: $('#rd-mision').value || null })
    toast(`${r.nuevas.length} oportunidad${r.nuevas.length === 1 ? '' : 'es'} nueva${r.nuevas.length === 1 ? '' : 's'}${r.aviso ? `<small>${esc(r.aviso)}</small>` : ''}`, r.nuevas.length ? '' : 'suave')
    radarVista.estado = 'nueva'
    traerRadar()
  })
  $('#rd-texto').onkeydown = (e) => e.key === 'Enter' && $('#rd-buscar').click()
  api('/calendario/estado').then((e) => { calConectado = e.conectado }).catch(() => {})
  traerRadar()
}

async function traerRadar() {
  if (!$('#rd-cuerpo')) return
  try {
    radarDatos = await api('/radar')
    const sel = $('#rd-mision')
    if (sel && sel.options.length === 1) sel.innerHTML += radarDatos.primarias.map((p) => `<option value="${p.id}">Para «${esc(p.titulo)}»</option>`).join('')
    $('#rd-cuotas').innerHTML = radarDatos.conBuscador
      ? `Buscadores este mes: ${radarDatos.cuotas.filter((c) => c.disponible).map((c) => `${c.id} ${c.usadas}/${c.limite}`).join(' · ')}`
      : 'Sin clave de buscador solo consulto Wikipedia. Para encontrar comunidades y gente, cargá <code>TAVILY_API_KEY</code> (gratis en tavily.com) en <code>.env</code> y reiniciá.'
    pintarRadar()
  } catch (e) { error(e) }
}

const hoyIso = () => new Date().toISOString().slice(0, 10)
const diasHasta = (f) => Math.round((new Date(`${f}T12:00:00`) - new Date(`${hoyIso()}T12:00:00`)) / 86_400_000)
const fechaOpor = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

function pintarRadar() {
  const d = radarDatos
  if (!d || !$('#rd-cuerpo')) return
  const todas = d.oportunidades
  const delEstado = todas.filter((o) => o.estado === radarVista.estado)
  const tipos = [...new Set(delEstado.map((o) => o.tipo))]
  if (radarVista.tipo && !tipos.includes(radarVista.tipo)) radarVista.tipo = null
  const xs = delEstado.filter((o) => !radarVista.tipo || o.tipo === radarVista.tipo)
  $('#rd-barra').innerHTML = `
    <div class="rd-barra">
      <div class="rd-tabs">${ESTADOS_OPOR.map(([e, n]) => `<button class="${radarVista.estado === e ? 'activo' : ''}" data-rd-estado="${e}">${n} <small>${todas.filter((o) => o.estado === e).length}</small></button>`).join('')}</div>
      <div class="cal-vistas">${[['lista', '☰ Lista'], ['mapa', '⌖ Mapa'], ['calendario', '▦ Calendario']].map(([m, t]) => `<button class="${radarVista.modo === m ? 'activo' : ''}" data-rd-modo="${m}">${t}</button>`).join('')}</div>
    </div>
    ${tipos.length > 1 ? `<div class="mp-capas">${[[null, 'Todos'], ...tipos.map((t) => [t, `${TIPO_OPOR[t] ?? '·'} ${t}`])].map(([t, n]) => `<button class="chip-capa ${radarVista.tipo === t ? 'activo' : ''}" data-rd-tipo="${t ?? ''}" style="--c:var(--acento)">${esc(n)} <small>${t ? delEstado.filter((o) => o.tipo === t).length : delEstado.length}</small></button>`).join('')}</div>` : ''}
    ${d.sinUbicar ? `<p class="chico tenue">${d.sinUbicar} sin lugar ni fecha todavía. <button class="btn btn-chico" id="rd-ubicar">📍 Ubicar en mapa y calendario</button></p>` : ''}`
  $$('[data-rd-estado]').forEach((b) => (b.onclick = () => { radarVista.estado = b.dataset.rdEstado; pintarRadar() }))
  $$('[data-rd-modo]').forEach((b) => (b.onclick = () => { radarVista.modo = b.dataset.rdModo; try { localStorage.setItem('mastro-radar-modo', radarVista.modo) } catch {}; pintarRadar() }))
  $$('[data-rd-tipo]').forEach((b) => (b.onclick = () => { radarVista.tipo = b.dataset.rdTipo || null; pintarRadar() }))
  const ub = $('#rd-ubicar')
  if (ub) ub.onclick = () => trabajando(ub, 'Ubicando…', async () => { const r = await api('/radar/ubicar', {}); toast(`${r.ubicadas} con lugar y fecha${r.quedan ? ` · quedan ${r.quedan}` : ''}`, 'suave'); traerRadar() })

  const cont = $('#rd-cuerpo')
  if (!todas.length) {
    cont.innerHTML = '<div class="vacio"><div class="gran">◍</div><h2>El radar todavía no salió</h2><p>Buscá algo arriba, sumale un ayudante <b>explorador</b> a una primaria, o esperá a la rutina (lunes y jueves a la mañana).</p></div>'
    return
  }
  if (radarVista.modo === 'mapa') {
    const conLugar = xs.filter((o) => o.lat != null && o.lon != null)
    cont.innerHTML = `<div class="mp-lienzo" id="rd-mapa"></div><p class="tenue chico">${conLugar.length} en el mapa${xs.filter((o) => o.online).length ? ` · ${xs.filter((o) => o.online).length} online` : ''}${xs.length - conLugar.length - xs.filter((o) => o.online).length > 0 ? ` · ${xs.length - conLugar.length - xs.filter((o) => o.online).length} sin lugar` : ''}</p>`
    pintarMapa($('#rd-mapa'), conLugar.map((o) => ({ id: `oportunidad:${o.id}`, capa: 'radar', titulo: o.titulo, lat: o.lat, lon: o.lon, aprox: true, detalle: [o.tipo, o.lugar, o.porQue].filter(Boolean).join(' · '), fecha: o.fecha ?? o.cierre, url: o.url, ref: { tipo: 'oportunidad', id: o.id } })), {
      acciones: (p) => [['agendar', '📅 Agendar'], p.url ? ['abrir', 'Abrir ↗'] : null].filter(Boolean),
      alAccion: (a, p) => (a === 'agendar' ? agendarOportunidad(p.ref.id) : accionDePunto(a, p)),
    }).catch((e) => { cont.innerHTML = `<p class="tenue">${esc(e.message)}</p>` })
    return
  }
  if (radarVista.modo === 'calendario') {
    cont.innerHTML = '<div class="panel" id="rd-cal"></div><p class="tenue chico">El Radar en el calendario: cuándo pasa cada una y cuándo cierra (de las nuevas y las que te interesan).</p>'
    pintarCalendario($('#rd-cal'), { soloCapas: ['radar'] })
    return
  }
  const pronto = xs.filter((o) => o.cierre && diasHasta(o.cierre) >= 0 && diasHasta(o.cierre) <= 7 && ['nueva', 'me_interesa'].includes(o.estado))
  const resto = xs.filter((o) => !pronto.includes(o))
  cont.innerHTML = xs.length
    ? `${pronto.length ? `<h3 class="sub rd-pronto">⏳ Cierra pronto · ${pronto.length}</h3><div class="opor-grid">${pronto.map(oporHTML).join('')}</div>` : ''}${resto.length ? `${pronto.length ? `<h3 class="sub">El resto · ${resto.length}</h3>` : ''}<div class="opor-grid">${resto.map(oporHTML).join('')}</div>` : ''}`
    : `<p class="tenue">Nada en «${esc(ESTADOS_OPOR.find(([e]) => e === radarVista.estado)?.[1] ?? '')}»${radarVista.tipo ? ` de tipo ${esc(radarVista.tipo)}` : ''}.</p>`
  $$('[data-op]', cont).forEach((card) => {
    const id = card.dataset.op
    $$('[data-op-estado]', card).forEach((b) => (b.onclick = async () => { try { await api(`/radar/${id}`, { estado: b.dataset.opEstado }); traerRadar() } catch (e) { error(e) } }))
    const br = $('[data-op-borrador]', card)
    if (br) br.onclick = () => trabajando(br, 'Redactando…', async () => { await api(`/radar/${id}/borrador`, {}); traerRadar() })
    const cp = $('[data-op-copiar]', card)
    if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(card.querySelector('.borrador pre').textContent); toast('Copiado', 'suave') } catch { toast('No pude copiar: seleccionalo a mano', 'error') } }
    const ag = $('[data-op-agendar]', card)
    if (ag) ag.onclick = () => agendarOportunidad(Number(id), ag)
  })
}

/** Lleva una oportunidad a su Google Calendar (si no tiene fecha, la pregunta). */
async function agendarOportunidad(id, boton) {
  if (calConectado === false) return toast('Conectá tu Google Calendar primero (Calendario → «Conectalo…»)', 'suave')
  const o = radarDatos?.oportunidades.find((x) => x.id === Number(id))
  let fecha = null
  if (o && !o.fecha && !o.cierre) {
    fecha = await preguntar('Esta no tiene fecha. ¿Qué día la ponés?', hoyIso(), { ok: 'Agendar', tipo: 'date' })
    if (!fecha) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return toast('La fecha va como AAAA-MM-DD')
  }
  try {
    const hacer = () => api('/calendario/llevar', { origen: 'oportunidad', id: Number(id), ...(fecha ? { fecha } : {}) })
    boton ? await trabajando(boton, '…', hacer) : await hacer()
    toast(o?.enCalendario ? 'Actualizada en tu calendario' : 'En tu calendario 📅', 'suave')
    traerRadar()
  } catch (e) { error(e) }
}

function oporHTML(o) {
  const cierra = o.cierre ? diasHasta(o.cierre) : null
  const urg = cierra == null ? '' : cierra < 0 ? 'cerro' : cierra <= 3 ? 'urg' : cierra <= 7 ? 'pronto' : ''
  const cuando = cierra == null ? '' : cierra < 0 ? `cerró el ${fechaOpor(o.cierre)}` : cierra === 0 ? 'cierra hoy' : cierra === 1 ? 'cierra mañana' : cierra <= 14 ? `cierra en ${cierra} días` : `cierra el ${fechaOpor(o.cierre)}`
  return `<article class="opor ${o.estado}" data-op="${o.id}">
    <div class="opor-meta">
      <span class="tipo-chip">${TIPO_OPOR[o.tipo] ?? '·'} ${esc(o.tipo)}</span>
      ${o.online ? '<span class="opor-dato">🌐 online</span>' : o.lugar ? `<span class="opor-dato">📍 ${esc(o.lugar)}</span>` : ''}
      ${o.fecha ? `<span class="opor-dato">📅 ${esc(fechaOpor(o.fecha))}${o.fechaFin && o.fechaFin !== o.fecha ? `–${esc(fechaOpor(o.fechaFin))}` : ''}</span>` : ''}
      ${cuando ? `<span class="opor-cierre ${urg}" title="${esc(o.cierre)}">${esc(cuando)}</span>` : ''}
    </div>
    <h3>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.titulo)}</a>` : esc(o.titulo)}</h3>
    ${o.descripcion ? `<p class="opor-desc" title="${esc(o.descripcion)}">${esc(o.descripcion)}</p>` : ''}
    ${o.porQue ? `<p class="porque">${esc(o.porQue)}</p>` : ''}
    ${o.borrador ? `<details class="borrador"><summary>✍ Borrador en tu voz</summary><pre>${esc(o.borrador)}</pre><button class="btn btn-chico" data-op-copiar>Copiar</button></details>` : ''}
    <div class="opor-acc">
      ${o.estado === 'descartada'
        ? '<button class="btn btn-chico" data-op-estado="nueva">↺ Recuperar</button>'
        : `${o.borrador ? '<button class="btn btn-chico" data-op-borrador title="Rehacer el borrador">✍ Rehacer</button>' : '<button class="btn btn-chico btn-primario" data-op-borrador>✍ Borrador</button>'}
          ${o.estado === 'nueva' ? '<button class="btn btn-chico" data-op-estado="me_interesa" title="Me interesa">☆ Me interesa</button>' : o.estado === 'me_interesa' ? '<button class="btn btn-chico activo" data-op-estado="nueva" title="Ya no me interesa">★ Te interesa</button>' : ''}
          ${o.fecha || o.cierre || o.estado !== 'hecha' ? `<button class="btn btn-chico ${o.enCalendario ? 'activo' : ''}" data-op-agendar title="${o.enCalendario ? 'Ya está en tu calendario (actualizar)' : 'Llevar a mi calendario'}">📅${o.enCalendario ? ' ✓' : ''}</button>` : ''}
          <span class="opor-sep"></span>
          ${o.estado !== 'hecha' ? '<button class="btn btn-chico" data-op-estado="hecha" title="Ya lo hice">✓</button>' : ''}
          <button class="btn btn-chico" data-op-estado="descartada" title="No va">✕</button>`}
    </div>
  </article>`
}

function refrescarRadar() {
  const f = JSON.stringify(E.hoy?.aviso ?? null)
  if (f !== radarFirma) { radarFirma = f; traerRadar() }
}
