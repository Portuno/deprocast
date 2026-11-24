import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { guardarPuntos } from '../src/recorrido.ts'
import { registrarSalud } from '../src/salud.ts'
import { agruparCharlas, diarioDelDia } from '../src/diario-dia.ts'
import { telefonoCallado, vigilarCaptura } from '../src/vigia-captura.ts'

const MIN = 60_000
const t = (s: string, dia = '2026-11-16') => new Date(`${dia}T${s}:00`).getTime()

test('Mobile 2.2 · el Diario del día: el sueño, las paradas y trayectos, el ánimo y los gastos, en orden y con sus números', async () => {
  const db = abrir(':memory:')
  // 08:00–08:20 en casa, 08:20–08:40 caminando hacia el norte, 08:40–09:10 en otra parada.
  const casa = Array.from({ length: 21 }, (_, i) => ({ en: t('08:00') + i * MIN, lat: 39.47, lon: -0.376 }))
  const camino = Array.from({ length: 20 }, (_, i) => ({ en: t('08:21') + i * MIN, lat: 39.47 + (i + 1) * 0.0008, lon: -0.376 }))
  const oficina = Array.from({ length: 30 }, (_, i) => ({ en: t('08:41') + i * MIN, lat: 39.486, lon: -0.376 }))
  guardarPuntos(db, 'disp:1', [...casa, ...camino, ...oficina], t('12:00'))
  registrarSalud(db, { tipo: 'sueno', fecha: '2026-11-16', titulo: 'Dormiste ~7 h', datos: { horas: 7, dormir: '00:40', despertar: '07:40' }, fuente: 'estimado' }, t('09:00'))
  registrarSalud(db, { tipo: 'animo', fecha: '2026-11-16', hora: '11:00', titulo: 'Ánimo 4/5', datos: { animo: 4 }, fuente: 'teléfono' }, t('11:00'))
  db.prepare(`INSERT INTO movimientos (fecha, monto, descripcion, categoria, huella, creado_en) VALUES ('2026-11-16', -12.5, 'Súper', 'comida', 'h1', ?)`).run(t('13:00'))
  const d = await diarioDelDia(db, '2026-11-16', { agenda: false })
  const tipos = d.momentos.map((m) => m.tipo)
  assert.deepEqual(tipos, ['sueno', 'parada', 'trayecto', 'parada', 'animo', 'gasto'])
  assert.equal(d.resumen.paradas, 2)
  assert.equal(d.resumen.suenoHoras, 7)
  assert.equal(d.resumen.animo, 4)
  assert.equal(d.resumen.gastos, 12.5)
  assert.ok(d.resumen.km > 1.5, `km: ${d.resumen.km}`)
  assert.equal(d.mapa.paradas.length, 2)
  assert.equal(d.pasosPorHora.length, 24)
})

test('Mobile 2.2 · lo dicho cerca del teléfono se agrupa en charlas (turnos a menos de 5 min)', () => {
  const xs = agruparCharlas([
    { inicio: t('10:00'), fin: t('10:01'), texto: 'hola', quien: 'Ana', modo: 'conversacion' },
    { inicio: t('10:02'), fin: t('10:03'), texto: '¿cómo va?', quien: 'Yo', modo: 'conversacion' },
    { inicio: t('12:00'), fin: t('12:00') + 5000, texto: 'comprar pan', quien: null, modo: 'dictado' },
  ])
  assert.equal(xs.length, 2)
  assert.match(xs[0].titulo, /^Charla con Ana, Yo · 2 turnos$/)
  assert.equal(xs[1].titulo, 'Le dictaste')
})

test('Mobile 2.2 · el vigía avisa una vez cuando el teléfono deja de mandar más de 3 h de día (no de noche)', async () => {
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO dispositivos (nombre, plataforma, prefijo, token_hash, creado_en, ultima_vez) VALUES ('Mi Android', 'android', 'x', 'y', ?, ?)`).run(t('08:00'), t('10:00'))
  assert.equal(telefonoCallado(db, t('12:00')), null, 'hace 2 h: todavía no')
  assert.equal(telefonoCallado(db, t('23:30')), null, 'de noche no avisa')
  const avisado = await vigilarCaptura(db, t('14:30'))
  assert.match(avisado!, /«Mi Android» no manda nada desde las 10:00 \(hace 4 h\)/)
  assert.equal(await vigilarCaptura(db, t('16:00')), null, 'el mismo silencio no se avisa dos veces')
  db.prepare('UPDATE dispositivos SET ultima_vez = ?').run(t('16:00'))
  fijarAjuste(db, 'otro', '1')
  assert.equal(telefonoCallado(db, t('17:00')), null, 'volvió a mandar')
  assert.ok(telefonoCallado(db, t('19:30')), 'y si se vuelve a callar, se avisa de nuevo')
})

test('Mobile 2.3 · el foco en el teléfono: el tramo más largo en una app (dentro de la sesión de pantalla) y los cambios por hora', async () => {
  const { focoDelTelefono } = await import('../src/uso-telefono.ts')
  const sesiones: [number, number][] = [[t('10:00'), t('11:00')]]
  const cambios: [number, string][] = [[t('10:00'), 'com.whatsapp'], [t('10:05'), 'com.android.launcher3'], [t('10:06'), 'com.notion.id'], [t('10:40'), 'com.instagram.android']]
  const f = focoDelTelefono(sesiones, cambios, (p) => ({ 'com.notion.id': 'Notion' } as Record<string, string>)[p] ?? p)!
  assert.equal(f.tramoMasLargoMin, 34, 'Notion de 10:06 a 10:40')
  assert.equal(f.app, 'Notion')
  assert.equal(f.cambiosPorHora, 3, 'el lanzador no cuenta')
  assert.equal(focoDelTelefono(sesiones, []), null, 'un APK viejo no manda cambios')
})

test('Mobile 2.3 · lo que sonó en el teléfono y el audio Bluetooth entran al Diario del día', async () => {
  const db = abrir(':memory:')
  const { escuchasDelTelefono } = await import('../src/musica.ts')
  const { recibirContexto } = await import('../src/contexto-telefono.ts')
  assert.equal(escuchasDelTelefono(db, [
    { en: t('18:00'), tema: 'Tema A', artista: 'Artista 1' },
    { en: t('18:03'), tema: 'Tema B', artista: 'Artista 2' },
    { en: t('18:07') - 10_000, tema: 'Salteado', artista: 'Artista 3' }, // 10 s hasta el siguiente: no es escucha
    { en: t('18:07'), tema: 'Tema C', artista: 'Artista 1' },
  ]), 3)
  recibirContexto(db, 'disp:1', { en: t('17:50'), wifi: 'Casa', bt: [] })
  recibirContexto(db, 'disp:1', { en: t('18:00'), wifi: null, bt: ['Car Multimedia'] })
  recibirContexto(db, 'disp:1', { en: t('18:30'), wifi: 'Oficina', bt: [] })
  const d = await diarioDelDia(db, '2026-11-16', { agenda: false })
  const musica = d.momentos.find((m) => m.tipo === 'musica')!
  assert.equal(musica.titulo, '3 temas')
  assert.match(musica.sub!, /Artista 1, Artista 2/)
  const bt = d.momentos.find((m) => m.tipo === 'bluetooth')!
  assert.equal(bt.titulo, 'Car Multimedia')
  assert.match(bt.sub!, /18:00–18:30 · 30 min/)
})
