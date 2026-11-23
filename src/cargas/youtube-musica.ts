/**
 * YouTube Music desde Google Takeout (Fragua #336): el .zip de «YouTube y YouTube Music» o sus archivos sueltos. El
 * historial de reproducciones trae lo que escuchó (lo de YouTube Music y los temas de canales «- Topic»): entra como
 * escuchas sin repetir y como una pieza por mes; la biblioteca de YouTube Music y las listas, como listas; y el gusto
 * musical por uso se rehace. YouTube no dice cuánto sonó cada tema: las horas son estimadas, el orden por veces no.
 */
import { zipDeBuffer } from '../takeout/zip.ts'
import { corregirPieza, piezaPorOrigen, type NuevaPieza } from '../corpus.ts'
import { guardarEscuchas, gustoEnTexto, resumenDelMes, type Escucha } from '../musica.ts'
import { escuchaDeYoutube, esHistorialYoutube, idDeVideo } from '../youtube-musica.ts'
import { parsearCsv } from './csv.ts'
import type { Contexto, Datos, Importador, Segmento } from './tipos.ts'

type Lista = { nombre: string; temas: string[]; sinNombre: number }
type Export = { escuchas: Escucha[]; listas: Lista[]; biblioteca: string[]; archivos: string[]; historialHtml: boolean }

const HISTORIAL = /(watch-history|historial[-_ ]de[-_ ]reproducciones)\.json$/i
/** Takeout trae el historial en HTML si no se elige JSON: no se puede leer bien, hay que pedirlo de nuevo. */
const HISTORIAL_HTML = /(watch-history|historial[-_ ]de[-_ ]reproducciones)\.html$/i
const BIBLIOTECA = /(music library songs|canciones de la biblioteca[^/]*)\.csv$/i
const LISTA = /(playlists|listas de reproducci[oó]n)\/[^/]+\.csv$/i

const esZip = (d: Datos) => !!d.bin && d.bin.subarray(0, 2).toString('latin1') === 'PK'

/** Columnas por nombre, en inglés o castellano. */
const col = (cab: string[], ...nombres: RegExp[]) => cab.findIndex((c) => nombres.some((n) => n.test(c.trim())))

function bibliotecaDe(texto: string): string[] {
  const [cab, ...filas] = parsearCsv(texto)
  if (!cab) return []
  const tema = col(cab, /^song title$/i, /^t[ií]tulo( de la canci[oó]n)?$/i), artista = col(cab, /^artist names?$/i, /^(nombres? de )?artistas?$/i)
  if (tema < 0) return []
  return filas.filter((f) => f[tema]?.trim()).map((f) => `${f[tema].trim()}${artista >= 0 && f[artista]?.trim() ? ` — ${f[artista].trim()}` : ''}`)
}

function listaDe(nombre: string, texto: string, titulos: Map<string, string>): Lista | null {
  const [cab, ...filas] = parsearCsv(texto)
  if (!cab) return null
  const vid = col(cab, /^video id$/i, /^id del? v[ií]deo$/i)
  if (vid < 0) return null
  const ids = filas.map((f) => f[vid]?.trim()).filter(Boolean)
  const temas = ids.map((i) => titulos.get(i)).filter((x): x is string => !!x)
  return { nombre: nombre.replace(/\.csv$/i, '').replace(/[-_]videos$/i, '').trim(), temas, sinNombre: ids.length - temas.length }
}

