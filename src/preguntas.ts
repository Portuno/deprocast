/**
 * Mastropiero pregunta: lo que le falta saber del jugador para ayudarlo mejor (sus números, su gente, sus proyectos,
 * cómo trabaja), de a una pregunta por vez. Antes desglosa en recuerdos lo que ya está en los datos; solo pregunta
 * el hueco. Él contesta con un toque o una línea; la respuesta pasa por el escriba y queda en la memoria.
 */
import { json, type Db } from './db.ts'
import { escribaDeMemoria, memoriaParaPrompt, recordar } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { listarEntidades } from './entidades.ts'
import { finanzasParaPrompt } from './finanzas.ts'
import { listarMisiones, principalDe, semanaDe } from './misiones.ts'
import { personas } from './personas.ts'
import { inventarioParaPrompt } from './personajes.ts'

export type Pregunta = {
  id: number; texto: string; porQue: string | null; tipo: 'abierta' | 'opciones' | 'numero'; opciones: string[]; tema: string | null
  estado: 'pendiente' | 'respondida' | 'salteada'; respuesta: string | null; origen: string; creadaEn: number; respondidaEn: number | null
}

const deFila = (r: any): Pregunta => ({
  id: r.id, texto: r.texto, porQue: r.por_que, tipo: r.tipo, opciones: json(r.opciones, []), tema: r.tema, estado: r.estado,
  respuesta: r.respuesta, origen: r.origen, creadaEn: r.creada_en, respondidaEn: r.respondida_en,
})

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const VACIAS = new Set('que cual cuales como cuando donde quien quienes para con una uno unas unos las los del esta este eso esa sus tus vos hoy mas muy poco sobre desde hasta tiene tener hacer hace algo alguien esto aquella aquel por'.split(' '))

function claves(s: string): string[] {
  return [...new Set(norm(s).split(' ').filter((w) => w.length > 3 && !VACIAS.has(w)))]
}

/** Nombres propios del texto (no las palabras de la pregunta). */
function nombres(s: string): string[] {
  const no = new Set(['cuanto', 'cuanta', 'cuantos', 'quien', 'quienes', 'como', 'cuando', 'donde', 'mastropiero'])
  return [...new Set([...s.matchAll(/\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/g)].map((m) => norm(m[0])).filter((n) => !VACIAS.has(n) && !no.has(n)))]
}

/** La familia de una pregunta que se repite mucho cambiando las palabras: plata que entra, vínculo, ritmo. */
function familia(s: string): string | null {
  const t = norm(s)
  if (/meta|objetivo|llegar a/.test(t) && /plata|ingres|euro|\d/.test(t)) return 'meta-plata'
  if (/(cuanto|cuanta).{0,40}(entra|gana|cobr|sueldo|factura)/.test(t) || /ingresos? (del|de este|mensual|por mes)/.test(t)) return 'plata-entra'
  if (/(cuanto|cuanta).{0,24}(gast|sale|salen)/.test(t) || /gastos? (del|de este|mensual|por mes)/.test(t)) return 'plata-sale'
  if (/quien es|que rol|que vinculo|para vos es/.test(t)) return 'vinculo'
  if (/a que hora/.test(t) || /cuando (te levant|arranc|dorm|descans)/.test(t)) return 'ritmo'
  return null
}

/** La misma pregunta dicha de otra forma. */
function preguntaParecida(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true
  const A = claves(a)
  const B = new Set(claves(b))
  if (A.length >= 2 && B.size >= 2) {
    const inter = A.filter((w) => B.has(w)).length
    if (inter >= 2 && inter / Math.min(A.length, B.size) >= 0.6) return true
  }
  const fa = familia(a)
  const fb = familia(b)
  if (!fa || fa !== fb) return false
  const na = nombres(a)
  const nb = nombres(b)
  if (!na.length && !nb.length) return true
  return na.some((n) => nb.includes(n))
}

/**
 * El dato ya está en una pista (un recuerdo, un número del mes, un vínculo). Preguntarlo sería hacerlo repetir lo que el sistema ya tiene.
 */
const conNumero = (p: string, re: RegExp) => {
  const n = Number(p.match(re)?.[1] ?? 0)
  return n > 0
}

function yaCubierta(texto: string, pistas: string[]): boolean {
  const f = familia(texto)
  const ns = nombres(texto)
  const plataYa = (p: string) => /\d/.test(p) && /entra|ingres|gana|sueldo|cobr|factura/.test(norm(p)) && !/llegar|meta|objetivo/.test(norm(p))
  if (f === 'plata-entra' && pistas.some((p) => conNumero(p, /entraron\s+([\d.]+)/) || plataYa(p))) return true
  if (f === 'plata-sale' && pistas.some((p) => conNumero(p, /salieron\s+([\d.]+)/))) return true
  if (f === 'meta-plata' && pistas.some((p) => conNumero(p, /su meta es\s+([\d.]+)/) || (/llegar a|meta de/.test(norm(p)) && /\d/.test(p)))) return true
  if (f === 'vinculo' && ns.length && pistas.some((p) => ns.every((n) => norm(p).includes(n)) && (/\([^)]+\)|:/.test(p)) && claves(p).length >= 2)) return true
  const A = claves(texto)
  if (A.length < 2) return false
  return pistas.some((p) => {
    const B = new Set(claves(p))
    const inter = A.filter((w) => B.has(w)).length
    return inter >= 2 && inter / A.length >= 0.6
  })
}

