import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-carpeta-'))
process.env.MASTRO_DB = path.join(tmp, 'nube', 'mastro.db')
process.env.MASTRO_TAKEOUT = path.join(tmp, 'nube', 'takeout')

const { abrir } = await import('../src/db.ts')
const { fechaDeRuta } = await import('../src/takeout/carpeta.ts')
const { loteDe, prepararTakeout } = await import('../src/takeout/cliente.ts')
const nube = await import('../src/takeout/nube.ts')

/** Un zip mínimo (deflate). */
function zip(archivos: Record<string, string | Buffer>): Buffer {
  const locales: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, 'utf8')
    const comp = zlib.deflateRawSync(datos)
    const n = Buffer.from(nombre, 'utf8')
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(datos.length, 22); lh.writeUInt16LE(n.length, 26)
    locales.push(lh, n, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(datos.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42)
    central.push(ch, n)
    offset += 30 + n.length + comp.length
  }
  const cd = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10)
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16)
  return Buffer.concat([...locales, cd, fin])
}

test('carpeta: la fecha sale del nombre (varias formas), de su carpeta o del archivo', () => {
  const oct = Date.parse('2026-10-05T10:00:00Z')
  assert.equal(fechaDeRuta('a/notas 2026-03-02.txt', oct), '2026-03-02')
  assert.equal(fechaDeRuta('audios/20260901_174913.m4a', oct), '2026-09-01')
  assert.equal(fechaDeRuta('fotos/1786442446535.jpg', oct), '2026-08-11')
  assert.equal(fechaDeRuta('Bot_faro_resumen_1409.md', oct, true), '2026-09-14')
  assert.equal(fechaDeRuta('Bot_faro_resumen_1409_dup1.md', oct, true), '2026-09-14')
  assert.equal(fechaDeRuta('Bot_faro_plan_2012.md', oct, true), '2025-12-20', 'un día que todavía no llegó es del año anterior')
  assert.equal(fechaDeRuta('Bot_faro_resumen_1409.md', oct), '2026-10-05', 'sin _DDMM en las reglas, cuenta la fecha del archivo')
  assert.equal(fechaDeRuta('diario/2026-06/hoy.md', oct), '2026-06-01')
})

