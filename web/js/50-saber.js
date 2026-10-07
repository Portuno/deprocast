'use strict'
// Corpus

const NIVEL_ORDEN = ['propia', 'primaria', 'investigacion', 'generada']
const NIVEL_GLIFO = { propia: '◉', primaria: '❖', investigacion: '⌬', generada: '✶' }
const TIPO_NOMBRE = { materia: 'materia', referencia: 'referencia', ficha: 'ficha', lista: 'lista', enlace: 'enlace' }
const filtroCorpus = { nivel: '', fuente: '', tipo: '', q: '', desde: 0, carga: '' }
let corpusFirma = ''
let corpusLista = { total: 0, piezas: [] }

function nivelBadge(n) {
  const m = META.niveles[n]
  return m ? `<span class="nivel-badge" style="--n:var(--nivel-${n})">${NIVEL_GLIFO[n]} ${m.numero} · ${esc(m.nombre)}</span>` : ''
}

function opcionesFuente(sel, { vacia = '', soloNivel = null } = {}) {
  const fs = E.fuentes
  const raiz = fs.filter((f) => !f.padreId)
  const hijas = (id) => fs.filter((f) => f.padreId === id)
  const op = (f, sangria) => `<option value="${esc(f.id)}" ${f.id === sel ? 'selected' : ''}>${sangria}${esc(f.nombre)} · ${META.niveles[f.nivel].numero}</option>`
  return (vacia ? `<option value="">${esc(vacia)}</option>` : '') +
    raiz.filter((f) => !soloNivel || f.nivel === soloNivel || hijas(f.id).length).map((f) => op(f, '') + hijas(f.id).map((h) => op(h, '  └ ')).join('')).join('') +
    `<option value="__nueva">＋ nueva fuente…</option>`
}

/** Un select de fuente con "＋ nueva fuente" que abre el alta en línea. */
function engancharFuente(select, nivelPorDefecto) {
  select.addEventListener('change', async () => {
    if (select.value !== '__nueva') return
    const nombre = prompt('Nombre de la fuente nueva (ej.: Gemini, Perplexity, Biblioteca de papers):')
    if (!nombre) { select.value = select.options[0].value; return }
    const nivel = nivelPorDefecto?.() ?? 'propia'
    const madre = E.fuentes.find((f) => /deprocast-0\.7$/.test(f.id)) && confirm('¿Cuelga de Deprocast 0.7? (Aceptar = sí, Cancelar = fuente independiente)') ? 'deprocast-0.7' : null
    try {
      const f = await api('/fuentes', { nombre, nivel, padreId: madre })
      await refrescar()
      select.innerHTML = opcionesFuente(f.id)
      toast(`Fuente «${esc(f.nombre)}» creada<small>Nivel ${META.niveles[f.nivel].numero} · ${esc(META.niveles[f.nivel].nombre)}</small>`, 'suave')
    } catch (e) { error(e); select.value = select.options[0].value }
  })
}

function montarCorpus() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Corpus</h1>
      <p>Todo lo que Mastropiero sabe, por la voz que habla en cada pieza. Lo estructurado entra listo; lo crudo pasa por extractor → clasificador → vectorizador.</p>
      <div class="fila"><button class="btn" id="c-quantomos" title="Las unidades mínimas que destila la pipeline">Quántomos</button><button class="btn" id="c-fuentes">Fuentes</button><button class="btn btn-primario" id="c-ingerir">＋ Ingerir</button></div>
    </div>
    <div class="niveles" id="c-niveles"></div>
    <div class="corpus-barra">
      <input class="campo-suelto" id="c-q" placeholder="Buscar en el corpus (sin importar tildes)…" value="${esc(filtroCorpus.q)}">
      <select class="campo-suelto" id="c-fuente"></select>
      <select class="campo-suelto" id="c-tipo"><option value="">todo tipo</option>${META.tipos.map((t) => `<option ${t === filtroCorpus.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <div class="corpus-grid">
      <section><div id="c-cuenta" class="cuenta"></div><div id="piezas"></div><div id="c-mas"></div></section>
      <aside class="panel"><h3>Cargas</h3><div id="c-cargas"></div></aside>
    </div>`
  $('#c-ingerir').onclick = () => modalIngesta()
  $('#c-fuentes').onclick = modalFuentes
  $('#c-quantomos').onclick = () => irA('quantomos')
  let espera
  $('#c-q').oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { filtroCorpus.q = e.target.value; filtroCorpus.desde = 0; traerPiezas() }, 250) }
  $('#c-fuente').onchange = (e) => {
    if (e.target.value === '__nueva') return
    filtroCorpus.fuente = e.target.value; filtroCorpus.desde = 0; traerPiezas()
  }
  engancharFuente($('#c-fuente'))
  $('#c-tipo').onchange = (e) => { filtroCorpus.tipo = e.target.value; filtroCorpus.desde = 0; traerPiezas() }
  corpusFirma = ''
  refrescarCorpus()
}

function refrescarCorpus() {
  if (!$('#c-niveles')) return
  const n = Object.fromEntries(E.liga.niveles.map((x) => [x.nivel, x.n]))
  const q = Object.fromEntries(E.quantomos.map((x) => [x.etapa, x.n]))
  $('#c-niveles').innerHTML = NIVEL_ORDEN.map((k) => `
    <button class="nivel-tile ${filtroCorpus.nivel === k ? 'on' : ''}" style="--n:var(--nivel-${k})" data-nivel="${k}">
      <span class="nt-glifo">${NIVEL_GLIFO[k]}</span><span class="nt-num">${META.niveles[k].numero}</span>
      <b>${esc(META.niveles[k].nombre)}</b><strong>${(n[k] ?? 0).toLocaleString('es-AR')}</strong><small>${esc(META.niveles[k].descripcion)}</small>
    </button>`).join('') + `
    <div class="nivel-tile extra"><span class="nt-glifo">⚛</span><b>Quántomos</b><strong>${((q.sellado ?? 0) + (q.proto ?? 0) + (q.propuesta ?? 0)).toLocaleString('es-AR')}</strong>
      <small>${q.proto ?? 0} proto · ${q.propuesta ?? 0} propuestas · ${q.sellado ?? 0} sellados</small></div>
    <div class="nivel-tile extra"><span class="nt-glifo">⚇</span><b>Entidades</b><strong>${E.liga.entidades.toLocaleString('es-AR')}</strong>
      <small>${E.entidades.slice(0, 4).map((e) => `${e.n} ${e.tipo}`).join(' · ') || 'personas, proyectos, lugares…'}</small></div>`
  $$('[data-nivel]').forEach((b) => (b.onclick = () => { filtroCorpus.nivel = filtroCorpus.nivel === b.dataset.nivel ? '' : b.dataset.nivel; filtroCorpus.desde = 0; refrescarCorpus(); traerPiezas() }))
  if ($('#c-fuente').value !== '__nueva') $('#c-fuente').innerHTML = opcionesFuente(filtroCorpus.fuente, { vacia: 'todas las fuentes' })
  $('#c-cargas').innerHTML = E.cargas.length ? E.cargas.map((c) => `
    <div class="carga-item ${c.estado}" data-carga="${c.id}">
      <div class="m-top"><span>#${c.id} · ${esc(c.importador)}</span><span class="pill ${c.estado === 'hecha' ? 'activo' : c.estado === 'analizada' ? 'prueba' : 'banca'}">${c.estado}</span></div>
      <div class="ci-tit">${esc(c.titulo ?? c.archivo)}</div>
      ${c.resumen ? `<div class="ci-res">${c.resumen.piezas} piezas · ${c.resumen.quantomos} quántomos · ${c.resumen.entidades} entidades${c.resumen.repetidas ? ` · ${c.resumen.repetidas} ya estaban` : ''}</div>` : ''}
    </div>`).join('') : '<p class="tenue">Ninguna todavía. Subí un archivo desde «＋ Ingerir».</p>'
  $$('[data-carga]').forEach((el) => (el.onclick = () => modalCarga(Number(el.dataset.carga))))
  const firma = JSON.stringify([E.liga.corpus, E.liga.niveles, E.cargas.map((c) => c.estado)])
  if (firma !== corpusFirma) { corpusFirma = firma; traerPiezas() }
}