export function listarPreguntas(db: Db, f: { estado?: string; limite?: number } = {}): Pregunta[] {
  return (f.estado
    ? db.prepare('SELECT * FROM preguntas WHERE estado = ? ORDER BY id LIMIT ?').all(f.estado, f.limite ?? 50)
    : db.prepare('SELECT * FROM preguntas ORDER BY id DESC LIMIT ?').all(f.limite ?? 50)).map(deFila)
}

export function siguientePregunta(db: Db): Pregunta | null {
  return listarPreguntas(db, { estado: 'pendiente', limite: 1 })[0] ?? null
}

/** Encola una pregunta (sin repetir una igual que ya esté pendiente o respondida). */
export function encolarPregunta(db: Db, p: { texto: string; porQue?: string | null; tipo?: string; opciones?: string[]; tema?: string | null; origen?: string }, ahora = Date.now()): Pregunta | null {
  const texto = String(p.texto ?? '').trim().slice(0, 300)
  if (!texto) return null
  const ya = (db.prepare('SELECT * FROM preguntas').all() as any[]).find((r) => preguntaParecida(r.texto, texto))
  if (ya) return deFila(ya)
  const opciones = (p.opciones ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 6)
  const tipo = p.tipo === 'numero' ? 'numero' : opciones.length >= 2 ? 'opciones' : 'abierta'
  const r = db.prepare('INSERT INTO preguntas (texto, por_que, tipo, opciones, tema, estado, origen, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(texto, p.porQue?.trim() || null, tipo, opciones.length ? JSON.stringify(opciones) : null, p.tema ?? null, 'pendiente', p.origen ?? 'mastropiero', ahora)
  return deFila(db.prepare('SELECT * FROM preguntas WHERE id = ?').get(Number(r.lastInsertRowid)))
}

/** Escriba inyectable: en la app corre en segundo plano; en tests, se espera o se apaga. */
let escriba = (db: Db, texto: string) => escribaDeMemoria(db, texto, null)
export function _probarEscribaPreguntas(f: typeof escriba) {
  escriba = f
}

/** Contesta (la respuesta va al escriba como algo que dijo él) o saltea. */
export async function responderPregunta(db: Db, id: number, respuesta: string | null, ahora = Date.now()): Promise<Pregunta> {
  const p = db.prepare('SELECT * FROM preguntas WHERE id = ?').get(id)
  if (!p) throw new Error(`No existe la pregunta ${id}`)
  const r = respuesta?.trim() || null
  db.prepare('UPDATE preguntas SET estado = ?, respuesta = ?, respondida_en = ? WHERE id = ?').run(r ? 'respondida' : 'salteada', r, ahora, id)
  const q = deFila(db.prepare('SELECT * FROM preguntas WHERE id = ?').get(id))
  if (r) await escriba(db, `Mastropiero le preguntó: «${q.texto}». Él respondió: ${r}`)
  return q
}

const SISTEMA = (n: number) => `Sos Mastropiero. Primero desglosás lo que YA está en los datos sobre el jugador, y solo después preguntás el hueco que de verdad no se puede sacar de ahí.
- «desglose»: de 0 a 6 hechos que ya se leen abajo y todavía no están escritos como recuerdo. Una oración en tercera persona («Ana es su socia», «Este mes entraron 2.500 €»). No inventes ni completes con suposiciones. No repitas un recuerdo que ya figura. Si no hay nada nuevo, lista vacía.
- «preguntas»: hasta ${n}, de temas distintos, solo lo que ni el desglose ni los datos alcanzan a decir. Si el número, el vínculo, el estado del proyecto o el hábito ya está, va al desglose y NO se pregunta.
- Nada de encuesta ni de pregunta genérica («¿cómo estás?», «¿en qué trabajás?» si ya se sabe). Concreta, con nombres propios cuando haga falta. No reformules una pregunta ya hecha, ni una que salteó.
- Una pregunta corta, en castellano rioplatense, con voseo. «por_que»: para qué te sirve ese hueco.
- Si se responde mejor eligiendo, de 2 a 5 «opciones»; si es un número que no está, tipo «numero»; si no, «abierta».
Forma: {"desglose": [{"texto": string, "tipo": "hecho" | "meta" | "preferencia" | "sueño" | "vision", "horizonte": "castillo" | "campamento" | "trinchera" | null}], "preguntas": [{"texto": string, "por_que": string, "tipo": "abierta" | "opciones" | "numero", "opciones": [string], "tema": string}]}`

/** Lo que el sistema ya tiene de él, partido en pistas: memoria, números, inventario, gente con vínculo y proyectos. */
function dossier(db: Db, ahora: number): { texto: string; pistas: string[] } {
  const memoria = memoriaParaPrompt(db, 90)
  const fin = finanzasParaPrompt(db)
  const inv = inventarioParaPrompt(db, 'jugador', 24)
  const gente = personas(db, { limite: 40 }, ahora)
    .filter((p) => p.vinculo || p.notas || p.menciones > 0)
    .slice(0, 12)
    .map((p) => `- ${p.nombre}${p.vinculo ? ` (${p.vinculo})` : ''}${p.notas ? `: ${p.notas}` : ''}${p.menciones ? ` · aparece en ${p.menciones} piezas` : ''}${p.ultimoContacto ? ` · último contacto ${p.ultimoContacto}` : ''}`)
  const proyectos = listarEntidades(db, { tipo: 'proyecto', limite: 12 })
    .filter((e) => e.piezas > 0 || e.notas)
    .map((e) => `- ${e.nombre}${e.notas ? `: ${e.notas}` : ''} (${e.piezas} piezas)`)
  const principal = principalDe(db, 'jugador')
  const primarias = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa', 'sugerida'] })
  const hechas = listarPreguntas(db, { limite: 60 }).map((p) => `- ${p.texto}${p.respuesta ? ` → ${p.respuesta.slice(0, 160)}` : p.estado === 'salteada' ? ' (la salteó)' : ''}`)
  const pistas = [memoria, fin, inv, ...gente, ...proyectos].flatMap((b) => b.split('\n')).map((l) => l.trim()).filter(Boolean)
  const texto = [
    `Lo que ya sabés de él (si un dato está acá, desglosalo: no lo preguntes):\n${memoria || '- casi nada en la memoria'}`,
    fin ? `\n${fin}` : '',
    inv ? `\nLo que tiene:\n${inv}` : '',
    gente.length ? `\nSu gente:\n${gente.join('\n')}` : '',
    proyectos.length ? `\nSus proyectos:\n${proyectos.join('\n')}` : '',
    principal ? `\nSu misión principal: ${principal.titulo}` : '',
    primarias.length ? `\nSus primarias de la semana: ${primarias.map((m) => m.titulo).join(' · ')}` : '',
    hechas.length ? `\nYa le preguntaste (no reformules, aunque la haya salteado):\n${hechas.join('\n')}` : '',
  ].filter(Boolean).join('\n')
  return { texto, pistas }
}

/** Desglosa en recuerdos lo que ya se sabe y encola solo las preguntas de un hueco real. */
export async function generarPreguntas(db: Db, n = 5, ahora = Date.now()): Promise<Pregunta[]> {
  const d = dossier(db, ahora)
  const { datos } = await pedirJson<{ desglose?: any[]; preguntas?: any[] }>({ db, clase: 'mastropiero', agenteId: 'preguntas' }, SISTEMA(n), d.texto, { temperatura: 0.4, maxTokens: 2500 })
  const pistas = [...d.pistas]
  for (const r of (datos.desglose ?? []).slice(0, 6)) {
    if (typeof r?.texto !== 'string' || r.texto.trim().length < 8) continue
    const antes = (db.prepare('SELECT MAX(id) AS n FROM memoria').get() as { n: number | null }).n ?? 0
    const x = recordar(db, { texto: r.texto, tipo: r.tipo, horizonte: r.horizonte ?? null, creadaPor: 'preguntas' }, ahora)
    if (x.id > antes) pistas.push(x.texto)
  }
  const out: Pregunta[] = []
  const vistas = new Set<number>()
  for (const p of (datos.preguntas ?? []).slice(0, n)) {
    if (typeof p?.texto !== 'string' || yaCubierta(p.texto, pistas)) continue
    const q = encolarPregunta(db, { texto: p.texto, porQue: p?.por_que, tipo: p?.tipo, opciones: Array.isArray(p?.opciones) ? p.opciones : [], tema: p?.tema ?? null }, ahora)
    if (!q || vistas.has(q.id) || q.creadaEn !== ahora) continue
    vistas.add(q.id)
    out.push(q)
  }
  return out
}

let generando: Promise<unknown> | null = null
/** Si quedan pocas pendientes, arma más en segundo plano (una sola vez a la vez). */
export function reponerPreguntas(db: Db, minimo = 2) {
  if (generando || listarPreguntas(db, { estado: 'pendiente', limite: minimo }).length >= minimo) return
  generando = generarPreguntas(db).catch((e) => console.error('  preguntas:', e instanceof Error ? e.message : e)).finally(() => (generando = null))
}
export const generandoPreguntas = () => !!generando
