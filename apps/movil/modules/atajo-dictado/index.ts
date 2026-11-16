/**
 * El icono rápido «Dictar a Deprocast» (Fragua #300). En Android 13+ la app puede ofrecerlo con un cartel del sistema;
 * en los anteriores se agrega a mano desde la barra (lápiz → arrastrar). Fuera de Android no hay.
 */
import { requireOptionalNativeModule } from 'expo'

type Nativo = { puedeOfrecer(): boolean; ofrecer(): boolean }
const nativo = requireOptionalNativeModule<Nativo>('AtajoDictado')

export const hayAtajo = () => nativo != null
export const puedeOfrecerAtajo = (): boolean => { try { return nativo?.puedeOfrecer() ?? false } catch { return false } }
export const ofrecerAtajo = (): boolean => { try { return nativo?.ofrecer() ?? false } catch { return false } }
