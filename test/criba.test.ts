import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { buscar, insertar } from '../src/corpus.ts'
import { cribar, deshacerUltima, marcador, siguiente } from '../src/criba.ts'
import { crearQuantomo, descartarLote, gruposProto, leerQuantomo, sellarLote } from '../src/quantomos.ts'

const dia = (d: number) => new Date(2026, 9, d, 12).getTime()

test('criba: links y lo propio primero, nunca lo generado; peso, descarte, deshacer y días del mes (sin racha que se pierda)', () => {
  const db = abrir(':memory:')
  const gen = insertar(db, { fuente: 'operador', titulo: 'Informe de agente sobre café', contenido: 'café', nivel: 'generada', origenId: 'c:g' })!
  const prim = insertar(db, { fuente: 'operador', titulo: 'Libro sobre café', contenido: 'café de especialidad', nivel: 'primaria', origenId: 'c:p' })!
  const propia = insertar(db, { fuente: 'operador', titulo: 'Mi nota de café', contenido: 'el café de la esquina', nivel: 'propia', origenId: 'c:n' })!
  const link = insertar(db, { fuente: 'operador', tipo: 'enlace', titulo: 'Reel de café', contenido: 'https://x/reel', nivel: 'primaria', origenId: 'c:l' })!

  assert.equal(siguiente(db)!.id, link)
  assert.equal(siguiente(db, { saltear: [link] })!.id, propia)
  assert.equal(siguiente(db, { nivel: 'primaria', saltear: [link] })!.id, prim)
  assert.throws(() => cribar(db, link, 13), /1 a 12/)

  cribar(db, link, 0, dia(5))
  cribar(db, propia, 12, dia(6))
  let m = cribar(db, prim, 3, dia(7))
  assert.deepEqual({ ...m, ultimo: undefined }, { hoy: 1, diasMes: 3, ultimo: undefined, cribadas: 3, faltan: 0, descartadas: 1 })
  assert.equal(siguiente(db), null, 'lo generado no se criba')
  assert.equal(marcador(db, dia(8)).diasMes, 3, 'hoy todavía no: los días del mes siguen ahí')
  assert.equal(marcador(db, dia(9)).diasMes, 3, 'un día sin cribar no resta nada')

  // El peso ordena la búsqueda: descartado al fondo, lo pesado arriba; lo generado sigue último.
  const orden = buscar(db, 'café', 10).map((p) => p.id)
  assert.equal(orden[0], propia)
  assert.deepEqual(orden.slice(-2), [link, gen])

  const d = deshacerUltima(db, dia(7))
  assert.equal(d.pieza!.id, prim)
  assert.equal(d.pieza!.peso, null)
  assert.equal(d.marcador.hoy, 0)
})

test('sellado por lotes', () => {
  const db = abrir(':memory:')
  // Crear 12 proto quántomos: 7 en un grupo (universo 'café', pieza null), 5 en otro (universo 'huerta', pieza null)
  const ids1: number[] = []
  const ids2: number[] = []
  for (let i = 0; i < 7; i++) {
    const id = crearQuantomo(db, { texto: `Quántomo de café número ${i}`, universo: 'café' })
    if (id) ids1.push(id)
  }
  for (let i = 0; i < 5; i++) {
    const id = crearQuantomo(db, { texto: `Quántomo de huerta número ${i}`, universo: 'huerta' })
    if (id) ids2.push(id)
  }
  assert.equal(ids1.length, 7)
  assert.equal(ids2.length, 5)

  // Grupos: dos grupos, ordenados por cantidad descendente
  const grupos = gruposProto(db)
  assert.equal(grupos.length, 2)
  assert.equal(grupos[0].universo, 'café')
  assert.equal(grupos[0].n, 7)
  assert.equal(grupos[1].universo, 'huerta')
  assert.equal(grupos[1].n, 5)

  // Sellar el primer lote con peso 8
  const r = sellarLote(db, ids1, 8)
  assert.equal(r.sellados, 7)
  for (const id of ids1) {
    const q = leerQuantomo(db, id)!
    assert.equal(q.etapa, 'sellado')
    assert.equal(q.peso, 8)
  }

  // El segundo lote sigue en proto
  const grupos2 = gruposProto(db)
  assert.equal(grupos2.length, 1)
  assert.equal(grupos2[0].universo, 'huerta')
  assert.equal(grupos2[0].n, 5)

  // Descartar el segundo lote con motivo
  const r2 = descartarLote(db, ids2, 'sin sustancia')
  assert.equal(r2.descartados, 5)
  for (const id of ids2) {
    const q = leerQuantomo(db, id)!
    assert.equal(q.etapa, 'descartado')
    assert.ok(q.procedencia!.includes('sin sustancia'))
  }

  // No quedan proto
  assert.equal(gruposProto(db).length, 0)

  // Sellar un lote vacío lanza error
  assert.throws(() => sellarLote(db, [], 5), /Lote vacío/)
  // Sellar con peso inválido lanza error
  assert.throws(() => sellarLote(db, [ids1[0]], 13), /1 a 12/)
})