async function traerPiezas(mas = false) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtroCorpus)) if (v !== '' && v != null) p.set(k, v)
  p.set('limite', 40)
  try {
    const r = await api(`/corpus?${p}`)
    corpusLista = mas ? { total: r.total, piezas: [...corpusLista.piezas, ...r.piezas] } : r
    pintarPiezas()
  } catch (e) { error(e) }
}

function piezaHTML(p) {
  const fuente = E.fuentes.find((f) => f.id === p.fuente)
  return `<div class="pieza ${p.tipo}" style="--n:var(--nivel-${p.nivel})" data-pieza="${p.id}">
    <div class="p-top"><span>#${p.id}</span>${nivelBadge(p.nivel)}<span>${esc(fuente?.nombre ?? p.fuente)}</span>
      ${p.tipo !== 'materia' ? `<span class="tipo-chip">${TIPO_NOMBRE[p.tipo]}</span>` : ''}
      ${p.peso ? `<span class="peso-chip" title="peso">${p.peso}</span>` : ''}
      <span class="etapas">${p.estado === 'pendiente' ? '<i>por traer</i>' : p.estado === 'traido' ? '<i class="ok">traído</i>' : p.estado === 'disponible' ? '<i class="ok">disponible</i>' : ['EXT', 'CLA', 'VEC'].map((x, i) => `<i class="${ESTADOS_CORPUS.indexOf(p.estado) > i ? 'ok' : ''}">${x}</i>`).join('')}</span></div>
    <h4>${esc(p.titulo)}</h4>
    ${p.autor || p.fecha ? `<div class="p-autor">${esc(p.autor ?? '')}${p.autor && p.fecha ? ' · ' : ''}${esc(String(p.fecha ?? '').slice(0, 10))}</div>` : ''}
    <p>${esc(p.contenido.slice(0, 320))}</p>
    ${p.etiquetas.length ? `<div class="tags">${p.etiquetas.slice(0, 8).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
  </div>`
}

function pintarPiezas() {
  const cont = $('#piezas')
  if (!cont) return
  const hayFiltro = filtroCorpus.q || filtroCorpus.nivel || filtroCorpus.fuente || filtroCorpus.tipo || filtroCorpus.carga
  $('#c-cuenta').innerHTML = `${corpusLista.total.toLocaleString('es-AR')} pieza${corpusLista.total === 1 ? '' : 's'}${hayFiltro ? ' con este filtro' : ''}
    ${filtroCorpus.carga ? ` · carga #${filtroCorpus.carga} <a href="#" id="c-sin-carga">quitar</a>` : ''}`
  const sc = $('#c-sin-carga')
  if (sc) sc.onclick = (e) => { e.preventDefault(); filtroCorpus.carga = ''; traerPiezas() }
  if (!corpusLista.piezas.length) {
    cont.innerHTML = hayFiltro
      ? '<div class="vacio"><h2>Nada con ese filtro</h2></div>'
      : `<div class="vacio"><div class="gran">❦</div><h2>Corpus en blanco</h2><p>El sistema arranca sin nada tuyo. Ingerí una nota, una referencia o subí un archivo: respaldos y fichas de Deprocast, CSV, texto o Markdown.</p>
         <div class="fila" style="justify-content:center;margin-top:16px"><button class="btn btn-primario" id="vacio-ingerir">＋ Ingerir</button></div></div>`
    const b = $('#vacio-ingerir')
    if (b) b.onclick = () => modalIngesta()
    $('#c-mas').innerHTML = ''
    return
  }
  cont.innerHTML = corpusLista.piezas.map(piezaHTML).join('')
  $('#c-mas').innerHTML = corpusLista.piezas.length < corpusLista.total
    ? `<button class="btn" id="c-mas-btn" style="width:100%">Ver más (${corpusLista.total - corpusLista.piezas.length} restantes)</button>` : ''
  const m = $('#c-mas-btn')
  if (m) m.onclick = () => { filtroCorpus.desde = corpusLista.piezas.length; traerPiezas(true) }
}

async function modalPieza(id) {
  try {
    const { pieza: p, quantomos, entidades } = await api(`/corpus/${id}`)
    const fuente = E.fuentes.find((f) => f.id === p.fuente)
    const meta = p.meta ? Object.entries(p.meta).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)) : []
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <div class="p-top">${nivelBadge(p.nivel)}<span>${esc(fuente?.nombre ?? p.fuente)}</span><span class="tipo-chip">${p.tipo}</span><span>#${p.id} · ${esc(p.estado)}</span></div>
      <h2 style="margin-top:8px">${esc(p.titulo)}</h2>
      ${p.autor || p.fecha ? `<p class="tenue">${esc(p.autor ?? '')} ${esc(String(p.fecha ?? '').slice(0, 10))}</p>` : ''}
      ${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:var(--oro-2)">${esc(p.url)}</a></p>` : ''}
      ${p.tipo === 'enlace' && p.estado === 'pendiente' ? `<div class="fila" style="margin:10px 0"><button class="btn btn-primario" id="p-crawl">≋ Mandar a un crawler</button></div>` : ''}
      ${entidades.length ? `<div class="tags" style="margin:8px 0">${entidades.map((e) => `<span class="ent">${esc(e.tipo)} · ${esc(e.nombre)}</span>`).join('')}</div>` : ''}
      ${p.etiquetas.length ? `<div class="tags" style="margin:8px 0">${p.etiquetas.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="respuesta" style="max-height:42vh;overflow:auto;margin-top:12px">${esc(p.contenido)}</div>
      <h3 class="sub">Quántomos de esta pieza (${quantomos.length})</h3>
      ${quantomos.length ? `<div class="q-lista">${quantomos.map(quantomoHTML).join('')}</div>` : '<p class="tenue">Ninguno. Si pasa por la pipeline, el extractor propone proto-quántomos.</p>'}
      ${meta.length ? `<h3 class="sub">Metadatos</h3><pre class="json">${esc(JSON.stringify(Object.fromEntries(meta), null, 2))}</pre>` : ''}`)
    engancharQuantomos($('#modal'), () => modalPieza(id))
    const c = $('#p-crawl')
    if (c) c.onclick = async () => {
      try {
        const t = await api('/tareas', { clase: 'crawler', texto: `Traer ${p.url}`, url: p.url, corpusId: p.id })
        cerrarModal()
        toast(`Misión #${t.id} para un crawler<small>Dale Tick: lo traído entra como fuente primaria.</small>`, 'suave')
        await refrescar()
      } catch (e) { error(e) }
    }
  } catch (e) { error(e) }
}

