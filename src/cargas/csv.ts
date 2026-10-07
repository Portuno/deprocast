/**
 * CSV genérico. Reconoce columnas comunes (nombre/título, autor, fecha, descripción, url, clasificación…)
 * y deja todas las demás en meta. Cada fila es una pieza; si parece un repertorio de obras, es una referencia.
 */
import type { Analisis, Datos, Importador } from './tipos.ts'

export function parsearCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '')
  const sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) > (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let comillas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"') {
        if (t[i + 1] === '"') (campo += '"'), i++
        else comillas = false
      } else campo += c
    } else if (c === '"') comillas = true
    else if (c === sep) fila.push(campo), (campo = '')
    else if (c === '\n') {
      fila.push(campo.replace(/\r$/, ''))
      if (fila.some((x) => x.trim())) filas.push(fila)
      fila = []
      campo = ''
    } else campo += c
  }
  if (campo || fila.length) {
    fila.push(campo.replace(/\r$/, ''))
    if (fila.some((x) => x.trim())) filas.push(fila)
  }
  return filas
}

const ALIAS: Record<string, string[]> = {
  titulo: ['titulo', 'título', 'title', 'nombre', 'name'],
  autor: ['autor', 'author', 'autores', 'authors', 'creador'],
  fecha: ['fecha', 'date', 'año', 'ano', 'year'],
  contenido: ['descripcion', 'descripción', 'description', 'contenido', 'content', 'texto', 'text', 'resumen', 'summary', 'notas', 'notes'],
  url: ['url', 'link', 'enlace', 'href'],
  id: ['id', 'codigo', 'código'],
}
const ETIQUETAS = ['clasificacion', 'clasificación', 'categoria', 'categoría', 'category', 'subtag', 'tag', 'tags', 'tipo', 'prioridad', 'priority']
const REFERENCIA = ['autor', 'author', 'clasificacion', 'clasificación', 'prioridad']

type Columnas = { mapa: Partial<Record<keyof typeof ALIAS, number>>; etiquetas: number[]; esReferencia: boolean }

function columnas(cab: string[]): Columnas {
  const norm = cab.map((c) => c.trim().toLowerCase())
  const mapa: Columnas['mapa'] = {}
  for (const [k, alias] of Object.entries(ALIAS) as [keyof typeof ALIAS, string[]][]) {
    const i = norm.findIndex((c) => alias.includes(c))
    if (i >= 0) mapa[k] = i
  }
  return {
    mapa,
    etiquetas: norm.map((c, i) => (ETIQUETAS.includes(c) ? i : -1)).filter((i) => i >= 0),
    esReferencia: norm.some((c) => REFERENCIA.includes(c)),
  }
}

function base(nombre: string): string {
  return nombre.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
}

export const csv: Importador = {
  id: 'csv',
  nombre: 'Planilla CSV',
  detectar: (d) => /\.(csv|tsv)$/i.test(d.nombre),
  analizar(d: Datos): Analisis {
    const [cab = [], ...filas] = parsearCsv(d.texto)
    const c = columnas(cab)
    const avisos: string[] = []
    if (c.mapa.titulo == null) avisos.push('No encontré una columna de título: se usa la primera.')
    return {
      importador: 'csv',
      titulo: base(d.nombre),
      descripcion: `${filas.length} filas · columnas: ${cab.join(', ')}`,
      segmentos: [{
        id: 'filas',
        nombre: c.esReferencia ? 'Referencias (obras, papers, repos)' : 'Filas',
        descripcion: c.esReferencia
          ? 'Cada fila apunta a una obra externa. Entran como referencia: el repertorio de lo que hay que ir a buscar.'
          : 'Cada fila es una pieza; las columnas sin mapa quedan como metadatos.',
        nivel: 'investigacion',
        destino: 'corpus',
        cantidad: filas.length,
        porDefecto: true,
      }],
      fuente: { id: '', nombre: base(d.nombre), nivel: 'investigacion', padreId: null },
      nivelEditable: true,
      avisos,
    }
  },
  ejecutar(d, ctx) {
    const [cab = [], ...filas] = parsearCsv(d.texto)
    const c = columnas(cab)
    const val = (f: string[], k: keyof typeof ALIAS) => (c.mapa[k] != null ? (f[c.mapa[k]!] ?? '').trim() : '')
    for (const f of filas) {
      const titulo = val(f, 'titulo') || f[0]
      const meta: Record<string, string> = Object.fromEntries(cab.map((h, i) => [h.trim(), f[i] ?? '']).filter(([, v]) => v !== ''))
      const prioridad = Object.entries(meta).find(([k]) => /^(prioridad|priority)$/i.test(k))?.[1]
      ctx.pieza('filas', {
        nivel: ctx.opciones.nivel,
        tipo: c.esReferencia ? 'referencia' : 'materia',
        titulo,
        contenido: val(f, 'contenido') || titulo,
        autor: val(f, 'autor') || null,
        fecha: val(f, 'fecha') || null,
        url: val(f, 'url') || null,
        etiquetas: [...new Set(c.etiquetas.map((i) => (f[i] ?? '').trim()).filter(Boolean))],
        peso: prioridad && /^P\d$/i.test(prioridad) ? Math.max(1, 12 - Number(prioridad.slice(1)) * 4) : null,
        meta,
        origenId: `csv:${base(d.nombre)}:${val(f, 'id') || titulo}`,
      })
    }
  },
}
