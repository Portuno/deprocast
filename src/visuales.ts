/**
 * Visuales por plantilla (plan v24): el modelo no escribe el HTML, manda los DATOS de lo que hay que mostrar y un
 * dibujante fijo (web/visual/*.js) lo dibuja. Cuesta 10-20 veces menos, sale rápido y siempre con el mismo estilo.
 * - diagrama: piezas (con su símbolo, los de IEC en electricidad) y conexiones con flujo, paso a paso, un control.
 * - molecula: una proteína real (su PDB: el servidor baja la estructura y la mete en los datos) o una molécula chica.
 * - funcion: curvas y = f(x; parámetros) con deslizadores (un parser propio: nada de eval).
 * - movimiento: una figura articulada por fases (ángulos por articulación), músculos y errores típicos.
 * Lo que no entra en ninguna, o si los datos no cierran dos veces, vuelve al HTML libre de antes.
 */
import { pedirJson } from './modelo.ts'
import type { Db } from './db.ts'

export const PLANTILLAS = ['diagrama', 'molecula', 'funcion', 'movimiento'] as const
export type Plantilla = (typeof PLANTILLAS)[number]
/** Qué plantillas puede usar cada clase de visual (la clase es lo que pide el tutor). */
export const PLANTILLAS_DE: Record<string, Plantilla[]> = { diagrama: ['diagrama', 'funcion'], simulacion: ['molecula', 'funcion'], movimiento: ['movimiento'] }

const txt = (x: unknown, n = 300) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const num = (x: unknown, def: number | null = null) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : def)
const entre = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const lista = (x: unknown, max: number): any[] => (Array.isArray(x) ? x.slice(0, max) : [])

// ─── expresiones (las mismas reglas que web/visual/funcion.js) ──────────

const FUNCIONES: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, exp: Math.exp, ln: Math.log, log: Math.log10,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, pow: Math.pow, sign: Math.sign,
}
const CONSTANTES: Record<string, number> = { pi: Math.PI, e: Math.E }

/**
 * Compila «a*sin(b*x) + c^2» a una función de las variables dadas. Solo números, variables conocidas, + - * / ^,
 * paréntesis y las funciones de arriba: cualquier otra cosa es un error (nunca se evalúa texto).
 */
export function compilarExpr(expr: string, variables: string[]): (v: Record<string, number>) => number {
  const s = String(expr).replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/·/g, '*')
  if (!s || s.length > 200) throw new Error('Expresión vacía o muy larga')
  let i = 0
  const vars = new Set(variables)
  type Nodo = (v: Record<string, number>) => number
  const ver = () => s[i]
  function primario(): Nodo {
    const c = ver()
    if (c === '(') { i++; const n = suma(); if (ver() !== ')') throw new Error('Falta un paréntesis'); i++; return n }
    if (c === '-') { i++; const n = potencia(); return (v) => -n(v) }
    if (c === '+') { i++; return potencia() }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))
    if (m) { i += m[0].length; const k = Number(m[0]); return () => k }
    const id = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(s.slice(i))
    if (!id) throw new Error(`No entiendo «${s.slice(i, i + 8)}»`)
    i += id[0].length
    const nombre = id[0]
    if (ver() === '(') {
      const f = Object.hasOwn(FUNCIONES, nombre.toLowerCase()) ? FUNCIONES[nombre.toLowerCase()] : null
      if (!f) throw new Error(`Función desconocida: ${nombre}`)
      i++
      const args: Nodo[] = [suma()]
      while (ver() === ',') { i++; args.push(suma()) }
      if (ver() !== ')') throw new Error('Falta un paréntesis')
      i++
      return (v) => f(...args.map((a) => a(v)))
    }
    if (vars.has(nombre)) return (v) => v[nombre]
    if (Object.hasOwn(CONSTANTES, nombre.toLowerCase())) { const k = CONSTANTES[nombre.toLowerCase()]; return () => k }
    throw new Error(`Variable desconocida: ${nombre}`)
  }
  function potencia(): Nodo {
    const b = primario()
    if (ver() === '^') { i++; const e = potencia(); return (v) => Math.pow(b(v), e(v)) } // a la derecha: 2^3^2 = 2^9
    return b
  }
  function producto(): Nodo {
    let n = potencia()
    for (;;) {
      const c = ver()
      if (c === '*' || c === '/') { i++; const d = potencia(); const a = n; n = c === '*' ? (v) => a(v) * d(v) : (v) => a(v) / d(v) }
      else if (c === '(' || (c && /[a-zA-Z0-9.]/.test(c))) { const d = potencia(); const a = n; n = (v) => a(v) * d(v) } // 2x, 3(x+1)
      else return n
    }
  }
  function suma(): Nodo {
    let n = producto()
    for (;;) {
      const c = ver()
      if (c !== '+' && c !== '-') return n
      i++
      const d = producto()
      const a = n
      n = c === '+' ? (v) => a(v) + d(v) : (v) => a(v) - d(v)
    }
  }
  const raiz = suma()
  if (i < s.length) throw new Error(`Sobra «${s.slice(i, i + 8)}»`)
  return raiz
}

