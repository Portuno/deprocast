'use strict'
// Discovery para clientes: el método de transformación con IA como herramienta. Un encargo por cliente; las áreas se
// puntúan (volumen, costo, alcance) para elegir por dónde empezar; entrevistas, documentos y logs alimentan el as-is
// (con lo que no estaba escrito); el to-be decide cada paso (borrar, código, agente, persona); la hoja de valor lleva los
// KPIs acordados antes de construir; y el modo sombra mide al agente contra la persona, regla por regla.

let dscActual = null
let dscTab = 'areas'
let dscDatos = null
const DESTINO_DSC = { borrar: ['🗑', 'Se borra'], codigo: ['⚙', 'Código'], agente: ['🤖', 'Agente'], persona: ['👤', 'Persona'] }
const CAT_KPI = { tiempo_costo: 'Tiempo y costo', ingresos: 'Ingresos (netos de tokens)', riesgo: 'Riesgo' }
const durDsc = (min) => (min == null ? '—' : min < 120 ? `${Math.round(min)} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`)

async function montarDiscovery() {
  if (dscActual) return montarEncargo(dscActual)
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Discovery</h1><p>Tus encargos de transformación con IA. El valor está en el discovery: saber qué preguntar y leer los logs, no solo entrevistar. Se empieza por un área (no por un flujo suelto), se acuerda el valor antes de construir, se borra antes de automatizar y los agentes pasan por modo sombra.</p>
      <div class="fila"><button class="btn btn-primario" id="dsc-nuevo">＋ Un encargo</button></div></div>
    <div id="dsc-lista"></div>`
  $('#dsc-nuevo').onclick = modalEncargoNuevo
  let d
  try { d = await api('/encargos') } catch (e) { return error(e) }
  $('#dsc-lista').innerHTML = d.encargos.length ? `<div class="tarjetas">${d.encargos.map((e) => `<article class="tarjeta dsc-enc" data-dsc="${e.id}">
      <header class="fila" style="justify-content:space-between"><h3>${esc(e.cliente)}</h3><span class="chip dsc-estado ${esc(e.estado)}">${esc(e.estado)}</span></header>
      <p>${esc(e.nombre)}</p>
      <small class="tenue">${e.departamento ? `Empieza por ${esc(e.departamento)} · ` : ''}${e.entrevistas} entrevistas · ${e.logs} logs · ${e.procesos} procesos</small>
    </article>`).join('')}</div>` : '<div class="vacio"><div class="gran">◇</div><h2>Todavía no hay encargos</h2><p>Abrí uno por cliente: después sumás sus áreas, entrevistas, documentos y logs.</p></div>'
  $$('[data-dsc]').forEach((c) => (c.onclick = () => { dscActual = Number(c.dataset.dsc); dscTab = 'areas'; montarEncargo(dscActual) }))
}

function modalEncargoNuevo() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Un encargo nuevo</h2>
    <form id="dsc-form">
      <label class="campo">Cliente (empresa o estudio)<input name="cliente" required autofocus></label>
      <label class="campo">Nombre del encargo (opcional)<input name="nombre" placeholder="Transformación con IA · …"></label>
      <label class="campo">Contexto (opcional)<textarea name="notas" rows="3" placeholder="Qué hacen, cuánta gente, qué ya probaron con IA (copilots, pilotos trabados…)"></textarea></label>
      <button class="btn btn-primario">Abrir</button></form>`)
  $('#dsc-form').onsubmit = async (ev) => {
    ev.preventDefault()
    try { const e = await api('/encargos', Object.fromEntries(new FormData(ev.target))); cerrarModal(); dscActual = e.id; dscTab = 'areas'; montarEncargo(e.id) } catch (e) { error(e) }
  }
}

