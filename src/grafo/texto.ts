/**
 * Del texto a la secuencia de lemas (plan v25), sin dependencias: limpiar (links, markdown, números), partir en párrafos,
 * llevar cada palabra a su raíz (el algoritmo Snowball para castellano: «barcos», «barco» y «barquita» no; los diminutivos
 * y apodos se unifican solo si él los declara como alias) y sacar las palabras-puente (stopwords). Cada raíz recuerda su
 * forma más frecuente, que es la que se muestra.
 */

const VOCALES = 'aeiouáéíóúü'
const esVocal = (c: string | undefined) => !!c && VOCALES.includes(c)

/** R1, R2 y RV del algoritmo Snowball (posiciones desde donde vale sacar sufijos). */
function regiones(w: string) {
  const r = (desde: number) => {
    for (let i = desde + 1; i < w.length; i++) if (!esVocal(w[i]) && esVocal(w[i - 1])) return i + 1
    return w.length
  }
  const r1 = r(0)
  const r2 = r(r1)
  let rv = w.length
  if (w.length > 3) {
    if (!esVocal(w[1])) { for (let i = 2; i < w.length; i++) if (esVocal(w[i])) { rv = i + 1; break } }
    else if (esVocal(w[0]) && esVocal(w[1])) { for (let i = 2; i < w.length; i++) if (!esVocal(w[i])) { rv = i + 1; break } }
    else rv = 3
  }
  return { r1, r2, rv }
}

const sinTilde = (s: string) => s.replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u')
/** El sufijo más largo de la lista con el que termina la palabra (o null). */
const sufijo = (w: string, xs: string[]) => xs.filter((s) => w.endsWith(s)).sort((a, b) => b.length - a.length)[0] ?? null

const PRONOMBRES = ['selas', 'selos', 'sela', 'selo', 'las', 'les', 'los', 'nos', 'me', 'se', 'la', 'le', 'lo']
const PASO1: [string[], string][] = [
  [['anza', 'anzas', 'ico', 'ica', 'icos', 'icas', 'ismo', 'ismos', 'able', 'ables', 'ible', 'ibles', 'ista', 'istas', 'oso', 'osa', 'osos', 'osas', 'amiento', 'amientos', 'imiento', 'imientos'], 'borrar'],
  [['adora', 'ador', 'ación', 'adoras', 'adores', 'aciones', 'ante', 'antes', 'ancia', 'ancias'], 'ic'],
  [['logía', 'logías'], 'log'],
  [['ución', 'uciones'], 'u'],
  [['encia', 'encias'], 'ente'],
  [['amente'], 'amente'],
  [['mente'], 'mente'],
  [['idad', 'idades'], 'idad'],
  [['iva', 'ivo', 'ivas', 'ivos'], 'iva'],
]
const TODOS_PASO1 = PASO1.flatMap(([xs]) => xs)
const PASO2A = ['ya', 'ye', 'yan', 'yen', 'yeron', 'yendo', 'yo', 'yó', 'yas', 'yes', 'yais', 'yamos']
const PASO2B_GU = ['en', 'es', 'éis', 'emos']
const PASO2B = ['arían', 'arías', 'arán', 'arás', 'aríais', 'aría', 'aréis', 'aríamos', 'aremos', 'ará', 'aré', 'erían', 'erías', 'erán', 'erás', 'eríais', 'ería', 'eréis', 'eríamos', 'eremos', 'erá', 'eré', 'irían', 'irías', 'irán', 'irás', 'iríais', 'iría', 'iréis', 'iríamos', 'iremos', 'irá', 'iré', 'aba', 'ada', 'ida', 'ía', 'ara', 'iera', 'ad', 'ed', 'id', 'ase', 'iese', 'aste', 'iste', 'an', 'aban', 'ían', 'aran', 'ieran', 'asen', 'iesen', 'aron', 'ieron', 'ado', 'ido', 'ando', 'iendo', 'ió', 'ar', 'er', 'ir', 'as', 'abas', 'adas', 'idas', 'ías', 'aras', 'ieras', 'ases', 'ieses', 'ís', 'áis', 'abais', 'íais', 'arais', 'ierais', 'aseis', 'ieseis', 'asteis', 'isteis', 'ados', 'idos', 'amos', 'ábamos', 'íamos', 'imos', 'áramos', 'iéramos', 'iésemos', 'ásemos']

