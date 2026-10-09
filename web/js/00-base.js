'use strict'
// Mastropiero · base: utilidades, estado compartido, modales, carta, HUD y crónica.

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(ruta, cuerpo) {
  const r = await fetch('/api' + ruta, cuerpo === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
  return j
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
const ICONO = { purga: '✝', asigna: '→', recluta: '+', vacante: '?', corre: '✓', falla: '✗', nivel: '▲', bautismo: '★', promovido: '◆', banca: '⇣', retirado: '✝', publica: '↻', tope: '⏸' }

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

// ─── toasts y modal ─────────────────────────────────────────────────────

function toast(html, tipo = '') {
  const t = document.createElement('div')
  t.className = `toast ${tipo}`
  t.innerHTML = html
  $('#toasts').append(t)
  setTimeout(() => t.remove(), 3700)
}
const error = (e) => toast(esc(e.message ?? e), 'error')

function abrirModal(html) {
  document.activeElement?.blur?.()
  $('#modal').innerHTML = html
  $('#velo').hidden = false
  // El foco va al primer campo: si se queda en el botón que abrió el modal, lo que tipeás se pierde (y la barra espaciadora lo reabre).
  setTimeout(() => $('#modal [autofocus], #modal input:not([type=hidden]):not([type=checkbox]):not([type=range]):not([data-sin-foco]), #modal textarea:not([data-sin-foco])')?.focus(), 0)
}
function cerrarModal() {
  $('#velo').hidden = true
  $('#modal').innerHTML = ''
}
$('#velo').addEventListener('click', (e) => { if (e.target.id === 'velo' || e.target.closest('[data-cerrar]')) cerrarModal() })
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarModal()
  const activo = document.activeElement
  const escribiendo = /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(activo?.tagName ?? '') || activo?.isContentEditable
  if (e.code === 'Space' && !escribiendo && $('#velo').hidden) { e.preventDefault(); hacerTick() }
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
    <ul class="stats">${stats}</ul>
    <footer><span class="pill ${f.estado}">${f.estado}</span><span>✓${f.exitos} ✗${f.fallos}</span><span class="motor" title="${esc(f.motor)}">${esc(f.motor)}</span></footer>
  </article>`
}

// ─── HUD y crónica ──────────────────────────────────────────────────────

function renderHud() {
  const r = E.roster
  const cuenta = (e) => r.filter((f) => f.estado === e).length
  const t = Object.fromEntries(E.liga.tareas.map((x) => [x.estado, x.n]))
  const tokens = E.uso.reduce((s, u) => s + u.tokens, 0)
  const stat = (k, v, extra = '') => `<div class="stat"><small>${k}</small><b>${v}</b>${extra ? `<em>${extra}</em>` : ''}</div>`
  // Lo tuyo siempre; las cifras de la liga solo cuando estás en la máquina.
  const maquina = VISTAS_MAQUINA.has(vista)
  $('#hud').innerHTML = [
    stat('Hoy', E.hoy.total ? `${E.hoy.hechos}/${E.hoy.total}` : '—', E.hoy.run?.estado === 'en_curso' ? 'run en curso' : E.hoy.run?.estado === 'propuesta' ? 'run propuesta' : E.hoy.total ? 'bandas' : 'sin run'),
    stat('Memoria', E.memoriaSinRevisar || '✓', E.memoriaSinRevisar ? 'por revisar' : 'al día'),
    ...(maquina ? [
      stat('Roster', r.length, `${cuenta('activo')} act · ${cuenta('prueba')} prueba`),
      stat('Bus', t.pendiente ?? 0, `pend · ${t.hecha ?? 0} hechas${E.enEspera ? ` · ${fmtTokens(E.enEspera)} en espera` : ''}`),
      stat('Tick', E.nTick),
    ] : []),
    stat('Gasto hoy', fmtTokens(E.gasto.total), E.gasto.tope ? `liga ${fmtTokens(E.gasto.liga)} de ${fmtTokens(E.gasto.tope)}` : 'sin tope'),
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