test('carpeta: con sus reglas entra por el mismo camino — texto sacado en la compu, sin repetidos ni excluidos, voz y autor, fuentes por proyecto y destilado situado', async () => {
  const carpeta = path.join(tmp, 'Archivo de pruebas')
  const f = (rel: string, contenido: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(carpeta, rel)), { recursive: true }); fs.writeFileSync(path.join(carpeta, rel), contenido) }
  f('.mastro-importar.json', JSON.stringify({
    nombre: 'Pruebas', zips: true, sufijoDDMM: true,
    excluir: ['^privado/', '\\.py$'],
    niveles: { propia: ['^libretas/'], investigacion: ['(^|/)[A-Z][a-z]+_[^/]*_\\d{4}\\.\\w+$'] },
    autor: '(?:^|/)([A-Z][a-z]+)_[^/]*_\\d{4}\\.\\w+$',
    proyectoDelNombre: '^[A-Z][a-z]+_([^_/]+)_',
    sinDestilar: ['\\.csv$'],
  }))
  const resumen = `# Faro: dónde estamos\n\n${'El mapa por capas avanza: lugares, recorridos e historias del barrio. '.repeat(8)}`
  f('Bot_faro_resumen_1409.md', resumen)
  f('faro/copia del resumen.md', resumen)
  const notas = `Notas sueltas del piloto.\n\n${'Probar el recorrido del domingo con la gente del barrio. '.repeat(8)}`
  f('faro/notas 2026-03-02.txt', notas)
  f('faro/datos.csv', `lugar,visitas\n${Array.from({ length: 30 }, (_, i) => `plaza ${i},${i * 3}`).join('\n')}`)
  f('faro/informe.docx', zip({ 'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>Informe del piloto de Faro.</w:t></w:r></w:p><w:p><w:r><w:t>${'Los recorridos funcionaron mejor de lo esperado. '.repeat(10)}</w:t></w:r></w:p></w:body></w:document>` }))
  f('faro/script.py', 'print("no entra")')
  f('faro/esquema.xml', '<esquema>un volcado de datos que no es una imagen</esquema>')
  f('privado/documento.txt', 'Esto es privado y no se importa nunca, aunque sea largo y tenga texto suficiente.')
  f('lote.zip', zip({ 'dentro/idea.md': `# Una idea\n\n${'Sumar un mapa sonoro con audios del barrio. '.repeat(8)}`, 'dentro/notas.txt': notas }))
  f('libretas/hoja.jpg', Buffer.alloc(200)) // chiquita: un ícono, no se sube
  const oct = new Date('2026-10-01T10:00:00Z')
  for (const x of ['Bot_faro_resumen_1409.md', 'faro/notas 2026-03-02.txt', 'lote.zip']) fs.utimesSync(path.join(carpeta, x), oct, oct)

  assert.match(loteDe(carpeta), /^carpeta-pruebas-\d{8}$/)
  const prep = await prepararTakeout(carpeta, { salida: path.join(tmp, 'compu') })
  assert.equal(prep.lote, loteDe(carpeta))
  const inventario = fs.readFileSync(path.join(prep.dir, 'inventario.tsv'), 'utf8')
  assert.match(inventario, /excluido\tprivado\//)
  assert.match(inventario, /excluido\tfaro\/script\.py/)
  assert.match(inventario, /repetido\tfaro\/copia del resumen\.md/, 'la misma copia en otra carpeta entra una vez')
  assert.match(inventario, /repetido\tlote\.zip\/dentro\/notas\.txt/, 'lo de adentro del zip que ya estaba suelto, también')
  assert.match(inventario, /icono\tlibretas\/hoja\.jpg/)
  assert.match(inventario, /otro_formato\tfaro\/esquema\.xml/, 'fuera de los textos, solo imágenes y audios')
  const lineas = fs.readFileSync(prep.paquete, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(!lineas.some((l) => /privado/.test(JSON.stringify(l))), 'lo excluido no viaja')
  const docx = lineas.find((l) => l.ruta === 'faro/informe.docx')
  assert.match(docx.texto, /Informe del piloto de Faro/, 'el texto de un Word se saca en la compu')

  // La nube.
  const db = abrir()
  const paquete = fs.readFileSync(prep.paquete)
  nube.recibirParte(prep.lote, 0, paquete)
  nube.paqueteListo(db, prep.lote, paquete.length)
  const ing = await nube.ingerirPaquete(db, prep.lote)
  assert.equal(ing.docs, 5)
  assert.equal(ing.docs_nuevos, 5)
  const bot = db.prepare(`SELECT * FROM corpus WHERE titulo = 'Bot_faro_resumen_1409'`).get() as any
  assert.deepEqual([bot.nivel, bot.fecha, bot.autor, bot.fuente], ['investigacion', '2026-09-14', 'Bot', 'carpeta-pruebas-faro'], 'lo que armó el bot, con su fecha, su autor y su proyecto')
  assert.equal((db.prepare(`SELECT padre_id FROM fuentes WHERE id = 'carpeta-pruebas-faro'`).get() as any).padre_id, 'carpeta-pruebas')
  const nota = db.prepare(`SELECT * FROM corpus WHERE titulo = 'notas 2026-03-02'`).get() as any
  assert.deepEqual([nota.nivel, nota.fecha], ['primaria', '2026-03-02'])
  const csv = db.prepare(`SELECT id FROM corpus WHERE titulo = 'datos'`).get() as any
  assert.ok(csv, 'la tabla entra al corpus')
  assert.ok(!db.prepare('SELECT 1 FROM takeout_destilado WHERE pieza_id = ?').get(csv.id), 'pero no se destila')
  assert.ok(db.prepare('SELECT 1 FROM takeout_destilado WHERE pieza_id = ?').get(bot.id))

  // Repetir no duplica.
  nube.recibirParte(prep.lote, 0, paquete)
  const otra = await nube.ingerirPaquete(db, prep.lote)
  assert.equal(otra.docs_nuevos ?? 0, 0)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE origen_id LIKE 'carpeta:texto:%'`).get() as any).n, 5)

  // Una página de su libreta (un medio de la carpeta): se describe con su contexto, es su voz y se destila sola.
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3000, 1)])
  const huella = 'a'.repeat(40)
  nube.recibirParte(prep.lote, 0, Buffer.from(`${JSON.stringify({ t: 'medio', huella, clase: 'imagen', ext: 'jpg', nombre: 'pagina.jpg', apariciones: [{ origen: 'carpeta', de: 'Pruebas', contexto: 'libretas', titulo: 'libretas/pagina.jpg', fecha: '2026-08-11', nivel: 'propia', rol: 'archivo' }] })}\n`))
  await nube.ingerirPaquete(db, prep.lote)
  nube.recibirMedio(db, prep.lote, huella, 'jpg', jpg)
  nube.cerrarLote(db, prep.lote)
  const pedidos: string[] = []
  const vistos: { sistema: string; usuario: string }[] = []
  nube._probarTakeout({
    ver: async (_db, _img, _mime, _s, texto) => { pedidos.push(texto); return JSON.stringify({ titulo: 'Página con ideas para Faro', tipo: 'documento', descripcion: 'Una página escrita a mano.', texto_visible: `Ideas: ${'mapa sonoro, recorridos con vecinos, un piloto chico. '.repeat(8)}` }) },
    destilar: async (_db, sistema, usuario) => { vistos.push({ sistema, usuario }); return { resumen: 'Avanzó con Faro.', valor: 2, temas: ['mapa por capas'], proyectos: [], personas: [], ideas: [], decisiones: [], abierto: [], sobre_el: [] } },
  })
  nube._probarHistoria(async () => ({ eras: [], hoy: null, cambios: null, ideas_para_revisar: [], pregunta: '' }))
  await nube.trabajarTakeout(db)
  assert.match(pedidos[0], /Está en su carpeta «Pruebas», en «libretas\/pagina\.jpg» \(2026-08-11\)/)
  const pagina = db.prepare(`SELECT * FROM corpus WHERE origen_id = ?`).get(`takeout:medio:${huella}`) as any
  assert.deepEqual([pagina.fuente, pagina.nivel, pagina.fecha, pagina.titulo], ['carpeta-pruebas-libretas', 'propia', '2026-08-11', 'Imagen · Página con ideas para Faro'])
  assert.ok(vistos.some((v) => /página escaneada de un cuaderno\) de su carpeta «Pruebas», en «libretas»/.test(v.usuario)), 'su página se destila sola')
  const delBot = vistos.find((v) => /Bot_faro_resumen_1409/.test(v.usuario))!
  assert.match(delBot.sistema, /una carpeta de documentos que fue juntando/)
  assert.match(delBot.usuario, /un documento de su carpeta «Pruebas», en «faro» \(lo armó su bot «Bot», a pedido suyo\)[\s\S]*fecha 2026-09-14/)
  assert.ok(db.prepare(`SELECT 1 FROM corpus WHERE titulo = 'Destilado · Bot_faro_resumen_1409'`).get())
  assert.equal((db.prepare('SELECT estado FROM takeout_lotes WHERE id = ?').get(prep.lote) as any).estado, 'terminado')
})
