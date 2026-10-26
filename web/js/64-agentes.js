'use strict'
// Los agentes con misión (plan v26): metas largas que un agente trabaja solo, en sesiones, con plan y diario. Lo que
// sale hacia afuera son borradores que vos mandás (en 📥 o acá, en Pistas). Misiones: cada una con su progreso contra
// el criterio, el embudo, el próximo paso y su diario; le podés indicar algo, pausarla o hacerla trabajar ya (en la
// nube). Pistas: las organizaciones que encontraron, con su etapa y el borrador.

const ag = { mision: null, filtroEtapa: '', filtroMision: '', timer: null }
const ESTADO_MISION_AG = { activa: 'Activa', pausada: 'Pausada', cumplida: 'Cumplida', fallida: 'Venció', abandonada: 'Abandonada' }
const METRICAS_AG = [['clientes', 'Clientes'], ['reuniones', 'Reuniones'], ['respuestas', 'Respuestas'], ['pistas', 'Pistas'], ['otro', 'Otro']]
const fechaAg = (t) => new Date(t).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const nombreAgente = (a, id) => (a ? a.nombre || a.id : id)

// ─── misiones ───────────────────────────────────────────────────────────

async function montarAgMisiones() {
  $('#principal').innerHTML = `<div class="titulo fila"><div class="f1"><h1>Misiones de tus agentes</h1><p>Una meta larga que un agente trabaja solo, varias veces por día en la nube: busca, anota, redacta. Lo que sale hacia afuera son borradores que mandás vos.</p></div><button class="btn btn-primario" id="ag-nueva">＋ Nueva misión</button></div><div id="ag-cuerpo"><p class="tenue">Juntando…</p></div>`
  $('#ag-nueva').onclick = () => modalNuevaMisionAg()
  if (ag.mision) return abrirMisionAg(ag.mision)
  pintarAgMisiones()
}

async function pintarAgMisiones() {
  let r
  try { r = await api('/agentes/misiones') } catch (e) { return error(e) }
  const cuerpo = $('#ag-cuerpo')
  if (!cuerpo) return
  if (!r.misiones.length) { cuerpo.innerHTML = '<div class="vacio"><p>Todavía ninguna. Una misión es algo como «tres clientes nuevos para tu productora antes de marzo»: le contás qué ofrecés y a quién, y un agente sale a buscar.</p></div>'; return }
  cuerpo.innerHTML = `<div class="ag-misiones">${r.misiones.map(tarjetaMisionAg).join('')}</div>`
  $$('[data-ag-mision]', cuerpo).forEach((b) => (b.onclick = () => abrirMisionAg(Number(b.dataset.agMision))))
}

const barraAg = (p) => `<progress class="ag-barra" max="${Math.max(1, p.meta)}" value="${Math.min(p.logrado, p.meta)}" title="${p.logrado} de ${p.meta}"></progress>`

function embudoAg(e) {
  const xs = Object.entries(e).filter(([k, n]) => n && k !== 'descartada')
  return xs.length ? `<p class="ag-embudo chico">${xs.map(([k, n]) => `<span>${esc(NOMBRE_ETAPA_AG[k] ?? k)} <b>${n}</b></span>`).join('')}</p>` : '<p class="chico tenue">Sin pistas todavía.</p>'
}
const NOMBRE_ETAPA_AG = { encontrada: 'Encontrada', borrador: 'Borrador', enviada: 'Enviada', respondio: 'Respondió', reunion: 'Reunión', cliente: 'Cliente', descartada: 'Descartada' }

function tarjetaMisionAg(m) {
  return `<button class="tarjeta ag-mision ${m.estado}" data-ag-mision="${m.id}">
    <div class="fila"><h4 class="f1">${esc(m.titulo)}</h4><span class="chip">${m.trabajando ? '⏳ trabajando' : esc(ESTADO_MISION_AG[m.estado] ?? m.estado)}</span></div>
    <small class="tenue">${esc(nombreAgente(m.agente, m.agenteId))} · ${esc(m.criterio.texto)}${m.vence ? ` · vence ${esc(m.vence)}` : ''}</small>
    ${barraAg(m.progreso)}${embudoAg(m.embudo)}
    ${m.proximo ? `<p class="chico">→ ${esc(m.proximo)}</p>` : ''}
    ${m.ultimo ? `<p class="chico tenue recorte">${fechaAg(m.ultimo.en)} · ${esc(m.ultimo.texto)}</p>` : ''}
  </button>`
}

