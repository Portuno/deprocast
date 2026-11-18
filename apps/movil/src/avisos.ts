/**
 * Avisos en el teléfono (Mobile 1.3), sin Firebase: todo son avisos locales que programa la app.
 * - Los eventos del calendario (unos minutos antes) y los recordatorios que le pediste a Mastropiero: el servidor dice
 *   qué viene en las próximas 36 horas y el teléfono los programa a su hora exacta (suenan aunque no haya red).
 * - Lo nuevo de Mastropiero en Hoy y lo que espera tu ok: con la app cerrada, la tarea de fondo (cada ~15 minutos) se
 *   fija si cambió algo desde lo último que viste y te avisa. Con la app abierta no avisa (ya lo estás viendo).
 * Tocar un aviso abre la app en Hoy.
 */
import { AppState, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { traerAvisos, traerHoy, traerMarca, type Credenciales } from './api'
import { actualizarWidget } from '../modules/widget-hoy'
import { fijarAjuste, guardarPaquete, leerAjuste, leerChat } from './almacen'
import { ajustesCaptura } from './captura'
import { avisa } from './logica/captura'
import { masParaValidar, nuevosDeMastropiero, planDeAvisos } from './logica/avisos'

const CANAL = 'deprocast'
const num = (s: string | null) => (s == null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s))

let configurado = false
async function configurar() {
  if (configurado) return
  configurado = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  })
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CANAL, { name: 'Deprocast', importance: Notifications.AndroidImportance.HIGH }).catch(() => {})
}

/** ¿Puede avisar? (el ajuste y el permiso). pedir: lo pide si falta (solo con la app abierta). */
export async function puedeAvisar(pedir = false): Promise<boolean> {
  if (!avisa(await ajustesCaptura())) return false
  try {
    const p = await Notifications.getPermissionsAsync()
    if (p.granted) return true
    if (!pedir || p.canAskAgain === false) return false
    return (await Notifications.requestPermissionsAsync()).granted
  } catch { return false }
}

async function mostrar(titulo: string, cuerpo: string) {
  await Notifications.scheduleNotificationAsync({ content: { title: titulo, body: cuerpo, data: { ir: 'hoy' } }, trigger: Platform.OS === 'android' ? { channelId: CANAL } : null })
}

/** Programa los eventos y recordatorios que vienen (y cancela los que ya no están). */
async function programar(c: Credenciales) {
  const { avisos, ahora, paraValidar } = await traerAvisos(c)
  // El widget de la pantalla de inicio (si lo puso): lo de ahora y lo que espera su ok, con lo que acaba de llegar.
  if (ahora) actualizarWidget({ titulo: ahora.titulo, sub: ahora.sub, validar: paraValidar ?? 0 })
  const programados = (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier)
  const plan = planDeAvisos(programados, avisos)
  for (const id of plan.cancelar) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
  // Lo que ya está programado a la misma hora no se toca.
  let hechos: Record<string, number> = {}
  try { hechos = JSON.parse((await leerAjuste('avisos_programados')) ?? '{}') } catch { hechos = {} }
  const ya = new Set(programados)
  const nuevos: Record<string, number> = {}
  for (const a of plan.programar) {
    nuevos[a.clave] = a.en
    if (ya.has(a.clave) && hechos[a.clave] === a.en) continue
    if (ya.has(a.clave)) await Notifications.cancelScheduledNotificationAsync(a.clave).catch(() => {})
    await Notifications.scheduleNotificationAsync({
      identifier: a.clave,
      content: { title: a.titulo, body: a.cuerpo, data: { ir: 'hoy' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: a.en, ...(Platform.OS === 'android' ? { channelId: CANAL } : {}) },
    }).catch(() => {})
  }
  await fijarAjuste('avisos_programados', JSON.stringify(nuevos))
}

/** Lo nuevo de Mastropiero y lo que espera tu ok, si la app no está a la vista. */
async function novedades(c: Credenciales) {
  const marca = await traerMarca(c)
  if (marca.marca === (await leerAjuste('aviso_marca'))) return
  const p = await traerHoy(c)
  await guardarPaquete(p).catch(() => false)
  const m = nuevosDeMastropiero(p.mensajes, num(await leerAjuste('aviso_ultimo_msg')))
  const v = masParaValidar(num(await leerAjuste('aviso_validar')), p.paraValidar)
  if (AppState.currentState !== 'active') {
    if (m.aviso) await mostrar(m.aviso.titulo, m.aviso.cuerpo)
    if (v) await mostrar(v.titulo, v.cuerpo)
  }
  await fijarAjuste('aviso_ultimo_msg', String(m.ultimo))
  await fijarAjuste('aviso_validar', String(p.paraValidar))
  await fijarAjuste('aviso_marca', p.marca ?? marca.marca)
}

let ultimaRevision = 0
/** Una pasada: programa lo que viene y, con la app cerrada, avisa lo nuevo. A lo sumo una por minuto (salvo forzar). */
export async function revisarAvisos(c: Credenciales, o: { forzar?: boolean } = {}) {
  if (!o.forzar && Date.now() - ultimaRevision < 60_000) return
  if (!(await puedeAvisar())) return
  ultimaRevision = Date.now()
  await configurar()
  await programar(c).catch(() => {})
  await novedades(c).catch(() => {})
}

/** Lo que ya viste con la app abierta no se avisa después: al irte, queda como visto. */
async function marcarVisto() {
  const l = await leerChat()
  const ultimo = l.mensajes.reduce((m, x) => (/^s\d+$/.test(x.id) ? Math.max(m, Number(x.id.slice(1))) : m), 0)
  if (ultimo) await fijarAjuste('aviso_ultimo_msg', String(Math.max(ultimo, num(await leerAjuste('aviso_ultimo_msg')) ?? 0)))
  await fijarAjuste('aviso_validar', String(l.paraValidar))
}

let registrado = false
/** Al abrir: pide el permiso (si falta y está el ajuste), configura y hace una pasada. */
export async function registrarAvisos(c: Credenciales) {
  if (!(await puedeAvisar(true))) return
  await configurar()
  if (!registrado) {
    registrado = true
    AppState.addEventListener('change', (s) => { if (s === 'background') void marcarVisto().catch(() => {}) })
  }
  await marcarVisto().catch(() => {})
  await revisarAvisos(c, { forzar: true })
}
