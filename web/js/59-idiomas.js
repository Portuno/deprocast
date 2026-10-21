'use strict'
// Idiomas: una pista de aprendizaje por idioma, para aprender de cero desde el castellano. Todo lo que aparece en el idioma
// viene con sus capas (el texto, cómo se lee, cómo suena y qué quiere decir) y con su audio ya listo. La práctica es por
// sesiones preparadas de antemano (tema, palabras, frases, la pregunta y respuestas sugeridas): abrir es instantáneo.
// Las tarjetas son cortas y también se hacen a mano. Telegram y la hora son opcionales.

let idiDatos = null
let idiAudio = null

async function montarIdiomas() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Idiomas</h1><p>De cero y desde el castellano: cada cosa con cómo se lee, cómo suena y qué quiere decir. Practicás cuando quieras; cada sesión queda en tu corpus y cuenta en Aprender.</p></div>
    <div id="idi-cuerpo"></div>`
  await pintarIdiomas()
}

async function pintarIdiomas() {
  const cont = $('#idi-cuerpo')
  if (!cont) return
  try { idiDatos = await api('/idiomas') } catch (e) { return error(e) }
  const xs = idiDatos.idiomas
  cont.innerHTML = `<div class="fila idi-acciones"><button class="btn btn-primario" id="idi-nuevo">＋ Un idioma</button><button class="btn" id="idi-repasar">🃏 Repasar todas</button></div>
    ${xs.length ? `<div class="idi-lista">${xs.map(tarjetaIdioma).join('')}</div>` : '<div class="vacio"><div class="gran">🗣</div><h2>Todavía no estás aprendiendo ningún idioma</h2><p>Elegí uno y escribí para qué lo querés: es lo que te va a sostener cuando la motivación baje, y lo que guía qué practicás.</p></div>'}`
  $('#idi-nuevo').onclick = modalNuevoIdioma
  $('#idi-repasar').onclick = () => repasarTarjetas()
  $$('[data-idi-empezar]', cont).forEach((b) => (b.onclick = () => abrirSesion(Number(b.dataset.idiEmpezar))))
  $$('[data-idi-tema]', cont).forEach((b) => (b.onclick = () => abrirSesion(Number(b.dataset.idi), b.dataset.idiTema)))
  $$('[data-idi-repasar]', cont).forEach((b) => (b.onclick = () => repasarTarjetas(`idioma:${b.dataset.idiRepasar}`)))
  $$('[data-idi-nuevas]', cont).forEach((b) => (b.onclick = () => modalTarjetasAMano(idiomaDe(b.dataset.idiNuevas))))
  $$('[data-idi-mazo]', cont).forEach((b) => (b.onclick = () => modalMazo(idiomaDe(b.dataset.idiMazo))))
  $$('[data-idi-ajustes]', cont).forEach((b) => (b.onclick = () => modalAjustesIdioma(idiomaDe(b.dataset.idiAjustes))))
}

const idiomaDe = (id) => idiDatos?.idiomas.find((x) => x.aprendizajeId === Number(id))

function tarjetaIdioma(i) {
  const pct = i.metaSemana ? Math.min(100, Math.round((i.minutosSemana / i.metaSemana) * 100)) : 0
  const n = i.temario.length
  const proximo = n ? i.temaIdx % n : -1
  const empezar = i.enCurso ? `▶ Seguir: ${esc(i.enCurso.tema)}` : i.proxima ? `▶ Empezar: ${esc(i.proxima.tema)}` : '▶ Empezar'
  return `<article class="tarjeta idi-tarjeta">
    <header class="idi-cab"><h3>${esc(i.nombre)}</h3><span class="chip">${esc(i.nivel ?? 'A0')}${i.objetivo ? ` → ${esc(i.objetivo)}` : ''}</span>${i.diasMes ? `<span class="idi-racha" title="Días que practicaste este mes (no se pierde nada por un día sin practicar)">${i.diasMes} día${i.diasMes === 1 ? '' : 's'} este mes</span>` : ''}</header>
    ${i.porQue ? `<p class="idi-porque">«${esc(i.porQue)}»</p>` : ''}
    <button class="btn btn-primario idi-empezar" data-idi-empezar="${i.aprendizajeId}">${empezar}</button>
    ${!i.proxima && !i.enCurso ? '<small class="tenue">La sesión se arma al abrirla (unos segundos). En la nube, la siguiente ya queda lista.</small>' : ''}
    ${n ? `<div class="idi-temario" title="Tu temario: tocá un tema para practicarlo ahora">${i.temario.map((t, k) => `<button class="idi-tema ${i.temaIdx >= n || k < i.temaIdx ? 'visto' : ''} ${k === proximo ? 'proximo' : ''}" data-idi="${i.aprendizajeId}" data-idi-tema="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="idi-metricas">
      <div><small>Esta semana</small><b>${i.minutosSemana} / ${i.metaSemana} min</b><i class="idi-barra"><b style="width:${pct}%"></b></i></div>
      <div><small>Sesiones</small><b>${i.sesiones}</b></div>
      <div><small>Palabras</small><b>${i.tarjetas.total}</b><small>${i.tarjetas.aprendidas} firmes</small></div>
    </div>
    <div class="fila idi-botones">
      <button class="btn btn-chico" data-idi-repasar="${i.aprendizajeId}" ${i.tarjetas.total ? '' : 'disabled'}>🃏 Repasar${i.tarjetas.hoy ? ` · ${i.tarjetas.hoy}` : ''}</button>
      <button class="btn btn-chico" data-idi-nuevas="${i.aprendizajeId}" title="Tarjetas a mano: lo que querés saber decir">＋ Tarjetas</button>
      <button class="btn btn-chico" data-idi-mazo="${i.aprendizajeId}" title="Ver, corregir o borrar tus tarjetas">🗂 Mazo</button>
      <button class="btn btn-chico btn-icono" data-idi-ajustes="${i.aprendizajeId}" title="Nivel, para qué, intereses y aviso">⚙</button>
    </div>
    ${i.hora ? `<p class="tenue chico">Aviso por Telegram a las ${esc(i.hora)}</p>` : ''}
  </article>`
}

function modalNuevoIdioma() {
  const disp = idiDatos?.disponibles ?? {}
  const ya = new Set((idiDatos?.idiomas ?? []).map((i) => i.codigo))
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Un idioma nuevo</h2>
    <p class="tenue">Nadie te enseña un idioma: lo aprendés vos, hablando. Cada sesión es corta, con todo traducido y con cómo suena.</p>
    <form id="idi-form">
      <div class="fila"><label class="campo">Idioma<select name="codigo" required>${Object.entries(disp).filter(([c]) => !ya.has(c)).map(([c, d]) => `<option value="${c}">${esc(d.nombre)}${d.voz ? '' : ' (sin audio)'}</option>`).join('')}</select></label>
        <label class="campo">Tu nivel hoy<select name="nivel">${(idiDatos?.niveles ?? []).map((n) => `<option ${n === 'A0' ? 'selected' : ''} value="${n}">${n}${n === 'A0' ? ' (de cero)' : ''}</option>`).join('')}</select></label>
        <label class="campo">A dónde querés llegar<input name="objetivo" placeholder="B1, o «charlar en un viaje»"></label></div>
      <label class="campo">¿Para qué lo querés? (sin esto no arranca; guía lo que practicás)<textarea name="porQue" rows="2" required minlength="10" placeholder="Ej.: para viajar y pedir comida, para hablar con clientes…"></textarea></label>
      <label class="campo">Temas que te interesan (opcional)<input name="intereses" placeholder="comida, viajes, negocios, fútbol…"></label>
      <label class="campo">Sobre vos, para practicar (opcional, una línea)<input name="sobreMi" placeholder="Me llamo…, vivo en…"></label>
      <div class="fila"><label class="campo">Minutos por día<input name="minutosDia" type="number" min="5" max="240" value="15"></label>
        <label class="campo">Aviso por Telegram (opcional)<input name="hora" type="time"></label></div>
      <button class="btn btn-primario">Arrancar</button>
    </form>`)
  $('#idi-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { await api('/idiomas', { ...f, minutosDia: Number(f.minutosDia) || 15, hora: f.hora || null }); cerrarModal(); toast('A practicar<small>Tu primera sesión trae el temario y las frases básicas.</small>', 'suave'); pintarIdiomas() } catch (e) { error(e) }
  }
}

