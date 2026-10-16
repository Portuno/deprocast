/**
 * Un código QR sin dependencias: modo byte (UTF-8), corrección de errores M, versión mínima que entre (hasta la 40) y la
 * máscara con menos penalización. Devuelve la matriz de módulos (true = oscuro). Sigue la especificación ISO/IEC 18004
 * (la misma estructura que el generador de referencia de Nayuki).
 */
import zlib from 'node:zlib'

const ECC_POR_BLOQUE_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const BLOQUES_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
const FORMATO_M = 0 // bits de nivel: L=1, M=0, Q=3, H=2

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function modulosCrudos(ver: number): number {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}
const palabrasDeDatos = (ver: number) => Math.floor(modulosCrudos(ver) / 8) - ECC_POR_BLOQUE_M[ver] * BLOQUES_M[ver]

function multiplicar(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
function divisor(grado: number): number[] {
  const r = new Array(grado).fill(0)
  r[grado - 1] = 1
  let raiz = 1
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplicar(r[j], raiz)
      if (j + 1 < r.length) r[j] ^= r[j + 1]
    }
    raiz = multiplicar(raiz, 0x02)
  }
  return r
}
function resto(datos: number[], div: number[]): number[] {
  const r = new Array(div.length).fill(0)
  for (const b of datos) {
    const f = b ^ (r.shift() as number)
    r.push(0)
    div.forEach((c, i) => (r[i] ^= multiplicar(c, f)))
  }
  return r
}

function conEccIntercalado(ver: number, datos: number[]): number[] {
  const nBloques = BLOQUES_M[ver]
  const eccLen = ECC_POR_BLOQUE_M[ver]
  const crudas = Math.floor(modulosCrudos(ver) / 8)
  const cortos = nBloques - (crudas % nBloques)
  const largoCorto = Math.floor(crudas / nBloques)
  const div = divisor(eccLen)
  const bloques: number[][] = []
  for (let i = 0, k = 0; i < nBloques; i++) {
    const d = datos.slice(k, k + largoCorto - eccLen + (i < cortos ? 0 : 1))
    k += d.length
    const ecc = resto(d, div)
    if (i < cortos) d.push(0)
    bloques.push(d.concat(ecc))
  }
  const out: number[] = []
  for (let i = 0; i < bloques[0].length; i++) {
    for (let j = 0; j < bloques.length; j++) if (i !== largoCorto - eccLen || j >= cortos) out.push(bloques[j][i])
  }
  return out
}

function posicionesAlineacion(ver: number, tam: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const paso = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const r = [6]
  for (let p = tam - 7; r.length < n; p -= paso) r.splice(1, 0, p)
  return r
}

