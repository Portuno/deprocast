/**
 * Leer el juego antes de redactar (Fragua #288). Cuando el pedido es una respuesta con consecuencia —un mail, un precio,
 * una fecha, un pedido a un tercero, una negociación—, antes del borrador va el tablero: quiénes juegan, qué gana o
 * paga cada uno, qué sabe cada uno, si es una vez o se repite; dos o tres respuestas posibles con lo que gana y pierde
 * cada una, y la que recomienda. El borrador sale de esa opción. No decide por él: muestra el tablero y recomienda.
 * Sin modelo para detectarlo (reglas): lo que no tiene consecuencia no paga el tablero.
 */
import type { Db } from '../db.ts'

/** Un pedido de redactar o contestar algo que sale hacia un tercero, o una negociación. */
const REDACTAR = /(?<!\p{L})(contest[aá]le|respond[eé]le|respondele|escrib[ií]le|mand[aá]le|armame (un|el) (mail|correo|mensaje)|redact[aá]|borrador|qu[eé] le (digo|contesto|respondo)|c[oó]mo le (digo|contesto|respondo|planteo|pido))(?!\p{L})/iu
const CONSECUENCIA = /(?<!\p{L})(precio|presupuesto|cotizaci[oó]n|tarifa|honorarios|oferta|contraoferta|descuento|cobr(ar|o|arle)|pag(ar|o|arle)|factura|plazo|fecha|entrega|contrato|propuesta|condiciones|negoci\p{L}*|acuerdo|aumento|sueldo|salario|cliente|proveedor|reclamo|deuda|se[ñn]a|adelanto)(?!\p{L})/iu
const NEGOCIACION = /(?<!\p{L})(negoci\p{L}*|contraoferta|regate\p{L}*|me ofrecen|me ofrecieron|le ofrezco|cu[aá]nto (le )?cobro|cu[aá]nto pido|subir el precio|bajar el precio)(?!\p{L})/iu

export function esJugada(texto: string): boolean {
  return NEGOCIACION.test(texto) || (REDACTAR.test(texto) && CONSECUENCIA.test(texto))
}

/** La instrucción del turno: el tablero antes del borrador (con su dominio de teoría de juegos, si lo tiene). */
export function instruccionDelJuego(db: Db): string {
  const dominio = (() => {
    try { return (db.prepare(`SELECT tema FROM aprendizajes WHERE estado != 'descartado' AND (tema LIKE '%juego%' OR tema LIKE '%game theory%') LIMIT 1`).get() as { tema: string } | undefined)?.tema ?? null } catch { return null }
  })()
  return `(Este pedido tiene consecuencias con un tercero. Antes de redactar, leé el juego, corto:
1. **Jugadores**: quiénes y qué gana o paga cada uno.
2. **Información**: qué sabe cada uno que el otro no.
3. **Juego**: ¿una sola vez o se repite (relación que sigue)? Eso cambia cuánto conviene tensar.
4. **Opciones**: 2 o 3 respuestas posibles, cada una con lo que gana y lo que arriesga.
5. **Recomiendo**: una, y por qué.
Después, el borrador de la opción recomendada (si él eligió otra, de esa). Buscá los datos reales antes (correo, persona, proyecto): no inventes montos ni fechas.${dominio ? ` Usá lo que vio en su dominio «${dominio}» de la Academia (nombrá el concepto cuando aplique).` : ''} No decidas por él: el tablero es para que elija.)`
}
