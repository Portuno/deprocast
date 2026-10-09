'use strict'
// Cuadernos: fuentes elegidas, preguntas que se responden solo con ellas (con citas), guía y charla en audio.

let cuadernoAbierto = null
let cuEspera = null
/** Lo que se estaba importando, para no perderlo al refrescar el cuaderno. */
let cuImport = { id: 0, modo: 'buscar', q: '', entidad: null }

function montarCuadernos() {
  clearTimeout(cuEspera)
  if (cuadernoAbierto) return montarCuaderno(cuadernoAbierto)
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Cuadernos</h1><p>Juntá fuentes sobre un tema (piezas de tu corpus, un texto, una página) y preguntale: responde solo con eso y te dice de dónde sale cada cosa. También te arma una guía y una charla en audio para escuchar caminando.</p>
      <div class="fila"><input id="cu-nuevo" placeholder="Nombre del cuaderno nuevo"><button class="btn btn-primario" id="cu-crear">Crear</button></div></div>
    <div class="cu-grid" id="cu-lista"></div>`
  const crear = async () => {
    const t = $('#cu-nuevo').value.trim()
    if (!t) return
    try { const c = await api('/cuadernos', { titulo: t }); cuadernoAbierto = c.id; montarCuadernos() } catch (e) { error(e) }
  }
  $('#cu-crear').onclick = crear
  $('#cu-nuevo').onkeydown = (e) => { if (e.key === 'Enter') crear() }
  refrescarCuadernos()
}

async function refrescarCuadernos() {
  if (cuadernoAbierto) return
  const cont = $('#cu-lista')
  if (!cont) return
  let cs
  try { cs = await api('/cuadernos') } catch (e) { return error(e) }
  cont.innerHTML = cs.length ? cs.map((c) => `<div class="cu-tarjeta" data-cu="${c.id}"><b>${esc(c.titulo)}</b><span class="tenue">${c.fuentes.length} fuente${c.fuentes.length === 1 ? '' : 's'} · ${c.notas} nota${c.notas === 1 ? '' : 's'}</span></div>`).join('')
    : '<p class="vacio">Ningún cuaderno todavía. Creá uno para un tema que estés estudiando o un proyecto.</p>'
  $$('[data-cu]', cont).forEach((el) => (el.onclick = () => { cuadernoAbierto = Number(el.dataset.cu); montarCuadernos() }))
}

/** Las citas [n] del texto se vuelven links a la pieza. */
function conCitas(texto, citas) {
  const porN = new Map(citas.map((c) => [c.n, c]))
  return md(texto).replace(/\[(\d+)\]/g, (m, n) => {
    const c = porN.get(Number(n))
    return c ? `<a href="#" class="cu-cita" data-pieza="${c.piezaId}" title="${esc(c.titulo)}">[${n}]</a>` : m
  })
}

function cuNivel(n) {
  const m = META.niveles[n]
  return m ? `<span class="nivel-badge" style="--n:var(--nivel-${n})" title="${esc(m.nombre)}">${NIVEL_GLIFO[n] ?? ''} ${esc(m.numero)}</span>` : ''
}

function filaFuente(f, boton) {
  return `<div class="cu-fuente"><span class="cu-tit" ${f.id ? `data-pieza="${f.id}"` : ''} title="${esc(f.titulo)}">${f.esQuantomo ? '<i class="cu-atomo" title="Quántomo">⚛</i> ' : ''}${esc(f.titulo)}</span><span class="cu-meta">${cuNivel(f.nivel)}</span>${boton}</div>`
}

async function montarCuaderno(id) {
  let c
  try { c = await api(`/cuadernos/${id}`) } catch (e) { cuadernoAbierto = null; return error(e) }
  if (cuImport.id !== id) cuImport = { id, modo: 'buscar', q: '', entidad: null }
  const modo = cuImport.modo
  $('#principal').innerHTML = `
    <div class="titulo cu-cab"><h1>${esc(c.titulo)}</h1><p><a href="#" id="cu-volver">← Cuadernos</a></p>
      <div class="fila"><button class="btn" id="cu-guia" ${c.fuentes.length ? '' : 'disabled'}>Guía</button><button class="btn" id="cu-charla" ${c.fuentes.length && !c.haciendo ? '' : 'disabled'}>🎧 Charla en audio</button><button class="btn btn-chico btn-peligro" id="cu-borrar">Borrar cuaderno</button></div></div>
    ${c.haciendo ? `<p class="pensando">${esc(c.haciendo)}…</p>` : ''}
    <div class="cu-cols">
      <aside class="panel cu-lado">
        <h3>Fuentes <em>${c.fuentes.length}</em></h3>
        <div class="cu-fuentes">${c.fuentes.map((f) => filaFuente(f, `<button class="btn btn-chico" data-quitar="${f.id}" title="Quitar">✕</button>`)).join('') || '<p class="tenue">Sumá fuentes abajo.</p>'}</div>
        <div class="cu-sumar">
          <h3>Sumar</h3>
          <div class="cu-modos">
            <button type="button" data-modo="buscar" class="${modo === 'buscar' ? 'on' : ''}">Buscar</button>
            <button type="button" data-modo="url" class="${modo === 'url' ? 'on' : ''}">URL</button>
            <button type="button" data-modo="texto" class="${modo === 'texto' ? 'on' : ''}">Texto</button>
          </div>
          <div class="cu-bloque" id="cu-panel-buscar" ${modo === 'buscar' ? '' : 'hidden'}>
            <input id="cu-buscar" placeholder="Pieza o entidad…" value="${esc(cuImport.q)}" autocomplete="off">
            <div id="cu-res"></div>
          </div>
          <div class="cu-bloque" id="cu-panel-url" ${modo === 'url' ? '' : 'hidden'}>
            <input id="cu-url" placeholder="https://…" autocomplete="off">
            <button class="btn btn-chico" id="cu-url-ok" type="button">Leer y sumar</button>
            <p class="cu-ayuda tenue">La página entra al corpus como fuente primaria y queda en este cuaderno.</p>
          </div>
          <div class="cu-bloque" id="cu-panel-texto" ${modo === 'texto' ? '' : 'hidden'}>
            <input id="cu-texto-tit" placeholder="Título, si querés" autocomplete="off">
            <textarea id="cu-texto" rows="4" placeholder="Pegá el texto"></textarea>
            <button class="btn btn-chico" id="cu-texto-ok" type="button">Sumar texto</button>
          </div>
        </div>
      </aside>
      <section class="cu-lectura">
        <div class="cu-notas">${c.notas.map((n) => `
          <div class="cu-nota">
            ${n.tipo === 'respuesta' ? `<div class="q">${esc(n.pregunta)}</div>` : `<div class="q">${n.tipo === 'guia' ? 'Guía' : '🎧 Charla'}</div>`}
            ${n.tipo === 'audio' && n.artefactoId ? `<audio controls preload="none" src="/taller/${n.artefactoId}/charla.mp3" style="width:100%;max-width:100%"></audio><details><summary class="tenue">Guion</summary><div class="md">${md(n.texto)}</div></details>` : `<div class="md">${conCitas(n.texto, n.citas)}</div>`}
            ${n.citas.length ? `<div class="cu-citas">${n.citas.map((x) => `<a href="#" data-pieza="${x.piezaId}" title="${esc(x.titulo)}">[${x.n}] ${esc(x.titulo)}</a>`).join('')}</div>` : ''}
          </div>`).join('') || `<p class="vacio">${c.fuentes.length ? 'Preguntale algo, o pedile la guía.' : 'Primero sumá fuentes.'}</p>`}</div>
        <form class="cu-preguntar" id="cu-preguntar"><input name="pregunta" placeholder="Preguntale al cuaderno…" ${c.fuentes.length ? '' : 'disabled'} autocomplete="off"><button class="btn btn-primario" ${c.fuentes.length ? '' : 'disabled'}>Preguntar</button></form>
      </section>
    </div>`
  const otra = () => montarCuaderno(id)
  const ocupado = async (boton, texto, fn) => {
    boton.disabled = true
    const t = boton.textContent
    boton.textContent = texto
    try {
      const r = await fn()
      if (r?.recorte) toast(esc(r.recorte), 'suave')
      otra()
    } catch (e) { error(e); boton.disabled = false; boton.textContent = t }
  }
  $('#cu-volver').onclick = (e) => { e.preventDefault(); cuadernoAbierto = null; montarCuadernos() }
  $('#cu-borrar').onclick = async () => { if (!confirm(`¿Borrar el cuaderno «${c.titulo}»? Las fuentes quedan en el corpus.`)) return; try { await api(`/cuadernos/${id}/borrar`, {}); cuadernoAbierto = null; montarCuadernos() } catch (e) { error(e) } }
  $$('[data-quitar]').forEach((b) => (b.onclick = async () => { try { await api(`/cuadernos/${id}/quitar`, { pieza: Number(b.dataset.quitar) }); otra() } catch (e) { error(e) } }))
  $('#cu-guia').onclick = (e) => ocupado(e.target, 'Leyendo las fuentes…', () => api(`/cuadernos/${id}/guia`, {}))
  $('#cu-charla').onclick = (e) => ocupado(e.target, 'Arrancando…', async () => { await api(`/cuadernos/${id}/charla`, {}); toast('Armando la charla<small>Tarda unos minutos; te aviso acá cuando esté.</small>') })
  $('#cu-preguntar').onsubmit = (e) => { e.preventDefault(); const q = e.target.pregunta.value.trim(); if (q) ocupado(e.target.querySelector('button'), 'Pensando…', () => api(`/cuadernos/${id}/preguntar`, { pregunta: q })) }
  $$('[data-modo]').forEach((b) => (b.onclick = () => {
    cuImport.modo = b.dataset.modo
    cuImport.entidad = null
    $$('[data-modo]').forEach((x) => x.classList.toggle('on', x.dataset.modo === cuImport.modo))
    for (const m of ['buscar', 'url', 'texto']) $(`#cu-panel-${m}`).hidden = cuImport.modo !== m
  }))
  $('#cu-url-ok').onclick = (e) => { const u = $('#cu-url').value.trim(); if (u) ocupado(e.target, 'Leyendo…', () => api(`/cuadernos/${id}/fuentes`, { url: u })) }
  $('#cu-texto-ok').onclick = (e) => {
    const contenido = $('#cu-texto').value.trim()
    const titulo = $('#cu-texto-tit').value.trim()
    if (contenido) ocupado(e.target, 'Sumando…', () => api(`/cuadernos/${id}/fuentes`, { texto: { contenido, ...(titulo ? { titulo } : {}) } }))
  }
  const pintarBusqueda = async () => {
    const box = $('#cu-res')
    if (!box || cuImport.entidad) return
    const q = cuImport.q.trim()
    if (q.length < 2) { box.innerHTML = '<p class="cu-ayuda tenue">Buscá una pieza del corpus o una entidad: de la entidad podés sumar quántomos, los que elijas o todos.</p>'; return }
    let piezas = []
    let entidades = []
    try {
      if (q.length >= 3) piezas = (await api(`/buscar?q=${encodeURIComponent(q)}&limite=8`)).piezas
    } catch { /* la búsqueda de texto a veces rechaza signos */ }
    try { entidades = (await api(`/entidades?q=${encodeURIComponent(q)}&limite=6`)).entidades } catch (e) { return error(e) }
    const ya = new Set(c.fuentes.map((f) => f.id))
    const libres = piezas.filter((p) => !ya.has(p.id))
    const htmlP = libres.length ? `<div class="cu-grupo">Piezas</div>${libres.map((p) => filaFuente(p, `<button class="btn btn-chico" data-sumar="${p.id}" type="button">＋</button>`)).join('')}` : ''
    const htmlE = entidades.length ? `<div class="cu-grupo">Entidades</div>${entidades.map((e) => `<div class="cu-fuente"><span class="cu-tit" title="${esc(e.nombre)}">${TIPO_ENT[e.tipo]?.glifo ?? '·'} ${esc(e.nombre)}</span><span class="cu-meta tenue">${e.piezas}</span><button class="btn btn-chico" type="button" data-ent="${e.id}">Abrir</button></div>`).join('')}` : ''
    box.innerHTML = htmlP + htmlE || '<p class="tenue">Nada con ese nombre.</p>'
    $$('[data-sumar]', box).forEach((b) => (b.onclick = () => ocupado(b, '…', () => api(`/cuadernos/${id}/fuentes`, { piezas: [Number(b.dataset.sumar)] }))))
    $$('[data-ent]', box).forEach((b) => (b.onclick = () => abrirEntidad(Number(b.dataset.ent))))
  }
  const abrirEntidad = async (entId) => {
    cuImport.entidad = entId
    const box = $('#cu-res')
    if (!box) return
    box.innerHTML = '<p class="tenue">Cargando…</p>'
    let d
    try { d = await api(`/entidades/${entId}/componentes`) } catch (e) { cuImport.entidad = null; return error(e) }
    if (cuImport.entidad !== entId || !$('#cu-res')) return
    const glifo = TIPO_ENT[d.entidad.tipo]?.glifo ?? '·'
    const hay = d.quantomos.length || d.piezas.length
    $('#cu-res').innerHTML = `<div class="cu-ent">
      <div class="cu-ent-cab"><button type="button" class="btn btn-chico" id="cu-ent-volver" title="Volver">←</button><b title="${esc(d.entidad.nombre)}">${glifo} ${esc(d.entidad.nombre)}</b></div>
      <p class="cu-ayuda tenue">${d.piezasTotal} pieza${d.piezasTotal === 1 ? '' : 's'} · ${d.quantomosTotal} quántomo${d.quantomosTotal === 1 ? '' : 's'}. Marcá los que querés, o sumalos todos.</p>
      <section>
        <div class="cu-ent-h"><span>Quántomos</span>${d.quantomosTotal ? `<button type="button" class="btn btn-chico" data-todo="quantomos">Todos${d.quantomosTotal > d.quantomos.length ? ` · ${d.quantomosTotal}` : ''}</button>` : ''}</div>
        ${d.quantomos.length ? `<div class="cu-lista">${d.quantomos.map((q) => { const linea = q.titulo && !q.texto.startsWith(q.titulo) ? `${q.titulo} — ${q.texto}` : q.texto; return `<label class="cu-check"><input type="checkbox" data-qid="${q.id}"><span title="${esc(q.texto)}">${esc(linea)}</span></label>` }).join('')}</div>${d.quantomosTotal > d.quantomos.length ? '<p class="cu-ayuda tenue">«Todos» suma hasta 80, los de más peso.</p>' : ''}` : '<p class="tenue">Ningún quántomo en las piezas que la mencionan.</p>'}
      </section>
      <section>
        <div class="cu-ent-h"><span>Piezas</span>${d.piezasTotal ? `<button type="button" class="btn btn-chico" data-todo="piezas">Todas${d.piezasTotal > d.piezas.length ? ` · ${d.piezasTotal}` : ''}</button>` : ''}</div>
        ${d.piezas.length ? `<div class="cu-lista">${d.piezas.map((p) => `<label class="cu-check"><input type="checkbox" data-pid="${p.id}"><span title="${esc(p.titulo)}">${esc(p.titulo)}</span></label>`).join('')}</div>` : '<p class="tenue">Ninguna pieza la menciona.</p>'}
      </section>
      ${hay ? '<div class="cu-acc"><button type="button" class="btn btn-chico btn-primario" id="cu-sumar-marcados">Sumar marcados</button></div>' : ''}
    </div>`
    $('#cu-ent-volver').onclick = () => { cuImport.entidad = null; pintarBusqueda() }
    $$('[data-todo]', $('#cu-res')).forEach((b) => (b.onclick = () => ocupado(b, 'Sumando…', () => api(`/cuadernos/${id}/fuentes`, { entidad: d.entidad.id, todo: b.dataset.todo }))))
    const marcar = $('#cu-sumar-marcados')
    if (marcar) marcar.onclick = () => {
      const quantomos = $$('[data-qid]:checked', $('#cu-res')).map((x) => Number(x.dataset.qid))
      const piezas = $$('[data-pid]:checked', $('#cu-res')).map((x) => Number(x.dataset.pid))
      if (!quantomos.length && !piezas.length) return toast('Marcá al menos un quántomo o una pieza')
      ocupado(marcar, 'Sumando…', () => api(`/cuadernos/${id}/fuentes`, { quantomos, piezas, entidad: d.entidad.id }))
    }
  }
  let espera
  $('#cu-buscar').oninput = (e) => {
    cuImport.q = e.target.value
    cuImport.entidad = null
    clearTimeout(espera)
    espera = setTimeout(() => pintarBusqueda(), 280)
  }
  if (cuImport.entidad) abrirEntidad(cuImport.entidad)
  else pintarBusqueda()
  // Mientras graba la charla, se refresca solo.
  clearTimeout(cuEspera)
  if (c.haciendo) cuEspera = setTimeout(() => { if (vista === 'cuadernos' && cuadernoAbierto === id) otra() }, 5000)
}
