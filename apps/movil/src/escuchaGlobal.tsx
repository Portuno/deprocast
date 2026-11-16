/**
 * La escucha es de la app, no de una pantalla (Mobile 1.1, Fragua #283). Antes vivía dentro de la pestaña Escucha: al
 * pasar a Hoy o al Mapa la pantalla se desmontaba y el micrófono se apagaba, aunque la interfaz dijera que escuchaba.
 * Ahora hay una sola, arriba de todo, y cada pantalla la lee de acá (Escucha la maneja; Hoy la muestra y la usa para
 * charlar en vivo).
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { sincronizar } from './sincronizar'
import type { Credenciales } from './api'
import { useEscucha } from './escucha'

type Escucha = ReturnType<typeof useEscucha>
const Contexto = createContext<Escucha | null>(null)

export function EscuchaGlobal({ c, children }: { c: Credenciales; children: ReactNode }) {
  const escucha = useEscucha(c)
  // Charlando con la pantalla apagada: las respuestas tienen que llegar igual (la sincronización de siempre solo corre con
  // la app a la vista). Mientras escucha, cada 8 s también en el fondo (el aviso fijo mantiene viva la app).
  useEffect(() => {
    if (!escucha.activa) return
    const x = setInterval(() => { if (AppState.currentState !== 'active') void sincronizar(c) }, 8_000)
    return () => clearInterval(x)
  }, [escucha.activa, c])
  return <Contexto.Provider value={escucha}>{children}</Contexto.Provider>
}

export function useEscuchaGlobal(): Escucha {
  const e = useContext(Contexto)
  if (!e) throw new Error('La escucha se usa adentro de <EscuchaGlobal>')
  return e
}