function leerExport(d: Datos): Export {
  const out: Export = { escuchas: [], listas: [], biblioteca: [], archivos: [], historialHtml: false }
  const titulos = new Map<string, string>() // id de video → «tema — artista», para nombrar lo de las listas
  const historial = (nombre: string, j: unknown[]) => {
    for (const x of j) {
      const e = escuchaDeYoutube(x)
      if (!e) continue
      out.escuchas.push(e)
      const id = idDeVideo((x as any).titleUrl)
      if (id && !titulos.has(id)) titulos.set(id, `${e.tema} — ${e.artista}`)
    }
    out.archivos.push(nombre)
  }
  if (esZip(d)) {
    const z = zipDeBuffer(d.bin!)
    const leer = (e: (typeof z.entradas)[number]) => z.leer(e).toString('utf8').replace(/^﻿/, '')
    out.historialHtml = z.entradas.some((x) => HISTORIAL_HTML.test(x.nombre)) && !z.entradas.some((x) => HISTORIAL.test(x.nombre))
    for (const e of z.entradas.filter((x) => !x.dir && HISTORIAL.test(x.nombre))) {
      try { historial(e.nombre.split('/').pop()!, JSON.parse(leer(e))) } catch { /* un archivo roto no frena el resto */ }
    }
    for (const e of z.entradas.filter((x) => !x.dir && BIBLIOTECA.test(x.nombre))) { out.biblioteca.push(...bibliotecaDe(leer(e))); out.archivos.push(e.nombre.split('/').pop()!) }
    for (const e of z.entradas.filter((x) => !x.dir && LISTA.test(x.nombre))) {
      const l = listaDe(e.nombre.split('/').pop()!, leer(e), titulos)
      if (l && (l.temas.length || l.sinNombre)) { out.listas.push(l); out.archivos.push(e.nombre.split('/').pop()!) }
    }
  } else if (esHistorialYoutube(d.json)) historial(d.nombre, d.json)
  else if (/\.csv$/i.test(d.nombre) && BIBLIOTECA.test(d.nombre)) { out.biblioteca = bibliotecaDe(d.texto); out.archivos.push(d.nombre) }
  return out
}

function zipDeYoutube(d: Datos): boolean {
  try { return zipDeBuffer(d.bin!).entradas.some((e) => HISTORIAL.test(e.nombre) || HISTORIAL_HTML.test(e.nombre) || BIBLIOTECA.test(e.nombre) || (LISTA.test(e.nombre) && /youtube/i.test(e.nombre))) } catch { return false }
}

function ponerPieza(ctx: Contexto, seg: string, p: Omit<NuevaPieza, 'fuente' | 'cargaId'> & { origenId: string }): void {
  const ya = piezaPorOrigen(ctx.db, p.origenId)
  if (!ya) { ctx.pieza(seg, p); return }
  if (ya.estado === 'retirada' || ya.contenido.trim() === p.contenido.trim()) return
  corregirPieza(ctx.db, ya.id, p.contenido, 'Nuevo export de YouTube', 'carga', ctx.ahora)
}

