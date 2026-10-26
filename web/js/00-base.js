'use strict'
// Mastropiero · base: utilidades, estado compartido, modales, carta, HUD y crónica.

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
/** Lo que se sondea mientras algo se hace: con la pestaña oculta espera a que vuelvas (no gasta nada mientras tanto). */
function cuandoSeVea(f) {
  if (!document.hidden) return f()
  document.addEventListener('visibilitychange', function alVolver() {
    if (document.hidden) return
    document.removeEventListener('visibilitychange', alVolver)
    f()
  })
}

async function api(ruta, cuerpo) {
  // Lo que pide una sección al abrirse es de ese montaje: si él ya se fue (o la volvió a abrir) cuando llega, no se
  // entrega (la promesa queda sin resolver). Así la sección vieja no sigue dibujando sobre la nueva ni tira errores
  // buscando sus botones en una pantalla que ya no es suya.
  const deMontaje = cuerpo === undefined && montando && Date.now() - montando.desde < 4000 && !RUTAS_COMPARTIDAS.test(ruta) ? montando.n : null
  const caduco = () => deMontaje != null && montando?.n !== deMontaje
  const vigente = (x) => (caduco() ? new Promise(() => {}) : x)
  if (cuerpo === undefined) {
    // Lo que se trajo de antemano (al pasar por el menú o mirando la sección vecina): se usa una vez y si está fresco.
    const p = precargas.get(ruta)
    precargas.delete(ruta)
    if (p && Date.now() - p.en < FRESCO_MS) { try { return vigente(await p.promesa) } catch { /* cae al pedido de siempre */ } }
    aprenderRuta(ruta)
  } else if (!/^\/(uso|zona)\b/.test(ruta)) precargas.clear() // lo que él cambia invalida lo traído antes (lo que se anota de uso, no)
  const r = await fetch('/api' + ruta, cuerpo === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  })
  const j = await r.json()
  if (caduco()) return vigente(j)
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
  return j
}
/** Lo que piden las piezas que viven en todas las pantallas (el estado, el chat al costado, el Directo, 📥, la paleta). */
const RUTAS_COMPARTIDAS = /^\/(estado|meta|hoy\/hud|menciones|uso|velocidad|chat|directo|bandeja|sombra|paleta|preguntas|zona)\b/

// ─── traer de antemano (que cada sección abra al instante) ──────────────
// Cada sección pide lo suyo al abrirse; esas rutas se aprenden (las de los primeros segundos de cada vista) y la próxima
// vez se piden antes de entrar: al pasar el mouse o tocar el menú, y para las pestañas vecinas de la sección abierta.

const FRESCO_MS = 30_000
const precargas = new Map()
const RUTAS_DE_TODOS = /^\/(estado|meta|hoy\/hud|menciones|uso|velocidad)\b/
let montando = null
let rutasDeVista = (() => { try { return JSON.parse(localStorage.getItem('mastro-rutas') || '{}') } catch { return {} } })()

/** Las rutas que pide una vista en sus primeros segundos quedan anotadas para traerlas antes la próxima vez. */
function aprenderRuta(ruta) {
  if (!montando || Date.now() - montando.desde > 2500 || RUTAS_DE_TODOS.test(ruta)) return
  const xs = (rutasDeVista[montando.vista] ?? []).filter((x) => x !== ruta)
  rutasDeVista[montando.vista] = [ruta, ...xs].slice(0, 6)
  try { localStorage.setItem('mastro-rutas', JSON.stringify(rutasDeVista)) } catch { /* sin almacenamiento: se aprende de nuevo */ }
}

