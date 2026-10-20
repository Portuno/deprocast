import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY

const { abrir } = await import('../src/db.ts')
const { insertar } = await import('../src/corpus.ts')
const { _probarEmbed } = await import('../src/semantica.ts')
const { recordar } = await import('../src/memoria.ts')
const { crearQuantomo, listarQuantomos, marcarNovedad, leerQuantomo } = await import('../src/quantomos.ts')
const modelos = await import('../src/modelos.ts')
const suenos = await import('../src/suenos.ts')
const apps = await import('../src/apps.ts')
const { crearConversacion } = await import('../src/chat/index.ts')
const tg = await import('../src/telegram.ts')
_probarEmbed(null)

const T = new Date(2026, 9, 20, 8).getTime()

test('¿Idea nueva o repetida?: cada quántomo contra los de antes, por sentido; filtro «solo nuevas»', async () => {
  const db = abrir(':memory:')
  const vec = (v: number[]) => { const n = Math.hypot(...v); return Buffer.from(new Float32Array(v.map((x) => x / n)).buffer) }
  const q = (texto: string, v: number[]) => {
    const id = crearQuantomo(db, { texto, origenId: `t:${texto}` }, T)!
    db.prepare(`INSERT INTO vec_items (tipo, id, modelo, vec, en) VALUES ('quantomo', ?, 'juguete', ?, ?)`).run(id, vec(v), T)
    return id
  }
  const a = q('El juego se aprende jugando', [1, 0, 0, 0])
  const b = q('A jugar se aprende jugando', [0.99, 0.05, 0, 0])
  const c = q('Aprender es jugar con reglas', [0.85, 0.5, 0, 0])
  const d = q('La plata viene de vender', [0, 0, 1, 0])
  const sinVector = crearQuantomo(db, { texto: 'Sin vector todavía', origenId: 't:sv' }, T)!
  assert.equal(await marcarNovedad(db), 4)
  assert.equal(await marcarNovedad(db), 0, 'una vez')
  assert.equal(leerQuantomo(db, a)!.novedad, 'nueva')
  assert.deepEqual([leerQuantomo(db, b)!.novedad, leerQuantomo(db, b)!.novedadDe], ['repetida', a])
  assert.deepEqual([leerQuantomo(db, c)!.novedad, leerQuantomo(db, c)!.novedadDe], ['variacion', b])
  assert.equal(leerQuantomo(db, d)!.novedad, 'nueva')
  assert.equal(leerQuantomo(db, sinVector)!.novedad, null)
  assert.deepEqual(listarQuantomos(db, { novedad: 'nueva' }).quantomos.map((x) => x.id).sort(), [a, d].sort())
})

