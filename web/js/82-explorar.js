'use strict'
// Explorar internet (plan v31): cada plataforma con qué se puede y qué no sin cuenta, por dónde va (su cadena) y cómo
// anda cada paso; y una caja para probar: buscar en una plataforma, listar lo de algo o leer un link.

const ESTADO_EXP = { ok: ['ok', 'anduvo'], fallo: ['mal', 'falló la última vez'], en_pausa: ['pausa', 'en pausa'], sin_usar: ['nada', 'sin usar todavía'] }
const ACCION_EXP = { buscar: 'Buscar', leer: 'Leer', listar: 'Listar' }
const exp = { plataforma: 'reddit', accion: 'buscar', canales: [] }

async function modalExplorar() {
  abrirModal('<div id="exp"><p class="tenue">Mirando los canales…</p></div>')
  $('#modal').classList.add('modal-ancho')
  await pintarExplorar()
}

function cadenaExp(nombre, bs) {
  if (!bs.length) return ''
  const hora = (ms) => new Date(ms).toTimeString().slice(0, 5)
  return `<div class="exp-cadena"><small class="tenue">${nombre}:</small> ${bs.map((b) => `<span class="exp-paso ${ESTADO_EXP[b.estado][0]}" title="${esc(ESTADO_EXP[b.estado][1])}${b.error ? ` · ${esc(b.error)}` : ''}${b.pausaHasta ? ` · vuelve a las ${hora(b.pausaHasta)}` : ''}">${esc(b.nombre)}</span>`).join('<span class="tenue"> → </span>')}</div>`
}

async function pintarExplorar() {
  const raiz = $('#exp')
  if (!raiz) return
  try { exp.canales = await api('/explorar/canales') } catch (e) { return error(e) }
  const c = exp.canales.find((x) => x.id === exp.plataforma) ?? exp.canales[0]
  const listados = c.listar ?? []
  if (exp.accion === 'listar' && !listados.length) exp.accion = 'buscar'
  raiz.innerHTML = `<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🌐 Explorar internet</h2>
    <p class="tenue">Lo que tus agentes, el Observatorio, Mastropiero y la puerta MCP pueden ver de cada plataforma, sin cuenta: solo lo público. Cada acción prueba sus caminos en orden; si uno está bloqueado o limitado, va el siguiente.</p>
    <div class="exp-canales">${exp.canales.map((x) => `<button class="exp-canal ${x.id === c.id ? 'on' : ''}" data-exp-canal="${x.id}">
        <b>${esc(x.nombre)}</b><small class="tenue">${esc(x.puede)}</small>${x.noPuede ? `<small class="exp-no">Sin cuenta no: ${esc(x.noPuede)}</small>` : ''}
        ${cadenaExp('buscar', x.buscar)}${cadenaExp('leer', x.leer)}${x.listar.map((l) => cadenaExp(l.nombre.toLowerCase(), l.backends)).join('')}
      </button>`).join('')}</div>
    <section class="seccion exp-prueba"><h3 class="sub">Probar en ${esc(c.nombre)}</h3>
      <div class="seg-tipos">${Object.entries(ACCION_EXP).filter(([k]) => k !== 'listar' || listados.length).map(([k, n]) => `<button class="chip ${exp.accion === k ? 'on' : ''}" data-exp-accion="${k}">${n}</button>`).join('')}</div>
      <form class="fila exp-form" id="exp-form">
        ${exp.accion === 'listar' ? `<select class="campo-suelto" id="exp-que">${listados.map((l) => `<option value="${l.que}">${esc(l.nombre)}</option>`).join('')}</select>` : ''}
        <input class="campo-suelto f1" id="exp-txt" placeholder="${exp.accion === 'leer' ? 'Un link (https://…)' : exp.accion === 'listar' ? esc(listados[0]?.ayuda ?? '') : `Qué buscar en ${esc(c.nombre)}`}" autocomplete="off">
        <button class="btn btn-primario">${ACCION_EXP[exp.accion]}</button>
      </form>
      <div id="exp-resultado"></div>
    </section>`
  $$('[data-exp-canal]', raiz).forEach((b) => (b.onclick = () => { exp.plataforma = b.dataset.expCanal; pintarExplorar() }))
  $$('[data-exp-accion]', raiz).forEach((b) => (b.onclick = () => { exp.accion = b.dataset.expAccion; pintarExplorar() }))
  const que = $('#exp-que')
  if (que) que.onchange = () => { $('#exp-txt').placeholder = listados.find((l) => l.que === que.value)?.ayuda ?? '' }
  $('#exp-form').onsubmit = (ev) => { ev.preventDefault(); probarExplorar(c) }
  $('#exp-txt').focus()
}

