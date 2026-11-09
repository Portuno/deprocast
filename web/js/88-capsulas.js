'use strict'
// Las cápsulas de 40 s (Fragua #163): grabar a una persona diciendo algo, con cámara, solo después de su consentimiento.
// Primero se escribe para qué se va a usar y la persona acepta; después se graba (40 s como mucho). El video queda en
// tu servidor (no va al corpus ni a ningún modelo) y se borra cuando la persona lo pida.

const CAP_MAX = 40
const cap = { stream: null, grabador: null, partes: [], reloj: null, inicio: 0, blob: null, datos: null }

async function montarCapsulas() {
  pararCamaraCap()
  $('#principal').innerHTML = `<div class="capsulas">
    <div class="titulo"><h1>Cápsulas</h1><p>Grabá a alguien diciendo algo, ${CAP_MAX} segundos como mucho, solo con su consentimiento. Lo que se puede hacer con el video queda escrito antes de grabar, y la persona puede pedir que se borre.</p>
      <div class="fila"><button class="btn btn-primario" id="cap-nueva">＋ Nueva cápsula</button></div></div>
    <div id="cap-paso"></div>
    <section><h3 class="sub">Grabadas</h3><div id="cap-lista" class="cap-lista"><p class="tenue">Cargando…</p></div></section>
  </div>`
  $('#cap-nueva').onclick = pasoConsentimiento
  pintarCapsulas()
}

async function pintarCapsulas() {
  let cs
  try { cs = await api('/capsulas') } catch (e) { return error(e) }
  const cont = $('#cap-lista')
  if (!cont) return
  cont.innerHTML = cs.length ? cs.map((c) => `<article class="tarjeta cap-item${c.estado === 'borrada' ? ' borrada' : ''}">
      <b>${esc(c.persona)}</b><small class="tenue">${new Date(c.creada).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${c.duracion ? ` · ${Math.round(c.duracion)} s` : ''}</small>
      ${c.estado === 'vigente' ? `<video src="/api/capsulas/${c.id}/video" controls preload="none"></video>` : `<p class="tenue chico">Video borrado ${c.borradaEn ? new Date(c.borradaEn).toLocaleDateString('es-AR') : ''} (${esc(c.motivoBorrado ?? '')}).</p>`}
      <p class="chico"><b>Uso permitido:</b> ${esc(c.uso)}</p>
      <details class="chico"><summary class="tenue">Consentimiento</summary><p>${esc(c.consentimiento)}</p></details>
      ${c.estado === 'vigente' ? `<div class="fila"><button class="btn btn-chico btn-peligro" data-borrar-cap="${c.id}">Borrar (a pedido)</button></div>` : ''}
    </article>`).join('') : '<p class="tenue">Ninguna todavía.</p>'
  $$('[data-borrar-cap]', cont).forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('¿Borrar el video de esta cápsula?', { detalle: 'Se borra el video del servidor. Queda solo el registro de que existió, con su consentimiento y cuándo se borró.', si: 'Borrar', peligro: true }))) return
    try { await api(`/capsulas/${b.dataset.borrarCap}/borrar`, { motivo: 'a pedido de la persona' }); toast('Video borrado', 'suave'); pintarCapsulas() } catch (e) { error(e) }
  }))
}

/** Paso 1: quién, para qué, y que la persona acepte (antes de prender la cámara). */
function pasoConsentimiento() {
  $('#cap-paso').innerHTML = `<form class="tarjeta cap-form" id="cap-consent">
    <h3 class="sub">1 · El consentimiento</h3>
    <label class="campo">Quién se graba<input name="persona" required placeholder="Nombre y apellido" autocomplete="off"></label>
    <label class="campo">Para qué se va a usar (se le lee antes de grabar)<textarea name="uso" rows="2" required placeholder="Ej.: un testimonio para la web de Versa; no se publica en redes ni se usa para otra cosa"></textarea></label>
    <label class="fila g-1 chico"><input type="checkbox" name="acepto" required> La persona escuchó para qué se usa, aceptó grabar hasta ${CAP_MAX} segundos para eso y sabe que puede pedir que se borre.</label>
    <div class="fila"><button class="btn btn-primario">Seguir: prender la cámara</button><button type="button" class="btn" id="cap-cancelar">Cancelar</button></div>
  </form>`
  $('#cap-cancelar').onclick = () => { $('#cap-paso').innerHTML = '' }
  $('#cap-consent').onsubmit = (ev) => {
    ev.preventDefault()
    const d = Object.fromEntries(new FormData(ev.target))
    if (!d.acepto) return toast('Sin el consentimiento no se graba', 'error')
    cap.datos = { persona: d.persona.trim(), uso: d.uso.trim(), consentimiento: `${d.persona.trim()} aceptó grabar hasta ${CAP_MAX} segundos para: «${d.uso.trim()}». Sabe que puede pedir que se borre. (${new Date().toLocaleString('es-AR')})` }
    pasoCamara()
  }
}

