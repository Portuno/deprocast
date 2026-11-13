/**
 * El rescate (plan v38, fase 6; Fragua #157): lo primero que hace un teléfono recién vinculado. Junta lo que trae
 * (lo que quedó sin enviar y, si lo elegís, tus fotos recientes y tus contactos), lo sube crudo a tu Deprocast (que
 * guarda una copia y otra en tu Drive) y recién cuando todo está a salvo le dice que lo procese. Si algo falla a mitad
 * de camino, se reintenta: lo que ya subió no se vuelve a subir.
 */
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { cerrarRescate, inventariar, subirItem, type Credenciales, type ItemRescate } from '../api'
import { colasCompletas, sacarDeCola, sacarVoz } from '../almacen'
import { ESP, LETRA, TOQUE, useTema } from '../tema'

const DIAS_FOTOS = 30
const MAX_FOTOS = 500

type Origen = { item: ItemRescate; cuerpo: () => Promise<{ uri: string; tipo?: string } | { texto: string }>; despues?: () => Promise<void> }

export function Rescate({ c, alTerminar }: { c: Credenciales; alTerminar: () => void }) {
  const t = useTema()
  const [fotos, setFotos] = useState(false)
  const [contactos, setContactos] = useState(false)
  const [paso, setPaso] = useState<string | null>(null)
  const [hecho, setHecho] = useState({ n: 0, de: 0 })
  const [error, setError] = useState<string | null>(null)
  const [corriendo, setCorriendo] = useState(false)

  /** Lo que trae este teléfono, con cómo se sube cada cosa. */
  const juntar = async (): Promise<Origen[]> => {
    const out: Origen[] = []
    const { textos, voces } = await colasCompletas()
    for (const x of textos) out.push({ item: { clave: `texto:${x.id}:${x.en}`, tipo: 'mensaje', nombre: 'mensaje.txt', fecha: x.en }, cuerpo: async () => ({ texto: x.texto }), despues: () => sacarDeCola(x.id) })
    for (const v of voces) {
      const meta = (() => { try { return JSON.parse(v.meta) } catch { return {} } })()
      out.push({
        item: { clave: `voz:${v.id}:${meta.inicio ?? ''}`, tipo: 'audio', nombre: 'voz.wav', fecha: meta.inicio, meta }, cuerpo: async () => ({ uri: v.uri, tipo: 'audio/wav' }),
        despues: async () => { await sacarVoz(v.id); try { new (await import('expo-file-system')).File(v.uri).delete() } catch { /* ya no está */ } },
      })
    }
    if (fotos) {
      setPaso('Buscando tus fotos…')
      const ML = await import('expo-media-library/legacy')
      if (!(await ML.requestPermissionsAsync()).granted) throw new Error('Sin permiso para ver tus fotos: destildá «Fotos» o dalo en Ajustes.')
      const r = await ML.getAssetsAsync({ mediaType: ML.MediaType.photo, first: MAX_FOTOS, createdAfter: Date.now() - DIAS_FOTOS * 86_400_000, sortBy: [[ML.SortBy.creationTime, false]] })
      for (const a of r.assets) out.push({
        item: { clave: `foto:${a.id}`, tipo: 'foto', nombre: a.filename, fecha: a.creationTime, meta: { ancho: a.width, alto: a.height } },
        cuerpo: async () => { const info = await ML.getAssetInfoAsync(a); if (!info.localUri) throw new Error(`No pude leer ${a.filename}`); return { uri: info.localUri, tipo: /\.png$/i.test(a.filename) ? 'image/png' : 'image/jpeg' } },
      })
    }
    if (contactos) {
      setPaso('Leyendo tus contactos…')
      const C = await import('expo-contacts/legacy')
      if (!(await C.requestPermissionsAsync()).granted) throw new Error('Sin permiso para ver tus contactos: destildá «Contactos» o dalo en Ajustes.')
      const { data } = await C.getContactsAsync({ fields: [C.Fields.Name, C.Fields.PhoneNumbers, C.Fields.Emails] })
      const lista = data.map((x) => ({ nombre: x.name, telefonos: (x.phoneNumbers ?? []).map((p) => p.number).filter(Boolean), mails: (x.emails ?? []).map((m) => m.email).filter(Boolean) }))
      const hoy = new Date().toISOString().slice(0, 10)
      out.push({ item: { clave: `contactos:${hoy}`, tipo: 'contactos', nombre: `contactos-${hoy}.json`, fecha: Date.now(), meta: { cuantos: lista.length } }, cuerpo: async () => ({ texto: JSON.stringify(lista) }) })
    }
    return out
  }

  const rescatar = async () => {
    setCorriendo(true)
    setError(null)
    try {
      const origenes = await juntar()
      setPaso('Anotando lo que hay…')
      const inv = await inventariar(c, origenes.map((o) => o.item))
      const faltan = new Set(inv.faltan)
      const subir = origenes.filter((o) => faltan.has(o.item.clave))
      setHecho({ n: 0, de: subir.length })
      const fallaron: string[] = []
      for (const [i, o] of subir.entries()) {
        setPaso(`Subiendo ${o.item.nombre}…`)
        try {
          const cu = await o.cuerpo()
          await subirItem(c, o.item.clave, 'uri' in cu ? { uri: cu.uri } : cu, 'uri' in cu ? cu.tipo : undefined)
          await o.despues?.()
        } catch (e) { fallaron.push(`${o.item.nombre}: ${e instanceof Error ? e.message : String(e)}`) }
        setHecho({ n: i + 1, de: subir.length })
      }
      // Lo que ya estaba a salvo de antes (un intento anterior) también sale de las colas del teléfono.
      for (const o of origenes) if (!faltan.has(o.item.clave)) await o.despues?.()
      if (fallaron.length) throw new Error(`No pude subir ${fallaron.length}: ${fallaron[0]}. Tocá «Rescatar» de nuevo (lo que ya subió no se repite).`)
      setPaso('Todo a salvo. Procesando…')
      await cerrarRescate(c)
      alTerminar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPaso(null)
    } finally { setCorriendo(false) }
  }

  const opcion = (titulo: string, detalle: string, valor: boolean, cambiar: (v: boolean) => void) => (
    <View style={[s.fila, { borderColor: t.linea }]}>
      <View style={{ flex: 1 }}><Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '600' }]}>{titulo}</Text><Text style={[s.chico, { color: t.tenue }]}>{detalle}</Text></View>
      <Switch value={valor} onValueChange={cambiar} disabled={corriendo} trackColor={{ true: t.acento }} />
    </View>
  )
  return (
    <ScrollView style={{ backgroundColor: t.fondo }} contentContainerStyle={s.raiz}>
      <Text style={[s.titulo, { color: t.texto }]}>Primero, el rescate</Text>
      <Text style={[s.texto, { color: t.tenue }]}>Antes de procesar nada, lo que trae este teléfono se guarda crudo en tu Deprocast (y una copia en tu Drive, si está conectado). Si algo falla o el teléfono se pierde, el material no se pierde.</Text>
      <View style={[s.tarjeta, { backgroundColor: t.panel, borderColor: t.linea }]}>
        <Text style={[LETRA.cuerpo, { color: t.texto, fontWeight: '600' }]}>Siempre</Text>
        <Text style={[s.chico, { color: t.tenue }]}>Lo que haya quedado sin enviar en este teléfono (mensajes y voces).</Text>
      </View>
      {opcion('Fotos', `Las de los últimos ${DIAS_FOTOS} días (hasta ${MAX_FOTOS}). Quedan en tu Drive; no se mandan al modelo.`, fotos, setFotos)}
      {opcion('Contactos', 'Los que no estén entre tus personas entran como personas nuevas, con su teléfono y su mail.', contactos, setContactos)}
      {paso ? <Text style={[s.texto, { color: t.acento }]}>{paso}{hecho.de ? ` (${hecho.n} de ${hecho.de})` : ''}</Text> : null}
      {error ? <Text style={[s.texto, { color: t.mal }]}>{error}</Text> : null}
      <Pressable onPress={rescatar} disabled={corriendo} style={[s.boton, { backgroundColor: t.acento, opacity: corriendo ? 0.6 : 1 }]} accessibilityRole="button">
        {corriendo ? <ActivityIndicator color={t.sobreAcento} /> : <Text style={[s.botonTexto, { color: t.sobreAcento }]}>Rescatar y empezar</Text>}
      </Pressable>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  raiz: { padding: ESP(5), gap: ESP(3) },
  titulo: { ...LETRA.titulo, fontWeight: '700' },
  texto: { ...LETRA.cuerpo },
  chico: { ...LETRA.chica, marginTop: ESP(1) },
  tarjeta: { borderWidth: 1, borderRadius: 12, padding: ESP(4) },
  fila: { flexDirection: 'row', alignItems: 'center', gap: ESP(3), borderTopWidth: 1, paddingVertical: ESP(3), minHeight: TOQUE },
  boton: { marginTop: ESP(2), minHeight: TOQUE, justifyContent: 'center', borderRadius: 10, paddingVertical: ESP(3), alignItems: 'center' },
  botonTexto: { ...LETRA.cuerpo, fontWeight: '700' },
})
