/**
 * El esqueleto (la Matriz 72 en La máquina): todo lo que trabaja en Deprocast en una sola geometría. En cada celda
 * (8 dominios × 9 oficios) conviven tres cosas:
 * - los órganos: lo que el sistema ya hace solo (leer un video, un cuaderno, destilar, la Fragua, la guardia de horas…),
 *   con su función, sus virtudes, qué hace y su actividad real de la semana;
 * - los agentes de la liga que él forjó en esa celda;
 * - los propuestos: agentes que salieron de sus pedidos y todavía no están forjados (se forjan desde acá, con su ok).
 * Nada personal: son descripciones del sistema. Lo suyo (las cartas, la actividad) sale de la base.
 */
import type { Db } from './db.ts'
import { celda as celdaDe, DOMINIOS } from './geometria72.ts'
import { cadenaPara } from './nan.ts'
import type { ClaseId } from './clases.ts'

export type Organo = {
  id: string; nombre: string; glifo: string; celda: number; tipo: 'organo' | 'propuesto'
  funcion: string; virtudes: string[]; hace: string[]; cuando: string
  /** Para mostrar con qué modelos piensa (la cadena de NaN de esa llamada). */
  cadena?: { clase: ClaseId | 'mastropiero'; agenteId: string }
  /** La vista de la pantalla donde se lo ve trabajar («modal:cuaderno» abre el Cuaderno en vivo). */
  vista?: string
  /** Cómo se cuenta lo que hizo en la semana: SQL con un solo «?» (desde), que devuelve n. */
  actividad?: { sql: string; etiqueta: string }[]
  /** Sus errores en el panel único (origen LIKE …). */
  errores?: string
  /** De qué propuesta de la Fragua sale (los propuestos). */
  propuesta?: number
  /** Para forjarlo (los propuestos): la clase y sus instrucciones. */
  forja?: { clase: ClaseId; instrucciones: string }
}

const c = (dominio: number, oficio: number) => dominio * 9 + oficio + 1
// Oficios: 0 Input·Cuerpo · 1 Input·Mente · 2 Input·Alma · 3 Proc·Cuerpo · 4 Proc·Mente · 5 Proc·Alma · 6 Output·Cuerpo · 7 Output·Mente · 8 Output·Alma
const [CAPTURA, CRIBA, BIBLIOTECA, MEMORIA, TERRITORIO, FINANZAS, DERECHO, VITALIDAD] = [0, 1, 2, 3, 4, 5, 6, 7]

