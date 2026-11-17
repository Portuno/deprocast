/**
 * Presentaciones (.pptx) desde el Taller (Fragua #310). Un guion por slides (título, puntos y la nota del expositor) más
 * imágenes (del Taller, un adjunto suyo, o una que se pinta con un pedido) y sale un PowerPoint de verdad: editable en
 * PowerPoint, Keynote y Google Slides, con las notas del orador en su campo y una paleta sobria.
 * - La portada: título, subtítulo, autor y fecha.
 * - Cada slide: título arriba; los puntos a la izquierda y la imagen a la derecha (sin imagen, el texto ocupa todo);
 *   el texto se achica solo si no entra; número de slide abajo.
 * - Una slide de sección («tipo: seccion») es un separador con el título grande.
 * Usa pptxgenjs empaquetado en vendor/ (la nube no instala dependencias nuevas).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db.ts'

export type SlideGuion = { titulo: string; puntos?: string[] | string | null; notas?: string | null; tipo?: 'contenido' | 'seccion' | 'cita' | null; imagen?: { artefacto?: number | null; adjunto?: string | null; prompt?: string | null } | null }
export type Pedido = { titulo: string; subtitulo?: string | null; autor?: string | null; slides: SlideGuion[]; paleta?: string | null; generarImagenes?: boolean }

/** Tres paletas sobrias (hex sin #): fondo, texto, acento, suave (los fondos de sección). */
export const PALETAS: Record<string, { fondo: string; texto: string; acento: string; suave: string; tenue: string }> = {
  sobria: { fondo: 'FFFFFF', texto: '1F2933', acento: '2F5D8C', suave: 'E8EEF4', tenue: '6B7785' },
  oscura: { fondo: '15181D', texto: 'EEF1F4', acento: 'D4A64A', suave: '232831', tenue: '9AA3AD' },
  tierra: { fondo: 'FBF7F0', texto: '3B2F2A', acento: 'A2552A', suave: 'EFE5D6', tenue: '7D6F66' },
}
const FUENTE = 'Arial'
const MAX_SLIDES = 60

/** Para las pruebas: pintar una imagen nueva con un pedido. */
let pintar = async (db: Db, prompt: string): Promise<Buffer | null> => {
  const t = await import('./taller.ts')
  const a = await t.crearImagen(db, prompt, { aspecto: '16:9', estilo: null })
  return a.estado === 'listo' && a.archivos[0] ? fs.readFileSync(path.join(t.carpeta(a.id), a.archivos[0])) : null
}
export function _probarPresentacion(f: typeof pintar) { pintar = f }

/** Los puntos de una slide: una lista, o un texto (el modelo a veces los manda juntos) cortado por renglón o «;». */
const listaDe = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|;\s*/) : []).map((x) => String(x ?? '').replace(/^\s*[-•·*]\s*/, '').trim()).filter(Boolean)

const mimeDe = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'image/jpeg')

/** Los bytes de la imagen de una slide: del Taller, de un adjunto (o de su Drive), o pintada con el pedido. */
async function imagenDe(db: Db, i: NonNullable<SlideGuion['imagen']>, generar: boolean): Promise<Buffer | null> {
  if (i.artefacto) {
    const t = await import('./taller.ts')
    const a = t.leerArtefacto(db, Number(i.artefacto))
    const archivo = a?.archivos.find((x) => /\.(png|jpe?g|webp)$/i.test(x))
    if (a && archivo) return fs.readFileSync(path.join(t.carpeta(a.id), archivo))
    return null
  }
  if (i.adjunto) {
    const { dirAdjuntos } = await import('./chat/adjuntos.ts')
    const local = path.join(dirAdjuntos(), path.basename(i.adjunto))
    if (fs.existsSync(local)) return fs.readFileSync(local)
    return (await import('./google/drive.ts')).medioDeAdjunto(db, i.adjunto).catch(() => null)
  }
  if (i.prompt && generar) return pintar(db, i.prompt).catch(() => null)
  return null
}

