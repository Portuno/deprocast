/**
 * Un PDF simple desde Markdown, sin dependencias (Fragua #204): las fuentes estándar del PDF (Helvetica, en negrita y
 * cursiva), codificación WinAnsi (tildes, ñ, ¿¡, comillas, guiones, €, •) y un maquetado sobrio: título, secciones,
 * párrafos, listas con viñeta o numeradas, citas, y al pie la fecha y el número de página. A4.
 * Entiende: «# título», «## sección», «### subsección», «- ítem» / «* ítem», «1. ítem», «> cita», «---» (separador),
 * y párrafos separados por una línea en blanco. Las marcas de **negrita** y _cursiva_ dentro del texto se quitan.
 */

const A4 = { ancho: 595.28, alto: 841.89 }
const MARGEN = 56
const ANCHO_UTIL = A4.ancho - 2 * MARGEN

// Anchos de Helvetica (de su AFM, en milésimas de em) para ASCII 32–126; lo demás se mide como su letra base.
const ANCHOS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const base = (c: string) => c.normalize('NFD').replace(/[̀-ͯ]/g, '')
function anchoCaracter(c: string, negrita: boolean): number {
  const b = base(c)[0] ?? c
  const k = b.charCodeAt(0)
  const w = k >= 32 && k <= 126 ? ANCHOS[k - 32] : c === '•' ? 350 : c === '—' ? 1000 : c === '–' ? 556 : c === '€' ? 556 : c === '…' ? 1000 : 556
  return negrita ? w * 1.06 : w
}
const anchoTexto = (t: string, tam: number, negrita = false) => [...t].reduce((s, c) => s + anchoCaracter(c, negrita), 0) * tam / 1000

/** El texto en WinAnsi (lo que no entra se reemplaza por algo parecido), escapado para un string del PDF. */
const ESPECIALES: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 }
function aWinAnsi(t: string): string {
  let out = ''
  for (const c of t) {
    let k = ESPECIALES[c] ?? c.charCodeAt(0)
    if (k > 255 || (k > 126 && k < 160 && !(c in ESPECIALES))) { const b = base(c); k = b && b.charCodeAt(0) < 256 ? b.charCodeAt(0) : 63 }
    const ch = String.fromCharCode(k)
    out += ch === '(' || ch === ')' || ch === '\\' ? `\\${ch}` : k < 32 ? ' ' : k > 126 ? `\\${k.toString(8).padStart(3, '0')}` : ch
  }
  return out
}

/** Corta un texto en líneas que entran en el ancho. */
function cortar(texto: string, tam: number, ancho: number, negrita = false): string[] {
  const lineas: string[] = []
  let actual = ''
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (anchoTexto(prueba, tam, negrita) <= ancho) { actual = prueba; continue }
    if (actual) lineas.push(actual)
    // Una palabra más larga que la línea se parte.
    let p = palabra
    while (anchoTexto(p, tam, negrita) > ancho) {
      let n = p.length
      while (n > 1 && anchoTexto(p.slice(0, n), tam, negrita) > ancho) n--
      lineas.push(p.slice(0, n))
      p = p.slice(n)
    }
    actual = p
  }
  if (actual) lineas.push(actual)
  return lineas
}

type Bloque = { tipo: 'titulo' | 'h2' | 'h3' | 'parrafo' | 'item' | 'cita' | 'separador'; texto: string; marca?: string }
const limpiarInline = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)').replace(/\[#\d+\]/g, '').trim()

