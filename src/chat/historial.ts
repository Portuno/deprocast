/**
 * El historial que ve el modelo, con elisión por etapas (docs/mejoras-harness.md, cambio 1; T4 de *An Empirical Study
 * of Harness Design*). La base guarda todo; esto es solo lo que viaja en el próximo llamado.
 *
 * 1. Ventana reciente, verbatim: desde el anteúltimo mensaje del operador hasta el final (piso: sus dos últimos
 *    turnos). Ahí las salidas de herramienta conservan hasta 12.000 caracteres.
 * 2. Región media (lo anterior): la salida de una herramienta de más de 800 caracteres se cambia por un stub. El
 *    diálogo (lo que dijo él y lo que contestó Mastropiero) queda entero.
 * 3. Tope blando (48.000 caracteres): si todavía no entra, un llamado aparte, sin herramientas, resume lo más viejo del
 *    medio en un bloque (Objetivo · Hecho · Pendiente · Decisiones del operador) y eso sale del arreglo. El resumen va
 *    como un mensaje de sistema corto, no se escribe en la conversación, y se recuerda para no rehacerlo en cada turno.
 * 4. Tope duro (80.000): si aun así no entra, se descarta lo más viejo del medio sin llamar al modelo. La ventana
 *    reciente nunca se recorta.
 * El diario no se resume (solo se elide). No hay almacén para «recuperar» lo elidido: si hace falta, la herramienta se
 * vuelve a llamar (el paper muestra que recuperar no paga).
 */
import type { Db } from '../db.ts'
import { llamarModelo } from '../modelo.ts'
import type { Mensaje } from './index.ts'

export const TOPE_VENTANA_HERRAMIENTA = 12_000
export const ELIDIR_DESDE = 800
export const TOPE_BLANDO = 48_000
export const TOPE_DURO = 80_000

type MsjModelo = Record<string, unknown>
/** Un bloque que se mueve entero: un mensaje del operador, o una respuesta del asistente con las salidas de sus herramientas. */
type Bloque = { mensajes: Mensaje[]; hastaId: number }

const recorte = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
export const stub = (n: number) => `[salida elidida: ${n} caracteres. Volvé a llamar la herramienta.]`

/** Lo que pesa un mensaje en el armado (texto + argumentos de las llamadas). */
const peso = (m: MsjModelo) => String(m.content ?? '').length + (Array.isArray(m.tool_calls) ? JSON.stringify(m.tool_calls).length : 0)
export const pesoTotal = (ms: MsjModelo[]) => ms.reduce((s, m) => s + peso(m), 0)

/** Arregla los pedidos de herramienta sin respuesta (un turno cortado por error rompe la API) y agrupa en bloques. */
function bloques(ms: Mensaje[]): Bloque[] {
  const lista = ms.filter((m) => m.rol === 'operador' || m.rol === 'asistente' || m.rol === 'herramienta')
  const respondidas = new Set(lista.filter((m) => m.rol === 'herramienta').map((m) => m.llamadaId))
  const limpios = lista.map((m) => (m.rol === 'asistente' && m.llamadas?.some((l) => !respondidas.has(l.id)) ? { ...m, llamadas: null } : m))
  const pedidas = new Set(limpios.filter((m) => m.rol === 'asistente').flatMap((m) => m.llamadas?.map((l) => l.id) ?? []))
  const out: Bloque[] = []
  for (const m of limpios) {
    if (m.rol === 'herramienta') {
      // Una salida sin su pedido (huérfana) no viaja; si no, va pegada al asistente que la pidió.
      if (!m.llamadaId || !pedidas.has(m.llamadaId) || !out.length) continue
      out.at(-1)!.mensajes.push(m)
      out.at(-1)!.hastaId = m.id
      continue
    }
    out.push({ mensajes: [m], hastaId: m.id })
  }
  return out
}

function aModelo(b: Bloque, o: { reciente: boolean; turnoEnCurso: boolean }): MsjModelo[] {
  return b.mensajes.map((m): MsjModelo => {
    if (m.rol === 'operador') return { role: 'user', content: m.texto ?? '' }
    if (m.rol === 'herramienta') {
      const t = m.texto ?? ''
      return { role: 'tool', tool_call_id: m.llamadaId, content: o.reciente ? recorte(t, TOPE_VENTANA_HERRAMIENTA) : t.length > ELIDIR_DESDE ? stub(t.length) : t }
    }
    const x: MsjModelo = { role: 'assistant', content: m.texto ?? '' }
    if (m.llamadas?.length) x.tool_calls = m.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: l.argumentos } }))
    if (m.razonamiento && o.turnoEnCurso) x.reasoning_content = m.razonamiento
    return x
  })
}

