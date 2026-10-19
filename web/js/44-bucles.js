'use strict'
// Lo que sigue volviendo: lo abierto que aparece una y otra vez (en tus charlas, notas y side quests quietas), con
// cuántas veces volvió y desde cuándo. Cada uno se termina de una de tres formas: hacerlo ya, agendarlo o soltarlo.
// También: «¿Qué te acordás?» de un video o link (primero recordar, después mirar).

const desdeBucle = (b) => (b.primera ? `desde el ${b.primera.slice(8, 10)}/${b.primera.slice(5, 7)}` : '')

/** Una fila con sus tres finales. */
function filaBucle(b, compacta = false) {
  return `<div class="bucle ${compacta ? 'compacta' : ''}" data-bucle="${b.id}">
    <div class="bucle-txt"><span>${esc(compacta ? corto(b.texto, 60) : b.texto)}</span>
      <small class="tenue">volvió ${b.veces} ${b.veces === 1 ? 'vez' : 'veces'}${desdeBucle(b) ? ` · ${desdeBucle(b)}` : ''}</small></div>
    <span class="bucle-fin">
      <button class="btn btn-chico" data-bucle-fin="ya" title="Es corto: side quest para hoy">✓${compacta ? '' : ' Hoy'}</button>
      <button class="btn btn-chico" data-bucle-fin="agendar" title="Al calendario">📅${compacta ? '' : ' Agendar'}</button>
      <button class="btn btn-chico" data-bucle-fin="soltar" title="Decidir no hacerlo: no vuelve a molestar">🗑${compacta ? '' : ' Soltar'}</button>
    </span></div>`
}

function engancharBucles(cont, bucles, alTerminar) {
  $$('[data-bucle-fin]', cont).forEach((btn) => (btn.onclick = () => {
    const b = bucles.find((x) => x.id === Number(btn.closest('[data-bucle]').dataset.bucle))
    if (!b) return
    if (btn.dataset.bucleFin === 'ya') return cerrarBucleUI(b, 'ya', {}, alTerminar)
    modalFinBucle(b, btn.dataset.bucleFin, alTerminar)
  }))
}

async function cerrarBucleUI(b, final, extra, alTerminar) {
  try {
    const r = await api(`/bucles/${b.id}`, { final, ...extra })
    toast(final === 'ya' ? '✓ Quedó como side quest para hoy' : final === 'agendar' ? (r.google ? '📅 En tu calendario' : '📅 Side quest con fecha') : '🗑 Soltado', 'suave')
    cerrarModal()
    alTerminar?.()
  } catch (e) { error(e) }
}

function modalFinBucle(b, final, alTerminar) {
  const manana = new Date(Date.now() + 86_400_000)
  const iso = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${final === 'agendar' ? '📅 Agendar' : '🗑 Soltar'}</h2>
    <p>«${esc(b.texto)}»</p><p class="tenue chico">Volvió ${b.veces} ${b.veces === 1 ? 'vez' : 'veces'}${desdeBucle(b) ? `, ${desdeBucle(b)}` : ''}.</p>
    <form id="bf-form">
      ${final === 'agendar'
        ? `<div class="fila"><label class="campo">Día<input name="fecha" type="date" value="${iso}" required></label><label class="campo">Hora (opcional)<input name="hora" type="time"></label></div>`
        : '<label class="campo">¿Por qué lo soltás? (opcional)<input name="motivo" placeholder="Ya no me importa, ya lo hice, no es mío…"></label>'}
      <button class="btn btn-primario">${final === 'agendar' ? 'Agendar' : 'Soltar'}</button>
    </form>`)
  $('#bf-form').onsubmit = (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    cerrarBucleUI(b, final, { fecha: f.fecha || null, hora: f.hora || null, motivo: f.motivo || null }, alTerminar)
  }
}

/** La sección completa (en Misiones): los siete que más pesan. */
async function pintarSeccionBucles(cont) {
  if (!cont) return
  let d
  try { d = await api('/bucles?limite=7') } catch { return void (cont.innerHTML = '') }
  if (!d.bucles.length) return void (cont.innerHTML = '')
  const cerrados = (d.resumen.cerrado ?? 0) + (d.resumen.agendado ?? 0) + (d.resumen.soltado ?? 0)
  cont.innerHTML = `<section class="seccion bucles-sec"><h3>🔁 Lo que sigue volviendo</h3>
    <p class="tenue chico">Lo abierto que aparece una y otra vez en tus charlas, notas y side quests quietas. Cerrarlo libera cabeza: hacelo ya, agendalo o soltalo.${cerrados ? ` Ya cerraste ${cerrados}.` : ''}</p>
    ${d.bucles.map((b) => filaBucle(b)).join('')}</section>`
  engancharBucles(cont, d.bucles, () => pintarSeccionBucles(cont))
}

// ─── ¿qué te acordás? ───────────────────────────────────────────────────

/** Primero escribís (o pensás) lo que recordás; después se muestra lo que plantea y sus tarjetas. */
async function recordarPiezaUI(id) {
  let d
  try { d = await api(`/piezas/${id}/recordar`) } catch (e) { return error(e) }
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🧠 ¿Qué te acordás?</h2>
    <p class="tenue">De «${esc(d.titulo)}». Antes de mirar: ¿qué plantea?, ¿con qué lo sostiene?, ¿qué te llevás para hacer?</p>
    <textarea class="campo-suelto" id="rp-mio" rows="4" placeholder="Lo que recordás, con tus palabras (aunque sea poco: recordar es lo que fija)"></textarea>
    <div class="fila" style="margin-top:10px"><button class="btn btn-primario" id="rp-ver">👀 Ver lo que plantea</button></div>
    <div id="rp-resp" hidden>
      ${d.tesis ? `<h3 class="sub">Qué plantea</h3><p>${esc(d.tesis)}</p>` : ''}
      ${d.resumen ? `<h3 class="sub">Resumen</h3><p class="tenue">${esc(d.resumen)}</p>` : ''}
      ${!d.tesis && !d.resumen ? '<p class="tenue">Todavía no está destilada: el Procesar la lee en la nube.</p>' : ''}
      <h3 class="sub">Sus tarjetas (${d.tarjetas.length})</h3>
      ${d.tarjetas.length ? `${d.tarjetas.map((t) => `<details class="rp-tj"><summary>${esc(t.frente)}</summary><p>${esc(t.dorso)}</p></details>`).join('')}<div class="fila" style="margin-top:8px"><button class="btn btn-chico" id="rp-repasar">🃏 Repasar las que tocan</button></div>`
        : '<p class="tenue chico">Sin tarjetas todavía.</p><button class="btn btn-chico" id="rp-armar">Armar tarjetas (en la nube)</button>'}
    </div>`)
  $('#rp-ver').onclick = () => { $('#rp-resp').hidden = false; $('#rp-ver').hidden = true }
  if ($('#rp-repasar')) $('#rp-repasar').onclick = () => repasarTarjetas('consumido')
  if ($('#rp-armar')) $('#rp-armar').onclick = async () => {
    $('#rp-armar').disabled = true
    try { const r = await api(`/piezas/${id}/tarjetas`, {}); toast(`${r.nuevas} tarjetas nuevas`, 'suave'); recordarPiezaUI(id) } catch (e) { error(e); $('#rp-armar').disabled = false }
  }
}
