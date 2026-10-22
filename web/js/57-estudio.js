'use strict'
// El Estudio: posproducción de un video. A la izquierda las capas, en el centro el lienzo (el video con las capas
// encima, que se arrastran) y la línea de tiempo, a la derecha el inspector de la capa elegida. Abajo, el agente: una
// frase y arma o cambia capas. Exportar arma el mp4 en el servidor (cada exportación es una versión).

const TIPO_CAPA = {
  subtitulos: { g: '💬', n: 'Subtítulos' }, titulo: { g: '▭', n: 'Zócalo (nombre y rol)' }, texto: { g: 'T', n: 'Texto' }, imagen: { g: '▣', n: 'Logo o imagen' },
  qr: { g: '▦', n: 'QR' }, color: { g: '◐', n: 'Color' }, cartel: { g: '●', n: 'Cartel (en vivo, rec)' }, chat: { g: '☰', n: 'Chat' }, alerta: { g: '★', n: 'Alerta' }, progreso: { g: '▬', n: 'Barra de progreso' },
}
const FILTRO_CSS = {
  sepia: (k) => `sepia(${k})`, contraste: (k) => `contrast(${1 + 0.35 * k}) saturate(${1 + 0.15 * k})`, vintage: (k) => `sepia(${0.35 * k}) saturate(${1 - 0.2 * k}) contrast(${1 + 0.05 * k})`,
  noir: (k) => `grayscale(1) contrast(${1 + 0.3 * k})`, cyberpunk: (k) => `saturate(${1 + 0.4 * k}) hue-rotate(${-15 * k}deg) contrast(${1 + 0.1 * k})`, cine: (k) => `contrast(${1 + 0.12 * k}) saturate(${1 - 0.12 * k}) sepia(${0.08 * k})`,
}
const es = { id: null, d: null, p: null, sel: null, guardando: null, sondeo: null, base: null }

