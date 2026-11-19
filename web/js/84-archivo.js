'use strict'
// Hoy → Archivo (Fragua #320): todo lo que Deprocast generó en un solo lugar. Los PDF y presentaciones del chat, las
// obras del Taller, los informes de los programados, los aportes de los ayudantes y las guías de los cuadernos, con
// búsqueda, filtros, vista previa sin bajar nada, y bajar, abrir en Drive o mandarlo de nuevo a su WhatsApp.

const ar = { q: '', tipo: '', origen: '', entidad: '', desde: '', hasta: '', datos: null, items: [], saltar: 0 }
const AR_TIPOS = {
  pdf: ['PDF', '📄'], presentacion: ['Presentación', '📊'], imagen: ['Imagen', '🖼'], audio: ['Audio', '🎧'], video: ['Video', '🎬'],
  informe: ['Informe', '⏰'], planilla: ['Planilla', '▦'], documento: ['Documento', '📝'], cuaderno: ['Cuaderno', '📓'], aporte: ['Aporte', '✦'],
  juego: ['Juego', '🎮'], pagina: ['Página', '◧'],
}
const AR_ORIGENES = { chat: 'Del chat', taller: 'Del Taller', programado: 'De un programado', ayudante: 'De un ayudante', cuaderno: 'De un cuaderno' }
const AR_PAGINA = 60

