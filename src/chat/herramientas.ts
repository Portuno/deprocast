/**
 * Las herramientas de Mastropiero: todo lo que se puede hacer en la plataforma, en forma de funciones
 * que un modelo puede pedir. Tres familias: lectura, acción y destructiva (esta última exige `confirmado`).
 * Los agentes de la liga, cuando conversan, reciben solo un subconjunto de lectura.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ATRIBUTOS, CLASE_IDS, CLASES } from '../clases.ts'
import { fechaLocal, type Db } from '../db.ts'
import { archivar, corregir, HORIZONTES, memoriaVigente, recordar, TIPOS_MEMORIA } from '../memoria.ts'
import { aHora, armarJornada, leerJornada, marcarBloque, progreso } from '../jornada.ts'
import { asientos, especializacion } from '../auditor.ts'
import { leerTarea, publicar, tareas } from '../bus.ts'
import { asegurarFuente, buscar, esNivel, fuentes, leerPieza, listarPiezas, NIVELES, type Nivel, type Pieza } from '../corpus.ts'
import { deshacer, listarCargas } from '../cargas/index.ts'
import { coocurrencias, entidadesPorId, leerEntidad, listarEntidades, resumenEntidades } from '../entidades.ts'
import { cronica, crearProyecto, estadoLiga, ingerir, numeroDeTick, tickUnico } from '../mastropiero.ts'
import { usoDelMes } from '../nan.ts'
import {
  aceptarPropuesta, crearQuantomo, descartar, leerQuantomo, listarQuantomos, pedirMejora, quantomosDePieza, resumenQuantomos, sellar,
} from '../quantomos.ts'
import { alias, bautizar, cambiarEstado, forjar, lapidas, leer, listar, nivel, retirar, type Ficha } from '../roster.ts'
import { capa } from '../xp.ts'

export type Ctx = {
  db: Db
  conversacionId: number | null
  /** Para agentes conversando: tope de lectura según su nivel. */
  lecturaMax?: number
  /** Inyectado por el motor del chat para no importar en círculo. */
  hablarConAgente?: (agenteId: string, mensaje: string) => Promise<string>
}

export type Herramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
  familia: 'lectura' | 'accion' | 'destructiva'
  ejecutar: (a: any, ctx: Ctx) => unknown | Promise<unknown>
  resumen?: (a: any, r: any) => string
}

// ─── formas compactas (lo que ve el modelo) ─────────────────────────────

const recorte = (s: string | null | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s ?? '')

function agenteCorto(db: Db, f: Ficha) {
  return {
    id: f.id, nombre: f.nombre, clase: f.clase, nivel: nivel(f), xp: f.xp, estado: f.estado, proyecto: f.proyectoId,
    especializacion: especializacion(db, f.id), motor: f.motor, exitos: f.exitos, fallos: f.fallos, celda: f.celda,
  }
}

function piezaCorta(p: Pieza, largo = 280) {
  return {
    id: p.id, nivel: `${NIVELES[p.nivel].numero} ${NIVELES[p.nivel].nombre}`, fuente: p.fuente, tipo: p.tipo, titulo: p.titulo,
    autor: p.autor ?? undefined, fecha: p.fecha?.slice(0, 10) ?? undefined, url: p.url ?? undefined, peso: p.peso ?? undefined,
    etiquetas: p.etiquetas.length ? p.etiquetas.slice(0, 8) : undefined, extracto: recorte(p.contenido, largo),
  }
}

const S = (props: Record<string, unknown>, req: string[] = []) => ({ type: 'object', properties: props, required: req })
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const int = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'integer', description, ...extra })
const bool = (description: string) => ({ type: 'boolean', description })
const NIVEL_ENUM = Object.keys(NIVELES)

function exigirConfirmacion(a: { confirmado?: boolean }, que: string) {
  if (a.confirmado !== true) {
    return { requiere_confirmacion: true, mensaje: `Esto ${que}. Pedile confirmación explícita al operador y, si dice que sí, volvé a llamar con confirmado=true.` }
  }
  return null
}

// ─── lineamientos ───────────────────────────────────────────────────────

const RAIZ = path.resolve(import.meta.dirname, '..', '..')

