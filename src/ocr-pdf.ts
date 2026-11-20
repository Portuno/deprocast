/**
 * OCR de PDFs escaneados o escritos a mano (Fragua #326). El lector de PDF saca el texto que el archivo trae escrito;
 * un escaneo, una fotocopia o un cuaderno no traen nada (o casi), y antes solo se avisaba «pasalo a imágenes».
 * - Al cargar: si el texto no alcanza para las páginas que tiene, la pieza entra igual (con lo que haya) y queda con
 *   el OCR pendiente.
 * - De fondo: Gemini lee el PDF entero, página por página (impreso, a mano o mezclado), y marca lo que no se entiende
 *   y las páginas ilegibles. La pieza se reescribe con ese texto (la versión anterior queda) y lo ilegible queda
 *   anotado por página, para saber qué falta.
 * - Si no hay con qué (sin GEMINI_API_KEY) o falla tres veces, se dice en la pieza y en la carga, por página.
 */
import fs from 'node:fs'
import { ajuste, json, type Db } from './db.ts'

export type PaginaOcr = { n: number; texto: string; tipo: 'impreso' | 'manuscrito' | 'mixto' | 'vacía'; legible: 'sí' | 'parcial' | 'no' }

/** Las páginas de un PDF (por sus objetos /Type /Page). */
export function paginasDePdf(bin: Buffer): number {
  return Math.max(1, (bin.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length)
}

/** ¿El texto que trae alcanza? Menos de 40 caracteres por página es un escaneo (o casi): un PDF de texto corto, no. */
export const textoInsuficiente = (texto: string, paginas: number) => texto.replace(/\s+/g, ' ').trim().length < 40 * Math.max(1, paginas)

/** Lo más que se le manda a Gemini de una (sus datos en línea). */
const MAX_BYTES = 19 * 1024 * 1024

let leerConModelo = async (db: Db, pdf: Buffer, nombre: string): Promise<PaginaOcr[]> => {
  const clave = process.env.GEMINI_API_KEY?.trim()
  if (!clave) throw new Error('No hay con qué leerlo: falta GEMINI_API_KEY')
  if (pdf.length > MAX_BYTES) throw new Error(`«${nombre}» pesa ${(pdf.length / 1024 / 1024).toFixed(1)} MB: el OCR lee hasta 19 MB (partilo en dos)`)
  const modelo = process.env.GEMINI_MODELO?.trim() || ajuste(db, 'youtube_gemini_modelo') || 'gemini-2.5-flash'
  const pedido = `Transcribí este PDF página por página, literal: lo impreso, lo escrito a máquina y lo escrito a mano. Sin resumir ni corregir. Lo que no se entiende, [ilegible]. Respetá párrafos y listas.
Devolvé SOLO JSON: {"paginas": [{"n": número de página, "texto": string, "tipo": "impreso" | "manuscrito" | "mixto" | "vacía", "legible": "sí" | "parcial" | "no"}]}. Una entrada por página, todas, en orden.`
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': clave }, signal: AbortSignal.timeout(600_000),
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: pdf.toString('base64') } }, { text: pedido }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
  })
  const j = await r.json().catch(() => null) as any
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${String(j?.error?.message ?? '').slice(0, 160)}`)
  const t = String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '')
  const datos = json<{ paginas?: any[] }>(t.replace(/^```(?:json)?\s*|\s*```$/g, ''), {}) ?? {}
  return normalizar(datos.paginas)
}
export function _probarOcr(f: typeof leerConModelo) { leerConModelo = f }

function normalizar(xs: unknown): PaginaOcr[] {
  return (Array.isArray(xs) ? xs : []).map((p: any, i): PaginaOcr => ({
    n: Number(p?.n) || i + 1,
    texto: String(p?.texto ?? '').trim(),
    tipo: ['impreso', 'manuscrito', 'mixto', 'vacía'].includes(p?.tipo) ? p.tipo : 'impreso',
    legible: p?.legible === 'no' ? 'no' : p?.legible === 'parcial' ? 'parcial' : 'sí',
  })).sort((a, b) => a.n - b.n)
}

/** El texto de la pieza: cada página con su encabezado (y de qué tipo es si no es impresa), lo ilegible marcado. */
export function textoDePaginas(paginas: PaginaOcr[]): string {
  return paginas.map((p) => {
    const marcas = [p.tipo !== 'impreso' ? p.tipo : '', p.legible === 'parcial' ? 'se lee en parte' : p.legible === 'no' ? 'ilegible' : ''].filter(Boolean)
    return `## Página ${p.n}${marcas.length ? ` (${marcas.join(', ')})` : ''}\n\n${p.texto || (p.legible === 'no' ? '[ilegible]' : '[vacía]')}`
  }).join('\n\n')
}

