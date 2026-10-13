'use strict'
// Librería: lo que leés, mirás, jugás y estudiás. Se carga (vos y Mastropiero), se revisa y se usa:
// cada obra puede traer su fuente al corpus, abrirse como cuaderno, y el Mentor la vuelve tarea.

const TIPOS_LIB = [['libro', 'Libros', '📖'], ['pelicula', 'Películas', '🎬'], ['serie', 'Series', '📺'], ['videojuego', 'Videojuegos', '🎮'], ['paper', 'Papers', '📄'], ['repositorio', 'Repos', '⌥']]
const ESTADOS_LIB = [['quiero', 'Quiero'], ['en_curso', 'En curso'], ['terminado', 'Terminado'], ['abandonado', 'Abandonado'], ['referencia', 'Referencia']]
const AUTOR_LIB = { libro: 'Autor', pelicula: 'Dirección', serie: 'Creador', videojuego: 'Estudio', paper: 'Autores', repositorio: 'Owner' }
let libTipo = 'libro'
let libFiltro = ''
let libEstado = ''
let libSoloRevisar = false
let libEspera = null

function montarLibreria() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Librería</h1><p>Lo que leés, mirás, jugás y estudiás. No es solo una lista: cada obra puede traer su fuente a tu corpus (para que Mastropiero sepa de qué trata), abrirse como cuaderno para preguntarle, y el Mentor la convierte en tareas para lo que estás empujando.</p>
      <div class="fila"><a class="btn" id="lib-csv" href="#" title="Bajar esta planilla">⇩ CSV</a></div></div>
    <div class="lib-flujo" id="lib-flujo"></div>
    <p class="pensando" id="lib-trabajando" hidden></p>
    <div id="lib-recos"></div>
    <section class="seccion">
      <div class="tabs" id="lib-tabs"></div>
      <div class="lib-barra">
        <form class="fila" id="lib-nueva"><input name="titulo" placeholder="Título" required autocomplete="off" style="flex:2;min-width:12em"><input name="autor" placeholder="Autor" autocomplete="off" style="flex:1;min-width:8em"><input name="anio" placeholder="Año" style="width:5em"><button class="btn btn-primario">＋ Sumar</button></form>
        <div class="fila"><input id="lib-q" placeholder="Buscar…" value="${esc(libFiltro)}" style="width:11em">
          <select id="lib-estado"><option value="">Todos los estados</option>${ESTADOS_LIB.map(([k, n]) => `<option value="${k}" ${libEstado === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <label class="tenue" style="font-size:12.5px"><input type="checkbox" id="lib-revisar" ${libSoloRevisar ? 'checked' : ''}> solo por revisar</label></div>
      </div>
      <div class="lib-envoltura"><table class="lib-tabla" id="lib-tabla"></table></div>
    </section>`
  $('#lib-nueva').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { const r = await api('/libreria', { ...f, tipo: libTipo }); if (!r.nueva) toast('Ya estaba en la Librería'); ev.target.reset(); ev.target.titulo.focus(); refrescarLibreria() } catch (e) { error(e) }
  }
  let t
  $('#lib-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { libFiltro = e.target.value; refrescarLibreria() }, 250) }
  $('#lib-estado').onchange = (e) => { libEstado = e.target.value; refrescarLibreria() }
  $('#lib-revisar').onchange = (e) => { libSoloRevisar = e.target.checked; refrescarLibreria() }
  pintarMentor()
  refrescarLibreria()
}

/** El recorrido: cargar → revisar → usar, con sus números y su botón. */
function pintarFlujo(d) {
  const p = d.panorama
  const ocupado = !!(d.poblando || d.expandiendo)
  $('#lib-flujo').innerHTML = `
    <article class="lib-paso"><div class="lib-paso-cab"><b>1</b>Cargar</div>
      <p><strong>${p.total}</strong> obras. Las sumás vos (arriba de la planilla, o diciéndoselo a Mastropiero en el chat) o las saca Mastropiero de lo que ya tenés en el corpus.</p>
      <button class="btn btn-chico" data-flujo="poblar" ${ocupado ? 'disabled' : ''}>✦ Buscar más en mi corpus</button></article>
    <article class="lib-paso"><div class="lib-paso-cab"><b>2</b>Revisar y valorar</div>
      <p><strong>${p.sinRevisar}</strong> por revisar · ${p.enCurso} en curso · ${p.quiero} que querés · ${p.valoradas} valoradas (1–12). Tocar una fila la da por revisada.</p>
      <button class="btn btn-chico" data-flujo="revisar">${libSoloRevisar ? 'Ver todas' : 'Ver las que faltan'}</button></article>
    <article class="lib-paso"><div class="lib-paso-cab"><b>3</b>Usar</div>
      <p><strong>${p.enCorpus}</strong> con su fuente en el corpus · ${p.porExpandir} para traer (las en curso, las que querés y las valoradas 7+ primero).</p>
      <div class="fila"><button class="btn btn-chico btn-primario" data-flujo="expandir" ${ocupado || !p.porExpandir ? 'disabled' : ''}>⇣ Traer al corpus</button><button class="btn btn-chico" data-flujo="mentor">🧭 Qué hago ahora</button></div></article>`
  $$('[data-flujo]', $('#lib-flujo')).forEach((b) => (b.onclick = async () => {
    const que = b.dataset.flujo
    if (que === 'revisar') { libSoloRevisar = !libSoloRevisar; $('#lib-revisar').checked = libSoloRevisar; return refrescarLibreria() }
    b.disabled = true
    try {
      if (que === 'poblar') { await api('/libreria/poblar', {}); toast('Buscando en tu corpus<small>Te aviso en Hoy cuando termine.</small>') }
      if (que === 'expandir') { await api('/libreria/expandir', { limite: 20 }); toast('Trayendo fuentes<small>De a una; te aviso en Hoy cuando termine.</small>') }
      if (que === 'mentor') { b.textContent = 'Pensando qué te sirve…'; await api('/mentor', {}); await pintarMentor(); $('#lib-recos').scrollIntoView({ behavior: 'smooth' }) }
    } catch (e) { error(e) } finally { refrescarLibreria() }
  }))
  const trabajo = $('#lib-trabajando')
  const txt = d.poblando ? `Buscando obras en tu corpus: ${d.poblando}…` : d.expandiendo ? `Trayendo fuentes al corpus: ${d.expandiendo.hechas} de ${d.expandiendo.total}${d.expandiendo.actual ? ` · ${d.expandiendo.actual}` : ''}…` : ''
  trabajo.hidden = !txt
  trabajo.textContent = txt
}

async function pintarMentor() {
  const cont = $('#lib-recos')
  if (!cont) return
  let rs
  try { rs = await api('/mentor') } catch { return }
  const TIPO = Object.fromEntries(TIPOS_LIB.map(([k, n, i]) => [k, `${i} ${n.toLowerCase().replace(/s$/, '')}`]))
  cont.innerHTML = rs.length ? `<section class="seccion">
    <div class="seccion-cab"><h3>🧭 El Mentor recomienda</h3><span class="tenue">De tu Librería, para lo que estás empujando esta semana. Aceptar la deja como side quest y pone la obra «en curso».</span></div>
    <div class="tarjetas">${rs.map((r) => `<article class="tarjeta" data-reco="${r.id}">
      <div class="tarjeta-cab"><span class="chip">${esc(TIPO[r.tipo] ?? r.tipo)}</span><span class="lib-obra-mini">${esc(r.titulo)}</span>${r.minutos ? `<span class="estado-chip">${r.minutos} min</span>` : ''}</div>
      <h4>${esc(r.accion)}</h4>
      <p class="recorte" title="Tocá para ver todo">${esc(r.porQue)}</p>
      <div class="tarjeta-pie"><button class="btn btn-chico btn-primario" data-si>${r.como === 'banda' ? 'A la próxima run' : 'Side quest'}</button><span class="espacio"></span><button class="btn btn-chico" data-no title="No me sirve">Descartar</button></div>
    </article>`).join('')}</div></section>` : ''
  $$('.recorte', cont).forEach((p) => (p.onclick = () => p.classList.toggle('abierto')))
  $$('[data-reco]', cont).forEach((el) => {
    const id = el.dataset.reco
    $('[data-si]', el).onclick = async () => { try { await api(`/mentor/${id}`, { aceptar: true }); toast('Anotado<small>Quedó como side quest y la obra pasó a «en curso».</small>'); pintarMentor(); refrescarLibreria() } catch (e) { error(e) } }
    $('[data-no]', el).onclick = async () => { try { await api(`/mentor/${id}`, { aceptar: false }); pintarMentor() } catch (e) { error(e) } }
  })
}

async function refrescarLibreria() {
  const tabla = $('#lib-tabla')
  if (!tabla) return
  let d
  try { d = await api(`/libreria?tipo=${libTipo}${libFiltro ? `&q=${encodeURIComponent(libFiltro)}` : ''}${libEstado ? `&estado=${libEstado}` : ''}`) } catch (e) { return error(e) }
  pintarFlujo(d)
  $('#lib-tabs').innerHTML = TIPOS_LIB.map(([k, n, i]) => `<button data-tab="${k}" class="${libTipo === k ? 'on' : ''}">${i} ${n} <small class="tenue">${d.conteos[k].total}${d.conteos[k].sinRevisar ? ` · ${d.conteos[k].sinRevisar}✦` : ''}</small></button>`).join('')
  $$('#lib-tabs [data-tab]').forEach((b) => (b.onclick = () => { libTipo = b.dataset.tab; refrescarLibreria() }))
  $('#lib-csv').href = `/api/libreria.csv?tipo=${libTipo}`
  $('#lib-nueva').autor.placeholder = AUTOR_LIB[libTipo]
  clearTimeout(libEspera)
  if (d.poblando || d.expandiendo) libEspera = setTimeout(() => { if (vista === 'libreria') refrescarLibreria() }, 4000)

  const obras = libSoloRevisar ? d.obras.filter((o) => !o.revisada) : d.obras
  const celda = (campo, valor, extra = '') => `<td contenteditable="true" spellcheck="false" data-campo="${campo}" ${extra}>${esc(valor ?? '')}</td>`
  const usoDe = (o) => o.expansion === 'ok'
    ? `<span class="estado-chip ok" title="${esc(o.resumen ?? 'Su fuente está en el corpus')}">en corpus</span>${o.piezas.length ? `<button class="btn btn-chico" data-cuaderno title="Abrir un cuaderno con esta obra para preguntarle">Cuaderno</button>` : ''}`
    : o.expansion ? `<span class="estado-chip" title="Probá con un link en la columna Link">${esc(o.expansion)}</span><button class="btn btn-chico" data-expandir title="Volver a buscar su fuente">↻</button>`
      : `<button class="btn btn-chico" data-expandir title="Traer su fuente (README, abstract, Wikipedia) a tu corpus">⇣ Al corpus</button>`
  tabla.innerHTML = `<thead><tr><th>Título</th><th>${AUTOR_LIB[libTipo]}</th><th>Año</th><th>Estado</th><th>Valor</th><th>Etiquetas</th><th>Notas</th><th>Link</th><th>Usar</th><th></th></tr></thead>
    <tbody>${obras.map((o) => `<tr data-id="${o.id}" class="${o.revisada ? '' : 'sin-revisar'}" title="${o.revisada ? '' : 'La cargó Mastropiero: revisala'}">
      ${celda('titulo', o.titulo, o.resumen ? `title="${esc(o.resumen)}"` : '')}${celda('autor', o.autor)}${celda('anio', o.anio)}
      <td><select data-campo="estado" class="lib-estado ${o.estado}">${ESTADOS_LIB.map(([k, n]) => `<option value="${k}" ${o.estado === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><select data-campo="valoracion" class="lib-valor"><option value="">—</option>${Array.from({ length: 12 }, (_, i) => `<option ${o.valoracion === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></td>
      ${celda('etiquetas', o.etiquetas.join(', '))}${celda('notas', o.notas)}
      <td class="lib-link">${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" title="${esc(o.url)}">↗</a>` : ''}<span contenteditable="true" data-campo="url" class="tenue" title="Pegá un link"></span></td>
      <td class="lib-usar">${usoDe(o)}</td>
      <td class="lib-acc">${o.piezas.length ? `<a href="#" data-pieza="${o.piezas[0]}" title="De dónde salió (${o.piezas.length} pieza${o.piezas.length > 1 ? 's' : ''})">❦</a>` : ''}${o.revisada ? '' : '<button class="btn btn-chico" data-ok title="Está bien así">✓</button>'}<button class="btn btn-chico" data-borrar title="Borrar">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="10" class="vacio">${libSoloRevisar ? 'No queda nada por revisar acá. 🎉' : 'Nada todavía. Sumá arriba, o «Buscar más en mi corpus».'}</td></tr>`}</tbody>`
  const guardar = async (tr, cambio) => { try { await api(`/libreria/${tr.dataset.id}`, cambio); tr.classList.remove('sin-revisar'); tr.querySelector('[data-ok]')?.remove() } catch (e) { error(e); refrescarLibreria() } }
  $$('[contenteditable][data-campo]', tabla).forEach((td) => {
    const antes = td.textContent
    td.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); td.blur() } if (e.key === 'Escape') { td.textContent = antes; td.blur() } }
    td.onblur = () => { const v = td.textContent.trim(); if (v !== antes.trim()) guardar(td.closest('tr'), { [td.dataset.campo]: v }).then(() => { if (td.dataset.campo === 'url' || td.dataset.campo === 'anio') refrescarLibreria() }) }
  })
  $$('select[data-campo]', tabla).forEach((s) => (s.onchange = () => { if (s.dataset.campo === 'estado') s.className = `lib-estado ${s.value}`; guardar(s.closest('tr'), { [s.dataset.campo]: s.value }) }))
  $$('[data-ok]', tabla).forEach((b) => (b.onclick = () => guardar(b.closest('tr'), { revisada: true })))
  $$('[data-borrar]', tabla).forEach((b) => (b.onclick = async () => { try { await api(`/libreria/${b.closest('tr').dataset.id}`, { borrar: true }); refrescarLibreria() } catch (e) { error(e) } }))
  $$('[data-expandir]', tabla).forEach((b) => (b.onclick = async () => {
    b.disabled = true
    b.textContent = 'Buscando…'
    try { const r = await api(`/libreria/${b.closest('tr').dataset.id}/expandir`, {}); toast(r.aviso ? `No pude<small>${esc(r.aviso)}</small>` : `En tu corpus<small>${esc(r.obra.resumen ?? r.obra.titulo)}</small>`) } catch (e) { error(e) } finally { refrescarLibreria() }
  }))
  $$('[data-cuaderno]', tabla).forEach((b) => (b.onclick = async () => {
    try { const c = await api(`/libreria/${b.closest('tr').dataset.id}/cuaderno`, {}); cuadernoAbierto = c.id; irA('cuadernos') } catch (e) { error(e) }
  }))
}
