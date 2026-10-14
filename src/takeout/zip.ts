/**
 * Un lector de ZIP sin dependencias: el índice central (con ZIP64, para los zips de más de 4 GB o de 65 535 entradas
 * que arma Google Takeout) y cada entrada guardada o comprimida con deflate. Lee de un archivo (sin cargarlo entero) o
 * de un Buffer (un .docx o un .xlsx, que por dentro son zips).
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

export type EntradaZip = { nombre: string; tamano: number; comprimido: number; metodo: number; offset: number; dir: boolean }

type Lector = { largo: number; leer: (desde: number, largo: number) => Buffer; cerrar: () => void }

const deArchivo = (ruta: string): Lector => {
  const fd = fs.openSync(ruta, 'r')
  return {
    largo: fs.fstatSync(fd).size,
    leer: (desde, largo) => {
      const b = Buffer.alloc(largo)
      let n = 0
      while (n < largo) {
        const r = fs.readSync(fd, b, n, largo - n, desde + n)
        if (!r) break
        n += r
      }
      return b.subarray(0, n)
    },
    cerrar: () => fs.closeSync(fd),
  }
}

const deBuffer = (buf: Buffer): Lector => ({ largo: buf.length, leer: (desde, largo) => buf.subarray(desde, desde + largo), cerrar: () => {} })

const u64 = (b: Buffer, o: number) => Number(b.readBigUInt64LE(o))

/** El índice central: dónde empieza y cuántas entradas tiene (mirando el registro ZIP64 si hace falta). */
function indice(l: Lector): { desde: number; largo: number; total: number } {
  const cola = l.leer(Math.max(0, l.largo - 66_000), Math.min(l.largo, 66_000))
  const i = cola.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (i < 0) throw new Error('No es un zip (o está cortado: falta el final)')
  let total = cola.readUInt16LE(i + 10)
  let largo = cola.readUInt32LE(i + 12)
  let desde = cola.readUInt32LE(i + 16)
  if (total === 0xffff || largo === 0xffffffff || desde === 0xffffffff) {
    const loc = cola.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), i)
    if (loc < 0) throw new Error('Zip64 sin localizador')
    const reg = l.leer(u64(cola, loc + 8), 56)
    if (reg.readUInt32LE(0) !== 0x06064b50) throw new Error('Zip64 roto')
    total = u64(reg, 32)
    largo = u64(reg, 40)
    desde = u64(reg, 48)
  }
  return { desde, largo, total }
}

function entradas(l: Lector): EntradaZip[] {
  const { desde, largo } = indice(l)
  const cd = l.leer(desde, largo)
  const out: EntradaZip[] = []
  let o = 0
  while (o + 46 <= cd.length && cd.readUInt32LE(o) === 0x02014b50) {
    const flags = cd.readUInt16LE(o + 8)
    const metodo = cd.readUInt16LE(o + 10)
    let comprimido = cd.readUInt32LE(o + 20)
    let tamano = cd.readUInt32LE(o + 24)
    const ln = cd.readUInt16LE(o + 28)
    const le = cd.readUInt16LE(o + 30)
    const lc = cd.readUInt16LE(o + 32)
    let offset = cd.readUInt32LE(o + 42)
    const nombreBuf = cd.subarray(o + 46, o + 46 + ln)
    const nombre = flags & 0x800 ? nombreBuf.toString('utf8') : nombreBuf.toString('utf8') // Takeout escribe UTF-8 aunque no lo marque
    // El extra ZIP64 trae los campos que no entraron en 32 bits, en este orden.
    let e = o + 46 + ln
    const finExtra = e + le
    while (e + 4 <= finExtra) {
      const id = cd.readUInt16LE(e)
      const n = cd.readUInt16LE(e + 2)
      if (id === 0x0001) {
        let p = e + 4
        if (tamano === 0xffffffff) { tamano = u64(cd, p); p += 8 }
        if (comprimido === 0xffffffff) { comprimido = u64(cd, p); p += 8 }
        if (offset === 0xffffffff) { offset = u64(cd, p); p += 8 }
      }
      e += 4 + n
    }
    out.push({ nombre, tamano, comprimido, metodo, offset, dir: nombre.endsWith('/') })
    o += 46 + ln + le + lc
  }
  return out
}

/** Dónde empiezan los datos de una entrada (después de su cabecera local, que tiene su propio largo de nombre y extra). */
function inicioDatos(l: Lector, e: EntradaZip): number {
  const h = l.leer(e.offset, 30)
  if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`Cabecera rota en ${e.nombre}`)
  return e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28)
}

function descomprimir(e: EntradaZip, crudo: Buffer): Buffer {
  if (e.metodo === 0) return crudo
  if (e.metodo === 8) return zlib.inflateRawSync(crudo)
  throw new Error(`Compresión no soportada (${e.metodo}) en ${e.nombre}`)
}

export type Zip = { entradas: EntradaZip[]; leer: (e: EntradaZip) => Buffer; cerrar: () => void }

/** Abre un zip del disco: el índice al toque, cada entrada cuando se pide (una por vez en memoria). */
export function abrirZip(ruta: string): Zip {
  const l = deArchivo(ruta)
  try {
    const es = entradas(l)
    return { entradas: es, leer: (e) => descomprimir(e, l.leer(inicioDatos(l, e), e.comprimido)), cerrar: l.cerrar }
  } catch (err) {
    l.cerrar()
    throw err
  }
}

/** Lo mismo, de un zip que ya está en memoria (un .docx, un .xlsx). */
export function zipDeBuffer(buf: Buffer): Zip {
  const l = deBuffer(buf)
  const es = entradas(l)
  return { entradas: es, leer: (e) => descomprimir(e, l.leer(inicioDatos(l, e), e.comprimido)), cerrar: () => {} }
}
