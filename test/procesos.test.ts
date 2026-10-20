import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY

const { abrir } = await import('../src/db.ts')
const { crearMision, actualizarMision } = await import('../src/misiones.ts')
const { anotarUso } = await import('../src/uso.ts')
const pr = await import('../src/procesos.ts')
const dsc = await import('../src/discovery.ts')

const T = new Date(2026, 9, 24, 18).getTime() // sábado
const DIA = 86_400_000

test('El discovery de tu semana: tus logs → tus procesos más caros con su to-be; lo de construir va a La Fragua (sin repetir)', async () => {
  const db = abrir(':memory:')
  assert.deepEqual(await pr.descubrirMisProcesos(db, T), { procesos: 0, propuestas: 0 }, 'sin material, nada')
  for (let i = 0; i < 4; i++) {
    const m = crearMision(db, { nivel: 'secundaria', titulo: 'Responder mails de clientes', categoria: 'comunicacion', minutos: 45, estado: 'activa' } as any, { ahora: T - i * DIA })
    actualizarMision(db, m.id, { estado: i ? 'hecha' : 'no' }, { ahora: T - i * DIA })
  }
  db.prepare(`INSERT INTO directo_sesiones (inicio, estado) VALUES (?, 'cerrada')`).run(T - DIA)
  db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, app, actividad) VALUES (1, 'pantalla', ?, ?, 'Gmail', 'responder mails')`).run(T - DIA, T - DIA + 50 * 60_000)
  anotarUso(db, 'herramienta', 'buscar_web')
  const material = pr.tusLogs(db, T)
  assert.match(material, /comunicacion: 4 · 3 · 1 · 180 min/)
  assert.match(material, /«Responder mails de clientes» ×4/)
  assert.match(material, /Gmail · responder mails · 50 min/)

  let vista = ''
  pr._probarProcesos(async (_db, _s, usuario) => {
    vista = usuario
    return { procesos: [{
      nombre: 'Responder mails de clientes', minutos_semana: 180, minutos_despues: 40, evidencia: '4 bandas de 45 min y 50 min de Gmail en el Directo',
      pasos: [{ paso: 'Leer la bandeja', sistema: 'Gmail', minutos: 15 }, { paso: 'Buscar el presupuesto anterior', sistema: 'Drive', minutos: 10 }, { paso: 'Escribir la respuesta', sistema: 'Gmail', minutos: 20 }],
      tobe: [{ destino: 'agente', por_que: 'Clasificar lo urgente', como: 'Un ayudante que resume la bandeja a la mañana' }, { destino: 'codigo', por_que: 'Siempre el mismo lugar', como: 'Buscar el presupuesto por cliente en el corpus' }, { destino: 'persona', por_que: 'Tu voz' }],
    }, { nombre: '', pasos: [] }] }
  })
  const r = await pr.descubrirMisProcesos(db, T)
  assert.match(vista, /Responder mails de clientes/)
  assert.deepEqual(r, { procesos: 1, propuestas: 2 })
  const [p] = pr.misProcesos(db)
  assert.equal(p.ambito, 'yo')
  assert.equal(p.resumen!.texto, 'De 3 pasos: 0 se borran, 1 pasa a código, 1 a un agente y 1 queda en una persona.')
  assert.deepEqual([p.kpis[0].linea_base, p.kpis[0].objetivo], ['180', '40'])
  const props = db.prepare(`SELECT titulo, detalle, origen FROM propuestas ORDER BY id`).all() as any[]
  assert.deepEqual(props.map((x) => x.titulo), ['Un agente para: Leer la bandeja', 'Automatizar: Buscar el presupuesto anterior'])
  assert.match(props[0].detalle, /Un ayudante que resume la bandeja/)
  assert.equal(props[0].origen, 'procesos')
  assert.deepEqual(await pr.descubrirMisProcesos(db, T + DIA), { procesos: 1, propuestas: 0 }, 'el mismo proceso se actualiza y las propuestas no se repiten')
  assert.equal(pr.misProcesos(db).length, 1)
})

test('Champions: el tablero de minutos ahorrados (no tokens), solo gente del encargo', () => {
  const db = abrir(':memory:')
  const e = dsc.crearEncargo(db, { cliente: 'Cliente Ejemplo' }, T)
  const champs = dsc.sumarPersona(db, e.id, { nombre: 'Champion Uno', rol: 'champion' }, T) as any[]
  const dos = (dsc.sumarPersona(db, e.id, { nombre: 'Champion Dos', rol: 'champion' }, T) as any[]).find((x) => x.nombre === 'Champion Dos')
  const uno = champs[0]
  assert.throws(() => pr.anotarAhorro(db, e.id, { personaId: uno.id, minutos: 0 }), /Cuántos minutos/)
  assert.throws(() => pr.anotarAhorro(db, e.id, { personaId: 99999, minutos: 30 }), /no está en el encargo/)
  pr.anotarAhorro(db, e.id, { personaId: uno.id, minutos: 90, que: 'Su skill de conciliación' }, T)
  pr.anotarAhorro(db, e.id, { personaId: dos.id, minutos: 200, que: 'Agente de facturas' }, T)
  pr.anotarAhorro(db, e.id, { personaId: uno.id, minutos: 500, semana: '2026-08-01' }, T)
  const t = pr.tableroChampions(db, e.id, T)
  assert.deepEqual(t.map((x) => [x.nombre, x.minutos4, x.total]), [['Champion Dos', 200, 200], ['Champion Uno', 90, 590]])
  assert.equal(t[1].ultimo, 'Su skill de conciliación')
  assert.equal(dsc.fichaEncargo(db, e.id).tablero.length, 2)
})

test('Sombra en vivo: avisa las reglas que recién quedan listas y, con la mitad de los casos, el encargo pasa a vivo', () => {
  const db = abrir(':memory:')
  const e = dsc.crearEncargo(db, { cliente: 'Cliente Ejemplo' }, T)
  dsc.editarEncargo(db, e.id, { estado: 'sombra' }, T)
  const csv = (n: number, regla: string, aciertos: number) => ['regla,propuesta,real', ...Array.from({ length: n }, (_, i) => `${regla},a,${i < aciertos ? 'a' : 'b'}`)].join('\n')
  const antes1 = new Set(dsc.sombraDe(db, e.id).reglas.filter((r) => r.lista).map((r) => r.regla))
  const s1 = dsc.cargarSombra(db, e.id, csv(40, 'Codificar', 40), null, T)
  const v1 = pr.revisarSombra(db, e.id, antes1, s1, T)
  assert.deepEqual([v1.nuevas.length, v1.paso, v1.aviso], [0, null, null], 'con 40 casos todavía no')
  const antes2 = new Set(dsc.sombraDe(db, e.id).reglas.filter((r) => r.lista).map((r) => r.regla))
  const s2 = dsc.cargarSombra(db, e.id, [csv(20, 'Codificar', 20), csv(30, 'Aprobar', 20).split('\n').slice(1).join('\n')].join('\n'), null, T)
  const v2 = pr.revisarSombra(db, e.id, antes2, s2, T)
  assert.deepEqual(v2.nuevas.map((r) => r.regla), ['Codificar'])
  assert.equal(v2.paso, 'vivo')
  assert.match(v2.aviso!, /una regla ya puede actuar sola .*Codificar \(100 % en 60 casos\).*pasó de sombra a vivo/)
  assert.equal(dsc.leerEncargo(db, e.id)!.estado, 'vivo')
  const v3 = pr.revisarSombra(db, e.id, new Set(['Codificar']), dsc.sombraDe(db, e.id), T)
  assert.equal(v3.aviso, null, 'no se repite')
})
