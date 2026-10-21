'use strict'
// El Directo en vivo, adentro de Hoy: una franja arriba del chat (qué está haciendo, cuánto lleva en eso contra su meta,
// el estímulo de hoy, la banda de la run), los controles (pausar, micrófono, charla en vivo, consejo, apagar), lo que
// espera su ok para validar ahí mismo, y los momentos como líneas finas en la charla.

const vivo = { datos: null, timer: null, firma: '' }
const LINEAS_VIVO = [['compacto', 'Momentos: cuando cambia'], ['todas', 'Momentos: todos'], ['ninguna', 'Momentos: ninguno']]
const lineasVivo = () => pref.leer('mastro-vivo-lineas', 'compacto')

/** ¿Hay un Directo prendido? (el de esta pestaña o uno abierto en el servidor). */
const hayDirecto = () => !!(directo.sesion || E?.hoy?.directo)

async function traerVivo() {
  if (vista !== 'hoy' || document.hidden) return
  if (!hayDirecto()) { vivo.datos = null; pintarVivo(); return }
  try { vivo.datos = (await api('/directo/vivo')).vivo } catch { return }
  pintarVivo()
  // Las líneas de momentos entran al hilo: se repinta el chat solo si cambiaron.
  const firma = JSON.stringify(vivo.datos?.momentos?.map((m) => m.id) ?? [])
  if (firma !== vivo.firma) { vivo.firma = firma; if (vista === 'hoy' && !chat.pensando) pintarChat() }
}

function seguirVivo() {
  clearInterval(vivo.timer)
  vivo.timer = setInterval(traerVivo, 15_000)
  traerVivo()
}

const reloj = (desde) => {
  const s = Math.max(0, Math.floor((Date.now() - desde) / 1000))
  return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function pintarVivo() {
  const el = $('#hoy-vivo')
  if (!el) return
  const d = vivo.datos
  if (!d) {
    el.innerHTML = `<button class="vivo-prender" id="vivo-prender" title="Mastropiero mira tu pantalla y te escucha mientras trabajás">● Prender el Directo</button>`
    el.className = 'hoy-vivo apagado'
    $('#vivo-prender').onclick = () => modalDirecto()
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
        <button class="btn btn-chico" id="vivo-apagar" title="Apagar el Directo (escribo el informe)">■</button>
      </span>
    </div>
    <div class="vivo-fila vivo-foco">
      ${a ? `<span title="Lo que lleva en lo mismo, contra su meta de bloque">⏱ ${d.bloque}′${d.meta ? ` de ${d.meta}′` : ''}<i class="vivo-barra"><b style="width:${pct}%"></b></i></span>` : ''}
      ${d.enEstimulo ? '<span class="vivo-alerta">alto estímulo</span>' : ''}
      ${d.estimuloHoy ? `<span class="tenue">estímulo hoy ${d.estimuloHoy}′</span>` : ''}
      ${d.banda ? `<span>⚔ ${esc(d.banda.titulo)}${d.banda.restan != null ? ` · quedan ${d.banda.restan}′` : ''}${d.banda.siguiente ? ` <span class="tenue">→ ${esc(d.banda.siguiente)}</span>` : ''}</span>` : '<span class="tenue">sin run</span>'}
    </div>`
  const en = (id, f) => { const b = $(id); if (b) b.onclick = f }
  en('#vivo-pausa', () => { directo.pausado = !directo.pausado; toast(directo.pausado ? '⏸ En pausa: no miro ni escucho' : '▶ Sigo mirando', 'suave'); pintarVivo() })
  en('#vivo-mic', () => { directo.sinMic = !directo.sinMic; pintarVivo() })
  en('#vivo-charla', () => { alternarCharlaEnVivo().then(pintarVivo) })
  en('#vivo-consejo', () => pedirConsejo())
  en('#vivo-validar', () => modalBandeja())
  en('#vivo-apagar', () => { if (directo.sesion) { if (confirm('¿Apagar el Directo? Escribo el informe con lo que vi y escuché.')) detenerDirecto() } else modalDirecto() })
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
