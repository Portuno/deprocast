import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { comoJson, RUTAS, rutaDe } from '../src/contrato-dispositivo.ts'

/** Las rutas que atiende el servidor, leídas de atenderDispositivo. */
function rutasDelServidor(): string[] {
  const s = fs.readFileSync('src/servidor-app.ts', 'utf8')
  const i = s.indexOf('async function atenderDispositivo(')
  const cuerpo = s.slice(i, s.indexOf('\n}\n', i))
  const out: string[] = []
  for (const m of cuerpo.matchAll(/ruta === '([^']+)' && req\.method === '([A-Z]+)'/g)) out.push(`${m[2]} ${m[1]}`)
  for (const m of cuerpo.matchAll(/ruta\.startsWith\('([^']+)'\) && req\.method === '([A-Z]+)'/g)) out.push(`${m[2]} ${m[1]}x.jpg`)
  return out
}

test('Mobile 2.2 · el contrato del dispositivo: toda ruta que atiende el servidor está en el contrato, y todas las del contrato se atienden', () => {
  const servidor = rutasDelServidor()
  assert.ok(servidor.length >= 25, servidor.join(', '))
  for (const r of servidor) { const [metodo, ruta] = r.split(' '); assert.ok(rutaDe(ruta, metodo), `el servidor atiende ${r} y el contrato no lo tiene`) }
  const s = fs.readFileSync('src/servidor-app.ts', 'utf8')
  for (const r of RUTAS) {
    const base = r.ruta.split('/:')[0]
    assert.ok(s.includes(`'${base}'`) || s.includes(`'${base}/'`) || s.includes(String.raw`^${base}\/`), `el contrato tiene ${r.metodo} ${r.ruta} y el servidor no la atiende`)
  }
  assert.equal(rutaDe('hablantes/12/olvidar', 'POST')?.ruta, 'hablantes/:id/olvidar')
  assert.equal(rutaDe('adjunto/171-ab.jpg', 'GET')?.ruta, 'adjunto/:archivo')
  assert.equal(rutaDe('borrar-todo', 'POST'), null)
})

test('Mobile 2.2 · docs/api-dispositivo.json está al día (npm run contrato)', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync('docs/api-dispositivo.json', 'utf8')), JSON.parse(JSON.stringify(comoJson())), 'corré npm run contrato')
})
