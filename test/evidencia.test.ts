import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY // sin NaN: lo previo se busca por palabras

const { abrir, fechaLocal, fijarAjuste } = await import('../src/db.ts')
const { insertar } = await import('../src/corpus.ts')
const { _probarEmbed } = await import('../src/semantica.ts')
const { crearMision, avanceDe, progresoInferido, actualizarMision } = await import('../src/misiones.ts')
const { crearAprendizaje, registrarPractica } = await import('../src/aprender.ts')
const ev = await import('../src/evidencia.ts')
const foco = await import('../src/foco.ts')
_probarEmbed(null)

const T = new Date(2026, 9, 19, 10).getTime() // lunes
const DIA = 86_400_000
const MIN = 60_000

test('Arranque al 20 %: lo que ya hizo hacia una primaria se encuentra, se muestra y la arranca cerca del 20 %', async () => {
  const db = abrir(':memory:')
  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Nota de voz · el podcast', contenido: 'Grabé el piloto del podcast de entrevistas y armé la lista de invitados.', fecha: '2026-08-02', origenId: 'p:1' })
  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Ideas sueltas', contenido: 'El podcast podría tener una sección de entrevistas cortas a vecinos.', fecha: '2026-09-10', origenId: 'p:2' })
  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Compras', contenido: 'Pan, leche y café.', origenId: 'p:3' })
  insertar(db, { fuente: 'operador', nivel: 'primaria', titulo: 'Un artículo sobre podcasts de entrevistas', contenido: 'Cómo hacer un podcast de entrevistas.', origenId: 'p:4' })
  const m = crearMision(db, { nivel: 'primaria', titulo: 'Lanzar el podcast de entrevistas', estado: 'activa' }, { ahora: T })

  assert.equal(avanceDe(db, m.id).progreso, 0)
  assert.equal(await ev.buscarPreviosPendientes(db, { ahora: T }), 1)
  assert.equal(await ev.buscarPreviosPendientes(db, { ahora: T }), 0, 'una vez')
  const ps = ev.previosDe(db, 'mision', m.id)
  assert.deepEqual(ps.map((p) => p.titulo).sort(), ['Ideas sueltas', 'Nota de voz · el podcast'], 'solo lo suyo (su voz) y lo que comparte palabras de peso')
  const a = avanceDe(db, m.id)
  assert.equal(a.senales!.previo, 2)
  assert.equal(a.previos!.length, 2)
  assert.ok(a.progreso >= 12 && a.progreso <= 20, `arranca con algo (${a.progreso} %)`)
  assert.equal(progresoInferido({ bandas: 0, aportes: 0, misiones: 0, piezas: 0, movimientos: 0, previo: 3 }), 20)
  assert.equal(progresoInferido({ bandas: 0, aportes: 0, misiones: 0, piezas: 0, movimientos: 0, previo: 9 }), 20, 'con tope')
  assert.match(ev.textoYaEmpezaste(ps), /^Ya empezaste: «/)

  // Nada que ver: mejor nada que algo forzado.
  const ap = crearAprendizaje(db, { tema: 'Soldadura de estaño', porQue: 'Arreglar mis pedales de guitarra' }, T)
  assert.deepEqual(await ev.buscarPrevios(db, 'aprendizaje', ap.id, 'Soldadura de estaño. Arreglar mis pedales', T), [])
})

