/**
 * El modo sombra en acción: la bandeja «Para decidir» (todo lo que espera tu ok, en un lugar, lo que más bloquea primero),
 * «Lo que hizo solo hoy» con ↩, el umbral de la captura que se ajusta a cuánto acierta, y el aviso diario por Telegram
 * con las excepciones y, si algún tipo acierta casi siempre, la oferta de hacerlo solo (con tu ok).
 */
import { ajuste, fechaLocal, fijarAjuste, json, type Db } from './db.ts'
import { CLAVES_TIPO, TIPOS, aciertoDe, anotar, estadoSombra, fijarModo, hechoSolo, leerDecision, modoDe } from './decisiones.ts'
import { deshacerCaptura } from './captura.ts'
import { resolverSugerido, sugeridos } from './finanzas.ts'
import { editarItem } from './personajes.ts'
import { actualizarMision } from './misiones.ts'
import { archivar, revisar } from './memoria.ts'

const MAQUINA = `('escriba', 'directo', 'takeout', 'preguntas')`
const n = (db: Db, sql: string, ...a: (string | number)[]) => (db.prepare(sql).get(...a) as { n: number }).n

// ─── deshacer lo que hizo solo ──────────────────────────────────────────

export function deshacerDecision(db: Db, id: number, ahora = Date.now()) {
  const d = leerDecision(db, id)
  if (!d || d.accion !== 'auto' || !d.deshacer) throw new Error('Eso no se puede deshacer desde acá')
  if (d.deshechaEn) throw new Error('Ya estaba deshecho')
  const x = d.deshacer
  if (x.que === 'captura') deshacerCaptura(db, x.tabla, x.id) // ya anota «deshecha»
  else {
    if (x.que === 'monto') {
      if (x.movimiento) db.prepare('DELETE FROM movimientos WHERE id = ?').run(x.movimiento)
      db.prepare(`UPDATE movimientos_sugeridos SET estado = 'pendiente', movimiento_id = NULL WHERE id = ?`).run(x.sugerido) // vuelve a la bandeja
    } else if (x.que === 'inventario') db.prepare(`UPDATE inventario SET estado = 'sugerido' WHERE id = ?`).run(x.id)
    else if (x.que === 'recuerdo') db.prepare('UPDATE memoria SET revisada = 0 WHERE id = ?').run(x.id)
    else if (x.que === 'archivar_recuerdo') db.prepare(`UPDATE memoria SET estado = 'archivada' WHERE id = ?`).run(x.id)
    else if (x.que === 'mision') db.prepare('UPDATE misiones SET estado = ?, cerrada_en = ? WHERE id = ?').run(x.estado, x.estado === 'activa' || x.estado === 'sugerida' ? null : ahora, x.id)
    else throw new Error('No sé deshacer eso')
    anotar(db, d.tipo, d.ref, 'deshecha', { ahora })
  }
  db.prepare('UPDATE decisiones SET deshecha_en = ? WHERE id = ?').run(ahora, id)
  return { ok: true }
}

// ─── la captura: el umbral sigue al acierto ─────────────────────────────

/** Desde qué confianza la captura registra sola: más exigente si viene errando, más suelta si acierta casi siempre. */
export function umbralCaptura(db: Db): number {
  const modo = modoDe(db, 'captura')
  if (modo === 'manual' || modo === 'sombra') return 2 // nunca sola: se charla
  const a = aciertoDe(db, 'captura')
  if (a.n >= 20 && (a.tasa ?? 1) < 0.8) return 0.85
  if (a.n >= 30 && a.cota >= 0.9) return 0.6
  return 0.7
}

// ─── la bandeja ─────────────────────────────────────────────────────────

type Item = { id: number | string; texto: string; sub?: string | null }
type Grupo = { tipo: string; nombre: string; n: number; peso: number; items: Item[]; acciones: [string, string][] | null; ir: string | null }

