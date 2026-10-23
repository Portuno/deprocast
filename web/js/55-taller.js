'use strict'
// El Taller: arriba se elige qué crear (y se arma en su mesa de trabajo), en el medio lo que está en el horno, abajo la
// Librería de todo lo hecho (cada obra con sus versiones). Tocar una obra abre su ficha.

const TIPO_TALLER = {
  juego: { glifo: '▶', nombre: 'Juego', linea: 'Algo para jugar acá mismo', ayuda: 'Describí el juego: mecánica, estética, de qué se trata.' },
  imagen: { glifo: '▣', nombre: 'Imagen', linea: 'Una o varias, en el formato que quieras', ayuda: 'Qué querés ver: sujeto, composición, colores.' },
  voz: { glifo: '♪', nombre: 'Voz', linea: 'Un texto leído o una charla a dos voces', ayuda: 'El texto que querés escuchar leído.' },
  personaje: { glifo: '☺', nombre: 'Personaje', linea: 'Ficha, retrato y voz, para reusar', ayuda: 'Quién es: rol, carácter, estética. O elegí a alguien de tu mundo abajo.' },
  video: { glifo: '▤', nombre: 'Video', linea: 'Guion, imágenes, voz y montaje', ayuda: 'De qué trata el video: el mensaje, el tono, para quién.' },
  visual: { glifo: '◈', nombre: 'Visual', linea: 'Un concepto dibujado, para tocar', ayuda: 'Qué concepto y qué tiene que mostrar: «un circuito con pila y lámpara; tocar cada pieza la explica».' },
  estudio: { glifo: '🎬', nombre: 'Estudio', linea: 'Posproducí un video: tuyo o del Taller', vista: true },
}
const tl = { tipo: null, filtro: '', q: '', datos: null, firma: '', sondeo: null, entidad: null, sugerencias: null }