async function abrirMisionAg(id) {
  ag.mision = id
  let r
  try { r = await api(`/agentes/misiones/${id}`) } catch (e) { ag.mision = null; return error(e) }
  const m = r.mision, cuerpo = $('#ag-cuerpo')
  if (!cuerpo) return
  const ICONO = { plan: '🗺', hallazgo: '🔎', paso: '·', reflexion: '💭', pregunta: '❓', instruccion: '🗣', resultado: '✓', sesion: '⏱' }
  cuerpo.innerHTML = `<div class="ag-detalle">
    <header class="aca-dom-cab"><button class="btn btn-chico" id="ag-volver">←</button><div class="f1"><h2>${esc(m.titulo)}</h2><small class="tenue">${esc(nombreAgente(r.agente, m.agenteId))}${r.agente ? ` · nivel ${r.agente.nivel ?? ''} · ${esc(r.agente.estado)}` : ''} · ${esc(m.criterio.texto)}${m.vence ? ` · vence ${esc(m.vence)}` : ''}</small></div><span class="chip">${r.trabajando ? '⏳ trabajando' : esc(ESTADO_MISION_AG[m.estado] ?? m.estado)}</span></header>
    ${barraAg(r.progreso)}<p class="chico">${r.progreso.logrado} de ${r.progreso.meta}</p>${embudoAg(r.embudo)}
    <div class="fila ag-acciones">
      ${m.estado === 'activa' ? '<button class="btn btn-primario" id="ag-trabajar" title="Una sesión ahora (en la nube: gasta tokens)">▶ Trabajar ahora</button><button class="btn" data-ag-estado="pausada">⏸ Pausar</button>' : ''}
      ${m.estado === 'pausada' ? '<button class="btn" data-ag-estado="activa">▶ Retomar</button>' : ''}
      ${['activa', 'pausada'].includes(m.estado) ? '<button class="btn" data-ag-estado="cumplida">✓ Cumplida</button><button class="btn" data-ag-estado="abandonada">✕ Abandonar</button>' : ''}
      <button class="btn" id="ag-ver-pistas">Ver sus pistas (${r.pistas.length})</button>
    </div>
    <section class="seccion"><h3>Indicale algo o preguntale</h3><div class="fila"><input id="ag-instruir" class="f1" placeholder="«Enfocate en bodas», «¿por qué elegiste esas?»…"><button class="btn" id="ag-instruir-ok" title="Queda en su diario y manda en su próxima sesión">Indicar</button><button class="btn" id="ag-hablar" title="Te contesta ahora, desde su plan y su diario (en la nube)">💬 Preguntarle</button></div><div id="ag-respuesta"></div></section>
    <section class="seccion"><h3>Su plan</h3>${m.plan.length ? `<ul class="ag-plan">${m.plan.map((p) => `<li class="${p.estado}">${p.estado === 'hecho' ? '✓' : p.estado === 'descartado' ? '✕' : '·'} ${esc(p.paso)}</li>`).join('')}</ul>` : '<p class="tenue">Lo arma en su primera sesión.</p>'}${m.proximo ? `<p class="chico">Próximo paso: ${esc(m.proximo)}</p>` : ''}</section>
    <section class="seccion"><h3>El brief</h3><p class="ag-brief">${esc(m.brief)}</p></section>
    <section class="seccion"><h3>Su diario</h3>${r.diario.length ? `<ol class="ag-diario">${r.diario.map((d) => `<li class="ag-d-${d.tipo}"><span>${ICONO[d.tipo] ?? '·'}</span><div class="f1"><small class="tenue">${fechaAg(d.en)} · ${esc(d.tipo)}</small><p>${esc(d.texto)}</p></div>${d.tipo === 'sesion' ? botonesFbAg(`diario:${d.id}`) : ''}</li>`).join('')}</ol>` : '<p class="tenue">Vacío: empieza con su primera sesión.</p>'}</section>
  </div>`
  $('#ag-volver').onclick = () => { ag.mision = null; pintarAgMisiones() }
  engancharFbAg(cuerpo)
  $('#ag-ver-pistas').onclick = () => { ag.filtroMision = String(m.id); irA('agpistas') }
  $$('[data-ag-estado]', cuerpo).forEach((b) => (b.onclick = async () => { try { await api(`/agentes/misiones/${m.id}`, { estado: b.dataset.agEstado }); abrirMisionAg(m.id) } catch (e) { error(e) } }))
  const instruir = async () => { const t = $('#ag-instruir').value.trim(); if (!t) return; try { await api(`/agentes/misiones/${m.id}/instruir`, { texto: t }); toast('Anotado: manda en su próxima sesión', 'suave'); abrirMisionAg(m.id) } catch (e) { error(e) } }
  $('#ag-instruir-ok').onclick = instruir
  $('#ag-instruir').onkeydown = (e) => { if (e.key === 'Enter') instruir() }
  $('#ag-hablar').onclick = async () => {
    const t = $('#ag-instruir').value.trim(), b = $('#ag-hablar')
    if (!t) return
    b.disabled = true
    $('#ag-respuesta').innerHTML = '<p class="tenue chico">Pensando…</p>'
    try {
      const x = await api(`/agentes/misiones/${m.id}/hablar`, { texto: t })
      await abrirMisionAg(m.id)
      const r = $('#ag-respuesta')
      if (r) r.innerHTML = `<blockquote class="ag-dice">${esc(x.respuesta)}</blockquote>`
    } catch (e) { $('#ag-respuesta').innerHTML = ''; error(e); b.disabled = false }
  }
  const tr = $('#ag-trabajar')
  if (tr) tr.onclick = async () => {
    tr.disabled = true; tr.textContent = '⏳ Trabajando…'
    try { const x = await api(`/agentes/misiones/${m.id}/trabajar`, {}); toast(`Sesión ${x.sesion}: ${x.pasos.length} pasos${x.cerrada ? '' : ' (sin cerrar)'}`, 'suave') } catch (e) { error(e) }
    abrirMisionAg(m.id)
  }
}