/** Todo lo que espera tu ok, por clase, lo que más bloquea primero; lo que hizo solo hoy; y lo que podría pasar a «auto». */
export function bandeja(db: Db, ahora = Date.now()) {
  const g: Grupo[] = []
  const ss = sugeridos(db)
  g.push({ tipo: 'monto', nombre: 'Montos que contaste', n: ss.length, peso: 3, items: ss.slice(0, 8).map((s) => ({ id: s.id, texto: `${s.descripcion}: ${s.monto > 0 ? '+' : ''}${s.monto} ${s.moneda}`, sub: s.fecha })), acciones: [['aceptar', '✓ Anotar'], ['descartar', '✕']], ir: null })
  const prims = db.prepare(`SELECT id, titulo, detalle, semana FROM misiones WHERE personaje = 'jugador' AND nivel IN ('primaria', 'principal') AND estado = 'sugerida' ORDER BY id DESC LIMIT 8`).all() as any[]
  g.push({ tipo: 'primaria', nombre: 'Primarias que te propone', n: n(db, `SELECT COUNT(*) AS n FROM misiones WHERE personaje = 'jugador' AND nivel IN ('primaria', 'principal') AND estado = 'sugerida'`), peso: 3, items: prims.map((m) => ({ id: m.id, texto: m.titulo, sub: m.detalle })), acciones: [['aceptar', '✓ Aceptar'], ['descartar', '✕']], ir: null })
  // Lo que vio el Directo (también el que sigue prendido): cada propuesta se resuelve acá mismo, una por una o todas.
  // Con el Directo prendido, lo suyo va primero: es lo que está pasando ahora.
  const sesiones = db.prepare(`SELECT id, resumen, estado FROM directo_sesiones WHERE resumen IS NOT NULL ORDER BY id DESC LIMIT 30`).all() as { id: number; resumen: string; estado: string }[]
  const dir = sesiones.flatMap((r) => ((json<any>(r.resumen, {})?.propuestas ?? []) as any[]).filter((p) => p.estado === 'pendiente').map((p) => ({ ...p, sesionId: r.id })))
  g.push({
    tipo: 'directo', nombre: 'Lo que vio el Directo', n: dir.length, peso: sesiones.some((r) => r.estado === 'activa') ? 100 : 2, ir: null, acciones: [['aceptar', '✓'], ['descartar', '✕']],
    items: dir.slice(0, 40).map((p) => ({ id: `${p.sesionId}:${p.id}`, texto: `${ETIQUETA_DIRECTO[p.tipo] ?? p.tipo}: ${p.titulo}`, sub: p.tipo === 'conexion' && p.de && p.con ? `${p.de} ↔ ${p.con}${p.detalle ? ` · ${p.detalle}` : ''}` : p.parecida ? `¿Es ${p.parecida.nombre}? (ya está en tus entidades)` : p.detalle ?? p.oido ?? null })),
  })
  // Las sorpresas de La Mano que todavía no respondió (cada clase con sus respuestas).
  const sorpresas = db.prepare(`SELECT id, tipo, texto, ids FROM mano_eventos WHERE estado IN ('pendiente', 'sin_hipotesis') ORDER BY id DESC LIMIT 30`).all() as { id: number; tipo: string; texto: string | null; ids: string }[]
  for (const [tipo, nombre, acciones] of SORPRESAS_MANO) {
    const xs = sorpresas.filter((s) => s.tipo === tipo)
    const textos = (s: { ids: string }) => (json<number[]>(s.ids, []).map((i) => (db.prepare('SELECT texto FROM quantomos WHERE id = ?').get(i) as { texto: string } | undefined)?.texto).filter(Boolean) as string[])
    g.push({ tipo: `mano_${tipo}`, nombre, n: xs.length, peso: 1, ir: null, acciones, items: xs.slice(0, 8).map((s) => ({ id: s.id, texto: textos(s).map((t) => `«${t.slice(0, 90)}»`).join(' · ') || (s.texto ?? ''), sub: s.texto })) })
  }
  // Lo que la Academia le propone aprender (por sus metas y lo que viene con fecha).
  const apr = db.prepare(`SELECT id, tema, por_que, sugerencia FROM aprendizajes WHERE estado = 'sugerido' ORDER BY creado_en DESC, id DESC LIMIT 8`).all() as any[]
  g.push({ tipo: 'aprender', nombre: 'Para aprender (tu Academia)', n: apr.length, peso: 2, ir: null, acciones: [['aceptar', '✓ Lo aprendo'], ['descartar', '✕']], items: apr.map((a) => {
    const s = json<any>(a.sugerencia, {}) ?? {}
    return { id: a.id, texto: a.tema, sub: [s.porQue ?? a.por_que, s.para ? `para ${s.para}${s.fecha ? ` (${s.fecha})` : ''}` : null, s.horizonte ? `${s.horizonte} plazo` : null].filter(Boolean).join(' · ') || null }
  }) })
  const inv = db.prepare(`SELECT id, nombre, detalle FROM inventario WHERE personaje = 'jugador' AND estado = 'sugerido' ORDER BY id DESC LIMIT 8`).all() as any[]
  g.push({ tipo: 'inventario', nombre: 'Lo que tenés (según lo que contaste)', n: n(db, `SELECT COUNT(*) AS n FROM inventario WHERE personaje = 'jugador' AND estado = 'sugerido'`), peso: 1, items: inv.map((i) => ({ id: i.id, texto: i.nombre, sub: i.detalle })), acciones: [['aceptar', '✓ Es mío'], ['descartar', '✕']], ir: null })
  const recs = db.prepare(`SELECT id, texto, fecha FROM memoria WHERE estado = 'vigente' AND revisada = 0 AND creada_por IN ${MAQUINA} ORDER BY id DESC LIMIT 8`).all() as any[]
  g.push({ tipo: 'recuerdo', nombre: 'Lo que anotó de vos', n: n(db, `SELECT COUNT(*) AS n FROM memoria WHERE estado = 'vigente' AND revisada = 0 AND creada_por IN ${MAQUINA}`), peso: 1, items: recs.map((r) => ({ id: r.id, texto: r.texto, sub: r.fecha })), acciones: [['aceptar', '✓ Es así'], ['descartar', '✕ No']], ir: null })
  g.push({ tipo: 'nombre', nombre: 'Nombres del archivo', n: n(db, `SELECT COUNT(*) AS n FROM takeout_nombres WHERE estado = 'propuesta'`), peso: 0.5, items: [], acciones: null, ir: 'takeout' })
  // Las de La Fragua que todavía no decidió (aceptar la deja abierta con prioridad alta, para construirla: ya no se pregunta).
  const sinDecidir = `estado = 'abierta' AND CAST(id AS TEXT) NOT IN (SELECT ref FROM decisiones WHERE tipo = 'propuesta')`
  const props = db.prepare(`SELECT id, titulo, detalle FROM propuestas WHERE ${sinDecidir} ORDER BY id DESC LIMIT 8`).all() as any[]
  g.push({ tipo: 'propuesta', nombre: 'Propuestas de mejora (La Fragua)', n: n(db, `SELECT COUNT(*) AS n FROM propuestas WHERE ${sinDecidir}`), peso: 0.5, items: props.map((p) => ({ id: p.id, texto: p.titulo ?? '', sub: p.detalle ?? null })), acciones: [['aceptar', '✓ Construir'], ['descartar', '✕']], ir: null })
  g.push({ tipo: 'quantomo', nombre: 'Quántomos proto para pesar', n: n(db, `SELECT COUNT(*) AS n FROM quantomos WHERE etapa = 'proto'`), peso: 0.2, items: [], acciones: null, ir: 'quantomos' })
  const grupos = g.filter((x) => x.n > 0).sort((a, b) => b.peso * Math.min(b.n, 10) - a.peso * Math.min(a.n, 10))
  const hoy = new Date(`${fechaLocal(ahora)}T00:00:00`).getTime()
  return {
    // El número del chip: lo que bloquea (los quántomos proto se pesan cuando hay ganas, no cuentan).
    grupos, total: grupos.filter((x) => x.peso >= 0.5).reduce((s, x) => s + x.n, 0),
    hechoSolo: hechoSolo(db, hoy),
    ofertas: estadoSombra(db).filter((e) => e.ofrecerAuto),
  }
}

