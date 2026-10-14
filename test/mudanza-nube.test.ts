import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { abrir } from '../src/db.ts'
import { aplicarBaseEntrante, destinoDe, mudar, recibirArchivo, recibirBase } from '../src/mudanza.ts'

/** Una «compu» y una «nube», cada una con su carpeta de datos (se cambia de una a otra con las variables). */
function lugar(nombre: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mastro-${nombre}-`))
  return { dir, env: { MASTRO_DB: path.join(dir, 'mastro.db'), MASTRO_CARGAS: path.join(dir, 'cargas'), MASTRO_TANDAS: path.join(dir, 'tandas'), MASTRO_BITACORA: path.join(dir, 'bitacora.md') } }
}
const en = (l: ReturnType<typeof lugar>) => Object.assign(process.env, l.env)

test('mudanza: solo se reciben archivos dentro de las carpetas de datos', () => {
  en(lugar('nube'))
  for (const mal of ['../afuera.txt', 'mastro.db', 'cargas', 'fragua/1/x.ts', 'adjuntos/../../x', '.env', '/etc/passwd']) assert.throws(() => destinoDe(mal), /no permitida/, mal)
  assert.ok(destinoDe('adjuntos/foto.jpg').endsWith(path.join('adjuntos', 'foto.jpg')))
  assert.equal(destinoDe('bitacora.md'), process.env.MASTRO_BITACORA)
  assert.throws(() => recibirBase(Buffer.from('no soy una base')), /no es una base/)
})

test('mudanza: la compu manda base y archivos; la nube arranca con todo y las rutas corregidas', async () => {
  const compu = lugar('compu')
  const nube = lugar('nube')

  // La compu: una base con algo, una carga, una foto y la bitácora.
  en(compu)
  const db = abrir()
  db.prepare(`INSERT INTO memoria (texto, tipo, fecha, estado, creada_por, creada_en) VALUES ('Le gusta el mate amargo', 'preferencia', '2026-10-14', 'vigente', 'operador', 1)`).run()
  fs.mkdirSync(compu.env.MASTRO_CARGAS, { recursive: true })
  fs.writeFileSync(path.join(compu.env.MASTRO_CARGAS, '1-chat.txt'), 'hola')
  db.prepare(`INSERT INTO cargas (importador, archivo, ruta, estado, creada_en) VALUES ('texto', 'chat.txt', ?, 'hecha', 1)`).run(path.join(compu.env.MASTRO_CARGAS, '1-chat.txt'))
  fs.mkdirSync(path.join(compu.dir, 'adjuntos'))
  fs.writeFileSync(path.join(compu.dir, 'adjuntos', 'plato.jpg'), 'jpg')
  fs.writeFileSync(compu.env.MASTRO_BITACORA, '# íntimo')
  db.close()

  // El «internet»: cada pedido corre del lado de la nube.
  const clave = 'una-clave-larga'
  const pedir = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    if (u.pathname === '/entrar') {
      const ok = new URLSearchParams(String(init.body)).get('clave') === clave
      return new Response(null, { status: ok ? 303 : 401, headers: ok ? { 'set-cookie': 'mastro=abc; HttpOnly' } : {} })
    }
    assert.match(String((init.headers as any)?.cookie), /mastro=abc/, 'todo con la cookie de la clave')
    en(nube)
    try {
      if (u.pathname === '/api/mudanza/archivo') return Response.json(recibirArchivo(u.searchParams.get('ruta')!, Buffer.from(init.body as Uint8Array)))
      if (u.pathname === '/api/mudanza/base') return Response.json(recibirBase(Buffer.from(init.body as Uint8Array)))
      if (u.pathname === '/api/mudanza') {
        aplicarBaseEntrante() // el «reinicio»
        const n = abrir()
        const conteos = { memoria: (n.prepare('SELECT COUNT(*) AS n FROM memoria').get() as any).n, cargas: (n.prepare('SELECT COUNT(*) AS n FROM cargas').get() as any).n }
        n.close()
        return Response.json({ conteos })
      }
      return new Response('?', { status: 404 })
    } finally {
      en(compu)
    }
  }
  await assert.rejects(mudar('https://nube', 'otra-clave-mala', { pedir, esperarMs: 0 }), /no aceptó la clave/)

  // En la nube ya había una base (vacía): queda como copia.
  en(nube)
  abrir().close()
  en(compu)
  const log: string[] = []
  const r = await mudar('https://nube/', clave, { pedir, esperarMs: 0, log: (t) => log.push(t) })
  assert.deepEqual(r.conteos, { memoria: 1, cargas: 1 })
  assert.match(log.join('\n'), /Subiendo 3 archivos/)
  assert.equal(fs.readFileSync(path.join(nube.dir, 'adjuntos', 'plato.jpg'), 'utf8'), 'jpg')
  assert.equal(fs.readFileSync(nube.env.MASTRO_BITACORA, 'utf8'), '# íntimo')
  assert.ok(fs.readdirSync(nube.dir).some((f) => f.startsWith('mastro.db.antes-')), 'la base vacía de la nube quedó como copia')
  const ruta = (new DatabaseSync(nube.env.MASTRO_DB).prepare('SELECT ruta FROM cargas').get() as any).ruta
  assert.equal(ruta, path.join(nube.env.MASTRO_CARGAS, '1-chat.txt'), 'la ruta de la carga apunta a la carpeta de la nube')
  assert.ok(fs.existsSync(ruta))
})
