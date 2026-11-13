import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { abrir, fijarAjuste } from '../src/db.ts'
import { _probarGoogle } from '../src/google/oauth.ts'
import { alDrive, archivarConversaciones, barrerDocumentos, borrarDeDrive, estadoDrive, guardarDocumento, idDeArchivo, sincronizarCorpus, sumarCarpetaCorpus, trabajarCola } from '../src/google/drive.ts'

const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })

/** Un Drive de mentira: carpetas, subidas (multipart), reemplazos, listados y exportaciones. */
function driveFalso(archivos: Record<string, { name: string; mimeType: string; modifiedTime: string; padre: string; texto?: string }> = {}) {
  const carpetas: { id: string; nombre: string; padre: string }[] = []
  const cambios: any[] = (archivos as any).__cambios ?? []
  const subidas: { meta: any; contenido: string }[] = []
  const reemplazos: { id: string; contenido: string }[] = []
  const papelera: string[] = []
  const borrados: string[] = []
  let n = 0
  _probarGoogle((async (u: string, init: RequestInit = {}) => {
    const url = String(u)
    const metodo = init.method ?? 'GET'
    if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
    if (url.includes('/drive/v3/changes/startPageToken')) return json({ startPageToken: `m${cambios.length}` })
    if (url.includes('/drive/v3/changes?')) { const desde = Number(/pageToken=m(\d+)/.exec(url)?.[1] ?? 0); return json({ changes: cambios.slice(desde), newStartPageToken: `m${cambios.length}` }) }
    if (metodo === 'POST' && url.startsWith('https://www.googleapis.com/drive/v3/files?fields=id')) {
      const b = JSON.parse(String(init.body))
      const id = `carpeta-${++n}`
      carpetas.push({ id, nombre: b.name, padre: b.parents[0] })
      return json({ id })
    }
    if (metodo === 'POST' && url.includes('/upload/drive/v3/files?uploadType=multipart')) {
      const crudo = Buffer.from(init.body as Uint8Array).toString('utf8')
      const partes = crudo.split(/\r\n\r\n/)
      const meta = JSON.parse(partes[1].split('\r\n--')[0])
      subidas.push({ meta, contenido: partes.slice(2).join('\r\n\r\n').replace(/\r\n--deprocast[0-9a-f]+--$/, '') })
      return json({ id: `archivo-${subidas.length}`, webViewLink: `https://drive/${subidas.length}` })
    }
    if (metodo === 'DELETE') { borrados.push(url.split('/files/')[1].split('?')[0]); return new Response(null, { status: 204 }) }
    if (metodo === 'PATCH' && /\?fields=id$/.test(url) && String(init.body ?? '').includes('trashed')) { papelera.push(url.split('/files/')[1].split('?')[0]); return json({ id: 'x' }) }
    if (metodo === 'PATCH') { reemplazos.push({ id: url.split('/files/')[1].split('?')[0], contenido: Buffer.from(init.body as Uint8Array).toString('utf8') }); return json({ id: 'x' }) }
    const lista = /\?q=([^&]+)/.exec(url)
    if (lista) {
      const padre = /'([^']+)' in parents/.exec(decodeURIComponent(lista[1].replace(/\+/g, ' ')))?.[1]
      return json({ files: Object.entries(archivos).filter(([, f]) => f.padre === padre).map(([id, f]) => ({ id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, webViewLink: `https://docs/${id}` })) })
    }
    const exp = /\/files\/([\w-]+)\/export/.exec(url)
    if (exp) return new Response(archivos[exp[1]].texto ?? '')
    const meta = /\/files\/([\w-]+)\?fields=/.exec(url)
    if (meta) { const f = archivos[meta[1]]; return json({ name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, webViewLink: `https://docs/${meta[1]}` }) }
    return json({ error: { message: `no simulado: ${metodo} ${url}` } }, 500)
  }) as typeof fetch)
  return { carpetas, subidas, reemplazos, papelera, borrados }
}

