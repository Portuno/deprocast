'use strict'
// La Academia: cada dominio que querés aprender tiene un tutor de seis niveles (del niño de 10 a la frontera). Arriba, lo
// que te conviene aprender (lo propone y vos aceptás); después tus dominios como naipes, con la escalera de niveles. Un
// dominio abre su clase (explicación, el visual del Taller, preguntas con devolución), el examen, sus fuentes y visuales.
// Idiomas es un dominio más, con su propia pestaña.

const aca = { tab: 'dominios', datos: null, dominio: null, sondeo: null }

function montarAprender() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Academia</h1><p>Tus dominios, cada uno con un tutor de seis niveles. Cada clase deja su pieza en el corpus, tarjetas para repasar y un quántomo para La Mano.</p></div>
    <div class="tabs" id="aca-tabs">${[['dominios', 'Dominios'], ['repaso', 'Repaso']].map(([k, n]) => `<button data-tab="${k}" class="${aca.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div id="aca-cuerpo"></div>`
  $$('#aca-tabs button').forEach((b) => (b.onclick = () => { aca.tab = b.dataset.tab; aca.dominio = null; montarAprender() }))
  pintarAprender()
}

async function pintarAprender() {
  const cont = $('#aca-cuerpo')
  if (!cont) return
  clearTimeout(aca.sondeo)
  if (aca.tab === 'repaso') {
    try { pintarRepaso(cont, await api('/aprender')) } catch (e) { error(e) }
    return
  }
  if (aca.dominio) return pintarDominio(aca.dominio)
  try { aca.datos = await api('/academia') } catch (e) { return error(e) }
  const { dominios, sugeridos } = aca.datos
  const activos = dominios.filter((d) => d.estado === 'activo')
  const quietos = dominios.filter((d) => d.estado !== 'activo')
  cont.innerHTML = `
    <div class="fila aca-acciones"><button class="btn btn-primario" id="aca-sumar">＋ Sumar un dominio</button><button class="btn" id="aca-sugerir">💡 ¿Qué me conviene aprender?</button></div>
    ${sugeridos.length ? `<section class="seccion"><h3>Sugeridos para vos</h3><div class="aca-grid">${sugeridos.map(naipeSugerido).join('')}</div></section>` : ''}
    ${activos.length ? `<div class="aca-grid">${activos.map(naipeDominio).join('')}</div>` : '<div class="vacio"><div class="gran">🎓</div><h2>Tu Academia está vacía</h2><p>Sumá algo que quieras aprender (y para qué), o pedí que te proponga qué te conviene según lo que viene en tu agenda y tus metas.</p></div>'}
    ${quietos.length ? `<details class="seccion aca-quietos"><summary>En pausa (${quietos.length})</summary><div class="aca-grid">${quietos.map(naipeDominio).join('')}</div></details>` : ''}`
  $('#aca-sumar').onclick = modalSumarDominio
  $('#aca-sugerir').onclick = sugerirDominios
  $$('[data-aca-aceptar]', cont).forEach((b) => (b.onclick = async () => { b.disabled = true; try { const d = await api(`/academia/${b.dataset.acaAceptar}/aceptar`, {}); toast(`${esc(d.tema)} entra a tu Academia<small>Su primera clase y sus fuentes se preparan de fondo.</small>`, 'suave'); pintarAprender() } catch (e) { b.disabled = false; error(e) } }))
  $$('[data-aca-descartar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/academia/${b.dataset.acaDescartar}/descartar`, {}); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-aca-abrir]', cont).forEach((b) => (b.onclick = (e) => { e.preventDefault(); aca.dominio = Number(b.dataset.acaAbrir); pintarAprender() }))
  $$('[data-aca-clase]', cont).forEach((b) => (b.onclick = () => abrirClase(Number(b.dataset.acaClase), !!b.dataset.examen)))
  $$('[data-aca-idioma]', cont).forEach((b) => (b.onclick = () => irA('idiomas')))
  $$('[data-aca-estado]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/aprender/${b.dataset.acaEstado}`, { estado: b.dataset.a }); pintarAprender() } catch (e) { error(e) } }))
}

/** La escalera de los seis niveles, con el actual marcado. */
function escalera(nivel) {
  const niveles = aca.datos?.niveles ?? []
  return `<ol class="aca-escalera" title="${esc(niveles.map((n) => `${n.n}. ${n.nombre}`).join(' → '))}">${niveles.map((n) => `<li class="${n.n < nivel ? 'hecho' : n.n === nivel ? 'actual' : ''}" title="${n.n}. ${esc(n.nombre)}"></li>`).join('')}</ol>`
}

function naipeSugerido(d) {
  const s = d.sugerencia ?? {}
  return `<article class="naipe aca-naipe aca-sugerido" data-madurez="proto">
    <header><h3>${esc(d.tema)}</h3>${s.horizonte ? `<span class="chip">${esc(s.horizonte)} plazo</span>` : ''}</header>
    <p>${esc(s.porQue ?? d.porQue ?? '')}</p>
    ${s.para ? `<p class="tenue chico">Para ${esc(s.para)}${s.fecha ? ` · ${esc(s.fecha)}` : ''}</p>` : ''}
    ${s.primerPaso ? `<p class="chico">Primera clase: ${esc(s.primerPaso)}</p>` : ''}
    <div class="fila"><button class="btn btn-primario btn-chico" data-aca-aceptar="${d.id}">✓ Lo aprendo</button><button class="btn btn-chico" data-aca-descartar="${d.id}">✕ No</button></div>
  </article>`
}

function naipeDominio(d) {
  if (d.idioma) return `<article class="naipe aca-naipe" data-madurez="pesado">
    <header><h3>🗣 ${esc(d.tema.replace(/^Idioma · /, ''))}</h3><span class="chip">Idiomas</span></header>
    <p class="tenue chico">Tiene su propio tutor, con cómo se lee y cómo suena.</p>
    <div class="fila"><button class="btn btn-chico" data-aca-idioma="${d.id}">Abrir en Idiomas →</button></div></article>`
  const madurez = d.tutorNivel >= 5 ? 'nucleo' : d.tutorNivel >= 3 ? 'sellado' : 'pesado'
  return `<article class="naipe aca-naipe ${d.estado}" data-madurez="${d.estado === 'activo' ? madurez : ''}">
    <header><h3><a href="#" data-aca-abrir="${d.id}">${esc(d.tema)}</a></h3><span class="chip">Nivel ${d.tutorNivel} · ${esc(d.nivelNombre)}</span></header>
    ${escalera(d.tutorNivel)}
    ${d.porQue ? `<p class="aca-porque">«${esc(d.porQue)}»</p>` : ''}
    <p class="chico">${d.temaSiguiente ? `Sigue: <b>${esc(d.temaSiguiente)}</b>${d.sesionLista ? ' <span class="tenue">(lista)</span>' : ''}` : '<span class="tenue">La primera clase arma el temario del nivel.</span>'}</p>
    <div class="aca-metricas tenue chico"><span>${d.clases} clase${d.clases === 1 ? '' : 's'}</span>${d.diasSinPracticar != null ? `<span>hace ${d.diasSinPracticar} día${d.diasSinPracticar === 1 ? '' : 's'}</span>` : ''}${d.tarjetasHoy ? `<span>🃏 ${d.tarjetasHoy} para hoy</span>` : ''}</div>
    <div class="fila">${d.estado === 'activo' ? `<button class="btn btn-primario btn-chico" data-aca-clase="${d.id}">▶ Clase</button>${d.examen ? `<button class="btn btn-chico" data-aca-clase="${d.id}" data-examen="1">📝 Examen</button>` : ''}` : ''}
      <button class="btn btn-chico" data-aca-abrir="${d.id}">Ver dominio</button>
      <button class="btn btn-chico" data-aca-estado="${d.id}" data-a="${d.estado === 'activo' ? 'pausado' : 'activo'}">${d.estado === 'activo' ? 'Pausar' : 'Reactivar'}</button></div>
  </article>`
}

function modalSumarDominio() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Un dominio nuevo</h2>
    <p class="tenue">Arrancás en el nivel 1 (como a un chico de 10) y subís con un examen cuando dos clases seguidas te salen bien.</p>
    <form id="aca-form">
      <label class="campo">Qué querés aprender<input name="tema" required placeholder="Electricidad, drones, biomecánica…"></label>
      <label class="campo">Para qué (guía el temario y las fuentes)<textarea name="porQue" rows="2" placeholder="Ej.: armar mi primer drone para el evento de noviembre"></textarea></label>
      <button class="btn btn-primario">Sumar</button>
    </form>`)
  $('#aca-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { await api('/academia', f); cerrarModal(); toast('Sumado a tu Academia', 'suave'); pintarAprender() } catch (e) { error(e) }
  }
}

async function sugerirDominios() {
  const b = $('#aca-sugerir')
  if (b) b.disabled = true
  toast('Mirando tu agenda, tus metas y el Radar…', 'suave')
  try {
    const r = await api('/academia/sugerir', {})
    toast(r.sugeridos.length ? `Te propuse ${r.sugeridos.length}<small>Están arriba (y en 📥 Para validar).</small>` : 'Nada nuevo para proponerte ahora', 'suave')
    pintarAprender()
  } catch (e) { error(e) } finally { if (b) b.disabled = false }
}

// ─── un dominio ─────────────────────────────────────────────────────────

async function pintarDominio(id) {
  let r
  try { r = await api(`/academia/${id}`) } catch (e) { aca.dominio = null; return error(e) }
  if (!aca.datos) { try { aca.datos = await api('/academia') } catch { /* sin escalera */ } }
  // Mientras llegaba, pudo cambiar la vista (o abrirse otra cosa): se pinta solo si sigue siendo este dominio.
  const cont = $('#aca-cuerpo')
  if (!cont || aca.dominio !== id) return
  const d = r.dominio
  const hechas = r.sesiones.filter((s) => s.estado === 'hecha')
  cont.innerHTML = `<div class="aca-dominio">
    <header class="aca-dom-cab"><button class="btn btn-chico" id="aca-volver">←</button><div class="f1"><h2>${esc(d.tema)}</h2>${d.porQue ? `<small class="tenue">${esc(d.porQue)}</small>` : ''}</div><span class="chip">Nivel ${d.tutorNivel} · ${esc(d.nivelNombre)}</span></header>
    ${escalera(d.tutorNivel)}
    <div class="fila aca-acciones">
      ${d.estado === 'activo' ? `<button class="btn btn-primario" data-aca-clase="${d.id}">▶ Clase</button>${r.examen ? `<button class="btn" data-aca-clase="${d.id}" data-examen="1">📝 Examen del nivel</button>` : ''}` : ''}
      <button class="btn" id="aca-tarjetas">🃏 Repasar tarjetas</button>
      <button class="btn" id="aca-fuentes" title="Busca material a tu nivel y lo suma al corpus (en la nube)">🔎 Buscar fuentes</button>
    </div>
    ${!r.examen && d.estado === 'activo' ? '<p class="tenue chico">El examen se habilita con dos clases seguidas del nivel resueltas con 80 % o más.</p>' : ''}
    <section class="seccion"><h3>Clases</h3>${hechas.length ? hechas.map((s) => `<div class="fila item"><span class="f1">${s.tipo === 'examen' ? '📝 ' : ''}${esc(s.tema)}</span><small class="tenue">nivel ${s.nivel}${s.puntaje != null ? ` · ${Math.round(s.puntaje * 100)} %` : ''} · ${new Date(s.cerradaEn ?? s.creadaEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</small>${s.piezaId ? `<a href="#" class="ref" data-pieza="${s.piezaId}">pieza</a>` : ''}</div>`).join('') : '<p class="tenue">Todavía ninguna.</p>'}</section>
    <section class="seccion"><h3>Visuales</h3>${r.visuales.length ? `<div class="aca-visuales">${r.visuales.map((a) => `<button class="aca-vis ${a.estado}" data-vis="${a.id}"><b>${esc(a.titulo)}</b><small>${esc(a.meta.clase ?? '')}${a.meta.valoracion ? ` · ${'★'.repeat(a.meta.valoracion)}` : ''}${a.meta.sellado ? ' · sellado' : ''}${a.estado === 'haciendo' ? ' · en el horno' : a.estado === 'fallo' ? ' · no salió' : ''}</small></button>`).join('')}</div>` : '<p class="tenue">Cuando una clase pide un dibujo, el Taller lo hace y queda acá.</p>'}</section>
    <section class="seccion"><div class="aca-sec-cab"><h3>Material</h3><button class="btn btn-chico" id="aca-material">＋ Material</button></div>${materialHTML(r.recursos.material)}</section>
    <section class="seccion"><h3>Relacionado en tu archivo</h3>${fuentesHTML(r.recursos)}</section>
  </div>`
  $('#aca-volver', cont).onclick = () => { aca.dominio = null; pintarAprender() }
  $$('[data-aca-clase]', cont).forEach((b) => (b.onclick = () => abrirClase(d.id, !!b.dataset.examen)))
  $('#aca-tarjetas', cont).onclick = () => repasarTarjetas(`aprender:${d.id}`)
  $('#aca-fuentes').onclick = async () => {
    const b = $('#aca-fuentes')
    b.disabled = true
    try { const f = await api(`/academia/${d.id}/fuentes`, {}); toast(f.nuevas.length ? `${f.nuevas.length} fuente${f.nuevas.length === 1 ? '' : 's'} nueva${f.nuevas.length === 1 ? '' : 's'} al corpus` : (f.aviso ?? 'Nada nuevo esta vez'), 'suave'); pintarDominio(d.id) } catch (e) { error(e) } finally { b.disabled = false }
  }
  $$('[data-pieza]', cont).forEach((x) => (x.onclick = (e) => { e.preventDefault(); modalPieza(Number(x.dataset.pieza)) }))
  $('#aca-material', cont).onclick = () => modalMaterial(d)
  $$('[data-mat]', cont).forEach((b) => (b.onclick = async () => {
    const cuerpo = b.dataset.accion === 'quitar' ? { quitar: true } : { util: Number(b.dataset.accion) }
    try { await api(`/academia/${d.id}/material/${b.dataset.mat}`, cuerpo); pintarDominio(d.id) } catch (e) { error(e) }
  }))
  $$('[data-vis]', cont).forEach((b) => (b.onclick = () => fichaVisual(r.visuales.find((a) => a.id === Number(b.dataset.vis)), () => pintarDominio(d.id))))
}

function fuentesHTML(rec) {
  const lista = [...rec.obras.map((o) => `📖 ${esc(o.titulo)}${o.autor ? ` — ${esc(o.autor)}` : ''} <small class="tenue">(${esc(o.estado)})</small>`), ...rec.piezas.map((p) => `<a href="#" class="ref" data-pieza="${p.id}">${esc(p.titulo)}</a>${p.por?.includes('sentido') ? ' <small class="tenue">por sentido</small>' : ''}`)]
  return lista.length ? `<ul class="aca-fuentes">${lista.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="tenue">Nada que hable de esto en tu Librería ni en el corpus.</p>'
}

const ORIGEN_MAT = { operador: 'tuyo', libro: 'libro', busqueda: 'búsqueda' }

/** El material del dominio: lo que sumaste y lo que encontró la búsqueda, con 👍/👎 (lo que no sirve, el tutor no lo usa). */
function materialHTML(ms) {
  if (!ms?.length) return '<p class="tenue">Sumale libros, textos, links o archivos: el tutor arma las clases sobre eso y cita de dónde sale. «Buscar fuentes» trae material a tu nivel.</p>'
  return `<ul class="aca-material">${ms.map((m) => `<li class="${m.util === -1 ? 'no-sirve' : ''}">
    <span class="chip">${ORIGEN_MAT[m.origen] ?? esc(m.origen)}</span>
    ${m.piezaId ? `<a href="#" class="ref f1" data-pieza="${m.piezaId}">${esc(m.titulo)}</a>` : `<span class="f1">📖 ${esc(m.titulo)}</span>`}
    ${m.palabras ? `<small class="tenue">${m.palabras.toLocaleString('es-AR')} palabras</small>` : ''}
    <button class="btn btn-chico btn-icono ${m.util === 1 ? 'on' : ''}" data-mat="${m.id}" data-accion="${m.util === 1 ? 0 : 1}" title="Sirve">👍</button>
    <button class="btn btn-chico btn-icono ${m.util === -1 ? 'on' : ''}" data-mat="${m.id}" data-accion="${m.util === -1 ? 0 : -1}" title="No sirve (el tutor no lo usa)">👎</button>
    <button class="btn btn-chico btn-icono" data-mat="${m.id}" data-accion="quitar" title="Quitar del dominio (sigue en tu corpus)">✕</button></li>`).join('')}</ul>`
}

/** Sumar material: un link, un texto, un archivo (PDF, Word…) o una obra de tu Librería. */
function modalMaterial(d) {
  let modo = 'link'
  const pintar = () => {
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Material para ${esc(d.tema)}</h2>
      <p class="tenue">El tutor arma las clases sobre esto (si es un libro, sigue su enfoque) y cita de dónde sale.</p>
      <div class="tabs">${[['link', 'Link'], ['texto', 'Texto'], ['archivo', 'Archivo'], ['obra', 'De tu Librería']].map(([k, n]) => `<button data-modo="${k}" class="${modo === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <form id="aca-mat-form" class="mt-3">
        ${modo === 'link' ? '<label class="campo">Link (una página, un video, un Google Doc, un PDF en la web)<input name="url" type="url" required placeholder="https://…"></label>'
          : modo === 'texto' ? '<label class="campo">Título<input name="titulo" placeholder="Apuntes de…"></label><label class="campo">Texto<textarea name="texto" rows="8" required minlength="40" placeholder="Pegá el texto acá"></textarea></label>'
          : modo === 'archivo' ? '<label class="campo">Archivo (PDF, Word, texto; hasta 30 MB)<input name="archivo" type="file" required accept=".pdf,.docx,.txt,.md,.pptx,.xlsx,.csv"></label>'
          : '<label class="campo">Buscá en tu Librería<input name="q" id="aca-obra-q" placeholder="Título o autor" data-sin-menciones></label><div id="aca-obras" class="aca-obras"></div>'}
        ${modo === 'obra' ? '' : '<button class="btn btn-primario">Sumar</button>'}
      </form>`)
    $$('[data-modo]').forEach((b) => (b.onclick = () => { modo = b.dataset.modo; pintar() }))
    const listo = (m) => { cerrarModal(); toast(`Sumado<small>${m.length} cosa${m.length === 1 ? '' : 's'} en el material de ${esc(d.tema)}</small>`, 'suave'); pintarDominio(d.id) }
    $('#aca-mat-form').onsubmit = async (ev) => {
      ev.preventDefault()
      const f = ev.target
      const b = $('button.btn-primario', f)
      if (b) b.disabled = true
      try {
        let cuerpo
        if (modo === 'archivo') {
          const archivo = f.archivo.files[0]
          const sub = await fetch(`/api/chat/archivo?nombre=${encodeURIComponent(archivo.name)}`, { method: 'POST', body: archivo }).then((r) => r.json())
          if (sub.error) throw new Error(sub.error)
          cuerpo = { archivo: sub.url, nombre: sub.nombre }
        } else cuerpo = Object.fromEntries(new FormData(f))
        listo((await api(`/academia/${d.id}/material`, cuerpo)).material)
      } catch (e) { error(e) } finally { if (b) b.disabled = false }
    }
    const q = $('#aca-obra-q')
    if (q) {
      let t
      const buscarObras = async () => {
        try {
          const r = await api(`/libreria?q=${encodeURIComponent(q.value.trim())}`)
          const obras = (r.obras ?? []).slice(0, 12)
          $('#aca-obras').innerHTML = obras.length ? obras.map((o) => `<button type="button" class="aca-obra" data-obra="${o.id}"><b>${esc(o.titulo)}</b><small class="tenue">${esc([o.tipo, o.autor].filter(Boolean).join(' · '))}</small></button>`).join('') : '<p class="tenue chico">Nada con eso en tu Librería.</p>'
          $$('[data-obra]').forEach((x) => (x.onclick = async () => { try { listo((await api(`/academia/${d.id}/material`, { obraId: Number(x.dataset.obra) })).material) } catch (e) { error(e) } }))
        } catch (e) { error(e) }
      }
      q.oninput = () => { clearTimeout(t); t = setTimeout(buscarObras, 250) }
      buscarObras()
      q.focus()
    }
  }
  pintar()
}

// ─── el visual: verlo, valorarlo y mejorarlo ────────────────────────────

const ESTRELLAS = [1, 2, 3, 4, 5]

/** El visual de la clase (o «en el horno», o «solo texto»), con ★ y Mejorar cuando está listo. */
function visualHTML(v) {
  if (!v) return ''
  if (v.estado === 'listo') return `<iframe class="aca-iframe" sandbox="allow-scripts" src="${esc(v.url)}" title="El visual de la clase"></iframe>
    <div class="fila aca-valorar"><span class="tenue chico">¿Te sirvió?</span>${ESTRELLAS.map((n) => `<button class="btn btn-chico btn-icono ${(v.valoracion ?? 0) >= n ? 'on' : ''}" data-estrella="${n}" title="${n} de 5${n >= 4 ? ' (queda sellado: es la referencia de este concepto)' : ''}">★</button>`).join('')}
      <button class="btn btn-chico" data-mejorar>Mejorar</button><a class="btn btn-chico" href="${esc(v.url)}" target="_blank" rel="noopener">Pantalla completa</a></div>`
  if (v.estado === 'haciendo') return `<div class="aca-horno"><span class="pensando"><span><i></i><i></i><i></i></span></span><p>El visual está en el horno del Taller${v.progreso ? `: ${esc(v.progreso)}` : ''}.</p><small class="tenue">Seguí con la explicación: aparece solo cuando esté.</small></div>`
  if (v.estado === 'fallo') return `<p class="aviso">El visual no salió${v.progreso ? `: ${esc(v.progreso)}` : ''}.</p>`
  return `<div class="aca-horno"><p>Solo texto por ahora: ${esc(v.motivo ?? 'el visual queda para después')}.</p><small class="tenue">Se vuelve a pedir la próxima vez que abras la clase.</small></div>`
}

/** Engancha ★ y Mejorar de un visual listo. luego: qué repintar después. */
function engancharVisual(cont, artefactoId, luego) {
  $$('[data-estrella]', cont).forEach((b) => (b.onclick = async () => {
    const n = Number(b.dataset.estrella)
    const nota = n <= 3 ? await preguntar('¿Qué le faltó? (sirve para mejorarlo)', '', { placeholder: 'Más grande, menos texto, que se vea la corriente…', ok: 'Guardar' }) : ''
    if (nota === null) return
    try { await api(`/taller/${artefactoId}/valorar`, { estrellas: n, nota: nota || null }); toast(n >= 4 ? 'Sellado<small>Es la referencia de este concepto: se reusa.</small>' : 'Anotado', 'suave'); luego?.() } catch (e) { error(e) }
  }))
  const m = $('[data-mejorar]', cont)
  if (m) m.onclick = async () => {
    const cambio = await preguntar('¿Qué cambio? Sale una versión nueva por la cola del Taller.', '', { largo: true, placeholder: 'Que muestre la corriente con flechas animadas…', ok: 'Mejorar' })
    if (!cambio?.trim()) return
    try { await api(`/taller/${artefactoId}/iterar`, { cambio }); toast('Nueva versión en el horno', 'suave'); luego?.() } catch (e) { error(e) }
  }
}

function fichaVisual(a, luego) {
  if (!a) return
  const v = { estado: a.estado, url: `/taller/${a.id}/index.html`, progreso: a.progreso, valoracion: a.meta.valoracion ?? null }
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${esc(a.titulo)}</h2><p class="tenue chico">${esc(a.pedido)}</p>${visualHTML(v)}`)
  $('#modal').classList.add('modal-ancho')
  engancharVisual($('#modal'), a.id, () => { cerrarModal(); luego?.() })
}

// ─── la clase ───────────────────────────────────────────────────────────

/** Las citas del tutor ([#123]) como links a la pieza (el texto ya viene escapado). */
const citas = (html) => html.replace(/\[#(\d+)\]/g, '<a href="#" class="ref" data-pieza="$1">[#$1]</a>')

/** Abre la clase (o el examen): si estaba lista, al instante; si no, el tutor la arma (unos segundos). */
async function abrirClase(id, examen = false) {
  aca.dominio = id
  const cont = $('#aca-cuerpo')
  if (!cont) return
  clearTimeout(aca.sondeo)
  cont.innerHTML = `<div class="aca-preparando"><span class="pensando"><span><i></i><i></i><i></i></span></span><p>${examen ? 'Armando el examen del nivel…' : 'Abriendo tu clase (si no estaba lista, el tutor la arma: unos segundos)…'}</p></div>`
  let r
  try { r = await api(`/academia/${id}/sesion`, examen ? { examen: true } : {}) } catch (e) { error(e); return pintarDominio(id) }
  if (aca.dominio === id) pintarClase(r)
}

function pintarClase(r) {
  const cont = $('#aca-cuerpo')
  if (!cont) return
  const s = r.sesion
  const p = s.paquete
  const turno = (i) => [...r.turnos].reverse().find((t) => t.i === i)
  cont.innerHTML = `<div class="aca-clase">
    <header class="aca-dom-cab"><button class="btn btn-chico" id="aca-volver">←</button><div class="f1"><h2>${s.tipo === 'examen' ? '📝 ' : ''}${esc(p.tema)}</h2><small class="tenue">Nivel ${s.nivel}${s.tipo === 'examen' ? ' · aprobás con 4 de 5' : ''}</small></div></header>
    <div class="aca-clase-cuerpo ${r.visual ? 'con-visual' : ''}">
      <section class="aca-expl">${(p.explicacion || '').split(/\n{2,}/).map((x) => `<p>${citas(esc(x))}</p>`).join('')}
        ${p.fuentes?.length ? `<p class="tenue chico">Sale de: ${p.fuentes.map((id) => `<a href="#" class="ref" data-pieza="${id}">#${id}</a>`).join(' · ')}</p>` : ''}
        ${p.ejemplos?.length ? `<h4>Ejemplos</h4><ul>${p.ejemplos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>
      ${r.visual ? `<aside class="aca-visual" id="aca-visual">${visualHTML(r.visual)}</aside>` : ''}
    </div>
    <section class="aca-preguntas"><h3>${s.tipo === 'examen' ? 'El examen' : 'Para chequear'}</h3>
      ${p.preguntas.map((q, i) => { const t = turno(i); return `<form class="aca-pregunta ${t ? (t.correcto ? 'bien' : 'mal') : ''}" data-i="${i}">
        <p><b>${i + 1}.</b> ${esc(q.pregunta)}</p>
        <div class="fila"><textarea class="campo-suelto f1" name="respuesta" rows="2" placeholder="Con tus palabras…" ${s.estado === 'hecha' ? 'disabled' : ''}>${esc(t?.respuesta ?? '')}</textarea>${s.estado === 'hecha' ? '' : `<button class="btn btn-chico">${t ? 'De nuevo' : 'Responder'}</button>`}</div>
        <div class="aca-devolucion">${t ? `${t.correcto ? '✓' : '✗'} ${esc(t.devolucion)}` : ''}</div></form>` }).join('')}
    </section>
    ${s.estado === 'hecha' ? '' : `<div class="fila"><button class="btn btn-primario" id="aca-cerrar">✋ Cerrar ${s.tipo === 'examen' ? 'el examen' : 'la clase'}</button><small class="tenue">Queda en tu corpus, con tarjetas para repasar.</small></div>`}
    <div id="aca-cierre"></div>
  </div>`
  $('#aca-volver').onclick = () => { clearTimeout(aca.sondeo); pintarDominio(s.aprendizajeId) }
  $$('[data-pieza]', cont).forEach((x) => (x.onclick = (e) => { e.preventDefault(); modalPieza(Number(x.dataset.pieza)) }))
  if (r.visual?.estado === 'listo') engancharVisual($('#aca-visual'), r.visual.artefactoId, () => refrescarVisual(s.id))
  if (r.visual?.estado === 'haciendo') esperarVisual(s.id)
  $$('.aca-pregunta', cont).forEach((f) => (f.onsubmit = async (ev) => {
    ev.preventDefault()
    const respuesta = f.respuesta.value.trim()
    if (!respuesta) return
    const b = $('button', f)
    b.disabled = true
    $('.aca-devolucion', f).innerHTML = '<span class="tenue">El tutor está leyendo…</span>'
    try {
      const d = await api(`/academia/sesion/${s.id}/responder`, { i: Number(f.dataset.i), respuesta })
      r.turnos.push({ i: d.i, respuesta, correcto: d.correcto, devolucion: d.devolucion })
      f.classList.toggle('bien', d.correcto)
      f.classList.toggle('mal', !d.correcto)
      $('.aca-devolucion', f).innerHTML = `${d.correcto ? '✓' : '✗'} ${esc(d.devolucion)}`
      b.textContent = 'De nuevo'
    } catch (e) { $('.aca-devolucion', f).innerHTML = ''; error(e) } finally { b.disabled = false }
  }))
  $$('.aca-pregunta textarea', cont).forEach((t) => t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); t.form.requestSubmit() } }))
  const cerrar = $('#aca-cerrar')
  if (cerrar) cerrar.onclick = async () => {
    const sin = p.preguntas.length - new Set(r.turnos.map((t) => t.i)).size
    if (sin && !(await confirmar(`Te ${sin === 1 ? 'queda una pregunta' : `quedan ${sin} preguntas`} sin responder. ¿Cerrar igual?`, { si: 'Cerrar' }))) return
    cerrar.disabled = true
    try {
      const c = await api(`/academia/sesion/${s.id}/cerrar`, {})
      clearTimeout(aca.sondeo)
      $('#aca-cierre').innerHTML = `<section class="seccion aca-resumen naipe" data-madurez="${c.subio ? 'nucleo' : 'sellado'}">
        <h3>${s.tipo === 'examen' ? (c.subio ? `🎉 Subiste al nivel ${c.nivel}` : 'Todavía no') : `Clase cerrada: ${Math.round(c.puntaje * 100)} %`}</h3>
        <p>${[c.tarjetas ? `${c.tarjetas} tarjeta${c.tarjetas === 1 ? '' : 's'} para repasar` : '', c.quantomos ? `${c.quantomos} quántomo${c.quantomos === 1 ? '' : 's'} para La Mano` : '', 'la pieza en tu corpus'].filter(Boolean).join(' · ')}.</p>
        ${c.repasar?.length ? `<p>Para repasar antes de volver a intentarlo:</p><ul>${c.repasar.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${c.examen && s.tipo !== 'examen' ? '<p><b>El examen del nivel está habilitado.</b></p>' : ''}
        <div class="fila"><button class="btn btn-primario" id="aca-otra">▶ Otra clase</button><button class="btn" id="aca-al-dominio">Volver al dominio</button></div></section>`
      $$('.aca-pregunta textarea, .aca-pregunta button', cont).forEach((x) => (x.disabled = true))
      cerrar.parentElement.remove()
      $('#aca-otra').onclick = () => abrirClase(s.aprendizajeId)
      $('#aca-al-dominio').onclick = () => pintarDominio(s.aprendizajeId)
    } catch (e) { cerrar.disabled = false; error(e) }
  }
}

/** Mientras el visual está en el horno, se mira cada pocos segundos (solo con la pestaña a la vista). */
function esperarVisual(sid) {
  clearTimeout(aca.sondeo)
  aca.sondeo = setTimeout(() => cuandoSeVea(() => refrescarVisual(sid)), 4000)
}

async function refrescarVisual(sid) {
  const el = $('#aca-visual')
  if (!el || vista !== 'aprender') return
  let r
  try { r = await api(`/academia/sesion/${sid}`) } catch { return esperarVisual(sid) }
  el.innerHTML = visualHTML(r.visual)
  if (r.visual?.estado === 'listo') engancharVisual(el, r.visual.artefactoId, () => refrescarVisual(sid))
  else if (r.visual?.estado === 'haciendo') esperarVisual(sid)
}

// ─── el repaso espaciado (lo que contaste que estudiaste) ───────────────

function pintarRepaso(cont, d) {
  const tocan = d.repaso.filter((p) => p.toca)
  const vienen = d.repaso.filter((p) => !p.toca)
  cont.innerHTML = `
    <p class="tenue">Lo que le contás a Mastropiero que estudiaste vuelve como pregunta en 1, 3, 7 y 16 días. Las tarjetas de cada dominio se repasan desde su página.</p>
    <section class="seccion"><h3>Para repasar ahora (${tocan.length})</h3>
      ${tocan.length ? tocan.map((p) => `<form class="apr-rep" data-rep="${p.id}"><b>${esc(p.texto)}</b><small class="tenue">${esc(p.porQue ?? '')} · vuelta ${p.vuelta + 1} de 4</small>
        <div class="fila"><input name="respuesta" placeholder="De memoria…" class="f1"><button class="btn btn-chico btn-primario">Responder</button><button class="btn btn-chico" type="button" data-saltar="${p.id}">Mañana</button></div></form>`).join('') : '<p class="tenue">Nada para repasar ahora.</p>'}</section>
    ${vienen.length ? `<section class="seccion"><h3>Vienen</h3>${vienen.map((p) => `<div class="fila item"><span class="f1">${esc(p.texto)}</span><small class="tenue">${new Date(p.vuelveEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</small></div>`).join('')}</section>` : ''}`
  $$('[data-rep]', cont).forEach((f) => (f.onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/repaso/${f.dataset.rep}`, { respuesta: f.respuesta.value }); toast('Bien. Vuelve más adelante.', 'suave'); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-saltar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/repaso/${b.dataset.saltar}`, { respuesta: null }); pintarAprender() } catch (e) { error(e) } }))
}
