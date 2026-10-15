// La nube corre en UTC: este test arranca igual, y la hora tiene que salir en la del operador.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'UTC'
delete process.env.MASTRO_ZONA

const { abrir, ajuste } = await import('../src/db.ts')
const { aplicarZona, recibirZona, ahoraEnPalabras } = await import('../src/zona.ts')
const { eventosDelDia } = await import('../src/calendario.ts')
const { pendientes } = await import('../src/rutinas.ts')

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:charla
SUMMARY:Charla IA jurídica
DTSTART;TZID=Europe/Madrid:20261015T160000
DTEND;TZID=Europe/Madrid:20261015T170000
END:VEVENT
BEGIN:VEVENT
UID:semanal
SUMMARY:Clase semanal
DTSTART;TZID=Europe/Madrid:20261001T190000
DTEND;TZID=Europe/Madrid:20261001T200000
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`

test('zona: el servidor en UTC muestra la hora del operador (agenda, «ahora», rutinas)', () => {
  const db = abrir(':memory:')
  assert.equal(new Date('2026-10-15T14:00:00Z').toTimeString().slice(0, 5), '14:00', 'arranca en UTC, como la nube')
  assert.equal(aplicarZona(db), 'Europe/Madrid')
  assert.equal(new Date('2026-10-15T14:00:00Z').toTimeString().slice(0, 5), '16:00')

  // La charla de las 16 (CEST) se ve a las 16, no a las 14.
  const [charla] = eventosDelDia([ICS], '2026-10-15').filter((e) => e.titulo.startsWith('Charla'))
  assert.equal(new Date(charla.inicio).toTimeString().slice(0, 5), '16:00')
  // Un evento semanal creado en verano sigue a las 19 después del cambio de hora.
  const [clase] = eventosDelDia([ICS], '2026-10-29').filter((e) => e.titulo.startsWith('Clase'))
  assert.equal(new Date(clase.inicio).toTimeString().slice(0, 5), '19:00')

  // El chat sabe el día, el año y la zona.
  assert.match(ahoraEnPalabras(Date.parse('2026-10-15T05:44:00Z')), /jueves.*15.*octubre.*2026.*07:44.*Europe\/Madrid/)

  // Las rutinas disparan en su hora: la matinal (07:50) es a las 07:50 de Madrid, no a las 07:50 UTC.
  db.prepare(`UPDATE rutinas SET activa = 1, ultima_fecha = NULL`).run()
  const aLas = (iso: string) => pendientes(db, Date.parse(iso)).map((r) => r.id)
  assert.ok(!aLas('2026-10-15T05:00:00Z').includes('matinal'), '07:00 en Madrid: todavía no')
  assert.ok(aLas('2026-10-15T05:55:00Z').includes('matinal'), '07:55 en Madrid: ya')

  // Su navegador manda la zona: se guarda y rige desde ya.
  assert.deepEqual(recibirZona(db, 'America/Argentina/Buenos_Aires'), { zona: 'America/Argentina/Buenos_Aires', cambio: true })
  assert.equal(ajuste(db, 'zona'), 'America/Argentina/Buenos_Aires')
  assert.equal(new Date('2026-10-15T14:00:00Z').toTimeString().slice(0, 5), '11:00')
  assert.equal(recibirZona(db, 'America/Argentina/Buenos_Aires').cambio, false)
  assert.throws(() => recibirZona(db, 'Marte/Olympus'), /desconocida/)
  process.env.TZ = 'Europe/Madrid'
})
