/**
 * La bitácora de desarrollo (Fragua #207). Él pega en WhatsApp o Telegram lo que va diciendo su sesión de Claude Code,
 * para tener registro. Eso no es un pedido suyo: se reconoce (hashes con «commit», rutas de src/, «Fragua #N»,
 * comandos, código entre comillas invertidas, la narración de quien programa), se guarda en una pieza por día de la
 * fuente «Bitácora de desarrollo» y se contesta «anotado», sin armar un turno. Si empieza con «registro:», va siempre.
 * Lo que mande en la misma ráfaga que sí es suyo sigue al chat como siempre.
 */
import { fechaLocal, type Db } from './db.ts'

const FUENTE = { id: 'desarrollo', nombre: 'Bitácora de desarrollo', nivel: 'generada', descripcion: 'Lo que pega de sus sesiones con Claude Code: registro de cómo se construyó, no pedidos suyos.' }
const PREFIJO = /^\s*(#?registro|bit[aá]cora)\s*[:：-]\s*/i

const SENALES: RegExp[] = [
  /\b[0-9a-f]{7,40}\b[\s\S]{0,120}\b(commit|push|github|despleg|deploy|versi[oó]n|nube)|\b(commit|push|github|despleg|deploy)\w*[\s\S]{0,120}\b[0-9a-f]{7,40}\b/i,
  /\b(src|web|test|apps|docs)\/[\w./-]+\.(ts|tsx|js|css|html|md|json)\b/,
  /\bFragua #\d+|#\d{2,3}\b[^.\n]{0,60}\b(propuesta|Fragua)|\b(propuestas?|Fragua)\b[^.\n]{0,60}#\d{2,3}\b/i,
  /\b(npm (run|test)|npx|tsc|node --test|git (push|commit|stash|log)|pull request|typecheck|tipado)\b/i,
  /^(Antes de seguir|Corro|Lo subo|Subo|Reviso|Miro|Busco|Ahora (reviso|miro|sigo|corro)|Listo[:.]|Pasa[n]?\b|Ya est[aá] en GitHub|No entr[oó]|Confirmado|Encontr[eé])/im,
  /`[^`\n]{2,}`/,
  /\b(pruebas?|tests?) (pasan|pasa|falla[n]?)\b|\bpass \d+|\b\d+ pruebas\b/i,
  /\b(commitear|redeploy|despliegue|polling|endpoint|handler|event loop|migraci[oó]n|refactor|stack|regex|tokens|configurable|vueltas de herramientas)\b/i,
]

/** Cuántas señales de «esto lo escribió una sesión de programación» tiene un texto. */
export const senales = (texto: string) => SENALES.filter((r) => r.test(texto)).length

/** ¿Es registro de su sesión de desarrollo (y no algo que él le pide)? */
export function esRegistro(texto: string): boolean {
  const t = texto.trim()
  if (PREFIJO.test(t)) return true
  const n = senales(t)
  return n >= 3 || (n >= 2 && t.length >= 120)
}

/**
 * Separa una ráfaga: lo que es registro y lo que es suyo. Si un mensaje es claramente registro, los de al lado con
 * alguna señal también (cuando pega varios pedazos seguidos de la misma sesión).
 */
export function separar(textos: string[]): { registro: string[]; suyo: string[] } {
  const claro = textos.map((t) => esRegistro(t))
  const hayClaro = claro.some(Boolean)
  const es = textos.map((t, i) => claro[i] || (hayClaro && senales(t) >= 1 && (claro[i - 1] || claro[i + 1] || claro.some((c, j) => c && Math.abs(j - i) <= 2))))
  return { registro: textos.filter((_, i) => es[i]).map((t) => t.replace(PREFIJO, '').trim()), suyo: textos.filter((_, i) => !es[i]) }
}

/** Lo suma a la bitácora del día (una pieza por día, que crece). Devuelve el id de la pieza. */
export async function anotarRegistro(db: Db, textos: string[], origen: string, ahora = Date.now()): Promise<number | null> {
  const limpio = textos.map((t) => t.trim()).filter(Boolean)
  if (!limpio.length) return null
  const { asegurarFuente, insertar } = await import('./corpus.ts')
  asegurarFuente(db, FUENTE)
  const fecha = fechaLocal(ahora)
  const hora = new Date(ahora).toTimeString().slice(0, 5)
  const bloque = `## ${hora} · ${origen}\n\n${limpio.join('\n\n')}`
  const origenId = `desarrollo:${fecha}`
  const ya = db.prepare('SELECT id, contenido FROM corpus WHERE origen_id = ?').get(origenId) as { id: number; contenido: string } | undefined
  if (ya) {
    db.prepare('UPDATE corpus SET contenido = ? WHERE id = ?').run(`${ya.contenido}\n\n${bloque}`, ya.id)
    db.prepare('DELETE FROM pasajes WHERE pieza_id = ?').run(ya.id) // cambió el texto: sus pasajes se rehacen
    return ya.id
  }
  return insertar(db, { fuente: FUENTE.id, nivel: 'generada', titulo: `Bitácora de desarrollo · ${fecha}`, fecha, contenido: `# Bitácora de desarrollo · ${fecha}\n\n${bloque}`, etiquetas: ['desarrollo', 'claude-code'], origenId }, ahora)
}

export const AVISO_ANOTADO = '📒 Anotado en la bitácora de desarrollo (lo tomo como registro, no como pedido).'
/** La nota que acompaña a lo suyo cuando en la misma ráfaga también pegó registro. */
export const NOTA_MEZCLA = '(Aviso del sistema: en el mismo envío pegó registro de su sesión de desarrollo con Claude Code; quedó en la bitácora. No es un pedido: contestá solo lo suyo, que sigue.)'
