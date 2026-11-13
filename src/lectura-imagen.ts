/**
 * Leer una imagen de verdad (Fragua #270 y #272). Antes, a una foto o captura le tocaba una descripción de 2 a 5
 * oraciones («captura con una lista de argumentos agrupados…»): sin las filas, sin qué ítem estaba en qué nivel, sin los
 * rótulos. Ahora:
 * - todo el texto visible, palabra por palabra, en orden de lectura;
 * - la estructura, si la tiene (tabla, tier list, columnas, niveles): cada grupo con su rótulo y sus elementos en orden;
 * - lo que no se lee con confianza, dicho parte por parte (nunca inventado ni omitido en silencio);
 * - si la primera pasada trae poco texto en algo que debería tenerlo, una segunda con otro modelo, y queda la más completa;
 * - todo queda como pieza del corpus (nivel «propia», etiqueta «captura», con la imagen como fuente): buscable para
 *   siempre, en vez de perderse con el turno. Si no se pudo guardar, el que llama lo avisa en el momento.
 */
import crypto from 'node:crypto'
import { fechaLocal, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { leerJson } from './modelo.ts'
import { M, nanVision } from './nan.ts'

export type Grupo = { nombre: string; items: string[] }
export type LecturaImagen = { clase: string; titulo: string; descripcion: string; texto: string; grupos: Grupo[]; ilegible: string[]; modelo: string | null }

const SISTEMA = `Leés una imagen que el operador le manda a su asistente (una captura de pantalla, una foto de un cartel, una página, una pizarra, una tabla, una tier list, un gráfico…). Tu trabajo es que no se pierda nada de lo que dice. JSON.
- "texto": TODO el texto visible, palabra por palabra, en su orden de lectura (de arriba abajo y de izquierda a derecha; en columnas, columna por columna), sin resumir, sin traducir y sin corregir. Si no hay texto, "".
- "grupos": si la imagen tiene estructura (filas y columnas, niveles de una tier list, categorías, secciones), cada grupo con su rótulo tal cual se ve (la letra del tier, el encabezado de la columna, el título de la sección) y sus elementos en el orden en que aparecen. Si un elemento es una imagen sin texto, describilo en dos o tres palabras entre corchetes. Si no tiene estructura, [].
- "ilegible": cada parte que no podés leer con confianza, concreta («el rótulo de la tercera fila», «la nota al pie, borrosa», «el segundo ítem del tier C, tapado por la marca de agua»). Nunca inventes ni adivines: si dudás, va acá.
- "clase": texto | tabla | lista | ranking | grafico | documento | foto | otro.
- "titulo": corto, de qué es (máx. 8 palabras).
- "descripcion": una o dos oraciones de qué es la imagen.
Forma: {"clase": string, "titulo": string, "descripcion": string, "texto": string, "grupos": [{"nombre": string, "items": [string]}], "ilegible": [string]}`

/** Las clases que deberían tener texto: si la primera pasada trae casi nada, se pide una segunda. */
const CON_TEXTO = /texto|tabla|lista|ranking|documento|grafico/
const MINIMO_TEXTO = 40

let vision = (db: Db, imagen: string, modelos?: string[]) => nanVision({ db, clase: 'mastropiero', agenteId: 'lectura-imagen' }, { sistema: SISTEMA, texto: 'Leé esta imagen entera.', imagen, maxTokens: 6000, modelos })
export function _probarLectura(f: typeof vision) { vision = f }

function normalizar(crudo: string, modelo: string | null): LecturaImagen {
  const j = leerJson<any>(crudo)
  if (!j || typeof j !== 'object') return { clase: 'otro', titulo: 'Imagen', descripcion: '', texto: crudo.trim().slice(0, 20_000), grupos: [], ilegible: [], modelo }
  const lista = (x: unknown) => (Array.isArray(x) ? x : [])
  return {
    clase: String(j.clase ?? 'otro').slice(0, 20),
    titulo: String(j.titulo ?? 'Imagen').trim().slice(0, 80) || 'Imagen',
    descripcion: String(j.descripcion ?? '').trim().slice(0, 600),
    texto: String(j.texto ?? '').trim().slice(0, 20_000),
    grupos: lista(j.grupos).map((g: any) => ({ nombre: String(g?.nombre ?? '').trim().slice(0, 120), items: lista(g?.items).map((i) => String(i).trim()).filter(Boolean).slice(0, 200) })).filter((g) => g.nombre || g.items.length).slice(0, 60),
    ilegible: lista(j.ilegible).map((x) => String(x).trim()).filter(Boolean).slice(0, 30),
    modelo,
  }
}
const tamano = (l: LecturaImagen) => l.texto.length + l.grupos.reduce((s, g) => s + g.nombre.length + g.items.join(' ').length, 0)

/** Lee la imagen (y, si trajo poco texto en algo que debería tenerlo, una segunda pasada con otro modelo). */
export async function leerImagen(db: Db, img: { datos: Buffer; mime: string }): Promise<LecturaImagen> {
  const dataUrl = `data:${img.mime};base64,${img.datos.toString('base64')}`
  const r1 = await vision(db, dataUrl)
  const l1 = normalizar(r1.texto, r1.modelo)
  if (!(CON_TEXTO.test(l1.clase) && tamano(l1) < MINIMO_TEXTO)) return l1
  const otro = r1.modelo === M.qwen ? M.deepseek : M.qwen
  const r2 = await vision(db, dataUrl, [otro]).catch(() => null)
  if (!r2) return l1
  const l2 = normalizar(r2.texto, r2.modelo)
  return tamano(l2) > tamano(l1) ? l2 : l1
}

/** La lectura en Markdown: lo que se guarda en el corpus y lo que ve el chat. */
export function lecturaComoTexto(l: LecturaImagen): string {
  return [
    l.descripcion,
    l.grupos.length ? `## Estructura\n${l.grupos.map((g) => `- **${g.nombre || '(sin rótulo)'}**: ${g.items.join(' · ') || '(vacío)'}`).join('\n')}` : '',
    l.texto ? `## Texto\n${l.texto}` : '',
    l.ilegible.length ? `## No se lee con confianza\n${l.ilegible.map((x) => `- ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Guarda la lectura como pieza suya (la imagen como fuente). La misma imagen dos veces no se duplica. Devuelve el id de
 * la pieza (o el de la que ya estaba).
 */
export function guardarLectura(db: Db, l: LecturaImagen, img: { datos: Buffer; url?: string | null; canal: string; nota?: string | null }, ahora = Date.now()): number {
  asegurarFuente(db, { id: 'capturas', nombre: 'Capturas e imágenes', nivel: 'propia', descripcion: 'Lo que mandaste como imagen (capturas, fotos de carteles, páginas, tablas), leído entero.' })
  const huella = crypto.createHash('sha1').update(img.datos).digest('hex').slice(0, 16)
  const origenId = `imagen:${huella}`
  const contenido = [img.nota ? `> ${img.nota}` : '', lecturaComoTexto(l), img.url ? `Imagen: ${img.url}` : ''].filter(Boolean).join('\n\n')
  const id = insertar(db, {
    fuente: 'capturas', nivel: 'propia', tipo: 'materia', estado: 'disponible', titulo: `Imagen · ${fechaLocal(ahora)} · ${l.titulo}`, contenido,
    fecha: fechaLocal(ahora), etiquetas: ['captura', l.clase], origenId, datos: { url: img.url ?? null, canal: img.canal, modelo: l.modelo, ilegible: l.ilegible.length },
  }, ahora)
  return id ?? (db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origenId) as { id: number }).id
}
