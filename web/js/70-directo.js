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
    <p class="tenue">Mastropiero mira tu pantalla y te escucha mientras trabajás. Al apagarlo te deja un resumen y una bandeja: tareas, entidades, conexiones, ideas y lo que miraste. Nada de eso entra solo; lo aceptás o lo descartás. Lo que decís en voz alta sí queda, porque es tuyo. Las capturas no se guardan.</p>
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
    try { trasCerrar(await api(`/directo/${huerfano.id}/cerrar`, {})) } catch (e) { error(e) }
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
    trasCerrar(await api(`/directo/${sesion}/cerrar`, {}))
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
  const nav = document.querySelector('#nav button[data-vista="directo"]')
  if (nav && E) {
    const n = E.hoy?.directoPorRevisar ?? 0
    let em = nav.querySelector('.badge')
    if (!n) em?.remove()
    else {
      if (!em) { em = document.createElement('em'); em.className = 'badge'; nav.append(em) }
      em.textContent = String(n)
    }
  }
}

// Vista Directo: la sesión en curso y la bandeja de lo que hay que aceptar

const ICONO_MOMENTO = { pantalla: '▣', voz: '🗣', medio: '♪' }
const GRUPOS_DIRECTO = [
  ['cumplida', 'Parecen hechas', 'Hecha'],
  ['banda', 'Bandas', 'Hecha'],
  ['tarea', 'Tareas nuevas', 'Side quest'],
  ['entidad', 'Entidades', 'Anotar'],
  ['conexion', 'Conexiones', 'Anotar'],
  ['idea', 'Ideas', 'A la memoria'],
  ['medio', 'Lo que viste o escuchaste', 'Al corpus'],
]
let directoFirma = ''

const horaDe = (t) => new Date(t).toTimeString().slice(0, 5)
const pendDirecto = (s) => (s.resumen?.propuestas ?? []).filter((p) => p.estado === 'pendiente')

function subtituloProp(p) {
  if (p.tipo === 'entidad') {
    const alias = p.alias?.length ? ` · alias ${p.alias.join(', ')}` : ''
    return [p.tipoEntidad, p.detalle].filter(Boolean).join(' · ') + alias
  }
  if (p.tipo === 'conexion') return p.detalle || ''
  if (p.tipo === 'medio') return [p.tipoEntidad, p.detalle].filter(Boolean).join(' · ')
  return p.detalle || ''
}

