'use strict'
// La paleta (Ctrl/Cmd+K, plan v22): ir a cualquier lado, hacer cualquier cosa y buscar, sin tocar el mouse (el patrón de
// Raycast). Busca en dos tiempos: lo que ya está en la pantalla (acciones, secciones, personas y entidades) al instante,
// y las misiones al servidor. El último renglón siempre le pregunta a Mastropiero. Además: «?» muestra todos los
// atajos y «g» + una letra salta de espacio (g h Hoy, g c Chat, g p Plan…).

const paleta = { abierta: false, items: [], i: 0, q: '', misiones: [], pedido: 0, otra: false, timer: null }
const normP = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Lo que vive en el panel de Hoy (los popovers de tarea y anotar): va a Hoy y espera a que esté armado. */
async function enHoy(f) {
  if (vista !== 'hoy') irA('hoy')
  for (let i = 0; i < 50 && !$('#hud-pop'); i++) await dormir(100)
  f()
}

const ACCIONES_PALETA = [
  { id: 'tarea', titulo: 'Nueva tarea', ico: 'plus', claves: 'anotar tarea pendiente hacer todo', hacer: () => enHoy(() => accionHud('tarea')) },
  { id: 'validar', titulo: 'Para validar', ico: 'inbox', claves: 'validar bandeja aprobar aceptar descartar pendientes ok', sub: () => (E?.paraValidar ? `${E.paraValidar} esperan tu ok` : 'nada esperando'), hacer: () => modalBandeja() },
  { id: 'bloque', titulo: 'Arrancar un bloque de foco', ico: 'timer', claves: 'bloque foco pomodoro concentrar minutos', hacer: () => modalBloque() },
  { id: 'run', titulo: 'Armar una run', ico: 'zap', claves: 'run bandas jornada planificar dia', hacer: () => enHoy(() => modalRun()) },
  { id: 'directo', titulo: () => (directo.sesion ? 'Apagar el Directo' : 'Prender el Directo'), ico: 'circle-dot', claves: 'directo pantalla grabar mirar escuchar vivo', hacer: () => (directo.sesion ? detenerDirecto() : modalDirecto()) },
  { id: 'consejo', titulo: '¿Qué me decís de este momento?', ico: 'lightbulb', claves: 'consejo copiloto como voy que hago ahora', hacer: () => enHoy(() => pedirConsejo()) },
  { id: 'charla', titulo: 'Charla en vivo', ico: 'headphones', claves: 'voz hablar charla vivo microfono escuchar', hacer: () => alternarCharlaEnVivo() },
  { id: 'anotar', titulo: 'Anotar algo (nota, idea, foto)', ico: 'pencil', claves: 'anotar nota idea foto capturar', hacer: () => enHoy(() => accionHud('anotar')) },
  { id: 'cierre', titulo: 'Cerrar el día hablando', ico: 'moon', claves: 'cierre noche terminar diario', hacer: () => enHoy(() => cerrarDiaHablando()) },
  { id: 'persona', titulo: 'Nueva persona', ico: 'user-plus', claves: 'persona contacto agregar gente', hacer: () => cargarScript('42-personas.js').then(() => modalNuevaPersona()) },
  { id: 'dominio', titulo: 'Sumar algo para aprender (Academia)', ico: 'graduation-cap', claves: 'aprender estudiar dominio tutor academia curso', hacer: () => { irA('aprender'); cargarScript('59-aprender.js').then(() => modalSumarDominio()) } },
  { id: 'conviene', titulo: '¿Qué me conviene aprender?', ico: 'lightbulb', claves: 'aprender sugerir conviene metas academia predecir', hacer: () => { irA('aprender'); cargarScript('59-aprender.js').then(() => sugerirDominios()) } },
  { id: 'sueno', titulo: 'Anotar un sueño', ico: 'moon', claves: 'sueño soñe dormir noche', hacer: () => cargarScript('59-suenos.js').then(() => modalSueno()) },
  { id: 'ajustes', titulo: 'Ajustes (rutinas, voz, Directo, tope)', ico: 'settings', claves: 'ajustes configuracion rutinas voz tope horario', hacer: () => enHoy(() => modalAjustesHoy()) },
  { id: 'tema', titulo: 'Cambiar el tema', ico: 'sun-moon', claves: 'tema oscuro claro modo sistema', hacer: () => $('#btn-tema').click() },
  { id: 'estado', titulo: 'Exportar o importar todo', ico: 'arrow-up-down', claves: 'exportar importar respaldo backup estado', hacer: () => modalEstado() },
  { id: 'velocidad', titulo: 'Velocidad del servidor', ico: 'activity', claves: 'velocidad rendimiento lento medir', hacer: () => modalVelocidad() },
  { id: 'atajos', titulo: 'Atajos del teclado', ico: 'keyboard', claves: 'atajos teclado ayuda shortcuts', hacer: () => mostrarAtajos() },
]
/** Otras palabras para encontrar cada sección. */
const SINONIMOS = {
  hoy: 'inicio dia jornada', directo: 'pantalla informes foco', chat: 'conversar hablar mensajes', misiones: 'tareas primarias quests objetivos semana',
  calendario: 'agenda eventos google', linea: 'tiempo historia timeline', mapa: 'lugares', salud: 'cuerpo comida peso entreno kcal habitos',
  personas: 'gente contactos amigos', jugador: 'yo perfil plata finanzas gastos ingresos inventario', suenos: 'soñe dormir', mano: 'cartas afirmaciones pesquisa',
  idiomas: 'chino ingles lenguas', aprender: 'estudiar practicar academia tutor dominios cursos clases', criba: 'pesar pasajes', corpus: 'archivo piezas buscar notas quantomos', cuadernos: 'notebook',
  libreria: 'libros peliculas series obras', entidades: 'proyectos conceptos', taller: 'crear imagen video estudio', radar: 'oportunidades convocatorias',
  cuentas: 'redes publicaciones posts', discovery: 'clientes encargos consultoria', fragua: 'propuestas mejoras', revision: 'feedback lecciones metricas acierto valoraciones', grafo: 'red mapa conceptos comunidades bisagras huecos topologia', grafos: 'crear grafo diccionario analizar texto', grafosalud: 'estado discurso modularidad salud corpus', liga: 'agentes roster',
}

