import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { asegurarEntidad, coocurrencias } from '../src/entidades.ts'
import { _probarEscriba, _probarModelo, crearConversacion, enviar, listarPropuestas, mensajes, promptMastropiero } from '../src/chat/index.ts'

_probarEscriba(async () => {})
import { HERRAMIENTAS, lineamientos } from '../src/chat/herramientas.ts'
import { forjar, leer, listar } from '../src/roster.ts'

type Pedido = { sistema: string; mensajes: any[]; herramientas: string[]; clase: string }

/** Modelo guionado: cada paso recibe lo que el modelo vería y devuelve texto o pedidos de herramienta. */
function guion(pasos: ((p: Pedido) => { texto?: string; llamadas?: { nombre: string; argumentos: unknown }[] })[]) {
  const vistos: Pedido[] = []
  let n = 0
  _probarModelo(async (l, o) => {
    const p: Pedido = { sistema: String(o.mensajes[0].content), mensajes: o.mensajes.slice(1), herramientas: (o.herramientas as any[]).map((h) => h.function.name), clase: String(l.clase) }
    vistos.push(p)
    const r = pasos[n++]?.(p) ?? { texto: 'fin' }
    return {
      texto: r.texto ?? '', razonamiento: null, modelo: 'falso', tokens: 10,
      llamadas: (r.llamadas ?? []).map((x, i) => ({ id: `c${n}-${i}`, nombre: x.nombre, argumentos: JSON.stringify(x.argumentos) })),
    }
  })
  return vistos
}

test('Mastropiero usa herramientas: forja un agente y lo cuenta; todo queda guardado', async () => {
  const db = abrir(':memory:')
  const vistos = guion([
    () => ({ llamadas: [{ nombre: 'forjar_agente', argumentos: { clase: 'buscador', instrucciones: 'Solo cito papers.', reparto: { precision: 3 } } }] }),
    (p) => ({ texto: `Listo: ${JSON.parse(p.mensajes.at(-1).content).forjado.id}` }),
  ])
  const c = crearConversacion(db)
  await enviar(db, c.id, 'Creame un buscador que solo cite papers')
  const ms = mensajes(db, c.id)
  assert.deepEqual(ms.map((m) => m.rol), ['operador', 'asistente', 'herramienta', 'asistente'])
  assert.equal(ms[2].resumen, 'forjó BUS-0001 (Buscador)')
  assert.equal(ms[3].texto, 'Listo: BUS-0001')
  assert.equal(leer(db, 'BUS-0001')!.creador, 'mastropiero')
  assert.equal(leer(db, 'BUS-0001')!.atributos.precision, 6)
  assert.ok(vistos[0].herramientas.includes('deshacer_carga'), 'Mastropiero ve todas las herramientas')
  assert.equal(vistos[0].clase, 'mastropiero')
})

test('lo destructivo no corre sin confirmación', async () => {
  const db = abrir(':memory:')
  forjar(db, { clase: 'generativo' })
  guion([
    () => ({ llamadas: [{ nombre: 'retirar_agente', argumentos: { id: 'GEN-0001' } }] }),
    (p) => ({ texto: JSON.parse(p.mensajes.at(-1).content).requiere_confirmacion ? '¿Confirmás?' : 'hecho' }),
  ])
  const c = crearConversacion(db)
  await enviar(db, c.id, 'retirá a GEN-0001')
  assert.ok(leer(db, 'GEN-0001'), 'sigue vivo')
  assert.equal(mensajes(db, c.id).at(-1)!.texto, '¿Confirmás?')

  guion([() => ({ llamadas: [{ nombre: 'retirar_agente', argumentos: { id: 'GEN-0001', confirmado: true } }] }), () => ({ texto: 'retirado' })])
  await enviar(db, c.id, 'sí, confirmo')
  assert.equal(leer(db, 'GEN-0001'), null)
})

