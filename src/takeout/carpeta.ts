/**
 * Una carpeta de documentos (la que va armando un asistente o uno mismo, ordenada por proyecto): md, txt, csv, html,
 * PDF, Word, Excel, PowerPoint, imágenes, audios y videos, también dentro de zips. Se reconoce porque tiene un
 * «.mastro-importar.json» con sus reglas (qué no entra, qué es su voz, qué escribió un bot, qué no se destila): así lo
 * propio de cada carpeta vive en la carpeta y no en el código.
 *
 * Acá no se gasta un token: el texto de los documentos se saca en la compu (también de los PDF y los Office) y va en
 * el paquete; las imágenes y los audios se achican y se suben. Lo repetido (el mismo archivo suelto y dentro de un zip,
 * la misma copia en dos carpetas) entra una vez. En la nube sigue el camino de siempre: piezas, medios, destilado,
 * entidades, quántomos e historia.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { abrirZip, type Zip } from './zip.ts'
import { aMarkdown, claseDeArchivo, type ClaseMedio } from './leer.ts'
import { achicar } from './achicar.ts'
import { textoDeDocumento, tramosDeTexto, type Aparicion } from './nube.ts'
import { slug } from '../corpus.ts'

export const CONFIG = '.mastro-importar.json'
type Log = (t: string) => void
type Medio = { huella: string; clase: ClaseMedio; ext: string; nombre: string; ruta: string; apariciones: Aparicion[] }

/** Las reglas de una carpeta (expresiones regulares sobre la ruta relativa, con «/», sin distinguir mayúsculas). */
export type ReglasCarpeta = {
  nombre: string
  descripcion?: string
  /** Leer también lo que hay dentro de los zips (lo repetido con lo suelto entra una vez). */
  zips?: boolean
  /** Los nombres terminan en _DDMM (día y mes; el año sale de la fecha del archivo). */
  sufijoDDMM?: boolean
  excluir?: string[]
  /** Qué nivel de voz tiene cada cosa (lo que no coincide es «primaria»). */
  niveles?: { propia?: string[]; investigacion?: string[]; generada?: string[] }
  /** Quién lo escribió, sacado del nombre (el grupo 1): p. ej. el bot que lo armó. */
  autor?: string
  /** El proyecto de un archivo suelto en la raíz, sacado de su nombre (el grupo 1). */
  proyectoDelNombre?: string
  /** Lo que entra al corpus (se puede buscar) pero no se destila: tablas y volcados de datos. */
  sinDestilar?: string[]
}

export const esCarpetaImportable = (carpeta: string) => fs.existsSync(path.join(carpeta, CONFIG))

export function leerReglas(carpeta: string): ReglasCarpeta {
  const r = JSON.parse(fs.readFileSync(path.join(carpeta, CONFIG), 'utf8')) as ReglasCarpeta
  return { ...r, nombre: String(r.nombre || path.basename(path.resolve(carpeta))).slice(0, 60) }
}

const re = (xs: string[] | undefined) => (xs ?? []).map((x) => new RegExp(x, 'i'))
const algun = (rs: RegExp[], s: string) => rs.some((r) => r.test(s))

/** Lo que sale de la carpeta: archivos sueltos y entradas de zips, con su ruta relativa y su fecha. */
type Archivo = { rel: string; bytes: number; mtime: number; leer: () => Buffer }

function recorrer(carpeta: string, excluir: RegExp[], conZips: boolean, alSaltear: (rel: string) => void): { archivos: Archivo[]; zips: Zip[] } {
  const archivos: Archivo[] = []
  const zips: Zip[] = []
  const ir = (dir: string, base: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.name === CONFIG) continue
      const rel = base ? `${base}/${d.name}` : d.name
      const abs = path.join(dir, d.name)
      if (algun(excluir, d.isDirectory() ? `${rel}/` : rel)) { alSaltear(d.isDirectory() ? `${rel}/` : rel); continue }
      if (d.isDirectory()) { ir(abs, rel); continue }
      if (!d.isFile()) continue
      const st = fs.statSync(abs)
      if (/\.zip$/i.test(d.name)) {
        if (!conZips) { alSaltear(rel); continue }
        let z: Zip
        try { z = abrirZip(abs) } catch { alSaltear(`${rel} (zip ilegible)`); continue }
        zips.push(z)
        for (const e of z.entradas) {
          if (e.dir) continue
          const relE = `${rel}/${e.nombre.replace(/\\/g, '/')}`
          if (algun(excluir, relE)) { alSaltear(relE); continue }
          archivos.push({ rel: relE, bytes: e.tamano, mtime: st.mtimeMs, leer: () => z.leer(e) })
        }
        continue
      }
      archivos.push({ rel, bytes: st.size, mtime: st.mtimeMs, leer: () => fs.readFileSync(abs) })
    }
  }
  ir(carpeta, '')
  return { archivos, zips }
}

