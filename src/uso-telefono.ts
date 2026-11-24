/**
 * Tu tiempo en el teléfono (Mobile 1.3): cuánto estuvo prendida la pantalla, cuántas veces lo desbloqueaste y cuánto
 * pasaste en cada app, por día. Lo manda el teléfono (con el permiso «Acceso a uso», que se da una vez en Android) cada
 * ~15 minutos; cada envío trae el día entero recalculado, así que se reemplaza (un reintento no suma de más).
 * Solo el tiempo y las aperturas por app: nunca lo que hay adentro.
 *
 * Cada app cae en una categoría (redes, video, mensajes, navegador, juegos, trabajo, otras) por su paquete; «distracción»
 * son redes, video y juegos, más lo que él marque (ajuste uso_distracciones: paquetes o nombres). Así Deprocast mide la
 * procrastinación de verdad y la cruza con el día.
 */
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'

export type AppUso = { paquete: string; nombre: string; min: number; aperturas: number }
export type DiaUso = { fecha: string; pantallaMin: number; desbloqueos: number; apps: AppUso[] }
export type Categoria = 'redes' | 'video' | 'mensajes' | 'navegador' | 'juegos' | 'trabajo' | 'otras'

const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }

function asegurar(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS uso_telefono (
    fecha TEXT NOT NULL, fuente TEXT NOT NULL, pantalla_min INTEGER NOT NULL DEFAULT 0, desbloqueos INTEGER NOT NULL DEFAULT 0,
    apps TEXT NOT NULL DEFAULT '[]', actualizado INTEGER NOT NULL, PRIMARY KEY (fecha, fuente))`)
  // Mobile 1.5 (para el sueño estimado, Fragua #298): cuándo estuvo prendida la pantalla, [[desde, hasta], …].
  if (!(db.prepare(`SELECT 1 FROM pragma_table_info('uso_telefono') WHERE name = 'sesiones'`).get())) db.exec(`ALTER TABLE uso_telefono ADD COLUMN sesiones TEXT`)
  // Mobile 2.3 (para el foco): cada vez que pasó a otra app, [[t, paquete], …].
  if (!(db.prepare(`SELECT 1 FROM pragma_table_info('uso_telefono') WHERE name = 'cambios'`).get())) db.exec(`ALTER TABLE uso_telefono ADD COLUMN cambios TEXT`)
}

/** Las sesiones de pantalla de un día: ordenadas, dentro del día y sin basura (como mucho 400). */
function limpiarSesiones(fecha: string, s: unknown): [number, number][] {
  const a = new Date(`${fecha}T00:00:00`).getTime(), b = a + 86_400_000
  return (Array.isArray(s) ? s : [])
    .map((x) => (Array.isArray(x) ? [Math.max(a, Number(x[0])), Math.min(b, Number(x[1]))] as [number, number] : null))
    .filter((x): x is [number, number] => !!x && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > x[0])
    .sort((x, y) => x[0] - y[0])
    .slice(0, 400)
}

/** Por paquete (o su comienzo). Lo que no está, por palabras del nombre; si no, «otras». */
const CATEGORIAS: [RegExp, Categoria][] = [
  [/^com\.instagram\.|^com\.facebook\.katana|^com\.facebook\.lite|^com\.twitter\.android|^com\.zhiliaoapp\.musically|^com\.ss\.android\.ugc|^com\.reddit\.|^com\.snapchat\.|^com\.pinterest|^com\.linkedin\.|^com\.tumblr|^com\.bereal|^xyz\.blueskyweb|^com\.threads/, 'redes'],
  [/^com\.google\.android\.youtube|^com\.netflix\.|^tv\.twitch\.|^com\.disney\.|^com\.amazon\.avod|^com\.hbo\.|^com\.max\.|^com\.crunchyroll|^com\.plexapp|^com\.vimeo/, 'video'],
  [/^com\.whatsapp|^org\.telegram\.|^org\.thoughtcrime\.securesms|^com\.facebook\.orca|^com\.google\.android\.gm$|^com\.microsoft\.office\.outlook|^com\.discord|^com\.google\.android\.apps\.messaging|^com\.samsung\.android\.messaging|^com\.slack/, 'mensajes'],
  [/^com\.android\.chrome|^org\.mozilla\.|^com\.brave\.|^com\.opera\.|^com\.microsoft\.emmx|^com\.sec\.android\.app\.sbrowser|^com\.duckduckgo/, 'navegador'],
  [/^com\.supercell\.|^com\.king\.|^com\.miniclip|^com\.mojang|^com\.roblox|^com\.chess|^com\.activision|^com\.ea\.|^com\.rovio|^com\.innersloth|^com\.dts\.freefire|^com\.tencent\.ig/, 'juegos'],
  [/^com\.google\.android\.apps\.docs|^com\.google\.android\.calendar|^com\.notion|^com\.microsoft\.office|^com\.microsoft\.teams|^com\.google\.android\.keep|^com\.todoist|^md\.obsidian|^com\.github|^us\.zoom|^com\.deprocast\./, 'trabajo'],
]
const PALABRAS: [RegExp, Categoria][] = [[/\bgame|juego|poker|casino/i, 'juegos'], [/tiktok|instagram|facebook|twitter|reddit/i, 'redes'], [/video|tv\b|stream/i, 'video']]
const DISTRACCION: Categoria[] = ['redes', 'video', 'juegos']
/** Lo que no es «usar el teléfono»: el lanzador, la barra del sistema, el teclado. */
const IGNORAR = /launcher|systemui|inputmethod|\.home$|com\.android\.settings\.intelligence|permissioncontroller|nexuslauncher|trebuchet/i

export function categoriaDe(paquete: string, nombre = ''): Categoria {
  for (const [re, c] of CATEGORIAS) if (re.test(paquete)) return c
  for (const [re, c] of PALABRAS) if (re.test(nombre) || re.test(paquete)) return c
  return 'otras'
}

/** Las que él marcó como distracción (paquetes o nombres), además de redes, video y juegos. */
export function distraccionesPropias(db: Db): string[] { return json<string[]>(ajuste(db, 'uso_distracciones'), []).filter((x) => typeof x === 'string') }
export function fijarDistracciones(db: Db, lista: string[]): string[] {
  const l = [...new Set(lista.map((x) => String(x).trim()).filter(Boolean))].slice(0, 100)
  fijarAjuste(db, 'uso_distracciones', JSON.stringify(l))
  return l
}
const esDistraccion = (a: { paquete: string; nombre: string; categoria: Categoria }, propias: string[]) =>
  DISTRACCION.includes(a.categoria) || propias.some((p) => p.toLowerCase() === a.paquete.toLowerCase() || p.toLowerCase() === a.nombre.toLowerCase())

/** Lo que mandó el teléfono: uno o varios días (cada uno reemplaza lo que había de ese día y ese teléfono). */
export function recibirUso(db: Db, fuente: string, dias: unknown, ahora = Date.now()): number {
  asegurar(db)
  let n = 0
  const alta = db.prepare(`INSERT INTO uso_telefono (fecha, fuente, pantalla_min, desbloqueos, apps, actualizado, sesiones, cambios) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (fecha, fuente) DO UPDATE SET pantalla_min = excluded.pantalla_min, desbloqueos = excluded.desbloqueos, apps = excluded.apps, actualizado = excluded.actualizado, sesiones = COALESCE(excluded.sesiones, uso_telefono.sesiones), cambios = COALESCE(excluded.cambios, uso_telefono.cambios)`)
  for (const d of (Array.isArray(dias) ? dias : []).slice(0, 14) as Partial<DiaUso>[]) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha))) continue
    const apps = (Array.isArray(d.apps) ? d.apps : [])
      .map((a) => ({ paquete: String(a?.paquete ?? '').slice(0, 120), nombre: String(a?.nombre ?? a?.paquete ?? '').slice(0, 80), min: Math.max(0, Math.round(Number(a?.min) || 0)), aperturas: Math.max(0, Math.round(Number(a?.aperturas) || 0)) }))
      .filter((a) => a.paquete && a.min > 0 && !IGNORAR.test(a.paquete))
      .sort((a, b) => b.min - a.min)
      .slice(0, 60)
    const pantalla = Math.max(0, Math.min(1440, Math.round(Number(d.pantallaMin) || 0)))
    const cambios = Array.isArray((d as any).cambios) ? JSON.stringify(((d as any).cambios as unknown[]).filter((x): x is [number, string] => Array.isArray(x) && Number.isFinite(Number(x[0])) && typeof x[1] === 'string').slice(-3000).map(([t, p]) => [Math.round(Number(t)), String(p).slice(0, 120)])) : null
    alta.run(String(d.fecha), fuente.slice(0, 40), pantalla, Math.max(0, Math.round(Number(d.desbloqueos) || 0)), JSON.stringify(apps), ahora, Array.isArray((d as any).sesiones) ? JSON.stringify(limpiarSesiones(String(d.fecha), (d as any).sesiones)) : null, cambios)
    n++
  }
  return n
}

/** Un día: pantalla, desbloqueos, distracción, por categoría y las apps (de todos los teléfonos, sumado). */
export function usoDelDia(db: Db, fecha = fechaLocal()) {
  asegurar(db)
  const filas = db.prepare('SELECT pantalla_min, desbloqueos, apps, sesiones, cambios FROM uso_telefono WHERE fecha = ?').all(fecha) as { pantalla_min: number; desbloqueos: number; apps: string; sesiones: string | null; cambios: string | null }[]
  const propias = distraccionesPropias(db)
  const porApp = new Map<string, AppUso & { categoria: Categoria }>()
  for (const f of filas) for (const a of json<AppUso[]>(f.apps, [])) {
    const x = porApp.get(a.paquete) ?? { ...a, min: 0, aperturas: 0, categoria: categoriaDe(a.paquete, a.nombre) }
    x.min += a.min; x.aperturas += a.aperturas
    porApp.set(a.paquete, x)
  }
  const apps = [...porApp.values()].sort((a, b) => b.min - a.min).map((a) => ({ ...a, distraccion: esDistraccion(a, propias) }))
  const enApps = apps.reduce((s, a) => s + a.min, 0)
  const porCategoria: Partial<Record<Categoria, number>> = {}
  for (const a of apps) porCategoria[a.categoria] = (porCategoria[a.categoria] ?? 0) + a.min
  return {
    fecha,
    hayDatos: filas.length > 0,
    // Si el teléfono no informó la pantalla (Android viejo), al menos lo que sumaron las apps.
    pantallaMin: Math.max(filas.reduce((s, f) => s + f.pantalla_min, 0), enApps),
    desbloqueos: filas.reduce((s, f) => s + f.desbloqueos, 0),
    distraccionMin: apps.filter((a) => a.distraccion).reduce((s, a) => s + a.min, 0),
    porCategoria,
    apps: apps.slice(0, 25),
    foco: focoDelTelefono(filas.flatMap((f) => json<[number, number][]>(f.sesiones, [])), filas.flatMap((f) => json<[number, string][]>(f.cambios, [])), (p) => porApp.get(p)?.nombre ?? p),
  }
}

/**
 * El foco en el teléfono (Mobile 2.3), como el del Directo en la compu: el tramo más largo en una sola app sin saltar a
 * otra (dentro de una sesión de pantalla), cuántas veces cambió de app por hora de pantalla, y en qué app fue ese tramo.
 * null si el teléfono no mandó los cambios (un APK viejo).
 */
export function focoDelTelefono(sesiones: [number, number][], cambios: [number, string][], nombre: (p: string) => string = (p) => p): { tramoMasLargoMin: number; app: string | null; cambiosPorHora: number } | null {
  if (!cambios.length) return null
  const cs = [...cambios].filter(([, p]) => !IGNORAR.test(p)).sort((a, b) => a[0] - b[0])
  let mejor = 0, app: string | null = null
  for (let i = 0; i < cs.length; i++) {
    const [t, p] = cs[i]
    // El tramo termina con el próximo cambio o con el fin de su sesión de pantalla, lo que pase primero.
    const ses = sesiones.find(([a, b]) => t >= a - 1000 && t <= b)
    const fin = Math.min(cs[i + 1]?.[0] ?? Infinity, ses?.[1] ?? t)
    if (fin - t > mejor) { mejor = fin - t; app = p }
  }
  const pantallaH = sesiones.reduce((s, [a, b]) => s + Math.max(0, b - a), 0) / 3_600_000
  return { tramoMasLargoMin: Math.round(mejor / 60_000), app: app ? nombre(app) : null, cambiosPorHora: pantallaH > 0 ? Math.round(cs.length / pantallaH) : 0 }
}

/** Varios días (los últimos n): cada día resumido, el promedio y las apps que más se llevaron. */
export function usoDeDias(db: Db, dias = 7, hasta = fechaLocal()) {
  const fechas = Array.from({ length: Math.max(1, Math.min(60, dias)) }, (_, i) => fechaLocal(new Date(`${hasta}T12:00:00`).getTime() - i * 86_400_000)).reverse()
  const cada = fechas.map((f) => usoDelDia(db, f))
  const con = cada.filter((d) => d.hayDatos)
  const total = new Map<string, { nombre: string; min: number; categoria: Categoria; distraccion: boolean }>()
  for (const d of con) for (const a of d.apps) { const x = total.get(a.paquete) ?? { nombre: a.nombre, min: 0, categoria: a.categoria, distraccion: a.distraccion }; x.min += a.min; total.set(a.paquete, x) }
  const prom = (k: 'pantallaMin' | 'distraccionMin' | 'desbloqueos') => (con.length ? Math.round(con.reduce((s, d) => s + d[k], 0) / con.length) : 0)
  return {
    desde: fechas[0], hasta, diasConDatos: con.length,
    promedio: { pantallaMin: prom('pantallaMin'), distraccionMin: prom('distraccionMin'), desbloqueos: prom('desbloqueos') },
    dias: cada.map((d) => ({ fecha: d.fecha, pantallaMin: d.pantallaMin, distraccionMin: d.distraccionMin, desbloqueos: d.desbloqueos, top: d.apps.slice(0, 3).map((a) => `${a.nombre} ${a.min} min`) })),
    apps: [...total.values()].sort((a, b) => b.min - a.min).slice(0, 15),
  }
}

/** Una línea para el Diario o el Hoy: «3 h 10 min de pantalla (1 h 20 en distracción: Instagram 50, YouTube 30); 64 desbloqueos». */
export function lineaDelDia(db: Db, fecha = fechaLocal()): string | null {
  const u = usoDelDia(db, fecha)
  if (!u.hayDatos) return null
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)
  const dis = u.apps.filter((a) => a.distraccion).slice(0, 3).map((a) => `${a.nombre} ${a.min}`).join(', ')
  return `${hm(u.pantallaMin)} de pantalla${u.distraccionMin ? ` (${hm(u.distraccionMin)} en distracción${dis ? `: ${dis}` : ''})` : ''}; ${u.desbloqueos} desbloqueos`
}
