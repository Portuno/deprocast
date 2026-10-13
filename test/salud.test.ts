import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir, fechaLocal } from '../src/db.ts'
import { alertasSalud, fijarMetasSalud, listarSalud, registrarSalud, resumenDia, resumenSemana, saludParaPrompt } from '../src/salud.ts'
import { _probarCaptura, clasificar, PARECE_REGISTRO, registrarCaptura } from '../src/captura.ts'
import { _probarTelegram, procesarActualizacion, telegramActivo } from '../src/telegram.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarEscriba } from '../src/chat/index.ts'
import { listarMovimientos } from '../src/finanzas.ts'

process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-salud-'))
_probarEscriba(async () => {})

const T = new Date(2026, 9, 14, 13, 30).getTime()
const HOY = '2026-10-14'

test('salud: registros, sueño uno por día, resumen contra metas, semana y prompt', () => {
  const db = abrir(':memory:')
  fijarMetasSalud(db, { kcal: 2200, proteina: 150, sueno: 7.5, entrenos: 4, peso: 80 })
  registrarSalud(db, { tipo: 'comida', titulo: 'Desayuno: avena', datos: { kcal: 450, proteina: 20, carbos: 60, grasa: 12, basura: 'x' } }, T - 5 * 3600_000)
  registrarSalud(db, { tipo: 'comida', titulo: 'Almuerzo: pollo con arroz', datos: { kcal: '650', proteina: 45 } }, T)
  registrarSalud(db, { tipo: 'ejercicio', titulo: 'Correr', datos: { minutos: 30, distancia_km: 5, intensidad: 'media' } }, T)
  registrarSalud(db, { tipo: 'sueno', datos: { horas: 6 } }, T)
  const s = registrarSalud(db, { tipo: 'sueno', datos: { calidad: 3 } }, T)
  assert.deepEqual(s.datos, { horas: 6, calidad: 3 }, 'horas y calidad llegan por separado y quedan en un solo registro')
  assert.equal(listarSalud(db, { tipo: 'sueno' }).length, 1)
  assert.equal(listarSalud(db, { tipo: 'comida' })[1].datos.basura, undefined, 'lo que no es un campo no se guarda')
  registrarSalud(db, { tipo: 'medida', titulo: 'Peso', fecha: '2026-10-07', datos: { peso: 83 } }, T)
  registrarSalud(db, { tipo: 'medida', titulo: 'Peso', datos: { peso: 82.4 } }, T)

  const d = resumenDia(db, HOY)
  assert.deepEqual([d.kcal, d.proteina, d.comidas, d.ejercicio.minutos, d.sueno?.horas, d.peso?.peso], [1100, 65, 2, 30, 6, 82.4])
  assert.equal(d.metas.kcal, 2200)
  const sem = resumenSemana(db, HOY)
  assert.equal(sem.entrenos, 1)
  assert.equal(sem.peso?.cambio, -0.6)
  assert.match(saludParaPrompt(db, T), /Hoy hasta ahora: comió 1100 kcal de 2200 kcal y 65 g de 150 g de proteína[\s\S]*entrenó 30 min[\s\S]*Peso: 82.4 kg \(-0.6 en la semana\), objetivo 80/)
  assert.equal(saludParaPrompt(abrir(':memory:'), T), '', 'sin datos no dice nada')
  fijarMetasSalud(db, { peso: null })
  assert.equal(resumenDia(db, HOY).metas.peso, null)
})

test('salud: alertas (proteína baja a la noche, días sin moverse, noches cortas)', () => {
  const db = abrir(':memory:')
  fijarMetasSalud(db, { proteina: 150, entrenos: 4 })
  const noche = new Date(2026, 9, 14, 21).getTime()
  registrarSalud(db, { tipo: 'comida', titulo: 'Almuerzo', datos: { kcal: 700, proteina: 30 } }, noche - 8 * 3600_000)
  registrarSalud(db, { tipo: 'sueno', fecha: '2026-10-13', datos: { horas: 5 } }, noche)
  registrarSalud(db, { tipo: 'sueno', fecha: HOY, datos: { horas: 5.5 } }, noche)
  const claves = alertasSalud(db, noche).map((a) => a.clave.split(':')[1])
  assert.deepEqual(claves, ['proteina', 'entreno', 'sueno'])
  registrarSalud(db, { tipo: 'ejercicio', titulo: 'Gym', datos: { minutos: 45 } }, noche)
  assert.ok(!alertasSalud(db, noche).some((a) => a.clave.startsWith('salud:entreno')))
})