test('Libro de evidencia: hasta tres identidades; bandas, misiones, hábitos y prácticas atadas se cuentan solas; el domingo, una pregunta', () => {
  const db = abrir(':memory:')
  const prim = crearMision(db, { nivel: 'primaria', titulo: 'Terminar el corto', estado: 'activa' }, { ahora: T - 10 * DIA })
  const b1 = crearMision(db, { nivel: 'secundaria', titulo: 'Editar la escena 3', padreId: prim.id, estado: 'activa' }, { ahora: T - 3 * DIA })
  const b2 = crearMision(db, { nivel: 'secundaria', titulo: 'Sesión de escritura', categoria: 'Escritura', estado: 'activa' }, { ahora: T - 2 * DIA })
  const b3 = crearMision(db, { nivel: 'secundaria', titulo: 'Responder mails', estado: 'activa' }, { ahora: T - 2 * DIA })
  for (const [b, d] of [[b1, 3], [b2, 2], [b3, 2]] as const) actualizarMision(db, b.id, { estado: 'hecha' }, { ahora: T - d * DIA })
  db.prepare(`INSERT INTO habitos (id, titulo) VALUES ('entreno', 'Entrenar')`).run()
  db.prepare(`INSERT INTO plan_dias (fecha, habitos, actualizado_en) VALUES (?, '{"entreno": true}', 1), (?, '{"entreno": false}', 1)`).run(fechaLocal(T - DIA), fechaLocal(T - 40 * DIA))
  const ap = crearAprendizaje(db, { tema: 'Montaje' }, T - 20 * DIA)
  registrarPractica(db, { aprendizajeId: ap.id, minutos: 30, que: 'Cortes en J', fecha: fechaLocal(T - 5 * DIA), fuente: 'manual' }, T)

  assert.throws(() => ev.crearIdentidad(db, { frase: 'Yo' }), /frase de identidad/)
  const i = ev.crearIdentidad(db, { frase: 'Soy alguien que termina lo que empieza', historiaVieja: 'Arranco mil cosas y no termino ninguna', ataduras: { primarias: [prim.id], habitos: ['entreno'], aprendizajes: [ap.id], categorias: 'escritura' as any } }, T)
  ev.crearIdentidad(db, { frase: 'Soy alguien que cuida su cuerpo' }, T)
  ev.crearIdentidad(db, { frase: 'Soy alguien que aprende en público' }, T)
  assert.throws(() => ev.crearIdentidad(db, { frase: 'Soy alguien que tiene una cuarta' }), /Hasta tres/)
  ev.anotarEvidencia(db, i.id, 'Mandé el corte a festivales', fechaLocal(T), T)

  const [libro] = ev.libroDeEvidencia(db, T)
  assert.equal(libro.frase, 'Soy alguien que termina lo que empieza')
  assert.deepEqual(libro.ultimas.map((e) => e.tipo).sort(), ['anotada', 'banda', 'banda', 'habito', 'practica'], 'la banda de mails no vota; el hábito de hace 40 días tampoco')
  assert.equal(libro.dias30, 5)
  assert.equal(libro.semana, 5)
  assert.deepEqual(libro.semanas, [0, 0, 0, 5])
  assert.equal(libro.hoy, 1)

  assert.equal(ev.preguntasDeEvidencia(db, T), 3)
  const q = db.prepare(`SELECT texto FROM preguntas WHERE origen = 'identidad' ORDER BY id`).all() as { texto: string }[]
  assert.match(q[0].texto, /juntaste 5 evidencias de «Soy alguien que termina lo que empieza», contra tu historia vieja/)
  assert.match(q[1].texto, /no hubo evidencia de «Soy alguien que cuida su cuerpo»/)

  ev.editarIdentidad(db, i.id, { estado: 'archivada' })
  assert.equal(ev.libroDeEvidencia(db, T).length, 2)
})

test('Foco desde el Directo: bloque más largo sin cambiar de tema, cambios por hora, minutos de estímulo y meta de bloque', () => {
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO directo_sesiones (inicio, estado) VALUES (?, 'cerrada')`).run(T)
  const mom = (desde: number, min: number, app: string, tema: string, detalle = '') =>
    db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, app, tema, detalle) VALUES (1, 'pantalla', ?, ?, ?, ?, ?)`).run(desde, desde + min * MIN, app, tema, detalle)
  const h = (hh: number, mm = 0, dia = T) => new Date(new Date(dia).setHours(hh, mm, 0, 0)).getTime()
  // Hoy: 40′ de guion (en dos momentos seguidos), un salto a Instagram, 20′ de guion, 15′ de mails.
  mom(h(9), 25, 'Google Docs', 'Guion del corto')
  mom(h(9, 26), 15, 'Google Docs', 'Guion del corto')
  mom(h(9, 42), 6, 'Instagram', 'Reels')
  mom(h(9, 49), 20, 'Google Docs', 'Guion del corto')
  mom(h(10, 10), 15, 'Gmail', 'Mails')
  // Hace 3 días: un bloque de 55′.
  mom(h(16, 0, T - 3 * DIA), 55, 'VS Code', 'Deprocast')

  const d = foco.focoDelDia(db, fechaLocal(T))
  assert.equal(d.bloqueMax, 41)
  assert.equal(d.bloqueQue, 'google docs · guion del corto')
  assert.equal(d.estimulo, 6)
  assert.equal(d.minutos, 81)
  assert.equal(d.cambiosPorHora, Math.round((3 / (81 / 60)) * 10) / 10)
  assert.equal(foco.metaDeBloque(db, T), 60, 'lo mejor de la semana + 5')
  const t = foco.tendenciaFoco(db, 14, T)
  assert.equal(t.dias.length, 14)
  assert.equal(t.dias.at(-1)!.fecha, fechaLocal(T))
  assert.equal(t.mejorSemana, 55)
  assert.match(foco.focoParaRun(db, T), /mejor bloque de la semana fue de 55 minutos.*unos 60 minutos/)

  fijarAjuste(db, 'apps_estimulo', 'gmail')
  assert.equal(foco.focoDelDia(db, fechaLocal(T)).estimulo, 15, 'la lista es editable')
  assert.equal(foco.metaDeBloque(abrir(':memory:'), T), null, 'sin Directo, sin meta')
})
