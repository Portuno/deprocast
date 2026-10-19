import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
delete process.env.GOOGLE_CUENTA_SERVICIO

const { abrir, fechaLocal, fijarAjuste } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const { _probarEmbed } = await import('../src/semantica.ts')
const { anotarSideQuest, leerMision, programar, cicloDeBandas } = await import('../src/misiones.ts')
const consumido = await import('../src/consumido.ts')
const bucles = await import('../src/bucles.ts')
const { paraRepasar } = await import('../src/tarjetas.ts')
const tg = await import('../src/telegram.ts')

const T = new Date(2026, 9, 19, 10).getTime()
const DIA = 86_400_000

// Un embedder de juguete: tres ejes de sentido; lo que habla de lo mismo cae en el mismo eje aunque cambien las palabras.
const EJES = [/contador|monotributo|impuestos|afip/, /bici|rueda|bicicleta/, /mam[aá]|madre|llamar a mi vieja/]
_probarEmbed(async (_db, textos) => ({ vectores: textos.map((t) => EJES.map((r) => (r.test(t.toLowerCase()) ? 1 : 0.02))), modelo: 'juguete' }))

const pieza = (db: any, p: { fuente: string; titulo: string; contenido: string; fecha?: string; meta?: any }) => insertar(db, { nivel: 'primaria', origenId: `t:${p.titulo}`, ...p })!
const destilado = (db: any, id: number, salida: any) =>
  db.prepare(`INSERT INTO takeout_destilado (pieza_id, lote, estado, salida, hecho_en) VALUES (?, 'reproceso', 'hecho', ?, ?)`).run(id, JSON.stringify(salida), T)

test('Lo que miraste: lo que valió la pena deja 3 a 5 tarjetas (una vez), con su minuto; la ficha pregunta antes de mostrar', async () => {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'youtube', nombre: 'YouTube', nivel: 'primaria', descripcion: 'Videos' })
  asegurarFuente(db, { id: 'web', nombre: 'Web', nivel: 'primaria', descripcion: 'Links' })
  const video = pieza(db, { fuente: 'youtube', titulo: 'Cómo recordar lo que estudiás', contenido: '[03:12] El repaso activo gana al releer…' })
  const flojo = pieza(db, { fuente: 'web', titulo: 'Una nota corta', contenido: 'Poca cosa.' })
  const propio = pieza(db, { fuente: 'operador', titulo: 'Mi nota de voz', contenido: 'Pensando en voz alta.' })
  destilado(db, video, { valor: 3, tesis: 'Recordar sin mirar fija más que releer.', resumen: 'Sobre el recuerdo activo.', ideas: [{ texto: 'Preguntarse antes de releer' }] })
  destilado(db, flojo, { valor: 1, resumen: 'Nada.' })
  destilado(db, propio, { valor: 3, resumen: 'Lo mío no es consumido.' })

  const pedidos: string[] = []
  consumido._probarConsumido(async (_db, usuario) => {
    pedidos.push(usuario)
    return { tarjetas: [
      { pregunta: '¿Por qué releer engaña?', respuesta: 'Da sensación de fluidez sin fijar nada.', minuto: '03:12' },
      { pregunta: '¿Qué propone en vez de releer?', respuesta: 'Preguntarse primero qué se recuerda.', minuto: null },
      { pregunta: '', respuesta: 'sin pregunta: no entra' },
    ] }
  })
  assert.equal(consumido.cuantasFaltan(db), 1, 'solo lo consumido con valor ≥ 2')
  assert.equal(await consumido.tarjetasDeLoConsumido(db, T), true)
  assert.match(pedidos[0], /Recordar sin mirar fija más/)
  assert.match(pedidos[0], /\[03:12\]/)
  const ts = paraRepasar(db, { mazo: consumido.MAZO_CONSUMIDO }, T)
  assert.equal(ts.length, 2)
  assert.match(ts[0].dorso, /▶ 03:12 · Cómo recordar/)
  assert.match(ts[1].dorso, /— Cómo recordar/)
  assert.equal(await consumido.tarjetasDeLoConsumido(db, T), false, 'una vez por pieza')
  assert.equal(consumido.cuantasFaltan(db), 0)

  const r = consumido.recordarPieza(db, video)
  assert.equal(r.tesis, 'Recordar sin mirar fija más que releer.')
  assert.equal(r.tarjetas.length, 2)

  // Si el modelo falla, la pieza no traba la cola.
  const otro = pieza(db, { fuente: 'youtube', titulo: 'Otro video', contenido: 'x' })
  destilado(db, otro, { valor: 2, resumen: 'y' })
  consumido._probarConsumido(async () => { throw new Error('NaN caído') })
  assert.equal(await consumido.tarjetasDeLoConsumido(db, T), true)
  assert.equal(consumido.cuantasFaltan(db), 0)
})

