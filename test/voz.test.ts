import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'

const { abrir, fijarAjuste } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, conversacionHoy, estaPensando } = await import('../src/chat/index.ts')
const { iniciarDirecto } = await import('../src/directo.ts')
const v = await import('../src/voz.ts')

_probarEscriba(async () => {})
_probarModelo(async () => ({ texto: 'Las 10:43, señor. Le queda la reunión de las 11 [#12].', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 3 }) as any)
let oido = 'qué hora es'
v._probarVoz({ transcribir: async () => oido, sintetizar: async (t, voz) => Buffer.from(`${voz}:${t}`) })

const esperar = async (cid: number) => { for (let i = 0; i < 200 && estaPensando(cid); i++) await new Promise((r) => setTimeout(r, 10)) }

test('Voz: lo dicho entra al chat como suyo (marcado voz), Mastropiero contesta y su respuesta queda marcada; el ruido no entra', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const r = await v.escucharTurno(db, cid, Buffer.alloc(4000), { segundos: 3 })
  assert.equal(r.texto, 'qué hora es')
  await esperar(cid)
  const ms = db.prepare('SELECT rol, texto, via, lugar, numero FROM mensajes WHERE conversacion_id = ? ORDER BY id').all(cid) as any[]
  assert.deepEqual({ ...ms[0] }, { rol: 'operador', texto: 'qué hora es', via: 'voz', lugar: 'hoy', numero: 1 })
  assert.equal(ms.at(-1).rol, 'asistente')
  assert.equal(ms.at(-1).via, 'voz', 'la respuesta se escuchó')

  oido = '¡Gracias por ver el video!'
  assert.deepEqual(await v.escucharTurno(db, cid, Buffer.alloc(4000)), { texto: null }, 'las alucinaciones de Whisper no entran')
  assert.deepEqual(await v.escucharTurno(db, cid, Buffer.alloc(100)), { texto: null }, 'un audio vacío tampoco')
})

test('Voz: con el Directo prendido, lo dicho en la charla también es un momento de voz del Directo', async () => {
  const db = abrir(':memory:')
  const s = iniciarDirecto(db, ['pantalla', 'voz'])
  oido = 'tengo que llamar a Pablo mañana'
  const cid = conversacionHoy(db).id
  await v.escucharTurno(db, cid, Buffer.alloc(4000), { segundos: 4 })
  await esperar(cid)
  const m = db.prepare(`SELECT tipo, texto FROM directo_momentos WHERE sesion_id = ?`).get(s.id) as any
  assert.deepEqual({ ...m }, { tipo: 'voz', texto: 'tengo que llamar a Pablo mañana' })
})

test('Voz: decir usa la voz elegida (Santa por defecto), limpia citas y markdown, y guarda el audio una vez', async () => {
  const db = abrir(':memory:')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-voz-'))
  assert.equal(v.vozDeMastropiero(db), 'em_santa')
  assert.equal(v.paraDecir('**Anotado** [#12]: mire https://x.com/a y `listo`'), 'Anotado : mire el link y listo')
  const a = await v.decir(db, 'Anotado, señor [#3].', dir)
  assert.match(a!, /^\/adjuntos\/tts-[0-9a-f]{16}\.mp3$/)
  assert.equal(fs.readFileSync(path.join(dir, path.basename(a!)), 'utf8'), 'em_santa:Anotado, señor .')
  assert.equal(await v.decir(db, 'Anotado, señor [#3].', dir), a, 'la misma frase, el mismo archivo')
  fijarAjuste(db, 'voz_mastropiero', 'ef_dora')
  assert.notEqual(await v.decir(db, 'Anotado, señor [#3].', dir), a, 'otra voz, otro audio')
  fijarAjuste(db, 'voz_mastropiero', 'robot')
  assert.equal(v.vozDeMastropiero(db), 'em_santa', 'una voz que no existe vuelve a Santa')
  assert.equal(await v.decir(db, '  [#4] ', dir), null)
})
