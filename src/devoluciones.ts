/**
 * Su feedback y lo que el sistema aprende de él (plan v24). Cada cosa que Deprocast le da —una clase, una explicación,
 * una pregunta, un visual, una fuente, una sugerencia, un proyecto, una respuesta del chat— se puede valorar (👍/👎 o
 * estrellas) con una nota. Una vez por semana (en la nube) las notas de cada superficie se destilan en «lecciones»:
 * reglas cortas de qué le sirve y qué no, que entran al prompt de esa superficie. Él las ve, las corrige o las borra;
 * las que corrigió quedan fijas. La Revisión junta las métricas: cuánto acierta cada cosa.
 */
import { fechaLocal, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'

export const SUPERFICIES: Record<string, string> = {
  clase: 'Las clases del tutor', explicacion: 'Las explicaciones', pregunta: 'Las preguntas del tutor', visual: 'Los visuales del Taller',
  fuente: 'Las fuentes que encuentra', sugerencia: 'Lo que te propone aprender', proyecto: 'Los proyectos de cada nivel', chat: 'Las respuestas de Mastropiero',
}

export type Devolucion = { id: number; superficie: string; ref: string; valor: number; nota: string | null; en: number }
export type Leccion = { id: number; superficie: string; texto: string; apoyo: number; fijada: boolean; estado: 'vigente' | 'archivada'; creadaEn: number }

/** Anota una valoración (una por cosa: la nueva reemplaza a la anterior). valor: −1/+1, o 1 a 5 estrellas. */
export function anotarDevolucion(db: Db, d: { superficie: string; ref: string | number; valor: number; nota?: string | null }, ahora = Date.now()): Devolucion {
  if (!SUPERFICIES[d.superficie]) throw new Error(`No sé valorar «${d.superficie}»`)
  const valor = Number(d.valor)
  if (!Number.isFinite(valor) || valor < -1 || valor > 5) throw new Error('El valor va de −1 a 5')
  db.prepare(`INSERT INTO devoluciones (superficie, ref, valor, nota, en) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(superficie, ref) DO UPDATE SET valor = excluded.valor, nota = COALESCE(excluded.nota, devoluciones.nota), en = excluded.en`)
    .run(d.superficie, String(d.ref), valor, d.nota?.trim().slice(0, 800) || null, ahora)
  return db.prepare('SELECT * FROM devoluciones WHERE superficie = ? AND ref = ?').get(d.superficie, String(d.ref)) as Devolucion
}

/** Que valorar nunca rompa lo que se está haciendo (los registros automáticos: aceptar, descartar, pedir otra explicación). */
export function anotarSilencioso(db: Db, d: Parameters<typeof anotarDevolucion>[1], ahora = Date.now()) {
  try { anotarDevolucion(db, d, ahora) } catch (e) { console.error('  devoluciones:', e instanceof Error ? e.message : e) }
}

/** Si fue para bien: un 👍, o 4-5 estrellas. */
const positiva = (d: { valor: number }) => d.valor === 1 || d.valor >= 4

export const leccionesDe = (db: Db, superficie?: string): Leccion[] =>
  (db.prepare(`SELECT * FROM lecciones WHERE estado = 'vigente' ${superficie ? 'AND superficie = ?' : ''} ORDER BY superficie, apoyo DESC, id`).all(...(superficie ? [superficie] : [])) as any[])
    .map((r) => ({ id: r.id, superficie: r.superficie, texto: r.texto, apoyo: r.apoyo, fijada: !!r.fijada, estado: r.estado, creadaEn: r.creada_en }))

/** Para los prompts: las lecciones vigentes de esas superficies (vacío si no hay). */
export function leccionesPara(db: Db, superficies: string | string[]): string {
  const xs = (Array.isArray(superficies) ? superficies : [superficies]).flatMap((s) => leccionesDe(db, s))
  return xs.length ? `Lo que aprendimos de sus devoluciones (respetalo):\n${xs.map((l) => `- ${l.texto}`).join('\n')}` : ''
}

/** Él corrige o borra una lección (corregida queda fija: la destilación no la toca). */
export function editarLeccion(db: Db, id: number, c: { texto?: string; borrar?: boolean }, ahora = Date.now()) {
  if (c.borrar) db.prepare(`UPDATE lecciones SET estado = 'archivada' WHERE id = ?`).run(id)
  else if (c.texto?.trim()) db.prepare('UPDATE lecciones SET texto = ?, fijada = 1, editada_en = ? WHERE id = ?').run(c.texto.trim().slice(0, 300), ahora, id)
  return leccionesDe(db)
}

const SISTEMA_LECCIONES = (sup: string) => `Mirás cómo valoró él «${SUPERFICIES[sup]}» de Deprocast (👍/👎 o estrellas, con sus notas) y escribís de 3 a 8 LECCIONES: reglas cortas y accionables de qué le sirve y qué no, para que la próxima salga mejor. Cada una en una oración, en positivo cuando se pueda («Usar analogías mecánicas», «Visuales con poco texto y un solo control»). Solo lo que se sostiene en más de una valoración o en una nota clara; nada inventado. Las que ya existen y siguen valiendo, mantenelas (podés afinarlas).
Forma: {"lecciones": [{"texto": string, "apoyo": número de valoraciones que la sostienen}]}`

/** El modelo (inyectable para tests: sin tokens). */
let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'lecciones' }, sistema, usuario, { temperatura: 0.3, maxTokens: 1500 })).datos
export function _probarLecciones(f: typeof modelo) { modelo = f }

