import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { abrir } from '../src/db.ts'
import { asegurarFuente, buscar, fuentes, insertar, listarPiezas, piezaPorOrigen } from '../src/corpus.ts'
import { deshacer, ejecutar, reetiquetar, subir } from '../src/cargas/index.ts'
import { listarEntidades } from '../src/entidades.ts'
import { aceptarPropuesta, crearQuantomo, leerQuantomo, linaje, listarQuantomos, pedirMejora, quantomosDePieza, sellar } from '../src/quantomos.ts'
import { publicar, tareas } from '../src/bus.ts'
import { cronica, ingerir, numeroDeTick, tick } from '../src/mastropiero.ts'
import { forjar } from '../src/roster.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-cargas-'))
process.env.MASTRO_CARGAS = tmp

/** Respaldo sintético con la forma del de la 0.7.x: una entrada de cada cosa. */
const RESPALDO = {
  format: 'deprocast-backup', version: 3, exported_at: '2026-01-01T00:00:00Z', include_media: false,
  run: { operator_name: 'Operadora de prueba', day_count: 3 },
  tables: {
    persons: [
      { id: 'p1', name: 'Ada', kind: 'fisica', aliases: '["Ada L."]', status: 'active' },
      { id: 'p2', name: 'Ada Lovelace', kind: 'fisica', aliases: '[]', status: 'merged', merged_into: 'p1' },
    ],
    projects: [{ id: 'pr1', title: 'Telar', category: 'proyecto', status: 'activo', aliases: '[]' }],
    agrupaciones: [], dominios: [{ id: 'dom-x', name: 'Cálculo' }], geografia: [],
    entries: [
      { id: 'e1', source_type: 'audio', status: 'approved', title: 'audio 1', content_raw: 'La máquina analítica podría componer música si se le dan las reglas.', timestamp_exact: '2026-01-01T10:00:00Z', manual_tags: '[]', human_weight: 9 },
      { id: 'e2', source_type: 'audio', status: 'rejected', title: 'descartado', content_raw: 'ruido', manual_tags: '[]' },
      { id: 'e3', source_type: 'blob', status: 'approved', title: 'nota', content_raw: 'Anotar las tarjetas perforadas del telar.', manual_tags: '["telar"]' },
      { id: 'e4', source_type: 'chat', status: 'approved', title: 'chat', content_raw: 'Ada: hola\nCharles: hola' },
    ],
    validated_file_metadata: [{ entry_id: 'e1', assigned_title: 'Música analítica', transcription: 'x' }],
    pending_tasks: [{ entry_id: 'e1', task_text: 'escribir la nota G', status: 'accepted' }],
    entity_links: [
      { entity_kind: 'person', entity_id: 'p2', entry_id: 'e1', quantomo_id: 'q1', role: 'mentioned' },
      { entity_kind: 'project', entity_id: 'pr1', entry_id: 'e3', role: 'ner' },
    ],
    notebooks: [{ id: 'n1', title: 'Cuaderno de prueba' }],
    pages: [{ id: 'pg1', notebook_id: 'n1', numero_logico: 3, is_blank: 0, transcription_spatial: 'Diagrama del motor', explanation: 'La hoja muestra un motor.', entry_id: 'e5', title: 'Motor' }],
    chat_sessions: [{ id: 'cs1', nombre_chat: 'Charla' }],
    chat_blocks: [{ id: 'cb1', chat_session_id: 'cs1', entry_id: 'e4', day_key: '2026-01-02', summary_json: '{"title":"Saludo"}', linked_entities_json: '[]', message_count: 2 }],
    bookmarks: [
      { id: 'b1', text: 'Un hilo sobre bernoulli', author_name: 'Alguien', author_username: 'alguien', link: 'https://x.com/a/1', weight: 8, status: 'CRIBADO', source: 'twitter', category: 'CONCEPTOS', manual_tags: '[]', enrichment_json: '{}' },
      { id: 'b2', text: 'slop', weight: 2, status: 'SLOP', source: 'twitter', manual_tags: '[]' },
      { id: 'b3', text: 'peso bajo', weight: 2, status: 'CRIBADO', source: 'instagram', manual_tags: '[]' },
    ],
    knowledge_entities: [{ id: 'k1', kind: 'repo', title: 'telar-lib', status: 'ready', summary: 'Librería de telares.', source_url: 'https://github.com/x/telar', tags: '[]' }],
    knowledge_repos: [{ entity_id: 'k1', stars: 10, stack_tags: '["rust"]', topics_json: '[]', languages_json: '{"Rust":1}' }],
    depro_research_packs: [{ id: 'rp1', topic: 'Números de Bernoulli' }],
    depro_research_findings: [{ id: 'f1', pack_id: 'rp1', title: 'Definición', body: 'Los números de Bernoulli aparecen en series de potencias.', url: 'https://ejemplo.org/b', axis_title: 'Base', status: 'assimilated' }],
    resumidor_reports: [{ id: 'r1', created_at: '2026-01-03', markdown: '# Informe\nTodo bien.', scope: 'organismo', model: 'm' }],
    directo_reports: [], ama_lists: [{ id: 'l1', title: 'Tridente de prueba', kind: 'tridente', size: 3, tags: '[]' }],
    ama_list_items: [{ list_id: 'l1', position: 0, label: 'Uno' }, { list_id: 'l1', position: 1, label: 'Dos' }],
    link_harvest: [{ url_norm: 'https://ejemplo.org/x', source_type: 'entry' }, { url_norm: 'https://ejemplo.org/x', source_type: 'chat' }],
    quantomos: [{ id: 'q1', entry_id: 'e1', title: 'Música', content: 'Una máquina puede componer si tiene reglas', hermetic_weight: 12, human_weight: 11, stage: 'sealed', universe: 'castillo' }],
    quantomo_lattices: [{ quantomo_id: 'q1', codec: 'l72.v1', cells: '{0,1}', seal: 'abc', permutation_id: 7 }],
    haikus: [{ quantomo_id: 'q1', line1: 'a', line2: 'b', line3: 'c', valid: 1, is_face: 1 }],
    quantomo_candidates: [{ id: 'c1', text: 'Las tarjetas guardan patrones', peso: 5, status: 'pending_aduana', source_ref: 'e3', source_kind: 'blob' }],
  },
}

