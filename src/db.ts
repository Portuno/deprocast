/**
 * Persistencia local vía `node:sqlite` (igual que la 0.7.1: sin toolchain nativo en Windows).
 * Tablas: proyectos, agentes (el roster), lapidas (los retirados), tareas (EL BUS),
 * auditoria (input/decisión/output de cada corrida), llamadas (tokens por modelo), cronica (eventos de cada tick)
 * y el corpus: fuentes, cargas, corpus (piezas), quantomos y entidades.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export type Db = DatabaseSync

/** En Vercel el disco del proyecto es de solo lectura. Todo lo que se escribe va a /tmp. */
if (process.env.VERCEL) {
  const raiz = '/tmp/deprocast'
  fs.mkdirSync(raiz, { recursive: true })
  if (!(process.env.MASTRO_DB ?? '').trim()) process.env.MASTRO_DB = path.join(raiz, 'mastro.db')
  if (!(process.env.MASTRO_CARGAS ?? '').trim()) process.env.MASTRO_CARGAS = path.join(raiz, 'cargas')
  if (!(process.env.MASTRO_BITACORA ?? '').trim()) process.env.MASTRO_BITACORA = path.join(raiz, 'bitacora.md')
}

export function resolverRuta(): string {
  const raw = (process.env.MASTRO_DB ?? '').trim()
  return raw ? path.resolve(raw) : path.resolve(process.cwd(), 'data', 'mastro.db')
}

/** `:memory:` para tests. */
export function abrir(ruta: string = resolverRuta()): Db {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true })
  const db = new DatabaseSync(ruta)
  // WAL + synchronous NORMAL (seguro con WAL), 64 MB de caché, el archivo mapeado en memoria, lo temporal en RAM y
  // esperar un rato si otro proceso escribe (en vez de fallar al toque).
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -65536; PRAGMA mmap_size = 268435456; PRAGMA temp_store = MEMORY; PRAGMA busy_timeout = 5000;')
  db.exec(ESQUEMA)
  migrar(db)
  // Estadísticas para el planificador (solo donde hacen falta: es barato).
  try { db.exec('PRAGMA optimize = 0x10002') } catch { /* SQLite viejo */ }
  return db
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS proyectos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  creado_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentes (
  id TEXT PRIMARY KEY,                -- designación: GEN-0007
  clase TEXT NOT NULL,
  nombre TEXT,                        -- se gana en nivel 3
  xp INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL,               -- prueba | activo | banca
  creador TEXT NOT NULL,              -- operador | mastropiero | id de un gerente
  proyecto_id TEXT REFERENCES proyectos(id),
  celda INTEGER,                      -- 1..72, opcional
  motor TEXT NOT NULL,
  instrucciones TEXT NOT NULL,
  atributos TEXT NOT NULL,            -- JSON
  exitos INTEGER NOT NULL DEFAULT 0,
  fallos INTEGER NOT NULL DEFAULT 0,
  racha_fallos INTEGER NOT NULL DEFAULT 0,
  creado_en INTEGER NOT NULL,
  ultima_corrida INTEGER
);

CREATE TABLE IF NOT EXISTS lapidas (
  id TEXT PRIMARY KEY,
  clase TEXT NOT NULL,
  nombre TEXT,
  xp INTEGER NOT NULL,
  especializacion TEXT,
  causa TEXT NOT NULL,
  ficha TEXT NOT NULL,                -- JSON de la ficha al morir
  retirado_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  clase TEXT NOT NULL,                -- clase que la puede tomar
  proyecto_id TEXT REFERENCES proyectos(id),
  dominio TEXT,                       -- etiqueta libre; de acá sale la especialización
  payload TEXT NOT NULL,              -- JSON
  estado TEXT NOT NULL,               -- pendiente | asignada | hecha | fallida
  asignada_a TEXT,
  asignada_por TEXT,
  publicada_por TEXT NOT NULL,
  pipeline TEXT,
  etapa INTEGER,
  corpus_id INTEGER REFERENCES corpus(id),
  intentos INTEGER NOT NULL DEFAULT 0,
  resultado TEXT,
  error TEXT,
  creada_en INTEGER NOT NULL,
  actualizada_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tareas_estado ON tareas(estado, clase);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER,
  agente_id TEXT NOT NULL,
  input TEXT,
  decision TEXT,
  output TEXT,
  ok INTEGER NOT NULL,
  dominio TEXT,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auditoria_agente ON auditoria(agente_id);

CREATE TABLE IF NOT EXISTS llamadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  motor TEXT NOT NULL,
  modelo TEXT NOT NULL,
  clase TEXT,
  agente_id TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latencia_ms INTEGER,
  status INTEGER,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS llamadas_en ON llamadas(motor, en);

CREATE TABLE IF NOT EXISTS corpus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuente TEXT NOT NULL,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  estado TEXT NOT NULL,               -- crudo | extraido | clasificado | disponible
  datos TEXT,
  etiquetas TEXT,
  embedding TEXT,
  url TEXT,
  creado_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cronica (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fuentes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  nivel TEXT NOT NULL,                -- propia | primaria | investigacion | generada (por defecto de sus piezas)
  descripcion TEXT,
  padre_id TEXT REFERENCES fuentes(id),
  sistema INTEGER NOT NULL DEFAULT 0, -- las de fábrica no se borran
  creada_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cargas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  importador TEXT NOT NULL,
  archivo TEXT NOT NULL,
  ruta TEXT,                          -- copia del archivo subido en data/cargas/
  bytes INTEGER,
  fuente_id TEXT,
  analisis TEXT,                      -- JSON: segmentos detectados
  resumen TEXT,                       -- JSON: lo que efectivamente entró
  estado TEXT NOT NULL,               -- analizada | hecha | deshecha
  creada_en INTEGER NOT NULL,
  hecha_en INTEGER
);

CREATE TABLE IF NOT EXISTS entidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origen_id TEXT UNIQUE,
  tipo TEXT NOT NULL,                 -- persona | proyecto | agrupacion | dominio | lugar | concepto
  nombre TEXT NOT NULL,
  alias TEXT,                         -- JSON string[]
  notas TEXT,
  meta TEXT,
  carga_id INTEGER,
  creada_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entidades_nombre ON entidades(nombre COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS quantomos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origen_id TEXT UNIQUE,
  pieza_id INTEGER,
  titulo TEXT,
  texto TEXT NOT NULL,
  peso INTEGER,                       -- 1..12, la criba
  etapa TEXT NOT NULL,                -- proto | sellado | propuesta | superado | descartado
  version INTEGER NOT NULL DEFAULT 1,
  padre_id INTEGER,                   -- la versión que mejora
  universo TEXT,                      -- trinchera | campamento | castillo
  procedencia TEXT,
  l72 TEXT,                           -- JSON: celdas y sello de la 0.7.1, si vino
  facetas TEXT,                       -- JSON: haikus y otras caras
  tarea_id INTEGER,
  carga_id INTEGER,
  creado_en INTEGER NOT NULL,
  actualizado_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  con TEXT NOT NULL,                  -- mastropiero | id de un agente
  titulo TEXT,
  archivada INTEGER NOT NULL DEFAULT 0,
  creada_en INTEGER NOT NULL,
  actualizada_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacion_id INTEGER NOT NULL REFERENCES conversaciones(id),
  rol TEXT NOT NULL,                  -- operador | asistente | herramienta | error
  texto TEXT,
  llamadas TEXT,                      -- JSON: pedidos de herramienta del asistente
  llamada_id TEXT,                    -- a qué pedido responde una herramienta
  herramienta TEXT,
  resumen TEXT,                       -- una línea legible de lo que hizo la herramienta
  razonamiento TEXT,
  modelo TEXT,
  tokens INTEGER,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mensajes_conv ON mensajes(conversacion_id, id);

CREATE TABLE IF NOT EXISTS propuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  detalle TEXT NOT NULL,
  area TEXT,
  prioridad TEXT,                     -- alta | media | baja
  estado TEXT NOT NULL,               -- abierta | aceptada | descartada
  conversacion_id INTEGER,
  creada_en INTEGER NOT NULL,
  resuelta_en INTEGER
);

CREATE TABLE IF NOT EXISTS memoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  texto TEXT NOT NULL,
  tipo TEXT NOT NULL,                 -- hecho | meta | preferencia | sueño | vision | correccion
  horizonte TEXT,                     -- castillo | campamento | trinchera
  fecha TEXT NOT NULL,                -- YYYY-MM-DD de cuando se supo
  origen INTEGER,                     -- conversación de la que salió
  estado TEXT NOT NULL,               -- vigente | corregida | archivada
  revisada INTEGER NOT NULL DEFAULT 0,
  reemplaza INTEGER,                  -- la memoria que corrige
  creada_por TEXT NOT NULL,           -- escriba | mastropiero | operador
  creada_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memoria_estado ON memoria(estado, tipo);

CREATE TABLE IF NOT EXISTS jornadas (
  fecha TEXT PRIMARY KEY,             -- YYYY-MM-DD
  estado TEXT NOT NULL,               -- en_curso | cerrada
  bloques TEXT NOT NULL,              -- JSON
  resumen TEXT,
  cierre TEXT,
  pidio_cierre INTEGER NOT NULL DEFAULT 0,
  modelo TEXT,
  creada_en INTEGER NOT NULL,
  actualizada_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rutinas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  hora TEXT NOT NULL,                 -- HH:MM local
  dias TEXT NOT NULL,                 -- 0..6 (domingo = 0), ej. '0123456'
  accion TEXT NOT NULL,               -- jornada | cierre
  activa INTEGER NOT NULL DEFAULT 1,
  ultima_fecha TEXT                   -- YYYY-MM-DD de la última corrida
);

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Personajes: el jugador, Mastropiero, cada agente y cada entidad. Clave: jugador | mastropiero | agente:ID | entidad:N.
CREATE TABLE IF NOT EXISTS historias (
  personaje TEXT PRIMARY KEY,
  texto TEXT,                         -- trasfondo y origen, en prosa
  elementos TEXT,                     -- JSON string[]: rasgos y elementos base
  sugerencia TEXT,                    -- JSON {texto, elementos}: lo que propone Mastropiero, hasta que se acepta
  actualizada_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personaje TEXT NOT NULL,
  tipo TEXT NOT NULL,                 -- capital | conexion | presencia | conocimiento | herramienta | acceso | recurso
  nombre TEXT NOT NULL,
  detalle TEXT,
  valor REAL,                         -- plata, seguidores, horas…
  unidad TEXT,
  url TEXT,
  entidad_id INTEGER,                 -- una conexión apunta a su entidad
  estado TEXT NOT NULL,               -- sugerido | vigente | archivado
  fuente TEXT NOT NULL,               -- operador | escriba | mastropiero | carga
  creado_en INTEGER NOT NULL,
  actualizado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS inventario_personaje ON inventario(personaje, estado);

CREATE TABLE IF NOT EXISTS misiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personaje TEXT NOT NULL,            -- quien la hace
  asignada_por TEXT NOT NULL,         -- clave de personaje
  nivel TEXT NOT NULL,                -- principal | primaria | secundaria | terciaria
  padre_id INTEGER,                   -- árbol: secundaria → primaria → principal (puede cruzar personajes)
  titulo TEXT NOT NULL,
  detalle TEXT,                       -- la subdescripción
  categoria TEXT,
  entidad_id INTEGER,                 -- el proyecto o la persona de la que trata
  estado TEXT NOT NULL,               -- sugerida | activa | hecha | parcial | no | descartada
  progreso INTEGER NOT NULL DEFAULT 0,
  feedback TEXT,
  armado TEXT,                        -- secundarias: bien | mal. Cómo estuvo armada la banda, para calibrar la próxima
  semana TEXT,                        -- primarias: 2026-W41
  run_id INTEGER,                     -- secundarias
  inicio TEXT,                        -- secundarias: HH:MM
  fin TEXT,
  minutos INTEGER,
  fijada INTEGER NOT NULL DEFAULT 0,  -- secundarias: rehacer la conserva
  con TEXT,                           -- persona involucrada
  gasto REAL,                         -- si usa plata
  disparador TEXT,                    -- terciarias: JSON {lugar, zona, actividad, cuando}
  vence TEXT,                         -- YYYY-MM-DD
  orden INTEGER NOT NULL DEFAULT 0,
  creada_por TEXT NOT NULL,
  creada_en INTEGER NOT NULL,
  cerrada_en INTEGER
);
CREATE INDEX IF NOT EXISTS misiones_personaje ON misiones(personaje, nivel, estado);
CREATE INDEX IF NOT EXISTS misiones_run ON misiones(run_id);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  inicio TEXT NOT NULL,               -- HH:MM
  fin TEXT NOT NULL,
  estado TEXT NOT NULL,               -- propuesta | en_curso | cerrada | descartada
  pedido TEXT NOT NULL,               -- JSON: el pedido ya resuelto (plantilla + campos + texto)
  fijos TEXT,                         -- JSON: eventos del calendario que caen adentro
  agentes TEXT,                       -- JSON: quiénes ayudaron a armarla
  resumen TEXT,
  reporte TEXT,
  comentario TEXT,                    -- lo que el jugador dice de la run entera
  modelo TEXT,
  ultima_hora INTEGER NOT NULL DEFAULT 0,
  creada_en INTEGER NOT NULL,
  iniciada_en INTEGER,
  cerrada_en INTEGER
);