test('captura: clasifica y registra comida, gasto y peso; lo que no es registro queda como «otro»', async () => {
  const db = abrir(':memory:')
  const respuestas: Record<string, any> = {
    milanesa: { tipo: 'comida', confianza: 0.9, titulo: 'Almuerzo: milanesa con puré', descripcion: 'Un plato', datos: { kcal: 850, proteina: 45, carbos: 70, grasa: 40 } },
    super: { tipo: 'gasto', confianza: 0.95, titulo: 'Súper', fecha: '2026-10-13', datos: { monto: 23.4, moneda: 'eur', comercio: 'Mercadona', categoria: 'comida' } },
    balanza: { tipo: 'medida', confianza: 0.8, titulo: 'Peso', datos: { peso: 82.1 } },
    hola: { tipo: 'otro', confianza: 0.9, titulo: '', descripcion: 'Un saludo', datos: {} },
  }
  _probarCaptura(async (_db, o) => respuestas[Object.keys(respuestas).find((k) => o.texto.includes(k))!])
  const c = await clasificar(db, { texto: 'almorcé milanesa' })
  const r = registrarCaptura(db, c, { ahora: T })!
  assert.equal(r.tabla, 'salud')
  assert.match(r.resumen, /🍽 Almuerzo: milanesa con puré: ~850 kcal · 45 g prot\. Hoy llevás 850 kcal y 45 g de proteína\./)
  const g = registrarCaptura(db, await clasificar(db, { texto: 'super' }), { foto: '/adjuntos/t.jpg', ahora: T })!
  assert.equal(g.tabla, 'movimientos')
  assert.deepEqual(listarMovimientos(db).map((m) => [m.fecha, m.monto, m.moneda, m.origen]), [['2026-10-13', -23.4, 'EUR', 'ticket']])
  assert.match(registrarCaptura(db, await clasificar(db, { texto: 'balanza' }), { ahora: T })!.resumen, /⚖ 82.1 kg/)
  assert.equal(registrarCaptura(db, await clasificar(db, { texto: 'hola' })), null)
  assert.ok(PARECE_REGISTRO.test('hoy almorcé milanesa') && PARECE_REGISTRO.test('gasté 12 € en el súper') && PARECE_REGISTRO.test('dormí 6 horas'))
  assert.ok(!PARECE_REGISTRO.test('¿qué tengo hoy en la agenda?'))
})

