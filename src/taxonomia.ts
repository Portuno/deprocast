/**
 * La taxonomía (Fragua #321): el catálogo canónico de todos los tipos de clasificación del conocimiento, en un solo
 * lugar. Cada tipo declara su familia (archivo, mundo, actores, trabajo, vida, salidas, criterios), su nombre, los
 * valores posibles, la tabla y el módulo donde vive, las herramientas que lo leen y lo escriben, y su estado (existe,
 * falta o inconsistente). De acá salen la sección «Taxonomía» de los lineamientos, la vista de la pantalla y la
 * auditoría. Es una descripción fiel de lo que ya existe: los valores se leen de las constantes de cada módulo (no se
 * copian), y esta primera versión no cambia ningún comportamiento ni ningún valor.
 */
import type { Db } from './db.ts'
import { NIVELES as NIVELES_PIEZA, TIPOS as TIPOS_PIEZA } from './corpus.ts'
import { ETAPAS_QUANTOMO, TIPOS_ENTIDAD as TIPOS_ENTIDAD_SEGMENTO } from './segmento.ts'
import { TIPOS_ENTIDAD } from './entidades.ts'
import { CLASES } from './clases.ts'
import { ROLES_AYUDANTE } from './ayudantes.ts'
import { ELEMENTOS, ESTADOS_PLANTEL } from './arquetipos.ts'
import { PLANTILLAS_OFICIO } from './oficios.ts'
import { ESTADOS_BANDA_ARQUETIPO } from './arquetipo-run.ts'
import { TIPOS_INVENTARIO } from './personajes.ts'
import { CLASES_PERSONA, ESTADOS_PERSONA, VINCULOS } from './personas.ts'
import { TIPOS_RELACION } from './linea.ts'
import { ESTADOS_MISION, NIVELES_MISION } from './misiones.ts'
import { METRICAS, TIPOS_DIARIO } from './agentes/misiones.ts'
import { CANALES as CANALES_PISTA } from './agentes/pistas.ts'
import { ETAPAS as ETAPAS_EMBUDO } from './agentes/embudo.ts'
import { DESTINOS, ESTADOS_ENCARGO } from './discovery.ts'
import { ESTADOS_EXTRACCION } from './extracciones.ts'
import { ESTADOS_OPORTUNIDAD, TIPOS_OPORTUNIDAD } from './radar.ts'
import { FINALES } from './bucles.ts'
import { ACCIONES as ACCIONES_DECISION, TIPOS as TIPOS_DECISION } from './decisiones.ts'
import { TIPOS_SALUD } from './salud.ts'
import { TIPOS_LUGAR } from './territorio.ts'
import { TIPOS_CAPTURA } from './captura.ts'
import { CATEGORIAS as CATEGORIAS_PLATA } from './finanzas.ts'
import { CAPAS_CAL } from './agenda.ts'
import { ESTADOS_RESERVA } from './reservas.ts'
import { ESTADOS_OBRA, TIPOS_OBRA } from './libreria.ts'
import { NIVELES as NIVELES_IDIOMA } from './idiomas.ts'
import { CALIDADES } from './tarjetas.ts'
import { FUENTES_SUENO } from './suenos.ts'
import { HORIZONTES, TIPOS_MEMORIA } from './memoria.ts'
import { ESCALAS } from './escalas.ts'
import { TIPOS_ARTEFACTO } from './taller.ts'
import { PLATAFORMAS as PLATAFORMAS_FEED } from './feed.ts'
import { PLATAFORMAS as PLATAFORMAS_OBSERVATORIO } from './observatorio.ts'
import { MODOS as MODOS_CUENTA } from './cuentas.ts'
import { TIPOS_FICHA } from './fichas.ts'
import { TIPOS_PAGINA } from './paginas.ts'
import { CRITERIOS } from './criterios.ts'
import { TIPOS_GENERADO } from './archivo.ts'
import { FUENTES_SISTEMA } from './db.ts'

export const FAMILIAS = {
  archivo: 'El archivo: piezas, niveles, quántomos y cribas del corpus',
  mundo: 'El mundo: entidades, alias, fichas y páginas',
  actores: 'Los actores: agentes, arquetipos, Logos, personajes y personas',
  trabajo: 'El trabajo: misiones, encargos, oportunidades, bucles y decisiones',
  vida: 'La vida: salud, plata, agenda, reservas, compras, librería, aprendizajes, sueños y memoria',
  salidas: 'Las salidas: lo generado, el taller, el feed, el observatorio y las cuentas',
  criterios: 'Los criterios: los pesos que deciden qué entra y en qué orden',
} as const
export type Familia = keyof typeof FAMILIAS
export type Estado = 'existe' | 'falta' | 'inconsistente'