async function montarTaller() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Taller</h1><p>Lo que Mastropiero crea con vos. Elegí qué hacer ahora, o abrí algo de tu Librería para seguirlo.</p></div></div>
    <section class="tl-crear"><h3 class="tl-h">¿Qué creamos?</h3><div class="tl-tipos" id="tl-tipos"></div><div id="tl-mesa"></div></section>
    <section id="tl-horno"></section>
    <section class="tl-libreria">
      <div class="tl-lib-cab"><h3 class="tl-h">Librería</h3>
        <div class="fila"><div class="chips" id="tl-filtros"></div><input class="campo-suelto" id="tl-q" placeholder="Buscar…" value="${esc(tl.q)}"></div></div>
      <div id="tl-lista"></div>
    </section>`
  let t
  $('#tl-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { tl.q = e.target.value; traerTaller(true) }, 250) }
  await traerTaller(true)
  if (tl.tipo) abrirMesa(tl.tipo)
}

function pintarTipos() {
  const c = tl.datos?.cuenta ?? {}
  $('#tl-tipos').innerHTML = Object.entries(TIPO_TALLER).map(([k, x]) => `<button class="tl-tipo ${tl.tipo === k ? 'on' : ''}" data-tl-tipo="${k}">
    <span class="tl-glifo">${x.glifo}</span><b>${x.nombre}</b><small>${x.linea}</small><em>${c[k] ? `${c[k]} ${x.vista ? 'proyectos' : 'en la Librería'}` : 'Todavía nada'}</em></button>`).join('')
  $$('[data-tl-tipo]').forEach((b) => (b.onclick = () => (TIPO_TALLER[b.dataset.tlTipo].vista ? ((es.id = null), irA('estudio')) : abrirMesa(tl.tipo === b.dataset.tlTipo ? null : b.dataset.tlTipo))))
  $('#tl-filtros').innerHTML = [['', 'Todo'], ...Object.entries(TIPO_TALLER).map(([k, x]) => [k, `${x.glifo} ${x.nombre}`])]
    .map(([k, n]) => `<button class="chip ${tl.filtro === k ? 'on' : ''}" data-tl-filtro="${k}">${n}</button>`).join('')
  $$('[data-tl-filtro]').forEach((b) => (b.onclick = () => { tl.filtro = b.dataset.tlFiltro; traerTaller(true) }))
}

// ─── la mesa de trabajo ─────────────────────────────────────────────────

const segmentado = (nombre, opciones, valor) => `<div class="tl-seg" data-seg="${nombre}">${opciones.map(([k, n]) => `<button type="button" class="${k === valor ? 'on' : ''}" data-v="${esc(k)}">${n}</button>`).join('')}</div>`
const valorSeg = (nombre) => $(`[data-seg="${nombre}"] .on`)?.dataset.v ?? null
const personajesListos = () => (tl.datos?.obras ?? []).map((o) => o.ultima).filter((a) => a.tipo === 'personaje' && a.estado === 'listo')
const opcionesVoz = (sel) => Object.entries(tl.datos?.voces ?? {}).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('')
const campoEntidad = (etq) => `<label class="campo tl-ent">${etq}<input id="tl-ent" list="tl-ents" placeholder="Buscá una persona, un proyecto…" value="${esc(tl.entidad?.nombre ?? '')}"><datalist id="tl-ents"></datalist></label>`

function abrirMesa(tipo, o = {}) {
  tl.tipo = tipo
  tl.sugerencias = null
  if (!o.entidad) tl.entidad = null
  else tl.entidad = o.entidad
  pintarTipos()
  const m = $('#tl-mesa')
  if (!tipo) return void (m.innerHTML = '')
  const x = TIPO_TALLER[tipo]
  const d = tl.datos
  const extra = {
    imagen: () => `<div class="tl-op"><span>Formato</span>${segmentado('aspecto', Object.entries(d.aspectos).map(([k, n]) => [k, `${n} ${k}`]), '1:1')}</div>
      <div class="tl-op"><span>Estilo</span>${segmentado('estilo', [['', 'Libre'], ...Object.entries(d.estilos)], '')}</div>
      <div class="tl-op"><span>Cuántas</span>${segmentado('variantes', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], '1')}<span>Calidad</span>${segmentado('modelo', [['flux-2-klein', 'Rápida'], ['qwen-image-2.1', 'Detallada']], 'flux-2-klein')}</div>`,
    voz: () => `<div class="tl-op"><span>Qué</span>${segmentado('modo', [['leer', 'Leer un texto'], ['charla', 'Charla a dos voces']], o.modo ?? 'leer')}</div>
      <div class="tl-op" id="tl-voces"></div>`,
    personaje: () => `<div class="tl-op">${campoEntidad('Que salga de alguien o algo de tu mundo (opcional)')}</div>`,
    video: () => `<div class="tl-op"><span>Formato</span>${segmentado('formato', [['16:9', 'Apaisado 16:9'], ['9:16', 'Vertical 9:16'], ['1:1', 'Cuadrado 1:1']], o.formato ?? '16:9')}</div>
      <div class="tl-op"><span>Escenas</span>${segmentado('escenas', [['', 'Que decida'], ['3', '3'], ['5', '5'], ['8', '8']], '')}<label class="tenue chico"><input type="checkbox" id="tl-mov" checked> movimiento (acercamiento suave)</label></div>
      <div class="tl-op"><span>Voz</span><select class="campo-suelto" id="tl-voz">${opcionesVoz('em_alex')}</select>
        <select class="campo-suelto" id="tl-pj"><option value="">Sin personaje</option>${personajesListos().map((a) => `<option value="${a.id}" ${String(o.personajeId) === String(a.id) ? 'selected' : ''}>Con ${esc(a.titulo)}</option>`).join('')}</select></div>`,
    visual: () => `<div class="tl-op"><span>Clase</span>${segmentado('clase', [['diagrama', 'Diagrama (piezas y relaciones)'], ['simulacion', 'Simulación (algo que se mueve)'], ['movimiento', 'Movimiento (el cuerpo)']], o.clase ?? 'diagrama')}</div>`,
    juego: () => `<div class="tl-op"><select class="campo-suelto" id="tl-pj"><option value="">Sin protagonista</option>${personajesListos().map((a) => `<option value="${a.id}" ${String(o.personajeId) === String(a.id) ? 'selected' : ''}>Protagonista: ${esc(a.titulo)}</option>`).join('')}</select>
      ${campoEntidad('Sobre algo de tu mundo (opcional)')}</div>`,
  }[tipo]
  m.innerHTML = `<div class="tl-mesa">
    <div class="tl-mesa-cab"><span class="tl-glifo">${x.glifo}</span><b>${x.nombre}</b><button class="btn btn-chico" id="tl-sugerir" title="Mastropiero propone 3 cosas desde tus proyectos e ideas">💡 Sugerime desde mi archivo</button></div>
    <div id="tl-sug"></div>
    <textarea class="campo-suelto" id="tl-pedido" rows="3" placeholder="${esc(x.ayuda)}">${esc(o.pedido ?? '')}</textarea>
    ${extra()}
    <div class="fila"><button class="btn btn-primario" id="tl-crear">Crear ${x.nombre.toLowerCase()}</button><span class="tenue chico">${tipo === 'video' ? (d.ffmpeg ? 'Sale un mp4 listo para el Estudio.' : 'Sin ffmpeg sale una presentación (imágenes + voz).') : 'Corre de fondo: lo ves en el horno.'}</span></div>
  </div>`
  $$('.tl-seg', m).forEach((g) => $$('button', g).forEach((b) => (b.onclick = () => { $$('button', g).forEach((y) => y.classList.toggle('on', y === b)); if (g.dataset.seg === 'modo') pintarVoces() })))
  const pintarVoces = () => {
    const c = $('#tl-voces')
    if (!c) return
    const charla = valorSeg('modo') === 'charla'
    c.innerHTML = charla
      ? `<span>Voces</span><select class="campo-suelto" id="tl-va">${opcionesVoz('em_alex')}</select><select class="campo-suelto" id="tl-vb">${opcionesVoz('ef_dora')}</select>`
      : `<span>Voz</span><select class="campo-suelto" id="tl-voz">${opcionesVoz('em_alex')}</select>`
    $('#tl-pedido').placeholder = charla ? 'El tema de la charla (sale de lo que hay en tu archivo sobre eso).' : x.ayuda
  }
  pintarVoces()
  const ent = $('#tl-ent')
  if (ent) ent.oninput = async () => {
    const q = ent.value.trim()
    const elegida = [...$('#tl-ents').options].find((op) => op.value === q)
    if (elegida) return void (tl.entidad = { id: Number(elegida.dataset.id), nombre: q })
    tl.entidad = null
    if (q.length < 2) return
    try { const r = await api(`/entidades?q=${encodeURIComponent(q)}&limite=10`); $('#tl-ents').innerHTML = r.entidades.map((e) => `<option value="${esc(e.nombre)}" data-id="${e.id}">${esc(e.tipo)}</option>`).join('') } catch { /* sin sugerencias */ }
  }
  $('#tl-sugerir').onclick = async () => {
    const b = $('#tl-sugerir')
    b.disabled = true
    $('#tl-sug').innerHTML = '<p class="tenue chico"><span class="pensando"><span><i></i><i></i><i></i></span></span> Mirando tus proyectos e ideas…</p>'
    try {
      const r = await api(`/taller/sugerencias?tipo=${tipo}`)
      $('#tl-sug').innerHTML = r.sugerencias.length ? `<div class="tl-sugs">${r.sugerencias.map((s, i) => `<button class="tl-sugerida" data-sug="${i}"><b>${esc(s.titulo)}</b><small>${esc(s.pedido)}</small></button>`).join('')}</div>` : '<p class="tenue chico">No se me ocurrió nada con lo que hay. Cargá más de tus proyectos.</p>'
      $$('[data-sug]', m).forEach((s) => (s.onclick = () => { $('#tl-pedido').value = r.sugerencias[Number(s.dataset.sug)].pedido; $('#tl-pedido').focus() }))
    } catch (e) { $('#tl-sug').innerHTML = ''; error(e) } finally { b.disabled = false }
  }
  $('#tl-crear').onclick = async () => {
    const pedido = $('#tl-pedido').value.trim()
    if (!pedido && !(tipo === 'personaje' && tl.entidad)) return toast('Contame qué querés crear', 'error')
    const cuerpo = {
      tipo, pedido, entidadId: tl.entidad?.id ?? null, personajeId: $('#tl-pj')?.value || null, voz: $('#tl-voz')?.value,
      aspecto: valorSeg('aspecto'), estilo: valorSeg('estilo') || null, variantes: Number(valorSeg('variantes') ?? 1), modelo: valorSeg('modelo'),
      modo: valorSeg('modo'), voces: $('#tl-va') ? [$('#tl-va').value, $('#tl-vb').value] : undefined,
      formato: valorSeg('formato'), escenas: valorSeg('escenas') || null, movimiento: $('#tl-mov')?.checked ?? true, clase: valorSeg('clase'),
    }
    try {
      const r = await api('/taller', cuerpo)
      $('#tl-pedido').value = ''
      if (r.desdeCache) toast('Ese concepto ya estaba dibujado<small>Está en tu Librería (se reusa en vez de gastar de nuevo).</small>', 'suave')
      else toast(`${x.nombre} a la cola del Taller<small>Se hace de a uno; te aviso cuando esté.</small>`, 'suave')
      traerTaller()
    } catch (e) { error(e) }
  }
  $('#tl-pedido').focus()
}

// ─── el horno y la librería ─────────────────────────────────────────────

const urlTaller = (a, n) => `/taller/${a.id}/${encodeURIComponent(n)}`
const imagenDe = (a) => a.archivos.find((n) => /\.(png|jpe?g)$/.test(n))

function miniatura(a) {
  if (a.estado === 'fallo') return `<div class="tl-mini tl-mini-icono">✕</div>`
  const img = imagenDe(a)
  if (img) return `<div class="tl-mini"><img src="${urlTaller(a, img)}" alt="" loading="lazy">${a.archivos.filter((n) => /\.(png|jpe?g)$/.test(n)).length > 1 && a.tipo === 'imagen' ? `<em>${a.archivos.length}</em>` : ''}</div>`
  return `<div class="tl-mini tl-mini-icono">${TIPO_TALLER[a.tipo]?.glifo ?? '·'}</div>`
}

async function traerTaller(forzar = false) {
  const cont = $('#tl-lista')
  if (!cont) return
  let d
  try { d = await api(`/taller?${new URLSearchParams({ tipo: tl.filtro, q: tl.q })}`) } catch (e) { return error(e) }
  const antes = tl.datos
  tl.datos = d
  // El horno: lo que se está haciendo; cuando algo sale, aviso.
  const firma = JSON.stringify([d.haciendo.map((a) => [a.id, a.progreso]), d.cola.enEspera.map((t) => t.id)])
  clearTimeout(tl.sondeo)
  if (d.haciendo.length || d.cola.enEspera.length) tl.sondeo = setTimeout(() => cuandoSeVea(() => vista === 'taller' && traerTaller()), 3000)
  if (antes) {
    const salieron = antes.haciendo.filter((a) => !d.haciendo.some((x) => x.id === a.id))
    if (salieron.length) toast(`Listo en el Taller<small>${esc(salieron.map((a) => a.titulo).join(', '))}</small>`)
  }
  if (!forzar && firma === tl.firma) return
  tl.firma = firma
  pintarTipos()
  $('#tl-horno').innerHTML = pintarHorno(d)
  cont.innerHTML = d.obras.length ? `<div class="tl-grid">${d.obras.map((o) => {
    const a = o.ultima
    return `<button class="tl-obra ${a.estado}" data-obra="${o.raiz}">${miniatura(a)}
      <span class="tl-obra-txt"><span class="tipo-chip">${TIPO_TALLER[a.tipo]?.glifo ?? ''} ${esc(TIPO_TALLER[a.tipo]?.nombre ?? a.tipo)}</span><b>${esc(a.titulo)}</b>
      <small>${o.versiones.length > 1 ? `v${a.version} · ${o.versiones.length} versiones · ` : ''}${new Date(a.creadoEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}${a.estado === 'haciendo' ? ' · en el horno' : a.estado === 'fallo' ? ' · no salió' : ''}</small></span></button>`
  }).join('')}</div>` : `<div class="vacio"><div class="gran">✎</div><h2>${tl.filtro || tl.q ? 'Nada con ese filtro' : 'La Librería está vacía'}</h2><p>Elegí arriba qué crear. Todo lo que hagas queda acá, con sus versiones.</p></div>`
  $$('[data-obra]', cont).forEach((b) => (b.onclick = () => {
    const o = d.obras.find((x) => x.raiz === Number(b.dataset.obra))
    if (o?.ultima.tipo === 'estudio') { es.id = o.raiz; return irA('estudio') }
    fichaObra(Number(b.dataset.obra))
  }))
}

const ORIGEN_COLA = { pantalla: 'a mano', chat: 'desde el chat' }
const origenCola = (o) => (o?.startsWith('tutor') ? 'para tu clase' : ORIGEN_COLA[o] ?? o ?? '')
const duracion = (ms) => (ms == null ? '' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`)

