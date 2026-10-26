/**
 * Las pistas de una misión (plan v26, el piloto: clientes para Versa). Una pista es una organización que podría ser
 * cliente (una productora, una marca, un evento), encontrada por el agente en la web, con su link verificado (solo URLs
 * que de verdad volvieron en esa sesión) y el porqué encaja. Son oportunidades del Radar con una etapa:
 * encontrada → borrador → enviada → respondió → reunión → cliente (o descartada).
 * El agente redacta el borrador; él lo revisa en 📥 y lo manda (el agente nunca habla con nadie); después marca qué
 * pasó. Cada marca vuelve al diario de la misión (el agente aprende qué funciona) y, desde la fase 4, a su paga.
 */
import { type Db } from '../db.ts'
import { anotar } from '../decisiones.ts'
import { guardarOportunidad, TIPOS_OPORTUNIDAD } from '../radar.ts'
import type { Herramienta } from '../chat/herramientas.ts'
import { ETAPAS, NOMBRE_ETAPA, leerPista, pistasDe, embudo, progreso, type Etapa, type Pista, type Contacto } from './embudo.ts'
import { anotarDiario, editarMisionAgente, leerMisionAgente, sumarAlPrompt, sumarHerramientasMision, type MisionAgente } from './misiones.ts'

export { ETAPAS, NOMBRE_ETAPA, leerPista, pistasDe, embudo, progreso, borradoresEsperando, ingresosPorConfirmar, type Etapa, type Pista, type Contacto } from './embudo.ts'
export const CANALES = ['mail', 'web', 'formulario', 'instagram', 'linkedin', 'telefono', 'otro'] as const

const ESTADO_RADAR: Record<Etapa, string> = { encontrada: 'nueva', borrador: 'me_interesa', enviada: 'hecha', respondio: 'hecha', reunion: 'hecha', cliente: 'hecha', descartada: 'descartada' }
const normal = (u: string) => u.trim().replace(/[.,;]+$/, '').replace(/\/+$/, '').replace(/^http:\/\//, 'https://').replace(/#.*$/, '')

/**
 * Él marca qué pasó con una pista (o la descarta). Queda en el diario de la misión (el agente lo lee en su próxima
 * sesión) y, si con eso se llega al criterio, la misión queda cumplida.
 */
export function marcarPista(db: Db, id: number, etapa: Etapa, o: { nota?: string | null; ahora?: number } = {}): Pista {
  const ahora = o.ahora ?? Date.now()
  const p = leerPista(db, id)
  if (!p) throw new Error(`No existe la pista ${id}`)
  if (!ETAPAS.includes(etapa)) throw new Error('Etapa inválida')
  const notas = o.nota?.trim() ? [p.notas, o.nota.trim()].filter(Boolean).join('\n').slice(-2000) : p.notas
  db.prepare('UPDATE oportunidades SET etapa = ?, estado = ?, notas = ?, actualizada_en = ? WHERE id = ?').run(etapa, ESTADO_RADAR[etapa], notas, ahora, id)
  const m = leerMisionAgente(db, p.misionId)
  if (m && etapa !== p.etapa) {
    anotarDiario(db, m, 'resultado', `El operador marcó la pista «${p.titulo}»: ${NOMBRE_ETAPA[etapa].toLowerCase()}${o.nota?.trim() ? ` (${o.nota.trim()})` : ''}.`, { pista: id, etapa }, ahora)
    const pr = progreso(db, m)
    if (m.estado === 'activa' && pr.logrado >= pr.meta) {
      editarMisionAgente(db, m.id, { estado: 'cumplida' }, ahora)
      anotarDiario(db, m, 'resultado', `Misión cumplida: ${pr.logrado} de ${pr.meta} (${m.criterio.texto}).`, null, ahora)
    }
  }
  return leerPista(db, id)!
}

/**
 * El borrador desde 📥 o desde Agentes: «lo mando» (tal cual o editado) lo pasa a enviada; descartarlo lo devuelve a
 * encontrada. Cada decisión queda en el libro del modo sombra (cuánto acierta el agente redactando) y en su diario.
 */
export function resolverBorrador(db: Db, id: number, accion: 'enviar' | 'descartar', o: { texto?: string | null; ahora?: number } = {}): Pista {
  const ahora = o.ahora ?? Date.now()
  const p = leerPista(db, id)
  if (!p) throw new Error(`No existe la pista ${id}`)
  if (p.etapa !== 'borrador' || !p.borrador) throw new Error('Esa pista no tiene un borrador esperando')
  const editado = !!o.texto?.trim() && o.texto.trim() !== p.borrador.trim()
  if (accion === 'enviar') {
    if (editado) db.prepare('UPDATE oportunidades SET borrador = ? WHERE id = ?').run(o.texto!.trim().slice(0, 6000), id)
    anotar(db, 'agente:borrador', id, editado ? 'editada' : 'aceptada', { ahora, cambios: editado ? { antes: p.borrador, despues: o.texto!.trim() } : undefined })
    return marcarPista(db, id, 'enviada', { nota: editado ? 'lo mandó con cambios' : 'lo mandó tal cual', ahora })
  }
  anotar(db, 'agente:borrador', id, 'rechazada', { ahora })
  db.prepare(`UPDATE oportunidades SET etapa = 'encontrada', estado = 'nueva', borrador = NULL, actualizada_en = ? WHERE id = ?`).run(ahora, id)
  const m = leerMisionAgente(db, p.misionId)
  if (m) anotarDiario(db, m, 'resultado', `El operador descartó tu borrador para «${p.titulo}». Era: «${p.borrador.slice(0, 300)}»`, { pista: id }, ahora)
  return leerPista(db, id)!
}

/** Su respuesta: sí → la pista es cliente (con el ingreso anotado); no → no se vuelve a preguntar por ese ingreso. */
export function confirmarIngreso(db: Db, ref: string, si: boolean, ahora = Date.now()) {
  const [mov, pista] = ref.split(':').map(Number)
  anotar(db, 'agente:cliente', ref, si ? 'aceptada' : 'rechazada', { ahora })
  return si ? marcarPista(db, pista, 'cliente', { nota: `ingreso #${mov}`, ahora }) : { ok: true }
}

// ─── lo que ve y usa el agente ──────────────────────────────────────────

const S = (props: Record<string, unknown>, req: string[] = []) => ({ type: 'object', properties: props, required: req })
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })

export const HERRAMIENTAS_PISTAS: Herramienta[] = [
  {
    nombre: 'guardar_pista', familia: 'accion',
    descripcion: 'Guarda una organización que podría ser cliente (productora, agencia, marca, evento, medio), con el link de donde la sacaste y por qué encaja. El link tiene que ser uno que te devolvió buscar_web o leer_pagina en esta sesión. Solo organizaciones, nunca personas particulares.',
    parametros: S({
      organizacion: str('El nombre de la organización'), url: str('Su web o la página donde la encontraste (de tus resultados de esta sesión)'), canal: str('Por dónde contactarla', { enum: [...CANALES] }),
      contacto_url: str('El link de contacto si lo viste (formulario, página de contacto, perfil); también de tus resultados'), tipo: str('Qué es', { enum: [...TIPOS_OPORTUNIDAD] }),
      por_que: str('Por qué encaja con la misión, concreto'), descripcion: str('Qué hace, en una oración'), lugar: str('Ciudad, si se sabe'),
    }, ['organizacion', 'url', 'por_que']),
    ejecutar: (a, ctx) => {
      const mc = ctx.mision
      const m = mc ? leerMisionAgente(ctx.db, mc.id) : null
      if (!m || !mc) return { error: 'guardar_pista es para trabajar una misión' }
      const vistas = new Set([...mc.urlsVistas].map(normal))
      const url = String(a.url ?? '').trim()
      if (!/^https?:\/\//.test(url) || !vistas.has(normal(url))) return { error: 'Ese link no salió de tus búsquedas ni lecturas de esta sesión: buscalo o leelo primero (no se guardan links de memoria).' }
      const cu = a.contacto_url ? String(a.contacto_url).trim() : null
      const contactoUrl = cu && vistas.has(normal(cu)) ? cu : null
      const ya = ctx.db.prepare('SELECT id, agente_mision_id FROM oportunidades WHERE url = ?').get(url) as { id: number; agente_mision_id: number | null } | undefined
      if (ya?.agente_mision_id) return { pista: ya.id, aviso: ya.agente_mision_id === m.id ? 'Ya la tenías' : 'Ya es pista de otra misión' }
      const o = guardarOportunidad(ctx.db, {
        titulo: String(a.organizacion ?? '').trim(), url, tipo: TIPOS_OPORTUNIDAD.includes(a.tipo) ? a.tipo : 'contacto', descripcion: a.descripcion ?? null, porQue: a.por_que ?? null,
        entidadId: m.entidadId, origen: 'agente', donde: a.lugar ? { lugar: String(a.lugar).slice(0, 120), online: 0, lat: null, lon: null, fecha: null, fechaFin: null } : null,
      })
      if (!o) return { error: 'Falta el nombre de la organización' }
      const contacto: Contacto = { organizacion: String(a.organizacion).trim().slice(0, 160), canal: CANALES.includes(a.canal) ? a.canal : 'web', url: contactoUrl }
      ctx.db.prepare(`UPDATE oportunidades SET agente_mision_id = ?, etapa = 'encontrada', contacto = ?, actualizada_en = ? WHERE id = ?`).run(m.id, JSON.stringify(contacto), Date.now(), o.id)
      return { pista: o.id, contacto_verificado: !!contactoUrl }
    },
    resumen: (a) => `guardó una pista: ${String(a.organizacion ?? '').slice(0, 40)}`,
  },
  {
    nombre: 'redactar_borrador', familia: 'accion',
    descripcion: 'Escribe el mensaje, mail o propuesta para una de tus pistas, en la voz del operador (él lo firma y lo manda). Corto, concreto, que muestre que conocés a esa organización, con lo que se ofrece y un link de muestra si el brief lo tiene. Queda en su bandeja para que lo revise.',
    parametros: S({ pista: { type: 'integer', description: 'El id de la pista' }, asunto: str('Asunto, si es un mail'), texto: str('El mensaje completo') }, ['pista', 'texto']),
    ejecutar: (a, ctx) => {
      const m = ctx.mision ? leerMisionAgente(ctx.db, ctx.mision.id) : null
      const p = leerPista(ctx.db, Number(a.pista))
      if (!m || !p || p.misionId !== m.id) return { error: 'Esa no es una pista de tu misión' }
      if (!['encontrada', 'borrador'].includes(p.etapa)) return { error: `Esa pista ya está ${NOMBRE_ETAPA[p.etapa].toLowerCase()}: no hace falta otro borrador` }
      const texto = String(a.texto ?? '').trim()
      if (texto.length < 40) return { error: 'Un borrador así de corto no sirve: escribí el mensaje entero' }
      const completo = `${a.asunto ? `Asunto: ${String(a.asunto).trim()}\n\n` : ''}${texto}`.slice(0, 6000)
      ctx.db.prepare(`UPDATE oportunidades SET borrador = ?, etapa = 'borrador', estado = 'me_interesa', actualizada_en = ? WHERE id = ?`).run(completo, Date.now(), p.id)
      return { pista: p.id, aviso: 'Queda en su bandeja: él lo revisa y lo manda.' }
    },
    resumen: () => 'redactó un borrador para una pista',
  },
]

/** Lo que el agente ve de sus pistas al arrancar cada sesión. */
function pistasParaPrompt(db: Db, m: MisionAgente): string {
  const ps = pistasDe(db, { misionId: m.id })
  if (!ps.length) return `## Tus pistas\nTodavía ninguna. Buscá organizaciones concretas que encajen con el brief y guardalas con guardar_pista (con el link de donde las sacaste).`
  const e = embudo(db, m.id)
  const pr = progreso(db, m)
  return `## Tus pistas (${pr.logrado} de ${pr.meta} para el criterio)
Embudo: ${ETAPAS.filter((x) => e[x]).map((x) => `${NOMBRE_ETAPA[x]} ${e[x]}`).join(' · ')}
${ps.slice(0, 40).map((p) => `- #${p.id} ${p.contacto.organizacion || p.titulo} [${NOMBRE_ETAPA[p.etapa]}] ${p.url ?? ''}${p.notas ? ` — ${p.notas.split('\n').at(-1)}` : ''}`).join('\n')}
Las pistas en «Encontrada» esperan tu borrador (redactar_borrador). Las enviadas las sigue él: no les redactes otro.`
}

sumarHerramientasMision(HERRAMIENTAS_PISTAS)
sumarAlPrompt(pistasParaPrompt)
