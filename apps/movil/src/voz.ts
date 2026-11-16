/**
 * Contestar en voz (Mobile 1.1, Fragua #285): en la charla en vivo desde Hoy, lo que responde Mastropiero se dice en voz
 * alta (el motor de voz del teléfono, sin red). Mientras habla, la escucha no graba: si no, se oiría a sí mismo.
 * Las respuestas se dicen de a una, en orden; sin Markdown ni links (se leen como texto).
 */
import * as Speech from 'expo-speech'
import { paraDecir } from './logica/decir'

let cola: Promise<void> = Promise.resolve()

/** Dice el texto (después de lo que ya se estaba diciendo). alHablar(true) al empezar, alHablar(false) al terminar. */
export function decir(texto: string, alHablar: (si: boolean) => void): Promise<void> {
  const t = paraDecir(texto)
  if (!t) return cola
  cola = cola.then(() => new Promise<void>((listo) => {
    const fin = () => { setTimeout(() => alHablar(false), 600); listo() } // un respiro antes de volver a escuchar
    alHablar(true)
    Speech.speak(t, { language: 'es-AR', rate: 1.02, onDone: fin, onStopped: fin, onError: fin })
  }))
  return cola
}

export function callar() {
  void Speech.stop()
}
