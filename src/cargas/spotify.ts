/**
 * Spotify como fuente (Fragua #325): el .zip de «Descargá tus datos» (los datos de la cuenta o el historial extendido)
 * o sus .json sueltos. Las escuchas quedan una por fila (sin repetir) y entran al corpus como una pieza por mes, con
 * fecha; las listas, como listas; la biblioteca y el gusto musical declarado por uso, como una pieza cada una que se
 * rehace en cada carga. Spotify no da el historial completo por API: el export periódico es el camino.
 */
import { zipDeBuffer } from '../takeout/zip.ts'
import { corregirPieza, piezaPorOrigen, type NuevaPieza } from '../corpus.ts'
import { escuchaDe, esHistorial, guardarEscuchas, gustoEnTexto, resumenDelMes, type Escucha } from '../musica.ts'
import type { Contexto, Datos, Importador, Segmento } from './tipos.ts'

type Lista = { nombre: string; modificada: string | null; temas: string[] }
type Export = { escuchas: Escucha[]; listas: Lista[]; biblioteca: { temas: string[]; artistas: string[] } | null; archivos: string[] }

const HISTORIAL = /(StreamingHistory|Streaming_History_Audio|endsong)[^/]*\.json$/i
const LISTAS = /Playlist\d*\.json$/i
const BIBLIOTECA = /YourLibrary\.json$/i

const esZip = (d: Datos) => !!d.bin && d.bin.subarray(0, 2).toString('latin1') === 'PK'
const esListas = (j: any) => Array.isArray(j?.playlists) && j.playlists.some((p: any) => Array.isArray(p?.items))
const esBiblioteca = (j: any) => Array.isArray(j?.tracks) && j.tracks.some((t: any) => t?.artist && t?.track)

function listasDe(j: any): Lista[] {
  return (j.playlists ?? []).filter((p: any) => p?.name).map((p: any) => ({
    nombre: String(p.name),
    modificada: p.lastModifiedDate ? String(p.lastModifiedDate).slice(0, 10) : null,
    temas: (p.items ?? []).map((i: any) => i?.track).filter((t: any) => t?.trackName).map((t: any) => `${t.trackName} — ${t.artistName ?? ''}`.replace(/ — $/, '')),
  }))
}

function bibliotecaDe(j: any) {
  const temas = (j.tracks ?? []).filter((t: any) => t?.track).map((t: any) => `${t.track} — ${t.artist ?? ''}`.replace(/ — $/, ''))
  const artistas = [...new Set<string>([...(j.tracks ?? []).map((t: any) => t?.artist), ...(j.artists ?? []).map((a: any) => a?.name)].filter(Boolean))]
  return { temas, artistas }
}

function leerExport(d: Datos): Export {
  const out: Export = { escuchas: [], listas: [], biblioteca: null, archivos: [] }
  const sumar = (nombre: string, j: any) => {
    if (esHistorial(j)) { for (const x of j) { const e = escuchaDe(x); if (e) out.escuchas.push(e) } out.archivos.push(nombre) }
    else if (esListas(j)) { out.listas.push(...listasDe(j)); out.archivos.push(nombre) }
    else if (esBiblioteca(j)) { out.biblioteca = bibliotecaDe(j); out.archivos.push(nombre) }
  }
  if (esZip(d)) {
    const z = zipDeBuffer(d.bin!)
    for (const e of z.entradas) {
      if (e.dir || !(HISTORIAL.test(e.nombre) || LISTAS.test(e.nombre) || BIBLIOTECA.test(e.nombre))) continue
      try { sumar(e.nombre.split('/').pop()!, JSON.parse(z.leer(e).toString('utf8').replace(/^﻿/, ''))) } catch { /* un archivo roto no frena el resto */ }
    }
  } else if (d.json !== undefined) sumar(d.nombre, d.json)
  return out
}

function zipDeSpotify(d: Datos): boolean {
  try { return zipDeBuffer(d.bin!).entradas.some((e) => HISTORIAL.test(e.nombre) || LISTAS.test(e.nombre) || BIBLIOTECA.test(e.nombre)) } catch { return false }
}

/** Una pieza que se rehace: si ya está, se corrige (con versión); si él la retiró, queda retirada. */
function ponerPieza(ctx: Contexto, seg: string, p: Omit<NuevaPieza, 'fuente' | 'cargaId'> & { origenId: string }): void {
  const ya = piezaPorOrigen(ctx.db, p.origenId)
  if (!ya) { ctx.pieza(seg, p); return }
  if (ya.estado === 'retirada' || ya.contenido.trim() === p.contenido.trim()) return
  corregirPieza(ctx.db, ya.id, p.contenido, 'Nuevas escuchas de Spotify', 'carga', ctx.ahora)
}