export const youtubeMusica: Importador = {
  id: 'youtube-musica', nombre: 'YouTube Music (Takeout)',
  detectar: (d) => (esZip(d) ? zipDeYoutube(d) : esHistorialYoutube(d.json) && (d.json as unknown[]).some((x) => escuchaDeYoutube(x)) || (/\.csv$/i.test(d.nombre) && BIBLIOTECA.test(d.nombre))),
  analizar: (d) => {
    const x = leerExport(d)
    const meses = new Set(x.escuchas.map((e) => e.en.slice(0, 7)))
    const avisos = ['YouTube no dice cuánto sonó cada tema: las horas son estimadas (3,5 min por reproducción); el orden por veces es exacto.']
    if (x.historialHtml) avisos.push('El historial vino en HTML (es lo que Takeout manda si no se cambia): volvé a pedirlo eligiendo JSON. En takeout.google.com → «YouTube y YouTube Music» → «Varios formatos» → historial → JSON.')
    else if (!x.escuchas.length) avisos.push('No trae historial de reproducciones con música: en Takeout marcá «YouTube y YouTube Music» → historial (en JSON).')
    const sinNombre = x.listas.reduce((s, l) => s + l.sinNombre, 0)
    if (sinNombre) avisos.push(`${sinNombre} temas de las listas no aparecen en el historial: van sin nombre (Takeout solo da el id). Traé las listas desde la cuenta con traer_musica_youtube.`)
    return {
      importador: 'youtube-musica', titulo: 'YouTube Music',
      descripcion: `${x.escuchas.length} escuchas en ${meses.size} meses, ${x.listas.length} listas, ${x.biblioteca.length} temas en la biblioteca. Archivos: ${x.archivos.join(', ') || 'ninguno reconocible'}.`,
      segmentos: ([
        { id: 'meses', nombre: 'Escuchas por mes', descripcion: 'Una pieza por mes con artistas y temas. Las escuchas quedan guardadas sin repetir.', nivel: 'propia', destino: 'corpus', cantidad: meses.size, porDefecto: true },
        { id: 'gusto', nombre: 'Gusto musical (por uso)', descripcion: 'Una pieza que se rehace en cada carga: lo que más escuchás, lo reciente, lo que sube y qué suena según la hora.', nivel: 'propia', destino: 'corpus', cantidad: x.escuchas.length ? 1 : 0, porDefecto: true },
        { id: 'listas', nombre: 'Listas', descripcion: 'Una pieza por lista, con los temas que se pueden nombrar.', nivel: 'propia', destino: 'corpus', cantidad: x.listas.length, porDefecto: true },
        { id: 'biblioteca', nombre: 'Biblioteca de YouTube Music', descripcion: 'Los temas que guardaste.', nivel: 'propia', destino: 'corpus', cantidad: x.biblioteca.length ? 1 : 0, porDefecto: true },
      ] as Segmento[]).filter((s) => s.cantidad > 0),
      fuente: { id: 'youtube-musica', nombre: 'YouTube Music', nivel: 'propia', padreId: null, descripcion: 'Lo que escuchás en YouTube Premium: historial, listas, biblioteca y «me gusta».' },
      nivelEditable: false, avisos,
    }
  },
  ejecutar(d, ctx) {
    const x = leerExport(d)
    if (x.escuchas.length && (ctx.quiere('meses') || ctx.quiere('gusto'))) {
      const { meses } = guardarEscuchas(ctx.db, x.escuchas, ctx.cargaId)
      if (ctx.quiere('meses')) for (const mes of meses) {
        const contenido = resumenDelMes(ctx.db, mes, 'youtube')
        if (contenido) ponerPieza(ctx, 'meses', { titulo: `Escuchas en YouTube Music · ${mes}`, contenido, fecha: `${mes}-01`, origenId: `youtube-musica:mes:${mes}`, etiquetas: ['youtube', 'música'] })
      }
      const gusto = ctx.quiere('gusto') ? gustoEnTexto(ctx.db) : null
      if (gusto) ponerPieza(ctx, 'gusto', { titulo: 'Gusto musical (por uso)', contenido: gusto, fecha: x.escuchas.reduce((m, e) => e.en > m ? e.en : m, '').slice(0, 10), origenId: 'musica:gusto', etiquetas: ['youtube', 'música', 'gusto'] })
    }
    if (ctx.quiere('listas')) for (const l of x.listas) {
      ponerPieza(ctx, 'listas', { tipo: 'lista', titulo: `Lista de YouTube · ${l.nombre}`, contenido: [`# ${l.nombre}`, `_${l.temas.length + l.sinNombre} temas${l.sinNombre ? ` (${l.sinNombre} sin nombre en el export)` : ''}._`, '', ...l.temas.map((t, i) => `${i + 1}. ${t}`)].join('\n'), origenId: `youtube-musica:takeout-lista:${l.nombre}`, etiquetas: ['youtube', 'música', 'lista'] })
    }
    if (x.biblioteca.length && ctx.quiere('biblioteca')) {
      ponerPieza(ctx, 'biblioteca', { tipo: 'lista', titulo: 'Biblioteca de YouTube Music', contenido: ['# Biblioteca de YouTube Music', `_${x.biblioteca.length} temas guardados._`, '', ...x.biblioteca.map((t) => `- ${t}`)].join('\n'), origenId: 'youtube-musica:biblioteca', etiquetas: ['youtube', 'música'] })
    }
  },
}