test('Consejo de modelos: hasta tres, manual desde el corpus (una pieza que se rehace), «¿qué haría?», charla como personaje y calibración', async () => {
  const db = abrir(':memory:')
  const m = modelos.sumarModelo(db, { nombre: 'Ana Referente' }, T)
  assert.equal(modelos.sumarModelo(db, { entidadId: m.id }).id, m.id, 'sumarla dos veces no duplica')
  modelos.sumarModelo(db, { nombre: 'Beto Ejemplo' }, T)
  modelos.sumarModelo(db, { nombre: 'Carla Guía' }, T)
  assert.throws(() => modelos.sumarModelo(db, { nombre: 'Dani Cuarta' }), /hasta tres/)
  modelos._probarModelos({ web: async () => [] })
  await assert.rejects(modelos.armarManual(db, m.id, T), /No tengo material/)

  insertar(db, { fuente: 'operador', nivel: 'primaria', titulo: 'Entrevista a Ana Referente', contenido: 'Ana dice: «Primero el prototipo feo, después lo lindo». Publica cada semana.', entidades: [m.id], origenId: 'e:1' })
  const pedidos: { sistema: string; usuario: string }[] = []
  modelos._probarModelos({
    web: async () => [],
    modelo: async (_db, sistema, usuario) => {
      pedidos.push({ sistema, usuario })
      if (sistema.includes('manual operativo de')) return { resumen: 'Hace y muestra rápido.', principios: [{ principio: 'Prototipo feo primero', en_la_practica: 'Muestra a los dos días' }, { principio: 'Publicar cada semana', en_la_practica: 'Ritmo fijo' }], estandares: ['Que alguien lo use'], como_decide: ['Lo que se puede probar ya'], lo_que_evita: ['Pulir antes de mostrar'], frases: [{ frase: 'Primero el prototipo feo', fuente: 'entrevista' }], preguntas: ['¿Qué puedo mostrar mañana?'] }
      return { haria: 'Mostraría el boceto mañana.', por_que: 'Prototipo feo primero', primer_paso: 'Mandar el boceto a dos personas', no_haria: 'Esperar a que esté lindo', confianza: 'alta' }
    },
  })
  const conManual = await modelos.armarManual(db, m.id, T)
  assert.match(pedidos[0].usuario, /Primero el prototipo feo/)
  assert.equal(conManual.manual!.principios.length, 2)
  const pieza = conManual.manualPieza!
  assert.match(String((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(pieza) as any).contenido), /## Principios\n- \*\*Prototipo feo primero\*\*/)
  assert.equal((await modelos.armarManual(db, m.id, T + 1000)).manualPieza, pieza, 'rehacerlo actualiza la misma pieza')

  const r = await modelos.queHaria(db, 'ana', 'Tengo el juego a medias y no sé si mostrarlo')
  assert.equal(r.modelo, 'Ana Referente')
  assert.equal(r.primerPaso, 'Mandar el boceto a dos personas')
  assert.match(pedidos.at(-1)!.sistema, /Principios: Prototipo feo primero/)
  await assert.rejects(modelos.queHaria(db, 'Beto', 'Una situación cualquiera'), /todavía no tiene manual/)
  await assert.rejects(modelos.queHaria(db, 'Nadie', 'Una situación cualquiera'), /no está en tu consejo/)

  assert.match(modelos.promptModelo(db, m.id), /Sos Ana Referente[\s\S]*Prototipo feo primero/)
  const c = crearConversacion(db, `modelo:${m.id}`)
  assert.equal(c.con, `modelo:${m.id}`)
  assert.equal(modelos.preguntasDeCalibracion(db, T), 1, 'solo quien tiene manual')
  assert.match(String((db.prepare(`SELECT texto FROM preguntas WHERE origen = 'modelo'`).get() as any).texto), /Tu vara contra la de Ana Referente: .*«(Prototipo feo primero|Publicar cada semana)»/)
  modelos.quitarModelo(db, m.id)
  assert.throws(() => crearConversacion(db, `modelo:${m.id}`), /no está en tu consejo/)
})

test('Sueños: texto o audio, «soñé…» se reconoce, se lee con el día anterior; símbolos que vuelven; creencias una vez por mes', async () => {
  const db = abrir(':memory:')
  assert.ok(suenos.PARECE_SUENO.test('Soñé que volaba'))
  assert.ok(suenos.PARECE_SUENO.test('anoche soñé con mi abuela'))
  assert.ok(suenos.PARECE_SUENO.test('Tuve un sueño rarísimo'))
  assert.ok(!suenos.PARECE_SUENO.test('Mi sueño es tener una casa'), 'un deseo no es un sueño')
  const pedidos: string[] = []
  suenos._probarSuenos({
    transcribir: async () => 'Soñé que el mar entraba a la casa y mi hermana cerraba las ventanas',
    modelo: async (_db, sistema, usuario) => {
      pedidos.push(usuario)
      if (sistema.includes('CREENCIAS')) return { creencias: [{ creencia: 'Hay que hacer todo solo', por_que: 'de su forma de trabajar' }, { creencia: 'La plata viene del esfuerzo', por_que: 'lo dijo hablando de su viejo' }] }
      return { titulo: 'El mar en la casa', escenas: ['El mar entra', 'Mi hermana cierra'], personas: ['mi hermana'], simbolos: ['mar', 'ventanas'], emociones: ['miedo'], lucido: false, fuente: 'emocional', por_que_fuente: 'La discusión del día anterior', cruce: 'Ayer discutió con su hermana' }
    },
  })
  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Crónica · ayer', contenido: 'Discutió con su hermana por la mudanza.', origenId: 'cronica:2026-10-19', fecha: '2026-10-19' })
  await assert.rejects(suenos.registrarSueno(db, { texto: ' ', origen: 'manual' }, T), /vacío/)
  const s1 = await suenos.registrarSueno(db, { audio: Buffer.from('m4a'), despertar: '07:10', emociones: 'Miedo, sorpresa', origen: 'app:Morpheon' }, T)
  assert.equal(s1.fecha, '2026-10-20')
  assert.match(s1.texto, /el mar entraba/)
  assert.deepEqual(s1.emociones, ['miedo', 'sorpresa'])
  assert.equal(s1.estado, 'pendiente')
  assert.match(String((db.prepare('SELECT fuente, nivel FROM corpus WHERE id = ?').get(s1.piezaId) as any).nivel), /propia/)

  assert.equal(await suenos.destilarSuenoPendiente(db, T), true)
  assert.match(pedidos[0], /Discutió con su hermana por la mudanza/, 'se cruza con la crónica del día anterior')
  const leido = suenos.leerSueno(db, s1.id)!
  assert.equal(leido.estado, 'destilado')
  assert.equal(leido.destilado!.fuente, 'emocional')
  assert.deepEqual(leido.destilado!.emociones, ['miedo', 'sorpresa'])
  assert.match(String((db.prepare('SELECT titulo FROM corpus WHERE id = ?').get(s1.piezaId) as any).titulo), /El mar en la casa/)

  const s2 = await suenos.registrarSueno(db, { texto: 'Otra vez el mar, ahora en la oficina', fecha: '2026-10-21', lucido: true, origen: 'telegram' }, T)
  await suenos.destilarSueno(db, s2.id, T)
  const v = suenos.vistaSuenos(db, T + 86_400_000)
  assert.equal(v.total, 2)
  assert.deepEqual(v.simbolos.map((x) => [x.k, x.n]), [['mar', 2], ['ventanas', 2]])
  assert.deepEqual(v.personas[0], { k: 'mi hermana', n: 2, suenos: [s2.id, s1.id] })
  assert.equal(v.semanas.length, 8)

  assert.equal(await suenos.preguntarCreencias(db, T), 0, 'con muy poca memoria, nada')
  for (const t of ['Trabaja solo casi siempre', 'Prefiere no pedir ayuda', 'Su viejo trabajaba doble turno', 'Quiere vivir de lo que crea', 'Le cuesta delegar']) recordar(db, { texto: t, tipo: 'hecho' })
  assert.equal(await suenos.preguntarCreencias(db, T), 2)
  const q = db.prepare(`SELECT texto, opciones FROM preguntas WHERE origen = 'creencias' ORDER BY id`).all() as any[]
  assert.match(q[0].texto, /«Hay que hacer todo solo»: ¿esto lo descubriste vos o lo heredaste/)
  assert.deepEqual(JSON.parse(q[0].opciones), ['Lo descubrí yo', 'Lo heredé', 'Las dos cosas', 'Ya no lo creo'])
  assert.equal(await suenos.preguntarCreencias(db, T + 5 * 86_400_000), 0, 'una vez por mes')
})

test('Apps conectadas: el token se ve una vez, se guarda su hash, se revoca; permisos por tipo; multipart sin dependencias', () => {
  const db = abrir(':memory:')
  assert.throws(() => apps.crearApp(db, 'X', ['suenos']), /Cómo se llama/)
  assert.throws(() => apps.crearApp(db, 'Morpheon', ['todo']), /Permisos posibles/)
  const { app, token } = apps.crearApp(db, 'Morpheon', ['suenos'], T)
  assert.match(token, /^dpc_[A-Za-z0-9_-]{40,}$/)
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM apps_conectadas').all()).includes(token), 'el token no queda guardado')
  assert.equal(apps.autenticarApp(db, `Bearer ${token}`, 'suenos').app!.id, app.id)
  assert.equal(apps.autenticarApp(db, undefined).motivo, 'sin_token')
  assert.equal(apps.autenticarApp(db, `Bearer ${token.slice(0, -2)}xx`).motivo, 'invalido')
  assert.equal(apps.autenticarApp(db, `Bearer ${token}`, 'eventos').motivo, 'sin_permiso')
  assert.equal(apps.listarApps(db)[0].usos, 1)

  const otra = apps.crearApp(db, 'Diario', ['eventos'], T)
  const auth = apps.autenticarApp(db, `Bearer ${otra.token}`, 'eventos')
  const ev = apps.recibirEvento(db, auth.app!, { tipo: 'registro', titulo: 'Corrí 5 km', texto: 'Corrí 5 km por el río', fecha: '2026-10-20' }, T)
  assert.match(String((db.prepare('SELECT titulo, fuente, nivel FROM corpus WHERE id = ?').get(ev.piezaId) as any).titulo), /^Diario · Corrí 5 km/)
  assert.throws(() => apps.recibirEvento(db, auth.app!, {}), /texto o datos/)

  apps.revocarApp(db, app.id, T)
  assert.equal(apps.autenticarApp(db, `Bearer ${token}`, 'suenos').motivo, 'invalido')
  assert.throws(() => apps.revocarApp(db, app.id), /ya estaba revocada/)

  const b = 'XyZ123'
  const cuerpo = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="despertar"\r\n\r\n07:12\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="audio"; filename="sueno.m4a"\r\nContent-Type: audio/m4a\r\n\r\n`), Buffer.from([0, 1, 2, 13, 10, 3]), Buffer.from('\r\n'),
    Buffer.from(`--${b}--\r\n`),
  ])
  const m = apps.leerMultipart(cuerpo, `multipart/form-data; boundary=${b}`)
  assert.deepEqual(m.campos, { despertar: '07:12' })
  assert.equal(m.archivos.audio.nombre, 'sueno.m4a')
  assert.equal(m.archivos.audio.tipo, 'audio/m4a')
  assert.deepEqual([...m.archivos.audio.datos], [0, 1, 2, 13, 10, 3], 'el binario llega entero (aunque tenga \\r\\n adentro)')
})

test('Sueños por Telegram: /sueno y después el relato; un audio que empieza con «soñé» va a Sueños', async () => {
  const db = abrir(':memory:')
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '5'
  const enviados: any[] = []
  let n = 0
  tg._probarTelegram({
    esperar: async () => {}, pedir: async (metodo, cuerpo) => { enviados.push({ metodo, ...cuerpo }); return { ok: true, result: { message_id: ++n } } },
    bajar: async () => ({ datos: Buffer.from('ogg'), nombre: 'v.oga' }), transcribir: async () => 'Soñé que perdía el tren y no me importaba',
  })
  const msj = (x: any) => tg.procesarActualizacion(db, { message: { chat: { id: 5 }, message_id: ++n, ...x } })
  await msj({ text: '/sueno' })
  assert.match(enviados.at(-1).text, /Contámelo/)
  await msj({ text: 'Estaba en un barco y llovía para arriba' })
  assert.match(enviados.at(-1).text, /Guardé tu sueño/)
  await msj({ voice: { file_id: 'v', duration: 20 } })
  assert.match(enviados.at(-1).text, /Guardé tu sueño/)
  const xs = db.prepare('SELECT texto, origen FROM suenos ORDER BY id').all() as any[]
  assert.deepEqual(xs.map((x) => x.origen), ['telegram', 'telegram'])
  assert.match(xs[1].texto, /perdía el tren/)
})
