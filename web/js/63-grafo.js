'use strict'
// El Grafo (plan v25): la topología de su memoria. Un lienzo propio (canvas, sin librerías): tamaño = intermediación
// (las bisagras), color = comunidad (los grupos de ideas que aparecen juntas). Tocar un nodo muestra sus vecinos y los
// pasajes originales donde aparece; dos nodos, el camino entre ellos. «Quitar lo obvio» saca las bisagras y deja ver lo
// de segundo nivel; «Comparar» muestra qué cambió entre dos fotos. Capas: Tu voz (con Vos en el centro), Todo y los que
// él arma en «Mis grafos».

const gf = {
  grafos: [], actual: null, foto: null, mostrado: null, historia: [], calculando: false,
  sel: [], hover: null, ocultas: new Set(), resaltar: null, quitados: null, diff: null, titulo: null, seguidos: [], hueco: null,
  t: { k: 1, x: 0, y: 0 }, lienzo: null, ctx: null, colores: [], pedido: 0, frags: new Map(),
}
const ESTADOS = { sesgado: 'Sesgado: casi sin grupos, la influencia concentrada', enfocado: 'Enfocado: hay grupos, pero uno domina', diversificado: 'Diversificado: varios grupos claros y conectados', disperso: 'Disperso: grupos claros pero sueltos' }

// ─── el espacio: Grafo · Mis grafos · Salud ─────────────────────────────

async function montarGrafo() {
  $('#principal').innerHTML = `<div class="gf">
    <div class="gf-barra fila">
      <select class="campo-suelto" id="gf-capa" aria-label="Qué grafo"></select>
      <button class="btn btn-chico" id="gf-recalcular" title="Volver a calcularlo ahora (en segundo plano)">↻</button>
      <input class="campo-suelto" id="gf-buscar" placeholder="Buscar un concepto…" data-sin-menciones>
      <select class="campo-suelto" id="gf-obvio" title="Sacar las bisagras para ver lo de segundo nivel"><option value="0">Todo a la vista</option><option value="3">Sin las 3 bisagras</option><option value="5">Sin las 5 bisagras</option><option value="10">Sin las 10 bisagras</option></select>
      <select class="campo-suelto" id="gf-comparar" title="Qué cambió entre esta foto y una anterior"><option value="">Comparar con…</option></select>
      <button class="btn btn-chico" id="gf-png" title="Descargar la imagen">⤓ PNG</button>
    </div>
    <div class="gf-cuerpo"><div class="gf-lienzo" id="gf-lienzo"><canvas></canvas><div class="gf-estado" id="gf-estado"></div></div><aside class="gf-panel" id="gf-panel"></aside></div>
  </div>`
  gf.lienzo = $('#gf-lienzo canvas')
  gf.ctx = gf.lienzo.getContext('2d')
  engancharLienzo()
  $('#gf-capa').onchange = (e) => { gf.actual = Number(e.target.value); gf.sel = []; gf.ocultas.clear(); traerGrafo() }
  $('#gf-recalcular').onclick = async () => { const b = $('#gf-recalcular'); b.disabled = true; avisoEstado('Recalculando en segundo plano…'); try { await api(`/grafos/${gf.actual}/recalcular`, { forzar: true }); await traerGrafo() } catch (e) { error(e) } finally { b.disabled = false } }
  $('#gf-buscar').oninput = (e) => {
    const q = sinTildesG(e.target.value.trim())
    if (q.length < 2) return dibujar()
    const n = gf.mostrado?.nodos.find((x) => sinTildesG(x.forma).startsWith(q)) ?? gf.mostrado?.nodos.find((x) => sinTildesG(x.forma).includes(q))
    if (n) { elegir(n.i, false); centrarEn(n) }
  }
  $('#gf-obvio').onchange = (e) => quitarObvio(Number(e.target.value))
  $('#gf-comparar').onchange = (e) => comparar(Number(e.target.value) || null)
  $('#gf-png').onclick = exportarPng
  try { gf.grafos = (await api('/grafos')).grafos } catch (e) { return error(e) }
  if (!gf.actual || !gf.grafos.some((g) => g.id === gf.actual)) gf.actual = gf.grafos[0]?.id
  pintarCapas()
  if (gf.titulo && gf.mostrado && !gf.actual) return (pintarPanel(), dibujar())
  traerGrafo()
}

function pintarCapas() {
  const s = $('#gf-capa')
  if (!s) return
  s.innerHTML = gf.grafos.map((g) => `<option value="${g.id}" ${g.id === gf.actual ? 'selected' : ''}>${g.tipo === 'voz' ? '◉ ' : g.tipo === 'todo' ? '◎ ' : ''}${esc(g.nombre)}</option>`).join('') + (gf.titulo && !gf.actual ? `<option selected>${esc(gf.titulo)}</option>` : '')
}

const sinTildesG = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const avisoEstado = (t) => { const e = $('#gf-estado'); if (e) { e.textContent = t || ''; e.hidden = !t } }

async function traerGrafo() {
  if (!gf.actual) return
  const pedido = ++gf.pedido
  gf.quitados = null; gf.diff = null; gf.titulo = null
  const obvio = $('#gf-obvio'); if (obvio) obvio.value = '0'
  avisoEstado('Armando el grafo (la primera vez tarda unos segundos; se calcula aparte, no frena nada)…')
  let r
  try { r = await api(`/grafos/${gf.actual}`) } catch (e) { avisoEstado(''); return error(e) }
  if (pedido !== gf.pedido) return
  gf.foto = r.foto; gf.mostrado = r.foto; gf.historia = r.historia; gf.calculando = r.calculando; gf.seguidos = r.huecos ?? []; gf.zonas = r.zonas ?? []; gf.hueco = null
  avisoEstado(r.foto ? '' : 'Todavía no hay texto para este grafo.')
  $('#gf-comparar').innerHTML = '<option value="">Comparar con…</option>' + r.historia.filter((h) => h.id !== r.foto?.id).map((h) => `<option value="${h.id}">${new Date(h.en).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${h.metricas?.n ?? '?'} conceptos</option>`).join('')
  encuadrar()
  pintarPanel()
  dibujar()
}

// ─── el dibujo ──────────────────────────────────────────────────────────

function colores() {
  const cs = getComputedStyle(document.documentElement)
  gf.colores = Array.from({ length: 12 }, (_, i) => cs.getPropertyValue(`--grafo-${i + 1}`).trim() || '#888')
  gf.colorBorde = cs.getPropertyValue('--linea-2').trim()
  gf.colorTexto = cs.getPropertyValue('--texto').trim()
  gf.colorFondo = cs.getPropertyValue('--panel').trim()
  gf.colorAcento = cs.getPropertyValue('--acento').trim()
}
const colorGrafo = (c) => (c < 0 ? gf.colorAcento : gf.colores[c % 12] ?? '#888')

/** El grafo entero a la vista. */
function encuadrar() { gf.t = { k: 1, x: 0, y: 0 } }
function aPantalla(n) {
  const w = gf.lienzo.clientWidth, h = gf.lienzo.clientHeight, R = Math.min(w, h) * 0.46
  return [w / 2 + n.x * R * gf.t.k + gf.t.x, h / 2 + n.y * R * gf.t.k + gf.t.y]
}
function centrarEn(n) {
  const w = gf.lienzo.clientWidth, h = gf.lienzo.clientHeight, R = Math.min(w, h) * 0.46
  gf.t.k = Math.max(gf.t.k, 2.2)
  gf.t.x = -n.x * R * gf.t.k; gf.t.y = -n.y * R * gf.t.k
  dibujar()
}