/** El horno: lo que se está haciendo (de a uno o dos), lo que espera su turno y lo último que salió (con cuánto tardó). */
function pintarHorno(d) {
  const c = d.cola
  const haciendo = d.haciendo
  if (!haciendo.length && !c.enEspera.length && !c.ultimos.length) return ''
  return `<div class="tl-horno"><div class="tl-horno-cab"><h3 class="tl-h">En el horno: ${haciendo.length}${c.enEspera.length ? ` · en espera: ${c.enEspera.length}` : ''}</h3><small class="tenue">De a ${c.paralelo} a la vez, de fondo: crear no frena al resto.</small></div>
    ${haciendo.map((a) => `<div class="tl-hornada"><span class="tl-glifo">${TIPO_TALLER[a.tipo]?.glifo ?? ''}</span><b>${esc(a.titulo)}</b><span class="pensando"><span><i></i><i></i><i></i></span></span><small>${esc(a.progreso ?? 'trabajando')}…</small></div>`).join('')}
    ${c.enEspera.map((t, i) => `<div class="tl-hornada tl-espera"><span class="tl-glifo">${i + 1}</span><b>${esc(t.titulo)}</b><small class="tenue">${esc(origenCola(t.origen))} · espera su turno</small></div>`).join('')}
    ${c.ultimos.length ? `<details class="tl-registro"><summary>Lo último que salió</summary>${c.ultimos.map((t) => `<div class="fila item"><span class="f1">${t.estado === 'fallo' ? '✕' : '✓'} ${esc(t.titulo)}</span><small class="tenue">${esc(origenCola(t.origen))}${t.ms != null ? ` · ${duracion(t.ms)}` : ''}${t.tokens ? ` · ${t.tokens.toLocaleString('es-AR')} tokens` : ''}${t.error ? ` · ${esc(t.error.slice(0, 80))}` : ''}</small></div>`).join('')}</details>` : ''}
  </div>`
}