function modalAjustesIdioma(i) {
  if (!i) return
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${esc(i.nombre)}</h2>
    <form id="idi-aj">
      <div class="fila"><label class="campo">Nivel<select name="nivel">${idiDatos.niveles.map((n) => `<option ${n === i.nivel ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="campo">Objetivo<input name="objetivo" value="${esc(i.objetivo ?? '')}"></label></div>
      <label class="campo">Para qué<textarea name="porQue" rows="2">${esc(i.porQue ?? '')}</textarea></label>
      <label class="campo">Temas que te interesan<input name="intereses" value="${esc(i.intereses ?? '')}" placeholder="comida, viajes, negocios…"></label>
      <label class="campo">Sobre vos, para practicar<input name="sobreMi" value="${esc(i.sobreMi ?? '')}" placeholder="Me llamo…, vivo en…"></label>
      <p class="tenue chico">Si cambiás el nivel o los intereses, el temario se vuelve a armar en la próxima sesión.</p>
      <div class="fila"><label class="campo">Minutos por día<input name="minutosDia" type="number" min="5" max="240" value="${i.minutosDia}"></label>
        <label class="campo">Aviso por Telegram (vacío: sin aviso)<input name="hora" type="time" value="${esc(i.hora ?? '')}"></label></div>
      <button class="btn btn-primario">Guardar</button>
    </form>`)
  $('#idi-aj').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { await api(`/idiomas/${i.aprendizajeId}`, { ...f, minutosDia: Number(f.minutosDia) || undefined, hora: f.hora || null }); cerrarModal(); pintarIdiomas() } catch (e) { error(e) }
  }
}