CREATE TABLE IF NOT EXISTS run_plantillas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  pedido TEXT NOT NULL,               -- JSON PedidoRun
  sistema INTEGER NOT NULL DEFAULT 0,
  creada_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preguntas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  texto TEXT NOT NULL,
  por_que TEXT,
  tipo TEXT NOT NULL,                 -- abierta | opciones | numero
  opciones TEXT,                      -- JSON string[]
  tema TEXT,
  estado TEXT NOT NULL,               -- pendiente | respondida | salteada
  respuesta TEXT,
  origen TEXT NOT NULL,               -- mastropiero | chat | agente
  creada_en INTEGER NOT NULL,
  respondida_en INTEGER
);

CREATE TABLE IF NOT EXISTS directo_sesiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inicio INTEGER NOT NULL,
  fin INTEGER,
  estado TEXT NOT NULL,               -- activa | cerrada
  fuentes TEXT,                       -- JSON: pantalla, voz, medio
  informe TEXT,
  resumen TEXT,                       -- JSON: métricas, ideas, tareas, consumido
  pieza_id INTEGER,
  ultimo INTEGER                      -- última señal del navegador
);

CREATE TABLE IF NOT EXISTS directo_momentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,                 -- pantalla | voz | medio
  desde INTEGER NOT NULL,
  hasta INTEGER NOT NULL,
  app TEXT,
  actividad TEXT,
  tema TEXT,
  detalle TEXT,
  nota TEXT,
  texto TEXT                          -- la transcripción (voz o medio)
);
CREATE INDEX IF NOT EXISTS directo_momentos_sesion ON directo_momentos(sesion_id, desde);

CREATE TABLE IF NOT EXISTS predicciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  texto TEXT NOT NULL,
  probabilidad REAL NOT NULL,         -- 0..1
  tipo TEXT,
  criterio TEXT,                      -- JSON: cómo se verifica solo (o null)
  resultado INTEGER,                  -- 1 pasó, 0 no pasó, null sin calificar
  estado TEXT NOT NULL,               -- abierta | calificada | para_el_jugador
  calificada_por TEXT,                -- datos | mastropiero | jugador
  nota TEXT,
  creada_en INTEGER NOT NULL,
  calificada_en INTEGER
);
CREATE INDEX IF NOT EXISTS predicciones_fecha ON predicciones(fecha);

CREATE TABLE IF NOT EXISTS cuotas (
  proveedor TEXT NOT NULL,            -- brave | tavily | duckduckgo
  mes TEXT NOT NULL,                  -- YYYY-MM
  usadas INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (proveedor, mes)
);

-- Oportunidades: lo que la liga encuentra afuera (comunidades, eventos, convocatorias, contactos, lugares para estar).
CREATE TABLE IF NOT EXISTS oportunidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  url TEXT,
  tipo TEXT,                          -- comunidad | evento | convocatoria | beca | premio | contacto | medio | otro
  descripcion TEXT,
  por_que TEXT,                       -- por qué encaja con él
  cierre TEXT,                        -- YYYY-MM-DD si tiene fecha límite
  mision_id INTEGER,                  -- la primaria para la que se buscó
  entidad_id INTEGER,
  borrador TEXT,                      -- mensaje o postulación redactada
  estado TEXT NOT NULL,               -- nueva | me_interesa | hecha | descartada
  origen TEXT NOT NULL,               -- radar | ayudante | chat
  creada_en INTEGER NOT NULL,
  actualizada_en INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS oportunidades_url ON oportunidades(url);

CREATE TABLE IF NOT EXISTS no_duplicados (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS artefactos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                 -- juego | imagen | voz | personaje | video | estudio
  titulo TEXT NOT NULL,
  pedido TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  padre_id INTEGER,                   -- la versión anterior
  archivos TEXT NOT NULL,             -- JSON: nombres dentro de data/taller/<id>/
  meta TEXT,                          -- JSON: prompt, modelo, voz, ficha…
  estado TEXT NOT NULL,               -- haciendo | listo | fallo
  progreso TEXT,
  creado_en INTEGER NOT NULL
);
-- La cola del Taller (plan v23): todo lo que se crea pasa por acá, de a uno (o dos) a la vez, para no saturar. Cada
-- trabajo deja su registro: de dónde vino, cuándo entró, empezó y terminó, cuántos tokens y el error si falló. La clave
-- (tipo + concepto + nivel + dominio) es la caché: un visual que ya existe no se vuelve a generar.
CREATE TABLE IF NOT EXISTS taller_cola (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                  -- crear | iterar | visual
  args TEXT NOT NULL,                  -- JSON: lo que se pidió
  titulo TEXT NOT NULL,
  artefacto_id INTEGER,
  prioridad INTEGER NOT NULL DEFAULT 5, -- más alto, antes
  clave TEXT,
  origen TEXT NOT NULL DEFAULT 'pantalla', -- pantalla | chat | tutor:<sesión>
  estado TEXT NOT NULL DEFAULT 'en_cola',  -- en_cola | haciendo | listo | fallo
  error TEXT,
  tokens INTEGER,
  encolado_en INTEGER NOT NULL,
  empezado_en INTEGER,
  terminado_en INTEGER
);
CREATE INDEX IF NOT EXISTS taller_cola_estado ON taller_cola(estado, prioridad, id);

CREATE TABLE IF NOT EXISTS cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  red TEXT NOT NULL,                  -- Instagram, X, Telegram, WhatsApp…
  nombre TEXT,                        -- nombre del agente de la cuenta (puede haber varios por red)
  usuario TEXT NOT NULL,
  correo TEXT,
  modo TEXT NOT NULL,                 -- lectura | redacta | libre
  conector TEXT,                      -- manual | telegram_canal
  reglas TEXT,                        -- JSON: temas, tono, horas, topeDia, chatId
  oficio TEXT,                        -- operador | creador
  cupos TEXT,                         -- JSON: cuántas publicaciones de cada tipo
  contexto TEXT,                      -- ruta del Markdown con el contexto del agente
  activa INTEGER NOT NULL DEFAULT 1,
  creada_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publicaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  tipo TEXT,                          -- el tipo de publicación (para los cupos)
  estado TEXT NOT NULL,               -- borrador | aprobada | publicada | descartada | fallo
  programada_para INTEGER,
  publicada_en INTEGER,
  url TEXT,
  origen TEXT NOT NULL,               -- mastropiero | operador | radar
  error TEXT,
  creada_en INTEGER NOT NULL
);

-- Tandas: notas de voz y páginas de cuadernos que entran de a muchas (cola de a una).
CREATE TABLE IF NOT EXISTS tandas (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,                      -- audio | pagina
  archivo TEXT NOT NULL,
  ruta TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  huella TEXT NOT NULL UNIQUE,
  fecha TEXT,                              -- YYYY-MM-DD[ HH:MM], del nombre o del archivo
  cuaderno TEXT,
  hoja INTEGER,
  estado TEXT NOT NULL,                    -- pendiente | procesando | hecha | fallo
  pieza_id INTEGER,
  error TEXT,
  creada_en INTEGER NOT NULL,
  hecha_en INTEGER
);

