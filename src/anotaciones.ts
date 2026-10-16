/**
 * Anotaciones: un bloque de notas suyas (ideas, decisiones, diseños, a veces marcadas [Confirmado] o [Inferido]) que se
 * procesa de una: queda como pieza propia, lo duradero va a la memoria (lo confirmado, revisado; lo inferido, para que
 * lo mire), lo que es funcionalidad de Deprocast va a La Fragua como propuesta «diseño» (con las restricciones que diga
 * el texto copiadas tal cual: nada se ejecuta solo), las personas y proyectos se enlazan (los nuevos esperan su ok) y
 * las ideas quedan como quántomos para pesar.
 */
import { fechaLocal, type Db } from './db.ts'
import { insertar } from './corpus.ts'
import { recordar } from './memoria.ts'
import { crearQuantomo } from './quantomos.ts'
import { entidadPorNombre } from './personajes.ts'
import { pedirJson } from './modelo.ts'

const SISTEMA = `Leés un bloque de anotaciones del operador: ideas, decisiones, diseños, a veces marcadas [Confirmado] (lo dijo él, es así) o [Inferido] (lo dedujo alguien, no es seguro). Devolvé:
- "resumen": una frase.
- "recuerdos": [{"texto": una oración en tercera persona, "tipo": "hecho" | "meta" | "preferencia" | "sueño" | "vision" | "correccion", "horizonte": "castillo" | "campamento" | "trinchera" | null, "confirmado": true | false}] — solo lo duradero sobre él (sus metas, su visión, cómo trabaja, decisiones). confirmado = true si viene marcado [Confirmado] o él lo afirma; false si es [Inferido] o una deducción.
- "propuestas": [{"titulo": string, "detalle": string (qué haría y para qué, concreto), "area": "pantalla" | "chat" | "corpus" | "liga" | "entidades" | "motores" | "otro", "restricciones": [string], "sensible": true | false}] — funcionalidades de Deprocast (la plataforma) que describe. En "restricciones" copiá lo que el texto prohíbe o condiciona («no hay permiso para…», «es solo diseño»). "sensible" = true si toca datos biométricos (rostro, emociones de la cara, voz), cámaras, o actuar sobre cuentas de terceros (mutear, publicar, borrar).
- "entidades": [{"nombre": string, "tipo": "persona" | "proyecto" | "agrupacion" | "lugar" | "concepto", "nota": string (qué es, según el texto)}] — nombres propios que aparecen.
- "ideas": [{"texto": una idea atómica que se entienda sola, "proyecto": string | null}] (hasta 8).
No inventes nada que no esté en el texto. Forma: {"resumen": string, "recuerdos": [...], "propuestas": [...], "entidades": [...], "ideas": [...]}`

let procesar = async (db: Db, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'anotaciones' }, SISTEMA, usuario, { temperatura: 0.2, maxTokens: 5000 })).datos
export function _probarAnotaciones(f: typeof procesar) {
  procesar = f
}

const lista = (v: unknown) => (Array.isArray(v) ? v : [])
const txt = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max)
const clave = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const TIPOS_MEMORIA = ['hecho', 'meta', 'preferencia', 'sueño', 'vision', 'correccion']
const AREAS = ['pantalla', 'chat', 'corpus', 'liga', 'entidades', 'motores', 'otro']
const TIPOS_ENTIDAD = ['persona', 'proyecto', 'agrupacion', 'lugar', 'concepto']

export type ResultadoAnotaciones = {
  pieza: number; resumen: string
  recuerdos: { id: number; texto: string; revisado: boolean }[]
  propuestas: { id: number; titulo: string; sensible: boolean }[]
  enlazadas: { id: number; nombre: string }[]
  nuevas: { nombre: string; tipo: string }[]
  quantomos: number
}

