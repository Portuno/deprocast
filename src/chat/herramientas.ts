/**
 * Las herramientas de Mastropiero: todo lo que se puede hacer en la plataforma, en forma de funciones
 * que un modelo puede pedir. Tres familias: lectura, acción y destructiva (esta última exige `confirmado`).
 * Los agentes de la liga, cuando conversan, reciben solo un subconjunto de lectura.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ATRIBUTOS, CLASE_IDS, CLASES } from '../clases.ts'
import { fechaLocal, fijarAjuste, type Db } from '../db.ts'
import { CATEGORIAS, listarMovimientos, registrarMovimiento, resumenMes } from '../finanzas.ts'
import { guardarRelacion, personas, VINCULOS } from '../personas.ts'
import { archivar, corregir, HORIZONTES, memoriaVigente, recordar, TIPOS_MEMORIA } from '../memoria.ts'
import { leerJornada, progreso } from '../jornada.ts'
import {
  actualizarMision, anotarSideQuest, arrancarRun, asignarMision, avanceDe, cerrarRun, conAvance, crearMision, descartarRun, enCurso, fijarPrincipal,
  leerRun, listarMisiones, listarPlantillas, listarReportes, marcarSecundaria, misionesDeRun, NIVELES_MISION, prepararRun, principalDe,
  procesarJugador, proponerPrimarias, rehacerRun, reporteSemana, runActual, semanaDe, type Mision,
} from '../misiones.ts'
import { aportes, ayudantesDe, CLASES_AYUDANTE, pedirAportes, quitarAyudante, sumarAyudante } from '../ayudantes.ts'
import { encolarPregunta, listarPreguntas } from '../preguntas.ts'
import { curva, prediccionesDe } from '../gemelo.ts'
import { listarCuentas, listarPublicaciones, redactarPublicaciones } from '../cuentas.ts'
import { crearImagen, crearJuego, crearPersonaje, crearVideo, crearVoz, iterarArtefacto, listarArtefactos, VOCES } from '../taller.ts'
import { buscarOportunidades, listarOportunidades, redactarOportunidad } from '../radar.ts'
import { buscarWeb, hayBuscadorWeb, leerPagina } from '../web.ts'
import { listarSesiones, momentos as momentosDirecto, sesionActiva } from '../directo.ts'
import { agregarItem, editarItem, escribirHistoria, inventarioDe, inventarioDerivado, leerHistoria, personaje, personaPorNombre, resolverPersonaje, TIPOS_INVENTARIO } from '../personajes.ts'
import { asientos, especializacion } from '../auditor.ts'
import { enEspera, leerTarea, pausarIngesta, publicar, reanudarIngesta, tareas } from '../bus.ts'
import { asegurarFuente, buscar, esNivel, fuentes, leerPieza, listarPiezas, NIVELES, type Nivel, type Pieza } from '../corpus.ts'
import { buscarHibrido } from '../semantica.ts'
import { compartidas } from '../bitacora.ts'
import { crearCuaderno, leerCuaderno, listarCuadernos, preguntar, sumarFuentes } from '../cuadernos.ts'
import { tabla as tablaEconomia } from '../economia.ts'
import { forjarMejora } from '../fragua.ts'
import { deshacer, listarCargas } from '../cargas/index.ts'
import { coocurrencias, duplicadosProbables, editarEntidad, entidadesPorId, fusionarEntidades, leerEntidad, listarEntidades, resumenEntidades, TIPOS_ENTIDAD } from '../entidades.ts'
import { cronica, crearProyecto, estadoLiga, ingerir, numeroDeTick, tickUnico } from '../mastropiero.ts'
import { tokensHoy, topeDiario, usoDelMes } from '../nan.ts'
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

function misionCorta(m: Mision) {
  return {
    id: m.id, nivel: m.nivel, titulo: m.titulo, detalle: m.detalle ? recorte(m.detalle, 240) : undefined, estado: m.estado, categoria: m.categoria ?? undefined,
    semana: m.semana ?? undefined, hora: m.inicio ? `${m.inicio}–${m.fin}` : undefined, vence: m.vence ?? undefined, disparador: m.disparador ?? undefined,
    asignada_por: m.asignadaPor !== 'jugador' ? m.asignadaPor : undefined, para: m.personaje !== 'jugador' ? m.personaje : undefined, nota: m.feedback ?? undefined,
  }
}

/** Un proyecto o persona por nombre o id, para colgarle una misión. */
function entidadId(db: Db, x: string | number): number | null {
  try {
    const k = resolverPersonaje(db, x)
    return k.startsWith('entidad:') ? Number(k.slice(8)) : null
  } catch {
    return null
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
        tokens_hoy: { ...tokensHoy(db), tope_liga: topeDiario(db) || 'sin tope' }, ingesta_en_espera: enEspera(db),
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
    descripcion: 'Encargos del bus de la liga (tareas de los agentes). Sin estado devuelve los más recientes.',
    parametros: S({ estado: str('Estado', { enum: ['pendiente', 'asignada', 'hecha', 'fallida'] }), limite: int('Cuántas (máx. 40)') }),
    ejecutar: (a, { db }) => tareas(db, a.estado, Math.min(a.limite ?? 15, 40)).map((t) => ({
      id: t.id, clase: t.clase, tipo: t.tipo, estado: t.estado, agente: t.asignadaA, texto: recorte(String(t.payload.texto ?? t.payload.titulo ?? ''), 120), error: t.error ?? undefined,
    })),
  },
  {
    nombre: 'ver_encargo', familia: 'lectura', descripcion: 'Un encargo del bus completo, con su resultado.', parametros: S({ id: int('id del encargo') }, ['id']),
    ejecutar: (a, { db }) => {
      const t = leerTarea(db, a.id)
      if (!t) return { error: `No existe el encargo ${a.id}` }
      const r = t.resultado && Array.isArray((t.resultado as any).embedding) ? { ...t.resultado, embedding: `[${(t.resultado as any).embedding.length} dimensiones]` } : t.resultado
      return { ...t, resultado: r }
    },
  },
  {
    nombre: 'buscar_corpus', familia: 'lectura',
    descripcion: 'Busca en el corpus por palabras y por significado (encuentra también lo que dice lo mismo con otras palabras). Devuelve piezas con id, nivel y extracto. Filtros opcionales por nivel, fuente o tipo.',
    parametros: S({ consulta: str('Qué buscar'), nivel: str('Nivel', { enum: NIVEL_ENUM }), fuente: str('id de fuente'), tipo: str('Tipo', { enum: ['materia', 'referencia', 'ficha', 'lista', 'enlace'] }), limite: int('Cuántas (máx. 20)') }, ['consulta']),
    ejecutar: async (a, { db, lecturaMax }) => {
      const limite = Math.min(a.limite ?? 8, lecturaMax ?? 20)
      if (!a.fuente && !a.tipo) {
        const ps = await buscarHibrido(db, a.consulta, limite, a.nivel && esNivel(a.nivel) ? [a.nivel as Nivel] : undefined)
        if (ps.length) return ps.map((p) => ({ ...piezaCorta(p), por: p.por }))
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
    nombre: 'ver_personaje', familia: 'lectura',
    descripcion: 'La ficha de un personaje: historia, inventario y misiones. Personaje: «jugador» (el operador; también es una entidad persona del corpus, con su nombre y alias), «mastropiero», un agente (id o nombre) o una entidad (id o nombre exacto).',
    parametros: S({ personaje: str('jugador | mastropiero | id o nombre de agente | id o nombre de entidad') }),
    ejecutar: (a, { db }) => {
      const k = resolverPersonaje(db, a.personaje)
      const h = leerHistoria(db, k)
      return {
        personaje: personaje(db, k), historia: h.texto ?? h.derivada, elementos: h.elementos, historia_sugerida: h.sugerencia ?? undefined,
        inventario: [...inventarioDe(db, k, { conSugeridos: true }).map((i) => ({ id: i.id, tipo: i.tipo, nombre: i.nombre, detalle: i.detalle ?? undefined, valor: i.valor ?? undefined, unidad: i.unidad ?? undefined, url: i.url ?? undefined, sugerido: i.estado === 'sugerido' || undefined })),
          ...inventarioDerivado(db, k)],
        principal: principalDe(db, k) ? misionCorta(principalDe(db, k)!) : null,
        misiones_abiertas: listarMisiones(db, { personaje: k, abiertas: true, limite: 30 }).filter((m) => m.nivel !== 'principal' && m.nivel !== 'secundaria').map(misionCorta),
      }
    },
  },
  {
    nombre: 'ver_misiones', familia: 'lectura',
    descripcion: 'Misiones con filtros. Sin filtros: las del jugador abiertas. Niveles: principal, primaria (las de la semana), secundaria (bandas de runs), terciaria (side quests). «asignadas_por_mi» trae lo que el jugador les encargó a otros.',
    parametros: S({ personaje: str('Por defecto el jugador'), nivel: str('Nivel', { enum: [...NIVELES_MISION] }), semana: str('2026-W41; «actual» para esta semana'), abiertas: bool('Solo sugeridas y activas'), asignadas_por_mi: bool('Lo que el jugador asignó a otros') }),
    ejecutar: (a, { db }) => {
      const semana = a.semana === 'actual' ? semanaDe() : a.semana
      const ms = a.asignadas_por_mi
        ? listarMisiones(db, { asignadaPor: 'jugador', excluirPersonaje: 'jugador', abiertas: a.abiertas ?? true })
        : listarMisiones(db, { personaje: resolverPersonaje(db, a.personaje), nivel: a.nivel, semana, abiertas: a.abiertas ?? !semana, limite: 80 })
      return conAvance(db, ms).map((m) => ({ ...misionCorta(m), progreso: m.avance.progreso, bandas_hechas: m.avance.bandas.hechas || undefined }))
    },
  },
  {
    nombre: 'ver_run', familia: 'lectura',
    descripcion: 'La run viva (en curso o propuesta de hoy) o una por id: su pedido, sus bandas con estado y nota, y la que toca ahora.',
    parametros: S({ id: int('id de la run; vacío = la viva') }),
    ejecutar: (a, { db }) => {
      const run = a.id ? leerRun(db, a.id) : runActual(db)
      if (!run) return { sin_run: true, plantillas: listarPlantillas(db).map((p) => p.nombre) }
      const v = enCurso(db)
      return {
        id: run.id, estado: run.estado, fecha: run.fecha, de: run.inicio, a: run.fin, resumen: run.resumen, pedido: { ...run.pedido, incluir: run.pedido.incluir?.map((e) => e.nombre) },
        agentes: run.agentes.map((x) => x.nombre), ahora: v?.run.id === run.id ? v.actual?.titulo ?? 'entre bandas' : undefined,
        bandas: misionesDeRun(db, run.id).map((m) => ({ id: m.id, hora: `${m.inicio}–${m.fin}`, titulo: m.titulo, estado: m.estado, nota: m.feedback ?? undefined })),
      }
    },
  },
  {
    nombre: 'ver_reportes', familia: 'lectura', descripcion: 'Los reportes recientes: por hora, por run y de la semana.',
    parametros: S({ tipo: str('hora | run | semana', { enum: ['hora', 'run', 'semana'] }) }),
    ejecutar: (a, { db }) => listarReportes(db, { tipo: a.tipo, limite: 8 }).map((r) => ({ id: r.id, tipo: r.tipo, cuando: new Date(r.creadoEn).toLocaleString('es-AR'), texto: recorte(r.texto, 1500) })),
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
    nombre: 'publicar_encargo', familia: 'accion',
    descripcion: 'Publica un encargo en el bus de la liga para una clase de agente. Se corre en el próximo tick. Crawler necesita url; auditor puede llevar agente_objetivo. (Las misiones del jugador o de las personas van con crear_mision.)',
    parametros: S({ clase: str('Clase', { enum: CLASE_IDS }), texto: str('El encargo'), proyecto: str('id de proyecto'), dominio: str('Dominio'), url: str('URL (crawler)'), agente_objetivo: str('Agente a auditar') }, ['clase', 'texto']),
    ejecutar: (a, { db }) => {
      const payload: Record<string, unknown> = { texto: a.texto }
      if (a.url) payload.url = a.url
      if (a.agente_objetivo) payload.agenteId = a.agente_objetivo
      const t = publicar(db, { clase: a.clase, payload, publicadaPor: 'mastropiero', proyectoId: a.proyecto || null, dominio: a.dominio || null })
      return { encargo: t.id, clase: t.clase, estado: t.estado }
    },
    resumen: (a, r) => `publicó el encargo #${r?.encargo ?? '?'} para ${a.clase}`,
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
    nombre: 'escribir_historia', familia: 'accion',
    descripcion: 'Escribe la historia (trasfondo, origen, elementos base) de un personaje. Para el jugador entra como sugerencia que él acepta, salvo que te la haya dictado.',
    parametros: S({ personaje: str('jugador | mastropiero | agente | entidad'), texto: str('La historia, en prosa'), elementos: { type: 'array', items: { type: 'string' }, description: 'Rasgos y elementos base, cortos' }, dictada: bool('true si el texto es lo que él te dijo tal cual') }, ['texto']),
    ejecutar: (a, { db }) => {
      const k = resolverPersonaje(db, a.personaje)
      const h = escribirHistoria(db, k, { texto: a.texto, elementos: a.elementos }, { sugerida: k === 'jugador' && !a.dictada })
      return { personaje: k, sugerida: !!h.sugerencia }
    },
    resumen: (a, r) => (r?.sugerida ? `sugirió una historia para ${a.personaje ?? 'el jugador'}` : `escribió la historia de ${a.personaje ?? 'el jugador'}`),
  },
  {
    nombre: 'inventario_agregar', familia: 'accion',
    descripcion: `Suma algo al inventario de un personaje. Tipos: ${TIPOS_INVENTARIO.join(', ')} (presencia = sitios web, redes, canales). Si ya está, lo actualiza.`,
    parametros: S({ personaje: str('Por defecto el jugador'), tipo: str('Tipo', { enum: [...TIPOS_INVENTARIO] }), nombre: str('Qué es'), detalle: str('Detalle'), valor: { type: 'number', description: 'Número, si hay (plata, seguidores…)' }, unidad: str('€, USD, seguidores…'), url: str('Link, si es presencia') }, ['tipo', 'nombre']),
    ejecutar: (a, { db }) => {
      const k = resolverPersonaje(db, a.personaje)
      const i = agregarItem(db, k, a, { fuente: 'mastropiero' })
      return { item: i.id, personaje: k, nombre: i.nombre }
    },
    resumen: (a) => `sumó al inventario: ${recorte(a.nombre, 50)}`,
  },
  {
    nombre: 'inventario_editar', familia: 'accion', descripcion: 'Cambia un ítem del inventario (valor, detalle) o lo archiva (estado archivado), o acepta uno sugerido (estado vigente).',
    parametros: S({ id: int('id del ítem'), nombre: str('Nombre'), detalle: str('Detalle'), valor: { type: 'number', description: 'Valor' }, unidad: str('Unidad'), url: str('Link'), estado: str('Estado', { enum: ['vigente', 'archivado'] }) }, ['id']),
    ejecutar: (a, { db }) => {
      const { id, ...c } = a
      const i = editarItem(db, id, c)
      return { item: i.id, nombre: i.nombre, estado: i.estado }
    },
    resumen: (a) => (a.estado === 'archivado' ? 'archivó un ítem del inventario' : 'actualizó el inventario'),
  },
  {
    nombre: 'sugerir_misiones', familia: 'accion',
    descripcion: 'Sugiere misiones a un personaje (entran como sugeridas: él las acepta). Para el jugador, la principal solo se sugiere. Para proponer las primarias de la semana del jugador desde su memoria, usá proponer_primarias.',
    parametros: S({
      personaje: str('Por defecto el jugador'), nivel: str('Nivel', { enum: ['principal', 'primaria', 'terciaria'] }),
      misiones: { type: 'array', items: { type: 'object', properties: { titulo: str('Título'), detalle: str('Subdescripción'), categoria: str('Categoría'), entidad: str('Proyecto o persona de la que trata') }, required: ['titulo'] } },
    }, ['nivel', 'misiones']),
    ejecutar: (a, { db }) => {
      const k = resolverPersonaje(db, a.personaje)
      const ids = (a.misiones ?? []).slice(0, 12).map((m: any) => crearMision(db, {
        personaje: k, asignadaPor: 'mastropiero', nivel: a.nivel, titulo: m.titulo, detalle: m.detalle, categoria: m.categoria,
        entidadId: m.entidad ? entidadId(db, m.entidad) : null, estado: 'sugerida', creadaPor: 'mastropiero',
      }, { por: 'mastropiero' }).id)
      return { sugeridas: ids }
    },
    resumen: (a, r) => `sugirió ${r?.sugeridas?.length ?? 0} misión(es) ${a.nivel === 'principal' ? 'principal(es)' : a.nivel + 's'}`,
  },
  {
    nombre: 'proponer_primarias', familia: 'accion', descripcion: 'Propone las primarias de la semana del jugador desde su memoria, su principal y lo que quedó de la semana pasada. Entran como sugeridas.',
    parametros: S({ semana: str('2026-W41; vacío = esta'), pedido: str('Lo que él pidió para la propuesta, si dijo algo') }),
    ejecutar: async (a, { db }) => ({ semana: a.semana || semanaDe(), sugeridas: (await proponerPrimarias(db, a.semana || semanaDe(), { texto: a.pedido })).map(misionCorta) }),
    resumen: (_, r) => `propuso ${r?.sugeridas?.length ?? 0} primarias para la semana`,
  },
  {
    nombre: 'crear_mision', familia: 'accion',
    descripcion: 'Crea una misión activa cuando él lo pide («anotame como primaria…»). Para el jugador o cualquier personaje. La principal del jugador va con fijar_principal.',
    parametros: S({ personaje: str('Por defecto el jugador'), nivel: str('Nivel', { enum: ['primaria', 'secundaria', 'terciaria'] }), titulo: str('Título'), detalle: str('Subdescripción'), categoria: str('Categoría'), entidad: str('Proyecto o persona de la que trata'), padre: int('id de la misión que empuja'), vence: str('YYYY-MM-DD') }, ['nivel', 'titulo']),
    ejecutar: (a, { db }) => {
      const m = crearMision(db, { personaje: resolverPersonaje(db, a.personaje), asignadaPor: 'jugador', nivel: a.nivel, titulo: a.titulo, detalle: a.detalle, categoria: a.categoria, entidadId: a.entidad ? entidadId(db, a.entidad) : null, padreId: a.padre ?? null, vence: a.vence ?? null, creadaPor: 'mastropiero' }, { por: 'mastropiero' })
      return misionCorta(m)
    },
    resumen: (a) => `anotó la misión «${recorte(a.titulo, 50)}»`,
  },
  {
    nombre: 'actualizar_mision', familia: 'accion',
    descripcion: 'Cambia una misión: aceptar una sugerida (estado activa), cerrarla (hecha, parcial, no, descartada), su progreso (0–100), feedback, título o detalle. La principal del jugador no se toca desde acá.',
    parametros: S({ id: int('id'), estado: str('Estado', { enum: ['activa', 'hecha', 'parcial', 'no', 'descartada'] }), progreso: int('0–100'), feedback: str('Lo que contó de cómo fue'), titulo: str('Título'), detalle: str('Detalle'), vence: str('YYYY-MM-DD') }, ['id']),
    ejecutar: (a, { db }) => {
      const { id, ...c } = a
      return misionCorta(actualizarMision(db, id, c, { por: 'mastropiero' }))
    },
    resumen: (a, r) => `actualizó «${recorte(r?.titulo ?? `#${a.id}`, 40)}»${a.estado ? ` → ${a.estado}` : ''}${a.progreso != null ? ` (${a.progreso}%)` : ''}`,
  },
  {
    nombre: 'marcar_mision', familia: 'accion', descripcion: 'Marca una banda de la run (o cualquier secundaria) como hecha, a medias o no, con su nota. Es lo que calibra las próximas runs.',
    parametros: S({ id: int('id de la banda (ver_run)'), estado: str('Estado', { enum: ['hecha', 'parcial', 'no', 'activa'] }), nota: str('Lo que contó: qué trabó, qué funcionó') }, ['id', 'estado']),
    ejecutar: (a, { db }) => misionCorta(marcarSecundaria(db, a.id, a.estado, a.nota)),
    resumen: (a, r) => `marcó «${recorte(r?.titulo ?? `#${a.id}`, 40)}» como ${a.estado === 'parcial' ? 'a medias' : a.estado}`,
  },
  {
    nombre: 'asignar_mision', familia: 'accion',
    descripcion: 'El jugador le encarga algo a otra persona (o agente): «Ana tiene que mandarme el presupuesto antes del viernes». Reconoce apodos si hay una sola persona que encaja («Ana» → «Ana María …»); si no existe, la crea. Decile a quién se la asignaste.',
    parametros: S({ a: str('Nombre o id de la persona, o agente'), titulo: str('Qué tiene que hacer'), detalle: str('Detalle'), vence: str('YYYY-MM-DD, si hay plazo') }, ['a', 'titulo']),
    ejecutar: (a, { db }) => {
      const m = asignarMision(db, { a: a.a, titulo: a.titulo, detalle: a.detalle, vence: a.vence })
      return { ...misionCorta(m), quien: personaje(db, m.personaje).nombre }
    },
    resumen: (a) => `le asignó a ${a.a}: ${recorte(a.titulo, 40)}`,
  },
  {
    nombre: 'editar_persona', familia: 'accion',
    descripcion: 'Define o actualiza la relación con una persona de su gente: vínculo, cercanía (1–5), cada cuántos días quiere verla o hablarle, lo próximo pendiente con ella, notas; o anota que hoy hubo contacto.',
    parametros: S({ persona: str('Nombre o id de la entidad'), vinculo: str('Vínculo', { enum: [...VINCULOS] }), cercania: int('1 a 5'), cada_dias: int('Cada cuántos días quiere contacto (0 = sin ritmo)'), proxima: str('Lo próximo con ella («devolverle el libro»)'), notas: str('Notas'), contacto: bool('true si hoy hablaron o se vieron') }, ['persona']),
    ejecutar: (a, { db }) => {
      const id = /^\d+$/.test(String(a.persona)) ? Number(a.persona) : personaPorNombre(db, String(a.persona), { sinJugador: true })
      if (!id) throw new Error(`No encuentro a «${a.persona}» entre las personas`)
      return guardarRelacion(db, id, { vinculo: a.vinculo, cercania: a.cercania, cadaDias: a.cada_dias, proxima: a.proxima, notas: a.notas, contacto: a.contacto || undefined })
    },
    resumen: (a) => `actualizó a ${recorte(String(a.persona), 30)}`,
  },
  {
    nombre: 'registrar_movimiento', familia: 'accion',
    descripcion: 'Registra un gasto (monto negativo) o un ingreso (positivo) que él cuenta («gasté 20 en el súper», «me pagaron 800 del freelance»). Euros salvo que diga otra moneda.',
    parametros: S({ monto: { type: 'number', description: 'Negativo si es gasto, positivo si es ingreso' }, descripcion: str('En qué'), categoria: str('Categoría', { enum: [...CATEGORIAS] }), fecha: str('YYYY-MM-DD; vacío = hoy'), moneda: str('EUR por defecto') }, ['monto', 'descripcion']),
    ejecutar: (a, { db }) => registrarMovimiento(db, { ...a, origen: 'chat' }) ?? { repetido: true },
    resumen: (a) => `anotó ${a.monto} € (${recorte(a.descripcion, 40)})`,
  },
  {
    nombre: 'fijar_meta_mes', familia: 'accion',
    descripcion: 'Fija su meta de ingresos por mes (en euros), cuando él la dice.',
    parametros: S({ euros: int('Euros por mes') }, ['euros']),
    ejecutar: (a, { db }) => (fijarAjuste(db, 'meta_ingresos_mes', String(Math.max(0, Math.round(Number(a.euros) || 0)))), resumenMes(db)),
    resumen: (a) => `fijó la meta del mes en ${a.euros} €`,
  },
  {
    nombre: 'anotar_side_quest', familia: 'accion',
    descripcion: 'Anota una side quest: un encargo chico que depende de dónde esté o qué haga («si pasás por una tienda de regalos, comprale X a Y»). El disparador es lo que la activa.',
    parametros: S({ titulo: str('Qué hacer'), detalle: str('Detalle'), lugar: str('Un lugar concreto'), zona: str('Barrio o zona'), actividad: str('Actividad que la habilita: caminar, salir, viajar…'), cuando: str('Momento: fin de semana, a la tarde…'), vence: str('YYYY-MM-DD') }, ['titulo']),
    ejecutar: (a, { db }) => misionCorta(anotarSideQuest(db, { titulo: a.titulo, detalle: a.detalle, disparador: { lugar: a.lugar, zona: a.zona, actividad: a.actividad, cuando: a.cuando }, vence: a.vence, creadaPor: 'mastropiero' })),
    resumen: (a) => `anotó la side quest «${recorte(a.titulo, 50)}»`,
  },
  {
    nombre: 'preparar_run', familia: 'accion',
    descripcion: 'Prepara una run a su pedido: interpreta lo que dijo, reúne contexto (y consulta a los agentes que conocen los proyectos incluidos), arma las bandas y las programa. Queda como propuesta hasta que arranque. Pasale su pedido tal cual en «texto».',
    parametros: S({
      texto: str('Su pedido en sus palabras'), fecha: str('YYYY-MM-DD si es para otro día (por ejemplo, mañana); vacío = hoy'), inicio: str('HH:MM de arranque'), fin: str('HH:MM de fin'), plantilla: str('Nombre de plantilla (por defecto «Mañana oficina»)'), duracion: int('Minutos'), banda: { type: 'array', items: { type: 'integer' }, description: 'Minutos por banda permitidos' },
      libre: bool('Que vos elijas el largo de cada banda'), cantidad: int('Cuántas bandas'), intensidad: int('1–5'), energia: str('Cómo está'), dinero: { type: 'number', description: 'Plata disponible' },
      recursos: str('Dónde está, qué tiene, si puede salir o llamar'), incluir: { type: 'array', items: { type: 'string' }, description: 'Proyectos o personas a meter (nombre, o «persona:Nombre» para crearla)' },
      excluir: str('Lo que no quiere'), formato: str('Cómo quiere ver las tareas'),
    }),
    ejecutar: async (a, { db }) => {
      const { run, misiones, avisos } = await prepararRun(db, a)
      return { run: run.id, estado: run.estado, de: run.inicio, a: run.fin, resumen: run.resumen, agentes: run.agentes.map((x) => x.nombre), avisos, bandas: misiones.map((m) => `${m.inicio} ${m.titulo}`) }
    },
    resumen: (_, r) => (r?.run ? `preparó una run de ${r.de} a ${r.a} (${r.bandas.length} bandas)` : 'intentó preparar una run'),
  },
  {
    nombre: 'rehacer_run', familia: 'accion', descripcion: 'Rehace la run viva con un cambio en palabras («más corta», «sacá lo de X», «más creativas»). Conserva lo fijado, lo marcado y lo que ya pasó.',
    parametros: S({ cambio: str('El cambio que pidió'), id: int('id de la run; vacío = la viva') }, ['cambio']),
    ejecutar: async (a, { db }) => {
      const id = a.id ?? runActual(db)?.id
      if (!id) return { error: 'No hay run viva para rehacer' }
      const { run, misiones } = await rehacerRun(db, id, a.cambio)
      return { run: run.id, de: run.inicio, a: run.fin, bandas: misiones.map((m) => `${m.inicio} ${m.titulo} [${m.estado}]`) }
    },
    resumen: () => 'rehízo la run',
  },
  {
    nombre: 'arrancar_run', familia: 'accion', descripcion: 'Arranca la run propuesta (se corre a ahora si se tardó). Solo cuando él dice que arranca.',
    parametros: S({ id: int('id; vacío = la propuesta de hoy') }),
    ejecutar: (a, { db }) => {
      const id = a.id ?? runActual(db)?.id
      if (!id) return { error: 'No hay run propuesta' }
      const r = arrancarRun(db, id)
      return { run: r.id, de: r.inicio, a: r.fin }
    },
    resumen: (_, r) => (r?.run ? `arrancó la run (${r.de}–${r.a})` : 'intentó arrancar la run'),
  },
  {
    nombre: 'cerrar_run', familia: 'accion', descripcion: 'Cierra la run en curso y escribe su reporte (va al corpus y calibra la próxima). Si la propuesta no se va a usar, descartala.',
    parametros: S({ id: int('id; vacío = la viva'), descartar: bool('true para descartar una propuesta sin arrancar') }),
    ejecutar: async (a, { db }) => {
      const run = a.id ? leerRun(db, a.id) : runActual(db)
      if (!run) return { error: 'No hay run viva' }
      if (a.descartar || run.estado === 'propuesta') return (descartarRun(db, run.id), { descartada: run.id })
      const r = await cerrarRun(db, run.id)
      return { cerrada: run.id, reporte: r.texto }
    },
    resumen: (_, r) => (r?.descartada ? 'descartó la run propuesta' : r?.cerrada ? 'cerró la run con su reporte' : 'intentó cerrar la run'),
  },
  {
    nombre: 'reporte_semanal', familia: 'accion', descripcion: 'Escribe el reporte de la semana (lo hecho, avance de primarias, runs, métricas, lo que otros deben).',
    parametros: S({ semana: str('2026-W41; vacío = esta') }),
    ejecutar: async (a, { db }) => ({ texto: (await reporteSemana(db, a.semana || semanaDe())).texto }),
    resumen: () => 'escribió el reporte de la semana',
  },
  {
    nombre: 'procesar_jugador', familia: 'accion',
    descripcion: 'Procesa todo lo que sabés del jugador y propone su ficha: historia, inventario, candidatas a misión principal y primarias de la semana. Todo entra como sugerencia.',
    parametros: S({}),
    ejecutar: async (_, { db }) => procesarJugador(db),
    resumen: (_, r) => (r ? `procesó al jugador: ${r.inventario} ítems, ${r.principales} principales y ${r.primarias} primarias sugeridas` : 'intentó procesar al jugador'),
  },

  {
    nombre: 'sumar_ayudante', familia: 'accion',
    descripcion: `Le suma a una primaria del jugador un ayudante de la liga que trabaja entre runs: un generativo (borradores, próximos pasos) o un buscador (lo que hay en su corpus). Uno nuevo de la clase, o uno existente por id.`,
    parametros: S({ primaria: int('id de la primaria (activa)'), clase: str('Rol del ayudante nuevo: generativo (borradores), buscador (su corpus) o explorador (sale a la web)', { enum: ['generativo', 'buscador', 'explorador'] }), agente: str('id de un agente existente (en vez de forjar uno)') }, ['primaria']),
    ejecutar: (a, { db }) => {
      const r = sumarAyudante(db, a.primaria, { clase: a.clase, agenteId: a.agente })
      return { ayudante: r.agente?.id, clase: r.agente?.clase, mision: r.mision.id }
    },
    resumen: (_, r) => (r?.ayudante ? `sumó a ${r.ayudante} como ayudante` : 'intentó sumar un ayudante'),
  },
  {
    nombre: 'quitar_ayudante', familia: 'accion', descripcion: 'Saca un ayudante de una primaria (su misión de ayudante queda descartada; el agente sigue en la liga).',
    parametros: S({ mision: int('id de la misión del ayudante') }, ['mision']),
    ejecutar: (a, { db }) => (quitarAyudante(db, a.mision), { quitado: a.mision }),
    resumen: () => 'sacó un ayudante',
  },
  {
    nombre: 'pedir_aportes', familia: 'accion',
    descripcion: 'Les pide ya un aporte a los ayudantes (de una primaria, o de todas las de la semana). Corre en el momento y gasta tokens de la liga, dentro del tope diario.',
    parametros: S({ primaria: int('id de la primaria; vacío = todas') }),
    ejecutar: async (a, { db }) => {
      const r = await pedirAportes(db, { primariaId: a.primaria })
      return { aportes: r.aportes.map((x) => ({ de: x.autor, para: x.titulo, texto: x.contenido.slice(0, 1500) })), fallas: r.fallas, frenado: r.frenado }
    },
    resumen: (_, r) => `pidió aportes: ${r?.aportes?.length ?? 0} nuevos${r?.fallas?.length ? `, ${r.fallas.length} fallaron` : ''}`,
  },
  {
    nombre: 'ver_aportes', familia: 'lectura', descripcion: 'Los aportes que dejaron los ayudantes (de una primaria o de todas) y quiénes ayudan en cada primaria.',
    parametros: S({ primaria: int('id de la primaria; vacío = todas') }),
    ejecutar: (a, { db }) => ({
      ayudantes: a.primaria ? ayudantesDe(db, a.primaria).map((x) => ({ mision: x.mision.id, agente: x.agente?.id, clase: x.agente?.clase })) : undefined,
      aportes: aportes(db, { primariaId: a.primaria, limite: 8 }).map((x) => ({ id: x.id, de: x.autor, para: x.titulo, cuando: new Date(x.en).toLocaleString('es-AR'), texto: x.contenido.slice(0, 1200) })),
    }),
  },
  {
    nombre: 'ver_duplicados', familia: 'lectura', descripcion: 'Entidades que parecen la misma (mismo nombre o una es alias de otra), con cuál convendría que quede. Para fusionarlas, fusionar_entidades con su ok.',
    parametros: S({}),
    ejecutar: (_, { db }) => duplicadosProbables(db, 20).map((g) => ({ motivo: g.motivo, queda: g.queda, entidades: g.entidades.map((e) => ({ id: e.id, nombre: e.nombre, tipo: e.tipo, piezas: e.piezas })) })),
  },
  {
    nombre: 'editar_entidad', familia: 'accion',
    descripcion: 'Corrige una entidad: nombre (el anterior queda como alias), tipo, notas, o suma alias. Cuando él te corrige quién o qué es algo.',
    parametros: S({ id: int('id de la entidad'), nombre: str('Nombre correcto'), tipo: str('Tipo', { enum: [...TIPOS_ENTIDAD] }), notas: str('Notas (reemplazan las anteriores)'), sumar_alias: { type: 'array', items: { type: 'string' }, description: 'Alias a sumar' } }, ['id']),
    ejecutar: (a, { db }) => {
      const e = editarEntidad(db, a.id, { nombre: a.nombre, tipo: a.tipo, notas: a.notas, sumarAlias: a.sumar_alias })
      return { id: e.id, nombre: e.nombre, tipo: e.tipo, alias: e.alias }
    },
    resumen: (_, r) => `corrigió la entidad ${r?.nombre ?? ''}`,
  },

  // Destructivas
  {
    nombre: 'fusionar_entidades', familia: 'destructiva',
    descripcion: 'Fusiona entidades duplicadas en una (la que queda absorbe piezas, misiones, inventario, alias y notas; las otras desaparecen). Requiere confirmación.',
    parametros: S({ queda: int('id de la entidad que queda'), absorbe: { type: 'array', items: { type: 'integer' }, description: 'ids de las duplicadas' }, confirmado: bool('true solo si el operador confirmó') }, ['queda', 'absorbe']),
    ejecutar: (a, { db }) => exigirConfirmacion(a, `fusiona ${a.absorbe?.length ?? 0} entidades en la #${a.queda}`) ?? (() => { const e = fusionarEntidades(db, a.queda, a.absorbe ?? []); return { id: e.id, nombre: e.nombre, tipo: e.tipo, alias: e.alias } })(),
    resumen: (a, r) => (r?.requiere_confirmacion ? 'pidió confirmación para fusionar entidades' : `fusionó ${a.absorbe?.length ?? 0} duplicadas en ${r?.nombre ?? ''}`),
  },

  {
    nombre: 'preguntarle_despues', familia: 'accion',
    descripcion: 'Deja una pregunta para el jugador en su tarjeta de Hoy (la contesta cuando quiera, con un toque). Para lo que te falta saber y no urge preguntar ahora en la charla.',
    parametros: S({ texto: str('La pregunta, corta'), por_que: str('Para qué te sirve saberlo'), opciones: { type: 'array', items: { type: 'string' }, description: 'De 2 a 5 opciones, si conviene elegir' } }, ['texto']),
    ejecutar: (a, { db }) => ({ pregunta: encolarPregunta(db, { texto: a.texto, porQue: a.por_que, opciones: a.opciones, origen: 'chat' })?.id }),
    resumen: (a) => `le dejó una pregunta: ${recorte(a.texto, 50)}`,
  },
  {
    nombre: 'ver_directo', familia: 'lectura',
    descripcion: 'Lo que viste y escuchaste con el Directo: la sesión prendida (sus últimos momentos) o los informes de las anteriores.',
    parametros: S({ momentos: int('Cuántos momentos recientes (máx. 60)') }),
    ejecutar: (a, { db }) => {
      const s = sesionActiva(db)
      return {
        prendido: s ? { desde: new Date(s.inicio).toLocaleTimeString('es-AR'), momentos: momentosDirecto(db, s.id).slice(-Math.min(a.momentos ?? 20, 60)).map((m) => ({ tipo: m.tipo, hora: new Date(m.desde).toLocaleTimeString('es-AR'), app: m.app ?? undefined, actividad: m.actividad ?? undefined, detalle: m.detalle ?? undefined, nota: m.nota ?? undefined, texto: m.texto ? recorte(m.texto, 600) : undefined })) } : null,
        informes: listarSesiones(db, 6).filter((x) => x.informe).map((x) => ({ cuando: new Date(x.inicio).toLocaleString('es-AR'), informe: recorte(x.informe!, 1500) })),
      }
    },
  },
  {
    nombre: 'forjar_mejora', familia: 'accion',
    descripcion: 'Lleva una propuesta de mejora (o un pedido) a La Fragua: escribe el cambio en una rama aparte, corre typecheck y tests, y deja el diff para que él lo lea. No toca lo que está andando; aplicarlo es decisión suya, desde La Fragua. Tarda unos minutos y avisa al terminar.',
    parametros: S({ propuesta: int('id de la propuesta (listar_propuestas)'), pedido: str('Si no hay propuesta: la mejora en palabras') }),
    ejecutar: (a, { db }) => {
      // Import dinámico: index.ts importa este archivo.
      void forjarMejora(db, { propuestaId: a.propuesta ?? null, pedido: a.pedido ?? null }).then(async (f) => { const { mensajeDeMastropiero, conversacionHoy } = await import('./index.ts'); mensajeDeMastropiero(db, conversacionHoy(db).id, `La forja #${f.id} terminó: ${f.estado === 'lista' ? 'pasa los tests, la podés leer y aplicar en La Fragua' : f.estado === 'rota' ? 'no pasa los tests' : 'no salió'}.`) }).catch(() => {})
      return { empezada: true, aviso: 'Va a tardar unos minutos; aviso en Hoy cuando termine.' }
    },
    resumen: (a) => `llevó ${a.propuesta ? `la propuesta #${a.propuesta}` : 'una mejora'} a La Fragua`,
  },
  {
    nombre: 'ver_economia', familia: 'lectura',
    descripcion: 'La economía de la liga: cuánto ganó y gastó cada agente esta temporada (semana) y su saldo. Al cierre (lunes), los que pierden van a la banca y el mejor de una clase con trabajo acumulado se clona.',
    parametros: S({}),
    ejecutar: (_, { db }) => tablaEconomia(db).slice(0, 25).map((x) => ({ agente: x.nombre, clase: x.clase, estado: x.estado, temporada: x.temporada, saldo: x.saldo })),
  },
  {
    nombre: 'ver_cuadernos', familia: 'lectura',
    descripcion: 'Sus cuadernos (colecciones de fuentes para estudiar un tema) con sus fuentes y cuántas notas tienen.',
    parametros: S({}),
    ejecutar: (_, { db }) => listarCuadernos(db).map((c) => ({ id: c.id, titulo: c.titulo, fuentes: c.fuentes.map((f) => f.titulo), notas: c.notas })),
  },
  {
    nombre: 'crear_cuaderno', familia: 'accion',
    descripcion: 'Crea un cuaderno para estudiar un tema con fuentes elegidas: ids de piezas del corpus (buscalas antes con buscar_corpus) y/o URLs. Después se le pregunta con preguntar_cuaderno.',
    parametros: S({ titulo: str('Nombre del cuaderno'), piezas: { type: 'array', items: { type: 'integer' }, description: 'ids de piezas' }, urls: { type: 'array', items: { type: 'string' }, description: 'Páginas web para sumar' } }, ['titulo']),
    ejecutar: async (a, { db }) => {
      const c = crearCuaderno(db, a.titulo)
      await sumarFuentes(db, c.id, { piezas: a.piezas ?? [] })
      for (const u of a.urls ?? []) await sumarFuentes(db, c.id, { url: u }).catch(() => {})
      return leerCuaderno(db, c.id)
    },
    resumen: (a) => `creó el cuaderno «${recorte(a.titulo, 40)}»`,
  },
  {
    nombre: 'preguntar_cuaderno', familia: 'lectura',
    descripcion: 'Le pregunta a un cuaderno: responde solo con sus fuentes y cita de dónde sale cada cosa. Pasale su respuesta tal cual (con las citas).',
    parametros: S({ cuaderno: int('id del cuaderno'), pregunta: str('La pregunta') }, ['cuaderno', 'pregunta']),
    ejecutar: async (a, { db }) => {
      const n = await preguntar(db, a.cuaderno, a.pregunta)
      return { respuesta: n.texto, citas: n.citas.map((c) => ({ n: c.n, pieza: c.piezaId, titulo: c.titulo })) }
    },
  },
  {
    nombre: 'ver_bitacora', familia: 'lectura',
    descripcion: 'Las entradas de su bitácora íntima que él eligió compartir con vos (las demás son privadas y no las ves). Solo si él te pide que las leas o habla de lo que escribió.',
    parametros: S({ n: int('Cuántas (máx. 10)') }),
    ejecutar: (a, { db }) => compartidas(db, Math.min(a.n ?? 5, 10)).map((e) => ({ fecha: e.fecha, animo: e.animo ?? undefined, texto: e.texto })),
  },
  {
    nombre: 'ver_personas', familia: 'lectura',
    descripcion: 'Su gente: vínculo, último contacto, a quién quería ver más seguido, lo pendiente con cada una y lo que les asignó.',
    parametros: S({ q: str('Filtrar por nombre') }),
    ejecutar: (a, { db }) => personas(db, { q: a.q || undefined, limite: 30 }).map((p) => ({ id: p.id, nombre: p.nombre, vinculo: p.vinculo ?? undefined, ultimo: p.ultimoContacto ?? undefined, dias: p.diasSinContacto ?? undefined, vencida: p.vencida || undefined, proxima: p.proxima ?? undefined, misiones: p.misiones.length ? p.misiones : undefined })),
  },
  {
    nombre: 'ver_finanzas', familia: 'lectura',
    descripcion: 'Sus números de un mes: ingresos, gastos, por categoría, avance hacia su meta y los últimos movimientos.',
    parametros: S({ mes: str('YYYY-MM; vacío = este mes') }),
    ejecutar: (a, { db }) => {
      const mes = a.mes || fechaLocal().slice(0, 7)
      return { ...resumenMes(db, mes), ultimos: listarMovimientos(db, { mes, limite: 15 }).map((m) => ({ fecha: m.fecha, monto: m.monto, categoria: m.categoria, descripcion: m.descripcion })) }
    },
  },
  {
    nombre: 'ver_gemelo', familia: 'lectura',
    descripcion: 'Tu gemelo predictivo: las predicciones de un día (con probabilidad y si pasaron) y la curva «te conozco». Si él pregunta cuánto lo conocés o qué predijiste.',
    parametros: S({ fecha: str('YYYY-MM-DD; vacío = hoy') }),
    ejecutar: (a, { db }) => {
      const f = a.fecha || fechaLocal()
      const c = curva(db, f, 14)
      return { te_conozco: c.total, calificadas: c.calificadas, predicciones: prediccionesDe(db, f).map((p) => ({ texto: p.texto, probabilidad: p.probabilidad, resultado: p.resultado, estado: p.estado, nota: p.nota ?? undefined })) }
    },
  },
  {
    nombre: 'buscar_web', familia: 'lectura',
    descripcion: 'Busca en la web (para investigar algo que no está en su corpus: datos, gente, lugares, noticias). Devuelve resultados con link; para leer una página, leer_pagina.',
    parametros: S({ consulta: str('Qué buscar'), n: int('Cuántos resultados (máx. 10)') }, ['consulta']),
    ejecutar: async (a, { db }) => ({ con_buscador: hayBuscadorWeb(), resultados: (await buscarWeb(db, a.consulta, { n: Math.min(a.n ?? 6, 10) })).map((r) => ({ titulo: r.titulo, url: r.url, extracto: r.extracto })) }),
    resumen: (a, r) => `buscó en la web «${recorte(a.consulta, 40)}» → ${r?.resultados?.length ?? 0}`,
  },
  {
    nombre: 'leer_pagina', familia: 'lectura', descripcion: 'Lee una página web (su texto, recortado).',
    parametros: S({ url: str('URL') }, ['url']),
    ejecutar: async (a) => (await leerPagina(a.url, 8000)) ?? { error: 'No pude leer esa página' },
    resumen: (a) => `leyó ${recorte(a.url, 50)}`,
  },
  {
    nombre: 'buscar_oportunidades', familia: 'accion',
    descripcion: 'El radar sale a buscar oportunidades concretas (comunidades, eventos, convocatorias, becas, medios, contactos) para una primaria o para lo que él pida, y las deja en Radar.',
    parametros: S({ primaria: int('id de la primaria (opcional)'), pedido: str('Qué buscar, en sus palabras') }),
    ejecutar: async (a, { db }) => {
      const r = await buscarOportunidades(db, { misionId: a.primaria ?? null, texto: a.pedido ?? null })
      return { nuevas: r.nuevas.map((o) => ({ id: o.id, titulo: o.titulo, tipo: o.tipo, url: o.url, por_que: o.porQue })), aviso: r.aviso }
    },
    resumen: (_, r) => `el radar encontró ${r?.nuevas?.length ?? 0} oportunidades`,
  },
  {
    nombre: 'ver_oportunidades', familia: 'lectura', descripcion: 'Las oportunidades del radar (nuevas, las que le interesan, las hechas).',
    parametros: S({}),
    ejecutar: (_, { db }) => listarOportunidades(db, { estados: ['nueva', 'me_interesa', 'hecha'], limite: 40 }).map((o) => ({ id: o.id, titulo: o.titulo, tipo: o.tipo, url: o.url, estado: o.estado, cierre: o.cierre ?? undefined, tiene_borrador: !!o.borrador })),
  },
  {
    nombre: 'redactar_oportunidad', familia: 'accion', descripcion: 'Le redacta, en su voz, el mensaje, post o postulación para aprovechar una oportunidad del radar. Él lo revisa y lo manda.',
    parametros: S({ id: int('id de la oportunidad'), pedido: str('Algo que quiera en el borrador') }, ['id']),
    ejecutar: async (a, { db }) => ({ borrador: (await redactarOportunidad(db, a.id, a.pedido)).borrador }),
    resumen: () => 'redactó un borrador',
  },
  {
    nombre: 'crear_en_taller', familia: 'accion',
    descripcion: `El Taller crea cosas: un juego (HTML jugable), una imagen, una voz (texto leído), un personaje (ficha + retrato + voz) o un video corto (guion, imágenes, voz, montaje). Corre en segundo plano: decile que lo va a ver en Taller. Voces: ${Object.entries(VOCES).map(([k, v]) => `${k} (${v})`).join(', ')}.`,
    parametros: S({ tipo: str('Qué crear', { enum: ['juego', 'imagen', 'voz', 'personaje', 'video'] }), pedido: str('Lo que pide, con todo el detalle que dio'), voz: str('Voz (para voz, video)'), personaje: int('id de un personaje del Taller, para un video') }, ['tipo', 'pedido']),
    ejecutar: (a, { db }) => {
      const f = { juego: () => crearJuego(db, a.pedido), imagen: () => crearImagen(db, a.pedido), voz: () => crearVoz(db, a.pedido, { voz: a.voz }), personaje: () => crearPersonaje(db, a.pedido), video: () => crearVideo(db, a.pedido, { personajeId: a.personaje ?? null, voz: a.voz }) }[a.tipo as string]
      if (!f) return { error: 'Tipo inválido' }
      void f().catch(() => {})
      return { empezado: true, donde: 'Taller' }
    },
    resumen: (a) => `empezó ${a.tipo === 'imagen' ? 'una imagen' : a.tipo === 'voz' ? 'una voz' : `un ${a.tipo}`} en el Taller`,
  },
  {
    nombre: 'iterar_en_taller', familia: 'accion', descripcion: 'Una versión nueva de algo del Taller con el cambio que pide («que el dragón sea azul», «que el juego tenga niveles»).',
    parametros: S({ id: int('id del artefacto'), cambio: str('El cambio') }, ['id', 'cambio']),
    ejecutar: (a, { db }) => { void iterarArtefacto(db, a.id, a.cambio).catch(() => {}); return { empezado: true } },
    resumen: () => 'pidió una versión nueva en el Taller',
  },
  {
    nombre: 'ver_taller', familia: 'lectura', descripcion: 'Lo que hay en el Taller (juegos, imágenes, voces, personajes, videos) y en qué estado.',
    parametros: S({}),
    ejecutar: (_, { db }) => listarArtefactos(db, { limite: 30 }).map((x) => ({ id: x.id, tipo: x.tipo, titulo: x.titulo, version: x.version, estado: x.estado, progreso: x.progreso ?? undefined })),
  },
  {
    nombre: 'ver_cuentas', familia: 'lectura', descripcion: 'Sus cuentas (red, usuario, modo: lectura, redacta o libre) y las publicaciones en cola o publicadas.',
    parametros: S({}),
    ejecutar: (_, { db }) => ({ cuentas: listarCuentas(db).map((c) => ({ id: c.id, red: c.red, usuario: c.usuario, modo: c.modo, conector: c.conector })), cola: listarPublicaciones(db, { estados: ['borrador', 'aprobada'], limite: 20 }).map((p) => ({ id: p.id, cuenta: p.cuentaId, estado: p.estado, texto: recorte(p.texto, 200) })) }),
  },
  {
    nombre: 'redactar_publicaciones', familia: 'accion', descripcion: 'Redacta publicaciones en su voz para una de sus cuentas. En modo «redacta» quedan como borrador para su ok; en «libre» se programan solas. Nunca en cuentas de lectura.',
    parametros: S({ cuenta: int('id de la cuenta'), n: int('Cuántas (1-5)'), tema: str('Sobre qué, si lo dijo') }, ['cuenta']),
    ejecutar: async (a, { db }) => (await redactarPublicaciones(db, a.cuenta, { n: Math.min(a.n ?? 3, 5), tema: a.tema })).map((p) => ({ id: p.id, estado: p.estado, texto: p.texto })),
    resumen: (_, r) => `redactó ${Array.isArray(r) ? r.length : 0} publicaciones`,
  },
  {
    nombre: 'ver_respuestas', familia: 'lectura', descripcion: 'Lo que ya le preguntaste al jugador y lo que contestó (o salteó).',
    parametros: S({}),
    ejecutar: (_, { db }) => listarPreguntas(db, { limite: 40 }).map((p) => ({ pregunta: p.texto, estado: p.estado, respuesta: p.respuesta ?? undefined })),
  },
  {
    nombre: 'pausar_ingesta', familia: 'accion',
    descripcion: 'Pone en espera la ingesta masiva del bus (destilar piezas con agentes): deja de repartirse y de gastar tokens. Las piezas siguen en el corpus y se buscan igual.',
    parametros: S({}),
    ejecutar: (_, { db }) => ({ en_espera: pausarIngesta(db) }),
    resumen: (_, r) => `puso en espera ${r?.en_espera ?? 0} encargos de ingesta`,
  },
  {
    nombre: 'reanudar_ingesta', familia: 'accion',
    descripcion: 'Devuelve al bus encargos de ingesta en espera: primero lo de su propia voz y lo más pesado. Con un límite chico (20–50) para no gastar de golpe.',
    parametros: S({ limite: int('Cuántos (por defecto 20)'), solo_propias: bool('Solo piezas de su propia voz') }),
    ejecutar: (a, { db }) => ({ reanudados: reanudarIngesta(db, { limite: Math.min(a.limite ?? 20, 500), soloPropias: a.solo_propias }), quedan_en_espera: enEspera(db) }),
    resumen: (_, r) => `devolvió ${r?.reanudados ?? 0} encargos de ingesta al bus`,
  },

  // Destructivas
  {
    nombre: 'fijar_principal', familia: 'destructiva',
    descripcion: 'Fija la misión principal de un personaje (reemplaza la vigente). La del jugador solo con su confirmación explícita; la de un agente no cambia nunca. Para aceptar una candidata sugerida, pasá su id.',
    parametros: S({ personaje: str('Por defecto el jugador'), titulo: str('La misión'), detalle: str('Detalle'), id: int('id de una principal sugerida para aceptarla'), confirmado: bool('true solo si el operador confirmó') }),
    ejecutar: (a, { db }) => {
      const k = resolverPersonaje(db, a.personaje)
      if (k === 'jugador') {
        const c = exigirConfirmacion(a, 'cambia la misión principal del jugador')
        if (c) return c
      }
      const m = a.id ? actualizarMision(db, a.id, { estado: 'activa' }, { por: 'operador' }) : fijarPrincipal(db, k, { titulo: a.titulo, detalle: a.detalle }, { por: k === 'jugador' ? 'operador' : 'mastropiero' })
      return misionCorta(m)
    },
    resumen: (a, r) => (r?.requiere_confirmacion ? 'pidió confirmación para fijar la misión principal' : `fijó la misión principal: ${recorte(r?.titulo ?? a.titulo ?? '', 50)}`),
  },
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