export type Tipo = {
  id: string
  familia: Familia
  nombre: string
  descripcion?: string
  /** Los valores posibles; null cuando es libre (texto o lista que crece con el uso). */
  valores: readonly (string | number)[] | null
  /** En vez de valores: un rango numérico cerrado. */
  rango?: readonly [number, number]
  /** De dónde salen los valores: la constante de un módulo o el comentario del esquema. */
  origen: string
  modulo: string
  tabla?: string
  columna?: string
  lee: readonly string[]
  escribe: readonly string[]
  /** Valores dinámicos que también valen (un prefijo, por ejemplo). */
  admite?: RegExp
  /** Otro lugar que declara su propia lista para lo mismo: si difiere, el tipo es inconsistente. */
  variantes?: { modulo: string; valores: readonly string[] }[]
  /** Declarado a propósito como faltante: hoy no hay clasificación, aunque haría falta. */
  falta?: string
}

const claves = (o: object) => Object.keys(o)

let _tipos: Tipo[] | null = null
/** El registro. Se arma la primera vez que se pide (así no importa el orden en que se cargan los módulos). */
export function taxonomia(): Tipo[] {
  if (_tipos) return _tipos
  const t = (x: Tipo) => x
  _tipos = [
    // ─── archivo
    t({ id: 'pieza.nivel', familia: 'archivo', nombre: 'Nivel de pieza', descripcion: 'Cercanía al operador: I mía, II primaria, III investigación, IV generada.', valores: claves(NIVELES_PIEZA), origen: 'NIVELES', modulo: 'src/corpus.ts', tabla: 'corpus', columna: 'nivel', lee: ['buscar_corpus', 'listar_fuentes'], escribe: ['crear_fuente', 'ingerir'] }),
    t({ id: 'pieza.fuente', familia: 'archivo', nombre: 'Fuente de pieza', descripcion: `Dinámica: se crean más. Las de sistema: ${FUENTES_SISTEMA.map((f) => f.nombre).join(', ')}.`, valores: null, origen: 'FUENTES_SISTEMA', modulo: 'src/corpus.ts', tabla: 'corpus', columna: 'fuente', lee: ['listar_fuentes', 'buscar_corpus'], escribe: ['crear_fuente', 'ingerir'] }),
    t({ id: 'fuente.nivel', familia: 'archivo', nombre: 'Nivel por defecto de una fuente', valores: claves(NIVELES_PIEZA), origen: 'NIVELES', modulo: 'src/corpus.ts', tabla: 'fuentes', columna: 'nivel', lee: ['listar_fuentes'], escribe: ['crear_fuente'] }),
    t({ id: 'pieza.tipo', familia: 'archivo', nombre: 'Tipo de pieza', descripcion: 'materia, referencia a una obra, ficha de entidad, lista (tridente o lista de seis), enlace por traer.', valores: TIPOS_PIEZA, origen: 'TIPOS', modulo: 'src/corpus.ts', tabla: 'corpus', columna: 'tipo', lee: ['buscar_corpus', 'leer_pieza'], escribe: ['ingerir', 'corregir_pieza'] }),
    t({ id: 'pieza.estado', familia: 'archivo', nombre: 'Estado de pieza', valores: ['crudo', 'extraido', 'clasificado', 'disponible'], origen: 'esquema de corpus', modulo: 'src/corpus.ts', tabla: 'corpus', columna: 'estado', lee: ['buscar_corpus'], escribe: ['ingerir'] }),
    t({ id: 'quantomo.etapa', familia: 'archivo', nombre: 'Etapa de quántomo', valores: ETAPAS_QUANTOMO, origen: 'ETAPAS_QUANTOMO', modulo: 'src/segmento.ts', tabla: 'quantomos', columna: 'etapa', lee: ['listar_quantomos'], escribe: ['crear_quantomo', 'sellar_quantomo', 'pedir_mejora_quantomo', 'resolver_propuesta_quantomo'] }),
    t({ id: 'quantomo.peso', familia: 'archivo', nombre: 'Peso de quántomo', descripcion: 'La escala de la criba.', valores: null, rango: [1, 12], origen: 'esquema de quantomos', modulo: 'src/segmento.ts', tabla: 'quantomos', columna: 'peso', lee: ['listar_quantomos'], escribe: ['crear_quantomo'] }),
    t({ id: 'quantomo.universo', familia: 'archivo', nombre: 'Universo de quántomo', valores: HORIZONTES, origen: 'HORIZONTES', modulo: 'src/memoria.ts', tabla: 'quantomos', columna: 'universo', lee: ['listar_quantomos'], escribe: ['crear_quantomo'] }),
    t({ id: 'criba.peso', familia: 'archivo', nombre: 'Peso en la criba', valores: null, rango: [1, 12], origen: 'esquema de criba', modulo: 'src/criba.ts', tabla: 'criba', columna: 'peso', lee: ['ver_cribas'], escribe: ['armar_criba', 'votar_criba'] }),
    // ─── mundo
    t({ id: 'entidad.tipo', familia: 'mundo', nombre: 'Tipo de entidad', valores: TIPOS_ENTIDAD, origen: 'TIPOS_ENTIDAD', modulo: 'src/entidades.ts', tabla: 'entidades', columna: 'tipo', lee: ['listar_entidades', 'ver_entidad'], escribe: ['editar_entidad', 'fusionar_entidades', 'crear_proyecto', 'crear_dominio'], variantes: [{ modulo: 'src/segmento.ts', valores: TIPOS_ENTIDAD_SEGMENTO }] }),
    t({ id: 'entidad.alias', familia: 'mundo', nombre: 'Alias y menciones', descripcion: 'Cada entidad guarda sus otros nombres; las menciones y las coocurrencias arman los nodos y las aristas del grafo.', valores: null, origen: 'esquema de entidades', modulo: 'src/entidades.ts', tabla: 'entidades', columna: 'alias', lee: ['ver_entidad', 'ver_duplicados', 'ver_grafo', 'conectar_conceptos'], escribe: ['editar_entidad', 'fusionar_entidades', 'no_son_lo_mismo'] }),
    t({ id: 'lugar.tipo', familia: 'mundo', nombre: 'Tipo de lugar', descripcion: 'Lo que marca desde el mapa del teléfono (Mobile 2.0): su casa, el trabajo, una empresa, un destino. Va en la meta del lugar como «clase».', valores: [...TIPOS_LUGAR], origen: 'TIPOS_LUGAR', modulo: 'src/territorio.ts', tabla: 'entidades', columna: 'meta.clase', lee: ['ver_recorrido'], escribe: [] }),
    t({ id: 'ficha.tipo', familia: 'mundo', nombre: 'Tipo de ficha', valores: TIPOS_FICHA, origen: 'TIPOS_FICHA', modulo: 'src/fichas.ts', lee: ['ver_ficha'], escribe: ['ficha_empresa', 'editar_ficha', 'investigar_ficha', 'abrir_ficha_idea'] }),
    t({ id: 'pagina.tipo', familia: 'mundo', nombre: 'Tipo de página', valores: TIPOS_PAGINA, origen: 'TIPOS_PAGINA', modulo: 'src/paginas.ts', lee: ['ver_pagina'], escribe: ['instruir_pagina'] }),
    t({ id: 'idea.tipo', familia: 'mundo', nombre: 'Tipo de idea', valores: null, origen: '—', modulo: 'src/fichas.ts', lee: ['ver_ficha'], escribe: ['abrir_ficha_idea', 'difundir_idea'], falta: 'Las ideas no tienen clasificación propia: viven como fichas y como texto suelto para difundir.' }),
    // ─── actores
    t({ id: 'agente.clase', familia: 'actores', nombre: 'Clase de agente', valores: claves(CLASES), origen: 'CLASES', modulo: 'src/clases.ts', tabla: 'agentes', columna: 'clase', lee: ['listar_agentes', 'ver_agente'], escribe: ['forjar_agente'] }),
    t({ id: 'agente.estado', familia: 'actores', nombre: 'Estado de agente', valores: ['prueba', 'activo', 'banca'], origen: 'esquema de agentes', modulo: 'src/agentes/motor.ts', tabla: 'agentes', columna: 'estado', lee: ['listar_agentes', 'ver_agente'], escribe: ['cambiar_estado_agente', 'retirar_agente'] }),
    t({ id: 'ayudante.rol', familia: 'actores', nombre: 'Rol de ayudante', valores: ROLES_AYUDANTE, origen: 'ROLES_AYUDANTE', modulo: 'src/ayudantes.ts', lee: ['traer_banda'], escribe: ['sumar_ayudante', 'quitar_ayudante'] }),
    t({ id: 'arquetipo.elemento', familia: 'actores', nombre: 'Elemento de arquetipo', valores: ELEMENTOS, origen: 'ELEMENTOS', modulo: 'src/arquetipos.ts', lee: ['ver_plantel', 'ver_pagina'], escribe: ['nombrar_arquetipo', 'ficha_arquetipo', 'crear_oficio'] }),
    t({ id: 'arquetipo.estado', familia: 'actores', nombre: 'Estado en el plantel', valores: ESTADOS_PLANTEL, origen: 'ESTADOS_PLANTEL', modulo: 'src/arquetipos.ts', lee: ['ver_plantel'], escribe: ['ficha_arquetipo'] }),
    t({ id: 'arquetipo.celda', familia: 'actores', nombre: 'Celda del 72', descripcion: 'Fila (elemento) por columna; el oficio y el nombre propio van en la ficha.', valores: null, rango: [1, 72], origen: 'esquema de agentes', modulo: 'src/arquetipos.ts', tabla: 'agentes', columna: 'celda', lee: ['ver_plantel'], escribe: ['ficha_arquetipo', 'crear_oficio'] }),
    t({ id: 'oficio.plantilla', familia: 'actores', nombre: 'Plantilla de oficio', valores: claves(PLANTILLAS_OFICIO), origen: 'PLANTILLAS_OFICIO', modulo: 'src/oficios.ts', lee: ['ver_plantel'], escribe: ['crear_oficio'] }),
    t({ id: 'arquetipo_banda.estado', familia: 'actores', nombre: 'Estado de una banda de arquetipo', descripcion: 'Las bandas de 12 minutos de la run de un arquetipo (sin cuerpo, día ni urgencia propia).', valores: ESTADOS_BANDA_ARQUETIPO, origen: 'ESTADOS_BANDA_ARQUETIPO', modulo: 'src/arquetipo-run.ts', tabla: 'arquetipo_bandas', columna: 'estado', lee: ['ver_run_arquetipo'], escribe: ['cargar_bandas_arquetipo', 'marcar_banda_arquetipo'] }),
    t({ id: 'logos.rubro', familia: 'actores', nombre: 'Rubro de Logos', descripcion: 'Los Logos se nombran por rubro: el rubro crece con el uso.', valores: null, origen: 'FAMILIA_LOGOS', modulo: 'src/logos.ts', tabla: 'agente_rubros', columna: 'rubro', lee: ['ver_logos', 'preguntar_a_logos'], escribe: ['forjar_logos'] }),
    t({ id: 'inventario.tipo', familia: 'actores', nombre: 'Tipo de inventario', valores: TIPOS_INVENTARIO, origen: 'TIPOS_INVENTARIO', modulo: 'src/personajes.ts', tabla: 'inventario', columna: 'tipo', lee: ['ver_personaje'], escribe: ['inventario_agregar', 'inventario_editar'] }),
    t({ id: 'persona.clase', familia: 'actores', nombre: 'Clase de persona', valores: CLASES_PERSONA, origen: 'CLASES_PERSONA', modulo: 'src/personas.ts', tabla: 'relaciones', columna: 'clase', lee: ['ver_persona', 'ver_personas'], escribe: ['editar_persona', 'nueva_persona'] }),
    t({ id: 'persona.vinculo', familia: 'actores', nombre: 'Vínculo', valores: VINCULOS, origen: 'VINCULOS', modulo: 'src/personas.ts', tabla: 'relaciones', columna: 'vinculo', lee: ['ver_persona', 'ver_personas'], escribe: ['editar_persona', 'nueva_persona'] }),
    t({ id: 'persona.nivel', familia: 'actores', nombre: 'Nivel de contacto', valores: null, rango: [1, 12], origen: 'personas.ts', modulo: 'src/personas.ts', tabla: 'relaciones', columna: 'nivel', lee: ['ver_persona', 'ver_personas'], escribe: ['editar_persona', 'nueva_persona'] }),
    t({ id: 'persona.importancia', familia: 'actores', nombre: 'Importancia en su vida', valores: null, rango: [1, 12], origen: 'personas.ts', modulo: 'src/personas.ts', tabla: 'relaciones', columna: 'importancia', lee: ['ver_persona', 'ver_personas'], escribe: ['editar_persona', 'nueva_persona'] }),
    t({ id: 'persona.estado', familia: 'actores', nombre: 'Estado de persona', valores: ESTADOS_PERSONA, origen: 'ESTADOS_PERSONA', modulo: 'src/personas.ts', tabla: 'relaciones', columna: 'estado', lee: ['ver_persona', 'ver_personas'], escribe: ['editar_persona', 'nueva_persona'] }),
    t({ id: 'relacion.tipo', familia: 'actores', nombre: 'Tipo de relación en la línea', valores: TIPOS_RELACION, origen: 'TIPOS_RELACION', modulo: 'src/linea.ts', lee: ['ver_linea', 'ver_relaciones'], escribe: [] }),
    // ─── trabajo
    t({ id: 'mision.nivel', familia: 'trabajo', nombre: 'Nivel de misión', descripcion: 'La secundaria es la banda; la terciaria, la side quest.', valores: NIVELES_MISION, origen: 'NIVELES_MISION', modulo: 'src/misiones.ts', tabla: 'misiones', columna: 'nivel', lee: ['ver_misiones'], escribe: ['crear_mision', 'sugerir_misiones', 'proponer_primarias', 'anotar_side_quest'] }),
    t({ id: 'mision.estado', familia: 'trabajo', nombre: 'Estado de misión', valores: ESTADOS_MISION, origen: 'ESTADOS_MISION', modulo: 'src/misiones.ts', tabla: 'misiones', columna: 'estado', lee: ['ver_misiones'], escribe: ['marcar_mision', 'actualizar_mision'] }),
    t({ id: 'mentor.como', familia: 'trabajo', nombre: 'Cómo entra una recomendación', valores: ['banda', 'side_quest'], origen: 'esquema de mentor', modulo: 'src/mentor.ts', tabla: 'mentor', columna: 'como', lee: ['ver_brujula'], escribe: ['recomendar_lectura'] }),
    t({ id: 'mision_agente.metrica', familia: 'trabajo', nombre: 'Métrica de misión de agente', valores: METRICAS, origen: 'METRICAS', modulo: 'src/agentes/misiones.ts', lee: ['ver_misiones_agentes'], escribe: ['crear_mision_agente'] }),
    t({ id: 'mision_agente.diario', familia: 'trabajo', nombre: 'Entrada del diario de misión', valores: TIPOS_DIARIO, origen: 'TIPOS_DIARIO', modulo: 'src/agentes/misiones.ts', lee: ['ver_diario'], escribe: ['al_diario'] }),
    t({ id: 'pista.canal', familia: 'trabajo', nombre: 'Canal de pista', valores: CANALES_PISTA, origen: 'CANALES', modulo: 'src/agentes/pistas.ts', lee: ['contexto_pista'], escribe: ['marcar_pista'] }),
    t({ id: 'embudo.etapa', familia: 'trabajo', nombre: 'Etapa del embudo', valores: ETAPAS_EMBUDO, origen: 'ETAPAS', modulo: 'src/agentes/embudo.ts', lee: ['contexto_pista'], escribe: ['marcar_pista'] }),
    t({ id: 'encargo.estado', familia: 'trabajo', nombre: 'Estado de encargo', valores: ESTADOS_ENCARGO, origen: 'ESTADOS_ENCARGO', modulo: 'src/discovery.ts', lee: ['ver_encargos'], escribe: ['crear_encargo'] }),
    t({ id: 'encargo.destino', familia: 'trabajo', nombre: 'Destino de una tarea del encargo', valores: DESTINOS, origen: 'DESTINOS', modulo: 'src/discovery.ts', lee: ['ver_encargos', 'hoja_de_valor'], escribe: ['armar_tobe'] }),
    t({ id: 'extraccion.estado', familia: 'trabajo', nombre: 'Estado de extracción', valores: ESTADOS_EXTRACCION, origen: 'ESTADOS_EXTRACCION', modulo: 'src/extracciones.ts', tabla: 'extracciones', columna: 'estado', lee: [], escribe: ['extraccion_cliente', 'plan_extraccion'] }),
    t({ id: 'oportunidad.tipo', familia: 'trabajo', nombre: 'Tipo de oportunidad', valores: TIPOS_OPORTUNIDAD, origen: 'TIPOS_OPORTUNIDAD', modulo: 'src/radar.ts', tabla: 'oportunidades', columna: 'tipo', lee: ['ver_oportunidades'], escribe: ['buscar_oportunidades'] }),
    t({ id: 'oportunidad.estado', familia: 'trabajo', nombre: 'Estado de oportunidad', valores: ESTADOS_OPORTUNIDAD, origen: 'ESTADOS_OPORTUNIDAD', modulo: 'src/radar.ts', tabla: 'oportunidades', columna: 'estado', lee: ['ver_oportunidades'], escribe: ['triar_oportunidades', 'redactar_oportunidad'] }),
    t({ id: 'bucle.estado', familia: 'trabajo', nombre: 'Estado de bucle', valores: ['abierto', 'cerrado', 'agendado', 'soltado'], origen: 'esquema de bucles', modulo: 'src/bucles.ts', tabla: 'bucles', columna: 'estado', lee: ['ver_bucles'], escribe: ['cerrar_bucle'] }),
    t({ id: 'bucle.final', familia: 'trabajo', nombre: 'Cómo se cierra un bucle', valores: FINALES, origen: 'FINALES', modulo: 'src/bucles.ts', lee: ['ver_bucles'], escribe: ['cerrar_bucle'] }),
    t({ id: 'decision.tipo', familia: 'trabajo', nombre: 'Tipo de decisión', descripcion: 'Lo que el sistema propone o hace solo y él valida; las del directo llevan su propio tipo detrás de «directo:».', valores: claves(TIPOS_DECISION), admite: /^directo:/, origen: 'TIPOS', modulo: 'src/decisiones.ts', tabla: 'decisiones', columna: 'tipo', lee: ['ver_para_validar'], escribe: ['validar', 'deshacer_ultima_accion'] }),
    t({ id: 'decision.accion', familia: 'trabajo', nombre: 'Qué hizo con una propuesta', valores: ACCIONES_DECISION, origen: 'ACCIONES', modulo: 'src/decisiones.ts', tabla: 'decisiones', columna: 'accion', lee: ['ver_para_validar'], escribe: ['validar', 'deshacer_ultima_accion'] }),
    // ─── vida
    t({ id: 'salud.tipo', familia: 'vida', nombre: 'Tipo de registro de salud', valores: TIPOS_SALUD, origen: 'TIPOS_SALUD', modulo: 'src/salud.ts', tabla: 'salud', columna: 'tipo', lee: ['ver_salud'], escribe: ['registrar_salud', 'corregir_registro_salud', 'borrar_registro_salud'] }),
    t({ id: 'captura.tipo', familia: 'vida', nombre: 'Tipo de captura', valores: TIPOS_CAPTURA, origen: 'TIPOS_CAPTURA', modulo: 'src/captura.ts', lee: ['ver_dia'], escribe: ['cargar_dia'] }),
    t({ id: 'plata.categoria', familia: 'vida', nombre: 'Categoría de movimiento', valores: CATEGORIAS_PLATA, origen: 'CATEGORIAS', modulo: 'src/finanzas.ts', tabla: 'movimientos', columna: 'categoria', lee: ['ver_finanzas'], escribe: ['registrar_movimiento'] }),
    t({ id: 'agenda.capa', familia: 'vida', nombre: 'Capa del calendario', valores: CAPAS_CAL, origen: 'CAPAS_CAL', modulo: 'src/agenda.ts', lee: ['ver_calendario', 'ver_agenda'], escribe: ['crear_evento_calendario', 'fijar_horario'] }),
    t({ id: 'reserva.estado', familia: 'vida', nombre: 'Estado de reserva', valores: ESTADOS_RESERVA, origen: 'ESTADOS_RESERVA', modulo: 'src/reservas.ts', tabla: 'reservas', columna: 'estado', lee: ['ver_reservas'], escribe: ['reservar', 'actualizar_reserva'] }),
    t({ id: 'compra.estado', familia: 'vida', nombre: 'Estado de compra', valores: ['pendiente', 'comprado', 'descartado'], origen: 'tipo Compra', modulo: 'src/compras.ts', tabla: 'compras', columna: 'estado', lee: ['ver_compras'], escribe: ['anotar_compras', 'marcar_compras'] }),
    t({ id: 'obra.tipo', familia: 'vida', nombre: 'Tipo de obra', valores: TIPOS_OBRA, origen: 'TIPOS_OBRA', modulo: 'src/libreria.ts', tabla: 'obras', columna: 'tipo', lee: ['ver_libreria'], escribe: ['agregar_obra'] }),
    t({ id: 'obra.estado', familia: 'vida', nombre: 'Estado de obra', valores: ESTADOS_OBRA, origen: 'ESTADOS_OBRA', modulo: 'src/libreria.ts', tabla: 'obras', columna: 'estado', lee: ['ver_libreria'], escribe: ['agregar_obra'] }),
    t({ id: 'obra.valoracion', familia: 'vida', nombre: 'Valoración de obra', valores: null, rango: [1, 12], origen: 'esquema de obras', modulo: 'src/libreria.ts', tabla: 'obras', columna: 'valoracion', lee: ['ver_libreria'], escribe: ['agregar_obra'] }),
    t({ id: 'aprendizaje.estado', familia: 'vida', nombre: 'Estado de aprendizaje', valores: ['activo', 'pausado', 'logrado', 'sugerido', 'descartado'], origen: 'esquema de aprendizajes', modulo: 'src/academia.ts', tabla: 'aprendizajes', columna: 'estado', lee: ['ver_aprendizajes'], escribe: ['crear_aprendizaje', 'sugerir_aprendizajes'] }),
    t({ id: 'idioma.nivel', familia: 'vida', nombre: 'Nivel de idioma', valores: NIVELES_IDIOMA, origen: 'NIVELES', modulo: 'src/idiomas.ts', lee: ['ver_idiomas'], escribe: ['crear_idioma'] }),
    t({ id: 'tarjeta.calidad', familia: 'vida', nombre: 'Calidad de respuesta en un repaso', valores: CALIDADES, origen: 'CALIDADES', modulo: 'src/tarjetas.ts', lee: [], escribe: [] }),
    t({ id: 'sueno.fuente', familia: 'vida', nombre: 'Fuente de un sueño', valores: FUENTES_SUENO, origen: 'FUENTES_SUENO', modulo: 'src/suenos.ts', lee: ['ver_suenos'], escribe: ['anotar_sueno'] }),
    t({ id: 'memoria.tipo', familia: 'vida', nombre: 'Tipo de recuerdo', valores: TIPOS_MEMORIA, origen: 'TIPOS_MEMORIA', modulo: 'src/memoria.ts', tabla: 'memoria', columna: 'tipo', lee: ['leer_memoria'], escribe: ['recordar', 'corregir_memoria'] }),
    t({ id: 'memoria.horizonte', familia: 'vida', nombre: 'Horizonte de una meta', valores: HORIZONTES, origen: 'HORIZONTES', modulo: 'src/memoria.ts', tabla: 'memoria', columna: 'horizonte', lee: ['leer_memoria'], escribe: ['recordar', 'corregir_memoria'] }),
    t({ id: 'escala', familia: 'vida', nombre: 'Escala de tiempo', valores: ESCALAS, origen: 'ESCALAS', modulo: 'src/escalas.ts', lee: ['ver_escala'], escribe: ['fijar_meta_mes'] }),
    // ─── salidas
    t({ id: 'generado.tipo', familia: 'salidas', nombre: 'Tipo de generado', valores: claves(TIPOS_GENERADO), origen: 'TIPOS_GENERADO', modulo: 'src/archivo.ts', tabla: 'generados', columna: 'tipo', lee: ['buscar_generados'], escribe: ['armar_pdf', 'armar_presentacion', 'reenviar_generado'] }),
    t({ id: 'artefacto.tipo', familia: 'salidas', nombre: 'Tipo de artefacto del taller', valores: TIPOS_ARTEFACTO, origen: 'TIPOS_ARTEFACTO', modulo: 'src/taller.ts', tabla: 'artefactos', columna: 'tipo', lee: ['ver_taller'], escribe: ['crear_en_taller', 'iterar_en_taller'] }),
    t({ id: 'feed.plataforma', familia: 'salidas', nombre: 'Plataforma del feed', valores: PLATAFORMAS_FEED, origen: 'PLATAFORMAS', modulo: 'src/feed.ts', lee: ['ver_feed', 'ver_ranking_feed'], escribe: ['seguir_en_feed'] }),
    t({ id: 'observatorio.plataforma', familia: 'salidas', nombre: 'Plataforma del observatorio', valores: PLATAFORMAS_OBSERVATORIO, origen: 'PLATAFORMAS', modulo: 'src/observatorio.ts', lee: ['ver_observatorio'], escribe: ['seguir_tema'] }),
    t({ id: 'cuenta.modo', familia: 'salidas', nombre: 'Modo de una cuenta', valores: MODOS_CUENTA, origen: 'MODOS', modulo: 'src/cuentas.ts', lee: ['ver_cuentas'], escribe: ['cuenta_de_agente'] }),
    // ─── criterios
    t({ id: 'criterio', familia: 'criterios', nombre: 'Criterio con peso', descripcion: 'Cada criterio es un personaje con su peso en %; los pesos suman 100.', valores: CRITERIOS.map((c) => c.clave), origen: 'CRITERIOS', modulo: 'src/criterios.ts', lee: ['ver_criterios'], escribe: ['fijar_criterio'] }),
  ]
  return _tipos
}