// ─── escuchar ───────────────────────────────────────────────────────────

/** Una frase en voz alta: si ya tiene su audio, al instante; si no, se pide (kokoro, si hay voz para ese idioma). */
async function escucharFrase(texto, codigo, boton, url = null) {
  if (boton) boton.disabled = true
  try {
    const u = url || (await api('/idiomas/voz', { texto, codigo })).url
    if (!u) return toast('Para este idioma todavía no hay voz', 'suave')
    idiAudio?.pause()
    idiAudio = new Audio(u)
    await idiAudio.play()
  } catch (e) { if (e?.name !== 'NotAllowedError') error(e) } finally { if (boton) boton.disabled = false }
}
const botonEscuchar = (texto, codigo, url = null) => `<button type="button" class="btn btn-chico btn-icono idi-oir" data-oir="${esc(texto)}" data-cod="${esc(codigo)}"${url ? ` data-url="${esc(url)}"` : ''} title="Escuchar">🔊</button>`
const engancharEscuchar = (cont) => $$('[data-oir]', cont).forEach((b) => (b.onclick = () => escucharFrase(b.dataset.oir, b.dataset.cod, b, b.dataset.url || null)))

// ─── las capas ──────────────────────────────────────────────────────────

/** Las capas que se pueden ocultar, por idioma (se recuerdan): el texto, cómo se lee, cómo suena y la traducción. */
const CAPAS = (i) => [['texto', i.codigo === 'zh' ? '汉字' : i.codigo === 'ja' ? '日本語' : 'texto'], ...(i.roman ? [['pron', i.codigo === 'zh' ? 'pinyin' : i.codigo === 'ja' ? 'romaji' : 'lectura']] : []), ['suena', 'cómo suena'], ['es', 'castellano']]
const capasOcultas = (i) => { try { return JSON.parse(pref.leer(`mastro-idi-capas-${i.codigo}`, '[]')) } catch { return [] } }

/** Una frase con sus capas y su audio. extra: botones al lado (⭐, usar). */
function capaHTML(c, i, o = {}) {
  if (!c) return ''
  return `<div class="capa${o.grande ? ' grande' : ''}">
    <div class="capa-texto" data-capa="texto">${esc(c.texto)} ${i.conVoz ? botonEscuchar(c.texto, i.codigo, c.audio) : ''}${o.extra ?? ''}</div>
    ${c.pron ? `<div class="capa-pron" data-capa="pron">${esc(c.pron)}</div>` : ''}
    ${c.suena ? `<div class="capa-suena" data-capa="suena">suena «${esc(c.suena)}»</div>` : ''}
    <div class="capa-es" data-capa="es">${esc(c.es)}</div>
    ${o.nota && c.nota ? `<div class="capa-nota">${esc(c.nota)}</div>` : ''}
  </div>`
}

// ─── la sesión ──────────────────────────────────────────────────────────

