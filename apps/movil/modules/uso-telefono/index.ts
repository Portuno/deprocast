/**
 * El uso del teléfono (Android, con el permiso «Acceso a uso»): pantalla, desbloqueos y tiempo por app entre dos
 * instantes. Fuera de Android (o sin el módulo compilado) no hay: tienePermiso() da false y leer() null.
 */
import { requireOptionalNativeModule } from 'expo'

export type AppCruda = { paquete: string; nombre: string; ms: number; aperturas: number }
export type UsoCrudo = { pantallaMs: number; desbloqueos: number; apps: AppCruda[] }
type Nativo = { tienePermiso(): boolean; abrirPermiso(): boolean; leer(desde: number, hasta: number): Promise<UsoCrudo | null> }

const nativo = requireOptionalNativeModule<Nativo>('UsoTelefono')

export const hayModulo = () => nativo != null
export const tienePermiso = (): boolean => { try { return nativo?.tienePermiso() ?? false } catch { return false } }
export const abrirPermiso = (): boolean => { try { return nativo?.abrirPermiso() ?? false } catch { return false } }
export async function leer(desde: number, hasta: number): Promise<UsoCrudo | null> {
  try { return (await nativo?.leer(desde, hasta)) ?? null } catch { return null }
}