export async function procesarAnotaciones(db: Db, texto: string, o: { fecha?: string | null; ahora?: number } = {}): Promise<ResultadoAnotaciones> {
  const ahora = o.ahora ?? Date.now()
  const limpio = texto.trim()
  if (limpio.length < 20) throw new Error('Pegá las anotaciones (un poco más de texto)')
  const fecha = o.fecha && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha) ? o.fecha : fechaLocal(ahora)
  const d = await procesar(db, `Fecha de las anotaciones: ${fecha}\n\n${limpio.slice(0, 60_000)}`)

  // Las entidades: las que ya existen se enlazan; las nuevas quedan propuestas (mismo lugar que las del Takeout).
  const enlazadas: { id: number; nombre: string }[] = []
  const nuevas: { nombre: string; tipo: string; nota: string }[] = []
  for (const e of lista(d?.entidades).slice(0, 30)) {
    const nombre = txt(e?.nombre, 80)
    if (!nombre) continue
    const id = entidadPorNombre(db, nombre)
    if (id) { if (!enlazadas.some((x) => x.id === id)) enlazadas.push({ id, nombre }) } else if (!nuevas.some((x) => clave(x.nombre) === clave(nombre))) nuevas.push({ nombre, tipo: TIPOS_ENTIDAD.includes(e?.tipo) ? e.tipo : 'concepto', nota: txt(e?.nota, 300) })
  }

  const resumen = txt(d?.resumen, 200)
  const pieza = insertar(db, {
    fuente: 'operador', nivel: 'propia', estado: 'disponible', titulo: `Anotaciones · ${fecha}${resumen ? ` · ${resumen.slice(0, 80)}` : ''}`, fecha, contenido: limpio,
    etiquetas: ['anotaciones'], entidades: enlazadas.map((x) => x.id), origenId: `anotaciones:${fecha}:${clave(limpio).slice(0, 60)}`,
  }, ahora) ?? (db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(`anotaciones:${fecha}:${clave(limpio).slice(0, 60)}`) as { id: number }).id

  for (const n of nuevas) {
    const k = clave(n.nombre)
    if (!k) continue
    const ya = db.prepare('SELECT estado, piezas FROM takeout_nombres WHERE clave = ?').get(k) as { estado: string; piezas: string | null } | undefined
    if (ya) {
      if (ya.estado === 'propuesta') db.prepare('UPDATE takeout_nombres SET veces = veces + 1, ultima = ?, piezas = ? WHERE clave = ?').run(fecha, JSON.stringify([...new Set([...(JSON.parse(ya.piezas ?? '[]') as number[]), pieza])]), k)
      continue
    }
    db.prepare(`INSERT INTO takeout_nombres (clave, nombre, tipo, veces, piezas, primera, ultima, nota, estado, creada_en) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'propuesta', ?)`).run(k, n.nombre, n.tipo, JSON.stringify([pieza]), fecha, fecha, n.nota || null, ahora)
  }

  const recuerdos: ResultadoAnotaciones['recuerdos'] = []
  for (const r of lista(d?.recuerdos).slice(0, 12)) {
    const t = txt(r?.texto, 400)
    if (!t) continue
    const revisado = r?.confirmado === true
    const x = recordar(db, { texto: t, tipo: TIPOS_MEMORIA.includes(r?.tipo) ? r.tipo : 'hecho', horizonte: r?.horizonte ?? null, piezaId: pieza, creadaPor: 'anotaciones', revisada: revisado, fecha }, ahora)
    recuerdos.push({ id: x.id, texto: x.texto, revisado })
  }

  // Lo que es de Deprocast va a La Fragua como diseño, con sus restricciones a la vista (y sin repetir lo que ya está abierto).
  const propuestas: ResultadoAnotaciones['propuestas'] = []
  const abiertas = new Set((db.prepare(`SELECT titulo FROM propuestas WHERE estado = 'abierta'`).all() as { titulo: string }[]).map((p) => clave(p.titulo)))
  for (const p of lista(d?.propuestas).slice(0, 10)) {
    const titulo = txt(p?.titulo, 160)
    if (!titulo || abiertas.has(clave(titulo))) continue
    const restricciones = lista(p?.restricciones).map((x) => txt(x, 300)).filter(Boolean)
    const sensible = p?.sensible === true
    const detalle = [
      txt(p?.detalle, 2000),
      'Es diseño (salió de tus anotaciones): no se construye ni se ejecuta nada hasta que lo apruebes.',
      restricciones.length ? `Restricciones que dijiste:\n${restricciones.map((x) => `- ${x}`).join('\n')}` : '',
      sensible ? 'Toca datos sensibles (biométricos, cámaras o cuentas de terceros): necesita tu ok explícito, y aun así nada se hace sin que lo actives vos.' : '',
    ].filter(Boolean).join('\n\n')
    const r = db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, origen, creada_en) VALUES (?, ?, ?, 'media', 'abierta', 'anotaciones', ?)`).run(titulo, detalle, AREAS.includes(p?.area) ? p.area : 'otro', ahora)
    abiertas.add(clave(titulo))
    propuestas.push({ id: Number(r.lastInsertRowid), titulo, sensible })
  }

  let quantomos = 0
  for (const [i, idea] of lista(d?.ideas).slice(0, 8).entries()) {
    const t = txt(idea?.texto ?? idea, 400)
    if (!t) continue
    if (crearQuantomo(db, { texto: t, titulo: `Anotación${idea?.proyecto ? ` · ${txt(idea.proyecto, 60)}` : ''} · ${fecha}`, piezaId: pieza, universo: 'anotaciones', procedencia: `Anotaciones del ${fecha}`, origenId: `anotaciones:${pieza}:${i}` }, ahora)) quantomos++
  }

  return { pieza, resumen, recuerdos, propuestas, enlazadas, nuevas: nuevas.map(({ nombre, tipo }) => ({ nombre, tipo })), quantomos }
}