async function montarEncargo(id) {
  try { dscDatos = await api(`/encargos/${id}`) } catch (e) { dscActual = null; return error(e) }
  const { encargo: e } = dscDatos
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><p><a href="#" id="dsc-volver">‹ Encargos</a></p><h1>${esc(e.cliente)}</h1><p>${esc(e.nombre)}${e.departamento ? ` · empieza por <b>${esc(e.departamento)}</b>` : ''}</p></div>
      <div class="fila"><select class="campo-suelto" id="dsc-estado" style="margin:0">${['discovery', 'diseño', 'sombra', 'vivo', 'cerrado'].map((x) => `<option ${x === e.estado ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="tabs" id="dsc-tabs">${[['areas', 'Áreas'], ['entrevistas', 'Entrevistas'], ['logs', 'Logs'], ['procesos', 'As-is y to-be'], ['valor', 'Valor'], ['sombra', 'Sombra'], ['personas', 'Personas']].map(([k, n]) => `<button data-tab="${k}" class="${dscTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${dscDatos.enLaNube ? '' : '<p class="tenue chico">Esta es la copia de la compu: la guía, el as-is, el to-be y los KPIs los arma Mastropiero en la nube.</p>'}
    <div id="dsc-cuerpo"></div>`
  $('#dsc-volver').onclick = (ev) => { ev.preventDefault(); dscActual = null; montarDiscovery() }
  $('#dsc-estado').onchange = async (ev) => { try { await api(`/encargos/${id}`, { estado: ev.target.value }); toast('Guardado', 'suave') } catch (er) { error(er) } }
  $$('#dsc-tabs [data-tab]').forEach((b) => (b.onclick = () => { dscTab = b.dataset.tab; montarEncargo(id) }))
  const pintar = { areas: dscAreas, entrevistas: dscEntrevistas, logs: dscLogs, procesos: dscProcesos, valor: dscValor, sombra: dscSombra, personas: dscPersonas }[dscTab]
  pintar($('#dsc-cuerpo'), id)
}

const recargarEncargo = (id) => montarEncargo(id)
/** Un pedido largo (Mastropiero pensando): el botón dice que espera. */
async function conEspera(btn, texto, f) {
  const antes = btn.textContent
  btn.disabled = true
  btn.textContent = texto
  try { await f() } catch (e) { error(e) } finally { btn.disabled = false; btn.textContent = antes }
}
/** Sube un archivo crudo a una ruta del encargo. */
async function subirCrudoDsc(ruta, archivo, params = {}) {
  const q = new URLSearchParams({ nombre: archivo.name, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) })
  const r = await fetch(`/api${ruta}?${q}`, { method: 'POST', body: archivo })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error)
  return j
}

function dscAreas(cont, id) {
  const xs = dscDatos.areas
  cont.innerHTML = `<p class="tenue">Por dónde empezar: el área que más pesa en volumen (cuántas veces por mes corren sus procesos), costo (lo tiene el CFO) y alcance (cuántas áreas tocan sus procesos). Lo caro suele estar en los traspasos entre áreas.</p>
    ${xs.length ? `<table class="dsc-tabla"><thead><tr><th>Área</th><th>Volumen/mes</th><th>Costo/mes</th><th>Toca</th><th>Puntaje</th><th></th></tr></thead><tbody>
      ${xs.map((a, i) => `<tr><td><b>${esc(a.nombre)}</b></td><td>${a.volumenMes ?? '—'}</td><td>${a.costoMes ?? '—'}</td><td>${a.alcance ?? '—'}</td><td><span class="dsc-barra"><i style="width:${a.puntaje}%"></i></span> ${a.puntaje}</td>
        <td>${dscDatos.encargo.departamento === a.nombre ? '<span class="chip">por acá</span>' : `<button class="btn btn-chico ${i === 0 ? 'btn-primario' : ''}" data-dsc-empezar="${esc(a.nombre)}">Empezar acá</button>`}</td></tr>`).join('')}</tbody></table>` : ''}
    <form class="fila dsc-form-area" id="dsc-area"><input class="campo-suelto" name="nombre" placeholder="Área (Finanzas, Legal, Ventas…)" required><input class="campo-suelto" name="volumenMes" type="number" placeholder="Volumen/mes"><input class="campo-suelto" name="costoMes" type="number" placeholder="Costo/mes"><input class="campo-suelto" name="alcance" type="number" placeholder="Áreas que toca"><button class="btn">Guardar</button></form>`
  $('#dsc-area').onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/encargos/${id}/areas`, Object.fromEntries(new FormData(ev.target))); recargarEncargo(id) } catch (e) { error(e) } }
  $$('[data-dsc-empezar]').forEach((b) => (b.onclick = async () => { try { await api(`/encargos/${id}`, { departamento: b.dataset.dscEmpezar }); recargarEncargo(id) } catch (e) { error(e) } }))
}

