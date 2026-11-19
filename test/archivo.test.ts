import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir, fijarAjuste } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { insertar } from '../src/corpus.ts'
import { crearMision } from '../src/misiones.ts'
import { _probarTaller, crearSegun } from '../src/taller.ts'
import { HERRAMIENTAS, ejecutarHerramienta } from '../src/chat/herramientas.ts'
import { leerGenerado, listarGenerados, markdownDe, reenviarGenerado, registrarGenerado, sumarLoDeOtrosLados, tipoDeArchivo } from '../src/archivo.ts'
import * as wa from '../src/whatsapp.ts'

process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'archivo-taller-'))
process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'archivo-adj-'))

test('Fragua #320: el PDF que pidió por el chat queda en el Archivo, con su texto para buscar, de dónde salió y su proyecto', async () => {
  const db = abrir(':memory:')
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Estreno ABC' })
  const r = await ejecutarHerramienta(HERRAMIENTAS, 'armar_pdf', JSON.stringify({ titulo: 'Plan del Estreno ABC', contenido: '# Plan\n\nAforos 69, 77, 98 y 108.\n\n- Pedir el DCP' }), { db, conversacionId: 7 })
  assert.equal(r.ok, true, JSON.stringify(r.resultado))
  const l = listarGenerados(db)
  assert.equal(l.total, 1)
  const g = l.items[0]
  assert.deepEqual([g.tipo, g.titulo, g.origen, g.origenRef, g.entidadId, g.entidad], ['pdf', 'Plan del Estreno ABC', 'chat', 'conversacion:7', proy, 'Estreno ABC'])
  assert.match(g.url!, /^\/adjuntos\/\d+-Plan-del-Estreno-ABC\.pdf$/)
  assert.match(g.resumen!, /1 página · Plan/)
  assert.equal(listarGenerados(db, { q: 'DCP' }).total, 1, 'se busca en lo que dice adentro')
  assert.equal(listarGenerados(db, { q: 'DCP aforos' }).total, 1, 'todas las palabras')
  assert.equal(listarGenerados(db, { q: 'dron' }).total, 0)
  assert.equal(listarGenerados(db, { tipo: 'imagen' }).total, 0)
  assert.equal(listarGenerados(db, { entidad: proy }).items.length, 1)
  assert.deepEqual(l.proyectos.map((p) => ({ ...p })), [{ id: proy, nombre: 'Estreno ABC', n: 1 }])
  // Mandarlo dos veces no lo duplica.
  registrarGenerado(db, { clave: `adjunto:${g.adjunto}`, tipo: 'pdf', titulo: g.titulo, origen: 'chat', canal: 'WhatsApp' })
  assert.equal(listarGenerados(db).total, 1)
  assert.equal(listarGenerados(db).items[0].canal, 'WhatsApp')
})

