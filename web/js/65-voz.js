'use strict'
// La voz con Mastropiero:
// - 🎙 dictar: un toque graba, otro corta; lo dicho entra al chat como suyo.
// - 🎧 charla en vivo: el micrófono queda abierto, detecta cuándo habla (por volumen) y manda cada frase; Mastropiero
//   contesta en voz alta, frase por frase a medida que escribe. Si le habla encima, se calla.
// - 🔊 leer en voz alta: las respuestas también suenan, aunque escriba.
// - Mantener Alt (en cualquier pantalla): hablarle sin ir a Hoy; la respuesta aparece en un globo.
// Todo lo dicho queda escrito en el chat (marcado 🎙 / 🔊).

const voz = {
  leer: false, // se lee de las preferencias al arrancar (pref vive en 90-arranque.js, que carga después)
  dictado: null, // { stream, rec, listo, desde }
  vivo: null, // la charla en vivo: { stream, ctx, an, buf, hablando, rec, voz0, silencio0, timer }
  cola: [], // frases para decir: { texto, url (promesa) }
  audio: null, // lo que está sonando
  lectura: null, // el turno que se está leyendo: { cid, desdeId, dichas }
  alt: null, // la tecla para hablar: { t, rec }
}
const teclaVoz = () => pref.leer('mastro-voz-tecla', 'Alt')
document.addEventListener('DOMContentLoaded', () => { voz.leer = pref.leer('mastro-voz-leer', 'no') === 'si' })

// ─── grabar ─────────────────────────────────────────────────────────────

const microfono = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  .catch((e) => { throw e?.name === 'NotAllowedError' ? new Error('El micrófono está bloqueado: permítalo en el navegador (el candado, al lado de la dirección)') : e })

function grabador(stream) {
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
  const partes = []
  rec.ondataavailable = (e) => e.data.size && partes.push(e.data)
  const listo = new Promise((ok) => (rec.onstop = () => ok(new Blob(partes, { type: partes[0]?.type || 'audio/webm' }))))
  rec.start()
  return { rec, listo, desde: Date.now() }
}

/** La conversación donde va lo dicho: la abierta en Chat u Hoy (o una nueva); desde otra pantalla, la de Hoy. */
async function conversacionParaVoz(global = false) {
  if (!global && (vista === 'chat' || vista === 'hoy')) {
    if (!chat.actual) {
      const c = await api('/chat', { con: 'mastropiero' })
      chat.actual = c
      chat.conversaciones.unshift(c)
    }
    return chat.actual.id
  }
  return E?.hoy?.conversacion ?? (await api('/hoy')).conversacion
}

/** Manda lo grabado: se transcribe en el servidor y entra al chat. Devuelve lo que entendió (null si fue ruido). */
async function mandarVoz(cid, blob, segundos) {
  // Si todavía está contestando, no espera: lo que dijo entra a ese turno (o a la respuesta que sigue).
  const hud = window.hudModoActual?.() ?? ''
  const r = await fetch(`/api/chat/${cid}/voz?nombre=voz.webm&segundos=${segundos}${hud ? `&hud=${encodeURIComponent(hud)}` : ''}`, { method: 'POST', body: blob })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error)
  return j.texto
}

/** Lo dicho entra al hilo abierto como si lo hubiera escrito (marcado voz) y se sigue el turno. */
function entrarAlHilo(cid, texto, leer) {
  if (!texto) return toast('No te escuché bien: probá de nuevo, más cerca del micrófono', 'suave')
  const ultimo = chat.mensajes.reduce((m, x) => (x.id > m ? x.id : m), 0)
  if (leer) voz.lectura = { cid, desdeId: ultimo, dichas: 0 }
  if (chat.actual?.id === cid && (vista === 'chat' || vista === 'hoy')) {
    chat.mensajes.push({ id: -1, rol: 'operador', texto, via: 'voz' })
    chat.pensando = true
    pintarChat()
    seguirTurno()
  }
}

// ─── 🎙 dictar ──────────────────────────────────────────────────────────

