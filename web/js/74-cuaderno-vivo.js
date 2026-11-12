'use strict'
// Cuaderno en vivo: un cuaderno digital (Huion Note u otra tableta) enchufado a la compu como tableta. Lo que se escribe en
// el papel se dibuja acá, a pantalla completa (la tableta cubre toda la pantalla: un trazo fuera de la hoja sería un
// clic en otra cosa). Al pasar de hoja —su tecla o botón, o una pausa larga— la hoja se guarda sola y va a Tandas como
// página de cuaderno: la nube la lee con visión y entra al corpus como cualquier hoja escaneada.

const CV = { nombre: 'Cuaderno', tecla: 'PageDown', pausaMin: 0, trazos: [], actual: null, enviadas: 0, cola: [], timer: null, reintento: null, aviso: '', capturando: false }
const cvLeer = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }
const cvGuardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin almacenamiento: sigue en memoria */ } }
const nombreTecla = (t) => (t?.startsWith('boton:') ? `botón ${t.slice(6)} del lápiz` : ({ ' ': 'Espacio', PageDown: 'Av Pág', PageUp: 'Re Pág', ArrowRight: '→', Enter: 'Enter' }[t] ?? t))

function modalCuadernoVivo() {
  Object.assign(CV, cvLeer('cv-ajustes', {}))
  const pendiente = cvLeer('cv-hoja', null)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>✒️ Cuaderno en vivo</h2>
    <p class="tenue">Con el cuaderno enchufado a la compu como tableta, lo que escribís en el papel aparece acá. Al pasar de hoja, la hoja se guarda sola y la nube la lee: entra al corpus como página de cuaderno (tareas, gastos e ideas incluidas).</p>
    <ol class="cv-pasos tenue">
      <li>En el driver de la tableta, el área de trabajo en <b>toda la pantalla</b> y <b>Windows Ink</b> prendido (para la presión).</li>
      <li>Apretá <b>Empezar</b>: la pantalla queda en blanco, a pantalla completa. Escribí en el papel como siempre.</li>
      <li>Al dar vuelta la hoja, apretá <b>${esc(nombreTecla(CV.tecla))}</b>. <b>Esc</b> termina (y manda la hoja que estaba a medias).</li>
    </ol>
    <label class="campo">Nombre del cuaderno<input id="cv-nombre" class="campo-suelto" value="${esc(CV.nombre)}" maxlength="60"></label>
    <div class="fila cv-fila"><span>Hoja nueva con: <b id="cv-tecla">${esc(nombreTecla(CV.tecla))}</b></span><button class="btn btn-chico" id="cv-cambiar">Cambiar (apretá la tecla o el botón)</button></div>
    <label class="campo">Si dejo de escribir, mandar la hoja sola a los
      <select id="cv-pausa" class="campo-suelto">${[0, 2, 5, 10, 20].map((m) => `<option value="${m}" ${CV.pausaMin === m ? 'selected' : ''}>${m ? `${m} minutos` : 'nunca (solo con la tecla)'}</option>`).join('')}</select></label>
    ${pendiente?.trazos?.length ? `<p class="cv-pendiente">Quedó una hoja sin mandar (${pendiente.trazos.length} trazos): sigue ahí al empezar.</p>` : ''}
    <div class="fila"><button class="btn btn-primario" id="cv-empezar">Empezar</button></div>`)
  $('#cv-cambiar').onclick = () => {
    $('#cv-tecla').textContent = 'apretá la tecla o el botón del lápiz…'
    const fin = (t) => { removeEventListener('keydown', k, true); removeEventListener('pointerdown', b, true); CV.tecla = t; cvGuardar('cv-ajustes', { nombre: CV.nombre, tecla: CV.tecla, pausaMin: CV.pausaMin }); $('#cv-tecla').textContent = nombreTecla(t) }
    const k = (e) => { if (e.key === 'Escape') return; e.preventDefault(); e.stopPropagation(); fin(e.key) }
    const b = (e) => { if (e.button > 0) { e.preventDefault(); fin(`boton:${e.button}`) } }
    setTimeout(() => { addEventListener('keydown', k, true); addEventListener('pointerdown', b, true) }, 50)
  }
  $('#cv-empezar').onclick = () => {
    CV.nombre = $('#cv-nombre').value.trim() || 'Cuaderno'
    CV.pausaMin = Number($('#cv-pausa').value) || 0
    cvGuardar('cv-ajustes', { nombre: CV.nombre, tecla: CV.tecla, pausaMin: CV.pausaMin })
    cerrarModal()
    empezarCuadernoVivo(pendiente)
  }
}

function empezarCuadernoVivo(pendiente) {
  CV.trazos = pendiente?.trazos ?? []
  CV.actual = null
  CV.enviadas = 0
  const capa = document.createElement('div')
  capa.id = 'cv'
  capa.className = 'cv'
  capa.innerHTML = `<canvas id="cv-lienzo"></canvas><div class="cv-hud" id="cv-hud"></div>`
  document.body.append(capa)
  const lienzo = $('#cv-lienzo')
  const ctx = lienzo.getContext('2d')
  const medir = () => {
    const r = devicePixelRatio || 1
    lienzo.width = innerWidth * r
    lienzo.height = innerHeight * r
    ctx.setTransform(r, 0, 0, r, 0, 0)
    redibujar(ctx)
  }
  medir()
  capa.requestFullscreen?.().catch(() => {})
  const punto = (e) => [Math.round(e.clientX * 10) / 10, Math.round(e.clientY * 10) / 10, e.pointerType === 'mouse' ? 0.5 : Math.round((e.pressure || 0.5) * 100) / 100]
  const abajo = (e) => {
    if (CV.tecla === `boton:${e.button}`) { e.preventDefault(); return void hojaNueva() }
    if (e.button !== 0) return
    e.preventDefault()
    try { capa.setPointerCapture(e.pointerId) } catch { /* un puntero que ya no está: se sigue sin captura */ }
    CV.actual = [punto(e)]
    CV.trazos.push(CV.actual)
    reprogramarPausa()
  }
  const mueve = (e) => {
    if (!CV.actual || !(e.buttons & 1)) return
    const ps = e.getCoalescedEvents?.() ?? [e]
    for (const p of ps.length ? ps : [e]) {
      const ant = CV.actual.at(-1), nuevo = punto(p)
      CV.actual.push(nuevo)
      trazo(ctx, ant, nuevo)
    }
  }
  const arriba = () => {
    if (!CV.actual) return
    if (CV.actual.length === 1) trazo(ctx, CV.actual[0], CV.actual[0])
    CV.actual = null
    cvGuardar('cv-hoja', { trazos: CV.trazos })
  }
  const tecla = (e) => {
    // Esc: si hay pantalla completa, el navegador la cierra y «fullscreenchange» termina; si no la hubo, termina acá.
    if (e.key === 'Escape') { if (!document.fullscreenElement) terminar(); return }
    if (e.key === CV.tecla) { e.preventDefault(); hojaNueva() }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); CV.trazos.pop(); redibujar(ctx); cvGuardar('cv-hoja', { trazos: CV.trazos }) }
  }
  const salir = () => {
    if (document.fullscreenElement) return
    terminar()
  }
  capa.addEventListener('pointerdown', abajo)
  capa.addEventListener('pointermove', mueve)
  capa.addEventListener('pointerup', arriba)
  capa.addEventListener('pointercancel', arriba)
  capa.addEventListener('contextmenu', (e) => e.preventDefault())
  addEventListener('keydown', tecla, true)
  addEventListener('resize', medir)
  document.addEventListener('fullscreenchange', salir)
  CV.limpiar = () => {
    removeEventListener('keydown', tecla, true)
    removeEventListener('resize', medir)
    document.removeEventListener('fullscreenchange', salir)
  }
  CV.ctx = ctx
  redibujar(ctx)
  hud()
}

function trazo(ctx, a, b) {
  ctx.strokeStyle = '#111'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 0.8 + 2.4 * ((a[2] + b[2]) / 2)
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0] + (a === b ? 0.1 : 0), b[1])
  ctx.stroke()
}

function redibujar(ctx) {
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, innerWidth, innerHeight)
  for (const t of CV.trazos) for (let i = 0; i < t.length; i++) trazo(ctx, t[Math.max(0, i - 1)], t[i])
}

function hud() {
  const h = $('#cv-hud')
  if (!h) return
  const cola = CV.cola.length ? ` · ${CV.cola.length} por mandar (sin conexión, reintento solo)` : ''
  h.textContent = `${CV.nombre} · ${CV.enviadas ? `${CV.enviadas} hoja${CV.enviadas === 1 ? '' : 's'} mandada${CV.enviadas === 1 ? '' : 's'}` : 'escribí en el papel'} · ${nombreTecla(CV.tecla)} = hoja nueva · Esc = terminar${cola}${CV.aviso ? ` · ${CV.aviso}` : ''}`
}

function reprogramarPausa() {
  clearTimeout(CV.timer)
  if (CV.pausaMin) CV.timer = setTimeout(() => hojaNueva(), CV.pausaMin * 60_000)
}

/** La hoja de ahora, recortada a lo escrito (con margen), en blanco y negro: lo que lee la visión. */
function imagenDeHoja(trazos) {
  const xs = trazos.flat().map((p) => p[0]), ys = trazos.flat().map((p) => p[1])
  const m = 40
  const x0 = Math.max(0, Math.min(...xs) - m), y0 = Math.max(0, Math.min(...ys) - m)
  const an = Math.max(...xs) + m - x0, al = Math.max(...ys) + m - y0
  const escala = Math.min(3, 2000 / Math.max(an, al))
  const c = document.createElement('canvas')
  c.width = Math.round(an * escala)
  c.height = Math.round(al * escala)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.setTransform(escala, 0, 0, escala, -x0 * escala, -y0 * escala)
  for (const t of trazos) for (let i = 0; i < t.length; i++) trazo(ctx, t[Math.max(0, i - 1)], t[i])
  return new Promise((ok) => c.toBlob(ok, 'image/png'))
}

async function hojaNueva() {
  clearTimeout(CV.timer)
  const trazos = CV.trazos.filter((t) => t.length)
  if (!trazos.length) return
  CV.trazos = []
  CV.actual = null
  cvGuardar('cv-hoja', null)
  if (CV.ctx) redibujar(CV.ctx)
  const ahora = new Date()
  const fecha = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
  const hora = ahora.toTimeString().slice(0, 8).replace(/:/g, '')
  CV.cola.push({ blob: await imagenDeHoja(trazos), nombre: `vivo-${fecha}_${hora}.png`, fecha })
  await mandarCola()
}

async function mandarCola() {
  clearTimeout(CV.reintento)
  while (CV.cola.length) {
    const h = CV.cola[0]
    try {
      const q = new URLSearchParams({ tipo: 'pagina', nombre: h.nombre, cuaderno: CV.nombre, fecha: h.fecha })
      const r = await fetch(`/api/tandas?${q}`, { method: 'POST', body: h.blob }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
      CV.cola.shift()
      CV.enviadas++
      CV.aviso = `hoja ${r.tanda?.hoja ?? ''} mandada ✓`
    } catch (e) {
      CV.aviso = `no se pudo mandar (${e instanceof Error ? e.message : e})`
      CV.reintento = setTimeout(mandarCola, 30_000)
      break
    } finally {
      hud()
    }
  }
}

async function terminar() {
  if (!$('#cv') || CV.terminando) return
  CV.terminando = true
  await hojaNueva()
  CV.terminando = false
  CV.limpiar?.()
  CV.ctx = null
  $('#cv')?.remove()
  const n = CV.enviadas
  if (CV.cola.length) toast(`Quedan ${CV.cola.length} hojas sin mandar: reintento solo mientras esta pestaña esté abierta.`)
  else if (n) toast(`✒️ ${n} hoja${n === 1 ? '' : 's'} de «${esc(CV.nombre)}» en camino: las lee la nube y entran al corpus.`)
}
