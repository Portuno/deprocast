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

export function resolverRuta(): string {
  const raw = (process.env.MASTRO_DB ?? '').trim()
  return raw ? path.resolve(raw) : path.resolve(process.cwd(), 'data', 'mastro.db')
}

/** `:memory:` para tests. */
export function abrir(ruta: string = resolverRuta()): Db {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true })
  const db = new DatabaseSync(ruta)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec(ESQUEMA)
  migrar(db)
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
  tipo TEXT NOT NULL,                 -- juego | imagen | voz | personaje | video
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

CREATE TABLE IF NOT EXISTS cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  red TEXT NOT NULL,                  -- Instagram, X, Telegram, WhatsApp…
  usuario TEXT NOT NULL,
  modo TEXT NOT NULL,                 -- lectura | redacta | libre
  conector TEXT,                      -- manual | telegram_canal
  reglas TEXT,                        -- JSON: temas, tono, horas, topeDia, chatId
  activa INTEGER NOT NULL DEFAULT 1,
  creada_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publicaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  estado TEXT NOT NULL,               -- borrador | aprobada | publicada | descartada | fallo
  programada_para INTEGER,
  publicada_en INTEGER,
  url TEXT,
  origen TEXT NOT NULL,               -- mastropiero | operador | radar
  error TEXT,
  creada_en INTEGER NOT NULL
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

CREATE INDEX IF NOT EXISTS quantomos_pieza ON quantomos(pieza_id);
CREATE INDEX IF NOT EXISTS quantomos_etapa ON quantomos(etapa);
`

/** Columnas que se sumaron después de la primera versión: se agregan sin tocar los datos. */
const COLUMNAS_NUEVAS: Record<string, [string, string][]> = {
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
  memoria: [
    ['pieza_id', 'INTEGER'], // la pieza del corpus de la que salió, si salió de una
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
  { id: 'temporada', nombre: 'Cierre de temporada de la liga', hora: '07:30', dias: '1', accion: 'temporada' },
  { id: 'destilar', nombre: 'Destilar unas piezas tuyas en espera', hora: '10:15', dias: '0123456', accion: 'destilar' },
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
  tokens_dia_max: '1000000', // tokens por día para la liga (agentes); 0 = sin tope
  pensar_cada_horas: '3', // Mastropiero piensa solo y deja una sugerencia (o nada); 0 = nunca
  meta_ingresos_mes: '', // su meta de ingresos por mes, en euros; vacío = sin meta
  telegram_voz: '0', // respuestas por Telegram también en audio: 0 = no, 1 = cuando él manda audio, siempre
  telegram_bandas: '1', // cada banda de la run llega sola por Telegram, con botones
  destilar_por_dia: '15', // con la ingesta en pausa, cuántas piezas propias despierta por día la rutina «destilar»
  vectorizar_auto: '1', // calcular solos los vectores del corpus (búsqueda por significado); 0 = no
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

export function migrar(db: Db) {
  for (const [tabla, cols] of Object.entries(COLUMNAS_NUEVAS)) {
    const hay = new Set((db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name))
    for (const [col, tipo] of cols) if (!hay.has(col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`)
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS corpus_origen ON corpus(origen_id); CREATE INDEX IF NOT EXISTS corpus_fuente ON corpus(fuente, nivel);')
  const habiaFts = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'corpus_fts'`).get()
  db.exec(FTS)
  if (!habiaFts) db.exec(`INSERT INTO corpus_fts(corpus_fts) VALUES ('rebuild')`)

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

  const ahora = Date.now()
  const alta = db.prepare('INSERT OR IGNORE INTO fuentes (id, nombre, nivel, descripcion, padre_id, sistema, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const f of FUENTES_SISTEMA) alta.run(f.id, f.nombre, f.nivel, f.descripcion, null, 1, ahora)
  // Piezas anteriores a las fuentes dinámicas: su fuente vieja pasa a existir; las 0.7.x cuelgan de Deprocast 0.7.
  for (const { fuente } of db.prepare('SELECT DISTINCT fuente FROM corpus WHERE fuente NOT IN (SELECT id FROM fuentes)').all() as { fuente: string }[]) {
    const deprocast = /^0\.7\.\d$/.test(fuente)
    alta.run(fuente, deprocast ? `Deprocast ${fuente}` : fuente, 'propia', null, deprocast ? 'deprocast-0.7' : null, 0, ahora)
  }
  db.exec(`UPDATE corpus SET nivel = COALESCE((SELECT nivel FROM fuentes WHERE fuentes.id = corpus.fuente), 'propia') WHERE nivel IS NULL`)
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
