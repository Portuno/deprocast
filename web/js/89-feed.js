'use strict'
// Tu feed, con tope (plan v38, fase 5): lo mejor de tus cuentas de X, subreddits y canales de YouTube, con una cantidad
// fija por día. Cuando llegás al tope, se terminó: sin scroll infinito. Lo puntuás del 1 al 6 mientras lo leés (teclas 1 a 6;
// i / n siguen valiendo 5 / 2), con categoría y razón si querés (Fragua #253), y aprendo qué fuentes te sirven. Al costado,
// el ranking de tus cuentas por puntaje, esta semana contra la anterior, y las que conviene silenciar.

const NOMBRE_PLAT = { x: 'X', youtube: 'YouTube', reddit: 'Reddit' }
const feed = { datos: null, activa: null }

async function montarFeed() {
  $('#principal').innerHTML = `<div class="feed">
    <div class="titulo"><h1>Feed</h1><p>Lo mejor de tus redes, con una cantidad fija por día. Cuando llegás al tope, se terminó. Marcá qué te importa: aprendo qué fuentes te sirven y te ordeno lo que viene. Lo de tus cuentas de X entra además a tu corpus.</p></div>
    <div class="feed-cuerpo"><section id="feed-dias"><p class="tenue">Cargando…</p></section><aside class="tarjeta feed-fuentes" id="feed-fuentes"></aside></div>
  </div>`
  pintarFeed()
}

