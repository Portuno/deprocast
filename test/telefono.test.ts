import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import * as uso from '../src/uso-telefono.ts'
import * as avisos from '../src/avisos-movil.ts'
import { _probarArchivosMovil, _probarDocumentos, recibirArchivoMovil, tipoDeArchivo } from '../src/archivos-movil.ts'

process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-telefono-'))
const h = (s: string, dia = '2026-11-16') => new Date(`${dia}T${s}:00`).getTime()

test('Mobile 1.3 · uso del teléfono: cada envío reemplaza el día; distracción por categoría y por lo que él marca; el lanzador no cuenta', () => {
  const db = abrir(':memory:')
  const dia = { fecha: '2026-11-16', pantallaMin: 200, desbloqueos: 40, apps: [
    { paquete: 'com.instagram.android', nombre: 'Instagram', min: 50, aperturas: 12 },
    { paquete: 'com.google.android.youtube', nombre: 'YouTube', min: 30, aperturas: 3 },
    { paquete: 'com.whatsapp', nombre: 'WhatsApp', min: 40, aperturas: 25 },
    { paquete: 'com.ejemplo.lector', nombre: 'Lector', min: 20, aperturas: 2 },
    { paquete: 'com.google.android.apps.nexuslauncher', nombre: 'Pixel Launcher', min: 15, aperturas: 30 },
  ] }
  assert.equal(uso.recibirUso(db, 'disp:1', [dia, { fecha: 'mal' }]), 1)
  // Un reenvío del mismo día (más tarde) reemplaza, no suma.
  uso.recibirUso(db, 'disp:1', [{ ...dia, pantallaMin: 210, apps: dia.apps.map((a) => (a.nombre === 'Instagram' ? { ...a, min: 60 } : a)) }])
  const u = uso.usoDelDia(db, '2026-11-16')
  assert.equal(u.pantallaMin, 210)
  assert.equal(u.desbloqueos, 40)
  assert.equal(u.distraccionMin, 90, 'Instagram 60 + YouTube 30')
  assert.ok(!u.apps.some((a) => /Launcher/.test(a.nombre)), 'el lanzador no cuenta')
  assert.equal(u.porCategoria.mensajes, 40)
  uso.fijarDistracciones(db, ['Lector'])
  assert.equal(uso.usoDelDia(db, '2026-11-16').distraccionMin, 110)
  assert.match(uso.lineaDelDia(db, '2026-11-16')!, /^3 h 30 min de pantalla \(1 h 50 min en distracción: Instagram 60, YouTube 30, Lector 20\); 40 desbloqueos$/)
  const s = uso.usoDeDias(db, 7, '2026-11-16')
  assert.equal(s.diasConDatos, 1)
  assert.equal(s.dias.length, 7)
  assert.equal(s.promedio.distraccionMin, 110)
  assert.equal(uso.lineaDelDia(db, '2026-11-15'), null)
  assert.equal(uso.categoriaDe('com.zhiliaoapp.musically'), 'redes')
})

test('Mobile 1.3 · avisos: los eventos unos minutos antes y los recordatorios, a su hora; lo que ya pasó no', async () => {
  const db = abrir(':memory:')
  const ahora = h('10:00')
  avisos._probarAvisos(async (f) => (f === '2026-11-16' ? [
    { titulo: 'Reunión', inicio: h('11:00'), fin: h('12:00'), todoElDia: false, lugar: 'Oficina' },
    { titulo: 'Ya fue', inicio: h('09:00'), fin: h('09:30'), todoElDia: false, lugar: null },
    { titulo: 'Feriado', inicio: h('00:00'), fin: h('23:59'), todoElDia: true, lugar: null },
  ] : [{ titulo: 'Dentista', inicio: h('09:00', '2026-11-17'), fin: h('10:00', '2026-11-17'), todoElDia: false, lugar: null }]) as any)
  assert.equal(avisos.cuandoDe({ cuando: '18:30' }, ahora), h('18:30'))
  assert.equal(avisos.cuandoDe({ cuando: '08:00' }, ahora), h('08:00', '2026-11-17'), 'ya pasó: mañana')
  assert.equal(avisos.cuandoDe({ minutos: 20 }, ahora), ahora + 20 * 60_000)
  assert.equal(avisos.cuandoDe({ cuando: 'el jueves' }, ahora), null)
  assert.throws(() => avisos.crearRecordatorio(db, 'tarde', h('08:00'), ahora), /futuro/)
  const r = avisos.crearRecordatorio(db, 'Llamar a la imprenta', h('18:30'), ahora)
  const p = await avisos.proximosAvisos(db, ahora)
  assert.equal(p.minutosAntes, 10)
  assert.deepEqual(p.avisos.map((a) => [a.titulo, a.en]), [['📅 Reunión', h('10:50')], ['⏰ Recordatorio', h('18:30')], ['📅 Dentista', h('08:50', '2026-11-17')]])
  assert.match(p.avisos[0].cuerpo, /En 10 min \(11:00\) · Oficina/)
  assert.ok(avisos.borrarRecordatorio(db, r.id))
  assert.equal(avisos.recordatorios(db, ahora).length, 0)
})

