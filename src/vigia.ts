/**
 * El vigía: la salud de Deprocast en vivo (La máquina → Estado) y un aviso por WhatsApp cuando algo se rompe.
 * - Cada pieza (el servidor, la integridad de la base, el Drive, WhatsApp, el Taller, los errores, el gasto y la caché)
 *   con su estado: bien, ojo o mal, y lo que pasa en una línea.
 * - Cada 15 minutos revisa lo que está «mal» y lo avisa por WhatsApp, si él lo quiere (ajuste vigia_whatsapp) y la
 *   ventana de 24 horas está abierta. Cada problema, una vez cada 12 horas: no se repite mientras sigue igual.
 * Solo lee; no arregla nada solo.
 */
import type { DatabaseSync } from 'node:sqlite'
import { ajuste, fechaLocal, fijarAjuste, json } from './db.ts'

type Db = DatabaseSync
export type Estado = 'bien' | 'ojo' | 'mal'
export type Problema = { clave: string; texto: string }
export type Pieza = { id: string; nombre: string; estado: Estado; detalle: string; problemas: Problema[] }

const HORA = 3_600_000
const hace = (ms: number) => { const m = Math.round(ms / 60_000); return m < 60 ? `${Math.max(1, m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d` }
const miles = (n: number) => Math.round(n).toLocaleString('es-AR')
const peor = (xs: Estado[]): Estado => (xs.includes('mal') ? 'mal' : xs.includes('ojo') ? 'ojo' : 'bien')
const existe = (db: Db, t: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t)

function servidor(o: { commit?: string | null; arranco?: number; ahora: number }): Pieza {
  return { id: 'servidor', nombre: 'Servidor', estado: 'bien', problemas: [],
    detalle: `${o.commit ? `Corre el commit ${o.commit.slice(0, 7)}` : 'Corre'}${o.arranco ? `, arrancó hace ${hace(o.ahora - o.arranco)}` : ''}.` }
}

function integridad(db: Db): Pieza {
  const r = json<{ r?: { estado: string; tabla: string; columna: string; nota?: string }[] }>(ajuste(db, 'integridad_reglas'), {}) ?? {}
  const h = json<{ h?: { tabla: string; padre: string; filas: number }[] }>(ajuste(db, 'integridad_huerfanos'), {}) ?? {}
  const reglas = r.r ?? []
  const puestas = reglas.filter((x) => x.estado === 'aplicada' || x.estado === 'ya estaba').length
  const salteadas = reglas.filter((x) => x.estado === 'salteada')
  const huerfanos = (h.h ?? []).reduce((s, x) => s + x.filas, 0)
  const problemas: Problema[] = salteadas.map((x) => ({ clave: `integridad:${x.tabla}.${x.columna}`, texto: `la regla de ${x.tabla}.${x.columna} no se pudo poner (${x.nota ?? 'sin motivo'})` }))
  if (huerfanos) problemas.push({ clave: 'integridad:huerfanos', texto: `${miles(huerfanos)} filas apuntan a algo que no existe` })
  return { id: 'integridad', nombre: 'Integridad', estado: salteadas.length ? 'mal' : huerfanos ? 'ojo' : 'bien', problemas,
    detalle: reglas.length ? `${puestas} reglas puestas${salteadas.length ? `, ${salteadas.length} salteadas` : ''}; ${huerfanos ? `${miles(huerfanos)} huérfanos` : 'sin huérfanos'}.` : 'Todavía no se revisó (corre a los 90 s de arrancar).' }
}

function drive(db: Db, ahora: number): Pieza {
  if (!existe(db, 'drive_cola')) return { id: 'drive', nombre: 'Drive', estado: 'ojo', detalle: 'No está conectado.', problemas: [] }
  const c = db.prepare(`SELECT COUNT(*) AS n, MIN(creado) AS viejo, SUM(CASE WHEN intentos >= 6 THEN 1 ELSE 0 END) AS trabados FROM drive_cola WHERE hecho = 0`).get() as { n: number; viejo: number | null; trabados: number | null }
  const subidos = (db.prepare(`SELECT COUNT(*) AS n FROM drive_cola WHERE hecho = 1`).get() as { n: number }).n
  const error = (db.prepare(`SELECT error FROM drive_cola WHERE hecho = 0 AND error IS NOT NULL ORDER BY id DESC LIMIT 1`).get() as { error: string } | undefined)?.error
  const conectado = !!ajuste(db, 'google_refresh')
  const problemas: Problema[] = []
  if (c.trabados) problemas.push({ clave: 'drive:trabados', texto: `${c.trabados} archivo(s) no suben a tu Drive después de 6 intentos${error ? ` (${error.slice(0, 120)})` : ''}` })
  else if (c.n && c.viejo && ahora - c.viejo > 2 * HORA) problemas.push({ clave: 'drive:atrasada', texto: `la cola del Drive tiene ${c.n} archivo(s) esperando hace ${hace(ahora - c.viejo)}` })
  return { id: 'drive', nombre: 'Drive', estado: !conectado ? 'ojo' : problemas.length ? 'mal' : c.n > 20 ? 'ojo' : 'bien', problemas,
    detalle: !conectado ? 'Google no está conectado: lo que mandás queda en el servidor.' : `${miles(subidos)} subidos${c.n ? `, ${c.n} esperando${c.viejo ? ` (el más viejo, hace ${hace(ahora - c.viejo)})` : ''}` : ', nada esperando'}.` }
}

