import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'

const { abrir, fechaLocal, fijarAjuste } = await import('../src/db.ts')
const { iniciarDirecto } = await import('../src/directo.ts')
const { arrancarBloque, bloqueActivo, bloqueParaPrompt, terminarBloque, vigilarBloque } = await import('../src/bloques.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, conversacionHoy, enviar, estaPensando } = await import('../src/chat/index.ts')
const { leerJornada, textoDeCierre } = await import('../src/jornada.ts')

_probarEscriba(async () => {})
const sistemas: string[] = []
_probarModelo(async (_l: any, o: any) => { sistemas.push(String(o.mensajes[0].content)); return { texto: '¿Y qué quedó para mañana?', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } as any })

const T = new Date(2026, 9, 21, 15, 0).getTime()
const MIN = 60_000

function conDirecto() {
  const db = abrir(':memory:')
  fijarAjuste(db, 'apps_estimulo', 'instagram')
  const s = iniciarDirecto(db, ['pantalla'], T - 10 * MIN)
  const m = db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, app, actividad, tema) VALUES (?, 'pantalla', ?, ?, ?, ?, ?)`)
  m.run(s.id, T - 3 * MIN, T, 'VS Code', 'programando', 'Deprocast')
  return { db, s, m }
}

test('Bloque guiado: arranca con lo que estaba haciendo, avisa una sola vez si se va del tema, y cierra con lo sostenido', () => {
  const { db, s, m } = conDirecto()
  const b = arrancarBloque(db, { minutos: 25, tema: 'el informe' }, T)
  assert.equal(b.referencia, 'vs code|deprocast', 'lo que estaba haciendo al arrancar')
  assert.equal(b.sesionId, s.id)
  m.run(s.id, T, T + 10 * MIN, 'VS Code', 'programando', 'Deprocast')
  assert.equal(vigilarBloque(db, T + 10 * MIN), null, 'en el tema: nada que decir')
  m.run(s.id, T + 10 * MIN, T + 14 * MIN, 'Instagram', 'navegando', 'reels')
  const aviso = vigilarBloque(db, T + 14 * MIN)
  assert.match(aviso!, /Lleva 4 minutos en Instagram · reels; el bloque era «el informe»\. Le quedan 11\./)
  m.run(s.id, T + 14 * MIN, T + 16 * MIN, 'Instagram', 'navegando', 'reels')
  assert.equal(vigilarBloque(db, T + 16 * MIN), null, 'una sola vez')
  assert.match(bloqueParaPrompt(db, T + 16 * MIN), /lleva 16 de 25 minutos; hace 6 min que está en Instagram · reels, fuera del tema/)
  m.run(s.id, T + 16 * MIN, T + 25 * MIN, 'Chrome', 'leyendo', 'el informe trimestral')
  const fin = vigilarBloque(db, T + 26 * MIN)!
  assert.match(fin, /Bloque terminado \(el informe\): 25 minutos\. Sostuvo 19 en el tema\./, '10 de VS Code y 9 del informe en Chrome')
  assert.match(fin, /unos 5 minutos/)
  assert.match(fin, /\[\[seguir\]\]\nArranco otro bloque de 25\n\[\[\/seguir\]\]$/)
  assert.equal(bloqueActivo(db), null)
})

test('Bloques: sin largo usa 25 (o su meta), sin Directo no inventa lo sostenido, y 90 minutos encadenados piden 20 de descanso', () => {
  const db = abrir(':memory:')
  for (let i = 0; i < 3; i++) {
    const b = arrancarBloque(db, {}, T + i * 32 * MIN)
    assert.equal(b.minutos, 25)
    const r = terminarBloque(db, T + i * 32 * MIN + 30 * MIN)!
    assert.equal(r.bloque.sostenido, null)
    assert.doesNotMatch(r.tarjeta, /Sostuvo/)
    assert.match(r.tarjeta, /unos 5 minutos/, `${(i + 1) * 25} minutos encadenados todavía no son 90`)
  }
  arrancarBloque(db, { minutos: 30 }, T + 96 * MIN)
  assert.match(terminarBloque(db, T + 130 * MIN)!.tarjeta, /Lleva 105 minutos de foco encadenado: le corresponden 20/)
})

test('Cierre hablado: lo que sigue diciendo por voz se suma al cierre, entra al diario y la charla sigue su guion', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const fecha = fechaLocal()
  textoDeCierre(db, fecha)
  const esperar = async () => { for (let i = 0; i < 200 && estaPensando(cid); i++) await new Promise((r) => setTimeout(r, 10)) }
  sistemas.length = 0
  void enviar(db, cid, 'Salió bien la reunión', { via: 'voz' }); await esperar()
  void enviar(db, cid, 'Me quedó pendiente el mail', { via: 'voz' }); await esperar()
  assert.equal(leerJornada(db, fecha)!.cierre, 'Salió bien la reunión\nMe quedó pendiente el mail')
  const piezas = db.prepare(`SELECT titulo FROM corpus WHERE titulo LIKE 'Cierre · %'`).all() as any[]
  assert.equal(piezas.length, 2, 'cada cosa al diario, como propia')
  assert.match(sistemas.at(-1)!, /Están cerrando el día hablando/)
  void enviar(db, cid, 'Otra cosa escrita'); await esperar()
  assert.equal(leerJornada(db, fecha)!.cierre, 'Salió bien la reunión\nMe quedó pendiente el mail', 'escrito, después del cierre, no se suma')
})