let cuadro = 0
function dibujar() { cancelAnimationFrame(cuadro); cuadro = requestAnimationFrame(pintarLienzo) }

function pintarLienzo() {
  const g = gf.mostrado, cv = gf.lienzo
  if (!cv || !g) { if (cv) gf.ctx.clearRect(0, 0, cv.width, cv.height); return }
  if (!gf.colores.length) colores()
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
  const ctx = gf.ctx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const nodos = g.nodos
  const pos = nodos.map(aPantalla)
  const visible = nodos.map((n) => n.vos || !gf.ocultas.has(n.com))
  // Lo que está en foco: lo elegido y sus vecinos, o las dos comunidades de un hueco.
  const foco = new Set()
  if (gf.sel.length) { for (const s of gf.sel) foco.add(s); for (const [a, b] of g.aristas) { if (gf.sel.includes(a)) foco.add(b); if (gf.sel.includes(b)) foco.add(a) } }
  if (gf.camino) for (const i of gf.camino) foco.add(i)
  const enFoco = (i) => (gf.resaltar ? gf.resaltar.has(nodos[i].com) : !foco.size || foco.has(i))
  const maxP = Math.max(1, ...g.aristas.map((a) => a[2]))
  // Las aristas, finas; las del camino, gruesas.
  const enCamino = new Set((gf.camino ?? []).slice(1).map((v, k) => `${Math.min(v, gf.camino[k])}|${Math.max(v, gf.camino[k])}`))
  ctx.lineCap = 'round'
  for (const [a, b, p] of g.aristas) {
    if (!visible[a] || !visible[b]) continue
    const camino = enCamino.has(`${Math.min(a, b)}|${Math.max(a, b)}`)
    const brillo = enFoco(a) && enFoco(b)
    ctx.globalAlpha = camino ? 0.95 : (brillo ? 0.12 + 0.5 * (p / maxP) : 0.03)
    ctx.strokeStyle = camino ? gf.colorAcento : nodos[a].com === nodos[b].com ? colorGrafo(nodos[a].com) : gf.colorBorde
    ctx.lineWidth = camino ? 3 : 0.6 + 1.6 * (p / maxP)
    ctx.beginPath(); ctx.moveTo(pos[a][0], pos[a][1]); ctx.lineTo(pos[b][0], pos[b][1]); ctx.stroke()
  }
  // Los nodos: tamaño por intermediación.
  const maxB = Math.max(1e-9, ...nodos.map((n) => n.btw))
  const radio = (n) => (n.vos ? 9 : 2.5 + 15 * Math.sqrt(n.btw / maxB)) * Math.min(2.2, Math.sqrt(gf.t.k))
  gf.radios = nodos.map(radio)
  gf.pos = pos
  for (const n of nodos) {
    if (!visible[n.i]) continue
    const [x, y] = pos[n.i], r = gf.radios[n.i]
    if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue
    ctx.globalAlpha = enFoco(n.i) ? 0.95 : 0.15
    ctx.fillStyle = colorGrafo(n.com)
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
    if (n.vos || gf.sel.includes(n.i) || n.i === gf.hover) { ctx.globalAlpha = 1; ctx.strokeStyle = n.vos ? gf.colorAcento : gf.colorTexto; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.stroke() }
    if (n.entrada && enFoco(n.i)) { ctx.globalAlpha = 0.8; ctx.strokeStyle = gf.colorTexto; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 7); ctx.stroke(); ctx.setLineDash([]) }
  }
  // Las etiquetas: las bisagras siempre, el resto según el zoom; sin pisarse.
  const orden = nodos.filter((n) => visible[n.i]).sort((a, b) => (b.vos ? 1 : 0) - (a.vos ? 1 : 0) || b.btw - a.btw)
  const ocupado = []
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  let puestas = 0
  for (const n of orden) {
    const obligada = n.vos || gf.sel.includes(n.i) || n.i === gf.hover || (foco.size > 0 && foco.has(n.i) && foco.size < 40)
    if (!obligada && (puestas > 18 + 22 * gf.t.k || !enFoco(n.i))) continue
    const [x, y] = pos[n.i], r = gf.radios[n.i]
    const tam = Math.round(Math.min(18, 11 + 6 * Math.sqrt(n.btw / maxB)))
    ctx.font = `${n.vos || gf.sel.includes(n.i) ? 600 : 400} ${tam}px system-ui, sans-serif`
    const ancho = ctx.measureText(n.forma).width
    const caja = [x - ancho / 2 - 2, y + r + 2, x + ancho / 2 + 2, y + r + 4 + tam]
    if (!obligada && ocupado.some((o) => caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) continue
    ocupado.push(caja)
    puestas++
    ctx.globalAlpha = enFoco(n.i) ? 1 : 0.35
    ctx.lineWidth = 3; ctx.strokeStyle = gf.colorFondo; ctx.strokeText(n.forma, x, y + r + 3)
    ctx.fillStyle = gf.colorTexto; ctx.fillText(n.forma, x, y + r + 3)
  }
  ctx.globalAlpha = 1
}

// ─── tocar, arrastrar, acercar ──────────────────────────────────────────

function nodoEn(x, y) {
  if (!gf.mostrado || !gf.pos) return null
  let mejor = null, d = 14
  for (const n of gf.mostrado.nodos) {
    if (!n.vos && gf.ocultas.has(n.com)) continue
    const [px, py] = gf.pos[n.i]
    const dd = Math.hypot(px - x, py - y) - gf.radios[n.i]
    if (dd < d) { d = dd; mejor = n.i }
  }
  return mejor
}

function engancharLienzo() {
  const cv = gf.lienzo
  const punteros = new Map()
  let arrastre = null, pellizco = null
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); punteros.set(e.pointerId, local(e)); if (punteros.size === 1) arrastre = { p: local(e), movio: false, x: gf.t.x, y: gf.t.y } })
  cv.addEventListener('pointermove', (e) => {
    const p = local(e)
    if (punteros.has(e.pointerId)) punteros.set(e.pointerId, p)
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (pellizco) zoomEn((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pellizco)
      pellizco = d
      arrastre = null
      return
    }
    if (arrastre) {
      const dx = p[0] - arrastre.p[0], dy = p[1] - arrastre.p[1]
      if (Math.abs(dx) + Math.abs(dy) > 4) arrastre.movio = true
      if (arrastre.movio) { gf.t.x = arrastre.x + dx; gf.t.y = arrastre.y + dy; dibujar() }
      return
    }
    const h = nodoEn(p[0], p[1])
    if (h !== gf.hover) { gf.hover = h; cv.style.cursor = h != null ? 'pointer' : 'grab'; dibujar() }
  })
  const soltar = (e) => {
    punteros.delete(e.pointerId)
    if (punteros.size < 2) pellizco = null
    if (arrastre && !arrastre.movio) {
      const [x, y] = local(e)
      const n = nodoEn(x, y)
      if (n != null) elegir(n, e.shiftKey || e.ctrlKey || e.metaKey)
      else if (gf.sel.length || gf.resaltar) { gf.sel = []; gf.camino = null; gf.resaltar = null; pintarPanel(); dibujar() }
    }
    arrastre = null
  }
  cv.addEventListener('pointerup', soltar)
  cv.addEventListener('pointercancel', soltar)
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); zoomEn(x, y, e.deltaY < 0 ? 1.15 : 0.87) }, { passive: false })
  cv.addEventListener('dblclick', () => { encuadrar(); dibujar() })
  new ResizeObserver(dibujar).observe($('#gf-lienzo'))
}

