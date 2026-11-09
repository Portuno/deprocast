import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { after, before, test } from 'node:test'
import { abrir } from '../src/db.ts'
import { leerCarga, subir } from '../src/cargas/index.ts'

/** Un zip mínimo (sin comprimir), como los que arma Word por dentro. */
function zip(archivos: Record<string, string>): Buffer {
  const locales: Buffer[] = []
  const centrales: Buffer[] = []
  let offset = 0
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.from(contenido, 'utf8')
    const n = Buffer.from(nombre, 'utf8')
    const crc = zlib.crc32(datos)
    const loc = Buffer.alloc(30)
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0, 8); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(datos.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(datos.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42)
    locales.push(loc, n, datos)
    centrales.push(cen, n)
    offset += 30 + n.length + datos.length
  }
  const central = Buffer.concat(centrales)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10); fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(offset, 16)
  return Buffer.concat([...locales, central, fin])
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-'))
const antes = process.env.MASTRO_CARGAS
before(() => { process.env.MASTRO_CARGAS = tmp })
after(() => { process.env.MASTRO_CARGAS = antes; fs.rmSync(tmp, { recursive: true, force: true }) })

test('un Word (.docx) o un OpenDocument (.odt) que llega por WhatsApp o Telegram se lee como texto', () => {
  const db = abrir(':memory:')
  const docx = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Plan de Igualdad 2027–2031</w:t></w:r></w:p><w:p><w:r><w:t>Objetivo: paridad en los puestos de dirección &amp; formación.</w:t></w:r></w:p></w:body></w:document>' })
  const c = subir(db, 'Plan_Igualdad_Calderona_Fitness_2027-2031_borrador.docx', docx)
  const a = leerCarga(db, c.id)!.analisis!
  assert.equal(a.importador, 'texto')
  const raw = fs.readdirSync(tmp).length
  assert.ok(raw >= 1)
  const odt = zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<office:document-content><office:body><office:text><text:p>Hola<text:s text:c="2"/>mundo</text:p><text:h>Título</text:h></office:text></office:body></office:document-content>' })
  assert.equal(leerCarga(db, subir(db, 'nota.odt', odt).id)!.analisis!.importador, 'texto')
  assert.throws(() => subir(db, 'roto.docx', Buffer.from('no soy un zip')), /no parece un documento válido/)
})
