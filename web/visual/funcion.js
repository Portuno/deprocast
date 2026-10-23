'use strict'
// El dibujante de funciones (plan v24): curvas y = f(x; parámetros) en un canvas, con deslizadores para los parámetros,
// puntos notables marcados y, al pasar el mouse, el valor de cada curva en ese x.

;(function () {
  const d = V.d
  if (!d || !Array.isArray(d.curvas) || !d.curvas.length) return V.error('Este visual no tiene datos.')
  const { escenario, panel, controles } = V.armar({ titulo: d.titulo, uso: 'Mové los deslizadores y mirá cómo cambia la curva. Pasá el mouse para leer valores.' })
  const COLORES = ['#d9b45a', '#56ccf2', '#eb5757', '#6fcf97']
  const params = Object.fromEntries((d.parametros || []).map((p) => [p.nombre, p.valor]))
  const vars = ['x', ...(d.parametros || []).map((p) => p.nombre)]
  const curvas = d.curvas.map((c, i) => { try { return { ...c, f: V.compilar(c.expr, vars), color: COLORES[i % COLORES.length] } } catch { return null } }).filter(Boolean)
  if (!curvas.length) return V.error('No pude calcular ninguna curva.')
  const canvas = V.el('canvas')
  escenario.append(canvas)
  const ctx = canvas.getContext('2d')
  let raton = null
  const evaluar = (c, x) => { const y = c.f({ ...params, x }); return Number.isFinite(y) ? y : NaN }

  // El rango de y: el pedido, o el que muestra bien las curvas con los parámetros de arranque (con «Reajustar»).
  let yr = null
  function ajustarY() {
    if (d.y && d.y.min != null && d.y.max != null) return (yr = [d.y.min, d.y.max])
    let lo = Infinity, hi = -Infinity
    for (const c of curvas) for (let k = 0; k <= 400; k++) { const y = evaluar(c, d.x.min + ((d.x.max - d.x.min) * k) / 400); if (Number.isFinite(y) && Math.abs(y) < 1e9) { lo = Math.min(lo, y); hi = Math.max(hi, y) } }
    if (!Number.isFinite(lo)) { lo = -1; hi = 1 }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
    const m = (hi - lo) * 0.1
    yr = [lo - m, hi + m]
  }
  ajustarY()

  const paso = (r) => { const b = Math.pow(10, Math.floor(Math.log10(r / 5))); return [1, 2, 5, 10].map((k) => k * b).find((s) => r / s <= 8) }
  function dibujar() {
    const dpr = window.devicePixelRatio || 1
    const W = escenario.clientWidth, H = Math.max(260, escenario.clientHeight)
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const m = { i: 46, d: 14, a: 14, b: 32 }
    const X = (x) => m.i + ((x - d.x.min) / (d.x.max - d.x.min)) * (W - m.i - m.d)
    const Y = (y) => H - m.b - ((y - yr[0]) / (yr[1] - yr[0])) * (H - m.a - m.b)
    // La grilla y los ejes.
    ctx.font = '11px system-ui'
    ctx.lineWidth = 1
    const px = paso(d.x.max - d.x.min), py = paso(yr[1] - yr[0])
    for (let x = Math.ceil(d.x.min / px) * px; x <= d.x.max + 1e-9; x += px) {
      ctx.strokeStyle = Math.abs(x) < px / 1e6 ? '#5b6270' : '#252a33'
      ctx.beginPath(); ctx.moveTo(X(x), m.a); ctx.lineTo(X(x), H - m.b); ctx.stroke()
      ctx.fillStyle = '#9a9a96'; ctx.textAlign = 'center'; ctx.fillText(V.fmt(+x.toFixed(10)), X(x), H - m.b + 14)
    }
    for (let y = Math.ceil(yr[0] / py) * py; y <= yr[1] + 1e-9; y += py) {
      ctx.strokeStyle = Math.abs(y) < py / 1e6 ? '#5b6270' : '#252a33'
      ctx.beginPath(); ctx.moveTo(m.i, Y(y)); ctx.lineTo(W - m.d, Y(y)); ctx.stroke()
      ctx.fillStyle = '#9a9a96'; ctx.textAlign = 'right'; ctx.fillText(V.fmt(+y.toFixed(10)), m.i - 6, Y(y) + 4)
    }
    ctx.fillStyle = '#9a9a96'; ctx.textAlign = 'right'; ctx.fillText(d.x.etiqueta || 'x', W - m.d, H - 4)
    ctx.textAlign = 'left'; ctx.fillText(d.y.etiqueta || 'y', m.i + 4, m.a + 10)
    // Las curvas: se cortan donde no existen (una asíntota, una raíz negativa).
    ctx.save(); ctx.beginPath(); ctx.rect(m.i, m.a, W - m.i - m.d, H - m.a - m.b); ctx.clip()
    for (const c of curvas) {
      ctx.strokeStyle = c.color; ctx.lineWidth = 2.4; ctx.beginPath()
      let dentro = false, yAnt = null
      const n = Math.max(200, W)
      for (let k = 0; k <= n; k++) {
        const x = d.x.min + ((d.x.max - d.x.min) * k) / n
        const y = evaluar(c, x)
        const salto = yAnt != null && Math.abs(y - yAnt) > (yr[1] - yr[0]) * 2
        if (!Number.isFinite(y) || salto) { dentro = false; yAnt = Number.isFinite(y) ? y : null; continue }
        if (dentro) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y))
        dentro = true; yAnt = y
      }
      ctx.stroke()
    }
    // Los puntos notables.
    for (const p of d.puntos || []) {
      ctx.strokeStyle = '#9a9a96'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(p.x), m.a); ctx.lineTo(X(p.x), H - m.b); ctx.stroke(); ctx.setLineDash([])
      const y = evaluar(curvas[0], p.x)
      if (Number.isFinite(y)) { ctx.fillStyle = curvas[0].color; ctx.beginPath(); ctx.arc(X(p.x), Y(y), 4.5, 0, 7); ctx.fill() }
      if (p.etiqueta) { ctx.fillStyle = '#e8e6e1'; ctx.textAlign = 'left'; ctx.fillText(p.etiqueta, X(p.x) + 6, m.a + 24) }
    }
    // Lo que está bajo el mouse.
    if (raton && raton.x >= m.i && raton.x <= W - m.d) {
      const x = d.x.min + ((raton.x - m.i) / (W - m.i - m.d)) * (d.x.max - d.x.min)
      ctx.strokeStyle = '#d9b45a55'; ctx.beginPath(); ctx.moveTo(raton.x, m.a); ctx.lineTo(raton.x, H - m.b); ctx.stroke()
      const lineas = curvas.map((c) => { const y = evaluar(c, x); if (Number.isFinite(y)) { ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(raton.x, Y(y), 4, 0, 7); ctx.fill() } return [c, y] })
      lectura.replaceChildren(V.el('b', {}, `${d.x.etiqueta || 'x'} = ${V.fmt(x)}`), ...lineas.map(([c, y]) => V.el('div', {}, V.el('span', { class: 'v-color', 'data-c': c.color }, '■ '), `${c.etiqueta || c.expr}: ${V.fmt(y)}`)))
      lectura.querySelectorAll('.v-color').forEach((s) => (s.style.color = s.dataset.c))
    }
    ctx.restore()
  }

  // El panel: qué mirar, las curvas y lo que marca el mouse.
  const lectura = V.el('div', { class: 'v-tenue' }, 'Pasá el mouse (o el dedo) por la gráfica.')
  V.explicar(panel, d.titulo || 'La función', d.explica || '', V.el('ul', {}, ...curvas.map((c) => { const li = V.el('li', {}, `${c.etiqueta ? `${c.etiqueta}: ` : ''}`, V.el('code', {}, `y = ${c.expr}`)); li.style.color = c.color; return li })), lectura)
  for (const p of d.parametros || []) controles.append(V.deslizador({ etiqueta: p.etiqueta || p.nombre, min: p.min, max: p.max, paso: p.paso, valor: p.valor }, (v) => { params[p.nombre] = v; dibujar() }))
  if (!(d.y && d.y.min != null)) controles.append(V.boton('Reajustar', () => { ajustarY(); dibujar() }, { title: 'Ajusta el alto a las curvas de ahora' }))
  const mover = (e) => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; raton = { x: t.clientX - r.left, y: t.clientY - r.top }; dibujar() }
  canvas.addEventListener('mousemove', mover)
  canvas.addEventListener('touchmove', mover, { passive: true })
  canvas.addEventListener('mouseleave', () => { raton = null; dibujar() })
  new ResizeObserver(dibujar).observe(escenario)
  dibujar()
})()