async function modalNuevaMisionAg() {
  let ents = []
  try { ents = (await api('/entidades?tipo=proyecto&limite=200')).entidades } catch { /* sin entidades: se crea sin proyecto */ }
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Una misión nueva</h2>
    <label class="campo">Qué tiene que lograr<input id="agn-titulo" placeholder="Ej.: Tres clientes nuevos para la productora"></label>
    <label class="campo">El brief<textarea id="agn-brief" rows="6" placeholder="Qué ofrecés, a quién, dónde, precios, links de muestra. Es todo lo que el agente sabe de entrada."></textarea></label>
    <div class="fila"><label class="campo f1">Se mide en<select id="agn-metrica">${METRICAS_AG.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label><label class="campo">Cuántos<input id="agn-meta" type="number" min="1" value="3"></label><label class="campo">Vence<input id="agn-vence" type="date"></label></div>
    <label class="campo">Para qué proyecto<select id="agn-entidad"><option value="">—</option>${ents.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></label>
    <p class="chico tenue">Se forja un agente buscador para esta misión. Trabaja en la nube, tres veces por día según su ritmo; lo que redacta te llega a 📥.</p>
    <div class="fila"><button class="btn btn-primario" id="agn-ok">Crear la misión</button></div>`)
  $('#agn-ok').onclick = async () => {
    try {
      const m = await api('/agentes/misiones', {
        titulo: $('#agn-titulo').value, brief: $('#agn-brief').value, vence: $('#agn-vence').value || null, entidadId: $('#agn-entidad').value ? Number($('#agn-entidad').value) : null,
        criterio: { metrica: $('#agn-metrica').value, meta: Number($('#agn-meta').value) || 1 },
      })
      cerrarModal(); ag.mision = m.id; irA('agmisiones'); abrirMisionAg(m.id)
    } catch (e) { error(e) }
  }
}

// ─── tu feedback (va a su paga y a las lecciones de los agentes) ─────────

const botonesFbAg = (ref) => `<span class="fila ag-fb"><button class="btn btn-chico btn-icono" data-ag-fb="${ref}" data-valor="1" title="Sirvió">👍</button><button class="btn btn-chico btn-icono" data-ag-fb="${ref}" data-valor="-1" title="No sirvió">👎</button></span>`
function engancharFbAg(raiz) {
  $$('[data-ag-fb]', raiz).forEach((b) => (b.onclick = async () => {
    try {
      await api('/devoluciones', { superficie: 'agentes', ref: b.dataset.agFb, valor: Number(b.dataset.valor) })
      $$(`[data-ag-fb="${b.dataset.agFb}"]`, raiz).forEach((x) => x.classList.toggle('on', x === b))
      toast('Anotado: cuenta para su paga y sus lecciones', 'suave')
    } catch (e) { error(e) }
  }))
}

// ─── pistas ─────────────────────────────────────────────────────────────

async function montarAgPistas() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Pistas</h1><p>Las organizaciones que encontraron tus agentes, con el link de donde las sacaron. Cuando hay borrador, revisalo, copialo y mandalo vos; después marcá qué pasó: eso le enseña al agente qué funciona.</p></div><div id="ag-pistas"><p class="tenue">Juntando…</p></div>`
  pintarAgPistas()
}

async function pintarAgPistas() {
  let r, ms
  try { [r, ms] = await Promise.all([api(`/agentes/pistas${ag.filtroMision ? `?mision=${ag.filtroMision}` : ''}`), api('/agentes/misiones')]) } catch (e) { return error(e) }
  const caja = $('#ag-pistas')
  if (!caja) return
  const xs = r.pistas.filter((p) => !ag.filtroEtapa || p.etapa === ag.filtroEtapa)
  const titulo = new Map(ms.misiones.map((m) => [m.id, m.titulo]))
  caja.innerHTML = `<div class="fila ag-filtros"><select id="ag-f-mision"><option value="">Todas las misiones</option>${ms.misiones.map((m) => `<option value="${m.id}" ${String(m.id) === ag.filtroMision ? 'selected' : ''}>${esc(m.titulo)}</option>`).join('')}</select>
      <div class="tabs">${[['', 'Todas'], ...r.etapas.map((k) => [k, r.nombres[k]])].map(([k, n]) => `<button data-ag-etapa="${k}" class="${ag.filtroEtapa === k ? 'on' : ''}">${esc(n)}</button>`).join('')}</div></div>
    ${xs.length ? `<ul class="ag-pistas">${xs.map((p) => `<li class="ag-pista ${p.etapa}">
      <div class="fila"><div class="f1"><b>${esc(p.contacto.organizacion || p.titulo)}</b>${p.url ? ` <a href="${esc(p.url)}" target="_blank" rel="noopener" class="chico">web ↗</a>` : ''}${p.contacto.url ? ` <a href="${esc(p.contacto.url)}" target="_blank" rel="noopener" class="chico">contacto ↗</a>` : ''}
        <br><small class="tenue">${esc(titulo.get(p.misionId) ?? '')} · ${esc(p.contacto.canal)}${p.lugar ? ` · ${esc(p.lugar)}` : ''}</small></div>
        <select data-ag-pista="${p.id}">${r.etapas.map((k) => `<option value="${k}" ${p.etapa === k ? 'selected' : ''} ${k === 'borrador' ? 'disabled' : ''}>${esc(r.nombres[k])}</option>`).join('')}</select></div>
      ${p.porQue ? `<p class="chico">${esc(p.porQue)}</p>` : ''}
      ${p.etapa === 'borrador' && p.borrador ? `<textarea class="ag-borrador" data-ag-texto="${p.id}" rows="7">${esc(p.borrador)}</textarea><div class="fila"><button class="btn btn-chico" data-ag-copiar="${p.id}">Copiar</button><button class="btn btn-chico btn-primario" data-ag-enviar="${p.id}">✓ Lo mando</button><button class="btn btn-chico" data-ag-descartar="${p.id}">✕ Descartar el borrador</button></div>` : ''}
      <div class="fila">${p.notas ? `<small class="tenue f1">${esc(p.notas.split('\n').at(-1))}</small>` : '<span class="f1"></span>'}${botonesFbAg(`pista:${p.id}`)}</div>
    </li>`).join('')}</ul>` : '<p class="tenue">Nada por acá todavía.</p>'}`
  $('#ag-f-mision').onchange = (e) => { ag.filtroMision = e.target.value; pintarAgPistas() }
  $$('[data-ag-etapa]', caja).forEach((b) => (b.onclick = () => { ag.filtroEtapa = b.dataset.agEtapa; pintarAgPistas() }))
  $$('[data-ag-pista]', caja).forEach((s) => (s.onchange = async () => { try { await api(`/agentes/pistas/${s.dataset.agPista}`, { etapa: s.value }); pintarAgPistas() } catch (e) { error(e) } }))
  const texto = (id) => $(`[data-ag-texto="${id}"]`, caja)?.value ?? ''
  $$('[data-ag-copiar]', caja).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(texto(b.dataset.agCopiar)); toast('Copiado', 'suave') } catch { toast('No pude copiar: seleccionalo a mano', 'error') } }))
  $$('[data-ag-enviar]', caja).forEach((b) => (b.onclick = async () => { try { await api(`/agentes/pistas/${b.dataset.agEnviar}`, { borrador: 'enviar', texto: texto(b.dataset.agEnviar) }); toast('Marcada como enviada', 'suave'); pintarAgPistas() } catch (e) { error(e) } }))
  engancharFbAg(caja)
  $$('[data-ag-descartar]', caja).forEach((b) => (b.onclick = async () => { try { await api(`/agentes/pistas/${b.dataset.agDescartar}`, { borrador: 'descartar' }); pintarAgPistas() } catch (e) { error(e) } }))
}