/** Las constantes de enumeración que existen en el código pero no son clasificaciones del conocimiento (y por qué). */
export const NO_SON_TAXONOMIA: Record<string, string> = {
  'src/academia.ts:NIVELES_TUTOR': 'niveles de explicación del tutor, no clasifican material',
  'src/academia.ts:VISUALES': 'formato de un visual del tutor',
  'src/apps.ts:PERMISOS': 'permisos de apps externas',
  'src/ayudantes.ts:CLASES_AYUDANTE': 'subconjunto de clases de agente, ya en agente.clase',
  'src/dispositivos.ts:TIPOS_DISPOSITIVO': 'aparatos del operador',
  'src/discovery.ts:CATEGORIAS_KPI': 'categorías de un KPI de encargo',
  'src/estudio.ts:TIPOS_CAPA': 'capas del editor de video',
  'src/mapa.ts:CAPAS_MAPA': 'capas del mapa',
  'src/mapamundi.ts:LENTES': 'lentes del mapamundi',
  'src/meditacion.ts:TIPOS_FASE': 'fases de una respiración',
  'src/mudanza.ts:RAICES': 'carpetas de archivos',
  'src/rescate.ts:TIPOS': 'tipos de archivo rescatado',
  'src/visuales.ts:TIPOS_NODO': 'piezas de un circuito simulado',
  'src/taller.ts:CLASES_VISUAL': 'estilos de un visual del taller',
  'src/xp.ts:CAPAS': 'capas de contexto que abre un agente según su nivel',
  'src/explorar/index.ts:CANALES': 'el registro de canales de búsqueda, no una clasificación',
}

