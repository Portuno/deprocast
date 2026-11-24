import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const deLaApp = (m: string): Promise<any> => import(`../apps/movil/src/logica/${m}.ts`)
const adjuntos = await deLaApp('adjuntos')
const mapa = await deLaApp('mapa')
const escucha = await deLaApp('escucha')

test('Mobile 2.0 · los adjuntos del chat se ven: la marca se parte en texto, imagen y archivo', () => {
  assert.deepEqual(adjuntos.partesDe('hola'), [{ tipo: 'texto', texto: 'hola' }])
  const p = adjuntos.partesDe('Mirá esto [imagen:/adjuntos/171-ab.jpg|un plato de lentejas] y el informe [archivo:/adjuntos/172-cd.pdf|Informe.pdf|3 páginas] ¿qué te parece?')
  assert.deepEqual(p, [
    { tipo: 'texto', texto: 'Mirá esto' },
    { tipo: 'imagen', archivo: '171-ab.jpg', descripcion: 'un plato de lentejas' },
    { tipo: 'texto', texto: 'y el informe' },
    { tipo: 'archivo', archivo: '172-cd.pdf', nombre: 'Informe.pdf', detalle: '3 páginas' },
    { tipo: 'texto', texto: '¿qué te parece?' },
  ])
  // Un link a un adjunto (lo escribe el modelo a veces): una imagen si es una foto; si no, un archivo.
  assert.deepEqual(adjuntos.partesDe('![foto](/adjuntos/x.png)')[0], { tipo: 'imagen', archivo: 'x.png', descripcion: 'foto' })
  assert.deepEqual(adjuntos.partesDe('[bajalo](/adjuntos/y.docx)')[0], { tipo: 'archivo', archivo: 'y.docx', nombre: 'bajalo', detalle: '' })
  assert.equal(adjuntos.tieneAdjuntos('sin nada'), false)
  assert.equal(adjuntos.iconoArchivo('a.pptx'), '📽')
})

test('Mobile 2.0 · el teléfono pide los adjuntos con su token, a la ruta del dispositivo (no a /adjuntos con la clave)', () => {
  const api = fs.readFileSync('apps/movil/src/api.ts', 'utf8')
  assert.match(api, /\/api\/dispositivo\/adjunto\/\$\{encodeURIComponent\(archivo\)\}/)
  const hoy = fs.readFileSync('apps/movil/src/pantallas/Hoy.tsx', 'utf8')
  assert.match(hoy, /partesDe\(m\.texto\)/, 'la burbuja parte el mensaje')
  assert.match(hoy, /headers: cabeceraDe\(c\)/, 'la foto va con el token')
})

// Un día de prueba: 9:00 a 9:20 caminando hacia el norte (un punto por minuto, ~80 m), 9:20 a 9:40 en auto (~800 m/min).
const H = new Date(2026, 10, 23, 9, 0).getTime()
const MIN = 60_000
const pie = Array.from({ length: 21 }, (_, i) => ({ en: H + i * MIN, lat: 39.47 + i * 0.00072, lon: -0.376 }))
const auto = Array.from({ length: 20 }, (_, i) => ({ en: H + (21 + i) * MIN, lat: pie[20].lat + (i + 1) * 0.0072, lon: -0.376 }))
const dia = [...pie, ...auto]