function zoomEn(x, y, f) {
  const k = Math.max(0.4, Math.min(12, gf.t.k * f))
  const w = gf.lienzo.clientWidth, h = gf.lienzo.clientHeight
  const real = k / gf.t.k
  gf.t.x = (gf.t.x - (x - w / 2)) * real + (x - w / 2)
  gf.t.y = (gf.t.y - (y - h / 2)) * real + (y - h / 2)
  gf.t.k = k
  dibujar()
}

// ─── elegir: un nodo, o dos (el camino) ─────────────────────────────────

function elegir(i, sumar) {
  gf.resaltar = null
  if (sumar && gf.sel.length === 1 && gf.sel[0] !== i) gf.sel = [gf.sel[0], i]
  else gf.sel = gf.sel.length === 1 && gf.sel[0] === i ? [] : [i]
  gf.camino = gf.sel.length === 2 ? caminoEntre(gf.sel[0], gf.sel[1]) : null
  pintarPanel()
  dibujar()
}

/** El camino más corto (costo 1/peso: más co-ocurrencia = más cerca), en el navegador. */
function caminoEntre(a, b) {
  const g = gf.mostrado, n = g.nodos.length
  const ady = Array.from({ length: n }, () => [])
  for (const [x, y, p] of g.aristas) { ady[x].push([y, 1 / p]); ady[y].push([x, 1 / p]) }
  const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), hecho = new Uint8Array(n)
  dist[a] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < n; i++) if (!hecho[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0 || u === b) break
    hecho[u] = 1
    for (const [v, c] of ady[u]) if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u }
  }
  if (dist[b] === Infinity) return null
  const out = [b]
  while (out[0] !== a) out.unshift(prev[out[0]])
  return out
}

// ─── el panel ───────────────────────────────────────────────────────────

function pintarPanel() {
  const p = $('#gf-panel'), g = gf.mostrado
  if (!p) return
  if (!g) { p.innerHTML = '<p class="tenue">Sin grafo todavía.</p>'; return }
  const m = g.metricas
  const cab = `<div class="gf-cab">
    <div class="fila"><span class="chip gf-estado-${m.estado}" title="${esc(ESTADOS[m.estado] ?? '')} (umbrales a calibrar con tu corpus)">${esc(m.estado)}</span>
      <small class="tenue">${m.n} conceptos · ${m.comunidades} grupos · ${g.documentos ?? m.documentos} textos${gf.foto?.en && !gf.quitados ? ` · ${new Date(gf.foto.en).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}` : ''}</small></div>
    <div class="gf-metricas" title="M: qué tan marcados están los grupos · C1: el grupo mayor · C2: lo conectado · E: cuán repartida está la influencia">
      <span>M <b>${m.M}</b></span><span>C1 <b>${Math.round(m.C1 * 100)}%</b></span><span>C2 <b>${Math.round(m.C2 * 100)}%</b></span><span>E <b>${m.E}</b></span></div>
    ${gf.quitados ? `<p class="chico">Sin: ${gf.quitados.map(esc).join(', ')} <a href="#" id="gf-volver-obvio">volver</a></p>` : ''}
  </div>`
  if (gf.hueco) return void (p.innerHTML = cab + huecoHTML(gf.hueco), engancharHueco(gf.hueco), volverObvio())
  if (gf.diff) return void (p.innerHTML = cab + diffHTML(gf.diff), $('#gf-cerrar-diff').onclick = () => { gf.diff = null; $('#gf-comparar').value = ''; pintarPanel() }, volverObvio())
  if (gf.sel.length === 1) return void (p.innerHTML = cab + nodoHTML(g.nodos[gf.sel[0]]), engancharNodo(g.nodos[gf.sel[0]]), volverObvio())
  if (gf.sel.length === 2) return void (p.innerHTML = cab + caminoHTML(), engancharCamino(), volverObvio())
  p.innerHTML = cab + estructuraHTML(g)
  volverObvio()
  $$('[data-gf-com]', p).forEach((b) => (b.onclick = () => { const c = Number(b.dataset.gfCom); gf.ocultas.has(c) ? gf.ocultas.delete(c) : gf.ocultas.add(c); b.classList.toggle('apagada', gf.ocultas.has(c)); dibujar() }))
  $$('[data-gf-solo]', p).forEach((b) => (b.onclick = () => { const c = Number(b.dataset.gfSolo); const todas = g.comunidades.map((x) => x.id); const ya = gf.ocultas.size === todas.length - 1 && !gf.ocultas.has(c); gf.ocultas = new Set(ya ? [] : todas.filter((x) => x !== c)); pintarPanel(); dibujar() }))
  $$('[data-gf-nodo]', p).forEach((b) => (b.onclick = (e) => { e.preventDefault(); const n = g.nodos[Number(b.dataset.gfNodo)]; elegir(n.i, false); centrarEn(n) }))
  $$('[data-gf-hueco]', p).forEach((b) => (b.onclick = () => { const h = g.huecos[Number(b.dataset.gfHueco)]; gf.sel = []; gf.camino = null; gf.resaltar = new Set([h.a, h.b]); dibujar() }))
  $$('[data-gf-seguido]', p).forEach((b) => (b.onclick = () => abrirHueco(gf.seguidos.find((h) => h.id === Number(b.dataset.gfSeguido)))))
  const zs = $('#gf-zonas', p)
  if (zs) zs.onclick = async () => {
    zs.disabled = true; zs.textContent = 'Leyendo cada grupo…'
    try { const r = await api(`/grafos/${gf.actual}/zonas`, {}); gf.zonas = r.zonas; if (r.aviso) toast(esc(r.aviso)); pintarPanel() } catch (e) { error(e); zs.disabled = false; zs.textContent = '✦ De qué va cada grupo' }
  }
}
function volverObvio() { const v = $('#gf-volver-obvio'); if (v) v.onclick = (e) => { e.preventDefault(); $('#gf-obvio').value = '0'; quitarObvio(0) } }

