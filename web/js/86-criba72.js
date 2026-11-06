'use strict'
// La Criba del 72 (plan v36): el formato que reemplaza a La Mano. 72 frases, 36 pares de polos opuestos (que no se notan),
// mezcladas: las votás del 1 al 6 por instinto y recién al final se ve la estructura. Las cribas son tuyas (las importás)
// o las arma Mastropiero con lo que sabe de vos; cuando la lee, aprende y te arma la siguiente para profundizar.

const c72 = { lista: [], id: null, datos: null, i: 0, modo: 'menu', cola: Promise.resolve(), trabajo: null }
const C72_GRUPOS = { origen: 'Origen', adentro: 'Hacia adentro', afuera: 'Hacia afuera', abajo: 'Lo de abajo', tuyas: 'Tuyas' }
const C72_CLASES = { partido: ['Partidos', 'un polo arriba y el otro abajo (|delta| ≥ 3)'], tension: ['Tensiones vivas', 'los dos polos en 5 o 6'], fria: ['Zonas frías', 'los dos polos en 3 o menos'], templado: ['Templados', 'el resto'] }

async function montarCriba72() {
  const id = Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('c')) || c72.id
  if (id && c72.modo !== 'menu') return abrirC72(id, c72.modo)
  c72.modo = 'menu'
  $('#principal').innerHTML = `<div class="c72">
    <div class="titulo"><h1>La Criba del 72</h1><p>72 frases que votás del 1 al 6 por instinto. Por debajo son 36 pares de polos opuestos, mezclados para que no se note: recién al final ves dónde estás partido, dónde hay tensión viva y dónde no te mueve nada. Mastropiero las lee, aprende de vos y te arma la siguiente.</p></div>
    <div class="c72-menu">
      <section id="c72-lista" class="c72-lista"><p class="tenue">Cargando…</p></section>
      <aside class="c72-lado">
        <form id="c72-armar" class="tarjeta c72-form">
          <h3 class="sub">Que Mastropiero arme una</h3>
          <label class="campo">Sobre qué<input name="tema" required placeholder="Cómo decido · Mi relación con la plata · El proyecto X" autocomplete="off"></label>
          <label class="campo">Para qué (opcional)<input name="para" placeholder="Qué querés que ilumine" autocomplete="off"></label>
          <div class="c72-anclas">
            <label class="campo">El 1 es…<input name="ancla1" placeholder="Nada que ver conmigo" autocomplete="off"></label>
            <label class="campo">El 6 es…<input name="ancla6" placeholder="Soy yo" autocomplete="off"></label>
          </div>
          <label class="campo">Grupo<select name="grupo">${Object.entries(C72_GRUPOS).map(([k, n]) => `<option value="${k}" ${k === 'tuyas' ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <div class="fila"><button class="btn btn-primario" id="c72-armar-btn">Armar la criba</button><small class="tenue">Tarda un minuto: usa lo que sabe de vos y tus cribas votadas.</small></div>
          <p id="c72-armando" class="tenue chico" hidden></p>
        </form>
        <div class="tarjeta c72-form">
          <h3 class="sub">Traer las tuyas</h3>
          <p class="tenue chico">El JSON de tus cribas (el formato de tu artefacto: titulo, consigna, a1, a6, ejes, pares e items).</p>
          <div class="fila"><button class="btn" id="c72-importar">Importar cribas</button></div>
        </div>
      </aside>
    </div>
  </div>`
  const f = $('#c72-armar')
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    armarC72(Object.fromEntries(new FormData(f)))
  }
  $('#c72-importar').onclick = modalImportarC72
  if (c72.trabajo) seguirArmadoC72()
  pintarListaC72()
}

async function pintarListaC72() {
  try { c72.lista = await api('/criba72') } catch (e) { return error(e) }
  const caja = $('#c72-lista')
  if (!caja) return
  if (!c72.lista.length) {
    caja.innerHTML = `<div class="vacio tarjeta"><h3>Todavía no hay cribas</h3><p class="tenue">Importá las tuyas o pedile a Mastropiero que te arme una (a la derecha).</p></div>`
    return
  }
  const grupos = {}
  for (const c of c72.lista) (grupos[c.grupo] ??= []).push(c)
  const orden = [...Object.keys(C72_GRUPOS), ...Object.keys(grupos).filter((g) => !(g in C72_GRUPOS))].filter((g) => grupos[g])
  caja.innerHTML = orden.map((g) => `<h3 class="sub">${esc(C72_GRUPOS[g] ?? g)}</h3><div class="c72-tarjetas">${grupos[g].map((c) => {
    const estado = c.conLectura ? 'Leída' : c.estado === 'cerrada' ? 'Votada' : c.votadas ? `${c.votadas} de 72` : 'Sin votar'
    return `<button class="c72-tarjeta${c.votadas ? ' empezada' : ''}" data-c72="${c.id}">
      <span class="c72-t-cab"><b>${esc(c.titulo)}</b>${c.origen === 'mastropiero' ? `<span class="chip" title="La armó Mastropiero">${ico('sparkles')}</span>` : ''}</span>
      ${c.ilumina ? `<small class="tenue">${esc(c.ilumina)}</small>` : ''}
      <span class="c72-barra"><i data-ancho="${Math.round((c.votadas / 72) * 100)}"></i></span>
      <small class="c72-estado">${esc(estado)}</small>
    </button>`
  }).join('')}</div>`).join('')
  $$('[data-ancho]', caja).forEach((e) => (e.style.width = `${e.dataset.ancho}%`))
  $$('[data-c72]', caja).forEach((b) => (b.onclick = () => abrirC72(Number(b.dataset.c72))))
}

function modalImportarC72() {
  abrirModal(`<h2>Importar cribas</h2>
    <p class="tenue">Pegá el JSON o elegí el archivo. Las que ya estén (por su id) se actualizan; tus votos no se tocan.</p>
    <textarea id="c72-json" class="campo-suelto c72-json" rows="10" placeholder='[{"id": "cualidades", "titulo": "Las 72 cualidades", …}]'></textarea>
    <div class="fila"><label class="btn">Elegir archivo<input type="file" id="c72-archivo" accept=".json,application/json" hidden></label><span></span>
      <button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario" id="c72-json-ok">Importar</button></div>`)
  $('#c72-archivo').onchange = async (e) => { const a = e.target.files?.[0]; if (a) $('#c72-json').value = await a.text() }
  $('#c72-json-ok').onclick = async () => {
    let datos
    try { datos = JSON.parse($('#c72-json').value) } catch { return toast('Eso no es un JSON válido', 'error') }
    try {
      const r = await api('/criba72/importar', { cribas: datos })
      cerrarModal()
      toast(`${r.nuevas} nueva${r.nuevas === 1 ? '' : 's'}${r.actualizadas ? ` · ${r.actualizadas} actualizada${r.actualizadas === 1 ? '' : 's'}` : ''}${r.errores.length ? `<small>${esc(r.errores.slice(0, 3).join(' · '))}</small>` : ''}`, r.errores.length ? 'error' : 'suave')
      pintarListaC72()
    } catch (e) { error(e) }
  }
}

