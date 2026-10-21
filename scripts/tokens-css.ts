/**
 * Una vez (plan v22, fase 1): lleva los tamaños de letra y los radios sueltos de web/estilo.css a los tokens de la
 * escala. Correrlo de nuevo no cambia nada (solo toca valores en px). `node scripts/tokens-css.ts`
 */
import fs from 'node:fs'
import path from 'node:path'

const archivo = path.resolve(import.meta.dirname, '..', 'web', 'estilo.css')
let css = fs.readFileSync(archivo, 'utf8')

// Letra: 11 · 12 · 13 · 14 · 16 · 18 · 22 · 28 · 48. Lo de medio píxel va al siguiente (se lee mejor); lo gigante
// decorativo (glifos de 84 px, clamp) queda como está.
const LETRA: [number, string][] = [
  [11, '--t-1'], [11.5, '--t-2'], [12, '--t-2'], [12.5, '--t-3'], [13, '--t-3'], [13.5, '--t-4'], [14, '--t-4'], [14.5, '--t-4'],
  [15, '--t-5'], [15.5, '--t-5'], [16, '--t-5'], [16.5, '--t-5'], [17, '--t-6'], [18, '--t-6'], [19, '--t-6'], [20, '--t-7'],
  [21, '--t-7'], [22, '--t-7'], [28, '--t-8'], [30, '--t-8'], [34, '--t-8'], [48, '--t-9'],
]
const token = (px: number) => (px < 11 ? '--t-1' : LETRA.find(([v]) => v === px)?.[1] ?? null)

let letra = 0
css = css.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, n) => {
  const t = token(Number(n))
  if (!t) return m
  letra++
  return `font-size: var(${t})`
})
// El atajo `font: 600 12px var(--mono)` (con o sin /alto de línea).
css = css.replace(/(font:\s*(?:[a-z-]+\s+|\d{3}\s+)*)(\d+(?:\.\d+)?)px(?=[\s/])/g, (m, antes, n) => {
  const t = token(Number(n))
  if (!t) return m
  letra++
  return `${antes}var(${t})`
})

// Radios: 4 · 8 · 12 y píldora.
let radios = 0
css = css.replace(/border-radius:\s*(\d+(?:\.\d+)?)px(?=\s*[;}])/g, (m, n) => {
  const v = Number(n)
  const t = v === 0 ? null : v <= 5 ? '--r-s' : v <= 10 ? '--r-m' : v <= 16 ? '--r-l' : v >= 99 ? '--r-pill' : null
  if (!t) return m
  radios++
  return `border-radius: var(${t})`
})

fs.writeFileSync(archivo, css)
console.log(`letra: ${letra} · radios: ${radios}`)
