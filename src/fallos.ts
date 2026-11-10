/**
 * Los fallos, estructurados (Fragua #191): para que la máquina corrija sin que nadie tenga que interpretar prosa.
 * Cada fallo tiene un código cerrado y estable (el catálogo de abajo), dónde pasó, la entrada y la salida crudas (lo
 * justo), la causa probable, una acción sugerida, si se puede reintentar, si se recuperó solo, si es de un sitio ajeno
 * (un 409 de otra página no pesa como un error de Deprocast) y una huella (origen + código + dónde) que agrupa los
 * iguales: «esto falló 14 veces por la misma causa» en una línea.
 *
 * El texto para el humano es otro campo (el de siempre). registrarError() sigue andando: clasifica el texto y le pone
 * código y huella. Lo lento (rutas, pasos, bloqueos) mantiene su agrupado por texto, con sus milisegundos.
 */
import crypto from 'node:crypto'
import type { Db } from './db.ts'

export const CODIGOS = {
  tiempo_agotado: { que: 'Una llamada no contestó a tiempo.', accion: 'Reintentar; si se repite, ver si el servicio está caído o si el pedido es demasiado grande.', reintentable: true },
  sin_red: { que: 'No hubo conexión (DNS, reset, red caída).', accion: 'Esperar y reintentar; si sigue, revisar la salida a internet del servidor.', reintentable: true },
  limite: { que: 'El servicio pidió frenar (429, cupo, rate limit).', accion: 'Esperar lo que pide el servicio (retry-after) y bajar el ritmo.', reintentable: true },
  servidor_ajeno: { que: 'El otro servicio falló (5xx, bad gateway).', accion: 'Reintentar más tarde; no es un error de Deprocast.', reintentable: true },
  nombre_ocupado: { que: 'El nombre o la identidad ya existe en el servicio (409).', accion: 'Reusar la identidad guardada o probar con un sufijo aleatorio; no insistir con nombres parecidos.', reintentable: false },
  conflicto: { que: 'El servicio rechazó el pedido por un conflicto (409).', accion: 'Leer el estado actual antes de repetir el pedido.', reintentable: false },
  sin_permiso: { que: 'Falta permiso o la credencial no vale (401/403).', accion: 'Revisar la clave o el token en las variables del servicio.', reintentable: false },
  no_encontrado: { que: 'Lo pedido no existe (404, id que no está).', accion: 'Revisar el link o el id; no reintentar igual.', reintentable: false },
  entrada_mala: { que: 'El pedido vino mal armado (400, argumentos inválidos).', accion: 'Corregir los argumentos según el error y volver a pedir.', reintentable: false },
  json_invalido: { que: 'El modelo (o un servicio) no devolvió el JSON pedido.', accion: 'Pedir de nuevo con el motivo; partir la entrada si es muy larga.', reintentable: true },
  bloqueado: { que: 'El sitio bloqueó la lectura (antibot, login, captcha).', accion: 'Probar otra vía (otro lector o buscador); sin cuenta no hay más.', reintentable: false },
  base_de_datos: { que: 'Falló una consulta a la base (SQLite: restricción, tabla, columna).', accion: 'Es un bug: mirar la consulta y la restricción que saltó.', reintentable: false },
  codigo: { que: 'Error de programación (undefined, no es una función, tipo).', accion: 'Es un bug: ir a la línea que lo tira.', reintentable: false },
  tope: { que: 'Se llegó al tope de tokens o de cupo propio.', accion: 'Esperar al día siguiente o subir el tope si hace falta.', reintentable: false },
  desconocido: { que: 'No se pudo clasificar.', accion: 'Leer el mensaje y sumar un código al catálogo si se repite.', reintentable: false },
} as const
export type CodigoFallo = keyof typeof CODIGOS

export type Fallo = {
  origen: string // herramienta:leer_pagina, modelo, explorar:reddit, takeout, telegram…
  mensaje: string // para el humano
  codigo?: CodigoFallo
  donde?: string | null // URL (sin query), archivo, tabla, pieza, modelo
  entrada?: string | null
  salida?: string | null
  causa?: string | null
  accion?: string | null
  reintentable?: boolean
  recuperado?: boolean
  ajeno?: boolean
}

