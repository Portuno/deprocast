import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { comunicacionesRecientes, recibirLlamadas, recibirMensajes, ultimosContactos } from '../src/comunicaciones.ts'
import { personas } from '../src/personas.ts'
import { diarioDelDia } from '../src/diario-dia.ts'

const t = (s: string, dia = '2026-11-16') => new Date(`${dia}T${s}:00`).getTime()

test('Mobile 2.4 · llamadas y quién te escribe: se atan a la persona, cuentan como último contacto y entran al Diario (sin texto)', async () => {
  const db = abrir(':memory:')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Pérez' })
  assert.equal(await recibirLlamadas(db, 'disp:1', [
    { en: t('10:00'), numero: '+34 600 11 22 33', nombre: 'Ana Pérez', tipo: 'saliente', duracionS: 420 },
    { en: t('12:00'), numero: '+34600999888', nombre: null, tipo: 'perdida', duracionS: 0 },
  ], t('23:00')), 2)
  assert.equal(await recibirLlamadas(db, 'disp:1', [{ en: t('10:00'), numero: '+34 600 11 22 33', nombre: 'Ana Pérez', tipo: 'saliente', duracionS: 420 }], t('23:00')), 0, 'la misma llamada no entra dos veces')
  assert.equal(await recibirMensajes(db, 'disp:1', [
    { en: t('15:01'), app: 'WhatsApp', remitente: 'Ana Pérez', grupo: false },
    { en: t('15:02'), app: 'WhatsApp', remitente: 'Ana Pérez', grupo: false },
    { en: t('15:20'), app: 'WhatsApp', remitente: 'Juan', conversacion: 'Fútbol martes', grupo: true },
    { en: t('15:30'), app: 'Telegram', remitente: '', grupo: false }, // sin remitente: no entra
  ], t('23:00')), 3)
  assert.equal(ultimosContactos(db).get(ana), '2026-11-16')
  assert.equal(personas(db, { id: ana }, t('23:00'))[0].ultimoContacto, '2026-11-16')
  const d = await diarioDelDia(db, '2026-11-16', { agenda: false })
  assert.equal(d.resumen.llamadas, 2)
  assert.equal(d.resumen.recibidos, 3)
  const ll = d.momentos.filter((m) => m.tipo === 'llamada')
  assert.deepEqual(ll.map((m) => [m.titulo, m.sub]), [['Ana Pérez', 'Llamaste · 7 min'], ['600999888', 'Perdida']].map(([a, b]) => [a === '600999888' ? '+34600999888' : a, b]))
  const ms = d.momentos.find((m) => m.tipo === 'mensajes')!
  assert.equal(ms.titulo, '3 mensajes · WhatsApp')
  assert.equal(ms.sub, 'Ana Pérez (2), Fútbol martes')
  const r = comunicacionesRecientes(db, 7, t('23:00'))
  assert.equal(r.personas[0].quien, 'Ana Pérez')
  assert.equal(r.personas[0].minutos, 7)
})