// ─── armar (de fondo: la pantalla pregunta cómo va) ─────────────────────

async function armarC72(params) {
  try {
    const r = await api('/criba72/armar', params)
    c72.trabajo = { clave: r.trabajo, que: 'armar', tema: params.tema }
    seguirArmadoC72()
  } catch (e) { error(e) }
}

async function seguirArmadoC72() {
  const t = c72.trabajo
  if (!t) return
  const aviso = $('#c72-armando')
  const boton = $('#c72-armar-btn')
  if (aviso) { aviso.hidden = false; aviso.textContent = `Armando «${t.tema}»… (podés seguir en otra cosa: te aviso)` }
  if (boton) boton.disabled = true
  const r = await api(`/criba72/trabajo/${encodeURIComponent(t.clave)}`).catch(() => ({ estado: 'andando' }))
  if (r.estado === 'andando') return setTimeout(seguirArmadoC72, 3000)
  c72.trabajo = null
  if (boton) boton.disabled = false
  if (aviso) aviso.hidden = true
  if (r.estado === 'listo') {
    toast(`Lista: «${esc(r.resultado.titulo)}»`, 'suave', { accion: { texto: 'Votarla', hacer: () => { c72.modo = 'intro'; c72.id = r.resultado.id; if (vista === 'criba72') abrirC72(r.resultado.id); else irA('criba72') } } })
    if (vista === 'criba72' && c72.modo === 'menu') pintarListaC72()
  } else toast(esc(r.error ?? 'Se perdió el armado (¿se reinició el servidor?). Probá de nuevo.'), 'error')
}