/** Paso 2: la cámara, la cuenta regresiva y el corte solo a los 40 s. */
async function pasoCamara() {
  $('#cap-paso').innerHTML = `<div class="tarjeta cap-form cap-camara">
    <h3 class="sub">2 · Grabar · ${esc(cap.datos.persona)}</h3>
    <video id="cap-video" autoplay muted playsinline></video>
    <div class="cap-reloj" id="cap-reloj">${CAP_MAX}</div>
    <div class="fila"><button class="btn btn-primario" id="cap-grabar">● Grabar</button><button class="btn" id="cap-parar" disabled>■ Parar</button><button class="btn" id="cap-salir">Cancelar</button></div>
    <div id="cap-revisar" class="fila"></div>
  </div>`
  try {
    cap.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    $('#cap-video').srcObject = cap.stream
  } catch (e) { toast(`No pude abrir la cámara: ${esc(e.message ?? e)}`, 'error'); return }
  $('#cap-salir').onclick = () => { pararCamaraCap(); $('#cap-paso').innerHTML = '' }
  $('#cap-grabar').onclick = () => {
    cap.partes = []
    const tipo = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm'
    cap.grabador = new MediaRecorder(cap.stream, { mimeType: tipo })
    cap.grabador.ondataavailable = (e) => { if (e.data.size) cap.partes.push(e.data) }
    cap.grabador.onstop = revisarCapsula
    cap.grabador.start(1000)
    cap.inicio = Date.now()
    $('#cap-grabar').disabled = true
    $('#cap-parar').disabled = false
    cap.reloj = setInterval(() => {
      const quedan = Math.max(0, CAP_MAX - Math.floor((Date.now() - cap.inicio) / 1000))
      $('#cap-reloj').textContent = quedan
      if (quedan <= 0) pararGrabacion()
    }, 250)
  }
  $('#cap-parar').onclick = pararGrabacion
}

function pararGrabacion() {
  clearInterval(cap.reloj)
  if (cap.grabador?.state === 'recording') cap.grabador.stop()
}

function revisarCapsula() {
  const segundos = Math.min(CAP_MAX, (Date.now() - cap.inicio) / 1000)
  cap.blob = new Blob(cap.partes, { type: 'video/webm' })
  pararCamaraCap()
  const v = $('#cap-video')
  if (!v) return
  v.srcObject = null
  v.src = URL.createObjectURL(cap.blob)
  v.muted = false
  v.controls = true
  $('#cap-revisar').innerHTML = '<button class="btn btn-primario" id="cap-guardar">Guardar</button><button class="btn" id="cap-otra">Grabar de nuevo</button>'
  $('#cap-otra').onclick = pasoCamara
  $('#cap-guardar').onclick = async () => {
    const q = new URLSearchParams({ ...cap.datos, acepto: '1', duracion: segundos.toFixed(1) })
    try {
      const r = await fetch(`/api/capsulas?${q}`, { method: 'POST', body: cap.blob, headers: { 'content-type': 'video/webm' } })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast('Cápsula guardada', 'suave')
      $('#cap-paso').innerHTML = ''
      pintarCapsulas()
    } catch (e) { error(e) }
  }
}

function pararCamaraCap() {
  clearInterval(cap.reloj)
  cap.stream?.getTracks().forEach((t) => t.stop())
  cap.stream = null
}
