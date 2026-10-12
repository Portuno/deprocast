import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { _probarEscriba, conversacionHoy, mensajeDeMastropiero, alDecirSolo } from '../src/chat/index.ts'
import { _probarConectores, guardarCuenta, leerAgente, listarCuentas, listarPublicaciones, publicarPendientes, redactarPublicaciones, resolverPublicacion } from '../src/cuentas.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _probarTelegram, procesarActualizacion } from '../src/telegram.ts'
import { arrancarRun, enCurso, prepararRun } from '../src/misiones.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarCalendario(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')
_probarEscriba(async () => {})
const T = new Date(2026, 9, 7, 9).getTime()

function modelo() {
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    const datos = s.includes('redactás publicaciones') ? { publicaciones: [{ texto: 'Post uno' }, { texto: 'Post dos' }] }
      : s.includes('armás una run') ? { resumen: 'ok', misiones: [{ titulo: 'Escribir el mail', minutos: 12 }] } : null
    return { texto: datos ? JSON.stringify(datos) : 'Te escucho, decime.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
}

test('cuentas: «redacta» nunca publica sola; «libre» se programa y publica con tope; lectura no redacta', async () => {
  const db = abrir(':memory:')
  modelo()
  const publicados: string[] = []
  _probarConectores({ telegram_canal: async (_c, t) => { publicados.push(t); return { url: null } } })
  const red = guardarCuenta(db, { red: 'Telegram', usuario: '@canal', modo: 'redacta', conector: 'telegram_canal', reglas: { chatId: '@canal' } }, T)
  const libre = guardarCuenta(db, { red: 'Telegram', usuario: '@otro', modo: 'libre', conector: 'telegram_canal', reglas: { chatId: '@otro', horas: [10], topeDia: 1 } }, T)
  const lect = guardarCuenta(db, { red: 'WhatsApp', usuario: 'personal', modo: 'lectura' }, T)
  await assert.rejects(redactarPublicaciones(db, lect.id, { ahora: T }), /solo de lectura/)

  const bs = await redactarPublicaciones(db, red.id, { ahora: T })
  assert.deepEqual(bs.map((p) => p.estado), ['borrador', 'borrador'])
  const ls = await redactarPublicaciones(db, libre.id, { ahora: T })
  assert.deepEqual(ls.map((p) => p.estado), ['aprobada', 'aprobada'])
  assert.ok(ls.every((p) => p.programadaPara), 'se programan solas')

  // Mucho después: «redacta» sigue sin publicar (nadie aprobó); «libre» publica solo 1 (tope).
  const despues = T + 3 * 86_400_000
  await publicarPendientes(db, despues)
  assert.equal(publicados.length, 1)
  assert.equal(listarPublicaciones(db, { cuentaId: red.id, estados: ['borrador'] }).length, 2)

  resolverPublicacion(db, bs[0].id, { accion: 'aprobar', cuando: despues - 1 }, despues)
  await publicarPendientes(db, despues)
  assert.ok(publicados.includes('Post uno'), 'lo aprobado por él sí sale')
  resolverPublicacion(db, bs[1].id, { accion: 'descartar' })
  assert.equal(listarPublicaciones(db, { cuentaId: red.id, estados: ['descartada'] }).length, 1)
})

test('telegram: solo su chat; texto y audio van a Hoy y la respuesta vuelve; botones marcan la banda; lo que dice solo sale', async () => {
  const db = abrir(':memory:')
  modelo()
  const enviados: any[] = []
  _probarTelegram({
    pedir: async (metodo, cuerpo) => { if (metodo === 'sendMessage') enviados.push(cuerpo); return { ok: true } },
    bajar: async () => ({ datos: Buffer.from('audio'), nombre: 'voz.oga' }),
    transcribir: async () => 'Mandé el mail',
  })
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  delete process.env.TELEGRAM_CHAT_ID
  await procesarActualizacion(db, { message: { chat: { id: 42 }, text: 'hola' } })
  assert.match(enviados[0].text, /TELEGRAM_CHAT_ID=42/, 'sin chat configurado, solo le dice su id')

  process.env.TELEGRAM_CHAT_ID = '42'
  await procesarActualizacion(db, { message: { chat: { id: 99 }, text: 'soy otro' } })
  assert.equal(enviados.length, 1, 'a otro, silencio')

  await procesarActualizacion(db, { message: { chat: { id: 42 }, text: 'hola Mastropiero' } })
  assert.equal(enviados.at(-1).text, 'Te escucho, decime.')
  await procesarActualizacion(db, { message: { chat: { id: 42 }, voice: { file_id: 'f1' } } })
  const hoy = conversacionHoy(db)
  assert.ok(db.prepare(`SELECT 1 FROM mensajes WHERE conversacion_id = ? AND rol = 'operador' AND texto = 'Mandé el mail'`).get(hoy.id), 'el audio entra transcripto')

  const { run } = await prepararRun(db, {}, { ahora: Date.now() })
  arrancarRun(db, run.id)
  const v = enCurso(db)!
  if (v.actual) {
    await procesarActualizacion(db, { message: { chat: { id: 42 }, text: '/banda' } })
    assert.ok(enviados.at(-1).reply_markup.inline_keyboard[0].length === 3)
    await procesarActualizacion(db, { callback_query: { id: 'c', data: `m:${v.actual.id}:hecha`, message: { chat: { id: 42 } } } })
    assert.match(enviados.at(-1).text, /Marcada «Escribir el mail» como hecha/)
  }

  const oido: string[] = []
  alDecirSolo((t) => oido.push(t))
  mensajeDeMastropiero(db, hoy.id, 'Buen día.')
  assert.deepEqual(oido, ['Buen día.'])
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

test('cuentas: varios agentes por red; la clave no sale del listado; el Markdown y los cupos limitan lo redactado', async () => {
  const db = abrir(':memory:')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-agentes-'))
  process.env.MASTRO_AGENTES = dir
  try {
    const a = guardarCuenta(db, { red: 'linkedin', usuario: 'lautaro', correo: 'yo@ejemplo.com', clave: 'clave-secreta-xyz', nombre: 'Lautaro' }, T)
    const b = guardarCuenta(db, { red: 'LinkedIn', usuario: 'otro' }, T)
    assert.equal(a.red, 'linkedin')
    assert.equal(b.red, 'linkedin')
    assert.equal(listarCuentas(db).filter((c) => c.red === 'linkedin').length, 2)
    const lista = listarCuentas(db).find((c) => c.id === a.id)!
    assert.equal(lista.tieneClave, true)
    assert.equal('clave' in lista, false)
    assert.equal(lista.correo, 'yo@ejemplo.com')
    const ficha = leerAgente(db, a.id)!
    assert.equal(ficha.clave, 'clave-secreta-xyz')
    assert.equal(fs.existsSync(path.join(dir, `${a.id}.md`)), false, 'sin markdown no escribe archivo')

    const ig = guardarCuenta(db, { red: 'Instagram', usuario: '@foto' }, T)
    assert.equal(ig.oficio, 'creador')
    assert.ok(ig.cupos.some((c) => c.tipo === 'video' && c.clase === 'pieza'))

    const reddit = guardarCuenta(db, {
      red: 'reddit', usuario: 'u/yo', clave: 'clave-secreta-xyz',
      cupos: [{ tipo: 'respuesta', cantidad: 2, clase: 'comentario' }],
      markdown: '# voz\nNunca inventes cifras.',
    }, T)
    assert.equal(reddit.reglas.topeDia, 2)
    assert.match(fs.readFileSync(path.join(dir, `${reddit.id}.md`), 'utf8'), /Nunca inventes cifras/)
    const editada = leerAgente(db, reddit.id)!
    assert.match(editada.markdown, /Nunca inventes cifras/)
    assert.equal(editada.clave, 'clave-secreta-xyz')

    _probarModelo(async (_l, o) => {
      const texto = o.mensajes.map((m) => String(m.content)).join('\n')
      assert.match(texto, /Nunca inventes cifras/)
      assert.doesNotMatch(texto, /clave-secreta-xyz/)
      return {
        texto: JSON.stringify({ publicaciones: [
          { texto: 'uno', tipo: 'respuesta' }, { texto: 'dos', tipo: 'respuesta' },
          { texto: 'tres', tipo: 'respuesta' }, { texto: 'otro', tipo: 'hilo' },
        ] }),
        llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1,
      }
    })
    const pubs = await redactarPublicaciones(db, reddit.id, { ahora: T })
    assert.equal(pubs.length, 2)
    assert.deepEqual(pubs.map((p) => p.tipo), ['respuesta', 'respuesta'])
  } finally {
    delete process.env.MASTRO_AGENTES
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
