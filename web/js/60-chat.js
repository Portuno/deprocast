'use strict'
// Chat

const chat = { conversaciones: [], actual: null, mensajes: [], pensando: false, sondeo: null, borrador: '' }

/** Markdown mínimo y seguro: se escapa todo primero; después se marcan bloques, tablas, listas y referencias. */
function md(texto) {
  const bloques = []
  // Citas al corpus: [#410] o [#410, #388] → notas al pie numeradas en el orden en que aparecen.
  const citas = new Map()
  let t = esc(texto ?? '')
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, c) => `\u0000${bloques.push(c) - 1}\u0000`)
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
    } else if (/^\s*[-*] /.test(l)) {
      const items = []
      while (i < lineas.length && /^\s*[-*] /.test(lineas[i])) items.push(lineas[i++].replace(/^\s*[-*] /, ''))
      i--
      out.push(`<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`)
    } else if (/^\s*\d+[.)] /.test(l)) {
      const items = []
      while (i < lineas.length && /^\s*\d+[.)] /.test(lineas[i])) items.push(lineas[i++].replace(/^\s*\d+[.)] /, ''))
      i--
      out.push(`<ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol>`)
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
    <form id="chat-form">
      <label class="btn btn-icono" id="chat-audio" title="Subir un audio: se transcribe y entra como lo que contás" hidden>🎙<input type="file" accept="audio/*" hidden id="chat-audio-in"></label>
      <textarea id="chat-txt" rows="1" placeholder="Escribile a Mastropiero…"></textarea><button class="btn btn-primario" id="chat-enviar">Enviar</button>
    </form>
    <small>Enter envía · Shift+Enter, nueva línea. Lo destructivo siempre te lo pregunta antes.</small>
  </div>`

function engancharCompositor() {
  const txt = $('#chat-txt')
  txt.value = chat.borrador
  const ajustar = () => { txt.style.height = 'auto'; txt.style.height = `${Math.min(txt.scrollHeight, 200)}px` }
  txt.oninput = () => { chat.borrador = txt.value; ajustar() }
  txt.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarChat() } }
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); enviarChat() }
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
  $('#principal').innerHTML = `<div class="chat"><aside class="chat-lado" id="chat-lado"></aside><section class="chat-main">${hiloHTMLBase()}</section></div>`
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
    chat.pensando = r.pensando
    pintarLado()
    pintarChat()
    if (chat.pensando) seguirTurno()
  } catch (e) { error(e) }
}

function pintarChat() {
  const c = chat.actual
  const q = quienEs(c ?? { con: 'mastropiero' })
  $('#chat-cab').innerHTML = `<span class="avatar" style="--c:${q.color}">${q.glifo}</span><div><b>${esc(q.nombre)}</b><small>${esc(q.sub)}</small></div>
    <div class="fila">${c ? `<button class="btn btn-chico" id="chat-archivar" title="Sacar de la lista">Archivar</button>` : ''}</div>`
  const ar = $('#chat-archivar')
  if (ar) ar.onclick = async () => { await api(`/chat/${c.id}/archivar`, {}); chat.actual = null; await traerConversaciones(); pintarChat() }
  $('#chat-txt').placeholder = c && c.con !== 'mastropiero' ? `Escribile a ${q.nombre}…` : 'Escribile a Mastropiero…'
  const col = $('#hilo-col')
  $('#chat-audio').hidden = c?.modo !== 'diario'
  if (c?.modo === 'diario') $('#chat-txt').placeholder = 'Contá lo que quieras…'
  if (!c || !chat.mensajes.length) {
    const sug = c?.modo === 'diario' || c?.modo === 'hoy' ? [] : c && c.con !== 'mastropiero' ? SUGERENCIAS_AGENTE : SUGERENCIAS_MASTRO
    const texto = c?.modo === 'diario'
      ? 'Un espacio para contar tus cosas, escrito o en audio (🎙). Mastropiero escucha y pregunta poco; lo que contás queda como tu voz en el corpus y alimenta lo que sabe de vos.'
      : c?.modo === 'hoy'
        ? 'Acá llega tu jornada a la mañana y el cierre a la noche. Contale cómo va el día o pedile que lo reorganice.'
        : c && c.con !== 'mastropiero'
          ? 'Un agente de la liga. Contesta desde su oficio y puede leer el corpus según su nivel; no actúa sobre la plataforma.'
          : 'Mastropiero ve y opera todo: tu día, tu memoria, la liga y el corpus. Pedile lo que quieras en lenguaje natural; lo destructivo te lo confirma antes.'
    col.innerHTML = `<div class="chat-bienvenida"><div class="avatar" style="--c:${q.color}">${q.glifo}</div>
      <h2>${esc(q.nombre)}</h2><p>${texto}</p>
      ${sug.length ? `<div class="sugerencias">${sug.map((s) => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>`
    $$('[data-sug]', col).forEach((b) => (b.onclick = () => { $('#chat-txt').value = b.dataset.sug; enviarChat() }))
  } else col.innerHTML = hiloHTML(chat.mensajes, q, chat.pensando ? chat.vivo ?? {} : null)
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
    if (m.rol === 'operador' || !turnos.length) turnos.push({ yo: m.rol === 'operador' ? m : null, herr: [], textos: [], errores: [], tokens: 0, modelo: null })
    const t = turnos.at(-1)
    if (m.rol === 'herramienta') t.herr.push(m)
    else if (m.rol === 'error') t.errores.push(m)
    else if (m.rol === 'asistente') {
      if (m.texto) t.textos.push(m.texto)
      t.tokens += m.tokens ?? 0
      t.modelo = m.modelo ?? t.modelo
    }
  }
  return turnos.map((t, i) => turnoHTML(t, q, i === turnos.length - 1 ? vivo : null)).join('')
}

