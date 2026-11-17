/**
 * La tarea de fondo (Mobile 1.3): Android la despierta cada ~15 minutos (cuando puede: con batería y red), aunque la app
 * esté cerrada. En cada pasada: lee el contador de pasos, manda el uso del teléfono y revisa los avisos (programa los
 * eventos y recordatorios que vienen y avisa lo nuevo de Mastropiero).
 *
 * Tiene que estar definida apenas arranca la app: este archivo se importa desde index.ts.
 */
import * as TaskManager from 'expo-task-manager'
import * as BackgroundTask from 'expo-background-task'
import { leerCredenciales } from './api'
import { ajustesCaptura } from './captura'
import { avisa, capta } from './logica/captura'
import { leerContador, subirPasos, cuentaConLaAppCerrada } from './pasos'
import { subirUsoTelefono, tienePermisoUso } from './uso'
import { revisarAvisos } from './avisos'
import { subirPagos, tienePermisoPagos } from './pagos'

export const TAREA_FONDO = 'deprocast-fondo'

TaskManager.defineTask(TAREA_FONDO, async () => {
  try {
    const a = await ajustesCaptura()
    if (capta(a, 'pasos')) await leerContador().catch(() => 0)
    const c = await leerCredenciales()
    if (!c) return BackgroundTask.BackgroundTaskResult.Success
    if (capta(a, 'pasos')) await subirPasos(c).catch(() => {})
    await subirUsoTelefono(c, { forzar: true }).catch(() => null)
    await subirPagos(c).catch(() => {})
    if (avisa(a)) await revisarAvisos(c, { forzar: true }).catch(() => {})
    return BackgroundTask.BackgroundTaskResult.Success
  } catch { return BackgroundTask.BackgroundTaskResult.Failed }
})

/** ¿Hace falta la tarea? (algo de lo que hace está prendido y es posible en este teléfono). */
async function hayQueHacer(): Promise<boolean> {
  const a = await ajustesCaptura()
  return (capta(a, 'pasos') && cuentaConLaAppCerrada()) || (capta(a, 'uso') && tienePermisoUso()) || (capta(a, 'pagos') && tienePermisoPagos()) || avisa(a)
}

/** La registra (o la saca si no hace falta). Se llama al abrir y al cambiar los ajustes. */
export async function registrarFondo() {
  try {
    const registrada = await TaskManager.isTaskRegisteredAsync(TAREA_FONDO)
    if (await hayQueHacer()) { if (!registrada) await BackgroundTask.registerTaskAsync(TAREA_FONDO, { minimumInterval: 15 }) }
    else if (registrada) await BackgroundTask.unregisterTaskAsync(TAREA_FONDO)
  } catch { /* sin tareas de fondo: todo corre al abrir la app */ }
}
