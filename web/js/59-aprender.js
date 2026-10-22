'use strict'
// Aprender: lo que querés aprender (temas, práctica y repaso espaciado). Lo que estudiás se lo contás a Mastropiero.

let aprTab = 'temas'

function montarAprender() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Aprender</h1><p>Lo que querés aprender. Lo que estudiás se lo contás a Mastropiero: te repregunta en 1, 3, 7 y 16 días.</p></div>
    <div class="tabs" id="apr-tabs">${[['temas', 'Quiero aprender'], ['repaso', 'Repaso']].map(([k, n]) => `<button data-tab="${k}" class="${aprTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div id="apr-cuerpo"></div>`
  $$('#apr-tabs button').forEach((b) => (b.onclick = () => { aprTab = b.dataset.tab; montarAprender() }))
  pintarAprender()
}

async function pintarAprender() {
  const cont = $('#apr-cuerpo')
  if (!cont) return
  try {
    const d = await api('/aprender')
    if (aprTab === 'temas') pintarTemas(cont, d)
    else pintarRepaso(cont, d)
  } catch (e) { error(e) }
}

function pintarTemas(cont, d) {
  cont.innerHTML = `
    <section class="seccion"><form class="fila" id="apr-nuevo"><input name="tema" placeholder="Quiero aprender… (francés, SQL, a negociar)" required style="flex:2;min-width:12em"><input name="nivelObjetivo" placeholder="Hasta dónde (opcional)" style="flex:1;min-width:10em"><button class="btn btn-primario">＋ Sumar</button></form></section>
    ${d.aprendizajes.length ? `<div class="tarjetas">${d.aprendizajes.map((a) => `<article class="tarjeta apr-tema ${a.estado}" data-tema="${a.id}">
      <h4>${esc(a.tema)} ${a.estado !== 'activo' ? `<small class="tenue">(${esc(a.estado)})</small>` : ''}</h4>
      <p>${a.practicas ? `${a.minutosSemana} min esta semana · ${a.minutos} en total · ${a.diasMes} día${a.diasMes === 1 ? '' : 's'} este mes · última ${esc(a.ultima)}` : 'Todavía sin práctica anotada.'}</p>
      ${a.nivelObjetivo ? `<p>Objetivo: ${esc(a.nivelObjetivo)}</p>` : ''}
      <form class="fila" data-practica="${a.id}"><input name="minutos" type="number" min="1" placeholder="min" style="width:5em"><input name="que" placeholder="Qué practicaste" class="f1"><button class="btn btn-chico">Anotar</button></form>
      <div class="fila"><button class="btn btn-chico" data-recursos="${a.id}">Recursos</button><button class="btn btn-chico" data-estado="${a.id}" data-a="${a.estado === 'activo' ? 'pausado' : 'activo'}">${a.estado === 'activo' ? 'Pausar' : 'Reactivar'}</button></div>
      <div class="apr-recursos" id="apr-rec-${a.id}"></div></article>`).join('')}</div>` : '<p class="tenue">Todavía no anotaste nada para aprender.</p>'}`
  $('#apr-nuevo').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/aprender', Object.fromEntries(new FormData(ev.target))); pintarAprender() } catch (e) { error(e) } }
  $$('[data-practica]', cont).forEach((f) => (f.onsubmit = async (ev) => {
    ev.preventDefault()
    const v = Object.fromEntries(new FormData(f))
    try { await api(`/aprender/${f.dataset.practica}/practica`, { minutos: v.minutos ? Number(v.minutos) : null, que: v.que }); toast('Anotado<small>Te repregunto mañana</small>', 'suave'); pintarAprender() } catch (e) { error(e) }
  }))
  $$('[data-estado]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/aprender/${b.dataset.estado}`, { estado: b.dataset.a }); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-recursos]', cont).forEach((b) => (b.onclick = async () => {
    try {
      const r = await api(`/aprender/${b.dataset.recursos}`)
      const lista = [...r.recursos.obras.map((o) => `📖 ${esc(o.titulo)}${o.autor ? ` — ${esc(o.autor)}` : ''} <small class="tenue">(${esc(o.estado)})</small>`), ...r.recursos.piezas.map((p) => `<a href="#" class="ref" data-pieza="${p.id}">${esc(p.titulo)}</a>`)]
      $(`#apr-rec-${b.dataset.recursos}`).innerHTML = lista.length ? `<ul>${lista.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="tenue chico">No encontré nada en tu Librería ni en el corpus. Sumá una obra o pedile al Mentor.</p>'
    } catch (e) { error(e) }
  }))
}

function pintarRepaso(cont, d) {
  const tocan = d.repaso.filter((p) => p.toca)
  const vienen = d.repaso.filter((p) => !p.toca)
  cont.innerHTML = `
    <section class="seccion"><h3>Para repasar ahora (${tocan.length})</h3>
      ${tocan.length ? tocan.map((p) => `<form class="apr-rep" data-rep="${p.id}"><b>${esc(p.texto)}</b><small class="tenue">${esc(p.porQue ?? '')} · vuelta ${p.vuelta + 1} de 4</small>
        <div class="fila"><input name="respuesta" placeholder="De memoria…" class="f1"><button class="btn btn-chico btn-primario">Responder</button><button class="btn btn-chico" type="button" data-saltar="${p.id}">Mañana</button></div></form>`).join('') : '<p class="tenue">Nada para repasar ahora.</p>'}</section>
    ${vienen.length ? `<section class="seccion"><h3>Vienen</h3>${vienen.map((p) => `<div class="fila item"><span class="f1">${esc(p.texto)}</span><small class="tenue">${new Date(p.vuelveEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</small></div>`).join('')}</section>` : ''}`
  $$('[data-rep]', cont).forEach((f) => (f.onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/repaso/${f.dataset.rep}`, { respuesta: f.respuesta.value }); toast('Bien. Vuelve más adelante.', 'suave'); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-saltar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/repaso/${b.dataset.saltar}`, { respuesta: null }); pintarAprender() } catch (e) { error(e) } }))
}