async function montarEstudio() {
  clearTimeout(es.sondeo)
  if (es.id) return abrirEstudio(es.id)
  let b
  try { b = await api('/estudio') } catch (e) { return error(e) }
  es.base = b
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>🎬 Estudio</h1><p>Posproducí un video: subtítulos automáticos, zócalos, logo, QR, color, chat, alertas. Le decís la vibra y lo arma; lo exportás vertical, cuadrado o apaisado.</p></div>
      <div class="fila"><button class="btn btn-chico" onclick="irA('taller')">← Taller</button></div></div>
    <section class="es-nuevo">
      <label class="es-subir" id="es-subir"><input type="file" accept="video/*" hidden id="es-archivo"><b>⇪ Subí un video tuyo</b><small>O arrastralo acá. Se sube por partes; puede ser largo.</small><span id="es-subiendo"></span></label>
      <div class="es-desde"><h3 class="tl-h">O uno del Taller</h3>${b.videos.length ? `<div class="es-videos">${b.videos.map((v) => `<button class="es-video" data-desde="${v.id}"><video src="/taller/${v.id}/video.mp4#t=1" muted preload="metadata"></video><span>${esc(v.titulo)}</span></button>`).join('')}</div>` : '<p class="tenue chico">Todavía no hay videos del Taller con mp4.</p>'}</div>
    </section>
    <h3 class="tl-h">Tus proyectos</h3>
    ${b.proyectos.length ? `<div class="tl-grid">${b.proyectos.map((o) => {
      const a = o.ultima
      const mini = a.archivos.includes('miniatura.jpg') ? `<img src="/taller/${a.id}/miniatura.jpg" alt="">` : `<video src="/taller/${a.meta?.proyecto?.fuente?.artefacto ?? a.id}/fuente.mp4#t=1" muted preload="metadata"></video>`
      return `<button class="tl-obra" data-es="${o.raiz}"><div class="tl-mini">${mini}</div><span class="tl-obra-txt"><span class="tipo-chip">🎬 ${esc(a.meta?.proyecto?.formato ?? '')}</span><b>${esc(a.titulo)}</b><small>${o.versiones.length > 1 ? `${o.versiones.length - 1} exportaciones · ` : ''}${new Date(a.creadoEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</small></span></button>`
    }).join('')}</div>` : '<p class="vacio">Todavía no posprodujiste nada.</p>'}
    <h3 class="tl-h" style="margin-top:22px">Plantillas (tu kit de marca)</h3>
    <div class="es-plantillas">${b.plantillas.map((p) => `<span class="sq"><span><b>${esc(p.nombre)}</b><small>${p.capas.length} capas${p.marca ? ` · ${esc(p.marca.slice(0, 80))}` : ''}</small></span><a class="btn btn-chico" href="/api/estudio/plantillas/${p.id}.zip">⇩ zip</a></span>`).join('') || '<p class="tenue chico">Guardá las capas de un proyecto como plantilla y aplicalas a cualquier video.</p>'}
      <label class="btn btn-chico">⇪ Importar plantilla (.zip)<input type="file" accept=".zip" hidden id="es-importar"></label></div>`
  $$('[data-es]').forEach((x) => (x.onclick = () => abrirEstudio(Number(x.dataset.es))))
  $$('[data-desde]').forEach((x) => (x.onclick = async () => { try { const a = await api('/estudio/nuevo', { desdeArtefacto: Number(x.dataset.desde) }); abrirEstudio(a.id) } catch (e) { error(e) } }))
  const subir = $('#es-subir')
  $('#es-archivo').onchange = (e) => e.target.files[0] && subirVideoEstudio(e.target.files[0])
  subir.ondragover = (e) => { e.preventDefault(); subir.classList.add('sobre') }
  subir.ondragleave = () => subir.classList.remove('sobre')
  subir.ondrop = (e) => { e.preventDefault(); subir.classList.remove('sobre'); if (e.dataTransfer.files[0]) subirVideoEstudio(e.dataTransfer.files[0]) }
  $('#es-importar').onchange = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    try { await fetch('/api/estudio/plantillas/importar', { method: 'POST', body: f }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error) }); toast('Plantilla importada', 'suave'); montarEstudio() } catch (err) { error(err) }
  }
}

/** Sube un video por partes (16 MB) y abre el proyecto nuevo. */
async function subirVideoEstudio(archivo) {
  const sesion = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const PEDAZO = 16 * 1024 * 1024
  const marca = $('#es-subiendo')
  try {
    for (let desde = 0; desde < archivo.size; desde += PEDAZO) {
      marca.textContent = ` ${Math.round((desde / archivo.size) * 100)} %`
      const r = await fetch(`/api/estudio/subir/parte?sesion=${sesion}&desde=${desde}`, { method: 'POST', body: archivo.slice(desde, desde + PEDAZO) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `respondió ${r.status}`)
    }
    marca.textContent = ' leyendo el video…'
    const r = await fetch(`/api/estudio/subir/fin?sesion=${sesion}&total=${archivo.size}&nombre=${encodeURIComponent(archivo.name)}`, { method: 'POST' })
    const a = await r.json()
    if (!r.ok) throw new Error(a.error)
    abrirEstudio(a.id)
  } catch (e) { marca.textContent = ''; error(e) }
}

// ─── el editor ──────────────────────────────────────────────────────────

const dur = () => (es.p.recorte ? es.p.recorte.hasta - es.p.recorte.desde : es.p.duracion)
const capaSel = () => es.p.capas.find((c) => c.id === es.sel) ?? null
const activaEn = (c, t) => c.visible && t >= c.desde && t <= (c.hasta ?? dur())
const tiempo = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`

async function abrirEstudio(id) {
  es.id = id
  if (vista !== 'estudio') return irA('estudio')
  try { es.d = await api(`/estudio/${id}`) } catch (e) { es.id = null; return error(e) }
  es.p = es.d.proyecto
  if (!es.base) es.base = await api('/estudio').catch(() => ({ imagenes: [], plantillas: [], cuentas: [] }))
  const [W, H] = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1] }[es.p.formato]
  $('#principal').innerHTML = `
    <div class="es">
      <div class="es-barra">
        <button class="btn btn-chico" id="es-volver">← Proyectos</button>
        <input class="campo-suelto es-titulo" id="es-titulo" value="${esc(es.d.artefacto.titulo)}">
        ${segmentado('es-formato', [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']], es.p.formato)}
        ${segmentado('es-encuadre', [['recorte', 'Recortar'], ['desenfoque', 'Con fondo']], es.p.encuadre)}
        <span class="espacio"></span>
        <button class="btn btn-chico" id="es-deshacer" ${es.p.puedeDeshacer ? '' : 'disabled'}>↶ Deshacer</button>
        <button class="btn btn-chico" id="es-transcribir">✨ Subtitular</button>
        <button class="btn btn-chico" id="es-momentos" title="Cortes para shorts, desde lo que se dice">✂ Momentos</button>
        <button class="btn btn-primario btn-chico" id="es-exportar" ${es.base?.ffmpeg === false ? 'disabled title="Este servidor no tiene ffmpeg (en la nube sí)"' : ''}>⇩ Exportar</button>
      </div>
      <div class="es-cuerpo">
        <aside class="es-capas"><div class="es-capas-cab"><b>Capas</b><select class="campo-suelto" id="es-agregar"><option value="">＋ Agregar…</option>${Object.entries(TIPO_CAPA).map(([k, x]) => `<option value="${k}">${x.g} ${x.n}</option>`).join('')}</select></div><div id="es-lista"></div>
          <div class="es-plant"><select class="campo-suelto" id="es-aplicar"><option value="">Aplicar plantilla…</option>${(es.base.plantillas ?? []).map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select><button class="btn btn-chico" id="es-guardar-pl">Guardar como plantilla</button></div></aside>
        <div class="es-centro">
          <div class="es-escena"><div class="es-lienzo ${es.p.encuadre}" id="es-lienzo" style="aspect-ratio:${W}/${H}">
            <video class="es-fondo" src="${es.d.fuente}" muted playsinline preload="metadata"></video>
            <video class="es-video" id="es-video" src="${es.d.fuente}" playsinline preload="auto"></video>
            <div class="es-capas-vivas" id="es-vivas"></div>
          </div></div>
          <div class="es-transporte"><button class="btn btn-chico" id="es-play">▶</button><span id="es-t" class="mono">0:00.0</span><input type="range" id="es-scrub" min="0" max="1000" value="0"><span class="mono tenue">${tiempo(dur())}</span></div>
          <div class="es-linea" id="es-linea"></div>
          <div class="es-agente"><input class="campo-suelto" id="es-pedido" placeholder="Decile la vibra: «que parezca un stream de cine», «poné mi nombre abajo», «tono editorial para LinkedIn»…"><button class="btn btn-primario btn-chico" id="es-pedir">Hacelo</button></div>
          <div class="es-respuesta tenue chico" id="es-respuesta"></div>
        </div>
        <aside class="es-inspector" id="es-inspector"></aside>
      </div>
      <div id="es-versiones"></div>
    </div>`
  const v = $('#es-video')
  const fondo = $('.es-fondo')
  const desde = es.p.recorte?.desde ?? 0
  v.addEventListener('loadedmetadata', () => { v.currentTime = desde })
  fondo.addEventListener('loadedmetadata', () => { fondo.currentTime = v.currentTime || desde })
  const tick = () => {
    if (!$('#es-video')) return
    const t = Math.max(0, v.currentTime - desde)
    if (es.p.recorte && v.currentTime >= es.p.recorte.hasta) { v.pause(); v.currentTime = desde }
    if (Math.abs(fondo.currentTime - v.currentTime) > 0.3) fondo.currentTime = v.currentTime
    $('#es-t').textContent = tiempo(t)
    $('#es-scrub').value = String(Math.round((t / dur()) * 1000))
    pintarVivas(t)
    const cab = $('#es-cabezal')
    if (cab) cab.style.left = `${(t / dur()) * 100}%`
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  $('#es-play').onclick = () => { if (v.paused) { v.play(); fondo.play() } else { v.pause(); fondo.pause() } }
  v.onplay = () => ($('#es-play').textContent = '❚❚')
  v.onpause = () => ($('#es-play').textContent = '▶')
  $('#es-scrub').oninput = (e) => { v.currentTime = desde + (Number(e.target.value) / 1000) * dur(); fondo.currentTime = v.currentTime }
  $('#es-volver').onclick = () => { es.id = null; montarEstudio() }
  $('#es-titulo').onchange = (e) => guardarEstudioYa({ titulo: e.target.value })
  $$('.tl-seg button').forEach((b) => (b.onclick = () => {
    const g = b.closest('.tl-seg')
    $$('button', g).forEach((y) => y.classList.toggle('on', y === b))
    if (g.dataset.seg === 'es-formato') { es.p.formato = b.dataset.v; guardarEstudioYa({ formato: es.p.formato }).then(() => abrirEstudio(es.id)) }
    if (g.dataset.seg === 'es-encuadre') { es.p.encuadre = b.dataset.v; $('#es-lienzo').className = `es-lienzo ${es.p.encuadre}`; guardarEstudioYa({ encuadre: es.p.encuadre }) }
  }))
  $('#es-agregar').onchange = (e) => {
    const tipo = e.target.value
    e.target.value = ''
    if (!tipo) return
    if (tipo === 'subtitulos' && es.p.capas.some((c) => c.tipo === 'subtitulos')) return toast('Ya hay subtítulos: usá ✨ Subtitular para rehacerlos', 'suave')
    if (tipo === 'subtitulos') return $('#es-transcribir').click()
    agregarCapa(tipo)
  }
  $('#es-deshacer').onclick = async () => { try { es.p = { ...es.p, ...(await api(`/estudio/${es.id}/deshacer`, {})) }; refrescarEditor() } catch (e) { error(e) } }
  $('#es-pedir').onclick = pedirAlAgente
  $('#es-pedido').onkeydown = (e) => { if (e.key === 'Enter') pedirAlAgente() }
  $('#es-transcribir').onclick = async () => {
    try { await api(`/estudio/${es.id}/transcribir`, {}); $('#es-respuesta').textContent = 'Escuchando el video y armando los subtítulos…'; esperarTarea() } catch (e) { error(e) }
  }
  $('#es-exportar').onclick = async () => {
    await guardarEstudioYa()
    try { await api(`/estudio/${es.id}/exportar`, {}); toast('Armando el video<small>Lo ves abajo, en Exportaciones.</small>', 'suave'); refrescarVersiones() } catch (e) { error(e) }
  }
  $('#es-momentos').onclick = async () => {
    const b = $('#es-momentos')
    b.disabled = true
    $('#es-respuesta').textContent = 'Buscando los mejores cortes en lo que se dice…'
    try {
      const r = await api(`/estudio/${es.id}/momentos`, {})
      $('#es-respuesta').innerHTML = r.momentos.length ? `Armé ${r.momentos.length} proyecto${r.momentos.length === 1 ? '' : 's'} vertical${r.momentos.length === 1 ? '' : 'es'}: ${r.momentos.map((m) => `<a href="#" class="ref" data-abrir="${m.id}">${esc(m.titulo)} (${tiempo(m.desde)}–${tiempo(m.hasta)})</a>`).join(' · ')}` : 'No encontré cortes que funcionen solos.'
      $$('[data-abrir]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); abrirEstudio(Number(a.dataset.abrir)) }))
    } catch (e) { $('#es-respuesta').textContent = ''; error(e) } finally { b.disabled = false }
  }
  $('#es-aplicar').onchange = async (e) => {
    const pid = e.target.value
    e.target.value = ''
    if (!pid) return
    try { es.p = { ...es.p, ...(await api(`/estudio/${es.id}/plantilla/${pid}`, {})) }; es.p.puedeDeshacer = true; refrescarEditor(); toast('Plantilla aplicada', 'suave') } catch (err) { error(err) }
  }
  $('#es-guardar-pl').onclick = async () => {
    const nombre = await preguntar('Nombre de la plantilla (por ejemplo, el de tu proyecto):', '', { ok: 'Seguir' })
    if (!nombre) return
    const marca = await preguntar('Tu marca en una línea (colores, tipografía, tono) — para que el agente la respete. Opcional:', '', { ok: 'Guardar plantilla' })
    if (marca === null) return
    try { await guardarEstudioYa(); await api(`/estudio/${es.id}/plantilla`, { nombre, marca }); es.base = await api('/estudio'); toast('Plantilla guardada', 'suave'); abrirEstudio(es.id) } catch (e) { error(e) }
  }
  // Arrastrar en el lienzo (las capas), con el mouse o el dedo.
  $('#es-vivas').onpointerdown = (e) => {
    const el = e.target.closest('[data-capa]')
    if (!el) return
    const c = es.p.capas.find((x) => x.id === el.dataset.capa)
    if (!c) return
    seleccionar(c.id)
    if (c.tipo === 'color') return
    e.preventDefault()
    const r = $('#es-lienzo').getBoundingClientRect()
    const x0 = e.clientX, y0 = e.clientY, cx = c.x, cy = c.y
    const mover = (ev) => {
      c.x = Math.min(0.98, Math.max(0, cx + (ev.clientX - x0) / r.width))
      c.y = Math.min(0.995, Math.max(0, cy + (ev.clientY - y0) / r.height))
      pintarVivas(Math.max(0, $('#es-video').currentTime - (es.p.recorte?.desde ?? 0)))
    }
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); guardarCapas(); pintarInspector() }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }
  refrescarEditor()
  refrescarVersiones()
  if (es.d.tarea?.activa) esperarTarea()
}

function refrescarEditor() {
  if (!$('#es-lista')) return
  if (es.sel && !capaSel()) es.sel = null
  $('#es-deshacer').disabled = !es.p.puedeDeshacer
  $('#es-lista').innerHTML = es.p.capas.length ? es.p.capas.map((c) => `<div class="es-capa ${c.id === es.sel ? 'on' : ''} ${c.visible ? '' : 'oculta'}" data-sel="${c.id}">
    <span class="es-g">${TIPO_CAPA[c.tipo].g}</span><span class="es-n">${esc(c.nombre)}</span>
    <button class="es-ojo" data-ojo="${c.id}" title="${c.visible ? 'Ocultar' : 'Mostrar'}">${c.visible ? '👁' : '—'}</button></div>`).join('') : '<p class="tenue chico">Sin capas. Agregá una, subtitulá, o pedile al agente.</p>'
  $$('[data-sel]').forEach((el) => (el.onclick = (e) => { if (!e.target.closest('[data-ojo]')) seleccionar(el.dataset.sel) }))
  $$('[data-ojo]').forEach((b) => (b.onclick = () => { const c = es.p.capas.find((x) => x.id === b.dataset.ojo); c.visible = !c.visible; guardarCapas(); refrescarEditor() }))
  pintarLinea()
  pintarInspector()
}

function seleccionar(id) {
  es.sel = id
  $$('[data-sel]').forEach((el) => el.classList.toggle('on', el.dataset.sel === id))
  $$('.es-fila').forEach((el) => el.classList.toggle('on', el.dataset.fila === id))
  pintarInspector()
}

/** Las capas en el lienzo: una aproximación de lo que arma ffmpeg (mismas posiciones y tamaños). */
function pintarVivas(t) {
  const cont = $('#es-vivas')
  const lienzo = $('#es-lienzo')
  if (!cont || !lienzo) return
  const H = lienzo.clientHeight
  const v = $('#es-video')
  const filtros = es.p.capas.filter((c) => c.tipo === 'color' && activaEn(c, t)).map((c) => (c.datos.manual ? `brightness(${c.datos.manual.brillo / 100}) contrast(${c.datos.manual.contraste / 100}) saturate(${c.datos.manual.saturacion / 100}) sepia(${c.datos.manual.sepia / 100}) grayscale(${c.datos.manual.gris / 100}) hue-rotate(${c.datos.manual.tono}deg)` : (FILTRO_CSS[c.datos.preset]?.((c.datos.intensidad ?? 100) / 100) ?? ''))).join(' ')
  v.style.filter = filtros
  const html = []
  for (const c of es.p.capas) {
    if (!activaEn(c, t) || c.tipo === 'color') continue
    const e = c.estilo
    const base = `left:${c.x * 100}%;top:${c.y * 100}%;opacity:${e.opacidad / 100};font-size:${Math.max(6, e.tam * H)}px;color:${e.color};`
    const caja = `background:${e.fondo};${e.sombra ? 'text-shadow:0 2px 6px rgba(0,0,0,.7);' : ''}`
    const sel = c.id === es.sel ? ' sel' : ''
    if (c.tipo === 'subtitulos') {
      const q = c.datos.cues.find((x) => t >= x.t0 && t <= x.t1)
      if (!q) continue
      const pal = c.datos.preset === 'palabra' && q.palabras?.length
      const linea = pal ? q.palabras.map((w) => (t >= w.t0 && t <= (w.t1 + 0.05) ? `<b class="es-pal">${esc(w.w)}</b>` : esc(w.w))).join(' ') : esc(q.texto)
      const preset = c.datos.preset
      const fondo = preset === 'minimo' || pal ? 'transparent' : preset === 'editorial' ? 'rgba(245,240,230,.92)' : e.fondo
      html.push(`<div class="es-viva es-sub ${preset}${sel}" data-capa="${c.id}" style="${base}width:${c.w * 100}%;"><span style="background:${fondo};${preset === 'editorial' ? 'color:#171717;' : ''}">${linea}</span></div>`)
    } else if (c.tipo === 'titulo') html.push(`<div class="es-viva es-caja${sel}" data-capa="${c.id}" style="${base}${caja}"><b>${esc(c.datos.titulo)}</b><small style="font-size:.7em">${esc(c.datos.subtitulo ?? '')}</small></div>`)
    else if (c.tipo === 'texto') html.push(`<div class="es-viva es-caja${sel}" data-capa="${c.id}" style="${base}${caja}max-width:${c.w * 100}%">${esc(c.datos.texto)}</div>`)
    else if (c.tipo === 'cartel') html.push(`<div class="es-viva es-caja es-cartel${sel}" data-capa="${c.id}" style="${base}${caja}"><b>● ${c.datos.modo === 'grabando' ? 'REC' : c.datos.modo === 'espectadores' ? `${Number(c.datos.espectadores).toLocaleString('es-AR')} mirando` : 'EN VIVO'}</b></div>`)
    else if (c.tipo === 'alerta') { if (t <= c.desde + 5) html.push(`<div class="es-viva es-caja${sel}" data-capa="${c.id}" style="${base}${caja}"><b>${esc(c.datos.nombre)}</b> ${c.datos.tipo === 'donacion' ? `donó${c.datos.monto ? ` ${c.datos.monto} €` : ''}` : c.datos.tipo === 'suscripcion' ? 'se suscribió' : 'empezó a seguirte'}${c.datos.mensaje ? `<br><small>${esc(c.datos.mensaje)}</small>` : ''}</div>`) }
    else if (c.tipo === 'chat') {
      const k = Math.floor((t - c.desde) / (c.datos.cadencia || 1.6))
      const vis = c.datos.mensajes.slice(Math.max(0, k - 5), k + 1)
      html.push(`<div class="es-viva es-caja es-chat${sel}" data-capa="${c.id}" style="${base}${caja}width:${c.w * 100}%">${vis.map((m) => `<div><b style="color:${m.color}">${esc(m.usuario)}</b> ${esc(m.texto)}</div>`).join('') || '<div class="tenue">(chat)</div>'}</div>`)
    } else if (c.tipo === 'imagen' || c.tipo === 'qr') {
      const src = c.tipo === 'qr' ? `/api/estudio/qr?d=${encodeURIComponent(c.datos.destino ?? '')}` : c.datos.archivo ? `/taller/${c.datos.artefacto ?? es.id}/${encodeURIComponent(c.datos.archivo)}` : null
      html.push(`<div class="es-viva es-img${sel}" data-capa="${c.id}" style="${base}width:${c.w * 100}%">${src ? `<img src="${src}" alt="" draggable="false">` : '<div class="es-vacia">▣ elegí una imagen</div>'}</div>`)
    } else if (c.tipo === 'progreso') html.push(`<div class="es-viva es-prog${sel}" data-capa="${c.id}" style="left:${c.x * 100}%;top:${c.y * 100}%;width:${c.w * 100 * (t / dur())}%;background:${e.fondo};opacity:${e.opacidad / 100}"></div>`)
  }
  cont.innerHTML = html.join('')
}

/** La línea de tiempo: una fila por capa con su tramo (se mueve o se estira desde los bordes). */
function pintarLinea() {
  const cont = $('#es-linea')
  if (!cont) return
  const D = dur()
  cont.innerHTML = `<div class="es-regla" id="es-regla">${Array.from({ length: 11 }, (_, i) => `<span style="left:${i * 10}%">${tiempo((D * i) / 10)}</span>`).join('')}</div>
    <div class="es-filas">${es.p.capas.map((c) => `<div class="es-fila ${c.id === es.sel ? 'on' : ''}" data-fila="${c.id}"><span class="es-fila-n">${TIPO_CAPA[c.tipo].g} ${esc(c.nombre)}</span>
      <div class="es-pista"><div class="es-tramo ${c.tipo}" data-tramo="${c.id}" style="left:${(c.desde / D) * 100}%;width:${(((c.hasta ?? D) - c.desde) / D) * 100}%"><i data-borde="i"></i><i data-borde="d"></i></div></div></div>`).join('')}
      <div class="es-cabezal-zona"><div class="es-cabezal" id="es-cabezal"></div></div></div>`
  $('#es-regla').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); const v = $('#es-video'); v.currentTime = (es.p.recorte?.desde ?? 0) + ((e.clientX - r.left) / r.width) * D }
  $$('[data-tramo]', cont).forEach((el) => (el.onpointerdown = (e) => {
    const c = es.p.capas.find((x) => x.id === el.dataset.tramo)
    seleccionar(c.id)
    e.preventDefault()
    const pista = el.parentElement.getBoundingClientRect()
    const borde = e.target.dataset.borde
    const x0 = e.clientX, d0 = c.desde, h0 = c.hasta ?? D
    const mover = (ev) => {
      const dt = ((ev.clientX - x0) / pista.width) * D
      if (borde === 'i') c.desde = Math.max(0, Math.min(h0 - 0.2, d0 + dt))
      else if (borde === 'd') c.hasta = Math.min(D, Math.max(d0 + 0.2, h0 + dt))
      else { const largo = h0 - d0; c.desde = Math.max(0, Math.min(D - largo, d0 + dt)); c.hasta = c.desde + largo }
      el.style.left = `${(c.desde / D) * 100}%`
      el.style.width = `${(((c.hasta ?? D) - c.desde) / D) * 100}%`
    }
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); if (c.hasta != null && c.hasta >= D - 0.05) c.hasta = null; guardarCapas(); pintarInspector() }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }))
}

