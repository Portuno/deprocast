import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const d = await import('../src/dispositivos.ts')
const h = await import('../src/hablantes.ts')
const { huellaDe, leerWav, parecido } = await import('../src/conciencia/huella.ts')

const T = new Date(2026, 10, 4, 11).getTime()
const sr = 16000

/** Una voz sintética: fundamental con armónicos filtrados por dos formantes, sílabas y algo de jitter. */
function voz(f0: number, f1: number, f2: number, seg: number, semilla: number): Float32Array {
  let s = semilla
  const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const n = sr * seg, x = new Float32Array(n)
  let fase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const f = f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 0.7 * t) + 0.01 * (azar() - 0.5))
    fase += (2 * Math.PI * f) / sr
    let v = 0
    for (let k = 1; k * f0 < 4000; k++) {
      const fk = k * f0
      v += (Math.exp(-((fk - f1) ** 2) / (2 * 120 ** 2)) + 0.7 * Math.exp(-((fk - f2) ** 2) / (2 * 180 ** 2)) + 0.05) * Math.sin(k * fase) / k ** 0.3
    }
    x[i] = 0.1 * v * (0.4 + 0.6 * Math.max(0, Math.sin(2 * Math.PI * 4.3 * t))) + 0.002 * (azar() - 0.5)
  }
  return x
}
/** Un WAV float32 mono (como los que graba la app). */
function wav(x: Float32Array): Buffer {
  const b = Buffer.alloc(44 + x.length * 4)
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34)
  b.write('data', 36); b.writeUInt32LE(x.length * 4, 40)
  for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i], 44 + i * 4)
  return b
}

test('La huella: la misma voz se parece (>0,93), voces distintas no; el WAV se lee', () => {
  const w = leerWav(new Uint8Array(wav(voz(110, 650, 1100, 1, 1))))!
  assert.equal(w.sr, sr)
  const a1 = huellaDe(voz(110, 650, 1100, 4, 1), sr)!, a2 = huellaDe(voz(112, 640, 1150, 4, 9), sr)!, b1 = huellaDe(voz(210, 400, 2300, 4, 3), sr)!
  assert.ok(parecido(a1, a2) > h.UMBRAL, `misma voz: ${parecido(a1, a2)}`)
  assert.ok(parecido(a1, b1) < h.UMBRAL, `voces distintas: ${parecido(a1, b1)}`)
  assert.equal(huellaDe(new Float32Array(100), sr), null, 'sin voz, sin huella')
})

test('Conversación: cada voz es un hablante (1, 2…), se reconoce al volver, se vincula a una persona y se junta', async () => {
  const db = abrir(':memory:')
  d._probarDispositivos({ transcribir: async () => 'algo que se dijo' })
  const { codigo } = d.crearCodigo(db, T)
  const { dispositivo } = d.vincular(db, { codigo }, T)
  const decir = (x: Float32Array, t: number) => d.recibirVoz(db, dispositivo, wav(x), 'voz.wav', { modo: 'conversacion', inicio: t }, t)
  const r1 = await decir(voz(110, 650, 1100, 3, 1), T)
  const r2 = await decir(voz(210, 400, 2300, 3, 3), T + 5000)
  const r3 = await decir(voz(112, 640, 1150, 3, 9), T + 10_000)
  assert.equal(r1.destino, 'conversacion')
  assert.deepEqual([r1.hablante!.etiqueta, r2.hablante!.etiqueta, r3.hablante!.etiqueta], ['Hablante 1', 'Hablante 2', 'Hablante 1'], 'la primera voz vuelve y se la reconoce')
  const turnos = h.ultimosTurnos(db)
  assert.deepEqual(turnos.map((t) => t.hablante?.etiqueta), ['Hablante 1', 'Hablante 2', 'Hablante 1'])
  // Vincular: el hablante 2 es una persona de tus entidades.
  const ana = Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('persona', 'Ana Prueba', ?)`).run(T).lastInsertRowid)
  assert.deepEqual(h.buscarPersonas(db, 'ana').map((p) => p.nombre), ['Ana Prueba'])
  assert.equal(h.vincularHablante(db, r2.hablante!.id, ana).nombre, 'Ana Prueba')
  const r4 = await decir(voz(205, 420, 2250, 3, 5), T + 20_000)
  assert.equal(r4.hablante!.nombre, 'Ana Prueba', 'desde ahí la reconoce por su nombre')
  // Si otro hablante resulta ser la misma persona, se juntan.
  h.vincularHablante(db, r1.hablante!.id, ana)
  assert.equal(h.listarHablantes(db).length, 1)
  assert.ok(h.ultimosTurnos(db).every((t) => t.hablante?.nombre === 'Ana Prueba'))
  // Olvidar: se borra la huella; los turnos quedan sin hablante.
  h.olvidarHablante(db, h.listarHablantes(db)[0].id)
  assert.equal(h.listarHablantes(db).length, 0)
  assert.ok(h.ultimosTurnos(db).every((t) => t.hablante === null))
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM voz_segmentos').all()).includes('RIFF'), 'el audio no se guarda')
})