export const spotify: Importador = {
  id: 'spotify', nombre: 'Datos de Spotify',
  detectar: (d) => esZip(d) ? zipDeSpotify(d) : esHistorial(d.json) || esListas(d.json) || esBiblioteca(d.json),
  analizar: (d) => {
    const x = leerExport(d)
    const meses = new Set(x.escuchas.map((e) => e.en.slice(0, 7)))
    const avisos: string[] = []
    if (!x.escuchas.length) avisos.push('No trae historial de escuchas: sin eso no hay gusto musical por uso. Pedí «Historial extendido de reproducción» en spotify.com/account/privacy.')
    return {
      importador: 'spotify', titulo: 'Spotify',
      descripcion: `${x.escuchas.length} escuchas en ${meses.size} meses, ${x.listas.length} listas${x.biblioteca ? `, ${x.biblioteca.temas.length} temas guardados` : ''}. Archivos: ${x.archivos.join(', ') || 'ninguno reconocible'}.`,
      segmentos: ([
        { id: 'meses', nombre: 'Escuchas por mes', descripcion: 'Una pieza por mes con horas, artistas y temas. Las escuchas quedan guardadas sin repetir.', nivel: 'propia', destino: 'corpus', cantidad: meses.size, porDefecto: true },
        { id: 'gusto', nombre: 'Gusto musical (por uso)', descripcion: 'Una pieza que se rehace en cada carga: lo que más escuchás, lo reciente, lo que sube y qué suena según la hora.', nivel: 'propia', destino: 'corpus', cantidad: x.escuchas.length ? 1 : 0, porDefecto: true },
        { id: 'listas', nombre: 'Listas', descripcion: 'Una pieza por lista, con sus temas.', nivel: 'propia', destino: 'corpus', cantidad: x.listas.length, porDefecto: true },
        { id: 'biblioteca', nombre: 'Biblioteca', descripcion: 'Los temas y artistas que guardaste.', nivel: 'propia', destino: 'corpus', cantidad: x.biblioteca ? 1 : 0, porDefecto: true },
      ] as Segmento[]).filter((s) => s.cantidad > 0),
      fuente: { id: 'spotify', nombre: 'Spotify', nivel: 'propia', padreId: null, descripcion: 'Lo que escuchás: historial, listas y biblioteca de Spotify.' },
      nivelEditable: false, avisos,
    }
  },
  ejecutar(d, ctx) {
    const x = leerExport(d)
    if (x.escuchas.length && (ctx.quiere('meses') || ctx.quiere('gusto'))) {
      const { meses } = guardarEscuchas(ctx.db, x.escuchas, ctx.cargaId)
      if (ctx.quiere('meses')) for (const mes of meses) {
        const contenido = resumenDelMes(ctx.db, mes)
        if (contenido) ponerPieza(ctx, 'meses', { titulo: `Escuchas · ${mes}`, contenido, fecha: `${mes}-01`, origenId: `spotify:mes:${mes}`, etiquetas: ['spotify', 'música'] })
      }
      const gusto = ctx.quiere('gusto') ? gustoEnTexto(ctx.db) : null
      if (gusto) ponerPieza(ctx, 'gusto', { titulo: 'Gusto musical (por uso)', contenido: gusto, fecha: x.escuchas.reduce((m, e) => e.en > m ? e.en : m, '').slice(0, 10), origenId: 'spotify:gusto', etiquetas: ['spotify', 'música', 'gusto'] })
    }
    if (ctx.quiere('listas')) for (const l of x.listas) {
      ponerPieza(ctx, 'listas', { tipo: 'lista', titulo: `Lista de Spotify · ${l.nombre}`, contenido: [`# ${l.nombre}`, `_${l.temas.length} temas${l.modificada ? `; cambiada el ${l.modificada}` : ''}._`, '', ...l.temas.map((t, i) => `${i + 1}. ${t}`)].join('\n'), fecha: l.modificada, origenId: `spotify:lista:${l.nombre}`, etiquetas: ['spotify', 'música', 'lista'] })
    }
    if (x.biblioteca && ctx.quiere('biblioteca')) {
      const b = x.biblioteca
      ponerPieza(ctx, 'biblioteca', { tipo: 'lista', titulo: 'Biblioteca de Spotify', contenido: ['# Biblioteca de Spotify', `_${b.temas.length} temas guardados, ${b.artistas.length} artistas._`, '', '## Artistas', b.artistas.join(', '), '', '## Temas', ...b.temas.map((t) => `- ${t}`)].join('\n'), origenId: 'spotify:biblioteca', etiquetas: ['spotify', 'música'] })
    }
  },
}
