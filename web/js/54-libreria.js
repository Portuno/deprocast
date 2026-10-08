'use strict'
// Librería: libros, películas, series, videojuegos, papers y repositorios, como planillas editables.

const TIPOS_LIB = [['libro', 'Libros'], ['pelicula', 'Películas'], ['serie', 'Series'], ['videojuego', 'Videojuegos'], ['paper', 'Papers'], ['repositorio', 'Repositorios']]
const ESTADOS_LIB = [['quiero', 'Quiero'], ['en_curso', 'En curso'], ['terminado', 'Terminado'], ['abandonado', 'Abandonado'], ['referencia', 'Referencia']]
const AUTOR_LIB = { libro: 'Autor', pelicula: 'Dirección', serie: 'Creador', videojuego: 'Estudio', paper: 'Autores', repositorio: 'Owner' }
let libTipo = 'libro'
let libFiltro = ''
let libEspera = null

function montarLibreria() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Librería</h1><p>Lo que leés, mirás, jugás y estudiás, como planillas. Editás tocando la celda. Las filas con raya a la izquierda las cargó Mastropiero desde tu corpus: cuando las tocás quedan revisadas. Después las usamos para expandir el corpus y recomendarte tareas.</p>
      <div class="fila"><button class="btn" id="lib-poblar" title="Repos y papers por su link; el resto, leyendo lo que dijiste o guardaste">✦ Poblar desde el corpus</button><a class="btn" id="lib-csv" href="#">⇩ CSV</a></div></div>
    <div class="tabs" id="lib-tabs"></div>
    <div class="fila" style="margin:10px 0">
      <form class="fila" id="lib-nueva" style="flex:1"><input name="titulo" placeholder="Título" required style="flex:2" autocomplete="off"><input name="autor" placeholder="Autor" style="flex:1" autocomplete="off"><input name="anio" placeholder="Año" style="width:5em"><button class="btn btn-primario">＋ Sumar</button></form>
      <input id="lib-q" placeholder="Filtrar…" value="${esc(libFiltro)}" style="width:12em">
    </div>
    <p class="pensando" id="lib-poblando" hidden></p>
    <div class="lib-envoltura"><table class="lib-tabla" id="lib-tabla"></table></div>`
  $('#lib-poblar').onclick = async () => { try { await api('/libreria/poblar', {}); toast('Poblando<small>Te aviso en Hoy cuando termine.</small>'); refrescarLibreria() } catch (e) { error(e) } }
  $('#lib-nueva').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { const r = await api('/libreria', { ...f, tipo: libTipo }); if (!r.nueva) toast('Ya estaba en la Librería'); ev.target.reset(); ev.target.titulo.focus(); refrescarLibreria() } catch (e) { error(e) }
  }
  let t
  $('#lib-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { libFiltro = e.target.value; refrescarLibreria() }, 250) }
  refrescarLibreria()
}

async function refrescarLibreria() {
  const tabla = $('#lib-tabla')
  if (!tabla) return
  let d
  try { d = await api(`/libreria?tipo=${libTipo}${libFiltro ? `&q=${encodeURIComponent(libFiltro)}` : ''}`) } catch (e) { return error(e) }
  $('#lib-tabs').innerHTML = TIPOS_LIB.map(([k, n]) => `<button data-tab="${k}" class="${libTipo === k ? 'on' : ''}">${n} <small class="tenue">${d.conteos[k].total}${d.conteos[k].sinRevisar ? ` · ${d.conteos[k].sinRevisar}✦` : ''}</small></button>`).join('')
  $$('#lib-tabs [data-tab]').forEach((b) => (b.onclick = () => { libTipo = b.dataset.tab; refrescarLibreria() }))
  $('#lib-csv').href = `/api/libreria.csv?tipo=${libTipo}`
  $('#lib-nueva').autor.placeholder = AUTOR_LIB[libTipo]
  const pob = $('#lib-poblando')
  pob.hidden = !d.poblando
  pob.textContent = d.poblando ? `Poblando: ${d.poblando}…` : ''
  $('#lib-poblar').disabled = !!d.poblando
  clearTimeout(libEspera)
  if (d.poblando) libEspera = setTimeout(() => { if (vista === 'libreria') refrescarLibreria() }, 5000)

  const celda = (o, campo, valor) => `<td contenteditable="true" spellcheck="false" data-campo="${campo}">${esc(valor ?? '')}</td>`
  tabla.innerHTML = `<thead><tr><th>Título</th><th>${AUTOR_LIB[libTipo]}</th><th>Año</th><th>Estado</th><th>Valor</th><th>Etiquetas</th><th>Notas</th><th>Link</th><th></th></tr></thead>
    <tbody>${d.obras.map((o) => `<tr data-id="${o.id}" class="${o.revisada ? '' : 'sin-revisar'}" title="${o.revisada ? '' : 'La cargó Mastropiero: revisala'}">
      ${celda(o, 'titulo', o.titulo)}${celda(o, 'autor', o.autor)}${celda(o, 'anio', o.anio)}
      <td><select data-campo="estado">${ESTADOS_LIB.map(([k, n]) => `<option value="${k}" ${o.estado === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><select data-campo="valoracion"><option value="">—</option>${Array.from({ length: 12 }, (_, i) => `<option ${o.valoracion === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></td>
      ${celda(o, 'etiquetas', o.etiquetas.join(', '))}${celda(o, 'notas', o.notas)}
      <td>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" title="${esc(o.url)}">↗</a>` : ''}<span contenteditable="true" data-campo="url" class="tenue" style="display:inline-block;min-width:2em" title="Pegá un link"></span></td>
      <td>${o.piezas.length ? `<a href="#" data-pieza="${o.piezas[0]}" title="De dónde salió (${o.piezas.length} pieza${o.piezas.length > 1 ? 's' : ''})">❦</a>` : ''} ${o.revisada ? '' : '<button class="btn btn-chico" data-ok title="Está bien así">✓</button>'}<button class="btn btn-chico" data-borrar title="Borrar">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="9" class="vacio">Nada todavía. Sumá arriba, o tocá «Poblar desde el corpus».</td></tr>`}</tbody>`
  const guardar = async (tr, cambio) => { try { await api(`/libreria/${tr.dataset.id}`, cambio); tr.classList.remove('sin-revisar'); tr.querySelector('[data-ok]')?.remove() } catch (e) { error(e); refrescarLibreria() } }
  $$('[contenteditable][data-campo]', tabla).forEach((td) => {
    const antes = td.textContent
    td.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); td.blur() } if (e.key === 'Escape') { td.textContent = antes; td.blur() } }
    td.onblur = () => { const v = td.textContent.trim(); if (v !== antes.trim()) guardar(td.closest('tr'), { [td.dataset.campo]: v }).then(() => { if (td.dataset.campo === 'url' || td.dataset.campo === 'anio') refrescarLibreria() }) }
  })
  $$('select[data-campo]', tabla).forEach((s) => (s.onchange = () => guardar(s.closest('tr'), { [s.dataset.campo]: s.value })))
  $$('[data-ok]', tabla).forEach((b) => (b.onclick = () => guardar(b.closest('tr'), { revisada: true })))
  $$('[data-borrar]', tabla).forEach((b) => (b.onclick = async () => { try { await api(`/libreria/${b.closest('tr').dataset.id}`, { borrar: true }); refrescarLibreria() } catch (e) { error(e) } }))
}
