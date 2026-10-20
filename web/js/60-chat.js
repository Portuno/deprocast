'use strict'
// Chat

const chat = { conversaciones: [], actual: null, mensajes: [], pensando: false, sondeo: null, borrador: '', adjuntos: [] }

/** Markdown mínimo y seguro: se escapa todo primero; después se marcan bloques, tablas, listas y referencias. */
function md(texto) {
  const bloques = []
  // Citas al corpus: [#410] o [#410, #388] → notas al pie numeradas en el orden en que aparecen.
  const citas = new Map()
  let t = esc(texto ?? '')
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, c) => (c.trim() ? `\u0000${bloques.push(c) - 1}\u0000` : '')) // un bloque vacío no se pinta
    .replace(/\s?\[((?:#\d+\s*,?\s*)+)\]/g, (_, ids) => `<sup class="cita">${ids.match(/\d+/g).map((id) => {
      if (!citas.has(id)) citas.set(id, citas.size + 1)
      return `<a data-pieza="${id}" title="Ver la fuente">${citas.get(id)}</a>`
    }).join('')}</sup>`)
  const lineas = t.split('\n')
  const out = []
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1] ?? '')) {
      const celdas = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const cab = celdas(l)
      i += 2
      const filas = []
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]))
      i--
      out.push(`<table><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`)
    } else if (/^\s*[-*] /.test(l) || /^\s*\d+[.)] /.test(l)) {
      // Una lista sigue aunque haya líneas en blanco entre los puntos (el modelo suele separarlos así), y las
      // líneas con sangría debajo de un punto son parte de ese punto. Así la numeración no vuelve a 1.
      const numerada = /^\s*\d+[.)] /.test(l)
      const marca = numerada ? /^\s*\d+[.)] / : /^\s*[-*] /
      const items = []
      const nums = []
      while (i < lineas.length) {
        const x = lineas[i]
        const m = numerada ? x.match(/^\s*(\d+)[.)] /) : null
        if (marca.test(x)) { if (m) nums.push(Number(m[1])); items.push(x.replace(marca, '')); i++; continue }
        if (items.length && /^\s{2,}\S/.test(x)) { items[items.length - 1] += `<br>${x.trim()}`; i++; continue }
        if (!x.trim()) {
          let j = i
          while (j < lineas.length && !lineas[j].trim()) j++
          if (j < lineas.length && marca.test(lineas[j])) { i = j; continue }
        }
        break
      }
      i--
      // El número escrito se respeta uno a uno (value en cada ítem): una lista «1., 7., 3.» no se renumerada 1, 2, 3.
      if (numerada) out.push(`<ol>${items.map((x, k) => `<li value="${nums[k] ?? k + 1}">${x}</li>`).join('')}</ol>`)
      else out.push(`<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`)
    } else if (/^#{1,4} /.test(l)) out.push(`<h4>${l.replace(/^#+ /, '')}</h4>`)
    else if (/^&gt; /.test(l)) out.push(`<blockquote>${l.slice(5)}</blockquote>`)
    else if (!l.trim()) out.push('')
    else out.push(`<p>${l}</p>`)
  }
  return out.join('')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\b(misi[oó]n(?:es)?) #(\d+)/gi, '$1 <a class="ref" data-ver-tarea="$2">#$2</a>')
    .replace(/\b(qu[aá]ntomo(?:s)?(?: proto| sellado)?) #(\d+)/gi, '$1 <a class="ref" data-ref-q="$2">#$2</a>')
    .replace(/\b(carga) #(\d+)/gi, '$1 <a class="ref" data-ref-carga="$2">#$2</a>')
    .replace(/\b(propuesta(?: de mejora)?) #(\d+)/gi, '$1 <a class="ref" data-ref-propuestas>#$2</a>')
    .replace(/\b(entidad(?:es)?) #(\d+)/gi, '$1 <a class="ref" data-ref-ent="$2">#$2</a>')
    .replace(/(^|[\s(,[])#(\d+)\b(?![^<]*<\/a>)/g, '$1<a class="ref" data-pieza="$2">#$2</a>')
    .replace(/\b([A-Z]{3}-\d{4})\b(?![^<]*<\/a>)/g, '<a class="ref" data-agente="$1">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => `<pre><code>${bloques[Number(n)]}</code></pre>`)
}

function quienEs(c) {
  if (c?.modo === 'diario') return { glifo: '✎', nombre: 'Diario', sub: 'contale lo que quieras · Mastropiero escucha', color: 'var(--acento-texto)' }
  if (c?.modo === 'hoy') return { glifo: '☿', nombre: 'Mastropiero', sub: 'tu día · acá llega la jornada y el cierre', color: 'var(--acento-texto)' }
  if (!c || c.con === 'mastropiero') return { glifo: '☿', nombre: 'Mastropiero', sub: 'el agente omnívoro · opera toda la plataforma', color: 'var(--acento-texto)' }
  if (String(c.con).startsWith('modelo:')) return { glifo: '♛', nombre: String(c.titulo ?? 'Tu modelo').replace(/^Con /, ''), sub: 'tu consejo de modelos · habla desde su manual', color: 'var(--acento-texto)', vivo: true }
  const f = E.roster.find((x) => x.id === c.con)
  const cl = f ? claseDe(f.clase) : null
  return {
    glifo: cl?.glifo ?? '✝', nombre: f ? (f.nombre ? `${f.nombre} · ${f.id}` : f.id) : `${c.con} (retirado)`,
    sub: f ? `${cl.nombre} · nivel ${f.nivel} · ${f.estado}${f.especializacion ? ` · ${f.especializacion}` : ''}` : 'ya no está en la liga',
    color: f ? colorDe(f.clase) : 'var(--debil)', vivo: !!f,
  }
}

const SUGERENCIAS_MASTRO = [
  '¿Cómo funciona la liga? Explicámelo corto.',
  '¿Qué hay en el corpus y de qué niveles?',
  'Creame un buscador que solo cite fuentes primarias.',
  'Corré un tick y contame qué pasó.',
  'Leé tus lineamientos y proponeme tres mejoras.',
  '¿Quién soy, según lo que cargué?',
  'Armame el día de mañana.',
]
const SUGERENCIAS_AGENTE = ['¿Qué hacés y cómo trabajás?', '¿Qué encontrás en el corpus sobre lo que más aparece?', '¿Qué misión te vendría bien?']

/** El hilo + el compositor: se usa en Chat y en Hoy (mismos ids, una vista a la vez). */
const hiloHTMLBase = () => `
  <header class="chat-cab" id="chat-cab"></header>
  <div class="chat-hilo" id="hilo"><div class="chat-col" id="hilo-col"></div></div>
  <div class="chat-compositor">
    ${E.chatConModelo ? '' : '<div class="aviso aviso-modelo">Sin modelo: Mastropiero necesita NAN_API_KEY en .env para conversar.</div>'}
    <div class="chat-acciones" id="chat-acciones" hidden></div>
    <form id="chat-form">
      <div class="chat-adjuntos" id="chat-adjuntos" hidden></div>
      <label class="btn btn-icono" id="chat-adjuntar" title="Adjuntar imágenes o archivos (PDF, Word, Excel, PowerPoint, texto). También podés pegarlos o arrastrarlos">📎<input type="file" accept="image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json" multiple hidden id="chat-img-in"></label>
      <label class="btn btn-icono" id="chat-audio" title="Subir un audio: se transcribe y entra como lo que contás" hidden>🎙<input type="file" accept="audio/*" hidden id="chat-audio-in"></label>
      <textarea id="chat-txt" rows="1" placeholder="Escribile a Mastropiero…" title="Enter envía. Shift+Enter, nueva línea."></textarea><button class="btn btn-primario" id="chat-enviar">Enviar</button>
    </form>
  </div>`

function engancharCompositor() {
  const txt = $('#chat-txt')
  txt.value = chat.borrador
  const ajustar = () => { txt.style.height = 'auto'; txt.style.height = `${Math.min(txt.scrollHeight, 200)}px` }
  txt.oninput = () => { chat.borrador = txt.value; ajustar() }
  txt.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarChat() } }
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); enviarChat() }
  $('#chat-img-in').onchange = (e) => { adjuntar([...e.target.files]); e.target.value = '' }
  txt.onpaste = (e) => {
    const fs = [...(e.clipboardData?.files ?? [])]
    if (fs.length) { e.preventDefault(); adjuntar(fs) }
  }
  const zona = $('.chat-compositor')
  zona.ondragover = (e) => { if ([...e.dataTransfer.items].some((x) => x.kind === 'file')) { e.preventDefault(); zona.classList.add('soltando') } }
  zona.ondragleave = () => zona.classList.remove('soltando')
  zona.ondrop = (e) => {
    zona.classList.remove('soltando')
    const fs = [...e.dataTransfer.files]
    if (fs.length) { e.preventDefault(); adjuntar(fs) }
  }
  pintarAdjuntos()
  $('#chat-audio-in').onchange = async (e) => {
    const f = e.target.files[0]
    if (!f || !chat.actual) return
    e.target.value = ''
    toast(`Transcribiendo ${esc(f.name)}…`, 'suave')
    try {
      const r = await fetch(`/api/diario/audio?conversacion=${chat.actual.id}&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      chat.mensajes.push({ id: -1, rol: 'operador', texto: j.texto })
      chat.pensando = true
      pintarChat()
      seguirTurno()
    } catch (err) { error(err) }
  }
  ajustar()
}

async function montarChat() {
  $('#principal').classList.add('lleno')
  $('#principal').innerHTML = `<div class="chat ${pref.leer('mastro-chat-lado', 'no') === 'si' ? 'con-lado' : ''}" id="chat-vista"><aside class="chat-lado" id="chat-lado"></aside><section class="chat-main">${hiloHTMLBase()}</section></div>`
  engancharCompositor()
  await traerConversaciones()
  if (!chat.actual || chat.actual.modo === 'hoy' || !chat.conversaciones.some((c) => c.id === chat.actual.id)) {
    const ultima = chat.conversaciones.find((c) => c.con === 'mastropiero' && c.modo === 'chat')
    if (ultima) await abrirConversacion(ultima.id)
    else { chat.actual = null; chat.mensajes = []; pintarChat() }
  } else await abrirConversacion(chat.actual.id)
  $('#chat-txt').focus()
}

async function traerConversaciones() {
  try { chat.conversaciones = await api('/chat') } catch (e) { error(e) }
  pintarLado()
}

function pintarLado() {
  const lado = $('#chat-lado')
  if (!lado) return
  const item = (c) => {
    const q = quienEs(c)
    return `<button class="chat-item ${chat.actual?.id === c.id ? 'on' : ''}" data-conv="${c.id}"><i style="color:${q.color}">${q.glifo}</i>
      <span>${esc(c.titulo ?? 'Conversación nueva')}</span>${c.pensando ? '<em>…</em>' : ''}</button>`
  }
  const conMastro = chat.conversaciones.filter((c) => c.con === 'mastropiero' && c.modo === 'chat')
  const diario = chat.conversaciones.filter((c) => c.modo === 'diario')
  const conAgentes = chat.conversaciones.filter((c) => c.con !== 'mastropiero')
  lado.innerHTML = `
    <button class="btn btn-primario" id="chat-nueva">Nueva conversación</button>
    <button class="chat-item" data-ir-hoy><i>☀</i><span>Hoy</span><em>${E.hoy.total ? `${E.hoy.hechos}/${E.hoy.total}` : ''}</em></button>
    <h4>Con Mastropiero</h4>${conMastro.map(item).join('') || '<p class="tenue" style="margin:2px 8px;font-size:12.5px">Ninguna todavía.</p>'}
    <h4>Diario</h4>
    <button class="chat-item" id="diario-nuevo"><i>✎</i><span>Contale algo</span></button>
    ${diario.map(item).join('')}
    ${conAgentes.length ? `<h4>Con agentes</h4>${conAgentes.map(item).join('')}` : ''}
    <h4>Hablar con un agente</h4>
    ${E.roster.map((f) => `<button class="chat-item" data-hablar="${esc(f.id)}"><i style="color:${colorDe(f.clase)}">${claseDe(f.clase).glifo}</i><span>${esc(f.nombre ?? f.id)}</span><em>${esc(claseDe(f.clase).nombre.slice(0, 3).toLowerCase())}</em></button>`).join('') || '<p class="tenue" style="margin:2px 8px;font-size:12.5px">El roster está vacío. Pedile a Mastropiero que forje uno.</p>'}
    <h4>Propuestas de mejora</h4>
    <button class="chat-item" data-ref-propuestas><i>✎</i><span>Ver propuestas</span><em>${E.propuestasAbiertas || ''}</em></button>`
  $('#chat-nueva').onclick = () => nuevaConversacion('mastropiero')
  $('#diario-nuevo').onclick = () => nuevaConversacion('mastropiero', 'diario')
  $('[data-ir-hoy]', lado).onclick = () => irA('hoy')
  $$('[data-conv]', lado).forEach((b) => (b.onclick = () => abrirConversacion(Number(b.dataset.conv))))
  $$('[data-hablar]', lado).forEach((b) => (b.onclick = () => {
    const existente = chat.conversaciones.find((c) => c.con === b.dataset.hablar)
    existente ? abrirConversacion(existente.id) : nuevaConversacion(b.dataset.hablar)
  }))
}

async function nuevaConversacion(con, modo = 'chat') {
  try {
    const c = await api('/chat', { con, modo })
    chat.conversaciones.unshift({ ...c, pensando: false })
    await abrirConversacion(c.id)
  } catch (e) { error(e) }
}

async function abrirConversacion(id) {
  try {
    const r = await api(`/chat/${id}`)
    chat.actual = r.conversacion
    chat.mensajes = r.mensajes
    chat.hayMas = !!r.hayMas
    chat.pensando = r.pensando
    pintarLado()
    pintarChat()
    if (chat.pensando) seguirTurno()
  } catch (e) { error(e) }
}

/** Los mensajes más viejos (de a 200), arriba, sin mover lo que se está leyendo. */
async function verAnteriores() {
  const id = chat.actual?.id
  const primero = chat.mensajes.find((m) => m.id > 0)?.id
  if (!id || !primero) return
  try {
    const r = await api(`/chat/${id}?antes=${primero}`)
    if (chat.actual?.id !== id) return
    const hilo = $('#hilo')
    const alto = hilo?.scrollHeight ?? 0
    chat.mensajes = [...r.mensajes, ...chat.mensajes]
    chat.hayMas = !!r.hayMas
    chat.pegado = false
    pintarChat()
    if (hilo) hilo.scrollTop = hilo.scrollHeight - alto
  } catch (e) { error(e) }
}

function sugerenciasDe(c) {
  if (c?.modo === 'diario' || c?.modo === 'hoy') return []
  if (c && c.con !== 'mastropiero') return SUGERENCIAS_AGENTE
  return SUGERENCIAS_MASTRO
}

/** Igual que partirSeguir en el servidor: el bloque no se muestra; son botones. */
function partirSeguir(texto, parcial = false) {
  let limpio = texto ?? ''
  if (parcial) limpio = limpio.replace(/\[\[(?:s(?:e(?:g(?:u(?:i(?:r(?:\](?:\])?)?)?)?)?)?)?)?$/i, '')
  const marca = '[[seguir]]'
  const i = limpio.toLowerCase().lastIndexOf(marca)
  if (i < 0) return { texto: limpio.trimEnd(), seguir: [] }
  const despues = limpio.slice(i + marca.length)
  const fin = despues.toLowerCase().indexOf('[[/seguir]]')
  if (fin < 0) return { texto: (parcial ? limpio.slice(0, i) : limpio).trimEnd(), seguir: [] }
  if (despues.slice(fin + '[[/seguir]]'.length).trim()) return { texto: limpio.trimEnd(), seguir: [] }
  const seguir = parcial ? [] : despues.slice(0, fin).split('\n').map((s) => s.replace(/^[-*•]\s*/, '').trim()).filter((s) => s.length > 0 && s.length <= 90).slice(0, 3)
  return { texto: limpio.slice(0, i).trimEnd(), seguir }
}

function seguirDelHilo() {
  if (chat.pensando) return []
  return partirSeguir(ultimaRespuesta()).seguir
}

function ultimaRespuesta() {
  for (let i = chat.mensajes.length - 1; i >= 0; i--) {
    const m = chat.mensajes[i]
    if (m.rol === 'asistente' && m.texto?.trim()) return m.texto
  }
  return ''
}

/** La charla entera para pegar en otro lado: quién dice qué y a qué hora (sin la actividad de herramientas). */
function charlaComoTexto(ms, nombre) {
  const hora = (en) => (en ? ` (${new Date(en).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })})` : '')
  return ms.map((m) => {
    if (m.rol === 'operador' && m.texto?.trim()) return `**Usuario**${hora(m.en)}:\n${m.texto.trim()}`
    if (m.rol === 'asistente' && m.texto?.trim()) return `**${m.modelo === 'rutina' ? `${nombre} (rutina)` : nombre}**${hora(m.en)}:\n${partirSeguir(m.texto).texto.trim()}`
    if (m.rol === 'evento' && m.texto?.trim()) return `· ${m.texto.trim()}`
    return ''
  }).filter(Boolean).join('\n\n')
}

function pintarChat() {
  const c = chat.actual
  const q = quienEs(c ?? { con: 'mastropiero' })
  const copiable = partirSeguir(ultimaRespuesta()).texto
  $('#chat-cab').innerHTML = `${$('#chat-vista') ? '<button class="btn btn-chico btn-icono" id="chat-ver-lado" type="button" title="Mostrar u ocultar las conversaciones">☰</button>' : ''}<span class="avatar" style="--c:${q.color}">${q.glifo}</span><div class="chat-quien"><b>${esc(q.nombre)}</b><small>${esc(q.sub)}</small></div>
    <div class="fila">${copiable ? '<button class="btn btn-chico" id="chat-copiar" type="button" title="Copiar la última respuesta">Copiar</button><button class="btn btn-chico" id="chat-copiar-todo" type="button" title="Copiar la charla entera, con quién dice qué">Copiar charla</button>' : ''}${c ? `<button class="btn btn-chico" id="chat-archivar" type="button" title="Sacar de la lista">Archivar</button>` : ''}</div>`
  const verLado = $('#chat-ver-lado')
  if (verLado) verLado.onclick = () => {
    const v = $('#chat-vista')
    v.classList.toggle('con-lado')
    pref.guardar('mastro-chat-lado', v.classList.contains('con-lado') ? 'si' : 'no')
  }
  const ar = $('#chat-archivar')
  if (ar) ar.onclick = async () => { await api(`/chat/${c.id}/archivar`, {}); chat.actual = null; await traerConversaciones(); pintarChat() }
  const copiar = $('#chat-copiar')
  if (copiar) copiar.onclick = async () => {
    try { await navigator.clipboard.writeText(copiable); toast('Respuesta copiada', 'suave') } catch (e) { error(e) }
  }
  const copiarTodo = $('#chat-copiar-todo')
  if (copiarTodo) copiarTodo.onclick = async () => {
    try { await navigator.clipboard.writeText(charlaComoTexto(chat.mensajes, q.nombre)); toast('Charla copiada', 'suave') } catch (e) { error(e) }
  }
  $('#chat-txt').placeholder = c && c.con !== 'mastropiero' ? `Escribile a ${q.nombre}…` : 'Escribile a Mastropiero…'
  const col = $('#hilo-col')
  const audio = $('#chat-audio')
  if (audio) audio.hidden = c?.modo !== 'diario'
  if (c?.modo === 'diario') $('#chat-txt').placeholder = 'Contá lo que quieras…'
  const hayHilo = chat.mensajes.some((m) => m.rol === 'operador' || m.rol === 'asistente')
  const sug = hayHilo ? [] : sugerenciasDe(c)
  const rapidas = hayHilo ? seguirDelHilo() : []
  const acc = $('#chat-acciones')
  if (acc) {
    acc.hidden = !rapidas.length
    acc.innerHTML = rapidas.map((s) => `<button type="button" data-acc="${esc(s)}">${esc(s)}</button>`).join('')
    $$('[data-acc]', acc).forEach((b) => (b.onclick = () => { if (chat.pensando) return; $('#chat-txt').value = b.dataset.acc; enviarChat() }))
  }
  if (!c || !chat.mensajes.length) {
    const texto = c?.modo === 'diario'
      ? 'Un espacio para contar tus cosas, escrito o en audio (🎙). Mastropiero escucha y pregunta poco; lo que contás queda como tu voz en el corpus y alimenta lo que sabe de vos.'
      : c?.modo === 'hoy'
        ? 'Acá llega tu jornada a la mañana y el cierre a la noche. Contale cómo va el día o pedile que lo reorganice.'
        : c && String(c.con).startsWith('modelo:')
          ? 'Uno de tus modelos, hablando desde su manual operativo (principios, su vara, cómo decide). Contale una decisión o mostrale tu trabajo: te contesta con su vara. Lo que su manual no cubre, te lo dice.'
          : c && c.con !== 'mastropiero'
          ? 'Un agente de la liga. Contesta desde su oficio y puede leer el corpus según su nivel; no actúa sobre la plataforma.'
          : 'Mastropiero ve y opera todo: tu día, tu memoria, la liga y el corpus. Pedile lo que quieras en lenguaje natural; lo destructivo te lo confirma antes.'
    col.innerHTML = `<div class="chat-bienvenida"><div class="avatar" style="--c:${q.color}">${q.glifo}</div>
      <h2>${esc(q.nombre)}</h2><p>${texto}</p>
      ${sug.length ? `<div class="sugerencias">${sug.map((s) => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>`
    $$('[data-sug]', col).forEach((b) => (b.onclick = () => { $('#chat-txt').value = b.dataset.sug; enviarChat() }))
  } else {
    col.innerHTML = (chat.hayMas ? '<div class="chat-mas"><button class="btn btn-chico" id="chat-anteriores">Ver mensajes anteriores</button></div>' : '') + hiloHTML(chat.mensajes, q, chat.pensando ? chat.vivo ?? {} : null)
    if ($('#chat-anteriores')) $('#chat-anteriores').onclick = verAnteriores
  }
  $('#chat-enviar').disabled = chat.pensando
  const hilo = $('#hilo')
  if (chat.pegado !== false) hilo.scrollTop = hilo.scrollHeight
}

/** Qué está haciendo, dicho en castellano y no en nombres de función. */
const VIVO = {
  buscar_corpus: (a) => `buscando «${a?.consulta ?? '…'}»`, leer_pieza: () => 'leyendo una fuente', ver_entidad: () => 'mirando una ficha',
  listar_entidades: () => 'repasando nombres', estado_general: () => 'mirando cómo está la liga', leer_lineamientos: () => 'releyendo sus lineamientos',
  listar_agentes: () => 'mirando el roster', ver_agente: (a) => `mirando a ${a?.id ?? 'un agente'}`, ver_bus: () => 'mirando el bus', ver_encargo: () => 'leyendo un encargo',
  listar_quantomos: () => 'repasando quántomos', listar_fuentes: () => 'mirando las fuentes', listar_cargas: () => 'mirando las cargas', ver_cronica: () => 'leyendo la crónica',
  forjar_agente: () => 'forjando un agente', hablar_con_agente: (a) => `hablando con ${a?.id ?? 'un agente'}`, correr_ticks: () => 'haciendo correr la liga',
  publicar_encargo: () => 'publicando un encargo', ingerir: () => 'guardando en el corpus', proponer_mejora: () => 'anotando una mejora', crear_proyecto: () => 'creando un proyecto',
  ver_personaje: () => 'mirando una ficha', ver_misiones: () => 'repasando misiones', ver_run: () => 'mirando la run', ver_reportes: () => 'leyendo reportes',
  preparar_run: () => 'armando la run (con la liga)', rehacer_run: () => 'rehaciendo la run', arrancar_run: () => 'arrancando la run', cerrar_run: () => 'escribiendo el reporte',
  proponer_primarias: () => 'pensando tus primarias', procesar_jugador: () => 'procesándote', reporte_semanal: () => 'escribiendo el reporte de la semana',
  marcar_mision: () => 'marcando una banda', anotar_side_quest: () => 'anotando una side quest', asignar_mision: () => 'asignando una misión',
}
const CONSULTA = {
  buscar_corpus: 'el corpus', leer_pieza: 'el corpus', listar_fuentes: 'el corpus', listar_entidades: 'quién es quién', ver_entidad: 'quién es quién',
  estado_general: 'la liga', listar_agentes: 'la liga', ver_agente: 'la liga', ver_bus: 'la liga', ver_encargo: 'la liga', ver_personaje: 'las fichas', ver_misiones: 'tus misiones', ver_run: 'la run', ver_reportes: 'los reportes', ver_cronica: 'la liga', listar_caidos: 'la liga',
  listar_cargas: 'las cargas', leer_lineamientos: 'sus lineamientos', listar_propuestas: 'las propuestas', listar_quantomos: 'los quántomos',
}
const listaY = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`)

function resumenActividad(herr) {
  const consultas = [...new Set(herr.map((m) => CONSULTA[m.herramienta]).filter(Boolean))]
  const acciones = herr.filter((m) => !CONSULTA[m.herramienta]).map((m) => m.resumen ?? m.herramienta.replace(/_/g, ' '))
  return [consultas.length ? `Consultó ${listaY(consultas)}` : '', ...acciones].filter(Boolean).join(' · ')
}

/** El hilo por turnos: lo que dijiste, una línea de lo que hizo, y lo que contestó (que se escribe en vivo). */
function hiloHTML(ms, q, vivo) {
  const turnos = []
  for (const m of ms) {
    // Una línea de registro (lo que hizo desde el HUD): sola, discreta, y corta el turno.
    if (m.rol === 'evento') { turnos.push({ evento: m }); continue }
    // Lo que manda una rutina (el saludo, el cierre, la calificación) es su propio mensaje: no se pega a la respuesta anterior.
    if (m.rol === 'asistente' && m.modelo === 'rutina') { turnos.push({ yo: null, herr: [], textos: m.texto ? [m.texto] : [], errores: [], tokens: 0, modelo: 'rutina', rutina: true, en: m.en }); continue }
    if (m.rol === 'operador' || !turnos.length || turnos.at(-1).evento || turnos.at(-1).rutina) turnos.push({ yo: m.rol === 'operador' ? m : null, herr: [], textos: [], errores: [], tokens: 0, modelo: null })
    const t = turnos.at(-1)
    if (m.rol === 'herramienta') t.herr.push(m)
    else if (m.rol === 'error') t.errores.push(m)
    else if (m.rol === 'asistente') {
      if (m.texto) t.textos.push(m.texto)
      t.tokens += m.tokens ?? 0
      t.modelo = m.modelo ?? t.modelo
    }
  }
  return turnos.map((t, i) => (t.evento ? `<div class="m-evento">· ${t.evento.en ? new Date(t.evento.en).toTimeString().slice(0, 5) : ''} ${esc(t.evento.texto ?? '')}</div>` : turnoHTML(t, q, i === turnos.length - 1 ? vivo : null))).join('')
}

function turnoHTML(t, q, vivo) {
  let h = t.yo ? `<div class="m m-yo">${textoConImagenes(t.yo.texto)}</div>` : ''
  // Lo que escribió y todavía se puede volver atrás (la comida, el gasto, la misión): un botón al lado de la línea.
  const deshacibles = t.herr.filter((m) => m.deshacible).map((m) => m.id)
  const deshecho = !deshacibles.length && t.herr.some((m) => m.deshecho)
  const actividad = t.herr.length ? `<details class="actividad"><summary><span>${esc(resumenActividad(t.herr))}</span>${deshacibles.length ? `<button type="button" class="deshacer" data-deshacer="${deshacibles.join(',')}" title="Volver atrás lo que anotó en este turno">↶ deshacer</button>` : deshecho ? '<em class="deshecho">deshecho</em>' : ''}</summary><ul>${t.herr.map((m) => {
    let cuerpo = m.texto ?? ''
    try { cuerpo = JSON.stringify(JSON.parse(cuerpo), null, 2) } catch {}
    const falla = /^\{"error"/.test(m.texto ?? '') || /falló|no existe/.test(m.resumen ?? '')
    return `<li class="${falla ? 'falla' : ''}${m.deshecho ? ' tachada' : ''}"><details><summary>${esc(m.resumen ?? m.herramienta)}</summary><pre>${esc(cuerpo.slice(0, 6000))}</pre></details></li>`
  }).join('')}</ul></details>` : ''
  const borrador = vivo?.borrador ? partirSeguir(vivo.borrador, true).texto : ''
  const texto = [...t.textos.map((x) => partirSeguir(x).texto), borrador].filter(Boolean).join('\n\n')
  const haciendo = vivo && !borrador
    ? `<div class="pensando"><span><i></i><i></i><i></i></span>${esc(vivo.herramienta ? (VIVO[vivo.herramienta]?.(vivo.argumentos) ?? 'trabajando') : t.herr.length ? 'pensando qué decirte' : 'pensando')}…</div>` : ''
  const meta = !vivo && t.modelo ? `<div class="m-meta">${t.rutina ? `rutina${t.en ? ` · ${new Date(t.en).toTimeString().slice(0, 5)}` : ''}` : `${esc(t.modelo)}${t.tokens ? ` · ${t.tokens.toLocaleString('es-AR')} tokens` : ''}`}</div>` : ''
  if (actividad || texto || haciendo) {
    h += `<div class="m m-el"><span class="avatar" style="--c:${q.color}">${q.glifo}</span><div>${actividad}
      ${texto ? `<div class="md">${md(texto)}${borrador ? '<span class="cursor"></span>' : ''}</div>` : ''}${haciendo}${meta}</div></div>`
  }
  return h + t.errores.map((m) => `<div class="m-error">${esc(m.texto)}</div>`).join('')
}

const EXT_DOC = /\.(pdf|docx|xlsx|pptx|txt|md|csv|json)$/i
const ICONO_ARCHIVO = { pdf: '📕', docx: '📘', xlsx: '📗', pptx: '📙', txt: '📄', md: '📄', csv: '📊', json: '🧾' }
const pesoLegible = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** Lo que se suelta, se pega o se elige: imágenes por un lado, documentos por otro; lo demás se avisa. */
function adjuntar(archivos) {
  const imgs = archivos.filter((f) => /^image\//.test(f.type))
  const docs = archivos.filter((f) => !/^image\//.test(f.type) && EXT_DOC.test(f.name))
  const otros = archivos.length - imgs.length - docs.length
  if (otros) toast(`${otros === 1 ? 'Ese archivo no lo leo' : `${otros} archivos no los leo`}: imágenes, PDF, Word, Excel, PowerPoint o texto. (Un audio, con 🎙)`, 'suave')
  if (imgs.length) adjuntarImagenes(imgs)
  if (docs.length) adjuntarArchivos(docs)
}

/** Sube cada documento: el servidor lo guarda y saca su texto, que Mastropiero lee con el mensaje. */
async function adjuntarArchivos(archivos) {
  for (const f of archivos) {
    const a = { id: Math.random(), tipo: 'archivo', nombre: f.name, bytes: f.size, subiendo: true, marca: null }
    chat.adjuntos.push(a)
    pintarAdjuntos()
    try {
      const r = await fetch(`/api/chat/archivo?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
      Object.assign(a, { subiendo: false, marca: r.marca, palabras: r.palabras, url: r.url })
    } catch (e) { error(e); chat.adjuntos = chat.adjuntos.filter((x) => x !== a) }
    pintarAdjuntos()
  }
}

/** Sube cada imagen (se achica y se describe en el servidor) y la deja lista para mandar con el próximo mensaje. */
async function adjuntarImagenes(archivos) {
  for (const f of archivos) {
    const a = { id: Math.random(), vista: URL.createObjectURL(f), subiendo: true, marca: null }
    chat.adjuntos.push(a)
    pintarAdjuntos()
    try {
      const r = await fetch(`/api/chat/imagen?nombre=${encodeURIComponent(f.name || 'imagen.png')}`, { method: 'POST', body: f }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
      Object.assign(a, { subiendo: false, marca: r.marca, descripcion: r.descripcion })
    } catch (e) { error(e); chat.adjuntos = chat.adjuntos.filter((x) => x !== a) }
    pintarAdjuntos()
  }
}

function pintarAdjuntos() {
  const cont = $('#chat-adjuntos')
  if (!cont) return
  cont.hidden = !chat.adjuntos.length
  cont.innerHTML = chat.adjuntos.map((a) => a.tipo === 'archivo'
    ? `<span class="adj adj-archivo ${a.subiendo ? 'subiendo' : ''}"><i>${ICONO_ARCHIVO[(a.nombre.split('.').pop() || '').toLowerCase()] ?? '📄'}</i><span><b title="${esc(a.nombre)}">${esc(a.nombre)}</b><small>${a.subiendo ? 'Leyendo…' : `${pesoLegible(a.bytes)} · ${a.palabras ? `${a.palabras.toLocaleString('es-AR')} palabras` : 'sin texto legible'}`}</small></span><button type="button" data-quitar-adj="${a.id}" title="Quitar">✕</button></span>`
    : `<span class="adj ${a.subiendo ? 'subiendo' : ''}" title="${esc(a.descripcion ?? 'Subiendo y mirando la imagen…')}"><img src="${a.vista}" alt=""><small>${a.subiendo ? 'Mirando…' : 'Lista'}</small><button type="button" data-quitar-adj="${a.id}" title="Quitar">✕</button></span>`).join('')
  $$('[data-quitar-adj]', cont).forEach((b) => (b.onclick = () => { chat.adjuntos = chat.adjuntos.filter((a) => String(a.id) !== b.dataset.quitarAdj); pintarAdjuntos() }))
}

/**
 * Lo que escribió él, con sus imágenes en galería (se abren grandes ahí mismo) y sus archivos como tarjetas.
 * Las marcas [imagen:url|descripción] y [archivo:url|nombre|palabras] no se muestran.
 */
function textoConImagenes(texto) {
  const imgs = []
  const docs = []
  const limpio = String(texto ?? '')
    .replace(/\[imagen:(\/adjuntos\/[^\]|\s]+)\|([^\]]*)\]/g, (_, url, d) => { imgs.push({ url, d }); return '' })
    .replace(/\[archivo:(\/adjuntos\/[^\]|\s]+)\|([^\]|]*)\|([^\]]*)\]/g, (_, url, nombre, p) => { docs.push({ url, nombre, p }); return '' }).trim()
  return `${limpio ? `<div>${conMenciones(esc(limpio))}</div>` : ''}${imgs.length ? `<div class="m-imgs ${imgs.length === 1 ? 'una' : ''}">${imgs.map((x) => `<button type="button" class="m-img" data-ver-img="${esc(x.url)}" data-desc="${esc(x.d)}" title="Ver grande"><img src="${esc(x.url)}${x.url.startsWith('/adjuntos/') ? '?ancho=480' : ''}" alt="${esc(x.d)}" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''}${docs.length ? `<div class="m-docs">${docs.map((x) => `<a class="m-doc" href="${esc(x.url)}" target="_blank" rel="noopener"><i>${ICONO_ARCHIVO[(x.nombre.split('.').pop() || '').toLowerCase()] ?? '📄'}</i><span><b>${esc(x.nombre)}</b><small>${esc(x.p)} · lo leyó Mastropiero</small></span></a>`).join('')}</div>` : ''}`
}

/** Una imagen del chat, grande, con lo que Mastropiero vio en ella. */
function verImagenChat(url, desc) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><div class="visor-img"><img src="${esc(url)}" alt="${esc(desc)}"></div>${desc && desc !== 'sin descripción' ? `<p class="tenue chico" style="margin-top:10px"><b>Lo que vio Mastropiero:</b> ${esc(desc)}</p>` : ''}<p class="chico"><a href="${esc(url)}" target="_blank" rel="noopener">Abrir el original ↗</a></p>`)
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-ver-img]')
  if (b) { e.preventDefault(); verImagenChat(b.dataset.verImg, b.dataset.desc ?? '') }
})

async function enviarChat() {
  const txt = $('#chat-txt')
  if (chat.adjuntos.some((a) => a.subiendo)) return toast(chat.adjuntos.some((a) => a.subiendo && a.tipo === 'archivo') ? 'Esperá: todavía estoy leyendo el archivo' : 'Esperá: todavía estoy mirando la imagen', 'suave')
  const marcas = chat.adjuntos.map((a) => a.marca).filter(Boolean)
  const texto = [txt.value.trim(), ...marcas].filter(Boolean).join('\n')
  if (!texto || chat.pensando) return
  try {
    if (!chat.actual) {
      const c = await api('/chat', { con: 'mastropiero' })
      chat.actual = c
      chat.conversaciones.unshift(c)
    }
    await api(`/chat/${chat.actual.id}/mensajes`, { texto, hud: window.hudModoActual?.() ?? null })
    txt.value = ''
    chat.borrador = ''
    chat.adjuntos = []
    pintarAdjuntos()
    txt.style.height = 'auto'
    chat.mensajes.push({ id: -1, rol: 'operador', texto })
    chat.pensando = true
    pintarChat()
    seguirTurno()
  } catch (e) { error(e) }
}

/** Mientras el turno corre, se leen los mensajes nuevos: las acciones aparecen a medida que pasan. */
function seguirTurno() {
  clearTimeout(chat.sondeo)
  const id = chat.actual?.id
  const paso = async () => {
    if (!id || chat.actual?.id !== id) return
    try {
      // Solo lo nuevo desde el último mensaje que ya tenemos (antes se traía la charla entera cada 300 ms).
      const ultimo = chat.mensajes.reduce((m, x) => (x.id > m ? x.id : m), 0)
      const r = await api(`/chat/${id}?desde=${ultimo}`)
      const antes = JSON.stringify([chat.mensajes.filter((m) => m.id > 0).length, chat.vivo, chat.pensando])
      if (r.mensajes.length) chat.mensajes = [...chat.mensajes.filter((m) => m.id > 0), ...r.mensajes]
      r.mensajes = chat.mensajes
      chat.pensando = r.pensando
      chat.vivo = r.vivo
      const hilo = $('#hilo')
      // Si el operador subió a leer, no se lo arrastra para abajo.
      chat.pegado = !hilo || hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 80
      if ((vista === 'chat' || vista === 'hoy') && JSON.stringify([r.mensajes.length, r.vivo, r.pensando]) !== antes) pintarChat()
      if (r.pensando) chat.sondeo = setTimeout(paso, 300)
      else { chat.pegado = true; await refrescar(); await traerConversaciones(); if (vista === 'hoy') traerHoy() }
    } catch (e) { error(e) }
  }
  chat.sondeo = setTimeout(paso, 300)
}

async function modalPropuestas() {
  try {
    const ps = await api('/propuestas')
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Propuestas de mejora</h2>
      <p class="tenue">Las registra Mastropiero cuando ve algo para mejorar. No se aplican solas: aceptarlas es marcarlas para construir.</p>
      ${ps.length ? ps.map((p) => `<div class="quantomo ${p.estado === 'abierta' ? 'propuesta' : 'superado'}" style="margin-bottom:6px">
        <div class="q-top"><span class="pill ${p.estado === 'aceptada' ? 'activo' : p.estado === 'abierta' ? 'prueba' : 'banca'}">${p.estado}</span>
          ${p.area ? `<span class="tipo-chip">${esc(p.area)}</span>` : ''}${p.prioridad ? `<span class="tipo-chip">${esc(p.prioridad)}</span>` : ''}<span>#${p.id} · ${new Date(p.creada_en).toLocaleDateString('es-AR')}</span></div>
        <div class="q-texto"><b>${esc(p.titulo)}</b></div><div class="md tenue">${md(p.detalle)}</div>
        ${p.estado === 'abierta' ? `<div class="q-acciones"><button class="btn btn-chico btn-primario" data-prop="${p.id}" data-estado="aceptada" title="Sigue abierta y La Fragua la forja primero esta noche">Mandar a La Fragua</button><button class="btn btn-chico" data-prop="${p.id}" data-estado="hecha" title="Ya se resolvió: queda como forjada">✓ Ya está</button><button class="btn btn-chico" data-prop="${p.id}" data-estado="descartada">Descartar</button></div>` : ''}
      </div>`).join('') : '<p class="tenue">Ninguna todavía. Pedile a Mastropiero que lea sus lineamientos y te proponga mejoras.</p>'}`)
    $$('[data-prop]').forEach((b) => (b.onclick = async () => {
      try { await api(`/propuestas/${b.dataset.prop}`, { estado: b.dataset.estado }); await refrescar(); modalPropuestas() } catch (e) { error(e) }
    }))
  } catch (e) { error(e) }
}

/** Abre el chat con Mastropiero con un mensaje listo para mandar. */
function preguntarAMastropiero(texto) {
  chat.borrador = texto
  chat.actual = chat.conversaciones.find((c) => c.con === 'mastropiero' && c.modo === 'chat') ?? null
  cerrarModal()
  irA('chat')
}

// ↶ deshacer: confirma, vuelve atrás lo que anotó en ese turno y recarga la charla.
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-deshacer]')
  if (!b || !chat.actual) return
  e.preventDefault()
  e.stopPropagation()
  const ids = b.dataset.deshacer.split(',').map(Number)
  const linea = b.previousElementSibling?.textContent ?? 'lo que hizo'
  if (!confirm(`¿Deshacer esto?\n\n${linea}`)) return
  try {
    const r = await api(`/chat/${chat.actual.id}/deshacer`, { ids })
    toast(`Deshecho<small>${esc(r.deshechas.join(' · '))}</small>`, 'suave')
    await abrirConversacion(chat.actual.id)
  } catch (err) { error(err) }
})
