/**
 * El mapa de conceptos de cada dominio (plan v24): reemplaza al temario plano. Cada concepto tiene su nivel (1 a 6), sus
 * requisitos (otros conceptos) y cuánto lo domina él (0 a 1), que sube con aciertos, baja con errores y se apaga con el
 * tiempo (cada concepto vuelve a repaso como una tarjeta). La próxima clase es la «frontera»: lo que menos domina entre lo
 * que ya tiene los requisitos. Con una fecha y un nivel de meta, el ritmo dice cuántas clases por semana hacen falta.
 * Acá no hay modelo: lo que arma el mapa (con el modelo) vive en academia.ts.
 */
import { fechaLocal, json, type Db } from './db.ts'

export type Concepto = {
  id: number; aprendizajeId: number; nombre: string; nivel: number; orden: number; requisitos: number[]; dominio: number
  aciertos: number; intentos: number; vistoEn: number | null; venceEn: number | null; sinMaterial: boolean | null
}
const deFila = (r: any): Concepto => ({
  id: r.id, aprendizajeId: r.aprendizaje_id, nombre: r.nombre, nivel: r.nivel, orden: r.orden, requisitos: json<number[]>(r.requisitos, []) ?? [], dominio: r.dominio,
  aciertos: r.aciertos, intentos: r.intentos, vistoEn: r.visto_en, venceEn: r.vence_en, sinMaterial: r.sin_material == null ? null : !!r.sin_material,
})

const DIA = 86_400_000
/** Desde cuánto se considera sabido (para los requisitos, el examen y el ritmo). */
export const SABIDO = 0.7
const clave = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim()

export const conceptosDe = (db: Db, id: number): Concepto[] =>
  db.prepare('SELECT * FROM conceptos WHERE aprendizaje_id = ? ORDER BY nivel, orden, id').all(id).map(deFila)
export const leerConcepto = (db: Db, cid: number): Concepto | null => { const r = db.prepare('SELECT * FROM conceptos WHERE id = ?').get(cid); return r ? deFila(r) : null }
export function conceptoPorNombre(db: Db, id: number, nombre: string): Concepto | null {
  const k = clave(nombre)
  return conceptosDe(db, id).find((c) => clave(c.nombre) === k) ?? null
}

/** Lo que domina hoy: si ya le tocaba repasarlo, un poco menos (se apaga con el tiempo). */
export const dominioHoy = (c: Concepto, ahora = Date.now()) => (c.venceEn && ahora > c.venceEn ? c.dominio * (ahora - c.venceEn > 14 * DIA ? 0.75 : 0.85) : c.dominio)

/**
 * Guarda el mapa (lo que armó el modelo): los conceptos que ya existían conservan lo que sabe de ellos; los nuevos entran
 * en 0; los que ya no están y nunca se tocaron se van (lo tocado se queda: es suyo). Los requisitos van por nombre.
 */