test('criba: título limpio, orden a elección y notas con @ que entran al corpus (y lo «para hacer», como side quest)', async () => {
  const { tituloLimpio } = await import('../src/corpus.ts')
  const { anotar, notasDe } = await import('../src/criba.ts')
  const { asegurarEntidad } = await import('../src/entidades.ts')
  const { listarMisiones } = await import('../src/misiones.ts')
  assert.equal(tituloLimpio('Lo que le dije a Gemini · Estoy viendo la estructura actual'), 'Estoy viendo la estructura actual')
  assert.equal(tituloLimpio('Destilado · Nota de voz · Paseo por el puerto'), 'Paseo por el puerto')
  assert.equal(tituloLimpio('Gemini · '), 'Gemini · ', 'si no queda nada, el original')

  const db = abrir(':memory:')
  const vieja = insertar(db, { fuente: 'operador', titulo: 'Lo que le dije a Gemini · La idea vieja', contenido: 'algo de marzo', nivel: 'propia', fecha: '2026-03-01', origenId: 'o:1' })!
  const nueva = insertar(db, { fuente: 'operador', titulo: 'Nota de voz · La idea nueva', contenido: 'algo de octubre', nivel: 'propia', fecha: '2026-10-01', origenId: 'o:2' })!
  assert.equal(siguiente(db, { orden: 'fecha_asc' })!.id, vieja)
  assert.equal(siguiente(db, { orden: 'fecha_desc' })!.id, nueva)
  assert.equal(siguiente(db, { orden: 'id_desc' })!.id, nueva)
  assert.equal(siguiente(db, { orden: 'id_asc' })!.titulo, 'La idea vieja', 'la criba muestra el título directo')
  assert.ok([vieja, nueva].includes(siguiente(db, { orden: 'azar' })!.id))

  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Gómez' })
  const r = anotar(db, vieja, 'Llamar a @Ana Gómez por esto\nque tiene el contacto', { hacer: true })
  assert.deepEqual(r.entidades, ['Ana Gómez'])
  const nota = db.prepare('SELECT * FROM corpus WHERE id = ?').get(r.nota) as any
  assert.equal(nota.nivel, 'propia')
  assert.match(nota.contenido, /Sobre «La idea vieja» \[#\d+\], del 2026-03-01[\s\S]*> algo de marzo/, 'la nota lleva la pieza citada')
  assert.ok(JSON.parse(nota.entidades).includes(ana))
  assert.ok(JSON.parse((db.prepare('SELECT entidades FROM corpus WHERE id = ?').get(vieja) as any).entidades).includes(ana), 'la @ también queda en la pieza')
  const sq = listarMisiones(db, { nivel: 'terciaria', abiertas: true }).find((m) => m.id === r.mision)!
  assert.equal(sq.titulo, 'Llamar a Ana Gómez por esto')
  assert.equal(sq.entidadId, ana)
  assert.match(sq.detalle ?? '', /Sale de la criba: «La idea vieja»/)
  anotar(db, vieja, 'Me gusta cómo arranca')
  assert.deepEqual(notasDe(db, vieja).map((n) => n.hacer), [true, false])
  assert.equal(siguiente(db, { orden: 'id_asc' })!.notas.length, 2, 'la carta trae sus notas')
  assert.equal(db.prepare('SELECT peso FROM corpus WHERE id = ?').get(vieja)!.peso, null, 'anotar no la pesa')
})

test('criba: la nota que sale con la puntuación decide sola si es para hacer', async () => {
  const { anotarSolo, _probarNotas, pareceTarea } = await import('../src/criba.ts')
  const { listarMisiones } = await import('../src/misiones.ts')
  const db = abrir(':memory:')
  const p = insertar(db, { fuente: 'operador', titulo: 'Idea', contenido: 'algo', nivel: 'propia', origenId: 'n:1' })!
  _probarNotas(async () => ({ hacer: true, tarea: 'Llamar a la productora' }))
  const r = await anotarSolo(db, p, 'tengo que llamar a la productora por esto')
  assert.equal(listarMisiones(db, { nivel: 'terciaria', abiertas: true }).find((m) => m.id === r!.mision)!.titulo, 'Llamar a la productora')
  _probarNotas(async () => { throw new Error('sin modelo') })
  const r2 = await anotarSolo(db, p, 'qué linda idea, me recuerda a otra cosa')
  assert.equal(r2!.mision, null, 'sin modelo, por las palabras: un comentario no es tarea')
  assert.ok(pareceTarea('Acordate de mandarle el mail'))
})
