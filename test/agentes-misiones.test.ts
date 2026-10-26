import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { leer } = await import('../src/roster.ts')
const { publicar, leerTarea } = await import('../src/bus.ts')
const { elegir } = await import('../src/gerente.ts')
const mi = await import('../src/agentes/misiones.ts')

const T = new Date(2026, 9, 27, 10).getTime()
const base = () => abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentes-mi-')), 'a.db'))
const BRIEF = 'Productora audiovisual chica: fotos y video para eventos y marcas. Buscamos productoras, agencias y eventos de la zona que tercericen.'

/** Un modelo con guion: cada llamada devuelve las herramientas del paso siguiente; guarda los prompts. */
function guion(pasos: { nombre: string; args: unknown }[][]) {
  const sistemas: string[] = [], usuarios: string[] = []
  let i = 0
  _probarModelo(async (_l, o) => {
    if (i === 0) { sistemas.push(String((o.mensajes[0] as any).content)); usuarios.push(String((o.mensajes[1] as any)?.content ?? '')) }
    const p = pasos[i++] ?? []
    return { texto: p.length ? '' : 'listo', llamadas: p.map((x, k) => ({ id: `l${i}-${k}`, nombre: x.nombre, argumentos: JSON.stringify(x.args) })), razonamiento: null, modelo: 'falso', tokens: 10 }
  })
  return { sistemas, usuarios, reiniciar: () => { i = 0 } }
}

test('Una misión: se forja su agente (dedicado: el bus no lo toma), arma el plan, anota, pregunta una sola vez y cierra con el próximo paso', async () => {
  const db = base()
  assert.throws(() => mi.crearMisionAgente(db, { titulo: 'Clientes', brief: 'corto' }, T), /brief/)
  const m = mi.crearMisionAgente(db, { titulo: 'Tres clientes nuevos', brief: BRIEF, criterio: { metrica: 'clientes', meta: 3 }, vence: '2027-03-01' }, T)
  assert.equal(leer(db, m.agenteId)!.clase, 'buscador')
  assert.equal(m.criterio.texto, '3 clientes')
  const t = publicar(db, { clase: 'buscador', tipo: 'consulta', payload: { texto: 'x' }, publicadaPor: 'operador' }, T)
  assert.ok(elegir(db, leerTarea(db, t.id)!, new Map())?.agente.id !== m.agenteId, 'el bus no toma al agente en misión')

  const g = guion([
    [{ nombre: 'rehacer_plan', args: { pasos: [{ paso: 'Listar productoras de la zona' }, { paso: 'Redactar propuestas' }] } }],
    [{ nombre: 'anotar_en_diario', args: { tipo: 'hallazgo', texto: 'Hay tres productoras que tercerizan foto en eventos.' } }, { nombre: 'preguntarle_al_operador', args: { pregunta: '¿Cuál es el precio por evento?', por_que: 'para la propuesta' } }],
    [{ nombre: 'preguntarle_al_operador', args: { pregunta: '¿Y por hora?' } }],
    [{ nombre: 'cerrar_sesion', args: { resumen: 'Armé el plan y encontré tres productoras.', proximo_paso: 'Leer sus webs', va_bien: true } }],
  ])
  const r = await mi.trabajarMision(db, m.id, { ahora: T })
  assert.equal(r.cerrada, true)
  assert.match(g.sistemas[0], /Tres clientes nuevos[\s\S]*Criterio de éxito: 3 clientes[\s\S]*Todavía no tenés plan/)
  assert.match(g.usuarios[0], /Es la primera/)
  const x = mi.leerMisionAgente(db, m.id)!
  assert.equal(x.plan.length, 2)
  assert.equal(x.proximo, 'Leer sus webs')
  const tipos = mi.diarioDe(db, m.id).map((d) => d.tipo)
  for (const tp of ['plan', 'hallazgo', 'pregunta', 'resultado', 'sesion']) assert.ok(tipos.includes(tp as any), tp)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM preguntas WHERE origen = ?`).get(`agente:${m.agenteId}`) as any).n, 1, 'una pregunta por sesión')

  // Lo que él indica manda en la próxima sesión, que arranca del próximo paso.
  mi.instruir(db, m.id, 'Enfocate en bodas', T)
  const g2 = guion([[{ nombre: 'cerrar_sesion', args: { resumen: 'ok', proximo_paso: 'seguir' } }]])
  await mi.trabajarMision(db, m.id, { ahora: T })
  assert.match(g2.sistemas[0], /instruccion\] Enfocate en bodas/)
  assert.match(g2.sistemas[0], /✓|·/)
  assert.match(g2.usuarios[0], /Sesión 2\. El próximo paso que dejaste: Leer sus webs/)
})

test('Sin cerrar, la sesión se cierra sola; la rutina respeta el ritmo, saltea pausadas y la banca, y marca fallida la vencida', async () => {
  const db = base()
  const m = mi.crearMisionAgente(db, { titulo: 'Reuniones', brief: BRIEF }, T)
  guion([[{ nombre: 'anotar_en_diario', args: { tipo: 'paso', texto: 'Buscando.' } }], [{ nombre: 'anotar_en_diario', args: { tipo: 'paso', texto: 'Sigo.' } }], [], []])
  const r = await mi.trabajarMision(db, m.id, { ahora: T })
  assert.equal(r.cerrada, false)
  assert.match(mi.diarioDe(db, m.id)[0].texto, /terminó sin cerrar|se le acabaron/)

  const ritmo = leer(db, m.agenteId)!.atributos.ritmo
  const porDia = 1 + Math.floor(ritmo / 2)
  guion(Array.from({ length: 20 }, () => [{ nombre: 'cerrar_sesion', args: { resumen: 'ok', proximo_paso: 'x' } }]))
  for (let k = 0; k < porDia + 1; k++) await mi.trabajarMisiones(db, T)
  assert.equal(mi.sesionesHoy(db, m.id, T), porDia, 'no más sesiones que las de su ritmo')

  const p = mi.crearMisionAgente(db, { titulo: 'Pausada', brief: BRIEF }, T)
  mi.editarMisionAgente(db, p.id, { estado: 'pausada' }, T)
  const b = mi.crearMisionAgente(db, { titulo: 'En banca', brief: BRIEF }, T)
  db.prepare(`UPDATE agentes SET estado = 'banca' WHERE id = ?`).run(b.agenteId)
  await assert.rejects(mi.trabajarMision(db, b.id, { ahora: T }), /banca/)
  const v = mi.crearMisionAgente(db, { titulo: 'Vencida', brief: BRIEF, vence: '2026-10-01' }, T)
  const res = await mi.trabajarMisiones(db, T + 1)
  assert.ok(!res.sesiones.some((s) => /Pausada|En banca/.test(s.mision)))
  assert.equal(mi.leerMisionAgente(db, v.id)!.estado, 'fallida')
  assert.throws(() => mi.crearMisionAgente(db, { titulo: 'Otra', brief: BRIEF, agenteId: m.agenteId }, T), /ya está en otra misión/)
})
