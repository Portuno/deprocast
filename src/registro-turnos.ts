/**
 * El registro de los turnos del chat como métrica (Fragua #238): no el error suelto, la tendencia. Cada turno con su
 * tipo, cuánto tardó, las herramientas que usó y cómo salió —acierto (👍), desvío (👎), error (se cortó o falló) o sin
 * marcar—, con su causa. Por día: turnos, tasa de acierto, errores y tiempo medio; por tipo de turno, el tiempo; y las
 * causas que más se repiten (cada una puede ir a La Fragua desde Errores).
 *
 * Marcar desde el chat: escribir «error» (o «error: no era eso») marca la respuesta anterior como desvío, con su causa.
 */
import { fechaLocal, type Db } from './db.ts'

export type Resultado = 'acierto' | 'desvio' | 'error' | null
type Fila = { id: number; conversacion_id: number; tipo: string; total_ms: number; vueltas: number; en: number; desde_id: number | null; hasta_id: number | null }

/** Los turnos de los últimos días, cada uno con lo que pasó en su ventana de tiempo. */
export function turnos(db: Db, dias = 14, ahora = Date.now(), limite = 400) {
  const filas = db.prepare(`SELECT id, conversacion_id, tipo, total_ms, vueltas, en, desde_id, hasta_id FROM chat_tiempos WHERE en >= ? ORDER BY en DESC, id DESC LIMIT ?`).all(ahora - dias * 86_400_000, limite) as Fila[]
  // Por los ids que abarca el turno; los turnos viejos (sin ids), por su ventana de tiempo.
  const porIds = db.prepare(`SELECT id, rol, herramienta, texto FROM mensajes WHERE conversacion_id = ? AND id > ? AND id <= ? ORDER BY id`)
  const enVentana = db.prepare(`SELECT id, rol, herramienta, texto FROM mensajes WHERE conversacion_id = ? AND en >= ? AND en <= ? ORDER BY id`)
  const fb = db.prepare(`SELECT valor, nota FROM devoluciones WHERE superficie = 'chat' AND ref = ?`)
  return filas.map((f) => {
    const ms = (f.hasta_id != null ? porIds.all(f.conversacion_id, f.desde_id ?? 0, f.hasta_id) : enVentana.all(f.conversacion_id, f.en, f.en + f.total_ms + 2000)) as { id: number; rol: string; herramienta: string | null; texto: string | null }[]
    const herramientas = [...new Set(ms.filter((m) => m.rol === 'herramienta' && m.herramienta).map((m) => m.herramienta!))]
    const error = ms.find((m) => m.rol === 'error')
    const ultima = ms.filter((m) => m.rol === 'asistente' && m.texto?.trim()).at(-1)
    const v = ultima ? (fb.get(String(ultima.id)) as { valor: number; nota: string | null } | undefined) : undefined
    const resultado: Resultado = error ? 'error' : v ? (v.valor > 0 ? 'acierto' : 'desvio') : null
    return {
      en: f.en, fecha: fechaLocal(f.en), tipo: f.tipo, ms: f.total_ms, vueltas: f.vueltas, herramientas, resultado,
      causa: error ? (error.texto ?? '').slice(0, 200) : v?.nota ?? null, respuesta: ultima ? (ultima.texto ?? '').slice(0, 160) : null,
    }
  })
}

const mediana = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/** Los agregados: por día, por tipo de turno y las causas que más se repiten. */
export function registroTurnos(db: Db, dias = 14, ahora = Date.now()) {
  const ts = turnos(db, dias, ahora)
  const porDia = new Map<string, typeof ts>()
  for (const t of ts) porDia.set(t.fecha, [...(porDia.get(t.fecha) ?? []), t])
  const tasa = (xs: typeof ts) => { const marcados = xs.filter((t) => t.resultado === 'acierto' || t.resultado === 'desvio'); return marcados.length ? +(marcados.filter((t) => t.resultado === 'acierto').length / marcados.length).toFixed(2) : null }
  const dia = [...porDia].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, xs]) => ({
    fecha, turnos: xs.length, aciertos: xs.filter((t) => t.resultado === 'acierto').length, desvios: xs.filter((t) => t.resultado === 'desvio').length,
    errores: xs.filter((t) => t.resultado === 'error').length, tasa: tasa(xs), msMediana: mediana(xs.map((t) => t.ms)),
  }))
  const porTipo = [...ts.reduce((m, t) => m.set(t.tipo, [...(m.get(t.tipo) ?? []), t.ms]), new Map<string, number[]>())]
    .map(([tipo, ms]) => ({ tipo, n: ms.length, msMediana: mediana(ms) })).sort((a, b) => b.n - a.n)
  // Las causas: los errores (por su primera frase) y los desvíos (por su nota).
  const causas = new Map<string, { causa: string; tipo: 'error' | 'desvio'; veces: number }>()
  for (const t of ts.filter((x) => (x.resultado === 'error' || x.resultado === 'desvio') && x.causa)) {
    const k = `${t.resultado}|${t.causa!.split(/[.:·]/)[0].trim().toLowerCase().slice(0, 80)}`
    const x = causas.get(k) ?? { causa: t.causa!.split(/[.·]/)[0].trim().slice(0, 120), tipo: t.resultado as 'error' | 'desvio', veces: 0 }
    x.veces++
    causas.set(k, x)
  }
  return { dias, total: ts.length, tasa: tasa(ts), porDia: dia, porTipo, causas: [...causas.values()].sort((a, b) => b.veces - a.veces).slice(0, 10), ultimos: ts.slice(0, 60) }
}

/** «error» (o «error: no era eso») en el chat: la respuesta anterior queda marcada como desvío, con su causa. null si no es eso. */
export function marcarErrorDesdeElChat(db: Db, cid: number, texto: string, ahora = Date.now()): string | null {
  const m = /^\s*(?:error|eso est[aá] mal|est[aá] mal)\s*(?:[:,.-]\s*(.{0,200}))?\s*$/i.exec(texto)
  if (!m) return null
  const ultima = db.prepare(`SELECT id FROM mensajes WHERE conversacion_id = ? AND rol = 'asistente' AND TRIM(COALESCE(texto, '')) != '' AND COALESCE(modelo, '') != 'rutina' AND COALESCE(via, '') != 'rapida' ORDER BY id DESC LIMIT 1`).get(cid) as { id: number } | undefined
  if (!ultima) return null
  const causa = m[1]?.trim() || 'marcado «error» desde el chat'
  db.prepare(`INSERT INTO devoluciones (superficie, ref, valor, nota, en) VALUES ('chat', ?, -1, ?, ?)
    ON CONFLICT(superficie, ref) DO UPDATE SET valor = -1, nota = excluded.nota, en = excluded.en`).run(String(ultima.id), causa, ahora)
  return `📌 Anotado: la respuesta anterior fue un error${m[1] ? ` («${causa}»)` : ''}. Queda en Revisión → Turnos, con su causa.`
}