test('Mobile 2.0 · dónde diste los pasos: los de cada hora van a los tramos a pie (no al auto ni a estar quieto)', () => {
  const horas = [{ hora: '2026-11-23T09', pasos: 2000 }, { hora: '2026-11-23T14', pasos: 500 }]
  const r = mapa.pasosEnTramos(dia, horas)
  assert.equal(r.porTramo.length, dia.length - 1)
  const aPie = r.porTramo.slice(0, 20).reduce((s: number, x: number) => s + x, 0)
  const enAuto = r.porTramo.slice(21).reduce((s: number, x: number) => s + x, 0)
  assert.ok(Math.abs(aPie - 2000) <= 20, `a pie: ${aPie}`)
  assert.equal(enAuto, 0, 'el auto no camina')
  assert.equal(r.sinUbicar, 500, 'a las 14 caminó sin recorrido: se dice')
  assert.equal(mapa.ritmo(100, MIN), 3)
  assert.equal(mapa.ritmo(0, MIN), 0)
  const tramos = mapa.tramosPorRitmo(dia, r.porTramo)
  assert.equal(tramos[0].ritmo, 3, '100 pasos por minuto: paso firme')
  assert.equal(tramos.at(-1).ritmo, 0, 'el auto, sin pasos')
})

test('Mobile 2.0 · la línea del día: trayectos con km y pasos entre las paradas', () => {
  const quieto = Array.from({ length: 11 }, (_, i) => ({ en: H - (11 - i) * MIN, lat: 39.47, lon: -0.376 }))
  const ps = [...quieto, ...pie]
  const r = mapa.pasosEnTramos(ps, [{ hora: '2026-11-23T09', pasos: 2000 }, { hora: '2026-11-23T08', pasos: 30 }])
  const paradas = [{ lat: 39.47, lon: -0.376, desde: quieto[0].en, hasta: quieto.at(-1)!.en, minutos: 10, lugar: 'Casa' }]
  const linea = mapa.lineaDelDia(ps, paradas, r.porTramo)
  assert.equal(linea[0].tipo, 'parada')
  assert.equal(linea[0].lugar, 'Casa')
  assert.equal(linea[1].tipo, 'trayecto')
  assert.ok(linea[1].km >= 1.5 && linea[1].km <= 1.8, `km: ${linea[1].km}`)
  assert.ok(Math.abs(linea[1].pasos - 2000) <= 20)
})

test('Mobile 2.0 · la escucha se da cuenta sola de la charla: la voz de otros cuenta solo si hablaste hace poco', () => {
  const T = 1_000_000
  assert.equal(escucha.enCharla('auto', null, T), false)
  assert.equal(escucha.enCharla('auto', T - 30_000, T), true)
  assert.equal(escucha.enCharla('auto', T - 120_000, T), false, 'pasó la charla')
  assert.equal(escucha.enCharla('yo', T, T), false)
  assert.equal(escucha.enCharla('charla', null, T), true)
  assert.equal(escucha.cuentaComoVoz('auto', { directa: false, otra: true }, false), false, 'la tele o el bar, no')
  assert.equal(escucha.cuentaComoVoz('auto', { directa: false, otra: true }, true), true, 'lo que te contestan, sí')
  assert.equal(escucha.cuentaComoVoz('yo', { directa: true, otra: false }, false), true)
  assert.equal(escucha.modoDelTramo('auto', { dictado: 20, escucha: 2, otras: 15 }), 'conversacion')
  assert.equal(escucha.modoDelTramo('auto', { dictado: 20, escucha: 2, otras: 3 }), 'dictado')
  assert.equal(escucha.modoDelTramo('yo', { dictado: 2, escucha: 20, otras: 40 }), 'pasivo', 'solo yo nunca es charla')
})

test('Mobile 2.0 · el audio queda en el teléfono: después de subir se archiva, no se borra', () => {
  const s = fs.readFileSync('apps/movil/src/sincronizar.ts', 'utf8')
  assert.match(s, /await subirVoz\(c, v\.uri, meta\)[\s\S]{0,200}await archivar\(v\.uri, meta, r\)/)
  const a = fs.readFileSync('apps/movil/src/audios.ts', 'utf8')
  assert.match(a, /new Directory\(Paths\.document, 'audios'\)/, 'en documentos, fuera de la carpeta de tramos')
  assert.match(fs.readFileSync('apps/movil/App.tsx', 'utf8'), /borrarCarpetaAudios\(\)/, 'desvincular borra también los audios')
})