export function lineamientos(seccion?: string) {
  const readme = fs.existsSync(path.join(RAIZ, 'README.md')) ? fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8') : ''
  const secciones = readme.split(/\n(?=## )/).map((s) => ({ titulo: (s.match(/^##? (.+)/)?.[1] ?? 'Intro').trim(), texto: s.trim() }))
  const codigo = fs.readdirSync(path.join(RAIZ, 'src'), { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).sort().map((f) => {
    const t = fs.readFileSync(path.join(RAIZ, 'src', f), 'utf8')
    const doc = t.match(/\/\*\*([\s\S]*?)\*\//)?.[1].replace(/^\s*\* ?/gm, '').replace(/\s+/g, ' ').trim() ?? ''
    return { archivo: `src/${f.replace(/\\/g, '/')}`, lineas: t.split('\n').length, que_hace: recorte(doc, 220) }
  })
  if (seccion) {
    const s = secciones.find((x) => x.titulo.toLowerCase().includes(seccion.toLowerCase()))
    return s ? { seccion: s.titulo, texto: s.texto } : { error: `No hay sección «${seccion}»`, secciones: secciones.map((x) => x.titulo) }
  }
  return { secciones: secciones.map((x) => x.titulo), readme: recorte(readme, 14000), mapa_del_codigo: codigo }
}

// ─── el catálogo ────────────────────────────────────────────────────────

export const HERRAMIENTAS: Herramienta[] = [
  // Lectura
  {
    nombre: 'estado_general', familia: 'lectura',
    descripcion: 'Foto de la plataforma: roster por estado, bus, corpus por nivel, quántomos, entidades, cargas, proyectos, tick actual y tokens de NaN del mes.',
    parametros: S({}),
    ejecutar: (_, { db }) => {
      const l = estadoLiga(db)
      return {
        tick: numeroDeTick(db), proyectos: l.proyectos, agentes: l.agentes, bus: l.tareas,
        corpus_por_nivel: l.niveles, quantomos: resumenQuantomos(db), entidades: resumenEntidades(db), caidos: l.lapidas,
        cargas: listarCargas(db).slice(0, 5).map((c) => ({ id: c.id, archivo: c.archivo, estado: c.estado, piezas: c.resumen?.piezas })),
        tokens_nan_mes: usoDelMes(db).map((u) => ({ modelo: u.modelo, tokens: u.tokens, cupo: u.cupo })),
      }
    },
  },
  {
    nombre: 'listar_agentes', familia: 'lectura',
    descripcion: 'Lista el roster de agentes vivos (no los retirados). Filtros opcionales.',
    parametros: S({ clase: str('Clase', { enum: CLASE_IDS }), estado: str('Estado', { enum: ['prueba', 'activo', 'banca'] }), proyecto: str('id de proyecto') }),
    ejecutar: (a, { db }) => listar(db, { clase: a.clase, estado: a.estado, proyectoId: a.proyecto }).map((f) => agenteCorto(db, f)),
  },
  {
    nombre: 'ver_agente', familia: 'lectura',
    descripcion: 'La carta completa de un agente (por id o nombre): atributos, capa, instrucciones y su bitácora reciente.',
    parametros: S({ id: str('id (GEN-0001) o nombre') }, ['id']),
    ejecutar: (a, { db }) => {
      const f = leer(db, a.id)
      if (!f) return { error: `No existe ${a.id} (puede estar retirado: ver listar_caidos)` }
      return { ...agenteCorto(db, f), atributos: f.atributos, capa: capa(nivel(f)), instrucciones: f.instrucciones, creador: f.creador,
        bitacora: asientos(db, { agenteId: f.id, limite: 10 }).map((x) => ({ ok: x.ok, tarea: x.tareaId, decision: recorte(x.decision, 140) })) }
    },
  },
  {
    nombre: 'listar_caidos', familia: 'lectura', descripcion: 'El cementerio: agentes retirados y por qué.', parametros: S({}),
    ejecutar: (_, { db }) => lapidas(db).slice(0, 30),
  },
  {
    nombre: 'ver_bus', familia: 'lectura',
    descripcion: 'Misiones del bus. Sin estado devuelve las más recientes.',
    parametros: S({ estado: str('Estado', { enum: ['pendiente', 'asignada', 'hecha', 'fallida'] }), limite: int('Cuántas (máx. 40)') }),
    ejecutar: (a, { db }) => tareas(db, a.estado, Math.min(a.limite ?? 15, 40)).map((t) => ({
      id: t.id, clase: t.clase, tipo: t.tipo, estado: t.estado, agente: t.asignadaA, texto: recorte(String(t.payload.texto ?? t.payload.titulo ?? ''), 120), error: t.error ?? undefined,
    })),
  },
  {
    nombre: 'ver_mision', familia: 'lectura', descripcion: 'Una misión completa con su resultado.', parametros: S({ id: int('id de la misión') }, ['id']),
    ejecutar: (a, { db }) => {
      const t = leerTarea(db, a.id)
      if (!t) return { error: `No existe la misión ${a.id}` }
      const r = t.resultado && Array.isArray((t.resultado as any).embedding) ? { ...t.resultado, embedding: `[${(t.resultado as any).embedding.length} dimensiones]` } : t.resultado
      return { ...t, resultado: r }
    },
  },
  {
    nombre: 'buscar_corpus', familia: 'lectura',
    descripcion: 'Busca en el corpus (texto completo, ignora tildes). Devuelve piezas con id, nivel y extracto. Filtros opcionales por nivel, fuente o tipo.',
    parametros: S({ consulta: str('Qué buscar'), nivel: str('Nivel', { enum: NIVEL_ENUM }), fuente: str('id de fuente'), tipo: str('Tipo', { enum: ['materia', 'referencia', 'ficha', 'lista', 'enlace'] }), limite: int('Cuántas (máx. 20)') }, ['consulta']),
    ejecutar: (a, { db, lecturaMax }) => {
      const limite = Math.min(a.limite ?? 8, lecturaMax ?? 20)
      if (!a.fuente && !a.tipo) {
        const ps = buscar(db, a.consulta, limite, null, a.nivel && esNivel(a.nivel) ? [a.nivel as Nivel] : undefined)
        if (ps.length) return ps.map((p) => piezaCorta(p))
      }
      const r = listarPiezas(db, { q: a.consulta, nivel: a.nivel, fuente: a.fuente, tipo: a.tipo, limite })
      return { total: r.total, piezas: r.piezas.map((p) => piezaCorta(p)) }
    },
    resumen: (a, r) => `buscó «${a.consulta}» → ${Array.isArray(r) ? r.length : r?.piezas?.length ?? 0} piezas`,
  },
  {
    nombre: 'leer_pieza', familia: 'lectura', descripcion: 'Una pieza del corpus entera, con sus quántomos y entidades.',
    parametros: S({ id: int('id de la pieza') }, ['id']),
    ejecutar: (a, { db }) => {
      const p = leerPieza(db, a.id)
      if (!p) return { error: `No existe la pieza ${a.id}` }
      return { ...piezaCorta(p, 9000), meta: p.meta ?? undefined, estado: p.estado,
        entidades: entidadesPorId(db, p.entidades).map((e) => `${e.tipo}: ${e.nombre}`),
        quantomos: quantomosDePieza(db, p.id).map((q) => ({ id: q.id, texto: q.texto, etapa: q.etapa, peso: q.peso })) }
    },
  },
  {
    nombre: 'listar_fuentes', familia: 'lectura', descripcion: 'Las fuentes del corpus, con su nivel y cantidad de piezas.', parametros: S({}),
    ejecutar: (_, { db }) => fuentes(db).map((f) => ({ id: f.id, nombre: f.nombre, nivel: f.nivel, madre: f.padreId, piezas: f.piezas })),
  },
  {
    nombre: 'listar_quantomos', familia: 'lectura',
    descripcion: 'Quántomos (unidades mínimas de información). Etapas: proto, sellado, propuesta, superado, descartado.',
    parametros: S({ etapa: str('Etapa', { enum: ['proto', 'sellado', 'propuesta', 'superado', 'descartado'] }), consulta: str('Texto a buscar'), limite: int('Cuántos (máx. 30)') }),
    ejecutar: (a, { db }) => {
      const r = listarQuantomos(db, { etapa: a.etapa, q: a.consulta, limite: Math.min(a.limite ?? 15, 30) })
      return { total: r.total, quantomos: r.quantomos.map((q) => ({ id: q.id, texto: q.texto, etapa: q.etapa, peso: q.peso, version: q.version, pieza: q.piezaId })) }
    },
  },
  {
    nombre: 'listar_entidades', familia: 'lectura',
    descripcion: 'Personas, proyectos, agrupaciones, dominios, lugares y conceptos, ordenados por cuántas piezas los mencionan.',
    parametros: S({ tipo: str('Tipo', { enum: ['persona', 'proyecto', 'agrupacion', 'dominio', 'lugar', 'concepto'] }), consulta: str('Nombre o alias'), limite: int('Cuántas (máx. 40)') }),
    ejecutar: (a, { db }) => listarEntidades(db, { tipo: a.tipo, q: a.consulta, limite: Math.min(a.limite ?? 20, 40) })
      .map((e) => ({ id: e.id, tipo: e.tipo, nombre: e.nombre, piezas: e.piezas, alias: e.alias.slice(0, 5) })),
  },
  {
    nombre: 'ver_entidad', familia: 'lectura',
    descripcion: 'Una entidad: notas, alias, con quién aparece y las piezas que la mencionan.',
    parametros: S({ id: int('id de la entidad') }, ['id']),
    ejecutar: (a, { db }) => {
      const e = leerEntidad(db, a.id)
      if (!e) return { error: `No existe la entidad ${a.id}` }
      return { ...e, aparece_con: coocurrencias(db, e.id, 10).map((x) => ({ id: x.id, tipo: x.tipo, nombre: x.nombre, piezas_compartidas: x.compartidas })),
        piezas: listarPiezas(db, { entidad: e.id, limite: 12 }).piezas.map((p) => piezaCorta(p, 160)) }
    },
  },
  {
    nombre: 'listar_cargas', familia: 'lectura', descripcion: 'Las cargas de archivos: qué entró, cuándo y en qué estado.', parametros: S({}),
    ejecutar: (_, { db }) => listarCargas(db).map((c) => ({ id: c.id, archivo: c.archivo, importador: c.importador, estado: c.estado, fuente: c.fuenteId, resumen: c.resumen })),
  },
  {
    nombre: 'ver_cronica', familia: 'lectura', descripcion: 'Los últimos eventos de la liga, tick por tick.', parametros: S({ limite: int('Cuántos (máx. 80)') }),
    ejecutar: (a, { db }) => cronica(db, Math.min(a.limite ?? 30, 80)),
  },
  {
    nombre: 'leer_lineamientos', familia: 'lectura',
    descripcion: 'Tus propios lineamientos: el README de Deprocast 1.0 (diseño, reglas, clases, corpus, quántomos) y un mapa del código. Usalo para explicar la plataforma o proponer mejoras.',
    parametros: S({ seccion: str('Título (o parte) de una sección del README; vacío trae todo') }),
    ejecutar: (a) => lineamientos(a.seccion),
  },
  {
    nombre: 'listar_propuestas', familia: 'lectura', descripcion: 'Las propuestas de mejora a la plataforma ya registradas y su estado.', parametros: S({}),
    ejecutar: (_, { db }) => db.prepare('SELECT id, titulo, area, prioridad, estado FROM propuestas ORDER BY id DESC LIMIT 40').all(),
  },
  {
    nombre: 'leer_memoria', familia: 'lectura',
    descripcion: 'Lo que sabés del operador: hechos, metas, preferencias, sueños y visión, con fecha. Filtrable por tipo u horizonte (castillo, campamento, trinchera).',
    parametros: S({ tipo: str('Tipo', { enum: [...TIPOS_MEMORIA] }), horizonte: str('Horizonte', { enum: [...HORIZONTES] }) }),
    ejecutar: (a, { db }) => memoriaVigente(db, { tipo: a.tipo, horizonte: a.horizonte, limite: 120 }).map((r) => ({ id: r.id, fecha: r.fecha, tipo: r.tipo, horizonte: r.horizonte, texto: r.texto })),
  },
  {
    nombre: 'ver_jornada', familia: 'lectura', descripcion: 'La jornada de un día: bloques con hora, estado y por qué, el sentido del día y su cierre.',
    parametros: S({ fecha: str('YYYY-MM-DD; vacío = hoy') }),
    ejecutar: (a, { db }) => {
      const j = leerJornada(db, a.fecha || fechaLocal())
      return j ? { ...j, progreso: progreso(j) } : { sin_jornada: true, fecha: a.fecha || fechaLocal() }
    },
  },

  // Acción
  {
    nombre: 'forjar_agente', familia: 'accion',
    descripcion: `Crea un agente nuevo (entra en prueba). Clases: ${CLASE_IDS.join(', ')}. Atributos (reparto de hasta 6 puntos extra sobre la base, tope 6 cada uno): ${ATRIBUTOS.map((a) => `${a.id} (${a.efecto})`).join('; ')}. Un ejecutivo necesita motor funcion:<nombre>.`,
    parametros: S({
      clase: str('Clase', { enum: CLASE_IDS }), instrucciones: str('Qué hace y cómo, en una o dos oraciones'),
      reparto: { type: 'object', description: 'Puntos extra por atributo', properties: Object.fromEntries(ATRIBUTOS.map((a) => [a.id, int(a.nombre)])) },
      motor: str('local | nan | llm | funcion:<n>; vacío = el de por defecto'), proyecto: str('id de proyecto, si es de la casa'), celda: int('Celda de la Matriz 72 (1–72)'),
    }, ['clase']),
    ejecutar: (a, { db }) => {
      const f = forjar(db, { clase: a.clase, instrucciones: a.instrucciones, reparto: a.reparto, motor: a.motor || undefined, proyectoId: a.proyecto || null, celda: a.celda || null, creador: 'mastropiero' })
      return { forjado: agenteCorto(db, f), atributos: f.atributos, nota: 'Entra en prueba: 3 éxitos y juega, 3 fallos y se retira.' }
    },
    resumen: (a, r) => (r?.forjado ? `forjó ${r.forjado.id} (${CLASES[a.clase as keyof typeof CLASES]?.nombre ?? a.clase})` : 'intentó forjar'),
  },
  {
    nombre: 'bautizar_agente', familia: 'accion', descripcion: 'Pone nombre a un agente de nivel 3 o más.',
    parametros: S({ id: str('id del agente'), nombre: str('Nombre único') }, ['id', 'nombre']),
    ejecutar: (a, { db }) => (bautizar(db, a.id, a.nombre), agenteCorto(db, leer(db, a.id)!)),
    resumen: (a) => `bautizó ${a.id} como ${a.nombre}`,
  },
  {
    nombre: 'crear_proyecto', familia: 'accion', descripcion: 'Crea un proyecto; nace con su gerente.',
    parametros: S({ nombre: str('Nombre del proyecto') }, ['nombre']),
    ejecutar: (a, { db }) => {
      const r = crearProyecto(db, a.nombre)
      return { proyecto: r.id, gerente: r.gerente.id }
    },
    resumen: (a, r) => `creó el proyecto ${a.nombre}${r?.gerente ? ` con ${r.gerente}` : ''}`,
  },
  {
    nombre: 'publicar_mision', familia: 'accion',
    descripcion: 'Publica una misión en el bus para una clase. Se corre en el próximo tick. Crawler necesita url; auditor puede llevar agente_objetivo.',
    parametros: S({ clase: str('Clase', { enum: CLASE_IDS }), texto: str('La misión'), proyecto: str('id de proyecto'), dominio: str('Dominio'), url: str('URL (crawler)'), agente_objetivo: str('Agente a auditar') }, ['clase', 'texto']),
    ejecutar: (a, { db }) => {
      const payload: Record<string, unknown> = { texto: a.texto }
      if (a.url) payload.url = a.url
      if (a.agente_objetivo) payload.agenteId = a.agente_objetivo
      const t = publicar(db, { clase: a.clase, payload, publicadaPor: 'mastropiero', proyectoId: a.proyecto || null, dominio: a.dominio || null })
      return { mision: t.id, clase: t.clase, estado: t.estado }
    },
    resumen: (a, r) => `publicó la misión #${r?.mision ?? '?'} para ${a.clase}`,
  },
  {
    nombre: 'correr_ticks', familia: 'accion',
    descripcion: 'Hace correr la liga: purga → reparte → corre. Devuelve los eventos. Más de 3 ticks requiere confirmación.',
    parametros: S({ n: int('Cuántos ticks (1–10)'), confirmado: bool('true solo si el operador confirmó más de 3') }),
    ejecutar: async (a, { db }) => {
      const n = Math.max(1, Math.min(a.n ?? 1, 10))
      if (n > 3) {
        const c = exigirConfirmacion(a, `corre ${n} ticks (puede gastar tokens)`)
        if (c) return c
      }
      const salida: { tick: number; eventos: string[] }[] = []
      for (let i = 0; i < n; i++) {
        const ev = await tickUnico(db)
        salida.push({ tick: numeroDeTick(db), eventos: ev.map((e) => `${e.tipo}: ${e.texto}`) })
      }
      return salida
    },
    resumen: (a, r) => (Array.isArray(r) ? `corrió ${r.length} tick${r.length === 1 ? '' : 's'} (${r.reduce((s, t) => s + t.eventos.length, 0)} eventos)` : 'pidió confirmación para correr ticks'),
  },
  {
    nombre: 'ingerir', familia: 'accion',
    descripcion: 'Agrega una pieza al corpus y arranca su pipeline. Nivel: propia (del operador), primaria (obra de un tercero), investigacion (síntesis o curación), generada (de un modelo).',
    parametros: S({ nivel: str('Nivel', { enum: NIVEL_ENUM }), titulo: str('Título'), contenido: str('Texto'), fuente: str('id de fuente (por defecto operador)'), tipo: str('materia | referencia', { enum: ['materia', 'referencia'] }), autor: str('Autor'), url: str('URL'), dominio: str('Dominio') }, ['nivel', 'titulo', 'contenido']),
    ejecutar: (a, { db }) => {
      const r = ingerir(db, { fuente: a.fuente || (a.nivel === 'generada' ? 'agentes' : 'operador'), nivel: a.nivel, tipo: a.tipo, titulo: a.titulo, contenido: a.contenido, autor: a.autor, url: a.url, dominio: a.dominio })
      return { pieza: r.corpusId, mision_extractor: r.tarea.id }
    },
    resumen: (a, r) => `ingirió «${recorte(a.titulo, 40)}» → pieza #${r?.pieza ?? '?'}`,
  },
  {
    nombre: 'crear_fuente', familia: 'accion', descripcion: 'Crea una fuente nueva para el corpus.',
    parametros: S({ nombre: str('Nombre'), nivel: str('Nivel por defecto', { enum: NIVEL_ENUM }), madre: str('id de la fuente madre (ej. deprocast-0.7)'), descripcion: str('Qué entra por acá') }, ['nombre', 'nivel']),
    ejecutar: (a, { db }) => asegurarFuente(db, { nombre: a.nombre, nivel: a.nivel, padreId: a.madre || null, descripcion: a.descripcion }),
    resumen: (a) => `creó la fuente ${a.nombre}`,
  },
  {
    nombre: 'crear_quantomo', familia: 'accion', descripcion: 'Registra un quántomo proto (una afirmación atómica), opcionalmente colgado de una pieza.',
    parametros: S({ texto: str('La afirmación'), pieza: int('id de la pieza de la que sale') }, ['texto']),
    ejecutar: (a, { db }) => ({ quantomo: crearQuantomo(db, { texto: a.texto, piezaId: a.pieza ?? null, etapa: 'proto', procedencia: 'chat con Mastropiero' }) }),
    resumen: (_, r) => `registró el quántomo proto #${r?.quantomo}`,
  },
  {
    nombre: 'sellar_quantomo', familia: 'accion', descripcion: 'Sella un quántomo proto con un peso de 1 a 12. Solo cuando el operador dio el peso.',
    parametros: S({ id: int('id'), peso: int('1 a 12') }, ['id', 'peso']),
    ejecutar: (a, { db }) => (sellar(db, a.id, a.peso), leerQuantomo(db, a.id)),
    resumen: (a) => `selló el quántomo #${a.id} con peso ${a.peso}`,
  },
  {
    nombre: 'pedir_mejora_quantomo', familia: 'accion', descripcion: 'Le encarga a un generativo una versión mejor de un quántomo; vuelve como propuesta.',
    parametros: S({ id: int('id'), instruccion: str('Qué mejorar') }, ['id']),
    ejecutar: (a, { db }) => ({ mision: pedirMejora(db, a.id, a.instruccion ?? '').id }),
    resumen: (a, r) => `pidió mejorar el quántomo #${a.id} (misión #${r?.mision})`,
  },
  {
    nombre: 'resolver_propuesta_quantomo', familia: 'accion', descripcion: 'Acepta o descarta una versión propuesta de un quántomo. Solo por decisión del operador.',
    parametros: S({ id: int('id de la propuesta'), accion: str('aceptar | descartar', { enum: ['aceptar', 'descartar'] }), peso: int('Peso, si quiere cambiarlo') }, ['id', 'accion']),
    ejecutar: (a, { db }) => (a.accion === 'aceptar' ? aceptarPropuesta(db, a.id, a.peso ?? null) : descartar(db, a.id), leerQuantomo(db, a.id)),
    resumen: (a) => `${a.accion === 'aceptar' ? 'aceptó' : 'descartó'} la propuesta #${a.id}`,
  },
  {
    nombre: 'hablar_con_agente', familia: 'accion',
    descripcion: 'Le habla a un agente de la liga y devuelve su respuesta. El agente contesta desde su oficio y puede leer el corpus según su nivel.',
    parametros: S({ id: str('id o nombre del agente'), mensaje: str('Qué decirle o preguntarle') }, ['id', 'mensaje']),
    ejecutar: async (a, ctx) => {
      if (!ctx.hablarConAgente) return { error: 'Conversación entre agentes no disponible acá' }
      const f = leer(ctx.db, a.id)
      if (!f) return { error: `No existe ${a.id}` }
      return { agente: alias(f), respuesta: await ctx.hablarConAgente(f.id, a.mensaje) }
    },
    resumen: (a) => `habló con ${a.id}`,
  },
  {
    nombre: 'proponer_mejora', familia: 'accion',
    descripcion: 'Registra una propuesta de mejora a la plataforma (código, diseño, reglas). Queda abierta para que el operador la acepte o la descarte; no se aplica sola.',
    parametros: S({ titulo: str('Título corto'), detalle: str('Qué cambiar, por qué y cómo, concreto'), area: str('liga | forja | corpus | quantomos | entidades | chat | pantalla | motores | otro'), prioridad: str('alta | media | baja', { enum: ['alta', 'media', 'baja'] }) }, ['titulo', 'detalle']),
    ejecutar: (a, { db, conversacionId }) => {
      const r = db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, conversacion_id, creada_en) VALUES (?, ?, ?, ?, 'abierta', ?, ?)`)
        .run(a.titulo, a.detalle, a.area ?? null, a.prioridad ?? 'media', conversacionId, Date.now())
      return { propuesta: Number(r.lastInsertRowid), estado: 'abierta' }
    },
    resumen: (a, r) => `propuso la mejora #${r?.propuesta}: ${recorte(a.titulo, 50)}`,
  },

  {
    nombre: 'recordar', familia: 'accion',
    descripcion: 'Guarda algo del operador en tu memoria (hecho, meta, preferencia, sueño, visión o corrección). La memoria ya se escribe sola con lo que te cuenta: usalo cuando te pida que te acuerdes de algo.',
    parametros: S({ texto: str('Una oración en tercera persona («Quiere…», «Prefiere…»)'), tipo: str('Tipo', { enum: [...TIPOS_MEMORIA] }), horizonte: str('Para metas: castillo (años), campamento (meses), trinchera (días)', { enum: [...HORIZONTES] }) }, ['texto', 'tipo']),
    ejecutar: (a, { db, conversacionId }) => {
      const r = recordar(db, { texto: a.texto, tipo: a.tipo, horizonte: a.horizonte, origen: conversacionId, creadaPor: 'mastropiero', revisada: true })
      return { recuerdo: r.id, texto: r.texto }
    },
    resumen: (a) => `recordó: ${recorte(a.texto, 60)}`,
  },
  {
    nombre: 'corregir_memoria', familia: 'accion', descripcion: 'Corrige un recuerdo cuando el operador te corrige. La versión vieja queda como corregida.',
    parametros: S({ id: int('id del recuerdo'), texto: str('El texto corregido'), tipo: str('Tipo', { enum: [...TIPOS_MEMORIA] }), horizonte: str('Horizonte', { enum: [...HORIZONTES] }) }, ['id']),
    ejecutar: (a, { db }) => corregir(db, a.id, { texto: a.texto, tipo: a.tipo, horizonte: a.horizonte }, 'mastropiero'),
    resumen: (a) => `corrigió un recuerdo${a.texto ? `: ${recorte(a.texto, 50)}` : ''}`,
  },
  {
    nombre: 'armar_jornada', familia: 'accion',
    descripcion: 'Arma la jornada de un día en bloques (según su memoria, lo que hablaron, su calendario y su ayer). Para hoy desde una hora, usá rehacer_desde_ahora.',
    parametros: S({ fecha: str('YYYY-MM-DD; vacío = hoy'), desde: str('HH:MM desde donde armar') }),
    ejecutar: async (a, { db }) => {
      const { jornada, avisos } = await armarJornada(db, a.fecha || fechaLocal(), { desde: a.desde })
      return { fecha: jornada.fecha, resumen: jornada.resumen, bloques: jornada.bloques.map((b) => `${b.inicio}–${b.fin} ${b.titulo}${b.estado === 'fijo' ? ' (agenda)' : ''}`), avisos }
    },
    resumen: (_, r) => (r?.bloques ? `armó la jornada (${r.bloques.length} bloques)` : 'intentó armar la jornada'),
  },
  {
    nombre: 'rehacer_desde_ahora', familia: 'accion', descripcion: 'Rehace la jornada de hoy desde este momento: conserva lo hecho y lo pasado, reacomoda lo que sigue.',
    parametros: S({ motivo: str('Por qué se reorganiza (lo que te contó)') }),
    ejecutar: async (_, { db }) => {
      const d = new Date()
      const desde = aHora(Math.min(23 * 60 + 55, Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5))
      const { jornada } = await armarJornada(db, fechaLocal(), { desde })
      return { desde, bloques: jornada.bloques.filter((b) => b.inicio >= desde).map((b) => `${b.inicio} ${b.titulo}`) }
    },
    resumen: (_, r) => (r?.desde ? `rehízo el día desde las ${r.desde}` : 'intentó rehacer el día'),
  },
  {
    nombre: 'marcar_bloque', familia: 'accion', descripcion: 'Marca un bloque de la jornada como hecho, saltado o pendiente (cuando te cuenta cómo va).',
    parametros: S({ id: str('id del bloque (ver_jornada)'), estado: str('Estado', { enum: ['hecho', 'saltado', 'pendiente'] }), fecha: str('YYYY-MM-DD; vacío = hoy') }, ['id', 'estado']),
    ejecutar: (a, { db }) => progreso(marcarBloque(db, a.fecha || fechaLocal(), a.id, a.estado)),
    resumen: (a) => `marcó un bloque como ${a.estado}`,
  },

  // Destructivas
  {
    nombre: 'olvidar', familia: 'destructiva', descripcion: 'Archiva un recuerdo del operador (deja de usarse). Requiere confirmación.',
    parametros: S({ id: int('id del recuerdo'), confirmado: bool('true solo si el operador confirmó') }, ['id']),
    ejecutar: (a, { db }) => exigirConfirmacion(a, `archiva el recuerdo #${a.id}`) ?? (archivar(db, a.id), { archivado: a.id }),
    resumen: (a, r) => (r?.requiere_confirmacion ? 'pidió confirmación para olvidar algo' : `olvidó el recuerdo #${a.id}`),
  },
  {
    nombre: 'cambiar_estado_agente', familia: 'destructiva',
    descripcion: 'Manda un agente activo a la banca o devuelve uno de la banca al juego. Requiere confirmación del operador.',
    parametros: S({ id: str('id'), estado: str('activo | banca', { enum: ['activo', 'banca'] }), confirmado: bool('true solo si el operador confirmó') }, ['id', 'estado']),
    ejecutar: (a, { db }) => exigirConfirmacion(a, `cambia a ${a.id} a ${a.estado}`) ?? (cambiarEstado(db, a.id, a.estado), agenteCorto(db, leer(db, a.id)!)),
    resumen: (a, r) => (r?.requiere_confirmacion ? `pidió confirmación para ${a.id} → ${a.estado}` : `pasó ${a.id} a ${a.estado}`),
  },
  {
    nombre: 'retirar_agente', familia: 'destructiva',
    descripcion: 'Retira un agente para siempre (va al cementerio; su designación y nombre no vuelven). Requiere confirmación.',
    parametros: S({ id: str('id'), causa: str('Por qué'), confirmado: bool('true solo si el operador confirmó') }, ['id']),
    ejecutar: (a, { db }) => {
      const c = exigirConfirmacion(a, `retira a ${a.id} para siempre`)
      if (c) return c
      if (!leer(db, a.id)) return { error: `No existe ${a.id}` }
      retirar(db, a.id, a.causa || 'retirado por el operador')
      return { retirado: a.id }
    },
    resumen: (a, r) => (r?.requiere_confirmacion ? `pidió confirmación para retirar ${a.id}` : `retiró a ${a.id}`),
  },
  {
    nombre: 'deshacer_carga', familia: 'destructiva',
    descripcion: 'Saca del corpus todo lo que entró con una carga (piezas, quántomos, entidades). Requiere confirmación.',
    parametros: S({ id: int('id de la carga'), confirmado: bool('true solo si el operador confirmó') }, ['id']),
    ejecutar: (a, { db }) => exigirConfirmacion(a, `borra del corpus todo lo de la carga #${a.id}`) ?? deshacer(db, a.id),
    resumen: (a, r) => (r?.requiere_confirmacion ? `pidió confirmación para deshacer la carga #${a.id}` : `deshizo la carga #${a.id}`),
  },
]

/** Lo que puede usar un agente de la liga cuando conversa: leer, nunca actuar. */
export const PARA_AGENTES = ['buscar_corpus', 'leer_pieza', 'listar_quantomos', 'listar_entidades', 'ver_entidad']

export function herramientasPara(con: 'mastropiero' | 'agente'): Herramienta[] {
  return con === 'mastropiero' ? HERRAMIENTAS : HERRAMIENTAS.filter((h) => PARA_AGENTES.includes(h.nombre))
}

/** El formato que entiende el modelo (tools de OpenAI). */
export function esquemas(hs: Herramienta[]) {
  return hs.map((h) => ({ type: 'function', function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } }))
}

export async function ejecutarHerramienta(hs: Herramienta[], nombre: string, argumentos: string, ctx: Ctx): Promise<{ resultado: unknown; resumen: string; ok: boolean }> {
  const h = hs.find((x) => x.nombre === nombre)
  if (!h) return { resultado: { error: `No existe la herramienta ${nombre}` }, resumen: `pidió ${nombre} (no existe)`, ok: false }
  let a: any
  try {
    a = argumentos?.trim() ? JSON.parse(argumentos) : {}
  } catch {
    return { resultado: { error: 'Argumentos que no son JSON válido' }, resumen: `${nombre}: argumentos inválidos`, ok: false }
  }
  try {
    const resultado = await h.ejecutar(a, ctx)
    const fallo = !!(resultado && typeof resultado === 'object' && 'error' in (resultado as object))
    return { resultado, resumen: h.resumen?.(a, resultado) ?? nombre.replace(/_/g, ' '), ok: !fallo }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { resultado: { error: msg }, resumen: `${nombre} falló: ${recorte(msg, 80)}`, ok: false }
  }
}