// ─── una criba ──────────────────────────────────────────────────────────

async function abrirC72(id, modo) {
  c72.id = id
  try { c72.datos = await api(`/criba72/${id}`) } catch (e) { c72.id = null; c72.modo = 'menu'; return error(e) }
  const s = c72.datos.sesion
  c72.modo = modo ?? (s?.estado === 'cerrada' ? 'lectura' : s ? 'votar' : 'intro')
  if (c72.modo === 'votar' && !s) c72.modo = 'intro'
  c72.i = primeraSinVotoC72()
  pintarC72()
}

function primeraSinVotoC72(desde = 0) {
  const v = c72.datos?.sesion?.votos ?? {}
  for (let k = 0; k < 72; k++) { const n = ((desde + k) % 72) + 1; if (!v[n]) return n - 1 }
  return desde
}

function cabeceraC72() {
  const { criba, sesion } = c72.datos
  const n = Object.keys(sesion?.votos ?? {}).length
  return `<div class="c72-cab">
    <button class="btn btn-chico" id="c72-volver" title="Volver a las cribas (Esc)">← Cribas</button>
    <div class="c72-cab-t"><h1>${esc(criba.titulo)}</h1>${criba.ilumina ? `<small class="tenue">${esc(criba.ilumina)}</small>` : ''}</div>
    ${sesion ? `<div class="c72-modos" role="tablist"><button role="tab" data-c72-modo="votar" aria-selected="${c72.modo === 'votar'}">Votar <small>${n}/72</small></button><button role="tab" data-c72-modo="lectura" aria-selected="${c72.modo === 'lectura'}">Lectura</button></div>` : ''}
    <div class="c72-cab-acc">${sesion ? `<button class="btn btn-chico" id="c72-exportar">⇩ Exportar</button><button class="btn btn-chico" id="c72-reiniciar" title="Archiva estos votos y la criba vuelve a cero">Reiniciar</button>` : ''}<button class="btn btn-chico btn-icono" id="c72-archivar" title="Sacarla de la lista" aria-label="Sacarla de la lista">${ico('archive')}</button></div>
  </div>`
}

function pintarC72() {
  const cuerpo = c72.modo === 'intro' ? introC72() : c72.modo === 'lectura' ? lecturaC72() : atrilC72()
  $('#principal').innerHTML = `<div class="c72 c72-en-${c72.modo}">${cabeceraC72()}${cuerpo}</div>`
  $('#c72-volver').onclick = volverC72
  $$('[data-c72-modo]').forEach((b) => (b.onclick = () => { c72.modo = b.dataset.c72Modo; if (c72.modo === 'lectura') abrirC72(c72.id, 'lectura'); else pintarC72() }))
  $('#c72-exportar')?.addEventListener('click', modalExportarC72)
  $('#c72-reiniciar')?.addEventListener('click', reiniciarC72)
  $('#c72-archivar').onclick = async () => {
    if (!(await confirmar('¿Sacar esta criba de la lista?', { si: 'Sacarla', detalle: 'Sus votos quedan guardados.' }))) return
    try { await api(`/criba72/${c72.id}/archivar`, {}); volverC72() } catch (e) { error(e) }
  }
  $$('[data-ancho]').forEach((e) => (e.style.width = `${e.dataset.ancho}%`))
  if (c72.modo === 'intro') atarIntroC72()
  else if (c72.modo === 'votar') atarAtrilC72()
  else atarLecturaC72()
}