-- Google Takeout (Gemini y NotebookLM): un lote por exportación; los medios se escuchan o se miran y se borran,
-- cada pieza se destila (ideas, proyectos, personas, temas) y al final cada proyecto recibe su historia por eras.
CREATE TABLE IF NOT EXISTS takeout_lotes (
  id TEXT PRIMARY KEY,
  estado TEXT NOT NULL,                    -- subiendo | ingiriendo | procesando | historia | terminado | error
  resumen TEXT,                            -- JSON: lo que trajo y lo que va dejando
  error TEXT,
  creado_en INTEGER NOT NULL,
  subido_en INTEGER,
  terminado_en INTEGER
);
CREATE TABLE IF NOT EXISTS takeout_medios (
  huella TEXT PRIMARY KEY,                 -- sha1 del archivo original: el mismo archivo en varios lados entra una vez
  lote TEXT NOT NULL,
  clase TEXT NOT NULL,                     -- audio | imagen | documento
  ext TEXT NOT NULL,
  nombre TEXT NOT NULL,
  apariciones TEXT NOT NULL,               -- JSON: dónde apareció (chat o cuaderno, fecha, nivel)
  ruta TEXT,                               -- mientras espera; se borra al procesarlo
  estado TEXT NOT NULL,                    -- esperando | pendiente | procesando | hecho | fallo | salteado
  pieza_id INTEGER,
  intentos INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  creado_en INTEGER NOT NULL,
  hecho_en INTEGER
);
CREATE TABLE IF NOT EXISTS takeout_destilado (
  pieza_id INTEGER PRIMARY KEY,
  lote TEXT NOT NULL,
  prioridad INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL,                    -- pendiente | procesando | hecho | fallo
  intentos INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  salida TEXT,                             -- JSON del destilado (lo lee la historia de cada proyecto)
  hecho_en INTEGER
);
-- Cada vez que algo apareció (aunque el contenido sea el mismo): cuántas veces y cuándo se volvió a un tema.
CREATE TABLE IF NOT EXISTS takeout_apariciones (
  id INTEGER PRIMARY KEY,
  pieza_id INTEGER NOT NULL,
  origen TEXT NOT NULL,                    -- gemini | notebooklm
  contexto TEXT,                           -- el chat o el cuaderno
  titulo TEXT,
  fecha TEXT,
  UNIQUE (pieza_id, origen, contexto, fecha)
);
CREATE TABLE IF NOT EXISTS temas_pulso (
  id INTEGER PRIMARY KEY,
  clave TEXT NOT NULL,                     -- el tema normalizado
  tema TEXT NOT NULL,
  fecha TEXT,
  pieza_id INTEGER NOT NULL,
  origen TEXT,
  UNIQUE (clave, pieza_id)
);
-- Personas y proyectos que el destilado encontró y no estaban: esperan su ok (aceptar, fusionar con una que ya existe o descartar).
CREATE TABLE IF NOT EXISTS takeout_nombres (
  clave TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,                      -- persona | proyecto
  veces INTEGER NOT NULL DEFAULT 0,
  piezas TEXT NOT NULL DEFAULT '[]',
  primera TEXT,
  ultima TEXT,
  nota TEXT,
  estado TEXT NOT NULL DEFAULT 'propuesta', -- propuesta | aceptada | descartada
  entidad_id INTEGER,
  creada_en INTEGER NOT NULL
);

-- Su gente en sus proyectos: con qué rol y cuánto importa para ese proyecto (1–12).
CREATE TABLE IF NOT EXISTS persona_proyecto (
  persona_id INTEGER NOT NULL,
  proyecto_id INTEGER NOT NULL,
  rol TEXT,
  importancia INTEGER,
  notas TEXT,
  desde INTEGER NOT NULL,
  PRIMARY KEY (persona_id, proyecto_id)
);