async function pintarFeed() {
  try { feed.datos = await api('/feed') } catch (e) { return error(e) }
  const { dias, fuentes, topes } = feed.datos
  const item = (i) => `<article class="feed-item${i.voto === 1 ? ' si' : i.voto === 0 ? ' no' : ''}" data-item="${i.id}">
      <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.titulo)}</a>${i.texto && i.texto !== i.titulo ? `<p>${esc(i.texto)}</p>` : ''}
      <small class="tenue">${esc(i.autor ?? '')}${i.fecha ? ` · ${esc(i.fecha)}` : ''}</small>
      ${i.voto == null ? `<div class="fila feed-puntaje" role="group" aria-label="Puntaje del 1 al 6">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="btn btn-chico" data-p="${n}" title="${n} de 6">${n}</button>`).join('')}</div>` : `<small class="tenue">${i.puntaje ? `${i.puntaje}/6` : i.voto === 1 ? 'importa' : 'no'}${i.categoria ? ` · #${esc(i.categoria)}` : ''}${i.razon ? ` · ${esc(i.razon)}` : ''}</small>${i.puntaje && !i.razon ? `<form class="fila feed-razon" data-razon="${i.id}"><input class="campo-suelto f1" name="categoria" placeholder="#categoría" aria-label="Categoría"><input class="campo-suelto f1" name="razon" placeholder="por qué (opcional)" aria-label="Por qué"><button class="btn btn-chico">Anotar</button></form>` : ''}`}
    </article>`
  $('#feed-dias').innerHTML = !fuentes.some((f) => f.activa)
    ? '<div class="vacio tarjeta"><h3>Todavía no seguís nada</h3><p class="tenue">Sumá una cuenta de X, un subreddit o un canal de YouTube (a la derecha), o pedíselo al chat.</p></div>'
    : dias.filter((d) => d.items.length || fuentes.some((f) => f.activa && f.plataforma === d.plataforma)).map((d) => `<section class="feed-plat"><h2>${NOMBRE_PLAT[d.plataforma]} <small class="tenue">${d.vistos} de ${d.tope} hoy</small></h2>
        ${d.items.map(item).join('')}
        ${d.terminado ? '<p class="tenue feed-fin">Se terminó por hoy. Mañana hay más.</p>' : !d.items.length ? '<p class="tenue chico">Nada nuevo por ahora.</p>' : ''}
      </section>`).join('')
  $$('#feed-dias [data-p]').forEach((b) => (b.onclick = () => puntuarFeed(Number(b.closest('[data-item]').dataset.item), Number(b.dataset.p))))
  $$('#feed-dias [data-razon]').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault()
    const it = Number(f.dataset.razon)
    const x = feed.datos.dias.flatMap((d) => d.items).find((i) => i.id === it)
    try { await api(`/feed/${it}/puntaje`, { puntaje: x?.puntaje ?? 4, categoria: f.categoria.value.replace(/^#/, '') || null, razon: f.razon.value || null }); pintarFeed() } catch (err) { error(err) }
  }))
  $$('#feed-dias [data-item]').forEach((a) => a.addEventListener('click', (e) => { if (!e.target.closest('a, button')) activarFeed(Number(a.dataset.item)) }))
  $('#feed-fuentes').innerHTML = `<h3 class="sub">Lo que seguís</h3>
    <form class="fila" id="feed-sumar"><input class="campo-suelto f1" name="texto" placeholder="@cuenta · r/subreddit · link del canal" autocomplete="off"><button class="btn btn-chico">Sumar</button></form>
    <ul>${fuentes.filter((f) => f.activa).map((f) => `<li><span>${esc(NOMBRE_PLAT[f.plataforma])} · ${esc(f.nombre)}${f.error ? ` <small class="tenue" title="${esc(f.error)}">⚠</small>` : ''}</span><button class="btn-link" data-quitar="${f.id}">quitar</button></li>`).join('') || '<li class="tenue">Nada todavía.</li>'}</ul>
    <h3 class="sub">Tope por día</h3>
    ${Object.entries(topes).map(([p, n]) => `<label class="fila g-2 chico">${NOMBRE_PLAT[p]} <input type="number" min="1" max="50" value="${n}" data-tope="${p}" class="campo-suelto feed-tope"></label>`).join('')}
    <div class="fila"><button class="btn btn-chico" id="feed-traer">Traer ahora</button></div>
    ${feed.datos.ranking?.length ? `<h3 class="sub">Tus cuentas, por puntaje</h3><ul class="pag-lista feed-ranking">${feed.datos.ranking.slice(0, 20).map((r) => `<li><span><b>${esc(r.cuenta)}</b> <small class="tenue">${NOMBRE_PLAT[r.plataforma] ?? r.plataforma}</small></span><small>${r.promedio}/6 en ${r.votos} voto${r.votos === 1 ? '' : 's'}${r.estaSemana != null ? ` · esta semana ${r.estaSemana}${r.semanaPasada != null ? ` (antes ${r.semanaPasada})` : ''}` : ''}</small>${r.silenciar ? `<button class="btn btn-chico" data-silenciar="${r.fuenteId}" title="Cae siempre abajo: dejar de seguirla">Silenciar</button>` : ''}</li>`).join('')}</ul>` : ''}
    <p class="tenue chico">Teclas: <kbd>j</kbd> <kbd>k</kbd> moverse · <kbd>i</kbd> importa · <kbd>n</kbd> no</p>`
  $('#feed-sumar').onsubmit = async (e) => {
    e.preventDefault()
    try { const f = await api('/feed/fuentes', { texto: e.target.texto.value }); toast(`Siguiendo ${esc(f.nombre)}`, 'suave'); void api('/feed/recolectar', {}).then(pintarFeed).catch(() => {}); pintarFeed() } catch (err) { error(err) }
  }
  $$('#feed-fuentes [data-quitar]').forEach((b) => (b.onclick = async () => { try { await api(`/feed/fuentes/${b.dataset.quitar}/quitar`, {}); pintarFeed() } catch (e) { error(e) } }))
  $$('#feed-fuentes [data-silenciar]').forEach((b) => (b.onclick = async () => { try { await api(`/feed/fuentes/${b.dataset.silenciar}/quitar`, {}); toast('Silenciada: no la traigo más', 'suave'); pintarFeed() } catch (e) { error(e) } }))
  $$('#feed-fuentes [data-tope]').forEach((x) => (x.onchange = async () => { try { await api('/feed/tope', { plataforma: x.dataset.tope, n: Number(x.value) }); pintarFeed() } catch (e) { error(e) } }))
  $('#feed-traer').onclick = async (e) => { e.target.disabled = true; try { const r = await api('/feed/recolectar', {}); toast(`${r.nuevos} nuevo${r.nuevos === 1 ? '' : 's'}${r.errores ? `<small>${r.errores} fuente${r.errores === 1 ? '' : 's'} con error</small>` : ''}`, 'suave'); pintarFeed() } catch (err) { error(err) } finally { e.target.disabled = false } }
  activarFeed(feed.activa ?? pendientesFeed()[0] ?? null)
}

const pendientesFeed = () => $$('#feed-dias [data-item]').filter((a) => a.querySelector('[data-p]')).map((a) => Number(a.dataset.item))

function activarFeed(id) {
  feed.activa = id
  $$('#feed-dias [data-item]').forEach((a) => a.classList.toggle('activo', Number(a.dataset.item) === id))
  $(`#feed-dias [data-item="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

async function puntuarFeed(id, puntaje) {
  try {
    await api(`/feed/${id}/puntaje`, { puntaje })
    const ps = pendientesFeed()
    feed.activa = ps[ps.indexOf(id) + 1] ?? ps.find((x) => x !== id) ?? null
    pintarFeed()
  } catch (e) { error(e) }
}

document.addEventListener('keydown', (e) => {
  if (vista !== 'feed' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || !$('#velo').hidden || document.querySelector('.dialogo-velo')) return
  const orden = $$('#feed-dias [data-item]').map((a) => Number(a.dataset.item))
  if (!orden.length) return
  const i = orden.indexOf(feed.activa)
  let hecho = true
  if (e.key === 'j' || e.key === 'ArrowDown') activarFeed(orden[Math.min(orden.length - 1, i + 1)])
  else if (e.key === 'k' || e.key === 'ArrowUp') activarFeed(orden[Math.max(0, i - 1)])
  else if (/^[1-6]$/.test(e.key) && feed.activa && pendientesFeed().includes(feed.activa)) puntuarFeed(feed.activa, Number(e.key))
  else if ((e.key === 'i' || e.key === 'n') && feed.activa && pendientesFeed().includes(feed.activa)) puntuarFeed(feed.activa, e.key === 'i' ? 5 : 2)
  else hecho = false
  if (hecho) { e.preventDefault(); e.stopPropagation() }
}, true)
