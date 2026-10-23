import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-'))

const { abrir } = await import('../src/db.ts')
const ac = await import('../src/academia.ts')
const cola = await import('../src/taller-cola.ts')
const { leerArtefacto } = await import('../src/taller.ts')

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
// El Taller falso: tarda un poco y deja el visual listo.
cola._probarCola(async (db, t) => {
  await dormir(10)
  db.prepare(`UPDATE artefactos SET estado = 'listo', archivos = '["index.html"]' WHERE id = ?`).run(t.artefactoId)
  return leerArtefacto(db, t.artefactoId!)
})
ac._probarAcademia({
  nube: () => false,
  modelo: async (_db, sistema, usuario) => {
    if (/mapa de conceptos/.test(sistema)) return { conceptos: [{ nombre: 'Ley de Ohm', nivel: 1 }, { nombre: 'Potencia', nivel: 1, requisitos: ['Ley de Ohm'] }] }
    const tema = /Tema de la clase: (.+)/.exec(usuario)?.[1] ?? '?'
    return { tema, explicacion: `Sobre ${tema}.`, ejemplos: [], ideas: [], tarjetas: [], preguntas: [{ pregunta: '¿?', clave: 'k' }], visual: { tipo: 'diagrama', pedido: `Un dibujo de ${tema}` } }
  },
})
async function hastaQueTermine(db: any) {
  for (let i = 0; i < 300; i++) {
    if (!(db.prepare(`SELECT COUNT(*) AS n FROM taller_cola WHERE estado IN ('en_cola', 'haciendo')`).get() as any).n) return
    await dormir(5)
  }
  throw new Error('la cola no terminó')
}

test('La clase pide su visual al Taller sola: en el horno, después listo; y si la cola está llena sigue con texto y reintenta al abrirla', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' })
  const s = await ac.abrirSesionTutor(db, d.id)
  assert.ok(s.visualId, 'la sesión quedó atada a su visual')
  assert.equal(ac.visualDe(db, s)!.estado, 'haciendo', 'en el horno, sin esperarlo')
  assert.match(cola.leerTrabajo(db, 1)!.origen, /^tutor:\d+$/)
  assert.equal(cola.leerTrabajo(db, 1)!.prioridad, 9, 'la está mirando: va primero')
  await hastaQueTermine(db)
  const v = ac.visualDe(db, ac.leerSesionTutor(db, s.id)!)!
  assert.equal(v.estado, 'listo')
  assert.equal(v.url, `/taller/${s.visualId}/index.html`)

  // Con la cola llena, la clase sale igual, solo con texto, y dice por qué.
  ac.cerrarSesionTutor(db, s.id)
  for (let i = 0; i < cola.MAX_EN_ESPERA; i++) db.prepare(`INSERT INTO taller_cola (tipo, args, titulo, estado, encolado_en) VALUES ('crear', '{}', 'espera', 'en_cola', 1)`).run()
  const s2 = await ac.prepararSesionTutor(db, d.id, { tema: 'Potencia' })
  assert.equal(s2.visualId, null)
  assert.deepEqual([ac.visualDe(db, s2)!.estado, ac.visualDe(db, s2)!.motivo], ['solo_texto', 'la cola del Taller está llena'])
  // Se liberó la cola: al abrirla, el visual se pide de nuevo.
  db.prepare(`DELETE FROM taller_cola WHERE titulo = 'espera'`).run()
  const abierta = await ac.abrirSesionTutor(db, d.id)
  assert.equal(abierta.id, s2.id)
  assert.ok(ac.leerSesionTutor(db, s2.id)!.visualId, 'ahora sí entró a la cola')
  await hastaQueTermine(db)
})
