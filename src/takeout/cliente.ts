/**
 * El Takeout desde la compu: lee los zips de Google Takeout (sin descomprimirlos), arma un paquete de texto con fechas
 * y achica los medios (audio a MP3 mono de 32 kbps, imágenes a JPG de 1600 px) para subirlos a la nube. Acá no se usa
 * ningún modelo ni se gasta un token: escuchar, mirar y destilar lo hace Deprocast allá.
 * Se puede cortar y repetir: lo ya preparado o subido no se rehace.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { abrirZip, type EntradaZip, type Zip } from './zip.ts'
import { aMarkdown, chatsDeGemini, claseDeArchivo, dia, queEs, turnosDeChatNlm, turnosDeGemini, type ClaseMedio } from './leer.ts'
import type { Aparicion } from './nube.ts'

type Ref = { zip: Zip; e: EntradaZip }
type Medio = { huella: string; clase: ClaseMedio; ext: string; nombre: string; ruta: string; apariciones: Aparicion[] }
type Log = (t: string) => void

/** El id del lote: el de la exportación («takeout-20261014T112845Z»), así repetir no duplica. */
export function loteDe(carpeta: string): string {
  const z = fs.readdirSync(carpeta).find((f) => /^takeout-\d{8}T\d{6}Z/.test(f))
  return z ? /^(takeout-\d{8}T\d{6}Z)/.exec(z)![1] : `takeout-${path.basename(path.resolve(carpeta)).replace(/[^\w.-]/g, '-').slice(0, 40)}`
}

const ejecutar = (args: string[]) => new Promise<boolean>((ok) => {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'ignore' })
  p.on('error', () => ok(false))
  p.on('exit', (c) => ok(c === 0))
})