/** La raíz Snowball de una palabra castellana (en minúsculas). */
export function raiz(palabra: string): string {
  let w = palabra.toLowerCase()
  if (w.length < 4) return sinTilde(w)
  let { r1, r2, rv } = regiones(w)
  // Paso 0: pronombres pegados (dámelo, comprándolas).
  const pr = sufijo(w, PRONOMBRES)
  if (pr && w.length - pr.length >= rv) {
    const base = w.slice(0, -pr.length)
    const antes = sufijo(base, ['iéndo', 'ándo', 'ár', 'ér', 'ír', 'ando', 'iendo', 'ar', 'er', 'ir', 'yendo'])
    if (antes && base.length - antes.length >= rv && (antes !== 'yendo' || base.endsWith('uyendo'))) w = /[áéí]/.test(antes) ? base.slice(0, -antes.length) + sinTilde(antes) : base
  }
  ;({ r1, r2, rv } = regiones(w))
  const en = (s: string, desde: number) => w.endsWith(s) && w.length - s.length >= desde
  // Paso 1: los sufijos de siempre.
  const s1 = sufijo(w, TODOS_PASO1)
  let sacado = false
  if (s1) {
    const tipo = PASO1.find(([xs]) => xs.includes(s1))![1]
    if (tipo === 'borrar' && en(s1, r2)) { w = w.slice(0, -s1.length); sacado = true }
    else if (tipo === 'ic' && en(s1, r2)) { w = w.slice(0, -s1.length); if (en('ic', r2)) w = w.slice(0, -2); sacado = true }
    else if (tipo === 'log' && en(s1, r2)) { w = w.slice(0, -s1.length) + 'log'; sacado = true }
    else if (tipo === 'u' && en(s1, r2)) { w = w.slice(0, -s1.length) + 'u'; sacado = true }
    else if (tipo === 'ente' && en(s1, r2)) { w = w.slice(0, -s1.length) + 'ente'; sacado = true }
    else if (tipo === 'amente' && en(s1, r1)) {
      w = w.slice(0, -s1.length); sacado = true
      if (en('iv', r2)) { w = w.slice(0, -2); if (en('at', r2)) w = w.slice(0, -2) }
      else for (const x of ['os', 'ic', 'ad']) if (en(x, r2)) { w = w.slice(0, -2); break }
    } else if (tipo === 'mente' && en(s1, r2)) {
      w = w.slice(0, -s1.length); sacado = true
      for (const x of ['ante', 'able', 'ible']) if (en(x, r2)) { w = w.slice(0, -x.length); break }
    } else if (tipo === 'idad' && en(s1, r2)) {
      w = w.slice(0, -s1.length); sacado = true
      for (const x of ['abil', 'ic', 'iv']) if (en(x, r2)) { w = w.slice(0, -x.length); break }
    } else if (tipo === 'iva' && en(s1, r2)) {
      w = w.slice(0, -s1.length); sacado = true
      if (en('at', r2)) w = w.slice(0, -2)
    }
  }
  if (!sacado) {
    ;({ rv } = regiones(w))
    // Paso 2a: verbos con «y» (después de u: construyendo).
    const s2a = sufijo(w, PASO2A)
    if (s2a && w.length - s2a.length >= rv && w[w.length - s2a.length - 1] === 'u') w = w.slice(0, -s2a.length)
    else {
      // Paso 2b: el resto de las terminaciones verbales.
      const s2b = sufijo(w, [...PASO2B_GU, ...PASO2B])
      if (s2b && w.length - s2b.length >= rv) {
        w = w.slice(0, -s2b.length)
        if (PASO2B_GU.includes(s2b) && w.endsWith('gu')) w = w.slice(0, -1)
      }
    }
  }
  // Paso 3: lo que queda (vocales finales).
  ;({ rv } = regiones(w))
  const s3 = sufijo(w, ['os', 'a', 'o', 'á', 'í', 'ó', 'e', 'é'])
  if (s3 && w.length - s3.length >= rv) {
    w = w.slice(0, -s3.length)
    if ((s3 === 'e' || s3 === 'é') && w.endsWith('gu') && w.length - 1 >= rv) w = w.slice(0, -1)
  }
  return sinTilde(w)
}

// ─── las palabras-puente ────────────────────────────────────────────────

const STOP_ES = `a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cual cuales cualquier cuando cuanto de del desde donde dos el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba estaban estado estamos estan estar este esto estos estoy fue fueron fui ha habia habian haber hace hacen hacer hacia han hasta hay he la las le les lo los mas me mi mis mientras mismo mucho muchos muy nada ni no nos nosotros o otra otras otro otros para pero poco por porque pues que quien quienes se sea ser si sido siempre sin sino sobre solo son soy su sus tal tambien tan tanto te tener tengo ti tiene tienen todo todos tu tus un una unas uno unos usted ustedes va vamos van vez y ya yo
  he has hemos habra hubo hay puede pueden podria puedo quiero quiere hago hice hizo dice dijo digo creo veo ver voy vas ir sera seria estaria fuera tenia tuve cosa cosas algo nadie otro asi aca alla ahi alli entonces luego despues ahora hoy ayer manana tambien tampoco igual mismo misma mejor peor gran grande menos mas muy bastante demasiado cierto ciertos cada mucha muchas pocos poca tanto tantas toda todas uno dos tres
  che bueno tipo onda re posta nomas viste sabes digamos osea o sea capaz medio justo bah dale listo ok okay vos sos tenes podes queres sabes estas decis hacelo ponele igualmente literal`
const STOP_EN = `a about after all also an and any are as at be been being but by can could did do does doing done for from get got had has have having he her here him his how i if in into is it its just like me more most my no not now of on one only or other our out over said she should so some such than that the their them then there these they this those through to too under up us very was we were what when where which while who why will with would you your yours yeah okay ok also really thing things going go make made much many even still way well`