function cargar(db: ReturnType<typeof abrir>, nombre: string, contenido: string) {
  return subir(db, nombre, contenido)
}

test('el sistema arranca en blanco: solo fuentes estructurales, corpus vacío', () => {
  const db = abrir(':memory:')
  assert.deepEqual(fuentes(db).map((f) => f.id).sort(), ['agentes', 'deprocast-0.7', 'operador', 'web'])
  assert.equal(listarPiezas(db).total, 0)
  assert.equal(listarQuantomos(db).total, 0)
})

test('fuentes dinámicas: se crean con nivel y madre', () => {
  const db = abrir(':memory:')
  const f = asegurarFuente(db, { nombre: 'Deprocast 0.7.4 (Grok)', nivel: 'investigacion', padreId: 'deprocast-0.7' })
  assert.equal(f.id, 'deprocast-0.7.4-grok')
  assert.throws(() => asegurarFuente(db, { nombre: 'X', nivel: 'cualquiera' }), /Nivel/)
  insertar(db, { fuente: f.id, titulo: 't', contenido: 'c', estado: 'disponible' })
  assert.equal(listarPiezas(db, { fuente: 'deprocast-0.7' }).total, 1, 'la madre incluye a sus hijas')
})

test('respaldo de Deprocast: segmenta, entra sin duplicar y se deshace', () => {
  const db = abrir(':memory:')
  const c = cargar(db, 'respaldo.json', JSON.stringify(RESPALDO))
  assert.equal(c.importador, 'deprocast-respaldo')
  const seg = Object.fromEntries(c.analisis!.segmentos.map((s) => [s.id, s.cantidad]))
  assert.deepEqual(seg, { entidades: 3, audios: 1, notas: 1, cuaderno: 1, chats: 1, criba: 1, conocimiento: 1, investigaciones: 1, informes: 1, listas: 1, quantomos: 2, enlaces: 1 })

  const hecha = ejecutar(db, c.id, { pipeline: 'ninguna' })
  assert.equal(hecha.estado, 'hecha')
  assert.equal(hecha.resumen!.piezas, 9, 'todo menos los enlaces, que vienen apagados')
  assert.ok(fuentes(db).some((f) => f.id === 'deprocast-0.7.1' && f.padreId === 'deprocast-0.7'))

  const audio = piezaPorOrigen(db, 'deprocast-0.7.1:entry:e1')!
  assert.equal(audio.nivel, 'propia')
  assert.equal(audio.titulo, 'Música analítica')
  assert.deepEqual(audio.meta?.acciones, ['escribir la nota G'])
  const ada = listarEntidades(db, { q: 'Ada' })[0]
  assert.ok(audio.entidades.includes(ada.id), 'la persona fusionada resuelve a su destino')
  assert.ok(audio.etiquetas.includes('Ada'))
  assert.equal(piezaPorOrigen(db, 'deprocast-0.7.1:bookmark:b1')!.nivel, 'primaria')
  assert.equal(piezaPorOrigen(db, 'deprocast-0.7.1:finding:f1')!.nivel, 'investigacion')
  assert.equal(piezaPorOrigen(db, 'deprocast-0.7.1:informe-resumidor:r1')!.nivel, 'generada')

  const qs = quantomosDePieza(db, audio.id)
  assert.equal(qs.length, 1)
  assert.equal(qs[0].etapa, 'sellado')
  assert.equal(qs[0].l72?.sello, 'abc')
  assert.equal((qs[0].facetas[0] as any).versos.length, 3)
  assert.equal(listarQuantomos(db, { etapa: 'proto' }).total, 1, 'el candidato entra como proto')

  // Buscar ignora tildes y encuentra lo cargado.
  assert.ok(buscar(db, 'maquina analitica', 5).some((p) => p.id === audio.id))

  // Repetir la carga no duplica.
  const otra = ejecutar(db, cargar(db, 'respaldo.json', JSON.stringify(RESPALDO)).id, {})
  assert.equal(otra.resumen!.piezas, 0)
  assert.ok(otra.resumen!.repetidas > 0)

  deshacer(db, c.id)
  assert.equal(listarPiezas(db).total, 0)
  assert.equal(listarQuantomos(db).total, 0)
  assert.equal(listarEntidades(db).length, 0)
})