let enCurso = false

/**
 * Lee con OCR las piezas que quedaron pendientes (de a dos por pasada). Devuelve cuántas resolvió. Si una falla, se
 * reintenta en la pasada siguiente; a la tercera queda dicho en la pieza, con el motivo.
 */
export async function ocrPendientes(db: Db, ahora = Date.now()): Promise<number> {
  if (enCurso) return 0
  enCurso = true
  let hechas = 0
  try {
    const xs = db.prepare(`SELECT c.id, c.titulo, c.contenido, c.meta, k.ruta, k.archivo FROM corpus c JOIN cargas k ON k.id = c.carga_id WHERE json_extract(c.meta, '$.ocr') = 'pendiente' ORDER BY c.id LIMIT 2`).all() as { id: number; titulo: string; contenido: string; meta: string | null; ruta: string; archivo: string }[]
    const { corregirPieza } = await import('./corpus.ts')
    const meta = (id: number, cambios: Record<string, unknown>) => db.prepare(`UPDATE corpus SET meta = json_patch(COALESCE(meta, '{}'), ?) WHERE id = ?`).run(JSON.stringify(cambios), id)
    for (const x of xs) {
      const m = json<Record<string, any>>(x.meta, {}) ?? {}
      try {
        if (!x.ruta || !fs.existsSync(x.ruta)) throw new Error('el archivo de la carga ya no está: subilo de nuevo')
        const paginas = await leerConModelo(db, fs.readFileSync(x.ruta), x.archivo)
        if (!paginas.length) throw new Error('no devolvió ninguna página')
        const ilegibles = paginas.filter((p) => p.legible === 'no').map((p) => p.n)
        const parciales = paginas.filter((p) => p.legible === 'parcial').map((p) => p.n)
        const aviso = ilegibles.length || parciales.length ? `> Leído con OCR. ${ilegibles.length ? `Ilegible: página${ilegibles.length === 1 ? '' : 's'} ${ilegibles.join(', ')}. ` : ''}${parciales.length ? `Se lee en parte: ${parciales.join(', ')}.` : ''}\n\n` : '> Leído con OCR.\n\n'
        corregirPieza(db, x.id, aviso + textoDePaginas(paginas), 'OCR por página', 'ocr', ahora)
        meta(x.id, { ocr: 'hecho', ocrPaginas: paginas.length, ocrIlegibles: ilegibles, ocrParciales: parciales, ocrTipos: [...new Set(paginas.map((p) => p.tipo))] })
        hechas++
      } catch (e) {
        const motivo = (e instanceof Error ? e.message : String(e)).slice(0, 300)
        const intentos = Number(m.ocrIntentos ?? 0) + 1
        // Sin motor no hay reintento que valga: se dice ya. Lo demás, a la tercera.
        const final = intentos >= 3 || /GEMINI_API_KEY|ya no está|pesa .* MB/.test(motivo)
        meta(x.id, { ocrIntentos: intentos, ocrError: motivo, ...(final ? { ocr: 'fallo' } : {}) })
        if (final) corregirPieza(db, x.id, `> ⚠ No se pudo leer con OCR: ${motivo}\n\n${x.contenido}`, 'OCR fallido', 'ocr', ahora)
      }
    }
  } finally {
    enCurso = false
  }
  return hechas
}