export const ORGANOS: Organo[] = [
  // ─── Captura: lo que entra
  {
    id: 'cuaderno', nombre: 'El Cuaderno', glifo: '✒', celda: c(CAPTURA, 0), tipo: 'organo', vista: 'modal:cuaderno',
    funcion: 'Lo escrito a mano y lo dicho en voz entra al corpus: hojas del cuaderno digital (en vivo o por el bot), fotos de páginas y notas de voz.',
    virtudes: ['Lee manuscrito con visión, sin que tipees nada', 'Una tanda es un aviso, no uno por hoja', 'Lo que se corta por red se reintenta solo'],
    hace: ['Cuaderno en vivo: la tableta en la compu, hoja por hoja', 'Hojas por Telegram o WhatsApp («hojas», /cuaderno)', 'Notas de voz: transcribe y separa quién habla'],
    cuando: 'Cuando llega una hoja o un audio',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM tandas WHERE tipo = 'pagina' AND estado = 'hecha' AND hecha_en >= ?`, etiqueta: 'hojas leídas' }, { sql: `SELECT COUNT(*) AS n FROM tandas WHERE tipo = 'audio' AND estado = 'hecha' AND hecha_en >= ?`, etiqueta: 'audios' }],
  },
  {
    id: 'youtube', nombre: 'El Lector de videos', glifo: '▶', celda: c(CAPTURA, 1), tipo: 'organo',
    funcion: 'Un video o un canal de YouTube entra con su transcripción completa y lo que se ve en pantalla, leído por Gemini del lado de Google.',
    virtudes: ['Videos largos de a tramos de 20 minutos (entran en el cupo)', 'Si Google está saturado o sin cupo, espera en la nube y vuelve solo', 'Lo que nadie puede leer (privado, solo miembros) no queda colgado'],
    hace: ['Transcribe y destila: qué plantea, si el título cumple, fuentes', 'Censa un canal entero antes de traerlo (con su ok)', 'Explora lo que el video recomienda'],
    cuando: 'Al llegar un link de YouTube; la cola se revisa cada 15 minutos',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM youtube_cola WHERE estado = 'listo' AND leido_en >= ?`, etiqueta: 'videos leídos' }],
    errores: 'youtube:%',
  },
  {
    id: 'puerta', nombre: 'La Puerta', glifo: '✉', celda: c(CAPTURA, 2), tipo: 'organo', vista: 'chat',
    funcion: 'Telegram y WhatsApp: lo que dice o manda desde el celular llega a Mastropiero y a su lugar (un gasto, una comida, un sueño, una hoja, un link).',
    virtudes: ['Clasifica fotos y textos sin preguntar', 'Responder a un registro lo corrige', 'Los avisos del sistema salen por el mismo canal'],
    hace: ['Fotos → registro, hoja de cuaderno o charla', 'Audios → nota de voz', 'Links → corpus (y Maps → lugar)'],
    cuando: 'Siempre: cada mensaje',
  },
  {
    id: 'captura', nombre: 'El Clasificador de capturas', glifo: '⊞', celda: c(CAPTURA, 3), tipo: 'organo', cadena: { clase: 'mastropiero', agenteId: 'captura' },
    funcion: 'Una foto o una frase se vuelve un registro en su lugar: comida, ejercicio, sueño, peso, gasto, ingreso, aprendizaje o página manuscrita.',
    virtudes: ['Una sola llamada: visión si hay foto, texto si no', 'Con ↩ se deshace', 'Lo que no es registro sigue a la charla'],
    hace: ['Estima kcal y macros de un plato', 'Lee tickets y facturas', 'Reconoce una página escrita a mano'],
    cuando: 'Cada foto o frase que parece un registro',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM llamadas WHERE agente_id = 'captura' AND en >= ?`, etiqueta: 'capturas' }],
  },
  // ─── Criba: lo que pesa
  {
    id: 'criba', nombre: 'La Criba', glifo: '⚖', celda: c(CRIBA, 4), tipo: 'organo', vista: 'criba',
    funcion: 'Él pesa el corpus de a una pieza, con una tecla: el peso ordena todo lo demás (lo que sube en las búsquedas y lo que leen los ayudantes).',
    virtudes: ['Lo retirado y las versiones de algo ya votado no vuelven', 'El voto se hereda a las versiones nuevas', 'Sin rachas que castiguen un día malo'],
    hace: ['Peso 1–12 o descarte', 'Notas con @ que entran al corpus', 'Lo «para hacer» de una nota, como side quest'],
    cuando: 'Cuando él criba',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM criba WHERE en >= ?`, etiqueta: 'piezas pesadas' }],
  },
  {
    id: 'mano', nombre: 'La Mano', glifo: '🂠', celda: c(CRIBA, 5), tipo: 'organo', vista: 'mano',
    funcion: 'Cinco afirmaciones destiladas de lo suyo, todavía sin pesar: él las pesa y ve al instante con qué conectan y con qué chocan.',
    virtudes: ['Sin modelo al jugar: la respuesta sale de los datos', 'Lo nuevo de verdad sale primero', 'Mide si sus predicciones aciertan'],
    hace: ['Peso, descarte o «choca con lo que sabía»', 'Puentes entre ideas lejanas', 'Pesquisas abiertas'],
    cuando: 'Cuando él juega una mano',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM mano_jugadas WHERE deshecha = 0 AND en >= ?`, etiqueta: 'jugadas' }],
  },
  {
    id: 'criba72', nombre: 'La Criba del 72', glifo: '⬡', celda: c(CRIBA, 8), tipo: 'organo', vista: 'criba72', cadena: { clase: 'mastropiero', agenteId: 'criba72' },
    funcion: '72 frases en 6 ejes de polos opuestos: él vota por instinto y recién al final se ve la estructura (pares partidos, tensiones vivas, zonas frías).',
    virtudes: ['No diagnostica: hipótesis con los ítems que las sostienen', 'Arma la siguiente donde hay tensión', 'Lo aprendido va a su memoria, para revisar'],
    hace: ['Importar cribas o armar una nueva', 'Lectura con protocolo', 'Exportar para otra IA'],
    cuando: 'Cuando él abre una criba',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM criba72_sesiones WHERE creada >= ?`, etiqueta: 'sesiones' }],
  },
  // ─── Biblioteca: lo que se sabe
  {
    id: 'explorar', nombre: 'El Explorador', glifo: '🌐', celda: c(BIBLIOTECA, 0), tipo: 'organo', vista: 'observatorio',
    funcion: 'Sale a internet sin cuenta: busca y lee en la web, Reddit, YouTube, GitHub, X, LinkedIn, Instagram y Facebook, con caminos de respaldo.',
    virtudes: ['Si un camino está bloqueado, va el siguiente', 'Nunca lee la red de adentro (localhost, IPs privadas)', 'Cada canal dice qué no se puede ver sin cuenta'],
    hace: ['buscar_en, explorar y leer_pagina para agentes, chat y MCP', 'Las rondas del Observatorio', 'Lectura de respaldo con Jina y Exa'],
    cuando: 'Cuando un agente, el chat o el Observatorio lo piden',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM observatorio_rondas WHERE en >= ?`, etiqueta: 'rondas del Observatorio' }],
    errores: 'explorar:%',
  },
  {
    id: 'reproceso', nombre: 'El Destilador', glifo: '⚗', celda: c(BIBLIOTECA, 4), tipo: 'organo', cadena: { clase: 'mastropiero', agenteId: 'reproceso' },
    funcion: 'Recorre todo el corpus: lo parte en pasajes con vector, destila cada pieza (ideas, decisiones, personas, proyectos) y escribe la historia de cada proyecto.',
    virtudes: ['De a 6 pasos a la vez, sin ahogar a nadie', 'Lo importado primero: es lo que acabás de subir', 'Una sola historia por proyecto, actualizada'],
    hace: ['Pasajes y vectores', 'Destilado y línea temporal', 'Crónica de cada mes e historia de cada proyecto'],
    cuando: 'De fondo, en la nube, mientras haya algo por hacer',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM takeout_destilado WHERE estado = 'hecho' AND hecho_en >= ?`, etiqueta: 'piezas destiladas' }],
    errores: 'reproceso%',
  },
  {
    id: 'grafo', nombre: 'El Cartógrafo', glifo: '🕸', celda: c(BIBLIOTECA, 5), tipo: 'organo', vista: 'grafo',
    funcion: 'Dibuja la forma de su pensamiento: los conceptos de su corpus, cómo se juntan en zonas, y los que dicen lo mismo sin aparecer juntos.',
    virtudes: ['Lo de máquina (logs, código, volcados) no entra', 'Une por sentido, no solo por co-aparición', 'Encuentra bisagras y huecos'],
    hace: ['preguntar_al_corpus por zonas', 'conectar_conceptos: qué une X con Y', 'Fotos del grafo en el tiempo'],
    cuando: 'Al recalcular el grafo',
  },
  {
    id: 'cuadernos', nombre: 'Los Cuadernos', glifo: '📓', celda: c(BIBLIOTECA, 7), tipo: 'organo', vista: 'cuadernos',
    funcion: 'Como NotebookLM, sobre su corpus: junta fuentes y responde solo con ellas, con cita; arma guía y una charla en audio a dos voces.',
    virtudes: ['Cada afirmación con su fuente', 'Si no está en las fuentes, lo dice', 'La charla se escucha caminando'],
    hace: ['Preguntas con citas', 'Guía: resumen, ideas clave, preguntas', 'Audio a dos voces'],
    cuando: 'Cuando él arma o le pregunta a un cuaderno',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM cuadernos WHERE creado_en >= ?`, etiqueta: 'cuadernos nuevos' }],
  },
  // ─── Memoria: lo que no se olvida (y lo que se corrige)
  {
    id: 'escriba', nombre: 'El Escriba', glifo: '✍', celda: c(MEMORIA, 1), tipo: 'organo',
    funcion: 'De cada cosa que él dice, anota lo que vale recordar: hechos, decisiones, preferencias, gente. Nunca de lo que dicen otros.',
    virtudes: ['Corre de fondo: no frena la respuesta', 'Lo dudoso queda para revisar', 'Sus correcciones mandan sobre todo'],
    hace: ['Recuerdos con horizonte', 'Contactos y relaciones', 'Correcciones duraderas'],
    cuando: 'Después de cada mensaje suyo',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM memoria WHERE creada_en >= ?`, etiqueta: 'recuerdos' }],
  },
  {
    id: 'guardia', nombre: 'La Guardia de las horas', glifo: '⏱', celda: c(MEMORIA, 7), tipo: 'organo',
    funcion: 'Ninguna reunión se nombra con hora y sin fecha: cada respuesta se cruza con la agenda de verdad, y si no está, se avisa con la que sí es.',
    virtudes: ['Sin modelo: no se puede saltear', 'Dice cuál es la de verdad y de qué día', 'Cada caso queda contado en los errores'],
    hace: ['Revisa cada respuesta del chat', 'Busca la reunión en la semana anterior y la siguiente', 'Avisa en la charla'],
    cuando: 'Después de cada respuesta de Mastropiero',
    errores: 'chat:guardia-horas',
  },
  {
    id: 'autocritica', nombre: 'El Autocrítico', glifo: '☉', celda: c(MEMORIA, 5), tipo: 'organo', cadena: { clase: 'mastropiero', agenteId: 'autocritica' },
    funcion: 'Mira lo que falló y lo que trabó (errores, pasos lentos, respuestas flojas) y lo convierte en propuestas concretas para la Fragua.',
    virtudes: ['Un error repetido es uno, con su cuenta', 'Separa lo propio de lo ajeno (un corte de Google no es un bug)', 'Cada propuesta trae su prueba'],
    hace: ['El panel único de errores', 'Medición de pasos lentos', 'Propuestas para la Fragua'],
    cuando: 'De fondo y en cada error',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM propuestas WHERE creada_en >= ?`, etiqueta: 'propuestas nuevas' }],
  },
  {
    id: 'fragua', nombre: 'La Fragua', glifo: '⚒', celda: c(MEMORIA, 8), tipo: 'organo', vista: 'fragua', cadena: { clase: 'mastropiero', agenteId: 'fragua' },
    funcion: 'Mastropiero mejora su propio código sin tocar lo que anda: cada mejora en una copia aparte, compilada y probada entera; él decide.',
    virtudes: ['Nada entra solo: pull request y su ok', 'Si un motor falla, prueba con el siguiente (cuatro)', 'Un commit que nombra la propuesta la cierra'],
    hace: ['Elige archivos y arma un plan', 'Escribe, compila y prueba (corrige hasta 2 veces)', 'Prueba de humo del servidor forjado'],
    cuando: 'De noche, o cuando él forja una propuesta',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM fragua WHERE creada_en >= ?`, etiqueta: 'forjas' }],
  },
  // ─── Territorio: dónde y cuándo
  {
    id: 'brujula', nombre: 'La Brújula', glifo: '🧭', celda: c(TERRITORIO, 3), tipo: 'organo', vista: 'hoy', cadena: { clase: 'mastropiero', agenteId: 'brujula' },
    funcion: 'El día en un solo lugar y con su fuente: agenda, horario fijo, run, primarias; y una sola instrucción útil para hoy.',
    virtudes: ['Cada cosa con su fuente', 'El día vacío se dice con palabras', 'Nada de otro día pasa por hoy'],
    hace: ['ver_dia y ver_agenda', 'La brújula de la mañana', 'Avisos de lo que vence'],
    cuando: 'Cada mañana y cada vez que se pregunta por un día',
  },
  {
    id: 'runs', nombre: 'El Director de runs', glifo: '➤', celda: c(TERRITORIO, 6), tipo: 'organo', vista: 'misiones', cadena: { clase: 'mastropiero', agenteId: 'run' },
    funcion: 'Arma la run que él pide (tiempo, energía, a quién meter) en bandas que respetan su horario, y aprende de cómo le fue.',
    virtudes: ['Él la diseña; Mastropiero la arma', 'Ninguna banda dentro del trabajo', 'Lo cumplido calibra las próximas'],
    hace: ['Bandas con su meta', 'Primarias y side quests', 'El Directo: qué está haciendo ahora'],
    cuando: 'Cuando él arranca una run',
  },
  // ─── Finanzas: la plata (la suya y la de las máquinas)
  {
    id: 'finanzas', nombre: 'El Tesorero', glifo: '€', celda: c(FINANZAS, 0), tipo: 'organo', vista: 'hoy',
    funcion: 'Gastos e ingresos: los que dice, los tickets que manda y los extractos del banco, cada uno en su categoría y su proyecto.',
    virtudes: ['Un extracto no duplica lo que ya estaba', 'Lo que dice de pasada («pagué 12 €») se anota', 'Resumen del mes'],
    hace: ['Registra movimientos', 'Importa extractos CSV', 'Plata del mes en Hoy'],
    cuando: 'Cuando llega un gasto, un ingreso o un extracto',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM movimientos WHERE creado_en >= ?`, etiqueta: 'movimientos' }],
  },
  {
    id: 'benchmark', nombre: 'El Benchmarkeador', glifo: '📊', celda: c(FINANZAS, 4), tipo: 'organo', cadena: { clase: 'mastropiero', agenteId: 'benchmark:codigo' },
    funcion: 'Prueba los modelos de NaN con su banco de pruebas (corpus, clasificación, redacción, extracción, código) y recomienda a cuál rotar cada tarea por acierto, precio y velocidad.',
    virtudes: ['Trampas que castigan el dato viejo y el invento', 'Si todos aciertan, dice que la prueba no distingue', 'Solo recomienda: rotar es decisión suya'],
    hace: ['Corre el banco contra el de siempre y dos alternativas', 'Sella el veredicto como quántomo', 'Mide créditos y tiempos'],
    cuando: 'Cuando se corre el banco',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM bench_corridas WHERE en >= ?`, etiqueta: 'mediciones' }],
  },
  // ─── Vitalidad: el cuerpo y lo que sueña
  {
    id: 'salud', nombre: 'El Cuerpo', glifo: '♥', celda: c(VITALIDAD, 0), tipo: 'organo', vista: 'salud',
    funcion: 'Comidas, entrenamientos, sueño y peso, contra sus metas; lo que alimenta la brújula y el gemelo.',
    virtudes: ['Una foto de un plato alcanza', 'Metas suyas, no genéricas', 'Corrige con una respuesta'],
    hace: ['Registra y estima', 'Resumen del día contra metas', 'Hábitos'],
    cuando: 'Cada registro',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM salud WHERE creado_en >= ?`, etiqueta: 'registros' }],
  },
  {
    id: 'suenos', nombre: 'El Onironauta', glifo: '☾', celda: c(VITALIDAD, 2), tipo: 'organo', vista: 'suenos',
    funcion: 'Lo que cuenta de un sueño («soñé que…») va a Sueños, no a la charla: se guarda con sus emociones y se destila.',
    virtudes: ['Lo reconoce solo, por voz o texto', 'Lúcidos y recurrentes', 'No interpreta sin pedírselo'],
    hace: ['Guarda y destila sueños', 'Emociones y símbolos', 'Lo recurrente, a la vista'],
    cuando: 'Cuando cuenta un sueño',
    actividad: [{ sql: `SELECT COUNT(*) AS n FROM suenos WHERE creado_en >= ?`, etiqueta: 'sueños' }],
  },

  // ─── Propuestos: salieron de sus pedidos, se forjan con su ok
  {
    id: 'taxonomo', nombre: 'El Taxónomo', glifo: '🐜', celda: c(VITALIDAD, 1), tipo: 'propuesto', propuesta: 234,
    funcion: 'Identifica lo vivo y el cielo: de una foto o un nombre, una ficha con nombre común y científico, familia, rasgos que lo distinguen de su pariente más cercano, hábitat; y para el cielo, constelación, catálogo y coordenadas.',
    virtudes: ['Tres miradas: biólogo, micrólogo, astrónomo', 'Honesto: si no llega a especie, dice género y hasta dónde sabe', 'Trabaja con un catálogo de referencia, no adivina'],
    hace: ['Fichas de especies desde una foto', 'Fichas de objetos celestes', 'Arma su lista de lo que fue viendo'],
    cuando: 'Cuando le mandan una foto de un bicho, una planta o el cielo',
    forja: { clase: 'clasificador', instrucciones: 'Sos El Taxónomo: identificás seres vivos y cuerpos celestes. De una foto o un nombre devolvés una ficha: nombre común y científico, reino y familia, los rasgos que lo distinguen de su pariente más cercano, hábitat y época; para el cielo, constelación, catálogo y coordenadas. Si no llegás a especie, decí el género y hasta dónde sabés. Trabajá con las listas de especies y los catálogos que haya en el corpus; si no hay, decilo antes de contestar.' },
  },
  ...(['Laboral', 'Mercantil', 'Fiscal'] as const).map((rubro): Organo => ({
    id: `logos-${rubro.toLowerCase()}`, nombre: `Logos · ${rubro}`, glifo: '§', tipo: 'propuesto', propuesta: 235,
    celda: rubro === 'Laboral' ? c(DERECHO, 4) : rubro === 'Mercantil' ? c(DERECHO, 7) : c(FINANZAS, 7),
    funcion: `Un profesional del derecho ${rubro.toLowerCase()} de la familia Los Logos: contesta con la norma y su cita, separa lo que dice la fuente de su lectura, y deriva a otro Logos lo que no es suyo.`,
    virtudes: ['Cita la norma, no opina sin fuente', 'Si su rubro no tiene fuente cargada, lo declara antes de contestar', 'Sabe qué no sabe y a quién derivar'],
    hace: rubro === 'Laboral' ? ['Convenios, contratos, despidos, igualdad', 'Lee actas y propone redacción', 'Alerta de plazos'] : rubro === 'Mercantil' ? ['Sociedades, contratos entre empresas', 'Actas y estatutos', 'Riesgos de un acuerdo'] : ['Impuestos y obligaciones', 'Facturas y deducciones', 'Calendario fiscal'],
    cuando: 'Cuando se le encarga un tema de su rubro',
    forja: { clase: 'generativo', instrucciones: `Sos Logos · ${rubro}, de la familia Los Logos: un profesional del derecho ${rubro.toLowerCase()}. Contestás con las fuentes del corpus (normas, convenios, sentencias, lo que haya cargado de tu rubro) y citás de dónde sale cada cosa; separás lo que dice la norma de tu lectura. Si tu rubro no tiene fuente cargada, lo decís antes de contestar. Lo que es de otro rubro lo derivás: Logos · Laboral, Logos · Mercantil o Logos · Fiscal.` },
  })),
]

export type Celda = ReturnType<typeof celdaDe>

/**
 * El esqueleto para la pantalla: cada órgano y propuesto con su celda, su actividad de los últimos 7 días, sus errores y
 * con qué modelos piensa; y la cuenta por dominio. Las cartas de la liga se suman en la pantalla (ya están en el roster).
 */
export function verEsqueleto(db: Db, ahora = Date.now()) {
  const desde = ahora - 7 * 86_400_000
  const n = (sql: string, ...a: (string | number)[]) => { try { return Number((db.prepare(sql).get(...a) as { n: number } | undefined)?.n ?? 0) } catch { return null } }
  const organos = ORGANOS.map((o) => ({
    ...o,
    celdaInfo: celdaDe(o.celda),
    modelos: o.cadena ? cadenaPara(o.cadena) : [],
    semana: (o.actividad ?? []).map((a) => ({ etiqueta: a.etiqueta, n: n(a.sql, desde) })),
    erroresSemana: o.errores ? n('SELECT COALESCE(SUM(veces), 0) AS n FROM errores WHERE origen LIKE ? AND ultima >= ?', o.errores, desde) : null,
    // Un propuesto que ya se forjó (su propuesta se cerró) se marca: queda a la vista hasta que el agente aparezca en la liga.
    propuestaEstado: o.propuesta ? ((db.prepare('SELECT estado FROM propuestas WHERE id = ?').get(o.propuesta) as { estado: string } | undefined)?.estado ?? null) : null,
  }))
  return {
    dominios: DOMINIOS,
    organos,
    porDominio: DOMINIOS.map((d, i) => ({ dominio: d, organos: organos.filter((o) => o.tipo === 'organo' && Math.floor((o.celda - 1) / 9) === i).length, propuestos: organos.filter((o) => o.tipo === 'propuesto' && Math.floor((o.celda - 1) / 9) === i).length })),
  }
}