-- Qué usa: vistas que abre, herramientas que corre Mastropiero por él, comandos de Telegram.
CREATE TABLE IF NOT EXISTS uso (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS uso_tipo ON uso(tipo, en);

-- Lo que él le corrigió a Mastropiero en una charla: manda en el prompt de esa charla (y lo duradero va a la memoria).
CREATE TABLE IF NOT EXISTS correcciones (
  id INTEGER PRIMARY KEY,
  conversacion_id INTEGER,
  texto TEXT NOT NULL,
  duradera INTEGER NOT NULL DEFAULT 0,
  en INTEGER NOT NULL
);

-- La brújula del día: el tridente Cuerpo · Mente · Alma.
CREATE TABLE IF NOT EXISTS brujulas (
  fecha TEXT PRIMARY KEY,
  cuerpo TEXT NOT NULL,
  mente TEXT NOT NULL,
  alma TEXT NOT NULL,
  foco TEXT NOT NULL,
  pregunta TEXT,
  datos TEXT,
  creada_en INTEGER NOT NULL
);

-- El Mentor: qué leer, ver o estudiar ahora, de la Librería.
CREATE TABLE IF NOT EXISTS mentor (
  id INTEGER PRIMARY KEY,
  obra_id INTEGER NOT NULL,
  por_que TEXT NOT NULL,
  accion TEXT NOT NULL,
  como TEXT NOT NULL,                      -- banda | side_quest
  minutos INTEGER,
  estado TEXT NOT NULL,                    -- sugerida | aceptada | descartada
  creada_en INTEGER NOT NULL,
  resuelta_en INTEGER
);

-- Puentes entre personas: presentar a dos, retomar con una.
CREATE TABLE IF NOT EXISTS puentes (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,                      -- presentar | retomar
  personas TEXT NOT NULL,                  -- JSON: ids de entidades
  clave TEXT NOT NULL,
  motivo TEXT NOT NULL,
  mensaje TEXT,
  estado TEXT NOT NULL,                    -- sugerido | hecho | descartado
  creado_en INTEGER NOT NULL,
  resuelto_en INTEGER
);

-- Librería: sus obras (libros, películas, series, videojuegos, papers, repos) como planillas.
CREATE TABLE IF NOT EXISTS obras (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  autor TEXT,
  anio INTEGER,
  estado TEXT NOT NULL DEFAULT 'quiero',   -- quiero | en_curso | terminado | abandonado | referencia
  valoracion INTEGER,                      -- 1..12, la escala de la criba
  url TEXT,
  notas TEXT,
  etiquetas TEXT,
  piezas TEXT,                             -- JSON: piezas del corpus donde aparece
  origen TEXT NOT NULL,                    -- operador | mastropiero
  revisada INTEGER NOT NULL DEFAULT 0,
  resumen TEXT,                            -- 2-3 oraciones, de su fuente
  expandida_en INTEGER,                    -- cuándo se trajo su fuente al corpus
  expansion TEXT,                          -- ok | sin fuente | fuente dudosa
  huella TEXT NOT NULL UNIQUE,
  creada_en INTEGER NOT NULL,
  editada_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS obras_tipo ON obras (tipo);
CREATE TABLE IF NOT EXISTS libreria_leidas (pieza_id INTEGER PRIMARY KEY, en INTEGER NOT NULL);

-- La Fragua: mejoras a la plataforma forjadas en su propia rama (fragua/<id>), aplicadas solo con su ok.
CREATE TABLE IF NOT EXISTS fragua (
  id INTEGER PRIMARY KEY,
  propuesta_id INTEGER,
  pedido TEXT NOT NULL,
  rama TEXT NOT NULL,
  estado TEXT NOT NULL,               -- haciendo | lista | rota | fallo | aplicada | descartada
  resumen TEXT,
  archivos TEXT,
  diff TEXT,
  salida TEXT,
  creada_en INTEGER NOT NULL,
  resuelta_en INTEGER
);

-- Economía de agentes: el monedero (asientos por temporada) y cómo terminó cada uno cada temporada.
CREATE TABLE IF NOT EXISTS monedero (
  id INTEGER PRIMARY KEY,
  agente_id TEXT NOT NULL,
  monto REAL NOT NULL,
  motivo TEXT NOT NULL,
  temporada TEXT NOT NULL,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS monedero_agente ON monedero (agente_id);
CREATE TABLE IF NOT EXISTS temporadas (
  semana TEXT NOT NULL,
  agente_id TEXT NOT NULL,
  neto REAL NOT NULL,
  estado_al_cierre TEXT NOT NULL,
  en INTEGER NOT NULL,
  PRIMARY KEY (semana, agente_id)
);

-- Cuadernos: fuentes elegidas del corpus y lo que se le preguntó (con citas).
CREATE TABLE IF NOT EXISTS cuadernos (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  creado_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cuaderno_fuentes (
  cuaderno_id INTEGER NOT NULL,
  pieza_id INTEGER NOT NULL,
  PRIMARY KEY (cuaderno_id, pieza_id)
);
CREATE TABLE IF NOT EXISTS cuaderno_notas (
  id INTEGER PRIMARY KEY,
  cuaderno_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,                 -- respuesta | guia | audio
  pregunta TEXT,
  texto TEXT NOT NULL,
  citas TEXT,
  artefacto_id INTEGER,
  creada_en INTEGER NOT NULL
);

-- Criba lúdica: cada peso que él puso (para el marcador y para deshacer).
CREATE TABLE IF NOT EXISTS criba (
  id INTEGER PRIMARY KEY,
  pieza_id INTEGER NOT NULL,
  peso INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  en INTEGER NOT NULL
);

-- Bitácora íntima: fuera del corpus; texto cifrado (v1:sal:iv:tag:datos) si cifrada = 1.
CREATE TABLE IF NOT EXISTS bitacora (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  texto TEXT NOT NULL,
  cifrada INTEGER NOT NULL DEFAULT 0,
  compartida INTEGER NOT NULL DEFAULT 0,
  animo INTEGER,
  creada_en INTEGER NOT NULL,
  editada_en INTEGER NOT NULL
);

-- Búsqueda por significado: un vector por pieza (Float32 normalizado), aparte de los de la liga.
CREATE TABLE IF NOT EXISTS vectores (
  pieza_id INTEGER PRIMARY KEY,
  modelo TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vec BLOB NOT NULL,
  en INTEGER NOT NULL
);

-- Personas: la relación con su gente (lo que él define; el resto se deduce).
CREATE TABLE IF NOT EXISTS relaciones (
  entidad_id INTEGER PRIMARY KEY,
  vinculo TEXT,
  cercania INTEGER,
  cada_dias INTEGER,
  proxima TEXT,
  notas TEXT,
  ultimo_contacto TEXT,
  actualizado_en INTEGER NOT NULL
);

-- Finanzas: sus movimientos (a mano, por chat o del CSV del banco). La huella evita repetir al reimportar.
CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'EUR',
  categoria TEXT NOT NULL DEFAULT 'otros',
  descripcion TEXT NOT NULL DEFAULT '',
  cuenta TEXT,
  origen TEXT NOT NULL DEFAULT 'manual',
  huella TEXT NOT NULL UNIQUE,
  creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS movimientos_fecha ON movimientos (fecha);

-- El reproceso: cada pieza en pasajes de ~1500 caracteres con su vector (la búsqueda por sentido ve todo el texto,
-- no solo el principio). 512 dimensiones (qwen3-embedding es matrioska), normalizado.
CREATE TABLE IF NOT EXISTS pasajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pieza_id INTEGER NOT NULL,
  orden INTEGER NOT NULL,
  desde INTEGER NOT NULL,                  -- posición en el contenido de la pieza
  hasta INTEGER NOT NULL,
  modelo TEXT NOT NULL,
  vec BLOB NOT NULL,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pasajes_pieza ON pasajes (pieza_id);
-- Vectores de lo que no es una pieza: recuerdos y quántomos.
CREATE TABLE IF NOT EXISTS vec_items (
  tipo TEXT NOT NULL,                      -- memoria | quantomo
  id INTEGER NOT NULL,
  modelo TEXT NOT NULL,
  vec BLOB NOT NULL,
  en INTEGER NOT NULL,
  PRIMARY KEY (tipo, id)
);
-- Lo que no se pudo reprocesar (tres intentos y se deja).
CREATE TABLE IF NOT EXISTS reproceso_fallos (
  pieza_id INTEGER NOT NULL,
  paso TEXT NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  PRIMARY KEY (pieza_id, paso)
);
-- Tarjetas de recuerdo activo (idiomas, lo que mira y lee, lo que estudia), con repaso espaciado SM-2.
-- mazo: «idioma:<aprendizaje>» | «consumo» | «aprender:<aprendizaje>». proxima: YYYY-MM-DD.
CREATE TABLE IF NOT EXISTS tarjetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mazo TEXT NOT NULL,
  frente TEXT NOT NULL,
  dorso TEXT NOT NULL,
  contexto TEXT,
  origen_tipo TEXT,
  origen_id INTEGER,
  facilidad REAL NOT NULL DEFAULT 2.5,
  intervalo INTEGER NOT NULL DEFAULT 0,
  repeticiones INTEGER NOT NULL DEFAULT 0,
  aciertos INTEGER NOT NULL DEFAULT 0,
  fallos INTEGER NOT NULL DEFAULT 0,
  proxima TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activa',
  creada_en INTEGER NOT NULL,
  ultima_en INTEGER,
  UNIQUE (mazo, frente)
);
CREATE INDEX IF NOT EXISTS tarjetas_proxima ON tarjetas(estado, proxima);
-- Un idioma que aprende: su aprendizaje, el código (Whisper, voces), el nivel y su práctica diaria.
CREATE TABLE IF NOT EXISTS idiomas (
  aprendizaje_id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  nivel TEXT,
  objetivo TEXT,
  minutos_dia INTEGER NOT NULL DEFAULT 15,
  hora TEXT,
  charla TEXT,
  ultimo_envio TEXT,
  temario TEXT,                       -- JSON: los temas en orden (se arma una vez, con su para qué y su nivel)
  tema_idx INTEGER NOT NULL DEFAULT 0, -- por dónde va
  sobre_mi TEXT,                      -- una línea para personalizar (nombre, ciudad); nunca sus proyectos
  intereses TEXT,                     -- temas que le interesan para practicar
  creado_en INTEGER NOT NULL
);
-- Las sesiones de práctica, preparadas antes de abrirlas: el paquete entero (tema, palabras, frases, la pregunta,
-- respuestas sugeridas, cada cosa con texto, romanización, cómo suena, traducción y su audio).
CREATE TABLE IF NOT EXISTS idioma_sesiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aprendizaje_id INTEGER NOT NULL,
  tema TEXT NOT NULL,
  paquete TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'lista', -- lista | en_curso | hecha
  pieza_id INTEGER,
  creada_en INTEGER NOT NULL,
  empezada_en INTEGER,
  cerrada_en INTEGER
);
CREATE INDEX IF NOT EXISTS idioma_sesiones_ap ON idioma_sesiones(aprendizaje_id, estado);
-- Cada vuelta de la práctica de un idioma: lo que preguntó Mastropiero, lo que contestó él y la corrección.
CREATE TABLE IF NOT EXISTS idioma_turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aprendizaje_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  pregunta TEXT,
  respuesta TEXT,
  por_voz INTEGER NOT NULL DEFAULT 0,
  devolucion TEXT,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idioma_turnos_ap ON idioma_turnos(aprendizaje_id, en);
-- La Mano: cada carta jugada (un quántomo pesado, descartado o marcado «choca con lo que ya sabía»), con su por qué
-- y cómo estaba antes (para deshacer).
CREATE TABLE IF NOT EXISTS mano_jugadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quantomo_id INTEGER NOT NULL,
  gesto TEXT NOT NULL,                -- peso | descartar | choca
  peso INTEGER,
  porque TEXT,
  etapa_antes TEXT,
  peso_antes INTEGER,
  deshecha INTEGER NOT NULL DEFAULT 0,
  pesquisa_id INTEGER,
  prediccion REAL,                    -- si predijo antes de ver: la probabilidad de que conectara
  resultado INTEGER,                  -- 1 si conectó con algo que ya sabía
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mano_jugadas_en ON mano_jugadas(en);
-- La Pesquisa: una pregunta, de 3 a 5 manos sobre ella, una síntesis y una decisión; cierra con elegir la próxima.
CREATE TABLE IF NOT EXISTS pesquisas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pregunta TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'libre', -- libre | bucle | pregunta | hipotesis
  origen_id INTEGER,
  fuentes TEXT,                       -- JSON: de qué fuentes se roba (vacío = de todas)
  jokers TEXT,                        -- JSON: ids del consejo de modelos (hasta 3)
  estado TEXT NOT NULL DEFAULT 'abierta', -- abierta | cerrada
  decision TEXT,                      -- ya | agendar | soltar (si salió de un bucle)
  sintesis TEXT,                      -- JSON: hipótesis, lo que faltó, lo que dijo cada joker, el abogado del diablo
  siguiente TEXT,                     -- JSON: las tres preguntas para elegir la próxima
  creada_en INTEGER NOT NULL,
  cerrada_en INTEGER
);
-- Las sorpresas de La Mano (lo que no podía predecir), con lo que él hizo con cada una: puente no obvio (real | casualidad),
-- la creencia que se cae (actualizo | sostengo | pruebo) y el combo con su hipótesis (real | casualidad).
CREATE TABLE IF NOT EXISTS mano_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                 -- puente | contradiccion | combo
  jugada_id INTEGER,
  quantomo_id INTEGER NOT NULL,       -- la carta que lo destapó
  otro_id INTEGER,                    -- puente/contradicción: el otro; combo: la hipótesis (cuando llega)
  ids TEXT NOT NULL,                  -- JSON: todas las cartas que entran
  sim REAL,
  texto TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  datos TEXT,                         -- JSON: su por qué, cómo estaba antes, la side quest
  creado_en INTEGER NOT NULL,
  respondido_en INTEGER
);
CREATE INDEX IF NOT EXISTS mano_eventos_estado ON mano_eventos(estado, id);
CREATE INDEX IF NOT EXISTS mano_eventos_tipo ON mano_eventos(tipo, creado_en);
-- Los bloques de foco guiados («arranco 25 minutos»): lo que dijo, lo que estaba haciendo al arrancar (la referencia del
-- tema), el Directo y la banda de su run si había, si ya le avisó que se fue del tema, y al cerrar cuánto sostuvo.
CREATE TABLE IF NOT EXISTS bloques_foco (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inicio INTEGER NOT NULL,
  minutos INTEGER NOT NULL,
  tema TEXT,
  referencia TEXT,                    -- app|tema normalizados
  sesion_id INTEGER,
  mision_id INTEGER,
  avisado INTEGER NOT NULL DEFAULT 0,
  fin INTEGER,
  sostenido INTEGER                   -- minutos en el tema (null sin Directo)
);
-- Las piezas que ya dejaron sus tarjetas (lo que miró o leyó): una vez cada una, aunque no haya salido ninguna.
CREATE TABLE IF NOT EXISTS tarjetas_piezas (
  pieza_id INTEGER PRIMARY KEY,
  tarjetas INTEGER NOT NULL DEFAULT 0,
  en INTEGER NOT NULL
);
-- Lo que sigue volviendo: lo abierto que aparece una y otra vez (en los destilados, las side quests quietas), juntado por
-- sentido, con cuántas veces volvió y desde cuándo. Termina de tres formas: cerrado ya, agendado o soltado.
CREATE TABLE IF NOT EXISTS bucles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  texto TEXT NOT NULL,
  clave TEXT NOT NULL,
  veces INTEGER NOT NULL DEFAULT 1,
  primera TEXT,                       -- YYYY-MM-DD
  ultima TEXT,
  fuentes TEXT,                       -- JSON [{origen, fecha, texto}] (las últimas 12)
  vec BLOB,
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | cerrado | agendado | soltado
  motivo TEXT,
  mision_id INTEGER,
  cerrado_en INTEGER,
  creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bucles_estado ON bucles(estado);
