import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-takeout-'))
process.env.MASTRO_DB = path.join(tmp, 'nube', 'mastro.db')
process.env.MASTRO_TAKEOUT = path.join(tmp, 'nube', 'takeout')

const { abrir } = await import('../src/db.ts')
const { asegurarEntidad } = await import('../src/entidades.ts')
const { zipDeBuffer } = await import('../src/takeout/zip.ts')
const { chatsDeGemini, fechaGemini, queEs, turnosDeChatNlm, turnosDeGemini } = await import('../src/takeout/leer.ts')
const { prepararTakeout } = await import('../src/takeout/cliente.ts')
const nube = await import('../src/takeout/nube.ts')

/** Un zip mínimo (deflate), como los de Takeout. */
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

const celda = (pedido: string, fecha: string, respuesta: string, chat: string) => `<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">Gemini Apps<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">${pedido}<br>${fecha}<br>${respuesta}</div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div><div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>Products:</b><br>&emsp;Gemini Apps<br><b>Details:</b><br>&emsp;https://gemini.google.com/app/${chat}: <a href="https://gemini.google.com/app/${chat}">https://gemini.google.com/app/${chat}</a><br></div></div></div>`
const ACTIVIDAD = `<html><body><div class="mdl-grid">${[
  celda('Prompted Ideas para el Proyecto Faro: un mapa de lugares<br>Attached 1 file.<br>-  <a href="notas%20faro-abc123.md">notas faro.md</a>', 'Mar 3, 2026, 10:15:00 AM CET', `<p>Podés empezar por <strong>tres capas</strong>.</p><p>${'Una capa de lugares, otra de recorridos y otra de historias que se cuentan caminando. '.repeat(4)}</p>`, 'aaaa1111'),
  celda('Prompted y la segunda capa?', 'Mar 3, 2026, 10:20:00 AM CET', '<p>La segunda capa son los recorridos.</p>', 'aaaa1111'),
  celda('Prompted traducime hola', 'Jun 1, 2026, 9:00:00 PM CEST', '<p>Hello.</p>', 'bbbb2222'),
  `<div class="outer-cell mdl-cell"><div class="mdl-grid"><div class="content-cell mdl-cell mdl-typography--body-1">Cleared previous feedback<br>Jun 2, 2026, 9:00:00 PM CEST<br></div></div></div>`,
].join('')}</div></body></html>`

test('takeout: lee la actividad de Gemini (fechas, chats, adjuntos) y los cuadernos de NotebookLM', () => {
  assert.equal(new Date(fechaGemini('Mar 3, 2026, 10:15:00 AM CET')!).toISOString(), '2026-03-03T09:15:00.000Z')
  assert.equal(new Date(fechaGemini('Jun 1, 2026, 12:05:00 AM CEST')!).toISOString(), '2026-05-31T22:05:00.000Z')
  const turnos = turnosDeGemini(ACTIVIDAD)
  assert.equal(turnos.length, 3, 'lo que no es un pedido no entra')
  assert.deepEqual(turnos[0].adjuntos, [{ archivo: 'notas faro-abc123.md', nombre: 'notas faro.md' }])
  assert.match(turnos[0].prompt, /^Ideas para el Proyecto Faro/)
  assert.doesNotMatch(turnos[0].prompt, /Attached/)
  assert.match(turnos[0].respuesta, /\*\*tres capas\*\*/)
  const chats = chatsDeGemini([...turnos, ...turnos])
  assert.equal(chats.length, 2)
  assert.equal(chats[0].turnos.length, 2, 'el mismo pedido en dos exportaciones cuenta una vez')
  assert.deepEqual(queEs('Faro/Sources/voz.m4a metadata.json'), { que: 'fuente-meta', base: 'voz.m4a' })
  assert.deepEqual(queEs('Faro/Artifacts/Resumen.wav(1)'), { que: 'artefacto', base: 'Resumen', ext: 'wav' })
  assert.deepEqual(queEs('Faro/Artifacts/Mapa'), { que: 'artefacto', base: 'Mapa', ext: '' })
  assert.deepEqual(turnosDeChatNlm('USER: <p>¿Qué dice?</p>\n\nMODEL: <p>Dice <em>esto</em>.</p>').map((t) => t.quien), ['yo', 'notebooklm'])
  const z = zipDeBuffer(zip({ 'a/b.txt': 'hola', 'c.txt': 'chau' }))
  assert.deepEqual(z.entradas.map((e) => [e.nombre, z.leer(e).toString()]), [['a/b.txt', 'hola'], ['c.txt', 'chau']])
})