function tableroDirecto(s) {
  const ps = s.resumen?.propuestas ?? []
  const chips = Object.entries(s.resumen?.minutosPorActividad ?? {}).slice(0, 6).map(([k, v]) => `<span class="chip">${esc(k)} ${v}′</span>`).join('')
  const texto = (s.informe ?? '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('')
  const grupos = GRUPOS_DIRECTO.map(([tipo, nombre, verbo]) => {
    const xs = ps.filter((p) => p.tipo === tipo && p.estado !== 'rechazada')
    if (!xs.length) return ''
    const vivos = xs.filter((p) => p.estado === 'pendiente')
    const ids = vivos.map((p) => p.id).join(',')
    return `<section class="dir-grupo" data-grupo="${tipo}">
      <header><h4>${nombre}${vivos.length ? ` <em>${vivos.length}</em>` : ''}</h4>
        ${vivos.length > 1 ? `<span class="fila"><button class="btn btn-chico" data-acc="aceptar" data-ids="${esc(ids)}">Aceptar estas</button><button class="btn btn-chico" data-acc="rechazar" data-ids="${esc(ids)}">Ninguna</button></span>` : ''}</header>
      ${xs.map((p) => `<div class="sq ${p.estado}" data-prop="${esc(p.id)}"><span><b>${esc(p.titulo)}</b>${subtituloProp(p) ? `<small>${esc(subtituloProp(p))}</small>` : ''}</span>
        ${p.estado === 'pendiente'
          ? `<span class="fila"><button class="btn btn-chico btn-primario" data-acc="aceptar">${verbo}</button><button class="btn btn-chico" data-acc="rechazar" title="Descartar">✕</button></span>`
          : '<em class="dir-ok">✓</em>'}</div>`).join('')}
    </section>`
  }).join('')
  const quedan = pendDirecto(s).length
  const tramos = s.resumen?.tramos ?? []
  const porHoras = s.estado === 'cerrada' && tramos.length > 1
    ? `<details class="dir-tramos"><summary class="tenue chico">Lo anotado hora por hora (${tramos.length})</summary>${tramos.map((t) => `<p><b>${horaDe(t.desde)}–${horaDe(t.hasta)}</b> ${esc(t.texto)}</p>`).join('')}</details>`
    : ''
  return `<div class="dir-tablero" data-sesion="${s.id}">
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    <div class="dir-texto">${texto}</div>
    ${/^No pude escribir el informe/.test(s.informe ?? '') ? `<p class="fila"><span class="tenue">Lo que viste y escuchaste quedó guardado; faltó el informe (seguramente se cortó internet).</span><button class="btn btn-chico btn-primario" data-rehacer="${s.id}">Reintentar el informe</button></p>` : ''}
    ${porHoras}
    ${grupos || '<p class="tenue chico">No salió nada para anotar.</p>'}
    ${quedan ? `<p class="dir-nota">Nada de esto entró solo. Aceptá lo que quieras guardar.</p>` : (ps.length ? '<p class="dir-nota">No queda nada por revisar.</p>' : '')}
  </div>`
}

function resumenSesion(s) {
  const cuando = `${new Date(s.inicio).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} ${new Date(s.inicio).toTimeString().slice(0, 5)}–${s.fin ? new Date(s.fin).toTimeString().slice(0, 5) : '…'}`
  const n = pendDirecto(s).length
  const mins = s.resumen?.minutosPorActividad ? Object.entries(s.resumen.minutosPorActividad).slice(0, 3).map(([k, v]) => `${k} ${v}′`).join(', ') : ''
  return { cuando, n, mins }
}

async function trasCerrar(s) {
  await refrescar()
  if (vista === 'directo') montarDirecto()
  else mostrarRevision(s)
}

function mostrarRevision(s) {
  const bandeja = Array.isArray(s.resumen?.propuestas)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Del Directo</h2>
    ${bandeja ? tableroDirecto(s) : `<div class="md">${md(s.informe ?? '')}</div>`}`)
  if (bandeja) engancharTablero($('#modal'))
}

function engancharTablero(raiz) {
  $$('[data-rehacer]', raiz).forEach((b) => (b.onclick = async () => {
    b.disabled = true
    b.textContent = 'Escribiendo…'
    try { const s = await api(`/directo/${b.dataset.rehacer}/informe`, {}); if ($('#modal')?.contains(b)) mostrarRevision(s); else if (vista === 'directo') montarDirecto() } catch (e) { error(e); b.disabled = false; b.textContent = 'Reintentar el informe' }
  }))
  $$('[data-acc]', raiz).forEach((btn) => {
    btn.onclick = async () => {
      const tablero = btn.closest('[data-sesion]')
      const sesion = tablero?.dataset.sesion
      const ids = btn.dataset.ids ? btn.dataset.ids.split(',').filter(Boolean) : [btn.closest('[data-prop]')?.dataset.prop].filter(Boolean)
      if (!sesion || !ids.length) return
      btn.disabled = true
      try {
        const r = await api(`/directo/${sesion}/propuesta`, { ids, accion: btn.dataset.acc })
        aplicarEnPantalla(sesion, r.propuestas)
        const verbos = { tarea: 'Side quest anotada', cumplida: 'Marcada hecha', banda: 'Banda hecha', entidad: 'Entidad anotada', conexion: 'Conexión anotada', idea: 'Quedó en la memoria', medio: 'Entró al corpus' }
        const uno = r.propuestas.length === 1 ? r.propuestas[0] : null
        toast(btn.dataset.acc === 'rechazar' ? (r.propuestas.length > 1 ? 'Descartadas' : 'Descartada') : (uno ? verbos[uno.tipo] ?? 'Anotado' : `${r.propuestas.length} anotadas`), 'suave')
        refrescar()
      } catch (e) { error(e); btn.disabled = false }
    }
  })
}

function aplicarEnPantalla(sesion, propuestas) {
  for (const p of propuestas) {
    $$(`[data-sesion="${sesion}"] [data-prop="${CSS.escape(p.id)}"]`).forEach((fila) => {
      if (p.estado === 'rechazada') fila.remove()
      else {
        fila.classList.remove('pendiente')
        fila.classList.add('aceptada')
        const botones = fila.querySelector('.fila')
        if (botones) botones.outerHTML = '<em class="dir-ok">✓</em>'
      }
    })
  }
  $$(`[data-sesion="${sesion}"]`).forEach((tablero) => {
    $$('.dir-grupo', tablero).forEach((g) => {
      const vivos = $$('[data-prop]:not(.aceptada)', g)
      const em = g.querySelector('h4 em')
      if (em) { if (vivos.length) em.textContent = String(vivos.length); else em.remove() }
      const cab = g.querySelector('header .fila')
      if (cab) {
        if (vivos.length < 2) cab.remove()
        else cab.querySelectorAll('[data-ids]').forEach((b) => { b.dataset.ids = vivos.map((f) => f.dataset.prop).join(',') })
      }
      if (!g.querySelector('[data-prop]')) g.remove()
    })
    const nota = $('.dir-nota', tablero)
    const quedan = $$('[data-prop]:not(.aceptada)', tablero).length
    if (nota) nota.textContent = quedan ? 'Nada de esto entró solo. Aceptá lo que quieras guardar.' : 'No queda nada por revisar.'
  })
  $$('[data-pend-sesion]').forEach((em) => {
    const tablero = $(`[data-sesion="${em.dataset.pendSesion}"]`)
    const n = tablero ? $$('[data-prop]:not(.aceptada)', tablero).length : 0
    em.textContent = n ? `${n} para revisar` : ''
  })
}

async function montarDirecto() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Directo</h1><p>El resumen de lo que Mastropiero vio, y una bandeja para aceptar o descartar. Las tareas, entidades y conexiones no entran solas.</p>
      <div class="fila"><button class="btn btn-primario" id="dv-boton">${directo.sesion ? 'Apagar el Directo' : '● Prender el Directo'}</button></div></div>
    <div id="dv"></div>`
  $('#dv-boton').onclick = modalDirecto
  try {
    const d = await api('/directo')
    directoFirma = JSON.stringify(E.hoy?.directo ?? null)
    const momento = (m) => `<div class="momento ${m.tipo}"><span class="mo-hora">${new Date(m.desde).toTimeString().slice(0, 5)}${m.hasta - m.desde > 90_000 ? `<small>${Math.round((m.hasta - m.desde) / 60000)}′</small>` : ''}</span><i>${ICONO_MOMENTO[m.tipo] ?? '·'}</i>
      <div>${m.tipo === 'pantalla' ? `<b>${esc([m.app, m.actividad].filter(Boolean).join(' · '))}</b>${m.detalle ? `<small>${esc(m.detalle)}</small>` : ''}${m.nota ? `<p>${esc(m.nota)}</p>` : ''}`
        : `<b>${m.tipo === 'voz' ? 'Dijiste' : `Escuchaste${m.detalle ? ` · ${esc(m.detalle)}` : ''}`}</b><p>${esc((m.texto ?? '').slice(0, 600))}</p>`}</div></div>`
    const cuerpo = (s) => Array.isArray(s.resumen?.propuestas)
      ? tableroDirecto(s)
      : `<div class="md">${md(s.informe ?? '')}</div>${s.piezaId ? `<p><a href="#" class="ref" data-pieza="${s.piezaId}">abrir en el corpus</a></p>` : ''}`
    $('#dv').innerHTML = `
      ${d.activa ? `<section class="panel"><h3>En curso · desde las ${new Date(d.activa.inicio).toTimeString().slice(0, 5)}</h3>
        ${d.activa.resumen?.tramos?.length
          ? tableroDirecto({ ...d.activa, informe: d.activa.resumen.tramos.map((t) => `${horaDe(t.desde)}–${horaDe(t.hasta)} · ${t.texto}`).join('\n\n') })
          : '<p class="tenue chico">Cada hora te dejo acá lo que vi, con sus propuestas: las podés ir aceptando sin apagarlo.</p>'}
        ${d.activa.momentos.length ? `<div class="momentos">${d.activa.momentos.slice().reverse().map(momento).join('')}</div>` : '<p class="tenue">Todavía nada: el primer cuadro llega en unos segundos y la voz al minuto.</p>'}</section>` : ''}
      <h3 class="sub">Informes</h3>
      ${d.sesiones.length ? d.sesiones.map((s) => {
        const r = resumenSesion(s)
        return `<details class="run-pasada" ${r.n ? 'open' : ''}><summary><b>${esc(r.cuando)}</b>${r.mins ? ` · ${esc(r.mins)}` : ''}${r.n ? ` <em class="dir-pend" data-pend-sesion="${s.id}">${r.n} para revisar</em>` : ''}</summary>${cuerpo(s)}</details>`
      }).join('') : '<div class="vacio"><div class="gran">◎</div><h2>Todavía no prendiste el Directo</h2><p>Prendelo cuando trabajes. Al cerrarlo, aceptás o descartás lo que Mastropiero creyó ver.</p></div>'}`
    engancharTablero($('#dv'))
  } catch (e) { error(e) }
}

function refrescarDirecto() {
  const f = JSON.stringify(E.hoy?.directo ?? null)
  if (f !== directoFirma) montarDirecto()
}