async function alternarDictado() {
  const b = $('#chat-dictar')
  if (voz.dictado) {
    const d = voz.dictado
    voz.dictado = null
    d.rec.rec.stop()
    d.stream.getTracks().forEach((t) => t.stop())
    b?.classList.remove('grabando')
    const blob = await d.rec.listo
    const segundos = Math.round((Date.now() - d.rec.desde) / 1000)
    if (blob.size < 1500) return toast('El audio quedó vacío', 'suave')
    try {
      const cid = await conversacionParaVoz()
      if (b) b.disabled = true
      entrarAlHilo(cid, await mandarVoz(cid, blob, segundos), voz.leer)
    } catch (e) { error(e) } finally { if (b) b.disabled = false }
    return
  }
  try {
    const stream = await microfono()
    voz.dictado = { stream, rec: grabador(stream) }
    b?.classList.add('grabando')
  } catch (e) { error(e) }
}

// ─── 🎧 charla en vivo ──────────────────────────────────────────────────

async function alternarCharlaEnVivo() {
  if (voz.vivo) return apagarCharla()
  try {
    const stream = await microfono()
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(an)
    voz.vivo = { stream, ctx, an, buf: new Float32Array(an.fftSize), hablando: false, rec: null, voz0: 0, silencio0: 0 }
    voz.vivo.timer = setInterval(escucharTick, 50)
    pintarBotonesVoz()
    toast('Charla en vivo<small>Hable cuando quiera: le contesto en voz alta. 🎧 de nuevo para cortar.</small>', 'suave')
  } catch (e) { error(e) }
}

function apagarCharla() {
  const v = voz.vivo
  if (!v) return
  clearInterval(v.timer)
  if (v.rec) v.rec.rec.stop()
  v.stream.getTracks().forEach((t) => t.stop())
  v.ctx.close()
  voz.vivo = null
  callar()
  pintarBotonesVoz()
}

/** Cada 50 ms: ¿está hablando? Empieza a grabar con la voz y manda la frase después de ~0,9 s de silencio. */
function escucharTick() {
  const v = voz.vivo
  if (!v) return
  v.an.getFloatTimeDomainData(v.buf)
  let s = 0
  for (const x of v.buf) s += x * x
  const nivel = Math.sqrt(s / v.buf.length)
  // Mientras suena Mastropiero, hace falta más volumen (que el parlante no se escuche a sí mismo).
  const umbral = voz.audio ? 0.07 : 0.022
  const ahora = Date.now()
  $('#chat-vivo')?.classList.toggle('oyendo', nivel > umbral)
  if (nivel > umbral) {
    v.silencio0 = 0
    if (!v.hablando) {
      if (!v.voz0) v.voz0 = ahora
      if (ahora - v.voz0 > 120) {
        v.hablando = true
        callar() // le habló encima: se calla
        v.rec = grabador(v.stream)
      }
    }
  } else {
    v.voz0 = 0
    if (v.hablando) {
      if (!v.silencio0) v.silencio0 = ahora
      if (ahora - v.silencio0 > 900) {
        v.hablando = false
        const r = v.rec
        v.rec = null
        r.rec.stop()
        const segundos = Math.round((ahora - r.desde) / 1000)
        if (ahora - r.desde < 600) return
        r.listo.then(async (blob) => {
          try {
            const cid = await conversacionParaVoz()
            entrarAlHilo(cid, await mandarVoz(cid, blob, segundos), true)
          } catch (e) { error(e) }
        })
      }
    }
  }
}

// ─── 🔊 que suene ───────────────────────────────────────────────────────

/**
 * Corta un texto en frases desde una posición: termina una frase un punto (o ! ? …) seguido de espacio, dos puntos o
 * punto y coma seguidos de espacio («10:43» no corta), o un salto de línea. Con el turno terminado, el resto también va.
 */
