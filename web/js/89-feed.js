'use strict'
// Tu feed, con tope (plan v38, fase 5): lo mejor de tus cuentas de X, subreddits y canales de YouTube, con una cantidad
// fija por día. Cuando llegás al tope, se terminó: sin scroll infinito. Marcás importa / no (i / n) y aprendo qué fuentes
// te sirven para ordenarte lo que viene.

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
      ${i.voto == null ? '<div class="fila"><button class="btn btn-chico" data-v="1">Importa <kbd>i</kbd></button><button class="btn btn-chico" data-v="0">No <kbd>n</kbd></button></div>' : ''}
    </article>`
  $('#feed-dias').innerHTML = !fuentes.some((f) => f.activa)
    ? '<div class="vacio tarjeta"><h3>Todavía no seguís nada</h3><p class="tenue">Sumá una cuenta de X, un subreddit o un canal de YouTube (a la derecha), o pedíselo al chat.</p></div>'
    : dias.filter((d) => d.items.length || fuentes.some((f) => f.activa && f.plataforma === d.plataforma)).map((d) => `<section class="feed-plat"><h2>${NOMBRE_PLAT[d.plataforma]} <small class="tenue">${d.vistos} de ${d.tope} hoy</small></h2>
        ${d.items.map(item).join('')}
        ${d.terminado ? '<p class="tenue feed-fin">Se terminó por hoy. Mañana hay más.</p>' : !d.items.length ? '<p class="tenue chico">Nada nuevo por ahora.</p>' : ''}
      </section>`).join('')
  $$('#feed-dias [data-v]').forEach((b) => (b.onclick = () => votarFeed(Number(b.closest('[data-item]').dataset.item), Number(b.dataset.v))))
  $$('#feed-dias [data-item]').forEach((a) => a.addEventListener('click', (e) => { if (!e.target.closest('a, button')) activarFeed(Number(a.dataset.item)) }))
  $('#feed-fuentes').innerHTML = `<h3 class="sub">Lo que seguís</h3>
    <form class="fila" id="feed-sumar"><input class="campo-suelto f1" name="texto" placeholder="@cuenta · r/subreddit · link del canal" autocomplete="off"><button class="btn btn-chico">Sumar</button></form>
    <ul>${fuentes.filter((f) => f.activa).map((f) => `<li><span>${esc(NOMBRE_PLAT[f.plataforma])} · ${esc(f.nombre)}${f.error ? ` <small class="tenue" title="${esc(f.error)}">⚠</small>` : ''}</span><button class="btn-link" data-quitar="${f.id}">quitar</button></li>`).join('') || '<li class="tenue">Nada todavía.</li>'}</ul>
    <h3 class="sub">Tope por día</h3>
    ${Object.entries(topes).map(([p, n]) => `<label class="fila g-2 chico">${NOMBRE_PLAT[p]} <input type="number" min="1" max="50" value="${n}" data-tope="${p}" class="campo-suelto feed-tope"></label>`).join('')}
    <div class="fila"><button class="btn btn-chico" id="feed-traer">Traer ahora</button></div>
    <p class="tenue chico">Teclas: <kbd>j</kbd> <kbd>k</kbd> moverse · <kbd>i</kbd> importa · <kbd>n</kbd> no</p>`
  $('#feed-sumar').onsubmit = async (e) => {
    e.preventDefault()
    try { const f = await api('/feed/fuentes', { texto: e.target.texto.value }); toast(`Siguiendo ${esc(f.nombre)}`, 'suave'); void api('/feed/recolectar', {}).then(pintarFeed).catch(() => {}); pintarFeed() } catch (err) { error(err) }
  }
  $$('#feed-fuentes [data-quitar]').forEach((b) => (b.onclick = async () => { try { await api(`/feed/fuentes/${b.dataset.quitar}/quitar`, {}); pintarFeed() } catch (e) { error(e) } }))
  $$('#feed-fuentes [data-tope]').forEach((x) => (x.onchange = async () => { try { await api('/feed/tope', { plataforma: x.dataset.tope, n: Number(x.value) }); pintarFeed() } catch (e) { error(e) } }))
  $('#feed-traer').onclick = async (e) => { e.target.disabled = true; try { const r = await api('/feed/recolectar', {}); toast(`${r.nuevos} nuevo${r.nuevos === 1 ? '' : 's'}${r.errores ? `<small>${r.errores} fuente${r.errores === 1 ? '' : 's'} con error</small>` : ''}`, 'suave'); pintarFeed() } catch (err) { error(err) } finally { e.target.disabled = false } }
  activarFeed(feed.activa ?? pendientesFeed()[0] ?? null)
}

const pendientesFeed = () => $$('#feed-dias [data-item]').filter((a) => a.querySelector('[data-v]')).map((a) => Number(a.dataset.item))

function activarFeed(id) {
  feed.activa = id
  $$('#feed-dias [data-item]').forEach((a) => a.classList.toggle('activo', Number(a.dataset.item) === id))
  $(`#feed-dias [data-item="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

async function votarFeed(id, voto) {
  try {
    await api(`/feed/${id}/voto`, { voto })
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
  else if ((e.key === 'i' || e.key === 'n') && feed.activa && pendientesFeed().includes(feed.activa)) votarFeed(feed.activa, e.key === 'i' ? 1 : 0)
  else hecho = false
  if (hecho) { e.preventDefault(); e.stopPropagation() }
}, true)