test('umbral de criba y pipeline: vectorizar publica tareas al bus', () => {
  const db = abrir(':memory:')
  const c = cargar(db, 'respaldo.json', JSON.stringify(RESPALDO))
  const hecha = ejecutar(db, c.id, { segmentos: ['criba'], umbralPeso: 1, pipeline: 'vectorizar' })
  assert.equal(hecha.resumen!.piezas, 2, 'con umbral 1 entra el de peso bajo, nunca el slop')
  assert.equal(tareas(db, 'pendiente').filter((t) => t.clase === 'vectorizador').length, 2)
})

test('CSV de repertorio: referencias con etiquetas y nivel elegido', () => {
  const db = abrir(':memory:')
  const csv = '﻿id,nombre,autor,fecha,descripcion,clasificacion,prioridad\nR1,"Un libro, largo",Autora,1999,"Sobre ""sistemas""",Libroteca,P0\nR2,Un paper,Otro,2020,Algo,Paper/Ensayo,P2\n'
  const c = cargar(db, 'repertorio.csv', csv)
  assert.equal(c.analisis!.segmentos[0].cantidad, 2)
  const f = asegurarFuente(db, { nombre: 'Curación de prueba', nivel: 'investigacion' })
  ejecutar(db, c.id, { fuenteId: f.id, nivel: 'investigacion' })
  const { piezas } = listarPiezas(db)
  const libro = piezas.find((p) => p.titulo === 'Un libro, largo')!
  assert.equal(libro.tipo, 'referencia')
  assert.equal(libro.autor, 'Autora')
  assert.equal(libro.contenido, 'Sobre "sistemas"')
  assert.deepEqual(libro.etiquetas, ['Libroteca', 'P0'])
  assert.equal(libro.peso, 12)
})

test('ficha de entidad: entidad, quántomos y vínculo con piezas ya cargadas', () => {
  const db = abrir(':memory:')
  ejecutar(db, cargar(db, 'respaldo.json', JSON.stringify(RESPALDO)).id, { segmentos: ['audios'] })
  const ficha = {
    schema: 'deprocast.entity-card', version: 1, exported_at: '2026-01-05',
    card: { kind: 'dominio', id: 'dom-x', title: 'Cálculo', prose: 'Cálculo es un dominio.', aliases: [], mentions: [], similar: [], timeline: [],
      quantomos: [{ id: 'q9', title: 'Q', content: 'Las series convergen', hermetic_weight: 7, stage: 'sealed' }], matter: [{ id: 'e1' }] },
  }
  const c = cargar(db, 'ficha.json', JSON.stringify(ficha))
  assert.equal(c.importador, 'deprocast-ficha')
  ejecutar(db, c.id, {})
  const ent = listarEntidades(db, { tipo: 'dominio' })[0]
  assert.equal(ent.nombre, 'Cálculo')
  assert.ok(piezaPorOrigen(db, 'deprocast-0.7.1:entry:e1')!.entidades.includes(ent.id))
  assert.equal(listarQuantomos(db).total, 1)
})

test('exporte de protoquántomos vacío: válido, sin nada que cargar', () => {
  const db = abrir(':memory:')
  const c = cargar(db, 'proto.json', JSON.stringify({ format: 'deprocast-quantomos', version: 1, stage: 'proto', quantomos: [], lattices: [] }))
  assert.equal(c.importador, 'deprocast-quantomos')
  assert.match(c.analisis!.avisos[0], /vacío/)
})