function modalFuentes() {
  const fila = (f) => `<tr><td>${f.padreId ? '  └ ' : ''}<b>${esc(f.nombre)}</b><div class="tenue" style="font-size:12px">${esc(f.descripcion ?? '')}</div></td>
    <td>${nivelBadge(f.nivel)}</td><td style="font:12px var(--mono)">${f.piezas.toLocaleString('es-AR')}</td><td style="font:11px var(--mono);color:var(--tenue)">${esc(f.id)}${f.sistema ? ' · fábrica' : ''}</td></tr>`
  const raiz = E.fuentes.filter((f) => !f.padreId)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Fuentes</h2>
    <p class="tenue">Cada fuente tiene un nivel por defecto; cada pieza puede tener el suyo. El corpus tiene que poder comer de muchas más: sumá las que quieras.</p>
    <table class="log">${raiz.map((f) => fila(f) + E.fuentes.filter((h) => h.padreId === f.id).map(fila).join('')).join('')}</table>
    <h3 class="sub">Nueva fuente</h3>
    <div class="form-fuente">
      <label class="campo">Nombre<input id="nf-nombre" placeholder="Gemini, Perplexity, Kindle, Zotero…"></label>
      <label class="campo">Nivel por defecto<select id="nf-nivel">${NIVEL_ORDEN.map((n) => `<option value="${n}">${META.niveles[n].numero} · ${esc(META.niveles[n].nombre)}</option>`).join('')}</select></label>
      <label class="campo">Cuelga de<select id="nf-madre"><option value="">— ninguna —</option>${raiz.map((f) => `<option value="${esc(f.id)}">${esc(f.nombre)}</option>`).join('')}</select></label>
      <label class="campo campo-ancho">Descripción<input id="nf-desc" placeholder="Qué entra por acá"></label>
      <button class="btn btn-primario" id="nf-crear">Crear fuente</button>
    </div>`)
  $('#nf-crear').onclick = async () => {
    try {
      await api('/fuentes', { nombre: $('#nf-nombre').value, nivel: $('#nf-nivel').value, padreId: $('#nf-madre').value, descripcion: $('#nf-desc').value })
      await refrescar()
      modalFuentes()
    } catch (e) { error(e) }
  }
}

// ─── Ingesta ────────────────────────────────────────────────────────────

const INGESTA = {
  propia: { titulo: 'Algo mío', ayuda: 'Una nota, una idea, un texto propio. Entra crudo y la pipeline lo destila.' },
  primaria: { titulo: 'Una fuente primaria', ayuda: 'La obra de otro, tal cual: traerla de la web, anotar la referencia o pegar el documento.' },
  investigacion: { titulo: 'Una investigación', ayuda: 'Un informe o una curación hecha con ayuda (Perplexity, Grok, un pack). Su voz no es la tuya ni la del autor original.' },
  generada: { titulo: 'Algo generado', ayuda: 'Lo llenan los agentes solos: cada obra de un generativo entra acá. A mano: la salida de una IA externa.' },
}

function modalIngesta(nivel = null) {
  if (!nivel) {
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Ingerir</h2>
      <p class="tenue">¿De quién es la voz que habla en lo que vas a cargar?</p>
      <div class="ingesta-niveles">${NIVEL_ORDEN.map((n) => `
        <button class="nivel-tile" style="--n:var(--nivel-${n})" data-ing="${n}"><span class="nt-glifo">${NIVEL_GLIFO[n]}</span><span class="nt-num">${META.niveles[n].numero}</span>
          <b>${esc(INGESTA[n].titulo)}</b><small>${esc(INGESTA[n].ayuda)}</small></button>`).join('')}</div>
      <label class="soltar" id="soltar">
        <input type="file" id="ing-archivo" hidden>
        <b>⇪ Subir un archivo</b>
        <span>Respaldo o ficha de Deprocast 0.7 · CSV · texto · Markdown. Detecto el formato, lo parto en segmentos y elegís qué entra. Arrastralo acá.</span>
      </label>`)
    $$('[data-ing]').forEach((b) => (b.onclick = () => modalIngesta(b.dataset.ing)))
    const s = $('#soltar')
    $('#ing-archivo').onchange = (e) => e.target.files[0] && subirArchivo(e.target.files[0])
    s.ondragover = (e) => { e.preventDefault(); s.classList.add('encima') }
    s.ondragleave = () => s.classList.remove('encima')
    s.ondrop = (e) => { e.preventDefault(); s.classList.remove('encima'); const f = e.dataTransfer.files[0]; if (f) subirArchivo(f) }
    return
  }
  const fuenteDefecto = { propia: 'operador', primaria: E.fuentes.find((f) => f.nivel === 'primaria' && f.id !== 'web')?.id ?? 'operador', investigacion: E.fuentes.find((f) => f.nivel === 'investigacion')?.id ?? 'operador', generada: 'agentes' }[nivel]
  const proyectos = `<option value="">— ninguno —</option>${E.liga.proyectos.map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}`
  const campoFuente = `<label class="campo">Fuente<select id="i-fuente">${opcionesFuente(fuenteDefecto)}</select></label>`
  const comunes = `<label class="campo">Dominio<input id="i-dom" placeholder="huerta, derecho, cine…"></label><label class="campo">Proyecto<select id="i-proy">${proyectos}</select></label>`
  let cuerpo = ''
  if (nivel === 'propia') {
    cuerpo = `<div class="form-ing">
      <label class="campo campo-ancho">Título<input id="i-titulo" placeholder="Nota de voz, idea, borrador…"></label>
      <label class="campo campo-ancho">Contenido<textarea id="i-contenido" rows="9" placeholder="Pegá o escribí. Entra crudo y pasa por extractor → clasificador → vectorizador."></textarea></label>
      ${campoFuente}<label class="campo">Fecha<input id="i-fecha" type="date"></label>${comunes}</div>`
  } else if (nivel === 'primaria') {
    cuerpo = `<div class="pestanas" id="i-pest"><button class="on" data-p="url">≋ Traer una URL</button><button data-p="ref">❖ Referencia a una obra</button><button data-p="doc">▤ Documento</button></div>
      <div class="form-ing" data-panel="url"><label class="campo campo-ancho">URL<input id="i-url" placeholder="https://…"></label>${comunes}
        <p class="tenue campo-ancho">Se publica una misión para un crawler; lo que traiga entra como fuente primaria por la pipeline.</p></div>
      <div class="form-ing" data-panel="ref" hidden>
        <label class="campo campo-ancho">Título de la obra<input id="r-titulo" placeholder="Libro, paper, película, ley, repo…"></label>
        <label class="campo">Autor<input id="r-autor"></label><label class="campo">Año<input id="r-fecha" placeholder="1972"></label>
        <label class="campo">Clase<select id="r-clase">${['libro', 'paper', 'artículo', 'repositorio', 'película', 'serie', 'curso', 'ley', 'otro'].map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label class="campo">URL<input id="r-url" placeholder="opcional"></label>
        <label class="campo campo-ancho">Por qué importa<textarea id="r-notas" rows="4" placeholder="Qué tiene, para qué la querés."></textarea></label>
        ${campoFuente}${comunes}</div>
      <div class="form-ing" data-panel="doc" hidden>
        <label class="campo campo-ancho">Título<input id="d-titulo"></label><label class="campo">Autor<input id="d-autor"></label><label class="campo">URL<input id="d-url"></label>
        <label class="campo campo-ancho">Texto<textarea id="d-contenido" rows="8"></textarea></label>${campoFuente.replace('i-fuente', 'd-fuente')}${comunes.replace('i-dom', 'd-dom').replace('i-proy', 'd-proy')}</div>`
  } else if (nivel === 'investigacion') {
    cuerpo = `<div class="form-ing">
      <label class="campo campo-ancho">Título<input id="i-titulo" placeholder="Informe sobre…"></label>
      <label class="campo campo-ancho">Informe<textarea id="i-contenido" rows="9" placeholder="Pegá el informe, con sus citas si las tiene."></textarea></label>
      ${campoFuente}<label class="campo">Herramienta<input id="i-autor" placeholder="Perplexity, Grok, Gemini…"></label>${comunes}
      <p class="tenue campo-ancho">¿Es un repertorio en planilla? Subilo como CSV desde «⇪ Subir un archivo»: cada fila entra como referencia.</p></div>`
  } else {
    cuerpo = `<div class="form-ing">
      <p class="tenue campo-ancho">Los generativos de la liga ya escriben acá solos. Esto es para la salida de una IA externa que quieras sumar, marcada como generada.</p>
      <label class="campo campo-ancho">Título<input id="i-titulo"></label>
      <label class="campo campo-ancho">Contenido<textarea id="i-contenido" rows="9"></textarea></label>
      ${campoFuente}<label class="campo">Modelo o herramienta<input id="i-autor" placeholder="ChatGPT, Claude, Gemini…"></label>${comunes}</div>`
  }
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <div class="p-top"><a href="#" id="i-volver" class="tenue">← niveles</a>${nivelBadge(nivel)}</div>
    <h2 style="margin-top:8px">${esc(INGESTA[nivel].titulo)}</h2><p class="tenue">${esc(INGESTA[nivel].ayuda)}</p>
    ${cuerpo}
    <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="i-enviar">Ingerir</button></div>`)
  $('#i-volver').onclick = (e) => { e.preventDefault(); modalIngesta() }
  $$('#modal select[id$="fuente"]').forEach((s) => engancharFuente(s, () => nivel))
  let panel = 'url'
  $$('#i-pest button').forEach((b) => (b.onclick = () => {
    panel = b.dataset.p
    $$('#i-pest button').forEach((x) => x.classList.toggle('on', x === b))
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== panel))
  }))
  const v = (sel) => $(sel)?.value?.trim() ?? ''
  $('#i-enviar').onclick = async () => {
    try {
      if (nivel === 'primaria' && panel === 'url') {
        if (!v('#i-url')) throw new Error('Falta la URL')
        const t = await api('/tareas', { clase: 'crawler', texto: `Traer ${v('#i-url')}`, url: v('#i-url'), dominio: v('#i-dom'), proyectoId: v('#i-proy') })
        cerrarModal()
        toast(`Misión #${t.id} para un crawler<small>Dale Tick para que la traiga.</small>`, 'suave')
      } else {
        const b = nivel === 'primaria' && panel === 'ref'
          ? { tipo: 'referencia', titulo: v('#r-titulo'), autor: v('#r-autor'), fecha: v('#r-fecha'), url: v('#r-url'), contenido: [v('#r-notas'), `(${v('#r-clase')})`].filter(Boolean).join('\n'), fuente: v('#i-fuente'), dominio: v('#i-dom'), proyectoId: v('#i-proy') }
          : nivel === 'primaria'
            ? { titulo: v('#d-titulo'), autor: v('#d-autor'), url: v('#d-url'), contenido: v('#d-contenido'), fuente: v('#d-fuente'), dominio: v('#d-dom'), proyectoId: v('#d-proy') }
            : { titulo: v('#i-titulo'), contenido: v('#i-contenido'), autor: v('#i-autor'), fecha: v('#i-fecha'), fuente: v('#i-fuente'), dominio: v('#i-dom'), proyectoId: v('#i-proy') }
        if (b.fuente === '__nueva') throw new Error('Terminá de crear la fuente o elegí otra')
        const r = await api('/ingerir', { ...b, nivel })
        cerrarModal()
        toast(`Pieza ${r.corpusId} · ${esc(META.niveles[nivel].nombre)}<small>La pipeline arrancó: misión #${r.tarea.id} para un extractor.</small>`, 'suave')
      }
      await refrescar()
      if (vista === 'corpus') traerPiezas()
    } catch (e) { error(e) }
  }
}