test('hablar con un agente: contesta desde su persona y solo con herramientas de lectura', async () => {
  const db = abrir(':memory:')
  forjar(db, { clase: 'clasificador', instrucciones: 'Etiqueto recetas.' })
  const vistos = guion([
    () => ({ llamadas: [{ nombre: 'hablar_con_agente', argumentos: { id: 'CLA-0001', mensaje: '¿qué hacés?' } }] }),
    (p) => ({ texto: p.sistema.includes('Etiqueto recetas') ? 'Etiqueto recetas, jefe.' : 'otro' }),
    (p) => ({ texto: `Dice: ${JSON.parse(p.mensajes.at(-1).content).respuesta}` }),
  ])
  const c = crearConversacion(db)
  await enviar(db, c.id, 'preguntale al clasificador qué hace')
  assert.equal(mensajes(db, c.id).at(-1)!.texto, 'Dice: Etiqueto recetas, jefe.')
  assert.ok(!vistos[1].herramientas.includes('forjar_agente'), 'un agente no forja')
  assert.ok(vistos[1].herramientas.includes('buscar_corpus'))

  // Conversación directa con el agente.
  guion([(p) => ({ texto: p.sistema.startsWith('Sos CLA-0001') ? 'hola, soy el clasificador' : 'x' })])
  const d = crearConversacion(db, 'CLA-0001')
  await enviar(db, d.id, 'hola')
  assert.equal(mensajes(db, d.id).at(-1)!.texto, 'hola, soy el clasificador')
})

test('el perfil del operador sale de lo cargado, no del código', () => {
  const db = abrir(':memory:')
  assert.match(promptMastropiero(db), /Todavía no sabés quién es el operador/)
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ada Ejemplo', alias: ['Ada'], meta: { operador: true } })
  const huerta = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Huerta' })
  insertar(db, { fuente: 'operador', titulo: 'n', contenido: 'c', estado: 'disponible', entidades: [yo, huerta] })
  const p = promptMastropiero(db)
  assert.match(p, /exoesqueleto cognitivo de Ada/)
  assert.match(p, /Huerta \(proyecto\)/)
  assert.doesNotMatch(p.split('Lo que sabés de')[1], /#\d+|nivel I\b/, 'el contexto del operador no trae ids ni jerga')
  assert.equal(coocurrencias(db, yo)[0].nombre, 'Huerta')
})

test('propone mejoras y lee sus lineamientos', async () => {
  const db = abrir(':memory:')
  const l = lineamientos() as any
  assert.ok(l.secciones.includes('Corpus'))
  assert.ok(l.mapa_del_codigo.some((x: any) => x.archivo === 'src/chat/index.ts'))
  guion([
    () => ({ llamadas: [{ nombre: 'leer_lineamientos', argumentos: { seccion: 'quántomos' } }, { nombre: 'proponer_mejora', argumentos: { titulo: 'Búsqueda híbrida', detalle: 'FTS más coseno', area: 'corpus', prioridad: 'alta' } }] }),
    () => ({ texto: 'Dejé una propuesta.' }),
  ])
  const c = crearConversacion(db)
  await enviar(db, c.id, '¿qué mejorarías?')
  const ps = listarPropuestas(db) as any[]
  assert.equal(ps[0].titulo, 'Búsqueda híbrida')
  assert.equal(ps[0].estado, 'abierta')
})

test('errores del modelo y herramientas inexistentes no rompen la conversación', async () => {
  const db = abrir(':memory:')
  _probarModelo(async () => { throw new Error('Sin modelo para conversar: configurá NAN_API_KEY en .env') })
  const c = crearConversacion(db)
  await enviar(db, c.id, 'hola')
  assert.equal(mensajes(db, c.id).at(-1)!.rol, 'error')

  // El turno anterior quedó sin respuesta; el siguiente igual se arma bien.
  const vistos = guion([() => ({ llamadas: [{ nombre: 'inventada', argumentos: {} }] }), () => ({ texto: 'ok' })])
  await enviar(db, c.id, 'de nuevo')
  assert.match(mensajes(db, c.id).find((m) => m.herramienta === 'inventada')!.texto!, /No existe la herramienta/)
  assert.ok(vistos[0].mensajes.every((m) => m.role !== 'tool'))
  assert.equal(listar(db).length, 0)
})

test('todas las herramientas tienen esquema y familia', () => {
  const nombres = new Set<string>()
  for (const h of HERRAMIENTAS) {
    assert.ok(!nombres.has(h.nombre), `duplicada: ${h.nombre}`)
    nombres.add(h.nombre)
    assert.equal((h.parametros as any).type, 'object')
    if (h.familia === 'destructiva') assert.ok('confirmado' in (h.parametros as any).properties, `${h.nombre} sin confirmado`)
  }
})
