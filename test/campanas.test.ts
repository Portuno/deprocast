import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const cu = await import('../src/cuentas.ts')
const ca = await import('../src/campanas.ts')
const ob = await import('../src/observatorio.ts')
const { bandeja } = await import('../src/sombra.ts')

const T = new Date(2026, 10, 2, 9).getTime()
const INICIO = new Date(2026, 10, 13, 21, 30).getTime()
const H = 3_600_000
const pedidos: string[] = []
let informe = 'Propuse el hashtag, publiqué en X y el Observatorio vio el reclamo en Reddit.'
ca._probarCampanas({
  buscador: async (_db, q) => (q.includes('EntrevistaYa') ? [{ titulo: 'Otra cosa con #EntrevistaYa', url: 'https://x.com/otro/1', extracto: '#EntrevistaYa era de otra campaña', proveedor: 't' }] : []),
  modelo: async (_db, sistema, usuario) => {
    pedidos.push(sistema)
    if (/Proponés hashtags/.test(sistema)) return { hashtags: ['#EntrevistaYa', 'Que lo entrevisten', '#SinPreguntasPactadas'] }
    if (/invita a su gente/.test(sistema)) return { mensaje: 'Gente: el jueves a las 21:30 pido con #SinPreguntasPactadas que lo entrevisten. Si te suma, publicalo con tus palabras.' }
    if (/informe de una campaña/.test(sistema)) return { informe }
    return {}
  },
})
_probarModelo(async (_l, o) => {
  const u = String((o.mensajes as any[]).at(-1).content)
  const momento = /Momento: (ANTES|DURANTE|DESPUÉS)/.exec(u)?.[1] ?? '?'
  return { texto: JSON.stringify({ publicaciones: [{ texto: `${momento}: lo digo yo, con #SinPreguntasPactadas.`, tipo: 'post' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 5 }
})

test('Una campaña: solo sus cuentas; hashtags con su chequeo; armada con piezas en su ventana (en borrador aunque la cuenta sea libre), la invitación, el Observatorio en vivo en la ventana; y el cierre con informe', async () => {
  const db = abrir(':memory:')
  const x = cu.guardarCuenta(db, { red: 'twitter', usuario: '@ejemplo', modo: 'libre' })
  const tg = cu.guardarCuenta(db, { red: 'telegram', usuario: 'canal', modo: 'redacta', conector: 'telegram_canal' })
  const lectura = cu.guardarCuenta(db, { red: 'instagram', usuario: '@lectura', modo: 'lectura' })
  assert.throws(() => ca.crearCampana(db, { titulo: 'X', objetivo: 'Pedir la entrevista en el programa', inicio: INICIO, cuentas: [lectura.id] }, T), /no son tuyas/)
  assert.throws(() => ca.crearCampana(db, { titulo: 'X', objetivo: 'Pedir la entrevista en el programa', inicio: INICIO, cuentas: [999] }, T), /no son tuyas/)

  const c = ca.crearCampana(db, { titulo: 'El día del programa', objetivo: 'Pedir que lo entrevisten sin preguntas pactadas', inicio: INICIO, cuentas: [x.id] }, T)
  assert.equal(c.fin, INICIO + 2 * H)
  await assert.rejects(ca.armarCampana(db, c.id, T), /elegí el hashtag/)
  const cands = await ca.proponerHashtags(db, c.id, T)
  assert.deepEqual(cands.map((k) => [k.hashtag, k.enUso]), [['#EntrevistaYa', true], ['#Queloentrevisten', false], ['#SinPreguntasPactadas', false]])
  assert.equal(cands[0].ejemplos[0].url, 'https://x.com/otro/1', 'muestra para qué ya se usa')
  ca.elegirHashtag(db, c.id, 'SinPreguntasPactadas', T)

  const r = await ca.armarCampana(db, c.id, T)
  const deX = r.piezas.filter((p) => p.cuentaId === x.id)
  assert.equal(deX.length, 3, 'antes, durante y después')
  assert.ok(ca.piezasDe(db, c.id).every((p) => p.estado === 'borrador'), 'nada sale sin su ok, aunque la cuenta sea libre')
  assert.deepEqual(deX.map((p) => p.programadaPara), [INICIO - 2 * H, INICIO + 15 * 60_000, INICIO + 2 * H + 30 * 60_000])
  assert.ok(pedidos.some((s) => /Nada se hace pasar por otra persona/.test(s)), 'las reglas van en los prompts')
  const inv = ca.piezasDe(db, c.id).find((p) => p.tipo === 'invitacion')!
  assert.equal(inv.cuentaId, tg.id, 'la invitación, en borrador en su canal de Telegram')
  assert.match(r.campana.comunidad!, /Si te suma/)
  const t = ob.leerTema(db, r.campana.temaId!)!
  assert.equal(t.consultas[0], '#SinPreguntasPactadas')
  assert.equal(ob.enVivo(t, INICIO - 3 * H), false, 'en vivo solo en su ventana')
  assert.equal(ob.enVivo(t, INICIO), true)
  assert.match(String(r.calendario), /no está conectado/, 'sin Google, lo dice')

  // Aprobada desde 📥, sale a la hora de su momento (no en el próximo horario de la cuenta).
  const { resolverBandeja } = await import('../src/sombra.ts')
  assert.ok(bandeja(db, T).grupos.find((g) => g.tipo === 'publicacion')!.items.some((i) => /campaña/.test(String(i.texto))))
  await resolverBandeja(db, 'publicacion', deX[1].id, 'aceptar', T)
  assert.equal(cu.listarPublicaciones(db).find((p) => p.id === deX[1].id)!.programadaPara, INICIO + 15 * 60_000)

  // El cierre: una hora después del fin, con informe en el corpus.
  assert.deepEqual(await ca.latidoCampanas(db, INICIO + H), [])
  const avisos = await ca.latidoCampanas(db, INICIO + 3 * H + 60_000)
  assert.match(avisos[0], /terminó/)
  const cerrada = ca.leerCampana(db, c.id)!
  assert.equal(cerrada.estado, 'cerrada')
  assert.match((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(cerrada.informePieza) as any).contenido, /Propuse el hashtag/)
  assert.equal(ob.leerTema(db, cerrada.temaId!)!.intensivoHasta, null, 'el Observatorio vuelve a su cadencia')
})