function estructuraHTML(g) {
  const bisagras = [...g.nodos].filter((n) => !n.vos).sort((a, b) => b.btw - a.btw).slice(0, 12)
  const entradas = g.nodos.filter((n) => n.entrada)
  // Las zonas (de qué va cada grupo) valen para la foto entera, no para «quitar lo obvio» ni para otra foto.
  const zona = (c) => (g === gf.foto ? (gf.zonas ?? []).find((z) => z.com === c.id && z.top.join() === c.top.join()) : null)
  const sinResumen = g === gf.foto && (gf.zonas ?? []).some((z) => !z.resumen)
  return `<section><h4>Grupos <small class="tenue">(tocá para apagar; ◎ para ver uno solo)</small></h4><ul class="gf-coms">${g.comunidades.filter((c) => c.tam >= 2).slice(0, 14).map((c) => { const z = zona(c); return `<li class="${gf.ocultas.has(c.id) ? 'apagada' : ''}"><button class="gf-color" data-gf-com="${c.id}" data-color="${c.id % 12}" title="Mostrar u ocultar"></button><span class="f1"${z?.resumen ? ` title="${esc(z.resumen)}"` : ''}>${z?.titulo ? `<b>${esc(z.titulo)}</b><br><small class="tenue">` : ''}${c.top.slice(0, 5).map(esc).join(', ')}${z?.titulo ? '</small>' : ''}</span><small class="tenue">${c.tam}</small><button class="btn btn-chico btn-icono" data-gf-solo="${c.id}" title="Ver solo este grupo">◎</button></li>` }).join('')}</ul>
    ${sinResumen ? '<button class="btn btn-chico" id="gf-zonas" title="Mastropiero lee cada grupo y escribe de qué va (en la nube: gasta tokens)">✦ De qué va cada grupo</button>' : ''}</section>
    <section><h4>Bisagras <small class="tenue">(unen tus áreas)</small></h4><p class="gf-lista">${bisagras.map((n) => `<a href="#" data-gf-nodo="${n.i}">${esc(n.forma)}</a>`).join(' · ')}</p></section>
    ${entradas.length ? `<section><h4>Puntos de entrada <small class="tenue">(aparecen poco, conectan mucho)</small></h4><p class="gf-lista">${entradas.map((n) => `<a href="#" data-gf-nodo="${n.i}">${esc(n.forma)}</a>`).join(' · ')}</p></section>` : ''}
    ${gf.seguidos.length && !gf.quitados && gf.mostrado === gf.foto ? `<section><h4>Huecos <small class="tenue">(grupos que casi no se tocan: ahí viven ideas nuevas)</small></h4><ul class="gf-huecos">${gf.seguidos.slice(0, 6).map((h) => `<li><button class="gf-hueco" data-gf-seguido="${h.id}"><span>${h.terminosA.slice(0, 3).map(esc).join(', ')}</span><b>↔</b><span>${h.terminosB.slice(0, 3).map(esc).join(', ')}</span><i class="chip gf-h-${h.estado}">${ESTADO_HUECO[h.estado] ?? h.estado}</i></button>${h.pregunta ? `<small>${esc(h.pregunta)}</small>` : h.bisagras.length ? `<small class="tenue">hoy los une apenas: ${h.bisagras.slice(0, 3).map(esc).join(', ')}</small>` : '<small class="tenue">nada los une todavía</small>'}</li>`).join('')}</ul></section>`
      : g.huecos?.length ? `<section><h4>Huecos <small class="tenue">(grupos que casi no se tocan)</small></h4><ul class="gf-huecos">${g.huecos.slice(0, 5).map((h, k) => `<li><button class="gf-hueco" data-gf-hueco="${k}"><span>${h.terminosA.slice(0, 3).map(esc).join(', ')}</span><b>↔</b><span>${h.terminosB.slice(0, 3).map(esc).join(', ')}</span></button></li>`).join('')}</ul></section>` : ''}
    ${g.automaticas?.length ? `<section><h4>Aparecen en casi todo</h4><p class="chico tenue">Si no son concepto para vos, frenalas en Mis grafos → Diccionario: ${g.automaticas.slice(0, 8).map(esc).join(', ')}</p></section>` : ''}
    <p class="chico tenue">Arrastrá para moverte, rueda o pellizco para acercar, doble toque para ver todo. Tocá un concepto; con Shift (o Ctrl) tocá otro para ver el camino entre los dos.</p>`
}

function nodoHTML(n) {
  if (n.vos) return '<section><h3>Vos</h3><p class="tenue">El centro de tu grafo: unido a tus diez conceptos más influyentes.</p></section>'
  const g = gf.mostrado
  const vec = g.aristas.filter(([a, b]) => a === n.i || b === n.i).map(([a, b, p]) => [a === n.i ? b : a, p]).filter(([j]) => !g.nodos[j].vos).sort((x, y) => y[1] - x[1]).slice(0, 14)
  const rango = [...g.nodos].filter((x) => !x.vos).sort((a, b) => b.btw - a.btw).findIndex((x) => x.i === n.i) + 1
  const com = g.comunidades.find((c) => c.id === n.com)
  return `<section><h3><i class="gf-punto" data-color="${n.com % 12}"></i> ${esc(n.forma)}</h3>
    <p class="chico">Aparece ${n.frec} ${n.frec === 1 ? 'vez' : 'veces'} en ${n.docs} texto${n.docs === 1 ? '' : 's'} · bisagra n.º ${rango}${n.entrada ? ' · punto de entrada' : ''}${n.periferia ? ' · periferia (toca otro grupo)' : ''}</p>
    ${com ? `<p class="chico tenue">Su grupo: ${com.top.slice(0, 6).map(esc).join(', ')}</p>` : ''}
    <h4>Va con</h4><p class="gf-lista">${vec.map(([j, p]) => `<a href="#" data-gf-nodo="${j}" title="peso ${p}">${esc(g.nodos[j].forma)}</a>`).join(' · ') || '—'}</p>
    <div class="fila"><button class="btn btn-chico" id="gf-preguntar">💬 Preguntarle a Mastropiero</button></div>
    <h4>Dónde aparece</h4><div id="gf-frags"><p class="tenue chico">Buscando en tus textos…</p></div></section>`
}

function engancharNodo(n) {
  const p = $('#gf-panel')
  $$('[data-gf-nodo]', p).forEach((b) => (b.onclick = (e) => { e.preventDefault(); elegir(Number(b.dataset.gfNodo), e.shiftKey || e.ctrlKey || e.metaKey) }))
  const preg = $('#gf-preguntar')
  if (preg) preg.onclick = () => preguntarAMastropiero(`En mi grafo, «${n.forma}» es una bisagra. ¿Qué dice mi archivo sobre «${n.forma}» y qué conecta con qué? (usá ver_grafo / conectar_conceptos si hace falta)`)
  if (!n.vos) traerFragmentos(n, null, $('#gf-frags'))
}

function caminoHTML() {
  const g = gf.mostrado, [a, b] = gf.sel.map((i) => g.nodos[i])
  return `<section><h3>${esc(a.forma)} ↔ ${esc(b.forma)}</h3>
    ${gf.camino ? `<p class="gf-camino">${gf.camino.map((i) => `<a href="#" data-gf-nodo="${i}">${esc(g.nodos[i].forma)}</a>`).join(' → ')}</p><p class="chico tenue">${gf.camino.length - 1} paso${gf.camino.length === 2 ? '' : 's'}: ${gf.camino.length === 2 ? 'aparecen juntos' : 'se tocan a través de esos conceptos'}.</p>` : '<p>No hay camino: viven en partes sueltas de tu grafo (un hueco).</p>'}
    <div class="fila"><button class="btn btn-chico" id="gf-preguntar">💬 ¿Qué conecta a ${esc(a.forma)} con ${esc(b.forma)}?</button></div>
    <h4>Donde aparecen juntos</h4><div id="gf-frags"><p class="tenue chico">Buscando…</p></div></section>`
}
function engancharCamino() {
  const g = gf.mostrado, [a, b] = gf.sel.map((i) => g.nodos[i])
  $$('[data-gf-nodo]', $('#gf-panel')).forEach((x) => (x.onclick = (e) => { e.preventDefault(); elegir(Number(x.dataset.gfNodo), false) }))
  $('#gf-preguntar').onclick = () => preguntarAMastropiero(`¿Qué conecta «${a.forma}» con «${b.forma}» en mi archivo? (usá conectar_conceptos)`)
  // Juntos; y si no aparecen juntos, el primer tramo del camino.
  const par = gf.camino && gf.camino.length > 2 ? [g.nodos[gf.camino[0]], g.nodos[gf.camino[1]]] : [a, b]
  traerFragmentos(par[0], par[1], $('#gf-frags'))
}