function dscEntrevistas(cont, id) {
  const d = dscDatos
  const areaPorDefecto = d.encargo.departamento ?? d.areas[0]?.nombre ?? ''
  cont.innerHTML = `
    <section class="seccion"><h3>Guía de entrevista</h3><p class="tenue chico">Lo que hay que preguntar: volumen y costo, sistemas, traspasos, excepciones, lo que no está escrito, aprobaciones y auditoría. Si ya subiste un log, también lo que los datos contradicen.</p>
      <form class="fila" id="dsc-guia"><input class="campo-suelto" name="area" value="${esc(areaPorDefecto)}" placeholder="Área" required style="margin:0"><button class="btn btn-primario" ${d.enLaNube ? '' : 'disabled'}>✦ Armar la guía</button></form>
      ${d.guias.map((g) => `<details class="dsc-guia"><summary>${esc(g.titulo)}</summary><div class="md">${md(g.md)}</div></details>`).join('')}</section>
    <section class="seccion"><h3>Entrevistas <small class="tenue">${d.entrevistas.length}</small></h3>
      ${d.entrevistas.map((x) => `<div class="sq"><span><a href="#" class="ref" data-pieza="${x.id}"><b>${esc(x.titulo)}</b></a><small>${x.palabras} palabras</small></span></div>`).join('')}
      <form id="dsc-ent"><div class="fila"><label class="campo">Quién<input name="quien"></label><label class="campo">Rol<input name="rol" placeholder="Controller, analista de AP…"></label><label class="campo">Área<input name="area" value="${esc(areaPorDefecto)}"></label></div>
        <label class="campo">Notas o transcripción<textarea name="texto" rows="5"></textarea></label>
        <div class="fila"><button class="btn btn-primario">Guardar</button><label class="btn">🎙 Subir el audio<input type="file" accept="audio/*,video/*" id="dsc-ent-audio" hidden></label></div></form></section>
    <section class="seccion"><h3>Documentación <small class="tenue">lo que dice que se hace</small></h3>
      ${d.documentos.map((x) => `<div class="sq"><span><a href="#" class="ref" data-pieza="${x.id}"><b>${esc(x.titulo)}</b></a><small>${x.palabras} palabras</small></span></div>`).join('')}
      <label class="btn">📄 Subir un procedimiento (PDF, Word, Excel, texto)<input type="file" id="dsc-doc" hidden></label></section>`
  $$('[data-pieza]', cont).forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); modalPieza(Number(a.dataset.pieza)) }))
  $('#dsc-guia').onsubmit = (ev) => { ev.preventDefault(); conEspera(ev.submitter, 'Pensando qué preguntar…', async () => { await api(`/encargos/${id}/guia`, { area: ev.target.area.value }); recargarEncargo(id) }) }
  const fe = $('#dsc-ent')
  fe.onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/encargos/${id}/entrevistas`, Object.fromEntries(new FormData(fe))); toast('Entrevista guardada', 'suave'); recargarEncargo(id) } catch (e) { error(e) } }
  $('#dsc-ent-audio').onchange = async (ev) => {
    const f = ev.target.files[0]
    if (!f) return
    toast('Transcribiendo la entrevista…', 'suave')
    try { await subirCrudoDsc(`/encargos/${id}/entrevista-audio`, f, { quien: fe.quien.value, rol: fe.rol.value, area: fe.area.value }); toast('Entrevista transcripta (el audio no se guarda)', 'suave'); recargarEncargo(id) } catch (e) { error(e) }
  }
  $('#dsc-doc').onchange = async (ev) => { const f = ev.target.files[0]; if (!f) return; try { await subirCrudoDsc(`/encargos/${id}/documento`, f, { area: areaPorDefecto }); recargarEncargo(id) } catch (e) { error(e) } }
}

function dscLogs(cont, id) {
  const d = dscDatos
  cont.innerHTML = `<p class="tenue">El log de eventos que exporta su ERP o CRM (CSV): una fila por evento con el caso, la actividad, la fecha y hora y, si hay, el área o el recurso. Se analiza acá mismo, sin modelo, y solo queda el análisis.</p>
    <div class="fila"><input class="campo-suelto" id="dsc-log-area" placeholder="Área (opcional)" value="${esc(d.encargo.departamento ?? '')}" style="margin:0;max-width:240px"><label class="btn btn-primario">⬆ Subir un log (CSV)<input type="file" accept=".csv,text/csv,text/plain" id="dsc-log" hidden></label></div>
    ${d.logs.map((l) => { const a = l.analisis; const maxEsp = Math.max(1, ...a.actividades.map((x) => x.hastaSiguiente.p90 ?? 0)); return `<section class="seccion dsc-log"><h3>${esc(l.nombre)}${l.area ? ` · ${esc(l.area)}` : ''}</h3>
      <div class="dsc-fichas"><div><b>${a.casos}</b><span>casos</span></div><div><b>${a.eventos}</b><span>eventos</span></div><div><b>${a.actividadesDistintas}</b><span>actividades</span></div><div><b>${a.pasosVarianteComun}</b><span>pasos en la variante común (${a.variantes[0]?.pct ?? 0} %)</span></div><div><b>${a.duracionCaso.mediana ?? '—'} h</b><span>por caso (p90 ${a.duracionCaso.p90 ?? '—'} h)</span></div></div>
      <h4>Variantes</h4>${a.variantes.slice(0, 4).map((v) => `<p class="chico"><b>${v.pct} %</b> · ${v.pasos.map(esc).join(' → ')}</p>`).join('')}
      <h4>Actividades <small class="tenue">hasta el paso siguiente: mediana (p90)</small></h4>
      <table class="dsc-tabla"><tbody>${a.actividades.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="tenue">${esc(x.area ?? '')}</td><td>${x.casos}</td><td style="width:40%"><span class="dsc-barra"><i style="width:${Math.round(((x.hastaSiguiente.mediana ?? 0) / maxEsp) * 100)}%"></i><em style="width:${Math.round(((x.hastaSiguiente.p90 ?? 0) / maxEsp) * 100)}%"></em></span></td><td>${durDsc(x.hastaSiguiente.mediana)} (${durDsc(x.hastaSiguiente.p90)})</td></tr>`).join('')}</tbody></table>
      ${a.retrabajos.length ? `<h4>Retrabajos</h4>${a.retrabajos.slice(0, 6).map((r) => `<p class="chico">↻ <b>${esc(r.actividad)}</b> se repite en ${r.pct} % de los casos</p>`).join('')}` : ''}
      ${a.traspasos.length ? `<h4>Traspasos entre áreas <small class="tenue">donde más se espera</small></h4>${a.traspasos.slice(0, 6).map((t) => `<p class="chico">${esc(t.de)} → ${esc(t.a)}: ${t.veces} veces, espera ${durDsc(t.espera.mediana)} (p90 ${durDsc(t.espera.p90)})</p>`).join('')}` : ''}
    </section>` }).join('')}`
  $('#dsc-log').onchange = async (ev) => { const f = ev.target.files[0]; if (!f) return; try { await subirCrudoDsc(`/encargos/${id}/log`, f, { area: $('#dsc-log-area').value }); recargarEncargo(id) } catch (e) { error(e) } }
}

