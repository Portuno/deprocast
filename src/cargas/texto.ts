/**
 * Texto suelto (.txt, .md, .html…): una pieza por archivo. Si es Markdown con secciones `#`/`##`,
 * se puede partir por sección para que cada una sea citable por separado.
 */
import type { Analisis, Datos, Importador } from './tipos.ts'

function secciones(md: string): { titulo: string; cuerpo: string }[] {
  const partes: { titulo: string; cuerpo: string }[] = []
  let actual: { titulo: string; cuerpo: string } | null = null
  for (const linea of md.split('\n')) {
    const h = linea.match(/^#{1,2}\s+(.+)/)
    if (h) {
      if (actual?.cuerpo.trim()) partes.push(actual)
      actual = { titulo: h[1].trim(), cuerpo: '' }
    } else if (actual) actual.cuerpo += linea + '\n'
  }
  if (actual?.cuerpo.trim()) partes.push(actual)
  return partes
}

const titulo = (nombre: string) => nombre.replace(/\.[^.]+$/, '')

function limpiar(d: Datos): string {
  return /\.html?$/i.test(d.nombre)
    ? d.texto.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim()
    : d.texto
}

export const texto: Importador = {
  id: 'texto',
  nombre: 'Texto',
  detectar: (d) => /\.(txt|md|markdown|html?|json)$/i.test(d.nombre) || !d.nombre.includes('.'),
  analizar(d: Datos): Analisis {
    const t = limpiar(d)
    const secs = /\.(md|markdown)$/i.test(d.nombre) ? secciones(t) : []
    return {
      importador: 'texto',
      titulo: titulo(d.nombre),
      descripcion: `${t.length.toLocaleString('es-AR')} caracteres`,
      segmentos: [
        { id: 'entero', nombre: 'Documento entero', descripcion: 'Una sola pieza con todo el texto.', nivel: 'propia', destino: 'corpus', cantidad: 1, porDefecto: secs.length < 2 },
        ...(secs.length >= 2
          ? [{ id: 'secciones', nombre: 'Por sección', descripcion: 'Una pieza por cada título # o ##: cada sección se cita por separado.', nivel: 'propia' as const, destino: 'corpus' as const, cantidad: secs.length, porDefecto: true }]
          : []),
      ],
      fuente: { id: 'operador', nombre: 'Operador', nivel: 'propia', padreId: null },
      nivelEditable: true,
      avisos: [],
    }
  },
  ejecutar(d, ctx) {
    const t = limpiar(d)
    if (ctx.quiere('entero')) ctx.pieza('entero', { nivel: ctx.opciones.nivel, titulo: titulo(d.nombre), contenido: t })
    if (ctx.quiere('secciones')) {
      for (const s of secciones(t)) ctx.pieza('secciones', { nivel: ctx.opciones.nivel, titulo: `${titulo(d.nombre)} · ${s.titulo}`, contenido: s.cuerpo.trim() })
    }
  },
}