const ETIQUETA_DIRECTO: Record<string, string> = { tarea: 'Tarea', cumplida: 'Parece hecha', banda: 'Banda hecha', entidad: 'Entidad', conexion: 'Conexión', idea: 'Idea', medio: 'Lo que miraste' }
const SORPRESAS_MANO: [string, string, [string, string][]][] = [
  ['puente', 'Puentes no obvios (La Mano)', [['real', '✓ Es real'], ['casualidad', '✕ Casualidad']]],
  ['contradiccion', '¿Se cae lo que creías? (La Mano)', [['actualizo', 'Actualizo'], ['sostengo', 'Sostengo'], ['pruebo', 'Lo pruebo']]],
  ['combo', 'Combos e hipótesis (La Mano)', [['real', '✓ Vale'], ['casualidad', '✕ Casualidad']]],
]

/**
 * Resolver algo desde la bandeja: va por el camino de siempre (y queda anotado ahí). Directo: id «sesión:propuesta».
 * La Mano: la acción es la respuesta de la sorpresa (real, casualidad, actualizo…).
 */
export async function resolverBandeja(db: Db, tipo: string, id: number | string, accion: string, ahora = Date.now()) {
  if (tipo === 'directo') {
    const [sesion, ...resto] = String(id).split(':')
    if (accion !== 'aceptar' && accion !== 'descartar') throw new Error('Aceptar o descartar')
    return (await import('./directo.ts')).resolverPropuestas(db, Number(sesion), [resto.join(':')], accion === 'aceptar' ? 'aceptar' : 'rechazar', ahora)
  }
  if (tipo.startsWith('mano_')) return (await import('./mano.ts')).responderSorpresa(db, Number(id), accion, null, ahora)
  if (tipo === 'propuesta') {
    if (accion !== 'aceptar' && accion !== 'descartar') throw new Error('Aceptar o descartar')
    return (await import('./chat/index.ts')).resolverPropuesta(db, Number(id), accion === 'aceptar' ? 'aceptada' : 'descartada')
  }
  if (accion !== 'aceptar' && accion !== 'descartar') throw new Error('Aceptar o descartar')
  id = Number(id)
  if (tipo === 'monto') return resolverSugerido(db, id, accion, {}, ahora)
  if (tipo === 'primaria') return actualizarMision(db, id, { estado: accion === 'aceptar' ? 'activa' : 'descartada' }, { por: 'operador', ahora })
  if (tipo === 'inventario') return editarItem(db, id, { estado: accion === 'aceptar' ? 'vigente' : 'archivado' }, ahora)
  if (tipo === 'recuerdo') return accion === 'aceptar' ? revisar(db, id) : archivar(db, id)
  if (tipo === 'aprender') {
    const ac = await import('./academia.ts')
    return accion === 'aceptar' ? ac.aceptarSugerencia(db, id, ahora) : ac.descartarSugerencia(db, id)
  }
  throw new Error(`«${tipo}» se resuelve en su sección`)
}