test('Lo que sigue volviendo: lo abierto se junta por sentido y cuenta las vueltas; tres finales; lo soltado no vuelve a molestar', async () => {
  const db = abrir(':memory:')
  const a = pieza(db, { fuente: 'operador', titulo: 'Charla de enero', contenido: 'x', fecha: '2026-01-10' })
  const b = pieza(db, { fuente: 'operador', titulo: 'Nota de marzo', contenido: 'x', fecha: '2026-03-02' })
  const c = pieza(db, { fuente: 'operador', titulo: 'Charla de septiembre', contenido: 'x', fecha: '2026-09-20' })
  destilado(db, a, { fecha: '2026-01-10', abierto: ['Hablar con el contador por el monotributo', 'Arreglar la rueda de la bici', 'corto'] })
  destilado(db, b, { fecha: '2026-03-02', abierto: ['Resolver lo de los impuestos con la AFIP'] })
  destilado(db, c, { fecha: '2026-09-20', abierto: ['hablar con el contador por el monotributo'] })
  const sq = anotarSideQuest(db, { titulo: 'Llamar a mi vieja para su cumple', creadaPor: 'escriba' }, T - 30 * DIA)
  anotarSideQuest(db, { titulo: 'Comprar pilas', creadaPor: 'escriba' }, T - 2 * DIA) // reciente: todavía no es un bucle

  assert.equal(await bucles.juntarBucles(db, { ahora: T }), 5)
  assert.equal(await bucles.juntarBucles(db, { ahora: T }), 0, 'cada mención cuenta una vez')
  const xs = bucles.listarBucles(db, {}, T)
  assert.equal(xs.length, 3)
  const contador = xs[0]
  assert.equal(contador.texto, 'Hablar con el contador por el monotributo')
  assert.equal(contador.veces, 3, 'las mismas palabras y otras con el mismo sentido')
  assert.equal(contador.primera, '2026-01-10')
  assert.equal(contador.ultima, '2026-09-20')
  assert.ok(contador.peso > xs[1].peso, 'pesa más lo que volvió más y hace más')
  const vieja = xs.find((x) => x.texto.startsWith('Llamar a mi vieja'))!
  assert.equal(vieja.misionId, sq.id)

  // ✓ ya: la side quest que ya era vence hoy; una nueva si no había.
  await bucles.cerrarBucle(db, vieja.id, 'ya', {}, T)
  assert.equal(leerMision(db, sq.id)!.vence, fechaLocal(T))
  const bici = xs.find((x) => /bici/.test(x.texto))!
  await assert.rejects(bucles.cerrarBucle(db, bici.id, 'agendar', {}, T), /qué día/)
  const ag = await bucles.cerrarBucle(db, bici.id, 'agendar', { fecha: '2026-10-25' }, T)
  assert.equal(ag.google, null, 'sin Google conectado queda como side quest con fecha')
  assert.equal(leerMision(db, ag.misionId!)!.vence, '2026-10-25')
  assert.equal(ag.bucle.estado, 'agendado')
  const s = await bucles.cerrarBucle(db, contador.id, 'soltar', { motivo: 'Ya cambié de contador' }, T)
  assert.equal(s.bucle.estado, 'soltado')
  assert.equal(s.bucle.motivo, 'Ya cambié de contador')
  await assert.rejects(bucles.cerrarBucle(db, contador.id, 'ya', {}, T), /ya está cerrado/)
  assert.equal(bucles.listarBucles(db, {}, T).length, 0)

  // Vuelve a aparecer: suma la vuelta, pero sigue soltado (no se reabre).
  const d = pieza(db, { fuente: 'operador', titulo: 'Charla de octubre', contenido: 'x', fecha: '2026-10-15' })
  destilado(db, d, { fecha: '2026-10-15', abierto: ['Pagar el monotributo atrasado'] })
  await bucles.juntarBucles(db, { ahora: T })
  assert.equal(bucles.leerBucle(db, contador.id, T)!.veces, 4)
  assert.equal(bucles.leerBucle(db, contador.id, T)!.estado, 'soltado')
  assert.deepEqual(bucles.resumenBucles(db), { agendado: 1, cerrado: 1, soltado: 1 })
})