/** Achica un medio: el resultado queda en «salida». false si no se pudo (formato roto, sin ffmpeg). */
async function achicar(datos: Buffer, ext: string, clase: ClaseMedio, salida: string, tmp: string): Promise<boolean> {
  if (clase === 'documento') { fs.writeFileSync(salida, datos); return true }
  const entrada = path.join(tmp, `entrada-${crypto.randomBytes(6).toString('hex')}.${ext || 'bin'}`)
  fs.writeFileSync(entrada, datos)
  try {
    const ok = clase === 'audio'
      ? await ejecutar(['-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', salida])
      : await ejecutar(['-i', entrada, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-q:v', '4', salida])
    if (ok && clase === 'audio' && fs.statSync(salida).size > 60 * 1024 * 1024) await ejecutar(['-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '16k', salida])
    return ok && fs.existsSync(salida) && fs.statSync(salida).size > 0
  } finally {
    fs.rmSync(entrada, { force: true })
  }
}

/** Lo que no vale subir: volcados de datos enormes (json, xml, html de varios MB) y documentos gigantes. */
const descartable = (ext: string, bytes: number) => (/^(json|xml|html?)$/.test(ext) && bytes > 2 * 1024 * 1024) || bytes > 400 * 1024 * 1024 || (/^(pdf|docx|xlsx|pptx|md|txt|csv)$/.test(ext) && bytes > 30 * 1024 * 1024)

export async function prepararTakeout(carpeta: string, o: { salida?: string; log?: Log; paralelo?: number } = {}): Promise<{ lote: string; dir: string; paquete: string; medios: Medio[]; resumen: Record<string, number> }> {
  const log = o.log ?? (() => {})
  const lote = loteDe(carpeta)
  const dir = path.resolve(o.salida ?? path.join(process.cwd(), 'data', 'takeout', lote))
  const dirMedios = path.join(dir, 'medios')
  const tmp = path.join(dir, 'tmp')
  fs.mkdirSync(dirMedios, { recursive: true })
  fs.mkdirSync(tmp, { recursive: true })
  const cacheRuta = path.join(dir, 'huellas.json')
  const cache: Record<string, string> = fs.existsSync(cacheRuta) ? JSON.parse(fs.readFileSync(cacheRuta, 'utf8')) : {}
  const resumen: Record<string, number> = {}
  const mas = (k: string, n = 1) => { resumen[k] = (resumen[k] ?? 0) + n }

  const zips = fs.readdirSync(carpeta).filter((f) => f.toLowerCase().endsWith('.zip')).sort().map((f) => abrirZip(path.join(carpeta, f)))
  const todas: Ref[] = zips.flatMap((zip) => zip.entradas.filter((e) => !e.dir).map((e) => ({ zip, e })))
  log(`${zips.length} zips, ${todas.length} archivos`)
  const leerTexto = (r: Ref) => r.zip.leer(r.e).toString('utf8')

  // ── medios: cada archivo una vez (por su huella), con todas las veces que apareció
  const medios = new Map<string, Medio>()
  const porEntrada = new Map<string, string | null>() // ruta dentro del zip → huella (null: no se sube)
  const pendientes: { r: Ref; ap: Aparicion }[] = []
  const pedirMedio = (r: Ref, ap: Aparicion) => pendientes.push({ r, ap })

  // ── Gemini
  const enGemini = todas.filter((r) => r.e.nombre.includes('/My Activity/Gemini Apps/'))
  const actividad = enGemini.filter((r) => /\/MyActivity[^/]*\.html$/.test(r.e.nombre))
  const chats = chatsDeGemini(actividad.flatMap((r) => turnosDeGemini(leerTexto(r))))
  const archivosGemini = new Map(enGemini.map((r) => [path.basename(r.e.nombre), r]))
  for (const c of chats) for (const t of c.turnos) for (const a of t.adjuntos) {
    const r = archivosGemini.get(a.archivo)
    if (!r) { mas('adjuntos_sin_archivo'); continue }
    const clase = claseDeArchivo(a.archivo)?.clase
    pedirMedio(r, { origen: 'gemini', contexto: c.id, titulo: c.titulo, fecha: dia(t.cuando), nivel: clase === 'audio' ? 'propia' : 'primaria', rol: 'adjunto' })
  }
  log(`Gemini: ${chats.length} conversaciones, ${chats.reduce((s, c) => s + c.turnos.length, 0)} pedidos`)

  // ── NotebookLM: agrupado por cuaderno
  const cuadernos = new Map<string, Map<string, Ref>>()
  for (const r of todas) {
    const i = r.e.nombre.indexOf('/NotebookLM/')
    if (i < 0) continue
    const rel = r.e.nombre.slice(i + '/NotebookLM/'.length)
    const carpetaC = rel.split('/')[0]
    if (!rel.includes('/')) continue
    const m = cuadernos.get(carpetaC) ?? new Map()
    m.set(rel, r)
    cuadernos.set(carpetaC, m)
  }
  type Nlm = { linea: any; cosas: any[] }
  const nlm: Nlm[] = []
  for (const [carpetaC, archivos] of cuadernos) {
    let meta: any = {}
    const fuentesMeta = new Map<string, any>()
    const fuentesHtml = new Map<string, Ref>()
    const artMeta = new Map<string, any>()
    const artCont = new Map<string, { ext: string; r: Ref }[]>()
    const cosas: any[] = []
    let descubiertas: any[] = []
    for (const [rel, r] of archivos) {
      const q = queEs(rel)
      try {
        if (q.que === 'meta-cuaderno') meta = JSON.parse(leerTexto(r))
        else if (q.que === 'fuente-meta') fuentesMeta.set(q.base, JSON.parse(leerTexto(r)))
        else if (q.que === 'fuente' && rel.endsWith('.html')) fuentesHtml.set(q.base, r)
        else if (q.que === 'artefacto-meta') artMeta.set(q.base, JSON.parse(leerTexto(r)))
        else if (q.que === 'artefacto') artCont.set(q.base, [...(artCont.get(q.base) ?? []), { ext: q.ext, r }])
        else if (q.que === 'nota') cosas.push({ t: 'nota', carpeta: carpetaC, titulo: q.base, texto: aMarkdown(leerTexto(r)) })
        else if (q.que === 'chat') cosas.push({ t: 'chat-nlm', carpeta: carpetaC, archivo: q.base, turnos: turnosDeChatNlm(leerTexto(r)) })
        else if (q.que === 'descubiertas') descubiertas = (JSON.parse(leerTexto(r))?.discoverSourcesJob?.discoverSourcesResults?.discoveredSources ?? []).map((d: any) => ({ url: d.sourceUrl, titulo: d.title, explicacion: d.explanation }))
      } catch { mas('nlm_ilegibles') }
    }
    const titulo = String(meta.title || carpetaC)
    const fuentes = [...new Set([...fuentesMeta.keys(), ...fuentesHtml.keys()])].map((base) => {
      const m = fuentesMeta.get(base) ?? {}
      return { base, titulo: String(m.title ?? base), tipo: String(m.metadata?.originalSourceContentType ?? ''), agregada: m.metadata?.sourceAddedTimestamp ?? m.metadata?.revisionData?.dateAdded ?? null }
    })
    const ultima = fuentes.map((f) => f.agregada).filter(Boolean).sort().at(-1) ?? meta.metadata?.lastViewed ?? null
    for (const f of fuentes) {
      const r = fuentesHtml.get(f.base)
      if (!r) continue
      cosas.push({ t: 'fuente', carpeta: carpetaC, titulo: f.titulo, tipo: f.tipo, agregada: f.agregada, texto: aMarkdown(leerTexto(r)) })
    }
    for (const c of cosas) if (c.t === 'chat-nlm' || c.t === 'nota') c.fecha = ultima
    const artefactos: { titulo: string; tipo: string }[] = []
    for (const base of new Set([...artMeta.keys(), ...artCont.keys()])) {
      const m = artMeta.get(base) ?? {}
      const tituloA = String(m.title ?? base)
      const tipo = String(m.type ?? '')
      artefactos.push({ titulo: tituloA, tipo })
      for (const { ext, r } of artCont.get(base) ?? []) {
        if (ext === 'md' || ext === '' || ext === 'html' || ext === 'json' || ext === 'csv') {
          let texto = ext === 'md' || ext === 'csv' ? leerTexto(r) : ext === 'json' ? leerTexto(r).slice(0, 60_000) : aMarkdown(leerTexto(r))
          texto = texto.slice(0, 150_000)
          cosas.push({ t: 'artefacto', carpeta: carpetaC, titulo: tituloA, tipo, fecha: ultima, texto })
        } else if (claseDeArchivo(`x.${ext}`)) pedirMedio(r, { origen: 'notebooklm', contexto: carpetaC, titulo: tituloA, fecha: ultima ? String(ultima).slice(0, 10) : null, nivel: 'generada', rol: tipo.replace('ARTIFACT_TYPE_', '').toLowerCase() || 'artefacto' })
      }
    }
    nlm.push({
      linea: { t: 'cuaderno', carpeta: carpetaC, titulo, emoji: meta.emoji ?? null, creado: meta.metadata?.createTime ?? null, visto: meta.metadata?.lastViewed ?? null, ultima, fuentes: fuentes.map(({ titulo: t, tipo, agregada }) => ({ titulo: t, tipo, agregada })), artefactos, chats: cosas.filter((c) => c.t === 'chat-nlm').length, notas: cosas.filter((c) => c.t === 'nota').length, descubiertas },
      cosas,
    })
  }
  log(`NotebookLM: ${nlm.length} cuadernos, ${nlm.reduce((s, c) => s + c.cosas.length, 0)} fuentes, notas, chats y artefactos`)

  // ── medios: huella, achicar (en paralelo), sin repetir
  log(`Medios: ${pendientes.length} apariciones; preparando…`)
  let hechos = 0
  const cola = [...pendientes]
  const trabajar = async () => {
    for (;;) {
      const p = cola.shift()
      if (!p) return
      const k = `${p.r.e.nombre}|${p.r.e.tamano}`
      let huella: string | null | undefined = porEntrada.has(k) ? porEntrada.get(k)! : undefined
      if (huella === undefined) {
        huella = null
        const datos = p.r.zip.leer(p.r.e)
        const cl = claseDeArchivo(path.basename(p.r.e.nombre), datos.subarray(0, 16))
        if (cl && !descartable(cl.ext, datos.length)) {
          const h = cache[k] ?? crypto.createHash('sha1').update(datos).digest('hex')
          cache[k] = h
          const extOut = cl.clase === 'audio' ? 'mp3' : cl.clase === 'imagen' ? 'jpg' : cl.ext === 'htm' ? 'html' : cl.ext
          const salida = path.join(dirMedios, `${h}.${extOut}`)
          const ya = medios.get(h)
          if (ya || (fs.existsSync(salida) && fs.statSync(salida).size > 0) || await achicar(datos, cl.ext, cl.clase, salida, tmp)) {
            huella = h
            if (!ya) medios.set(h, { huella: h, clase: cl.clase, ext: extOut, nombre: path.basename(p.r.e.nombre).slice(0, 200), ruta: salida, apariciones: [] })
          } else mas('medios_rotos')
        } else mas('medios_salteados')
        porEntrada.set(k, huella)
      }
      if (huella) medios.get(huella)!.apariciones.push(p.ap)
      if (++hechos % 100 === 0) {
        log(`  ${hechos}/${pendientes.length}`)
        fs.writeFileSync(cacheRuta, JSON.stringify(cache))
      }
    }
  }
  await Promise.all(Array.from({ length: o.paralelo ?? 4 }, trabajar))
  fs.writeFileSync(cacheRuta, JSON.stringify(cache))
  fs.rmSync(tmp, { recursive: true, force: true })

  // ── el paquete: una línea por cosa
  const paquete = path.join(dir, 'paquete.jsonl')
  const fd = fs.openSync(`${paquete}.parcial`, 'w')
  const w = (x: unknown) => fs.writeSync(fd, `${JSON.stringify(x)}\n`)
  const huellaDe = (archivo: string) => { const r = archivosGemini.get(archivo); return r ? porEntrada.get(`${r.e.nombre}|${r.e.tamano}`) ?? null : null }
  try {
    w({ t: 'lote', id: lote, creado: Date.now() })
    for (const c of chats) w({ t: 'gemini', id: c.id, titulo: c.titulo, desde: c.desde, hasta: c.hasta, turnos: c.turnos.map((t) => ({ cuando: t.cuando, prompt: t.prompt, respuesta: t.respuesta, adjuntos: t.adjuntos.map((a) => ({ huella: huellaDe(a.archivo), nombre: a.nombre })) })) })
    for (const c of nlm) { w(c.linea); for (const x of c.cosas) w(x) }
    for (const m of medios.values()) {
      const unicas = [...new Map(m.apariciones.map((a) => [`${a.origen}|${a.contexto}|${a.fecha}|${a.titulo}`, a])).values()]
      w({ t: 'medio', huella: m.huella, clase: m.clase, ext: m.ext, nombre: m.nombre, apariciones: unicas })
    }
    w({ t: 'fin' })
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(`${paquete}.parcial`, paquete)
  for (const z of zips) z.cerrar()
  mas('chats', chats.length)
  mas('cuadernos', nlm.length)
  mas('medios', medios.size)
  for (const m of medios.values()) mas(`medios_${m.clase}`)
  const lista = [...medios.values()].map((m) => ({ ...m, apariciones: [] }))
  fs.writeFileSync(path.join(dir, 'medios.json'), JSON.stringify(lista))
  log(`Listo: paquete de ${Math.round(fs.statSync(paquete).size / 1048576)} MB y ${medios.size} medios (${Math.round(lista.reduce((s, m) => s + fs.statSync(m.ruta).size, 0) / 1048576)} MB)`)
  return { lote, dir, paquete, medios: [...medios.values()], resumen }
}

// ─── subir ──────────────────────────────────────────────────────────────

async function entrar(base: string, clave: string): Promise<string> {
  if (!clave || clave.length < 8) throw new Error('Falta la clave de la nube (MASTRO_CLAVE_NUBE en .env)')
  const r = await fetch(`${base}/entrar`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ clave }).toString(), redirect: 'manual' })
  const cookie = /mastro=[^;]+/.exec(r.headers.get('set-cookie') ?? '')?.[0]
  if (!cookie) throw new Error(`La nube no aceptó la clave (respondió ${r.status})`)
  return cookie
}

/** Sube el paquete y los medios que falten; la nube hace el resto sola. */
export async function subirTakeout(url: string, clave: string, dir: string, lote: string, o: { log?: Log } = {}) {
  const log = o.log ?? (() => {})
  const base = url.replace(/\/+$/, '')
  const cookie = await entrar(base, clave)
  const pedir = async (ruta: string, init: RequestInit = {}) => {
    for (let intento = 1; ; intento++) {
      try {
        const r = await fetch(`${base}${ruta}`, { ...init, headers: { cookie, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(300_000) })
        const j = await r.json().catch(() => ({ error: `respondió ${r.status}` }))
        if (!r.ok) throw new Error(j.error ?? `respondió ${r.status}`)
        return j
      } catch (e) {
        if (intento >= 4) throw e
        await new Promise((ok) => setTimeout(ok, 3000 * intento))
      }
    }
  }
  const estado = async () => ((await pedir('/api/takeout')).lotes as any[]).find((l) => l.id === lote)
  let l = await estado()
  if (!l?.resumen?.ingesta_chats && !l?.resumen?.ingesta_cuadernos) {
    const paquete = path.join(dir, 'paquete.jsonl')
    const total = fs.statSync(paquete).size
    const fd = fs.openSync(paquete, 'r')
    const PEDAZO = 16 * 1024 * 1024
    try {
      for (let desde = 0; desde < total; desde += PEDAZO) {
        const b = Buffer.alloc(Math.min(PEDAZO, total - desde))
        fs.readSync(fd, b, 0, b.length, desde)
        await pedir(`/api/takeout/paquete/parte?lote=${lote}&desde=${desde}`, { method: 'POST', body: b })
        log(`Paquete: ${Math.round(((desde + b.length) / total) * 100)}%`)
      }
    } finally {
      fs.closeSync(fd)
    }
    await pedir(`/api/takeout/paquete/fin?lote=${lote}&total=${total}`, { method: 'POST', body: '' })
    log('La nube está leyendo el paquete…')
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 5000))
      l = await estado()
      if (l?.estado === 'error') throw new Error(l.error ?? 'La nube no pudo leer el paquete')
      if (l?.resumen?.ingesta_chats || l?.resumen?.ingesta_cuadernos) break
    }
    log(`Leído: ${Object.entries(l.resumen).filter(([k]) => k.startsWith('ingesta_')).map(([k, v]) => `${k.slice(8)} ${v}`).join(' · ')}`)
  } else log('El paquete ya estaba en la nube.')

  const medios = JSON.parse(fs.readFileSync(path.join(dir, 'medios.json'), 'utf8')) as Medio[]
  const faltan: string[] = []
  for (let i = 0; i < medios.length; i += 400) faltan.push(...(await pedir('/api/takeout/faltan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ huellas: medios.slice(i, i + 400).map((m) => m.huella) }) })).faltan)
  const porHuella = new Map(medios.map((m) => [m.huella, m]))
  log(`Medios: faltan ${faltan.length} de ${medios.length}`)
  let n = 0
  let bytes = 0
  for (const h of faltan) {
    const m = porHuella.get(h)!
    if (!fs.existsSync(m.ruta)) continue
    const datos = fs.readFileSync(m.ruta)
    await pedir(`/api/takeout/medio?lote=${lote}&huella=${h}&ext=${m.ext}`, { method: 'POST', body: datos })
    bytes += datos.length
    if (++n % 50 === 0 || n === faltan.length) log(`  ${n}/${faltan.length} (${Math.round(bytes / 1048576)} MB)`)
  }
  await pedir(`/api/takeout/cerrar?lote=${lote}`, { method: 'POST', body: '' })
  log('Subido. Desde acá trabaja la nube sola: escucha, mira, destila y arma la historia de cada proyecto.')
  return await pedir('/api/takeout')
}
