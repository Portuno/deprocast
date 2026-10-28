'use strict'
// Exportación a medida: en vez de todo Deprocast, lo que elegís. Cuatro pasos en un modal:
// 1. Elegir las entidades de partida (proyectos, personas, conceptos…), o usar un esquema guardado.
// 2. Ver sus vinculaciones (conexiones, equipo, lo que aparece junto en tus textos) y sumar las que quieras.
// 3. Qué viaja: relaciones, quántomos por etapa, piezas, notas y la relación personal, con la previa de cuánto pesa.
// 4. Bajar el JSON (y guardar el esquema con un nombre para volver a correrlo con los datos del día).

const TIPOS_SEG = [['', 'Todas'], ['proyecto', 'Proyectos'], ['persona', 'Personas'], ['agrupacion', 'Agrupaciones'], ['concepto', 'Conceptos'], ['dominio', 'Dominios'], ['lugar', 'Lugares']]
const POR_SEG = { conexion: 'Conexiones que anotaste', equipo: 'Equipo (persona ↔ proyecto)', textos: 'Aparecen juntas en tus textos' }
const ETAPAS_SEG = [['sellado', 'Sellados'], ['proto', 'Proto'], ['propuesta', 'Propuestas'], ['superado', 'Superados'], ['descartado', 'Descartados']]
const OPC_SEG = () => ({ relaciones: 'entre', coocurrencias: false, quantomos: ['sellado', 'proto'], piezas: 'referencias', notas: true, relacionPersonal: false })
const seg = { paso: 1, elegidas: new Map(), q: '', tipo: '', vinculos: [], sumadas: new Set(), opc: OPC_SEG(), nombre: '', esquemaId: null, esquemas: [] }
let segBusqueda = null
let segPrevia = null

async function modalSegmento() {
  Object.assign(seg, { paso: 1, elegidas: new Map(), q: '', tipo: '', vinculos: [], sumadas: new Set(), opc: OPC_SEG(), nombre: '', esquemaId: null })
  abrirModal('<div id="seg"></div>')
  $('#modal').classList.add('modal-ancho')
  try { seg.esquemas = await api('/segmento/esquemas') } catch { seg.esquemas = [] }
  pintarSegmento()
}

const idsSeg = () => [...new Set([...seg.elegidas.keys(), ...seg.sumadas])]

function pintarSegmento() {
  const raiz = $('#seg')
  if (!raiz) return
  const pasos = ['Elegir', 'Vínculos', 'Qué viaja', 'Bajar']
  raiz.innerHTML = `<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>⇩ Exportar a medida</h2>
    <p class="tenue">Un JSON solo con lo que elegís: entidades, sus relaciones, sus quántomos y (si querés) sus piezas.</p>
    <ol class="seg-pasos">${pasos.map((p, i) => `<li class="${seg.paso === i + 1 ? 'on' : seg.paso > i + 1 ? 'hecho' : ''}">${i + 1}. ${p}</li>`).join('')}</ol>
    <div id="seg-cuerpo"></div>`
  ;[pasoElegirSeg, pasoVinculosSeg, pasoOpcionesSeg, pasoBajarSeg][seg.paso - 1]($('#seg-cuerpo'))
}

// ─── 1. elegir ──────────────────────────────────────────────────────────