function itemsBase() {
  const vistas = ESPACIOS.flatMap((e) => e.vistas.map(([v, n]) => ({ id: `ir:${v}`, grupo: 'Ir a', titulo: n, sub: e.vistas.length > 1 ? e.nombre : '', ico: e.ico, claves: `${SINONIMOS[v] ?? ''} ${e.nombre}`, hacer: () => irA(v) })))
  const acciones = ACCIONES_PALETA.map((a) => ({ ...a, id: `hacer:${a.id}`, grupo: 'Hacer', titulo: typeof a.titulo === 'function' ? a.titulo() : a.titulo, sub: a.sub?.() ?? '' }))
  return [...acciones, ...vistas]
}

/** Personas, entidades y agentes: el catálogo de las @ (ya está en la pantalla). */
function itemsMencionables() {
  return (typeof MENCIONABLES === 'undefined' ? [] : MENCIONABLES).map((m) => {
    const ent = m.k.startsWith('entidad:') ? Number(m.k.slice(8)) : null
    const abrir = ent != null ? () => cargarScript('50-saber.js').then(() => { filtroEnt.sel = ent; irA('entidades') })
      : m.k.startsWith('agente:') ? () => modalAgente(m.k.slice(7)) : () => irA('jugador')
    return {
      id: `menc:${m.k}`, grupo: m.t === 'persona' ? 'Personas' : 'Entidades', titulo: m.n, sub: m.t, ico: m.t === 'persona' ? 'user' : m.t === 'agente' ? 'cog' : 'shapes',
      claves: (m.a ?? []).join(' '), hacer: abrir,
      otra: { titulo: `Preguntarle a Mastropiero sobre ${m.n}`, hacer: () => preguntarAMastropiero(`¿Qué sabés de @${m.n}?`) },
    }
  })
}