/** Abre la sesión en la misma vista: la charla a la izquierda, las palabras de hoy a la derecha. tema: practicar ese tema ahora. */
async function abrirSesion(id, tema = null) {
  const i = idiomaDe(id)
  const cont = $('#idi-cuerpo')
  if (!i || !cont) return
  const lista = !tema && (i.proxima || i.enCurso)
  cont.innerHTML = `<div class="idi-preparando"><p>${lista ? 'Abriendo tu sesión…' : 'Preparando tu sesión: el tema, las palabras, la pregunta y todos los audios, de una (unos segundos)…'}</p></div>`
  let r
  try { r = await api(`/idiomas/${id}/abrir`, tema ? { tema } : {}) } catch (e) { error(e); return pintarIdiomas() }
  const s = r.sesion
  const p = s.paquete
  const ocultas = new Set(capasOcultas(i))
  const inicio = Date.now()
  cont.innerHTML = `<div class="idi-sesion ${[...ocultas].map((k) => `oculta-${k}`).join(' ')}" id="idi-sesion">
    <header class="idi-ses-cab">
      <button class="btn btn-chico" id="idi-volver" title="Volver (la sesión queda abierta 45 minutos)">←</button>
      <div><h2>🗣 ${esc(i.nombre)} · ${esc(p.tema)}</h2>${p.objetivo ? `<small class="tenue">${esc(p.objetivo)}</small>` : ''}</div>
      <div class="idi-capas" title="Mostrá u ocultá cada capa (se recuerda)">${CAPAS(i).map(([k, n]) => `<button class="btn btn-chico ${ocultas.has(k) ? '' : 'on'}" data-capa-tog="${k}">${n}</button>`).join('')}</div>
      <span class="idi-reloj tenue" id="idi-reloj">0 min</span>
    </header>
    <div class="idi-ses-cuerpo">
      <section class="idi-charla" id="idi-charla"></section>
      <aside class="idi-palabras">
        <h3>Palabras de hoy</h3>
        ${p.palabras.map((c, k) => capaHTML(c, i, { nota: true, extra: `<button type="button" class="btn btn-chico btn-icono idi-estrella" data-estrella="${k}" title="A mis tarjetas">⭐</button>` })).join('')}
        ${p.frases.length ? `<h3>Frases modelo</h3>${p.frases.map((c) => capaHTML(c, i, { nota: true })).join('')}` : ''}
      </aside>
    </div>
    <div class="idi-sugeridas" id="idi-sug"></div>
    <form id="idi-resp" class="idi-resp">
      <textarea class="campo-suelto" name="texto" rows="2" placeholder="Contestá en ${esc(i.nombre.toLowerCase())} (si no te sale, escribilo en castellano y te ayudo) — o grabá un audio" data-sin-foco></textarea>
      <div class="fila"><button type="button" class="btn" id="idi-grabar">🎙 Grabar</button><button class="btn btn-primario">Mandar</button><button type="button" class="btn" id="idi-fin">✋ Terminar</button></div>
    </form>
  </div>`
  const ses = $('#idi-sesion')
  const charla = $('#idi-charla')
  engancharEscuchar(ses)
  const reloj = setInterval(() => { const el = $('#idi-reloj'); if (!el) return clearInterval(reloj); el.textContent = `${Math.round((Date.now() - inicio) / 60000)} min` }, 30_000)
  $('#idi-volver').onclick = () => { clearInterval(reloj); pintarIdiomas() }
  $$('[data-capa-tog]', ses).forEach((b) => (b.onclick = () => {
    const k = b.dataset.capaTog
    const on = ses.classList.toggle(`oculta-${k}`)
    b.classList.toggle('on', !on)
    pref.guardar(`mastro-idi-capas-${i.codigo}`, JSON.stringify(CAPAS(i).map(([x]) => x).filter((x) => ses.classList.contains(`oculta-${x}`))))
  }))
  $$('[data-estrella]', ses).forEach((b) => (b.onclick = async () => {
    try { const { nuevas } = await api(`/idiomas/${id}/tarjetas`, { items: [p.palabras[Number(b.dataset.estrella)]] }); b.disabled = true; toast(nuevas ? 'A tus tarjetas' : 'Ya estaba en tus tarjetas', 'suave') } catch (e) { error(e) }
  }))

  const agregar = (html) => { charla.insertAdjacentHTML('beforeend', html); engancharEscuchar(charla); charla.scrollTop = charla.scrollHeight }
  const mastro = (c, ...mas) => agregar(`<div class="idi-msj mastro">${[...mas, c].filter(Boolean).map((x) => capaHTML(x, i, { grande: x === c })).join('')}</div>`)
  const sugeridas = (xs) => {
    const el = $('#idi-sug')
    el.innerHTML = xs?.length ? `<small class="tenue">Podés contestar, por ejemplo (tocá para usarla):</small>${xs.map((c, k) => `<div class="idi-sugerida" data-usar="${k}">${capaHTML(c, i)}</div>`).join('')}` : ''
    engancharEscuchar(el)
    $$('[data-usar]', el).forEach((d) => (d.onclick = (e) => { if (e.target.closest('[data-oir]')) return; const t = $('#idi-resp').texto; t.value = xs[Number(d.dataset.usar)].texto; t.focus() }))
  }
  const sonar = (c) => { if (i.conVoz && c?.audio) escucharFrase(c.texto, i.codigo, null, c.audio) }

  if (r.retomar) {
    agregar(`<p class="tenue idi-retomar">Seguís donde quedaste (${r.retomar.vueltas} vuelta${r.retomar.vueltas === 1 ? '' : 's'}).</p>`)
    mastro(r.retomar.pregunta, r.retomar.respuesta)
    sugeridas(r.retomar.sugeridas)
  } else {
    mastro(p.pregunta)
    sugeridas(p.sugeridas)
    sonar(p.pregunta)
  }

  const devolucion = (d) => {
    if (d.transcripcion) agregar(`<div class="idi-msj yo"><p>🎙 ${esc(d.transcripcion)}</p></div>`)
    agregar(`<div class="idi-devolucion">
      ${d.correcciones.length ? `<div class="idi-corr"><small>Cómo sonaría natural</small>${d.correcciones.map((c) => `<div><p><s>${esc(c.dijo)}</s> →</p>${capaHTML(c.natural, i)}${c.por_que ? `<small class="tenue">${esc(c.por_que)}</small>` : ''}</div>`).join('')}</div>` : '<p class="idi-ok">✓ Sin nada para corregir.</p>'}
      ${d.nuevas.length ? `<div class="idi-frases"><small>Te faltó${d.tarjetasNuevas ? ` · ${d.tarjetasNuevas} nueva${d.tarjetasNuevas === 1 ? '' : 's'} en tus tarjetas` : ''}</small>${d.nuevas.map((c) => capaHTML(c, i, { nota: true })).join('')}</div>` : ''}
      ${d.animo ? `<p class="idi-animo">💪 ${esc(d.animo)}</p>` : ''}
    </div>`)
    if (d.pregunta || d.respuesta) mastro(d.pregunta, d.respuesta)
    sugeridas(d.sugeridas)
    sonar(d.pregunta ?? d.respuesta)
  }
  const espera = () => { agregar('<p class="tenue idi-espera">Mastropiero está leyendo…</p>'); return charla.lastElementChild }

  const form = $('#idi-resp')
  form.onsubmit = async (ev) => {
    ev.preventDefault()
    const texto = form.texto.value.trim()
    if (!texto) return
    form.texto.value = ''
    agregar(`<div class="idi-msj yo"><p>${esc(texto)}</p></div>`)
    const e1 = espera()
    try { const d = await api(`/idiomas/${id}/responder`, { texto }); e1.remove(); devolucion({ ...d, transcripcion: null }) } catch (e) { e1.remove(); error(e) }
  }
  form.texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit() } })

  // Grabar: MediaRecorder → el audio crudo al servidor, que lo transcribe en ese idioma.
  let rec = null
  let desde = 0
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
        const segundos = Math.round((Date.now() - desde) / 1000)
        if (blob.size < 2000) return toast('El audio quedó vacío', 'suave')
        const e1 = espera()
        try {
          const res = await fetch(`/api/idiomas/${id}/audio?nombre=respuesta.webm&segundos=${segundos}`, { method: 'POST', body: blob })
          const d = await res.json()
          e1.remove()
          if (!res.ok) throw new Error(d.error)
          devolucion(d)
        } catch (e) { e1.remove(); error(e) }
      }
      rec.start()
      desde = Date.now()
      b.textContent = '⏹ Listo'
      b.classList.add('grabando')
    } catch (e) { error(e) }
  }

  $('#idi-fin').onclick = async () => {
    if (rec) rec.stop()
    clearInterval(reloj)
    let res = null
    try { res = (await api(`/idiomas/${id}/cerrar`, {})).resumen } catch { /* cerrar es un plus */ }
    if (!res) return pintarIdiomas()
    cont.innerHTML = `<div class="idi-resumen tarjeta">
      <h2>✓ ${esc(res.tema)}</h2>
      <div class="idi-metricas"><div><small>Vueltas</small><b>${res.vueltas}</b></div><div><small>Palabras de la sesión</small><b>${res.palabras}</b></div><div><small>A tus tarjetas</small><b>${res.tarjetas}</b></div><div><small>Minutos</small><b>${res.minutos}</b></div></div>
      <div class="fila">${res.piezaId ? `<button class="btn" id="idi-pieza">📄 Ver en el corpus</button>` : ''}<button class="btn" data-idi-repasar-fin>🃏 Repasar ahora</button><button class="btn btn-primario" id="idi-listo">Listo</button></div>
    </div>`
    $('#idi-pieza')?.addEventListener('click', () => modalPieza(res.piezaId))
    $('[data-idi-repasar-fin]').onclick = () => repasarTarjetas(`idioma:${id}`)
    $('#idi-listo').onclick = pintarIdiomas
  }
}

