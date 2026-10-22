/**
 * Qué usa de verdad: las vistas que abre, las herramientas que Mastropiero corre por él y el rastro que deja cada
 * módulo (registros de salud, movimientos, votos, runs…). Para que «rankeame las funciones» se conteste con datos.
 */
import type { Db } from './db.ts'

export function anotarUso(db: Db, tipo: 'vista' | 'herramienta' | 'telegram', nombre: string, ahora = Date.now()) {
  if (!/^[\w.-]{1,60}$/.test(nombre)) return
  db.prepare('INSERT INTO uso (tipo, nombre, en) VALUES (?, ?, ?)').run(tipo, nombre, ahora)
}

/** El rastro de cada módulo en el período: cuántas cosas dejó (tabla, columna de fecha, en ms o en YYYY-MM-DD). */
const RASTRO: [string, string, string, 'ms' | 'fecha'][] = [
  ['Runs', 'runs', 'creada_en', 'ms'],
  ['Salud (registros)', 'salud', 'creado_en', 'ms'],
  ['Plata (movimientos)', 'movimientos', 'creado_en', 'ms'],
  ['Aprender (prácticas)', 'practicas', 'creado_en', 'ms'],
  ['Directo (sesiones)', 'directo_sesiones', 'inicio', 'ms'],
  ['Cargas', 'cargas', 'creada_en', 'ms'],
  ['Tandas (audios y páginas)', 'tandas', 'creada_en', 'ms'],
  ['Cuadernos (notas)', 'cuaderno_notas', 'creada_en', 'ms'],
  ['Taller (creaciones)', 'artefactos', 'creado_en', 'ms'],
  ['Radar (oportunidades)', 'oportunidades', 'creada_en', 'ms'],
  ['Brújula', 'brujulas', 'creada_en', 'ms'],
  ['Corpus (piezas nuevas)', 'corpus', 'creado_en', 'ms'],
  ['Chat (mensajes tuyos)', 'mensajes', 'en', 'ms'],
]

export function verUso(db: Db, dias = 30, ahora = Date.now()) {
  const desde = ahora - Math.max(1, Math.min(365, dias)) * 86_400_000
  const ranking = (tipo: string) => (db.prepare('SELECT nombre, COUNT(*) AS veces, MAX(en) AS ultima FROM uso WHERE tipo = ? AND en >= ? GROUP BY nombre ORDER BY veces DESC, nombre').all(tipo, desde) as { nombre: string; veces: number; ultima: number }[])
    .map((r) => ({ nombre: r.nombre, veces: r.veces, ultima: new Date(r.ultima).toISOString().slice(0, 10) }))
  const rastro = RASTRO.map(([nombre, tabla, col]) => {
    try {
      const extra = tabla === 'mensajes' ? ` AND rol = 'operador'` : ''
      return { modulo: nombre, cosas: (db.prepare(`SELECT COUNT(*) AS n FROM "${tabla}" WHERE "${col}" >= ?${extra}`).get(desde) as { n: number }).n }
    } catch {
      return { modulo: nombre, cosas: 0 }
    }
  }).sort((a, b) => b.cosas - a.cosas)
  const desdeCuando = (db.prepare('SELECT MIN(en) AS n FROM uso').get() as { n: number | null }).n
  return {
    dias, vistas: ranking('vista'), herramientas: ranking('herramienta'), telegram: ranking('telegram'), rastro,
    nota: desdeCuando ? `Las vistas y herramientas se cuentan desde ${new Date(desdeCuando).toISOString().slice(0, 10)}; el rastro de cada módulo, de todo el período.` : 'Las vistas y herramientas recién se empiezan a contar; el rastro de cada módulo sí cuenta todo el período.',
  }
}