// ─── la sala: quién trabaja ahora y lo último que anotaron ──────────────

async function montarAgSala() {
  $('#principal').innerHTML = `<div class="titulo"><h1>La sala</h1><p>Quién está trabajando ahora, en qué paso y con qué herramienta; lo último que anotaron en sus diarios y lo que gastaron hoy. Trabajan tres veces por día en la nube (o cuando le das «Trabajar ahora» a una misión).</p></div><div id="ag-sala"><p class="tenue">Juntando…</p></div>`
  pintarAgSala()
}

async function pintarAgSala() {
  clearTimeout(ag.timer)
  let r, ms
  try { [r, ms] = await Promise.all([api('/agentes/sala'), api('/agentes/misiones')]) } catch (e) { return error(e) }
  const caja = $('#ag-sala')
  if (!caja) return
  const titulo = new Map(ms.misiones.map((m) => [m.id, m.titulo]))
  const gasto = new Map(r.gasto.map((g) => [g.agente, g.tokens]))
  const activas = ms.misiones.filter((m) => m.estado === 'activa')
  const ICONO = { plan: '🗺', hallazgo: '🔎', paso: '·', reflexion: '💭', pregunta: '❓', instruccion: '🗣', resultado: '✓', sesion: '⏱' }
  caja.innerHTML = `<section class="seccion"><h3>Ahora</h3>${r.trabajando.length ? `<ul class="ag-ahora">${r.trabajando.map((t) => `<li><b>${esc(t.agenteId)}</b> <span class="tenue">${esc(titulo.get(t.misionId) ?? 'charla')}</span> · paso ${t.paso}${t.herramienta ? ` · <code>${esc(t.herramienta)}</code>` : ' · pensando'}</li>`).join('')}</ul>` : '<p class="tenue">Nadie trabajando en este momento.</p>'}</section>
    <section class="seccion"><h3>Hoy</h3>${activas.length ? `<div class="ag-hoy">${activas.map((m) => `<button class="tarjeta" data-ag-ir="${m.id}"><b>${esc(nombreAgente(m.agente, m.agenteId))}</b><small class="tenue">${esc(m.titulo)}</small><small>${fmtTokens(gasto.get(m.agenteId) ?? 0)} tokens hoy · ${m.progreso.logrado} de ${m.progreso.meta}</small></button>`).join('')}</div>` : '<p class="tenue">Ninguna misión activa.</p>'}</section>
    <section class="seccion"><h3>Lo último en sus diarios</h3>${r.diario.length ? `<ol class="ag-diario">${r.diario.map((d) => `<li class="ag-d-${d.tipo}"><span>${ICONO[d.tipo] ?? '·'}</span><div class="f1"><small class="tenue">${fechaAg(d.en)} · ${esc(d.agente)} · ${esc(d.titulo)}</small><p>${esc(d.texto)}</p></div></li>`).join('')}</ol>` : '<p class="tenue">Todavía nada.</p>'}</section>`
  $$('[data-ag-ir]', caja).forEach((b) => (b.onclick = () => { ag.mision = Number(b.dataset.agIr); irA('agmisiones') }))
  // Mientras se mira la sala, se actualiza sola (más seguido si alguien está trabajando).
  if (vista === 'agsala') ag.timer = setTimeout(() => { if (vista === 'agsala') pintarAgSala() }, r.trabajando.length ? 3000 : 15000)
}

