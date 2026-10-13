/**
 * La captura: lo que él manda (una foto con o sin explicación, o un texto como «almorcé milanesa con ensalada» o
 * «gasté 12 € en el súper») se clasifica y se registra solo, en su lugar: comidas, ejercicio, sueño y peso en Salud;
 * gastos e ingresos en Finanzas. Lo que no es un registro (una charla, una pregunta) vuelve como «otro» y sigue a la
 * conversación. Una sola llamada: visión si hay foto, texto si no.
 */
import { fechaLocal, type Db } from './db.ts'
import { nanVision } from './nan.ts'
import { leerJson, pedirJson } from './modelo.ts'
import { borrarSalud, metasSalud, registrarSalud, resumenDia } from './salud.ts'
import { registrarMovimiento, CATEGORIAS } from './finanzas.ts'

export const TIPOS_CAPTURA = ['comida', 'ejercicio', 'sueno', 'medida', 'gasto', 'ingreso', 'aprendizaje', 'otro'] as const
export type Captura = {
  tipo: (typeof TIPOS_CAPTURA)[number]
  confianza: number
  fecha: string | null
  hora: string | null
  titulo: string
  /** Lo que se ve en la foto, en una o dos oraciones (para la charla si no es un registro). */
  descripcion: string
  datos: Record<string, any>
}

const SISTEMA = `Clasificás lo que el jugador le manda a su asistente (una foto, un texto, o los dos) para registrarlo solo. JSON.
- tipo:
  comida (lo que comió o va a comer: un plato, un paquete, un menú que dice que pidió),
  ejercicio (un entrenamiento, una caminata, una captura de una app de deporte),
  sueno (cuánto o cómo durmió),
  medida (su peso, una balanza, medidas del cuerpo),
  gasto (un ticket, una factura, «gasté», «pagué»), ingreso («cobré», «me pagaron», una transferencia recibida),
  aprendizaje (lo que estudió o practicó: «estudié 30 min de X», apuntes de una clase),
  otro (cualquier otra cosa: una charla, una pregunta, un pedido, una foto que no es un registro).
- confianza: 0 a 1. Si dudás entre registro y charla, «otro».
- fecha: YYYY-MM-DD solo si la dice o se lee («ayer», la fecha del ticket); si no, null. hora: HH:MM si la dice o se lee; si no, null.
- titulo: corto. Para comida empezá con Desayuno, Almuerzo, Merienda, Cena o Snack y qué fue («Almuerzo: pollo con arroz»).
- descripcion: lo que se ve o se entiende, en una o dos oraciones.
- datos según el tipo (números, sin unidades):
  comida: {"items": [string], "kcal": number, "proteina": number, "carbos": number, "grasa": number} — estimá porciones con lo que se ve y lo que dice; gramos de macros; redondeá.
  ejercicio: {"minutos": number, "intensidad": "suave"|"media"|"fuerte", "distancia_km": number|null, "kcal": number|null, "que": string}
  sueno: {"horas": number, "calidad": 1|2|3 (mal, bien, muy bien) | null}
  medida: {"peso": number|null, "grasa_corporal": number|null, "cintura": number|null}
  gasto o ingreso: {"monto": number (positivo), "moneda": "EUR"|"USD"|"ARS"|…, "comercio": string, "categoria": una de ${CATEGORIAS.join(', ')}, "proyecto": string|null (si dice para qué proyecto o persona)}
  aprendizaje: {"tema": string, "minutos": number|null, "que": string}
  otro: {}
Forma: {"tipo": string, "confianza": number, "fecha": string|null, "hora": string|null, "titulo": string, "descripcion": string, "datos": object}`

let modelo = async (db: Db, o: { imagen?: { datos: Buffer; mime: string }; texto: string }): Promise<any> => {
  if (o.imagen) {
    const r = await nanVision({ db, clase: 'mastropiero', agenteId: 'captura' }, { sistema: SISTEMA, texto: o.texto || 'Te mandó esta foto, sin texto.', imagen: `data:${o.imagen.mime};base64,${o.imagen.datos.toString('base64')}`, maxTokens: 1500 })
    return leerJson(r.texto)
  }
  return (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'captura' }, SISTEMA, o.texto, { temperatura: 0.1, maxTokens: 1200 })).datos
}
export function _probarCaptura(f: typeof modelo) {
  modelo = f
}

/** Texto que parece un registro (comida, ejercicio, sueño, peso, plata, estudio): solo esos pasan por el clasificador. */
export const PARECE_REGISTRO = /\b(com[ií]|almorc[eé]|cen[eé]|desayun[eé]|merend[eé]|me com[ií]|entren[eé]|corr[ií]|nad[eé]|gym|gimnasio|camin[eé]|pedale[eé]|bici|dorm[ií]|me despert[eé]|peso\b|pes[eé]|kg\b|kcal|gast[eé]|pagu[eé]|cobr[eé]|me pagaron|me transfirieron|€|euros?\b|d[oó]lares|estudi[eé]|practiqu[eé]|le[ií] \d+)/i

