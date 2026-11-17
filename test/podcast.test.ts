import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { contarPalabras, duracionMp3, planDeLargo, reloj } from '../src/podcast.ts'
import { _probarTaller, carpeta, crearSegun } from '../src/taller.ts'

process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'podcast-'))
process.env.MASTRO_SIN_FFMPEG = '1'

/** Un mp3 de verdad en lo que importa: n cuadros MPEG-1 capa III a 128 kbps y 44,1 kHz (417 bytes, 1152 muestras cada uno). */
const mp3 = (cuadros: number) => {
  const c = Buffer.alloc(417)
  c.set([0xff, 0xfb, 0x90, 0x00])
  return Buffer.concat(Array.from({ length: cuadros }, () => c))
}

test('Fragua #312 · las cuentas del podcast: palabras por minuto, capítulos y la duración de un mp3', () => {
  assert.deepEqual(planDeLargo(8), { minutos: 8, palabras: 1120, capitulos: 2, porCapitulo: 560 })
  assert.equal(planDeLargo(15).capitulos, 4)
  assert.equal(planDeLargo(15).palabras, 2100)
  assert.equal(planDeLargo(0).minutos, 1)
  assert.equal(planDeLargo(500).minutos, 40)
  assert.equal(contarPalabras('Che, ¿leíste lo de la Asamblea? Es re-interesante.'), 8)
  // 100 cuadros de 1152 muestras a 44,1 kHz: 2,61 s (también con una etiqueta ID3 adelante).
  assert.ok(Math.abs(duracionMp3(mp3(100)) - 2.612) < 0.01)
  const id3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 5]), Buffer.alloc(5), mp3(100)])
  assert.ok(Math.abs(duracionMp3(id3) - 2.612) < 0.01)
  assert.equal(reloj(75), '01:15')
  assert.equal(reloj(3725), '1:02:05')
})

test('Fragua #312 · un episodio con el largo pedido: plan en capítulos, guion desde el brief, un mp3 y la transcripción con capítulos', async () => {
  const db = abrir(':memory:')
  const pedidos: string[] = []
  const turnos = (n: number, palabras: number) => Array.from({ length: n }, (_, i) => ({ quien: i % 2 ? 'B' : 'A', texto: Array.from({ length: palabras }, () => 'idea').join(' ') }))
  let vuelta = 0
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    const u = String(o.mensajes.at(-1)!.content)
    pedidos.push(u)
    if (s.includes('Armás el plan de un episodio')) return { texto: JSON.stringify({ titulo: 'Ciudades que se caminan', capitulos: [{ titulo: 'La pregunta', puntos: ['por qué caminar'] }, { titulo: 'Lo que cambia', puntos: ['veredas'] }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    vuelta++
    // El primer capítulo vuelve corto (40 palabras de 560): se pide una vuelta más que sigue.
    return { texto: JSON.stringify({ turnos: vuelta === 1 ? turnos(2, 20) : turnos(14, 40) }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const grabados: string[] = []
  _probarTaller({ voz: async (t, v) => { grabados.push(v); return mp3(50) } })

  const a = await crearSegun(db, { tipo: 'voz', modo: 'charla', pedido: 'ciudades caminables', minutos: '8', contexto: 'Es para la clase del jueves, público general.', voces: ['em_santa', 'ef_dora'], usarArchivo: false })
  assert.equal(a.estado, 'listo', String(a.progreso))
  assert.equal(a.titulo, 'Ciudades que se caminan')
  assert.deepEqual(a.archivos, ['podcast.mp3', 'transcripcion.md'])
  assert.equal(a.meta.minutosPedidos, 8)
  assert.equal(a.meta.capitulos.length, 2)
  // El plan pidió los capítulos del largo; cada tramo, sus palabras; el brief va entero.
  assert.match(pedidos[0], /Temas: ciudades caminables[\s\S]*Es para la clase del jueves[\s\S]*Dura 8 minutos: 2 capítulos/)
  assert.match(pedidos[1], /capítulo 1 de 2, «La pregunta»[\s\S]*Abre el episodio[\s\S]*Cerca de 560 palabras/)
  assert.match(pedidos[2], /Seguí desde ahí con unas 520 palabras más/)
  assert.match(pedidos[3], /capítulo 2 de 2[\s\S]*Cierra el episodio/)
  assert.ok(!pedidos.some((p) => /Lo que sabés de él/.test(p)), 'sin su archivo cuando no lo quiere')
  // Las dos voces elegidas, alternadas; el segundo capítulo empieza donde termina el primero.
  assert.deepEqual([...new Set(grabados)].sort(), ['ef_dora', 'em_santa'])
  const porTurno = 50 * 1152 / 44100
  assert.equal(a.meta.capitulos[0].desde, 0)
  assert.ok(Math.abs(a.meta.capitulos[1].desde - 16 * porTurno) < 0.01)
  assert.equal(a.meta.duracion, Math.round(30 * porTurno))
  const tr = fs.readFileSync(path.join(carpeta(a.id), 'transcripcion.md'), 'utf8')
  assert.match(tr, /^# Ciudades que se caminan/)
  assert.match(tr, /- \[00:00\] 1\. La pregunta\n- \[00:21\] 2\. Lo que cambia/)
  assert.match(tr, /\*\*Santa\*\* \(00:00\): idea/)
  assert.match(tr, /\*\*Dora\*\* \(00:01\): idea/)
  assert.equal(fs.statSync(path.join(carpeta(a.id), 'podcast.mp3')).size, 30 * 50 * 417)

  // Sin minutos: la charla corta de siempre.
  _probarModelo(async () => ({ texto: JSON.stringify({ titulo: 'Corta', turnos: turnos(2, 5) }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  const corta = await crearSegun(db, { tipo: 'charla', pedido: 'mapas' })
  assert.deepEqual(corta.archivos, ['charla.mp3'])
})