function turnoHTML(t, q, vivo) {
  let h = t.yo ? `<div class="m m-yo"><div>${conMenciones(esc(t.yo.texto))}</div></div>` : ''
  const actividad = t.herr.length ? `<details class="actividad"><summary>${esc(resumenActividad(t.herr))}</summary><ul>${t.herr.map((m) => {
    let cuerpo = m.texto ?? ''
    try { cuerpo = JSON.stringify(JSON.parse(cuerpo), null, 2) } catch {}
    const falla = /^\{"error"/.test(m.texto ?? '') || /falló|no existe/.test(m.resumen ?? '')
    return `<li class="${falla ? 'falla' : ''}"><details><summary>${esc(m.resumen ?? m.herramienta)}</summary><pre>${esc(cuerpo.slice(0, 6000))}</pre></details></li>`
  }).join('')}</ul></details>` : ''
  const borrador = vivo?.borrador ?? ''
  const texto = [...t.textos, borrador].filter(Boolean).join('\n\n')
  const haciendo = vivo && !borrador
    ? `<div class="pensando"><span><i></i><i></i><i></i></span>${esc(vivo.herramienta ? (VIVO[vivo.herramienta]?.(vivo.argumentos) ?? 'trabajando') : t.herr.length ? 'pensando qué decirte' : 'pensando')}…</div>` : ''
  const meta = !vivo && t.modelo ? `<div class="m-meta">${esc(t.modelo)}${t.tokens ? ` · ${t.tokens.toLocaleString('es-AR')} tokens` : ''}</div>` : ''
  if (actividad || texto || haciendo) {
    h += `<div class="m m-el"><span class="avatar" style="--c:${q.color}">${q.glifo}</span><div>${actividad}
      ${texto ? `<div class="md">${md(texto)}${borrador ? '<span class="cursor"></span>' : ''}</div>` : ''}${haciendo}${meta}</div></div>`
  }
  return h + t.errores.map((m) => `<div class="m-error">${esc(m.texto)}</div>`).join('')
}

async function enviarChat() {
  const txt = $('#chat-txt')
  const texto = txt.value.trim()
  if (!texto || chat.pensando) return
  try {
    if (!chat.actual) {
      const c = await api('/chat', { con: 'mastropiero' })
      chat.actual = c
      chat.conversaciones.unshift(c)
    }
    await api(`/chat/${chat.actual.id}/mensajes`, { texto })
    txt.value = ''
    chat.borrador = ''
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
      const r = await api(`/chat/${id}`)
      const antes = JSON.stringify([chat.mensajes.filter((m) => m.id > 0).length, chat.vivo, chat.pensando])
      chat.mensajes = r.mensajes
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
        ${p.estado === 'abierta' ? `<div class="q-acciones"><button class="btn btn-chico btn-primario" data-prop="${p.id}" data-estado="aceptada">Aceptar</button><button class="btn btn-chico" data-prop="${p.id}" data-estado="descartada">Descartar</button></div>` : ''}
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