function volverC72() { c72.modo = 'menu'; c72.id = null; c72.datos = null; montarCriba72() }

function introC72() {
  const { criba } = c72.datos
  return `<div class="c72-intro tarjeta">
    <p class="c72-consigna">${esc(criba.consigna)}</p>
    <div class="c72-escala"><span><b>1</b> ${esc(criba.a1)}</span><span class="c72-escala-linea"></span><span>${esc(criba.a6)} <b>6</b></span></div>
    <label class="campo">¿Qué o quién tenés en mente? <small class="tenue">(opcional: queda con tus votos)</small><input id="c72-mente" placeholder="Una persona, un proyecto, una época…" autocomplete="off" data-sin-menciones></label>
    <div class="fila"><button class="btn btn-primario" id="c72-empezar">Empezar</button><small class="tenue">Teclas: 1 a 6 vota y pasa · ← → moverse · D duda · 0 borrar · Esc salir</small></div>
  </div>`
}

function atarIntroC72() {
  const ir = async () => {
    try {
      const s = await api(`/criba72/${c72.id}/empezar`, { enMente: $('#c72-mente').value })
      c72.datos.sesion = s
      c72.modo = 'votar'
      c72.i = primeraSinVotoC72()
      pintarC72()
    } catch (e) { error(e) }
  }
  $('#c72-empezar').onclick = ir
  $('#c72-mente').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ir() } }
}

// ─── el atril: una frase a la vez ───────────────────────────────────────

function atrilC72() {
  const { criba, sesion } = c72.datos
  const n = c72.i + 1
  const voto = sesion.votos[n]
  const duda = !!sesion.dudas[n]
  const hechas = Object.keys(sesion.votos).length
  return `<div class="c72-atril">
    <div class="c72-progreso" title="${hechas} de 72"><i data-ancho="${Math.round((hechas / 72) * 100)}"></i></div>
    <div class="c72-carta tarjeta">
      <div class="c72-num"><span>${n} <small class="tenue">/ 72</small></span>${sesion.enMente ? `<small class="tenue">En mente: ${esc(sesion.enMente)}</small>` : ''}</div>
      <p class="c72-frase">${esc(criba.items[c72.i])}</p>
      <div class="c72-votos" role="radiogroup" aria-label="Tu voto">${[1, 2, 3, 4, 5, 6].map((v) => `<button role="radio" aria-checked="${voto === v}" class="c72-voto${voto === v ? ' on' : ''}" data-voto="${v}"><b>${v}</b></button>`).join('')}</div>
      <div class="c72-anclas-voto"><small>${esc(criba.a1)}</small><small>${esc(criba.a6)}</small></div>
      <div class="c72-acc">
        <button class="btn btn-chico" id="c72-ant" aria-label="Anterior">←</button>
        <button class="btn btn-chico${duda ? ' on' : ''}" id="c72-duda" aria-pressed="${duda}" title="Marcala si dudaste (D)">¿Duda?</button>
        ${voto ? '<button class="btn btn-chico" id="c72-borrar" title="Borrar el voto (0)">Borrar</button>' : ''}
        <button class="btn btn-chico" id="c72-sig" aria-label="Siguiente">→</button>
      </div>
    </div>
    <div class="c72-mapa" aria-label="Las 72">${criba.items.map((_, k) => `<button class="c72-celda${sesion.votos[k + 1] ? ` v${sesion.votos[k + 1]}` : ''}${k === c72.i ? ' actual' : ''}${sesion.dudas[k + 1] ? ' duda' : ''}" data-ir="${k}" title="${k + 1}${sesion.votos[k + 1] ? ` · ${sesion.votos[k + 1]}` : ''}">${sesion.votos[k + 1] ?? ''}</button>`).join('')}</div>
    ${hechas === 72 ? '<div class="c72-fin tarjeta"><b>¡Las 72!</b> <button class="btn btn-primario" id="c72-ver">Ver la lectura</button></div>' : hechas >= 36 ? '<p class="tenue chico c72-fin-aviso">Con la mitad ya hay lectura (pestaña Lectura), pero completa dice mucho más.</p>' : ''}
  </div>`
}

