'use strict'
// El consejo de modelos (en Jugador): 1 a 3 personas que tomás de referencia, con su manual operativo. Se puede hablar
// con cada una como personaje, preguntar «¿qué haría?» y, los domingos, calibrar tu vara con la suya.

async function montarModelos(cont) {
  let d
  try { d = await api('/modelos') } catch (e) { return error(e) }
  const xs = d.modelos
  cont.innerHTML = `
    <p class="tenue">Hasta tres personas que tomás de modelo. Mastropiero arma el manual operativo de cada una con lo que hay de ella en tu corpus (y la web): principios, su vara, cómo decide, lo que evita. Mandale links, videos o libros suyos para que el manual sea mejor.</p>
    ${xs.length < 3 ? `<form class="fila" id="mo-sumar" style="margin:10px 0"><input class="campo-suelto" name="nombre" placeholder="Nombre de la persona" style="flex:1;margin:0"><button class="btn btn-primario">＋ Sumar al consejo</button></form>` : ''}
    ${xs.length ? `<div class="tarjetas">${xs.map((m) => `<article class="tarjeta mo-mod">
        <header class="fila" style="justify-content:space-between"><h3>♛ ${esc(m.nombre)}</h3><button class="btn btn-chico" data-mo-quitar="${m.id}" title="Sacar del consejo">✕</button></header>
        ${m.manual ? `<p>${esc(m.manual.resumen)}</p><ul class="mo-principios">${m.manual.principios.slice(0, 5).map((p) => `<li><b>${esc(p.principio)}</b> <span class="tenue">${esc(p.en_la_practica)}</span></li>`).join('')}</ul>
          <small class="tenue">Manual del ${new Date(m.manualEn).toLocaleDateString('es-AR')}${m.manualPieza ? ` · <a href="#" class="ref" data-mo-pieza="${m.manualPieza}">verlo entero</a>` : ''}</small>`
          : '<p class="tenue chico">Todavía sin manual.</p>'}
        <div class="fila mo-acc">
          <button class="btn btn-chico ${m.manual ? '' : 'btn-primario'}" data-mo-manual="${m.id}" ${d.enLaNube ? '' : 'disabled title="Se arma en la nube (gasta tokens)"'}>${m.manual ? '↻ Rehacer manual' : '✦ Armar su manual'}</button>
          <button class="btn btn-chico" data-mo-hablar="${m.id}">💬 Hablar</button>
          <button class="btn btn-chico" data-mo-haria="${m.id}" ${m.manual ? '' : 'disabled'}>¿Qué haría?</button>
        </div>
      </article>`).join('')}</div>` : '<div class="vacio"><div class="gran">♛</div><h2>Tu consejo está vacío</h2><p>¿A quién mirás cuando dudás? Sumalo y armamos su manual.</p></div>'}`
  const recargar = () => montarModelos(cont)
  if ($('#mo-sumar', cont)) $('#mo-sumar', cont).onsubmit = async (ev) => { ev.preventDefault(); try { await api('/modelos', { nombre: ev.target.nombre.value }); recargar() } catch (e) { error(e) } }
  $$('[data-mo-quitar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/modelos/${b.dataset.moQuitar}/quitar`, {}); recargar() } catch (e) { error(e) } }))
  $$('[data-mo-pieza]', cont).forEach((a) => (a.onclick = (e) => { e.preventDefault(); modalPieza(Number(a.dataset.moPieza)) }))
  $$('[data-mo-manual]', cont).forEach((b) => (b.onclick = async () => {
    b.disabled = true
    b.textContent = 'Leyendo su material…'
    try { await api(`/modelos/${b.dataset.moManual}/manual`, {}); toast('Manual listo', 'suave'); recargar() } catch (e) { error(e); recargar() }
  }))
  $$('[data-mo-hablar]', cont).forEach((b) => (b.onclick = async () => {
    try { const c = await api(`/modelos/${b.dataset.moHablar}/hablar`, {}); chat.actual = { id: c.id, modo: 'chat' }; irA('chat') } catch (e) { error(e) }
  }))
  $$('[data-mo-haria]', cont).forEach((b) => (b.onclick = () => modalQueHaria(xs.find((m) => m.id === Number(b.dataset.moHaria)))))
}

function modalQueHaria(m) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>¿Qué haría ${esc(m.nombre)}?</h2>
    <form id="qh-form"><label class="campo">La situación o la decisión, con contexto<textarea name="situacion" rows="4" required autofocus></textarea></label><button class="btn btn-primario">Preguntar</button></form>
    <div id="qh-resp"></div>`)
  $('#qh-form').onsubmit = async (ev) => {
    ev.preventDefault()
    $('#qh-resp').innerHTML = '<p class="tenue">Pensando desde su manual…</p>'
    try {
      const r = await api(`/modelos/${m.id}/que-haria`, { situacion: ev.target.situacion.value })
      $('#qh-resp').innerHTML = `<div class="qh"><p><b>Haría:</b> ${esc(r.haria)}</p><p><b>Por qué:</b> ${esc(r.porQue)}</p><p><b>Hoy:</b> ${esc(r.primerPaso)}</p><p><b>No haría:</b> ${esc(r.noHaria)}</p><small class="tenue">Confianza ${esc(r.confianza)} (cuánto lo cubre su manual)</small></div>`
    } catch (e) { $('#qh-resp').innerHTML = ''; error(e) }
  }
}