function subirArchivo(archivo) {
  abrirModal(`<h2>Subiendo ${esc(archivo.name)}</h2><p class="tenue">${(archivo.size / 1024 / 1024).toFixed(1)} MB</p>
    <div class="xp" style="height:10px;--c:var(--oro)"><div id="sub-barra" style="width:0%"></div></div><p class="tenue" id="sub-txt">Enviando…</p>`)
  const x = new XMLHttpRequest()
  x.open('POST', `/api/cargas?nombre=${encodeURIComponent(archivo.name)}`)
  x.upload.onprogress = (e) => {
    if (!e.lengthComputable) return
    $('#sub-barra').style.width = `${(e.loaded / e.total) * 100}%`
    if (e.loaded === e.total) $('#sub-txt').textContent = 'Leyendo y segmentando…'
  }
  x.onload = async () => {
    const r = JSON.parse(x.responseText || '{}')
    if (x.status !== 200) { cerrarModal(); return error(new Error(r.error ?? `HTTP ${x.status}`)) }
    await refrescar()
    modalCarga(r.id)
  }
  x.onerror = () => { cerrarModal(); error(new Error('No se pudo subir el archivo')) }
  x.send(archivo)
}

async function modalCarga(id) {
  try {
    const c = await api(`/cargas/${id}`)
    const a = c.analisis
    if (c.estado !== 'analizada') {
      const r = c.resumen
      abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Carga #${c.id} · ${esc(a.titulo)}</h2>
        <p class="tenue">${esc(c.archivo)} · ${esc(c.estado)}${c.hechaEn ? ` el ${new Date(c.hechaEn).toLocaleString('es-AR')}` : ''}</p>
        ${r ? `<div class="resumen-carga">
          <div><strong>${r.piezas.toLocaleString('es-AR')}</strong><small>piezas</small></div><div><strong>${r.quantomos.toLocaleString('es-AR')}</strong><small>quántomos</small></div>
          <div><strong>${r.entidades.toLocaleString('es-AR')}</strong><small>entidades</small></div><div><strong>${r.repetidas.toLocaleString('es-AR')}</strong><small>ya estaban</small></div>
          <div><strong>${r.tareas.toLocaleString('es-AR')}</strong><small>misiones</small></div></div>
          <table class="log">${a.segmentos.filter((s) => r.porSegmento[s.id]).map((s) => `<tr><td>${s.nivel ? nivelBadge(s.nivel) : '→'}</td><td>${esc(s.nombre)}</td><td style="font:12px var(--mono)">${r.porSegmento[s.id]}</td></tr>`).join('')}</table>
          <p class="tenue">Pipeline: ${esc(r.pipeline)} · ${r.segundos} s</p>` : ''}
        <div class="fila" style="margin-top:14px">
          ${c.estado === 'hecha' ? `<button class="btn" id="cg-ver">Ver sus piezas</button><button class="btn" id="cg-reetiquetar" title="Vuelve a calcular entidades y etiquetas con el importador actual. No toca piezas ni quántomos.">Recalcular etiquetas</button><button class="btn btn-peligro" id="cg-deshacer">Deshacer la carga</button>` : ''}
        </div>`)
      const ver = $('#cg-ver')
      if (ver) ver.onclick = () => { cerrarModal(); Object.assign(filtroCorpus, { carga: c.id, nivel: '', fuente: '', tipo: '', q: '', desde: 0 }); if (vista !== 'corpus') irA('corpus'); else traerPiezas() }
      const ret = $('#cg-reetiquetar')
      if (ret) ret.onclick = async () => {
        ret.disabled = true
        ret.textContent = 'Recalculando…'
        try {
          const r = await api(`/cargas/${c.id}/reetiquetar`, {})
          toast(`Etiquetas recalculadas<small>${r.piezas.toLocaleString('es-AR')} piezas revisadas, ${r.cambiadas.toLocaleString('es-AR')} corregidas.</small>`, 'suave')
          await refrescar()
        } catch (e) { error(e) } finally { ret.disabled = false; ret.textContent = 'Recalcular etiquetas' }
      }
      const des = $('#cg-deshacer')
      if (des) des.onclick = async () => {
        if (!confirm(`¿Sacar del corpus todo lo que entró con la carga #${c.id}? Las piezas, quántomos y entidades de esta carga se borran.`)) return
        try { await api(`/cargas/${c.id}/deshacer`, {}); toast(`Carga #${c.id} deshecha`, 'suave'); cerrarModal(); await refrescar() } catch (e) { error(e) }
      }
      return
    }
    const existe = E.fuentes.some((f) => f.id === a.fuente.id)
    const opcFuente = (existe || !a.fuente.id ? '' : `<option value="${esc(a.fuente.id)}" selected>(nueva) ${esc(a.fuente.nombre)} · ${META.niveles[a.fuente.nivel].numero}</option>`) + opcionesFuente(existe ? a.fuente.id : '', { vacia: a.fuente.id ? '' : '— elegí una fuente —' })
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <div class="p-top"><span>Carga #${c.id}</span><span class="tipo-chip">${esc(c.importador)}</span><span>${esc(c.archivo)} · ${(c.bytes / 1024 / 1024).toFixed(1)} MB</span></div>
      <h2 style="margin-top:8px">${esc(a.titulo)}</h2><p class="tenue">${esc(a.descripcion)}</p>
      ${a.avisos.map((x) => `<div class="aviso">! ${esc(x)}</div>`).join('')}
      <h3 class="sub">Segmentos · elegí qué entra</h3>
      <div class="segmentos">${a.segmentos.map((s) => `
        <label class="segmento ${s.cantidad ? '' : 'vacio-seg'}"><input type="checkbox" value="${s.id}" ${s.porDefecto && s.cantidad ? 'checked' : ''} ${s.cantidad ? '' : 'disabled'}>
          <div><div class="seg-top"><b>${esc(s.nombre)}</b><span class="seg-n">${s.cantidad.toLocaleString('es-AR')}</span>${s.nivel ? nivelBadge(s.nivel) : `<span class="tipo-chip">→ ${s.destino}</span>`}</div>
          <small>${esc(s.descripcion)}</small>${s.nota ? `<small class="seg-nota">${esc(s.nota)}</small>` : ''}</div></label>`).join('')}</div>
      <div class="form-ing" style="margin-top:14px">
        <label class="campo">Fuente<select id="cg-fuente">${opcFuente}</select></label>
        ${a.nivelEditable ? `<label class="campo">Nivel de las piezas<select id="cg-nivel">${NIVEL_ORDEN.map((n) => `<option value="${n}" ${n === a.segmentos[0]?.nivel ? 'selected' : ''}>${META.niveles[n].numero} · ${esc(META.niveles[n].nombre)}</option>`).join('')}</select></label>` : ''}
        ${a.umbralPeso ? `<label class="campo">Peso mínimo de la criba: <b id="cg-umbral-v">${a.umbralPeso}</b><input type="range" id="cg-umbral" min="1" max="12" value="${a.umbralPeso}"></label>` : ''}
      </div>
      <h3 class="sub">¿Pasa por la pipeline?</h3>
      <div class="pipeline-op">
        <label><input type="radio" name="cg-pipe" value="ninguna" checked><b>No</b><small>Lo estructurado entra listo para buscar. Sin gastar tokens.</small></label>
        <label><input type="radio" name="cg-pipe" value="vectorizar"><b>Solo vectorizar</b><small id="cg-est-v"></small></label>
        <label><input type="radio" name="cg-pipe" value="completa"><b>Completa</b><small id="cg-est-c"></small></label>
      </div>
      <div class="fila" style="margin-top:16px"><button class="btn btn-primario" id="cg-ejecutar">Cargar</button><button class="btn" id="cg-descartar">Descartar</button></div>`)
    const estimar = () => {
      const n = a.segmentos.filter((s) => s.destino === 'corpus' && s.id !== 'enlaces' && $(`.segmentos input[value="${s.id}"]`)?.checked).reduce((t, s) => t + s.cantidad, 0)
      $('#cg-est-v').textContent = `≈ ${n.toLocaleString('es-AR')} llamadas de embedding (una por pieza).`
      $('#cg-est-c').textContent = `≈ ${(n * 3).toLocaleString('es-AR')} misiones: extractor, clasificador y vectorizador por pieza. Con NaN, tokens de verdad.`
    }
    $$('.segmentos input').forEach((i) => (i.onchange = estimar))
    estimar()
    engancharFuente($('#cg-fuente'), () => $('#cg-nivel')?.value ?? a.fuente.nivel)
    const u = $('#cg-umbral')
    if (u) u.oninput = () => ($('#cg-umbral-v').textContent = u.value)
    $('#cg-descartar').onclick = async () => { try { await api(`/cargas/${c.id}/descartar`, {}); cerrarModal(); await refrescar() } catch (e) { error(e) } }
    $('#cg-ejecutar').onclick = async () => {
      const boton = $('#cg-ejecutar')
      boton.disabled = true
      boton.textContent = 'Cargando…'
      try {
        await api(`/cargas/${c.id}/ejecutar`, {
          segmentos: $$('.segmentos input:checked').map((i) => i.value), fuenteId: $('#cg-fuente').value,
          nivel: $('#cg-nivel')?.value, umbralPeso: u?.value, pipeline: $('input[name="cg-pipe"]:checked').value,
        })
        await refrescar()
        modalCarga(c.id)
      } catch (e) { boton.disabled = false; boton.textContent = 'Cargar'; error(e) }
    }
  } catch (e) { error(e) }
}

// Quántomos

const filtroQ = { etapa: '', q: '', desde: 0 }
let qLista = { total: 0, quantomos: [] }

function pesoHTML(q) {
  const p = q.peso ?? 0
  const sellable = q.etapa === 'proto' || q.etapa === 'propuesta'
  return `<span class="peso12 ${sellable ? 'sellable' : ''}" title="${sellable ? 'Clic en un punto: sellar con ese peso' : `peso ${p}`}">${Array.from({ length: 12 }, (_, i) =>
    `<i class="${i < p ? 'on' : ''}" ${sellable ? `data-sellar="${q.id}" data-peso="${i + 1}"` : ''}></i>`).join('')}<b>${p || '—'}</b></span>`
}

function quantomoHTML(q) {
  const haiku = q.facetas?.find((f) => f.tipo === 'haiku' && f.cara) ?? q.facetas?.find((f) => f.tipo === 'haiku')
  return `<div class="quantomo ${q.etapa}" data-q="${q.id}">
    <div class="q-top"><span class="pill ${q.etapa === 'sellado' ? 'activo' : q.etapa === 'propuesta' ? 'prueba' : 'banca'}">${q.etapa}</span>
      ${q.version > 1 ? `<span class="tipo-chip">v${q.version}</span>` : ''}${q.universo ? `<span class="tipo-chip">${esc(q.universo)}</span>` : ''}
      ${q.l72 ? `<span class="tipo-chip" title="sello L72 de la 0.7.1">L72</span>` : ''}<span class="tenue">#${q.id}${q.procedencia ? ` · ${esc(q.procedencia.slice(0, 60))}` : ''}</span></div>
    <div class="q-texto">${esc(q.texto)}</div>
    ${haiku ? `<div class="q-haiku">${haiku.versos.map(esc).join(' / ')}</div>` : ''}
    <div class="q-acciones">${pesoHTML(q)}
      ${q.etapa === 'sellado' ? `<button class="btn btn-chico" data-mejorar="${q.id}">✦ Pedir mejora</button>` : ''}
      ${q.etapa === 'propuesta' ? `<button class="btn btn-chico btn-primario" data-aceptar="${q.id}">Aceptar</button>` : ''}
      ${q.etapa !== 'descartado' && q.etapa !== 'superado' ? `<button class="btn btn-chico" data-descartar="${q.id}">Descartar</button>` : ''}
      ${q.piezaId ? `<button class="btn btn-chico" data-ver-pieza="${q.piezaId}">pieza #${q.piezaId}</button>` : ''}
      <button class="btn btn-chico" data-linaje="${q.id}">linaje</button>
    </div></div>`
}

/** Botones de un listado de quántomos; `luego` re-pinta donde estén. */
function engancharQuantomos(raiz, luego) {
  const hacer = (f) => async (e) => {
    e.stopPropagation()
    try { await f(e.currentTarget); await refrescar(); luego() } catch (err) { error(err) }
  }
  $$('[data-sellar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => {
    const q = qLista.quantomos.find((x) => x.id === Number(el.dataset.sellar))
    const ruta = q?.etapa === 'propuesta' ? 'aceptar' : 'sellar'
    await api(`/quantomos/${el.dataset.sellar}/${ruta}`, { peso: Number(el.dataset.peso) })
    toast(`⚛ Quántomo #${el.dataset.sellar} sellado con peso ${el.dataset.peso}`, 'suave')
  })))
  $$('[data-aceptar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => { await api(`/quantomos/${el.dataset.aceptar}/aceptar`, {}); toast('Propuesta aceptada: la versión anterior queda en el linaje', 'suave') })))
  $$('[data-descartar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => api(`/quantomos/${el.dataset.descartar}/descartar`, {}))))
  $$('[data-mejorar]', raiz).forEach((b) => (b.onclick = hacer(async (el) => {
    const instruccion = prompt('¿Qué mejorar? (opcional: más corto, más preciso, sin jerga…)', '')
    if (instruccion === null) return
    const t = await api(`/quantomos/${el.dataset.mejorar}/mejora`, { instruccion })
    toast(`Misión #${t.id} para un generativo<small>Dale Tick: la versión nueva vuelve como propuesta.</small>`, 'suave')
  })))
  $$('[data-ver-pieza]', raiz).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); modalPieza(Number(b.dataset.verPieza)) }))
  $$('[data-linaje]', raiz).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); modalLinaje(Number(b.dataset.linaje)) }))
}