function frasesDesde(texto, desde, terminado) {
  const frases = []
  let i = desde
  const re = /[.!?…]+(?=\s|$)|[:;](?=\s)|\n+/g
  re.lastIndex = desde
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const fin = m.index + m[0].length
    const f = texto.slice(i, fin).trim()
    if (f) frases.push(f)
    i = fin
  }
  if (terminado && texto.slice(i).trim()) { frases.push(texto.slice(i).trim()); i = texto.length }
  return { frases, hasta: i }
}
const frasesDe = (texto, terminado) => frasesDesde(texto, 0, terminado).frases

/** Después de cada lectura del turno: lo nuevo que escribió Mastropiero se encola para decir. */
window.vozAvance = function vozAvance() {
  const l = voz.lectura
  if (!l || chat.actual?.id !== l.cid) return
  // Sin el bloque de acciones rápidas ([[seguir]]): eso son botones, no se dice.
  const textos = chat.mensajes.filter((m) => m.id > l.desdeId && m.rol === 'asistente' && m.texto).map((m) => partirSeguir(m.texto).texto)
  const borrador = chat.pensando ? partirSeguir(chat.vivo?.borrador ?? '', true).texto : ''
  const todo = [...textos, borrador].filter(Boolean).join('\n\n')
  if (l.dichas === Infinity) { if (!chat.pensando) voz.lectura = null; return } // le habló encima: este turno ya no se lee
  // l.dichas: hasta qué posición del texto ya se encoló (por posición, así nada se pierde ni se repite).
  const { frases, hasta } = frasesDesde(todo, Math.min(l.dichas, todo.length), !chat.pensando)
  for (const f of frases) encolar(f)
  l.dichas = hasta
  if (!chat.pensando) voz.lectura = null
}

function encolar(texto) {
  if (!texto.replace(/[^\p{L}\p{N}]/gu, '')) return
  // Se pide el audio enseguida (mientras suena la anterior): así no hay huecos.
  voz.cola.push({ texto, url: api('/voz/decir', { texto }).then((r) => r.url).catch(() => null) })
  if (!voz.audio) sonarSiguiente()
}

async function sonarSiguiente() {
  const f = voz.cola.shift()
  if (!f) { voz.audio = null; return }
  const url = await f.url
  if (!url) return sonarSiguiente()
  const a = new Audio(url)
  voz.audio = a
  a.onended = a.onerror = () => { if (voz.audio === a) sonarSiguiente() }
  try { await a.play() } catch { voz.audio = null; voz.cola = [] }
}

/** Se calla: corta lo que suena y vacía la cola. */
function callar() {
  voz.cola = []
  if (voz.audio) { voz.audio.onended = null; voz.audio.pause(); voz.audio = null }
  if (voz.lectura) voz.lectura.dichas = Infinity
}

function alternarLeer() {
  voz.leer = !voz.leer
  pref.guardar('mastro-voz-leer', voz.leer ? 'si' : 'no')
  if (!voz.leer) callar()
  pintarBotonesVoz()
}

// ─── los botones del compositor ─────────────────────────────────────────

function pintarBotonesVoz() {
  $('#chat-vivo')?.classList.toggle('on', !!voz.vivo)
  $('#chat-leer')?.classList.toggle('on', voz.leer)
  $('#chat-dictar')?.classList.toggle('grabando', !!voz.dictado)
}

window.engancharVoz = function engancharVoz() {
  const d = $('#chat-dictar')
  if (!d) return
  // Un toque dicta (y otro manda); mantenerlo apretado es como mantener Alt: habla mientras lo aprieta y al soltar manda.
  let espera = null
  let manteniendo = false
  d.onpointerdown = () => { manteniendo = false; espera = setTimeout(() => { manteniendo = true; voz.alt = { t: null }; empezarAlt() }, 350) }
  d.onpointerup = d.onpointercancel = () => { clearTimeout(espera); if (manteniendo) terminarAlt(true) }
  d.onclick = (e) => { if (manteniendo) { manteniendo = false; e.preventDefault(); return } alternarDictado() }
  $('#chat-vivo').onclick = alternarCharlaEnVivo
  $('#chat-leer').onclick = alternarLeer
  pintarBotonesVoz()
}