function pasoElegirSeg(c) {
  c.innerHTML = `${seg.esquemas.length ? `<section class="seccion"><h3 class="sub">Esquemas guardados</h3><div class="seg-esquemas">${seg.esquemas.map((e) => `<div class="seg-esquema"><div class="f1"><b>${esc(e.nombre)}</b><small class="tenue">${e.esquema.entidades.length} entidad${e.esquema.entidades.length === 1 ? '' : 'es'} · relaciones ${e.esquema.relaciones === 'no' ? 'no' : e.esquema.relaciones === 'entre' ? 'entre ellas' : 'también hacia afuera'} · quántomos ${e.esquema.quantomos.join(', ') || 'no'}</small></div><button class="btn btn-chico btn-primario" data-seg-usar="${e.id}">Usar</button><button class="btn btn-chico btn-icono" data-seg-borrar="${e.id}" title="Borrar el esquema" aria-label="Borrar el esquema">✕</button></div>`).join('')}</div></section>` : ''}
    <section class="seccion"><h3 class="sub">¿Qué querés exportar? <small class="tenue">elegí las entidades de partida</small></h3>
      <div class="seg-elegidas">${seg.elegidas.size ? [...seg.elegidas.values()].map((e) => `<span class="chip on">${esc(e.nombre)} <small>${esc(e.tipo)}</small><button class="btn-link" data-seg-quitar="${e.id}" aria-label="Quitar ${esc(e.nombre)}">✕</button></span>`).join('') : '<span class="tenue chico">Ninguna todavía.</span>'}</div>
      <input class="campo-suelto seg-buscar" id="seg-q" placeholder="Buscar por nombre o alias…" value="${esc(seg.q)}" autocomplete="off">
      <div class="seg-tipos">${TIPOS_SEG.map(([k, n]) => `<button class="chip ${seg.tipo === k ? 'on' : ''}" data-seg-tipo="${k}">${n}</button>`).join('')}</div>
      <div class="seg-lista" id="seg-resultados"><p class="tenue chico">Buscando…</p></div>
    </section>
    <div class="seg-nav"><span></span><button class="btn btn-primario" id="seg-sig" ${seg.elegidas.size ? '' : 'disabled'}>Ver sus vínculos →</button></div>`
  $('#seg-q').oninput = (e) => { seg.q = e.target.value; clearTimeout(segBusqueda); segBusqueda = setTimeout(buscarSeg, 250) }
  $('#seg-q').focus()
  $$('[data-seg-tipo]', c).forEach((b) => (b.onclick = () => { seg.tipo = b.dataset.segTipo; pasoElegirSeg(c) }))
  $$('[data-seg-quitar]', c).forEach((b) => (b.onclick = () => { seg.elegidas.delete(Number(b.dataset.segQuitar)); pasoElegirSeg(c) }))
  $$('[data-seg-usar]', c).forEach((b) => (b.onclick = () => usarEsquemaSeg(Number(b.dataset.segUsar))))
  $$('[data-seg-borrar]', c).forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('¿Borrar este esquema? Lo exportado antes no se toca.'))) return
    try { await api(`/segmento/esquemas/${b.dataset.segBorrar}/borrar`, {}); seg.esquemas = await api('/segmento/esquemas'); pasoElegirSeg(c) } catch (e) { error(e) }
  }))
  $('#seg-sig').onclick = () => { seg.paso = 2; seg.vinculos = []; pintarSegmento() }
  buscarSeg()
}

async function buscarSeg() {
  const caja = $('#seg-resultados')
  if (!caja) return
  let r
  try { r = await api(`/segmento/entidades?q=${encodeURIComponent(seg.q)}&tipo=${encodeURIComponent(seg.tipo)}`) } catch (e) { caja.innerHTML = `<p class="m-err">${esc(e.message)}</p>`; return }
  if (!$('#seg-resultados')) return
  caja.innerHTML = r.length ? r.map((e) => `<label class="seg-item"><input type="checkbox" data-seg-ent="${e.id}" ${seg.elegidas.has(e.id) ? 'checked' : ''}><span class="f1">${esc(e.nombre)}</span><small class="tenue">${esc(e.tipo)} · ${e.piezas} pieza${e.piezas === 1 ? '' : 's'}</small></label>`).join('') : '<p class="tenue chico">Nada con eso.</p>'
  $$('[data-seg-ent]', caja).forEach((cb) => (cb.onchange = () => {
    const e = r.find((x) => x.id === Number(cb.dataset.segEnt))
    cb.checked ? seg.elegidas.set(e.id, e) : seg.elegidas.delete(e.id)
    const c = $('#seg-cuerpo')
    // Solo se repintan las elegidas y el botón (la lista y el campo quedan como están).
    $('.seg-elegidas', c).outerHTML = `<div class="seg-elegidas">${[...seg.elegidas.values()].map((x) => `<span class="chip on">${esc(x.nombre)} <small>${esc(x.tipo)}</small><button class="btn-link" data-seg-quitar="${x.id}" aria-label="Quitar ${esc(x.nombre)}">✕</button></span>`).join('') || '<span class="tenue chico">Ninguna todavía.</span>'}</div>`
    $$('[data-seg-quitar]', c).forEach((b) => (b.onclick = () => { seg.elegidas.delete(Number(b.dataset.segQuitar)); pasoElegirSeg(c) }))
    $('#seg-sig').disabled = !seg.elegidas.size
  }))
}

