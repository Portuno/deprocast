import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { guardarPuntos } from '../src/recorrido.ts'
import { recibirCapas } from '../src/capas.ts'
import * as t from '../src/territorio.ts'
import { _probarArchivosMovil, recibirArchivoMovil } from '../src/archivos-movil.ts'

process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-territorio-'))
const CASA = { lat: 39.4699, lon: -0.3763 }
const XATIVA = { lat: 38.9897, lon: -0.5181 }
const h = (s: string) => new Date(`2026-11-16T${s}:00`).getTime()

test('#259 · privacidad: lo de una zona, una franja o una pausa no se registra; exportar y borrar un rango', async () => {
  const db = abrir(':memory:')
  t.fijarPrivacidad(db, { zonas: [{ nombre: 'Casa', ...CASA, radio: 200 }], franjas: [{ desde: '23:00', hasta: '06:00' }] })
  const r = guardarPuntos(db, 'disp:1', [
    { en: h('10:00'), ...CASA }, // en casa: no
    { en: h('10:05'), lat: CASA.lat + 0.01, lon: CASA.lon }, // a 1 km: sí
    { en: h('23:30'), lat: CASA.lat + 0.01, lon: CASA.lon }, // franja: no
  ], h('23:59'))
  assert.equal(r.guardados, 1)
  // Los minutos de la escucha en casa quedan, pero sin lugar.
  recibirCapas(db, 1, [{ minuto: h('10:00'), hablo: 10, escucho: 0, ruido: 0, silencio: 50, vozDb: null, vozCercaDb: null, pisoDb: null, pasos: 30, caminando: 0, ...CASA, precision: 10 } as any], h('10:30'))
  assert.equal((db.prepare('SELECT lat FROM capas_minuto').get() as any).lat, null)
  t.fijarPrivacidad(db, { pausadoHasta: h('12:00') })
  assert.equal(guardarPuntos(db, 'disp:1', [{ en: h('11:00'), lat: 40, lon: -3 }], h('11:01')).guardados, 0, 'en pausa')

  const g = await t.exportarRango(db, '2026-11-16', '2026-11-16')
  assert.equal(g.type, 'FeatureCollection')
  assert.equal(g.features.length, 1)
  assert.deepEqual(t.borrarRango(db, '2026-11-16', '2026-11-16'), { puntos: 1, minutos: 0 })
})

test('#259 · cada pieza con su lugar, buscar «lo que hablé en Xàtiva», paradas frecuentes y cruces por persona', async () => {
  const db = abrir(':memory:')
  const lugar = asegurarEntidad(db, { tipo: 'lugar', nombre: 'Xàtiva', meta: XATIVA })
  // Estuvo en Xàtiva de 10 a 11 (puntos cada 5 min) y grabó un audio a las 10:30.
  guardarPuntos(db, 'disp:1', Array.from({ length: 13 }, (_, i) => ({ en: h('10:00') + i * 5 * 60_000, lat: XATIVA.lat + i * 0.00001, lon: XATIVA.lon })), h('12:00'))
  asegurarFuente(db, { id: 'voz', nombre: 'Notas de voz', nivel: 'propia' })
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba' })
  const audio = insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · castillo', contenido: 'Hablé con Ana del castillo.', meta: { voz: { inicio: h('10:30') } }, entidades: [ana] }, h('10:31'))!
  insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · en casa', contenido: 'Otra cosa.', meta: { voz: { inicio: h('20:00') } } }, h('20:01'))
  assert.deepEqual(t.lugarEn(db, h('10:30')), { lat: t.lugarEn(db, h('10:30'))!.lat, lon: XATIVA.lon, nombre: 'Xàtiva', lugarId: lugar })
  assert.equal(t.lugarEn(db, h('20:00')), null, 'sin recorrido a esa hora')
  assert.equal(t.ubicarPiezas(db, { desde: 0 }), 1)
  const meta = JSON.parse((db.prepare('SELECT meta FROM corpus WHERE id = ?').get(audio) as any).meta)
  assert.equal(meta.lugar.nombre, 'Xàtiva')

  const b = await t.buscarPorLugar(db, 'xativa', { radio: 500 })
  assert.equal(b.lugar!.nombre, 'Xàtiva')
  assert.deepEqual(b.visitas.map((v) => [v.fecha, v.desde, v.hasta]), [['2026-11-16', '10:00', '11:00']])
  assert.deepEqual(b.piezas.map((p) => p.titulo), ['Audio · castillo'])

  // Dónde se cruzaron con Ana.
  const r = await t.recorridoRango(db, '2026-11-16', '2026-11-16', { entidad: ana })
  assert.equal(r.cruces.length, 1)
  assert.ok(r.paradas.length >= 1)

  // Un lugar que se repite 3 días y no tiene nombre se propone para nombrar; nombrado, deja de proponerse.
  const OFI = { lat: 39.48, lon: -0.35 }
  for (const dia of ['2026-11-14', '2026-11-15', '2026-11-16']) guardarPuntos(db, 'disp:1', [0, 5, 10, 15].map((m) => ({ en: new Date(`${dia}T09:00:00`).getTime() + m * 60_000, ...OFI })), h('23:00'))
  const f = t.paradasFrecuentes(db, h('23:00'))
  assert.equal(f.length, 1)
  assert.equal(f[0].dias, 3)
  await t.guardarLugar(db, { nombre: 'La oficina', ...OFI })
  assert.equal(t.paradasFrecuentes(db, h('23:00')).length, 0)
})

