/**
 * Compartir → Deprocast (Mobile 1.3; Fragua #301). Desde cualquier app (una foto, un link de YouTube o Instagram, un
 * texto de WhatsApp, una nota de voz reenviada, un PDF), «Compartir» y elegir Deprocast: lo compartido sale SOLO, apenas
 * llega (sin tocar nada: un archivo compartido apurado no se pierde). Los textos y links van como mensaje a Mastropiero;
 * fotos, videos, audios y documentos, a la cola de archivos (sin red, esperan en el teléfono y salen solos).
 * La pantalla queda para confirmar que salió y, si querés, agregarle una nota después (va a Hoy como mensaje).
 * Lo mismo compartido dos veces en 10 minutos (la app se cerró y volvió a abrir con lo mismo) no se manda de nuevo.
 */
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Credenciales } from '../api'
import { encolar, fijarAjuste, leerAjuste } from '../almacen'
import { encolarCompartidos } from '../archivos'
import { sincronizar } from '../sincronizar'
import { armarCompartido, claveCompartido, type Compartido } from '../logica/archivos'
import { ESP, LETRA, TOQUE, useTema } from '../tema'

const ICONO: Record<string, string> = { text: '💬', url: '🔗', image: '🖼', video: '🎬', audio: '🎧', file: '📄' }

export function Compartir({ c, items, resolviendo, listo }: { c: Credenciales; items: Compartido[]; resolviendo: boolean; listo: (mensaje: string | null) => void }) {
  const t = useTema()
  const [nota, setNota] = useState('')
  const [estado, setEstado] = useState<'preparando' | 'mandando' | 'mandado' | 'error'>('preparando')
  const [resumen, setResumen] = useState('')
  const hecho = useRef(false)
  const hayArchivos = items.some((x) => x.shareType && x.shareType !== 'text' && x.shareType !== 'url')

  // Sale solo, apenas están los archivos listos (Fragua #301).
  useEffect(() => {
    if (hecho.current || (resolviendo && hayArchivos) || !items.length) return
    hecho.current = true
    void (async () => {
      setEstado('mandando')
      try {
        const clave = claveCompartido(items)
        // Lo mismo en los últimos 10 minutos (la app se cerró y volvió con lo mismo): ya salió. Más tarde, sí se manda.
        const [en, ...resto] = ((await leerAjuste('compartido_ultimo')) ?? '').split('|')
        if (resto.join('|') === clave && Date.now() - Number(en) < 10 * 60_000) { setResumen('Esto ya lo habías mandado recién.'); setEstado('mandado'); return }
        const a = armarCompartido(items, null)
        if (a.mensaje) await encolar(a.mensaje)
        const n = a.archivos.length ? await encolarCompartidos(c, a.archivos, null) : 0
        await fijarAjuste('compartido_ultimo', `${Date.now()}|${clave}`)
        void sincronizar(c)
        const partes = [a.mensaje ? 'el mensaje' : null, n ? `${n} archivo${n === 1 ? '' : 's'}` : null].filter(Boolean)
        setResumen(partes.length ? `Mandé ${partes.join(' y ')}${n ? ' (sale con red; lo que resulte aparece en Hoy)' : ''}.` : 'No había nada para mandar.')
        setEstado('mandado')
      } catch (e) {
        setResumen(`No pude mandarlo: ${e instanceof Error ? e.message : String(e)}`)
        setEstado('error')
      }
    })()
  }, [items, resolviendo, hayArchivos, c])

  // La nota, después: va a Hoy como mensaje sobre lo que compartiste.
  const terminar = async () => {
    const x = nota.trim()
    if (x) { await encolar(`(Sobre lo que te compartí recién) ${x}`); void sincronizar(c) }
    listo(estado === 'mandado' ? `📤 ${resumen}${x ? ' Con tu nota.' : ''}` : resumen || null)
  }

  return (
    <View style={[s.raiz, { backgroundColor: t.fondo }]}>
      <View style={s.cab}>
        <Text style={[s.titulo, { color: t.texto }]}>{estado === 'mandado' ? '✓ Mandado a Deprocast' : estado === 'error' ? 'No salió' : 'Mandando a Deprocast…'}</Text>
      </View>
      {resumen ? <Text style={[LETRA.chica, { color: estado === 'error' ? t.mal : t.tenue }]}>{resumen}</Text> : null}
      <ScrollView contentContainerStyle={s.lista}>
        {items.map((x, i) => {
          const tipo = x.shareType ?? 'text'
          const texto = tipo === 'text' || tipo === 'url' ? (x.value ?? '') : (x.originalName ?? x.contentMimeType ?? x.mimeType ?? 'archivo')
          return (
            <View key={i} style={[s.item, { borderColor: t.linea, backgroundColor: t.panel }]}>
              <Text style={LETRA.cuerpo}>{ICONO[tipo] ?? '📄'}</Text>
              <Text style={[LETRA.chica, { color: t.texto, flex: 1 }]} numberOfLines={6}>{texto}</Text>
            </View>
          )
        })}
        {estado === 'preparando' || estado === 'mandando' ? <View style={s.fila}><ActivityIndicator color={t.acento} /><Text style={[LETRA.chica, { color: t.tenue }]}>{estado === 'preparando' ? 'Preparando los archivos…' : 'Mandando…'}</Text></View> : null}
      </ScrollView>
      <TextInput
        value={nota}
        onChangeText={setNota}
        placeholder="¿Una nota? (opcional): para qué es, qué querés que haga"
        placeholderTextColor={t.tenue}
        multiline
        style={[s.nota, { color: t.texto, borderColor: t.linea }]}
        accessibilityLabel="Nota"
      />
      <Pressable onPress={terminar} disabled={estado === 'preparando' || estado === 'mandando'} style={[s.mandar, { backgroundColor: t.acento, opacity: estado === 'preparando' || estado === 'mandando' ? 0.6 : 1 }]} accessibilityRole="button" accessibilityLabel={nota.trim() ? 'Mandar la nota' : 'Listo'}>
        <Text style={[LETRA.cuerpo, { color: t.sobreAcento, fontWeight: '700' }]}>{nota.trim() ? 'Mandar la nota' : 'Listo'}</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  raiz: { flex: 1, padding: ESP(4), gap: ESP(3) },
  cab: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), minHeight: TOQUE },
  titulo: { ...LETRA.titulo, fontWeight: '700', flex: 1 },
  lista: { gap: ESP(2) },
  item: { flexDirection: 'row', gap: ESP(3), borderWidth: 1, borderRadius: 12, padding: ESP(3) },
  fila: { flexDirection: 'row', alignItems: 'center', gap: ESP(2), minHeight: TOQUE },
  nota: { ...LETRA.cuerpo, borderWidth: 1, borderRadius: 12, padding: ESP(3), minHeight: TOQUE * 2, maxHeight: 160 },
  mandar: { minHeight: TOQUE, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
})