function conectado() {
  const db = abrir(':memory:')
  fijarAjuste(db, 'google_refresh', 'r1')
  fijarAjuste(db, 'google_alcances', 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file')
  return db
}

describe('Drive (plan v35, fase 2)', () => {
  const antes = { db: process.env.MASTRO_DB, id: process.env.GOOGLE_OAUTH_ID, s: process.env.GOOGLE_OAUTH_SECRETO }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-'))
  before(() => { process.env.MASTRO_DB = path.join(tmp, 'x.db'); process.env.GOOGLE_OAUTH_ID = 'c'; process.env.GOOGLE_OAUTH_SECRETO = 's' })
  after(() => {
    for (const [k, v] of [['MASTRO_DB', antes.db], ['GOOGLE_OAUTH_ID', antes.id], ['GOOGLE_OAUTH_SECRETO', antes.s]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    _probarGoogle(fetch)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('lo que manda va a su carpeta Mastropiero (Audios/AAAA-MM), con la transcripción; las carpetas se crean una vez', async () => {
    const db = conectado()
    const g = driveFalso()
    const ahora = new Date(2026, 10, 5, 10, 30).getTime()
    const id = alDrive(db, { datos: Buffer.from('OggS audio'), nombre: 'nota.ogg', tipo: 'audio', origen: 'WhatsApp', descripcion: 'Comprar pan y llamar a Ana' }, ahora)
    assert.ok(id)
    await trabajarCola(db)
    assert.equal(g.subidas.length, 1)
    assert.deepEqual(g.carpetas.map((c) => c.nombre), ['Mastropiero', 'Audios', '2026-11'])
    assert.equal(g.carpetas[0].padre, 'root')
    assert.equal(g.subidas[0].meta.name, '2026-11-05 10.30 · WhatsApp · nota.ogg')
    assert.equal(g.subidas[0].meta.description, 'Comprar pan y llamar a Ana')
    assert.equal(g.subidas[0].meta.parents[0], g.carpetas[2].id)
    assert.equal(fs.readdirSync(path.join(tmp, 'drive-cola')).length, 0, 'el archivo sale del disco')

    alDrive(db, { datos: Buffer.from('jpg'), nombre: 'foto.jpg', tipo: 'imagen', origen: 'chat' }, ahora)
    alDrive(db, { datos: Buffer.from('ogg 2'), nombre: 'otra.ogg', tipo: 'audio', origen: 'chat' }, ahora)
    await trabajarCola(db)
    assert.deepEqual(g.carpetas.map((c) => c.nombre), ['Mastropiero', 'Audios', '2026-11', 'Imágenes', '2026-11'], 'Audios ya existía: no se vuelve a crear')
    assert.equal(estadoDrive(db).cola.subidos, 3)
  })

  it('apagado, o sin Google, no guarda nada', () => {
    const db = conectado()
    fijarAjuste(db, 'drive_medios', '0')
    assert.equal(alDrive(db, { datos: Buffer.from('x'), nombre: 'a.ogg', tipo: 'audio', origen: 'chat' }), null)
    assert.equal(alDrive(abrir(':memory:'), { datos: Buffer.from('x'), nombre: 'a.ogg', tipo: 'audio', origen: 'chat' }), null)
  })

  it('las conversaciones: un documento por día (Google Doc) que se reescribe solo si cambió', async () => {
    const db = conectado()
    const g = driveFalso()
    const dia = new Date(2026, 10, 5, 9).getTime()
    const c = Number(db.prepare(`INSERT INTO conversaciones (con, titulo, creada_en, actualizada_en) VALUES ('mastropiero', 'Hoy', ?, ?)`).run(dia, dia).lastInsertRowid)
    const msj = db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)`)
    msj.run(c, 'operador', '¿Qué tengo hoy?', dia)
    msj.run(c, 'asistente', 'Tres cosas: la reunión, el presupuesto y el gimnasio.', dia + 60_000)
    assert.equal(await archivarConversaciones(db, '2026-11-05'), 1)
    const doc = g.subidas[0]
    assert.equal(doc.meta.mimeType, 'application/vnd.google-apps.document')
    assert.equal(doc.meta.name, '2026-11-05 · Hoy')
    assert.match(doc.contenido, /\[09:00\] Vos:\n¿Qué tengo hoy\?/)
    assert.deepEqual(g.carpetas.map((x) => x.nombre), ['Mastropiero', 'Conversaciones', '2026-11'])
    assert.equal(await archivarConversaciones(db, '2026-11-05'), 0, 'sin cambios, no se toca')
    msj.run(c, 'operador', 'Gracias', dia + 120_000)
    assert.equal(await archivarConversaciones(db, '2026-11-05'), 1)
    assert.equal(g.reemplazos[0].id, 'archivo-1', 'se reescribe el mismo documento')
    assert.match(g.reemplazos[0].contenido, /Gracias/)
  })

  it('sus carpetas al corpus: lo nuevo entra, lo que no cambió no se toca, lo que cambió se actualiza', async () => {
    const db = conectado()
    const archivos = {
      doc1: { name: 'Plan 2027', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-11-01T10:00:00Z', padre: 'mis-notas', texto: 'El plan del año que viene.' },
      sub: { name: 'Viajes', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-11-01T10:00:00Z', padre: 'mis-notas' },
      hoja: { name: 'Gastos', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-11-02T10:00:00Z', padre: 'sub', texto: 'fecha,monto\n2026-11-01,1200' },
      foto: { name: 'foto.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-11-02T10:00:00Z', padre: 'mis-notas' },
    }
    ;(archivos as any).__cambios = []
    driveFalso(archivos)
    assert.deepEqual(sumarCarpetaCorpus(abrir(':memory:'), { id: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ', nombre: 'X' }), [{ id: '1AbCdEfGhIjKlMnOpQ', nombre: 'X' }])
    // La carpeta de prueba (un id corto) se carga directo.
    fijarAjuste(db, 'drive_corpus', JSON.stringify([{ id: 'mis-notas', nombre: 'Mis notas' }]))
    assert.deepEqual(await sincronizarCorpus(db), { nuevos: 2, actualizados: 0, retirados: 0, errores: 0, modo: 'completo' }, 'el documento y la planilla (de la subcarpeta); la foto no tiene texto')
    const p = db.prepare(`SELECT titulo, contenido, url FROM corpus WHERE origen_id = 'drive:hoja'`).get() as { titulo: string; contenido: string; url: string }
    assert.match(p.contenido, /2026-11-01,1200/)
    assert.equal(p.url, 'https://docs/hoja')
    assert.deepEqual(await sincronizarCorpus(db), { nuevos: 0, actualizados: 0, retirados: 0, errores: 0, modo: 'cambios' }, 'sin cambios: no recorre nada')
    archivos.doc1.modifiedTime = '2026-11-05T10:00:00Z'
    archivos.doc1.texto = 'El plan del año que viene, corregido.'
    // Fragua #136: solo lo que cambió (la API de cambios), no el árbol entero.
    const cambios = (archivos as any).__cambios
    cambios.push({ fileId: 'doc1', file: { id: 'doc1', name: 'Plan 2027', mimeType: archivos.doc1.mimeType, modifiedTime: archivos.doc1.modifiedTime, parents: ['mis-notas'] } })
    cambios.push({ fileId: 'otro', file: { id: 'otro', name: 'Ajeno', mimeType: archivos.doc1.mimeType, modifiedTime: '2026-11-05T10:00:00Z', parents: ['carpeta-ajena'] } })
    cambios.push({ fileId: 'hoja', removed: true })
    assert.deepEqual(await sincronizarCorpus(db), { nuevos: 0, actualizados: 1, retirados: 1, errores: 0, modo: 'cambios' }, 'lo editado se actualiza, lo ajeno no entra, lo borrado se retira')
    assert.equal((db.prepare(`SELECT estado FROM corpus WHERE origen_id = 'drive:hoja'`).get() as { estado: string }).estado, 'retirada')
    assert.match((db.prepare(`SELECT contenido FROM corpus WHERE origen_id = 'drive:doc1'`).get() as { contenido: string }).contenido, /corregido/)
  })

  it('Mastropiero guarda documentos en Mastropiero/Documentos', async () => {
    const db = conectado()
    const g = driveFalso()
    const r = await guardarDocumento(db, 'Resumen de la semana', 'Lo que pasó…', 'Resúmenes')
    assert.equal(r.carpeta, 'Mastropiero/Documentos/Resúmenes')
    assert.equal(g.subidas[0].meta.mimeType, 'application/vnd.google-apps.document')
    assert.equal(idDeArchivo('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQ/edit'), '1AbCdEfGhIjKlMnOpQ')
    const sinPermiso = abrir(':memory:')
    fijarAjuste(sinPermiso, 'google_refresh', 'r1')
    fijarAjuste(sinPermiso, 'google_alcances', 'https://www.googleapis.com/auth/drive.readonly')
    await assert.rejects(guardarDocumento(sinPermiso, 'x', 'y'), /volver a conectar/)
  })

  it('#240: guardar un documento con un nombre que ya está lo reescribe (no crea otro); borrar va a la papelera; el barrido marca repetidos y vacíos', async () => {
    const db = conectado()
    fijarAjuste(db, 'drive_carpeta:Mastropiero/Documentos', 'docs')
    const DOC = 'application/vnd.google-apps.document'
    const g = driveFalso({
      docBuenoAbCdEfGhIjKlMn: { name: 'Prototipo 72 arquetipos', mimeType: DOC, modifiedTime: '2026-11-12T10:00:00Z', padre: 'docs', texto: 'Las doce tandas, completas, con todo el material que hacía falta.' },
      docRestoAbCdEfGhIjKlMn: { name: 'Prototipo 72 arquetipos', mimeType: DOC, modifiedTime: '2026-11-11T10:00:00Z', padre: 'docs', texto: 'Prueba' },
      docOtroAbCdEfGhIjKlMnO: { name: 'Plan', mimeType: DOC, modifiedTime: '2026-11-10T10:00:00Z', padre: 'docs', texto: 'Un plan con suficiente texto para no contar como vacío.' },
    })
    const r = await guardarDocumento(db, 'Prototipo 72 arquetipos', 'Versión nueva')
    assert.equal(r.actualizado, true)
    assert.equal(g.subidas.length, 0, 'no crea otro')
    assert.deepEqual(g.reemplazos.map((x) => x.id), ['docBuenoAbCdEfGhIjKlMn'], 'reescribe el más nuevo')
    assert.match((r as any).aviso, /2 documentos con ese nombre/)
    const nuevo = await guardarDocumento(db, 'Otro título', 'Texto')
    assert.equal(nuevo.actualizado, false)
    assert.equal(g.subidas.length, 1)
    const b = await barrerDocumentos(db)
    assert.equal(b.repetidos, 2)
    assert.equal(b.vacios, 1)
    assert.ok(b.documentos.find((d) => d.id === 'docRestoAbCdEfGhIjKlMn')!.vacio)
    const x = await borrarDeDrive(db, 'https://docs.google.com/document/d/docRestoAbCdEfGhIjKlMn/edit')
    assert.deepEqual(g.papelera, ['docRestoAbCdEfGhIjKlMn'])
    assert.match(x.como, /papelera/)
    await borrarDeDrive(db, 'docRestoAbCdEfGhIjKlMn', true)
    assert.deepEqual(g.borrados, ['docRestoAbCdEfGhIjKlMn'])
  })
})
