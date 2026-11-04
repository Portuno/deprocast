/** Los colores de Deprocast (los mismos de web/estilo.css), oscuro y claro según el teléfono. */
import { useColorScheme } from 'react-native'

const OSCURO = { fondo: '#0f1012', panel: '#16171a', linea: '#26282d', texto: '#e6e6e8', tenue: '#9a9ca4', acento: '#c4a062', sobreAcento: '#0f1012', mal: '#d27272', ok: '#67b083' }
const CLARO = { fondo: '#f5f4f1', panel: '#ffffff', linea: '#e3e1db', texto: '#1d1d1f', tenue: '#6b6d74', acento: '#8a6a2e', sobreAcento: '#ffffff', mal: '#ad4444', ok: '#287a4c' }
export type Tema = typeof OSCURO

export const useTema = (): Tema => (useColorScheme() === 'light' ? CLARO : OSCURO)