function atarAtrilC72() {
  $$('[data-voto]').forEach((b) => (b.onclick = () => votarC72(Number(b.dataset.voto))))
  $$('[data-ir]').forEach((b) => (b.onclick = () => { c72.i = Number(b.dataset.ir); pintarC72() }))
  $('#c72-ant').onclick = () => moverC72(-1)
  $('#c72-sig').onclick = () => moverC72(1)
  $('#c72-duda').onclick = dudaC72
  $('#c72-borrar')?.addEventListener('click', () => votarC72(null))
  $('#c72-ver')?.addEventListener('click', () => abrirC72(c72.id, 'lectura'))
}

function moverC72(d) { c72.i = (c72.i + d + 72) % 72; pintarC72() }

/** El voto se ve al instante; el pedido va en fila (en orden) y si falla, se avisa y se recarga lo que hay. */
function votarC72(voto) {
  const s = c72.datos.sesion
  const n = c72.i + 1
  if (voto == null) delete s.votos[n]; else s.votos[n] = voto
  enviarC72({ n, voto })
  if (voto != null) c72.i = primeraSinVotoC72(c72.i + 1)
  if (Object.keys(s.votos).length === 72 && voto != null) toast('¡Las 72! Mirá la lectura.', 'suave')
  pintarC72()
}

function dudaC72() {
  const s = c72.datos.sesion
  const n = c72.i + 1
  const duda = !s.dudas[n]
  if (duda) s.dudas[n] = true; else delete s.dudas[n]
  enviarC72({ n, voto: s.votos[n] ?? null, duda })
  pintarC72()
}

function enviarC72(cuerpo) {
  const sid = c72.datos.sesion.id
  c72.cola = c72.cola.then(() => api(`/criba72/sesion/${sid}/votar`, cuerpo)).then((s) => {
    if (c72.datos?.sesion?.id === sid) c72.datos.sesion.estado = s.estado
  }).catch((e) => { error(e); if (c72.id) abrirC72(c72.id, c72.modo) })
}

async function reiniciarC72() {
  if (!(await confirmar('¿Reiniciar la criba?', { si: 'Reiniciar', detalle: 'Estos votos quedan archivados en el historial y la criba vuelve a cero.' }))) return
  try { await api(`/criba72/${c72.id}/reiniciar`, {}); abrirC72(c72.id, 'intro') } catch (e) { error(e) }
}

// ─── la lectura ─────────────────────────────────────────────────────────

