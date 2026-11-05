/**
 * Google Sheets y la búsqueda en Drive (plan v35). Mastropiero encuentra una planilla por nombre, la lee, escribe un
 * rango, agrega filas o crea una nueva. Los valores van «como si los escribiera él» (USER_ENTERED): una fórmula sigue
 * siendo fórmula y una fecha, fecha.
 */
import type { Db } from '../db.ts'
import { llamarGoogle } from './oauth.ts'

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE = 'https://www.googleapis.com/drive/v3/files'

/** El id de una planilla, desde el link entero o el id suelto. */
export function idDeHoja(x: string): string {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(x)
  const id = m?.[1] ?? x.trim()
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) throw new Error('No reconozco esa planilla: pasá el link o su id.')
  return id
}
const link = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`
const rango = (r: string) => encodeURIComponent(r)

const TIPOS: Record<string, string> = {
  planilla: 'application/vnd.google-apps.spreadsheet',
  documento: 'application/vnd.google-apps.document',
  presentacion: 'application/vnd.google-apps.presentation',
  carpeta: 'application/vnd.google-apps.folder',
  pdf: 'application/pdf',
}

/** Buscar en su Drive por nombre (y tipo): lo más reciente primero. */
export async function buscarEnDrive(db: Db, consulta: string, tipo?: string, limite = 15) {
  const partes = [`name contains '${consulta.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, 'trashed = false']
  if (tipo && TIPOS[tipo]) partes.push(`mimeType = '${TIPOS[tipo]}'`)
  const q = new URLSearchParams({ q: partes.join(' and '), fields: 'files(id,name,mimeType,modifiedTime,webViewLink)', pageSize: String(Math.min(limite, 50)), orderBy: 'modifiedTime desc' })
  const r = await llamarGoogle<any>(db, `${DRIVE}?${q}`)
  return (r.files ?? []).map((f: any) => ({ id: f.id, nombre: f.name, tipo: Object.entries(TIPOS).find(([, m]) => m === f.mimeType)?.[0] ?? f.mimeType, modificado: f.modifiedTime, link: f.webViewLink }))
}

/** Leer una planilla: sin rango, sus pestañas y las primeras 200 filas de la primera. */
export async function leerHoja(db: Db, hoja: string, r?: string) {
  const id = idDeHoja(hoja)
  const meta = await llamarGoogle<any>(db, `${SHEETS}/${id}?fields=properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))`)
  const pestanas = (meta.sheets ?? []).map((s: any) => ({ nombre: s.properties.title, filas: s.properties.gridProperties?.rowCount, columnas: s.properties.gridProperties?.columnCount }))
  const cual = r || `'${pestanas[0]?.nombre ?? 'Hoja 1'}'!A1:Z200`
  const v = await llamarGoogle<any>(db, `${SHEETS}/${id}/values/${rango(cual)}`)
  return { id, titulo: meta.properties?.title, link: link(id), pestanas, rango: v.range, valores: v.values ?? [] }
}

/** Escribir un rango (reemplaza lo que había ahí). */
export async function escribirHoja(db: Db, hoja: string, r: string, valores: unknown[][]) {
  const id = idDeHoja(hoja)
  const x = await llamarGoogle<any>(db, `${SHEETS}/${id}/values/${rango(r)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: valores }) })
  return { id, link: link(id), rango: x.updatedRange, celdas: x.updatedCells ?? 0 }
}

/** Agregar filas al final de una tabla (o de una pestaña). */
export async function agregarFilas(db: Db, hoja: string, r: string, filas: unknown[][]) {
  const id = idDeHoja(hoja)
  const x = await llamarGoogle<any>(db, `${SHEETS}/${id}/values/${rango(r)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: filas }) })
  return { id, link: link(id), rango: x.updates?.updatedRange, filas: x.updates?.updatedRows ?? 0 }
}

/** Una planilla nueva en su Drive, con encabezados y filas si las hay. */
export async function crearHoja(db: Db, titulo: string, filas: unknown[][] = []) {
  if (!titulo.trim()) throw new Error('Falta el nombre de la planilla.')
  const x = await llamarGoogle<any>(db, SHEETS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ properties: { title: titulo.trim() } }) })
  const id = x.spreadsheetId as string
  if (filas.length) await escribirHoja(db, id, `'${x.sheets?.[0]?.properties?.title ?? 'Hoja 1'}'!A1`, filas)
  return { id, titulo: titulo.trim(), link: link(id), filas: filas.length }
}
