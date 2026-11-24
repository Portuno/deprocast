/**
 * Los módulos de la app (Mobile 2.0): un solo lugar con su nombre, su ícono y para qué sirve. La barra de abajo muestra
 * cuatro; el Menú, todos.
 */
export type Modulo = 'hoy' | 'mapa' | 'escucha' | 'menu' | 'validar' | 'actividad' | 'audios' | 'captura'

export const MODULOS: Record<Modulo, { nombre: string; icono: string; para: string }> = {
  hoy: { nombre: 'Hoy', icono: '💬', para: 'Charlar con Mastropiero' },
  mapa: { nombre: 'Mapa', icono: '🗺', para: 'Por dónde anduviste' },
  escucha: { nombre: 'Escucha', icono: '🎙', para: 'Tu voz y tus charlas' },
  menu: { nombre: 'Menú', icono: '☰', para: 'Todo' },
  validar: { nombre: 'Validar', icono: '✅', para: 'Lo que espera tu ok' },
  actividad: { nombre: 'Actividad', icono: '🚶', para: 'Pasos y uso del teléfono' },
  audios: { nombre: 'Audios', icono: '🎧', para: 'Lo grabado, en el teléfono' },
  captura: { nombre: 'Permisos', icono: '⚙', para: 'Qué capta y qué no' },
}

/** Los fijos de abajo. */
export const BARRA: Modulo[] = ['hoy', 'mapa', 'escucha', 'menu']
/** Los del Menú, en orden. */
export const EN_MENU: Modulo[] = ['hoy', 'mapa', 'escucha', 'validar', 'actividad', 'audios', 'captura']