test('Actividad: los pasos del teléfono (el mayor que informó) o los de la escucha, minutos caminando, km y la meta', () => {
  const db = abrir(':memory:')
  t.anotarPasos(db, 'disp:1', '2026-11-16', 3000)
  t.anotarPasos(db, 'disp:1', '2026-11-16', 2500) // un contador viejo no baja lo que ya se vio
  recibirCapas(db, 1, [{ minuto: h('09:00'), hablo: 0, escucho: 0, ruido: 0, silencio: 60, vozDb: null, vozCercaDb: null, pisoDb: null, pasos: 120, caminando: 60 } as any], h('09:30'))
  // Caminó 1 km en 12 minutos (5 km/h).
  guardarPuntos(db, 'disp:1', Array.from({ length: 5 }, (_, i) => ({ en: h('18:00') + i * 3 * 60_000, lat: CASA.lat + i * 0.00225, lon: CASA.lon })), h('19:00'))
  const a = t.actividadDelDia(db, '2026-11-16')
  assert.equal(a.pasos, 3000)
  assert.equal(a.fuente, 'teléfono')
  assert.equal(a.meta, 8000)
  assert.equal(a.avance, 38)
  assert.equal(a.km, 1)
  assert.equal(a.minutosCaminando, 12)
})

test('Mobile 1.2 · fotos y videos desde Hoy: un registro se anota solo; otra foto se lee y se charla; un video se transcribe', async () => {
  const db = abrir(':memory:')
  const charlas: string[] = [], avisos: string[] = []
  _probarArchivosMovil({
    clasificar: async (_db, _img, nota) => (nota === 'el almuerzo' ? { tipo: 'comida', confianza: 0.95, titulo: 'Almuerzo: milanesa', descripcion: '', datos: { kcal: 700 } } : { tipo: 'otro', confianza: 0.9, titulo: '', descripcion: '', datos: {} }) as any,
    leer: async () => ({ clase: 'texto', titulo: 'Cartel', descripcion: 'Un cartel de la parada.', texto: 'Línea 140', grupos: [], ilegible: [], modelo: null }),
    transcribir: async () => 'Acá estoy en la parada esperando el bus.',
    ffmpeg: async (args) => { fs.writeFileSync(args.at(-1)!, Buffer.alloc(2000, 1)); return { ok: true, salida: '' } },
    charlar: async (_db, x) => { charlas.push(x) },
    avisar: async (_db, x) => { avisos.push(x) },
  })
  const jpg = Buffer.from('\xff\xd8\xff foto', 'binary')
  await recibirArchivoMovil(db, jpg, { nombre: 'a.jpg', mime: 'image/jpeg', nota: 'el almuerzo', dispositivo: 'Teléfono' }).trabajo
  assert.match(avisos[0], /📸 .*Almuerzo: milanesa/)
  await recibirArchivoMovil(db, Buffer.from('\xff\xd8\xff otra', 'binary'), { nombre: 'b.jpg', mime: 'image/jpeg', lat: 39.47, lon: -0.37, dispositivo: 'Teléfono' }).trabajo
  assert.match(charlas[0], /foto desde Teléfono, ya leída entera y guardada en su corpus \[#\d+\]/)
  const foto = db.prepare(`SELECT meta FROM corpus WHERE fuente = 'capturas'`).get() as any
  assert.equal(JSON.parse(foto.meta).lugar.lat, 39.47)
  const v = recibirArchivoMovil(db, Buffer.alloc(5000, 2), { nombre: 'v.mp4', mime: 'video/mp4', nota: 'la parada', dispositivo: 'Teléfono' })
  assert.equal(v.tipo, 'video')
  await v.trabajo
  const pieza = db.prepare(`SELECT titulo, contenido FROM corpus WHERE fuente = 'videos'`).get() as any
  assert.match(pieza.titulo, /^Video · .* · Cartel$/)
  assert.match(pieza.contenido, /## Lo que se dice\nAcá estoy en la parada/)
  assert.match(charlas.at(-1)!, /Te mandé un video .* Lo que se ve: Un cartel/)
  assert.throws(() => recibirArchivoMovil(db, Buffer.alloc(0), { nombre: 'a.pdf', mime: 'application/pdf', dispositivo: 'Teléfono' }), /vacío/)
})