type Pedido = { tipo: string; id: number | string; accion: string }

/** Varias de una («aceptar todas las tareas», «todo»): cada una por su camino; lo que falle se informa sin frenar el resto. */
export async function resolverLote(db: Db, items: Pedido[], ahora = Date.now()) {
  const errores: string[] = []
  let hechas = 0
  for (const x of items.slice(0, 200)) {
    try { await resolverBandeja(db, String(x.tipo), x.id, String(x.accion), ahora); hechas++ } catch (e) { errores.push(e instanceof Error ? e.message : String(e)) }
  }
  return { hechas, errores }
}

/** Lo de un grupo entero (o de todos) que admite esa acción, tal como está en la bandeja. */
export function pedidosDeGrupo(db: Db, o: { tipo?: string; todo?: boolean; accion: string }, ahora = Date.now()): Pedido[] {
  return bandeja(db, ahora).grupos
    .filter((g) => (o.todo || g.tipo === o.tipo) && g.acciones?.some(([a]) => a === o.accion))
    .flatMap((g) => g.items.map((i) => ({ tipo: g.tipo, id: i.id, accion: o.accion })))
}

// ─── el aviso diario ────────────────────────────────────────────────────

const indiceDe = (tipo: string) => CLAVES_TIPO.indexOf(tipo)
export const tipoDeIndice = (i: number) => CLAVES_TIPO[i] ?? null

/**
 * El resumen de la noche (solo si hay algo): lo que espera tu ok, lo que hizo solo y, si un tipo acierta casi siempre,
 * la oferta de hacerlo solo (una vez cada dos semanas por tipo). Devuelve el texto y los botones.
 */
export function avisoBandeja(db: Db, ahora = Date.now()): { texto: string; botones: { texto: string; dato: string }[][] } | null {
  const b = bandeja(db, ahora)
  const ofrecidas = json<Record<string, number>>(ajuste(db, 'sombra_ofertas'), {}) ?? {}
  const ofertas = b.ofertas.filter((o) => ahora - (ofrecidas[o.tipo] ?? 0) > 14 * 86_400_000).slice(0, 2)
  if (!b.total && !b.hechoSolo.length && !ofertas.length) return null
  for (const o of ofertas) ofrecidas[o.tipo] = ahora
  if (ofertas.length) fijarAjuste(db, 'sombra_ofertas', JSON.stringify(ofrecidas))
  const texto = [
    b.total ? `📥 **Para decidir** (${b.total}): ${b.grupos.slice(0, 5).map((x) => `${x.n} ${x.nombre.toLowerCase()}`).join(' · ')}. Está todo junto en Hoy → 📥.` : '',
    b.hechoSolo.length ? `🤖 Hoy hice solo ${b.hechoSolo.length} ${b.hechoSolo.length === 1 ? 'cosa' : 'cosas'} (se deshacen desde Hoy → 📥).` : '',
    ...ofertas.map((o) => `🎯 «${o.nombre}»: acerté ${o.aciertos} de ${o.n} (${Math.round((o.tasa ?? 0) * 100)} %). ¿Lo hago solo de ahora en más? Siempre deshacible.`),
  ].filter(Boolean).join('\n\n')
  return { texto, botones: ofertas.map((o) => [{ texto: `✓ Sí, ${TIPOS[o.tipo].nombre.split(' ')[0].toLowerCase()} solo`, dato: `sm:${indiceDe(o.tipo)}:auto` }, { texto: 'Todavía no', dato: `sm:${indiceDe(o.tipo)}:no` }]) }
}

/** La respuesta a la oferta (botón de Telegram o pantalla). */
export function responderOferta(db: Db, tipo: string, si: boolean) {
  if (si) fijarModo(db, tipo, 'auto')
  return { tipo, modo: modoDe(db, tipo) }
}
