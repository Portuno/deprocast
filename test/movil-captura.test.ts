import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import * as uso from '../src/uso-telefono.ts'
import { cambiosDeCarga, parteEnchufado, recibirCarga } from '../src/carga-telefono.ts'
import { estimarSueno } from '../src/sueno-estimado.ts'
import { registrarSalud } from '../src/salud.ts'
import { _probarArchivosMovil, recibirArchivoMovil } from '../src/archivos-movil.ts'

process.env.MASTRO_ADJUNTOS ??= fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-captura-'))
const MIN = 60_000
const t = (s: string, dia = '2026-11-16') => new Date(`${dia}T${s}:00`).getTime()

test('Mobile 2.1 · la carga: enchufar y desenchufar se ubican entre dos muestras; muy separadas, no se sabe', () => {
  const ms = [
    { en: t('23:30', '2026-11-15'), cargando: false, nivel: 0.4 },
    { en: t('23:45', '2026-11-15'), cargando: true, nivel: 0.41 },
    { en: t('07:00'), cargando: true, nivel: 1 },
    { en: t('07:15'), cargando: false, nivel: 1 },
    { en: t('09:00'), cargando: true, nivel: 0.9 }, // 1 h 45 después: no se sabe cuándo lo enchufó
  ]
  const c = cambiosDeCarga(ms)
  assert.equal(c.length, 2)
  assert.equal(c[0].en, t('23:37', '2026-11-15') + 30_000)
  assert.equal(c[0].enchufado, true)
  assert.equal(c[1].enchufado, false)
  assert.ok(parteEnchufado(ms, t('00:00'), t('06:30')) < 0.2, 'una muestra vale como mucho 40 min')
  const cada15 = Array.from({ length: 30 }, (_, i) => ({ en: t('23:45', '2026-11-15') + i * 15 * MIN, cargando: true, nivel: null }))
  assert.ok(parteEnchufado(cada15, t('00:00'), t('06:30')) > 0.95)
})

test('Mobile 2.1 · el sueño estimado usa la carga: desenchufar es levantarte, y una noche enchufado suma una fuente', () => {
  const db = abrir(':memory:')
  // Pantalla hasta las 00:40; a la mañana, desenchufa el teléfono y recién un rato después prende la pantalla.
  uso.recibirUso(db, 'disp:1', [{ fecha: '2026-11-16', pantallaMin: 40, desbloqueos: 5, apps: [], sesiones: [[t('00:00'), t('00:40')], [t('07:40'), t('07:50')]] }] as any)
  const muestras = Array.from({ length: 30 }, (_, i) => ({ en: t('00:45') + i * 15 * MIN, cargando: t('00:45') + i * 15 * MIN < t('07:20'), nivel: null }))
  assert.equal(recibirCarga(db, 'disp:1', muestras), 30)
  assert.equal(recibirCarga(db, 'disp:1', muestras), 0, 'la misma muestra no entra dos veces')
  const s = estimarSueno(db, '2026-11-16')!
  assert.equal(s.dormir, '00:40')
  assert.equal(s.despertar, '07:22', 'se levantó al desenchufar (entre las muestras de 07:15 y 07:30)')
  assert.ok(s.fuentes.includes('carga'))
  assert.equal(s.confianza, 'alta')
})

test('Mobile 2.1 · el ánimo es un tipo de salud, de 1 a 5', () => {
  const db = abrir(':memory:')
  const r = registrarSalud(db, { tipo: 'animo', titulo: 'Ánimo 4/5', datos: { animo: 4, energia: 9 }, fuente: 'teléfono' })
  assert.equal(r.tipo, 'animo')
  assert.deepEqual(r.datos, { animo: 4, energia: 5 }, 'la energía se acota a 5')
})

test('Mobile 2.1 · una foto que el teléfono subió solo (galería) se lee y se guarda sin abrir charla en Hoy; un registro igual se avisa', async () => {
  const db = abrir(':memory:')
  const charlas: string[] = [], avisos: string[] = []
  _probarArchivosMovil({
    clasificar: async (_db, _img, nota) => (nota === 'ticket' ? { tipo: 'gasto', confianza: 0.95, titulo: 'Súper', descripcion: '', datos: { monto: 12 } } : { tipo: 'otro', confianza: 0.9, titulo: '', descripcion: '', datos: {} }) as any,
    leer: async () => ({ clase: 'foto', titulo: 'Atardecer', descripcion: 'El mar.', texto: '', grupos: [], ilegible: [], modelo: null }),
    charlar: async (_db, x) => { charlas.push(x) },
    avisar: async (_db, x) => { avisos.push(x) },
  })
  await recibirArchivoMovil(db, Buffer.from('\xff\xd8\xff mar', 'binary'), { nombre: 'IMG_1.jpg', mime: 'image/jpeg', dispositivo: 'Teléfono', auto: true }).trabajo
  assert.equal(charlas.length, 0, 'sin charla')
  assert.ok(db.prepare(`SELECT 1 FROM corpus WHERE titulo LIKE '%Atardecer%'`).get(), 'pero queda leída en el corpus')
  await recibirArchivoMovil(db, Buffer.from('\xff\xd8\xff mar2', 'binary'), { nombre: 'IMG_2.jpg', mime: 'image/jpeg', dispositivo: 'Teléfono' }).trabajo
  assert.equal(charlas.length, 1, 'la que mandaste vos sí se charla')
})