async function modalLinaje(id) {
  try {
    const { linaje, pieza } = await api(`/quantomos/${id}`)
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>⚛ Linaje del quántomo</h2>
      <p class="tenue">Nada se pisa: cada mejora es una versión nueva; la anterior queda como superada.</p>
      ${linaje.map((q) => `<div class="linaje-paso ${q.etapa}"><div class="q-top"><span class="tipo-chip">v${q.version}</span><span class="pill ${q.etapa === 'sellado' ? 'activo' : 'banca'}">${q.etapa}</span><span class="tenue">${esc(q.procedencia ?? '')} · ${new Date(q.actualizadoEn).toLocaleString('es-AR')}</span></div><div class="q-texto">${esc(q.texto)}</div></div>`).join('<div class="linaje-flecha">↓</div>')}
      ${pieza ? `<h3 class="sub">Sale de</h3>${piezaHTML(pieza)}` : ''}`)
  } catch (e) { error(e) }
}

function montarQuantomos() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Quántomos</h1><p>La unidad mínima: una afirmación atómica. Los extractores y las cargas proponen; vos sellás con un peso de 1 a 12. Los generativos proponen mejoras y vos decidís.</p></div>
    <div class="chips" id="q-chips"></div>
    <div class="corpus-barra"><input class="campo-suelto" id="q-q" placeholder="Buscar quántomos…" value="${esc(filtroQ.q)}"></div>
    <div id="q-cuenta" class="cuenta"></div><div id="q-lista" class="q-lista"></div><div id="q-mas"></div>`
  let espera
  $('#q-q').oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { filtroQ.q = e.target.value; filtroQ.desde = 0; traerQuantomos() }, 250) }
  refrescarQuantomos()
  traerQuantomos()
}