// ─── mantener Alt: hablarle desde cualquier pantalla ────────────────────

function globo(html, quedar = 12000) {
  let g = $('#voz-globo')
  if (!g) {
    g = document.createElement('div')
    g.id = 'voz-globo'
    g.className = 'voz-globo'
    g.onclick = () => { g.hidden = true; irA('hoy') }
    document.body.appendChild(g)
  }
  g.innerHTML = html
  g.hidden = false
  clearTimeout(g.dataset.t)
  if (quedar) g.dataset.t = setTimeout(() => (g.hidden = true), quedar)
}

async function empezarAlt() {
  try {
    const stream = await microfono()
    if (!voz.alt) return stream.getTracks().forEach((t) => t.stop())
    voz.alt.stream = stream
    voz.alt.rec = grabador(stream)
    callar()
    globo('<b>🎙 Le escucho…</b><small>Suelte para mandar</small>', 0)
  } catch (e) { voz.alt = null; error(e) }
}

async function terminarAlt(mandar) {
  const a = voz.alt
  voz.alt = null
  if (!a) return
  clearTimeout(a.t)
  if (!a.rec) return
  a.rec.rec.stop()
  a.stream.getTracks().forEach((t) => t.stop())
  if (!mandar) return globo('Cancelado.', 2000)
  const blob = await a.rec.listo
  const segundos = Math.round((Date.now() - a.rec.desde) / 1000)
  if (blob.size < 1500 || segundos < 1) return globo('No llegué a escucharle.', 2500)
  globo('<b>Transcribiendo…</b>', 0)
  try {
    const enVista = vista === 'chat' || vista === 'hoy'
    const cid = await conversacionParaVoz(!enVista)
    const texto = await mandarVoz(cid, blob, segundos)
    if (!texto) return globo('No le entendí: pruebe de nuevo.', 3000)
    if (enVista && chat.actual?.id === cid) { $('#voz-globo') && ($('#voz-globo').hidden = true); return entrarAlHilo(cid, texto, voz.leer) }
    globo(`<b>Usted:</b> ${esc(texto)}<small>Mastropiero está pensando…</small>`, 0)
    seguirGlobo(cid)
  } catch (e) { globo(esc(e.message), 4000) }
}

/** Desde otra pantalla: se sigue el turno y la respuesta aparece en el globo (y suena, si «leer» está prendido). */
async function seguirGlobo(cid) {
  const desde = (await api(`/chat/${cid}?ultimos=1`)).mensajes.at(-1)?.id ?? 0
  const base = Math.max(0, desde - 1)
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 700))
    const r = await api(`/chat/${cid}?desde=${base}`).catch(() => null)
    if (!r) continue
    const texto = r.mensajes.filter((m) => m.rol === 'asistente' && m.texto).map((m) => partirSeguir(m.texto).texto).join('\n\n') || partirSeguir(r.vivo?.borrador ?? '', true).texto
    if (texto) globo(`<b>Mastropiero:</b> ${esc(texto.slice(0, 600))}${texto.length > 600 ? '…' : ''}<small>${r.pensando ? 'escribiendo…' : 'Toque para abrir Hoy'}</small>`, r.pensando ? 0 : 20000)
    if (!r.pensando) {
      if (voz.leer && texto) frasesDe(texto, true).forEach(encolar)
      return
    }
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === teclaVoz()) {
    if (e.repeat || voz.alt) return
    voz.alt = { t: setTimeout(empezarAlt, 300) }
    return
  }
  // Cualquier otra tecla con Alt apretado es un atajo (Alt+1, Alt+F): no es para hablar.
  if (voz.alt) terminarAlt(false)
}, true)
document.addEventListener('keyup', (e) => {
  if (e.key !== teclaVoz() || !voz.alt) return
  if (voz.alt.rec) e.preventDefault()
  terminarAlt(true)
}, true)
window.addEventListener('blur', () => { if (voz.alt) terminarAlt(false) })