/**
 * Qué tan bien coincide, por comienzo de palabra (así «gente» encuentra Personas por su sinónimo y no «Agentes»):
 * el título que empieza así; todas las palabras al comienzo de palabras del título; un sinónimo; el texto en el medio
 * del título; y por último, palabras en lo demás.
 */
const palabrasDe = (s) => normP(s).split(/[^a-z0-9ñ]+/).filter(Boolean)
const empiezan = (qs, ws) => qs.every((q) => ws.some((w) => w.startsWith(q)))
function puntaje(it, q) {
  const qs = palabrasDe(q)
  if (!qs.length) return 0
  const t = normP(it.titulo)
  const tw = palabrasDe(it.titulo)
  let p = t.startsWith(q) ? 100 : empiezan(qs, tw) ? 80 : empiezan(qs, palabrasDe(it.claves)) ? 60 : t.includes(q) ? 40
    : empiezan(qs, [...tw, ...palabrasDe(it.sub), ...palabrasDe(it.claves)]) ? 25 : 0
  if (!p) return 0
  const rec = recientesPaleta().indexOf(it.id)
  if (rec >= 0) p += 15 - rec
  return p
}

const recientesPaleta = () => { try { return JSON.parse(pref.leer('mastro-paleta-recientes', '[]')) } catch { return [] } }
function anotarReciente(id) {
  if (!id || id.startsWith('extra:')) return
  pref.guardar('mastro-paleta-recientes', JSON.stringify([id, ...recientesPaleta().filter((x) => x !== id)].slice(0, 8)))
}

function calcularItems() {
  const q = normP(paleta.q.trim())
  const base = [...itemsBase(), ...itemsMencionables()]
  if (!q) {
    const porId = new Map(base.map((x) => [x.id, x]))
    const rec = recientesPaleta().map((id) => porId.get(id)).filter(Boolean).map((x) => ({ ...x, grupo: 'Recientes' }))
    const ya = new Set(rec.map((x) => x.id))
    return [...rec, ...base.filter((x) => x.grupo === 'Hacer' && !ya.has(x.id)).slice(0, 8), ...base.filter((x) => x.grupo === 'Ir a' && !ya.has(x.id))]
  }
  const orden = ['Hacer', 'Ir a', 'Personas', 'Entidades', 'Misiones']
  const hallados = base.map((x) => ({ x, p: puntaje(x, q) })).filter((r) => r.p > 0)
    .sort((a, b) => b.p - a.p || orden.indexOf(a.x.grupo) - orden.indexOf(b.x.grupo))
  // Los mejores arriba, sin perder el grupo: el grupo del mejor resultado va primero.
  const grupos = [...new Set(hallados.map((r) => r.x.grupo))]
  const items = grupos.flatMap((g) => hallados.filter((r) => r.x.grupo === g).slice(0, g === 'Ir a' || g === 'Hacer' ? 6 : 5).map((r) => r.x))
  const misiones = paleta.misiones.map((m) => ({
    id: `mision:${m.id}`, grupo: 'Misiones', titulo: m.titulo, sub: [m.nivel, m.estado].filter(Boolean).join(' · '), ico: 'swords',
    hacer: () => cargarScript('40-personajes.js').then(() => modalMision(m, () => { if (vista === 'misiones') VISTAS.misiones.refrescar() })),
  }))
  const texto = paleta.q.trim()
  return [
    ...items, ...misiones,
    { id: 'extra:corpus', grupo: 'Más', titulo: `Buscar «${texto}» en el corpus`, ico: 'database', hacer: () => { window.buscarEnCorpus = texto; irA('corpus') } },
    { id: 'extra:preguntar', grupo: 'Más', titulo: `Preguntarle a Mastropiero: «${texto}»`, ico: 'message-circle', hacer: () => preguntarAMastropiero(texto) },
  ]
}

