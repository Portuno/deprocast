import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { aplicarCambios, aplicarForja, descartarForja, faltaTest, forjarMejora, salidaDeCompilador, salidaDeTests, sigueLaSuite } from '../src/fragua.ts'

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

function repoDePrueba() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-fragua-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Operador')
  git(dir, 'config', 'user.email', 'operador@ejemplo.com')
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'saludo.ts'), "export const saludo = () => 'hola'\n")
  fs.writeFileSync(path.join(dir, '.gitignore'), 'data/\n')
  fs.writeFileSync(path.join(dir, '.gitattributes'), '* text=auto eol=lf\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'inicio')
  return dir
}

let vioCambios = ''
let vioCorreccion = ''
function modelo(cambios: unknown[], correccion: unknown[] = cambios) {
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    const u = String(o.mensajes[1]?.content ?? '')
    const datos = s.includes('Elegí los archivos')
      ? { archivos: ['src/saludo.ts', 'src/inventado.ts'] }
      : s.includes('verificacion')
        ? { archivos: ['src/saludo.ts'], cambio: 'Saluda con más onda.', verificacion: 'typecheck' }
        : s.includes('algo falló')
          ? (vioCorreccion = u, { resumen: 'Corregido.', cambios: correccion })
          : (vioCambios = u, { resumen: 'Saluda con más onda.', cambios })
    return { texto: JSON.stringify(datos), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
}

test('fragua: forja en su rama sin tocar main; aplica solo si pasó y con su ok; descarta limpio', async () => {
  const repo = repoDePrueba()
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, creada_en) VALUES ('Saludo con onda', 'Que diga buenas', 'abierta', 1)`).run()

  modelo([{ archivo: 'src/saludo.ts', buscar: "'hola'", reemplazar: "'buenas'" }, { archivo: 'test/saludo.test.ts', buscar: '', reemplazar: "import './../src/saludo.ts'\n" }])
  const f = await forjarMejora(db, { propuestaId: 1 }, { repo, verificar: () => ({ ok: true, salida: 'ℹ pass 1' }) })
  assert.equal(f.estado, 'lista', f.salida ?? '')
  assert.match(vioCambios, /Cambio: Saluda con más onda/)
  assert.match(vioCambios, /Verificación: typecheck/)
  assert.match(f.resumen!, /Cambio: Saluda con más onda/)
  assert.deepEqual(f.archivos, ['src/saludo.ts', 'test/saludo.test.ts'])
  assert.match(f.diff!, /-export const saludo = \(\) => 'hola'\n\+export const saludo = \(\) => 'buenas'/)
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'saludo.ts'), 'utf8'), "export const saludo = () => 'hola'\n", 'main intacto')

  fs.writeFileSync(path.join(repo, 'src', 'saludo.ts'), "export const saludo = () => 'sucio'\n")
  assert.throws(() => aplicarForja(db, f.id, { repo }), /sin commitear/)
  git(repo, 'checkout', '--', '.')
  const ap = aplicarForja(db, f.id, { repo })
  assert.equal(ap.estado, 'aplicada')
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'saludo.ts'), 'utf8'), "export const saludo = () => 'buenas'\n")
  assert.equal((db.prepare('SELECT estado FROM propuestas WHERE id = 1').get() as any).estado, 'aceptada')
  assert.deepEqual(git(repo, 'log', '-2', '--format=%an').split('\n'), ['Operador', 'Operador'], 'firma con la cuenta del repo, no con una inventada')
  assert.equal(git(repo, 'branch', '--list', 'fragua/*'), '', 'la rama se borra')

  // Tests rotos: queda «rota» y no se puede aplicar; se descarta sin dejar rastro.
  modelo([{ archivo: 'src/saludo.ts', buscar: "'buenas'", reemplazar: "'chau'" }, { archivo: 'test/despedida.test.ts', buscar: '', reemplazar: 'export {}\n' }], [])
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
  assert.match(mal.salida!, /corrección 2/, 'probó corregirse antes de rendirse')
  descartarForja(db, mal.id, { repo })
})

test('fragua: si no compila, le devuelve el error y se corrige; si toca src/ sin test, se lo pide', async () => {
  const repo = repoDePrueba()
  const db = abrir(':memory:')
  // Primera vuelta: cambia el código sin test. Le pide el test; lo trae; el typecheck falla; le pasa el error; corrige.
  modelo([{ archivo: 'src/saludo.ts', buscar: "'hola'", reemplazar: '42' }], [{ archivo: 'test/saludo.test.ts', buscar: '', reemplazar: 'export {}\n' }])
  let verificaciones = 0
  const verificar = (dir: string) => {
    verificaciones++
    if (fs.readFileSync(path.join(dir, 'src', 'saludo.ts'), 'utf8').includes('42')) {
      modelo([], [{ archivo: 'src/saludo.ts', buscar: '42', reemplazar: "'buenas'" }])
      return { ok: false, salida: "src/saludo.ts(1,29): error TS2322: Type 'number' is not assignable to type 'string'." }
    }
    return { ok: true, salida: 'ℹ pass 1' }
  }
  const f = await forjarMejora(db, { pedido: 'Que salude distinto' }, { repo, verificar })
  assert.equal(f.estado, 'lista', f.salida ?? '')
  assert.equal(verificaciones, 2, 'sin test no verifica: primero se lo pide')
  assert.match(vioCorreccion, /error TS2322/, 'la corrección ve el error del compilador')
  assert.match(vioCorreccion, /=== src\/saludo\.ts ===\nexport const saludo = \(\) => 42/, 'y el archivo como quedó')
  assert.match(f.salida!, /primera vuelta[\s\S]*sin tocar ningún test[\s\S]*corrección 1[\s\S]*TS2322[\s\S]*corrección 2[\s\S]*pass 1/)
  assert.match(f.diff!, /\+export const saludo = \(\) => 'buenas'/)
  descartarForja(db, f.id, { repo })

  assert.equal(faltaTest(['web/js/57-fragua.js']), null, 'la pantalla no tiene tests')
  assert.equal(faltaTest(['src/a.ts', 'test/a.test.ts']), null)
  assert.match(faltaTest(['src/a.ts'])!, /sin tocar ningún test/)
})

test('fragua: si tsc falla, la salida trae archivo y mensaje y la suite no corre', () => {
  const txt = 'src/saludo.ts(1,14): error TS2322: Type \'string\' is not assignable to type \'number\'.\n  la línea de contexto también queda\n'
  const salida = salidaDeCompilador(txt)
  assert.match(salida, /src\/saludo\.ts\(1,14\): error TS2322/)
  assert.match(salida, /línea de contexto/)
  assert.doesNotMatch(salidaDeTests('ruido\n✖ failing tests\n'), /ruido/)
  assert.equal(sigueLaSuite(2), false)
  assert.equal(sigueLaSuite(0), true)
})

test('fragua: no deja tocar .env, .git, data ni salir del repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-fragua2-'))
  for (const archivo of ['.env', '../afuera.ts', 'data/mastro.db', '.git/config', 'node_modules/x.js']) {
    assert.throws(() => aplicarCambios(dir, [{ archivo, buscar: '', reemplazar: 'x' }]), /no permitido/, archivo)
  }
  assert.deepEqual(aplicarCambios(dir, [{ archivo: 'src/nuevo.ts', buscar: '', reemplazar: 'export {}\n' }]), ['src/nuevo.ts'])
  assert.throws(() => aplicarCambios(dir, [{ archivo: 'src/nuevo.ts', buscar: '', reemplazar: 'x' }]), /ya existe/)
})

test('propuestas: «hecha» la cierra como forjada (sin pasar por La Fragua); la herramienta resuelve varias', async () => {
  const { resolverPropuesta } = await import('../src/chat/index.ts')
  const { ejecutarHerramienta, HERRAMIENTAS } = await import('../src/chat/herramientas.ts')
  const db = abrir(':memory:')
  const alta = db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, creada_en) VALUES (?, 'x', 'abierta', 1)`)
  const [a, b, c] = ['Uno', 'Dos', 'Tres'].map((t) => Number(alta.run(t).lastInsertRowid))
  resolverPropuesta(db, a, 'hecha')
  const fa = db.prepare('SELECT estado, resuelta_en FROM propuestas WHERE id = ?').get(a) as any
  assert.equal(fa.estado, 'aceptada')
  assert.ok(fa.resuelta_en)
  assert.throws(() => resolverPropuesta(db, 999, 'hecha'), /No existe/)
  const r: any = (await ejecutarHerramienta(HERRAMIENTAS, 'resolver_propuestas', JSON.stringify({ ids: [b, c, 999], estado: 'descartada' }), { db, conversacionId: null })).resultado
  assert.deepEqual(r.propuestas, [b, c])
  assert.equal(r.errores.length, 1)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM propuestas WHERE estado = 'abierta'`).get() as any).n, 0)
})