/** Markdown (el subconjunto de arriba) → bloques. */
export function bloquesDe(md: string): Bloque[] {
  const out: Bloque[] = []
  let parrafo: string[] = []
  const cerrar = () => { if (parrafo.length) out.push({ tipo: 'parrafo', texto: limpiarInline(parrafo.join(' ')) }); parrafo = [] }
  for (const linea of md.replace(/\r/g, '').split('\n')) {
    const l = linea.trim()
    let m: RegExpExecArray | null
    if (!l) { cerrar(); continue }
    if ((m = /^#\s+(.*)$/.exec(l))) { cerrar(); out.push({ tipo: 'titulo', texto: limpiarInline(m[1]) }) }
    else if ((m = /^##\s+(.*)$/.exec(l))) { cerrar(); out.push({ tipo: 'h2', texto: limpiarInline(m[1]) }) }
    else if ((m = /^#{3,6}\s+(.*)$/.exec(l))) { cerrar(); out.push({ tipo: 'h3', texto: limpiarInline(m[1]) }) }
    else if ((m = /^[-*•]\s+(.*)$/.exec(l))) { cerrar(); out.push({ tipo: 'item', texto: limpiarInline(m[1]), marca: '•' }) }
    else if ((m = /^(\d+)[.)]\s+(.*)$/.exec(l))) { cerrar(); out.push({ tipo: 'item', texto: limpiarInline(m[2]), marca: `${m[1]}.` }) }
    else if ((m = /^>\s?(.*)$/.exec(l))) { cerrar(); out.push({ tipo: 'cita', texto: limpiarInline(m[1]) }) }
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) { cerrar(); out.push({ tipo: 'separador', texto: '' }) }
    else parrafo.push(l)
  }
  cerrar()
  return out
}

/** El PDF entero (Buffer). `titulo` va arriba si el Markdown no empieza con «# …»; `pie` va abajo con el número de página. */
export function pdfDesdeMarkdown(md: string, o: { titulo?: string; pie?: string; autor?: string } = {}): Buffer {
  const bloques = bloquesDe(md)
  if (o.titulo && bloques[0]?.tipo !== 'titulo') bloques.unshift({ tipo: 'titulo', texto: o.titulo })
  const paginas: string[][] = [[]]
  let y = A4.alto - MARGEN
  const pagina = () => paginas[paginas.length - 1]
  const nueva = () => { paginas.push([]); y = A4.alto - MARGEN }
  const linea = (t: string, x: number, tam: number, fuente: 'F1' | 'F2' | 'F3', alto: number) => {
    if (y - alto < MARGEN + 24) nueva()
    y -= alto
    pagina().push(`BT /${fuente} ${tam} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${aWinAnsi(t)}) Tj ET`)
  }
  for (const b of bloques) {
    if (b.tipo === 'titulo') { for (const l of cortar(b.texto, 20, ANCHO_UTIL, true)) linea(l, MARGEN, 20, 'F2', 26); y -= 10 }
    else if (b.tipo === 'h2') { y -= 8; for (const l of cortar(b.texto, 14, ANCHO_UTIL, true)) linea(l, MARGEN, 14, 'F2', 19); y -= 2 }
    else if (b.tipo === 'h3') { y -= 4; for (const l of cortar(b.texto, 12, ANCHO_UTIL, true)) linea(l, MARGEN, 12, 'F2', 16) }
    else if (b.tipo === 'parrafo') { for (const l of cortar(b.texto, 11, ANCHO_UTIL)) linea(l, MARGEN, 11, 'F1', 15); y -= 6 }
    else if (b.tipo === 'cita') { for (const l of cortar(b.texto, 11, ANCHO_UTIL - 18)) linea(l, MARGEN + 18, 11, 'F3', 15); y -= 6 }
    else if (b.tipo === 'item') {
      const sangria = 16
      const ls = cortar(b.texto, 11, ANCHO_UTIL - sangria)
      ls.forEach((l, i) => {
        if (i === 0) { if (y - 15 < MARGEN + 24) nueva(); pagina().push(`BT /F1 11 Tf ${MARGEN.toFixed(2)} ${(y - 15).toFixed(2)} Td (${aWinAnsi(b.marca ?? '•')}) Tj ET`) }
        linea(l, MARGEN + sangria, 11, 'F1', 15)
      })
      y -= 3
    } else if (b.tipo === 'separador') {
      if (y - 18 < MARGEN + 24) nueva()
      y -= 10
      pagina().push(`0.7 G 0.5 w ${MARGEN} ${y.toFixed(2)} m ${A4.ancho - MARGEN} ${y.toFixed(2)} l S 0 G`)
      y -= 8
    }
  }
  // El pie: la fecha (o lo que pidió) y «n de N».
  const total = paginas.length
  const pie = o.pie ?? ''
  paginas.forEach((p, i) => {
    const num = `${i + 1} de ${total}`
    if (pie) p.push(`BT /F1 9 Tf ${MARGEN} ${MARGEN - 20} Td 0.4 g (${aWinAnsi(pie)}) Tj ET`)
    p.push(`BT /F1 9 Tf ${(A4.ancho - MARGEN - anchoTexto(num, 9)).toFixed(2)} ${MARGEN - 20} Td 0.4 g (${aWinAnsi(num)}) Tj ET`)
  })
  // Los objetos: 1 catálogo, 2 páginas, 3–5 fuentes, después cada página con su contenido.
  const objetos: string[] = []
  const fuente = (nombre: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${nombre} /Encoding /WinAnsiEncoding >>`
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objetos[3] = fuente('Helvetica')
  objetos[4] = fuente('Helvetica-Bold')
  objetos[5] = fuente('Helvetica-Oblique')
  const kids: number[] = []
  paginas.forEach((p, i) => {
    const pag = 6 + i * 2
    const cont = pag + 1
    kids.push(pag)
    const flujo = p.join('\n')
    objetos[pag] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.ancho} ${A4.alto}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${cont} 0 R >>`
    objetos[cont] = `<< /Length ${Buffer.byteLength(flujo, 'latin1')} >>\nstream\n${flujo}\nendstream`
  })
  objetos[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const info = objetos.length
  objetos[info] = `<< /Producer (Deprocast) /Title (${aWinAnsi(o.titulo ?? bloques.find((b) => b.tipo === 'titulo')?.texto ?? 'Documento')})${o.autor ? ` /Author (${aWinAnsi(o.autor)})` : ''} >>`
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  for (let i = 1; i < objetos.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1')
    pdf += `${i} 0 obj\n${objetos[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
