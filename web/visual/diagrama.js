'use strict'
// El dibujante de diagramas (plan v24): piezas con su símbolo (IEC en electricidad) y conexiones con flujo animado.
// Un circuito que cierra un lazo se dibuja como circuito (los cables siguen un rectángulo); lo demás, por capas de
// izquierda a derecha. Tocar una pieza la explica; «paso a paso» recorre el funcionamiento; el control (interruptor o
// deslizador) cambia el estado y se ve el efecto.

;(function () {
  const d = V.d
  if (!d || !Array.isArray(d.nodos) || !d.nodos.length) return V.error('Este visual no tiene datos.')
  const { escenario, panel, controles } = V.armar({ titulo: d.titulo, uso: d.uso || 'Tocá cada pieza para ver qué hace.' })
  const W = 800, H = 500
  const nodos = d.nodos.map((n) => ({ ...n }))
  const porId = new Map(nodos.map((n) => [n.id, n]))
  const conexiones = (d.conexiones || []).filter((c) => porId.has(c.de) && porId.has(c.a))
  const ELECTRICOS = new Set(['pila', 'resistencia', 'led', 'lampara', 'interruptor', 'capacitor', 'motor', 'diodo', 'transistor', 'tierra', 'bobina', 'fuente_ca', 'amperimetro', 'voltimetro'])
  const COLOR_FLUJO = { corriente: 'var(--corriente)', datos: 'var(--datos)', energia: 'var(--energia)', materia: 'var(--materia)' }

  // ─── el estado: el control manda ───────────────────────────────────────
  const control = d.control
  let cerrado = true // el interruptor
  let valorCtrl = control && control.tipo === 'deslizador' ? control.valor : null
  const salidaFn = control && control.tipo === 'deslizador' && control.salida ? (() => { try { return V.compilar(control.salida.expr, [control.nombre]) } catch { return null } })() : null
  const salidaMax = salidaFn ? Math.max(Math.abs(salidaFn({ [control.nombre]: control.max })), Math.abs(salidaFn({ [control.nombre]: control.min })), 1e-9) : null
  const circula = () => (control && control.tipo === 'interruptor' ? cerrado : true)
  const intensidad = () => {
    if (!circula()) return 0
    if (control && control.tipo === 'deslizador') {
      if (salidaFn) return Math.min(1, Math.abs(salidaFn({ [control.nombre]: valorCtrl })) / salidaMax)
      return (valorCtrl - control.min) / (control.max - control.min)
    }
    return 1
  }

  // ─── el layout ─────────────────────────────────────────────────────────
  const vecinos = new Map(nodos.map((n) => [n.id, []]))
  for (const c of conexiones) { vecinos.get(c.de).push(c.a); vecinos.get(c.a).push(c.de) }
  /** Un lazo que pasa por todas las piezas (un circuito en serie): se recorre desde la fuente. */
  function lazo() {
    const inicio = nodos.find((n) => n.tipo === 'pila' || n.tipo === 'fuente_ca') || nodos[0]
    const orden = [inicio.id]
    const vistos = new Set(orden)
    for (;;) {
      const actual = orden[orden.length - 1]
      const salientes = conexiones.filter((c) => c.de === actual && !vistos.has(c.a)).map((c) => c.a)
      const sig = salientes[0] || vecinos.get(actual).find((x) => !vistos.has(x))
      if (!sig) break
      orden.push(sig)
      vistos.add(sig)
    }
    const cierra = vecinos.get(orden[orden.length - 1]).includes(orden[0])
    return orden.length === nodos.length && cierra && nodos.length >= 3 ? orden : null
  }
  const esCircuito = nodos.filter((n) => ELECTRICOS.has(n.tipo)).length >= nodos.length / 2
  const orden = esCircuito ? lazo() : null

  // Rectángulo del circuito: cada pieza en un punto del perímetro (t de 0 a 1, sentido horario desde arriba a la izquierda).
  const R = { x: 140, y: 90, w: 520, h: 310 }
  const per = 2 * (R.w + R.h)
  const enPerimetro = (t) => {
    let s = ((t % 1) + 1) % 1 * per
    if (s < R.w) return { x: R.x + s, y: R.y, lado: 'arriba' }
    s -= R.w
    if (s < R.h) return { x: R.x + R.w, y: R.y + s, lado: 'derecha' }
    s -= R.h
    if (s < R.w) return { x: R.x + R.w - s, y: R.y + R.h, lado: 'abajo' }
    s -= R.w
    return { x: R.x, y: R.y + R.h - s, lado: 'izquierda' }
  }
  const ESQUINAS = [0, R.w / per, (R.w + R.h) / per, (2 * R.w + R.h) / per]
  /** El cable de t1 a t2 siguiendo el rectángulo (con sus esquinas), en el sentido del recorrido. */
  function cablePerimetro(t1, t2) {
    if (t2 < t1) t2 += 1
    const puntos = [enPerimetro(t1)]
    for (const base of [0, 1]) for (const e of ESQUINAS) { const te = e + base; if (te > t1 && te < t2) puntos.push(enPerimetro(te)) }
    puntos.push(enPerimetro(t2))
    return puntos.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  }

  const ts = new Map()
  if (orden) {
    // La fuente arriba a la izquierda, repartidas parejo; si son 4 o menos, una por lado (queda más prolijo).
    orden.forEach((id, i) => ts.set(id, (i + 0.5) / orden.length))
    for (const id of orden) { const p = enPerimetro(ts.get(id)); Object.assign(porId.get(id), { x: p.x, y: p.y, lado: p.lado }) }
  } else {
    // Por capas: cada pieza una columna más a la derecha que la que la alimenta.
    const entrantes = new Map(nodos.map((n) => [n.id, 0]))
    for (const c of conexiones) entrantes.set(c.a, entrantes.get(c.a) + 1)
    const capa = new Map()
    const cola = nodos.filter((n) => !entrantes.get(n.id)).map((n) => n.id)
    if (!cola.length) cola.push(nodos[0].id)
    cola.forEach((id) => capa.set(id, 0))
    while (cola.length) {
      const id = cola.shift()
      for (const c of conexiones.filter((x) => x.de === id)) if (!capa.has(c.a)) { capa.set(c.a, capa.get(id) + 1); cola.push(c.a) }
    }
    for (const n of nodos) if (!capa.has(n.id)) capa.set(n.id, 0)
    const capas = Math.max(...capa.values()) + 1
    const columnas = [...Array(capas)].map((_, k) => nodos.filter((n) => capa.get(n.id) === k))
    columnas.forEach((col, k) => col.forEach((n, j) => { n.x = capas === 1 ? W / 2 : 90 + (k * (W - 180)) / (capas - 1); n.y = H / 2 + (j - (col.length - 1) / 2) * Math.min(110, (H - 100) / Math.max(1, col.length - 1 || 1)); n.lado = null }))
  }

  // ─── los símbolos (centrados en 0,0; horizontales; se giran si el cable es vertical) ─
  const S = (tag, a) => V.svg(tag, { stroke: 'currentColor', 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round', ...a })
  const SIMBOLOS = {
    pila: () => [S('line', { x1: -6, y1: -16, x2: -6, y2: 16 }), S('line', { x1: 6, y1: -9, x2: 6, y2: 9, 'stroke-width': 4 }), V.svg('text', { x: -16, y: -12, class: 'v-signo' }, '+'), V.svg('text', { x: 12, y: -12, class: 'v-signo' }, '−')],
    resistencia: () => [S('rect', { x: -18, y: -7, width: 36, height: 14, rx: 1 })],
    led: () => [S('path', { d: 'M-9,-10 L-9,10 L9,0 Z', class: 'v-luz' }), S('line', { x1: 9, y1: -10, x2: 9, y2: 10 }), S('path', { d: 'M2,-14 l6,-8 M6,-22 l2,0 l0,2 M9,-11 l6,-8 M13,-19 l2,0 l0,2', 'stroke-width': 1.5 })],
    lampara: () => [S('circle', { r: 13, class: 'v-luz' }), S('path', { d: 'M-9,-9 L9,9 M-9,9 L9,-9' })],
    interruptor: (n) => [V.svg('circle', { cx: -14, cy: 0, r: 3, fill: 'currentColor' }), V.svg('circle', { cx: 14, cy: 0, r: 3, fill: 'currentColor' }), S('line', { x1: -14, y1: 0, x2: 14, y2: n._abierto ? -14 : 0, class: 'v-palanca' })],
    capacitor: () => [S('line', { x1: -4, y1: -14, x2: -4, y2: 14 }), S('line', { x1: 4, y1: -14, x2: 4, y2: 14 })],
    motor: () => [S('circle', { r: 14 }), V.svg('text', { x: 0, y: 5, 'text-anchor': 'middle', class: 'v-letra' }, 'M')],
    diodo: () => [S('path', { d: 'M-9,-10 L-9,10 L9,0 Z' }), S('line', { x1: 9, y1: -10, x2: 9, y2: 10 })],
    transistor: () => [S('circle', { r: 15 }), S('line', { x1: -5, y1: -9, x2: -5, y2: 9 }), S('line', { x1: -15, y1: 0, x2: -5, y2: 0 }), S('line', { x1: -5, y1: -4, x2: 8, y2: -13 }), S('path', { d: 'M-5,4 L8,13 M3,13 L8,13 L6,8' })],
    tierra: () => [S('line', { x1: 0, y1: -8, x2: 0, y2: 0 }), S('line', { x1: -12, y1: 0, x2: 12, y2: 0 }), S('line', { x1: -7, y1: 5, x2: 7, y2: 5 }), S('line', { x1: -3, y1: 10, x2: 3, y2: 10 })],
    bobina: () => [S('path', { d: 'M-20,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0' })],
    fuente_ca: () => [S('circle', { r: 14 }), S('path', { d: 'M-8,0 q4,-8 8,0 t8,0' })],
    amperimetro: () => [S('circle', { r: 13 }), V.svg('text', { x: 0, y: 5, 'text-anchor': 'middle', class: 'v-letra' }, 'A')],
    voltimetro: () => [S('circle', { r: 13 }), V.svg('text', { x: 0, y: 5, 'text-anchor': 'middle', class: 'v-letra' }, 'V')],
  }
  const TAPA = { pila: [24, 36], resistencia: [40, 18], led: [24, 24], lampara: [30, 30], interruptor: [34, 10], capacitor: [12, 32], motor: [32, 32], diodo: [22, 24], transistor: [34, 34], tierra: [28, 20], bobina: [42, 12], fuente_ca: [32, 32], amperimetro: [30, 30], voltimetro: [30, 30] }

  // ─── el dibujo ─────────────────────────────────────────────────────────
  const svg = V.svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': d.titulo || 'Diagrama' })
  svg.append(V.svg('style', {}, `.v-signo{font:bold 13px system-ui;fill:var(--tenue);stroke:none}.v-letra{font:bold 14px system-ui;fill:currentColor;stroke:none}.v-etq{font:600 19px system-ui;fill:var(--texto)}.v-valor{font:16px system-ui;fill:var(--tenue)}.v-caja-t{font:16px system-ui;fill:var(--texto)}.v-cable{stroke:#5b6270;stroke-width:3;fill:none}`))
  const defs = V.svg('defs', {}, V.svg('marker', { id: 'v-flecha', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, V.svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#5b6270' })),
    V.svg('filter', { id: 'v-brillo', x: '-50%', y: '-50%', width: '200%', height: '200%' }, V.svg('feGaussianBlur', { stdDeviation: 5, result: 'b' }), V.svg('feMerge', {}, V.svg('feMergeNode', { in: 'b' }), V.svg('feMergeNode', { in: 'SourceGraphic' }))))
  svg.append(defs)
  const capaCables = V.svg('g')
  const capaFlujo = V.svg('g')
  const capaNodos = V.svg('g')
  svg.append(capaCables, capaFlujo, capaNodos)

  const dCable = (c) => {
    const a = porId.get(c.de), b = porId.get(c.a)
    if (orden && ts.has(c.de) && ts.has(c.a)) {
      const i = orden.indexOf(c.de), j = orden.indexOf(c.a)
      const n = orden.length
      if ((i + 1) % n === j) return cablePerimetro(ts.get(c.de), ts.get(c.a))
      if ((j + 1) % n === i) return cablePerimetro(ts.get(c.a), ts.get(c.de)) // al revés del lazo: la animación se invierte abajo
    }
    const dx = Math.max(60, Math.abs(b.x - a.x) / 2)
    const atras = b.x <= a.x
    return atras ? `M${a.x},${a.y} C${a.x + 80},${a.y + 140} ${b.x - 80},${b.y + 140} ${b.x},${b.y}` : `M${a.x + 50},${a.y} C${a.x + 50 + dx},${a.y} ${b.x - 50 - dx},${b.y} ${b.x - 54},${b.y}`
  }
  const flujos = []
  for (const c of conexiones) {
    const camino = dCable(c)
    const enCircuito = !!orden
    capaCables.append(V.svg('path', { d: camino, class: 'v-cable', 'marker-end': enCircuito ? null : 'url(#v-flecha)' }))
    const tipo = c.flujo || (enCircuito ? 'corriente' : null)
    if (tipo) {
      // En el circuito, si el cable va «al revés» del lazo, la animación también.
      const inverso = orden && orden.indexOf(c.a) === (orden.indexOf(c.de) - 1 + orden.length) % orden.length
      const f = V.svg('path', { d: camino, class: 'v-flujo', stroke: COLOR_FLUJO[tipo], 'stroke-width': 3.2, fill: 'none', style: inverso ? 'animation-direction: reverse' : null })
      capaFlujo.append(f)
      flujos.push(f)
    }
    if (c.etiqueta) {
      const a = porId.get(c.de), b = porId.get(c.a)
      capaCables.append(V.svg('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 8, 'text-anchor': 'middle', class: 'v-valor' }, c.etiqueta))
    }
  }

  const grupos = new Map()
  for (const n of nodos) {
    const g = V.svg('g', { class: 'v-nodo', transform: `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`, tabindex: 0, role: 'button', 'aria-label': n.etiqueta })
    const cuerpo = V.svg('g', { class: 'v-cuerpo-nodo', color: 'var(--texto)' })
    const vertical = n.lado === 'derecha' || n.lado === 'izquierda'
    if (n.tipo === 'caja' || !SIMBOLOS[n.tipo]) {
      const ancho = Math.max(110, Math.min(200, n.etiqueta.length * 9.2 + 28))
      cuerpo.append(V.svg('rect', { x: -ancho / 2, y: -24, width: ancho, height: 48, rx: 8, fill: '#1d2129', stroke: '#5b6270', 'stroke-width': 1.6, class: 'v-marca' }),
        V.svg('text', { x: 0, y: 5, 'text-anchor': 'middle', class: 'v-caja-t' }, n.etiqueta))
    } else {
      const [tw, th] = TAPA[n.tipo] || [30, 30]
      const s = V.svg('g', { transform: `${vertical ? 'rotate(90) ' : ''}scale(1.7)` })
      // La tapa: tapa el cable debajo del símbolo (los cables pasan «a través» de la pieza).
      s.append(V.svg('rect', { x: -tw / 2 - 2, y: -th / 2 - 2, width: tw + 4, height: th + 4, fill: 'var(--panel)', stroke: 'none' }), ...SIMBOLOS[n.tipo](n))
      s.append(V.svg('rect', { x: -tw / 2 - 6, y: -th / 2 - 6, width: tw + 12, height: th + 12, rx: 6, fill: 'transparent', stroke: 'transparent', class: 'v-marca' }))
      cuerpo.append(s)
      // La etiqueta, hacia afuera del circuito.
      const off = { arriba: [0, -42], abajo: [0, 52], derecha: [42, 6], izquierda: [-42, 6] }[n.lado] || [0, 52]
      const ancla = n.lado === 'derecha' ? 'start' : n.lado === 'izquierda' ? 'end' : 'middle'
      cuerpo.append(V.svg('text', { x: off[0], y: off[1], 'text-anchor': ancla, class: 'v-etq' }, n.etiqueta))
      if (n.valor) cuerpo.append(V.svg('text', { x: off[0], y: off[1] + (n.lado === 'arriba' ? -22 : 20), 'text-anchor': ancla, class: 'v-valor' }, n.valor))
    }
    g.append(cuerpo)
    g.addEventListener('click', () => elegir(n.id))
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(n.id) } })
    capaNodos.append(g)
    grupos.set(n.id, g)
  }
  escenario.append(svg)
  // El encuadre justo: lo dibujado más un margen (así en el celular no queda chiquito en el medio de la nada).
  try { const b = svg.getBBox(); if (b.width > 0) svg.setAttribute('viewBox', `${(b.x - 24).toFixed(0)} ${(b.y - 24).toFixed(0)} ${(b.width + 48).toFixed(0)} ${(b.height + 48).toFixed(0)}`) } catch { /* sin medidas: el de siempre */ }

  // ─── el estado en pantalla ─────────────────────────────────────────────
  function pintarEstado() {
    const k = intensidad()
    for (const f of flujos) { f.style.opacity = k ? 0.35 + 0.65 * k : 0; f.style.animationDuration = `${(1.6 - 1.2 * k).toFixed(2)}s` }
    const afecta = control && control.tipo === 'deslizador' && control.afecta && control.afecta.length ? new Set(control.afecta) : null
    for (const n of nodos) {
      const g = grupos.get(n.id)
      const luz = g.querySelector('.v-luz')
      if (luz) {
        const kk = afecta && !afecta.has(n.id) ? (circula() ? 1 : 0) : k
        luz.setAttribute('fill', kk ? `rgba(242, 201, 76, ${(0.25 + 0.75 * kk).toFixed(2)})` : 'none')
        luz.setAttribute('filter', kk > 0.15 ? 'url(#v-brillo)' : '')
      }
      if (n.tipo === 'interruptor' && control && control.tipo === 'interruptor' && control.nodo === n.id) {
        n._abierto = !cerrado
        g.querySelector('.v-palanca')?.setAttribute('y2', cerrado ? 0 : -14)
      }
    }
  }

  function elegir(id) {
    for (const [k, g] of grupos) { g.classList.toggle('v-elegido', k === id); g.querySelector('.v-cuerpo-nodo').classList.remove('v-atenuado') }
    const n = porId.get(id)
    const conectadas = conexiones.filter((c) => c.de === id || c.a === id).map((c) => porId.get(c.de === id ? c.a : c.de).etiqueta)
    V.explicar(panel, n.etiqueta + (n.valor ? ` · ${n.valor}` : ''), n.explica || '', conectadas.length ? V.el('p', { class: 'v-tenue' }, `Conectada con: ${[...new Set(conectadas)].join(', ')}.`) : null)
    if (control && control.tipo === 'interruptor' && control.nodo === id) alternar()
  }

  // ─── paso a paso ───────────────────────────────────────────────────────
  let paso = -1
  const pasos = d.pasos || []
  const etqPaso = V.el('span', { class: 'v-tenue' })
  function irAPaso(i) {
    paso = i
    if (i < 0) {
      for (const g of grupos.values()) g.querySelector('.v-cuerpo-nodo').classList.remove('v-atenuado')
      etqPaso.textContent = pasos.length ? `${pasos.length} pasos` : ''
      return V.explicar(panel, d.titulo || 'Cómo funciona', d.uso || 'Tocá una pieza para ver qué es.', inicio())
    }
    const p = pasos[i]
    const resaltar = new Set(p.resaltar || [])
    for (const [k, g] of grupos) g.querySelector('.v-cuerpo-nodo').classList.toggle('v-atenuado', resaltar.size > 0 && !resaltar.has(k))
    etqPaso.textContent = `Paso ${i + 1} de ${pasos.length}`
    V.explicar(panel, `Paso ${i + 1}`, p.texto)
  }
  const inicio = () => (pasos.length ? V.boton('▶ Paso a paso', () => irAPaso(0)) : null)

  if (pasos.length) {
    controles.append(V.boton('◀', () => irAPaso(Math.max(-1, paso - 1)), { title: 'Paso anterior' }), etqPaso, V.boton('▶', () => irAPaso(Math.min(pasos.length - 1, paso + 1)), { title: 'Paso siguiente' }), V.boton('Ver todo', () => irAPaso(-1)))
  }
  function alternar() {
    cerrado = !cerrado
    btnInt && (btnInt.textContent = cerrado ? 'Abrir el interruptor' : 'Cerrar el interruptor')
    pintarEstado()
    V.explicar(panel, cerrado ? 'Cerrado' : 'Abierto', cerrado ? control.cerrado : control.abierto)
  }
  let btnInt = null
  if (control && control.tipo === 'interruptor') {
    btnInt = V.boton('Abrir el interruptor', alternar)
    controles.append(V.el('span', { class: 'v-sep' }), btnInt)
  } else if (control && control.tipo === 'deslizador') {
    const salida = V.el('span', { class: 'v-salida' })
    const pintarSalida = () => { if (salidaFn) salida.textContent = `${control.salida.etiqueta || 'Resultado'}: ${V.fmt(salidaFn({ [control.nombre]: valorCtrl }))}${control.salida.unidad ? ` ${control.salida.unidad}` : ''}` }
    controles.append(V.el('span', { class: 'v-sep' }), V.deslizador({ etiqueta: control.etiqueta, min: control.min, max: control.max, paso: control.paso, valor: control.valor, unidad: control.unidad }, (v) => { valorCtrl = v; pintarSalida(); pintarEstado() }), salidaFn ? salida : null)
    pintarSalida()
  }
  pintarEstado()
  irAPaso(-1)
  if (control && control.texto) panel.append(V.el('p', { class: 'v-tenue' }, control.texto))
})()
