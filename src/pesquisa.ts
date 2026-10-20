/**
 * La Pesquisa: la sesión de La Mano. Una pregunta (un bucle que no cierra, una pregunta pendiente, una hipótesis o lo que
 * él escriba), de 3 a 5 manos robadas sobre ella, una síntesis (la hipótesis de un combo, o lo que faltó para armar algo) y
 * una decisión. Siempre cierra dejando una pregunta: elegir 1 de 3 para la próxima (o saltar), con la misma build.
 * La build es suya: de qué fuentes se roba y hasta tres jokers (del consejo de modelos) que opinan al cerrar.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { ascension, enNube, preguntarModelo } from './mano.ts'
import { bucleMasViejos, cerrarBucle, FINALES, leerBucle } from './bucles.ts'
import { encolarPregunta, listarPreguntas } from './preguntas.ts'
import { leerModelo, listarModelos, queHaria } from './modelos.ts'

export type Opcion = { origen: 'bucle' | 'pregunta' | 'hipotesis'; id: number | null; texto: string }
export type Sintesis = {
  hipotesis: { id: number | null; texto: string } | null
  /** Derrota informativa: si no salió un combo, lo que faltó saber (queda como pregunta). */
  falto: { preguntaId: number | null; texto: string } | null
  jokers: { modelo: string; haria: string; porQue: string }[]
  /** Ascensión 3: el abogado del diablo contra la hipótesis. */
  contra: string | null
  /** Por qué no hubo jokers (en local no se gastan tokens). */
  nota: string | null
}
export type Pesquisa = {
  id: number
  pregunta: string
  origen: string
  origenId: number | null
  fuentes: string[]
  jokers: { id: number; nombre: string }[]
  estado: 'abierta' | 'cerrada'
  decision: string | null
  sintesis: Sintesis | null
  siguiente: Opcion[] | null
  jugadas: number
  pesadas: number
  sorpresas: number
  creadaEn: number
  cerradaEn: number | null
}

export const MAX_JOKERS = 3

export function leerPesquisa(db: Db, id: number): Pesquisa | null {
  const r = db.prepare('SELECT * FROM pesquisas WHERE id = ?').get(id) as any
  if (!r) return null
  const c = db.prepare(`SELECT COUNT(*) AS n, SUM(gesto = 'peso') AS p FROM mano_jugadas WHERE pesquisa_id = ? AND deshecha = 0`).get(id) as { n: number; p: number | null }
  const s = (db.prepare(`SELECT COUNT(*) AS n FROM mano_eventos e JOIN mano_jugadas j ON j.id = e.jugada_id WHERE j.pesquisa_id = ?`).get(id) as { n: number }).n
  return {
    id: r.id, pregunta: r.pregunta, origen: r.origen, origenId: r.origen_id, fuentes: json(r.fuentes, []),
    jokers: json<number[]>(r.jokers, []).map((j) => leerModelo(db, j)).filter((m) => !!m).map((m) => ({ id: m!.id, nombre: m!.nombre })),
    estado: r.estado, decision: r.decision, sintesis: json(r.sintesis, null), siguiente: json(r.siguiente, null),
    jugadas: c.n, pesadas: c.p ?? 0, sorpresas: s, creadaEn: r.creada_en, cerradaEn: r.cerrada_en,
  }
}

export function pesquisaAbierta(db: Db): Pesquisa | null {
  const r = db.prepare(`SELECT id FROM pesquisas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 1`).get() as { id: number } | undefined
  return r ? leerPesquisa(db, r.id) : null
}

