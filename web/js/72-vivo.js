'use strict'
// El Directo en vivo, adentro de Hoy: una franja arriba del chat (qué está haciendo, cuánto lleva en eso contra su meta,
// el estímulo de hoy, la banda de la run), los controles (pausar, micrófono, charla en vivo, consejo, apagar), lo que
// espera su ok para validar ahí mismo, y los momentos como líneas finas en la charla.

const vivo = { datos: null, bloque: null, timer: null, firma: '', firmaBloque: '' }
const LINEAS_VIVO = [['compacto', 'Momentos: cuando cambia'], ['todas', 'Momentos: todos'], ['ninguna', 'Momentos: ninguno']]
const lineasVivo = () => pref.leer('mastro-vivo-lineas', 'compacto')

/** ¿Hay un Directo prendido? (el de esta pestaña o uno abierto en el servidor). */
const hayDirecto = () => !!(directo.sesion || E?.hoy?.directo)

async function traerVivo() {
  if (vista !== 'hoy' || document.hidden) return
  let r
  try { r = await api('/directo/vivo') } catch { return }
  vivo.datos = r.vivo
  vivo.bloque = r.bloque
  pintarVivo()
  window.pintarAhora?.() // el bloque y la cuenta de la banda viven en «Ahora»
  // El bloque guiado terminó o le avisé que se fue del tema: el mensaje ya está en Hoy (y se escucha si la voz está prendida).
  const fb = r.bloque ? `${r.bloque.id}:${r.bloque.avisado}` : ''
  if (vivo.firmaBloque && fb !== vivo.firmaBloque) traerLoNuevo()
  vivo.firmaBloque = fb || (vivo.firmaBloque ? '-' : '')
  // Las líneas de momentos entran al hilo: se repinta el chat solo si cambiaron.
  const firma = JSON.stringify(vivo.datos?.momentos?.map((m) => m.id) ?? [])
  if (firma !== vivo.firma) { vivo.firma = firma; if (vista === 'hoy' && !chat.pensando) pintarChat() }
}

function seguirVivo() {
  clearInterval(vivo.timer)
  vivo.timer = setInterval(traerVivo, 15_000)
  traerVivo()
}

const miles = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