async function whatsapp(db: Db): Promise<Pieza> {
  const w = (await import('./whatsapp.ts')).estadoWhatsapp(db) as any
  if (!w.configurado) return { id: 'whatsapp', nombre: 'WhatsApp', estado: 'ojo', detalle: 'No está configurado.', problemas: [] }
  return { id: 'whatsapp', nombre: 'WhatsApp', estado: w.vinculado ? 'bien' : 'ojo', problemas: [],
    detalle: !w.vinculado ? 'Configurado, pero falta vincular tu número.' : w.ventanaAbierta ? 'Vinculado, ventana de 24 h abierta.' : 'Vinculado; la ventana de 24 h está cerrada (Mastropiero no te puede escribir primero).' }
}

function taller(db: Db, ahora: number): Pieza {
  if (!existe(db, 'taller_cola')) return { id: 'taller', nombre: 'Taller', estado: 'bien', detalle: 'Sin uso todavía.', problemas: [] }
  const colgados = db.prepare(`SELECT id, titulo, empezado_en FROM taller_cola WHERE estado = 'haciendo' AND empezado_en < ?`).all(ahora - 45 * 60_000) as { id: number; titulo: string; empezado_en: number }[]
  const n = db.prepare(`SELECT SUM(CASE WHEN estado = 'en_cola' THEN 1 ELSE 0 END) AS espera, SUM(CASE WHEN estado = 'fallo' AND terminado_en >= ? THEN 1 ELSE 0 END) AS fallos, SUM(CASE WHEN estado = 'listo' AND terminado_en >= ? THEN 1 ELSE 0 END) AS listos FROM taller_cola`).get(ahora - 24 * HORA, ahora - 24 * HORA) as { espera: number | null; fallos: number | null; listos: number | null }
  const problemas = colgados.map((c) => ({ clave: `taller:${c.id}`, texto: `«${c.titulo.slice(0, 60)}» lleva ${hace(ahora - c.empezado_en)} haciéndose en el Taller` }))
  return { id: 'taller', nombre: 'Taller', estado: problemas.length ? 'mal' : (n.fallos ?? 0) > (n.listos ?? 0) && (n.fallos ?? 0) >= 3 ? 'ojo' : 'bien', problemas,
    detalle: `En las últimas 24 h: ${n.listos ?? 0} listos, ${n.fallos ?? 0} fallidos; ${n.espera ?? 0} en espera.` }
}

async function errores(db: Db, ahora: number): Promise<Pieza & { grupos: { veces: number; texto: string; donde: string; ultima: number; propio: boolean }[] }> {
  const e = (await import('./fallos.ts')).erroresRecientes(db, 24, ahora) as any
  const grupos = (e.grupos ?? []) as any[]
  const propios = grupos.filter((g) => !g.recuperado && !g.ajeno)
  // Lo que es nuevo (empezó en las últimas 24 h) y se repite: eso vale un aviso.
  const nuevos = propios.filter((g) => g.veces >= 3 && (g.primera ?? g.ultima) >= ahora - 24 * HORA && g.ultima >= ahora - 2 * HORA)
  return {
    id: 'errores', nombre: 'Errores', estado: nuevos.length ? 'mal' : propios.length ? 'ojo' : 'bien',
    problemas: nuevos.slice(0, 3).map((g) => ({ clave: `error:${g.huella ?? g.mensaje.slice(0, 40)}`, texto: `un error nuevo se repite (${g.veces} veces): ${String(g.mensaje).slice(0, 140)}` })),
    detalle: `${e.total ?? 0} en 24 h, en ${grupos.length} grupos; ${propios.length ? `${propios.length} sin recuperarse solos` : 'todos se recuperaron solos o son de afuera'}.`,
    grupos: grupos.slice(0, 12).map((g) => ({ veces: g.veces, texto: String(g.mensaje).slice(0, 200), donde: [g.origen, g.donde].filter(Boolean).join(' · '), ultima: g.ultima, propio: !g.recuperado && !g.ajeno })),
  }
}

