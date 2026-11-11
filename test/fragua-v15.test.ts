import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { enLlano, erroresEnMarkdown, erroresRecientes, errorALaFragua, registrarFallo } from '../src/fallos.ts'
import { idDeArchivo } from '../src/google/drive.ts'
import { _probarLector, leer, lugarDeUrl, resolverMapa } from '../src/lector/index.ts'
import { armarHistorial } from '../src/chat/historial.ts'
import { crearConversacion, mensajes } from '../src/chat/index.ts'
import { diccionarioVacio, lemas, limpiar } from '../src/grafo/texto.ts'
import { diccionario, entidadesDeNodos } from '../src/grafo/index.ts'

// ─── #216: errores legibles ─────────────────────────────────────────────

test('#216: un error de código se explica en llano, con qué se intentaba, y se exporta y se manda a La Fragua', async () => {
  const db = abrir(':memory:')
  const t = Date.parse('2026-11-11T10:00:00Z')
  registrarFallo(db, { origen: 'herramienta:leer_de_drive', mensaje: "Cannot read properties of undefined (reading 'trim')", entrada: '{"id":"1AbC"}' }, t)
  registrarFallo(db, { origen: 'herramienta:leer_de_drive', mensaje: "Cannot read properties of undefined (reading 'trim')", entrada: '{"id":"1AbC"}' }, t + 1000)
  const [g] = erroresRecientes(db, 24, t + 2000).grupos
  assert.equal(g.veces, 2, 'el mismo fallo va una vez, con su cuenta')
  assert.equal(g.bug, true)
  assert.match(g.llano, /la herramienta leer_de_drive: esperaba un dato y llegó vacío \(al usar «trim»\)/)
  assert.match(g.llano, /Se intentaba con: \{"id":"1AbC"\}/)
  const md = erroresEnMarkdown(db, 24, t + 2000)
  assert.match(md, /^# Errores de las últimas 24 h/)
  assert.match(md, /## 🐞 herramienta:leer_de_drive · codigo ×2/)
  assert.match(md, /\*\*En llano:\*\*/)
  const r = await errorALaFragua(db, g.huella!, t + 3000)
  const p = db.prepare('SELECT titulo, detalle, prioridad, origen FROM propuestas WHERE id = ?').get(r.propuestaId) as any
  assert.equal(p.prioridad, 'alta')
  assert.equal(p.origen, 'errores')
  assert.match(p.detalle, /HUELLA: [0-9a-f]+ · 2 vez/)
  assert.equal((await errorALaFragua(db, g.huella!, t + 4000)).sumada, true, 'la segunda vez se suma a la misma')
  assert.match(enLlano({ codigo: 'base_de_datos', origen: 'liga', mensaje: 'NOT NULL constraint failed: tareas.x' }), /faltaba un campo obligatorio/)
})

test('#216: leer_de_drive sin archivo dice qué falta (no «reading trim»)', () => {
  assert.throws(() => idDeArchivo(undefined), /Falta el archivo: pasá el link de Drive o su id/)
  assert.equal(idDeArchivo('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit'), '1AbCdEfGhIjKlMnOpQrStUv')
})

// ─── #219: Google Maps ──────────────────────────────────────────────────

test('#219: la URL larga de Maps da nombre y pin; con el aviso de cookies, la de «continue»; un punto suelto, solo coordenadas', () => {
  const l = lugarDeUrl('https://www.google.com/maps/place/Forn+de+Pa+Ca+Pepa/@38.9887,-0.5211,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d38.98871!4d-0.52102')
  assert.equal(l.nombre, 'Forn de Pa Ca Pepa')
  assert.deepEqual([l.lat, l.lon], [38.98871, -0.52102], 'el pin del lugar, no el centro del mapa')
  const c = lugarDeUrl(`https://consent.google.com/m?continue=${encodeURIComponent('https://www.google.com/maps/place/Bar+X/@39.47,-0.37,15z')}`)
  assert.deepEqual([c.nombre, c.lat, c.lon], ['Bar X', 39.47, -0.37])
  const p = lugarDeUrl('https://maps.google.com/?q=39.4699,-0.3763')
  assert.deepEqual([p.nombre, p.lat, p.lon], [null, 39.4699, -0.3763])
})

test('#219: el acortado se expande y queda como lugar (nombre, dirección y coordenadas), no como un mapa centrado en cualquier lado', async () => {
  _probarLector(async (url) => {
    assert.match(url, /maps\.app\.goo\.gl/)
    const r = new Response('<html><head><meta property="og:title" content="Forn de Pa Ca Pepa · Carrer Major, 3, Xàtiva"><meta content="https://maps.google.com/maps/api/staticmap?center=64.78%2C25.87" property="og:image"></head></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    Object.defineProperty(r, 'url', { value: 'https://www.google.com/maps/place/Forn+de+Pa+Ca+Pepa/@38.98,-0.52,17z/data=!3d38.98871!4d-0.52102' })
    return r
  })
  const lugar = await resolverMapa('https://maps.app.goo.gl/abc123')
  assert.deepEqual([lugar.nombre, lugar.direccion, lugar.lat, lugar.lon], ['Forn de Pa Ca Pepa', 'Carrer Major, 3, Xàtiva', 38.98871, -0.52102])
  const l = await leer('https://maps.app.goo.gl/abc123')
  assert.equal(l.fuente, 'mapa')
  assert.match(l.markdown, /Coordenadas: 38\.98871, -0\.52102/)
  assert.doesNotMatch(l.markdown, /64\.78/)
})

// ─── #218: lo dictado ───────────────────────────────────────────────────

test('#218: una nota de voz llega al modelo marcada como dictado, con su hora', async () => {
  const db = abrir(':memory:')
  const c = crearConversacion(db)
  const t = new Date(2026, 10, 11, 12, 30).getTime()
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, via, en) VALUES (?, 'operador', ?, 'voz', ?)`).run(c.id, 'Comida baño permitido gente maja pan casero', t)
  const h = await armarHistorial(db, mensajes(db, c.id), { ahora: t + 60_000 })
  assert.equal(h[0].content, '[🎙 dictado · 12:30] Comida baño permitido gente maja pan casero')
})

// ─── #227 y #228: el grafo ──────────────────────────────────────────────

test('#227: las muletillas, las marcas de hablante y las rutas no son conceptos; su nombre tampoco', () => {
  const ls = lemas(limpiar('Voz A: vale, vale, claro, el plan de igualdad.\n[Speaker 2] Gracias, mira la auditoría en C:\\Users\\alguien\\dev\\notas'), diccionarioVacio())
  assert.ok(!ls.some((l) => /^(val|clar|graci|mir|voz|speaker|dev|users)/.test(l)), ls.join(' '))
  assert.ok(ls.some((l) => l.startsWith('igual')) && ls.some((l) => l.startsWith('audit')), ls.join(' '))
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO entidades (tipo, nombre, alias, meta, creada_en) VALUES ('persona', 'Jugador Ejemplo', '["Jugador"]', '{"operador":1}', 1)`).run()
  const d = diccionario(db)
  assert.ok(d.stop.has('jugador') && d.stop.has('ejemplo'), 'su nombre no une cosas en su grafo')
})

test('#228: un nodo que es una entidad hereda su tipo y su ficha (por nombre, alias, raíz o nombre de pila único)', () => {
  const db = abrir(':memory:')
  const e = (tipo: string, nombre: string, alias: string[] = []) => Number(db.prepare(`INSERT INTO entidades (tipo, nombre, alias, creada_en) VALUES (?, ?, ?, 1)`).run(tipo, nombre, JSON.stringify(alias)).lastInsertRowid)
  const versa = e('proyecto', 'Versa')
  const camila = e('persona', 'Camila Pérez')
  const valencia = e('lugar', 'Valencia', ['València'])
  e('persona', 'Ana Gómez'); e('persona', 'Ana López') // dos «Ana»: no se adivina
  const nodo = (i: number, forma: string, lema: string) => ({ i, forma, lema })
  const m = entidadesDeNodos(db, { nodos: [nodo(0, 'versa', 'vers'), nodo(1, 'camila', 'camil'), nodo(2, 'valència', 'valenci'), nodo(3, 'ana', 'ana'), nodo(4, 'camiones', 'camion')] as any })
  assert.equal(m[0]?.id, versa)
  assert.equal(m[0]?.tipo, 'proyecto')
  assert.equal(m[1]?.id, camila, 'el nombre de pila, si es único')
  assert.equal(m[2]?.id, valencia, 'por alias')
  assert.equal(m[3], undefined, 'ambiguo')
  assert.equal(m[4], undefined)
})

test('#208: lo mismo pedido dos veces (el mismo nombre propio, o casi) queda en un grupo; lo demás no se mezcla', async () => {
  const { gruposDePropuestas } = await import('../src/fragua-grupos.ts')
  const db = abrir(':memory:')
  const p = (titulo: string, detalle: string) => Number(db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, creada_en) VALUES (?, ?, 'otro', 'media', 'abierta', 1)`).run(titulo, detalle).lastInsertRowid)
  const bench = p('El Benchmarkeador: auditor que compara motores y agentes contra un banco de pruebas', 'Compara contra referencia: tiempo, tokens, euros, acierto.')
  const logos = p('Los Logos: serie de agentes profesionales, uno por rubro, con agrupación propia', 'Una familia de agentes: Logos · Laboral, Mercantil y Fiscal.')
  const raci = p('El Racializador: identificar especies, naturaleza y cuerpos celestes, con ficha y fuente', 'Recibe una foto o un nombre y devuelve una ficha.')
  const logos2 = p('Serie de profesionales Los Logos', 'Desarrollar una serie de profesionales de distintos rubros.')
  const bench2 = p('Agente Benchmarkeador', 'Construir un agente dedicado a benchmarks.')
  const raci2 = p('Agente Razalizador: detección de razas y naturaleza', 'Detectar razas de animales y elementos de la naturaleza.')
  p('Cuentas de redes: Deprocast accede a las del operador y cada agente tiene las suyas', 'Tokens por cuenta con alcance declarado.')
  p('Deprocast como sistema operativo de relojes, anillos y gadgets', 'Una capa de dispositivos con un contrato común.')
  const gs = gruposDePropuestas(db).map((g) => g.ids.sort((a, b) => a - b))
  assert.deepEqual(gs.sort((a, b) => a[0] - b[0]), [[bench, bench2], [logos, logos2], [raci, raci2]])
})
