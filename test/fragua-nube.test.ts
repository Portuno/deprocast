import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { aprobarForja, forjarMejora, porQueNoSePuedeForjar, propuestasParaForjar, revertirForja } from '../src/fragua.ts'
import { _probarGithub, diffDe, pruebaDeHumo, vigilarAprobadas } from '../src/fragua-nube.ts'

/** Un GitHub falso: guarda lo que se le pide y contesta lo justo. */
function githubFalso() {
  const pedidos: { metodo: string; ruta: string; cuerpo: any }[] = []
  let main = 'base000'
  _probarGithub((async (u: string, init: RequestInit = {}) => {
    const ruta = String(u).replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, '')
    const metodo = init.method ?? 'GET'
    const cuerpo = init.body ? JSON.parse(String(init.body)) : null
    pedidos.push({ metodo, ruta, cuerpo })
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status })
    if (metodo === 'GET' && ruta === '/commits/main') return j({ sha: main })
    if (metodo === 'GET' && ruta.startsWith('/git/commits/')) return j({ tree: { sha: `arbol-de-${ruta.split('/').pop()}` }, parents: [{ sha: 'padre111' }] })
    if (ruta === '/git/blobs') return j({ sha: `blob${pedidos.length}` })
    if (ruta === '/git/trees') return j({ sha: 'arbol-nuevo' })
    if (ruta === '/git/commits') return j({ sha: 'commit-nuevo' })
    if (ruta === '/git/refs') return j({ ref: cuerpo.ref })
    if (ruta === '/pulls') return j({ number: 7, html_url: 'https://github.com/x/y/pull/7' })
    if (ruta === '/pulls/7/merge') { main = 'merge777'; return j({ sha: 'merge777', merged: true }) }
    if (metodo === 'PATCH' && ruta === '/git/refs/heads/main') { main = cuerpo.sha; return j({}) }
    if (metodo === 'DELETE') return new Response(null, { status: 204 })
    return j({ message: `no simulado ${metodo} ${ruta}` }, 500)
  }) as typeof fetch)
  return { pedidos, mover: (s: string) => { main = s } }
}

/** El código de la nube: sin .git (baja como paquete). */
function codigoSinGit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-nube-'))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'saludo.ts'), "export const saludo = () => 'hola'\n")
  fs.writeFileSync(path.join(dir, 'package.json'), '{}')
  return dir
}

function modelo() {
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    const datos = s.includes('Elegí los archivos') ? { archivos: ['src/saludo.ts'] }
      : s.includes('verificacion') ? { archivos: ['src/saludo.ts'], cambio: 'Saluda con más onda.', verificacion: 'typecheck' }
      : { resumen: 'Saluda con más onda.', cambios: [{ archivo: 'src/saludo.ts', buscar: "'hola'", reemplazar: "'buenas'" }, { archivo: 'test/saludo.test.ts', buscar: '', reemplazar: "import '../src/saludo.ts'\n" }] }
    return { texto: JSON.stringify(datos), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
}

const conEntorno = async (vars: Record<string, string | undefined>, f: () => Promise<void>) => {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) if (v == null) delete process.env[k]; else process.env[k] = v
  try { await f() } finally { for (const [k, v] of Object.entries(antes)) if (v == null) delete process.env[k]; else process.env[k] = v }
}