async function usarEsquemaSeg(id) {
  const e = seg.esquemas.find((x) => x.id === id)
  if (!e) return
  try {
    const v = await api('/segmento/vecindario', { ids: e.esquema.entidades })
    seg.elegidas = new Map(v.elegidas.map((x) => [x.id, x]))
    seg.vinculos = v.vinculos
    seg.sumadas = new Set()
    const { nombre, entidades, ...opc } = e.esquema
    seg.opc = { ...OPC_SEG(), ...opc }
    seg.nombre = nombre ?? ''
    seg.esquemaId = id
    seg.paso = 3
    pintarSegmento()
  } catch (er) { error(er) }
}

// ─── 2. vínculos ────────────────────────────────────────────────────────

async function pasoVinculosSeg(c) {
  c.innerHTML = '<p class="tenue">Buscando sus vínculos…</p>'
  let v
  try { v = await api('/segmento/vecindario', { ids: [...seg.elegidas.keys()] }) } catch (e) { return error(e) }
  if (!$('#seg-cuerpo')) return
  seg.vinculos = v.vinculos
  for (const e of v.elegidas) seg.elegidas.set(e.id, { ...seg.elegidas.get(e.id), ...e })
  // Por defecto se suman las conexiones y el equipo; lo que aparece junto en los textos, solo si lo marcás.
  if (!seg.sumadas.size) for (const x of v.vinculos) if (x.por !== 'textos') seg.sumadas.add(x.id)
  const grupos = Object.keys(POR_SEG).map((por) => [por, v.vinculos.filter((x) => x.por === por)]).filter(([, xs]) => xs.length)
  c.innerHTML = `<section class="seccion"><h3 class="sub">Elegiste</h3><div class="seg-resumen">${v.elegidas.map((e) => `<div><b>${esc(e.nombre)}</b> <small class="tenue">${esc(e.tipo)} · ${e.piezas} pieza${e.piezas === 1 ? '' : 's'} · ${e.quantomos} quántomo${e.quantomos === 1 ? '' : 's'}</small></div>`).join('')}</div></section>
    ${grupos.length ? grupos.map(([por, xs]) => `<section class="seccion seg-grupo" data-seg-grupo="${por}"><h3 class="sub">${POR_SEG[por]} <small class="tenue">${xs.length}</small>
        <span class="seg-todas"><button class="btn-link" data-seg-todas="1">todas</button> · <button class="btn-link" data-seg-todas="0">ninguna</button></span></h3>
        <div class="seg-lista">${xs.map((x) => `<label class="seg-item"><input type="checkbox" data-seg-vin="${x.id}" ${seg.sumadas.has(x.id) ? 'checked' : ''}><span class="f1">${esc(x.nombre)} <small class="tenue">${esc(x.tipo)}</small></span><small class="tenue">${esc(x.detalle)}</small></label>`).join('')}</div></section>`).join('')
      : '<p class="tenue">No tienen vínculos anotados ni aparecen con otras en tus textos: se exportan solas.</p>'}
    <div class="seg-nav"><button class="btn" id="seg-atras">← Atrás</button><span class="tenue chico" id="seg-cuenta"></span><button class="btn btn-primario" id="seg-sig">Qué viaja →</button></div>`
  const contar = () => { $('#seg-cuenta').textContent = `${idsSeg().length} entidades en total` }
  const marcar = (id, si) => { const otra = $$(`[data-seg-vin="${id}"]`, c); otra.forEach((x) => (x.checked = si)); si ? seg.sumadas.add(id) : seg.sumadas.delete(id); contar() }
  $$('[data-seg-vin]', c).forEach((cb) => (cb.onchange = () => marcar(Number(cb.dataset.segVin), cb.checked)))
  $$('[data-seg-todas]', c).forEach((b) => (b.onclick = () => { const si = b.dataset.segTodas === '1'; $$('[data-seg-vin]', b.closest('[data-seg-grupo]')).forEach((cb) => marcar(Number(cb.dataset.segVin), si)) }))
  $('#seg-atras').onclick = () => { seg.paso = 1; pintarSegmento() }
  $('#seg-sig').onclick = () => {
    // Si sumaste algo por aparecer junto en tus textos, ese vínculo también viaja (se puede sacar en el paso 3).
    if (seg.vinculos.some((x) => x.por === 'textos' && seg.sumadas.has(x.id))) seg.opc.coocurrencias = true
    seg.paso = 3
    pintarSegmento()
  }
  contar()
}

