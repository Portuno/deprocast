/**
 * Adiós a los Cien Días (plan v23): una sola vez, al arrancar. Lo que el plan sabía de él pasa al corpus como suyo
 * (los frentes con qué es ganar y su principio, lo que practicaba, los focos de cada semana, sus notas y WOOP), los
 * frentes y los hábitos con forma de tema quedan como dominios, se guarda un respaldo con todo y se borran sus tablas.
 * Los votos y las tildes de cada día no son conocimiento: quedan solo en el respaldo. Si las tablas ya no están, no hace
 * nada.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fechaLocal, json, type Db } from './db.ts'
import { asegurarPorNombre } from './entidades.ts'
import { ingerir } from './mastropiero.ts'

const TABLAS = ['planes', 'frentes', 'habitos', 'plan_dias', 'plan_semanas', 'plan_tareas'] as const
const existe = (db: Db, t: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t)
const DIAS = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

export type Migracion = { respaldo: string | null; piezas: number; dominios: number; borradas: string[] }

export function migrarCien(db: Db, o: { respaldos?: string | null; ahora?: number } = {}): Migracion | null {
  if (!existe(db, 'planes')) return null
  const ahora = o.ahora ?? Date.now()
  const filas = Object.fromEntries(TABLAS.filter((t) => existe(db, t)).map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()])) as Record<string, any[]>

  // 1. El respaldo: todo, tal cual (por si algo no se pasó bien, se puede volver a leer).
  let respaldo: string | null = null
  if (o.respaldos) {
    fs.mkdirSync(o.respaldos, { recursive: true })
    respaldo = path.join(o.respaldos, `cien-dias-${fechaLocal(ahora)}.json`)
    fs.writeFileSync(respaldo, JSON.stringify({ exportado: new Date(ahora).toISOString(), tablas: filas }, null, 2))
  }

  // 2. Al corpus, como suyo.
  let piezas = 0
  const guardar = (titulo: string, contenido: string, origenId: string) => {
    if (!contenido.trim()) return
    ingerir(db, { fuente: 'operador', nivel: 'propia', titulo, contenido, dominio: 'aprendizaje', origenId, meta: { de: 'cien-dias' } }, ahora)
    piezas++
  }
  const habitos = filas.habitos ?? []
  const semanas = filas.plan_semanas ?? []
  const ritmo = (h: any) => {
    const dias = json<number[]>(h.dias, [])
    return dias.length ? dias.map((d) => DIAS[d] ?? d).join(', ') : `${h.por_semana} por semana`
  }
  for (const plan of filas.planes ?? []) {
    for (const f of (filas.frentes ?? []).filter((x) => x.plan_id === plan.id).sort((a, b) => a.orden - b.orden)) {
      const suyos = habitos.filter((h) => h.frente_id === f.id)
      guardar(`Frente: ${f.nombre}`, [
        `# ${f.nombre}${f.corto && f.corto !== f.nombre ? ` (${f.corto})` : ''}`,
        f.ganar ? `**Qué es ganar:** ${f.ganar}` : '',
        f.principio ? `**Principio:** ${f.principio}` : '',
        suyos.length ? `**Lo que practicaba para esto:**\n${suyos.map((h) => `- ${h.titulo} (${ritmo(h)})`).join('\n')}` : '',
        `_Del plan «${plan.nombre}» (${plan.desde} → ${plan.hasta})._`,
      ].filter(Boolean).join('\n\n'), `frente:${f.id}`)
    }
    const focos = semanas.filter((s) => s.plan_id === plan.id).sort((a, b) => a.n - b.n)
    if (focos.length) guardar(`Los focos de cada semana (${plan.nombre})`, `# Los focos de cada semana\n\n${focos.map((s) => `- Semana ${s.n}: ${s.foco}`).join('\n')}`, `plan-focos:${plan.id}`)
  }
  if (habitos.length) {
    const nombreFrente = new Map((filas.frentes ?? []).map((f) => [f.id, f.nombre]))
    guardar('Lo que practicaba', `# Lo que practicaba\n\n${habitos.map((h) => `- ${h.titulo} — ${ritmo(h)}${h.frente_id && nombreFrente.get(h.frente_id) ? ` · ${nombreFrente.get(h.frente_id)}` : ''}${h.activo ? '' : ' (lo había dejado)'}`).join('\n')}`, 'plan-habitos')
  }
  const notas = (filas.plan_dias ?? []).filter((d) => d.nota?.trim() || d.woop).sort((a, b) => a.fecha.localeCompare(b.fecha)).map((d) => {
    const w = json<{ w?: string; o?: string; ob?: string; p?: string } | null>(d.woop, null)
    return [`## ${d.fecha}`, w?.w ? `- Deseo: ${w.w}` : '', w?.o ? `- Resultado: ${w.o}` : '', w?.ob ? `- Obstáculo: ${w.ob}` : '', w?.p ? `- Plan: ${w.p}` : '', d.nota?.trim() ? `- Nota: ${d.nota.trim()}` : ''].filter(Boolean).join('\n')
  }).filter((x) => x.includes('\n'))
  if (notas.length) guardar('Notas y WOOP del plan', `# Notas y WOOP del plan\n\n${notas.join('\n\n')}`, 'plan-notas')

  // 3. Los frentes y los hábitos con forma de tema, como dominios (lo que no es un tema —votar, anotar gastos— no).
  let dominios = 0
  const temas = new Set<string>()
  for (const f of filas.frentes ?? []) temas.add(String(f.nombre).trim())
  for (const h of habitos) if (!/voto|verbo|woop|gasto|anotar|pesarme|peso/i.test(h.titulo)) temas.add(String(h.titulo).replace(/^(practicar|estudiar|aprender)\s+/i, '').trim())
  for (const t of temas) {
    if (t.length < 3) continue
    try { asegurarPorNombre(db, t, 'dominio', ahora); dominios++ } catch { /* un nombre raro no frena la migración */ }
  }

  // 4. Lo que apuntaba al plan se suelta, y las tablas se van.
  try { db.prepare('UPDATE aprendizajes SET frente_id = NULL').run() } catch { /* sin la columna, nada */ }
  for (const r of db.prepare('SELECT id, ataduras FROM identidades').all() as { id: number; ataduras: string }[]) {
    const a = json<Record<string, unknown>>(r.ataduras, {})
    if (!('habitos' in a)) continue
    delete a.habitos
    db.prepare('UPDATE identidades SET ataduras = ? WHERE id = ?').run(JSON.stringify(a), r.id)
  }
  db.prepare(`DELETE FROM rutinas WHERE id = 'voto'`).run()
  const borradas: string[] = []
  for (const t of [...TABLAS].reverse()) if (existe(db, t)) { db.exec(`DROP TABLE ${t}`); borradas.push(t) }
  return { respaldo, piezas, dominios, borradas }
}