test('Fragua #320: lo del Taller, los aportes, las guías de cuadernos y los informes se listan sin duplicar el archivo', async () => {
  const db = abrir(':memory:')
  _probarTaller({ imagen: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) })
  const a = await crearSegun(db, { tipo: 'imagen', pedido: 'un faro al atardecer' })
  const prim = crearMision(db, { personaje: 'jugador', asignadaPor: 'jugador', nivel: 'primaria', titulo: 'Lanzar el podcast', estado: 'activa' })
  insertar(db, { fuente: 'operador', titulo: 'Aporte · próximos pasos', contenido: 'Grabá el piloto el martes.', nivel: 'generada', meta: { aporte: 1, primaria: prim.id, agente: 'GEN-0001' }, origenId: 'ap:1' } as any)
  db.prepare(`INSERT INTO programados (titulo, pedido, cuando, activo, ultimo, resultado, creado) VALUES ('Radar de convocatorias', 'Buscá convocatorias', '{}', 1, ?, '## Hay dos\n\nUna de cine y otra de música.', ?)`).run(Date.now(), Date.now())

  assert.equal(sumarLoDeOtrosLados(db), 3)
  assert.equal(sumarLoDeOtrosLados(db), 0, 'una sola vez')
  const l = listarGenerados(db)
  assert.deepEqual(Object.keys(l.tipos).sort(), ['aporte', 'imagen', 'informe'])
  const img = l.items.find((x) => x.tipo === 'imagen')!
  assert.equal(img.artefactoId, a.id)
  assert.match(img.url!, new RegExp(`^/taller/${a.id}/`), 'apunta al archivo del Taller, no a una copia')
  assert.equal(fs.readdirSync(process.env.MASTRO_ADJUNTOS!).filter((f) => f.endsWith('.png')).length, 0)
  const aporte = l.items.find((x) => x.tipo === 'aporte')!
  assert.match(aporte.origenTexto!, /primaria «Lanzar el podcast».*GEN-0001/)
  const informe = leerGenerado(db, l.items.find((x) => x.tipo === 'informe')!.id)!
  assert.equal(informe.resumen, 'Hay dos')
  const md = markdownDe(informe)
  assert.match(md.nombre, /^Radar-de-convocatorias\.md$/)
  assert.match(md.datos.toString(), /^# Radar de convocatorias\n\n_Informe · .*Buscá convocatorias_\n\n## Hay dos/)
  assert.equal(listarGenerados(db, { origen: 'ayudante' }).total, 1)
  assert.equal(listarGenerados(db, { desde: '2000-01-01', hasta: '2000-01-02' }).total, 0)
})

test('Fragua #320: reenviar manda el archivo o el texto a su WhatsApp; un juego no se manda; la ventana cerrada se dice', async () => {
  const db = abrir(':memory:')
  const id = registrarGenerado(db, { clave: 'programado:1:1', tipo: 'informe', titulo: 'Radar', origen: 'programado', texto: 'Una convocatoria nueva.' })
  await assert.rejects(reenviarGenerado(db, id), /ventana de 24 horas/)
  const juego = registrarGenerado(db, { clave: 'artefacto:99', tipo: 'juego', titulo: 'Un juego', origen: 'taller' })
  await assert.rejects(reenviarGenerado(db, juego), /no se manda/)

  wa.configurarWhatsapp(db, { numeroId: '123456789', token: 'EAA'.padEnd(40, 'x'), secreto: 'a'.repeat(32) })
  fijarAjuste(db, 'whatsapp_wa_id', '5491100000000')
  fijarAjuste(db, 'whatsapp_ultimo_entrante', String(Date.now() - 60_000))
  const mandados: any[] = []
  wa._probarWhatsapp((async (u: string, init: RequestInit = {}) => {
    if (String(u).endsWith('/media')) return new Response(JSON.stringify({ id: 'm1' }))
    if (String(u).endsWith('/messages')) { mandados.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ messages: [{ id: 'w' }] })) }
    return new Response('{}', { status: 404 })
  }) as typeof fetch)
  assert.deepEqual(await reenviarGenerado(db, id), { canal: 'WhatsApp' })
  assert.match(mandados.map((m) => m.text?.body ?? '').join('\n'), /Radar\n\nUna convocatoria nueva\./)

  fs.writeFileSync(path.join(process.env.MASTRO_ADJUNTOS!, '1-plan.pdf'), '%PDF-1.4 x')
  const pdf = registrarGenerado(db, { clave: 'adjunto:1-plan.pdf', tipo: 'pdf', titulo: 'Plan', nombre: 'plan.pdf', origen: 'chat', adjunto: '1-plan.pdf' })
  mandados.length = 0
  await reenviarGenerado(db, pdf)
  assert.ok(mandados.some((m) => m.type === 'document' && m.document.filename === 'plan.pdf'), JSON.stringify(mandados))
})

test('Fragua #320: el tipo sale de la extensión', () => {
  assert.deepEqual(['a.pdf', 'b.pptx', 'c.xlsx', 'd.PNG', 'e.mp3', 'f.mp4', 'g.md'].map(tipoDeArchivo), ['pdf', 'presentacion', 'planilla', 'imagen', 'audio', 'video', 'documento'])
})