function bot() {
  const enviados: any[] = []
  let n = 100
  _probarTelegram({
    pedir: async (metodo, cuerpo) => { const id = ++n; if (/^(sendMessage|editMessageText)$/.test(metodo)) enviados.push({ metodo, id, ...cuerpo }); return { ok: true, result: { message_id: id } } },
    bajar: async () => ({ datos: Buffer.from('foto-falsa'), nombre: 'file_7.jpg' }),
    ver: async () => 'una foto cualquiera',
  })
  _probarModelo(async () => ({ texto: 'Dale, charlamos.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  let m = 1
  const yo = (extra: any) => ({ message: { chat: { id: 42 }, message_id: ++m, ...extra } })
  return { enviados, yo, ultimo: () => enviados.at(-1) }
}

test('telegram: una foto de comida se anota sola; ↩ la deshace; responder la corrige; una charla sigue siendo charla', async () => {
  const db = abrir(':memory:')
  const { yo, ultimo } = bot()
  const vistos: { imagen: boolean; texto: string }[] = []
  _probarCaptura(async (_db, o) => {
    vistos.push({ imagen: !!o.imagen, texto: o.texto })
    if (/Corrección.*era de pollo/.test(o.texto)) return { tipo: 'comida', confianza: 0.9, titulo: 'Almuerzo: pollo al horno', descripcion: '', datos: { kcal: 500, proteina: 50 } }
    if (o.imagen) return { tipo: 'comida', confianza: 0.85, titulo: 'Almuerzo: milanesa', descripcion: 'Un plato con milanesa', datos: { kcal: 800, proteina: 40 } }
    return { tipo: 'otro', confianza: 0.9, titulo: '', descripcion: '', datos: {} }
  })
  await procesarActualizacion(db, yo({ photo: [{ file_id: 'a' }], caption: 'el almuerzo' }))
  assert.deepEqual(vistos[0], { imagen: true, texto: 'el almuerzo' })
  const anotado = ultimo()
  assert.match(anotado.text, /🍽 Almuerzo: milanesa: ~800 kcal/)
  assert.equal(anotado.reply_markup.inline_keyboard[0][0].text, '↩ Deshacer')
  const [reg] = listarSalud(db)
  assert.ok(reg.foto?.startsWith('/adjuntos/'), 'la foto queda guardada')
  assert.equal(reg.fuente, 'telegram')

  // Corrección: responde al mensaje del registro.
  await procesarActualizacion(db, yo({ text: 'no, era de pollo', reply_to_message: { message_id: anotado.id } }))
  assert.match(vistos.at(-1)!.texto, /el almuerzo\nCorrección del jugador \(manda sobre lo anterior\): no, era de pollo/)
  assert.ok(vistos.at(-1)!.imagen, 'la corrección vuelve a mirar la foto')
  assert.deepEqual(listarSalud(db).map((r) => r.titulo), ['Almuerzo: pollo al horno'], 'reemplaza, no suma')

  // Deshacer.
  const corregido = ultimo()
  const [, tabla, id] = corregido.reply_markup.inline_keyboard[0][0].callback_data.split(':')
  await procesarActualizacion(db, { callback_query: { id: 'q', data: `x:${tabla}:${id}`, message: { chat: { id: 42 }, message_id: corregido.id } } })
  assert.equal(listarSalud(db).length, 0)
  assert.match(ultimo().text, /Deshecho/)

  // Texto que no parece un registro: ni siquiera pasa por el clasificador.
  const antes = vistos.length
  await procesarActualizacion(db, yo({ text: '¿qué tengo hoy?' }))
  assert.equal(vistos.length, antes)
  assert.match(ultimo().text, /Dale, charlamos/)
})

test('telegram: los botones de sueño, el freno a los repetidos y un solo dueño del bot', async () => {
  const db = abrir(':memory:')
  const { ultimo, enviados } = bot()
  await procesarActualizacion(db, { callback_query: { id: 'q', data: 'z:h:7', message: { chat: { id: 42 }, message_id: 5 } } })
  await procesarActualizacion(db, { callback_query: { id: 'q', data: 'z:c:2', message: { chat: { id: 42 }, message_id: 5 } } })
  assert.deepEqual(resumenDia(db, fechaLocal()).sueno, { horas: 7, calidad: 2 })
  assert.match(ultimo().text, /Dormiste 7 h \(bien\)/)

  const { decir } = await import('../src/telegram.ts')
  const largo = 'Este es un aviso largo que no debería llegar dos veces seguidas por Telegram.'
  const n = enviados.length
  await decir(largo)
  await decir(largo)
  assert.equal(enviados.length, n + 1, 'el mismo texto largo en 2 minutos sale una vez')

  delete process.env.MASTRO_TELEGRAM
  process.env.MASTRO_NUBE = '1'
  assert.equal(telegramActivo(), false, 'en la nube, apagado salvo que se pida')
  process.env.MASTRO_TELEGRAM = '1'
  assert.equal(telegramActivo(), true)
  delete process.env.MASTRO_NUBE
  process.env.MASTRO_TELEGRAM = '0'
  assert.equal(telegramActivo(), false, 'en la compu se puede apagar')
  delete process.env.MASTRO_TELEGRAM
  assert.equal(telegramActivo(), true)
})