const SISTEMA_RESUMEN = `Resumís el principio de una conversación entre el operador y Mastropiero, para que Mastropiero la siga sin el texto completo.
Escribí solo estos encabezados, en este orden, y omití el que quede vacío:
Objetivo: qué busca el operador en esta conversación.
Hecho: lo que ya se hizo o se resolvió (con datos concretos: nombres, cifras, ids).
Pendiente: lo que quedó por hacer o por contestar.
Decisiones del operador: lo que él decidió, pidió o corrigió, con sus palabras si importan.
Corto (máximo 15 líneas en total), en castellano. Solo lo que está en el texto.`

/** Resumen inyectable (tests). */
let resumir = async (db: Db, previo: string | null, texto: string): Promise<string> => {
  const r = await llamarModelo({ db, clase: 'mastropiero', agenteId: 'historial' }, {
    mensajes: [{ role: 'system', content: SISTEMA_RESUMEN }, { role: 'user', content: `${previo ? `Resumen de lo anterior a esto:\n${previo}\n\n` : ''}Conversación:\n${texto}` }],
    herramientas: [], temperatura: 0.2, maxTokens: 1500,
  })
  return r.texto.trim()
}
export function _probarResumen(f: typeof resumir) {
  resumir = f
}

const comoTexto = (bs: Bloque[]) => bs.flatMap((b) => b.mensajes).map((m) => {
  if (m.rol === 'operador') return `OPERADOR: ${m.texto ?? ''}`
  if (m.rol === 'herramienta') return `  [${m.herramienta ?? 'herramienta'}: ${recorte(m.texto ?? '', 400)}]`
  return `MASTROPIERO: ${m.texto ?? ''}${m.llamadas?.length ? ` (usó ${m.llamadas.map((l) => l.nombre).join(', ')})` : ''}`
}).join('\n')

/**
 * Arma el historial para el próximo llamado. `cid` sirve para recordar el resumen (null: sin resumen recordado);
 * `resumirViejo` en false (el diario) solo elide y, si hace falta, descarta.
 */
export async function armarHistorial(db: Db, ms: Mensaje[], o: { cid?: number | null; resumirViejo?: boolean } = {}): Promise<MsjModelo[]> {
  const bs = bloques(ms)
  // La ventana reciente arranca en el anteúltimo mensaje del operador (sus dos últimos turnos).
  const operadores = bs.map((b, i) => (b.mensajes[0].rol === 'operador' ? i : -1)).filter((i) => i >= 0)
  const inicioReciente = operadores.length >= 2 ? operadores.at(-2)! : operadores.length ? operadores[0] : Math.max(0, bs.length - 1)
  const ultimoOperador = operadores.at(-1) ?? -1
  let medio = bs.slice(0, inicioReciente)
  const reciente = bs.slice(inicioReciente).flatMap((b, k) => aModelo(b, { reciente: true, turnoEnCurso: inicioReciente + k > ultimoOperador }))
  const armar = (resumen: string | null) => [
    ...(resumen ? [{ role: 'system', content: `Resumen de lo anterior de esta conversación (lo armaste vos para no perder el hilo):\n${resumen}` }] : []),
    ...medio.flatMap((b) => aModelo(b, { reciente: false, turnoEnCurso: false })),
    ...reciente,
  ]
  let resumen: string | null = null
  // Un resumen ya hecho: lo que cubre sale del medio.
  const guardado = o.cid != null ? (db.prepare('SELECT hasta_id, texto FROM chat_resumenes WHERE conversacion_id = ?').get(o.cid) as { hasta_id: number; texto: string } | undefined) : undefined
  if (guardado && o.resumirViejo !== false) {
    const cubiertos = medio.filter((b) => b.hastaId <= guardado.hasta_id).length
    if (cubiertos) { medio = medio.slice(cubiertos); resumen = guardado.texto }
  }
  if (pesoTotal(armar(resumen)) <= TOPE_BLANDO) return armar(resumen)

  // Tope blando: resumir lo más viejo del medio hasta que lo que queda entre con holgura.
  if (o.resumirViejo !== false && medio.length) {
    const aResumir: Bloque[] = []
    while (medio.length && pesoTotal(armar(resumen)) > TOPE_BLANDO * 0.7) aResumir.push(medio.shift()!)
    try {
      resumen = await resumir(db, resumen, comoTexto(aResumir))
      if (o.cid != null && resumen) {
        db.prepare('INSERT OR REPLACE INTO chat_resumenes (conversacion_id, hasta_id, texto, en) VALUES (?, ?, ?, ?)').run(o.cid, aResumir.at(-1)!.hastaId, resumen, Date.now())
      }
    } catch {
      // Sin resumen (el modelo falló): lo resumido no vuelve; el tope duro decide qué más sale.
    }
  }
  // Tope duro: descartar lo más viejo del medio, sin modelo. La ventana reciente no se toca.
  while (medio.length && pesoTotal(armar(resumen)) > TOPE_DURO) medio.shift()
  return armar(resumen)
}
