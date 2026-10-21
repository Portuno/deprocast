/**
 * El copiloto: un consejo para ESTE momento, solo cuando él lo pide (💡, «¿cómo voy?», o en la charla en vivo). No habla
 * solo: esa fue su decisión. Con el Directo prendido ve lo de los últimos 15 minutos (vivo.ts ya va en el prompt de
 * Mastropiero), la banda de la run, la agenda y lo pendiente; dice UNA cosa concreta y deja hasta tres acciones rápidas
 * (los botones de [[seguir]]: tocarlas es pedírselas, y las hace con sus herramientas de siempre).
 */
import type { Db } from './db.ts'
import { enviar } from './chat/index.ts'
import { estadoVivo } from './vivo.ts'

export const PEDIDO_CONSEJO = '💡 ¿Qué me decís de este momento?'

/** Lo que se suma al prompt de Mastropiero para este turno. */
export function reglasDeConsejo(db: Db, ahora = Date.now()): string {
  const v = estadoVivo(db, ahora)
  return `Ahora te pidió un consejo para ESTE momento. Decile UNA sola cosa, concreta y accionable, atada a algo real:
- foco: lo que está haciendo contra su banda o su meta de bloque (si se fue a algo de alto estímulo, cuánto lleva y qué banda corre);
- agenda: algo que se viene pronto;
- tarea: algo que dijo o vio que conviene anotar;
- conexión: lo que está mirando conecta con una primaria, un bucle o una persona;
- descanso: si lleva mucho seguido (el ciclo de 90/20).
${v ? '' : 'El Directo está apagado: usá su run, su agenda y lo que charlaron hoy.'}
Si de verdad no hay nada que valga, decilo en una línea («Va bien: siga así»). Una a tres oraciones, de usted, sin contraposición.
Al final, hasta tres acciones rápidas que él pueda tocar para que las hagas vos, en un bloque:
[[seguir]]
Anotá «…» como tarea
Marcá la banda hecha
Pasá a la siguiente banda
[[/seguir]]
Solo las que tengan sentido ahora (pueden ser menos), cortas, en imperativo y dirigidas a vos.`
}

/** Pide el consejo en una conversación: entra como su pedido (💡) y Mastropiero contesta con las reglas del consejo. */
export function pedirConsejo(db: Db, cid: number, o: { hud?: string | null } = {}) {
  void enviar(db, cid, PEDIDO_CONSEJO, { hud: o.hud ?? null, extra: reglasDeConsejo(db), via: 'copiloto' })
}