export type Hallazgo = { tipo: string; que: 'valor_no_declarado' | 'fuera_de_rango' | 'columna_faltante' | 'variante_distinta' | 'sin_herramientas' | 'herramienta_inexistente' | 'falta'; detalle: string; veces?: number }

const columnasDe = (db: Db, tabla: string): Set<string> => {
  try { return new Set((db.prepare(`PRAGMA table_info(${tabla})`).all() as any[]).map((c) => c.name)) } catch { return new Set() }
}

/** Lo que se ve sin abrir la base: listas que faltan, otra lista distinta para lo mismo, tipos que ninguna herramienta lee ni escribe y herramientas nombradas que no existen. */
export function revisarRegistro(herramientas?: readonly string[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const existentes = herramientas ? new Set(herramientas) : null
  for (const t of taxonomia()) {
    if (t.falta) hallazgos.push({ tipo: t.id, que: 'falta', detalle: t.falta })
    for (const v of t.variantes ?? []) {
      const a = new Set(t.valores?.map(String) ?? [])
      const sobran = v.valores.filter((x) => !a.has(x)), faltan = [...a].filter((x) => !v.valores.includes(x))
      if (sobran.length || faltan.length) hallazgos.push({ tipo: t.id, que: 'variante_distinta', detalle: `${v.modulo} declara otra lista${faltan.length ? `: le falta ${faltan.join(', ')}` : ''}${sobran.length ? `; agrega ${sobran.join(', ')}` : ''}` })
    }
    if (!t.lee.length && !t.escribe.length) hallazgos.push({ tipo: t.id, que: 'sin_herramientas', detalle: 'ninguna herramienta lo lee ni lo escribe' })
    if (existentes) for (const h of [...t.lee, ...t.escribe]) if (!existentes.has(h)) hallazgos.push({ tipo: t.id, que: 'herramienta_inexistente', detalle: `«${h}» no está entre las herramientas` })
  }
  return hallazgos
}

const TRAMO = 2_000
const ceder = () => new Promise<void>((r) => setImmediate(r))

/**
 * Lo que dice la base: valores usados que no están declarados, números fuera de rango y columnas que no existen.
 * Recorre de a tramos y cede el turno entre uno y otro: no traba el servidor aunque el corpus sea grande.
 */
export async function revisarBase(db: Db): Promise<Hallazgo[]> {
  const hallazgos: Hallazgo[] = []
  for (const t of taxonomia()) {
    if (!t.tabla || !t.columna) continue
    const cols = columnasDe(db, t.tabla)
    if (!cols.size) continue // la tabla se crea con el primer uso: todavía no hay nada que auditar
    if (!cols.has(t.columna)) { hallazgos.push({ tipo: t.id, que: 'columna_faltante', detalle: `${t.tabla}.${t.columna} no existe en esta base` }); continue }
    if (!t.valores && !t.rango) continue
    const usados = new Map<string, number>()
    const max = Number((db.prepare(`SELECT MAX(rowid) AS m FROM ${t.tabla}`).get() as any)?.m ?? 0)
    const contar = db.prepare(`SELECT ${t.columna} AS v, COUNT(*) AS n FROM ${t.tabla} WHERE rowid > ? AND rowid <= ? AND ${t.columna} IS NOT NULL GROUP BY ${t.columna}`)
    for (let desde = 0; desde < max; desde += TRAMO) {
      for (const u of contar.all(desde, desde + TRAMO) as { v: string | number; n: number }[]) usados.set(String(u.v), (usados.get(String(u.v)) ?? 0) + u.n)
      await ceder()
    }
    if (t.rango) {
      const [lo, hi] = t.rango
      for (const [v, n] of usados) if (!(Number(v) >= lo && Number(v) <= hi)) hallazgos.push({ tipo: t.id, que: 'fuera_de_rango', detalle: `${t.tabla}.${t.columna} = ${v} (va de ${lo} a ${hi})`, veces: n })
    } else {
      const ok = new Set(t.valores!.map(String))
      for (const [v, n] of usados) if (!ok.has(v) && !t.admite?.test(v)) hallazgos.push({ tipo: t.id, que: 'valor_no_declarado', detalle: `${t.tabla}.${t.columna} = «${v}»`, veces: n })
    }
  }
  return hallazgos
}

export function estadosDe(hallazgos: Hallazgo[]): Record<string, Estado> {
  const estados: Record<string, Estado> = {}
  for (const t of taxonomia()) {
    const h = hallazgos.filter((x) => x.tipo === t.id)
    estados[t.id] = h.some((x) => x.que === 'falta' || x.que === 'columna_faltante') ? 'falta'
      : h.some((x) => x.que === 'valor_no_declarado' || x.que === 'fuera_de_rango' || x.que === 'variante_distinta') ? 'inconsistente' : 'existe'
  }
  return estados
}

/** La auditoría completa: el registro contra el código y contra la base. */
export async function auditar(db: Db | null, herramientas?: readonly string[]): Promise<{ hallazgos: Hallazgo[]; estados: Record<string, Estado> }> {
  const hallazgos = [...revisarRegistro(herramientas), ...(db ? await revisarBase(db) : [])]
  return { hallazgos, estados: estadosDe(hallazgos) }
}

const valoresTexto = (t: Tipo) => t.rango ? `${t.rango[0]} a ${t.rango[1]}` : t.valores ? t.valores.join(' · ') : 'libre'

/** El registro para la pantalla: familia → tipos → valores, con el estado de cada uno según los hallazgos que se le pasen. */
export function catalogo(hallazgos: Hallazgo[] = revisarRegistro()) {
  const estados = estadosDe(hallazgos)
  return {
    familias: (Object.keys(FAMILIAS) as Familia[]).map((f) => ({
      id: f, descripcion: FAMILIAS[f],
      tipos: taxonomia().filter((t) => t.familia === f).map((t) => ({ ...t, valores: t.valores ? [...t.valores] : null, valoresTexto: valoresTexto(t), estado: estados[t.id] })),
    })),
    hallazgos,
    resumen: { tipos: taxonomia().length, existe: Object.values(estados).filter((e) => e === 'existe').length, falta: Object.values(estados).filter((e) => e === 'falta').length, inconsistente: Object.values(estados).filter((e) => e === 'inconsistente').length },
  }
}

/** La sección «Taxonomía» de los lineamientos, regenerada desde el registro cada vez que se lee. */
export function taxonomiaMarkdown(): string {
  const hallazgos = revisarRegistro()
  const estados = estadosDe(hallazgos)
  const lineas = ['## Taxonomía', '', '_Generada desde src/taxonomia.ts (Fragua 321). Ninguna enumeración de tipos se escribe a mano en otro lado: todas se leen del registro._', '']
  for (const f of Object.keys(FAMILIAS) as Familia[]) {
    lineas.push(`### ${f[0].toUpperCase()}${f.slice(1)}`, `_${FAMILIAS[f]}_`, '')
    for (const t of taxonomia().filter((x) => x.familia === f)) {
      const donde = t.tabla ? `${t.tabla}.${t.columna}` : t.modulo
      const herr = [t.lee.length ? `lee: ${t.lee.join(', ')}` : '', t.escribe.length ? `escribe: ${t.escribe.join(', ')}` : ''].filter(Boolean).join(' · ')
      lineas.push(`- **${t.nombre}** (\`${t.id}\`, ${estados[t.id]}): ${valoresTexto(t)}. En ${donde}${herr ? `; ${herr}` : ''}.${t.descripcion ? ` ${t.descripcion}` : ''}`)
    }
    lineas.push('')
  }
  const pendientes = hallazgos.filter((h) => h.que !== 'sin_herramientas')
  if (pendientes.length) lineas.push('### Lo que no cierra', ...pendientes.map((h) => `- \`${h.tipo}\`: ${h.detalle}`), '')
  return lineas.join('\n').trim()
}