function lecturaC72() {
  const { metricas: m, sesion } = c72.datos
  if (!sesion || !m.votadas) return '<div class="vacio tarjeta"><p>Todavía no votaste.</p></div>'
  const max = Math.max(1, ...m.dist)
  const pct = (x) => Math.round((x / m.votadas) * 100)
  const par = (p) => `<li class="c72-par c72-${p.clase}"><span class="c72-par-t">${esc(p.tension)} <small class="tenue">${p.delta > 0 ? '+' : ''}${p.delta} · carga ${p.carga}</small></span>
    <span class="c72-polo" data-polo="${p.a}"><b>${p.va}</b> ${esc(p.textoA)}</span><span class="c72-polo" data-polo="${p.b}"><b>${p.vb}</b> ${esc(p.textoB)}</span></li>`
  const clases = ['partido', 'tension', 'fria'].map((cl) => {
    const ps = m.pares.filter((p) => p.clase === cl).sort((a, b) => (cl === 'partido' ? Math.abs(b.delta) - Math.abs(a.delta) : cl === 'tension' ? b.carga - a.carga : a.carga - b.carga))
    return `<section class="tarjeta c72-clase"><h3 class="sub">${C72_CLASES[cl][0]} <small class="tenue">${ps.length} · ${C72_CLASES[cl][1]}</small></h3>${ps.length ? `<ul class="c72-pares">${ps.map(par).join('')}</ul>` : '<p class="tenue chico">Ninguno.</p>'}</section>`
  }).join('')
  const s = c72.datos.sesion
  const lectura = s.lectura
    ? `<div class="c72-lectura-txt">${md(s.lectura)}</div>${s.siguiente ? `<div class="c72-siguiente"><span>Para profundizar: <b>${esc(s.siguiente.tema)}</b>${s.siguiente.para ? ` <small class="tenue">${esc(s.siguiente.para)}</small>` : ''}</span><button class="btn btn-primario btn-chico" id="c72-profundizar">Armarla</button></div>` : ''}<div class="fila"><button class="btn btn-chico" id="c72-leer">Leer de nuevo</button></div>`
    : `<p class="tenue">Mastropiero la lee con tu protocolo: forma, extremos, pares, ejes, hasta 3 hipótesis con los ítems que las sostienen y una sola pregunta. Lo que aprenda queda en su memoria (para que lo revises) y la pregunta, en su cola.</p><div class="fila"><button class="btn btn-primario" id="c72-leer" ${m.votadas < 36 ? 'disabled title="Votá al menos la mitad"' : ''}>Que Mastropiero la lea</button></div>`
  return `<div class="c72-lectura">
    <div class="c72-col">
      <section class="tarjeta c72-forma">
        <h3 class="sub">La forma <small class="tenue">${m.votadas} de 72${sesion.enMente ? ` · en mente: ${esc(sesion.enMente)}` : ''}</small></h3>
        <div class="c72-dist">${m.dist.map((x, k) => `<div class="c72-dist-col" title="${x} con ${k + 1}"><span class="c72-dist-n">${x}</span><span class="c72-dist-barra"><i data-alto="${Math.round((x / max) * 100)}"></i></span><b>${k + 1}</b></div>`).join('')}</div>
        <div class="c72-cifras"><span><b>${m.media?.toFixed(2) ?? '—'}</b><small>media</small></span><span><b>${pct(m.altos)}%</b><small>en 5–6</small></span><span><b>${pct(m.bajos)}%</b><small>en 1–2</small></span><span><b>${m.dudas.length}</b><small>dudas</small></span></div>
      </section>
      <section class="tarjeta c72-ejes"><h3 class="sub">Ejes</h3>
        <table class="c72-tabla"><thead><tr><th>Eje</th><th>Media</th><th title="Partidos">Part.</th><th title="Tensiones vivas">Tens.</th><th title="Zonas frías">Fría</th></tr></thead>
        <tbody>${m.ejes.map((e) => `<tr><td>${esc(e.nombre)}</td><td>${e.media?.toFixed(1) ?? '—'}</td><td>${e.partido || ''}</td><td>${e.tension || ''}</td><td>${e.fria || ''}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="tarjeta c72-mastro"><h3 class="sub">${ico('sparkles')} Lectura de Mastropiero</h3><div id="c72-mastro">${lectura}</div></section>
    </div>
    <div class="c72-col">${clases}
      <details class="tarjeta c72-estructura"><summary>Estructura completa <small class="tenue">(tocá un polo para cambiar su voto)</small></summary>
        ${m.ejes.map((e, ei) => `<h4>${esc(e.nombre)}</h4><ul class="c72-pares">${m.pares.filter((p) => p.eje === ei).map((p) => `<li class="c72-par${p.clase ? ` c72-${p.clase}` : ''}"><span class="c72-par-t">${esc(p.tension)}</span><span class="c72-polo" data-polo="${p.a}"><b>${p.va ?? '–'}</b> ${esc(p.textoA)}</span><span class="c72-polo" data-polo="${p.b}"><b>${p.vb ?? '–'}</b> ${esc(p.textoB)}</span></li>`).join('')}</ul>`).join('')}
      </details>
    </div>
  </div>`
}

function atarLecturaC72() {
  $$('[data-alto]').forEach((e) => (e.style.height = `${e.dataset.alto}%`))
  $$('[data-polo]').forEach((b) => { b.tabIndex = 0; b.onclick = () => { c72.i = Number(b.dataset.polo) - 1; c72.modo = 'votar'; pintarC72() } })
  $('#c72-leer')?.addEventListener('click', leerC72)
  $('#c72-profundizar')?.addEventListener('click', () => {
    const sg = c72.datos.sesion.siguiente
    armarC72({ tema: sg.tema, para: sg.para ?? '', padreId: c72.id, grupo: c72.datos.criba.grupo })
    toast(`Armando «${esc(sg.tema)}»<small>Te aviso cuando esté.</small>`, 'suave')
  })
  if (c72.trabajo?.que === 'leer' && c72.trabajo.id === c72.id) seguirLecturaC72()
}

async function leerC72() {
  try {
    const r = await api(`/criba72/${c72.id}/leer`, {})
    c72.trabajo = { clave: r.trabajo, que: 'leer', id: c72.id }
    seguirLecturaC72()
  } catch (e) { error(e) }
}

async function seguirLecturaC72() {
  const t = c72.trabajo
  if (!t || t.que !== 'leer') return
  const caja = $('#c72-mastro')
  if (caja && c72.id === t.id) caja.innerHTML = '<p class="tenue cargando-vista" role="status">Mastropiero está leyendo tu criba… (un minuto)</p>'
  const r = await api(`/criba72/trabajo/${encodeURIComponent(t.clave)}`).catch(() => ({ estado: 'andando' }))
  if (r.estado === 'andando') return setTimeout(seguirLecturaC72, 3000)
  c72.trabajo = null
  if (r.estado !== 'listo') { toast(esc(r.error ?? 'Se perdió la lectura. Probá de nuevo.'), 'error'); if (vista === 'criba72' && c72.id === t.id) abrirC72(t.id, 'lectura'); return }
  toast('Lectura lista', 'suave')
  if (vista === 'criba72' && c72.id === t.id) abrirC72(t.id, 'lectura')
}

// ─── exportar ───────────────────────────────────────────────────────────

function modalExportarC72() {
  abrirModal(`<h2>Exportar la criba</h2>
    <p class="tenue">Con tus votos, las métricas y el protocolo de lectura (para leerla vos o pasársela a otra IA).</p>
    <div class="seg-formatos">${[['json', 'JSON', 'para otra app o IA'], ['md', 'Markdown', 'para leer o pegar en un chat'], ['txt', 'Texto plano', 'para cualquier lado']].map(([f, n, d]) => `<button class="seg-formato" data-c72-fmt="${f}"><b>${n}</b><small class="tenue">${d}</small></button>`).join('')}</div>
    <div class="fila"><button class="btn" id="c72-copiar">Copiar en Markdown</button><span></span><button class="btn" data-cerrar>Cerrar</button></div>`)
  const traer = (formato) => api(`/criba72/${c72.id}/exportar`, { formato })
  $$('[data-c72-fmt]').forEach((b) => (b.onclick = async () => {
    try {
      const f = b.dataset.c72Fmt
      const r = await traer(f)
      const [contenido, tipo] = f === 'json' ? [JSON.stringify(r.datos, null, 2), 'application/json'] : [r.texto, f === 'md' ? 'text/markdown' : 'text/plain']
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([contenido], { type: `${tipo};charset=utf-8` }))
      a.download = `criba-${(c72.datos.criba.titulo || 'criba').toLowerCase().replace(/[^a-z0-9áéíóúñü]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.${f}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { error(e) }
  }))
  $('#c72-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText((await traer('md')).texto); toast('Copiada', 'suave') } catch (e) { error(e) }
  }
}

// ─── teclado (como tu artefacto) ────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (vista !== 'criba72' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || !$('#velo').hidden || document.querySelector('.dialogo-velo')) return
  if (e.key === 'Escape' && c72.modo !== 'menu') { e.preventDefault(); return volverC72() }
  if (c72.modo !== 'votar') return
  if (/^[1-6]$/.test(e.key)) { e.preventDefault(); votarC72(Number(e.key)) }
  else if (e.key === '0' || e.key === 'Backspace') { e.preventDefault(); votarC72(null) }
  else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); moverC72(1) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); moverC72(-1) }
  else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); dudaC72() }
  else if (e.key === 'l') { e.preventDefault(); abrirC72(c72.id, 'lectura') }
})
