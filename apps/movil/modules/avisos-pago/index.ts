/**
 * Los avisos de pago (Fragua #296): lo que el teléfono guardó de las apps de pago y banco (con el permiso «Acceso a
 * notificaciones»). Fuera de Android (o sin el módulo compilado) no hay.
 */
import { requireOptionalNativeModule } from 'expo'

export type AvisoPago = { paquete: string; app: string; titulo: string; texto: string; en: number }
type Nativo = { tienePermiso(): boolean; abrirPermiso(): boolean; fijarPaquetes(p: string[]): boolean; pendientes(): AvisoPago[]; soltar(hasta: number): number }
const nativo = requireOptionalNativeModule<Nativo>('AvisosPago')

export const hayAvisosPago = () => nativo != null
export const tienePermisoPagos = (): boolean => { try { return nativo?.tienePermiso() ?? false } catch { return false } }
export const abrirPermisoPagos = (): boolean => { try { return nativo?.abrirPermiso() ?? false } catch { return false } }
export const fijarPaquetes = (p: string[]): boolean => { try { return nativo?.fijarPaquetes(p) ?? false } catch { return false } }
export const pendientesPago = (): AvisoPago[] => { try { return nativo?.pendientes() ?? [] } catch { return [] } }
export const soltarPagos = (hasta: number): number => { try { return nativo?.soltar(hasta) ?? 0 } catch { return 0 } }