/** Arma el .pptx. Devuelve los bytes, cuántas slides e imágenes entraron, y lo que no se pudo (por qué). */
export async function armarPresentacion(db: Db, p: Pedido, ahora = Date.now()): Promise<{ datos: Buffer; slides: number; imagenes: number; avisos: string[] }> {
  const slides = (Array.isArray(p.slides) ? p.slides : []).filter((s) => s && String(s.titulo ?? '').trim()).slice(0, MAX_SLIDES)
  if (!String(p.titulo ?? '').trim()) throw new Error('Falta el título de la presentación')
  if (!slides.length) throw new Error('Falta el guion: al menos una slide con su título')
  const c = PALETAS[String(p.paleta ?? 'sobria')] ?? PALETAS.sobria
  const avisos: string[] = []
  const { default: Pptx } = await import('../vendor/pptxgenjs-4.0.1.mjs')
  const pres = new Pptx()
  pres.layout = 'LAYOUT_WIDE' // 13,33 × 7,5 pulgadas (16:9)
  pres.title = p.titulo
  if (p.autor) pres.author = p.autor
  pres.company = 'Deprocast'

  // La portada.
  const portada = pres.addSlide()
  portada.background = { color: c.fondo }
  portada.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: c.acento }, line: { color: c.acento } })
  portada.addText(p.titulo, { x: 0.9, y: 2.2, w: 11.5, h: 1.6, fontFace: FUENTE, fontSize: 44, bold: true, color: c.texto, fit: 'shrink', valign: 'bottom' })
  if (p.subtitulo) portada.addText(p.subtitulo, { x: 0.9, y: 3.9, w: 11.5, h: 1, fontFace: FUENTE, fontSize: 22, color: c.acento, fit: 'shrink', valign: 'top' })
  const fecha = new Date(ahora).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  portada.addText([p.autor, fecha].filter(Boolean).join(' · '), { x: 0.9, y: 6.4, w: 11.5, h: 0.5, fontFace: FUENTE, fontSize: 14, color: c.tenue })

  // Las imágenes primero, de a 3 a la vez (pintar una tarda unos segundos).
  const imgs: (Buffer | null)[] = slides.map(() => null)
  const conImagen = [...slides.entries()].filter(([, s]) => s.tipo !== 'seccion' && s.imagen)
  for (let j = 0; j < conImagen.length; j += 3) {
    await Promise.all(conImagen.slice(j, j + 3).map(async ([k, s]) => {
      imgs[k] = await imagenDe(db, s.imagen!, !!p.generarImagenes)
      if (!imgs[k]) avisos.push(`Slide ${k + 1}: ${s.imagen!.prompt && !p.generarImagenes ? 'tenía un pedido de imagen pero no se pidió pintarlas' : 'no encontré la imagen'}`)
    }))
  }
  avisos.sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))

  let imagenes = 0
  for (const [k, s] of slides.entries()) {
    const sl = pres.addSlide()
    sl.background = { color: s.tipo === 'seccion' ? c.suave : c.fondo }
    const notas = s.notas == null ? '' : String(s.notas).trim()
    if (notas) sl.addNotes(notas)
    const puntos = listaDe(s.puntos)
    sl.slideNumber = { x: 12.3, y: 6.95, w: 0.7, h: 0.35, fontFace: FUENTE, fontSize: 10, color: c.tenue }
    if (s.tipo === 'seccion') {
      sl.addShape(pres.ShapeType.rect, { x: 0.9, y: 3.55, w: 1.2, h: 0.08, fill: { color: c.acento }, line: { color: c.acento } })
      sl.addText(s.titulo, { x: 0.9, y: 2.0, w: 11.5, h: 1.5, fontFace: FUENTE, fontSize: 40, bold: true, color: c.texto, fit: 'shrink', valign: 'bottom' })
      if (puntos.length) sl.addText(puntos.join(' · '), { x: 0.9, y: 3.8, w: 11.5, h: 1, fontFace: FUENTE, fontSize: 20, color: c.tenue, fit: 'shrink', valign: 'top' })
      continue
    }
    const img = imgs[k]
    const anchoTexto = img ? 6.2 : 11.7
    sl.addText(s.titulo, { x: 0.8, y: 0.45, w: 11.7, h: 0.95, fontFace: FUENTE, fontSize: 30, bold: true, color: c.texto, fit: 'shrink', valign: 'middle' })
    sl.addShape(pres.ShapeType.rect, { x: 0.8, y: 1.42, w: 0.9, h: 0.06, fill: { color: c.acento }, line: { color: c.acento } })
    if (s.tipo === 'cita' && puntos.length) {
      sl.addText(`«${puntos.join(' ')}»`, { x: 0.8, y: 1.9, w: anchoTexto, h: 4.6, fontFace: FUENTE, fontSize: 28, italic: true, color: c.acento, fit: 'shrink', valign: 'middle' })
    } else if (puntos.length) {
      sl.addText(puntos.map((t) => ({ text: t, options: { bullet: { code: '25AA', indent: 18 }, paraSpaceAfter: 10 } })), { x: 0.8, y: 1.8, w: anchoTexto, h: 5, fontFace: FUENTE, fontSize: 20, color: c.texto, fit: 'shrink', valign: 'top' })
    }
    if (img) {
      sl.addImage({ data: `${mimeDe(img)};base64,${img.toString('base64')}`, x: 7.3, y: 1.8, w: 5.4, h: 4.9, sizing: { type: 'contain', w: 5.4, h: 4.9 } })
      imagenes++
    }
  }
  const datos = Buffer.from(await pres.write({ outputType: 'nodebuffer' }) as Uint8Array)
  return { datos, slides: slides.length + 1, imagenes, avisos }
}