function dscProcesos(cont, id) {
  const d = dscDatos
  cont.innerHTML = `<form class="fila" id="dsc-asis"><input class="campo-suelto" name="area" value="${esc(d.encargo.departamento ?? d.areas[0]?.nombre ?? '')}" placeholder="Área" required style="margin:0;max-width:240px"><button class="btn btn-primario" ${d.enLaNube ? '' : 'disabled'}>✦ Armar el as-is</button><small class="tenue">Cruza los logs, las entrevistas y la documentación.</small></form>
    ${d.procesos.map((p) => `<section class="seccion dsc-proc"><h3>${esc(p.nombre)}</h3>
      ${p.resumen ? `<p class="dsc-resumen">${esc(p.resumen.texto)}${p.documentados != null ? ` <span class="tenue">La documentación decía ${p.documentados}.</span>` : ''}${p.resumen.minutosAntes ? ` <span class="tenue">Trabajo por caso: ${p.resumen.minutosAntes} min${p.resumen.minutosDespues != null ? ` → ${p.resumen.minutosDespues} min` : ''}.</span>` : ''}</p>` : ''}
      <div class="dsc-pasos">${(p.pasosAsis ?? []).map((x) => { const t = p.pasosTobe?.find((y) => y.n === x.n); return `<div class="dsc-paso ${t ? t.destino : ''}">
        <span class="dsc-n">${x.n}</span><div><b>${esc(x.paso)}</b>${x.en_la_doc ? '' : ' <span class="chip dsc-nodoc" title="No estaba en la documentación">no documentado</span>'}
          <small class="tenue">${[x.area, x.sistema, x.quien, x.minutos != null ? `${x.minutos} min` : null, x.frecuencia].filter(Boolean).map(esc).join(' · ')}</small>
          ${x.excepciones ? `<small class="dsc-exc">⚠ ${esc(x.excepciones)}</small>` : ''}
          ${t?.por_que ? `<small class="tenue">→ ${esc(t.por_que)}</small>` : ''}</div>
        ${p.pasosTobe ? `<span class="dsc-destinos">${Object.entries(DESTINO_DSC).map(([k, [g, n]]) => `<button class="${t?.destino === k ? 'on' : ''}" data-dsc-paso="${p.id}:${x.n}:${k}" title="${n}">${g}</button>`).join('')}</span>` : ''}</div>` }).join('')}</div>
      <div class="fila"><button class="btn ${p.pasosTobe ? '' : 'btn-primario'}" data-dsc-tobe="${p.id}" ${d.enLaNube ? '' : 'disabled'}>${p.pasosTobe ? '↻ Rehacer el to-be' : '✦ Armar el to-be'}</button></div></section>`).join('') || '<div class="vacio"><h2>Todavía no hay procesos</h2><p>Subí un log o una entrevista y armá el as-is del área.</p></div>'}`
  $('#dsc-asis').onsubmit = (ev) => { ev.preventDefault(); conEspera(ev.submitter, 'Mapeando el proceso real…', async () => { await api(`/encargos/${id}/asis`, { area: ev.target.area.value }); recargarEncargo(id) }) }
  $$('[data-dsc-tobe]').forEach((b) => (b.onclick = () => conEspera(b, 'Decidiendo cada paso…', async () => { await api(`/procesos/${b.dataset.dscTobe}/tobe`, {}); recargarEncargo(id) })))
  $$('[data-dsc-paso]').forEach((b) => (b.onclick = async () => { const [p, n, destino] = b.dataset.dscPaso.split(':'); try { await api(`/procesos/${p}/paso/${n}`, { destino }); recargarEncargo(id) } catch (e) { error(e) } }))
}

