'use strict'
// El dibujante de moléculas (plan v24), sin librerías: una proteína real (los Cα de su PDB, que el servidor ya metió en
// los datos) como cadena gruesa coloreada por estructura (hélices, láminas, lazos), o una molécula chica con sus átomos
// y enlaces. Se rota arrastrando, se acerca con la rueda o pellizcando, y el plegado va de la cadena estirada a la
// estructura real.

;(function () {
  const d = V.d
  const proteina = Array.isArray(d.cadena) && d.cadena.length > 2
  if (!proteina && !(Array.isArray(d.atomos) && d.atomos.length > 1)) return V.error('Este visual no tiene datos.')
  const { escenario, panel, controles } = V.armar({ titulo: d.titulo || d.nombrePdb, uso: 'Arrastrá para rotar, rueda o pellizco para acercar. Tocá un punto para ver qué es.' })
  const canvas = V.el('canvas')
  escenario.append(canvas)
  const ctx = canvas.getContext('2d')
  const SS = { H: ['#d65db1', 'Hélice α'], E: ['#f2c94c', 'Lámina β'], C: ['#8a93a3', 'Lazo'] }
  const CPK = { H: '#e8e6e1', C: '#7d8590', N: '#4f7cff', O: '#eb5757', S: '#f2c94c', P: '#f2994a', F: '#6fcf97', Cl: '#6fcf97', Br: '#a0522d', I: '#9b51e0', Na: '#9b51e0', K: '#9b51e0', Ca: '#6fcf97', Mg: '#6fcf97', Fe: '#f2994a', Zn: '#8a93a3', Cu: '#f2994a' }
  const RADIO = { H: 0.32, C: 0.5, N: 0.5, O: 0.5, S: 0.62, P: 0.6 }

  // Los puntos: la estructura real y, para la proteína, la cadena estirada (para el plegado).
  const real = proteina ? d.cadena.map((a) => ({ x: a[0], y: a[1], z: a[2], ss: a[3], res: a[4], n: a[5], c: a[6] })) : d.atomos.map((a) => ({ x: a.x, y: a.y, z: a.z || 0, e: a.e }))
  const estirada = real.map((_, i) => ({ x: (i - real.length / 2) * 3.8 * Math.cos(0.3), y: (i % 2 ? 1 : -1) * 0.9, z: 0 }))
  // El tamaño: el radio que abarca al 95 % (un extremo suelto no achica todo lo demás).
  const radios = real.map((p) => Math.hypot(p.x, p.y, p.z)).sort((a, b) => a - b)
  const radioEstructura = radios[Math.floor(radios.length * 0.95)] || radios[radios.length - 1] || 1
  const residuos = (d.residuos || []).map((r) => ({ ...r, i: real.findIndex((p) => p.n === r.n && (!r.cadena || p.c === r.cadena)) })).filter((r) => r.i >= 0)

  let plegado = 1, rotY = 0.5, rotX = 0.3, zoom = 1, girando = true, elegido = -1, animPliegue = null
  const puntos = () => real.map((p, i) => (plegado >= 1 ? p : { ...p, x: estirada[i].x + (p.x - estirada[i].x) * plegado, y: estirada[i].y + (p.y - estirada[i].y) * plegado, z: estirada[i].z + (p.z - estirada[i].z) * plegado }))
  let proyectados = []

  function dibujar() {
    const dpr = window.devicePixelRatio || 1
    const W = escenario.clientWidth, H = Math.max(260, escenario.clientHeight)
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const escala = (Math.min(W, H) / 2.3 / (plegado < 1 ? Math.max(radioEstructura, (real.length * 3.8 * (1 - plegado)) / 2) : radioEstructura)) * zoom
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX)
    proyectados = puntos().map((p, i) => {
      const x1 = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy
      const y1 = p.y * cx - z1 * sx, z2 = p.y * sx + z1 * cx
      const persp = 1 / (1 + z2 / (radioEstructura * 6))
      return { i, X: W / 2 + x1 * escala * persp, Y: H / 2 - y1 * escala * persp, z: z2, s: persp }
    })
    const prof = (z) => 0.45 + 0.55 * (1 - (z / radioEstructura + 1) / 2)
    if (proteina) {
      // La cadena suavizada (Catmull-Rom entre Cα: la hélice se ve espiral y no serrucho), en tramos cortos dibujados de
      // atrás hacia adelante. Los cortes de cadena (otra cadena o un hueco) no se unen.
      const P = puntos()
      const proyectar = (p) => {
        const x1 = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy
        const y1 = p.y * cx - z1 * sx, z2 = p.y * sx + z1 * cx
        const persp = 1 / (1 + z2 / (radioEstructura * 6))
        return { X: W / 2 + x1 * escala * persp, Y: H / 2 - y1 * escala * persp, z: z2, s: persp }
      }
      const unido = (i) => i >= 0 && i < real.length - 1 && real[i].c === real[i + 1].c && Math.hypot(P[i].x - P[i + 1].x, P[i].y - P[i + 1].y, P[i].z - P[i + 1].z) < 4.6 + 30 * (1 - plegado)
      const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return ['x', 'y', 'z'].reduce((o, k) => ((o[k] = 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3)), o), {}) }
      const segs = []
      const N = 4
      for (let i = 0; i < real.length - 1; i++) {
        if (!unido(i)) continue
        const a = unido(i - 1) ? P[i - 1] : P[i], d = unido(i + 1) ? P[i + 2] : P[i + 1]
        const ss = real[i].ss === real[i + 1].ss ? real[i].ss : 'C'
        let prev = proyectar(P[i])
        for (let k = 1; k <= N; k++) {
          const q = proyectar(k === N ? P[i + 1] : cr(a, P[i], P[i + 1], d, k / N))
          segs.push([prev, q, ss, (prev.z + q.z) / 2])
          prev = q
        }
      }
      segs.sort((a, b) => b[3] - a[3])
      ctx.lineCap = 'round'
      for (const [a, b, ss, z] of segs) {
        ctx.globalAlpha = prof(z)
        ctx.strokeStyle = SS[ss][0]
        ctx.lineWidth = (ss === 'C' ? 2.6 : ss === 'H' ? 6.5 : 5.5) * a.s * Math.sqrt(zoom)
        ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke()
      }
      ctx.globalAlpha = 1
      for (const r of residuos) {
        const p = proyectados[r.i]
        ctx.fillStyle = r.i === elegido ? '#d9b45a' : '#f2f2f2'
        ctx.beginPath(); ctx.arc(p.X, p.Y, 5.5 * p.s, 0, 7); ctx.fill()
        ctx.font = '12px system-ui'; ctx.fillStyle = '#e8e6e1'; ctx.fillText(`${real[r.i].res}${real[r.i].n}`, p.X + 8, p.Y - 6)
      }
      if (elegido >= 0 && !residuos.some((r) => r.i === elegido)) { const p = proyectados[elegido]; ctx.strokeStyle = '#d9b45a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.X, p.Y, 7, 0, 7); ctx.stroke() }
    } else {
      // Enlaces y después átomos, por profundidad.
      const orden = proyectados.slice().sort((a, b) => b.z - a.z)
      for (const [i, j, o] of d.enlaces || []) {
        const a = proyectados[i], b = proyectados[j]
        ctx.strokeStyle = '#5b6270'; ctx.lineWidth = 3 * a.s
        const nx = -(b.Y - a.Y), ny = b.X - a.X, l = Math.hypot(nx, ny) || 1
        for (let k = 0; k < (o || 1); k++) {
          const off = ((k - ((o || 1) - 1) / 2) * 5) / l
          ctx.beginPath(); ctx.moveTo(a.X + nx * off, a.Y + ny * off); ctx.lineTo(b.X + nx * off, b.Y + ny * off); ctx.stroke()
        }
      }
      for (const p of orden) {
        const e = real[p.i].e
        const r = (RADIO[e] || 0.55) * escala * 0.55 * p.s
        const g = ctx.createRadialGradient(p.X - r / 3, p.Y - r / 3, r / 5, p.X, p.Y, r)
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, CPK[e] || '#8a93a3'); g.addColorStop(1, '#0d0f13')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.X, p.Y, r, 0, 7); ctx.fill()
        if (p.i === elegido) { ctx.strokeStyle = '#d9b45a'; ctx.lineWidth = 2; ctx.stroke() }
        if (r > 9) { ctx.fillStyle = '#101216'; ctx.font = `bold ${Math.min(14, r * 0.8)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(e, p.X, p.Y + 4); ctx.textAlign = 'left' }
      }
    }
  }

  // ─── tocar, rotar, acercar ─────────────────────────────────────────────
  let arrastre = null, pellizco = null
  canvas.addEventListener('pointerdown', (e) => { arrastre = { x: e.clientX, y: e.clientY, movio: false }; canvas.setPointerCapture(e.pointerId) })
  canvas.addEventListener('pointermove', (e) => {
    if (!arrastre || pellizco) return
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y
    if (Math.abs(dx) + Math.abs(dy) > 3) arrastre.movio = true
    rotY += dx * 0.01; rotX += dy * 0.01
    arrastre.x = e.clientX; arrastre.y = e.clientY
    girando = false; btnGiro.classList.remove('on')
    dibujar()
  })
  canvas.addEventListener('pointerup', (e) => {
    if (arrastre && !arrastre.movio) {
      const r = canvas.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      let mejor = -1, dist = 18
      for (const p of proyectados) { const dd = Math.hypot(p.X - x, p.Y - y); if (dd < dist) { dist = dd; mejor = p.i } }
      if (mejor >= 0) elegir(mejor)
    }
    arrastre = null
  })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.4, Math.min(5, zoom * (e.deltaY < 0 ? 1.12 : 0.89))); dibujar() }, { passive: false })
  canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pellizco = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) }, { passive: true })
  canvas.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && pellizco) { const dd = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); zoom = Math.max(0.4, Math.min(5, zoom * (dd / pellizco))); pellizco = dd; dibujar() } }, { passive: true })
  canvas.addEventListener('touchend', () => { pellizco = null })

  function elegir(i) {
    elegido = i
    const p = real[i]
    if (proteina) {
      const nota = residuos.find((r) => r.i === i)
      V.explicar(panel, `${p.res} ${p.n}${p.c ? ` · cadena ${p.c}` : ''}`, nota ? nota.nota : `Parte de un ${SS[p.ss][1].toLowerCase()}.`)
    } else {
      const enl = (d.enlaces || []).filter(([a, b]) => a === i || b === i).length
      V.explicar(panel, `Átomo de ${p.e}`, `${enl} enlace${enl === 1 ? '' : 's'}.`)
    }
    panel.append(V.boton('← Volver a la explicación', inicio))
    dibujar()
  }
  function inicio() {
    elegido = -1
    const leyenda = proteina ? V.el('ul', {}, ...Object.values(SS).map(([c, n]) => { const li = V.el('li', {}, n); li.style.color = c; return li })) : null
    const lista = residuos.length ? V.el('div', {}, V.el('p', { class: 'v-tenue' }, 'Residuos clave:'), ...residuos.map((r) => V.boton(`${real[r.i].res}${real[r.i].n}`, () => elegir(r.i)))) : null
    V.explicar(panel, d.titulo || d.nombrePdb || 'La molécula', d.explica || '', proteina ? V.el('p', { class: 'v-tenue' }, `${real.length} residuos${d.pdb ? ` · PDB ${d.pdb}` : ''}${d.nombrePdb && d.titulo !== d.nombrePdb ? ` · ${d.nombrePdb}` : ''}`) : null, leyenda, lista)
    dibujar()
  }

  // ─── el plegado (por pasos) y el giro ──────────────────────────────────
  const btnGiro = V.boton('⟳ Girar', () => { girando = !girando; btnGiro.classList.toggle('on', girando); if (girando) girar() }, { on: true })
  controles.append(btnGiro)
  if (proteina) {
    const desl = V.deslizador({ etiqueta: 'Plegado', min: 0, max: 1, paso: 0.01, valor: 1 }, (v) => { plegado = v; cancelAnimationFrame(animPliegue); dibujar() })
    const input = desl.querySelector('input')
    const ir = (hasta, texto) => {
      cancelAnimationFrame(animPliegue)
      const desde = plegado, t0 = performance.now(), dur = 2200 * Math.abs(hasta - desde) + 200
      if (texto) V.explicar(panel, 'Plegado', texto, V.boton('← Volver a la explicación', inicio))
      const paso = (t) => { const k = Math.min(1, (t - t0) / dur); plegado = desde + (hasta - desde) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2); input.value = plegado; input.dispatchEvent(new Event('input')); if (k < 1) animPliegue = requestAnimationFrame(paso) }
      animPliegue = requestAnimationFrame(paso)
    }
    controles.append(desl, V.boton('▶ Plegar desde cero', () => { plegado = 0; ir(1) }))
    ;(d.pasos || []).forEach((p, i) => controles.append(V.boton(`${i + 1}`, () => ir(p.plegado, p.texto), { title: p.texto })))
  }
  function girar() { if (!girando) return; rotY += 0.006; dibujar(); requestAnimationFrame(girar) }
  new ResizeObserver(dibujar).observe(escenario)
  inicio()
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) girar(); else { girando = false; btnGiro.classList.remove('on') }
})()