export function guardarMapa(db: Db, id: number, items: { nombre: string; nivel: number; requisitos?: string[] }[], ahora = Date.now()): Concepto[] {
  const limpios = items.map((x) => ({ nombre: String(x.nombre ?? '').trim().slice(0, 120), nivel: Math.max(1, Math.min(6, Math.round(Number(x.nivel) || 1))), requisitos: (x.requisitos ?? []).map(String) }))
    .filter((x, i, xs) => x.nombre && xs.findIndex((y) => clave(y.nombre) === clave(x.nombre)) === i)
  if (!limpios.length) return conceptosDe(db, id)
  const antes = new Map(conceptosDe(db, id).map((c) => [clave(c.nombre), c]))
  const nuevos = new Set(limpios.map((x) => clave(x.nombre)))
  db.exec('BEGIN')
  try {
    for (const c of antes.values()) if (!nuevos.has(clave(c.nombre)) && !c.intentos) db.prepare('DELETE FROM conceptos WHERE id = ?').run(c.id)
    const orden: Record<number, number> = {}
    for (const x of limpios) {
      const o = (orden[x.nivel] = (orden[x.nivel] ?? -1) + 1)
      const ya = antes.get(clave(x.nombre))
      if (ya) db.prepare('UPDATE conceptos SET nombre = ?, nivel = ?, orden = ? WHERE id = ?').run(x.nombre, x.nivel, o, ya.id)
      else db.prepare('INSERT INTO conceptos (aprendizaje_id, nombre, nivel, orden, requisitos, creado_en) VALUES (?, ?, ?, ?, ?, ?)').run(id, x.nombre, x.nivel, o, '[]', ahora)
    }
    const porClave = new Map(conceptosDe(db, id).map((c) => [clave(c.nombre), c]))
    for (const x of limpios) {
      const c = porClave.get(clave(x.nombre))!
      // Un requisito tiene que ser de su nivel o de uno anterior (si no, no se podría empezar nunca).
      const req = x.requisitos.map((r) => porClave.get(clave(r))).filter((r) => r && r.id !== c.id && r.nivel <= c.nivel).map((r) => r!.id)
      db.prepare('UPDATE conceptos SET requisitos = ? WHERE id = ?').run(JSON.stringify([...new Set(req)]), c.id)
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return conceptosDe(db, id)
}

/** Los temarios del v23 pasan a conceptos (en fila: cada tema pide el anterior); lo ya visto queda sabido a medias. */
export function deTemario(db: Db, id: number, temario: Record<string, string[]>, temaIdx: number, nivelActual: number, ahora = Date.now()): Concepto[] {
  const items = Object.entries(temario).flatMap(([n, temas]) => temas.map((t, i) => ({ nombre: t, nivel: Number(n), requisitos: i ? [temas[i - 1]] : [] })))
  const cs = guardarMapa(db, id, items, ahora)
  for (const c of cs) {
    const visto = c.nivel < nivelActual || (c.nivel === nivelActual && c.orden < temaIdx)
    if (visto) db.prepare('UPDATE conceptos SET dominio = MAX(dominio, ?), visto_en = ?, vence_en = ? WHERE id = ?').run(SABIDO, ahora, ahora + 3 * DIA, c.id)
  }
  return conceptosDe(db, id)
}

/**
 * La frontera: entre lo de su nivel (o de antes) que todavía no aprendió, lo que tiene sus requisitos, en el orden del
 * mapa (primero lo de abajo). Mira lo aprendido alguna vez (no lo que se fue apagando: eso vuelve por el repaso intercalado, no frena el avance).
 */
export function frontera(db: Db, id: number, nivel: number, _ahora = Date.now()): Concepto | null {
  const cs = conceptosDe(db, id)
  const porId = new Map(cs.map((c) => [c.id, c]))
  return cs.filter((c) => c.nivel <= nivel && c.dominio < SABIDO && c.requisitos.every((r) => !porId.has(r) || porId.get(r)!.dominio >= SABIDO))
    .sort((a, b) => a.nivel - b.nivel || a.orden - b.orden)[0] ?? null
}

/** Lo que ya vio y le toca repasar (para intercalar en las clases): este dominio primero, después los demás activos. */
export function conceptosParaRepasar(db: Db, o: { aprendizajeId: number; excepto?: number[]; limite?: number }, ahora = Date.now()): (Concepto & { dominioTema: string })[] {
  const filas = db.prepare(`SELECT c.*, a.tema AS dominio_tema FROM conceptos c JOIN aprendizajes a ON a.id = c.aprendizaje_id
    WHERE a.estado = 'activo' AND c.intentos > 0 AND c.vence_en IS NOT NULL AND c.vence_en <= ? ORDER BY c.aprendizaje_id = ? DESC, c.vence_en LIMIT 20`).all(ahora, o.aprendizajeId) as any[]
  const fuera = new Set(o.excepto ?? [])
  return filas.map((r) => ({ ...deFila(r), dominioTema: r.dominio_tema })).filter((c) => !fuera.has(c.id)).slice(0, o.limite ?? 2)
}

/** Una respuesta mueve el dominio: un acierto lo acerca a 1, un error lo baja (la primera respuesta a cada pregunta cuenta). */
export function anotarRespuesta(db: Db, cid: number, correcto: boolean, ahora = Date.now()) {
  const c = leerConcepto(db, cid)
  if (!c) return
  const d = correcto ? c.dominio + (1 - c.dominio) * 0.35 : c.dominio * 0.6
  db.prepare('UPDATE conceptos SET dominio = ?, intentos = intentos + 1, aciertos = aciertos + ?, visto_en = ? WHERE id = ?').run(+d.toFixed(3), correcto ? 1 : 0, ahora, cid)
}

/** Cuándo vuelve: lo que sabe poco, mañana; lo firme, en dos semanas (como el repaso espaciado). */
export function programarRepaso(db: Db, cid: number, ahora = Date.now()) {
  const c = leerConcepto(db, cid)
  if (!c) return
  const dias = c.dominio < 0.5 ? 1 : c.dominio < SABIDO ? 3 : c.dominio < 0.85 ? 7 : 16
  db.prepare('UPDATE conceptos SET visto_en = ?, vence_en = ? WHERE id = ?').run(ahora, ahora + dias * DIA, cid)
}

/** Una aclaración («no entendí») baja un poco lo que creía saber de ese concepto. */
export function bajarDominio(db: Db, cid: number, factor = 0.85) {
  db.prepare('UPDATE conceptos SET dominio = dominio * ? WHERE id = ?').run(factor, cid)
}

/** Lo de los niveles de abajo queda sabido (por el diagnóstico o al subir de nivel); vuelve pronto a repaso para confirmarlo. */
export function marcarSabidos(db: Db, id: number, hastaNivel: number, piso = SABIDO, ahora = Date.now()) {
  db.prepare('UPDATE conceptos SET dominio = MAX(dominio, ?), visto_en = COALESCE(visto_en, ?), vence_en = COALESCE(vence_en, ?) WHERE aprendizaje_id = ? AND nivel <= ?')
    .run(piso, ahora, ahora + 7 * DIA, id, hastaNivel)
}

export const nivelSabido = (db: Db, id: number, nivel: number, ahora = Date.now()) => {
  const cs = conceptosDe(db, id).filter((c) => c.nivel === nivel)
  return cs.length > 0 && cs.every((c) => dominioHoy(c, ahora) >= SABIDO)
}

// ─── el ritmo: el plan hacia atrás desde una fecha ──────────────────────

export type Ritmo = {
  fecha: string; nivel: number; pendientes: number; semanas: number; porSemana: number; inicial: number | null; hechasSemana: number; faltanSemana: number
  estado: 'lograda' | 'vencida' | 'al_dia' | 'atrasado'; texto: string
}

const lunes = (ahora: number) => { const d = new Date(ahora); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() }

/** Cuántas clases faltan para llegar al nivel de la meta: los conceptos sin saber hasta ese nivel y un examen por nivel. */
function pendientesHasta(db: Db, id: number, nivelActual: number, nivelMeta: number, ahora: number) {
  const conceptos = conceptosDe(db, id).filter((c) => c.nivel <= nivelMeta && dominioHoy(c, ahora) < SABIDO).length
  return conceptos + Math.max(0, nivelMeta - nivelActual)
}

/**
 * El ritmo hacia la meta: cuántas clases por semana hacen falta de acá a la fecha, cuántas hizo esta semana y si va al
 * día (comparado con lo que pedía cuando fijó la meta). null si no tiene meta.
 */
export function ritmoDe(db: Db, d: { id: number; tutorNivel: number; tema: string }, ahora = Date.now()): Ritmo | null {
  const m = db.prepare('SELECT meta_fecha, meta_nivel, meta_inicial FROM aprendizajes WHERE id = ?').get(d.id) as { meta_fecha: string | null; meta_nivel: number | null; meta_inicial: number | null } | undefined
  if (!m?.meta_fecha || !m.meta_nivel) return null
  const hoy = fechaLocal(ahora)
  const pendientes = pendientesHasta(db, d.id, d.tutorNivel, m.meta_nivel, ahora)
  const fin = new Date(`${m.meta_fecha}T23:59:59`).getTime()
  const semanas = Math.max(1, Math.ceil((fin - ahora) / (7 * DIA)))
  const porSemana = Math.ceil(pendientes / semanas)
  const hechasSemana = (db.prepare(`SELECT COUNT(*) AS n FROM tutor_sesiones WHERE aprendizaje_id = ? AND estado = 'hecha' AND tipo IN ('clase', 'examen') AND cerrada_en >= ?`).get(d.id, lunes(ahora)) as { n: number }).n
  const faltanSemana = Math.max(0, porSemana - hechasSemana)
  const lograda = d.tutorNivel > m.meta_nivel || pendientes === 0
  const estado: Ritmo['estado'] = lograda ? 'lograda' : m.meta_fecha < hoy ? 'vencida' : m.meta_inicial != null && porSemana > m.meta_inicial ? 'atrasado' : 'al_dia'
  const fechaCorta = new Date(`${m.meta_fecha}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })
  const texto = estado === 'lograda' ? `Meta cumplida: nivel ${m.meta_nivel}`
    : estado === 'vencida' ? `La meta (nivel ${m.meta_nivel} para el ${fechaCorta}) ya pasó: faltaron ${pendientes} clases`
    : `Nivel ${m.meta_nivel} para el ${fechaCorta}: ${porSemana} clase${porSemana === 1 ? '' : 's'} por semana${estado === 'atrasado' ? ` (arrancaste con ${m.meta_inicial}: vas atrasado)` : ''} · ${faltanSemana ? `falta${faltanSemana === 1 ? '' : 'n'} ${faltanSemana} esta semana` : 'esta semana, al día'}`
  return { fecha: m.meta_fecha, nivel: m.meta_nivel, pendientes, semanas, porSemana, inicial: m.meta_inicial, hechasSemana, faltanSemana, estado, texto }
}

/** Fija (o saca) la meta: una fecha y el nivel al que quiere llegar. Guarda el ritmo de arranque para saber si se atrasa. */
export function fijarMeta(db: Db, d: { id: number; tutorNivel: number }, m: { fecha: string | null; nivel?: number | null }, ahora = Date.now()) {
  if (!m.fecha) return void db.prepare('UPDATE aprendizajes SET meta_fecha = NULL, meta_nivel = NULL, meta_inicial = NULL WHERE id = ?').run(d.id)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.fecha)) throw new Error('La fecha va como AAAA-MM-DD')
  if (m.fecha < fechaLocal(ahora)) throw new Error('Esa fecha ya pasó')
  const nivel = Math.max(d.tutorNivel, Math.min(6, Math.round(Number(m.nivel) || Math.min(6, d.tutorNivel + 1))))
  const semanas = Math.max(1, Math.ceil((new Date(`${m.fecha}T23:59:59`).getTime() - ahora) / (7 * DIA)))
  const inicial = Math.ceil(pendientesHasta(db, d.id, d.tutorNivel, nivel, ahora) / semanas)
  db.prepare('UPDATE aprendizajes SET meta_fecha = ?, meta_nivel = ?, meta_inicial = ? WHERE id = ?').run(m.fecha, nivel, inicial, d.id)
}