test('la Fragua en la nube (plan v38, fase 2): forja sobre una copia, prueba de humo, pull request; aprobar lo mergea y se vigila', async () => {
  await conEntorno({ GITHUB_FRAGUA_TOKEN: undefined, MASTRO_REPO: undefined, MASTRO_COMMIT: 'base000' }, async () => {
    const repo = codigoSinGit()
    assert.match(porQueNoSePuedeForjar(repo)!, /GITHUB_FRAGUA_TOKEN/, 'sin token, dice qué falta')
    process.env.GITHUB_FRAGUA_TOKEN = 'ghp_prueba'
    process.env.MASTRO_REPO = 'Portuno/depromastro'
    assert.equal(porQueNoSePuedeForjar(repo), null)
    const gh = githubFalso()
    modelo()
    const db = abrir(':memory:')
    db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, origen, prioridad, creada_en) VALUES ('Saludo con onda', 'Que diga buenas', 'abierta', 'autocritica', 'alta', 1)`).run()
    let humoEn = ''
    const f = await forjarMejora(db, { propuestaId: 1 }, { repo, verificar: () => ({ ok: true, salida: 'ℹ pass 1' }), humo: async (d) => { humoEn = fs.readFileSync(path.join(d, 'src', 'saludo.ts'), 'utf8'); return { ok: true, salida: '✔ arrancó' } } })
    assert.equal(f.estado, 'lista', f.salida ?? '')
    assert.equal(f.modo, 'pr')
    assert.match(humoEn, /buenas/, 'la prueba de humo corre sobre el código forjado')
    assert.equal(fs.readFileSync(path.join(repo, 'src', 'saludo.ts'), 'utf8'), "export const saludo = () => 'hola'\n", 'el código que corre, intacto')
    assert.ok(!fs.existsSync(path.join(repo, 'data', 'fragua', String(f.id))), 'la copia se borra: queda el PR')
    assert.equal(f.prUrl, 'https://github.com/x/y/pull/7')
    assert.match(f.diff!, /-export const saludo = \(\) => 'hola'\n\+export const saludo = \(\) => 'buenas'/)
    const pr = gh.pedidos.find((p) => p.ruta === '/pulls')!
    assert.equal(pr.cuerpo.head, `fragua/${f.id}`)
    assert.match(pr.cuerpo.body, /✔ arrancó/, 'el PR lleva la salida de los tests y del humo')
    assert.equal(gh.pedidos.find((p) => p.ruta === '/git/commits' && p.metodo === 'POST')!.cuerpo.parents[0], 'base000', 'sobre el commit que corre')

    const ap = await aprobarForja(db, f.id, 1_000_000)
    assert.equal(ap.estado, 'aplicada')
    assert.equal(ap.mergeSha, 'merge777')
    assert.equal((db.prepare('SELECT estado FROM propuestas WHERE id = 1').get() as any).estado, 'aceptada')

    // Vigilancia: corriendo la versión nueva, queda vigilada; si a los 15 minutos sigue la vieja, se revierte sola.
    const avisos: string[] = []
    assert.equal(await vigilarAprobadas(db, 1_000_000 + 5 * 60_000, (t) => avisos.push(t)), 0, 'todavía dentro del margen')
    assert.equal(await vigilarAprobadas(db, 1_000_000 + 16 * 60_000, (t) => avisos.push(t)), 1)
    assert.equal((db.prepare('SELECT estado FROM fragua WHERE id = ?').get(f.id) as any).estado, 'revertida')
    assert.match(avisos[0], /no levantó en la nube: la revertí sola/)
    const revert = gh.pedidos.filter((p) => p.ruta === '/git/commits' && p.metodo === 'POST').at(-1)!
    assert.deepEqual([revert.cuerpo.tree, revert.cuerpo.parents], ['arbol-de-padre111', ['merge777']], 'el árbol de antes, encima de main')
  })
})

test('la Fragua en la nube: revertir a mano solo si es lo último de main; de noche solo autocrítica alta', async () => {
  await conEntorno({ GITHUB_FRAGUA_TOKEN: 'ghp_prueba', MASTRO_REPO: 'Portuno/depromastro', MASTRO_COMMIT: 'merge777' }, async () => {
    const gh = githubFalso()
    const db = abrir(':memory:')
    db.prepare(`INSERT INTO fragua (id, propuesta_id, pedido, rama, estado, modo, merge_sha, creada_en, resuelta_en) VALUES (3, NULL, 'Algo', 'fragua/3', 'aplicada', 'pr', 'merge777', 1, 1)`).run()
    assert.equal(await vigilarAprobadas(db, 2), 0)
    assert.equal((db.prepare('SELECT vigilada FROM fragua WHERE id = 3').get() as any).vigilada, 1, 'ya corre: queda vigilada')
    gh.mover('otro999')
    await assert.rejects(revertirForja(db, 3), /a mano/)
    gh.mover('merge777')
    assert.equal((await revertirForja(db, 3)).estado, 'revertida')
    db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, origen, prioridad, creada_en) VALUES ('Una idea', 'x', 'abierta', 'chat', 'alta', 1), ('Un error del log', 'x', 'abierta', 'autocritica', 'alta', 2), ('Algo menor', 'x', 'abierta', 'autocritica', 'media', 3)`).run()
    assert.deepEqual(propuestasParaForjar(db, 5, { soloAutocritica: true }).map((p) => p.titulo), ['Un error del log'])
  })
})

