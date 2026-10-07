'use strict'
// ─── Directo: Mastropiero ve tu pantalla y te escucha (solo cuando lo prendés) ──

const directo = { sesion: null, pantalla: null, mic: null, video: null, timer: null, reloj: null, grabadores: [], subidas: new Set(), huella: null, ultimoEnvio: 0, inicio: 0 }

function subirDirecto(ruta, blob, tipo) {
  const p = fetch(ruta, { method: 'POST', headers: { 'content-type': tipo }, body: blob }).catch(() => {})
  directo.subidas.add(p)
  p.finally(() => directo.subidas.delete(p))
  return p
}

function modalDirecto() {
  if (directo.sesion) {
    if (confirm('¿Apagar el Directo? Escribo el informe con lo que vi y escuché.')) detenerDirecto()
    return
  }
  const huerfano = E.hoy?.directo
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <h2>Directo</h2>
    <p class="tenue">Mastropiero mira tu pantalla y te escucha mientras trabajás. Anota qué hacés, transcribe lo que decís y entiende lo que mirás o escuchás (videos, música, lecturas). Al apagarlo te deja un informe, y todo entra al corpus y a tu memoria. Las capturas no se guardan: solo lo que se vio.</p>
    ${huerfano ? `<p class="aviso">Hay un Directo abierto desde las ${new Date(huerfano.inicio).toTimeString().slice(0, 5)} sin señal (se recargó la página). Prendelo de nuevo para retomarlo, o cerralo.</p>` : ''}
    <div class="form-ing">
      <label class="campo fila" style="gap:6px"><input type="checkbox" id="d-pantalla" checked> Pantalla</label>
      <label class="campo fila" style="gap:6px"><input type="checkbox" id="d-mic" checked> Micrófono (tu voz)</label>
      <label class="campo fila" style="gap:6px"><input type="checkbox" id="d-audio" checked> Audio de la pantalla (videos, música)</label>
      <label class="campo">Mirar cada<select id="d-cada"><option value="15">15 s</option><option value="30" selected>30 s</option><option value="60">1 min</option><option value="120">2 min</option></select></label>
    </div>
    <p class="hoy-nota">Al prender, el navegador te pide qué compartir: para el audio de videos y música elegí <b>la pantalla completa</b> (o la pestaña) y marcá «compartir audio». Funciona en Chrome o Edge abriendo <code>http://localhost:7272</code>; en el panel de Claude puede no andar.</p>
    <div class="fila" style="margin-top:12px"><button class="btn btn-primario" id="d-prender">● Prender</button>${huerfano ? '<button class="btn" id="d-cerrar-viejo">Cerrar el que quedó abierto</button>' : ''}</div>`)
  $('#d-prender').onclick = () => {
    const op = { pantalla: $('#d-pantalla').checked, mic: $('#d-mic').checked, audio: $('#d-audio').checked, cada: Number($('#d-cada').value) }
    cerrarModal()
    prenderDirecto(op)
  }
  const viejo = $('#d-cerrar-viejo')
  if (viejo) viejo.onclick = async () => {
    cerrarModal()
    toast('Cerrando el Directo y escribiendo el informe…', 'suave')
    try { await api(`/directo/${huerfano.id}/cerrar`, {}); await refrescar(); if (vista === 'directo') montarDirecto() } catch (e) { error(e) }
  }
}

async function prenderDirecto(op) {
  let pantalla = null
  let mic = null
  try {
    if (op.pantalla) pantalla = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: op.audio })
    if (op.mic) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    if (!pantalla && !mic) return toast('Elegí al menos pantalla o micrófono', 'error')
    const conAudio = !!pantalla?.getAudioTracks().length
    const s = await api('/directo/iniciar', { fuentes: [pantalla && 'pantalla', mic && 'voz', conAudio && 'medio'].filter(Boolean) })
    Object.assign(directo, { sesion: s.id, pantalla, mic, inicio: s.inicio || Date.now(), huella: null, ultimoEnvio: 0, grabadores: [] })
    if (pantalla) {
      const v = document.createElement('video')
      v.muted = true
      v.srcObject = new MediaStream(pantalla.getVideoTracks())
      await v.play()
      directo.video = v
      pantalla.getVideoTracks()[0].addEventListener('ended', () => directo.sesion && detenerDirecto())
      directo.timer = setInterval(capturarCuadro, op.cada * 1000)
      setTimeout(capturarCuadro, 1500)
      if (conAudio) grabarTramos(new MediaStream(pantalla.getAudioTracks()), 'medio')
    }
    if (mic) grabarTramos(mic, 'voz')
    directo.reloj = setInterval(pintarIndicadorDirecto, 1000)
    pintarIndicadorDirecto()
    toast(`● En directo<small>${[pantalla && 'pantalla', mic && 'tu voz', conAudio && 'el audio de la pantalla'].filter(Boolean).join(', ')}. Apagalo desde el botón de arriba.</small>`)
    if (op.audio && pantalla && !conAudio) toast('El navegador no compartió audio de la pantalla<small>Para videos y música, compartí la pantalla completa o una pestaña con «compartir audio».</small>', 'suave')
  } catch (e) {
    pantalla?.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    error(e?.name === 'NotAllowedError' ? 'No se dio permiso para compartir' : e)
  }
}

/** Audio en tramos de un minuto: cada tramo es un archivo completo que Whisper puede leer solo. */
function grabarTramos(stream, tipo) {
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  const tramo = () => {
    const sesion = directo.sesion
    if (!sesion) return
    const partes = []
    const desde = Date.now()
    const rec = new MediaRecorder(stream, { mimeType: mime })
    rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(partes, { type: 'audio/webm' })
      if (blob.size > 4000) subirDirecto(`/api/directo/${sesion}/audio?tipo=${tipo}&desde=${desde}&nombre=${tipo}.webm`, blob, 'audio/webm')
      directo.grabadores = directo.grabadores.filter((r) => r !== rec)
      if (directo.sesion === sesion) tramo()
    }
    rec.start()
    directo.grabadores.push(rec)
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), 60_000)
  }
  tramo()
}

/** Un cuadro solo si la pantalla cambió (o cada 5 minutos igual): ahorra modelo sin perder nada. */
function capturarCuadro() {
  const v = directo.video
  if (!directo.sesion || !v?.videoWidth) return
  const chico = document.createElement('canvas')
  chico.width = 32
  chico.height = 18
  const cx = chico.getContext('2d', { willReadFrequently: true })
  cx.drawImage(v, 0, 0, 32, 18)
  const d = cx.getImageData(0, 0, 32, 18).data
  const g = []
  for (let i = 0; i < d.length; i += 4) g.push((d[i] + d[i + 1] + d[i + 2]) / 3)
  const dif = directo.huella ? g.reduce((s, x, i) => s + Math.abs(x - directo.huella[i]), 0) / g.length : 999
  if (dif < 4 && Date.now() - directo.ultimoEnvio < 5 * 60_000) return
  directo.huella = g
  directo.ultimoEnvio = Date.now()
  const w = Math.min(1280, v.videoWidth)
  const c = document.createElement('canvas')
  c.width = w
  c.height = Math.round((v.videoHeight * w) / v.videoWidth)
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
  c.toBlob((b) => b && subirDirecto(`/api/directo/${directo.sesion}/cuadro`, b, 'image/jpeg'), 'image/jpeg', 0.6)
}

async function detenerDirecto() {
  const sesion = directo.sesion
  if (!sesion) return
  directo.sesion = null
  clearInterval(directo.timer)
  clearInterval(directo.reloj)
  directo.grabadores.forEach((r) => r.state !== 'inactive' && r.stop()) // cada uno sube su último tramo
  await dormir(400)
  directo.pantalla?.getTracks().forEach((t) => t.stop())
  directo.mic?.getTracks().forEach((t) => t.stop())
  Object.assign(directo, { pantalla: null, mic: null, video: null })
  pintarIndicadorDirecto()
  toast('Apagando el Directo<small>Termino de procesar lo último y escribo el informe…</small>', 'suave')
  try {
    await Promise.allSettled([...directo.subidas])
    const s = await api(`/directo/${sesion}/cerrar`, {})
    toast('Informe del Directo listo<small>Lo tenés en Directo y en Hoy.</small>')
    await refrescar()
    if (vista === 'directo') montarDirecto()
    else abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Informe del Directo</h2><div class="md">${md(s.informe ?? '')}</div>`)
  } catch (e) { error(e) }
}