// ─── las formas de cada plantilla ───────────────────────────────────────

export const TIPOS_NODO = ['pila', 'resistencia', 'led', 'lampara', 'interruptor', 'capacitor', 'motor', 'diodo', 'transistor', 'tierra', 'bobina', 'fuente_ca', 'amperimetro', 'voltimetro', 'caja'] as const
const FLUJOS = ['corriente', 'datos', 'energia', 'materia']

type Valido<T> = { ok: true; datos: T } | { ok: false; motivo: string }
const mal = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo })

export function validarDiagrama(d: any): Valido<any> {
  const nodos = lista(d?.nodos, 24).map((n, k) => ({
    id: txt(n?.id, 24) || `n${k}`, tipo: (TIPOS_NODO as readonly string[]).includes(n?.tipo) ? n.tipo : 'caja',
    etiqueta: txt(n?.etiqueta, 40) || txt(n?.id, 24), explica: txt(n?.explica, 320), valor: txt(n?.valor, 24) || null,
    x: num(n?.x), y: num(n?.y),
  }))
  if (nodos.length < 2) return mal('hacen falta al menos dos piezas')
  const ids = new Set(nodos.map((n) => n.id))
  if (ids.size !== nodos.length) return mal('hay piezas con el mismo id')
  const conexiones = lista(d?.conexiones, 40).map((c) => ({ de: txt(c?.de, 24), a: txt(c?.a, 24), etiqueta: txt(c?.etiqueta, 40) || null, flujo: FLUJOS.includes(c?.flujo) ? c.flujo : null }))
    .filter((c) => ids.has(c.de) && ids.has(c.a) && c.de !== c.a)
  if (!conexiones.length) return mal('ninguna conexión une piezas que existan')
  const pasos = lista(d?.pasos, 12).map((p) => ({ texto: txt(p?.texto, 300), resaltar: lista(p?.resaltar, 12).map((x) => txt(x, 24)).filter((x) => ids.has(x)) })).filter((p) => p.texto)
  let control: any = null
  const c = d?.control
  if (c?.tipo === 'interruptor' && ids.has(txt(c.nodo, 24))) control = { tipo: 'interruptor', nodo: txt(c.nodo, 24), abierto: txt(c.abierto, 240) || 'Abierto: no circula nada.', cerrado: txt(c.cerrado, 240) || 'Cerrado: circula.' }
  else if (c?.tipo === 'deslizador') {
    const min = num(c.min, 0)!, max = num(c.max, 10)!
    if (max > min) {
      const nombre = /^[a-zA-Z]\w{0,11}$/.test(String(c.nombre ?? '')) ? String(c.nombre) : 'v'
      let salida = null
      if (c.salida?.expr) {
        try { compilarExpr(c.salida.expr, [nombre]); salida = { expr: txt(c.salida.expr, 200), etiqueta: txt(c.salida.etiqueta, 40), unidad: txt(c.salida.unidad, 12) } } catch { /* sin salida calculada */ }
      }
      control = { tipo: 'deslizador', nombre, etiqueta: txt(c.etiqueta, 40) || nombre, unidad: txt(c.unidad, 12), min, max, valor: entre(num(c.valor, min)!, min, max), paso: num(c.paso, (max - min) / 100), salida, afecta: lista(c.afecta, 12).map((x) => txt(x, 24)).filter((x) => ids.has(x)), texto: txt(c.texto, 240) }
    }
  }
  return { ok: true, datos: { titulo: txt(d?.titulo, 80), uso: txt(d?.uso, 200), nodos, conexiones, pasos, control } }
}

