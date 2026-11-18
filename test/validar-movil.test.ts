import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { crearMision } from '../src/misiones.ts'
import { resolverLote, tandaParaValidar } from '../src/sombra.ts'

// Con la ruta en una variable: Node lo carga, y tsc no lo mezcla con el servidor (la app no es ESM).
const deLaApp = (m: string): Promise<any> => import(`../apps/movil/src/logica/${m}.ts`)
const v = await deLaApp('validar')

test('Mobile · validar deslizando: solo un gesto marcado es un sí o un no (no hay deshacer)', () => {
  assert.equal(v.decidirDeslizar(130, 0.1), 'aceptar')
  assert.equal(v.decidirDeslizar(-115, -0.2), 'descartar')
  assert.equal(v.decidirDeslizar(60, 0.2), null, 'poco recorrido y lento: vuelve')
  assert.equal(v.decidirDeslizar(50, 1.4), 'aceptar', 'un tirón rápido')
  assert.equal(v.decidirDeslizar(20, 2), null, 'un tirón sin recorrido no cuenta')
  assert.equal(v.decidirDeslizar(60, -1.4), null, 'el tirón para el otro lado no cuenta')
  assert.equal(v.cierreDeTanda(10, 1243), 'Respondiste 10. Quedan 1.243 para validar.')
  assert.equal(v.cierreDeTanda(1, 0), 'Respondiste una. No queda nada para validar.')
})

test('Mobile · la tanda para validar: lo que más pesa, de a sí o no, y responder la saca de la bandeja', async () => {
  const db = abrir(':memory:')
  const T = Date.now()
  for (let i = 0; i < 6; i++) crearMision(db, { nivel: 'primaria', titulo: `Primaria ${i}`, estado: 'sugerida' }, { ahora: T })
  const t = tandaParaValidar(db, 10, T)
  assert.equal(t.tarjetas.length, 4, 'como mucho 4 por grupo, para que la tanda mezcle')
  assert.ok(t.total >= 6)
  const x = t.tarjetas[0]
  assert.equal(x.tipo, 'primaria')
  assert.equal(x.grupo, 'Primarias que te propone')
  assert.ok(x.si && x.no && !x.si.startsWith('✓'), 'las etiquetas, sin el tilde')
  const r = await resolverLote(db, [{ tipo: x.tipo, id: x.id, accion: 'aceptar' }], T)
  assert.equal(r.hechas, 1)
  assert.ok(!tandaParaValidar(db, 10, T).tarjetas.some((y) => y.id === x.id), 'la respondida ya no vuelve')
})