function precargarDatos(ruta) {
  const ya = precargas.get(ruta)
  if (ya && Date.now() - ya.en < FRESCO_MS) return
  const promesa = fetch('/api' + ruta).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`); return j })
  promesa.catch(() => precargas.delete(ruta))
  precargas.set(ruta, { en: Date.now(), promesa })
}

let META = null
let E = null
let R = null
let vista = 'liga'
let auto = false
let tickEnCurso = false
let cronicaVista = 0
const nuevas = new Set()
const filtro = { clase: null, estado: null }
const forja = { clase: null, reparto: {}, motor: '', instrucciones: '', proyectoId: '', celda: null }
const mision = { clase: 'buscador', proyectoId: '' }

/** Las vistas de la maquinaria de la liga: van agrupadas y plegadas en el menú, con su HUD propio. */
const VISTAS_MAQUINA = new Set(['liga', 'forja', 'encargos', 'matriz', 'cementerio'])
const claseDe = (id) => META.clases.find((c) => c.id === id)
const colorDe = (id) => `var(--${id})`
const ESTADOS_CORPUS = ['crudo', 'extraido', 'clasificado', 'disponible']
const OFICIOS = ['Input·Cuerpo', 'Input·Mente', 'Input·Alma', 'Proc·Cuerpo', 'Proc·Mente', 'Proc·Alma', 'Output·Cuerpo', 'Output·Mente', 'Output·Alma']
const ICONO = { purga: '✝', asigna: '→', recluta: '+', vacante: '?', corre: '✓', falla: '✗', nivel: '▲', bautismo: '★', promovido: '◆', banca: '⇣', retirado: '✝', publica: '↻', tope: '⏸', memoria: '≡' }

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

/** Un ícono del sprite (web/iconos.svg, Lucide). Toma el color y el tamaño del texto que lo rodea. */
const ico = (nombre, clase = '') => `<svg class="ico ${clase}" aria-hidden="true"><use href="#i-${nombre}"></use></svg>`

// Toda lista de pestañas (role=tablist) se recorre con las flechas, Inicio y Fin, como en cualquier app de escritorio.
document.addEventListener('keydown', (e) => {
  const tab = e.target.closest?.('[role=tab]')
  const lista = tab?.closest('[role=tablist]')
  if (!lista || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const ts = [...lista.querySelectorAll('[role=tab]')]
  const i = ts.indexOf(tab)
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? ts.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ts.length) % ts.length
  e.preventDefault()
  ts[n].focus()
  ts[n].click()
})

/**
 * Las barras de pestañas de cada vista (.tabs, .pestanas, .cu-modos, .dia-tabs, .rd-tabs) pasan a ser pestañas de
 * verdad: role=tablist/tab y aria-selected según la clase on/activo que ya usa cada una. Así todas se recorren con las
 * flechas y se leen bien, sin tocar cada vista. Se mantiene sola cuando la vista se redibuja o cambia de pestaña.
 */
const LISTAS_PESTANAS = '.tabs, .pestanas, .cu-modos, .dia-tabs, .rd-tabs'
function marcarPestanas(raiz) {
  const listas = raiz.matches?.(LISTAS_PESTANAS) ? [raiz] : [...(raiz.querySelectorAll?.(LISTAS_PESTANAS) ?? [])]
  for (const l of listas) {
    l.setAttribute('role', 'tablist')
    const bs = [...l.querySelectorAll(':scope > button')]
    const elegida = bs.find((b) => b.classList.contains('on') || b.classList.contains('activo')) ?? bs[0]
    for (const b of bs) {
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', b === elegida && (b.classList.contains('on') || b.classList.contains('activo')))
      b.tabIndex = b === elegida ? 0 : -1
    }
  }
}
new MutationObserver((ms) => {
  for (const m of ms) {
    if (m.type === 'attributes') { const l = m.target.parentElement?.closest(LISTAS_PESTANAS); if (l) marcarPestanas(l) }
    else {
      const l = m.target.closest?.(LISTAS_PESTANAS) // la barra se llenó por dentro
      if (l) marcarPestanas(l)
      for (const n of m.addedNodes) if (n.nodeType === 1) marcarPestanas(n)
    }
  }
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

// ─── toasts y modal ─────────────────────────────────────────────────────

/**
 * Un aviso abajo a la derecha. Con `accion` lleva un botón (Deshacer, Ver…) y dura más, para que dé tiempo a tocarlo.
 * Los errores se anuncian a los lectores de pantalla en el acto; lo demás, cuando terminen de leer.
 */
function toast(html, tipo = '', o = {}) {
  const t = document.createElement('div')
  t.className = `toast ${tipo}`
  t.setAttribute('role', tipo === 'error' ? 'alert' : 'status')
  t.innerHTML = `<div class="toast-txt">${html}</div>`
  if (o.accion) {
    const b = document.createElement('button')
    b.className = 'toast-accion'
    b.textContent = o.accion.texto
    b.onclick = () => { t.remove(); o.accion.hacer() }
    t.append(b)
  }
  const ms = o.ms ?? (o.accion ? 8000 : 3700)
  t.style.animationDuration = `${(ms - 100) / 1000}s` // se desvanece al final de su tiempo, no antes
  $('#toasts').append(t)
  setTimeout(() => t.remove(), ms)
}
const error = (e) => toast(esc(e.message ?? e), 'error')

// ─── modal ──────────────────────────────────────────────────────────────

/** Lo que se puede enfocar adentro de algo (para que Tab no se escape del modal). */
const enfocables = (el) => [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null)
/** Tab y Shift+Tab dan la vuelta adentro de `el`. */
function atraparFoco(e, el) {
  if (e.key !== 'Tab') return
  const xs = enfocables(el)
  if (!xs.length) return
  const [primero, ultimo] = [xs[0], xs[xs.length - 1]]
  if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
}

let antesDelModal = null
let alCerrarModal = null
/**
 * Abre el modal. `lado: true` lo abre como panel lateral (las fichas: persona, pieza, agente), así lo de atrás se sigue
 * viendo. `alCerrar`: lo que hay que hacer cuando se cierra (por ejemplo, mandar lo que quedó esperando su «Deshacer»).
 * Al cerrarlo, el foco vuelve a lo que lo abrió.
 */
function abrirModal(html, o = {}) {
  if ($('#velo').hidden) antesDelModal = document.activeElement
  else if (alCerrarModal && alCerrarModal !== o.alCerrar) { const f = alCerrarModal; alCerrarModal = null; f() }
  alCerrarModal = o.alCerrar ?? null
  document.activeElement?.blur?.()
  const m = $('#modal')
  m.className = `modal${o.lado ? ' modal-lado' : ''}${o.hoja ? ' modal-hoja' : ''}` // cada modal arranca con su tamaño normal (el que necesite más, se agranda)
  $('#velo').classList.toggle('velo-lado', !!o.lado)
  $('#velo').classList.toggle('velo-hoja', !!o.hoja) // `hoja`: sube desde abajo (el celular)
  m.innerHTML = html
  m.setAttribute('role', 'dialog')
  m.setAttribute('aria-modal', 'true')
  const titulo = m.querySelector('h2')
  if (titulo) { titulo.id = 'modal-titulo'; m.setAttribute('aria-labelledby', 'modal-titulo') } else m.removeAttribute('aria-labelledby')
  m.querySelectorAll('[data-cerrar]:not([aria-label])').forEach((b) => b.setAttribute('aria-label', 'Cerrar'))
  $('#velo').hidden = false
  // El foco va al primer campo: si se queda en el botón que abrió el modal, lo que tipeás se pierde (y la barra espaciadora lo reabre).
  setTimeout(() => ($('#modal [autofocus], #modal input:not([type=hidden]):not([type=checkbox]):not([type=range]):not([data-sin-foco]), #modal textarea:not([data-sin-foco])') ?? m.querySelector('[data-cerrar]'))?.focus(), 0)
}
function cerrarModal() {
  if ($('#velo').hidden) return
  $('#velo').hidden = true
  $('#modal').innerHTML = ''
  const f = alCerrarModal
  alCerrarModal = null
  f?.()
  const antes = antesDelModal
  antesDelModal = null
  if (antes?.isConnected) antes.focus?.()
}
$('#velo').addEventListener('click', (e) => { if (e.target.id === 'velo' || e.target.closest('[data-cerrar]')) cerrarModal() })
$('#velo').addEventListener('keydown', (e) => atraparFoco(e, $('#modal')))

// ─── confirmar y preguntar (en vez de los diálogos del navegador) ───────

/**
 * Un diálogo chico encima de todo (también encima de un modal abierto). Devuelve una promesa: true/false para confirmar,
 * el texto o null para preguntar. Esc o tocar afuera es «no».
 */
function dialogo(html, alListo, foco = '[data-si]') {
  return new Promise((resolver) => {
    const antes = document.activeElement
    const velo = document.createElement('div')
    velo.className = 'dialogo-velo'
    velo.innerHTML = `<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dialogo-t">${html}</div>`
    document.body.append(velo)
    const caja = velo.firstElementChild
    const terminar = (valor) => {
      velo.remove()
      if (antes?.isConnected) antes.focus?.()
      resolver(valor)
    }
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) terminar(alListo(false)) })
    caja.addEventListener('keydown', (e) => {
      e.stopPropagation() // que Esc no cierre también el modal de abajo, ni dispare atajos
      if (e.key === 'Escape') { e.preventDefault(); terminar(alListo(false)) }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); terminar(alListo(true)) }
      else atraparFoco(e, caja)
    })
    caja.querySelector('[data-si]').onclick = () => terminar(alListo(true))
    caja.querySelector('[data-no]').onclick = () => terminar(alListo(false))
    setTimeout(() => {
      const campo = caja.querySelector('input, textarea')
      if (!campo) return caja.querySelector(foco)?.focus()
      campo.focus()
      // Como el prompt de siempre: lo que ya estaba queda elegido (escribir lo reemplaza); en un texto largo, el cursor al final.
      if (campo.tagName === 'INPUT' && campo.type !== 'date' && campo.type !== 'number') campo.select()
      else if (campo.tagName === 'TEXTAREA') campo.setSelectionRange(campo.value.length, campo.value.length)
    }, 0)
  })
}