// ─── el inspector ───────────────────────────────────────────────────────

const campoNum = (k, etq, v, o = {}) => `<label class="campo">${etq}<input type="number" data-k="${k}" value="${v ?? ''}" step="${o.paso ?? 0.1}" ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} placeholder="${o.ph ?? ''}"></label>`
const campoRango = (k, etq, v, min, max, paso) => `<label class="campo">${etq} <small class="tenue" data-ver="${k}">${v}</small><input type="range" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${paso}"></label>`
const campoColor = (k, etq, v) => `<label class="campo">${etq}<span class="es-color"><input type="color" data-kc="${k}" value="${/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}"><input class="campo-suelto" data-k="${k}" value="${esc(v)}"></span></label>`

function pintarInspector() {
  const cont = $('#es-inspector')
  if (!cont) return
  const c = capaSel()
  if (!c) {
    const r = es.p.recorte
    cont.innerHTML = `<h4>Proyecto</h4><p class="tenue chico">${tiempo(es.p.duracion)} · ${es.p.ancho}×${es.p.alto}</p>
      <label class="campo">Recortar el video (segundos)<span class="fila"><input type="number" id="es-r0" value="${r?.desde ?? 0}" step="0.1" min="0"><input type="number" id="es-r1" value="${r?.hasta ?? es.p.duracion.toFixed(1)}" step="0.1"></span></label>
      <button class="btn btn-chico" id="es-recortar">Aplicar recorte</button>
      <p class="tenue chico">Tocá una capa (en la lista, en el lienzo o en la línea) para editarla.</p>`
    $('#es-recortar').onclick = async () => {
      const a = Number($('#es-r0').value), b = Number($('#es-r1').value)
      await guardarEstudioYa({ recorte: a <= 0.05 && b >= es.p.duracion - 0.05 ? null : { desde: a, hasta: b } })
      abrirEstudio(es.id)
    }
    return
  }
  const e = c.estilo
  const d = c.datos
  const propios = {
    subtitulos: () => `<label class="campo">Estilo<select data-d="preset">${['clasico', 'minimo', 'cine', 'editorial', 'palabra'].map((p) => `<option value="${p}" ${d.preset === p ? 'selected' : ''}>${{ clasico: 'Clásico', minimo: 'Mínimo', cine: 'Cine', editorial: 'Editorial', palabra: 'Palabra por palabra (reels)' }[p]}</option>`).join('')}</select></label>
      <div class="es-cues">${d.cues.map((q, i) => `<div class="es-cue"><button class="btn btn-chico" data-ir="${q.t0}">${tiempo(q.t0)}</button><input class="campo-suelto" data-cue="${i}" value="${esc(q.texto)}"></div>`).join('')}</div>`,
    titulo: () => `<label class="campo">Nombre<input data-d="titulo" value="${esc(d.titulo)}"></label><label class="campo">Rol<input data-d="subtitulo" value="${esc(d.subtitulo ?? '')}"></label>`,
    texto: () => `<label class="campo">Texto<textarea data-d="texto" rows="3">${esc(d.texto)}</textarea></label>`,
    cartel: () => `<label class="campo">Qué dice<select data-d="modo">${[['vivo', 'EN VIVO'], ['grabando', 'REC'], ['espectadores', 'Espectadores']].map(([k, n]) => `<option value="${k}" ${d.modo === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${d.modo === 'espectadores' ? `<label class="campo">Cuántos<input type="number" data-d="espectadores" value="${d.espectadores}"></label>` : ''}`,
    alerta: () => `<label class="campo">Tipo<select data-d="tipo">${[['seguidor', 'Nuevo seguidor'], ['suscripcion', 'Suscripción'], ['donacion', 'Donación']].map(([k, n]) => `<option value="${k}" ${d.tipo === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="campo">Nombre<input data-d="nombre" value="${esc(d.nombre)}"></label>${d.tipo === 'donacion' ? `<label class="campo">Monto (€)<input type="number" data-d="monto" value="${d.monto ?? ''}"></label>` : ''}<label class="campo">Mensaje<input data-d="mensaje" value="${esc(d.mensaje ?? '')}"></label>`,
    chat: () => `<label class="campo">Mensajes (uno por línea: «usuario: texto»)<textarea data-chat rows="6">${esc(d.mensajes.map((m) => `${m.usuario}: ${m.texto}`).join('\n'))}</textarea></label>${campoNum('d.cadencia', 'Segundos entre mensajes', d.cadencia, { min: 0.4, max: 10 })}<button class="btn btn-chico" id="es-chat-ia">✨ Que lo escriba el agente</button>`,
    qr: () => `<label class="campo">A dónde lleva<input data-d="destino" value="${esc(d.destino)}"></label>`,
    imagen: () => `<label class="campo">Imagen del Taller<select data-img><option value="">— elegí —</option>${(es.base.imagenes ?? []).map((a) => (a.archivos ?? []).filter((n) => /\.(png|jpe?g)$/.test(n)).map((n) => `<option value="${a.id}|${n}" ${d.artefacto === a.id && d.archivo === n ? 'selected' : ''}>${esc(a.titulo)}${a.archivos.length > 1 ? ` · ${n}` : ''}</option>`).join('')).join('')}</select></label>
      <label class="btn btn-chico">⇪ Subir un logo<input type="file" accept="image/png,image/jpeg" hidden data-subir-img></label>`,
    color: () => `<label class="campo">Look<select data-d="preset">${[['cine', 'Cine'], ['contraste', 'Contraste'], ['vintage', 'Vintage'], ['noir', 'Noir'], ['sepia', 'Sepia'], ['cyberpunk', 'Cyberpunk']].map(([k, n]) => `<option value="${k}" ${d.preset === k && !d.manual ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${campoRango('d.intensidad', 'Intensidad', d.intensidad ?? 100, 0, 200, 5)}`,
    progreso: () => '',
  }[c.tipo]
  const geo = c.tipo === 'color' ? '' : `<div class="es-dos">${campoRango('x', 'X', +c.x.toFixed(3), 0, 0.98, 0.005)}${campoRango('y', 'Y', +c.y.toFixed(3), 0, 0.995, 0.005)}</div>${['imagen', 'qr', 'subtitulos', 'chat', 'texto', 'progreso'].includes(c.tipo) ? campoRango('w', 'Ancho', +c.w.toFixed(3), 0.03, 1, 0.005) : ''}`
  const estilo = ['color', 'imagen', 'qr'].includes(c.tipo) ? (c.tipo !== 'color' ? campoRango('e.opacidad', 'Opacidad', e.opacidad, 0, 100, 5) : '')
    : `${c.tipo === 'progreso' ? campoColor('e.fondo', 'Color', e.fondo) : `<div class="es-dos">${campoColor('e.color', 'Letra', e.color)}${campoColor('e.fondo', 'Fondo', e.fondo)}</div>${campoRango('e.tam', 'Tamaño', e.tam, 0.015, 0.12, 0.002)}`}
      ${campoRango('e.opacidad', 'Opacidad', e.opacidad, 0, 100, 5)}${c.tipo === 'progreso' ? '' : `<label class="campo">Animación<select data-k="e.animacion">${[['ninguna', 'Ninguna'], ['aparecer', 'Aparecer'], ['deslizar', 'Deslizar'], ['latir', 'Latir']].map(([k, n]) => `<option value="${k}" ${e.animacion === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`}`
  cont.innerHTML = `<div class="es-insp-cab"><span>${TIPO_CAPA[c.tipo].g}</span><input class="campo-suelto" data-k="nombre" value="${esc(c.nombre)}"><button class="btn btn-chico" id="es-borrar-capa" title="Borrar la capa">✕</button></div>
    <div class="es-dos">${campoNum('desde', 'Desde (s)', +c.desde.toFixed(2), { min: 0 })}${campoNum('hasta', 'Hasta (s)', c.hasta == null ? '' : +c.hasta.toFixed(2), { ph: 'el final' })}</div>
    ${propios()}${geo}${estilo}`
  // Cada cambio se refleja en el lienzo al instante y se guarda (con un respiro).
  const poner = (k, v) => {
    if (k.startsWith('e.')) c.estilo[k.slice(2)] = v
    else if (k.startsWith('d.')) c.datos[k.slice(2)] = v
    else c[k] = v
  }
  $$('[data-k]', cont).forEach((el) => (el.oninput = () => {
    const k = el.dataset.k
    const num = el.type === 'number' || el.type === 'range'
    const v = num ? (el.value === '' ? null : Number(el.value)) : el.value
    poner(k, v)
    const ver = $(`[data-ver="${k}"]`, cont)
    if (ver) ver.textContent = el.value
    if (k === 'nombre') refrescarListaSolo()
    guardarCapas()
  }))
  $$('[data-kc]', cont).forEach((el) => (el.oninput = () => { poner(el.dataset.kc, el.value); $(`[data-k="${el.dataset.kc}"]`, cont).value = el.value; guardarCapas() }))
  $$('[data-d]', cont).forEach((el) => (el.oninput = el.onchange = () => {
    c.datos[el.dataset.d] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value
    if (c.tipo === 'color') c.datos.manual = null
    guardarCapas()
    if (el.tagName === 'SELECT') pintarInspector()
  }))
  $$('[data-cue]', cont).forEach((el) => (el.oninput = () => { const q = c.datos.cues[Number(el.dataset.cue)]; q.texto = el.value; q.palabras = undefined; guardarCapas() }))
  $$('[data-ir]', cont).forEach((b) => (b.onclick = () => { $('#es-video').currentTime = (es.p.recorte?.desde ?? 0) + Number(b.dataset.ir) }))
  const chat = $('[data-chat]', cont)
  if (chat) chat.oninput = () => { c.datos.mensajes = chat.value.split('\n').map((l) => /^([^:]{1,24}):\s*(.+)$/.exec(l.trim())).filter(Boolean).map((m, i) => ({ usuario: m[1].trim(), texto: m[2].slice(0, 140), color: c.datos.mensajes[i]?.color ?? ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171'][i % 6] })); guardarCapas() }
  const ia = $('#es-chat-ia')
  if (ia) ia.onclick = () => { $('#es-pedido').value = `Escribí el chat «${c.nombre}» (id ${c.id}): mensajes creíbles de gente mirando este video, sobre lo que se dice.`; pedirAlAgente() }
  const img = $('[data-img]', cont)
  if (img) img.onchange = () => { const [a, n] = img.value.split('|'); c.datos.artefacto = a ? Number(a) : null; c.datos.archivo = n ?? null; guardarCapas() }
  const sub = $('[data-subir-img]', cont)
  if (sub) sub.onchange = async () => {
    const f = sub.files[0]
    if (!f) return
    try { const r = await fetch(`/api/estudio/${es.id}/imagen?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j }); c.datos.archivo = r.archivo; c.datos.artefacto = null; guardarCapas() } catch (err) { error(err) }
  }
  $('#es-borrar-capa').onclick = () => { es.p.capas = es.p.capas.filter((x) => x.id !== c.id); es.sel = null; guardarCapas(); refrescarEditor() }
}

function refrescarListaSolo() {
  const c = capaSel()
  const el = c && $(`[data-sel="${c.id}"] .es-n`)
  if (el) el.textContent = c.nombre
}

function agregarCapa(tipo) {
  const id = Math.random().toString(16).slice(2, 10)
  const nombre = TIPO_CAPA[tipo].n.split(' (')[0]
  es.p.capas.push({ id, tipo, nombre, visible: true, desde: 0, hasta: null })
  // El servidor completa con lo que corresponde a cada tipo (lugar, estilo y datos de arranque).
  guardarEstudioYa({ capas: es.p.capas }).then((p) => { if (p) { es.p.capas = p.capas; es.sel = id; refrescarEditor() } })
}

/** Guarda las capas con un respiro (mientras arrastrás o escribís no se manda en cada letra). */
function guardarCapas() {
  clearTimeout(es.guardando)
  es.guardando = setTimeout(() => guardarEstudioYa({ capas: es.p.capas }), 600)
}
async function guardarEstudioYa(cambios = { capas: es.p.capas }) {
  clearTimeout(es.guardando)
  try { const p = await api(`/estudio/${es.id}`, cambios); return p } catch (e) { error(e); return null }
}

async function pedirAlAgente() {
  const pedido = $('#es-pedido').value.trim()
  if (!pedido) return
  const b = $('#es-pedir')
  b.disabled = true
  $('#es-respuesta').innerHTML = '<span class="pensando"><span><i></i><i></i><i></i></span></span> Armando…'
  try {
    await guardarEstudioYa()
    const r = await api(`/estudio/${es.id}/agente`, { pedido })
    $('#es-respuesta').textContent = `☿ ${r.mensaje}`
    $('#es-pedido').value = ''
    const d = await api(`/estudio/${es.id}`)
    es.p = d.proyecto
    refrescarEditor()
  } catch (e) { $('#es-respuesta').textContent = ''; error(e) } finally { b.disabled = false }
}

async function esperarTarea() {
  clearTimeout(es.sondeo)
  let d
  try { d = await api(`/estudio/${es.id}`) } catch { return }
  if (d.tarea?.activa) return void (es.sondeo = setTimeout(() => vista === 'estudio' && esperarTarea(), 2500))
  if (d.tarea?.error) { $('#es-respuesta').textContent = ''; return error(new Error(d.tarea.error)) }
  es.p = d.proyecto
  $('#es-respuesta').textContent = '☿ Listo: subtítulos armados. Revisalos en el inspector (tocá la capa).'
  es.sel = es.p.capas.find((c) => c.tipo === 'subtitulos')?.id ?? es.sel
  refrescarEditor()
}

/** Las exportaciones del proyecto: cada una con su video, para bajar o mandar a Cuentas (en borrador). */
async function refrescarVersiones() {
  const cont = $('#es-versiones')
  if (!cont) return
  let d
  try { d = await api(`/estudio/${es.id}`) } catch { return }
  const exps = d.versiones.filter((v) => v.meta?.exportado)
  const haciendo = exps.some((v) => v.estado === 'haciendo')
  cont.innerHTML = exps.length ? `<h3 class="tl-h">Exportaciones</h3><div class="es-exps">${exps.map((v) => `<div class="es-exp ${v.estado}">
    ${v.estado === 'listo' ? `<video controls src="/taller/${v.id}/video.mp4" preload="metadata"></video>` : v.estado === 'haciendo' ? `<div class="tl-haciendo"><span class="pensando"><span><i></i><i></i><i></i></span></span>${esc(v.progreso ?? 'armando')}…</div>` : `<p class="aviso">No salió: ${esc(v.progreso ?? '')}</p>`}
    <div class="fila"><b>v${v.version}</b><small class="tenue">${esc(v.meta?.proyecto?.formato ?? '')} · ${new Date(v.creadoEn).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
      ${v.estado === 'listo' ? `<a class="btn btn-chico" href="/taller/${v.id}/video.mp4" download>⇩ mp4</a>${(es.base.cuentas ?? []).length ? `<select class="campo-suelto" data-pub="${v.id}"><option value="">Mandar a Cuentas…</option>${es.base.cuentas.map((c) => `<option value="${c.id}">${esc(c.red)} · ${esc(c.usuario)}</option>`).join('')}</select>` : ''}` : ''}</div></div>`).join('')}</div>` : ''
  $$('[data-pub]', cont).forEach((s) => (s.onchange = async () => {
    if (!s.value) return
    try { await api(`/estudio/${s.dataset.pub}/publicar`, { cuentaId: Number(s.value) }); toast('En Cuentas, como borrador<small>Revisalo y aprobalo ahí: no sale solo.</small>', 'suave') } catch (e) { error(e) } finally { s.value = '' }
  }))
  clearTimeout(es.sondeoExp)
  if (haciendo) es.sondeoExp = setTimeout(() => vista === 'estudio' && refrescarVersiones(), 3000)
}

function refrescarEstudio() {}
