/**
 * Qué puede hacer Deprocast, dicho para que Mastropiero lo sepa (y no niegue lo que existe: «por Telegram no entra
 * audio» era falso). Cuando se suma una función, se suma acá una línea.
 */
export type Capacidad = { area: string; que: string; claves: string }

export const CAPACIDADES: Capacidad[] = [
  { area: 'Telegram', claves: 'telegram celular bot mensaje', que: 'Le habla desde el celular por Telegram: texto, notas de voz, fotos, links y archivos. Lo que Mastropiero dice solo (el saludo, el cierre, cada banda de la run con botones) le llega por ahí. Comandos: /hoy /run /gasto /ingreso /nota /bitacora /buscar /criba /pregunta /voz.' },
  { area: 'Telegram · notas de voz', claves: 'audio voz nota de voz telegram hablar caminar', que: 'Sí: una nota de voz por Telegram se transcribe sola (Whisper). Si es un registro (una comida, un gasto, cuánto durmió, una práctica) se anota directo; si no, entra al chat de Hoy como si la hubiera escrito. Una nota larga (90 s o más) además queda guardada como pieza suya en el corpus, y de ahí salen recuerdos y side quests. Puede contestar en audio (ajuste de voz).' },
  { area: 'Telegram · fotos', claves: 'foto imagen comida ticket balanza telegram', que: 'Una foto (comida, ticket, la balanza, una página) se mira con visión y se registra donde corresponde, con «↩ Deshacer». Responder a ese mensaje lo corrige.' },
  { area: 'Links', claves: 'link url página web leer markdown md rastrear', que: 'Un link (por el chat o Telegram) se lee y se guarda en el corpus en Markdown limpio (GitHub, Wikipedia, Reddit, YouTube, X, PDF…); si es un sitio con índice, rastrea hasta 20 páginas y arma un cuaderno. Siempre se puede bajar el .md.' },
  { area: 'Hoy y el HUD', claves: 'hoy hud panel run quests agenda cuerpo stats oráculo', que: 'Hoy: el chat y un panel con seis modos (Run, Quests, Agenda, Cuerpo, Stats, Oráculo) y acciones rápidas (side quest, run, anotar, voto, foco).' },
  { area: 'Agenda', claves: 'agenda calendario eventos reunión google', que: 'Lee su Google Calendar (direcciones ICS en las variables del servicio): los eventos del día entran a la brújula, la matinal, el gemelo y las runs (reservan su hueco).' },
  { area: 'Runs y misiones', claves: 'run banda misión primaria secundaria side quest principal north star', que: 'Misión principal (la North Star, la fija él), primarias de la semana, runs con bandas (las arma con la liga y él las arranca), side quests, encargos a otros, reportes de la semana y ayudantes de la liga por primaria.' },
  { area: 'Salud', claves: 'salud comida calorías proteína sueño peso entreno', que: 'Comidas (kcal y macros estimados), entrenos, sueño y peso, con metas y alertas.' },
  { area: 'Plata', claves: 'plata finanzas gasto ingreso banco csv proyecto', que: 'Movimientos (a mano, por Telegram o desde el CSV del banco), meta del mes, plata por proyecto y ritmo para llegar.' },
  { area: 'Aprender', claves: 'aprender estudio idioma práctica repaso', que: 'Temas que aprende, prácticas anotadas y repaso espaciado (1, 3, 7 y 16 días).' },
  { area: 'Directo', claves: 'directo pantalla grabar informe', que: 'El Directo mira su pantalla y escucha mientras trabaja en la compu, y arma informes con propuestas para revisar.' },
  { area: 'Corpus', claves: 'corpus memoria buscar pieza fuente nivel ingerir', que: 'Todo lo que sabe, por la voz que habla (propia, primaria, investigación, generada), con búsqueda por significado, fuentes, entidades y quántomos.' },
  { area: 'Cargas', claves: 'cargar importar whatsapp instagram claude gemini correo csv pdf respaldo', que: 'Importa respaldos y fichas de Deprocast, chats de WhatsApp e Instagram, Claude, Gemini, correo (.mbox/.eml), CSV, PDF, texto y Markdown; cada carga se puede deshacer.' },
  { area: 'Google Takeout', claves: 'takeout gemini notebooklm google importar', que: 'El Takeout de Gemini y NotebookLM entra desde la compu con un comando; la nube transcribe, describe, destila (ideas, proyectos, personas, temas) y arma la historia de cada proyecto. Se sigue en Corpus → 🗂 Takeout.' },
  { area: 'Importar una carpeta', claves: 'carpeta documentos importar grokbot bot zip pdf', que: 'Una carpeta de documentos (la que arma un bot o uno mismo, por proyecto) entra con el mismo comando si tiene un .mastro-importar.json con sus reglas: el texto de md, PDF y Office se saca en la compu, las imágenes y audios se achican, lo repetido entra una vez; la nube lo destila igual que el Takeout.' },
  { area: 'Tandas', claves: 'tandas audios páginas cuaderno escaneado notas de voz muchas', que: 'Muchas notas de voz o páginas de cuadernos escaneados de una: se transcriben, se separan las voces y entran como suyas.' },
  { area: 'Cuadernos', claves: 'cuaderno notebooklm guía audio fuentes', que: 'Cuadernos como NotebookLM sobre su corpus: responden solo con sus fuentes, citando, con guía y charla en audio. Los crea él.' },
  { area: 'Librería', claves: 'librería libro obra leer lectura', que: 'Sus obras (libros, películas, papers) con estado de lectura y recomendaciones.' },
  { area: 'Radar', claves: 'radar oportunidades trabajo convocatoria', que: 'Oportunidades que busca afuera (convocatorias, trabajos, clientes) con borradores de respuesta.' },
  { area: 'Cuentas', claves: 'cuentas redes publicar posts', que: 'Sus cuentas para publicar: redacta publicaciones en cola (él las aprueba).' },
  { area: 'Taller', claves: 'taller crear juego video personaje', que: 'Crear cosas con la liga: juegos, videos, personajes, iterando.' },
  { area: 'Liga y agentes', claves: 'liga agente forjar encargo tick proyecto gerente', que: 'Los agentes de la liga: se forjan, toman encargos del bus, suben de nivel; cada proyecto tiene un gerente.' },
  { area: 'La Fragua', claves: 'fragua propuesta mejora código', que: 'Las propuestas de mejora (las suyas y las de la autocrítica nocturna) se forjan de noche como cambios de código para que él los revise y aplique.' },
  { area: 'Memoria', claves: 'memoria recuerdo corrección', que: 'Lo que Mastropiero sabe de él se escribe solo con lo que cuenta; él lo revisa y corrige. Sus correcciones mandan.' },
  { area: 'El gemelo', claves: 'gemelo predicción te conozco', que: 'Cada mañana predice su día y a la noche se califica («te conozco»); lo dudoso lo marca él en Hoy.' },
  { area: 'Rutinas', claves: 'rutina hora matinal cierre voto crónica gnosis', que: 'Rutinas con hora: autocrítica 02:30, fragua 03:00, lectura 04:00, audio matinal 07:50, voto 22:15, crónica 23:55, gnosis el domingo; en su hora local.' },
]

/** Las capacidades que tocan un tema (todas si no se dice cuál). */
export function capacidades(tema = ''): Capacidad[] {
  const t = tema.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!t.trim()) return CAPACIDADES
  const palabras = t.split(/\W+/).filter((w) => w.length > 2)
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const hits = CAPACIDADES.filter((c) => palabras.some((w) => norm(`${c.area} ${c.claves} ${c.que}`).includes(w)))
  return hits.length ? hits : CAPACIDADES
}