CREATE INDEX IF NOT EXISTS bucles_clave ON bucles(clave);
-- Arranque al 20 %: lo que ya hizo hacia algo nuevo (una primaria, un aprendizaje, una meta), encontrado en su corpus.
CREATE TABLE IF NOT EXISTS previos (
  tipo TEXT NOT NULL,                 -- mision | aprendizaje | meta
  ref_id INTEGER NOT NULL,
  pieza_id INTEGER NOT NULL,
  titulo TEXT,
  fecha TEXT,
  fragmento TEXT,
  en INTEGER NOT NULL,
  PRIMARY KEY (tipo, ref_id, pieza_id)
);
CREATE TABLE IF NOT EXISTS previos_buscados (
  tipo TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  en INTEGER NOT NULL,
  PRIMARY KEY (tipo, ref_id)
);
-- El libro de evidencia: quién quiere ser (1 a 3 frases), su historia vieja y lo que lo ata a los hechos.
CREATE TABLE IF NOT EXISTS identidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frase TEXT NOT NULL,
  historia_vieja TEXT,
  ataduras TEXT NOT NULL DEFAULT '{}', -- JSON {primarias: [id], aprendizajes: [id], categorias: [str], palabras: [str]}
  estado TEXT NOT NULL DEFAULT 'activa', -- activa | archivada
  creada_en INTEGER NOT NULL
);
-- Lo que él anota a mano como evidencia (lo demás se cuenta solo de bandas, hábitos, misiones y prácticas).
CREATE TABLE IF NOT EXISTS evidencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identidad_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  fecha TEXT NOT NULL,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS evidencias_identidad ON evidencias(identidad_id, fecha);
-- Los sueños: entran por Telegram, a mano o por una app conectada (Morpheon). El audio se transcribe y se borra.
CREATE TABLE IF NOT EXISTS suenos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pieza_id INTEGER,
  fecha TEXT NOT NULL,                -- el día en que se despertó
  texto TEXT NOT NULL,
  despertar TEXT,                     -- HH:MM
  duracion_min INTEGER,
  lucido INTEGER,
  emociones TEXT,                     -- JSON [string] (las que dijo él)
  nota TEXT,
  origen TEXT NOT NULL,               -- telegram | manual | app:<nombre>
  destilado TEXT,                     -- JSON {titulo, escenas, personas, simbolos, emociones, lucido, fuente, cruce}
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | destilado | fallo
  creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS suenos_fecha ON suenos(fecha);
-- Las apps que le hablan a Deprocast (Morpheon y las que vengan): el token se ve una vez; acá queda su hash.
CREATE TABLE IF NOT EXISTS apps_conectadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  prefijo TEXT NOT NULL,              -- los primeros caracteres del token (para encontrarlo y reconocerlo)
  token_hash TEXT NOT NULL,
  permisos TEXT NOT NULL,             -- JSON [suenos, eventos]
  creada_en INTEGER NOT NULL,
  ultima_vez INTEGER,
  usos INTEGER NOT NULL DEFAULT 0,
  revocada_en INTEGER
);
-- Discovery para clientes (transformación con IA): un encargo por cliente y área, sus áreas puntuadas, los logs
-- analizados (solo el análisis: el CSV no se guarda), los procesos (as-is, to-be, KPIs) y los casos en sombra.
CREATE TABLE IF NOT EXISTS encargos_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cliente_id INTEGER NOT NULL,        -- la entidad (agrupación) del cliente
  proyecto_id INTEGER,                -- la entidad proyecto del encargo
  departamento TEXT,                  -- por dónde se empieza
  estado TEXT NOT NULL DEFAULT 'discovery', -- discovery | diseño | sombra | vivo | cerrado
  notas TEXT,
  creado_en INTEGER NOT NULL,
  actualizado_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS encargo_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encargo_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  volumen_mes REAL,                   -- cuántas veces corren sus procesos por mes
  costo_mes REAL,                     -- lo que cuesta el área por mes (lo tiene el CFO)
  alcance INTEGER,                    -- cuántas áreas tocan sus procesos
  notas TEXT,
  UNIQUE (encargo_id, nombre)
);
CREATE TABLE IF NOT EXISTS encargo_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encargo_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  area TEXT,
  analisis TEXT NOT NULL,             -- JSON (discovery-logs.ts)
  en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS procesos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ambito TEXT NOT NULL,               -- yo | encargo:<id>
  nombre TEXT NOT NULL,
  area TEXT,
  pasos_asis TEXT,                    -- JSON [{n, paso, area, sistema, quien, minutos, frecuencia, excepciones, fuente, en_la_doc}]
  pasos_tobe TEXT,                    -- JSON [{n, destino: borrar|codigo|agente|persona, por_que, regla}]
  kpis TEXT,                          -- JSON [{categoria: tiempo_costo|ingresos|riesgo, nombre, linea_base, objetivo, unidad, medido_en}]
  documentados INTEGER,               -- cuántos pasos decía la documentación
  creado_en INTEGER NOT NULL,
  actualizado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS procesos_ambito ON procesos(ambito);
CREATE TABLE IF NOT EXISTS sombra_casos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encargo_id INTEGER NOT NULL,
  proceso_id INTEGER,
  caso TEXT,
  regla TEXT NOT NULL,                -- la regla o el tipo de caso del agente
  propuesta TEXT,                     -- lo que propuso el agente
  real TEXT,                          -- lo que hizo la persona
  coincide INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sombra_casos_encargo ON sombra_casos(encargo_id, regla, fecha);
-- Los minutos que cada champion del cliente dice que ahorró con IA (el tablero: minutos, no tokens).
CREATE TABLE IF NOT EXISTS champion_ahorros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encargo_id INTEGER NOT NULL,
  persona_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  minutos INTEGER NOT NULL,
  que TEXT,
  en INTEGER NOT NULL
);
-- El libro de decisiones: lo que Mastropiero propuso y qué se decidió (o si lo hizo solo). La base del modo sombra.
CREATE TABLE IF NOT EXISTS decisiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                 -- captura | monto | inventario | recuerdo | directo:<tipo> | side_quest | primaria | nombre | quantomo | propuesta
  ref TEXT NOT NULL,                  -- qué cosa (id o clave)
  accion TEXT NOT NULL,               -- aceptada | editada | rechazada | deshecha | auto
  cambios TEXT,                       -- JSON: qué cambió él, o qué hizo solo (texto)
  deshacer TEXT,                      -- JSON: cómo deshacer lo que hizo solo
  confianza REAL,
  en INTEGER NOT NULL,
  deshecha_en INTEGER
);
CREATE INDEX IF NOT EXISTS decisiones_tipo ON decisiones(tipo, id);
CREATE INDEX IF NOT EXISTS decisiones_auto ON decisiones(accion, en);
-- Cada mención ya contada (abierto:<pieza>:<i>, mision:<id>): así no suma dos veces.
CREATE TABLE IF NOT EXISTS bucles_vistos (
  origen TEXT PRIMARY KEY,
  bucle_id INTEGER,
  en INTEGER NOT NULL
);
-- Lo que Deprocast llevó a su Google Calendar (una oportunidad, un evento de la Línea, una misión): así no se duplica y
-- un cambio de fecha acá se edita allá.
CREATE TABLE IF NOT EXISTS calendario_vinculos (
  origen TEXT NOT NULL,
  origen_id INTEGER NOT NULL,
  google_id TEXT NOT NULL,
  creado_en INTEGER NOT NULL,
  PRIMARY KEY (origen, origen_id)
);
-- Lugares ya buscados en el mapa (OpenStreetMap): una vez cada texto, también los que no se encontraron.
CREATE TABLE IF NOT EXISTS geocache (
  clave TEXT PRIMARY KEY,
  texto TEXT NOT NULL,
  lat REAL,
  lon REAL,
  nombre TEXT,
  buscado_en INTEGER NOT NULL
);
-- YouTube: videos y canales por leer. La nube no puede (YouTube la marca como bot): los lee el servicio de
-- transcripciones o la compu. estado: pendiente | compu (espera a la compu) | listo | sin_subtitulos | fallo.
CREATE TABLE IF NOT EXISTS youtube_cola (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  url TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  motivo TEXT,
  intentos INTEGER NOT NULL DEFAULT 0,
  pieza_id INTEGER,
  de TEXT,
  max_videos INTEGER,
  creado_en INTEGER NOT NULL,
  leido_en INTEGER
);
-- La crónica de un mes que no salió: a los 3 intentos se deja, hasta que el mes tenga material nuevo.
CREATE TABLE IF NOT EXISTS cronica_fallos (
  mes TEXT PRIMARY KEY,
  intentos INTEGER NOT NULL DEFAULT 0,
  piezas INTEGER NOT NULL DEFAULT 0,
  largo INTEGER,
  huella TEXT,
  error TEXT,
  ultimo_en INTEGER
);
-- La línea temporal: lo que pasó o va a pasar según cada pieza, con la fecha resuelta contra la de la pieza.
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pieza_id INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  fecha TEXT,                              -- YYYY-MM-DD o YYYY-MM
  precision TEXT NOT NULL DEFAULT 'dia',   -- dia | mes
  hora TEXT,
  fin TEXT,                                -- hasta qué hora (una grabación)
  tipo TEXT NOT NULL,                      -- pasado | futuro | grabacion
  lugar TEXT,
  lugar_id INTEGER,
  personas TEXT,                           -- JSON [{nombre, id}]
  confianza REAL,
  estado TEXT NOT NULL DEFAULT 'visto',    -- visto | agendado | descartado
  huella TEXT NOT NULL UNIQUE,
  creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS eventos_fecha ON eventos (fecha);
CREATE INDEX IF NOT EXISTS eventos_pieza ON eventos (pieza_id);

-- Plantillas del Estudio (el kit de marca de un proyecto): capas que se aplican a cualquier video.
CREATE TABLE IF NOT EXISTS plantillas_estudio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  entidad_id INTEGER,                      -- el proyecto de quien es la marca (opcional)
  marca TEXT,                              -- colores, tipografía, tono: lo que el agente tiene que respetar
  capas TEXT NOT NULL,                     -- JSON
  creada_en INTEGER NOT NULL
);

-- Montos que contó charlando («me pagaron 800», «gasté 40 en…»): esperan su ok para entrar a Finanzas.
CREATE TABLE IF NOT EXISTS movimientos_sugeridos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'EUR',
  descripcion TEXT NOT NULL,
  dicho TEXT,                          -- la frase de donde salió
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aceptado | descartado
  movimiento_id INTEGER,
  creado_en INTEGER NOT NULL
);

-- Conexiones entre entidades (se conocen, trabajan juntos, le debe algo): de lo que se dice o se ve en el Directo.
CREATE TABLE IF NOT EXISTS conexiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  relacion TEXT,
  nota TEXT,
  origen TEXT,
  creada_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conexiones_a ON conexiones (a);
CREATE INDEX IF NOT EXISTS conexiones_b ON conexiones (b);