// ─── tarjetas a mano y el mazo ──────────────────────────────────────────

/** Tarjetas a mano: escribís lo que querés saber decir (una por línea) y Mastropiero completa todo de una; revisás y guardás. */
function modalTarjetasAMano(i) {
  if (!i) return
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>＋ Tarjetas de ${esc(i.nombre.toLowerCase())}</h2>
    <p class="tenue">Lo que querés saber decir, una cosa por línea (en castellano o en ${esc(i.nombre.toLowerCase())}). Cortas y específicas: «la cuenta, por favor», «soy argentino», «¿cuánto cuesta?».</p>
    <textarea class="campo-suelto" id="tjm-lineas" rows="5" placeholder="la cuenta, por favor\n¿cuánto cuesta?\nno entiendo"></textarea>
    <div class="fila"><button class="btn btn-primario" id="tjm-completar">Completar todo de una</button><button class="btn" id="tjm-mano">Escribirla yo</button></div>
    <div id="tjm-borradores"></div>`)
  const filas = []
  const pintar = () => {
    $('#tjm-borradores').innerHTML = filas.length ? `<div class="tjm-lista">${filas.map((f, k) => `<div class="tjm-fila">
        <label><input type="checkbox" data-k="${k}" ${f.ok ? 'checked' : ''}></label>
        <input class="campo-suelto" data-k="${k}" data-c="texto" value="${esc(f.texto ?? '')}" placeholder="En ${esc(i.nombre.toLowerCase())}">
        ${i.roman ? `<input class="campo-suelto" data-k="${k}" data-c="pron" value="${esc(f.pron ?? '')}" placeholder="${i.codigo === 'zh' ? 'pinyin' : 'lectura'}">` : ''}
        <input class="campo-suelto" data-k="${k}" data-c="suena" value="${esc(f.suena ?? '')}" placeholder="cómo suena">
        <input class="campo-suelto" data-k="${k}" data-c="es" value="${esc(f.es ?? '')}" placeholder="en castellano">
        ${i.conVoz && f.texto ? botonEscuchar(f.texto, i.codigo, f.audio) : ''}
      </div>`).join('')}</div><button class="btn btn-primario" id="tjm-guardar">Guardar las marcadas</button>` : ''
    engancharEscuchar($('#tjm-borradores'))
    $$('#tjm-borradores input[data-c]').forEach((x) => (x.oninput = () => { filas[Number(x.dataset.k)][x.dataset.c] = x.value }))
    $$('#tjm-borradores input[type=checkbox]').forEach((x) => (x.onchange = () => { filas[Number(x.dataset.k)].ok = x.checked }))
    $('#tjm-guardar')?.addEventListener('click', async () => {
      try {
        const { nuevas } = await api(`/idiomas/${i.aprendizajeId}/tarjetas`, { items: filas.filter((f) => f.ok) })
        toast(`${nuevas} tarjeta${nuevas === 1 ? '' : 's'} nueva${nuevas === 1 ? '' : 's'}`, 'suave')
        cerrarModal()
        pintarIdiomas()
      } catch (e) { error(e) }
    })
  }
  $('#tjm-completar').onclick = async (ev) => {
    const lineas = $('#tjm-lineas').value.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lineas.length) return toast('Escribí al menos una', 'suave')
    ev.target.disabled = true
    ev.target.textContent = 'Completando…'
    try { const { borradores } = await api(`/idiomas/${i.aprendizajeId}/completar`, { lineas }); filas.push(...borradores.map((b) => ({ ...b, ok: true }))); $('#tjm-lineas').value = ''; pintar() } catch (e) { error(e) }
    ev.target.disabled = false
    ev.target.textContent = 'Completar todo de una'
  }
  $('#tjm-mano').onclick = () => { filas.push({ texto: '', pron: '', suena: '', es: $('#tjm-lineas').value.split('\n')[0]?.trim() ?? '', ok: true }); pintar() }
}

/** Las de antes de las sesiones (de las charlas viejas, frases largas que a veces ni eran del idioma). */
const tarjetaVieja = (t) => t.origenTipo === 'idioma_turno' || /^¿Cómo dirías/.test(t.frente)

/**
 * El mazo de un idioma: todas sus tarjetas para verlas, corregirlas o borrarlas. Una por una (dos toques) o varias de una:
 * marcás (todas, las viejas o a mano) y «Borrar marcadas».
 */
async function modalMazo(i) {
  if (!i) return
  let xs
  try { xs = (await api(`/idiomas/${i.aprendizajeId}/tarjetas`)).tarjetas } catch (e) { return error(e) }
  const viejas = xs.filter(tarjetaVieja).length
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🗂 Mazo de ${esc(i.nombre.toLowerCase())} <small class="tenue" id="mazo-n">${xs.length}</small></h2>
    ${xs.length ? `<div class="fila mazo-marcar">
      <button class="btn btn-chico" data-marcar="todas">Marcar todas</button>
      ${viejas ? `<button class="btn btn-chico" data-marcar="viejas" title="Las de las charlas de antes (frases largas)">Marcar las viejas (${viejas})</button>` : ''}
      <button class="btn btn-chico" data-marcar="ninguna">Desmarcar</button>
      <button class="btn btn-chico mazo-borrar" id="mazo-borrar" disabled>🗑 Borrar marcadas</button>
    </div>
    <div class="mazo-lista">${xs.map((t) => `<div class="mazo-fila" data-t="${t.id}">
      <label class="mazo-check"><input type="checkbox" data-sel="${t.id}"></label>
      <div class="mazo-txt"><b>${esc(t.frente)}</b><span>${esc(t.dorso).replace(/\n/g, '<br>')}</span><small class="tenue">${t.intervalo >= 21 ? 'firme' : t.repeticiones ? `vuelve el ${esc(t.proxima)}` : 'nueva'}</small></div>
      <div class="mazo-acc"><button class="btn btn-chico btn-icono" data-editar title="Corregir">✎</button><button class="btn btn-chico btn-icono" data-borrar title="Borrar">🗑</button></div>
    </div>`).join('')}</div>` : '<p class="tenue">Todavía no hay tarjetas: salen de cada sesión, o hacelas a mano con «＋ Tarjetas».</p>'}`)
  // Varias de una: marcar y borrar (con un segundo toque para confirmar).
  const borrar = $('#mazo-borrar')
  const marcadas = () => $$('#modal [data-sel]:checked').map((c) => Number(c.dataset.sel))
  const contar = () => {
    if (!borrar) return
    const n = marcadas().length
    borrar.disabled = !n
    borrar.classList.remove('seguro')
    borrar.textContent = n ? `🗑 Borrar marcadas (${n})` : '🗑 Borrar marcadas'
  }
  $$('#modal [data-sel]').forEach((c) => (c.onchange = contar))
  $$('#modal [data-marcar]').forEach((b) => (b.onclick = () => {
    const modo = b.dataset.marcar
    $$('#modal [data-sel]').forEach((c) => { c.checked = modo === 'todas' || (modo === 'viejas' && tarjetaVieja(xs.find((t) => t.id === Number(c.dataset.sel)))) })
    contar()
  }))
  borrar?.addEventListener('click', async () => {
    const ids = marcadas()
    if (!ids.length) return
    if (!borrar.classList.contains('seguro')) { borrar.classList.add('seguro'); borrar.textContent = `¿Borrar ${ids.length}? Tocá de nuevo`; return }
    try {
      const { borradas } = await api(`/idiomas/${i.aprendizajeId}/tarjetas/borrar`, { ids })
      ids.forEach((id) => $(`#modal .mazo-fila[data-t="${id}"]`)?.remove())
      xs = xs.filter((t) => !ids.includes(t.id))
      $('#mazo-n').textContent = xs.length
      toast(`${borradas} tarjeta${borradas === 1 ? '' : 's'} borrada${borradas === 1 ? '' : 's'}`, 'suave')
      contar()
    } catch (e) { error(e) }
  })
  $$('#modal .mazo-fila').forEach((f) => {
    const t = xs.find((x) => x.id === Number(f.dataset.t))
    $('[data-borrar]', f).onclick = async (e) => {
      const b = e.currentTarget
      if (!b.classList.contains('seguro')) { b.classList.add('seguro'); b.textContent = '¿Borrar?'; return }
      try { await api(`/tarjetas/${t.id}/borrar`, {}); f.remove() } catch (err) { error(err) }
    }
    $('[data-editar]', f).onclick = () => {
      $('.mazo-txt', f).innerHTML = `<input class="campo-suelto" data-f value="${esc(t.frente)}"><textarea class="campo-suelto" rows="3" data-d>${esc(t.dorso)}</textarea><button class="btn btn-chico btn-primario" data-guardar>Guardar</button>`
      $('[data-guardar]', f).onclick = async () => {
        try {
          const n = await api(`/tarjetas/${t.id}/editar`, { frente: $('[data-f]', f).value, dorso: $('[data-d]', f).value })
          Object.assign(t, n)
          $('.mazo-txt', f).innerHTML = `<b>${esc(n.frente)}</b><span>${esc(n.dorso).replace(/\n/g, '<br>')}</span>`
        } catch (err) { error(err) }
      }
    }
  })
}