function refrescarQuantomos() {
  if (!$('#q-chips')) return
  const n = Object.fromEntries(E.quantomos.map((x) => [x.etapa, x.n]))
  const etapas = [['', 'Vigentes', (n.proto ?? 0) + (n.sellado ?? 0) + (n.propuesta ?? 0)], ['propuesta', 'Propuestas', n.propuesta ?? 0], ['proto', 'Proto', n.proto ?? 0], ['sellado', 'Sellados', n.sellado ?? 0], ['superado', 'Superados', n.superado ?? 0], ['descartado', 'Descartados', n.descartado ?? 0]]
  $('#q-chips').innerHTML = etapas.map(([k, t, c]) => `<button class="chip ${filtroQ.etapa === k ? 'on' : ''}" data-etapa="${k}">${t} ${c.toLocaleString('es-AR')}</button>`).join('')
  $$('[data-etapa]').forEach((b) => (b.onclick = () => { filtroQ.etapa = b.dataset.etapa; filtroQ.desde = 0; refrescarQuantomos(); traerQuantomos() }))
}

async function traerQuantomos(mas = false) {
  const p = new URLSearchParams({ limite: 40, desde: filtroQ.desde })
  if (filtroQ.etapa) p.set('etapa', filtroQ.etapa)
  if (filtroQ.q) p.set('q', filtroQ.q)
  try {
    const r = await api(`/quantomos?${p}`)
    qLista = mas ? { total: r.total, quantomos: [...qLista.quantomos, ...r.quantomos] } : r
    const cont = $('#q-lista')
    if (!cont) return
    $('#q-cuenta').textContent = `${qLista.total.toLocaleString('es-AR')} quántomo${qLista.total === 1 ? '' : 's'}`
    cont.innerHTML = qLista.quantomos.length ? qLista.quantomos.map(quantomoHTML).join('')
      : `<div class="vacio"><div class="gran">⚛</div><h2>Sin quántomos${filtroQ.etapa ? ' en esta etapa' : ''}</h2><p>Nacen cuando el extractor destila una pieza o cuando cargás un respaldo que los trae.</p></div>`
    engancharQuantomos(cont, () => traerQuantomos())
    $('#q-mas').innerHTML = qLista.quantomos.length < qLista.total ? `<button class="btn" id="q-mas-btn" style="width:100%">Ver más</button>` : ''
    const m = $('#q-mas-btn')
    if (m) m.onclick = () => { filtroQ.desde = qLista.quantomos.length; traerQuantomos(true) }
  } catch (e) { error(e) }
}


