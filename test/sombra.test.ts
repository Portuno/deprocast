import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY

const { abrir } = await import('../src/db.ts')
const dec = await import('../src/decisiones.ts')
const sombra = await import('../src/sombra.ts')
const { sugerirMovimiento, resolverSugerido } = await import('../src/finanzas.ts')
const { agregarItem, editarItem } = await import('../src/personajes.ts')
const { crearMision, actualizarMision, leerMision } = await import('../src/misiones.ts')
const { recordar, revisar, archivar, corregir } = await import('../src/memoria.ts')
const { crearQuantomo, sellar, descartar } = await import('../src/quantomos.ts')
const { registrarCaptura, deshacerCaptura } = await import('../src/captura.ts')
const { resolverPropuestas } = await import('../src/directo.ts')
const tg = await import('../src/telegram.ts')

const T = new Date(2026, 9, 20, 10).getTime()
const ultima = (db: any, tipo: string) => ({ ...db.prepare('SELECT ref, accion FROM decisiones WHERE tipo = ? ORDER BY id DESC LIMIT 1').get(tipo) })

test('Wilson y el acierto: cada cosa vale lo último que se decidió; hacer solo y que nadie lo deshaga cuenta a favor', () => {
  assert.equal(dec.wilson(0, 0), 0)
  assert.ok(dec.wilson(30, 30) > 0.88 && dec.wilson(30, 30) < 0.9, 'con 30 de 30 todavía no llega a 0,95')
  assert.ok(dec.wilson(50, 50) > 0.92)
  assert.ok(dec.wilson(80, 80) >= 0.95)
  const db = abrir(':memory:')
  dec.anotarDecision(db, 'monto', 1, 'auto')
  dec.anotarDecision(db, 'monto', 2, 'auto')
  dec.anotarDecision(db, 'monto', 2, 'deshecha')
  dec.anotarDecision(db, 'monto', 3, 'editada')
  dec.anotarDecision(db, 'monto', 4, 'aceptada')
  dec.anotarDecision(db, 'monto', 4, 'auto') // un «auto» después de su decisión no la pisa
  assert.deepEqual(dec.aciertoDe(db, 'monto'), { n: 4, aciertos: 2, tasa: 0.5, cota: dec.aciertoDe(db, 'monto').cota })
})

