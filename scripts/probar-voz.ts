/**
 * El test de voz de Mastropiero: las 10 situaciones del plan v20, respondidas por el modelo con el prompt de verdad (la
 * VOZ de usted + la personalidad en su dosis), y un control automático de lo que se puede chequear solo. El resto (¿suena
 * a él o a un imitador?) lo califica Lautaro leyendo el resultado.
 *
 * Gasta tokens: corre en la nube (MASTRO_NUBE=1) o, en la compu, solo con --aca y su ok.
 * Uso: npm run probar-voz [-- --aca]   → deja data/voz-AAAA-MM-DD.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { abrir, fechaLocal } from '../src/db.ts'
import { promptMastropiero } from '../src/chat/index.ts'
import { llamarModelo } from '../src/modelo.ts'
import { nombraDePila } from '../src/personalidad.ts'
import { enLaNube } from '../src/reproceso.ts'

/** Cada situación: lo que pasó (como contexto del sistema), lo que dice el operador y si es de «respuesta sola». */
const SITUACIONES: { nombre: string; contexto: string; mensaje: string; corta?: boolean }[] = [
  { nombre: '1. Una captura por Telegram', contexto: 'El operador mandó por Telegram «café 3,20» y quedó anotado como gasto de 3,20 € hoy a las 10:41. Confirmáselo.', mensaje: 'café 3,20' },
  { nombre: '2. Rechazó una propuesta de la bandeja', contexto: 'El operador acaba de rechazar en la bandeja una side quest que propusiste («Llamar al contador»). El acierto de esa categoría bajó de 78 % a 72 %.', mensaje: 'No, esa no. La rechacé.' },
  { nombre: '3. Un quántomo mal sellado', contexto: 'El operador acaba de sellar con peso 12 (el máximo) el quántomo «compré pan». En La Mano se deshace con la tecla Z.', mensaje: 'uy, le puse 12 a lo del pan' },
  { nombre: '4. Un lunes sin ganas', contexto: 'Es lunes, 9:05. Agenda de hoy: 11:00 reunión con el cliente, 15:00 entrega del presupuesto, 18:00 gimnasio. Primaria más atrasada: «Lanzar el Faro» (20 %).', mensaje: 'no tengo ganas de nada hoy' },
  { nombre: '5. Un error de la nube', contexto: 'A las 9:12 la nube devolvió error 524 durante 4 minutos; ya volvió y no se perdió nada (se verificó).', mensaje: '¿qué pasó recién que no andaba nada?' },
  { nombre: '6. «¿Qué hora es?»', contexto: 'Son las 10:43.', mensaje: '¿qué hora es?', corta: true },
  { nombre: '7. «Esa idea es de un video, no tuya»', contexto: 'En tu respuesta anterior presentaste como tuya la idea «cobrar la entrada filtra a la comunidad». En el corpus está en un video que el operador guardó el día 12 [#4410].', mensaje: 'esa idea es de un video que vi, no tuya' },
  { nombre: '8. Cierre de una run con 2 de 6', contexto: 'Se cerró la run de la mañana: 2 de 6 bandas hechas (el correo y el presupuesto); quedaron la factura, el informe, llamar a Pablo y ordenar el escritorio.', mensaje: 'cerré la run, salió como salió' },
  { nombre: '9. «Redactame el mail para el cliente»', contexto: 'El cliente es una inmobiliaria; hay que avisarle que el presupuesto llega el jueves en vez del martes por un retraso del proveedor. El operador firma con su nombre de pila y escribe informal, de vos.', mensaje: 'redactame el mail para el cliente' },
  { nombre: '10. Una sorpresa en La Mano', contexto: 'En La Mano salió un puente no obvio: la nota del operador de marzo («el precio de entrada cuida la comunidad») y un podcast de economía sobre bienes comunes se parecen 82 % y nunca aparecieron juntos.', mensaje: '¿y esto qué es?' },
]

/** Lo que se chequea solo: sin nombres de pila, sin meta-referencias, sin voseo (salvo en el mail, que es en su voz), lo corto corto. */
function controles(s: (typeof SITUACIONES)[number], texto: string): string[] {
  const fallas: string[] = []
  const nombre = nombraDePila(texto)
  if (nombre) fallas.push(`nombre de pila: «${nombre}»`)
  if (/Les Luthiers|Mundstock|personaje ficticio/i.test(texto)) fallas.push('meta-referencia')
  const voseo = /\b(vos|tenés|querés|podés|sabés|fijate|mirá|decime)\b/i.exec(s.nombre.startsWith('9.') ? texto.split(/\n\s*\n/).at(-1) ?? '' : texto)
  if (voseo) fallas.push(`voseo: «${voseo[0]}»`)
  if (s.corta && texto.length > 40) fallas.push(`la respuesta corta tiene ${texto.length} caracteres`)
  if (/jaja|😂|🤣/i.test(texto)) fallas.push('risa o emoji')
  // La regla del Gem: prohibido hablar en contraposición («esto no es X, sino Y»).
  const contra = /\bno (?:es|son|se trata de|hace falta)\b[^.;:\n]{1,80}?,?\s*(?:sino|hace falta)\b/i.exec(texto)
  if (contra) fallas.push(`contraposición: «${contra[0]}»`)
  return fallas
}

async function main() {
  if (!enLaNube() && !process.argv.includes('--aca')) {
    console.error('Gasta tokens: corrélo en la nube, o acá con --aca si Lautaro dio el ok.')
    process.exit(1)
  }
  const db = abrir(process.env.MASTRO_DB ?? ':memory:')
  const salida: string[] = [`# Test de voz de Mastropiero · ${fechaLocal()}`, '', 'Califique cada una: ¿suena a Mastropiero o a un imitador? (criterio en docs/personalidad/mastropiero.md)', '']
  let malas = 0
  for (const s of SITUACIONES) {
    const sistema = `${promptMastropiero(db, s.mensaje)}\n\nLo que acaba de pasar: ${s.contexto}`
    let texto = ''
    try {
      const r: any = await llamarModelo({ db, clase: 'mastropiero', agenteId: 'probar-voz' } as any, { mensajes: [{ role: 'system', content: sistema }, { role: 'user', content: s.mensaje }] } as any)
      texto = String(r?.texto ?? '').trim()
    } catch (e) { texto = `(falló: ${e instanceof Error ? e.message : e})` }
    const fallas = controles(s, texto)
    if (fallas.length) malas++
    salida.push(`## ${s.nombre}`, '', `> ${s.mensaje}`, '', texto, '', fallas.length ? `**Control automático:** ✗ ${fallas.join(' · ')}` : '**Control automático:** ✓', '', '¿Suena a él? ☐ sí ☐ imitador — nota: ', '')
    console.log(`${fallas.length ? '✗' : '✓'} ${s.nombre}${fallas.length ? ` (${fallas.join(', ')})` : ''}`)
  }
  const archivo = path.join('data', `voz-${fechaLocal()}.md`)
  fs.mkdirSync('data', { recursive: true })
  fs.writeFileSync(archivo, salida.join('\n'))
  console.log(`\n${SITUACIONES.length - malas}/${SITUACIONES.length} pasan el control automático. Resultado: ${archivo}`)
}

await main()
