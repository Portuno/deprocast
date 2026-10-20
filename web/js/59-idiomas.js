'use strict'
// Idiomas: una pista de aprendizaje por idioma (práctica diaria + tarjetas + progreso). La práctica es una charla corta
// sobre tu vida, en el idioma y a tu nivel: contestás escribiendo o hablando, y vuelve con correcciones en contexto y
// frases nuevas que quedan como tarjetas. Las tarjetas se repasan primero recordando («¿qué te acordás?») y después mirando.

let idiDatos = null
let idiAudio = null

async function montarIdiomas() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Idiomas</h1><p>Hablar desde el día uno, sobre tu vida real. Cada idioma tiene su por qué (sin eso no arranca), su práctica diaria (acá o por Telegram, a su hora) y sus tarjetas de recuerdo activo. Lo que practicás cuenta en Aprender.</p></div>
    <div class="fila idi-acciones"><button class="btn btn-primario" id="idi-nuevo">＋ Un idioma</button><button class="btn" id="idi-repasar">🃏 Repasar tarjetas</button></div>
    <div id="idi-cuerpo"></div>`
  $('#idi-nuevo').onclick = modalNuevoIdioma
  $('#idi-repasar').onclick = () => repasarTarjetas()
  await pintarIdiomas()
}

async function pintarIdiomas() {
  const cont = $('#idi-cuerpo')
  if (!cont) return
  try { idiDatos = await api('/idiomas') } catch (e) { return error(e) }
  const xs = idiDatos.idiomas
  if (!xs.length) {
    cont.innerHTML = '<div class="vacio"><div class="gran">🗣</div><h2>Todavía no estás aprendiendo ningún idioma</h2><p>Elegí uno y escribí para qué lo querés: es lo que te va a sostener cuando la motivación baje.</p></div>'
    return
  }
  cont.innerHTML = `<div class="tarjetas">${xs.map(tarjetaIdioma).join('')}</div>`
  $$('[data-idi-practicar]', cont).forEach((b) => (b.onclick = () => abrirPracticaIdioma(Number(b.dataset.idiPracticar))))
  $$('[data-idi-repasar]', cont).forEach((b) => (b.onclick = () => repasarTarjetas(`idioma:${b.dataset.idiRepasar}`)))
  $$('[data-idi-ajustes]', cont).forEach((b) => (b.onclick = () => modalAjustesIdioma(xs.find((x) => x.aprendizajeId === Number(b.dataset.idiAjustes)))))
}

function tarjetaIdioma(i) {
  const pct = i.metaSemana ? Math.min(100, Math.round((i.minutosSemana / i.metaSemana) * 100)) : 0
  const ultimos = i.ultimos.slice(0, 3)
  return `<article class="tarjeta idi-tarjeta">
    <header class="idi-cab"><h3>${esc(i.nombre)}</h3><span class="chip">${esc(i.nivel ?? 'A1')}${i.objetivo ? ` → ${esc(i.objetivo)}` : ''}</span>${i.diasMes ? `<span class="idi-racha" title="Días que practicaste este mes (no se pierde nada por un día sin practicar)">${i.diasMes} día${i.diasMes === 1 ? '' : 's'} este mes</span>` : ''}</header>
    ${i.porQue ? `<p class="idi-porque">«${esc(i.porQue)}»</p>` : ''}
    <div class="idi-metricas">
      <div><small>Esta semana</small><b>${i.minutosSemana} / ${i.metaSemana} min</b><i class="idi-barra"><b style="width:${pct}%"></b></i></div>
      <div><small>Charlas</small><b>${i.charlas}</b></div>
      <div><small>Frases</small><b>${i.tarjetas.total}</b><small>${i.tarjetas.aprendidas} firmes</small></div>
    </div>
    <p class="tenue chico">${i.hora ? `Práctica por Telegram a las ${esc(i.hora)}` : 'Sin hora: practicás cuando quieras'} · ${i.minutosDia} min por día${i.conVoz ? ' · con audio' : ''}</p>
    ${ultimos.length ? `<details class="idi-ultimos"><summary>Últimas charlas</summary>${ultimos.map((t) => `<div class="idi-turno"><small>${esc(t.fecha)}${t.por_voz ? ' · 🎙' : ''}</small><p>${esc(corto(t.respuesta, 160))}</p>${t.devolucion?.correcciones?.length ? `<p class="tenue chico">${t.devolucion.correcciones.map((c) => `${esc(c.dijo)} → <b>${esc(c.natural)}</b>`).join(' · ')}</p>` : ''}</div>`).join('')}</details>` : ''}
    <div class="fila idi-botones">
      <button class="btn btn-primario btn-chico" data-idi-practicar="${i.aprendizajeId}">🗣 Practicar${idiDatos.abierta === i.aprendizajeId ? ' (sigue abierta)' : ''}</button>
      <button class="btn btn-chico" data-idi-repasar="${i.aprendizajeId}" ${i.tarjetas.total ? '' : 'disabled'}>🃏 Repasar${i.tarjetas.hoy ? ` · ${i.tarjetas.hoy}` : ''}</button>
      <button class="btn btn-chico btn-icono" data-idi-ajustes="${i.aprendizajeId}" title="Nivel, hora y minutos">⚙</button>
    </div>
  </article>`
}

function modalNuevoIdioma() {
  const disp = idiDatos?.disponibles ?? {}
  const ya = new Set((idiDatos?.idiomas ?? []).map((i) => i.codigo))
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Un idioma nuevo</h2>
    <p class="tenue">Nadie te enseña un idioma: lo aprendés vos, hablando. La práctica es corta y diaria; la gramática llega en contexto.</p>
    <form id="idi-form">
      <div class="fila"><label class="campo">Idioma<select name="codigo" required>${Object.entries(disp).filter(([c]) => !ya.has(c)).map(([c, d]) => `<option value="${c}">${esc(d.nombre)}${d.voz ? '' : ' (sin audio)'}</option>`).join('')}</select></label>
        <label class="campo">Tu nivel hoy<select name="nivel">${(idiDatos?.niveles ?? []).map((n) => `<option ${n === 'A1' ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="campo">A dónde querés llegar<input name="objetivo" placeholder="B2, o «charlar en un viaje»"></label></div>
      <label class="campo">¿Para qué lo querés? (sin esto no arranca)<textarea name="porQue" rows="3" required minlength="10" placeholder="Lo que te va a sostener cuando baje la motivación"></textarea></label>
      <div class="fila"><label class="campo">Minutos por día<input name="minutosDia" type="number" min="5" max="240" value="15"></label>
        <label class="campo">Práctica por Telegram a las<input name="hora" type="time"></label></div>
      <button class="btn btn-primario">Arrancar</button>
    </form>`)
  $('#idi-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { await api('/idiomas', { ...f, minutosDia: Number(f.minutosDia) || 15, hora: f.hora || null }); cerrarModal(); toast('A practicar', 'suave'); pintarIdiomas() } catch (e) { error(e) }
  }
}

function modalAjustesIdioma(i) {
  if (!i) return
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${esc(i.nombre)}</h2>
    <form id="idi-aj">
      <div class="fila"><label class="campo">Nivel<select name="nivel">${idiDatos.niveles.map((n) => `<option ${n === i.nivel ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="campo">Objetivo<input name="objetivo" value="${esc(i.objetivo ?? '')}"></label></div>
      <label class="campo">Para qué<textarea name="porQue" rows="3">${esc(i.porQue ?? '')}</textarea></label>
      <div class="fila"><label class="campo">Minutos por día<input name="minutosDia" type="number" min="5" max="240" value="${i.minutosDia}"></label>
        <label class="campo">Práctica por Telegram a las (vacío: sin aviso)<input name="hora" type="time" value="${esc(i.hora ?? '')}"></label></div>
      <button class="btn btn-primario">Guardar</button>
    </form>`)
  $('#idi-aj').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { await api(`/idiomas/${i.aprendizajeId}`, { ...f, minutosDia: Number(f.minutosDia) || undefined, hora: f.hora || null }); cerrarModal(); pintarIdiomas() } catch (e) { error(e) }
  }
}

// ─── escuchar ───────────────────────────────────────────────────────────

/** Una frase en su idioma, en voz alta (kokoro, si hay voz para ese idioma). */
async function escucharFrase(texto, codigo, boton) {
  if (boton) boton.disabled = true
  try {
    const r = await api('/idiomas/voz', { texto, codigo })
    if (!r.url) return toast('Para este idioma todavía no hay voz', 'suave')
    idiAudio?.pause()
    idiAudio = new Audio(r.url)
    await idiAudio.play()
  } catch (e) { error(e) } finally { if (boton) boton.disabled = false }
}
const botonEscuchar = (texto, codigo) => `<button type="button" class="btn btn-chico btn-icono idi-oir" data-oir="${esc(texto)}" data-cod="${esc(codigo)}" title="Escuchar">🔊</button>`
const engancharEscuchar = (cont) => $$('[data-oir]', cont).forEach((b) => (b.onclick = () => escucharFrase(b.dataset.oir, b.dataset.cod, b)))

// ─── la práctica ────────────────────────────────────────────────────────

async function abrirPracticaIdioma(id) {
  const i = idiDatos?.idiomas.find((x) => x.aprendizajeId === id)
  if (!i) return
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🗣 ${esc(i.nombre)} · práctica</h2>
    <div class="idi-charla" id="idi-charla"><p class="tenue">Mastropiero está pensando qué preguntarte…</p></div>
    <form id="idi-resp" class="idi-resp">
      <textarea class="campo-suelto" name="texto" rows="2" placeholder="Contestá en ${esc(i.nombre.toLowerCase())} (o grabá un audio: mejor, hablar desde el día uno)" data-sin-foco></textarea>
      <div class="fila"><button type="button" class="btn" id="idi-grabar">🎙 Grabar</button><button class="btn btn-primario">Mandar</button><button type="button" class="btn btn-chico" id="idi-fin">✋ Terminar</button></div>
    </form>`)
  $('#modal').classList.add('modal-ancho')
  const charla = $('#idi-charla')
  const agregar = (html) => { charla.insertAdjacentHTML('beforeend', html); engancharEscuchar(charla); charla.scrollTop = charla.scrollHeight }
  const mensajeMastro = (texto, ayuda) => `<div class="idi-msj mastro"><p>${esc(texto)} ${i.conVoz ? botonEscuchar(texto, i.codigo) : ''}</p>${ayuda ? `<details><summary>En castellano</summary><p class="tenue">${esc(ayuda)}</p></details>` : ''}</div>`
  try {
    const p = await api(`/idiomas/${id}/abrir`, {})
    charla.innerHTML = mensajeMastro(p.mensaje, p.ayuda)
    engancharEscuchar(charla)
    if (i.conVoz) escucharFrase(p.mensaje, i.codigo)
  } catch (e) { charla.innerHTML = `<p class="tenue">${esc(e.message)}</p>`; return }

  const devolucion = (d) => {
    if (d.transcripcion) agregar(`<div class="idi-msj yo"><p>🎙 ${esc(d.transcripcion)}</p></div>`)
    agregar(`<div class="idi-devolucion">
      ${d.correcciones.length ? `<div class="idi-corr">${d.correcciones.map((c) => `<p><s>${esc(c.dijo)}</s> → <b>${esc(c.natural)}</b> ${i.conVoz ? botonEscuchar(c.natural, i.codigo) : ''}${c.por_que ? `<br><small class="tenue">${esc(c.por_que)}</small>` : ''}</p>`).join('')}</div>` : '<p class="idi-ok">✓ Sin nada para corregir.</p>'}
      ${d.frases.length ? `<div class="idi-frases"><small>Frases nuevas${d.tarjetasNuevas ? ` · ${d.tarjetasNuevas} a tus tarjetas` : ''} (repetilas en voz alta)</small>${d.frases.map((f) => `<p><b>${esc(f.frase)}</b> ${i.conVoz ? botonEscuchar(f.frase, i.codigo) : ''}<br><span class="tenue">${esc(f.traduccion)}${f.patron ? ` · <i>${esc(f.patron)}</i>` : ''}</span></p>`).join('')}</div>` : ''}
      ${d.animo ? `<p class="idi-animo">💪 ${esc(d.animo)}</p>` : ''}
    </div>`)
    const sigue = [d.respuesta, d.pregunta].filter(Boolean).join(' ')
    if (sigue) agregar(mensajeMastro(sigue, null))
  }

  const form = $('#idi-resp')
  form.onsubmit = async (ev) => {
    ev.preventDefault()
    const texto = form.texto.value.trim()
    if (!texto) return
    form.texto.value = ''
    agregar(`<div class="idi-msj yo"><p>${esc(texto)}</p></div>`)
    const espera = agregarEspera()
    try { const d = await api(`/idiomas/${id}/responder`, { texto }); espera.remove(); devolucion({ ...d, transcripcion: null }) } catch (e) { espera.remove(); error(e) }
  }
  const agregarEspera = () => { agregar('<p class="tenue idi-espera">Mastropiero está leyendo…</p>'); return charla.lastElementChild }

  // Grabar: MediaRecorder → el audio crudo al servidor, que lo transcribe en ese idioma.
  let rec = null
  let inicio = 0
  $('#idi-grabar').onclick = async () => {
    const b = $('#idi-grabar')
    if (rec) { rec.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
      const partes = []
      rec.ondataavailable = (e) => e.data.size && partes.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        rec = null
        b.textContent = '🎙 Grabar'
        b.classList.remove('grabando')
        const blob = new Blob(partes, { type: partes[0]?.type || 'audio/webm' })
        const segundos = Math.round((Date.now() - inicio) / 1000)
        if (blob.size < 2000) return toast('El audio quedó vacío', 'suave')
        const espera = agregarEspera()
        try {
          const r = await fetch(`/api/idiomas/${id}/audio?nombre=respuesta.webm&segundos=${segundos}`, { method: 'POST', body: blob })
          const d = await r.json()
          espera.remove()
          if (!r.ok) throw new Error(d.error)
          devolucion(d)
        } catch (e) { espera.remove(); error(e) }
      }
      rec.start()
      inicio = Date.now()
      b.textContent = '⏹ Listo'
      b.classList.add('grabando')
    } catch (e) { error(e) }
  }
  $('#idi-fin').onclick = async () => {
    if (rec) rec.stop()
    try { await api(`/idiomas/${id}/cerrar`, {}) } catch { /* cerrar es un plus */ }
    cerrarModal()
    pintarIdiomas()
  }
}

