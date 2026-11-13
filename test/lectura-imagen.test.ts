import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { M } from '../src/nan.ts'
import { _probarLectura, guardarLectura, lecturaComoTexto, leerImagen } from '../src/lectura-imagen.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCaptura } from '../src/captura.ts'
import { _probarTelegram, procesarActualizacion } from '../src/telegram.ts'

process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-lectura-'))

// Una tier list de 8 ítems en 5 niveles (el caso que motivó #270: antes volvía como «una lista de argumentos agrupados»).
const TIER = {
  clase: 'ranking', titulo: 'Tier list de argumentos', descripcion: 'Una tier list con cinco niveles.',
  texto: 'S Uno Dos A Tres B Cuatro Cinco C Seis D Siete Ocho',
  grupos: [{ nombre: 'S', items: ['Uno', 'Dos'] }, { nombre: 'A', items: ['Tres'] }, { nombre: 'B', items: ['Cuatro', 'Cinco'] }, { nombre: 'C', items: ['Seis'] }, { nombre: 'D', items: ['Siete', 'Ocho'] }],
  ilegible: ['la nota al pie, borrosa'],
}

test('lectura de imagen: la estructura entera, lo ilegible dicho, y una pieza del corpus sin duplicar', async () => {
  const db = abrir(':memory:')
  const pedidos: (string[] | undefined)[] = []
  _probarLectura(async (_db, _img, modelos) => { pedidos.push(modelos); return { texto: '```json\n' + JSON.stringify(TIER) + '\n```', modelo: M.deepseek, tokens: 1 } })
  const l = await leerImagen(db, { datos: Buffer.from('img-tier'), mime: 'image/jpeg' })
  assert.equal(pedidos.length, 1, 'con texto suficiente, una sola pasada')
  assert.equal(l.grupos.length, 5)
  assert.equal(l.grupos.flatMap((g) => g.items).length, 8, 'los 8 ítems, cada uno en su nivel')
  assert.deepEqual(l.grupos.find((g) => g.nombre === 'D')?.items, ['Siete', 'Ocho'])
  const md = lecturaComoTexto(l)
  assert.match(md, /- \*\*B\*\*: Cuatro · Cinco/)
  assert.match(md, /## No se lee con confianza\n- la nota al pie, borrosa/)

  const id = guardarLectura(db, l, { datos: Buffer.from('img-tier'), url: '/adjuntos/x.jpg', canal: 'Telegram', nota: 'mirá esto' }, Date.UTC(2026, 10, 13, 15))
  const p = db.prepare('SELECT fuente, nivel, titulo, contenido, etiquetas FROM corpus WHERE id = ?').get(id) as any
  assert.equal(p.fuente, 'capturas')
  assert.equal(p.nivel, 'propia')
  assert.match(p.titulo, /^Imagen · 2026-11-13 · Tier list de argumentos$/)
  assert.match(p.contenido, /^> mirá esto/)
  assert.match(p.contenido, /Imagen: \/adjuntos\/x\.jpg/)
  assert.deepEqual(JSON.parse(p.etiquetas), ['captura', 'ranking'])
  assert.equal(guardarLectura(db, l, { datos: Buffer.from('img-tier'), canal: 'chat' }), id, 'la misma imagen no se duplica')
})

test('lectura de imagen: si la primera pasada trae casi nada en algo con texto, una segunda con otro modelo; queda la más completa', async () => {
  const db = abrir(':memory:')
  const pedidos: (string[] | undefined)[] = []
  _probarLectura(async (_db, _img, modelos) => {
    pedidos.push(modelos)
    return modelos ? { texto: JSON.stringify(TIER), modelo: modelos[0], tokens: 1 } : { texto: JSON.stringify({ clase: 'ranking', titulo: 'Captura', texto: 'S A B', grupos: [] }), modelo: M.deepseek, tokens: 1 }
  })
  const l = await leerImagen(db, { datos: Buffer.from('x'), mime: 'image/png' })
  assert.deepEqual(pedidos, [undefined, [M.qwen]])
  assert.equal(l.modelo, M.qwen)
  assert.equal(l.grupos.length, 5)

  // Una foto sin texto (un perro) no pide segunda pasada; un modelo que no devuelve JSON queda como texto.
  pedidos.length = 0
  _probarLectura(async () => ({ texto: 'Un perro en el pasto.', modelo: M.deepseek, tokens: 1 }))
  const perro = await leerImagen(db, { datos: Buffer.from('y'), mime: 'image/png' })
  assert.equal(perro.clase, 'otro')
  assert.equal(perro.texto, 'Un perro en el pasto.')
})

test('telegram: una foto que no es registro se lee entera, queda en el corpus y el chat recibe la lectura con el número de pieza', async () => {
  const db = abrir(':memory:')
  const enviados: any[] = []
  const alModelo: string[] = []
  let n = 100
  _probarTelegram({
    pedir: async (metodo, cuerpo) => { const id = ++n; if (metodo === 'sendMessage') enviados.push({ id, ...cuerpo }); return { ok: true, result: { message_id: id } } },
    bajar: async (id) => ({ datos: Buffer.from(`\xff\xd8\xff jpg ${id}`), nombre: `${id}.jpg` }),
    ver: async () => ({ ...TIER, modelo: null }),
  })
  _probarModelo(async (_l: any, o: any) => { alModelo.push(JSON.stringify(o)); return { texto: 'La vi.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } })
  _probarCaptura(async () => ({ tipo: 'otro', confianza: 0.9, titulo: '', descripcion: 'Una captura', datos: {} }))
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  await procesarActualizacion(db, { message: { chat: { id: 42 }, message_id: 2, photo: [{ file_id: 't1' }], caption: '¿qué opinás de este ranking?' } })

  const p = db.prepare("SELECT id, contenido FROM corpus WHERE fuente = 'capturas'").get() as any
  assert.ok(p, 'la lectura quedó como pieza')
  assert.match(p.contenido, /\*\*D\*\*: Siete · Ocho/)
  const turno = alModelo.join('\n')
  assert.match(turno, new RegExp(`guardada en su corpus \\[#${p.id}\\]`))
  assert.match(turno, /Siete · Ocho/, 'el chat recibe la estructura, no una descripción')
  assert.ok(enviados.some((e) => /Drive no está conectado/.test(e.text)), 'sin Drive, se avisa')

  // Al día siguiente vuelve a avisar, pero no en cada foto del mismo día.
  const avisos = enviados.filter((e) => /Drive no está conectado/.test(e.text)).length
  await procesarActualizacion(db, { message: { chat: { id: 42 }, message_id: 3, photo: [{ file_id: 't2' }] } })
  assert.equal(enviados.filter((e) => /Drive no está conectado/.test(e.text)).length, avisos)
})
