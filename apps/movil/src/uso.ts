/**
 * Tu tiempo en el teléfono (Mobile 1.3). Con el permiso «Acceso a uso» (se da una vez en los ajustes de Android), la app
 * lee cuánto estuvo prendida la pantalla, cuántas veces lo desbloqueaste y cuánto pasaste en cada app (nunca lo que hay
 * adentro), y lo manda a Deprocast: hoy y ayer, el día entero recalculado cada vez (el servidor reemplaza, no suma).
 * Corre al abrir la app y en la tarea de fondo (cada ~15 minutos).
 */
import * as Uso from '../modules/uso-telefono'
import { subirUso, type Credenciales } from './api'
import { ajustesCaptura } from './captura'
import { capta } from './logica/captura'
import { rangoDelDia, resumirUso, type DiaUso } from './logica/uso'

const fechaDe = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export const hayModuloUso = Uso.hayModulo
export const tienePermisoUso = Uso.tienePermiso
export const abrirPermisoUso = Uso.abrirPermiso

let ultimo = 0
/** Lee hoy y ayer y los manda. Sin permiso, sin el ajuste o hace menos de 10 minutos (salvo forzar): nada. */
export async function subirUsoTelefono(c: Credenciales, o: { forzar?: boolean } = {}): Promise<DiaUso | null> {
  if (!capta(await ajustesCaptura(), 'uso') || !Uso.tienePermiso()) return null
  if (!o.forzar && Date.now() - ultimo < 10 * 60_000) return null
  const ahora = Date.now()
  const dias: DiaUso[] = []
  for (const f of [fechaDe(ahora - 86_400_000), fechaDe(ahora)]) {
    const [desde, hasta] = rangoDelDia(f, ahora)
    const crudo = await Uso.leer(desde, hasta)
    if (crudo) dias.push(resumirUso(f, crudo))
  }
  if (!dias.length) return null
  await subirUso(c, dias)
  ultimo = ahora
  return dias[dias.length - 1]
}