// ─── el repaso ──────────────────────────────────────────────────────────

const CALIDADES_TJ = [['otra', '↺ Otra vez'], ['dificil', '😓 Difícil'], ['bien', '🙂 Bien'], ['facil', '😎 Fácil']]

/** El repaso: la pregunta sola, «👀 Ver» muestra el dorso (con cómo se lee y cómo suena), y cómo te fue decide cuándo vuelve. mazo = null: todas. */
async function repasarTarjetas(mazo = null) {
  let cola
  try { cola = (await api(`/tarjetas?limite=100${mazo ? `&mazo=${encodeURIComponent(mazo)}` : ''}`)).paraHoy } catch (e) { return error(e) }
  if (!idiDatos) { try { idiDatos = await api('/idiomas') } catch { /* sin nombres ni audio */ } }
  let hechas = 0
  const codigoDe = (m) => { const id = m.startsWith('idioma:') ? Number(m.slice(7)) : null; const i = idiDatos?.idiomas.find((x) => x.aprendizajeId === id); return i?.conVoz ? i.codigo : null }
  const nombreDe = (m) => { const id = m.startsWith('idioma:') ? Number(m.slice(7)) : null; return idiDatos?.idiomas.find((x) => x.aprendizajeId === id)?.nombre ?? (id ? 'Idioma' : m === 'consumido' ? 'Lo que miraste' : m === 'mano' ? 'La Mano' : m) }
  const pintar = () => {
    const t = cola[0]
    if (!t) {
      abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><div class="vacio"><div class="gran">🃏</div><h2>${hechas ? `Listo: ${hechas} repasada${hechas === 1 ? '' : 's'}` : 'No te queda ninguna para hoy'}</h2><p>Lo que sabés se aleja; lo que costó vuelve pronto.</p></div>`)
      if (vista === 'idiomas' && $('.idi-lista, .idi-acciones')) pintarIdiomas()
      if (vista === 'hoy') traerHoy()
      return
    }
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
      <div class="tj-cab"><span class="chip">${esc(nombreDe(t.mazo))}</span><small class="tenue">${cola.length} para hoy${hechas ? ` · ${hechas} hechas` : ''}</small></div>
      <div class="tj-carta"><p class="tj-frente">${esc(t.frente)}</p>
        <div class="tj-dorso" hidden><hr>${t.dorso.split('\n').filter(Boolean).map((l, n) => `<p class="${n ? 'tenue' : 'tj-resp'}">${esc(l)}${!n && codigoDe(t.mazo) ? ` ${botonEscuchar(l, codigoDe(t.mazo))}` : ''}</p>`).join('')}</div></div>
      <p class="tenue chico tj-pista">¿Qué te acordás? Decilo en voz alta antes de mirar.</p>
      <div class="fila tj-botones"><button class="btn btn-primario" id="tj-ver" autofocus>👀 Ver</button></div>`)
    $('#tj-ver').onclick = () => {
      $('.tj-dorso').hidden = false
      $('.tj-pista').hidden = true
      engancharEscuchar($('#modal'))
      const oir = $('#modal [data-oir]')
      if (oir) escucharFrase(oir.dataset.oir, oir.dataset.cod, null)
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