export function validarFuncion(d: any): Valido<any> {
  const parametros = lista(d?.parametros, 5).map((p) => {
    const min = num(p?.min, 0)!, max = num(p?.max, 10)!
    return { nombre: String(p?.nombre ?? ''), etiqueta: txt(p?.etiqueta, 40), min, max, valor: entre(num(p?.valor, min)!, Math.min(min, max), Math.max(min, max)), paso: num(p?.paso, Math.abs(max - min) / 100) || 0.01 }
  }).filter((p) => /^[a-zA-Z]\w{0,11}$/.test(p.nombre) && p.nombre !== 'x' && p.max > p.min && !Object.hasOwn(CONSTANTES, p.nombre.toLowerCase()))
  const vars = ['x', ...parametros.map((p) => p.nombre)]
  const errores: string[] = []
  const curvas = lista(d?.curvas, 4).map((c) => ({ expr: txt(c?.expr, 200), etiqueta: txt(c?.etiqueta, 60) })).filter((c) => {
    try { compilarExpr(c.expr, vars); return true } catch (e) { errores.push(`«${c.expr}»: ${(e as Error).message}`); return false }
  })
  if (!curvas.length) return mal(errores.length ? `ninguna curva se puede calcular (${errores.join('; ')})` : 'falta al menos una curva')
  const xmin = num(d?.x?.min, -10)!, xmax = num(d?.x?.max, 10)!
  if (!(xmax > xmin)) return mal('el rango de x está al revés')
  const ymin = num(d?.y?.min), ymax = num(d?.y?.max)
  return {
    ok: true, datos: {
      titulo: txt(d?.titulo, 80), explica: txt(d?.explica, 400), parametros, curvas,
      x: { min: xmin, max: xmax, etiqueta: txt(d?.x?.etiqueta, 30) || 'x' },
      y: { min: ymin != null && ymax != null && ymax > ymin ? ymin : null, max: ymin != null && ymax != null && ymax > ymin ? ymax : null, etiqueta: txt(d?.y?.etiqueta, 30) || 'y' },
      puntos: lista(d?.puntos, 8).map((p) => ({ x: num(p?.x), etiqueta: txt(p?.etiqueta, 40) })).filter((p) => p.x != null),
    },
  }
}

/** Las articulaciones de la figura (grados). Perfil: flexiones; frente: aperturas. */
export const ARTICULACIONES = ['tronco', 'cuello', 'hombro', 'codo', 'cadera', 'rodilla', 'tobillo', 'hombroAbd', 'caderaAbd'] as const
const LADOS = ['', 'I', 'D'] // sin lado = los dos; I/D = izquierda/derecha (para lo asimétrico: una zancada)

function pose(p: any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of ARTICULACIONES) for (const l of LADOS) {
    const v = num(p?.[`${a}${l}`])
    if (v != null) out[`${a}${l}`] = entre(v, -180, 180)
  }
  return out
}

export function validarMovimiento(d: any): Valido<any> {
  const fases = lista(d?.fases, 8).map((f) => ({ nombre: txt(f?.nombre, 40), ms: entre(num(f?.ms, 1200)!, 200, 6000), pose: pose(f?.pose), musculos: lista(f?.musculos, 8).map((m) => txt(m, 30)).filter(Boolean), cue: txt(f?.cue, 200) }))
    .filter((f) => f.nombre && Object.keys(f.pose).length)
  if (fases.length < 2) return mal('hacen falta al menos dos fases con su pose')
  const errores = lista(d?.errores, 5).map((e) => ({ nombre: txt(e?.nombre, 60), fase: entre(Math.round(num(e?.fase, 0)!), 0, fases.length - 1), pose: pose(e?.pose), explica: txt(e?.explica, 240) }))
    .filter((e) => e.nombre && Object.keys(e.pose).length)
  return { ok: true, datos: { titulo: txt(d?.titulo, 80), explica: txt(d?.explica, 400), vista: d?.vista === 'frente' ? 'frente' : 'perfil', fases, errores } }
}