/** Clasifica una foto y/o un texto. */
export async function clasificar(db: Db, o: { imagen?: { datos: Buffer; mime: string }; texto?: string | null }): Promise<Captura> {
  const d = await modelo(db, { imagen: o.imagen, texto: String(o.texto ?? '').trim() }) ?? {}
  const tipo = (TIPOS_CAPTURA as readonly string[]).includes(d.tipo) ? d.tipo : 'otro'
  return {
    tipo, confianza: Math.min(1, Math.max(0, Number(d.confianza) || 0)),
    fecha: typeof d.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) ? d.fecha : null,
    hora: typeof d.hora === 'string' && /^\d{1,2}:\d{2}$/.test(d.hora) ? d.hora : null,
    titulo: String(d.titulo ?? '').trim().slice(0, 160), descripcion: String(d.descripcion ?? '').trim().slice(0, 600),
    datos: d.datos && typeof d.datos === 'object' ? d.datos : {},
  }
}

export type Registrado = { tipo: Captura['tipo']; tabla: 'salud' | 'movimientos'; id: number; resumen: string }

const n0 = (v: unknown) => Math.round(Number(v) || 0)

/** Registra lo clasificado. null si no es algo que se registre (otro, aprendizaje todavía no, o datos que no alcanzan). */
export function registrarCaptura(db: Db, c: Captura, o: { foto?: string | null; fuente?: string; ahora?: number } = {}): Registrado | null {
  const ahora = o.ahora ?? Date.now()
  const fuente = o.fuente ?? 'captura'
  if (c.tipo === 'comida' || c.tipo === 'ejercicio' || c.tipo === 'sueno' || c.tipo === 'medida') {
    if (c.tipo === 'sueno' && c.datos.horas == null && c.datos.calidad == null) return null
    if (c.tipo === 'medida' && c.datos.peso == null && c.datos.grasa_corporal == null && c.datos.cintura == null) return null
    const r = registrarSalud(db, { tipo: c.tipo, titulo: c.titulo, fecha: c.fecha, hora: c.hora, datos: c.datos, foto: o.foto, fuente }, ahora)
    const dia = resumenDia(db, r.fecha)
    const m = metasSalud(db)
    const resumen = c.tipo === 'comida'
      ? `🍽 ${r.titulo}: ~${n0(r.datos.kcal)} kcal · ${n0(r.datos.proteina)} g prot. ${r.fecha === fechaLocal(ahora) ? 'Hoy llevás' : `El ${r.fecha} van`} ${dia.kcal}${m.kcal ? ` de ${m.kcal}` : ''} kcal y ${dia.proteina}${m.proteina ? ` de ${m.proteina}` : ''} g de proteína.`
      : c.tipo === 'ejercicio'
        ? `💪 ${r.titulo}${r.datos.minutos ? `: ${r.datos.minutos} min` : ''}${r.datos.distancia_km ? ` · ${r.datos.distancia_km} km` : ''}. Anotado.`
        : c.tipo === 'sueno'
          ? `😴 ${r.titulo}${r.datos.calidad ? ` (${['', 'mal', 'bien', 'muy bien'][r.datos.calidad]})` : ''}. Anotado.`
          : `⚖ ${r.datos.peso != null ? `${r.datos.peso} kg` : r.titulo}${m.peso && r.datos.peso != null ? ` (objetivo ${m.peso})` : ''}. Anotado.`
    return { tipo: c.tipo, tabla: 'salud', id: r.id, resumen }
  }
  if (c.tipo === 'gasto' || c.tipo === 'ingreso') {
    const monto = Math.abs(Number(c.datos.monto))
    if (!Number.isFinite(monto) || !monto) return null
    const descripcion = String(c.datos.comercio || c.titulo || (c.tipo === 'gasto' ? 'Gasto' : 'Ingreso')).slice(0, 200)
    const m = registrarMovimiento(db, {
      fecha: c.fecha ?? undefined, monto: c.tipo === 'gasto' ? -monto : monto, moneda: String(c.datos.moneda || 'EUR').toUpperCase().slice(0, 3),
      categoria: c.datos.categoria ?? null, descripcion, origen: o.foto ? 'ticket' : fuente,
    }, ahora)
    if (!m) return null // ya estaba (mismo día, monto y descripción)
    return { tipo: c.tipo, tabla: 'movimientos', id: m.id, resumen: `${c.tipo === 'gasto' ? '💸' : '💰'} ${descripcion}: ${c.tipo === 'gasto' ? '-' : '+'}${monto} ${m.moneda} (${m.categoria}). Anotado.` }
  }
  return null
}

/** Deshace un registro de la captura (el botón ↩ de Telegram, o una corrección que lo reemplaza). */
export function deshacerCaptura(db: Db, tabla: string, id: number) {
  if (tabla === 'salud') borrarSalud(db, id)
  else if (tabla === 'movimientos') db.prepare('DELETE FROM movimientos WHERE id = ?').run(id)
}
