'use strict'
// El diario propio (Fragua #166): las notas de prensa que trajo (páginas filmadas o fotografiadas, recortes pegados),
// traducidas con el original al lado, por tema. Marca qué importa y qué no (i / n); lo descartado queda guardado pero
// fuera de la vista, y su criterio se aprende para ordenarle lo nuevo. También sube videos (Fragua #165).

const prensa = { dia: null, activa: null, verDescartadas: false, datos: null }

async function montarPrensa() {
  $('#principal').innerHTML = `<div class="prensa">
    <div class="titulo"><h1>Diario</h1><p>La prensa que traés (fotos o videos de páginas, recortes), partida en notas y traducida con el original al lado. Marcá qué te importa: aprendo tu criterio y te ordeno lo nuevo. Mandá un video por WhatsApp con la palabra «diario» y entra solo.</p>
      <div class="fila"><label class="btn">🎬 Subir un video<input type="file" id="pr-video" accept="video/*" hidden></label><button class="btn" id="pr-pegar">Pegar texto de prensa</button><span class="tenue chico" id="pr-cola"></span></div></div>
    <div class="prensa-cuerpo"><nav class="prensa-dias" id="pr-dias"></nav><section id="pr-notas" class="prensa-notas"><p class="tenue">Cargando…</p></section><aside id="pr-criterio" class="prensa-criterio"></aside></div>
  </div>`
  $('#pr-video').onchange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const modo = await confirmar(`¿«${f.name}» son páginas de un diario?`, { si: 'Sí, al diario', no: 'No, es otro video', detalle: 'Si son páginas, las leo una por una y las traduzco. Si no, el video entra al corpus como fuente (lo dicho y lo que se ve).' }) ? 'prensa' : 'fuente'
    try {
      const r = await fetch(`/api/videos?nombre=${encodeURIComponent(f.name)}&modo=${modo}`, { method: 'POST', body: f }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
      toast(`🎬 En la cola${r.antes ? ` (hay ${r.antes} antes)` : ''}<small>Te aviso en Hoy cuando esté.</small>`, 'suave')
      colaPrensa()
    } catch (err) { error(err) }
  }
  $('#pr-pegar').onclick = async () => {
    const t = await preguntar('Pegá el texto de la nota o de la página (en el idioma que esté):', '', { largo: true, ok: 'Al diario' })
    if (!t?.trim()) return
    try { const ns = await api('/prensa', { texto: t }); toast(`${ns.length} nota${ns.length === 1 ? '' : 's'} al diario`, 'suave'); prensa.dia = ns[0]?.fecha ?? prensa.dia; pintarPrensa() } catch (e) { error(e) }
  }
  colaPrensa()
  pintarPrensa()
}

async function colaPrensa() {
  try {
    const vs = await api('/videos')
    const enCola = vs.filter((v) => v.estado === 'pendiente' || v.estado === 'procesando')
    const c = $('#pr-cola')
    if (c) c.textContent = enCola.length ? `${enCola.length} video${enCola.length === 1 ? '' : 's'} procesándose…` : ''
    if (enCola.length && vista === 'prensa') setTimeout(colaPrensa, 8000)
  } catch { /* la cola no es imprescindible */ }
}