async function traerFragmentos(a, b, caja) {
  if (!caja || !gf.foto || !gf.actual || gf.titulo) { if (caja) caja.innerHTML = '<p class="tenue chico">En un texto suelto no hay piezas que abrir.</p>'; return }
  const clave = `${gf.foto.id}:${a.lema}:${b?.lema ?? ''}`
  try {
    const fs = gf.frags.get(clave) ?? (await api(`/grafos/${gf.actual}/fragmentos?${new URLSearchParams({ foto: gf.foto.id, a: a.lema, fa: a.forma, ...(b ? { b: b.lema, fb: b.forma } : {}) })}`)).fragmentos
    gf.frags.set(clave, fs)
    if (!caja.isConnected) return
    caja.innerHTML = fs.length ? fs.map((f) => `<article class="gf-frag"><header><a href="#" ${f.pieza ? `data-pieza="${f.pieza}"` : `data-quantomo="${f.quantomo}"`}>${esc(f.titulo)}</a>${f.fecha ? `<small class="tenue">${esc(String(f.fecha).slice(0, 10))}</small>` : ''}</header><p>${esc(f.texto).replace(/«([^»]+)»/g, '<mark>$1</mark>')}</p></article>`).join('')
      : '<p class="tenue chico">No los encontré cerca en el texto (se unen por sus vecinos).</p>'
    $$('[data-pieza]', caja).forEach((x) => (x.onclick = (e) => { e.preventDefault(); modalPieza(Number(x.dataset.pieza)) }))
    $$('[data-quantomo]', caja).forEach((x) => (x.onclick = (e) => { e.preventDefault(); irA('quantomos') }))
  } catch (e) { caja.innerHTML = ''; error(e) }
}

// ─── un hueco: la pregunta y sus tres salidas ───────────────────────────

const ESTADO_HUECO = { abierto: 'abierto', en_curso: 'en curso', cerrado: 'cerrado ✓', descartado: 'descartado' }

/** Las comunidades de la foto donde viven los términos de un hueco (para resaltarlas en el lienzo). */
function comunidadesDe(h) {
  const g = gf.mostrado
  const com = (ts) => { const c = new Map(); for (const t of ts) { const n = g.nodos.find((x) => sinTildesG(x.forma) === sinTildesG(t)); if (n && n.com >= 0) c.set(n.com, (c.get(n.com) ?? 0) + 1) } return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] }
  return new Set([com(h.terminosA), com(h.terminosB)].filter((x) => x != null))
}

function abrirHueco(h) {
  if (!h) return
  gf.hueco = h; gf.sel = []; gf.camino = null
  gf.resaltar = comunidadesDe(h)
  pintarPanel(); dibujar()
}

