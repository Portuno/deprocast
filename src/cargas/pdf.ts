/**
 * PDF como carga, sin dependencia nueva. Saca el texto de los operadores Tj/TJ, e infla los streams
 * FlateDecode con zlib. Un escaneo (o lo escrito a mano) casi no trae texto: la pieza entra igual y se lee con OCR por
 * página, de fondo (Fragua #326, src/ocr-pdf.ts), con lo ilegible marcado por página.
 */
import zlib from 'node:zlib'
import { paginasDePdf, textoInsuficiente } from '../ocr-pdf.ts'
import type { Analisis, Datos, Importador } from './tipos.ts'

function desescapar(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) => {
    if (e === 'n') return '\n'
    if (e === 'r') return '\r'
    if (e === 't') return '\t'
    if (e === 'b') return '\b'
    if (e === 'f') return '\f'
    if (e === '(' || e === ')' || e === '\\') return e
    return String.fromCharCode(Number.parseInt(e, 8))
  })
}

function operadores(s: string): string {
  const out: string[] = []
  for (const m of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(desescapar(m[1]))
  for (const bloque of s.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    for (const lit of bloque[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) out.push(desescapar(lit[1]))
  }
  return out.join('')
}

/** El texto que el PDF trae escrito. Vacío si es un escaneo o un formato que no sabemos leer. */
export function textoDePdf(bin: Buffer): string {
  const latin = bin.toString('latin1')
  const partes: string[] = []
  const re = /stream\r?\n([\s\S]*?)endstream/g
  let m: RegExpExecArray | null
  while ((m = re.exec(latin))) {
    const antes = latin.slice(Math.max(0, m.index - 300), m.index)
    let datos = Buffer.from(m[1], 'latin1')
    if (/FlateDecode/.test(antes)) {
      const inflar = (b: Buffer) => {
        try { return zlib.inflateSync(b) } catch { return zlib.inflateRawSync(b) }
      }
      try { datos = inflar(datos) } catch {
        try { datos = inflar(datos.subarray(0, Math.max(0, datos.length - 1))) } catch { continue }
      }
    }
    partes.push(operadores(datos.toString('latin1')))
  }
  return partes.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const titulo = (nombre: string) => nombre.replace(/\.pdf$/i, '')

export const pdf: Importador = {
  id: 'pdf',
  nombre: 'PDF',
  detectar: (d) => (!!d.bin && d.bin.subarray(0, 5).toString('latin1') === '%PDF-') || /\.pdf$/i.test(d.nombre),
  analizar(d: Datos): Analisis {
    const texto = d.bin ? textoDePdf(d.bin) : ''
    const paginas = d.bin ? paginasDePdf(d.bin) : 1
    const ocr = textoInsuficiente(texto, paginas)
    return {
      importador: 'pdf',
      titulo: titulo(d.nombre),
      descripcion: `${paginas} página${paginas === 1 ? '' : 's'}; ${texto ? `${texto.length.toLocaleString('es-AR')} caracteres de texto` : 'sin texto extraíble'}.`,
      segmentos: ocr
        ? [{ id: 'ocr', nombre: 'Leer con OCR', descripcion: 'Casi no trae texto (escaneo, fotocopia o escrito a mano): se lee con OCR página por página, de fondo, y lo ilegible queda marcado por página.', nivel: 'primaria', destino: 'corpus', cantidad: 1, porDefecto: true }]
        : [{ id: 'documento', nombre: 'Documento', descripcion: 'Una pieza con el texto del PDF.', nivel: 'primaria', destino: 'corpus', cantidad: 1, porDefecto: true }],
      fuente: { id: 'pdf', nombre: 'PDF', nivel: 'primaria', padreId: null },
      nivelEditable: true,
      avisos: ocr ? [`Este PDF casi no trae texto (${texto.trim().length} caracteres en ${paginas} página${paginas === 1 ? '' : 's'}): puede ser un escaneo o estar escrito a mano. Al cargarlo se lee con OCR por página (unos minutos).`] : [],
    }
  },
  ejecutar(d, ctx) {
    const texto = d.bin ? textoDePdf(d.bin) : ''
    const paginas = d.bin ? paginasDePdf(d.bin) : 1
    if (textoInsuficiente(texto, paginas)) {
      // Entra ya (con lo poco que traiga) y el OCR la completa de fondo.
      if (ctx.quiere('ocr')) ctx.pieza('ocr', { nivel: ctx.opciones.nivel, titulo: titulo(d.nombre), contenido: texto.trim() || '(Leyendo con OCR, página por página: el texto llega en unos minutos.)', meta: { ocr: 'pendiente', ocrPaginas: paginas } })
      return
    }
    if (!ctx.quiere('documento')) return
    ctx.pieza('documento', { nivel: ctx.opciones.nivel, titulo: titulo(d.nombre), contenido: texto })
  },
}