/**
 * ¿Seguro? `si` es el verbo de lo que va a pasar («Borrar», «Apagar y escribir el informe»); `peligro` lo pinta de rojo
 * y deja el foco en Cancelar, para que un Enter apurado no borre nada.
 */
function confirmar(pregunta, o = {}) {
  const { si = 'Sí', no = 'Cancelar', peligro = false, detalle = '' } = o
  return dialogo(`<p class="dialogo-t" id="dialogo-t">${esc(pregunta)}</p>${detalle ? `<p class="tenue">${esc(detalle)}</p>` : ''}
    <div class="dialogo-acc"><button class="btn" data-no>${esc(no)}</button><button class="btn ${peligro ? 'btn-peligro-lleno' : 'btn-primario'}" data-si>${esc(si)}</button></div>`,
  (ok) => ok, peligro ? '[data-no]' : '[data-si]')
}

/** Pide un texto. Devuelve lo escrito (puede ser '') o null si canceló. `largo` usa un cuadro de varias líneas. */
function preguntar(pregunta, valor = '', o = {}) {
  const { ok = 'Listo', placeholder = '', largo = false, tipo = 'text' } = o
  return dialogo(`<label class="dialogo-t" id="dialogo-t" for="dialogo-campo">${esc(pregunta)}</label>
    ${largo ? `<textarea class="campo-suelto" id="dialogo-campo" rows="4" placeholder="${esc(placeholder)}">${esc(valor ?? '')}</textarea>` : `<input class="campo-suelto" id="dialogo-campo" type="${tipo}" placeholder="${esc(placeholder)}" value="${esc(valor ?? '')}" data-sin-menciones>`}
    <div class="dialogo-acc"><button class="btn" data-no>Cancelar</button><button class="btn btn-primario" data-si>${esc(ok)}</button></div>`,
  (si) => (si ? $('#dialogo-campo')?.value ?? '' : null)) // se lee antes de que el diálogo se borre
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarModal()
  const activo = document.activeElement
  const escribiendo = /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(activo?.tagName ?? '') || activo?.isContentEditable
  // En la Criba y en La Mano el espacio pasa a la siguiente carta: ahí no corre la liga (gastaría tokens sin querer).
  if (e.code === 'Space' && !escribiendo && $('#velo').hidden && vista !== 'criba' && vista !== 'mano') { e.preventDefault(); hacerTick() }
})

