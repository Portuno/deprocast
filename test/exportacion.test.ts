import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir, ajuste, fijarAjuste } from '../src/db.ts'
import { buscar, insertar } from '../src/corpus.ts'
import { recordar } from '../src/memoria.ts'
import { escribir, leerBitacora } from '../src/bitacora.ts'
import { exportarEstado, importarEstado, leerExportacion, tablasDe } from '../src/exportacion.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-export-'))
process.env.MASTRO_DB = path.join(tmp, 'esta', 'mastro.db') // los respaldos automáticos caen acá, no en data/

function compu(nombre: string) {
  const dir = path.join(tmp, nombre)
  process.env.MASTRO_CARGAS = path.join(dir, 'cargas')
  process.env.MASTRO_TALLER = path.join(dir, 'taller')
  process.env.MASTRO_BITACORA = path.join(dir, 'bitacora.md')
  return dir
}

test('exportación: todo el estado en un JSON y de vuelta en otra compu, igual', () => {
  // Compu A, con uso.
  const a = compu('a')
  const db = abrir(':memory:')
  const pieza = insertar(db, { fuente: 'operador', titulo: 'Plan de la película', contenido: 'rodaje en otoño', nivel: 'propia', origenId: 'x:1' })!
  db.prepare('INSERT INTO vectores (pieza_id, modelo, dims, vec, en) VALUES (?, ?, ?, ?, ?)').run(pieza, 'm', 2, Buffer.from(new Float32Array([0.6, 0.8]).buffer), 1)
  recordar(db, { tipo: 'hecho', texto: 'Prefiere trabajar de mañana' })
  escribir(db, { texto: 'secreto', clave: 'clave-larga' })
  fijarAjuste(db, 'meta_ingresos_mes', '3000')
  db.prepare(`INSERT INTO cargas (importador, archivo, ruta, estado, creada_en) VALUES ('texto', 'nota.md', ?, 'hecha', 1)`).run(path.join('C:', 'otra', 'cargas', 'nota.md'))
  db.prepare(`INSERT INTO fragua (pedido, rama, estado, creada_en) VALUES ('x', 'fragua/1', 'lista', 1)`).run()
  fs.mkdirSync(path.join(a, 'cargas'), { recursive: true })
  fs.writeFileSync(path.join(a, 'cargas', 'nota.md'), 'hola')
  fs.mkdirSync(path.join(a, 'taller', '3'), { recursive: true })
  fs.writeFileSync(path.join(a, 'taller', '3', 'voz.mp3'), Buffer.from([1, 2, 3]))

  const r = exportarEstado(db, { destino: path.join(a, 'exportaciones') })
  assert.ok(fs.existsSync(r.ruta) && !fs.existsSync(`${r.ruta}.parcial`))
  assert.equal(r.manifiesto.files, 2)
  const texto = fs.readFileSync(r.ruta, 'utf8')
  const { manifiesto } = leerExportacion(texto)
  assert.equal(manifiesto.counts.corpus, 1)
  assert.ok(!texto.includes('secreto'), 'lo cifrado viaja cifrado')
  assert.ok(!/corpus_fts/.test(Object.keys(JSON.parse(texto).tables).join()), 'el índice no viaja')
  assert.ok(exportarEstado(db, { destino: path.join(a, 'exportaciones'), archivos: false, ahora: 1 }).manifiesto.files === 0)

  // Compu B, recién instalada.
  const b = compu('b')
  const otra = abrir(':memory:')
  const imp = importarEstado(otra, texto)
  assert.equal(imp.respaldo, null, 'base vacía: no hace falta respaldo')
  for (const t of tablasDe(db)) {
    assert.deepEqual(otra.prepare(`SELECT * FROM "${t}"`).all().length, db.prepare(`SELECT * FROM "${t}"`).all().length, t)
  }
  assert.equal(buscar(otra, 'película', 5)[0]?.id, pieza, 'el índice se reconstruyó')
  assert.deepEqual([...new Float32Array(new Uint8Array((otra.prepare('SELECT vec FROM vectores').get() as any).vec).buffer)].map((x) => Math.round(x * 10) / 10), [0.6, 0.8])
  assert.equal(leerBitacora(otra, { clave: 'clave-larga' })[0].texto, 'secreto')
  assert.equal(ajuste(otra, 'meta_ingresos_mes'), '3000')
  assert.equal((otra.prepare('SELECT ruta FROM cargas').get() as any).ruta, path.join(b, 'cargas', 'nota.md'), 'rutas de esta compu')
  assert.equal(fs.readFileSync(path.join(b, 'cargas', 'nota.md'), 'utf8'), 'hola')
  assert.deepEqual([...fs.readFileSync(path.join(b, 'taller', '3', 'voz.mp3'))], [1, 2, 3])
  assert.equal((otra.prepare('SELECT estado FROM fragua').get() as any).estado, 'descartada', 'la rama quedó en la otra compu')
  assert.ok((otra.prepare('SELECT COUNT(*) AS n FROM rutinas').get() as any).n >= 10, 'lo de fábrica sigue')

  // Una base con datos no se pisa sin confirmar; confirmando, respalda antes.
  assert.throws(() => importarEstado(otra, texto), /ya tiene datos/)
  const rr = importarEstado(otra, texto, { forzar: true })
  assert.ok(rr.respaldo && fs.existsSync(path.join(rr.respaldo, 'mastro.db')))
  assert.throws(() => importarEstado(otra, '{"format":"deprocast-backup"}'), /No es una exportación de estado/)
  assert.throws(() => importarEstado(otra, '{"format":"deprocast-estado","version":99}'), /versión más nueva/)
})