async function montarArchivo() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Archivo</h1><p>Todo lo que se generó, en un solo lugar: lo que pediste por el chat, lo del Taller, los informes de los programados y los aportes. Se ve acá sin bajarlo.</p></div></div>
    <div class="ar-barra">
      <input class="campo-suelto ar-q" id="ar-q" type="search" placeholder="Buscar en títulos y en lo que dicen…" value="${esc(ar.q)}">
      <select class="campo-suelto" id="ar-origen" title="De dónde salió"><option value="">De todos lados</option>${Object.entries(AR_ORIGENES).map(([k, n]) => `<option value="${k}" ${ar.origen === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select class="campo-suelto" id="ar-entidad" title="Proyecto"><option value="">Todos los proyectos</option></select>
      <label class="ar-fecha">Desde <input class="campo-suelto" type="date" id="ar-desde" value="${esc(ar.desde)}"></label>
      <label class="ar-fecha">Hasta <input class="campo-suelto" type="date" id="ar-hasta" value="${esc(ar.hasta)}"></label>
    </div>
    <div class="chips" id="ar-tipos"></div>
    <p class="tenue chico" id="ar-cuenta"></p>
    <div class="ar-grilla" id="ar-lista"><p class="tenue">Buscando…</p></div>
    <div class="ar-mas" id="ar-mas"></div>`
  let t
  $('#ar-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ar.q = e.target.value; traerArchivo() }, 250) }
  for (const [id, k] of [['ar-origen', 'origen'], ['ar-entidad', 'entidad'], ['ar-desde', 'desde'], ['ar-hasta', 'hasta']]) $(`#${id}`).onchange = (e) => { ar[k] = e.target.value; traerArchivo() }
  await traerArchivo()
}

async function traerArchivo(mas = false) {
  const p = new URLSearchParams()
  for (const k of ['q', 'tipo', 'origen', 'entidad', 'desde', 'hasta']) if (ar[k]) p.set(k, ar[k])
  ar.saltar = mas ? ar.saltar + AR_PAGINA : 0
  p.set('limite', AR_PAGINA)
  if (ar.saltar) p.set('saltar', ar.saltar)
  let d
  try { d = await api(`/archivo?${p}`) } catch (e) { return error(e) }
  if (vista !== 'archivo' || !$('#ar-lista')) return
  ar.datos = d
  ar.items = mas ? [...ar.items, ...d.items] : d.items
  pintarArchivo()
}

function pintarArchivo() {
  const d = ar.datos
  const total = Object.values(d.tipos).reduce((s, n) => s + n, 0)
  $('#ar-tipos').innerHTML = [['', 'Todo', total], ...Object.entries(AR_TIPOS).filter(([k]) => d.tipos[k] || ar.tipo === k).map(([k, [n, g]]) => [k, `${g} ${n}`, d.tipos[k] ?? 0])]
    .map(([k, n, c]) => `<button class="chip ${ar.tipo === k ? 'on' : ''}" data-ar-tipo="${k}">${esc(n)} <span class="tenue">${c}</span></button>`).join('')
  $$('[data-ar-tipo]').forEach((b) => (b.onclick = () => { ar.tipo = b.dataset.arTipo; traerArchivo() }))
  const sel = $('#ar-entidad')
  const proyectos = d.proyectos.some((x) => String(x.id) === ar.entidad) || !ar.entidad ? d.proyectos : [...d.proyectos, { id: ar.entidad, nombre: 'El elegido', n: 0 }]
  sel.innerHTML = `<option value="">Todos los proyectos</option>${proyectos.map((x) => `<option value="${x.id}" ${String(x.id) === ar.entidad ? 'selected' : ''}>${esc(x.nombre)} (${x.n})</option>`).join('')}`
  $('#ar-cuenta').textContent = d.total ? `${d.total} ${d.total === 1 ? 'cosa' : 'cosas'}${ar.q || ar.tipo || ar.origen || ar.entidad || ar.desde || ar.hasta ? ' con estos filtros' : ''}` : ''
  $('#ar-lista').innerHTML = ar.items.length ? ar.items.map(tarjetaArchivo).join('') : `<p class="tenue">${total ? 'Nada con estos filtros.' : 'Todavía no se generó nada. Lo que pidas por el chat (un PDF, una presentación), lo del Taller y los informes de los programados van a aparecer acá solos.'}</p>`
  $('#ar-mas').innerHTML = ar.items.length < d.total ? `<button class="btn" id="ar-ver-mas">Ver más (${d.total - ar.items.length})</button>` : ''
  if ($('#ar-ver-mas')) $('#ar-ver-mas').onclick = () => traerArchivo(true)
  $$('[data-ar-ver]').forEach((b) => (b.onclick = () => verArchivo(Number(b.dataset.arVer))))
  $$('[data-ar-mandar]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); mandarArchivo(Number(b.dataset.arMandar), b) }))
}

/** Bajar: el archivo tal cual; lo que es texto, como .md. */
const bajarDe = (g) => (g.url ? g.url : `/api/archivo/${g.id}/md`)
const nombreBajar = (g) => (g.url ? g.nombre ?? '' : '')
const fechaArchivo = (ms) => new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' })

function tarjetaArchivo(g) {
  const [nombre, glifo] = AR_TIPOS[g.tipo] ?? [g.tipo, '·']
  const mandable = g.tipo !== 'juego' && g.tipo !== 'pagina'
  return `<article class="ar-tarjeta" data-tipo="${esc(g.tipo)}">
    <button class="ar-mini" data-ar-ver="${g.id}" title="Ver">${g.miniatura ? `<img loading="lazy" alt="" src="${esc(g.miniatura)}">` : `<span class="ar-glifo">${glifo}</span>`}</button>
    <div class="ar-cuerpo">
      <div class="ar-cab"><span class="tipo-chip">${esc(nombre)}</span><span class="tenue chico" title="${esc(new Date(g.creadoEn).toLocaleString('es-AR'))}">${esc(fechaArchivo(g.creadoEn))}</span></div>
      <h4 data-ar-ver="${g.id}" title="${esc(g.titulo)}">${esc(g.titulo)}</h4>
      ${g.resumen ? `<p class="ar-resumen">${esc(g.resumen)}</p>` : ''}
      <p class="ar-origen tenue chico">${esc(AR_ORIGENES[g.origen] ?? g.origen)}${g.origenTexto && g.origen !== 'chat' ? ` · ${esc(g.origenTexto.replace(/\s+/g, ' ').slice(0, 90))}` : ''}${g.entidad ? ` · <b>${esc(g.entidad)}</b>` : ''}${g.canal ? ` · salió por ${esc(g.canal)}` : ''}</p>
      <div class="ar-acc">
        <button class="btn btn-chico" data-ar-ver="${g.id}">Ver</button>
        <a class="btn btn-chico" href="${esc(bajarDe(g))}" download="${esc(nombreBajar(g))}">Bajar</a>
        ${g.drive ? `<a class="btn btn-chico" href="${esc(g.drive)}" target="_blank" rel="noopener">Drive</a>` : ''}
        ${mandable ? `<button class="btn btn-chico" data-ar-mandar="${g.id}" title="Mandarlo de nuevo a tu WhatsApp">Mandar</button>` : ''}
      </div>
    </div>
  </article>`
}

/** La vista previa, sin bajar nada: la imagen, el audio o el video ahí; el juego corriendo; lo demás, su texto. */
async function verArchivo(id) {
  let g
  try { g = await api(`/archivo/${id}`) } catch (e) { return error(e) }
  const [nombre] = AR_TIPOS[g.tipo] ?? [g.tipo]
  const texto = g.texto ? `<div class="ar-texto md">${md(g.texto)}</div>` : ''
  const vistaPrevia =
    g.tipo === 'imagen' && g.url ? `<img class="ar-previa" alt="" src="${esc(g.url)}">`
      : g.tipo === 'audio' && g.url ? `<audio class="ar-previa" controls preload="metadata" src="${esc(g.url)}"></audio>`
        : g.tipo === 'video' && g.url && /\.(mp4|webm|mov)$/i.test(g.url) ? `<video class="ar-previa" controls preload="metadata" src="${esc(g.url)}"></video>`
          : (g.tipo === 'juego' || g.tipo === 'pagina' || g.tipo === 'video') && g.url ? `<iframe class="ar-marco" sandbox="allow-scripts allow-pointer-lock" src="${esc(g.url)}"></iframe>`
            : texto || `<p class="tenue">Este no tiene vista previa${g.url ? ': bajalo para abrirlo.' : '.'}</p>`
  const mandable = g.tipo !== 'juego' && g.tipo !== 'pagina'
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <div class="ar-detalle">
      <small class="mis-etq">${esc(nombre)} · ${esc(new Date(g.creadoEn).toLocaleString('es-AR'))}${g.entidad ? ` · ${esc(g.entidad)}` : ''}</small>
      <h2>${esc(g.titulo)}</h2>
      ${g.origenTexto ? `<p class="tenue chico">${esc(AR_ORIGENES[g.origen] ?? g.origen)}: ${esc(g.origenTexto.slice(0, 400))}</p>` : ''}
      ${vistaPrevia}
      ${(g.tipo === 'pdf' || g.tipo === 'presentacion') && g.texto ? `<p class="tenue chico">${g.tipo === 'pdf' ? 'El texto del PDF' : 'El guion de la presentación'}; el archivo, con «Bajar».</p>` : ''}
      <div class="ar-acc">
        <a class="btn" href="${esc(bajarDe(g))}" download="${esc(nombreBajar(g))}">Bajar</a>
        ${g.url && g.tipo === 'pdf' ? `<a class="btn" href="${esc(g.url)}" target="_blank" rel="noopener">Abrir el PDF</a>` : ''}
        ${g.drive ? `<a class="btn" href="${esc(g.drive)}" target="_blank" rel="noopener">Abrir en Drive</a>` : ''}
        ${mandable ? `<button class="btn" id="ar-det-mandar">Mandar a WhatsApp</button>` : ''}
      </div>
    </div>`)
  if ($('#ar-det-mandar')) $('#ar-det-mandar').onclick = (e) => mandarArchivo(g.id, e.target)
}

async function mandarArchivo(id, boton) {
  if (boton) boton.disabled = true
  try {
    const r = await api(`/archivo/${id}/reenviar`, {})
    toast(`Mandado por ${esc(r.canal)}`, 'suave')
    const g = ar.items.find((x) => x.id === id)
    if (g) { g.canal = r.canal; if (vista === 'archivo' && $('#ar-lista')) pintarArchivo() }
  } catch (e) { error(e) } finally { if (boton) boton.disabled = false }
}
