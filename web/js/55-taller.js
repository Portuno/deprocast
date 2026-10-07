'use strict'
// Taller: juegos, imágenes, voces, personajes y videos; cada cambio es una versión nueva

const TIPO_TALLER = {
  juego: { glifo: '▶', nombre: 'Juego', ayuda: 'Un juego que corre acá mismo. Describilo: mecánica, estética, de qué se trata.' },
  imagen: { glifo: '▣', nombre: 'Imagen', ayuda: 'Qué querés ver: sujeto, estilo, colores, encuadre.' },
  voz: { glifo: '♪', nombre: 'Voz', ayuda: 'El texto que querés escuchar leído.' },
  personaje: { glifo: '☺', nombre: 'Personaje', ayuda: 'Quién es: rol, carácter, estética. Queda con retrato y voz para usarlo en juegos y videos.' },
  video: { glifo: '▤', nombre: 'Video', ayuda: 'De qué trata el video corto: guion, imágenes, voz y montaje.' },
}
let tallerTipo = 'juego'
let tallerFirma = ''
let tallerSondeo = null

async function montarTaller() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Taller</h1><p>Mastropiero crea: juegos que se juegan acá, imágenes, voces, personajes y videos. Pedí cambios y cada uno queda como versión nueva.</p></div>
    <div class="panel taller-crear">
      <div class="chips" id="tl-tipos">${Object.entries(TIPO_TALLER).map(([k, t]) => `<button class="chip ${k === tallerTipo ? 'on' : ''}" data-tl-tipo="${k}">${t.glifo} ${t.nombre}</button>`).join('')}</div>
      <textarea class="campo-suelto" id="tl-pedido" rows="3"></textarea>
      <div class="fila" id="tl-extra"></div>
      <div class="fila"><button class="btn btn-primario" id="tl-crear">Crear</button><span class="tenue chico" id="tl-nota"></span></div>
    </div>
    <div id="tl-lista"></div>`
  const pintarTipo = async () => {
    $$('[data-tl-tipo]').forEach((b) => b.classList.toggle('on', b.dataset.tlTipo === tallerTipo))
    $('#tl-pedido').placeholder = TIPO_TALLER[tallerTipo].ayuda
    const d = tallerDatos ?? await api('/taller')
    $('#tl-extra').innerHTML = tallerTipo === 'voz' || tallerTipo === 'video'
      ? `<select class="campo-suelto" id="tl-voz">${Object.entries(d.voces).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>${tallerTipo === 'video' ? `<select class="campo-suelto" id="tl-pj"><option value="">Sin personaje</option>${d.artefactos.filter((a) => a.tipo === 'personaje' && a.estado === 'listo').map((a) => `<option value="${a.id}">Con ${esc(a.titulo)}</option>`).join('')}</select>` : ''}`
      : tallerTipo === 'imagen' ? '<select class="campo-suelto" id="tl-modelo"><option value="flux-2-klein">Rápida (flux, ~8 s)</option><option value="qwen-image-2.1">Detallada (qwen-image, ~1 min)</option></select>' : ''
    $('#tl-nota').textContent = tallerTipo === 'video' ? (d.ffmpeg ? 'Sale un mp4 (ffmpeg) y una presentación.' : 'Sin ffmpeg sale una presentación HTML (imágenes + voz).') : ''
  }
  $$('[data-tl-tipo]').forEach((b) => (b.onclick = () => { tallerTipo = b.dataset.tlTipo; pintarTipo() }))
  $('#tl-crear').onclick = async () => {
    const pedido = $('#tl-pedido').value.trim()
    if (!pedido) return toast('Contame qué querés crear', 'error')
    try {
      await api('/taller', { tipo: tallerTipo, pedido, voz: $('#tl-voz')?.value, modelo: $('#tl-modelo')?.value, personajeId: $('#tl-pj')?.value || null })
      $('#tl-pedido').value = ''
      toast(`${TIPO_TALLER[tallerTipo].nombre} en marcha<small>Lo ves abajo; avisa cuando esté.</small>`, 'suave')
      traerTaller()
    } catch (e) { error(e) }
  }
  await traerTaller()
  pintarTipo()
}

let tallerDatos = null
async function traerTaller() {
  const cont = $('#tl-lista')
  if (!cont) return
  try {
    const d = await api('/taller')
    tallerDatos = d
    const f = JSON.stringify(d.artefactos.map((a) => [a.id, a.estado, a.progreso]))
    const haciendo = d.artefactos.some((a) => a.estado === 'haciendo')
    clearTimeout(tallerSondeo)
    if (haciendo) tallerSondeo = setTimeout(() => vista === 'taller' && traerTaller(), 3000)
    if (f === tallerFirma && cont.innerHTML) return
    if (tallerFirma && f !== tallerFirma) {
      const listos = d.artefactos.filter((a) => a.estado === 'listo' && !tallerFirma.includes(`[${a.id},"listo"`))
      if (listos.length && tallerFirma.includes('haciendo')) toast(`Listo en el Taller<small>${esc(listos.map((a) => a.titulo).join(', '))}</small>`)
    }
    tallerFirma = f
    const url = (a, n) => `/taller/${a.id}/${encodeURIComponent(n)}`
    const vista_ = (a) => {
      if (a.estado === 'haciendo') return `<div class="tl-haciendo"><span class="pensando"><span><i></i><i></i><i></i></span></span>${esc(a.progreso ?? 'trabajando')}…</div>`
      if (a.estado === 'fallo') return `<p class="aviso">No salió: ${esc(a.progreso ?? '')}</p>`
      const img = a.archivos.find((n) => /\.(png|jpe?g)$/.test(n))
      if (a.tipo === 'juego') return `<iframe class="tl-juego" sandbox="allow-scripts allow-pointer-lock" src="${url(a, 'index.html')}" title="${esc(a.titulo)}"></iframe>`
      if (a.tipo === 'video') return a.archivos.includes('video.mp4') ? `<video controls src="${url(a, 'video.mp4')}"></video>` : `<iframe class="tl-juego" sandbox="allow-scripts" src="${url(a, 'presentacion.html')}"></iframe>`
      return `${img ? `<img src="${url(a, img)}" alt="${esc(a.titulo)}">` : ''}${a.archivos.includes('voz.mp3') ? `<audio controls src="${url(a, 'voz.mp3')}"></audio>` : ''}${a.meta?.ficha ? `<p class="tenue chico">${esc(a.meta.ficha.descripcion ?? '')}<br><i>«${esc(a.meta.ficha.frase ?? '')}»</i></p>` : ''}`
    }
    cont.innerHTML = d.artefactos.length ? `<div class="tl-grid">${d.artefactos.map((a) => `<div class="tl ${a.estado}" data-tl="${a.id}">
      <div class="p-top"><span class="tipo-chip">${TIPO_TALLER[a.tipo]?.glifo ?? ''} ${esc(a.tipo)}</span>${a.version > 1 ? `<span class="tipo-chip">v${a.version}</span>` : ''}</div>
      <h3>${esc(a.titulo)}</h3>
      ${vista_(a)}
      ${a.estado === 'listo' ? `<div class="fila tl-acc"><input class="campo-suelto" data-tl-cambio placeholder="Pedí un cambio…"><button class="btn btn-chico" data-tl-iterar>Nueva versión</button>
        ${a.tipo === 'juego' ? `<a class="btn btn-chico" href="${url(a, 'index.html')}" target="_blank" rel="noopener">Pantalla completa</a>` : ''}
        <button class="btn btn-chico" data-tl-corpus title="Guardarlo en el corpus">❦</button></div>` : ''}
    </div>`).join('')}</div>` : '<div class="vacio"><div class="gran">✎</div><h2>El Taller está vacío</h2><p>Pedí un juego, una imagen, una voz, un personaje o un video.</p></div>'
    $$('[data-tl]', cont).forEach((el) => {
      const id = el.dataset.tl
      const it = $('[data-tl-iterar]', el)
      if (it) it.onclick = async () => {
        const cambio = $('[data-tl-cambio]', el).value.trim()
        if (!cambio) return toast('Decime qué cambiar', 'error')
        try { await api(`/taller/${id}/iterar`, { cambio }); toast('Nueva versión en marcha', 'suave'); traerTaller() } catch (e) { error(e) }
      }
      const co = $('[data-tl-corpus]', el)
      if (co) co.onclick = async () => { try { await api(`/taller/${id}/corpus`, {}); toast('Guardado en el corpus', 'suave') } catch (e) { error(e) } }
    })
  } catch (e) { error(e) }
}

function refrescarTaller() {}
