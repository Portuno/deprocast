import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { respaldar, restaurar } from '../src/respaldo.ts'
import { chequear } from '../src/doctor.ts'

function temporal(nombre: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mastro-${nombre}-`))
}

/** Corre `fn` con variables de entorno cambiadas y las devuelve como estaban. */
async function conEntorno<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(antes)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
}

test('respaldo y restauración: ida y vuelta con cargas, sin pisar sin permiso', async () => {
  const origen = temporal('origen')
  const destino = temporal('destino')
  const cargasOrigen = path.join(origen, 'cargas')
  fs.mkdirSync(cargasOrigen)
  fs.writeFileSync(path.join(cargasOrigen, '1-notas.txt'), 'hola')

  await conEntorno({ MASTRO_CARGAS: cargasOrigen }, () => {
    const db = abrir(path.join(origen, 'mastro.db'))
    insertar(db, { fuente: 'operador', titulo: 'Una pieza', contenido: 'algo para buscar' })
    db.prepare(`INSERT INTO cargas (importador, archivo, ruta, estado, creada_en) VALUES ('texto', 'notas.txt', ?, 'hecha', 0)`)
      .run(path.join(cargasOrigen, '1-notas.txt'))
    const { carpeta, manifiesto } = respaldar(db, { destino: path.join(origen, 'respaldos'), ahora: Date.UTC(2026, 9, 8, 12) })
    db.close()
    assert.equal(manifiesto.conteos.corpus, 1)
    assert.equal(manifiesto.cargas, 1)
    assert.ok(fs.existsSync(path.join(carpeta, 'mastro.db')))
    assert.ok(fs.existsSync(path.join(carpeta, 'cargas', '1-notas.txt')))

    const cargasDestino = path.join(destino, 'cargas')
    process.env.MASTRO_CARGAS = cargasDestino
    const base = path.join(destino, 'mastro.db')
    const r = restaurar(carpeta, { destino: base })
    assert.equal(r.conteos.corpus, 1)
    assert.equal(r.anterior, null)
    assert.equal(fs.readFileSync(path.join(cargasDestino, '1-notas.txt'), 'utf8'), 'hola')

    const nueva = abrir(base)
    const fila = nueva.prepare('SELECT ruta FROM cargas').get() as { ruta: string }
    assert.equal(fila.ruta, path.join(cargasDestino, '1-notas.txt'))
    nueva.close()

    // Ya hay base: sin forzar no la toca; con forzar la guarda antes.
    assert.throws(() => restaurar(carpeta, { destino: base }), /--forzar/)
    const r2 = restaurar(carpeta, { destino: base, forzar: true })
    assert.ok(r2.anterior && fs.existsSync(r2.anterior))
  })
})

test('doctor: sin .env ni key lo marca como falla y no sale a la red', async () => {
  const raiz = temporal('doctor')
  const cs = await conEntorno({ NAN_API_KEY: undefined, MASTRO_DB: path.join(raiz, 'data', 'mastro.db') }, () => chequear({ conRed: false, raiz }))
  const de = (n: string) => cs.find((c) => c.nombre === n)
  assert.equal(de('.env')?.estado, 'falla')
  assert.equal(de('NAN_API_KEY')?.estado, 'falla')
  assert.equal(de('NaN responde'), undefined)
  assert.equal(de('Base')?.estado, 'aviso')
  assert.equal(de('Node')?.estado, 'ok')
  assert.equal(de('SQLite con búsqueda (FTS5)')?.estado, 'ok')
})