async function probarExplorar(c) {
  const txt = $('#exp-txt').value.trim()
  const caja = $('#exp-resultado')
  if (!txt || !caja) return
  caja.innerHTML = '<p class="tenue">Buscando…</p>'
  const cuerpo = exp.accion === 'leer' ? { url: txt } : exp.accion === 'listar' ? { plataforma: c.id, que: $('#exp-que').value, id: txt } : { plataforma: c.id, consulta: txt }
  let r
  const ruta = { buscar: '/explorar/buscar', leer: '/explorar/leer', listar: '/explorar/listar' }[exp.accion]
  try { r = await api(ruta, cuerpo) } catch (e) { caja.innerHTML = `<p class="m-err">${esc(e.message)}</p>`; return }
  if (!$('#exp-resultado')) return
  if (r.error) {
    caja.innerHTML = `<p class="m-err">✗ ${esc(r.error)}</p>`
  } else if (exp.accion === 'leer') {
    caja.innerHTML = `<p class="tenue chico">${esc(r.plataforma)} · vía ${esc(r.via)}${r.aviso ? ` · ⚠ ${esc(r.aviso)}` : ''}</p><div class="exp-leido">${md(r.markdown.slice(0, 6000))}${r.markdown.length > 6000 ? `<p class="tenue">… (${r.markdown.length.toLocaleString('es-AR')} caracteres en total)</p>` : ''}</div>`
  } else {
    const datos = (x) => Object.entries(x.datos ?? {}).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ')
    caja.innerHTML = `<p class="tenue chico">${r.items.length} resultado${r.items.length === 1 ? '' : 's'} · vía ${esc(r.via)}${r.aviso ? ` · ${esc(r.aviso)}` : ''}</p>
      <ol class="exp-items">${r.items.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.titulo)}</a><small class="tenue">${[x.autor, x.fecha?.slice(0, 10), datos(x)].filter(Boolean).map(esc).join(' · ')}</small>${x.texto ? `<p>${esc(x.texto.replace(/\s+/g, ' ').slice(0, 280))}</p>` : ''}<button class="btn-link" data-exp-leer="${esc(x.url)}">leer →</button></li>`).join('')}</ol>`
    $$('[data-exp-leer]', caja).forEach((b) => (b.onclick = () => { exp.accion = 'leer'; pintarExplorar().then(() => { $('#exp-txt').value = b.dataset.expLeer; probarExplorar(c) }) }))
  }
  // La salud cambió (anduvo o falló algo): se refrescan las cadenas sin perder el resultado.
  try {
    exp.canales = await api('/explorar/canales')
    const tarjetas = $$('.exp-canal')
    exp.canales.forEach((x, i) => { const t = tarjetas[i]; if (t) for (const el of $$('.exp-cadena', t)) el.remove() })
    exp.canales.forEach((x, i) => { const t = tarjetas[i]; if (t) t.insertAdjacentHTML('beforeend', `${cadenaExp('buscar', x.buscar)}${cadenaExp('leer', x.leer)}${x.listar.map((l) => cadenaExp(l.nombre.toLowerCase(), l.backends)).join('')}`) })
  } catch { /* la salud se ve la próxima vez */ }
}
