/**
 * Salud: lo que come (con kcal y macros estimadas), el ejercicio, el sueño y las medidas (peso). Entra por foto o texto
 * (Telegram, el chat, la pantalla) y se compara con sus metas (ajustes salud_*; vacío = sin meta). Lo usan la Brújula
 * («Cuerpo»), el audio de la mañana, el chat y las alertas.
 */
import { ajuste, fechaLocal, fijarAjuste, json, type Db } from './db.ts'

export const TIPOS_SALUD = ['comida', 'ejercicio', 'sueno', 'medida', 'sintoma', 'otro'] as const
export type TipoSalud = (typeof TIPOS_SALUD)[number]
export type RegistroSalud = { id: number; fecha: string; hora: string | null; tipo: TipoSalud; titulo: string; datos: Record<string, any>; foto: string | null; fuente: string; creadoEn: number }

const deFila = (r: any): RegistroSalud => ({ id: r.id, fecha: r.fecha, hora: r.hora, tipo: r.tipo, titulo: r.titulo, datos: json(r.datos, {}), foto: r.foto, fuente: r.fuente, creadoEn: r.creado_en })

/** Los campos numéricos que se guardan, por tipo (lo demás se descarta). */
const CAMPOS: Record<TipoSalud, string[]> = {
  comida: ['kcal', 'proteina', 'carbos', 'grasa'],
  ejercicio: ['minutos', 'distancia_km', 'kcal', 'series', 'intensidad'],
  sueno: ['horas', 'calidad'],
  medida: ['peso', 'grasa_corporal', 'cintura'],
  sintoma: ['intensidad'],
  otro: [],
}
const TEXTOS = ['items', 'intensidad_texto', 'nota', 'que']

function limpiarDatos(tipo: TipoSalud, d: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of CAMPOS[tipo]) {
    const v = typeof d[k] === 'string' ? Number(String(d[k]).replace(',', '.')) : d[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.round(v * 10) / 10
  }
  if (tipo === 'ejercicio' && typeof d.intensidad === 'string') out.intensidad_texto = d.intensidad.slice(0, 30)
  if (tipo === 'sueno' && out.calidad != null) out.calidad = Math.min(3, Math.max(1, Math.round(Number(out.calidad))))
  for (const k of TEXTOS) {
    if (Array.isArray(d[k])) out[k] = (d[k] as unknown[]).map(String).filter(Boolean).slice(0, 12)
    else if (typeof d[k] === 'string' && (d[k] as string).trim()) out[k] = (d[k] as string).trim().slice(0, 400)
  }
  return out
}

const tipoValido = (t: unknown): TipoSalud => (TIPOS_SALUD as readonly string[]).includes(String(t)) ? t as TipoSalud : 'otro'
const TITULO: Record<TipoSalud, string> = { comida: 'Comida', ejercicio: 'Ejercicio', sueno: 'Sueño', medida: 'Medida', sintoma: 'Síntoma', otro: 'Nota' }

