import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
process.env.TAVILY_API_KEY = 'falsa'
delete process.env.BRAVE_API_KEY
const { abrir } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarWeb } = await import('../src/web.ts')
const { asegurarEntidad } = await import('../src/entidades.ts')
const { bandeja, resolverBandeja } = await import('../src/sombra.ts')
const mi = await import('../src/agentes/misiones.ts')
const pi = await import('../src/agentes/pistas.ts')

const T = new Date(2026, 9, 27, 10).getTime()
const BRIEF = 'Productora audiovisual: fotos y video para eventos y marcas en Valencia. Buscamos productoras y eventos que tercericen.'

_probarWeb(async (url) => {
  if (String(url).includes('tavily')) return new Response(JSON.stringify({ results: [
    { title: 'Productora Luz', url: 'https://luz.example/', content: 'Productora de eventos en Valencia' },
    { title: 'Contacto Luz', url: 'https://luz.example/contacto', content: 'Escribinos' },
  ] }), { status: 200 })
  return new Response('<html><title>Luz</title><body>Somos una productora</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
})

function guion(pasos: { nombre: string; args: unknown }[][]) {
  let i = 0
  const respuestas: string[] = []
  _probarModelo(async (_l, o) => {
    const ultimo = o.mensajes.at(-1) as any
    if (ultimo?.role === 'tool') respuestas.push(String(ultimo.content))
    const p = pasos[i++] ?? []
    return { texto: p.length ? '' : 'listo', llamadas: p.map((x, k) => ({ id: `l${i}-${k}`, nombre: x.nombre, argumentos: JSON.stringify(x.args) })), razonamiento: null, modelo: 'falso', tokens: 10 }
  })
  return respuestas
}

test('El piloto: busca, guarda pistas solo con links que volvieron, redacta; el borrador va a 📥 y lo que él marca vuelve al diario hasta cumplir la misión', async () => {
  const db = abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentes-p-')), 'a.db'))
  const versa = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Productora de prueba' }, T)
  const m = mi.crearMisionAgente(db, { titulo: 'Un cliente', brief: BRIEF, criterio: { metrica: 'clientes', meta: 1 }, entidadId: versa }, T)
  const respuestas = guion([
    [{ nombre: 'buscar_web', args: { consulta: 'productoras eventos valencia' } }],
    [{ nombre: 'guardar_pista', args: { organizacion: 'Inventada SA', url: 'https://inventada.example', por_que: 'x' } }],
    [{ nombre: 'guardar_pista', args: { organizacion: 'Productora Luz', url: 'https://luz.example', contacto_url: 'https://luz.example/contacto', canal: 'formulario', por_que: 'Hacen eventos y tercerizan foto', lugar: 'Valencia' } }],
    [{ nombre: 'redactar_borrador', args: { pista: 1, texto: 'corto' } }],
    [{ nombre: 'redactar_borrador', args: { pista: 1, asunto: 'Foto y video para sus eventos', texto: 'Hola, somos una productora chica de Valencia. Vi que organizan eventos todo el año y quería ofrecerles cobertura de foto y video. Les dejo una muestra.' } }],
    [{ nombre: 'cerrar_sesion', args: { resumen: 'Una pista con borrador', proximo_paso: 'Buscar más' } }],
  ])
  await mi.trabajarMision(db, m.id, { ahora: T })
  assert.match(respuestas[1], /no salió de tus búsquedas/, 'un link de memoria no se guarda')
  const [p] = pi.pistasDe(db, { misionId: m.id })
  assert.equal(p.contacto.organizacion, 'Productora Luz')
  assert.equal(p.contacto.url, 'https://luz.example/contacto', 'el contacto también salió de los resultados')
  assert.match(respuestas[3], /no sirve/)
  assert.equal(pi.leerPista(db, p.id)!.etapa, 'borrador')
  assert.match(pi.leerPista(db, p.id)!.borrador!, /^Asunto: Foto y video/)

  // En 📥: «Lo mando» lo pasa a enviada y queda en el libro del modo sombra.
  const g = bandeja(db, T).grupos.find((x) => x.tipo === 'agente_borrador')!
  assert.equal(g.items[0].id, p.id)
  await resolverBandeja(db, 'agente_borrador', p.id, 'aceptar', T)
  assert.equal(pi.leerPista(db, p.id)!.etapa, 'enviada')
  assert.equal((db.prepare(`SELECT accion FROM decisiones WHERE tipo = 'agente:borrador'`).get() as any).accion, 'aceptada')

  // Entra un ingreso del proyecto: ¿es de esa pista? Sí → cliente → misión cumplida.
  db.prepare(`INSERT INTO movimientos (fecha, monto, moneda, categoria, descripcion, origen, huella, creado_en, entidad_id) VALUES ('2026-10-28', 400, 'EUR', 'ingresos', 'Cobertura evento', 'manual', 'h1', ?, ?)`).run(T + 1000, versa)
  const ing = bandeja(db, T + 2000).grupos.find((x) => x.tipo === 'agente_cliente')!
  assert.match(String(ing.items[0].texto), /Productora Luz/)
  await resolverBandeja(db, 'agente_cliente', ing.items[0].id, 'aceptar', T + 2000)
  assert.equal(pi.leerPista(db, p.id)!.etapa, 'cliente')
  assert.equal(mi.leerMisionAgente(db, m.id)!.estado, 'cumplida')
  assert.ok(mi.diarioDe(db, m.id).some((d) => /marcó la pista «Productora Luz»: cliente/.test(d.texto)), 'el agente se entera en su diario')
  assert.ok(!bandeja(db, T + 3000).grupos.some((x) => x.tipo === 'agente_cliente' && x.n), 'no vuelve a preguntar')
})

test('Descartar un borrador lo devuelve a «encontrada» y el agente lo lee; el prompt trae las pistas con su etapa', async () => {
  const db = abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentes-p-')), 'a.db'))
  const m = mi.crearMisionAgente(db, { titulo: 'Reuniones', brief: BRIEF, criterio: { metrica: 'reuniones', meta: 5 } }, T)
  guion([
    [{ nombre: 'buscar_web', args: { consulta: 'x' } }],
    [{ nombre: 'guardar_pista', args: { organizacion: 'Productora Luz', url: 'https://luz.example/', por_que: 'encaja' } }],
    [{ nombre: 'redactar_borrador', args: { pista: 1, texto: 'Hola, les escribo para ofrecerles foto y video en sus eventos de este año, con muestras.' } }],
    [{ nombre: 'cerrar_sesion', args: { resumen: 'ok', proximo_paso: 'más' } }],
  ])
  await mi.trabajarMision(db, m.id, { ahora: T })
  const p = pi.pistasDe(db)[0]
  pi.resolverBorrador(db, p.id, 'descartar', { ahora: T })
  assert.equal(pi.leerPista(db, p.id)!.etapa, 'encontrada')
  assert.ok(mi.diarioDe(db, m.id).some((d) => /descartó tu borrador/.test(d.texto)))
  const f = (await import('../src/roster.ts')).leer(db, m.agenteId)!
  const prompt = mi.promptMision(db, f, mi.leerMisionAgente(db, m.id)!, T)
  assert.match(prompt, /## Tus pistas \(0 de 5[\s\S]*Productora Luz \[Encontrada\]/)
})
