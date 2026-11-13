import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/** Las pantallas de la app (y su raíz). */
const archivos = ['apps/movil/App.tsx', ...fs.readdirSync('apps/movil/src/pantallas').map((f) => path.join('apps/movil/src/pantallas', f))]
const leer = (f: string) => fs.readFileSync(f, 'utf8')
/** Los props de cada <Tag …> (contando llaves: un «() =>» adentro no corta el tag). */
function tagsDe(texto: string, tag: string): string[] {
  const out: string[] = []
  for (let i = texto.indexOf(`<${tag}`); i >= 0; i = texto.indexOf(`<${tag}`, i + 1)) {
    let prof = 0
    let j = i + tag.length + 1
    for (; j < texto.length; j++) {
      const ch = texto[j]
      if (ch === '{') prof++
      else if (ch === '}') prof--
      else if (ch === '>' && prof === 0) break
    }
    out.push(texto.slice(i + tag.length + 1, j))
  }
  return out
}
/** Los estilos de un archivo: nombre → definición (lo que está entre sus llaves). */
function estilos(texto: string): Map<string, string> {
  const i = texto.indexOf('StyleSheet.create({')
  const m = new Map<string, string>()
  if (i < 0) return m
  for (const x of texto.slice(i).matchAll(/^\s{2}(\w+): \{([^\n]*)\},?$/gm)) m.set(x[1], x[2])
  return m
}

test('Mobile 1.0 · bloque 3: una sola escala de letra (cuatro tamaños, en el tema) y nada de tamaños sueltos', () => {
  const tema = leer('apps/movil/src/tema.ts')
  const tamanos = [...tema.matchAll(/fontSize: (\d+)/g)].map((x) => Number(x[1]))
  assert.deepEqual(tamanos, [13, 16, 22, 28], 'cuatro tamaños')
  for (const f of archivos) assert.doesNotMatch(leer(f), /fontSize:\s*\d/, `${f}: un tamaño suelto (usá LETRA)`)
})

test('Mobile 1.0 · bloque 3: el espaciado es de múltiplos de 4', () => {
  for (const f of archivos) {
    for (const x of leer(f).matchAll(/\b(padding\w*|margin\w*|gap|rowGap|columnGap):\s*(\d+)\b/g)) {
      assert.equal(Number(x[2]) % 4, 0, `${f}: ${x[1]}: ${x[2]} no es múltiplo de 4 (usá ESP)`)
    }
  }
})

test('Mobile 1.0 · bloque 3: nada de scroll horizontal; los textos largos se cortan o envuelven', () => {
  for (const f of archivos) assert.doesNotMatch(leer(f), /\bhorizontal\b(?!\w)/, `${f}: scroll horizontal`)
})

test('Mobile 1.0 · bloque 3: todo lo que se toca mide al menos 44 px (o tiene área extra)', () => {
  for (const f of archivos) {
    const texto = leer(f)
    const s = estilos(texto)
    for (const props of tagsDe(texto, 'Pressable')) {
      if (/hitSlop=/.test(props)) continue
      const nombres = [...props.matchAll(/s\.(\w+)/g)].map((y) => y[1])
      const ok = nombres.some((n) => /minHeight: TOQUE|flex: 1/.test(s.get(n) ?? ''))
      assert.ok(ok, `${f}: un Pressable sin 44 px ni hitSlop: <Pressable${props.slice(0, 80)}…>`)
    }
  }
})

test('Mobile 1.0 · bloque 3: el contraste se lee al sol (AA, 4,5:1) en claro y en oscuro', () => {
  const tema = leer('apps/movil/src/tema.ts')
  const paleta = (nombre: string) => Object.fromEntries([...new RegExp(`const ${nombre} = \\{([^}]*)\\}`).exec(tema)![1].matchAll(/(\w+): '(#[0-9a-f]{6})'/g)].map((x) => [x[1], x[2]]))
  const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  for (const n of ['OSCURO', 'CLARO']) {
    const t = paleta(n)
    for (const [a, b] of [['texto', 'fondo'], ['tenue', 'fondo'], ['tenue', 'panel'], ['acento', 'fondo'], ['sobreAcento', 'acento'], ['mal', 'fondo']]) {
      assert.ok(ratio(t[a], t[b]) >= 4.5, `${n}: ${a} sobre ${b} = ${ratio(t[a], t[b]).toFixed(1)}`)
    }
  }
})