test('Mobile 1.3 · compartir: un audio se transcribe y va a Hoy (uno largo queda como nota de voz, sin repetirse); un documento se carga solo', async () => {
  const db = abrir(':memory:')
  const charlas: string[] = [], avisosHoy: string[] = []
  const largo = 'Esta es una nota de voz larga sobre el proyecto. '.repeat(12)
  _probarArchivosMovil({ transcribir: async () => largo, charlar: async (_db, x) => { charlas.push(x) }, avisar: async (_db, x) => { avisosHoy.push(x) } })
  assert.equal(tipoDeArchivo('PTT-20261116.opus', 'audio/ogg'), 'audio')
  assert.equal(tipoDeArchivo('chat.zip', 'application/zip'), 'documento')
  await recibirArchivoMovil(db, Buffer.alloc(3000, 1), { nombre: 'PTT-1.opus', mime: 'audio/ogg', dispositivo: 'Teléfono' }).trabajo
  assert.match(charlas[0], /Te compartí un audio desde Teléfono \(«PTT-1\.opus», guardado como nota de voz \[#\d+\]\)\. Lo que dice:\nEsta es una nota/)
  await recibirArchivoMovil(db, Buffer.alloc(3000, 2), { nombre: 'PTT-1-reenviado.opus', mime: 'audio/ogg', dispositivo: 'Teléfono' }).trabajo
  assert.match(charlas[1], /que ya estaba \(#\d+/)
  _probarDocumentos(async (_db, nombre) => `📄 Cargué «${nombre}»: 3 piezas nuevas.`)
  const d = recibirArchivoMovil(db, Buffer.from('%PDF-1.4'), { nombre: 'informe.pdf', mime: 'application/pdf', nota: 'para el lunes', dispositivo: 'Teléfono' })
  assert.equal(d.tipo, 'documento')
  await d.trabajo
  assert.match(avisosHoy.at(-1)!, /📄 Cargué «informe\.pdf»: 3 piezas nuevas\. \(con tu nota: «para el lunes»\)/)
  assert.match(charlas.at(-1)!, /ya está cargado en tu corpus\.\)\npara el lunes/)
})

test('Fragua #298 · sueño estimado sin reloj: el hueco más largo de la noche, con una mirada al teléfono como interrupción; nunca pisa uno anotado', async () => {
  const { estimarSueno, anotarSuenoEstimado } = await import('../src/sueno-estimado.ts')
  const { conversacionHoy } = await import('../src/chat/index.ts')
  const db = abrir(':memory:')
  const t = (s: string, dia = '2026-11-16') => new Date(`${dia}T${s}:00`).getTime()
  // Pantalla: hasta las 00:40 del 16 (sesión de la víspera), una mirada 03:10–03:13, y desde las 07:50.
  uso.recibirUso(db, 'disp:1', [
    { fecha: '2026-11-15', pantallaMin: 120, desbloqueos: 30, apps: [], sesiones: [[t('22:00', '2026-11-15'), t('23:59', '2026-11-15')]] },
    { fecha: '2026-11-16', pantallaMin: 60, desbloqueos: 10, apps: [], sesiones: [[t('00:00'), t('00:40')], [t('03:10'), t('03:13')], [t('07:50'), t('08:20')]] },
  ] as any)
  // Un mensaje suyo a las 08:30 (otra fuente).
  const c = conversacionHoy(db)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'operador', 'buen día', ?)`).run(c.id, t('08:30'))
  const s = estimarSueno(db, '2026-11-16')!
  assert.equal(s.dormir, '00:40')
  assert.equal(s.despertar, '07:50')
  assert.equal(s.interrupciones, 1)
  assert.equal(s.horas, 7.2)
  assert.equal(s.confianza, 'alta')
  assert.deepEqual(s.fuentes.sort(), ['chat', 'pantalla'])
  await anotarSuenoEstimado(db, '2026-11-16')
  const r = db.prepare(`SELECT titulo, fuente, datos FROM salud WHERE tipo = 'sueno' AND fecha = '2026-11-16'`).get() as any
  assert.equal(r.fuente, 'estimado')
  assert.match(r.titulo, /^Dormiste ~7,2 h \(estimado, 00:40–07:50, 1 interrupción\)$/)
  assert.equal(JSON.parse(r.datos).origen, 'estimado')
  // Uno anotado a mano manda: el estimado no lo pisa.
  db.prepare(`UPDATE salud SET fuente = 'manual' WHERE tipo = 'sueno'`).run()
  assert.equal(await anotarSuenoEstimado(db, '2026-11-16'), null)
  // Sin actividad después de dormir (no se sabe cuándo se despertó): no se estima.
  assert.equal(estimarSueno(db, '2026-11-17'), null)
})
