/**
 * Un solo reproductor para los audios guardados (Mobile 2.0): tocar uno corta el que sonaba; tocar el mismo lo para.
 * Mientras suena, la escucha no graba (si no, se grabaría a sí misma).
 */
import { useEffect, useState } from 'react'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'

let player: AudioPlayer | null = null
let actual: string | null = null
let alSonar: ((si: boolean) => void) | null = null
const escuchas = new Set<(id: string | null) => void>()
const avisar = () => { for (const f of escuchas) f(actual) }

export function parar() {
  try { player?.pause() } catch { /* ya estaba parado */ }
  actual = null
  alSonar?.(false)
  avisar()
}

/** Toca un audio (o lo para, si ya sonaba). silenciar: la escucha deja de grabar mientras suena. */
export function tocar(id: string, uri: string, silenciar?: (si: boolean) => void) {
  if (actual === id) return parar()
  try {
    if (!player) {
      player = createAudioPlayer(null)
      player.addListener('playbackStatusUpdate', (st) => { if (st.didJustFinish) parar() })
    }
    alSonar = silenciar ?? null
    player.replace({ uri })
    player.play()
    actual = id
    alSonar?.(true)
    avisar()
  } catch { parar() }
}

/** El id del audio que está sonando (o null). */
export function useSonando(): string | null {
  const [id, setId] = useState<string | null>(actual)
  useEffect(() => { escuchas.add(setId); return () => { escuchas.delete(setId) } }, [])
  return id
}