test('Cada resolver anota su decisión (sin cambiar lo que hace)', async () => {
  const db = abrir(':memory:')
  // Montos
  const s1 = sugerirMovimiento(db, { monto: -12, descripcion: 'Súper' }, T)!
  resolverSugerido(db, s1.id, 'aceptar', {}, T)
  assert.deepEqual(ultima(db, 'monto'), { ref: String(s1.id), accion: 'aceptada' })
  const s2 = sugerirMovimiento(db, { monto: -40, descripcion: 'Nafta' }, T)!
  resolverSugerido(db, s2.id, 'aceptar', { monto: -45 }, T)
  assert.equal(ultima(db, 'monto').accion, 'editada')
  const s3 = sugerirMovimiento(db, { monto: 300, descripcion: 'Algo' }, T)!
  resolverSugerido(db, s3.id, 'descartar', {}, T)
  assert.equal(ultima(db, 'monto').accion, 'rechazada')
  // Inventario sugerido
  const it = agregarItem(db, 'jugador', { tipo: 'recurso', nombre: 'Cámara' } as any, { sugerido: true })
  editarItem(db, it.id, { estado: 'vigente' })
  assert.deepEqual(ultima(db, 'inventario'), { ref: String(it.id), accion: 'aceptada' })
  editarItem(db, it.id, { estado: 'archivado' })
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM decisiones WHERE tipo = 'inventario'`).get() as any).n, 1, 'lo que ya era suyo no cuenta')
  // Primarias sugeridas y side quests del escriba
  const p = crearMision(db, { nivel: 'primaria', titulo: 'Cerrar el taller', estado: 'sugerida' }, { ahora: T })
  actualizarMision(db, p.id, { estado: 'activa', titulo: 'Cerrar el taller pagado' }, { ahora: T })
  assert.equal(ultima(db, 'primaria').accion, 'editada')
  const sq = crearMision(db, { nivel: 'terciaria', titulo: 'Comprar pilas', estado: 'activa', creadaPor: 'escriba' } as any, { ahora: T })
  actualizarMision(db, sq.id, { estado: 'descartada' }, { ahora: T })
  assert.equal(ultima(db, 'side_quest').accion, 'rechazada')
  // Recuerdos del escriba (los de él no cuentan)
  const r1 = recordar(db, { texto: 'Trabaja de noche', tipo: 'hecho', creadaPor: 'escriba' }, T)
  revisar(db, r1.id)
  const r2 = recordar(db, { texto: 'Vive en Lyon', tipo: 'hecho', creadaPor: 'escriba' }, T)
  archivar(db, r2.id)
  const r3 = recordar(db, { texto: 'Toma mate amargo', tipo: 'preferencia', creadaPor: 'escriba' }, T)
  corregir(db, r3.id, { texto: 'Toma mate dulce' })
  const mio = recordar(db, { texto: 'Lo dije yo', tipo: 'hecho' }, T)
  archivar(db, mio.id)
  assert.deepEqual((db.prepare(`SELECT accion FROM decisiones WHERE tipo = 'recuerdo' ORDER BY id`).all() as any[]).map((x) => x.accion), ['aceptada', 'rechazada', 'editada'])
  // Quántomos proto
  const q1 = crearQuantomo(db, { texto: 'Uno', origenId: 'q1' }, T)!
  const q2 = crearQuantomo(db, { texto: 'Dos', origenId: 'q2' }, T)!
  sellar(db, q1, 7, T)
  descartar(db, q2, T)
  assert.deepEqual((db.prepare(`SELECT accion FROM decisiones WHERE tipo = 'quantomo' ORDER BY id`).all() as any[]).map((x) => x.accion), ['aceptada', 'rechazada'])
  // Captura: registrar es «auto»; deshacer o corregir cuentan en contra
  const reg = registrarCaptura(db, { tipo: 'gasto', titulo: 'Café', fecha: null, hora: null, datos: { monto: 2.5 }, confianza: 0.9, descripcion: '' } as any, { ahora: T })!
  assert.equal(ultima(db, 'captura').accion, 'auto')
  deshacerCaptura(db, reg.tabla, reg.id)
  assert.equal(ultima(db, 'captura').accion, 'deshecha')
  assert.equal(dec.aciertoDe(db, 'captura').aciertos, 0)
})

test('Modo sombra: ofrece «auto» cuando la cota llega a 0,95 (unos 80 aciertos), nunca solo; en auto lo hace, queda en «hecho solo» y se deshace', async () => {
  const db = abrir(':memory:')
  assert.throws(() => dec.fijarModo(db, 'primaria', 'auto'), /todavía no se puede hacer solo/)
  assert.equal(dec.modoDe(db, 'monto'), 'sombra')
  for (let i = 1; i <= 80; i++) dec.anotarDecision(db, 'monto', 1000 + i, 'aceptada')
  const e = dec.estadoSombra(db).find((x) => x.tipo === 'monto')!
  assert.equal(e.ofrecerAuto, true)
  assert.equal(dec.modoDe(db, 'monto'), 'sombra', 'ofrecer no es pasar')

  // La oferta llega en el aviso (con botón) y la respuesta por Telegram lo prende.
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '3'
  const enviados: any[] = []
  tg._probarTelegram({ esperar: async () => {}, pedir: async (m, c) => { enviados.push({ m, ...c }); return { ok: true, result: { message_id: 9 } } } })
  const aviso = sombra.avisoBandeja(db, T)!
  assert.match(aviso.texto, /acerté 80 de 80/)
  const dato = aviso.botones[0][0].dato
  assert.equal(sombra.avisoBandeja(db, T + 60_000)?.botones.length ?? 0, 0, 'la oferta no se repite enseguida')
  await tg.procesarActualizacion(db, { callback_query: { id: 'q', data: dato, message: { chat: { id: 3 }, message_id: 9 } } })
  assert.equal(dec.modoDe(db, 'monto'), 'auto')
  assert.match(enviados.at(-1).text, /lo hago solo/)

  // En auto: el monto entra solo, deshacible; deshacerlo lo devuelve a la bandeja y cuenta en contra.
  const s = sugerirMovimiento(db, { monto: -8, descripcion: 'Pan' }, T)!
  const mov = db.prepare('SELECT movimiento_id, estado FROM movimientos_sugeridos WHERE id = ?').get(s.id) as any
  assert.equal(mov.estado, 'aceptado')
  const solos = dec.hechoSolo(db, T - 1000)
  assert.equal(solos.length, 1)
  assert.match(solos[0].texto, /Pan: -8/)
  sombra.deshacerDecision(db, solos[0].id, T)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM movimientos WHERE id = ?').get(mov.movimiento_id) as any).n, 0)
  assert.equal((db.prepare('SELECT estado FROM movimientos_sugeridos WHERE id = ?').get(s.id) as any).estado, 'pendiente')
  assert.throws(() => sombra.deshacerDecision(db, solos[0].id, T), /Ya estaba deshecho/)
  assert.equal(dec.hechoSolo(db, T - 1000).length, 0)
  assert.equal(ultima(db, 'monto').accion, 'deshecha')
})

test('Directo: lo que va solo queda anotado con cómo deshacerlo; la bandeja junta lo pendiente y resuelve por el camino de siempre', async () => {
  const db = abrir(':memory:')
  const prop = (id: string, tipo: string, titulo: string) => ({ id, tipo, estado: 'pendiente', titulo, detalle: null, misionId: null, tipoEntidad: null, tipoCon: null, alias: [], de: null, con: null, oido: null })
  const sid = Number(db.prepare(`INSERT INTO directo_sesiones (inicio, fin, estado, resumen) VALUES (?, ?, 'cerrada', ?)`)
    .run(T, T, JSON.stringify({ propuestas: [prop('a', 'tarea', 'Llamar al gestor'), prop('b', 'tarea', 'Mandar el presupuesto'), prop('c', 'idea', 'Un taller por mes')] })).lastInsertRowid)
  resolverPropuestas(db, sid, ['a'], 'aceptar', T, { sola: true })
  resolverPropuestas(db, sid, ['c'], 'rechazar', T)
  const [solo] = dec.hechoSolo(db, T - 1)
  assert.equal(solo.tipo, 'directo:tarea')
  const misionId = (db.prepare(`SELECT id FROM misiones WHERE titulo = 'Llamar al gestor'`).get() as any).id
  sombra.deshacerDecision(db, solo.id, T)
  assert.equal(leerMision(db, misionId)!.estado, 'descartada')
  assert.equal(ultima(db, 'directo:idea').accion, 'rechazada')

  sugerirMovimiento(db, { monto: -20, descripcion: 'Libro' }, T)
  crearMision(db, { nivel: 'primaria', titulo: 'Escribir la propuesta', estado: 'sugerida' }, { ahora: T })
  const r = recordar(db, { texto: 'Prefiere reuniones cortas', tipo: 'preferencia', creadaPor: 'escriba' }, T)
  const b = sombra.bandeja(db, T)
  assert.deepEqual(b.grupos.map((g) => g.tipo), ['monto', 'primaria', 'directo', 'recuerdo'])
  assert.equal(b.grupos.find((g) => g.tipo === 'directo')!.n, 1)
  assert.equal(b.total, 4)
  await sombra.resolverBandeja(db, 'recuerdo', r.id, 'aceptar', T)
  assert.equal(ultima(db, 'recuerdo').accion, 'aceptada')
  // Lo del Directo ahora se resuelve en la misma bandeja: «sesión:propuesta».
  const item = b.grupos.find((g) => g.tipo === 'directo')!.items[0]
  assert.equal(item.id, `${sid}:b`)
  assert.equal(item.texto, 'Tarea: Mandar el presupuesto')
  await sombra.resolverBandeja(db, 'directo', item.id, 'aceptar', T)
  assert.ok(db.prepare(`SELECT 1 FROM misiones WHERE titulo = 'Mandar el presupuesto'`).get())
  await assert.rejects(sombra.resolverBandeja(db, 'nombre', 1, 'aceptar'), /se resuelve en su sección/)
})

test('Captura: el umbral sigue al acierto', () => {
  const db = abrir(':memory:')
  assert.equal(sombra.umbralCaptura(db), 0.7)
  for (let i = 0; i < 25; i++) dec.anotarDecision(db, 'captura', `salud:${i}`, i < 15 ? 'deshecha' : 'auto')
  assert.equal(sombra.umbralCaptura(db), 0.85, 'viene errando: pide más confianza')
  dec.fijarModo(db, 'captura', 'manual')
  assert.equal(sombra.umbralCaptura(db), 2, 'en manual nunca registra sola')
  const db2 = abrir(':memory:')
  for (let i = 0; i < 80; i++) dec.anotarDecision(db2, 'captura', `salud:${i}`, 'auto')
  assert.equal(sombra.umbralCaptura(db2), 0.6, 'acierta casi siempre: se suelta un poco')
})
