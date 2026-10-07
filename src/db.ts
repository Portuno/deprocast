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
  { id: 'jornada', nombre: 'Armar la jornada', hora: '08:30', accion: 'jornada' },
  { id: 'cierre', nombre: 'Cierre del día', hora: '22:30', accion: 'cierre' },
]
const AJUSTES_SISTEMA: Record<string, string> = {
  jornada_inicio: '09:00',
  jornada_fin: '23:00',
  bloques_minutos: '12,25,50',
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

function migrar(db: Db) {
  for (const [tabla, cols] of Object.entries(COLUMNAS_NUEVAS)) {
    const hay = new Set((db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name))
    for (const [col, tipo] of cols) if (!hay.has(col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`)
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS corpus_origen ON corpus(origen_id); CREATE INDEX IF NOT EXISTS corpus_fuente ON corpus(fuente, nivel);')
  const habiaFts = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'corpus_fts'`).get()
  db.exec(FTS)
  if (!habiaFts) db.exec(`INSERT INTO corpus_fts(corpus_fts) VALUES ('rebuild')`)

  const rutina = db.prepare(`INSERT OR IGNORE INTO rutinas (id, nombre, hora, dias, accion, activa) VALUES (?, ?, ?, '0123456', ?, 1)`)
  for (const r of RUTINAS_SISTEMA) rutina.run(r.id, r.nombre, r.hora, r.accion)
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
