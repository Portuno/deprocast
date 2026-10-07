'use strict'
// ─── @menciones: en cualquier lugar donde se escribe ───────────────────

/** Lo que se puede nombrar con @ (entidades y agentes). Se trae una vez y se refresca cuando cambian las entidades. */
let MENCIONABLES = []
let mencionablesFirma = ''
const normM = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const TIPO_GLIFO = { persona: '◐', proyecto: '◆', agrupacion: '⬡', dominio: '▦', lugar: '⌖', concepto: '✧', agente: '⚙', vos: '◉' }

async function traerMencionables() {
  const f = JSON.stringify(E?.entidades ?? []) + (E?.roster?.length ?? 0)
  if (f === mencionablesFirma && MENCIONABLES.length) return
  mencionablesFirma = f
  try { MENCIONABLES = await api('/menciones') } catch { /* sin catálogo, sin sugerencias */ }
}

const menc = { el: null, desde: -1, opciones: [], i: 0 }
const caja = document.createElement('div')
caja.className = 'menciones'
caja.hidden = true
document.body.appendChild(caja)

function cerrarMenciones() { caja.hidden = true; menc.el = null; menc.opciones = [] }

/** La consulta después de la última @ antes del cursor (si no hay un salto de línea en el medio). */
function consultaMencion(el) {
  const pos = el.selectionStart ?? el.value.length
  const antes = el.value.slice(0, pos)
  const at = antes.lastIndexOf('@')
  if (at < 0 || (at > 0 && /[\p{L}\p{N}_.]/u.test(antes[at - 1]))) return null
  const q = antes.slice(at + 1)
  if (q.length > 40 || /\n/.test(q) || /\s{2}/.test(q)) return null
  return { desde: at, q }
}

function filtrarMenciones(q) {
  const n = normM(q.trim())
  const puntaje = (m) => {
    const nombres = [m.n, ...(m.a ?? [])].map(normM)
    if (!n) return 1
    if (nombres.some((x) => x.startsWith(n))) return 3
    if (nombres.some((x) => x.split(/\s+/).some((w) => w.startsWith(n)))) return 2
    return nombres.some((x) => x.includes(n)) ? 1 : 0
  }
  return MENCIONABLES.map((m) => ({ m, s: puntaje(m) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.m.p ?? 0) - (a.m.p ?? 0)).slice(0, 8).map((x) => x.m)
}

function pintarMenciones() {
  if (!menc.el || !menc.opciones.length) return void (caja.hidden = true)
  const r = menc.el.getBoundingClientRect()
  caja.innerHTML = menc.opciones.map((m, i) => `<button type="button" class="${i === menc.i ? 'on' : ''}" data-mi="${i}"><i>${TIPO_GLIFO[m.t] ?? '·'}</i><b>${esc(m.n)}</b><small>${esc(m.t)}${m.p ? ` · ${m.p}` : ''}</small></button>`).join('')
  caja.hidden = false
  const alto = caja.offsetHeight
  const arriba = r.bottom + alto + 8 > window.innerHeight
  caja.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - caja.offsetWidth - 8))}px`
  caja.style.top = `${arriba ? r.top - alto - 6 : r.bottom + 6}px`
  caja.style.minWidth = `${Math.min(Math.max(r.width * 0.5, 260), 420)}px`
}

function elegirMencion(m) {
  const el = menc.el
  if (!el || !m) return
  const pos = el.selectionStart ?? el.value.length
  const antes = el.value.slice(0, menc.desde)
  const despues = el.value.slice(pos)
  const insertado = `@${m.n}${despues.startsWith(' ') ? '' : ' '}`
  el.value = antes + insertado + despues
  const cursor = antes.length + insertado.length
  el.setSelectionRange(cursor, cursor)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  cerrarMenciones()
  el.focus()
}

const escribible = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|)$/.test(el.type))) && !el.closest('[data-sin-menciones]')

document.addEventListener('input', (e) => {
  const el = e.target
  if (!escribible(el)) return
  const c = consultaMencion(el)
  if (!c) return cerrarMenciones()
  if (!MENCIONABLES.length) traerMencionables().then(() => el === document.activeElement && el.dispatchEvent(new Event('input')))
  menc.el = el
  menc.desde = c.desde
  menc.opciones = filtrarMenciones(c.q)
  menc.i = 0
  pintarMenciones()
})
// Antes que los atajos del campo (Enter envía en el chat): con la lista abierta, las teclas son de la lista.
document.addEventListener('keydown', (e) => {
  if (caja.hidden || e.target !== menc.el) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    menc.i = (menc.i + (e.key === 'ArrowDown' ? 1 : -1) + menc.opciones.length) % menc.opciones.length
    pintarMenciones()
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    e.stopImmediatePropagation()
    elegirMencion(menc.opciones[menc.i])
  } else if (e.key === 'Escape') {
    e.stopImmediatePropagation()
    cerrarMenciones()
  }
}, true)
caja.addEventListener('mousedown', (e) => {
  const b = e.target.closest('[data-mi]')
  if (b) { e.preventDefault(); elegirMencion(menc.opciones[Number(b.dataset.mi)]) }
})
document.addEventListener('focusout', (e) => { if (e.target === menc.el) setTimeout(() => { if (document.activeElement !== menc.el) cerrarMenciones() }, 120) })
window.addEventListener('resize', () => pintarMenciones())

/** En lo que escribiste, las menciones se ven como menciones (y llevan a su ficha). Recibe texto ya escapado. */
function conMenciones(t) {
  if (!t.includes('@') || !MENCIONABLES.length) return t
  const nombres = MENCIONABLES.flatMap((m) => [m.n, ...(m.a ?? [])].map((n) => ({ m, n: esc(n) }))).filter((x) => x.n.length >= 2).sort((a, b) => b.n.length - a.n.length)
  let out = ''
  let i = 0
  for (let at = t.indexOf('@'); at >= 0; at = t.indexOf('@', at + 1)) {
    if (at < i || (at > 0 && /[\p{L}\p{N}_.]/u.test(t[at - 1]))) continue
    const resto = t.slice(at + 1)
    const hit = nombres.find((x) => normM(resto.slice(0, x.n.length)) === normM(x.n) && !/[\p{L}\p{N}]/u.test(resto[x.n.length] ?? ''))
    if (!hit) continue
    const k = hit.m.k
    const attr = k.startsWith('entidad:') ? `data-ref-ent="${k.slice(8)}"` : k.startsWith('agente:') ? `data-ver-agente="${esc(k.slice(7))}"` : 'data-ir-jugador'
    out += `${t.slice(i, at)}<a href="#" class="mencion" ${attr}>@${resto.slice(0, hit.n.length)}</a>`
    i = at + 1 + hit.n.length
  }
  return out + t.slice(i)
}