-- El resumen de lo viejo de una conversación larga (elisión por etapas). No es parte de la conversación: es lo que
-- ve el modelo en lugar de los mensajes que cubre. Se recuerda para no rehacerlo en cada turno.
CREATE TABLE IF NOT EXISTS chat_resumenes (
  conversacion_id INTEGER PRIMARY KEY,
  hasta_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alertas (
  clave TEXT PRIMARY KEY,             -- tipo:id:fecha (una por día)
  texto TEXT NOT NULL,
  en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reportes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                 -- hora | run | semana
  personaje TEXT NOT NULL,
  desde INTEGER NOT NULL,
  hasta INTEGER NOT NULL,
  run_id INTEGER,
  texto TEXT NOT NULL,
  metricas TEXT,                      -- JSON
  pieza_id INTEGER,
  creado_en INTEGER NOT NULL
);

-- Salud: lo que come, el ejercicio, el sueño y las medidas (peso). Entra por foto o texto (Telegram, chat, pantalla).
CREATE TABLE IF NOT EXISTS salud (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,                -- YYYY-MM-DD (el sueño: el día en que se despertó)
  hora TEXT,                          -- HH:MM
  tipo TEXT NOT NULL,                 -- comida | ejercicio | sueno | medida | sintoma | otro
  titulo TEXT NOT NULL,
  datos TEXT NOT NULL DEFAULT '{}',   -- JSON: kcal, proteina, carbos, grasa, minutos, intensidad, distancia_km, horas, calidad, peso…
  foto TEXT,                          -- /adjuntos/<archivo>
  fuente TEXT NOT NULL DEFAULT 'manual',
  creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS salud_fecha ON salud(fecha, tipo);

-- Lo que quiere aprender (temas o habilidades) y lo que practica de cada uno.
CREATE TABLE IF NOT EXISTS aprendizajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tema TEXT NOT NULL UNIQUE,
  por_que TEXT,
  nivel_actual TEXT,
  nivel_objetivo TEXT,
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | pausado | logrado | sugerido (lo propuso la Academia) | descartado
  frente_id TEXT,
  creado_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS practicas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aprendizaje_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  minutos INTEGER,
  que TEXT,
  notas TEXT,
  fuente TEXT NOT NULL DEFAULT 'manual',
  creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS practicas_aprendizaje ON practicas(aprendizaje_id, fecha);
-- La Academia (plan v23): cada dominio con su tutor de seis niveles. Una sesión es una clase (explicación, ejemplos,
-- preguntas y el visual que le sirve) o un examen para subir de nivel; los turnos son sus respuestas con la devolución.
CREATE TABLE IF NOT EXISTS tutor_sesiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aprendizaje_id INTEGER NOT NULL,
  nivel INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'clase',  -- clase | examen
  tema TEXT NOT NULL,
  paquete TEXT NOT NULL,               -- JSON: explicación, ejemplos, preguntas, ideas, tarjetas, visual
  estado TEXT NOT NULL DEFAULT 'lista', -- lista | en_curso | hecha
  puntaje REAL,
  pieza_id INTEGER,
  visual_id INTEGER,                   -- el artefacto del Taller que la acompaña
  creada_en INTEGER NOT NULL,
  empezada_en INTEGER,
  cerrada_en INTEGER
);
CREATE INDEX IF NOT EXISTS tutor_sesiones_ap ON tutor_sesiones(aprendizaje_id, estado);
CREATE TABLE IF NOT EXISTS tutor_turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id INTEGER NOT NULL,
  i INTEGER NOT NULL,                  -- qué pregunta del paquete
  respuesta TEXT NOT NULL,
  correcto INTEGER NOT NULL DEFAULT 0,
  devolucion TEXT,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tutor_turnos_sesion ON tutor_turnos(sesion_id, i);

-- Lo que se rompió (errores del servidor, rutas que no existen): la materia de la autocrítica. Uno por texto y día.
CREATE TABLE IF NOT EXISTS errores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origen TEXT NOT NULL,               -- servidor | ruta | rutina
  texto TEXT NOT NULL,
  veces INTEGER NOT NULL DEFAULT 1,
  primera INTEGER NOT NULL,
  ultima INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS errores_ultima ON errores(ultima);

CREATE INDEX IF NOT EXISTS quantomos_pieza ON quantomos(pieza_id);
CREATE INDEX IF NOT EXISTS quantomos_etapa ON quantomos(etapa);
`

/** Columnas que se sumaron después de la primera versión: se agregan sin tocar los datos. */
const COLUMNAS_NUEVAS: Record<string, [string, string][]> = {
  // El radar con lugar y fecha (para el mapa y el calendario): fecha/fecha_fin son las del evento; cierre, la fecha límite.
  oportunidades: [['lugar', 'TEXT'], ['online', 'INTEGER'], ['lat', 'REAL'], ['lon', 'REAL'], ['fecha', 'TEXT'], ['fecha_fin', 'TEXT'], ['ubicada', 'INTEGER']],
  corpus: [
    ['nivel', 'TEXT'],
    ['tipo', "TEXT NOT NULL DEFAULT 'materia'"], // materia | referencia | ficha | lista | enlace
    ['origen_id', 'TEXT'],
    ['autor', 'TEXT'],
    ['fecha', 'TEXT'],
    ['peso', 'INTEGER'],
    ['entidades', 'TEXT'], // JSON number[] → entidades.id
    ['meta', 'TEXT'],
    ['carga_id', 'INTEGER'],
  ],
  conversaciones: [
    ['modo', "TEXT NOT NULL DEFAULT 'chat'"], // chat | hoy | diario
  ],
  // ¿Idea nueva o repetida? Contra los quántomos de antes, por sentido.
  quantomos: [['novedad', 'TEXT'], ['novedad_de', 'INTEGER'], ['novedad_sim', 'REAL']],
  // La Mano: a qué Pesquisa pertenece cada jugada (si había una abierta).
  mano_jugadas: [['pesquisa_id', 'INTEGER'], ['prediccion', 'REAL'], ['resultado', 'INTEGER']],
  // Idiomas por sesiones: el temario, lo personal mínimo y a qué sesión pertenece cada vuelta.
  idiomas: [['temario', 'TEXT'], ['tema_idx', 'INTEGER NOT NULL DEFAULT 0'], ['sobre_mi', 'TEXT'], ['intereses', 'TEXT']],
  // La Academia: el nivel del tutor (1 niño de 10 … 6 frontera), el temario de cada nivel, por dónde va, la sugerencia
  // que lo trajo (por qué, horizonte, para qué evento) y cuándo se buscaron fuentes por última vez.
  aprendizajes: [['tutor_nivel', 'INTEGER NOT NULL DEFAULT 1'], ['temario', 'TEXT'], ['tema_idx', 'INTEGER NOT NULL DEFAULT 0'], ['sugerencia', 'TEXT'], ['fuentes_en', 'INTEGER']],
  idioma_turnos: [['sesion_id', 'INTEGER']],
  misiones: [
    ['armado', 'TEXT'], // bien | mal: si la banda estuvo bien armada
    ['progreso_manual', 'INTEGER'], // 1 = el % lo fijó él; si no, el avance de una primaria se infiere de lo hecho
  ],
  mensajes: [
    ['deshacer', 'TEXT'], // JSON: cómo volver atrás lo que escribió esa herramienta (si se puede)
    ['deshecho_en', 'INTEGER'],
    ['numero', 'INTEGER'], // el número de mensaje dentro de su conversación (1, 2, 3…)
    ['lugar', 'TEXT'], // dónde ocurrió: hoy | diario | chat | agente:<id>
    ['via', 'TEXT'], // cómo llegó: voz (dicho o escuchado) | copiloto | null (escrito)
  ],
  runs: [
    ['comentario', 'TEXT'], // lo que dijo de la run entera
  ],
  cuentas: [
    ['nombre', 'TEXT'], ['correo', 'TEXT'], ['oficio', 'TEXT'], ['cupos', 'TEXT'], ['contexto', 'TEXT'],
  ],
  publicaciones: [
    ['tipo', 'TEXT'],
    ['adjunto', 'TEXT'], // un archivo que va con la publicación (el video del Estudio)
  ],
  obras: [
    ['resumen', 'TEXT'], ['expandida_en', 'INTEGER'], ['expansion', 'TEXT'],
  ],
  memoria: [
    ['pieza_id', 'INTEGER'], // la pieza del corpus de la que salió, si salió de una
  ],
  llamadas: [
    ['fondo', 'INTEGER'], // 1 = la hizo algo que corre solo (una rutina): cuenta para el tope diario
  ],
  propuestas: [
    ['origen', 'TEXT'], // chat | autocritica
  ],
  proyectos: [
    ['entidad_id', 'INTEGER'], // la entidad tipo proyecto (el espacio de proyecto los junta)
  ],
  relaciones: [
    ['clase', 'TEXT'], // fisica | juridica | ficticia (vacío: según el tipo de la entidad)
    ['estado', 'TEXT'], // conocida | contactada | por_conocer
    ['nivel', 'INTEGER'], // nivel de contacto 1–12: cuánto la conoce
    ['importancia', 'INTEGER'], // importancia en su vida 1–12
  ],
  preguntas: [
    ['vuelve_en', 'INTEGER'], // repaso espaciado: no se muestra antes de esto
    ['repaso', 'INTEGER'], // en qué vuelta del repaso va (0 = la primera)
  ],
  movimientos: [
    ['entidad_id', 'INTEGER'], // el proyecto (o la persona) al que pertenece: cuánto deja o cuesta cada cosa suya
    ['mision_id', 'INTEGER'],
    ['foto', 'TEXT'], // el ticket, si entró por foto
    ['nota', 'TEXT'],
  ],
}

/** Rutinas y ajustes de fábrica: horarios editables, nada del operador. */
const RUTINAS_SISTEMA = [
  { id: 'jornada', nombre: 'Saludo del día', hora: '08:30', dias: '0123456', accion: 'jornada' },
  { id: 'cierre', nombre: 'Cierre del día', hora: '22:30', dias: '0123456', accion: 'cierre' },
  { id: 'semana', nombre: 'Proponer las primarias de la semana', hora: '08:00', dias: '1', accion: 'semana' },
  { id: 'ayudantes', nombre: 'Aportes de los ayudantes', hora: '07:45', dias: '0123456', accion: 'ayudantes' },
  { id: 'prediccion', nombre: 'El gemelo predice el día', hora: '08:20', dias: '0123456', accion: 'prediccion' },
  { id: 'radar', nombre: 'El radar sale a buscar oportunidades', hora: '09:30', dias: '14', accion: 'radar' },
  { id: 'calificacion', nombre: 'El gemelo se califica', hora: '23:40', dias: '0123456', accion: 'calificacion' },
  { id: 'reporte_semanal', nombre: 'Reporte de la semana', hora: '21:00', dias: '0', accion: 'reporte_semanal' },
  { id: 'evidencia', nombre: 'Tu evidencia de la semana contra tu historia vieja', hora: '19:30', dias: '0', accion: 'evidencia' },
  { id: 'modelos', nombre: 'Tu vara contra la de tus modelos', hora: '19:40', dias: '0', accion: 'modelos' },
  { id: 'mis_procesos', nombre: 'El discovery de tu semana: tus procesos más caros y qué borrar o automatizar', hora: '18:00', dias: '6', accion: 'mis_procesos' },
  { id: 'bandeja', nombre: 'Para decidir: lo que espera tu ok y lo que hice solo', hora: '21:30', dias: '0123456', accion: 'bandeja' },
  { id: 'mano', nombre: 'La Mano: aviso solo si llegó algo nuevo de verdad', hora: '19:00', dias: '0123456', accion: 'mano' },
  { id: 'creencias', nombre: 'Creencias: ¿descubiertas o heredadas? (una vez por mes)', hora: '17:00', dias: '0', accion: 'creencias' },
  { id: 'brujula', nombre: 'La brújula del día', hora: '08:10', dias: '0123456', accion: 'brujula' },
  { id: 'academia', nombre: 'La Academia propone qué te conviene aprender', hora: '08:15', dias: '1', accion: 'academia' },
  { id: 'mentor', nombre: 'El Mentor recomienda qué leer o ver', hora: '08:05', dias: '1', accion: 'mentor' },
  { id: 'puentes', nombre: 'Puentes con tu gente', hora: '11:00', dias: '0', accion: 'puentes' },
  { id: 'temporada', nombre: 'Cierre de temporada de la liga', hora: '07:30', dias: '1', accion: 'temporada' },
  { id: 'destilar', nombre: 'Destilar unas piezas tuyas en espera', hora: '10:15', dias: '0123456', accion: 'destilar' },
  { id: 'autocritica', nombre: 'Mastropiero revisa lo que se rompió y propone arreglos', hora: '02:30', dias: '0123456', accion: 'autocritica' },
  { id: 'fragua', nombre: 'La Fragua forja las propuestas abiertas', hora: '03:00', dias: '0123456', accion: 'fragua' },
  { id: 'lectura', nombre: 'Lectura nocturna: expandir la Librería', hora: '04:00', dias: '0123456', accion: 'lectura' },
  { id: 'matinal', nombre: 'El audio de la mañana', hora: '07:50', dias: '0123456', accion: 'matinal' },
  { id: 'cronica', nombre: 'La crónica del día entra al corpus', hora: '23:55', dias: '0123456', accion: 'cronica' },
  { id: 'gnosis', nombre: 'Síntesis de la semana: patrones como quántomos', hora: '21:30', dias: '0', accion: 'gnosis' },
]
/** La única plantilla de run de fábrica: genérica, sin nada del operador. */
const PLANTILLAS_SISTEMA = [
  { nombre: 'Mañana oficina', pedido: { duracion: 180, banda: [12], cantidad: 15, subdescripcion: true } },
]
const AJUSTES_SISTEMA: Record<string, string> = {
  jornada_inicio: '09:00',
  jornada_fin: '23:00',
  bloques_minutos: '12,25,50',
  primarias_semana: '6',
  tokens_dia_max: '5000000', // tokens por día para lo que corre solo (la liga y las rutinas); lo que él pide no se frena; 0 = sin tope
  pensar_cada_horas: '3', // Mastropiero piensa solo y deja una sugerencia (o nada); 0 = nunca
  meta_ingresos_mes: '', // su meta de ingresos por mes, en euros; vacío = sin meta
  telegram_voz: '0', // respuestas por Telegram también en audio: 0 = no, 1 = cuando él manda audio, siempre
  telegram_bandas: '1', // cada banda de la run llega sola por Telegram, con botones
  destilar_por_dia: '15', // con la ingesta en pausa, cuántas piezas propias despierta por día la rutina «destilar»
  vectorizar_auto: '1', // calcular solos los vectores del corpus (búsqueda por significado); 0 = no
  reproceso_activo: '0', // el reproceso (pasajes, destilado, eventos, relaciones) corre de fondo en la nube; lo prende él
  reproceso_rerank: '1', // el chat reordena con un modelo chico lo que trae del archivo; 0 = solo por puntaje
  directo_auto: '1', // del Directo, las ideas y lo que miró entran solas (tareas, personas y conexiones esperan su ok); 0 = todo espera
  apps_estimulo: 'instagram, tiktok, shorts, reels, x.com, twitter, facebook, reddit, twitch', // foco: lo de alto estímulo (editable)
  ciclo_bandas: '90/20', // runs: minutos de foco seguidos y de descanso lejos de la pantalla; 0 = sin ciclos
  fragua_por_noche: '3', // cuántas propuestas forja la rutina «fragua» por noche; 0 = ninguna
  lectura_obras: '10', // cuántas obras de la Librería expande la lectura nocturna
  ayudantes_auto: '1', // cada primaria aceptada sin ayudante recibe uno solo; 0 = los suma él
  salud_kcal_dia: '', // metas de salud; vacío = sin meta
  salud_proteina_dia: '',
  salud_sueno_horas: '',
  salud_entrenos_semana: '',
  salud_peso_objetivo: '',
}

/** Fuentes de fábrica. Estructura, no contenido: el corpus arranca vacío. */
export const FUENTES_SISTEMA: { id: string; nombre: string; nivel: string; descripcion: string }[] = [
  { id: 'operador', nombre: 'Operador', nivel: 'propia', descripcion: 'Lo que cargás a mano: notas, textos, archivos.' },
  { id: 'deprocast-0.7', nombre: 'Deprocast 0.7', nivel: 'propia', descripcion: 'Las instancias 0.7.x. Cada carga cuelga su subfuente de acá.' },
  { id: 'web', nombre: 'Web', nivel: 'primaria', descripcion: 'Lo que traen los crawlers.' },
  { id: 'agentes', nombre: 'Agentes', nivel: 'generada', descripcion: 'Lo que producen los agentes de la liga.' },
]

const FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS corpus_fts USING fts5(
  titulo, contenido, etiquetas, autor, content='corpus', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS corpus_fts_ai AFTER INSERT ON corpus BEGIN
  INSERT INTO corpus_fts(rowid, titulo, contenido, etiquetas, autor) VALUES (new.id, new.titulo, new.contenido, new.etiquetas, new.autor);
END;
CREATE TRIGGER IF NOT EXISTS corpus_fts_ad AFTER DELETE ON corpus BEGIN
  INSERT INTO corpus_fts(corpus_fts, rowid, titulo, contenido, etiquetas, autor) VALUES ('delete', old.id, old.titulo, old.contenido, old.etiquetas, old.autor);
END;
CREATE TRIGGER IF NOT EXISTS corpus_fts_au AFTER UPDATE OF titulo, contenido, etiquetas, autor ON corpus BEGIN
  INSERT INTO corpus_fts(corpus_fts, rowid, titulo, contenido, etiquetas, autor) VALUES ('delete', old.id, old.titulo, old.contenido, old.etiquetas, old.autor);
  INSERT INTO corpus_fts(rowid, titulo, contenido, etiquetas, autor) VALUES (new.id, new.titulo, new.contenido, new.etiquetas, new.autor);
END;
`

/** La tabla puente pieza ↔ entidad, mantenida por triggers desde corpus.entidades (que sigue siendo la fuente de verdad). */
const CORPUS_ENTIDADES = `
CREATE TABLE IF NOT EXISTS corpus_entidades (
  pieza_id INTEGER NOT NULL,
  entidad_id INTEGER NOT NULL,
  PRIMARY KEY (pieza_id, entidad_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS corpus_entidades_ent ON corpus_entidades(entidad_id, pieza_id);
CREATE TRIGGER IF NOT EXISTS corpus_ent_ai AFTER INSERT ON corpus WHEN new.entidades IS NOT NULL AND json_valid(new.entidades) BEGIN
  INSERT OR IGNORE INTO corpus_entidades (pieza_id, entidad_id) SELECT new.id, CAST(value AS INTEGER) FROM json_each(new.entidades) WHERE CAST(value AS INTEGER) > 0;
END;
CREATE TRIGGER IF NOT EXISTS corpus_ent_au AFTER UPDATE OF entidades ON corpus BEGIN
  DELETE FROM corpus_entidades WHERE pieza_id = old.id;
  INSERT OR IGNORE INTO corpus_entidades (pieza_id, entidad_id) SELECT new.id, CAST(value AS INTEGER) FROM json_each(CASE WHEN json_valid(new.entidades) THEN new.entidades ELSE '[]' END) WHERE CAST(value AS INTEGER) > 0;
END;
CREATE TRIGGER IF NOT EXISTS corpus_ent_ad AFTER DELETE ON corpus BEGIN
  DELETE FROM corpus_entidades WHERE pieza_id = old.id;
END;
`

/** Los índices de las consultas que se repiten (las que se piden cada pocos segundos, o en bucles). */
const INDICES_RAPIDOS = `
CREATE INDEX IF NOT EXISTS corpus_nivel ON corpus(nivel, fecha);
CREATE INDEX IF NOT EXISTS corpus_estado ON corpus(estado);
CREATE INDEX IF NOT EXISTS quantomos_etapa_novedad ON quantomos(etapa, novedad);
CREATE INDEX IF NOT EXISTS mano_jugadas_pesquisa ON mano_jugadas(pesquisa_id);
CREATE INDEX IF NOT EXISTS corpus_aporte ON corpus(json_extract(meta, '$.primaria')) WHERE json_extract(meta, '$.aporte') = 1;
CREATE INDEX IF NOT EXISTS corpus_ayudante ON corpus(json_extract(meta, '$.ayudante')) WHERE json_extract(meta, '$.ayudante') IS NOT NULL;
CREATE INDEX IF NOT EXISTS misiones_padre ON misiones(padre_id, nivel);
CREATE INDEX IF NOT EXISTS misiones_entidad ON misiones(entidad_id, estado);
CREATE INDEX IF NOT EXISTS movimientos_entidad ON movimientos(entidad_id, fecha);
CREATE INDEX IF NOT EXISTS preguntas_estado ON preguntas(estado, id);
CREATE INDEX IF NOT EXISTS llamadas_cuando ON llamadas(en);
CREATE INDEX IF NOT EXISTS cronica_tick ON cronica(tick);
CREATE INDEX IF NOT EXISTS takeout_destilado_cola ON takeout_destilado(lote, estado, prioridad);
CREATE INDEX IF NOT EXISTS directo_momentos_tipo ON directo_momentos(tipo, desde);
CREATE INDEX IF NOT EXISTS encargo_logs_encargo ON encargo_logs(encargo_id);
`

export function migrar(db: Db) {
  for (const [tabla, cols] of Object.entries(COLUMNAS_NUEVAS)) {
    const hay = new Set((db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name))
    for (const [col, tipo] of cols) if (!hay.has(col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`)
  }
  // Las contraseñas de las redes no se guardan (ninguna función las usaba y quedaban en texto plano): se borran y se va la columna.
  if ((db.prepare('PRAGMA table_info(cuentas)').all() as { name: string }[]).some((c) => c.name === 'clave')) {
    db.exec('UPDATE cuentas SET clave = NULL')
    try { db.exec('ALTER TABLE cuentas DROP COLUMN clave') } catch { /* SQLite viejo: queda la columna, vacía */ }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS corpus_origen ON corpus(origen_id); CREATE INDEX IF NOT EXISTS corpus_fuente ON corpus(fuente, nivel);')
  const habiaFts = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'corpus_fts'`).get()
  db.exec(FTS)
  if (!habiaFts) db.exec(`INSERT INTO corpus_fts(corpus_fts) VALUES ('rebuild')`)
  // Qué entidades nombra cada pieza, con índice: «las piezas de X» deja de recorrer todo el corpus con json_each.
  db.exec(CORPUS_ENTIDADES)
  if (!db.prepare(`SELECT 1 FROM ajustes WHERE clave = 'corpus_entidades_v1'`).get()) {
    db.exec(`INSERT OR IGNORE INTO corpus_entidades (pieza_id, entidad_id) SELECT c.id, CAST(j.value AS INTEGER) FROM corpus c, json_each(c.entidades) j
      WHERE c.entidades IS NOT NULL AND json_valid(c.entidades) AND CAST(j.value AS INTEGER) > 0`)
    db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('corpus_entidades_v1', '1')`).run()
  }
  db.exec(INDICES_RAPIDOS)

  const rutina = db.prepare(`INSERT OR IGNORE INTO rutinas (id, nombre, hora, dias, accion, activa) VALUES (?, ?, ?, ?, ?, 1)`)
  for (const r of RUTINAS_SISTEMA) rutina.run(r.id, r.nombre, r.hora, r.dias, r.accion)
  db.prepare(`UPDATE rutinas SET nombre = 'Saludo del día' WHERE id = 'jornada' AND nombre = 'Armar la jornada'`).run()
  const plantilla = db.prepare('INSERT OR IGNORE INTO run_plantillas (nombre, pedido, sistema, creada_en) VALUES (?, ?, 1, ?)')
  for (const p of PLANTILLAS_SISTEMA) plantilla.run(p.nombre, JSON.stringify(p.pedido), Date.now())
  migrarJornadas(db)
  const yo = db.prepare(`SELECT id FROM entidades WHERE json_extract(meta, '$.operador') = 1 ORDER BY id LIMIT 1`).get() as { id: number } | undefined
  if (yo) {
    const k = `entidad:${yo.id}`
    db.prepare(`UPDATE misiones SET personaje = 'jugador' WHERE personaje = ?`).run(k)
    db.prepare(`UPDATE misiones SET asignada_por = 'jugador' WHERE asignada_por = ?`).run(k)
    db.prepare(`UPDATE inventario SET personaje = 'jugador' WHERE personaje = ?`).run(k)
    db.prepare(`UPDATE OR IGNORE historias SET personaje = 'jugador' WHERE personaje = ?`).run(k)
    db.prepare(`DELETE FROM historias WHERE personaje = ?`).run(k)
  }
  const ajuste = db.prepare('INSERT OR IGNORE INTO ajustes (clave, valor) VALUES (?, ?)')
  for (const [k, v] of Object.entries(AJUSTES_SISTEMA)) ajuste.run(k, v)
  // Personas v2: la cercanía vieja (1–5) pasa a nivel de contacto (1–12), una sola vez.
  if (!db.prepare(`SELECT 1 FROM ajustes WHERE clave = 'personas_v2'`).get()) {
    db.exec(`UPDATE relaciones SET nivel = CASE cercania WHEN 1 THEN 2 WHEN 2 THEN 5 WHEN 3 THEN 7 WHEN 4 THEN 10 WHEN 5 THEN 12 END WHERE nivel IS NULL AND cercania IS NOT NULL`)
    db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('personas_v2', '1')`).run()
  }

  const ahora = Date.now()
  const alta = db.prepare('INSERT OR IGNORE INTO fuentes (id, nombre, nivel, descripcion, padre_id, sistema, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const f of FUENTES_SISTEMA) alta.run(f.id, f.nombre, f.nivel, f.descripcion, null, 1, ahora)
  // Piezas anteriores a las fuentes dinámicas: su fuente vieja pasa a existir; las 0.7.x cuelgan de Deprocast 0.7.
  for (const { fuente } of db.prepare('SELECT DISTINCT fuente FROM corpus WHERE fuente NOT IN (SELECT id FROM fuentes)').all() as { fuente: string }[]) {
    const deprocast = /^0\.7\.\d$/.test(fuente)
    alta.run(fuente, deprocast ? `Deprocast ${fuente}` : fuente, 'propia', null, deprocast ? 'deprocast-0.7' : null, 0, ahora)
  }
  db.exec(`UPDATE corpus SET nivel = COALESCE((SELECT nivel FROM fuentes WHERE fuentes.id = corpus.fuente), 'propia') WHERE nivel IS NULL`)
  // La metadata de cada mensaje: su número dentro de la conversación y dónde ocurrió (hoy | diario | chat | agente:<id>).
  // Los viejos se numeran una vez, de una pasada; los nuevos, con un trigger (sirve para todo lo que inserta mensajes).
  if (db.prepare('SELECT 1 FROM mensajes WHERE numero IS NULL LIMIT 1').get()) {
    db.exec(`UPDATE mensajes SET numero = w.n, lugar = w.lugar FROM (
      SELECT m.id, ROW_NUMBER() OVER (PARTITION BY m.conversacion_id ORDER BY m.id) AS n,
        CASE WHEN c.con = 'mastropiero' THEN COALESCE(c.modo, 'chat') ELSE 'agente:' || c.con END AS lugar
      FROM mensajes m LEFT JOIN conversaciones c ON c.id = m.conversacion_id) AS w
      WHERE mensajes.id = w.id AND mensajes.numero IS NULL`)
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS mensajes_metadata AFTER INSERT ON mensajes WHEN new.numero IS NULL BEGIN
    UPDATE mensajes SET
      numero = COALESCE((SELECT numero FROM mensajes WHERE conversacion_id = new.conversacion_id AND id < new.id ORDER BY id DESC LIMIT 1), 0) + 1,
      lugar = (SELECT CASE WHEN con = 'mastropiero' THEN COALESCE(modo, 'chat') ELSE 'agente:' || con END FROM conversaciones WHERE id = new.conversacion_id)
    WHERE id = new.id;
  END`)
}

/**
 * Una sola vez: los bloques de las jornadas viejas pasan a ser misiones secundarias, con una run por día.
 * La columna `bloques` queda vacía; la jornada sigue guardando el resumen y el cierre del día.
 */
function migrarJornadas(db: Db) {
  const viejas = db.prepare(`SELECT fecha, bloques, creada_en FROM jornadas WHERE bloques != '[]'`).all() as { fecha: string; bloques: string; creada_en: number }[]
  const estado: Record<string, string> = { hecho: 'hecha', saltado: 'no', pendiente: 'activa' }
  for (const j of viejas) {
    const bloques = json<any[]>(j.bloques, []).filter((b) => b && b.estado !== 'fijo' && b.inicio && b.fin)
    if (bloques.length) {
      const r = db.prepare(`INSERT INTO runs (fecha, inicio, fin, estado, pedido, resumen, modelo, creada_en, iniciada_en, cerrada_en) VALUES (?, ?, ?, 'cerrada', '{}', 'Jornada anterior a las runs.', 'migracion', ?, ?, ?)`)
        .run(j.fecha, bloques[0].inicio, bloques.at(-1).fin, j.creada_en, j.creada_en, j.creada_en)
      const run = Number(r.lastInsertRowid)
      const alta = db.prepare(`INSERT INTO misiones (personaje, asignada_por, nivel, titulo, detalle, categoria, estado, run_id, inicio, fin, minutos, orden, creada_por, creada_en, cerrada_en)
        VALUES ('jugador', 'mastropiero', 'secundaria', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'migracion', ?, ?)`)
      bloques.forEach((b, i) => {
        const e = estado[b.estado] ?? 'activa'
        alta.run(String(b.titulo ?? '').slice(0, 160), b.por_que ?? null, b.proyecto ?? null, e, run, b.inicio, b.fin, b.minutos ?? null, i, j.creada_en, e === 'activa' ? null : j.creada_en)
      })
    }
    db.prepare(`UPDATE jornadas SET bloques = '[]' WHERE fecha = ?`).run(j.fecha)
  }
}

export function ajuste(db: Db, clave: string): string | null {
  return (db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(clave) as { valor: string } | undefined)?.valor ?? null
}

export function fijarAjuste(db: Db, clave: string, valor: string) {
  db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor)
}

/** Fecha local YYYY-MM-DD (la del operador, no UTC). */
export function fechaLocal(ms = Date.now()): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function json<T>(v: unknown, def: T): T {
  if (typeof v !== 'string' || !v) return def
  try {
    return JSON.parse(v) as T
  } catch {
    return def
  }
}