/**
 * Destila las lecciones de cada superficie que tenga valoraciones nuevas (3 o más desde la última vez). Reemplaza las
 * no fijadas; las que él corrigió se quedan. Devuelve cuántas lecciones vigentes quedaron por superficie.
 */
export async function destilarLecciones(db: Db, ahora = Date.now()): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const sup of Object.keys(SUPERFICIES)) {
    const ultima = (db.prepare('SELECT MAX(creada_en) AS t FROM lecciones WHERE superficie = ?').get(sup) as { t: number | null }).t ?? 0
    const nuevas = (db.prepare('SELECT COUNT(*) AS n FROM devoluciones WHERE superficie = ? AND en > ?').get(sup, ultima) as { n: number }).n
    if (nuevas < 3) continue
    const ds = db.prepare('SELECT * FROM devoluciones WHERE superficie = ? ORDER BY en DESC LIMIT 60').all(sup) as Devolucion[]
    const ya = leccionesDe(db, sup)
    const r = await modelo(db, SISTEMA_LECCIONES(sup), [
      `Valoraciones (de la más nueva a la más vieja):\n${ds.map((d) => `- ${positiva(d) ? '👍' : '👎'}${d.valor > 1 ? ` (${d.valor}★)` : ''}${d.nota ? ` «${d.nota}»` : ''}`).join('\n')}`,
      ya.length ? `Lecciones de antes:\n${ya.map((l) => `- ${l.texto}${l.fijada ? ' (él la escribió: no la cambies)' : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n'))
    const xs = (Array.isArray(r?.lecciones) ? r.lecciones : []).map((l: any) => ({ texto: String(l?.texto ?? '').trim().slice(0, 300), apoyo: Math.max(1, Math.round(Number(l?.apoyo) || 1)) })).filter((l: { texto: string }) => l.texto).slice(0, 8)
    if (!xs.length) continue
    const fijadas = new Set(ya.filter((l) => l.fijada).map((l) => l.texto.toLowerCase()))
    db.prepare(`UPDATE lecciones SET estado = 'archivada' WHERE superficie = ? AND estado = 'vigente' AND fijada = 0`).run(sup)
    for (const l of xs) if (!fijadas.has(l.texto.toLowerCase())) db.prepare('INSERT INTO lecciones (superficie, texto, apoyo, creada_en) VALUES (?, ?, ?, ?)').run(sup, l.texto, l.apoyo, ahora)
    out[sup] = leccionesDe(db, sup).length
  }
  return out
}

// ─── la revisión: cuánto acierta cada cosa ──────────────────────────────

/** Cota inferior de Wilson (95 %): cuánto acierta «de verdad» con pocas muestras. */
const wilson = (si: number, n: number) => {
  if (!n) return null
  const z = 1.96, p = si / n
  return +((p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n)).toFixed(3)
}

export function revision(db: Db, ahora = Date.now()) {
  const porSuperficie = Object.entries(SUPERFICIES).map(([sup, nombre]) => {
    const ds = db.prepare('SELECT valor FROM devoluciones WHERE superficie = ?').all(sup) as { valor: number }[]
    const bien = ds.filter(positiva).length
    return { superficie: sup, nombre, n: ds.length, bien, tasa: ds.length ? +(bien / ds.length).toFixed(2) : null, cota: wilson(bien, ds.length) }
  })
  // Lo que propone aprender: aceptadas contra descartadas (el libro de decisiones).
  const dec = db.prepare(`SELECT accion, COUNT(*) AS n FROM decisiones WHERE tipo = 'aprender' GROUP BY accion`).all() as { accion: string; n: number }[]
  const aceptadas = dec.find((x) => x.accion === 'aceptada')?.n ?? 0
  const rechazadas = dec.find((x) => x.accion === 'rechazada')?.n ?? 0
  // Los visuales: estrellas y tokens por plantilla.
  const visuales = (db.prepare(`SELECT COALESCE(json_extract(a.meta, '$.plantilla'), 'libre') AS plantilla, COUNT(*) AS n, AVG(json_extract(a.meta, '$.valoracion')) AS estrellas,
      SUM(json_extract(a.meta, '$.valoracion') IS NOT NULL) AS valorados, AVG(c.tokens) AS tokens
    FROM artefactos a LEFT JOIN taller_cola c ON c.artefacto_id = a.id WHERE a.tipo = 'visual' AND a.estado = 'listo' GROUP BY plantilla ORDER BY n DESC`).all() as any[])
    .map((r) => ({ plantilla: r.plantilla, n: r.n, valorados: r.valorados, estrellas: r.estrellas == null ? null : +r.estrellas.toFixed(1), tokens: r.tokens == null ? null : Math.round(r.tokens) }))
  // Las fuentes: utilidad por sitio (lo que marcó en el material de cada dominio).
  const fuentes = (db.prepare(`SELECT c.url, f.util FROM dominio_fuentes f JOIN corpus c ON c.id = f.pieza_id WHERE f.util IS NOT NULL AND c.url LIKE 'http%'`).all() as { url: string; util: number }[])
    .reduce((m, r) => { let h = ''; try { h = new URL(r.url).hostname.replace(/^www\./, '') } catch { return m } const x = m.get(h) ?? { sitio: h, sirve: 0, noSirve: 0 }; r.util > 0 ? x.sirve++ : x.noSirve++; return m.set(h, x) }, new Map<string, { sitio: string; sirve: number; noSirve: number }>())
  // Cada dominio: cuánto domina en promedio, cuánto retiene de sus tarjetas y su ritmo.
  const dominios = (db.prepare(`SELECT a.id, a.tema, a.tutor_nivel AS nivel,
      (SELECT AVG(dominio) FROM conceptos c WHERE c.aprendizaje_id = a.id AND c.intentos > 0) AS dominio,
      (SELECT COUNT(*) FROM conceptos c WHERE c.aprendizaje_id = a.id) AS conceptos,
      (SELECT SUM(aciertos) FROM tarjetas t WHERE t.mazo = 'aprender:' || a.id) AS aciertos,
      (SELECT SUM(aciertos + fallos) FROM tarjetas t WHERE t.mazo = 'aprender:' || a.id) AS repasos
    FROM aprendizajes a WHERE a.estado = 'activo' ORDER BY a.tema`).all() as any[])
    .map((r) => ({ id: r.id, tema: r.tema, nivel: r.nivel, conceptos: r.conceptos, dominio: r.dominio == null ? null : +r.dominio.toFixed(2), retencion: r.repasos ? +(r.aciertos / r.repasos).toFixed(2) : null, repasos: r.repasos ?? 0 }))
  // El chat: 👍 por semana (las últimas 8).
  const desde = ahora - 56 * 86_400_000
  const semanas = new Map<string, { semana: string; bien: number; mal: number }>()
  for (const d of db.prepare(`SELECT valor, en FROM devoluciones WHERE superficie = 'chat' AND en >= ?`).all(desde) as { valor: number; en: number }[]) {
    const l = new Date(d.en); l.setDate(l.getDate() - ((l.getDay() + 6) % 7))
    const k = fechaLocal(l.getTime())
    const x = semanas.get(k) ?? { semana: k, bien: 0, mal: 0 }
    positiva(d) ? x.bien++ : x.mal++
    semanas.set(k, x)
  }
  return {
    porSuperficie,
    sugerencias: { aceptadas, rechazadas, cota: wilson(aceptadas, aceptadas + rechazadas) },
    visuales, fuentes: [...fuentes.values()].sort((a, b) => b.sirve + b.noSirve - a.sirve - a.noSirve).slice(0, 15),
    dominios, chat: [...semanas.values()].sort((a, b) => a.semana.localeCompare(b.semana)),
    lecciones: leccionesDe(db),
    ultimas: (db.prepare(`SELECT * FROM devoluciones WHERE nota IS NOT NULL ORDER BY en DESC LIMIT 12`).all() as Devolucion[]),
  }
}