function pintarPaleta() {
  const lista = $('#paleta-lista')
  if (!lista) return
  paleta.items = calcularItems()
  paleta.i = Math.min(paleta.i, Math.max(0, paleta.items.length - 1))
  let grupo = ''
  lista.innerHTML = paleta.items.map((it, n) => {
    const cab = it.grupo !== grupo ? `<li class="pa-grupo" role="presentation">${esc((grupo = it.grupo))}</li>` : ''
    const sel = n === paleta.i
    const titulo = sel && paleta.otra && it.otra ? it.otra.titulo : it.titulo
    return `${cab}<li class="pa-item${sel ? ' sel' : ''}" id="pa-${n}" role="option" aria-selected="${sel}" data-n="${n}">${ico(it.ico || 'chevron-right')}<span class="pa-t">${esc(titulo)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}${it.otra ? `<kbd title="Otra acción">Tab</kbd>` : ''}</li>`
  }).join('')
  $('#paleta-q').setAttribute('aria-activedescendant', `pa-${paleta.i}`)
  $(`#pa-${paleta.i}`)?.scrollIntoView({ block: 'nearest' })
}

/** Las misiones van al servidor (un poco después de que deja de escribir); lo demás ya está acá. */
function buscarEnServidor() {
  clearTimeout(paleta.timer)
  const q = paleta.q.trim()
  if (q.length < 2) { paleta.misiones = []; return }
  const pedido = ++paleta.pedido
  paleta.timer = setTimeout(async () => {
    try {
      const r = await api(`/paleta?q=${encodeURIComponent(q)}`)
      if (pedido !== paleta.pedido || !paleta.abierta) return
      paleta.misiones = r.misiones ?? []
      pintarPaleta()
    } catch { /* sin servidor, lo de la pantalla alcanza */ }
  }, 140)
}

function abrirPaleta(q = '') {
  if (paleta.abierta) return void $('#paleta-q').select()
  paleta.abierta = true
  paleta.q = q
  paleta.i = 0
  paleta.otra = false
  paleta.misiones = []
  paleta.antes = document.activeElement
  if (typeof traerMencionables === 'function') traerMencionables().then(() => paleta.abierta && pintarPaleta())
  const el = document.createElement('div')
  el.className = 'paleta-velo'
  el.id = 'paleta'
  el.innerHTML = `<div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar o hacer">
    <div class="paleta-q">${ico('search')}<input id="paleta-q" role="combobox" aria-expanded="true" aria-controls="paleta-lista" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Buscar o hacer… (una sección, una persona, una acción)" data-sin-menciones value="${esc(q)}"><kbd>Esc</kbd></div>
    <ul class="paleta-lista" id="paleta-lista" role="listbox" aria-label="Resultados"></ul>
    <div class="paleta-pie"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Tab</kbd> otra acción</span><span><kbd>?</kbd> atajos</span></div>
  </div>`
  document.body.append(el)
  el.addEventListener('mousedown', (e) => { if (e.target === el) cerrarPaleta() })
  const input = $('#paleta-q')
  input.oninput = () => { paleta.q = input.value; paleta.i = 0; paleta.otra = false; buscarEnServidor(); pintarPaleta() }
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = paleta.items.length
      paleta.i = (paleta.i + (e.key === 'ArrowDown' ? 1 : -1) + n) % Math.max(1, n)
      paleta.otra = false
      pintarPaleta()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (paleta.items[paleta.i]?.otra) { paleta.otra = !paleta.otra; pintarPaleta() }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ejecutarPaleta(paleta.i)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cerrarPaleta()
    }
  }
  $('#paleta-lista').addEventListener('click', (e) => { const li = e.target.closest('[data-n]'); if (li) ejecutarPaleta(Number(li.dataset.n)) })
  $('#paleta-lista').addEventListener('mousemove', (e) => {
    const li = e.target.closest('[data-n]')
    if (li && Number(li.dataset.n) !== paleta.i) { paleta.i = Number(li.dataset.n); paleta.otra = false; pintarPaleta() }
  })
  pintarPaleta()
  input.focus()
  input.select()
}

function cerrarPaleta(devolverFoco = true) {
  if (!paleta.abierta) return
  paleta.abierta = false
  clearTimeout(paleta.timer)
  $('#paleta')?.remove()
  if (devolverFoco) paleta.antes?.focus?.()
}

