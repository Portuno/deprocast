'use strict'
// Lo común de los dibujantes del Taller (plan v24): armar la página (título, escenario, panel, controles), los
// deslizadores y el parser de expresiones (las mismas reglas que src/visuales.ts: nada de eval).

const V = {
  d: window.VISUAL || {},
  el(tag, props = {}, ...hijos) {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue
      if (k === 'class') e.className = v
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v)
      else e.setAttribute(k, v === true ? '' : v)
    }
    for (const h of hijos.flat()) if (h != null && h !== false) e.append(h.nodeType ? h : document.createTextNode(String(h)))
    return e
  },
  svg(tag, attrs = {}, ...hijos) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) e.setAttribute(k, v)
    for (const h of hijos.flat()) if (h != null && h !== false) e.append(h.nodeType ? h : document.createTextNode(String(h)))
    return e
  },
  /** La página: título y uso arriba, el escenario y el panel al lado (abajo en el celular), los controles al pie. */
  armar({ titulo, uso }) {
    const raiz = document.getElementById('visual')
    const escenario = V.el('div', { class: 'v-escenario' })
    const panel = V.el('aside', { class: 'v-panel', 'aria-live': 'polite' })
    const controles = V.el('div', { class: 'v-controles' })
    raiz.replaceChildren(V.el('header', { class: 'v-cab' }, V.el('h1', {}, titulo || ''), uso ? V.el('p', {}, uso) : null), V.el('div', { class: 'v-cuerpo' }, escenario, panel), controles)
    return { escenario, panel, controles }
  },
  explicar(panel, titulo, texto, ...extra) {
    panel.replaceChildren(V.el('h2', {}, titulo || ''), texto ? V.el('p', {}, texto) : null, ...extra)
  },
  boton(texto, alTocar, o = {}) {
    return V.el('button', { type: 'button', class: o.on ? 'on' : null, title: o.title || null, onclick: alTocar }, texto)
  },
  fmt(n) {
    if (n == null || !Number.isFinite(n)) return '—'
    const a = Math.abs(n)
    return a !== 0 && (a >= 1e5 || a < 1e-3) ? n.toExponential(2) : String(+n.toFixed(a >= 100 ? 1 : a >= 1 ? 2 : 3))
  },
  deslizador({ etiqueta, min, max, paso, valor, unidad }, alCambiar) {
    const salida = V.el('output', {}, `${V.fmt(valor)}${unidad ? ` ${unidad}` : ''}`)
    const input = V.el('input', { type: 'range', min, max, step: paso || (max - min) / 100, value: valor, 'aria-label': etiqueta })
    input.addEventListener('input', () => { const v = Number(input.value); salida.textContent = `${V.fmt(v)}${unidad ? ` ${unidad}` : ''}`; alCambiar(v) })
    return V.el('label', { class: 'v-desl' }, V.el('span', {}, etiqueta), input, salida)
  },
  error(msg) { document.getElementById('visual').replaceChildren(V.el('p', { class: 'v-error' }, msg)) },
  sinTildes: (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
  /** Compila «a*sin(b*x)» a una función de las variables. Números, variables, + - * / ^, paréntesis y funciones conocidas. */
  compilar(expr, variables) {
    const F = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, pow: Math.pow, sign: Math.sign }
    const K = { pi: Math.PI, e: Math.E }
    const s = String(expr).replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/·/g, '*')
    const vars = new Set(variables)
    let i = 0
    const ver = () => s[i]
    const primario = () => {
      const c = ver()
      if (c === '(') { i++; const n = suma(); if (ver() !== ')') throw new Error('Falta un paréntesis'); i++; return n }
      if (c === '-') { i++; const n = potencia(); return (v) => -n(v) }
      if (c === '+') { i++; return potencia() }
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))
      if (m) { i += m[0].length; const k = Number(m[0]); return () => k }
      const id = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(s.slice(i))
      if (!id) throw new Error(`No entiendo «${s.slice(i, i + 8)}»`)
      i += id[0].length
      const nombre = id[0]
      if (ver() === '(') {
        const f = Object.hasOwn(F, nombre.toLowerCase()) ? F[nombre.toLowerCase()] : null
        if (!f) throw new Error(`Función desconocida: ${nombre}`)
        i++
        const args = [suma()]
        while (ver() === ',') { i++; args.push(suma()) }
        if (ver() !== ')') throw new Error('Falta un paréntesis')
        i++
        return (v) => f(...args.map((a) => a(v)))
      }
      if (vars.has(nombre)) return (v) => v[nombre]
      if (Object.hasOwn(K, nombre.toLowerCase())) { const k = K[nombre.toLowerCase()]; return () => k }
      throw new Error(`Variable desconocida: ${nombre}`)
    }
    const potencia = () => { const b = primario(); if (ver() === '^') { i++; const e = potencia(); return (v) => Math.pow(b(v), e(v)) } return b }
    const producto = () => {
      let n = potencia()
      for (;;) {
        const c = ver()
        if (c === '*' || c === '/') { i++; const d = potencia(); const a = n; n = c === '*' ? (v) => a(v) * d(v) : (v) => a(v) / d(v) }
        else if (c === '(' || (c && /[a-zA-Z0-9.]/.test(c))) { const d = potencia(); const a = n; n = (v) => a(v) * d(v) }
        else return n
      }
    }
    const suma = () => {
      let n = producto()
      for (;;) { const c = ver(); if (c !== '+' && c !== '-') return n; i++; const d = producto(); const a = n; n = c === '+' ? (v) => a(v) + d(v) : (v) => a(v) - d(v) }
    }
    const raiz = suma()
    if (i < s.length) throw new Error(`Sobra «${s.slice(i, i + 8)}»`)
    return raiz
  },
}