/** El código de un error a partir de su texto (y de un estado HTTP, si lo hay). */
export function clasificar(texto: string, estado?: number | null): { codigo: CodigoFallo; ajeno: boolean } {
  const t = texto.toLowerCase()
  const s = estado ?? Number(/\b(?:http|estado|status|estadohttp)\D{0,3}([1-5]\d\d)\b/i.exec(texto)?.[1] ?? /\b(4\d\d|5\d\d)\b/.exec(texto)?.[1] ?? 0)
  if (/nombre_ocupado|ya existe|already exists|name (is )?taken/.test(t)) return { codigo: 'nombre_ocupado', ajeno: true }
  if (/timeout|tiempo agotado|aborted due to timeout|timed out|tardó demasiado/.test(t)) return { codigo: 'tiempo_agotado', ajeno: false }
  if (/fetch failed|econnreset|enotfound|econnrefused|sin conexi[oó]n|socket hang up|eai_again/.test(t)) return { codigo: 'sin_red', ajeno: false }
  if (s === 429 || /too many requests|rate limit|retry after|cupo|quota/.test(t)) return { codigo: 'limite', ajeno: true }
  if (/json v[aá]lido|json mal formado|no devolvi[oó] (el )?json|unexpected token|unexpected non-whitespace|not valid json/.test(t)) return { codigo: 'json_invalido', ajeno: false }
  if (/sqlite|unique constraint|no such (table|column)|foreign key/.test(t)) return { codigo: 'base_de_datos', ajeno: false }
  if (/cannot read|is not a function|is not defined|undefined|typeerror|referenceerror/.test(t)) return { codigo: 'codigo', ajeno: false }
  if (/tope (diario|de tokens)|tope alcanzado/.test(t)) return { codigo: 'tope', ajeno: false }
  if (/captcha|antibot|confirm[aá] que no sos un bot|not a bot|login required|inicia sesi[oó]n/.test(t)) return { codigo: 'bloqueado', ajeno: true }
  if (s === 409 || /\bconflict\b/.test(t)) return { codigo: 'conflicto', ajeno: true }
  if (s === 401 || s === 403 || /unauthorized|forbidden|sin permiso|no tiene acceso|invalid (api )?key/.test(t)) return { codigo: 'sin_permiso', ajeno: true }
  if (s === 404 || /not found|no existe|no encontr[eé]/.test(t)) return { codigo: 'no_encontrado', ajeno: s === 404 }
  if (s === 400 || /argumentos|bad request|inv[aá]lid/.test(t)) return { codigo: 'entrada_mala', ajeno: s === 400 }
  if (s >= 500 || /bad gateway|service unavailable|internal server error/.test(t)) return { codigo: 'servidor_ajeno', ajeno: true }
  return { codigo: 'desconocido', ajeno: false }
}

/** Lo que identifica a un fallo para agruparlo: origen + código + dónde (sin números ni query). */
export function huellaDe(origen: string, codigo: string, donde?: string | null): string {
  const d = String(donde ?? '').replace(/\?.*$/, '').replace(/\d+/g, '#').toLowerCase()
  return crypto.createHash('sha1').update(`${origen}|${codigo}|${d}`).digest('hex').slice(0, 12)
}

const recorte = (t: string | null | undefined, n: number) => (t == null ? null : String(t).slice(0, n))

