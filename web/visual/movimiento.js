'use strict'
// El dibujante de movimientos (plan v24): una figura articulada que hace el ejercicio por fases (ángulos por
// articulación, interpolados), con los músculos que trabajan resaltados y los errores típicos al lado de la forma
// buena. De perfil mira a la derecha (el lado lejano, más oscuro); de frente, abre brazos y piernas.

;(function () {
  const d = V.d
  if (!d || !Array.isArray(d.fases) || d.fases.length < 2) return V.error('Este visual no tiene datos.')
  const { escenario, panel, controles } = V.armar({ titulo: d.titulo, uso: 'Play para verlo entero; tocá una fase para frenarla ahí. Los errores se ven al lado de la forma buena.' })
  const canvas = V.el('canvas')
  escenario.append(canvas)
  const ctx = canvas.getContext('2d')
  const frente = d.vista === 'frente'
  // Largos de cada segmento (en altos de cabeza, una persona de ~7,5 cabezas).
  const L = { cabeza: 0.5, cuello: 0.35, tronco: 2.6, muslo: 1.95, pierna: 1.85, pie: 0.9, brazo: 1.4, antebrazo: 1.3, hombros: 0.95, caderas: 0.6 }
  const rad = (g) => (g * Math.PI) / 180
  const ang = (pose, art, lado) => pose[art + lado] ?? pose[art] ?? 0
  const dir = (phi) => [Math.sin(rad(phi)), Math.cos(rad(phi))] // phi: desde «hacia abajo» (y de pantalla crece hacia abajo), + hacia adelante
  const mas = (p, v, l) => [p[0] + v[0] * l, p[1] + v[1] * l]

  /** Las articulaciones de un lado (perfil), con la cadera en el origen (y crece hacia abajo, como la pantalla). */
  function perfil(pose, lado) {
    const t = ang(pose, 'tronco', '')
    const cadera = [0, 0]
    const hombro = mas(cadera, dir(180 - t), L.tronco)
    const cuello = mas(hombro, dir(180 - t - ang(pose, 'cuello', '')), L.cuello)
    const muslo = -t + ang(pose, 'cadera', lado)
    const rodilla = mas(cadera, dir(muslo), L.muslo)
    const pierna = muslo - ang(pose, 'rodilla', lado)
    const tobillo = mas(rodilla, dir(pierna), L.pierna)
    const pie = mas(tobillo, dir(90 + Math.min(0, ang(pose, 'tobillo', lado))), L.pie)
    const brazo = -t + ang(pose, 'hombro', lado)
    const codo = mas(hombro, dir(brazo), L.brazo)
    const mano = mas(codo, dir(brazo + ang(pose, 'codo', lado)), L.antebrazo)
    return { cadera, hombro, cuello, rodilla, tobillo, pie, codo, mano }
  }
  /** De frente: el lado I a la izquierda de la pantalla; las flexiones acortan lo que se ve. */
  function deFrente(pose, lado) {
    const s = lado === 'I' ? -1 : 1
    const cadera = [s * L.caderas / 2, 0]
    const hombro = [s * L.hombros / 2, -L.tronco * Math.cos(rad(ang(pose, 'tronco', '')))]
    const cuello = [0, hombro[1] - L.cuello]
    const abdC = rad(ang(pose, 'caderaAbd', lado)), flexC = rad(ang(pose, 'cadera', lado))
    const rodilla = [cadera[0] + s * Math.sin(abdC) * L.muslo, cadera[1] + Math.cos(abdC) * L.muslo * Math.abs(Math.cos(flexC))]
    const flexR = rad(ang(pose, 'cadera', lado) - ang(pose, 'rodilla', lado))
    const tobillo = [rodilla[0] + s * Math.sin(abdC) * L.pierna * 0.3, rodilla[1] + L.pierna * Math.abs(Math.cos(flexR))]
    const pie = [tobillo[0] + s * 0.35, tobillo[1] + 0.05]
    const abdH = rad(ang(pose, 'hombroAbd', lado))
    const codo = [hombro[0] + s * Math.sin(abdH) * L.brazo, hombro[1] + Math.cos(abdH) * L.brazo]
    const flexCodo = rad(ang(pose, 'codo', lado))
    const mano = [codo[0] + s * Math.sin(abdH) * L.antebrazo * Math.cos(flexCodo), codo[1] + Math.cos(abdH) * L.antebrazo * Math.cos(flexCodo) - Math.sin(flexCodo) * L.antebrazo * 0.4]
    return { cadera, hombro, cuello, rodilla, tobillo, pie, codo, mano }
  }
  const figura = (pose) => {
    const I = (frente ? deFrente : perfil)(pose, 'I'), D = (frente ? deFrente : perfil)(pose, 'D')
    // Los pies al piso: lo más bajo de la figura toca el suelo.
    const piso = Math.max(...[I, D].flatMap((f) => [f.tobillo[1], f.pie[1]]))
    const bajar = (f) => Object.fromEntries(Object.entries(f).map(([k, p]) => [k, [p[0], p[1] - piso]]))
    return { I: bajar(I), D: bajar(D) }
  }

  // Los músculos: dónde se pintan (segmento, lado del segmento: adelante +1 / atrás −1).
  const MUSCULOS = [
    [/cuadri/, 'cadera', 'rodilla', 1], [/isquio|femoral/, 'cadera', 'rodilla', -1], [/glute/, 'cadera', 'rodilla', -1, 0.35], [/aductor/, 'cadera', 'rodilla', 0],
    [/gemel|pantorr|soleo|triceps sural/, 'rodilla', 'tobillo', -1], [/tibial/, 'rodilla', 'tobillo', 1],
    [/abdom|core|oblicu|recto/, 'cadera', 'hombro', 1], [/lumbar|erector|espinal|espalda baja/, 'cadera', 'hombro', -1, 0.5], [/dorsal|espalda/, 'hombro', 'cadera', -1, 0.6],
    [/pector/, 'hombro', 'cadera', 1, 0.35], [/trapec/, 'cuello', 'hombro', -1], [/deltoid|hombro/, 'hombro', 'codo', 0, 0.3],
    [/bicep/, 'hombro', 'codo', 1], [/tricep/, 'hombro', 'codo', -1], [/antebraz/, 'codo', 'mano', 0],
  ]
  const zonasDe = (nombres) => (nombres || []).flatMap((n) => { const m = MUSCULOS.find(([re]) => re.test(V.sinTildes(n))); return m ? [m] : [] })

  function dibujarFigura(f, x0, escala, piso, o = {}) {
    const P = (p) => [x0 + p[0] * escala, piso + p[1] * escala]
    for (const lado of ['I', 'D']) { // de perfil, el I va atrás (más oscuro)
      const j = f[lado]
      const lejos = !frente && lado === 'I'
      const color = o.color || (lejos ? '#6b7280' : '#e8e6e1')
      ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.lineWidth = escala * (lejos ? 0.28 : 0.34)
      const linea = (...ps) => { ctx.beginPath(); ps.forEach((p, k) => { const q = P(p); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]) }); ctx.stroke() }
      linea(j.cadera, j.rodilla, j.tobillo, j.pie)
      linea(j.hombro, j.codo, j.mano)
      // Los músculos que trabajan en esta fase (solo en el lado cercano de perfil; los dos de frente).
      if (o.musculos && !lejos) {
        for (const [, a, b, cara, largo] of o.musculos) {
          const pa = j[a], pb = j[b]
          if (!pa || !pb) continue
          const fin = largo ? [pa[0] + (pb[0] - pa[0]) * largo, pa[1] + (pb[1] - pa[1]) * largo] : pb
          const nx = -(fin[1] - pa[1]), ny = fin[0] - pa[0], l = Math.hypot(nx, ny) || 1
          const off = frente ? 0 : (cara * 0.16)
          ctx.strokeStyle = 'rgba(235, 87, 87, .75)'; ctx.lineWidth = escala * 0.2
          linea([pa[0] + (nx / l) * off, pa[1] + (ny / l) * off], [fin[0] + (nx / l) * off, fin[1] + (ny / l) * off])
          ctx.strokeStyle = color; ctx.lineWidth = escala * 0.34
        }
      }
    }
    // Tronco y cabeza (uno solo).
    const j = f.D, k = f.I
    ctx.strokeStyle = o.color || '#e8e6e1'; ctx.lineWidth = escala * 0.4
    const medio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const caderaM = frente ? medio(j.cadera, k.cadera) : j.cadera, hombroM = frente ? medio(j.hombro, k.hombro) : j.hombro
    ctx.beginPath(); ctx.moveTo(...P(caderaM)); ctx.lineTo(...P(hombroM)); ctx.stroke()
    if (frente) { ctx.lineWidth = escala * 0.3; ctx.beginPath(); ctx.moveTo(...P(k.hombro)); ctx.lineTo(...P(j.hombro)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(...P(k.cadera)); ctx.lineTo(...P(j.cadera)); ctx.stroke() }
    if (o.musculos) for (const [, a, b, cara, largo] of o.musculos) {
      if (!((a === 'cadera' && b === 'hombro') || (a === 'hombro' && b === 'cadera'))) continue
      const pa = a === 'cadera' ? caderaM : hombroM, pb = b === 'cadera' ? caderaM : hombroM
      const fin = largo ? [pa[0] + (pb[0] - pa[0]) * largo, pa[1] + (pb[1] - pa[1]) * largo] : pb
      const nx = -(fin[1] - pa[1]), ny = fin[0] - pa[0], l = Math.hypot(nx, ny) || 1, off = frente ? 0 : cara * 0.22
      ctx.strokeStyle = 'rgba(235, 87, 87, .75)'; ctx.lineWidth = escala * 0.24
      ctx.beginPath(); ctx.moveTo(...P([pa[0] + (nx / l) * off, pa[1] + (ny / l) * off])); ctx.lineTo(...P([fin[0] + (nx / l) * off, fin[1] + (ny / l) * off])); ctx.stroke()
    }
    const c = j.cuello, cab = frente ? [0, c[1] - L.cabeza * 0.9] : [c[0] + (c[0] - hombroM[0]) * 0.6, c[1] + (c[1] - hombroM[1]) * 0.6 - 0.1]
    ctx.strokeStyle = o.color || '#e8e6e1'; ctx.lineWidth = escala * 0.3
    ctx.beginPath(); ctx.moveTo(...P(hombroM)); ctx.lineTo(...P(cab)); ctx.stroke()
    ctx.fillStyle = o.color || '#e8e6e1'
    ctx.beginPath(); ctx.arc(...P(cab), escala * L.cabeza * 0.62, 0, 7); ctx.fill()
    if (o.rotulo) { ctx.fillStyle = o.color || '#e8e6e1'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText(o.rotulo, x0, piso + escala * 0.9); ctx.textAlign = 'left' }
  }

  // ─── el tiempo ─────────────────────────────────────────────────────────
  const fases = d.fases
  let t = 0, play = true, velocidad = 1, fija = null, error = null, ultimo = performance.now()
  const total = fases.reduce((s, f) => s + f.ms, 0)
  const suave = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
  function poseEn(tt) {
    // Cada fase llega a su pose en su tiempo; desde la anterior (la última vuelve a la primera).
    let acum = 0
    for (let i = 0; i < fases.length; i++) {
      if (tt < acum + fases[i].ms) {
        const a = fases[(i - 1 + fases.length) % fases.length].pose, b = fases[i].pose, k = suave((tt - acum) / fases[i].ms)
        const claves = new Set([...Object.keys(a), ...Object.keys(b)])
        return { i, pose: Object.fromEntries([...claves].map((c) => [c, (a[c] ?? b[c] ?? 0) + ((b[c] ?? a[c] ?? 0) - (a[c] ?? b[c] ?? 0)) * k])) }
      }
      acum += fases[i].ms
    }
    return { i: fases.length - 1, pose: fases[fases.length - 1].pose }
  }

  function dibujar() {
    const dpr = window.devicePixelRatio || 1
    const W = escenario.clientWidth, H = Math.max(260, escenario.clientHeight)
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const piso = H - 40
    ctx.strokeStyle = '#2a2f38'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, piso + 2); ctx.lineTo(W, piso + 2); ctx.stroke()
    const dosFiguras = !!error
    const escala = Math.min((H - 70) / 8.2, (dosFiguras ? W / 2 : W) / 6.5)
    if (error) {
      const f = fases[error.fase]
      dibujarFigura(figura(f.pose), W * 0.27, escala, piso, { color: '#6fcf97', rotulo: '✓ Así' })
      dibujarFigura(figura({ ...f.pose, ...error.pose }), W * 0.73, escala, piso, { color: '#eb5757', rotulo: `✗ ${error.nombre}` })
      return
    }
    const actual = fija != null ? { i: fija, pose: fases[fija].pose } : poseEn(t)
    dibujarFigura(figura(actual.pose), W / 2 + (frente ? 0 : -escala * 0.6), escala, piso, { musculos: zonasDe(fases[actual.i].musculos) })
    if (actual.i !== faseMostrada) mostrarFase(actual.i)
  }
  let faseMostrada = -1
  function mostrarFase(i) {
    faseMostrada = i
    const f = fases[i]
    botonesFase.forEach((b, k) => b.classList.toggle('on', k === i))
    V.explicar(panel, `${i + 1}. ${f.nombre}`, f.cue || '', f.musculos?.length ? V.el('p', {}, V.el('b', {}, 'Trabajan: '), f.musculos.join(', ')) : null, d.explica ? V.el('p', { class: 'v-tenue' }, d.explica) : null)
  }

  function cuadro(ahora) {
    if (play && fija == null && !error) t = (t + (ahora - ultimo) * velocidad) % total
    ultimo = ahora
    dibujar()
    requestAnimationFrame(cuadro)
  }

  // ─── controles ─────────────────────────────────────────────────────────
  const btnPlay = V.boton('⏸ Pausa', () => { play = !play; fija = null; error = null; btnPlay.textContent = play ? '⏸ Pausa' : '▶ Play' })
  const botonesFase = fases.map((f, i) => V.boton(`${i + 1}. ${f.nombre}`, () => { fija = fija === i ? null : i; error = null; play = fija == null; btnPlay.textContent = play ? '⏸ Pausa' : '▶ Play'; mostrarFase(i) }))
  controles.append(btnPlay, ...botonesFase, V.deslizador({ etiqueta: 'Velocidad', min: 0.25, max: 2, paso: 0.25, valor: 1, unidad: '×' }, (v) => (velocidad = v)))
  if (d.errores?.length) {
    controles.append(V.el('span', { class: 'v-sep' }), ...d.errores.map((e) => V.boton(`✗ ${e.nombre}`, () => {
      error = error === e ? null : e
      if (error) { play = false; btnPlay.textContent = '▶ Play'; V.explicar(panel, e.nombre, e.explica || '', V.el('p', { class: 'v-tenue' }, `En la fase «${fases[e.fase].nombre}». A la izquierda, cómo va; a la derecha, el error.`)) }
      else { faseMostrada = -1; play = true; btnPlay.textContent = '⏸ Pausa' }
    })))
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { play = false; btnPlay.textContent = '▶ Play' }
  requestAnimationFrame(cuadro)
})()