function ejecutarPaleta(n) {
  const it = paleta.items[n]
  if (!it) return
  const accion = paleta.otra && it.otra ? it.otra.hacer : it.hacer
  anotarReciente(it.id)
  cerrarPaleta(false)
  try { Promise.resolve(accion()).catch(error) } catch (e) { error(e) }
}

/** «?»: todos los atajos en un lugar (antes vivían solo en los title=). */
function mostrarAtajos() {
  const grupo = (titulo, filas) => `<h3 class="sub">${titulo}</h3><table class="tabla atajos"><tbody>${filas.map(([k, d]) => `<tr><td>${k.split(' ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>`
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar aria-label="Cerrar">✕</button><h2>Atajos del teclado</h2>
    ${grupo('En todos lados', [
      ['Ctrl K', 'Buscar o hacer cualquier cosa'], ['?', 'Esta hoja'], ['Esc', 'Cerrar lo que esté abierto'],
      [`${teclaVoz()} (mantener)`, 'Hablarle a Mastropiero desde cualquier pantalla'],
      ...ESPACIOS.map((e) => [`g ${e.tecla}`, `Ir a ${e.nombre}`]),
    ])}
    ${grupo('Hoy', [['Alt 1…6', 'Cambiar el panel (Run, Quests, Agenda, Cuerpo, Stats, Oráculo)'], ['Alt N', 'Nueva tarea'], ['Alt R', 'Armar una run'], ['Alt A', 'Anotar'], ['Alt F', 'Pantalla de foco'], ['Enter', 'Mandar (Shift Enter: otra línea)']])}
    ${grupo('La Mano', [['1…9 0 q w', 'Pesar la carta (1 a 12)'], ['x', 'Descartar'], ['c', 'Choca con lo que creías'], ['a', 'Predecir antes de jugar'], ['j k l', 'Conecta seguro · puede · seguro que no'], ['Espacio →', 'Pasar'], ['←', 'Volver'], ['z', 'Deshacer'], ['r', 'Robar otra mano'], ['p', 'Escribir el por qué']])}
    ${grupo('Criba', [['1…9 0 q w', 'Pesar el pasaje (1 a 12)'], ['x', 'Sin peso'], ['Espacio', 'Saltear'], ['z', 'Deshacer']])}`)
}

const escribiendo = (el) => /INPUT|TEXTAREA|SELECT/.test(el?.tagName ?? '') || el?.isContentEditable

let esperandoG = 0
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+K: en cualquier lado, aunque esté escribiendo.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    return paleta.abierta ? cerrarPaleta() : abrirPaleta()
  }
  if (paleta.abierta || e.ctrlKey || e.metaKey || e.altKey || escribiendo(e.target) || !$('#velo').hidden) return
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); return mostrarAtajos() }
  // «g» y después una letra: el espacio (como en Gmail, GitHub o Linear).
  if (esperandoG && Date.now() - esperandoG < 1500) {
    esperandoG = 0
    const esp = ESPACIOS.find((x) => x.tecla === e.key.toLowerCase())
    if (esp) { e.preventDefault(); e.stopImmediatePropagation(); irAEspacio(esp.id) }
    return
  }
  if (e.key === 'g' && vista !== 'mano' && vista !== 'criba') esperandoG = Date.now()
}, true)

/**
 * El paso siguiente de un estado vacío (o de cualquier botón suelto), sin enganchar nada en cada vista:
 * data-paso-ir="corpus" va a esa sección, data-paso-hacer="sueno" corre esa acción de la paleta, data-paso-preguntar="…" se lo deja
 * escrito a Mastropiero en el chat.
 */
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-paso-ir], [data-paso-hacer], [data-paso-preguntar]')
  if (!b || b.closest('#paleta')) return
  e.preventDefault()
  if (b.dataset.pasoIr) { cerrarModal(); return irA(b.dataset.pasoIr) }
  if (b.dataset.pasoHacer) return ACCIONES_PALETA.find((a) => a.id === b.dataset.pasoHacer)?.hacer()
  preguntarAMastropiero(b.dataset.pasoPreguntar)
})