// Entidades

const TIPO_ENT = {
  persona: { glifo: '◐', nombre: 'Personas' }, proyecto: { glifo: '◆', nombre: 'Proyectos' }, agrupacion: { glifo: '⬡', nombre: 'Agrupaciones' },
  dominio: { glifo: '▦', nombre: 'Dominios' }, lugar: { glifo: '⌖', nombre: 'Lugares' }, concepto: { glifo: '✧', nombre: 'Conceptos' },
}
const filtroEnt = { tipo: '', q: '', sel: null }
let entTab = 'corpus'
let entLista = { total: 0, entidades: [] }

function montarEntidades() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Entidades</h1><p>Personas, proyectos, agrupaciones, dominios, lugares y conceptos que aparecen en el corpus, ordenados por cuántas piezas los mencionan.</p></div>
    <div class="chips" id="ent-tipos"></div>
    <div class="corpus-barra"><input class="campo-suelto" id="ent-q" placeholder="Buscar por nombre o alias…" value="${esc(filtroEnt.q)}"></div>
    <div class="ent-grid"><section><div id="ent-cuenta" class="cuenta"></div><div id="ent-lista"></div><div id="ent-mas"></div></section><aside class="ent-detalle" id="ent-detalle"></aside></div>`
  let espera
  $('#ent-q').oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { filtroEnt.q = e.target.value; traerEntidades() }, 250) }
  refrescarEntidades()
  traerEntidades()
  if (filtroEnt.sel) verEntidad(filtroEnt.sel)
  else $('#ent-detalle').innerHTML = ''
}

function refrescarEntidades() {
  const cont = $('#ent-tipos')
  if (!cont) return
  const n = Object.fromEntries(E.entidades.map((x) => [x.tipo, x.n]))
  const total = E.entidades.reduce((s, x) => s + x.n, 0)
  cont.innerHTML = `<button class="chip ${!filtroEnt.tipo ? 'on' : ''}" data-tipo-ent="">Todas ${total.toLocaleString('es-AR')}</button>` +
    Object.entries(TIPO_ENT).map(([k, t]) => `<button class="chip ${filtroEnt.tipo === k ? 'on' : ''}" data-tipo-ent="${k}">${t.glifo} ${t.nombre} ${(n[k] ?? 0).toLocaleString('es-AR')}</button>`).join('')
  $$('[data-tipo-ent]', cont).forEach((b) => (b.onclick = () => { filtroEnt.tipo = b.dataset.tipoEnt; refrescarEntidades(); traerEntidades() }))
}

async function traerEntidades(mas = false) {
  const p = new URLSearchParams({ limite: 60, desde: mas ? entLista.entidades.length : 0 })
  if (filtroEnt.tipo) p.set('tipo', filtroEnt.tipo)
  if (filtroEnt.q) p.set('q', filtroEnt.q)
  try {
    const r = await api(`/entidades?${p}`)
    entLista = mas ? { total: r.total, entidades: [...entLista.entidades, ...r.entidades] } : r
    const cont = $('#ent-lista')
    if (!cont) return
    $('#ent-cuenta').textContent = `${entLista.total.toLocaleString('es-AR')} entidad${entLista.total === 1 ? '' : 'es'}`
    cont.innerHTML = entLista.entidades.length ? `<div class="ent-lista">${entLista.entidades.map((e) => `
      <div class="ent-fila ${filtroEnt.sel === e.id ? 'sel' : ''}" data-ent="${e.id}"><i>${TIPO_ENT[e.tipo]?.glifo ?? '·'}</i>
        <div><b>${esc(e.nombre)}</b>${e.alias.length ? `<small>${esc(e.alias.slice(0, 4).join(' · '))}</small>` : ''}</div><em>${e.piezas}</em></div>`).join('')}</div>`
      : `<div class="vacio"><div class="gran">⚇</div><h2>Sin entidades${filtroEnt.tipo || filtroEnt.q ? ' con este filtro' : ''}</h2><p>Entran con las cargas: un respaldo de Deprocast trae personas, proyectos, agrupaciones, dominios y lugares.</p></div>`
    $$('[data-ent]', cont).forEach((el) => (el.onclick = () => verEntidad(Number(el.dataset.ent))))
    $('#ent-mas').innerHTML = entLista.entidades.length < entLista.total ? `<button class="btn" id="ent-mas-btn" style="width:100%;margin-top:8px">Ver más</button>` : ''
    const m = $('#ent-mas-btn')
    if (m) m.onclick = () => traerEntidades(true)
  } catch (e) { error(e) }
}

async function verEntidad(id) {
  filtroEnt.sel = id
  $$('.ent-fila').forEach((el) => el.classList.toggle('sel', Number(el.dataset.ent) === id))
  try {
    const { entidad: e, coocurrencias, total, piezas } = await api(`/entidades/${id}`)
    const det = $('#ent-detalle')
    if (!det) return
    const meta = e.meta ? Object.entries(e.meta).filter(([k, v]) => v != null && typeof v !== 'object' && k !== 'operador') : []
    det.innerHTML = `<div class="panel">
      <div class="p-top"><span class="tipo-chip">${TIPO_ENT[e.tipo]?.glifo ?? ''} ${esc(e.tipo)}</span>${e.meta?.operador ? '<span class="nivel-badge">vos · el jugador</span>' : ''}${meta.map(([k, v]) => `<span class="tipo-chip">${esc(k)}: ${esc(v)}</span>`).join('')}</div>
      <h2>${esc(e.nombre)}</h2>
      ${e.alias.length ? `<div class="tags">${e.alias.map((a) => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
      ${e.notas ? `<div class="notas">${esc(e.notas)}</div>` : ''}
      <div class="fila" style="margin:12px 0 4px"><button class="btn btn-chico btn-primario" id="ent-preguntar">☿ Preguntarle a Mastropiero</button>
        ${e.meta?.operador ? '<button class="btn btn-chico" id="ent-ficha-jugador">Tu ficha de jugador</button>' : e.tipo === 'persona' ? '<button class="btn btn-chico" id="ent-soy-yo" title="Marcar esta persona como vos: tu ficha de jugador y la suya pasan a ser una">Soy yo</button>' : ''}</div>
      <div class="tabs chicas" id="ent-tabs">${[['corpus', 'Corpus'], ['misiones', 'Misiones'], ['historia', 'Historia'], ['inventario', 'Inventario']].map(([k, n]) => `<button data-etab="${k}" class="${k === entTab ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div id="ent-ficha"></div>
      <div id="ent-corpus" ${entTab === 'corpus' ? '' : 'hidden'}>
      ${coocurrencias.length ? `<h3 class="sub">Aparece con</h3><div class="coocurre">${coocurrencias.map((x) => `<button data-co="${x.id}">${TIPO_ENT[x.tipo]?.glifo ?? ''} ${esc(x.nombre)}<em>${x.compartidas}</em></button>`).join('')}</div>` : ''}
      <h3 class="sub">Piezas que la mencionan · ${total.toLocaleString('es-AR')}</h3>
      ${piezas.length ? piezas.map(piezaHTML).join('') : '<p class="tenue">Ninguna pieza la menciona todavía.</p>'}
      ${total > piezas.length ? `<p class="tenue">Mostrando ${piezas.length}. En Corpus podés buscarla por nombre.</p>` : ''}
      </div>
    </div>`
    const pintarTab = () => {
      $$('#ent-tabs [data-etab]').forEach((b) => b.classList.toggle('on', b.dataset.etab === entTab))
      $('#ent-corpus').hidden = entTab !== 'corpus'
      if (entTab === 'corpus') $('#ent-ficha').innerHTML = ''
      else fichaPersonaje($('#ent-ficha'), `entidad:${e.id}`, { tabs: [entTab] })
    }
    $$('#ent-tabs [data-etab]').forEach((b) => (b.onclick = () => { entTab = b.dataset.etab; pintarTab() }))
    pintarTab()
    const soy = $('#ent-soy-yo')
    if (soy) soy.onclick = async () => {
      if (!confirm(`¿${e.nombre} sos vos? Su ficha y la tuya de jugador pasan a ser una sola.`)) return
      try { await api(`/entidades/${e.id}/soy-yo`, {}); toast(`Listo: ${esc(e.nombre)} sos vos`, 'suave'); await refrescar(); verEntidad(e.id) } catch (err) { error(err) }
    }
    const fj = $('#ent-ficha-jugador')
    if (fj) fj.onclick = () => irA('jugador')
    $('#ent-preguntar').onclick = () => preguntarAMastropiero(`Contame sobre ${e.nombre} (entidad #${e.id}): qué es, con qué aparece y qué dice el corpus.`)
    $$('[data-co]', det).forEach((b) => (b.onclick = () => verEntidad(Number(b.dataset.co))))
  } catch (err) { error(err) }
}