const quitar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/**
 * Lo que no es concepto en su corpus (calibrado sobre el suyo): el formato de las importaciones (transcripciones,
 * cuadernos, títulos) y palabras genéricas que sobreviven a las stopwords (tipo, forma, parte, ejemplo). Él puede
 * protegerlas en el diccionario si para él sí son concepto.
 */
const STOP_FORMATO = `speaker speakers hablante hoja hojas pagina paginas titulo titulos subtitulo transcripcion transcripciones transcript operador adicional adicionales informacion nota notas fragmento fragmentos seccion secciones texto textos mensaje mensajes audio audios archivo archivos imagen imagenes foto fotos link links enlace video videos
  parte partes forma formas manera maneras tipo tipos caso casos ejemplo ejemplos punto puntos tema temas cuestion general generalmente especifico especifica posible posibles importante importantes necesario necesaria diferente diferentes nuevo nueva nuevos nuevas primer primero primera segundo segunda ultimo ultima siguiente anterior mayor menor bueno buena malo mala exclusivamente mediante respecto traves medida dentro fuera cerca lejos parece pareceria`
/** Raíces de verbos y nexos que se cuelan conjugados (parece, indica, tenemos, hacer, poder…). Se miran después de cortar. */
export const STOP_RAICES = new Set('parec indic aparec sugier suger ten tien hac hic hech pod pued quier quer dec dic dij sab deb segu sig est esta estuv tuv pas pued pon pus dej llev llam resultr result permit permitir necesit sirv sirv ofrec mostr muestr incluy inclu cre cre consider observ ayud refuerz reforz bas trat ten'.split(' '))
export const STOPWORDS = new Set([...STOP_ES.split(/\s+/), ...STOP_EN.split(/\s+/), ...STOP_FORMATO.split(/\s+/)].filter(Boolean).map(quitar))

// ─── del texto a los lemas ──────────────────────────────────────────────

/** Lo que él declaró: palabras que no suman (stop), las que se unifican (alias → destino) y las que no se tocan (proteger). */
export type Diccionario = { stop: Set<string>; alias: Map<string, string>; proteger: Set<string> }
export const diccionarioVacio = (): Diccionario => ({ stop: new Set(), alias: new Map(), proteger: new Set() })

/** Limpia lo que no es prosa: links, markdown, citas [#12], código, números y emojis. */
export function limpiar(texto: string): string {
  return texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/g, ' ')
    .replace(/\[#\d+\]/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|~]+/g, ' ')
    .replace(/\b\d+([.,:/]\d+)*\b/g, ' ')
}

/** Los párrafos de un texto: lo separado por renglón en blanco (o por renglón, si es una lista o una charla). */
export const parrafos = (texto: string) => limpiar(texto).split(/\n\s*\n|\n(?=\s*[-•*]\s)|\n(?=[^\n]{0,40}:\s)/).map((p) => p.trim()).filter((p) => p.length > 2)

const PALABRA = /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ][a-zA-ZáéíóúüñÁÉÍÓÚÜÑ'-]*[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g

/**
 * Un párrafo como secuencia de lemas (raíces), sin palabras-puente. formas: cuenta cada forma visible por raíz (para
 * mostrar la más frecuente). Las palabras protegidas no se cortan; los alias se llevan a su destino.
 */
export function lemas(parrafo: string, dic: Diccionario, formas?: Map<string, Map<string, number>>): string[] {
  const out: string[] = []
  for (const m of parrafo.matchAll(PALABRA)) {
    const visible = m[0].replace(/^['-]+|['-]+$/g, '')
    const baja = visible.toLowerCase()
    const plano = quitar(baja)
    if (plano.length < 3) continue
    // Lo que él protege siempre entra (aunque esté en una lista); lo que él frenó, nunca.
    const protegida = dic.proteger.has(plano)
    if (dic.stop.has(plano) || (!protegida && STOPWORDS.has(plano))) continue
    const destino = dic.alias.get(plano)
    // Un alias a otra palabra suelta se une a esa palabra (por su raíz, como cuando aparece sola); a una etiqueta de varias
    // palabras («club náutico»), queda esa etiqueta.
    const l = destino ? (/\s/.test(destino) || dic.proteger.has(quitar(destino)) ? destino : raiz(destino)) : protegida ? plano : raiz(baja)
    if (l.length < 3 || dic.stop.has(l) || (!protegida && !destino && STOP_RAICES.has(l))) continue
    out.push(l)
    if (formas) {
      const f = formas.get(l) ?? new Map<string, number>()
      const mostrar = destino ?? baja
      f.set(mostrar, (f.get(mostrar) ?? 0) + 1)
      formas.set(l, f)
    }
  }
  return out
}

/** La forma más frecuente de cada raíz (la que se muestra en el grafo). */
export const formaDe = (formas: Map<string, Map<string, number>>, l: string) => [...(formas.get(l) ?? new Map([[l, 1]])).entries()].sort((a, b) => b[1] - a[1])[0][0]