/** Abre una Pesquisa (una a la vez). De un bucle, la pregunta es el bucle mismo. */
export function abrirPesquisa(db: Db, x: { pregunta?: string | null; origen?: string; origenId?: number | null; fuentes?: string[]; jokers?: number[] }, ahora = Date.now()): Pesquisa {
  const abierta = pesquisaAbierta(db)
  if (abierta) throw new Error(`Ya tenés una Pesquisa abierta («${abierta.pregunta.slice(0, 60)}»): cerrala primero`)
  const origen = ['bucle', 'pregunta', 'hipotesis'].includes(String(x.origen)) ? String(x.origen) : 'libre'
  let pregunta = String(x.pregunta ?? '').trim()
  if (origen === 'bucle' && x.origenId && !pregunta) pregunta = leerBucle(db, x.origenId, ahora)?.texto ?? ''
  if (pregunta.length < 4) throw new Error('¿Cuál es la pregunta?')
  const jokers = [...new Set((x.jokers ?? []).map(Number).filter(Number.isFinite))]
  if (jokers.length > MAX_JOKERS) throw new Error(`Hasta ${MAX_JOKERS} jokers por Pesquisa`)
  for (const j of jokers) if (!leerModelo(db, j)) throw new Error('Ese joker no está en tu consejo de modelos')
  const fuentes = [...new Set((x.fuentes ?? []).map(String).filter(Boolean))]
  const id = Number(db.prepare('INSERT INTO pesquisas (pregunta, origen, origen_id, fuentes, jokers, creada_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(pregunta.slice(0, 400), origen, x.origenId ?? null, JSON.stringify(fuentes), JSON.stringify(jokers), ahora).lastInsertRowid)
  return leerPesquisa(db, id)!
}

const SISTEMA_FALTO = `Te paso la pregunta que una persona estuvo investigando y las afirmaciones que pesó como importantes. No salió una hipótesis. Escribí la UNA pregunta concreta que, si la respondiera, más la destrabaría (un dato, una experiencia, una prueba). Corta, en segunda persona.
Forma: {"pregunta": string}`

const SISTEMA_CONTRA = `Sos el abogado del diablo. Te paso una hipótesis y la evidencia con la que se armó. Escribí el mejor argumento en contra (el más fuerte, no el más fácil) y qué dato lo zanjaría. Dos o tres frases.
Forma: {"contra": string}`

/**
 * Cierra la Pesquisa: arma la síntesis (la hipótesis de su combo o, si no hubo, lo que faltó saber, que queda como pregunta),
 * en la nube le pregunta a cada joker qué haría y, con la ascensión 3, el abogado del diablo. Si salió de un bucle, la
 * decisión (ya, agendar o soltar) lo cierra. Deja las tres preguntas para elegir la próxima.
 */
export async function cerrarPesquisa(db: Db, id: number, o: { decision?: string | null; fecha?: string | null } = {}, ahora = Date.now()): Promise<Pesquisa> {
  const p = leerPesquisa(db, id)
  if (!p) throw new Error(`No existe la Pesquisa ${id}`)
  if (p.estado !== 'abierta') throw new Error('Esa Pesquisa ya está cerrada')
  const decision = o.decision ? String(o.decision) : null
  if (decision && !(FINALES as readonly string[]).includes(decision)) throw new Error(`La decisión es ${FINALES.join(', ')}`)
  const pesadas = db.prepare(`SELECT q.id, q.texto, q.peso FROM mano_jugadas j JOIN quantomos q ON q.id = j.quantomo_id
    WHERE j.pesquisa_id = ? AND j.deshecha = 0 AND j.gesto = 'peso' AND q.etapa = 'sellado' ORDER BY q.peso DESC, j.id`).all(id) as { id: number; texto: string; peso: number }[]
  const combo = db.prepare(`SELECT e.otro_id, e.texto FROM mano_eventos e JOIN mano_jugadas j ON j.id = e.jugada_id
    WHERE j.pesquisa_id = ? AND e.tipo = 'combo' AND e.otro_id IS NOT NULL AND e.estado != 'casualidad' ORDER BY e.id DESC LIMIT 1`).get(id) as { otro_id: number; texto: string } | undefined
  const nube = enNube()
  const evidencia = pesadas.slice(0, 12).map((q) => `- (peso ${q.peso}) ${q.texto}`).join('\n')
  const s: Sintesis = { hipotesis: combo ? { id: combo.otro_id, texto: combo.texto } : null, falto: null, jokers: [], contra: null, nota: nube ? null : 'Los jokers y el abogado del diablo opinan en tu Deprocast de la nube (gastan tokens).' }

  if (!s.hipotesis) {
    // Derrota informativa: no salió nada armado, pero queda qué faltó (y la próxima tiene más sentido).
    let texto = `Para «${p.pregunta.slice(0, 120)}»: ¿qué dato o qué experiencia te faltó?`
    if (nube && pesadas.length) {
      try { texto = String((await preguntarModelo(db, SISTEMA_FALTO, `PREGUNTA: ${p.pregunta}\n\nLO QUE PESÓ:\n${evidencia}`))?.pregunta ?? '').trim() || texto } catch { /* queda la genérica */ }
    }
    const q = encolarPregunta(db, { texto, porQue: `Salió de la Pesquisa «${p.pregunta.slice(0, 80)}», que cerró sin hipótesis.`, tema: 'pesquisa', origen: 'pesquisa' }, ahora)
    s.falto = { preguntaId: q?.id ?? null, texto }
  }

  if (nube) {
    const situacion = `Estoy investigando: «${p.pregunta}». Lo que pesé como importante:\n${evidencia}${s.hipotesis ? `\n\nMi hipótesis: ${s.hipotesis.texto}` : ''}`
    const conManual = p.jokers.filter((j) => leerModelo(db, j.id)?.manual)
    const r = await Promise.allSettled(conManual.map((j) => queHaria(db, j.id, situacion)))
    s.jokers = r.flatMap((x) => (x.status === 'fulfilled' ? [{ modelo: x.value.modelo, haria: x.value.haria, porQue: x.value.porQue }] : []))
    if (s.hipotesis && ascension(db).adversario) {
      try { s.contra = String((await preguntarModelo(db, SISTEMA_CONTRA, `HIPÓTESIS: ${s.hipotesis.texto}\n\nEVIDENCIA:\n${evidencia}`))?.contra ?? '').trim() || null } catch { /* sin abogado esta vez */ }
    }
  }

  if (p.origen === 'bucle' && p.origenId && decision) {
    await cerrarBucle(db, p.origenId, decision, { fecha: decision === 'agendar' ? (o.fecha ?? fechaLocal(ahora + 86_400_000)) : null, motivo: decision === 'soltar' ? `Lo pensé en una Pesquisa` : null }, ahora)
  }

  db.prepare(`UPDATE pesquisas SET estado = 'cerrada', decision = ?, sintesis = ?, siguiente = ?, cerrada_en = ? WHERE id = ?`)
    .run(decision, JSON.stringify(s), JSON.stringify(proximas(db, p, s, ahora)), ahora, id)
  return leerPesquisa(db, id)!
}

/** Las tres para elegir la próxima: la hipótesis puesta a prueba, el bucle más viejo y una pregunta pendiente (sin repetir). */
function proximas(db: Db, p: Pesquisa, s: Sintesis, ahora: number): Opcion[] {
  const out: Opcion[] = []
  if (s.hipotesis) out.push({ origen: 'hipotesis', id: s.hipotesis.id, texto: `¿Es cierto que ${s.hipotesis.texto.split('\n')[0].replace(/^[A-ZÁÉÍÓÚÑ]/, (c) => c.toLowerCase()).replace(/[.?]$/, '')}?` })
  for (const b of bucleMasViejos(db, 4, ahora)) if (!(p.origen === 'bucle' && b.id === p.origenId) && out.length < 3 && !out.some((x) => x.origen === 'bucle')) out.push({ origen: 'bucle', id: b.id, texto: b.texto })
  for (const q of listarPreguntas(db, { estado: 'pendiente', limite: 6 })) if (out.length < 3 && !out.some((x) => x.texto === q.texto)) out.push({ origen: 'pregunta', id: q.id, texto: q.texto })
  for (const b of bucleMasViejos(db, 6, ahora)) if (out.length < 3 && !out.some((x) => x.origen === 'bucle' && x.id === b.id) && !(p.origen === 'bucle' && b.id === p.origenId)) out.push({ origen: 'bucle', id: b.id, texto: b.texto })
  return out.slice(0, 3)
}

/** Elegir la próxima (una de las tres, con la misma build: reinicio con ventaja) o saltar. */
export function elegirSiguiente(db: Db, id: number, eleccion: number | 'saltar', ahora = Date.now()): Pesquisa | null {
  const p = leerPesquisa(db, id)
  if (!p || p.estado !== 'cerrada') throw new Error('Primero cerrá la Pesquisa')
  if (eleccion === 'saltar') return null
  const op = p.siguiente?.[eleccion]
  if (!op) throw new Error('Esa opción no está')
  return abrirPesquisa(db, { pregunta: op.texto, origen: op.origen, origenId: op.id, fuentes: p.fuentes, jokers: p.jokers.map((j) => j.id) }, ahora)
}

/** Lo que hace falta para armar una Pesquisa: de dónde puede salir la pregunta, de qué fuentes robar y qué jokers hay. */
export function opcionesDePesquisa(db: Db, ahora = Date.now()) {
  return {
    bucles: bucleMasViejos(db, 5, ahora).map((b) => ({ id: b.id, texto: b.texto, veces: b.veces })),
    preguntas: listarPreguntas(db, { estado: 'pendiente', limite: 5 }).map((q) => ({ id: q.id, texto: q.texto })),
    fuentes: db.prepare(`SELECT f.id, f.nombre, COUNT(*) AS n FROM quantomos q JOIN corpus c ON c.id = q.pieza_id JOIN fuentes f ON f.id = c.fuente
      WHERE q.etapa = 'proto' GROUP BY f.id ORDER BY n DESC LIMIT 20`).all() as { id: string; nombre: string; n: number }[],
    jokers: listarModelos(db).map((m) => ({ id: m.id, nombre: m.nombre, conManual: !!m.manual })),
  }
}