// ─── tarjetas ───────────────────────────────────────────────────────────

const CALIDADES_TJ = [['otra', '↺ Otra vez'], ['dificil', '😓 Difícil'], ['bien', '🙂 Bien'], ['facil', '😎 Fácil']]

/** El repaso: la pregunta sola, «👀 Ver» muestra el dorso, y cómo te fue decide cuándo vuelve. mazo = null: todas. */
async function repasarTarjetas(mazo = null) {
  let cola
  try { cola = (await api(`/tarjetas?limite=100${mazo ? `&mazo=${encodeURIComponent(mazo)}` : ''}`)).paraHoy } catch (e) { return error(e) }
  let hechas = 0
  const codigoDe = (m) => { const id = m.startsWith('idioma:') ? Number(m.slice(7)) : null; const i = idiDatos?.idiomas.find((x) => x.aprendizajeId === id); return i?.conVoz ? i.codigo : null }
  const nombreDe = (m) => { const id = m.startsWith('idioma:') ? Number(m.slice(7)) : null; return idiDatos?.idiomas.find((x) => x.aprendizajeId === id)?.nombre ?? (id ? 'Idioma' : m === 'consumido' ? 'Lo que miraste' : m) }
  const pintar = () => {
    const t = cola[0]
    if (!t) {
      abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><div class="vacio"><div class="gran">🃏</div><h2>${hechas ? `Listo: ${hechas} repasada${hechas === 1 ? '' : 's'}` : 'No te queda ninguna para hoy'}</h2><p>Lo que sabés se aleja; lo que costó vuelve pronto.</p></div>`)
      if (vista === 'idiomas') pintarIdiomas()
      if (vista === 'hoy') traerHoy()
      return
    }
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <div class="tj-cab"><span class="chip">${esc(nombreDe(t.mazo))}</span><small class="tenue">${cola.length} para hoy${hechas ? ` · ${hechas} hechas` : ''}</small></div>
      <div class="tj-carta"><p class="tj-frente">${esc(t.frente)}</p>
        <div class="tj-dorso" hidden><hr>${t.dorso.split('\n').filter(Boolean).map((l, n) => `<p class="${n ? 'tenue' : 'tj-resp'}">${esc(l)}${!n && codigoDe(t.mazo) ? ` ${botonEscuchar(l, codigoDe(t.mazo))}` : ''}</p>`).join('')}</div></div>
      <p class="tenue chico tj-pista">¿Qué te acordás? Pensalo (o decilo en voz alta) antes de mirar.</p>
      <div class="fila tj-botones"><button class="btn btn-primario" id="tj-ver" autofocus>👀 Ver</button></div>`)
    $('#tj-ver').onclick = () => {
      $('.tj-dorso').hidden = false
      $('.tj-pista').hidden = true
      engancharEscuchar($('#modal'))
      $('.tj-botones').innerHTML = CALIDADES_TJ.map(([c, n]) => `<button class="btn ${c === 'bien' ? 'btn-primario' : ''}" data-cal="${c}">${n}</button>`).join('')
      $$('[data-cal]').forEach((b) => (b.onclick = async () => {
        try {
          const r = await api(`/tarjetas/${t.id}`, { calidad: b.dataset.cal })
          hechas++
          cola.shift()
          if (b.dataset.cal === 'otra') cola.push(r) // vuelve al final de la ronda de hoy
          pintar()
        } catch (e) { error(e) }
      }))
    }
  }
  pintar()
}
