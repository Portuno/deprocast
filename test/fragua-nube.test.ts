import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { aprobarForja, forjarMejora, porQueNoSePuedeForjar, propuestasParaForjar, revertirForja } from '../src/fragua.ts'
import { _probarGithub, abrirPullRequest, correrNode, diffDe, faltaPermiso, pruebaDeHumo, vigilarAprobadas } from '../src/fragua-nube.ts'

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

test('Mobile 2.0: la app móvil vive en su propio repo: ningún test de acá la lee y la copia de la nube no la lleva', async () => {
  const { COPIAR } = await import('../src/fragua-nube.ts')
  const fs = await import('node:fs')
  assert.ok(!COPIAR.some((c) => c.startsWith('apps/')), 'la copia no lleva la app')
  for (const f of fs.readdirSync('test').filter((x) => x.endsWith('.ts'))) assert.doesNotMatch(fs.readFileSync(`test/${f}`, 'utf8'), /\.\.\/apps\/movil\//, `${f} lee la app`)
  assert.ok(!COPIAR.some((c) => /node_modules|dist/.test(c)), 'nada armado ni dependencias')
})

test('Fragua #318: lo que el código importa fuera de src (vendor/) viaja en la copia de la nube', async () => {
  const { COPIAR } = await import('../src/fragua-nube.ts')
  const fs = await import('node:fs')
  const path = await import('node:path')
  const cubierto = (ruta: string) => COPIAR.some((c) => ruta === c || ruta.startsWith(`${c}/`))
  const importados = new Set<string>()
  const ir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = path.join(d, e.name)
      if (e.isDirectory()) { ir(r); continue }
      if (!r.endsWith('.ts')) continue
      for (const m of fs.readFileSync(r, 'utf8').matchAll(/import\((['"])(\.\.?\/[^'"]+)\1\)|from\s+(['"])(\.\.?\/[^'"]+)\3/g)) {
        const rel = path.relative('.', path.resolve(d, m[2] ?? m[4])).split(path.sep).join('/')
        if (!rel.startsWith('..')) importados.add(rel)
      }
    }
  }
  ir('src')
  assert.ok([...importados].some((x) => x.startsWith('vendor/')), 'presentacion.ts importa vendor/')
  for (const r of importados) assert.ok(cubierto(r), `src importa ${r}, pero la copia de la nube no lo lleva (sumalo a COPIAR)`)
})

test('la forja corre el typecheck y la suite sin trabar el servidor (antes, 330 s congelado en la nube)', async () => {
  let latidos = 0
  const reloj = setInterval(() => latidos++, 20)
  const r = await correrNode(['-e', "setTimeout(() => { console.log('listo'); console.error('aviso'); process.exit(3) }, 400)"], { cwd: os.tmpdir() })
  clearInterval(reloj)
  assert.equal(r.status, 3)
  assert.match(r.salida, /listo/)
  assert.match(r.salida, /aviso/)
  assert.ok(latidos >= 5, `el servidor siguió latiendo mientras tanto (${latidos})`)
  const corta = await correrNode(['-e', 'setTimeout(() => {}, 60000)'], { cwd: os.tmpdir(), timeoutMs: 200 })
  assert.notEqual(corta.status, 0, 'el tope de tiempo la corta')
})

test('#277: si el token no puede abrir el pull request, se dice qué permiso darle (no un 403 crudo)', async () => {
  process.env.GITHUB_FRAGUA_TOKEN = process.env.GITHUB_FRAGUA_TOKEN ?? 'falso'
  process.env.MASTRO_REPO = process.env.MASTRO_REPO ?? 'operador/repo'
  _probarGithub((async (u: string, init: RequestInit = {}) => {
    const ruta = new URL(u).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '')
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status })
    if (ruta === '/pulls') return j({ message: 'Resource not accessible by personal access token' }, 403)
    if (ruta === '/commits/main') return j({ sha: 'base' })
    if (ruta.startsWith('/git/commits/')) return j({ tree: { sha: 'arbol' } })
    return j({ sha: 'x', ref: 'r' })
    void init
  }) as typeof fetch)
  await assert.rejects(abrirPullRequest({ id: 22, titulo: 't', cuerpo: 'c', archivos: [{ ruta: 'src/a.ts', contenido: 'x' }] }), /«Pull requests» en Read and write/)
  assert.match(faltaPermiso('POST', '/git/blobs'), /«Contents» en Read and write/)
  assert.match(faltaPermiso('PUT', '/pulls/7/merge'), /«Pull requests» y «Contents»/)
})