test('takeout: un docx y un xlsx se leen por dentro (son zips)', () => {
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Primera línea</w:t></w:r></w:p><w:p><w:r><w:t>Segunda &amp; final</w:t></w:r></w:p></w:body></w:document>' })
  assert.equal(nube.textoDeDocumento(docx, 'docx').trim(), 'Primera línea\nSegunda & final')
  const xlsx = zip({
    'xl/sharedStrings.xml': '<sst><si><t>Mes</t></si><si><t>Ingreso</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>marzo</t></is></c><c r="B2"><v>1200</v></c></row></sheetData></worksheet>',
  })
  assert.equal(nube.textoDeDocumento(xlsx, 'xlsx'), '## Hoja 1\nMes | Ingreso\nmarzo | 1200')
})

test('takeout: de los zips a la nube — piezas con su fecha y su voz, medios que se procesan y se borran, destilado, nombres e historia', async () => {
  // La compu: un takeout de dos zips (la actividad y un adjunto en uno; un cuaderno en otro).
  const carpeta = path.join(tmp, 'takeout')
  fs.mkdirSync(carpeta, { recursive: true })
  fs.writeFileSync(path.join(carpeta, 'takeout-20261014T112845Z-1-001.zip'), zip({
    'Takeout/My Activity/Gemini Apps/MyActivity.html': ACTIVIDAD,
    'Takeout/My Activity/Gemini Apps/notas faro-abc123.md': '# Faro\nUn mapa de lugares con capas y recorridos, para caminar la ciudad.',
  }))
  fs.writeFileSync(path.join(carpeta, 'takeout-20261014T112845Z-1-002.zip'), zip({
    'Takeout/NotebookLM/Faro/Faro metadata.json': JSON.stringify({ title: 'Faro', emoji: '🗺', metadata: { createTime: '2026-04-01T10:00:00Z', lastViewed: '2026-05-01T10:00:00Z' } }),
    'Takeout/NotebookLM/Faro/Sources/voz.m4a metadata.json': JSON.stringify({ title: 'voz.m4a', metadata: { sourceAddedTimestamp: '2026-04-02T10:00:00Z', originalSourceContentType: 'SOURCE_CONTENT_TYPE_AUDIO' } }),
    'Takeout/NotebookLM/Faro/Sources/voz.m4a.html': `<p>${'Hoy pensé que Faro tiene que arrancar por un solo barrio y con Ana como guía. '.repeat(8)}</p>`,
    'Takeout/NotebookLM/Faro/Sources/paper.pdf metadata.json': JSON.stringify({ title: 'paper.pdf', metadata: { sourceAddedTimestamp: '2026-04-03T10:00:00Z', originalSourceContentType: 'SOURCE_CONTENT_TYPE_PDF' } }),
    'Takeout/NotebookLM/Faro/Sources/paper.pdf.html': '<p>Los mapas mentales de una ciudad se arman con recorridos repetidos.</p>',
    'Takeout/NotebookLM/Faro/Artifacts/Informe metadata.json': JSON.stringify({ title: 'Informe', type: 'ARTIFACT_TYPE_TAILORED_REPORT' }),
    'Takeout/NotebookLM/Faro/Artifacts/Informe.md': '## Informe\nFaro combina mapas y recorridos [1].',
  }))
  const prep = await prepararTakeout(carpeta, { salida: path.join(tmp, 'compu') })
  assert.equal(prep.lote, 'takeout-20261014T112845Z')
  assert.equal(prep.medios.length, 1, 'el adjunto de Gemini (un documento) se sube')

  // La nube.
  const db = abrir()
  const faro = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Faro', alias: ['Proyecto Faro'] })
  const paquete = fs.readFileSync(prep.paquete)
  nube.recibirParte(prep.lote, 0, paquete)
  nube.paqueteListo(db, prep.lote, paquete.length)
  const ing = await nube.ingerirPaquete(db, prep.lote)
  assert.equal(ing.chats, 2)
  assert.equal(ing.cuadernos, 1)
  const chat = db.prepare(`SELECT * FROM corpus WHERE origen_id = 'takeout:gemini:aaaa1111'`).get() as any
  assert.equal(chat.nivel, 'investigacion')
  assert.equal(chat.fecha, '2026-03-03')
  assert.match(chat.contenido, /\*\*Yo:\*\* Ideas para el Proyecto Faro[\s\S]*\[Adjuntos: notas faro\.md\][\s\S]*\*\*Gemini:\*\*/)
  assert.equal((db.prepare(`SELECT nivel FROM corpus WHERE origen_id = 'takeout:gemini-yo:aaaa1111'`).get() as any).nivel, 'propia', 'lo que él dijo es su voz')
  const voz = db.prepare(`SELECT * FROM corpus WHERE titulo LIKE 'Nota de voz%'`).get() as any
  assert.equal(voz.nivel, 'propia')
  assert.equal(voz.fecha, '2026-04-02')
  assert.equal((db.prepare(`SELECT nivel FROM corpus WHERE titulo LIKE 'Fuente · paper%'`).get() as any).nivel, 'primaria')
  assert.match((db.prepare(`SELECT fuente FROM corpus WHERE origen_id = 'takeout:nlm:Faro'`).get() as any).fuente, /^nlm-/, 'el cuaderno es un contexto (subfuente), no un Cuaderno de Deprocast')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cuadernos').get() as any).n, 0)

  // Repetir la ingesta no duplica.
  nube.recibirParte(prep.lote, 0, paquete)
  await nube.ingerirPaquete(db, prep.lote)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE origen_id LIKE 'takeout:gemini:%'`).get() as any).n, 2)

  // El medio llega, se procesa y se borra.
  const m = prep.medios[0]
  assert.deepEqual(nube.faltan(db, [m.huella]), [m.huella])
  nube.recibirMedio(db, prep.lote, m.huella, m.ext, fs.readFileSync(m.ruta))
  assert.deepEqual(nube.faltan(db, [m.huella]), [])
  nube.cerrarLote(db, prep.lote)

  const llamadas: string[] = []
  nube._probarTakeout({
    destilar: async (_db, _s, usuario) => {
      llamadas.push(usuario)
      if (/traducime/.test(usuario)) return { resumen: 'Pidió una traducción.', valor: 0, temas: ['traducción'], proyectos: [], personas: [], ideas: [], decisiones: [], abierto: [], sobre_el: [] }
      return {
        resumen: 'Pensó cómo arrancar Faro.', valor: 2, temas: ['mapas de ciudad', 'Mapas de Ciudad'],
        proyectos: [{ nombre: 'Proyecto Faro', estado_entonces: 'Una idea de mapa por capas.', ideas: ['Empezar por un barrio'] }],
        personas: [{ nombre: 'Ana', rol: 'guía' }], ideas: [{ texto: 'Arrancar Faro por un solo barrio', proyecto: 'Faro' }], decisiones: ['Tres capas'], abierto: ['¿Qué barrio?'], sobre_el: ['Prefiere probar en chico antes de escalar'],
      }
    },
  })
  nube._probarHistoria(async () => ({ eras: [{ desde: '2026-03', hasta: '2026-04', nombre: 'Mapa por capas', como_era: 'Una idea.' }], hoy: null, cambios: null, ideas_para_revisar: [{ idea: 'Empezar por un barrio', de_cuando: '2026-04', por_que_hoy: 'Es barato de probar.' }], pregunta: '¿En qué está Faro hoy y a dónde lo querés llevar?' }))
  await nube.trabajarTakeout(db)

  const medio = db.prepare('SELECT * FROM takeout_medios').get() as any
  assert.equal(medio.estado, 'hecho')
  assert.ok(!fs.existsSync(medio.ruta), 'el archivo no queda en Deprocast')
  const adj = db.prepare('SELECT * FROM corpus WHERE id = ?').get(medio.pieza_id) as any
  assert.match(adj.contenido, /Un mapa de lugares/)
  assert.equal(adj.fecha, '2026-03-03')
  assert.ok(llamadas.some((u) => /Un mapa de lugares/.test(u) && /Ideas para el Proyecto Faro/.test(u)), 'el chat se destila con su adjunto')
  assert.ok(llamadas.some((u) => /Contexto · Faro/.test(u) && /Faro combina mapas/.test(u)), 'el cuaderno se destila entero, como contexto')

  const destilados = db.prepare(`SELECT * FROM corpus WHERE fuente = 'takeout-destilado'`).all() as any[]
  assert.ok(destilados.length >= 3)
  assert.ok(destilados.every((d) => d.fecha), 'cada destilado conserva la fecha de lo que destila')
  assert.ok(JSON.parse((db.prepare('SELECT entidades FROM corpus WHERE id = ?').get(chat.id) as any).entidades).includes(faro), 'el alias «Proyecto Faro» enlaza la entidad que ya existía')
  const ana = db.prepare(`SELECT * FROM takeout_nombres WHERE clave = 'ana'`).get() as any
  assert.equal(ana.estado, 'propuesta', 'una persona nueva espera su ok')
  assert.ok(ana.veces >= 2)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM entidades WHERE nombre = 'Ana'`).get() as any).n, 0)
  const pulso = db.prepare(`SELECT COUNT(DISTINCT clave) AS temas, COUNT(*) AS n FROM temas_pulso WHERE clave = 'mapas de ciudad'`).get() as any
  assert.equal(pulso.temas, 1, 'el mismo tema con otra mayúscula es el mismo')
  assert.ok(pulso.n >= 2, 'y cuenta cada vez que volvió')
  assert.ok((db.prepare(`SELECT COUNT(*) AS n FROM quantomos WHERE universo = 'archivo'`).get() as any).n >= 1, 'las ideas quedan como quántomos proto')
  assert.ok(!db.prepare(`SELECT 1 FROM quantomos WHERE procedencia LIKE '%traducime%'`).get(), 'lo trivial no deja ideas')
  assert.ok((db.prepare(`SELECT COUNT(*) AS n FROM memoria WHERE creada_por = 'takeout' AND revisada = 0`).get() as any).n >= 1)

  const historia = db.prepare(`SELECT * FROM corpus WHERE titulo = 'Historia de Faro'`).get() as any
  assert.match(historia.contenido, /## Eras[\s\S]*Mapa por capas[\s\S]*## Hoy\nNo hay material reciente/)
  assert.ok(db.prepare(`SELECT 1 FROM preguntas WHERE origen = 'takeout' AND texto LIKE '%Faro%'`).get(), 'le pregunta en qué estado está hoy')
  assert.ok(db.prepare(`SELECT 1 FROM corpus WHERE titulo LIKE 'Mapa del año%'`).get())
  assert.equal((db.prepare('SELECT estado FROM takeout_lotes').get() as any).estado, 'terminado')

  // Aceptar a Ana: nace la entidad y se enlaza en lo que la mencionaba.
  const r = nube.resolverNombre(db, 'ana', 'aceptar')
  const conAna = db.prepare(`SELECT COUNT(*) AS n FROM corpus c, json_each(c.entidades) j WHERE j.value = ?`).get(r.entidadId!) as any
  assert.ok(conAna.n >= 2)
  assert.ok(nube.estadoTakeout(db).temas.length >= 1)
})

