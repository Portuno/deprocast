import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Cada llamada de la pantalla a /api tiene que tener su ruta en el servidor. (Ya pasó: botones que respondían
 * «Ruta desconocida» porque la ruta nunca se escribió.) Se lee el código, no se levanta el servidor.
 */
test('rutas: todo lo que la pantalla pide a /api existe en el servidor', () => {
  const srv = fs.readFileSync('src/servidor.ts', 'utf8')
  const rutas = [...srv.matchAll(/\['(GET|POST)', (\/\^\\\/api.*?\$\/),/g)].map((m) => new Function(`return ${m[2]}`)() as RegExp)
  const crudas = [...srv.matchAll(/url\.pathname === '(\/api\/[^']+)'/g)].map((m) => m[1])
  const crudasRe = [...srv.matchAll(/\/\^\\\/api\\\/[^ ]*?\$\/\.exec\(url\.pathname\)/g)].map((m) => new Function(`return ${m[0].replace('.exec(url.pathname)', '')}`)() as RegExp)
  const faltan: string[] = []
  for (const f of fs.readdirSync('web/js')) {
    const js = fs.readFileSync(path.join('web/js', f), 'utf8')
    for (const m of js.matchAll(/(?:\bapi\(|fetch\(|\.href = )\s*([`'])(\/[^`'\n]*?)\1/g)) {
      const crudo = m[2].split('?')[0]
      if (/\$\{[^}]*$/.test(crudo)) continue // plantilla anidada: no se puede leer sin ejecutarla
      // Un ${…} puede ser un número, una clave («reporte_semanal») o una acción fija («aceptar», «sellar»):
      // alcanza con que alguna forma tenga ruta.
      const huecos = (crudo.match(/\$\{[^}]+\}/g) ?? []).length
      let combos: string[][] = [[]]
      for (let h = 0; h < huecos; h++) combos = combos.flatMap((c) => ['1', 'abc', 'aceptar', 'sellar'].map((x) => [...c, x]))
      const formas = combos.map((c) => {
        let k = 0
        const p = crudo.replace(/\$\{[^}]+\}/g, () => c[k++])
        return p.startsWith('/api') ? p : `/api${p}`
      })
      if (formas.every((p) => !p.startsWith('/api/') && p !== '/api')) continue
      const ok = formas.some((p) => rutas.some((r) => r.test(p)) || crudas.includes(p) || crudasRe.some((r) => r.test(p)) || p === '/api')
      if (!ok) faltan.push(`${formas[0]} (${f})`)
    }
  }
  assert.deepEqual(faltan, [])
})
