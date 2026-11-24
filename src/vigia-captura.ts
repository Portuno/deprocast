/**
 * El vigía de la captura (Mobile 2.2): si el teléfono deja de mandar (ni un pedido, ni un punto, ni la carga) por más de
 * 3 horas de día, Mastropiero lo dice en Hoy, una vez por silencio. Antes se descubría al otro día, mirando un mapa vacío.
 * Casi siempre es Android (Huawei en especial) cerrando la app: el aviso dice cómo evitarlo.
 * Solo los teléfonos que venían mandando (algo en los últimos 3 días); de noche (23 a 9) no avisa.
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'

const HORA = 3_600_000
export const SILENCIO = 3 * HORA

const existe = (db: Db, tabla: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tabla)
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)

/** La última señal de cada teléfono vinculado (un pedido o un dato suyo). */
export function ultimasSenales(db: Db): { id: number; nombre: string; ultima: number }[] {
  const telefonos = db.prepare(`SELECT id, nombre, ultima_vez FROM dispositivos WHERE revocado_en IS NULL AND COALESCE(tipo, 'telefono') = 'telefono'`).all() as { id: number; nombre: string; ultima_vez: number | null }[]
  return telefonos.map((t) => {
    const f = `disp:${t.id}`
    const max = (sql: string, ...p: (string | number)[]) => Number((db.prepare(sql).get(...p) as { n: number | null } | undefined)?.n ?? 0)
    const ultima = Math.max(
      t.ultima_vez ?? 0,
      existe(db, 'recorrido_puntos') ? max('SELECT MAX(en) AS n FROM recorrido_puntos WHERE fuente = ?', f) : 0,
      existe(db, 'carga_telefono') ? max('SELECT MAX(en) AS n FROM carga_telefono WHERE fuente = ?', f) : 0,
      existe(db, 'voz_turnos') ? max('SELECT MAX(creado_en) AS n FROM voz_turnos WHERE dispositivo_id = ?', t.id) : 0,
    )
    return { id: t.id, nombre: t.nombre, ultima }
  })
}

/** ¿Hay que avisar? El teléfono en silencio (o null). */
export function telefonoCallado(db: Db, ahora = Date.now()): { id: number; nombre: string; ultima: number } | null {
  const h = new Date(ahora).getHours()
  if (h < 9 || h >= 23) return null
  for (const t of ultimasSenales(db)) {
    if (!t.ultima || ahora - t.ultima < SILENCIO || ahora - t.ultima > 3 * 24 * HORA) continue
    if (Number(ajuste(db, `vigia_captura_${t.id}`) ?? 0) === t.ultima) continue // este silencio ya se avisó
    return t
  }
  return null
}

/** Una pasada: avisa en Hoy (una vez por silencio). Devuelve el texto avisado, o null. */
export async function vigilarCaptura(db: Db, ahora = Date.now()): Promise<string | null> {
  const t = telefonoCallado(db, ahora)
  if (!t) return null
  fijarAjuste(db, `vigia_captura_${t.id}`, String(t.ultima))
  const horas = Math.floor((ahora - t.ultima) / HORA)
  const texto = `📵 «${t.nombre}» no manda nada desde las ${hm(t.ultima)} (hace ${horas} h): ni recorrido, ni pasos, ni la escucha. Si no lo apagaste, Android cerró Deprocast. Abrí la app un momento; y para que no vuelva a pasar en Huawei: Ajustes → Batería → Inicio de aplicaciones → Deprocast → «Gestionar manualmente», con las tres opciones prendidas.`
  const c = await import('./chat/index.ts')
  c.mensajeDeMastropiero(db, c.conversacionHoy(db).id, texto)
  return texto
}