test('quántomos: sellar, pedir mejora, aceptar la propuesta y conservar el linaje', async () => {
  const db = abrir(':memory:')
  const id = crearQuantomo(db, { texto: 'el riego temprano es mejor porque si', etapa: 'proto' })!
  assert.throws(() => sellar(db, id, 13), /1 a 12/)
  sellar(db, id, 8)
  assert.equal(leerQuantomo(db, id)!.etapa, 'sellado')

  forjar(db, { clase: 'generativo' })
  const t = pedirMejora(db, id, 'más corto')
  assert.equal(t.tipo, 'mejora-quantomo')
  await tick(db, { reclutar: false })
  const propuesta = listarQuantomos(db, { etapa: 'propuesta' }).quantomos[0]
  assert.equal(propuesta.padreId, id)
  assert.equal(propuesta.version, 2)
  assert.equal(listarPiezas(db, { nivel: 'generada' }).total, 0, 'una mejora no es obra nueva: no va al corpus')

  aceptarPropuesta(db, propuesta.id, null)
  assert.equal(leerQuantomo(db, id)!.etapa, 'superado')
  assert.equal(leerQuantomo(db, propuesta.id)!.peso, 8, 'hereda el peso si no se da otro')
  assert.deepEqual(linaje(db, propuesta.id).map((q) => q.id), [id, propuesta.id])
})

test('lo que crea un generativo entra al corpus como generada; el extractor propone proto-quántomos', async () => {
  const db = abrir(':memory:')
  forjar(db, { clase: 'generativo' })
  publicar(db, { clase: 'generativo', payload: { texto: 'un poema' }, publicadaPor: 'operador' })
  const { corpusId } = ingerir(db, { fuente: 'operador', titulo: 'n', contenido: 'Regar temprano reduce mucho la evaporación del agua en verano. El mulch conserva la humedad del sustrato por más tiempo.' })
  await tick(db)
  assert.equal(listarPiezas(db, { nivel: 'generada' }).total, 1)
  assert.ok(quantomosDePieza(db, corpusId).length >= 1)
})

test('la crónica persiste en la base y numera los ticks', async () => {
  const db = abrir(':memory:')
  await tick(db)
  publicar(db, { clase: 'generativo', payload: { texto: 'x' }, publicadaPor: 'operador' })
  await tick(db)
  assert.equal(numeroDeTick(db), 2)
  assert.ok(cronica(db).every((e) => e.tick === 2))
})

test('migración: una base vieja (fuente 0.7.1, sin columnas nuevas) abre y conserva sus piezas', () => {
  const ruta = path.join(tmp, 'vieja.db')
  const vieja = new DatabaseSync(ruta)
  vieja.exec(`CREATE TABLE corpus (id INTEGER PRIMARY KEY AUTOINCREMENT, fuente TEXT NOT NULL, titulo TEXT NOT NULL, contenido TEXT NOT NULL,
    estado TEXT NOT NULL, datos TEXT, etiquetas TEXT, embedding TEXT, url TEXT, creado_en INTEGER NOT NULL);
    INSERT INTO corpus (fuente, titulo, contenido, estado, creado_en) VALUES ('0.7.1', 'vieja', 'una pieza de antes', 'disponible', 1);`)
  vieja.close()
  const db = abrir(ruta)
  const f = fuentes(db).find((x) => x.id === '0.7.1')!
  assert.equal(f.padreId, 'deprocast-0.7')
  assert.equal(listarPiezas(db).piezas[0].nivel, 'propia')
  assert.equal(buscar(db, 'pieza antes', 3).length, 1, 'el índice FTS se reconstruye')
  db.close()
})

test('los vínculos via_agrupacion no etiquetan; reetiquetar corrige una carga vieja', () => {
  const db = abrir(':memory:')
  const conVia = structuredClone(RESPALDO) as any
  conVia.tables.entity_links.push({ entity_kind: 'person', entity_id: 'p1', entry_id: 'e3', role: 'via_agrupacion' })
  const c = ejecutar(db, cargar(db, 'via.json', JSON.stringify(conVia)).id, {})
  const nota = piezaPorOrigen(db, 'deprocast-0.7.1:entry:e3')!
  assert.ok(!nota.etiquetas.includes('Ada'), 'Ada no se menciona en la nota: no se etiqueta')
  // Simula la carga vieja, con la etiqueta heredada mal puesta.
  const ada = listarEntidades(db, { q: 'Ada' })[0].id
  db.prepare('UPDATE corpus SET entidades = ?, etiquetas = ? WHERE id = ?').run(JSON.stringify([...nota.entidades, ada]), JSON.stringify([...nota.etiquetas, 'Ada']), nota.id)
  const r = reetiquetar(db, c.id)
  assert.ok(r.cambiadas >= 1)
  assert.ok(!piezaPorOrigen(db, 'deprocast-0.7.1:entry:e3')!.entidades.includes(ada))
  assert.ok(piezaPorOrigen(db, 'deprocast-0.7.1:entry:e1')!.entidades.includes(ada), 'las menciones reales quedan')
})