function huecoHTML(h) {
  const hist = h.historia.filter((x) => x.puente != null)
  return `<section><div class="aca-sec-cab"><h3>Un hueco</h3><button class="btn btn-chico" id="gfh-cerrar">✕</button></div>
    <p class="gf-hueco-lados"><span>${h.terminosA.slice(0, 5).map(esc).join(', ')}</span><b>↔</b><span>${h.terminosB.slice(0, 5).map(esc).join(', ')}</span></p>
    <p class="chico tenue">${h.bisagras.length ? `Hoy los une apenas: ${h.bisagras.map(esc).join(', ')}.` : 'Hoy nada los une.'} Estado: ${ESTADO_HUECO[h.estado] ?? h.estado}${hist.length > 1 ? ` · puente ${hist[0].puente} → ${hist.at(-1).puente}` : ''}</p>
    ${h.pregunta ? `<blockquote class="gf-pregunta">${esc(h.pregunta)}</blockquote>${h.porQue ? `<p class="chico tenue">${esc(h.porQue)}</p>` : ''}${h.puentes.length ? `<p class="chico">Posibles puentes: ${h.puentes.map(esc).join(' · ')}</p>` : ''}`
      : '<div class="fila"><button class="btn btn-primario btn-chico" id="gfh-pregunta">💡 Proponer la pregunta que los une</button></div>'}
    ${h.pregunta && h.estado !== 'cerrado' ? `<form id="gfh-resp"><textarea class="campo-suelto" name="texto" rows="4" placeholder="Tu respuesta (queda como pieza tuya y como quántomo para La Mano)" required></textarea><div class="fila"><button class="btn btn-primario btn-chico">Responder</button></div></form>` : ''}
    ${h.respuestaPieza ? `<p class="chico">✓ Respondiste: <a href="#" data-pieza="${h.respuestaPieza}">tu respuesta</a>${h.quantomoId ? ' (el quántomo espera en La Mano)' : ''}.</p>` : ''}
    <div class="fila gf-salidas">
      <button class="btn btn-chico" id="gfh-agente" title="En la nube: busca material que una los dos grupos y lo trae a tu corpus">🔎 Que lo investigue un agente</button>
      <button class="btn btn-chico" id="gfh-fragua" ${h.propuestaId ? 'disabled' : ''} title="Si toca el sistema o tus proyectos: una propuesta abierta">${h.propuestaId ? '✓ En La Fragua' : '→ La Fragua'}</button>
      <button class="btn btn-chico" id="gfh-radar" title="En la nube: el Radar busca oportunidades con esta pregunta">→ Radar</button>
    </div>
    ${h.agente?.urls?.length ? `<p class="chico">El agente trajo ${h.agente.urls.length}: ${h.agente.urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname)}</a>`).join(' · ')}</p>` : ''}
    <div class="fila"><span class="tenue chico">¿Sirve este hueco?</span><button class="btn btn-chico btn-icono" data-gfh-fb="1">👍</button><button class="btn btn-chico btn-icono" data-gfh-fb="-1">👎</button><button class="btn btn-chico" id="gfh-descartar">Descartar</button></div></section>`
}

function engancharHueco(h) {
  const p = $('#gf-panel')
  const recargar = async (nuevo) => { if (nuevo?.id) { const i = gf.seguidos.findIndex((x) => x.id === nuevo.id); if (i >= 0) gf.seguidos[i] = nuevo; gf.hueco = nuevo } pintarPanel() }
  const accion = async (b, ruta, cuerpo = {}, msj) => { b.disabled = true; try { const r = await api(ruta, cuerpo); if (msj) toast(msj(r), 'suave'); await recargar(r.id ? r : await refrescarHueco(h.id)) } catch (e) { error(e) } finally { b.disabled = false } }
  $('#gfh-cerrar').onclick = () => { gf.hueco = null; gf.resaltar = null; pintarPanel(); dibujar() }
  const pr = $('#gfh-pregunta', p); if (pr) pr.onclick = () => accion(pr, `/grafos/huecos/${h.id}/pregunta`)
  const f = $('#gfh-resp', p)
  if (f) f.onsubmit = (e) => { e.preventDefault(); accion($('button', f), `/grafos/huecos/${h.id}/responder`, { texto: f.texto.value }, () => 'Guardada: tu respuesta es pieza tuya y quántomo para La Mano') }
  $('#gfh-agente').onclick = (e) => accion(e.target, `/grafos/huecos/${h.id}/investigar`, {}, (r) => r.guardadas?.length ? `El agente trajo ${r.guardadas.length} fuente${r.guardadas.length === 1 ? '' : 's'} al corpus` : (r.aviso ?? 'Nada nuevo'))
  $('#gfh-fragua').onclick = (e) => accion(e.target, `/grafos/huecos/${h.id}/fragua`, {}, () => 'Quedó como propuesta en La Fragua')
  $('#gfh-radar').onclick = (e) => accion(e.target, `/grafos/huecos/${h.id}/radar`, {}, (r) => r.nuevas?.length ? `El Radar encontró ${r.nuevas.length}: ${r.nuevas.slice(0, 3).join(' · ')}` : (r.aviso ?? 'El Radar no encontró nada nuevo'))
  $('#gfh-descartar').onclick = async () => { try { await api(`/grafos/huecos/${h.id}/descartar`, {}); gf.seguidos = gf.seguidos.filter((x) => x.id !== h.id); gf.hueco = null; gf.resaltar = null; pintarPanel(); dibujar() } catch (e) { error(e) } }
  $$('[data-gfh-fb]', p).forEach((b) => (b.onclick = async () => { try { await api('/devoluciones', { superficie: 'grafo', ref: h.id, valor: Number(b.dataset.gfhFb), nota: `${h.terminosA.slice(0, 3).join(', ')} ↔ ${h.terminosB.slice(0, 3).join(', ')}${h.pregunta ? ` — ${h.pregunta}` : ''}` }); $$('[data-gfh-fb]', p).forEach((x) => x.classList.toggle('on', x === b)); toast('Anotado', 'suave') } catch (e) { error(e) } }))
  $$('[data-pieza]', p).forEach((x) => (x.onclick = (e) => { e.preventDefault(); modalPieza(Number(x.dataset.pieza)) }))
}

async function refrescarHueco(id) {
  const r = await api(`/grafos/${gf.actual}`)
  gf.seguidos = r.huecos ?? []
  return gf.seguidos.find((x) => x.id === id) ?? null
}

// ─── quitar lo obvio, comparar, exportar ────────────────────────────────

async function quitarObvio(k) {
  if (!gf.foto) return
  gf.sel = []; gf.camino = null; gf.resaltar = null
  if (!k) { gf.mostrado = gf.foto; gf.quitados = null; pintarPanel(); return dibujar() }
  avisoEstado(`Sacando las ${k} bisagras y volviendo a medir…`)
  try { const r = await api(`/grafos/fotos/${gf.foto.id}/sin`, { k }); gf.mostrado = r; gf.quitados = r.quitados } catch (e) { error(e) }
  avisoEstado('')
  pintarPanel(); dibujar()
}

async function comparar(fotoId) {
  if (!fotoId || !gf.foto) { gf.diff = null; return pintarPanel() }
  try { gf.diff = await api(`/grafos/diff?a=${fotoId}&b=${gf.foto.id}`); pintarPanel() } catch (e) { error(e) }
}

function diffHTML(d) {
  const fecha = (t) => new Date(t).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
  const lista = (xs) => xs.map((t) => esc(t.join ? t.slice(0, 4).join(', ') : t)).join(' · ')
  const m = Object.entries(d.metricas).map(([k, v]) => `<span>${k} <b>${v.antes} → ${v.ahora}</b></span>`).join('')
  return `<section><div class="aca-sec-cab"><h3>Del ${fecha(d.desde)} al ${fecha(d.hasta)}</h3><button class="btn btn-chico" id="gf-cerrar-diff">✕</button></div>
    <div class="gf-metricas">${m}</div>
    ${d.nacieron.length ? `<h4>Nacieron</h4><p class="chico">${d.nacieron.map((c) => `[${c.top.slice(0, 4).map(esc).join(', ')}]`).join(' · ')}</p>` : ''}
    ${d.murieron.length ? `<h4>Se apagaron</h4><p class="chico">${d.murieron.map((c) => `[${c.top.slice(0, 4).map(esc).join(', ')}]`).join(' · ')}</p>` : ''}
    ${d.juntaron.length ? `<h4>Se juntaron</h4>${d.juntaron.map((j) => `<p class="chico">${j.eran.map((e) => `[${lista(e)}]`).join(' + ')} → [${lista(j.top)}]</p>`).join('')}` : ''}
    ${d.partieron.length ? `<h4>Se partieron</h4>${d.partieron.map((p) => `<p class="chico">[${lista(p.de)}] → ${p.en.map((e) => `[${lista(e)}]`).join(' + ')}</p>`).join('')}` : ''}
    ${d.bisagrasSuben.length ? `<h4>Bisagras que suben</h4><p class="chico">${d.bisagrasSuben.map(esc).join(' · ')}</p>` : ''}
    ${d.bisagrasBajan.length ? `<h4>Bisagras que bajan</h4><p class="chico">${d.bisagrasBajan.map(esc).join(' · ')}</p>` : ''}
    ${d.nuevos.length ? `<h4>Conceptos nuevos</h4><p class="chico">${d.nuevos.map(esc).join(' · ')}</p>` : ''}
    ${!d.nacieron.length && !d.murieron.length && !d.juntaron.length && !d.partieron.length ? '<p class="tenue">Los grupos son los mismos.</p>' : ''}</section>`
}

function exportarPng() {
  const cv = gf.lienzo
  if (!cv) return
  const copia = document.createElement('canvas')
  copia.width = cv.width; copia.height = cv.height
  const c = copia.getContext('2d')
  c.fillStyle = gf.colorFondo || '#111'; c.fillRect(0, 0, copia.width, copia.height)
  c.drawImage(cv, 0, 0)
  const a = document.createElement('a')
  a.download = `grafo-${sinTildesG(gf.titulo ?? gf.grafos.find((g) => g.id === gf.actual)?.nombre ?? 'grafo').replace(/[^a-z0-9]+/g, '-')}.png`
  a.href = copia.toDataURL('image/png')
  a.click()
}

/** Abrir el grafo de algo (una entidad, un dominio, un cuaderno, una charla): lo arma si no existe. */
async function abrirGrafoDe(fuente, nombre) {
  try { const g = await api('/grafos/de', { fuente, nombre }); gf.actual = g.id; gf.sel = []; gf.ocultas.clear(); irA('grafo') } catch (e) { error(e) }
}

// ─── Mis grafos: crear, el diccionario y analizar un texto ──────────────

async function montarGrafos() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Mis grafos</h1><p>«Tu voz» es tu memoria (lo tuyo y lo que sellaste); «Todo», el corpus entero. Armá otros sumando entidades, charlas, dominios, cuadernos, épocas o texto.</p></div>
    <div class="fila aca-acciones"><button class="btn btn-primario" id="gfs-nuevo">＋ Nuevo grafo</button><button class="btn" id="gfs-texto">Analizar un texto</button></div>
    <div id="gfs-lista"></div>
    <section class="seccion"><h3>Diccionario</h3><p class="tenue chico">Lo que frenás no entra; lo que protegés no se corta ni se saca; un alias junta dos formas en un concepto («barquito» → «barco»).</p><div id="gfs-dic"></div></section>`
  $('#gfs-nuevo').onclick = () => modalNuevoGrafo()
  $('#gfs-texto').onclick = modalAnalizarTexto
  pintarGrafos()
}