/** Anota un fallo estructurado; los iguales (misma huella, últimas 24 h) suman al contador. Devuelve el fallo completo. */
export function registrarFallo(db: Db, f: Fallo, ahora = Date.now()) {
  const c = f.codigo ? { codigo: f.codigo, ajeno: !!f.ajeno } : clasificar(`${f.mensaje} ${f.salida ?? ''}`)
  const cat = CODIGOS[c.codigo]
  const donde = f.donde ?? null
  const huella = huellaDe(f.origen, c.codigo, donde ?? f.mensaje.slice(0, 120))
  const completo = {
    ...f, codigo: c.codigo, ajeno: f.ajeno ?? c.ajeno, donde, huella, accion: f.accion ?? cat.accion, causa: f.causa ?? cat.que,
    reintentable: f.reintentable ?? cat.reintentable, recuperado: !!f.recuperado,
  }
  try {
    const ya = db.prepare('SELECT id FROM errores WHERE huella = ? AND ultima > ?').get(huella, ahora - 86_400_000) as { id: number } | undefined
    if (ya) db.prepare('UPDATE errores SET veces = veces + 1, ultima = ?, texto = ?, salida = COALESCE(?, salida) WHERE id = ?').run(ahora, recorte(f.mensaje, 600), recorte(f.salida, 600), ya.id)
    else db.prepare(`INSERT INTO errores (origen, texto, primera, ultima, codigo, huella, donde, entrada, salida, causa, accion, reintentable, recuperado, ajeno) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(f.origen, recorte(f.mensaje, 600), ahora, ahora, c.codigo, huella, recorte(donde, 300), recorte(f.entrada, 600), recorte(f.salida, 600), completo.causa, completo.accion, completo.reintentable ? 1 : 0, completo.recuperado ? 1 : 0, completo.ajeno ? 1 : 0)
  } catch { /* anotar un fallo nunca rompe nada */ }
  return completo
}

/** El bloque aparte que acompaña a un resultado que falló (la salida útil no se contamina). */
export const bloqueFallo = (f: ReturnType<typeof registrarFallo>) => ({ codigo: f.codigo, reintentable: f.reintentable, accion: f.accion, ajeno: f.ajeno, huella: f.huella, ...(f.donde ? { donde: f.donde } : {}) })

/**
 * Una respuesta de otra página que en realidad es un error (un JSON con estadoHttp/status 4xx-5xx, o con «error» y
 * «code»), aunque haya llegado como contenido. null si no lo es.
 */
export function errorEnRespuesta(texto: string): { estado: number | null; codigo: string | null; mensaje: string } | null {
  const crudo = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  if (!crudo.startsWith('{') || crudo.length > 20_000) return null
  let j: any
  try { j = JSON.parse(crudo) } catch { return null }
  const estado = Number(j.estadoHttp ?? j.status ?? j.statusCode ?? j.code) || null
  const codigo = typeof j.error === 'string' ? j.error : typeof j.code === 'string' ? j.code : null
  if ((estado && estado >= 400) || (j.error && (codigo || j.message))) return { estado: estado && estado >= 400 ? estado : null, codigo, mensaje: String(j.message ?? j.error?.message ?? j.error ?? 'error').slice(0, 300) }
  return null
}

/** Los fallos de las últimas horas, agrupados por huella: los tres más repetidos con su acción, y la lista. */
export function erroresRecientes(db: Db, horas = 24, ahora = Date.now()) {
  const filas = db.prepare(`SELECT origen, texto, veces, ultima, codigo, huella, donde, causa, accion, reintentable, recuperado, ajeno FROM errores
    WHERE ultima >= ? AND origen != 'lento' ORDER BY veces DESC, ultima DESC LIMIT 200`).all(ahora - horas * 3_600_000) as any[]
  const grupos = filas.map((f) => ({
    huella: f.huella ?? null, codigo: f.codigo ?? clasificar(f.texto).codigo, origen: f.origen, donde: f.donde, veces: f.veces, ultima: f.ultima, mensaje: f.texto,
    accion: f.accion ?? CODIGOS[(f.codigo ?? clasificar(f.texto).codigo) as CodigoFallo].accion, reintentable: !!f.reintentable, recuperado: !!f.recuperado, ajeno: !!f.ajeno,
  }))
  const propios = grupos.filter((g) => !g.ajeno && !g.recuperado)
  return { horas, total: grupos.reduce((s, g) => s + g.veces, 0), top: (propios.length ? propios : grupos).slice(0, 3), grupos }
}