async function pintarPrensa() {
  let d
  try { d = await api(`/prensa${prensa.dia ? `?fecha=${prensa.dia}` : ''}`) } catch (e) { return error(e) }
  prensa.datos = d
  prensa.dia = d.dia
  $('#pr-dias').innerHTML = d.dias.length ? d.dias.map((x) => `<button class="${x.fecha === d.dia ? 'on' : ''}" data-dia="${x.fecha}">${new Date(`${x.fecha}T12:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}<small>${x.n}${x.pendientes ? ` · ${x.pendientes} sin marcar` : ''}</small></button>`).join('') : ''
  $$('#pr-dias [data-dia]').forEach((b) => (b.onclick = () => { prensa.dia = b.dataset.dia; prensa.activa = null; pintarPrensa() }))
  const nota = (n) => `<article class="prensa-nota${n.voto === 1 ? ' importa' : n.voto === 0 ? ' descartada' : ''}" data-nota="${n.id}" tabindex="-1">
      <header><h3>${esc(n.titular)}</h3><span class="tenue chico">${n.territorio ? `${esc(n.territorio)} · ` : ''}${esc(n.idioma)}${n.voto == null && n.sugerido != null ? ` · ${n.sugerido >= 0.6 ? 'probablemente te importa' : n.sugerido <= 0.4 ? 'probablemente no' : 'sin criterio todavía'}` : ''}</span></header>
      <div class="prensa-textos"><div><small class="tenue">Castellano</small><p>${esc(n.traduccion)}</p></div>${n.idioma !== 'castellano' ? `<div class="prensa-original"><small class="tenue">Original</small><p>${esc(n.original)}</p></div>` : ''}</div>
      <footer class="fila"><button class="btn btn-chico${n.voto === 1 ? ' btn-primario' : ''}" data-voto="1">Importa <kbd>i</kbd></button><button class="btn btn-chico" data-voto="0">No <kbd>n</kbd></button>${n.voto != null ? '<button class="btn btn-chico" data-voto="">Desmarcar</button>' : ''}${n.piezaId ? `<button class="btn-link" data-pieza="${n.piezaId}">pieza #${n.piezaId}</button>` : ''}</footer>
    </article>`
  $('#pr-notas').innerHTML = !d.dia
    ? '<div class="vacio tarjeta"><h3>Todavía no hay prensa</h3><p class="tenue">Subí un video de las páginas, mandalo por WhatsApp con «diario», o pegá el texto.</p></div>'
    : `${d.temas.map((t) => `<h2 class="sub">${esc(t.tema)} <small class="tenue">${t.notas.length}</small></h2>${t.notas.map(nota).join('')}`).join('') || '<p class="tenue">Todo lo de este día lo descartaste.</p>'}
       ${d.descartadas.length ? `<details class="prensa-descartadas"${prensa.verDescartadas ? ' open' : ''}><summary>Descartadas (${d.descartadas.length})</summary>${d.descartadas.map(nota).join('')}</details>` : ''}`
  $('#pr-notas details')?.addEventListener('toggle', (e) => { prensa.verDescartadas = e.target.open })
  $$('#pr-notas [data-voto]').forEach((b) => (b.onclick = () => votarPrensa(Number(b.closest('[data-nota]').dataset.nota), b.dataset.voto === '' ? null : Number(b.dataset.voto))))
  $$('#pr-notas [data-pieza]').forEach((b) => (b.onclick = () => modalPieza(Number(b.dataset.pieza))))
  $$('#pr-notas [data-nota]').forEach((a) => a.addEventListener('click', (e) => { if (!e.target.closest('button')) activarNota(Number(a.dataset.nota)) }))
  const c = d.criterio
  $('#pr-criterio').innerHTML = `<div class="tarjeta"><h3 class="sub">Tu criterio</h3>${c.votos ? `<p class="tenue chico">De ${c.votos} nota${c.votos === 1 ? '' : 's'} marcada${c.votos === 1 ? '' : 's'}.</p>
    ${[['Temas', c.temas], ['Territorios', c.territorios]].map(([n, xs]) => xs.length ? `<h4>${n}</h4><ul class="prensa-tasas">${xs.slice(0, 8).map((x) => `<li><span>${esc(x.k)}</span><i data-ancho="${Math.round(x.tasa * 100)}"></i><small>${Math.round(x.tasa * 100)} %</small></li>`).join('')}</ul>` : '').join('')}` : '<p class="tenue chico">Marcá algunas notas y acá aparece qué te importa (por tema y por territorio). Con eso ordeno lo nuevo.</p>'}
    <p class="tenue chico">Teclas: <kbd>j</kbd> <kbd>k</kbd> moverse · <kbd>i</kbd> importa · <kbd>n</kbd> no</p></div>`
  $$('#pr-criterio [data-ancho]').forEach((x) => (x.style.width = `${x.dataset.ancho}%`))
  activarNota(prensa.activa ?? siguientePendiente())
}

const notasVisibles = () => $$('#pr-notas > article[data-nota]').map((a) => Number(a.dataset.nota))
const siguientePendiente = (desde = null) => {
  const ns = [...(prensa.datos?.temas ?? []).flatMap((t) => t.notas)]
  const orden = notasVisibles()
  const i = desde == null ? -1 : orden.indexOf(desde)
  return [...orden.slice(i + 1), ...orden.slice(0, i + 1)].find((id) => ns.find((n) => n.id === id)?.voto == null) ?? orden[0] ?? null
}

function activarNota(id) {
  prensa.activa = id
  $$('#pr-notas [data-nota]').forEach((a) => a.classList.toggle('activa', Number(a.dataset.nota) === id))
  $(`#pr-notas [data-nota="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

async function votarPrensa(id, voto) {
  try {
    await api(`/prensa/${id}/voto`, { voto })
    prensa.activa = voto == null ? id : siguientePendiente(id)
    pintarPrensa()
  } catch (e) { error(e) }
}

document.addEventListener('keydown', (e) => {
  if (vista !== 'prensa' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || !$('#velo').hidden || document.querySelector('.dialogo-velo')) return
  const orden = notasVisibles()
  if (!orden.length) return
  const i = orden.indexOf(prensa.activa)
  let hecho = true
  if (e.key === 'j' || e.key === 'ArrowDown') activarNota(orden[Math.min(orden.length - 1, i + 1)])
  else if (e.key === 'k' || e.key === 'ArrowUp') activarNota(orden[Math.max(0, i - 1)])
  else if (e.key === 'i' && prensa.activa) votarPrensa(prensa.activa, 1)
  else if (e.key === 'n' && prensa.activa) votarPrensa(prensa.activa, 0)
  else hecho = false
  if (hecho) { e.preventDefault(); e.stopPropagation() }
}, true)