async function pintarGrafos() {
  let gs, dic
  try { [gs, dic] = await Promise.all([api('/grafos'), api('/grafos/diccionario')]) } catch (e) { return error(e) }
  gf.grafos = gs.grafos
  const TIPO = { entidad: 'entidad', conversacion: 'charla', dominio: 'dominio', cuaderno: 'cuaderno', piezas: 'piezas', texto: 'texto', epoca: 'época' }
  $('#gfs-lista').innerHTML = `<div class="aca-grid">${gs.grafos.map((g) => `<article class="naipe aca-naipe" data-madurez="${g.tipo === 'voz' ? 'nucleo' : g.tipo === 'todo' ? 'sellado' : 'pesado'}">
    <header><h3><a href="#" data-gfs-abrir="${g.id}">${esc(g.nombre)}</a></h3>${g.foto ? `<span class="chip">${esc(g.foto.metricas.estado)}</span>` : ''}</header>
    <p class="chico tenue">${g.tipo === 'voz' ? 'Lo tuyo y lo que sellaste, con vos en el centro.' : g.tipo === 'todo' ? 'Todo el corpus (una muestra pareja).' : g.fuentes.map((f) => TIPO[f.tipo] ?? f.tipo).join(' · ')}</p>
    <p class="chico">${g.foto ? `${g.foto.metricas.n} conceptos · ${g.foto.metricas.comunidades} grupos · ${new Date(g.foto.en).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}` : '<span class="tenue">Sin calcular todavía</span>'}${g.calculando ? ' · calculando…' : ''}</p>
    <div class="fila"><button class="btn btn-chico btn-primario" data-gfs-abrir="${g.id}">Ver</button>${g.tipo === 'propio' ? `<button class="btn btn-chico" data-gfs-editar="${g.id}">Editar</button><button class="btn btn-chico" data-gfs-borrar="${g.id}">Borrar</button>` : ''}</div></article>`).join('')}</div>`
  $$('[data-gfs-abrir]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); gf.actual = Number(b.dataset.gfsAbrir); gf.titulo = null; irA('grafo') }))
  $$('[data-gfs-editar]').forEach((b) => (b.onclick = () => modalNuevoGrafo(gs.grafos.find((g) => g.id === Number(b.dataset.gfsEditar)))))
  $$('[data-gfs-borrar]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('¿Borrar este grafo?', { detalle: 'Se borra el grafo y sus fotos; tus textos quedan.', si: 'Borrar', peligro: true }))) return
    try { await api(`/grafos/${b.dataset.gfsBorrar}`, { borrar: true }); pintarGrafos() } catch (e) { error(e) }
  }))
  const DICT = { stop: 'frenada', proteger: 'protegida', alias: 'alias' }
  $('#gfs-dic').innerHTML = `<form class="fila" id="gfs-dic-form"><input class="campo-suelto" name="forma" placeholder="palabra" required><select class="campo-suelto" name="tipo"><option value="stop">Frenar</option><option value="proteger">Proteger</option><option value="alias">Alias de…</option></select><input class="campo-suelto" name="destino" placeholder="se junta con (para alias)"><button class="btn btn-chico">Sumar</button></form>
    ${dic.entradas.length ? `<ul class="gfs-dic">${dic.entradas.map((e) => `<li><b>${esc(e.forma)}</b> <span class="chip">${DICT[e.tipo] ?? e.tipo}</span>${e.destino ? ` → ${esc(e.destino)}` : ''} <button class="btn btn-chico btn-icono" data-gfs-quitar="${esc(e.forma)}" title="Sacar del diccionario">✕</button></li>`).join('')}</ul>` : '<p class="tenue chico">Vacío.</p>'}
    <p class="tenue chico">Los cambios se ven al recalcular (↻ en el grafo, o solo a la madrugada).</p>`
  $('#gfs-dic-form').onsubmit = async (e) => { e.preventDefault(); try { await api('/grafos/diccionario', Object.fromEntries(new FormData(e.target))); pintarGrafos() } catch (err) { error(err) } }
  $$('[data-gfs-quitar]').forEach((b) => (b.onclick = async () => { try { await api('/grafos/diccionario', { forma: b.dataset.gfsQuitar, tipo: null }); pintarGrafos() } catch (e) { error(e) } }))
}