// ─── carta ──────────────────────────────────────────────────────────────

function pips(base, total, max = 6) {
  let s = ''
  for (let i = 0; i < max; i++) s += `<i class="${i < base ? 'b' : i < total ? 'x' : ''}"></i>`
  return `<span class="pips">${s}</span>`
}

function cartaHTML(f) {
  const c = claseDe(f.clase)
  const pct = f.xpTecho ? Math.max(0, Math.min(100, ((f.xp - f.xpPiso) / (f.xpTecho - f.xpPiso)) * 100)) : 100
  const nombre = f.nombre
    ? `<div class="nombre">${esc(f.nombre)}</div>`
    : f.puedeBautizar
      ? `<div class="nombre bautismo">★ bautismo pendiente</div>`
      : `<div class="nombre sin">sin nombre · se gana en nv ${R.NIVEL_BAUTISMO}</div>`
  const stats = META.atributos.map((a) => `<li>${a.sigla}${pips(c.base[a.id], f.atributos[a.id])}</li>`).join('')
  const cls = ['carta', `nv-${f.nivel}`, f.estado, nuevas.has(f.id) ? 'nueva' : ''].join(' ')
  return `<article class="${cls}" style="--c:${colorDe(f.clase)}" data-agente="${esc(f.id)}">
    <div class="tope"><span class="glifo">${c.glifo}</span><span>${esc(f.id)}</span><span class="nv" title="Nivel">${f.nivel}</span></div>
    <div class="arte">${f.estado === 'prueba' ? `<em class="cinta">PRUEBA ${f.exitos}/${R.PRUEBA_EXITOS}</em>` : ''}<span>${c.glifo}</span>${f.celdaInfo ? `<em class="celda72">⬡ ${f.celdaInfo.etiqueta}</em>` : ''}</div>
    ${nombre}
    <div class="clase">${esc(c.nombre)}${f.especializacion ? ` <em>· ${esc(f.especializacion)}</em>` : f.proyectoId ? ` <em>· ${esc(f.proyectoId)}</em>` : ''}</div>
    <div class="xp"><div style="width:${pct}%"></div></div>
    <div class="xp-txt"><span>${f.xp} XP</span><span>${f.xpTecho ? `→ ${f.xpTecho}` : 'MÁX'}</span></div>
    ${f.padre ? `<div class="linaje" title="${esc(f.mutacion ?? '')}">🧬 hijo de ${esc(f.padre)}${f.mutacion ? `: ${esc(f.mutacion)}` : ''}</div>` : ''}
    <ul class="stats">${stats}</ul>
    <footer><span class="pill ${f.estado}">${f.estado}</span><span>✓${f.exitos} ✗${f.fallos}</span><span class="motor" title="${esc(f.motor)}">${esc(f.motor)}</span></footer>
  </article>`
}

