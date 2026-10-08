import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { aplicarCambios, aplicarForja, descartarForja, forjarMejora } from '../src/fragua.ts'

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

function repoDePrueba() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-fragua-'))
  git(dir, 'init', '-q', '-b', 'main')
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'saludo.ts'), "export const saludo = () => 'hola'\n")
  fs.writeFileSync(path.join(dir, '.gitignore'), 'data/\n')
  fs.writeFileSync(path.join(dir, '.gitattributes'), '* text=auto eol=lf\n')
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'inicio')
  return dir
}

function modelo(cambios: unknown[]) {
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    const datos = s.includes('Elegí los archivos') ? { archivos: ['src/saludo.ts', 'src/inventado.ts'] } : { resumen: 'Saluda con más onda.', cambios }
    return { texto: JSON.stringify(datos), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
}

test('fragua: forja en su rama sin tocar main; aplica solo si pasó y con su ok; descarta limpio', async () => {
  const repo = repoDePrueba()
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, creada_en) VALUES ('Saludo con onda', 'Que diga buenas', 'abierta', 1)`).run()

  modelo([{ archivo: 'src/saludo.ts', buscar: "'hola'", reemplazar: "'buenas'" }])
  const f = await forjarMejora(db, { propuestaId: 1 }, { repo, verificar: () => ({ ok: true, salida: 'ℹ pass 1' }) })
  assert.equal(f.estado, 'lista', f.salida ?? '')
  assert.deepEqual(f.archivos, ['src/saludo.ts'])
  assert.match(f.diff!, /-export const saludo = \(\) => 'hola'\n\+export const saludo = \(\) => 'buenas'/)
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'saludo.ts'), 'utf8'), "export const saludo = () => 'hola'\n", 'main intacto')

  fs.writeFileSync(path.join(repo, 'src', 'saludo.ts'), "export const saludo = () => 'sucio'\n")
  assert.throws(() => aplicarForja(db, f.id, { repo }), /sin commitear/)
  git(repo, 'checkout', '--', '.')
  const ap = aplicarForja(db, f.id, { repo })
  assert.equal(ap.estado, 'aplicada')
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'saludo.ts'), 'utf8'), "export const saludo = () => 'buenas'\n")
  assert.equal((db.prepare('SELECT estado FROM propuestas WHERE id = 1').get() as any).estado, 'aceptada')
  assert.equal(git(repo, 'branch', '--list', 'fragua/*'), '', 'la rama se borra')

  // Tests rotos: queda «rota» y no se puede aplicar; se descarta sin dejar rastro.
  modelo([{ archivo: 'src/saludo.ts', buscar: "'buenas'", reemplazar: "'chau'" }])
  const rota = await forjarMejora(db, { pedido: 'Que se despida' }, { repo, verificar: () => ({ ok: false, salida: '✖ falla' }) })
  assert.equal(rota.estado, 'rota')
  assert.throws(() => aplicarForja(db, rota.id, { repo }), /solo se aplica una que pasó/)
  descartarForja(db, rota.id, { repo })
  assert.equal(git(repo, 'branch', '--list', 'fragua/*'), '')
  assert.ok(!fs.existsSync(path.join(repo, 'data', 'fragua', String(rota.id))))

  // Un «buscar» que no está: falla antes de verificar.
  modelo([{ archivo: 'src/saludo.ts', buscar: 'no existe', reemplazar: 'x' }])
  const mal = await forjarMejora(db, { pedido: 'algo' }, { repo, verificar: () => { throw new Error('no debería verificar') } })
  assert.equal(mal.estado, 'fallo')
  assert.match(mal.salida!, /no encontré el tramo/)
  descartarForja(db, mal.id, { repo })
})

test('fragua: no deja tocar .env, .git, data ni salir del repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-fragua2-'))
  for (const archivo of ['.env', '../afuera.ts', 'data/mastro.db', '.git/config', 'node_modules/x.js']) {
    assert.throws(() => aplicarCambios(dir, [{ archivo, buscar: '', reemplazar: 'x' }]), /no permitido/, archivo)
  }
  assert.deepEqual(aplicarCambios(dir, [{ archivo: 'src/nuevo.ts', buscar: '', reemplazar: 'export {}\n' }]), ['src/nuevo.ts'])
  assert.throws(() => aplicarCambios(dir, [{ archivo: 'src/nuevo.ts', buscar: '', reemplazar: 'x' }]), /ya existe/)
})