// ─── la ficha de una obra ───────────────────────────────────────────────

function vistaGrande(a) {
  if (a.estado === 'haciendo') return `<div class="tl-haciendo"><span class="pensando"><span><i></i><i></i><i></i></span></span>${esc(a.progreso ?? 'trabajando')}…</div>`
  if (a.estado === 'fallo') return `<p class="aviso">No salió: ${esc(a.progreso ?? '')}</p>`
  if (a.tipo === 'visual') return `<iframe class="tl-juego" sandbox="allow-scripts" src="${urlTaller(a, 'index.html')}" title="${esc(a.titulo)}"></iframe>`
  if (a.tipo === 'juego') return `<iframe class="tl-juego" sandbox="allow-scripts allow-pointer-lock" src="${urlTaller(a, 'index.html')}" title="${esc(a.titulo)}"></iframe>`
  if (a.tipo === 'video') return a.archivos.includes('video.mp4') ? `<video controls src="${urlTaller(a, 'video.mp4')}"></video>` : `<iframe class="tl-juego" sandbox="allow-scripts" src="${urlTaller(a, 'presentacion.html')}"></iframe>`
  const imgs = a.archivos.filter((n) => /\.(png|jpe?g)$/.test(n))
  const audio = a.archivos.find((n) => /\.mp3$/.test(n))
  return `${imgs.length ? `<div class="tl-imgs n${Math.min(imgs.length, 4)}">${imgs.map((n) => `<a href="${urlTaller(a, n)}" target="_blank" rel="noopener"><img src="${urlTaller(a, n)}" alt="${esc(a.titulo)}" loading="lazy" decoding="async"></a>`).join('')}</div>` : ''}
    ${audio ? `<audio controls src="${urlTaller(a, audio)}"></audio>` : ''}
    ${a.meta?.ficha ? `<div class="tl-ficha-pj"><p>${esc(a.meta.ficha.descripcion ?? '')}</p>${a.meta.ficha.personalidad?.length ? `<p class="tenue chico">${a.meta.ficha.personalidad.map(esc).join(' · ')}</p>` : ''}<p><i>«${esc(a.meta.ficha.frase ?? '')}»</i></p></div>` : ''}
    ${a.meta?.guion?.length && a.tipo === 'voz' ? `<details class="tl-guion"><summary>Guion</summary>${a.meta.guion.map((t) => `<p><b>${esc(tl.datos?.voces?.[t.voz]?.split(' ')[0] ?? t.voz)}:</b> ${esc(t.texto)}</p>`).join('')}</details>` : ''}`
}

