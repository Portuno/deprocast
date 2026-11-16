import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { crearConversacion } from '../src/chat/index.ts'
import { HERRAMIENTAS, NUCLEO, ejecutarHerramienta } from '../src/chat/herramientas.ts'
import { _probarCargarDia, cargarDia, fechaPedida, origenDe, textoDeCarga } from '../src/cargar-dia.ts'

const AHORA = new Date('2026-11-17T10:00:00').getTime()

test('#241: «cargá lo de ayer» trae Drive y la cola, guarda la charla del día una vez y devuelve cada pieza con su origen', async () => {
  const db = abrir(':memory:')
  assert.equal(fechaPedida('ayer', AHORA), '2026-11-16')
  assert.equal(fechaPedida('hoy', AHORA), '2026-11-17')
  assert.equal(fechaPedida('2026-11-01', AHORA), '2026-11-01')

  const llamados: string[] = []
  _probarCargarDia({
    drive: async () => { llamados.push('drive'); return { nuevos: 2, actualizados: 1, retirados: 0, errores: 0, modo: 'cambios' } as any },
    tandas: async () => { llamados.push('tandas'); return 3 },
    diario: async (_db, f) => { llamados.push(`diario ${f}`); return [`dia ${f}`] },
  })
  asegurarFuente(db, { id: 'voz', nombre: 'Notas de voz', nivel: 'propia' })
  asegurarFuente(db, { id: 'capturas', nombre: 'Capturas', nivel: 'propia' })
  insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · caminata', contenido: 'Pensé en el taller.', fecha: '2026-11-16', datos: { archivo: '20261116_101500.m4a' } })
  insertar(db, { fuente: 'capturas', nivel: 'propia', titulo: 'Imagen · panel', contenido: 'MetroBús', fecha: '2026-11-16', datos: { canal: 'WhatsApp', url: '/adjuntos/x.jpg' } })
  insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · otro día', contenido: 'No es de ayer.', fecha: '2026-11-10' })

  const c = crearConversacion(db)
  const ins = db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en, via) VALUES (?, ?, ?, ?, ?)')
  const t = (h: string) => new Date(`2026-11-16T${h}:00`).getTime()
  ins.run(c.id, 'operador', 'Hoy quiero cerrar el taller de IA', t('09:00'), null)
  ins.run(c.id, 'asistente', 'Dale, ¿arrancamos por el temario?', t('09:01'), null)
  ins.run(c.id, 'operador', 'Sí, y llamar a Raph', t('09:05'), 'voz')
  ins.run(c.id, 'operador', 'Esto es de otro día', new Date('2026-11-15T09:00:00').getTime(), null)

  const r = await cargarDia(db, 'ayer', AHORA)
  assert.deepEqual(llamados, ['drive', 'tandas', 'diario 2026-11-16'])
  assert.deepEqual(r.drive, { nuevos: 2, actualizados: 1 })
  assert.equal(r.tandas, 3)
  assert.equal(r.charla!.mensajes, 2)
  assert.equal(r.charla!.nueva, true)
  const charla = db.prepare('SELECT titulo, contenido, nivel FROM corpus WHERE id = ?').get(r.charla!.piezaId) as any
  assert.equal(charla.titulo, 'Charla del día · 2026-11-16')
  assert.equal(charla.nivel, 'propia')
  assert.match(charla.contenido, /09:05 · Él \(dictado\)\*\*: Sí, y llamar a Raph/)
  assert.doesNotMatch(charla.contenido, /otro día/)
  assert.ok(db.prepare(`SELECT 1 FROM tareas WHERE pipeline = 'ingesta' AND corpus_id = ?`).get(r.charla!.piezaId), 'pasa por la ingesta (entidades y quántomos)')

  assert.deepEqual(r.piezas.map((p) => [p.titulo, p.origen]), [
    ['Audio · caminata', 'archivo: 20261116_101500.m4a'],
    ['Imagen · panel', 'WhatsApp · /adjuntos/x.jpg'],
    ['Charla del día · 2026-11-16', 'chat'],
  ])
  assert.match(textoDeCarga(r), /Cargué lo del 2026-11-16: 3 piezas \(con la charla del día, 2 mensajes tuyos\)/)

  // Cargar de nuevo no duplica la charla: la actualiza si creció.
  ins.run(c.id, 'operador', 'Me olvidaba: comprar tinta', t('20:00'), null)
  const r2 = await cargarDia(db, '2026-11-16', AHORA)
  assert.equal(r2.charla!.piezaId, r.charla!.piezaId)
  assert.equal(r2.charla!.nueva, false)
  assert.match((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(r.charla!.piezaId) as any).contenido, /comprar tinta/)
  assert.equal(origenDe({ url: 'https://x.org', fuente: 'web', datos: null, meta: null }), 'https://x.org')

  // Desde el chat, siempre a mano.
  assert.ok(NUCLEO.includes('cargar_dia'))
  const h = await ejecutarHerramienta(HERRAMIENTAS, 'cargar_dia', JSON.stringify({ fecha: '2026-11-16' }), { db, conversacionId: null })
  assert.match((h.resultado as any).texto, /📥 Cargué lo del 2026-11-16/)
})
