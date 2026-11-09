/**
 * La ficha de idea (Fragua #159): cuando tira una idea grande y vaga («clonar Revolut y Stripe»), Mastropiero la baja en
 * el mismo turno a cuatro campos fijos y un primer paso que se puede verificar en una semana. Queda como side quest con
 * vencimiento a 7 días, atada al proyecto si lo hay, para que la idea no muera como frase suelta en el chat.
 */
import { fechaLocal, type Db } from './db.ts'
import { crearMision, type Mision } from './misiones.ts'
import { entidadPorNombre } from './personajes.ts'

export type FichaIdea = { idea: string; queEs: string; codigoYPermiso: string; prueba7Dias: string; primerCliente: string; proyecto?: string | number | null }

export function abrirFichaIdea(db: Db, f: FichaIdea, ahora = Date.now()): { mision: Mision; ficha: string; proyecto: number | null } {
  const limpio = (s: unknown, max: number) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  const idea = limpio(f.idea, 200)
  const prueba = limpio(f.prueba7Dias, 240)
  if (!idea) throw new Error('Falta la idea')
  if (!prueba) throw new Error('Falta qué se puede probar en 7 días: es el punto de la ficha')
  const proyecto = typeof f.proyecto === 'number' ? f.proyecto : f.proyecto ? entidadPorNombre(db, String(f.proyecto)) : null
  const ficha = [
    `💡 ${idea}`,
    `Qué es: ${limpio(f.queEs, 400) || '—'}`,
    `Código y permisos: ${limpio(f.codigoYPermiso, 400) || '—'}`,
    `En 7 días se prueba: ${prueba}`,
    `Primer cliente o usuario real: ${limpio(f.primerCliente, 240) || '— (falta: es lo primero a averiguar)'}`,
  ].join('\n')
  const vence = fechaLocal(ahora + 7 * 86_400_000)
  const mision = crearMision(db, {
    nivel: 'terciaria', titulo: `Probar: ${prueba}`.slice(0, 200), detalle: ficha, categoria: 'idea', entidadId: proyecto, estado: 'activa',
    disparador: { cuando: 'esta semana' }, vence, creadaPor: 'mastropiero',
  }, { por: 'mastropiero', ahora })
  return { mision, ficha, proyecto }
}