const valida = (a: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && a >= 2000 && a <= 2100
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** La fecha de un archivo: la que dice su nombre (20260901, 2026-09-01, un instante en milisegundos, _DDMM) o la de su carpeta; si no, la del archivo. */
export function fechaDeRuta(rel: string, mtime: number, sufijoDDMM = false): string {
  const nombre = rel.split('/').pop() ?? rel
  const ymd = (s: string) => {
    for (const m of s.matchAll(/(?<!\d)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/g)) if (valida(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3])
    return null
  }
  const deNombre = ymd(nombre)
  if (deNombre) return deNombre
  const epoch = /(?<!\d)(1[5-9]\d{11})(?!\d)/.exec(nombre)?.[1]
  if (epoch) return new Date(Number(epoch)).toISOString().slice(0, 10)
  if (sufijoDDMM) {
    const m = /_(\d{2})(\d{2})(?:_[^/._]*)?\.\w+$/.exec(nombre)
    if (m) {
      const ref = new Date(mtime)
      let a = ref.getFullYear()
      if (valida(a, +m[2], +m[1])) {
        if (Date.parse(iso(a, +m[2], +m[1])) > mtime + 2 * 86_400_000) a -= 1
        return iso(a, +m[2], +m[1])
      }
    }
  }
  const ym = /(?<!\d)(20\d{2})-(\d{2})(?![\d-])/.exec(rel)
  const deCarpeta = ymd(rel.split('/').slice(0, -1).join('/')) ?? (ym && valida(+ym[1], +ym[2], 1) ? `${ym[1]}-${ym[2]}-01` : null)
  return deCarpeta ?? new Date(mtime).toISOString().slice(0, 10)
}

const TEXTO = /^(md|markdown|txt|csv|tsv|json|jsonl|html?)$/
const OFFICE = /^(pdf|docx|pptx|xlsx|xlsm)$/

/** El texto de un archivo de texto o de un documento, sacado acá (sin modelos). */
function textoDe(datos: Buffer, ext: string): string {
  let t: string
  if (OFFICE.test(ext)) t = textoDeDocumento(datos, ext === 'xlsm' ? 'xlsx' : ext)
  else if (ext === 'html' || ext === 'htm') t = aMarkdown(datos.toString('utf8'))
  else t = datos.toString('utf8')
  return t.replace(/^﻿/, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
}

/** La fecha más nueva de lo que entra: el lote cambia cuando la carpeta suma algo (y lo ya subido no se repite). */
export function loteCarpeta(carpeta: string): string {
  const r = leerReglas(carpeta)
  let ultima = 0
  const excluir = re(r.excluir)
  const ir = (dir: string, base: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${d.name}` : d.name
      if (d.name === CONFIG || algun(excluir, d.isDirectory() ? `${rel}/` : rel)) continue
      if (d.isDirectory()) ir(path.join(dir, d.name), rel)
      else if (d.isFile()) ultima = Math.max(ultima, fs.statSync(path.join(dir, d.name)).mtimeMs)
    }
  }
  ir(carpeta, '')
  return `carpeta-${slug(r.nombre).replace(/\./g, '-').slice(0, 30) || 'docs'}-${new Date(ultima || Date.now()).toISOString().slice(0, 10).replace(/-/g, '')}`
}

export async function prepararCarpeta(carpeta: string, o: { salida?: string; log?: Log; paralelo?: number } = {}) {
  const log = o.log ?? (() => {})
  const reglas = leerReglas(carpeta)
  const lote = loteCarpeta(carpeta)
  const dir = path.resolve(o.salida ?? path.join(process.cwd(), 'data', 'takeout', lote))
  const dirMedios = path.join(dir, 'medios')
  const tmp = path.join(dir, 'tmp')
  fs.mkdirSync(dirMedios, { recursive: true })
  fs.mkdirSync(tmp, { recursive: true })
  const resumen: Record<string, number> = {}
  const mas = (k: string, n = 1) => { resumen[k] = (resumen[k] ?? 0) + n }
  const inventario: string[] = []
  const anotar = (que: string, rel: string) => { inventario.push(`${que}\t${rel}`); mas(que) }

  const excluir = re(reglas.excluir)
  const propia = re(reglas.niveles?.propia)
  const investigacion = re(reglas.niveles?.investigacion)
  const generada = re(reglas.niveles?.generada)
  const sinDestilar = re(reglas.sinDestilar)
  const autorRe = reglas.autor ? new RegExp(reglas.autor) : null
  const proyectoRe = reglas.proyectoDelNombre ? new RegExp(reglas.proyectoDelNombre) : null
  const nivelDe = (rel: string) => (algun(propia, rel) ? 'propia' : algun(investigacion, rel) ? 'investigacion' : algun(generada, rel) ? 'generada' : 'primaria')
  // Un archivo suelto en la raíz va al proyecto que dice su nombre solo si hay una carpeta con ese nombre (si no, a la raíz).
  const carpetas = new Map(fs.readdirSync(carpeta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => [d.name.toLowerCase(), d.name]))
  const proyectoDe = (rel: string) => {
    const partes = rel.split('/')
    if (partes.length > 1) return partes[0]
    return carpetas.get(proyectoRe?.exec(partes[0])?.[1]?.toLowerCase() ?? '') ?? null
  }

  const { archivos, zips } = recorrer(carpeta, excluir, reglas.zips !== false, (rel) => anotar('excluido', rel))
  log(`${reglas.nombre}: ${archivos.length} archivos para mirar (${zips.length} zips abiertos)`)

  const paquete = path.join(dir, 'paquete.jsonl')
  const fd = fs.openSync(`${paquete}.parcial`, 'w')
  const w = (x: unknown) => fs.writeSync(fd, `${JSON.stringify(x)}\n`)
  const vistos = new Set<string>() // huellas de archivos y de textos: lo repetido entra una vez
  const medios = new Map<string, Medio>()
  const pendientes: { a: Archivo; huella: string; clase: ClaseMedio; ext: string; ap: Aparicion }[] = []
  try {
    w({ t: 'lote', id: lote, creado: Date.now(), origen: 'carpeta', carpeta: { nombre: reglas.nombre, descripcion: reglas.descripcion ?? null } })
    let i = 0
    for (const a of archivos) {
      if (++i % 500 === 0) log(`  ${i}/${archivos.length}`)
      const nombre = a.rel.split('/').pop()!
      const cl = claseDeArchivo(nombre)
      const ext = path.extname(nombre).toLowerCase().slice(1)
      const esTexto = TEXTO.test(ext) || OFFICE.test(ext)
      // Fuera de los textos, solo imágenes y audios (un .xml suelto, un .xls viejo o un zip dentro de un zip no entran).
      if (!esTexto && cl?.clase !== 'imagen' && cl?.clase !== 'audio') { anotar('otro_formato', a.rel); continue }
      if (esTexto && ((/^(json|jsonl|html?|csv|tsv)$/.test(ext) && a.bytes > 2 * 1024 * 1024) || a.bytes > 600 * 1024 * 1024)) { anotar('muy_grande', a.rel); continue }
      if (cl?.clase === 'imagen' && a.bytes < 12 * 1024) { anotar('icono', a.rel); continue }
      if (cl?.clase === 'audio' && a.bytes > 1500 * 1024 * 1024) { anotar('muy_grande', a.rel); continue }
      let datos: Buffer
      try { datos = a.leer() } catch { anotar('ilegible', a.rel); continue }
      const huella = crypto.createHash('sha1').update(datos).digest('hex')
      const fecha = fechaDeRuta(a.rel, a.mtime, reglas.sufijoDDMM)
      const nivel = nivelDe(a.rel)
      const proyecto = proyectoDe(a.rel)
      if (esTexto) {
        if (vistos.has(huella)) { anotar('repetido', a.rel); continue }
        vistos.add(huella)
        let texto: string
        try { texto = textoDe(datos, ext) } catch { anotar('ilegible', a.rel); continue }
        if (texto.length < 40) { anotar(ext === 'pdf' ? 'pdf_sin_texto' : 'vacio', a.rel); continue }
        const ht = `texto:${crypto.createHash('sha1').update(texto).digest('hex')}`
        if (vistos.has(ht)) { anotar('repetido', a.rel); continue }
        vistos.add(ht)
        const autor = autorRe?.exec(a.rel)?.[1] ?? null
        const partes = tramosDeTexto(texto, 300_000)
        partes.forEach((t, k) => w({
          t: 'doc', de: reglas.nombre, proyecto, ruta: a.rel, titulo: nombre.replace(/\.\w+$/, ''), fecha, autor, nivel, ext,
          destilar: !algun(sinDestilar, a.rel), parte: k + 1, partes: partes.length, texto: t,
        }))
        anotar(`texto_${ext}`, a.rel)
        continue
      }
      if (vistos.has(huella)) { anotar('repetido', a.rel); continue }
      vistos.add(huella)
      pendientes.push({ a, huella, clase: cl!.clase, ext: cl!.ext, ap: { origen: 'carpeta', de: reglas.nombre, contexto: proyecto ?? '', titulo: a.rel, fecha, nivel, rol: 'archivo' } })
    }

    // Los medios: achicar en paralelo (se vuelven a leer acá: no quedan todos en memoria).
    log(`Medios: ${pendientes.length} para achicar…`)
    const cola = [...pendientes]
    let hechos = 0
    const trabajar = async () => {
      for (let p = cola.shift(); p; p = cola.shift()) {
        const h = p.huella
        const extOut = p.clase === 'audio' ? 'mp3' : 'jpg'
        const salida = path.join(dirMedios, `${h}.${extOut}`)
        if ((fs.existsSync(salida) && fs.statSync(salida).size > 0) || await achicar(p.a.leer(), p.ext, p.clase, salida, tmp)) {
          medios.set(h, { huella: h, clase: p.clase, ext: extOut, nombre: p.a.rel.split('/').pop()!.slice(0, 200), ruta: salida, apariciones: [p.ap] })
          anotar(`medio_${p.clase}`, p.a.rel)
        } else anotar('medio_roto', p.a.rel)
        if (++hechos % 50 === 0) log(`  ${hechos}/${pendientes.length}`)
      }
    }
    await Promise.all(Array.from({ length: o.paralelo ?? 4 }, trabajar))
    for (const m of medios.values()) w({ t: 'medio', huella: m.huella, clase: m.clase, ext: m.ext, nombre: m.nombre, apariciones: m.apariciones })
    w({ t: 'fin' })
  } finally {
    fs.closeSync(fd)
    for (const z of zips) z.cerrar()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  fs.renameSync(`${paquete}.parcial`, paquete)
  fs.writeFileSync(path.join(dir, 'medios.json'), JSON.stringify([...medios.values()].map((m) => ({ ...m, apariciones: [] }))))
  // Qué pasó con cada archivo (para revisar antes de subir): entró, repetido, excluido, sin texto…
  fs.writeFileSync(path.join(dir, 'inventario.tsv'), `que\truta\n${inventario.join('\n')}\n`)
  log(`Listo: paquete de ${Math.round(fs.statSync(paquete).size / 1048576)} MB y ${medios.size} medios (${Math.round([...medios.values()].reduce((s, m) => s + fs.statSync(m.ruta).size, 0) / 1048576)} MB)`)
  log(Object.entries(resumen).sort().map(([k, v]) => `${k} ${v}`).join(' · '))
  return { lote, dir, paquete, medios: [...medios.values()], resumen }
}
