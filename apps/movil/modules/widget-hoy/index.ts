/**
 * El widget de Deprocast en la pantalla de inicio (Android): lo de ahora (la banda en curso o lo próximo de la agenda),
 * cuántas cosas esperan tu ok, y dos botones: Dictar (abre la escucha) y Validar (abre la tanda). La app le pasa lo que
 * muestra cada vez que habla con Deprocast (al abrir y de fondo, cada ~15 minutos); el widget no pide nada solo.
 * Fuera de Android no hay.
 */
import { requireOptionalNativeModule } from 'expo'

type Nativo = { actualizar(titulo: string, sub: string, validar: number): boolean }
const nativo = requireOptionalNativeModule<Nativo>('WidgetHoy')

export const hayWidget = () => nativo != null
export const actualizarWidget = (d: { titulo: string; sub: string; validar: number }): boolean => {
  try { return nativo?.actualizar(d.titulo.slice(0, 80), d.sub.slice(0, 80), Math.max(0, Math.round(d.validar))) ?? false } catch { return false }
}