async function fichaObra(raiz, verId = null) {
  await traerTaller(true)
  const o = tl.datos.obras.find((x) => x.raiz === raiz) ?? (await api('/taller')).obras.find((x) => x.raiz === raiz)
  if (!o) return toast('Esa obra ya no está', 'error')
  const id = verId ?? o.ultima.id
  const a = id === o.ultima.id ? o.ultima : tl.datos.artefactos.find((x) => x.id === id) ?? o.ultima
  const meta = [a.meta?.aspecto && `Formato ${a.meta.aspecto}`, a.meta?.formato && `Formato ${a.meta.formato}`, a.meta?.estilo && `Estilo ${tl.datos.estilos?.[a.meta.estilo] ?? a.meta.estilo}`, a.meta?.voz && tl.datos.voces?.[a.meta.voz], a.meta?.escenas && `${a.meta.escenas} escenas`, a.meta?.plantilla && (a.meta.plantilla === 'libre' ? 'Dibujado a mano' : `Plantilla: ${a.meta.plantilla}`)].filter(Boolean)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <div class="tl-ficha">
      <div class="tl-ficha-vista">${vistaGrande(a)}</div>
      <div class="tl-ficha-lado">
        <span class="tipo-chip">${TIPO_TALLER[a.tipo]?.glifo ?? ''} ${esc(TIPO_TALLER[a.tipo]?.nombre ?? a.tipo)}</span>
        <h2>${esc(a.titulo)}</h2>
        <p class="tenue chico">${esc(a.pedido.slice(0, 400))}</p>
        ${meta.length ? `<p class="chico">${meta.map(esc).join(' · ')}</p>` : ''}
        ${o.versiones.length > 1 ? `<div class="tl-versiones"><small class="tenue">Versiones</small>${o.versiones.map((v) => `<button class="${v.id === a.id ? 'on' : ''} ${v.estado}" data-ver="${v.id}" title="${new Date(v.creadoEn).toLocaleString('es-AR')}">v${v.version}</button>`).join('')}</div>` : ''}
        ${a.tipo === 'visual' && a.estado === 'listo' ? `<div class="fila aca-valorar"><span class="tenue chico">¿Te sirvió?</span>${[1, 2, 3, 4, 5].map((n) => `<button class="btn btn-chico btn-icono ${(a.meta?.valoracion ?? 0) >= n ? 'on' : ''}" data-tl-estrella="${n}" title="${n} de 5${n >= 4 ? ' (queda sellado: la referencia del concepto)' : ''}">★</button>`).join('')}${a.meta?.sellado ? '<span class="chip">sellado</span>' : ''}</div>${a.meta?.nota ? `<p class="tenue chico">Tu nota: ${esc(a.meta.nota)}</p>` : ''}` : ''}
        ${a.estado === 'listo' ? `<div class="tl-cambio"><textarea class="campo-suelto" id="tlf-cambio" rows="2" placeholder="Pedí un cambio (sale una versión nueva)…"></textarea><button class="btn btn-primario btn-chico" id="tlf-iterar">Nueva versión</button></div>
          <div class="fila tl-acciones">
            ${a.tipo === 'juego' || a.tipo === 'visual' ? `<a class="btn btn-chico" href="${urlTaller(a, 'index.html')}" target="_blank" rel="noopener">Pantalla completa</a>` : ''}
            ${a.tipo === 'personaje' ? '<button class="btn btn-chico" data-usar="video">▤ Video con este personaje</button><button class="btn btn-chico" data-usar="juego">▶ Juego con este personaje</button>' : ''}
            ${a.tipo === 'video' && a.archivos.includes('video.mp4') ? '<button class="btn btn-chico btn-primario" id="tlf-estudio">🎬 Posproducir en el Estudio</button>' : ''}
            <button class="btn btn-chico" id="tlf-corpus" title="Guardarlo en tu corpus">❦ Al corpus</button>
          </div>
          <details class="tl-archivos"><summary>Archivos (${a.archivos.length})</summary>${a.archivos.map((n) => `<a href="${urlTaller(a, n)}" download="${esc(n)}">${esc(n)}</a>`).join('')}</details>` : ''}
        ${a.estado !== 'haciendo' ? `<button class="btn btn-chico tl-borrar" id="tlf-borrar">Borrar ${o.versiones.length > 1 ? `la v${a.version}` : 'esta obra'}</button>` : ''}
      </div>
    </div>`)
  $('#modal').classList.add('modal-ancho')
  $$('[data-ver]').forEach((b) => (b.onclick = () => fichaObra(raiz, Number(b.dataset.ver))))
  const it = $('#tlf-iterar')
  if (it) it.onclick = async () => {
    const cambio = $('#tlf-cambio').value.trim()
    if (!cambio) return toast('Decime qué cambiar', 'error')
    try { await api(`/taller/${a.id}/iterar`, { cambio }); cerrarModal(); toast('Nueva versión en el horno', 'suave'); traerTaller(true) } catch (e) { error(e) }
  }
  $$('[data-tl-estrella]').forEach((b) => (b.onclick = async () => {
    const n = Number(b.dataset.tlEstrella)
    const nota = n <= 3 ? await preguntar('¿Qué le faltó? (sirve para mejorarlo)', a.meta?.nota ?? '', { ok: 'Guardar' }) : ''
    if (nota === null) return
    try { await api(`/taller/${a.id}/valorar`, { estrellas: n, nota: nota || null }); toast(n >= 4 ? 'Sellado<small>Es la referencia de este concepto: se reusa.</small>' : 'Anotado', 'suave'); fichaObra(raiz, a.id) } catch (e) { error(e) }
  }))
  const est = $('#tlf-estudio')
  if (est) est.onclick = async () => { try { const n = await api('/estudio/nuevo', { desdeArtefacto: a.id }); cerrarModal(); es.id = n.id; irA('estudio') } catch (e) { error(e) } }
  const co = $('#tlf-corpus')
  if (co) co.onclick = async () => { try { await api(`/taller/${a.id}/corpus`, {}); toast('Guardado en el corpus', 'suave') } catch (e) { error(e) } }
  $$('[data-usar]').forEach((b) => (b.onclick = () => { cerrarModal(); abrirMesa(b.dataset.usar, { personajeId: a.id }); $('#tl-mesa').scrollIntoView({ behavior: 'smooth' }) }))
  const bo = $('#tlf-borrar')
  if (bo) bo.onclick = async () => {
    if (!(await confirmar(`¿Borrar ${o.versiones.length > 1 ? `la versión ${a.version} de` : ''} «${a.titulo}»?`, { detalle: 'Se borran sus archivos.', si: 'Borrar', peligro: true }))) return
    try { await api(`/taller/${a.id}/borrar`, {}); cerrarModal(); toast('Borrado', 'suave'); traerTaller(true) } catch (e) { error(e) }
  }
}

function refrescarTaller() {}
