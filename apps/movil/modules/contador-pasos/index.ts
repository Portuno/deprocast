/**
 * El contador de pasos de hardware del teléfono (Android): el total desde que se prendió, que cuenta aunque la app esté
 * cerrada. Fuera de Android (o en una app sin el módulo compilado) no hay: disponible() da false y leer() null.
 */
import { requireOptionalNativeModule } from 'expo'

export type Lectura = { total: number; arranque: number; en: number }
type Nativo = { disponible(): boolean; leer(): Promise<Lectura | null> }

const nativo = requireOptionalNativeModule<Nativo>('ContadorPasos')

export const disponible = (): boolean => { try { return nativo?.disponible() ?? false } catch { return false } }
export async function leer(): Promise<Lectura | null> {
  try { return (await nativo?.leer()) ?? null } catch { return null }
}
