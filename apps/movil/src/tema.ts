/**
 * El tema de Deprocast en el teléfono: los colores (los mismos de web/estilo.css), oscuro y claro según el teléfono, y
 * desde Mobile 1.0 (bloque 3) un solo sistema para todo lo demás:
 * - LETRA: cuatro tamaños y ninguno más (con su interlineado);
 * - ESP: el espaciado, siempre en múltiplos de 4;
 * - TOQUE: nada que se toca mide menos de 44 px (o se le agranda el área con hitSlop).
 * El claro sube el contraste del texto secundario para leerse al sol.
 */
import { useColorScheme } from 'react-native'

const OSCURO = { fondo: '#0f1012', panel: '#16171a', linea: '#2e3036', texto: '#ececee', tenue: '#a3a5ad', acento: '#c9a566', sobreAcento: '#0f1012', mal: '#e08080', ok: '#6fbb8c' }
const CLARO = { fondo: '#f7f6f3', panel: '#ffffff', linea: '#d9d6cf', texto: '#141416', tenue: '#4f5157', acento: '#7a5c22', sobreAcento: '#ffffff', mal: '#a33a3a', ok: '#226b43' }
export type Tema = typeof OSCURO

export const useTema = (): Tema => (useColorScheme() === 'light' ? CLARO : OSCURO)

/** Los cuatro tamaños de letra (y su interlineado). No hay otros. */
export const LETRA = {
  chica: { fontSize: 13, lineHeight: 18 },
  cuerpo: { fontSize: 16, lineHeight: 22 },
  titulo: { fontSize: 22, lineHeight: 28 },
  grande: { fontSize: 28, lineHeight: 34 },
} as const

/** El espaciado: múltiplos de 4 (ESP(3) = 12). */
export const ESP = (n: number) => n * 4

/** El tamaño mínimo de lo que se toca. */
export const TOQUE = 44
/** Para lo chico que se toca (un chip): agranda el área tocable sin agrandar el dibujo. */
export const AREA_EXTRA = { top: 10, bottom: 10, left: 8, right: 8 }
