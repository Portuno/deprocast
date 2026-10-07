/**
 * Mastropiero pregunta: lo que le falta saber del jugador para ayudarlo mejor (sus números, su gente, sus proyectos,
 * cómo trabaja), de a una pregunta por vez. Él contesta con un toque o una línea; la respuesta pasa por el escriba
 * y queda en la memoria (y en el inventario si es algo que tiene).
 */
import { json, type Db } from './db.ts'
import { escribaDeMemoria, memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { listarEntidades } from './entidades.ts'
import { listarMisiones, principalDe, semanaDe } from './misiones.ts'

export type Pregunta = {
  id: number; texto: string; porQue: string | null; tipo: 'abierta' | 'opciones' | 'numero'; opciones: string[]; tema: string | null
  estado: 'pendiente' | 'respondida' | 'salteada'; respuesta: string | null; origen: string; creadaEn: number; respondidaEn: number | null
}

const deFila = (r: any): Pregunta => ({
  id: r.id, texto: r.texto, porQue: r.por_que, tipo: r.tipo, opciones: json(r.opciones, []), tema: r.tema, estado: r.estado,
  respuesta: r.respuesta, origen: r.origen, creadaEn: r.creada_en, respondidaEn: r.respondida_en,
})

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

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
  const n = norm(texto)
  const ya = (db.prepare(`SELECT * FROM preguntas WHERE estado != 'salteada'`).all() as any[]).find((r) => norm(r.texto) === n)
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

const SISTEMA = (n: number) => `Sos Mastropiero y preparás preguntas para conocer mejor al jugador: lo que te falta saber para ayudarlo de verdad.
- ${n} preguntas, de temas distintos: sus números (ingresos, gastos, metas de plata), su gente (quién es quién y qué rol cumple), sus proyectos (estado, próximos hitos, qué traba), cómo trabaja y descansa, gustos y referencias, fechas importantes, y lo que no te cierra de lo que sabés.
- Preguntá lo que de verdad no está en lo que sabés. Nada genérico ni de encuesta: concreto, con nombres propios cuando corresponda.
- Una pregunta por vez, corta, en castellano rioplatense, con voseo. «por_que»: una frase con para qué te sirve saberlo.
- Si se responde mejor eligiendo, dá de 2 a 5 «opciones»; si es un número, tipo «numero»; si no, «abierta».
- No repitas lo que ya preguntaste.
Forma: {"preguntas": [{"texto": string, "por_que": string, "tipo": "abierta" | "opciones" | "numero", "opciones": [string], "tema": string}]}`

/** Arma preguntas nuevas desde lo que sabe y lo que no; se encolan como pendientes. */
export async function generarPreguntas(db: Db, n = 5, ahora = Date.now()): Promise<Pregunta[]> {
  const hechas = listarPreguntas(db, { limite: 60 }).map((p) => `- ${p.texto}${p.respuesta ? ` → ${p.respuesta.slice(0, 120)}` : p.estado === 'salteada' ? ' (la salteó)' : ''}`)
  const principal = principalDe(db, 'jugador')
  const primarias = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa', 'sugerida'] })
  const gente = listarEntidades(db, { tipo: 'persona', limite: 15 }).filter((e) => e.piezas > 0).map((e) => e.nombre)
  const proyectos = listarEntidades(db, { tipo: 'proyecto', limite: 15 }).filter((e) => e.piezas > 0).map((e) => e.nombre)
  const usuario = [
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 90) || '- casi nada'}`,
    principal ? `\nSu misión principal: ${principal.titulo}` : '',
    primarias.length ? `\nSus primarias de la semana: ${primarias.map((m) => m.titulo).join(' · ')}` : '',
    gente.length ? `\nPersonas que aparecen en su material: ${gente.join(', ')}` : '',
    proyectos.length ? `\nProyectos que aparecen: ${proyectos.join(', ')}` : '',
    hechas.length ? `\nYa le preguntaste (no repitas):\n${hechas.join('\n')}` : '',
  ].filter(Boolean).join('\n')
  const { datos } = await pedirJson<{ preguntas?: any[] }>({ db, clase: 'mastropiero', agenteId: 'preguntas' }, SISTEMA(n), usuario, { temperatura: 0.7, maxTokens: 2500 })
  return (datos.preguntas ?? []).slice(0, n).map((p) => encolarPregunta(db, { texto: p?.texto, porQue: p?.por_que, tipo: p?.tipo, opciones: Array.isArray(p?.opciones) ? p.opciones : [], tema: p?.tema ?? null }, ahora))
    .filter((p): p is Pregunta => !!p)
}

let generando: Promise<unknown> | null = null
/** Si quedan pocas pendientes, arma más en segundo plano (una sola vez a la vez). */
export function reponerPreguntas(db: Db, minimo = 2) {
  if (generando || listarPreguntas(db, { estado: 'pendiente', limite: minimo }).length >= minimo) return
  generando = generarPreguntas(db).catch((e) => console.error('  preguntas:', e instanceof Error ? e.message : e)).finally(() => (generando = null))
}
export const generandoPreguntas = () => !!generando