/** Crear (o editar) un grafo sumando fuentes. */
async function modalNuevoGrafo(g = null) {
  const fuentes = [...(g?.fuentes ?? [])]
  const nombres = new Map()
  const NOMBRE = (f) => nombres.get(JSON.stringify(f)) ?? (f.tipo === 'texto' ? `texto: ${(f.titulo || f.texto).slice(0, 30)}…` : f.tipo === 'epoca' ? `época ${f.desde} → ${f.hasta}` : `${f.tipo} #${f.id ?? ''}`)
  let modo = 'entidad'
  const pintar = () => {
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${g ? 'Editar el grafo' : 'Un grafo nuevo'}</h2>
      <label class="campo">Nombre<input id="gfn-nombre" value="${esc(g?.nombre ?? '')}" placeholder="Ej.: Todo sobre el proyecto X"></label>
      <h4>Fuentes</h4><ul class="gfn-fuentes">${fuentes.map((f, i) => `<li>${esc(NOMBRE(f))} <button class="btn btn-chico btn-icono" data-gfn-quitar="${i}">✕</button></li>`).join('') || '<li class="tenue">Ninguna todavía.</li>'}</ul>
      <div class="tabs">${[['entidad', 'Entidad'], ['conversacion', 'Charla'], ['dominio', 'Dominio'], ['cuaderno', 'Cuaderno'], ['epoca', 'Época'], ['texto', 'Texto']].map(([k, n]) => `<button data-gfn-modo="${k}" class="${modo === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div id="gfn-elegir" class="mt-3"></div>
      <div class="fila mt-3"><button class="btn btn-primario" id="gfn-listo" ${fuentes.length ? '' : 'disabled'}>${g ? 'Guardar' : 'Crear y ver'}</button></div>`)
    $$('[data-gfn-modo]').forEach((b) => (b.onclick = () => { modo = b.dataset.gfnModo; g = g && { ...g, nombre: $('#gfn-nombre').value }; pintar() }))
    $$('[data-gfn-quitar]').forEach((b) => (b.onclick = () => { fuentes.splice(Number(b.dataset.gfnQuitar), 1); pintar() }))
    $('#gfn-listo').onclick = async () => {
      const nombre = $('#gfn-nombre').value.trim() || fuentes.map(NOMBRE).slice(0, 3).join(' + ')
      try {
        const r = g ? await api(`/grafos/${g.id}`, { nombre, fuentes }) : await api('/grafos', { nombre, fuentes })
        cerrarModal()
        if (g) { await api(`/grafos/${g.id}/recalcular`, { forzar: true }).catch(() => {}); return pintarGrafos() }
        gf.actual = r.id; gf.titulo = null; irA('grafo')
      } catch (e) { error(e) }
    }
    const caja = $('#gfn-elegir')
    const sumar = (f, nombre) => { if (!fuentes.some((x) => JSON.stringify(x) === JSON.stringify(f))) { fuentes.push(f); nombres.set(JSON.stringify(f), nombre) } pintar() }
    const buscador = async (placeholder, traer) => {
      caja.innerHTML = `<input class="campo-suelto" id="gfn-q" placeholder="${placeholder}" data-sin-menciones><div class="aca-obras" id="gfn-res"></div>`
      let t
      const ir = async () => { try { const xs = await traer($('#gfn-q').value.trim()); $('#gfn-res').innerHTML = xs.map((x, i) => `<button type="button" class="aca-obra" data-gfn-i="${i}"><b>${esc(x.nombre)}</b>${x.sub ? `<small class="tenue">${esc(x.sub)}</small>` : ''}</button>`).join('') || '<p class="tenue chico">Nada.</p>'; $$('[data-gfn-i]').forEach((b) => (b.onclick = () => { const x = xs[Number(b.dataset.gfnI)]; sumar(x.fuente, x.nombre) })) } catch (e) { error(e) } }
      $('#gfn-q').oninput = () => { clearTimeout(t); t = setTimeout(ir, 250) }
      ir()
    }
    if (modo === 'entidad') buscador('Una persona, un proyecto, un lugar…', async (q) => (await api(`/entidades?${new URLSearchParams({ q, limite: 15 })}`)).entidades.map((e) => ({ nombre: e.nombre, sub: e.tipo, fuente: { tipo: 'entidad', id: e.id } })))
    else if (modo === 'conversacion') buscador('Filtrar charlas…', async (q) => (await api('/chat')).filter((c) => !q || sinTildesG(c.titulo ?? '').includes(sinTildesG(q))).slice(0, 20).map((c) => ({ nombre: c.titulo || `Charla #${c.id}`, sub: new Date(c.actualizadaEn ?? c.creadaEn).toLocaleDateString('es-AR'), fuente: { tipo: 'conversacion', id: c.id } })))
    else if (modo === 'dominio') buscador('Filtrar dominios…', async (q) => (await api('/academia')).dominios.filter((d) => !q || sinTildesG(d.tema).includes(sinTildesG(q))).map((d) => ({ nombre: d.tema, sub: `nivel ${d.tutorNivel}`, fuente: { tipo: 'dominio', id: d.id } })))
    else if (modo === 'cuaderno') buscador('Filtrar cuadernos…', async (q) => (await api('/cuadernos')).filter((c) => !q || sinTildesG(c.titulo).includes(sinTildesG(q))).map((c) => ({ nombre: c.titulo, sub: c.descripcion ?? '', fuente: { tipo: 'cuaderno', id: c.id } })))
    else if (modo === 'epoca') {
      caja.innerHTML = '<div class="fila"><label class="campo">Desde<input type="date" id="gfn-desde"></label><label class="campo">Hasta<input type="date" id="gfn-hasta"></label><button class="btn btn-chico" id="gfn-epoca">Sumar</button></div><p class="tenue chico">Tus textos de esa época.</p>'
      $('#gfn-epoca').onclick = () => { const desde = $('#gfn-desde').value, hasta = $('#gfn-hasta').value; if (desde && hasta) sumar({ tipo: 'epoca', desde, hasta }, `época ${desde} → ${hasta}`) }
    } else {
      caja.innerHTML = '<label class="campo">Título<input id="gfn-tt"></label><textarea class="campo-suelto" id="gfn-texto" rows="6" placeholder="Pegá un texto"></textarea><button class="btn btn-chico mt-3" id="gfn-sumar-texto">Sumar</button>'
      $('#gfn-sumar-texto').onclick = () => { const texto = $('#gfn-texto').value.trim(); if (texto.length > 40) sumar({ tipo: 'texto', texto, titulo: $('#gfn-tt').value.trim() || undefined }, `texto: ${($('#gfn-tt').value.trim() || texto).slice(0, 30)}…`) }
    }
  }
  pintar()
}

function modalAnalizarTexto() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Analizar un texto</h2><p class="tenue">El grafo de un texto suelto, al instante (no se guarda): sus grupos de ideas, sus bisagras y sus huecos.</p>
    <textarea class="campo-suelto" id="gft-texto" rows="10" placeholder="Pegá un texto (un artículo, un borrador, una charla)"></textarea><div class="fila mt-3"><button class="btn btn-primario" id="gft-ir">Ver su grafo</button></div>`)
  $('#gft-ir').onclick = async () => {
    const b = $('#gft-ir'); b.disabled = true
    try { const r = await api('/grafos/texto', { texto: $('#gft-texto').value }); cerrarModal(); gf.actual = null; gf.foto = null; gf.mostrado = r; gf.titulo = 'Texto analizado'; gf.sel = []; gf.ocultas.clear(); irA('grafo') } catch (e) { error(e) } finally { b.disabled = false }
  }
}

// ─── la salud (la historia de las métricas; la fase 6 suma el aviso) ────

async function montarGrafoSalud() {
  $('#principal').innerHTML = `<div class="titulo"><h1>La salud de tu corpus</h1><p>Cómo está tu discurso (lo que medís en tu texto, no en tu cabeza): si tus grupos de ideas están marcados, si uno domina, si está todo conectado y si la influencia está repartida. Ningún estado es «el bueno»: un manifiesto quiere estar sesgado, una memoria probablemente diversificada.</p></div><div id="gfh-cuerpo"><p class="tenue">Juntando…</p></div>`
  try {
    const { grafos } = await api('/grafos')
    const voz = grafos.find((g) => g.tipo === 'voz')
    const r = await api(`/grafos/${voz.id}`)
    const h = r.historia
    $('#gfh-cuerpo').innerHTML = `<section class="seccion"><h3>Tu voz, hoy: ${esc(r.foto?.metricas.estado ?? '—')}</h3><p>${esc(ESTADOS[r.foto?.metricas.estado] ?? '')}</p><p class="tenue chico">Los umbrales de los estados vienen de la literatura y se calibran con tu historia (con un mes de fotos ya dicen algo tuyo).</p></section>
      <section class="seccion"><h3>La historia</h3>${h.length ? `<table class="rev-tabla"><thead><tr><th>Foto</th><th>Textos</th><th>Conceptos</th><th>M</th><th>C1</th><th>C2</th><th>E</th><th>Estado</th></tr></thead><tbody>${h.map((x) => `<tr><td>${new Date(x.en).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</td><td>${x.documentos}</td><td>${x.metricas?.n ?? '—'}</td><td>${x.metricas?.M ?? '—'}</td><td>${x.metricas ? Math.round(x.metricas.C1 * 100) + '%' : '—'}</td><td>${x.metricas ? Math.round(x.metricas.C2 * 100) + '%' : '—'}</td><td>${x.metricas?.E ?? '—'}</td><td>${esc(x.metricas?.estado ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="tenue">Todavía una sola foto.</p>'}</section>`
  } catch (e) { error(e) }
}
