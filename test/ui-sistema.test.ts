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
  confirm: 20,
  prompt: 20,
  coloresFijos: 50,
  styleEnJs: 253,
  letraSinToken: 433,
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