export function leerSalud(db: Db, id: number): RegistroSalud | null {
  const r = db.prepare('SELECT * FROM salud WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

/** Anota un registro. El sueño es uno por día: si ya hay, se completa ese (horas y calidad pueden llegar por separado). */
export function registrarSalud(db: Db, r: { tipo: string; titulo?: string | null; fecha?: string | null; hora?: string | null; datos?: Record<string, unknown>; foto?: string | null; fuente?: string }, ahora = Date.now()): RegistroSalud {
  const tipo = tipoValido(r.tipo)
  const fecha = r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) ? r.fecha : fechaLocal(ahora)
  const hora = r.hora && /^\d{1,2}:\d{2}$/.test(r.hora) ? r.hora.padStart(5, '0') : tipo === 'sueno' ? null : new Date(ahora).toTimeString().slice(0, 5)
  const datos = limpiarDatos(tipo, r.datos)
  const titulo = String(r.titulo ?? '').trim().slice(0, 160) || (tipo === 'sueno' && datos.horas != null ? `Dormiste ${datos.horas} h` : TITULO[tipo])
  if (tipo === 'sueno') {
    const ya = db.prepare(`SELECT * FROM salud WHERE tipo = 'sueno' AND fecha = ?`).get(fecha) as any
    if (ya) {
      const junto = { ...json<Record<string, unknown>>(ya.datos, {}), ...datos }
      db.prepare('UPDATE salud SET datos = ?, titulo = ? WHERE id = ?').run(JSON.stringify(junto), junto.horas != null ? `Dormiste ${junto.horas} h` : ya.titulo, ya.id)
      return leerSalud(db, ya.id)!
    }
  }
  const res = db.prepare('INSERT INTO salud (fecha, hora, tipo, titulo, datos, foto, fuente, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(fecha, hora, tipo, titulo, JSON.stringify(datos), r.foto ?? null, r.fuente ?? 'manual', ahora)
  return leerSalud(db, Number(res.lastInsertRowid))!
}

export function editarSalud(db: Db, id: number, c: { titulo?: string; fecha?: string; hora?: string; datos?: Record<string, unknown> }): RegistroSalud {
  const r = leerSalud(db, id)
  if (!r) throw new Error(`No existe el registro ${id}`)
  const datos = c.datos ? { ...r.datos, ...limpiarDatos(r.tipo, c.datos) } : r.datos
  db.prepare('UPDATE salud SET titulo = ?, fecha = ?, hora = ?, datos = ? WHERE id = ?')
    .run(c.titulo?.trim() || r.titulo, c.fecha && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) ? c.fecha : r.fecha, c.hora ?? r.hora, JSON.stringify(datos), id)
  return leerSalud(db, id)!
}

export function borrarSalud(db: Db, id: number) {
  db.prepare('DELETE FROM salud WHERE id = ?').run(id)
}

export function listarSalud(db: Db, f: { fecha?: string; desde?: string; hasta?: string; tipo?: string; limite?: number } = {}): RegistroSalud[] {
  const cond: string[] = []
  const args: (string | number)[] = []
  if (f.fecha) { cond.push('fecha = ?'); args.push(f.fecha) }
  if (f.desde) { cond.push('fecha >= ?'); args.push(f.desde) }
  if (f.hasta) { cond.push('fecha <= ?'); args.push(f.hasta) }
  if (f.tipo) { cond.push('tipo = ?'); args.push(f.tipo) }
  return db.prepare(`SELECT * FROM salud ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY fecha DESC, hora DESC, id DESC LIMIT ?`).all(...args, f.limite ?? 300).map(deFila)
}

// ─── metas y resúmenes ──────────────────────────────────────────────────

export const CLAVES_METAS = { kcal: 'salud_kcal_dia', proteina: 'salud_proteina_dia', sueno: 'salud_sueno_horas', entrenos: 'salud_entrenos_semana', peso: 'salud_peso_objetivo' } as const
export type Metas = Record<keyof typeof CLAVES_METAS, number | null>

export function metasSalud(db: Db): Metas {
  const n = (k: string) => { const v = Number(ajuste(db, k)); return Number.isFinite(v) && v > 0 ? v : null }
  return { kcal: n(CLAVES_METAS.kcal), proteina: n(CLAVES_METAS.proteina), sueno: n(CLAVES_METAS.sueno), entrenos: n(CLAVES_METAS.entrenos), peso: n(CLAVES_METAS.peso) }
}

export function fijarMetasSalud(db: Db, m: Partial<Record<keyof typeof CLAVES_METAS, number | string | null>>): Metas {
  for (const [k, clave] of Object.entries(CLAVES_METAS)) {
    const v = m[k as keyof typeof CLAVES_METAS]
    if (v === undefined) continue
    const n = Number(v)
    fijarAjuste(db, clave, v === null || v === '' || !Number.isFinite(n) || n <= 0 ? '' : String(n))
  }
  return metasSalud(db)
}

const suma = (rs: RegistroSalud[], k: string) => Math.round(rs.reduce((s, r) => s + (Number(r.datos[k]) || 0), 0))
const corrida = (fecha: string, dias: number) => { const [a, m, d] = fecha.split('-').map(Number); return fechaLocal(new Date(a, m - 1, d + dias, 12).getTime()) }

/** El último peso anotado hasta esa fecha. */
function pesoHasta(db: Db, fecha: string): { peso: number; fecha: string } | null {
  for (const r of listarSalud(db, { tipo: 'medida', hasta: fecha, limite: 20 })) if (typeof r.datos.peso === 'number') return { peso: r.datos.peso, fecha: r.fecha }
  return null
}

export function resumenDia(db: Db, fecha = fechaLocal()) {
  const rs = listarSalud(db, { fecha })
  const comidas = rs.filter((r) => r.tipo === 'comida')
  const ejercicio = rs.filter((r) => r.tipo === 'ejercicio')
  const sueno = rs.find((r) => r.tipo === 'sueno') ?? null
  return {
    fecha, metas: metasSalud(db),
    comidas: comidas.length, kcal: suma(comidas, 'kcal'), proteina: suma(comidas, 'proteina'), carbos: suma(comidas, 'carbos'), grasa: suma(comidas, 'grasa'),
    ejercicio: { sesiones: ejercicio.length, minutos: suma(ejercicio, 'minutos'), titulos: ejercicio.map((e) => e.titulo) },
    sueno: sueno ? { horas: sueno.datos.horas ?? null, calidad: sueno.datos.calidad ?? null } : null,
    peso: pesoHasta(db, fecha), registros: rs,
  }
}

/** Los 7 días que terminan en «hasta»: por día y promedios. */
export function resumenSemana(db: Db, hasta = fechaLocal()) {
  const dias = Array.from({ length: 7 }, (_, i) => corrida(hasta, i - 6)).map((f) => {
    const d = resumenDia(db, f)
    return { fecha: f, comidas: d.comidas, kcal: d.kcal, proteina: d.proteina, minutos: d.ejercicio.minutos, entreno: d.ejercicio.sesiones > 0, sueno: d.sueno?.horas ?? null }
  })
  const conComida = dias.filter((d) => d.comidas)
  const conSueno = dias.filter((d) => d.sueno != null)
  const prom = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null)
  const pesoFin = pesoHasta(db, hasta)
  const pesoIni = pesoHasta(db, corrida(hasta, -7))
  return {
    desde: dias[0].fecha, hasta, dias, metas: metasSalud(db),
    kcalPromedio: prom(conComida.map((d) => d.kcal)), proteinaPromedio: prom(conComida.map((d) => d.proteina)),
    entrenos: dias.filter((d) => d.entreno).length, minutos: dias.reduce((s, d) => s + d.minutos, 0),
    suenoPromedio: prom(conSueno.map((d) => d.sueno!)),
    peso: pesoFin ? { actual: pesoFin.peso, cambio: pesoIni && pesoIni.fecha !== pesoFin.fecha ? Math.round((pesoFin.peso - pesoIni.peso) * 10) / 10 : null } : null,
  }
}