async function dscValor(cont, id) {
  const d = dscDatos
  let hoja = ''
  try { hoja = (await api(`/encargos/${id}/valor`)).md } catch (e) { error(e) }
  cont.innerHTML = `<p class="tenue">El valor se acuerda antes de construir: con el CEO y el CFO, en tres categorías (tiempo y costo, ingresos netos de tokens, riesgo), con dónde está hoy cada número. Esta hoja es la que el cliente lleva a su directorio.</p>
    ${d.procesos.map((p) => `<section class="seccion"><h3>${esc(p.nombre)}</h3>
      <table class="dsc-tabla dsc-kpis" data-dsc-kpis="${p.id}"><thead><tr><th>Categoría</th><th>KPI</th><th>Hoy</th><th>Objetivo</th><th>Unidad</th><th>Cómo se mide</th><th></th></tr></thead><tbody>
        ${[...p.kpis, null].map((k) => `<tr><td><select class="campo-suelto" data-k="categoria">${Object.entries(CAT_KPI).map(([c, n]) => `<option value="${c}" ${k?.categoria === c ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
          <td><input class="campo-suelto" data-k="nombre" value="${esc(k?.nombre ?? '')}" placeholder="${k ? '' : 'Un KPI nuevo…'}"></td><td><input class="campo-suelto" data-k="linea_base" value="${esc(k?.linea_base ?? '')}"></td><td><input class="campo-suelto" data-k="objetivo" value="${esc(k?.objetivo ?? '')}"></td>
          <td><input class="campo-suelto" data-k="unidad" value="${esc(k?.unidad ?? '')}"></td><td><input class="campo-suelto" data-k="medido_en" value="${esc(k?.medido_en ?? '')}"></td><td>${k ? '<button class="btn btn-chico" data-k-borrar>✕</button>' : ''}</td></tr>`).join('')}
      </tbody></table>
      <div class="fila"><button class="btn btn-primario" data-dsc-kpis-guardar="${p.id}">Guardar KPIs</button><button class="btn" data-dsc-kpis-proponer="${p.id}" ${d.enLaNube ? '' : 'disabled'}>✦ Proponer KPIs</button></div></section>`).join('') || '<p class="tenue">Los KPIs van por proceso: primero armá el as-is.</p>'}
    <section class="seccion"><h3>La hoja de valor</h3><div class="fila"><button class="btn" id="dsc-bajar">⬇ Bajar en Markdown</button><button class="btn" id="dsc-imprimir">🖨 Imprimir</button></div><div class="md dsc-hoja" id="dsc-hoja">${md(hoja)}</div></section>`
  $$('[data-k-borrar]', cont).forEach((b) => (b.onclick = () => b.closest('tr').remove()))
  $$('[data-dsc-kpis-guardar]', cont).forEach((b) => (b.onclick = async () => {
    const filas = $$(`[data-dsc-kpis="${b.dataset.dscKpisGuardar}"] tbody tr`).map((tr) => Object.fromEntries($$('[data-k]', tr).map((i) => [i.dataset.k, i.value.trim()]))).filter((k) => k.nombre)
    try { await api(`/procesos/${b.dataset.dscKpisGuardar}/kpis`, { kpis: filas }); toast('KPIs guardados', 'suave'); recargarEncargo(id) } catch (e) { error(e) }
  }))
  $$('[data-dsc-kpis-proponer]', cont).forEach((b) => (b.onclick = () => conEspera(b, 'Buscando la línea de base…', async () => { await api(`/procesos/${b.dataset.dscKpisProponer}/kpis/proponer`, {}); recargarEncargo(id) })))
  $('#dsc-bajar').onclick = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([hoja], { type: 'text/markdown' }))
    a.download = `hoja-de-valor-${d.encargo.cliente.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
    a.click()
  }
  $('#dsc-imprimir').onclick = () => {
    const w = window.open('', '_blank')
    if (!w) return toast('El navegador bloqueó la ventana: permitila para imprimir', 'suave')
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(d.encargo.nombre)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}h1{font-size:24px}h2{font-size:18px;margin-top:24px}</style>${$('#dsc-hoja').innerHTML}`)
    w.document.close()
    w.print()
  }
}

function dscSombra(cont, id) {
  const s = dscDatos.sombra
  cont.innerHTML = `<p class="tenue">Modo sombra: el agente corre con todo el volumen pero sin actuar; se compara lo que propuso con lo que hizo la persona. Desde la semana 3 actúa solo en las reglas que aciertan 99 % o más (con 50 casos o más); la persona queda con las excepciones. Subí un CSV con <code>regla, propuesta, real</code> (y si hay, <code>fecha</code> y <code>caso</code>).</p>
    <label class="btn btn-primario">⬆ Subir casos en sombra (CSV)<input type="file" accept=".csv,text/csv,text/plain" id="dsc-sombra" hidden></label>
    ${s.total ? `<div class="dsc-fichas"><div><b>${s.total}</b><span>casos</span></div><div><b>${s.puedeTomar} %</b><span>de los casos ya los puede tomar el agente</span></div><div><b>${s.reglas.filter((r) => r.lista).length}/${s.reglas.length}</b><span>reglas listas</span></div></div>
      <table class="dsc-tabla"><thead><tr><th>Regla</th><th>Casos</th><th>Acierto</th><th></th></tr></thead><tbody>${s.reglas.map((r) => `<tr><td>${esc(r.regla)}</td><td>${r.casos}</td><td style="width:40%"><span class="dsc-barra ${r.lista ? 'ok' : ''}"><i style="width:${r.acierto}%"></i></span> ${r.acierto} %</td><td>${r.lista ? '<span class="chip dsc-lista">✓ actúa sola</span>' : r.casos < 50 ? '<small class="tenue">pocos casos</small>' : '<small class="tenue">sigue en sombra</small>'}</td></tr>`).join('')}</tbody></table>
      ${s.semanas.length > 1 ? `<h4>Por semana</h4><div class="dsc-semanas">${s.semanas.map((w) => `<span title="${w.semana}: ${w.casos} casos"><i style="height:${w.acierto}%"></i><small>${w.acierto}%</small></span>`).join('')}</div>` : ''}` : ''}`
  $('#dsc-sombra').onchange = async (ev) => { const f = ev.target.files[0]; if (!f) return; try { const r = await subirCrudoDsc(`/encargos/${id}/sombra`, f); toast(`${r.cargados} casos cargados`, 'suave'); recargarEncargo(id) } catch (e) { error(e) } }
}

function dscPersonas(cont, id) {
  const xs = dscDatos.champions
  cont.innerHTML = `<p class="tenue">El sponsor decide y lleva la hoja al directorio. Los champions (5 a 10 % de la gente) ya usan IA para trabajar mejor: un día de formación, un tablero de minutos ahorrados (no de tokens) y construyen los agentes del área siguiente.</p>
    ${xs.map((p) => `<div class="sq"><span><b>${esc(p.nombre)}</b><small>${esc(p.rol)}</small></span></div>`).join('') || '<p class="tenue chico">Nadie todavía.</p>'}
    <form class="fila" id="dsc-persona" style="margin-top:10px"><input class="campo-suelto" name="nombre" placeholder="Nombre" required style="margin:0"><select class="campo-suelto" name="rol" style="margin:0;max-width:160px"><option value="champion">Champion</option><option value="sponsor">Sponsor</option></select><button class="btn">Sumar</button></form>`
  $('#dsc-persona').onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/encargos/${id}/personas`, Object.fromEntries(new FormData(ev.target))); recargarEncargo(id) } catch (e) { error(e) } }
}