test('la prueba de humo dice que no si el servidor no levanta; el diff sin git muestra lo cambiado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-humo-'))
  fs.mkdirSync(path.join(dir, 'web', 'js'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'web', 'js', 'roto.js'), 'function (')
  const r = await pruebaDeHumo(dir, {}, { esperaMs: 3000 })
  assert.equal(r.ok, false)
  assert.match(r.salida, /web\/js\/roto\.js no compila/)
  assert.match(r.salida, /el servidor no arrancó/)
  assert.equal(diffDe('a.ts', 'uno\ndos\ntres\n', 'uno\nDOS\ntres\n'), '--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n uno\n-dos\n+DOS\n tres')
  assert.match(diffDe('nuevo.ts', null, 'hola\n'), /^--- \/dev\/null\n\+\+\+ b\/nuevo\.ts/)
})

test('#266: la copia de la nube para forjar lleva el código de la app nativa (su test compara la conciencia acústica), sin dist ni node_modules', async () => {
  const { prepararCopia, borrarCopia } = await import('../src/fragua-nube.ts')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const origen = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-origen-'))
  for (const f of ['src/conciencia/acustica.ts', 'apps/movil/src/conciencia/acustica.ts', 'apps/movil/dist/bundle.js', 'apps/movil/App.tsx', 'test/movil.test.ts']) {
    fs.mkdirSync(path.dirname(path.join(origen, f)), { recursive: true })
    fs.writeFileSync(path.join(origen, f), 'x')
  }
  const destino = path.join(os.tmpdir(), `forja-copia-${Date.now()}`)
  prepararCopia(origen, destino)
  assert.ok(fs.existsSync(path.join(destino, 'apps/movil/src/conciencia/acustica.ts')))
  assert.ok(!fs.existsSync(path.join(destino, 'apps/movil/dist')), 'lo armado no viaja')
  borrarCopia(destino)
})

test('Mobile 1.0 · bloque 5: todo archivo de la app móvil que leen los tests viaja en la copia que se forja en la nube (si falta uno, falla acá y no en cada forja)', async () => {
  const { COPIAR } = await import('../src/fragua-nube.ts')
  const fs = await import('node:fs')
  const cubierto = (ruta: string) => COPIAR.some((c) => ruta === c || ruta.startsWith(`${c}/`))
  const leidos = new Set<string>()
  for (const f of fs.readdirSync('test').filter((x) => x.endsWith('.ts'))) {
    for (const m of fs.readFileSync(`test/${f}`, 'utf8').matchAll(/['"`](?:\.\.\/)?(apps\/movil\/[\w./${}-]+)/g)) {
      if (/\/dist(\/|$)/.test(m[1])) continue // lo armado no viaja a propósito (el test de #266 lo verifica)
      // Una ruta con ${…} (armada en el test) vale por su carpeta.
      leidos.add(m[1].includes('${') ? m[1].slice(0, m[1].indexOf('${')).replace(/\/[^/]*$/, '') : m[1])
    }
  }
  assert.ok(leidos.size >= 5, [...leidos].join(', '))
  for (const r of leidos) assert.ok(cubierto(r), `los tests leen ${r}, pero la copia de la nube no lo lleva (sumalo a COPIAR)`)
  assert.ok(!COPIAR.some((c) => /node_modules|dist/.test(c)), 'nada armado ni dependencias')
})
