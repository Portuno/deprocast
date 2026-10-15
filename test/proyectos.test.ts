import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { crearMision } from '../src/misiones.ts'
import { crearProyecto } from '../src/mastropiero.ts'
import { crearCuaderno } from '../src/cuadernos.ts'
import { _probarSandbox, armarSandbox, espacioDeProyecto, proyectoPorNombre, vincularProyectos } from '../src/proyectos.ts'
import { GRUPOS } from '../src/chat/herramientas.ts'

test('espacio de proyecto: junta lo que hay del proyecto (corpus, historia, misiones, cuadernos) y lo vincula con la liga', () => {
  const db = abrir(':memory:')
  const faro = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Faro', alias: ['Proyecto Faro'] })
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana' })
  insertar(db, { fuente: 'operador', titulo: 'Idea del mapa', contenido: 'Faro con Ana', entidades: [faro, ana], fecha: '2026-10-01', origenId: 't:1' })
  asegurarFuente(db, { id: 'takeout-historia', nombre: 'Historia de proyectos', nivel: 'investigacion' })
  insertar(db, { fuente: 'takeout-historia', titulo: 'Historia de Faro', contenido: '## Eras\n- Mapa por capas', entidades: [faro], fecha: '2026-10-14', origenId: 't:2' })
  crearMision(db, { titulo: 'Probar Faro en un barrio', nivel: 'primaria', entidadId: faro })
  crearCuaderno(db, 'Faro · notas de campo')

  assert.equal(proyectoPorNombre(db, 'proyecto faro'), faro)
  const e = espacioDeProyecto(db, faro)
  assert.equal(e.liga, null)
  assert.equal(e.corpus.total, 2)
  assert.match(e.historia!.texto, /Mapa por capas/)
  assert.deepEqual(e.misiones.map((m) => m.titulo), ['Probar Faro en un barrio'])
  assert.deepEqual(e.cuadernos.map((c) => c.titulo), ['Faro · notas de campo'])
  assert.ok(e.relacionadas.some((x) => x.nombre === 'Ana'))

  crearProyecto(db, 'Proyecto Faro')
  assert.equal(vincularProyectos(db), 1, 'el proyecto de la liga se vincula por alias')
  assert.ok(espacioDeProyecto(db, faro).liga)
  assert.ok(GRUPOS.liga.includes('ver_proyecto') && GRUPOS.liga.includes('armar_sandbox'))
})

test('sandbox: propone agentes y encargos (no forja ni publica nada) y, si hace falta, crea el proyecto en la liga', async () => {
  const db = abrir(':memory:')
  const versa = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Versa' })
  let leyo = ''
  _probarSandbox(async (_db, usuario) => {
    leyo = usuario
    return {
      resumen: 'Versa tiene la idea pero no clientes.',
      agentes: [{ clase: 'buscador', instrucciones: 'Busca 20 productoras chicas en Valencia.', por_que: 'Sin lista no hay ventas.' }, { clase: 'inventado', instrucciones: 'x' }],
      encargos: [{ clase: 'generativo', texto: 'Escribí la oferta de Versa en 5 líneas.', por_que: 'Para mandar mañana.' }],
    }
  })
  const agentesAntes = (db.prepare('SELECT COUNT(*) AS n FROM agentes').get() as any).n
  const s = await armarSandbox(db, versa)
  assert.match(leyo, /Proyecto: Versa/)
  assert.equal(s.resumen, 'Versa tiene la idea pero no clientes.')
  assert.deepEqual(s.agentes.map((a) => a.clase), ['buscador'], 'una clase que no existe no pasa')
  assert.equal(s.encargos.length, 1)
  assert.ok(s.proyecto.id, 'Versa queda en la liga, con su gerente')
  assert.equal((db.prepare('SELECT entidad_id FROM proyectos WHERE id = ?').get(s.proyecto.id) as any).entidad_id, versa)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM agentes').get() as any).n, agentesAntes + 1, 'solo el gerente: los agentes propuestos los forja él')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM tareas WHERE publicada_por = 'operador'`).get() as any).n, 0, 'ningún encargo publicado sin su ok')
})
