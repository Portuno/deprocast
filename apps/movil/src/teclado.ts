/**
 * El alto del teclado (Mobile 1.0.1). En Android las apps de Expo van de borde a borde: la ventana ya no se achica
 * cuando aparece el teclado y el KeyboardAvoidingView sin «behavior» dejaba la caja de texto tapada. Se mide el teclado
 * y la pantalla le deja ese lugar abajo.
 */
import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

export function useAltoTeclado(): number {
  const [alto, setAlto] = useState(0)
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const ver = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setAlto(e.endCoordinates.height))
    const tapar = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setAlto(0))
    return () => { ver.remove(); tapar.remove() }
  }, [])
  return alto
}