// ─── HUD y crónica ──────────────────────────────────────────────────────

function renderHud() {
  const n = E.paraValidar ? (E.paraValidar > 99 ? '99+' : String(E.paraValidar)) : ''
  for (const el of [$('#n-validar'), $('#n-validar-abajo')]) if (el) el.textContent = n
  const r = E.roster
  const cuenta = (e) => r.filter((f) => f.estado === e).length
  const t = Object.fromEntries(E.liga.tareas.map((x) => [x.estado, x.n]))
  const tokens = E.uso.reduce((s, u) => s + u.tokens, 0)
  const stat = (k, v, extra = '') => `<div class="stat"><small>${k}</small><b>${v}</b>${extra ? `<em>${extra}</em>` : ''}</div>`
  // Lo tuyo siempre; las cifras de la liga solo cuando estás en la máquina.
  const maquina = VISTAS_MAQUINA.has(vista)
  $('#hud').innerHTML = [
    stat('Hoy', E.hoy.total ? `${E.hoy.hechos}/${E.hoy.total}` : '—', E.hoy.run?.estado === 'en_curso' ? 'run en curso' : E.hoy.run?.estado === 'propuesta' ? 'run propuesta' : E.hoy.total ? 'bandas' : 'sin run'),
    stat('Memoria', E.memoriaSinRevisar || '✓', E.memoriaSinRevisar ? 'nuevas (los repetidos se juntan solos)' : 'al día'),
    ...(maquina ? [
      stat('Roster', r.length, `${cuenta('activo')} act · ${cuenta('prueba')} prueba`),
      stat('Bus', t.pendiente ?? 0, `pend · ${t.hecha ?? 0} hechas${E.enEspera ? ` · ${fmtTokens(E.enEspera)} en espera` : ''}`),
      stat('Tick', E.nTick),
    ] : []),
    stat('Gasto hoy', fmtTokens(E.gasto.total), E.gasto.tope ? `solo ${fmtTokens(E.gasto.liga + (E.gasto.fondo ?? 0))} de ${fmtTokens(E.gasto.tope)}` : 'sin tope'),
    stat('NaN este mes', fmtTokens(tokens), 'tokens'),
  ].join('')
}

function renderCronica() {
  const lista = E.cronica
  if (!lista.length) {
    $('#cronica-lista').innerHTML = `<p style="color:var(--tenue);font-size:13px;padding:0 6px">Todavía no pasó nada. Apretá <b>Tick</b> (o la barra espaciadora) y Mastropiero purga, reparte y hace correr a la liga.</p>`
    return
  }
  const grupos = new Map()
  lista.forEach((e, i) => {
    if (!grupos.has(e.tick)) grupos.set(e.tick, [])
    grupos.get(e.tick).push({ ...e, i })
  })
  $('#cronica-lista').innerHTML = [...grupos].reverse().map(([tick, evs]) => `
    <div class="tick-grupo"><small>TICK ${tick}</small>
      ${evs.map((e) => `<div class="ev ${e.tipo} ${e.i >= cronicaVista ? 'nuevo' : ''}"><i>${ICONO[e.tipo] ?? '·'}</i><span>${esc(e.texto)}</span></div>`).join('')}
    </div>`).join('')
  cronicaVista = lista.length
}