function pintarIndicadorDirecto() {
  const b = $('#btn-directo')
  if (!b) return
  const huerfano = !directo.sesion && E?.hoy?.directo
  b.classList.toggle('on', !!directo.sesion)
  b.classList.toggle('huerfano', !!huerfano)
  if (directo.sesion) {
    const s = Math.floor((Date.now() - directo.inicio) / 1000)
    b.textContent = `● ${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    b.title = 'En directo: tocá para apagar'
  } else {
    b.textContent = huerfano ? '● Directo (sin señal)' : '● Directo'
    b.title = huerfano ? 'Quedó un Directo abierto sin señal: tocá para retomarlo o cerrarlo' : 'Prender el Directo: Mastropiero ve tu pantalla y te escucha'
  }
}

// Vista Directo: la sesión en curso y los informes

const ICONO_MOMENTO = { pantalla: '▣', voz: '🗣', medio: '♪' }
let directoFirma = ''

async function montarDirecto() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Directo</h1><p>Lo que Mastropiero ve y escucha mientras trabajás, y lo que entiende de eso. Se prende y se apaga desde el botón ● de arriba.</p>
      <div class="fila"><button class="btn btn-primario" id="dv-boton">${directo.sesion ? 'Apagar el Directo' : '● Prender el Directo'}</button></div></div>
    <div id="dv"></div>`
  $('#dv-boton').onclick = modalDirecto
  try {
    const d = await api('/directo')
    directoFirma = JSON.stringify(E.hoy?.directo ?? null)
    const momento = (m) => `<div class="momento ${m.tipo}"><span class="mo-hora">${new Date(m.desde).toTimeString().slice(0, 5)}${m.hasta - m.desde > 90_000 ? `<small>${Math.round((m.hasta - m.desde) / 60000)}′</small>` : ''}</span><i>${ICONO_MOMENTO[m.tipo] ?? '·'}</i>
      <div>${m.tipo === 'pantalla' ? `<b>${esc([m.app, m.actividad].filter(Boolean).join(' · '))}</b>${m.detalle ? `<small>${esc(m.detalle)}</small>` : ''}${m.nota ? `<p>${esc(m.nota)}</p>` : ''}`
        : `<b>${m.tipo === 'voz' ? 'Dijiste' : `Escuchaste${m.detalle ? ` · ${esc(m.detalle)}` : ''}`}</b><p>${esc((m.texto ?? '').slice(0, 600))}</p>`}</div></div>`
    $('#dv').innerHTML = `
      ${d.activa ? `<section class="panel"><h3>En curso · desde las ${new Date(d.activa.inicio).toTimeString().slice(0, 5)}</h3>
        ${d.activa.momentos.length ? `<div class="momentos">${d.activa.momentos.slice().reverse().map(momento).join('')}</div>` : '<p class="tenue">Todavía nada: el primer cuadro llega en unos segundos y la voz al minuto.</p>'}</section>` : ''}
      <h3 class="sub">Informes</h3>
      ${d.sesiones.length ? d.sesiones.map((s) => `<details class="run-pasada"><summary><b>${esc(new Date(s.inicio).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }))}</b> ${new Date(s.inicio).toTimeString().slice(0, 5)}–${s.fin ? new Date(s.fin).toTimeString().slice(0, 5) : '…'}${s.resumen?.minutosPorActividad ? ` · ${esc(Object.entries(s.resumen.minutosPorActividad).slice(0, 3).map(([k, v]) => `${k} ${v}′`).join(', '))}` : ''}</summary>
        <div class="md">${md(s.informe ?? '')}</div>${s.piezaId ? `<p><a href="#" class="ref" data-pieza="${s.piezaId}">abrir en el corpus</a></p>` : ''}</details>`).join('') : '<div class="vacio"><div class="gran">◎</div><h2>Todavía no prendiste el Directo</h2><p>Prendelo cuando trabajes: Mastropiero va a entender qué hacés, qué mirás y qué decís, y te deja un informe.</p></div>'}`
  } catch (e) { error(e) }
}

function refrescarDirecto() {
  const f = JSON.stringify(E.hoy?.directo ?? null)
  if (f !== directoFirma) montarDirecto()
}