// ─── 3. qué viaja ───────────────────────────────────────────────────────

const esquemaSeg = () => ({ ...seg.opc, nombre: seg.nombre || undefined, entidades: idsSeg() })

function pasoOpcionesSeg(c) {
  const o = seg.opc
  const radio = (nombre, valor, texto, sub = '') => `<label class="seg-opc"><input type="radio" name="${nombre}" value="${valor}" ${o[nombre] === valor ? 'checked' : ''}><span>${texto}${sub ? `<small class="tenue">${sub}</small>` : ''}</span></label>`
  c.innerHTML = `<div class="seg-opciones">
      <fieldset><legend>Relaciones</legend>
        ${radio('relaciones', 'entre', 'Solo entre las elegidas', 'el esquema queda cerrado')}
        ${radio('relaciones', 'afuera', 'También hacia afuera', 'la otra punta viaja como referencia (nombre y tipo)')}
        ${radio('relaciones', 'no', 'Sin relaciones')}
        <label class="seg-opc"><input type="checkbox" name="coocurrencias" ${o.coocurrencias ? 'checked' : ''}><span>Sumar «aparecen juntas en tus textos» <small class="tenue">con cuántas piezas comparten</small></span></label>
      </fieldset>
      <fieldset><legend>Quántomos <small class="tenue">los de las piezas donde aparecen</small></legend>
        <div class="seg-tipos">${ETAPAS_SEG.map(([k, n]) => `<label class="chip ${o.quantomos.includes(k) ? 'on' : ''}"><input type="checkbox" name="etapa" value="${k}" ${o.quantomos.includes(k) ? 'checked' : ''} hidden>${n}</label>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Piezas del corpus</legend>
        ${radio('piezas', 'no', 'No')}
        ${radio('piezas', 'referencias', 'Como referencia', 'título, fecha, nivel, link y con qué entidades aparecen')}
        ${radio('piezas', 'completas', 'Con su texto', 'pesa más (hasta 400 piezas con texto)')}
      </fieldset>
      <fieldset><legend>Sobre cada entidad</legend>
        <label class="seg-opc"><input type="checkbox" name="notas" ${o.notas ? 'checked' : ''}><span>Notas y datos extra</span></label>
        <label class="seg-opc"><input type="checkbox" name="relacionPersonal" ${o.relacionPersonal ? 'checked' : ''}><span>Tu relación con cada persona <small class="tenue">vínculo, cercanía, último contacto</small></span></label>
      </fieldset>
    </div>
    <div class="seg-previa" id="seg-previa"><span class="tenue">Calculando…</span></div>
    <div class="seg-nav"><button class="btn" id="seg-atras">← Atrás</button><span></span><button class="btn btn-primario" id="seg-sig">Siguiente →</button></div>`
  const leer = () => {
    const f = c.querySelector('.seg-opciones')
    seg.opc = {
      relaciones: f.querySelector('[name=relaciones]:checked')?.value ?? 'entre',
      coocurrencias: f.querySelector('[name=coocurrencias]').checked,
      quantomos: [...f.querySelectorAll('[name=etapa]:checked')].map((x) => x.value),
      piezas: f.querySelector('[name=piezas]:checked')?.value ?? 'referencias',
      notas: f.querySelector('[name=notas]').checked,
      relacionPersonal: f.querySelector('[name=relacionPersonal]').checked,
    }
    $$('[name=etapa]', f).forEach((x) => x.closest('.chip').classList.toggle('on', x.checked))
    clearTimeout(segPrevia)
    segPrevia = setTimeout(previaSeg, 200)
  }
  c.querySelector('.seg-opciones').onchange = leer
  $('#seg-atras').onclick = () => { seg.paso = seg.esquemaId && !seg.vinculos.length ? 1 : 2; pintarSegmento() }
  $('#seg-sig').onclick = () => { seg.paso = 4; pintarSegmento() }
  previaSeg()
}

const pesoSeg = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

async function previaSeg() {
  const caja = $('#seg-previa')
  if (!caja) return
  try {
    const p = await api('/segmento/previa', { esquema: esquemaSeg() })
    if (!$('#seg-previa')) return
    caja.innerHTML = `<b>Sale:</b> ${p.entidades} entidades${p.afuera ? ` (+${p.afuera} de referencia)` : ''} · ${p.relaciones} relaciones · ${p.quantomos.toLocaleString('es-AR')} quántomos · ${p.piezas.toLocaleString('es-AR')} piezas · <b>~${pesoSeg(p.bytes)}</b>`
  } catch (e) { caja.innerHTML = `<span class="m-err">${esc(e.message)}</span>` }
}

// ─── 4. bajar ───────────────────────────────────────────────────────────

function pasoBajarSeg(c) {
  c.innerHTML = `<section class="seccion"><div class="seg-previa" id="seg-previa"><span class="tenue">Calculando…</span></div></section>
    <section class="seccion"><h3 class="sub">Guardar el esquema <small class="tenue">opcional: para volver a correrlo con los datos del día</small></h3>
      <div class="fila"><input class="campo-suelto f1" id="seg-nombre" placeholder="Ej.: El proyecto y su gente" value="${esc(seg.nombre)}"><button class="btn" id="seg-guardar">Guardar</button></div></section>
    <div class="seg-nav"><button class="btn" id="seg-atras">← Atrás</button><span></span><button class="btn btn-primario" id="seg-bajar">⇩ Bajar el JSON</button></div>`
  $('#seg-nombre').oninput = (e) => { seg.nombre = e.target.value }
  $('#seg-atras').onclick = () => { seg.paso = 3; pintarSegmento() }
  $('#seg-guardar').onclick = async () => {
    try { const g = await api('/segmento/esquemas', { esquema: esquemaSeg() }); seg.esquemaId = g.id; seg.esquemas = await api('/segmento/esquemas'); toast(`Esquema «${esc(g.nombre)}» guardado`, 'suave') } catch (e) { error(e) }
  }
  $('#seg-bajar').onclick = async () => {
    const b = $('#seg-bajar')
    b.disabled = true
    b.textContent = 'Armando…'
    try {
      const r = await api('/segmento/exportar', { esquema: esquemaSeg(), esquemaId: seg.esquemaId })
      const nombre = (seg.nombre || [...seg.elegidas.values()].map((e) => e.nombre).slice(0, 2).join('-') || 'segmento').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }))
      a.download = `deprocast-${nombre}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      toast(`⇩ Exportado<small>${r.resumen.entidades} entidades · ${r.resumen.relaciones} relaciones · ${r.resumen.quantomos} quántomos · ${r.resumen.piezas} piezas</small>`, 'suave')
    } catch (e) { error(e) } finally { b.disabled = false; b.textContent = '⇩ Bajar el JSON' }
  }
  previaSeg()
}
