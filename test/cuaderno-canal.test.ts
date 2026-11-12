import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCaptura } from '../src/captura.ts'
import { _probarTandas, listarTandas, procesarTandas } from '../src/tandas.ts'
import { _probarHojas, _probarTelegram, avisarHojas, MARCA_CUADERNO, procesarActualizacion } from '../src/telegram.ts'

process.env.MASTRO_CARGAS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-cuaderno-'))

function bot() {
  const enviados: any[] = []
  let n = 100
  _probarTelegram({
    pedir: async (metodo, cuerpo) => { const id = ++n; if (metodo === 'sendMessage') enviados.push({ id, ...cuerpo }); return { ok: true, result: { message_id: id } } },
    // Cada «foto» es un JPG distinto (si no, Tandas la toma por repetida).
    bajar: async (id) => ({ datos: Buffer.from(`\xff\xd8\xff jpg ${id}`), nombre: `${id}.jpg` }),
  })
  _probarModelo(async () => ({ texto: 'Dale.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  _probarHojas({ esperar: (ms) => new Promise((ok) => setTimeout(ok, Math.min(ms, 20))) })
  _probarTandas({ leerPagina: async () => JSON.stringify({ transcripcion: 'Comprar tinta. ☐ Llamar al banco.', titulo: 'Pendientes', legible: 1 }), escriba: async () => [] })
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  let m = 1
  const yo = (extra: any) => ({ message: { chat: { id: 42 }, message_id: ++m, ...extra } })
  return { enviados, yo }
}

test('cuaderno por el bot: «hoja» en la foto, un álbum entero, /cuaderno con nombre y una página a mano sin texto van a Tandas; lo demás sigue igual', async () => {
  const db = abrir(':memory:')
  const { enviados, yo } = bot()
  const clasificadas: string[] = []
  _probarCaptura(async (_db, o) => {
    clasificadas.push(o.texto)
    return /manuscrita/.test(o.texto) ? { tipo: 'manuscrito', confianza: 0.9, titulo: '', descripcion: 'Una página escrita a mano', datos: {} } : { tipo: 'otro', confianza: 0.9, titulo: '', descripcion: 'Un perro', datos: {} }
  })

  // Un álbum desde la app de Huion: la primera con «hojas», las demás sin texto pero del mismo álbum.
  await procesarActualizacion(db, yo({ photo: [{ file_id: 'h1' }], caption: 'Hojas de hoy', media_group_id: 'g1' }))
  await procesarActualizacion(db, yo({ photo: [{ file_id: 'h2' }], media_group_id: 'g1' }))
  await procesarActualizacion(db, yo({ document: { file_id: 'h3', file_name: 'Huion_Note_3.jpg', mime_type: 'image/jpeg' }, media_group_id: 'g1' }))
  let ts = listarTandas(db).tandas
  assert.deepEqual(ts.map((t: any) => [t.tipo, t.cuaderno, t.hoja]).sort(), [['pagina', 'Cuaderno', 1], ['pagina', 'Cuaderno', 2], ['pagina', 'Cuaderno', 3]])
  assert.equal(clasificadas.length, 0, 'no pasan por el clasificador')
  assert.equal(enviados.filter((e) => /📓/.test(e.text)).length, 1, 'un aviso por tanda, no uno por hoja')
  assert.match(enviados.at(-1).text, /Hoja 1 al cuaderno «Cuaderno»/)

  // /cuaderno con nombre: las fotos sin texto de los próximos minutos van a ese cuaderno.
  await procesarActualizacion(db, yo({ text: '/cuaderno Rojo' }))
  assert.match(enviados.at(-1).text, /van al cuaderno «Rojo» durante 10 minutos/)
  await procesarActualizacion(db, yo({ photo: [{ file_id: 'r1' }] }))
  assert.ok(listarTandas(db).tandas.some((t: any) => t.cuaderno === 'Rojo' && t.hoja === 1))

  // Fuera de la tanda: una foto con otro texto pasa por el clasificador como siempre; una página a mano sin decir nada, al cuaderno.
  _probarHojas({})
  await procesarActualizacion(db, yo({ photo: [{ file_id: 'p1' }], caption: 'mirá mi perro' }))
  assert.deepEqual(clasificadas, ['mirá mi perro'])
  await procesarActualizacion(db, yo({ photo: [{ file_id: 'm1' }], caption: 'página manuscrita' }))
  assert.equal(listarTandas(db).tandas.filter((t: any) => t.cuaderno === 'Rojo').length, 2, 'la reconoce el clasificador y va al cuaderno')
  assert.equal(MARCA_CUADERNO.test('mis apuntes'), true)
  assert.equal(MARCA_CUADERNO.test('ahojaldrado'), false)

  // Leídas: un solo aviso con lo que entró al corpus.
  await procesarTandas(db)
  const avisos: string[] = []
  await avisarHojas(db, listarTandas(db).tandas.filter((t: any) => t.cuaderno === 'Cuaderno').map((t: any) => t.id), async (t) => avisos.push(t))
  assert.match(avisos[0], /Leí 3 hojas; ya están en tu corpus:\n• Cuaderno · hoja \d · Pendientes \[#\d+\]/)
})