// ─── la temporada: quién cobra y por qué ────────────────────────────────

async function montarAgTemporada() {
  $('#principal').innerHTML = `<div class="titulo"><h1>La temporada</h1><p>Los agentes cobran por lo que te sirve y pagan lo que gastan. El lunes se cierra la semana: el que dio pérdida va a la banca (dos seguidas, se retira) y el mejor con trabajo esperando se clona.</p></div><div id="ag-temporada"><p class="tenue">Juntando…</p></div>`
  let e
  try { e = await api('/economia') } catch (err) { return error(err) }
  const t = e.tarifas, x = e.resultados
  const caja = $('#ag-temporada')
  if (!caja) return
  caja.innerHTML = `<section class="seccion"><h3>Semana ${esc(e.semana)}</h3>${e.tabla.length ? `<div class="gf-tabla"><table class="rev-tabla"><thead><tr><th>Agente</th><th>Clase</th><th>Estado</th><th>Esta semana</th><th>Saldo</th><th>De dónde</th></tr></thead><tbody>${e.tabla.map((a) => `<tr class="${a.temporada < 0 ? 'ag-pierde' : ''}"><td>${esc(a.nombre)}</td><td>${esc(a.clase)}</td><td>${esc(a.estado)}</td><td><b>${a.temporada > 0 ? '+' : ''}${a.temporada}</b></td><td>${a.saldo}</td><td class="chico">${a.detalle.map(esc).join(' · ') || '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tenue">Sin agentes que cobren.</p>'}</section>
    <section class="seccion"><h3>Qué paga</h3><ul class="chico ag-tarifas">
      <li>Una pista que no descartás: +${x.pista}</li><li>Un borrador que mandás: +${x.borradorAceptado} (con cambios: +${x.borradorEditado}; descartado: ${x.borradorRechazado})</li>
      <li>La primera vez que una pista llega a enviada: +${x.enviada} · respuesta: +${x.respondio} · reunión: +${x.reunion} · cliente: +${x.cliente}</li>
      <li>Tu 👍: +${x.pulgarArriba} · tu 👎: ${x.pulgarAbajo} · lo suyo que sellás alto en La Mano: lo que pasa del 6</li>
      <li>Una tarea del bus: +${t.tarea} · un aporte a una primaria: +${t.aporte} · un fallo: ${t.fallo} · cada mil tokens: ${t.milTokens}</li></ul></section>
    ${e.historia.length ? `<section class="seccion"><h3>Temporadas anteriores</h3><p class="chico">${e.historia.map((h) => `${esc(h.semana)} (${h.neto > 0 ? '+' : ''}${h.neto})`).join(' · ')}</p></section>` : ''}`
}