const ELEMENTOS = new Set(['H', 'C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'Na', 'K', 'Ca', 'Mg', 'Fe', 'Zn', 'Cu'])

export function validarMolecula(d: any): Valido<any> {
  const pdb = /^[0-9][a-zA-Z0-9]{3}$/.test(String(d?.pdb ?? '').trim()) ? String(d.pdb).trim().toUpperCase() : null
  const atomos = lista(d?.atomos, 80).map((a) => ({ e: ELEMENTOS.has(a?.e) ? a.e : 'C', x: num(a?.x), y: num(a?.y), z: num(a?.z, 0) })).filter((a) => a.x != null && a.y != null)
  const enlaces = lista(d?.enlaces, 160).map((e) => (Array.isArray(e) ? [Math.round(num(e[0], -1)!), Math.round(num(e[1], -1)!), entre(Math.round(num(e[2], 1)!), 1, 3)] : null))
    .filter((e): e is number[] => !!e && e[0] >= 0 && e[1] >= 0 && e[0] < atomos.length && e[1] < atomos.length && e[0] !== e[1])
  if (!pdb && atomos.length < 2) return mal('falta el código PDB de la proteína o los átomos de la molécula')
  return {
    ok: true, datos: {
      titulo: txt(d?.titulo, 80), explica: txt(d?.explica, 400), pdb, atomos: pdb ? [] : atomos, enlaces: pdb ? [] : enlaces,
      residuos: lista(d?.residuos, 10).map((r) => ({ n: Math.round(num(r?.n, 0)!), cadena: txt(r?.cadena, 2) || null, nota: txt(r?.nota, 160) })).filter((r) => r.n && r.nota),
      pasos: lista(d?.pasos, 6).map((p) => ({ texto: txt(p?.texto, 240), plegado: entre(num(p?.plegado, 1)!, 0, 1) })).filter((p) => p.texto),
    },
  }
}

export const VALIDAR: Record<Plantilla, (d: any) => Valido<any>> = { diagrama: validarDiagrama, molecula: validarMolecula, funcion: validarFuncion, movimiento: validarMovimiento }

// ─── el PDB: la estructura real, reducida a su esqueleto ────────────────

export type Cadena = { res: string; n: number; c: string; x: number; y: number; z: number; ss: 'H' | 'E' | 'C' }[]

/** Lee un archivo PDB: los Cα del primer modelo (hasta `max`), con su estructura secundaria (HELIX/SHEET), centrados. */
export function parsearPdb(texto: string, max = 1500): { titulo: string; cadena: Cadena } {
  const helices: [string, number, number][] = []
  const laminas: [string, number, number][] = []
  const cadena: Cadena = []
  let titulo = ''
  for (const l of texto.split(/\r?\n/)) {
    const reg = l.slice(0, 6)
    if (reg === 'TITLE ') titulo += ` ${l.slice(10).trim()}`
    else if (reg === 'HELIX ') helices.push([l.slice(19, 20).trim(), Number(l.slice(21, 25)), Number(l.slice(33, 37))])
    else if (reg === 'SHEET ') laminas.push([l.slice(21, 22).trim(), Number(l.slice(22, 26)), Number(l.slice(33, 37))])
    else if (reg === 'ENDMDL') break
    else if (reg === 'ATOM  ' && l.slice(12, 16).trim() === 'CA' && (l[16] === ' ' || l[16] === 'A') && cadena.length < max) {
      const c = l.slice(21, 22).trim()
      const n = Number(l.slice(22, 26))
      const dentro = (xs: [string, number, number][]) => xs.some(([cc, a, b]) => cc === c && n >= a && n <= b)
      cadena.push({ res: l.slice(17, 20).trim(), n, c, x: Number(l.slice(30, 38)), y: Number(l.slice(38, 46)), z: Number(l.slice(46, 54)), ss: dentro(helices) ? 'H' : dentro(laminas) ? 'E' : 'C' })
    }
  }
  if (cadena.length) {
    const m = ['x', 'y', 'z'].map((k) => cadena.reduce((s, a) => s + (a as any)[k], 0) / cadena.length)
    for (const a of cadena) { a.x = +(a.x - m[0]).toFixed(2); a.y = +(a.y - m[1]).toFixed(2); a.z = +(a.z - m[2]).toFixed(2) }
  }
  return { titulo: titulo.trim().toLowerCase().replace(/(^|\s)\S/g, (s) => s.toUpperCase()).slice(0, 120), cadena }
}

/** Baja la estructura de RCSB (inyectable para tests: sin red). */
let bajarPdb = async (codigo: string): Promise<string> => {
  const r = await fetch(`https://files.rcsb.org/download/${codigo}.pdb`, { signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`El PDB ${codigo} no está (${r.status})`)
  return r.text()
}
export function _probarPdb(f: typeof bajarPdb) { bajarPdb = f }

// ─── el pedido al modelo ────────────────────────────────────────────────

const FORMAS: Record<Plantilla, string> = {
  diagrama: `"diagrama" — piezas y relaciones (un circuito, un componente, un proceso, una arquitectura, un ciclo).
datos: {"titulo": string, "uso": "una línea de cómo usarlo", "nodos": [{"id": "corto", "tipo": ${TIPOS_NODO.map((t) => `"${t}"`).join('|')}, "etiqueta": string, "explica": "qué es y qué hace acá, 1-2 oraciones", "valor": "9 V" | null}], "conexiones": [{"de": id, "a": id, "etiqueta": string | null, "flujo": "corriente"|"datos"|"energia"|"materia"|null}], "pasos": [{"texto": "qué pasa en este paso", "resaltar": [ids]}], "control": null | {"tipo": "interruptor", "nodo": id del interruptor, "abierto": "qué pasa abierto", "cerrado": "qué pasa cerrado"} | {"tipo": "deslizador", "nombre": "V", "etiqueta": "Tensión", "unidad": "V", "min": 0, "max": 12, "valor": 9, "salida": {"expr": "V/220", "etiqueta": "Corriente", "unidad": "A"}, "afecta": [ids que brillan más o menos], "texto": "qué mirar"}}
Electricidad: usá los tipos de componente (símbolos IEC); la corriente sale del + de la pila. Para lo que no es un componente, "caja". 3 a 12 nodos, 2 a 6 pasos.`,
  funcion: `"funcion" — una o más curvas y = f(x) con parámetros que se mueven (matemática, física, economía, biología).
datos: {"titulo": string, "explica": "qué mirar al mover los parámetros", "x": {"min": n, "max": n, "etiqueta": "t (s)"}, "y": {"min": n|null, "max": n|null, "etiqueta": string}, "parametros": [{"nombre": "a", "etiqueta": "Amplitud", "min": n, "max": n, "valor": n, "paso": n}], "curvas": [{"expr": "a*sin(b*x)", "etiqueta": string}], "puntos": [{"x": n, "etiqueta": "un punto notable"}]}
Expresiones: números, x, los parámetros, pi, e, + - * / ^ y paréntesis, y sin cos tan asin acos atan exp ln log sqrt abs min max pow floor ceil round sign. Nada más.`,
  molecula: `"molecula" — una proteína o una molécula.
datos: {"titulo": string, "explica": "qué mirar", "pdb": "código PDB real de 4 caracteres (ej. 1UBQ, 1HHO, 2LYZ) o null", "residuos": [{"n": número de residuo, "cadena": "A", "nota": "por qué importa"}], "pasos": [{"texto": "qué pasa", "plegado": 0..1 (0 = cadena estirada, 1 = plegada)}], "atomos": [{"e": "C", "x": n, "y": n, "z": n}] (solo si no hay pdb: una molécula chica, coordenadas en Å), "enlaces": [[i, j, orden]]}
Una proteína: SIEMPRE con su código PDB real (no inventes uno; si no sabés cuál, elegí otra plantilla). Una molécula chica (agua, glucosa, ATP simplificado): átomos y enlaces.`,
  movimiento: `"movimiento" — un ejercicio, una postura o una técnica del cuerpo.
datos: {"titulo": string, "explica": "qué mirar", "vista": "perfil"|"frente", "fases": [{"nombre": "Bajada", "ms": 1500, "pose": {...ángulos}, "musculos": ["cuádriceps", "glúteos"], "cue": "la indicación clave"}], "errores": [{"nombre": "Rodillas hacia adentro", "fase": índice, "pose": {...los ángulos que cambian}, "explica": "por qué está mal y cómo corregirlo"}]}
Ángulos en grados. Perfil (mirando a la derecha): "tronco" inclinación desde la vertical (+ adelante), "cuello", "hombro" flexión del brazo (0 abajo, 90 adelante, 180 arriba), "codo" flexión (0 estirado), "cadera" flexión del muslo respecto del tronco (0 alineado, 90 sentado), "rodilla" flexión (0 estirada, 90 en ángulo recto), "tobillo" dorsiflexión (+ rodilla hacia adelante). Frente: "hombroAbd" y "caderaAbd" (apertura), "rodilla". Con sufijo I o D para un solo lado (caderaI, rodillaD) cuando el movimiento es asimétrico. 2 a 6 fases.`,
}

const SISTEMA = (permitidas: Plantilla[]) => `Sos el ilustrador técnico del Taller de Mastropiero. NO escribís código: elegís la plantilla que mejor muestra el concepto y mandás sus DATOS; un dibujante fijo los dibuja (interactivo, en castellano rioplatense).
Plantillas posibles:
${permitidas.map((p) => `- ${FORMAS[p]}`).join('\n')}
- "libre" — si de verdad ninguna sirve (entonces "datos": null y se dibuja a mano).
Reglas: correcto antes que lindo (valores, nombres, proporciones de verdad); textos cortos y claros; nada inventado.
Forma: {"plantilla": ${[...permitidas, 'libre'].map((p) => `"${p}"`).join('|')}, "datos": {...}}`

export type DatosVisual = { plantilla: Plantilla; datos: any; modelo: string | null; tokens: number }

/** El modelo (inyectable para tests: sin tokens). */
let modelo = async (db: Db, sistema: string, usuario: string): Promise<{ datos: any; modelo: string; tokens: number }> =>
  pedirJson({ db, clase: 'mastropiero', agenteId: 'taller' }, sistema, usuario, { temperatura: 0.3, maxTokens: 5000 })
export function _probarVisuales(f: typeof modelo) { modelo = f }

/**
 * Los datos de un visual: el modelo elige plantilla y manda los datos; se validan (si no cierran, un segundo intento
 * diciéndole qué falló). Si es una proteína, se baja su estructura. null: va por el HTML libre.
 * previo: los datos de la versión anterior (para «Mejorar»: se cambia solo lo pedido).
 */
export async function datosVisual(db: Db, a: { clase: string; concepto: string; pedido: string; dominio?: string | null; nivel?: number | null; lecciones?: string }, previo?: { plantilla: Plantilla; datos: any } | null): Promise<DatosVisual | null> {
  const permitidas = previo ? [previo.plantilla] : PLANTILLAS_DE[a.clase] ?? ['diagrama']
  const usuario = [
    previo ? `Los datos actuales (plantilla ${previo.plantilla}):\n${JSON.stringify(previo.datos).slice(0, 12000)}\n\nLo que hay que mejorar: ${a.pedido}\nDevolvé los datos completos, mejorados, con la misma plantilla.`
      : `Concepto: ${a.concepto}${a.dominio ? ` (dominio: ${a.dominio}${a.nivel ? `, nivel ${a.nivel} de 6` : ''})` : ''}\nQué tiene que mostrar: ${a.pedido}`,
    a.lecciones ? `Lo que aprendimos de sus valoraciones (respetalo):\n${a.lecciones}` : '',
  ].filter(Boolean).join('\n\n')
  let tokens = 0
  let nota = ''
  for (let intento = 0; intento < 2; intento++) {
    const r = await modelo(db, SISTEMA(permitidas), nota ? `${usuario}\n\nLo anterior no sirvió: ${nota}. Corregilo.` : usuario)
    tokens += r.tokens ?? 0
    const plantilla = r.datos?.plantilla
    if (plantilla === 'libre' || !permitidas.includes(plantilla)) return null
    const v = VALIDAR[plantilla as Plantilla](r.datos?.datos)
    if (!v.ok) { nota = v.motivo; continue }
    if (plantilla === 'molecula' && v.datos.pdb) {
      try {
        const p = parsearPdb(await bajarPdb(v.datos.pdb))
        if (p.cadena.length < 5) { nota = `el PDB ${v.datos.pdb} no trae una cadena de proteína`; continue }
        v.datos.cadena = p.cadena.map((x) => [x.x, x.y, x.z, x.ss, x.res, x.n, x.c])
        v.datos.nombrePdb = p.titulo
      } catch (e) { nota = `${(e as Error).message}: usá un código PDB que exista`; continue }
    }
    return { plantilla, datos: v.datos, modelo: r.modelo ?? null, tokens }
  }
  return null
}

/** La cáscara: los datos inline y el dibujante de su plantilla (todo lo demás vive en /visual/). */
export function shellVisual(plantilla: Plantilla, datos: any, titulo: string): string {
  const seguro = JSON.stringify(datos).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const t = String(titulo).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title>
<link rel="stylesheet" href="/visual/visual.css"></head>
<body><main id="visual" data-plantilla="${plantilla}"></main>
<script>window.VISUAL = ${seguro}</script>
<script src="/visual/comun.js"></script><script src="/visual/${plantilla}.js"></script>
</body></html>
`
}