export function qrMatriz(texto: string): boolean[][] {
  const bytes = [...Buffer.from(texto, 'utf8')]
  let ver = 1
  for (; ver <= 40; ver++) if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= palabrasDeDatos(ver) * 8) break
  if (ver > 40) throw new Error('Demasiado largo para un QR')
  // Los bits: modo byte, cantidad, los bytes, terminador y relleno.
  const bits: number[] = []
  const poner = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1) }
  poner(0b0100, 4)
  poner(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) poner(b, 8)
  const capacidad = palabrasDeDatos(ver) * 8
  poner(0, Math.min(4, capacidad - bits.length))
  poner(0, (8 - (bits.length % 8)) % 8)
  for (let p = 0xec; bits.length < capacidad; p ^= 0xec ^ 0x11) poner(p, 8)
  const datos: number[] = []
  for (let i = 0; i < bits.length; i += 8) datos.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  const palabras = conEccIntercalado(ver, datos)

  const tam = ver * 4 + 17
  const m: boolean[][] = Array.from({ length: tam }, () => new Array(tam).fill(false))
  const fn: boolean[][] = Array.from({ length: tam }, () => new Array(tam).fill(false))
  const fijo = (x: number, y: number, oscuro: boolean) => { m[y][x] = oscuro; fn[y][x] = true }
  for (let i = 0; i < tam; i++) { fijo(6, i, i % 2 === 0); fijo(i, 6, i % 2 === 0) }
  const buscador = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      const x = cx + dx, y = cy + dy
      if (x >= 0 && x < tam && y >= 0 && y < tam) fijo(x, y, d !== 2 && d !== 4)
    }
  }
  buscador(3, 3); buscador(tam - 4, 3); buscador(3, tam - 4)
  const al = posicionesAlineacion(ver, tam)
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fijo(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  const formato = (mascara: number) => {
    const d = (FORMATO_M << 3) | mascara
    let r = d
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537)
    const b = ((d << 10) | r) ^ 0x5412
    for (let i = 0; i <= 5; i++) fijo(8, i, bit(b, i))
    fijo(8, 7, bit(b, 6)); fijo(8, 8, bit(b, 7)); fijo(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) fijo(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) fijo(tam - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) fijo(8, tam - 15 + i, bit(b, i))
    fijo(8, tam - 8, true)
  }
  formato(0) // reserva los lugares (se reescribe con la máscara elegida)
  if (ver >= 7) {
    let r = ver
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const b = (ver << 12) | r
    for (let i = 0; i < 18; i++) { const a = tam - 11 + (i % 3), c = Math.floor(i / 3); fijo(a, c, bit(b, i)); fijo(c, a, bit(b, i)) }
  }
  // Los datos, en zigzag de a dos columnas.
  let i = 0
  for (let der = tam - 1; der >= 1; der -= 2) {
    if (der === 6) der = 5
    for (let v = 0; v < tam; v++) for (let j = 0; j < 2; j++) {
      const x = der - j
      const y = ((der + 1) & 2) === 0 ? tam - 1 - v : v
      if (!fn[y][x] && i < palabras.length * 8) { m[y][x] = bit(palabras[i >>> 3], 7 - (i & 7)); i++ }
    }
  }
  const invierte = (k: number, x: number, y: number) => [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][k]
  const enmascarar = (k: number) => { for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (!fn[y][x] && invierte(k, x, y)) m[y][x] = !m[y][x] }
  // La máscara con menos penalización (rachas largas, bloques 2x2 y desbalance de oscuros).
  const penalizacion = () => {
    let p = 0
    for (let a = 0; a < tam; a++) {
      for (const linea of [m[a], m.map((f) => f[a])]) {
        let racha = 1
        for (let b = 1; b <= tam; b++) {
          if (b < tam && linea[b] === linea[b - 1]) racha++
          else { if (racha >= 5) p += racha - 2; racha = 1 }
        }
      }
    }
    for (let y = 0; y < tam - 1; y++) for (let x = 0; x < tam - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
    const oscuros = m.flat().filter(Boolean).length
    return p + Math.floor(Math.abs(oscuros * 20 - tam * tam * 10) / (tam * tam)) * 10
  }
  let mejor = 0
  let menor = Infinity
  for (let k = 0; k < 8; k++) {
    enmascarar(k); formato(k)
    const p = penalizacion()
    if (p < menor) (menor = p), (mejor = k)
    enmascarar(k) // deshace (la máscara es su propia inversa)
  }
  enmascarar(mejor)
  formato(mejor)
  return m
}

/** El QR como PNG en blanco y negro (con su margen), sin herramientas de afuera. */
export function qrPng(texto: string, escala = 8): Buffer {
  const { deflateSync, crc32 } = zlib
  const m = qrMatriz(texto)
  const n = (m.length + 8) * escala
  const filas: Buffer[] = []
  for (let y = 0; y < n; y++) {
    const fila = Buffer.alloc(n + 1, 255)
    fila[0] = 0 // sin filtro
    const my = Math.floor(y / escala) - 4
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / escala) - 4
      if (my >= 0 && mx >= 0 && my < m.length && mx < m.length && m[my][mx]) fila[x + 1] = 0
    }
    filas.push(fila)
  }
  const trozo = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const td = Buffer.concat([Buffer.from(tipo), datos])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([largo, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 0 // 8 bits, escala de grises
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(Buffer.concat(filas))), trozo('IEND', Buffer.alloc(0))])
}