test('chatgpt: la exportación entra por el mismo camino — la rama que quedó, su voz transcripta, adjuntos, destilado situado y sin el chat grupal como su voz', async () => {
  const carpeta = path.join(tmp, 'f347054d-2025-01-20-10-00-00-abc')
  fs.mkdirSync(carpeta, { recursive: true })
  const t = (s: string) => Date.parse(s) / 1000
  const msg = (id: string, parent: string | null, role: string, cuando: string, content: any, metadata: any = {}) => ({ id, parent, children: [], message: { id, author: { role }, create_time: t(cuando), content, metadata } })
  fs.writeFileSync(path.join(carpeta, 'conversations-000.json'), JSON.stringify([{
    conversation_id: 'gpt-1', title: 'Plan para Faro', create_time: t('2024-06-01T10:00:00Z'), update_time: t('2024-06-01T11:00:00Z'), current_node: 'a2',
    mapping: {
      raiz: { id: 'raiz', parent: null, children: ['u1'], message: null },
      u1: msg('u1', 'raiz', 'user', '2024-06-01T10:00:00Z', { content_type: 'multimodal_text', parts: ['Armame un plan para el Proyecto Faro con Ana', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-DOC1' }] }, { attachments: [{ id: 'file-DOC1', name: 'notas.md' }] }),
      vieja: msg('vieja', 'u1', 'assistant', '2024-06-01T10:01:00Z', { content_type: 'text', parts: ['RESPUESTA DESCARTADA'] }),
      piensa: msg('piensa', 'u1', 'assistant', '2024-06-01T10:01:30Z', { content_type: 'thoughts', thoughts: [{ content: 'PENSAMIENTO INTERNO' }] }),
      a1: msg('a1', 'piensa', 'assistant', '2024-06-01T10:02:00Z', { content_type: 'text', parts: [`Primero, un barrio piloto. ${'Después, sumar recorridos y gente del barrio. '.repeat(8)}`] }),
      u2: msg('u2', 'a1', 'user', '2024-06-01T10:05:00Z', { content_type: 'multimodal_text', parts: [{ content_type: 'real_time_user_audio_video_asset_pointer' }, { content_type: 'audio_transcription', text: 'Dale, arrancamos por Ruzafa', direction: 'in' }] }),
      a2: msg('a2', 'u2', 'assistant', '2024-06-01T10:05:10Z', { content_type: 'multimodal_text', parts: [{ content_type: 'audio_transcription', text: 'Perfecto, Ruzafa entonces.', direction: 'out' }, { content_type: 'audio_asset_pointer' }] }),
    },
  }]))
  fs.writeFileSync(path.join(carpeta, 'group_chats.json'), JSON.stringify({ chats: [{ id: 'g1', name: 'Contrato', created_at: '2025-01-03T10:00:00Z', last_action_at: '2025-01-04T10:00:00Z', messages: [
    { role: 'user', text: 'Necesitamos un contrato', created_at: '2025-01-03T10:00:00Z' }, { role: 'assistant', text: 'Acá va un modelo.', created_at: '2025-01-03T10:01:00Z' },
  ] }] }))
  fs.writeFileSync(path.join(carpeta, 'conversation_asset_file_names.json'), JSON.stringify({ 'file-DOC1.dat': 'notas.md' }))
  fs.writeFileSync(path.join(carpeta, 'file-DOC1.dat'), '# Notas\nRecorridos por Ruzafa los domingos.')

  const prep = await prepararTakeout(carpeta, { salida: path.join(tmp, 'compu-gpt') })
  assert.equal(prep.lote, 'chatgpt-2025-01-20-10-00-00')
  assert.equal(prep.medios.length, 1)

  const db = abrir()
  const paquete = fs.readFileSync(prep.paquete)
  nube.recibirParte(prep.lote, 0, paquete)
  nube.paqueteListo(db, prep.lote, paquete.length)
  const ing = await nube.ingerirPaquete(db, prep.lote)
  assert.equal(ing.chats, 2)
  const chat = db.prepare(`SELECT * FROM corpus WHERE origen_id = 'takeout:chatgpt:gpt-1'`).get() as any
  assert.deepEqual([chat.titulo, chat.fuente, chat.nivel, chat.fecha], ['ChatGPT · Plan para Faro', 'chatgpt-chats', 'investigacion', '2024-06-01'])
  assert.match(chat.contenido, /\*\*Yo:\*\* Armame un plan[\s\S]*\[Adjuntos: notas\.md\][\s\S]*\*\*ChatGPT:\*\* Primero, un barrio piloto[\s\S]*\*\*Yo:\*\* Dale, arrancamos por Ruzafa[\s\S]*\*\*ChatGPT:\*\* Perfecto, Ruzafa/)
  assert.doesNotMatch(chat.contenido, /RESPUESTA DESCARTADA|PENSAMIENTO INTERNO/, 'solo la rama que quedó, sin lo interno del modelo')
  const yo = db.prepare(`SELECT * FROM corpus WHERE origen_id = 'takeout:chatgpt-yo:gpt-1'`).get() as any
  assert.deepEqual([yo.nivel, yo.fuente], ['propia', 'chatgpt'])
  assert.match(yo.contenido, /arrancamos por Ruzafa/, 'lo que dijo por voz es su voz')
  assert.ok(db.prepare(`SELECT 1 FROM corpus WHERE origen_id = 'takeout:chatgpt:grupo-g1'`).get())
  assert.ok(!db.prepare(`SELECT 1 FROM corpus WHERE origen_id = 'takeout:chatgpt-yo:grupo-g1'`).get(), 'del chat grupal no se sabe quién es él')

  nube.recibirMedio(db, prep.lote, prep.medios[0].huella, prep.medios[0].ext, fs.readFileSync(prep.medios[0].ruta))
  nube.cerrarLote(db, prep.lote)
  const vistos: { sistema: string; usuario: string }[] = []
  nube._probarTakeout({ destilar: async (_db, sistema, usuario) => { vistos.push({ sistema, usuario }); return { resumen: 'Planeó Faro con Ana.', valor: 2, temas: ['barrio piloto'], proyectos: [], personas: [{ nombre: 'Ana', rol: 'guía' }], ideas: [{ texto: 'Piloto en Ruzafa', proyecto: null }], decisiones: [], abierto: [], sobre_el: [] } } })
  nube._probarHistoria(async () => ({ eras: [], hoy: null, cambios: null, ideas_para_revisar: [], pregunta: '' }))
  await nube.trabajarTakeout(db)
  const adj = db.prepare(`SELECT * FROM corpus WHERE origen_id LIKE 'takeout:medio:%' AND contenido LIKE '%Ruzafa los domingos%'`).get() as any
  assert.equal(adj.fuente, 'chatgpt-adjuntos')
  const delChat = vistos.find((v) => /Plan para Faro/.test(v.usuario))!
  assert.match(delChat.sistema, /ChatGPT, la primera IA que usó/)
  assert.match(delChat.usuario, /una conversación con ChatGPT[\s\S]*fecha 2024-06-01[\s\S]*Ruzafa los domingos/, 'situado en su fecha y con su adjunto')
  assert.ok(db.prepare(`SELECT 1 FROM corpus WHERE titulo = 'Destilado · Plan para Faro'`).get())
  assert.equal((db.prepare('SELECT estado FROM takeout_lotes WHERE id = ?').get(prep.lote) as any).estado, 'terminado')
})