test('Bucles por Telegram: los botones del aviso los cierran', async () => {
  const db = abrir(':memory:')
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '9'
  const enviados: any[] = []
  let n = 0
  tg._probarTelegram({ esperar: async () => {}, pedir: async (metodo, cuerpo) => { enviados.push({ metodo, ...cuerpo }); return { ok: true, result: { message_id: ++n } } } })
  const p = pieza(db, { fuente: 'operador', titulo: 'Charla', contenido: 'x', fecha: '2026-05-01' })
  destilado(db, p, { abierto: ['Arreglar la rueda de la bici', 'Hablar con el contador'] })
  await bucles.juntarBucles(db)
  const [b1, b2] = bucles.bucleMasViejos(db, 3)
  const boton = (data: string) => tg.procesarActualizacion(db, { callback_query: { id: 'q', data, message: { chat: { id: 9 }, message_id: 1 } } })
  await boton(`b:${b1.id}:manana`)
  assert.match(enviados.at(-1).text, /quedó para mañana/)
  assert.equal(bucles.leerBucle(db, b1.id)!.estado, 'agendado')
  await boton(`b:${b2.id}:soltar`)
  assert.match(enviados.at(-1).text, /Soltado/)
  await boton(`b:${b2.id}:ya`)
  assert.match(enviados.at(-1).text, /ya está cerrado/)
})

test('Runs en ciclos de 90/20: tras 90 minutos de foco, un descanso lejos de la pantalla (un hueco o una pausa también cuentan)', () => {
  const db = abrir(':memory:')
  assert.deepEqual(cicloDeBandas(db), [90, 20], 'por defecto')
  fijarAjuste(db, 'ciclo_bandas', '0')
  assert.equal(cicloDeBandas(db), null)
  fijarAjuste(db, 'ciclo_bandas', '50/10')
  assert.deepEqual(cicloDeBandas(db), [50, 10])

  const banda = (titulo: string, minutos: number, categoria: string | null = null) => ({ titulo, detalle: null, minutos, primaria: null, categoria, con: null, gasto: null })
  const base = { desde: 600, hasta: 900, banda: null, cantidad: null, ocupado: [] as [number, number][], dinero: null, excluir: null, ciclo: [90, 20] as [number, number] }
  const r = programar([banda('A', 50), banda('B', 40), banda('C', 50), banda('D', 50)], base)
  assert.deepEqual(r.map((m) => `${m.inicio} ${m.titulo}`), ['10:00 A', '10:50 B', '11:30 Descanso: lejos de la pantalla', '11:50 C', '12:40 Descanso: lejos de la pantalla', '13:00 D'])
  assert.equal(r[2].categoria, 'pausa')
  assert.equal(r[2].minutos, 20)

  // Un hueco de la agenda de 20 minutos ya es descanso; una pausa del modelo también.
  const hueco = programar([banda('A', 60), banda('B', 60)], { ...base, ocupado: [[660, 685]] })
  assert.deepEqual(hueco.map((m) => m.titulo), ['A', 'B'])
  const pausa = programar([banda('A', 60), banda('Respirar', 10, 'pausa'), banda('B', 60)], base)
  assert.deepEqual(pausa.map((m) => m.titulo), ['A', 'Respirar', 'B'])

  // La cantidad cuenta bandas, no descansos; sin ciclo, como siempre.
  assert.equal(programar([banda('A', 60), banda('B', 60), banda('C', 60)], { ...base, cantidad: 2 }).filter((m) => m.categoria !== 'pausa').length, 2)
  assert.deepEqual(programar([banda('A', 60), banda('B', 60)], { ...base, ciclo: null }).map((m) => m.titulo), ['A', 'B'])
})