const reloj = (desde) => {
  const s = Math.max(0, Math.floor((Date.now() - desde) / 1000))
  return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Los botones que van siempre, con o sin Directo: un bloque guiado y cerrar el día hablando. */
const botonesSiempre = () => `${vivo.bloque ? '' : '<button class="btn btn-chico" id="vivo-bloque" title="Un bloque de foco guiado: le cuido el tema y le aviso una vez si se va">⏱</button>'}
  <button class="btn btn-chico" id="vivo-cierre" title="Cerrar el día hablando (unos 3 minutos)">🌙</button>`

function engancharSiempre() {
  const en = (id, f) => { const b = $(id); if (b) b.onclick = f }
  en('#vivo-bloque', () => modalBloque())
  en('#vivo-cierre', () => cerrarDiaHablando())
}

function pintarVivo() {
  const el = $('#hoy-vivo')
  if (!el) return
  const d = vivo.datos
  if (!d) {
    el.innerHTML = `<div class="vivo-fila"><button class="vivo-prender" id="vivo-prender" title="Mastropiero mira tu pantalla y te escucha mientras trabajás">● Prender el Directo</button><span class="vivo-acc">${botonesSiempre()}</span></div>`
    el.className = 'hoy-vivo apagado'
    $('#vivo-prender').onclick = () => modalDirecto()
    engancharSiempre()
    return
  }
  el.className = `hoy-vivo${directo.pausado ? ' pausado' : ''}`
  const a = d.actual
  const pct = d.meta ? Math.min(100, Math.round((d.bloque / d.meta) * 100)) : 0
  const local = directo.sesion === d.sesion.id
  el.innerHTML = `
    <div class="vivo-fila">
      <span class="vivo-punto">${directo.pausado ? '⏸ EN PAUSA' : '● EN VIVO'}</span>
      <span class="vivo-reloj" id="vivo-reloj">${reloj(d.sesion.inicio)}</span>
      <span class="vivo-ahora">${a ? `${esc(a.app ?? '')}${a.actividad ? ` · ${esc(a.actividad)}` : ''}${a.tema ? ` · <span class="tenue">${esc(a.tema)}</span>` : ''}` : '<span class="tenue">esperando el primer cuadro…</span>'}</span>
      <span class="vivo-acc">
        ${local ? `<button class="btn btn-chico" id="vivo-pausa" title="Pausar sin apagar (no mira ni escucha)">${directo.pausado ? '▶' : '⏸'}</button>
        ${directo.mic ? `<button class="btn btn-chico ${directo.sinMic ? '' : 'on'}" id="vivo-mic" title="Tu micrófono para el Directo">🎙</button>` : ''}` : ''}
        <button class="btn btn-chico ${voz.vivo ? 'on' : ''}" id="vivo-charla" title="Charla en vivo">🎧</button>
        <button class="btn btn-chico" id="vivo-consejo" title="Un consejo para este momento (solo cuando lo pedís)">💡</button>
        <button class="btn btn-chico" id="vivo-validar" title="Lo que espera tu ok">📥${d.pendientes ? ` ${d.pendientes}` : ''}</button>
        <select class="campo-suelto vivo-lineas" id="vivo-lineas" title="Los momentos en la charla">${LINEAS_VIVO.map(([k, n]) => `<option value="${k}" ${lineasVivo() === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        ${botonesSiempre()}
        <button class="btn btn-chico" id="vivo-apagar" title="Apagar el Directo (escribo el informe)">■</button>
      </span>
    </div>
    <div class="vivo-fila vivo-foco">
      ${a ? `<span title="Lo que lleva en lo mismo, contra su meta de bloque">▣ ${d.bloque}′${d.meta ? ` de ${d.meta}′` : ''}<i class="vivo-barra"><b style="width:${pct}%"></b></i></span>` : ''}
      ${d.enEstimulo ? '<span class="vivo-alerta">alto estímulo</span>' : ''}
      ${d.estimuloHoy ? `<span class="tenue">estímulo hoy ${d.estimuloHoy}′</span>` : ''}
      ${d.costo?.directoPorHora || d.costo?.copilotoHoy ? `<span class="tenue" title="Lo que gasta el Directo por hora (mirar y escribir los tramos) y el copiloto hoy">≈ ${miles(d.costo.directoPorHora)} tok/h${d.costo.copilotoHoy ? ` · 💡 ${miles(d.costo.copilotoHoy)}` : ''}</span>` : ''}
    </div>`
  const en = (id, f) => { const b = $(id); if (b) b.onclick = f }
  en('#vivo-pausa', () => { directo.pausado = !directo.pausado; toast(directo.pausado ? '⏸ En pausa: no miro ni escucho' : '▶ Sigo mirando', 'suave'); pintarVivo() })
  en('#vivo-mic', () => { directo.sinMic = !directo.sinMic; pintarVivo() })
  en('#vivo-charla', () => { alternarCharlaEnVivo().then(pintarVivo) })
  en('#vivo-consejo', () => pedirConsejo())
  en('#vivo-validar', () => modalBandeja())
  en('#vivo-apagar', async () => { if (directo.sesion) { if (await confirmarApagarDirecto()) detenerDirecto() } else modalDirecto() })
  engancharSiempre()
  $('#vivo-lineas').onchange = (e) => { pref.guardar('mastro-vivo-lineas', e.target.value); vivo.firma = ''; pintarChat() }
}
setInterval(() => { const r = $('#vivo-reloj'); if (r && vivo.datos && !document.hidden) r.textContent = reloj(vivo.datos.sesion.inicio) }, 1000)

/**
 * Los momentos del Directo como líneas en el hilo de Hoy, intercalados por hora. Compacto: solo cuando cambia de app o
 * de tema, y lo que dijo o escuchó (lo dicho en la charla ya está como mensaje).
 */
function conMomentos(ms) {
  const d = vivo.datos
  const modo = lineasVivo()
  if (vista !== 'hoy' || !d || modo === 'ninguna' || !d.momentos?.length) return ms
  let ant = ''
  const lineas = []
  for (const m of d.momentos) {
    if (m.tipo === 'pantalla') {
      const clave = `${m.app}|${m.tema}`
      if (modo === 'compacto' && clave === ant) continue
      ant = clave
      lineas.push({ id: -100000 - m.id, rol: 'momento', en: m.desde, texto: `▣ ${[m.app, m.actividad, m.tema].filter(Boolean).join(' · ')}` })
    } else if (m.tipo === 'medio') lineas.push({ id: -100000 - m.id, rol: 'momento', en: m.desde, texto: `♪ ${(m.texto ?? '').slice(0, 120)}` })
    else if (m.tipo === 'voz' && !ms.some((x) => x.via === 'voz' && x.texto === m.texto)) lineas.push({ id: -100000 - m.id, rol: 'momento', en: m.desde, texto: `🗣 «${(m.texto ?? '').slice(0, 140)}»` })
  }
  if (!lineas.length) return ms
  const desde = d.sesion.inicio
  return [...ms, ...lineas].sort((x, y) => (x.en ?? 0) - (y.en ?? 0) || (x.id > 0 && y.id > 0 ? x.id - y.id : 0)).filter((x) => x.rol !== 'momento' || x.en >= desde)
}

/** 💡 Un consejo para este momento: solo cuando lo pide (decisión suya). Va al chat de Hoy. */
async function pedirConsejo() {
  try {
    const cid = await conversacionParaVoz()
    await api(`/chat/${cid}/consejo`, {})
    const ultimo = chat.mensajes.reduce((m, x) => (x.id > m ? x.id : m), 0)
    if (voz.vivo || voz.leer) voz.lectura = { cid, desdeId: ultimo, dichas: 0 }
    chat.pensando = true
    pintarChat()
    seguirTurno()
  } catch (e) { error(e) }
}

/** Trae lo que llegó a Hoy sin que él escribiera (la tarjeta del bloque, el aviso) y, con la voz prendida, lo dice. */
async function traerLoNuevo() {
  if (vista !== 'hoy' || !chat.actual) return
  const antes = chat.mensajes.reduce((m, x) => (x.id > m ? x.id : m), 0)
  await abrirConversacion(chat.actual.id)
  if (!(voz.vivo || voz.leer)) return
  for (const m of chat.mensajes) if (m.id > antes && m.rol === 'asistente') encolar(paraOir(partirSeguir(m.texto).texto))
}
const paraOir = (t) => t.replace(/[⏱🌙]/gu, '').trim()

/** ⏱ Arrancar un bloque guiado: cuántos minutos (sin nada, su meta de bloque) y en qué. */
function modalBloque() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>⏱ Un bloque de foco</h2>
    <p class="tenue">Mientras dura, si el Directo ve que se fue del tema más de 3 minutos, le aviso una vez. Al terminar: cuánto sostuvo y el descanso que le toca.</p>
    <div class="form-ing">
      <label class="campo">En qué<input id="bq-tema" placeholder="el informe, el mail al cliente…"></label>
      <label class="campo">Minutos<input id="bq-min" type="number" min="5" max="180" placeholder="su meta de bloque"></label>
    </div>
    <div class="fila mt-3"><button class="btn btn-primario" id="bq-ir">⏱ Arrancar</button><button class="btn" data-bq="25">25′</button><button class="btn" data-bq="50">50′</button></div>`)
  const ir = async (min) => {
    try {
      await api('/bloque', { minutos: min || Number($('#bq-min').value) || null, tema: $('#bq-tema').value.trim() || null })
      cerrarModal()
      toast('⏱ Bloque arrancado<small>Le cuido el tema.</small>', 'suave')
      traerVivo()
    } catch (e) { error(e) }
  }
  $('#bq-ir').onclick = () => ir(null)
  $$('[data-bq]').forEach((b) => (b.onclick = () => ir(Number(b.dataset.bq))))
  $('#bq-tema').onkeydown = (e) => { if (e.key === 'Enter') ir(null) }
  $('#bq-tema').focus()
}

/** 🌙 El cierre del día hablado: Mastropiero abre con lo del día, se escucha, y queda la charla en vivo para contestarle. */
async function cerrarDiaHablando() {
  try {
    const { texto } = await api('/hoy/cierre', {})
    if (chat.actual) await abrirConversacion(chat.actual.id)
    encolar(paraOir(texto))
    if (!voz.vivo) await alternarCharlaEnVivo()
    pintarVivo()
  } catch (e) { error(e) }
}
