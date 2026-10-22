import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Las guardas del sistema visual (plan v22): leen web/ como texto. Funcionan como trinquete: cada tope es lo que había
 * al empezar y solo puede bajar; cuando una fase limpia algo, el tope baja con ella y ya no se puede volver atrás.
 */
const WEB = path.resolve(import.meta.dirname, '..', 'web')
const css = fs.readFileSync(path.join(WEB, 'estilo.css'), 'utf8')
const js = fs.readdirSync(path.join(WEB, 'js')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(WEB, 'js', f), 'utf8')).join('\n')
const cuenta = (texto: string, re: RegExp) => (texto.match(re) ?? []).length

const TOPES = {
  confirm: 0,
  prompt: 0,
  coloresFijos: 49,
  styleEnJs: 253,
  letraSinToken: 3, // los glifos gigantes decorativos (84 px, 140 px, el clamp de la portada)
}

test('Sin diálogos del navegador: confirm() y prompt() solo bajan (se reemplazan por los de la app)', () => {
  assert.ok(cuenta(js, /\bconfirm\(/g) <= TOPES.confirm, `confirm(): ${cuenta(js, /\bconfirm\(/g)} > ${TOPES.confirm}`)
  assert.ok(cuenta(js, /\bprompt\(/g) <= TOPES.prompt, `prompt(): ${cuenta(js, /\bprompt\(/g)} > ${TOPES.prompt}`)
})

test('Los colores viven en los tokens: fuera de :root no aparecen colores fijos nuevos', () => {
  const sinRoot = css.replace(/:root[^{]*\{[^}]*\}/g, '')
  const n = cuenta(sinRoot, /#[0-9a-fA-F]{3,8}\b/g) + cuenta(sinRoot, /rgba?\(/g)
  assert.ok(n <= TOPES.coloresFijos, `colores fijos fuera de :root: ${n} > ${TOPES.coloresFijos}`)
})

test('El layout no se escribe a mano en el JS: los style="" solo bajan', () => {
  const n = cuenta(js, /style="/g)
  assert.ok(n <= TOPES.styleEnJs, `style="" en web/js: ${n} > ${TOPES.styleEnJs}`)
})

test('La letra sale de la escala: los font-size sin token solo bajan', () => {
  const n = (css.match(/font-size:\s*[^;}]+/g) ?? []).filter((x) => !/var\(--t-\d\)/.test(x)).length
  assert.ok(n <= TOPES.letraSinToken, `font-size sin token: ${n} > ${TOPES.letraSinToken}`)
})

/** Los tokens de color de un bloque (`:root {…}` o `:root[data-tema='claro'] {…}`). */
function tokens(selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`)
  const bloque = css.slice(i, css.indexOf('}', i))
  return Object.fromEntries([...bloque.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
}
const luz = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contraste = (a: string, b: string) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

test('Contraste WCAG: todo texto se lee (≥ 4,5:1) sobre el fondo, el panel y el panel 2, en los dos temas', () => {
  const oscuro = tokens(':root')
  const claro = { ...oscuro, ...tokens(":root[data-tema='claro']") }
  for (const [nombre, t] of [['oscuro', oscuro], ['claro', claro]] as const) {
    for (const texto of ['texto', 'tenue', 'debil', 'acento-texto', 'ok', 'mal', 'aviso']) {
      for (const fondo of ['fondo', 'panel', 'panel-2']) {
        const r = contraste(t[texto], t[fondo])
        assert.ok(r >= 4.5, `${nombre}: --${texto} sobre --${fondo} da ${r.toFixed(2)}:1`)
      }
    }
    assert.ok(contraste(t['sobre-acento'], t.acento) >= 4.5, `${nombre}: el texto del botón primario`)
  }
})

test('Tres anchos y nada más: compu (más de 1000), tablet (1000) y celular (720)', () => {
  const anchos = new Set([...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => m[1]))
  assert.deepEqual([...anchos].sort(), ['1000', '1280', '720'])
})