function gasto(db: Db, ahora: number) {
  const d = new Date(ahora)
  const hoy = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const mes = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const q = (desde: number, filtro = '') => db.prepare(`SELECT COUNT(*) AS llamadas, COALESCE(SUM(tokens_in), 0) AS entrada, COALESCE(SUM(MIN(COALESCE(tokens_cache, 0), COALESCE(tokens_in, 0))), 0) AS cache, COALESCE(SUM(tokens_out), 0) AS salida, ROUND(COALESCE(SUM(creditos), 0), 2) AS creditos FROM llamadas WHERE en >= ? ${filtro}`).get(desde) as { llamadas: number; entrada: number; cache: number; salida: number; creditos: number }
  const chatHoy = q(hoy, `AND agente_id IN ('mastropiero', 'copiloto')`)
  return { hoy: q(hoy), mes: q(mes), chatHoy, cacheChatHoy: chatHoy.entrada ? Math.round((chatHoy.cache / chatHoy.entrada) * 100) : null }
}

function piezaGasto(g: ReturnType<typeof gasto>, ahora: number): Pieza {
  const pc = (x: { entrada: number; cache: number }) => (x.entrada ? Math.round((x.cache / x.entrada) * 100) : 0)
  const problemas: Problema[] = []
  // La caché del chat baja (después del arreglo del 18/11 tendría que estar alta): con volumen, vale saberlo.
  if (g.chatHoy.entrada > 1_000_000 && (g.cacheChatHoy ?? 0) < 20) problemas.push({ clave: `cache:${fechaLocal(ahora)}`, texto: `hoy el chat leyó ${miles(g.chatHoy.entrada)} tokens y solo el ${g.cacheChatHoy} % salió de la caché` })
  return { id: 'gasto', nombre: 'Gasto y caché', estado: problemas.length ? 'ojo' : 'bien', problemas,
    detalle: `Hoy ${g.hoy.creditos} créditos (${miles(g.hoy.entrada + g.hoy.salida)} tokens, ${pc(g.hoy)} % de caché); este mes ${g.mes.creditos}. El chat, hoy: ${g.cacheChatHoy == null ? 'sin uso' : `${g.cacheChatHoy} % de caché`}.` }
}

/** El estado de todo, para la pantalla y para el aviso. */
export async function estadoSistema(db: Db, o: { commit?: string | null; arranco?: number; ahora?: number } = {}) {
  const ahora = o.ahora ?? Date.now()
  const g = gasto(db, ahora)
  const e = await errores(db, ahora)
  const piezas: Pieza[] = [servidor({ ...o, ahora }), integridad(db), drive(db, ahora), await whatsapp(db), taller(db, ahora), { ...e, grupos: undefined } as Pieza, piezaGasto(g, ahora)]
  return { en: ahora, estado: peor(piezas.map((p) => p.estado)), piezas, gasto: g, errores: e.grupos, avisos: ajuste(db, 'vigia_whatsapp') !== '0' }
}

/** Para que no se repita: lo avisado (clave → cuándo). Cada problema, una vez cada 12 horas. */
const REAVISO = 12 * HORA

/**
 * La ronda del vigía: lo que está mal y todavía no se avisó (o se avisó hace más de 12 h), en un solo mensaje por
 * WhatsApp. Devuelve lo que avisó (o lo que habría avisado si no se pudo mandar).
 */
export async function vigilar(db: Db, o: { commit?: string | null; arranco?: number; ahora?: number; decir?: (texto: string) => Promise<boolean> } = {}): Promise<{ avisados: Problema[]; mandado: boolean }> {
  const ahora = o.ahora ?? Date.now()
  if (ajuste(db, 'vigia_whatsapp') === '0') return { avisados: [], mandado: false }
  const s = await estadoSistema(db, { ...o, ahora })
  const ya = json<Record<string, number>>(ajuste(db, 'vigia_avisados'), {}) ?? {}
  for (const [k, t] of Object.entries(ya)) if (ahora - t > 7 * 24 * HORA) delete ya[k]
  const nuevos = s.piezas.flatMap((p) => p.problemas).filter((p) => !ya[p.clave] || ahora - ya[p.clave] > REAVISO)
  if (!nuevos.length) return { avisados: [], mandado: false }
  const texto = `Ojo, algo en Deprocast no anda:\n${nuevos.map((p) => `- ${p.texto}`).join('\n')}\n\nEl detalle está en La máquina → Estado.`
  const decir = o.decir ?? (async (t: string) => (await import('./whatsapp.ts')).decirPorWhatsapp(db, t, ahora))
  const mandado = await decir(texto).catch(() => false)
  // Si no se pudo mandar (ventana cerrada), se anota igual: queda en la pantalla, y no se reintenta cada 15 minutos.
  for (const p of nuevos) ya[p.clave] = ahora
  fijarAjuste(db, 'vigia_avisados', JSON.stringify(ya))
  return { avisados: nuevos, mandado }
}