const deMeta = (v: number, meta: number | null, u = '') => `${v}${u}${meta ? ` de ${meta}${u}` : ''}`

/** Para Mastropiero: cómo viene su cuerpo (ayer, hoy y la semana), si hay datos. */
export function saludParaPrompt(db: Db, ahora = Date.now()): string {
  const hoy = fechaLocal(ahora)
  const ayer = corrida(hoy, -1)
  const s = resumenSemana(db, hoy)
  if (!s.dias.some((d) => d.comidas || d.minutos || d.sueno != null) && !s.peso) return ''
  const linea = (f: string, et: string) => {
    const d = resumenDia(db, f)
    const partes = [
      d.comidas ? `comió ${deMeta(d.kcal, d.metas.kcal, ' kcal')} y ${deMeta(d.proteina, d.metas.proteina, ' g')} de proteína (${d.comidas} comidas anotadas)` : '',
      d.ejercicio.sesiones ? `entrenó ${d.ejercicio.minutos} min (${d.ejercicio.titulos.join(', ')})` : '',
      d.sueno?.horas != null ? `durmió ${d.sueno.horas} h${d.sueno.calidad ? ` (${['', 'mal', 'bien', 'muy bien'][d.sueno.calidad]})` : ''}` : '',
    ].filter(Boolean)
    return partes.length ? `${et}: ${partes.join('; ')}.` : ''
  }
  return [
    'Su cuerpo:',
    linea(ayer, 'Ayer'), linea(hoy, 'Hoy hasta ahora'),
    `Semana: ${s.entrenos} días con ejercicio${s.metas.entrenos ? ` de ${s.metas.entrenos}` : ''}${s.suenoPromedio != null ? `, duerme ${s.suenoPromedio} h en promedio${s.metas.sueno ? ` (meta ${s.metas.sueno})` : ''}` : ''}${s.kcalPromedio != null ? `, ${s.kcalPromedio} kcal por día anotado` : ''}.`,
    s.peso ? `Peso: ${s.peso.actual} kg${s.peso.cambio != null ? ` (${s.peso.cambio > 0 ? '+' : ''}${s.peso.cambio} en la semana)` : ''}${s.metas.peso ? `, objetivo ${s.metas.peso}` : ''}.` : '',
  ].filter(Boolean).join(' ')
}

/** Alertas de salud (sin modelo), con la misma forma que las de alertas.ts: una por clave y día. */
export function alertasSalud(db: Db, ahora = Date.now()): { clave: string; texto: string }[] {
  const hoy = fechaLocal(ahora)
  const hora = new Date(ahora).getHours()
  const d = resumenDia(db, hoy)
  const out: { clave: string; texto: string }[] = []
  if (hora >= 20 && d.metas.proteina && d.comidas && d.proteina < d.metas.proteina * 0.5) {
    out.push({ clave: `salud:proteina:${hoy}`, texto: `Vas ${d.proteina} g de proteína de ${d.metas.proteina}. Si cenás, que tenga proteína.` })
  }
  if (d.metas.entrenos && hora >= 12) {
    const sin = [0, 1, 2].every((n) => !resumenDia(db, corrida(hoy, -n)).ejercicio.sesiones)
    const anota = listarSalud(db, { desde: corrida(hoy, -14), limite: 1 }).length > 0 // solo si viene anotando: si no, no sabemos
    if (sin && anota) out.push({ clave: `salud:entreno:${hoy}`, texto: 'Van tres días sin ejercicio anotado. ¿Diez minutos hoy, aunque sea? (Nunca dos veces seguidas.)' })
  }
  const dosNoches = [0, 1].map((n) => resumenDia(db, corrida(hoy, -n)).sueno?.horas)
  if (dosNoches.every((h) => typeof h === 'number' && h < 6)) out.push({ clave: `salud:sueno:${hoy}`, texto: `Dos noches seguidas durmiendo menos de 6 horas (${dosNoches.join(' y ')}). Hoy, a la cama temprano: lo demás rinde peor así.` })
  return out
}
