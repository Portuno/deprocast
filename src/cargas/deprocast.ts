/**
 * Respaldo completo de Deprocast 0.7.x (`deprocast-backup`) y exportes de quántomos (`deprocast-quantomos`).
 *
 * El respaldo trae ~110 tablas; acá se segmenta en lo que es conocimiento. Lo operativo
 * (colas, embeddings de otro modelo, simulaciones de calendario, energía, estado de UI) no entra.
 * Todo lleva origen `deprocast-0.7.1:<tipo>:<id>`: repetir la carga no duplica nada.
 */
import type { TipoEntidad } from '../entidades.ts'
import type { Analisis, Contexto, Datos, Importador, Segmento } from './tipos.ts'

export const INSTANCIA = 'deprocast-0.7.1'
export const ORIGEN = (tipo: string, id: string | number) => `${INSTANCIA}:${tipo}:${id}`

const arr = <T = any>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[]
  if (typeof v !== 'string' || !v) return []
  try {
    const x = JSON.parse(v)
    return Array.isArray(x) ? x : []
  } catch {
    return []
  }
}
const obj = (v: unknown): Record<string, any> => {
  if (v && typeof v === 'object') return v as Record<string, any>
  try {
    const x = JSON.parse(String(v ?? ''))
    return x && typeof x === 'object' ? x : {}
  } catch {
    return {}
  }
}

const UMBRAL_DEFECTO = 4

// ─── qué se toma de cada tabla ──────────────────────────────────────────

function tablas(j: any) {
  const T = j.tables ?? {}
  const t = (n: string): any[] => (Array.isArray(T[n]) ? T[n] : [])
  const entradasSueltas = t('entries').filter((e) => e.status === 'approved' && ['audio', 'blob', 'document'].includes(e.source_type))
  return {
    T: t,
    audios: entradasSueltas.filter((e) => e.source_type === 'audio'),
    notas: entradasSueltas.filter((e) => e.source_type !== 'audio'),
    paginas: t('pages').filter((p) => !p.is_blank && (p.transcription_spatial?.trim() || p.explanation?.trim())),
    chats: t('chat_blocks').filter((b) => b.entry_id),
    bookmarks: t('bookmarks'),
    conocimiento: t('knowledge_entities').filter((k) => k.status === 'ready'),
    hallazgos: t('depro_research_findings'),
    informes: [
      ...t('resumidor_reports').filter((r) => r.markdown).map((r) => ({ tipo: 'resumidor', r })),
      ...t('directo_reports').filter((r) => r.summary).map((r) => ({ tipo: 'directo', r })),
      ...t('entries').filter((e) => e.source_type === 'agente' && e.content_raw).map((r) => ({ tipo: 'agente', r })),
    ],
    listas: t('ama_lists'),
    enlaces: [...new Map(t('link_harvest').map((l) => [l.url_norm || l.url_cruda, l])).values()],
    quantomos: t('quantomos'),
    candidatos: t('quantomo_candidates').filter((c) => c.status !== 'rejected'),
    personas: t('persons').filter((p) => p.status !== 'merged' && p.kind !== 'ruido'),
    proyectos: t('projects').filter((p) => p.status !== 'merged'),
    agrupaciones: t('agrupaciones'),
    dominios: t('dominios'),
    lugares: t('geografia').filter((g) => g.status !== 'merged'),
  }
}

function bookmarksCribados(bs: any[], umbral: number) {
  return bs.filter((b) => b.status !== 'SLOP' && (b.weight ?? 0) >= umbral)
}

// ─── análisis ───────────────────────────────────────────────────────────

function analizarRespaldo(d: Datos): Analisis {
  const j = d.json
  const x = tablas(j)
  const nEntidades = x.personas.length + x.proyectos.length + x.agrupaciones.length + x.dominios.length + x.lugares.length
  const seg = (s: Segmento) => s
  const segmentos: Segmento[] = [
    seg({ id: 'entidades', nombre: 'Entidades', descripcion: `Personas (${x.personas.length}), proyectos y conceptos (${x.proyectos.length}), agrupaciones (${x.agrupaciones.length}), dominios (${x.dominios.length}) y lugares (${x.lugares.length}). Las fusionadas se resuelven a su destino.`, nivel: null, destino: 'entidades', cantidad: nEntidades, porDefecto: true, nota: 'Van primero: las piezas se marcan con las entidades que mencionan.' }),
    seg({ id: 'audios', nombre: 'Notas de voz', descripcion: 'Transcripciones aprobadas en Aduana, con peso, tareas extraídas y hablantes.', nivel: 'propia', destino: 'corpus', cantidad: x.audios.length, porDefecto: true }),
    seg({ id: 'notas', nombre: 'Notas y documentos', descripcion: 'Blobs de Zona franca y documentos sueltos.', nivel: 'propia', destino: 'corpus', cantidad: x.notas.length, porDefecto: true }),
    seg({ id: 'cuaderno', nombre: 'Cuadernos', descripcion: 'Páginas con transcripción. La exégesis del Visionario va aparte, marcada como generada.', nivel: 'propia', destino: 'corpus', cantidad: x.paginas.length, porDefecto: true }),
    seg({ id: 'chats', nombre: 'Conversaciones', descripcion: 'Chats importados, una pieza por jornada.', nivel: 'propia', destino: 'corpus', cantidad: x.chats.length, porDefecto: true }),
    seg({ id: 'criba', nombre: 'Criba (bookmarks)', descripcion: `Posts de X e Instagram cribados. Se toman los de peso ≥ umbral y nunca el slop (${x.bookmarks.filter((b) => b.status === 'SLOP').length}).`, nivel: 'primaria', destino: 'corpus', cantidad: bookmarksCribados(x.bookmarks, UMBRAL_DEFECTO).length, porDefecto: true, nota: `Con umbral ${UMBRAL_DEFECTO}. El total sin slop es ${bookmarksCribados(x.bookmarks, 1).length}.` }),
    seg({ id: 'conocimiento', nombre: 'Conocimiento', descripcion: 'Fichas de repos, currículas y normas, con su destilado.', nivel: 'primaria', destino: 'corpus', cantidad: x.conocimiento.length, porDefecto: true }),
    seg({ id: 'investigaciones', nombre: 'Investigaciones', descripcion: `Hallazgos de ${x.T('depro_research_packs').length} packs del Explorador, cada uno con su URL.`, nivel: 'investigacion', destino: 'corpus', cantidad: x.hallazgos.length, porDefecto: true }),
    seg({ id: 'informes', nombre: 'Informes del sistema', descripcion: 'Resumidor, bitácoras de Directo y salidas de agentes.', nivel: 'generada', destino: 'corpus', cantidad: x.informes.length, porDefecto: true }),
    seg({ id: 'listas', nombre: 'Listas AmazonA', descripcion: 'Tridentes y Lista6 con sus elementos.', nivel: 'propia', destino: 'corpus', cantidad: x.listas.length, porDefecto: true }),
    seg({ id: 'quantomos', nombre: 'Quántomos', descripcion: `${x.quantomos.length} quántomos (con sello L72 y haikus como facetas) y ${x.candidatos.length} candidatos que esperaban Aduana, como proto.`, nivel: null, destino: 'quantomos', cantidad: x.quantomos.length + x.candidatos.length, porDefecto: true, nota: 'Se enlazan a la pieza de la que salieron si esa pieza entra en esta carga.' }),
    seg({ id: 'enlaces', nombre: 'Enlaces por traer', descripcion: 'URLs cosechadas de chats, entradas y bookmarks, sin repetir. Entran como pendientes: materia para crawlers.', nivel: 'primaria', destino: 'corpus', cantidad: x.enlaces.length, porDefecto: false, nota: 'No pasan por la pipeline hasta que un crawler las traiga.' }),
  ]
  const avisos: string[] = []
  if (j.include_media === false) avisos.push('El respaldo no incluye medios: audios e imágenes quedan como texto y metadatos.')
  avisos.push('No entran: embeddings (otro modelo, se recalculan), colas, simulaciones de calendario, energía ni estado de pantalla.')
  return {
    importador: 'deprocast-respaldo',
    titulo: `Respaldo de ${j.run?.operator_name ?? 'Deprocast'} · ${String(j.exported_at ?? '').slice(0, 10)}`,
    descripcion: `Deprocast 0.7.1 · formato v${j.version} · ${j.run?.day_count ?? '?'} días de RUN · ${Object.keys(j.tables ?? {}).length} tablas.`,
    segmentos,
    fuente: { id: INSTANCIA, nombre: 'Deprocast 0.7.1', nivel: 'propia', padreId: 'deprocast-0.7', descripcion: 'La instancia nativa: audios, cuadernos, criba, chats.' },
    nivelEditable: false,
    umbralPeso: UMBRAL_DEFECTO,
    avisos,
  }
}

// ─── ejecución ──────────────────────────────────────────────────────────

const TIPO_LINK: Record<string, TipoEntidad> = { person: 'persona', project: 'proyecto', agrupacion: 'agrupacion', dominio: 'dominio', geografia: 'lugar' }

function ejecutarRespaldo(d: Datos, ctx: Contexto) {
  const x = tablas(d.json)
  const umbral = ctx.opciones.umbralPeso ?? UMBRAL_DEFECTO

  // Entidades. Las fusionadas apuntan a su destino: así los vínculos viejos resuelven.
  const destino = new Map<string, string>()
  for (const [tabla, tipo] of [['persons', 'persona'], ['projects', 'proyecto'], ['geografia', 'lugar']] as const) {
    for (const r of x.T(tabla)) if (r.merged_into) destino.set(`${tipo}:${r.id}`, `${tipo}:${r.merged_into}`)
  }
  const resolver = (clave: string) => {
    let k = clave
    for (let i = 0; i < 8 && destino.has(k); i++) k = destino.get(k)!
    return k
  }
  const idEntidad = new Map<string, number>()
  const nombreEntidad = new Map<string, string>()
  const alta = (tipo: TipoEntidad, r: any, nombre: string, extra: Record<string, unknown> = {}) => {
    const clave = `${tipo}:${r.id}`
    nombreEntidad.set(clave, nombre)
    if (!ctx.quiere('entidades')) return
    idEntidad.set(clave, ctx.entidad('entidades', {
      tipo, nombre, alias: arr<string>(r.aliases), notas: r.notes ?? null, origenId: ORIGEN(tipo, r.id), meta: Object.keys(extra).length ? extra : null,
    }))
  }
  for (const p of x.personas) alta('persona', p, p.name, { clase: p.kind, ...(p.is_operator ? { operador: true } : {}) })
  for (const p of x.proyectos) alta(p.category === 'concepto' ? 'concepto' : 'proyecto', p, p.title, { estado: p.status })
  for (const a of x.agrupaciones) alta('agrupacion', a, a.name)
  for (const dm of x.dominios) alta('dominio', dm, dm.name)
  for (const g of x.lugares) alta('lugar', g, g.name, { clase: g.kind })
  // Los conceptos se dieron de alta como 'concepto' pero los vínculos los nombran como project.
  for (const p of x.proyectos) if (p.category === 'concepto') {
    if (idEntidad.has(`concepto:${p.id}`)) idEntidad.set(`proyecto:${p.id}`, idEntidad.get(`concepto:${p.id}`)!)
    nombreEntidad.set(`proyecto:${p.id}`, p.title)
  }

  // Vínculos entidad ↔ entrada / quántomo.
  const porEntrada = new Map<string, Set<string>>()
  for (const l of x.T('entity_links')) {
    const tipo = TIPO_LINK[l.entity_kind]
    // via_agrupacion es pertenencia propagada (toda persona de un grupo, en cada entrada que nombra al grupo): no es una mención.
    if (!tipo || !l.entry_id || l.role === 'via_agrupacion') continue
    const k = resolver(`${tipo}:${l.entity_id}`)
    if (!porEntrada.has(l.entry_id)) porEntrada.set(l.entry_id, new Set())
    porEntrada.get(l.entry_id)!.add(k)
  }
  const marcas = (entryId: string | null | undefined, extra: string[] = []) => {
    const claves = [...(entryId ? porEntrada.get(entryId) ?? [] : [])]
    return {
      entidades: claves.map((k) => idEntidad.get(k)).filter((v): v is number => v != null),
      etiquetas: [...new Set([...extra, ...claves.map((k) => nombreEntidad.get(k)).filter((v): v is string => !!v)])].slice(0, 24),
    }
  }

  // entry_id → pieza, para enlazar quántomos.
  const piezaDeEntrada = new Map<string, number>()
  const anotar = (entryId: string | null | undefined, id: number | null) => {
    if (entryId && id != null) piezaDeEntrada.set(entryId, id)
  }
  const transcripcion = new Map(x.T('validated_file_metadata').map((v) => [v.entry_id, v]))
  const acciones = new Map<string, string[]>()
  for (const t of x.T('pending_tasks')) {
    if (t.status === 'rejected') continue
    acciones.set(t.entry_id, [...(acciones.get(t.entry_id) ?? []), t.task_text])
  }

  if (ctx.quiere('audios')) {
    for (const e of x.audios) {
      const v = transcripcion.get(e.id)
      const contenido = e.content_raw || v?.transcription
      if (!contenido?.trim()) continue
      const m = marcas(e.id, arr<string>(e.manual_tags))
      anotar(e.id, ctx.pieza('audios', {
        titulo: v?.assigned_title || e.title, contenido, fecha: e.timestamp_exact, peso: e.human_weight ?? null, ...m,
        meta: { archivo: e.original_filename, duracion_s: e.duration_sec, nota: e.operator_note || undefined, acciones: acciones.get(e.id), hablantes: arr(e.speaker_map).length || undefined },
        origenId: ORIGEN('entry', e.id),
      }))
    }
  }
  if (ctx.quiere('notas')) {
    for (const e of x.notas) {
      if (!e.content_raw?.trim()) continue
      anotar(e.id, ctx.pieza('notas', {
        titulo: e.title, contenido: e.content_raw, fecha: e.timestamp_exact, peso: e.human_weight ?? null,
        ...marcas(e.id, [e.source_type === 'blob' ? 'nota' : 'documento', ...arr<string>(e.manual_tags)]),
        meta: { nota: e.operator_note || undefined, acciones: acciones.get(e.id) }, origenId: ORIGEN('entry', e.id),
      }))
    }
  }
  if (ctx.quiere('cuaderno')) {
    const cuadernos = new Map(x.T('notebooks').map((n) => [n.id, n.title]))
    for (const p of x.paginas) {
      const cuaderno = cuadernos.get(p.notebook_id) ?? 'Cuaderno'
      anotar(p.entry_id, ctx.pieza('cuaderno', {
        titulo: `${cuaderno} · hoja ${p.numero_logico}${p.title ? ` · ${p.title}` : ''}`,
        contenido: [p.transcription_spatial?.trim(), p.explanation_user?.trim() && `[Nota del operador]\n${p.explanation_user.trim()}`].filter(Boolean).join('\n\n') || `(Página sin texto: ${p.title ?? 'dibujo'})`,
        fecha: p.updated_at, peso: p.explanation_weight ?? null,
        ...marcas(p.entry_id, ['cuaderno', cuaderno]),
        meta: { cuaderno, hoja: p.numero_logico, posicion: p.posicion_visual, exegesis_generada: p.explanation || undefined, elementos_graficos: arr(p.graphic_elements).length || undefined },
        origenId: ORIGEN('page', p.id),
      }))
    }
  }
  if (ctx.quiere('chats')) {
    const sesiones = new Map(x.T('chat_sessions').map((s) => [s.id, s.nombre_chat]))
    const entradas = new Map(x.T('entries').map((e) => [e.id, e]))
    for (const b of x.chats) {
      const e = entradas.get(b.entry_id)
      if (!e?.content_raw?.trim()) continue
      const s = obj(b.summary_json)
      const chat = sesiones.get(b.chat_session_id) ?? 'Chat'
      anotar(b.entry_id, ctx.pieza('chats', {
        titulo: `${chat} · ${b.day_key}${s.title ? ` · ${s.title}` : ''}`, contenido: e.content_raw, fecha: b.started_at, peso: b.human_weight ?? null,
        ...marcas(b.entry_id, ['chat', chat, ...arr<any>(b.linked_entities_json).map((x) => x.name)]),
        meta: { chat, mensajes: b.message_count, resumen: s.summary && s.summary !== s.title ? s.summary : undefined },
        origenId: ORIGEN('chat_block', b.id),
      }))
    }
  }
  if (ctx.quiere('criba')) {
    for (const b of bookmarksCribados(x.bookmarks, umbral)) {
      const enr = obj(b.enrichment_json)
      const contenido = [
        b.text?.trim(),
        b.transcript?.trim() && `[Transcripción]\n${b.transcript.trim()}`,
        enr.video_meta && `[Descripción del video, generada]\n${enr.video_meta}`,
      ].filter(Boolean).join('\n\n')
      if (!contenido) continue
      anotar(b.entry_id, ctx.pieza('criba', {
        tipo: 'materia', titulo: (b.text ?? '').split('\n')[0].slice(0, 120) || `${b.source} @${b.author_username}`, contenido,
        autor: b.author_username ? `${b.author_name ?? ''} (@${b.author_username})`.trim() : b.author_name, url: b.link, fecha: b.created_at_source, peso: b.weight,
        ...marcas(b.entry_id, [b.source, b.category, ...arr<string>(b.manual_tags)].filter(Boolean)),
        meta: { quantomo_criba: b.quantomo || undefined, nota: b.operator_note || undefined, estado_criba: b.status },
        origenId: ORIGEN('bookmark', b.id),
      }))
    }
  }
  if (ctx.quiere('conocimiento')) {
    const repos = new Map(x.T('knowledge_repos').map((r) => [r.entity_id, r]))
    for (const k of x.conocimiento) {
      const r = repos.get(k.id)
      ctx.pieza('conocimiento', {
        tipo: 'referencia', titulo: k.title,
        contenido: [k.summary, k.utility_problem && `Problema que resuelve: ${k.utility_problem}`, k.architecture_tldr && `Arquitectura: ${k.architecture_tldr}`, k.use_cases && `Casos de uso: ${k.use_cases}`].filter(Boolean).join('\n\n'),
        autor: k.authors_org || null, url: k.source_url, fecha: k.captured_at, peso: k.weight ?? null,
        etiquetas: [k.kind, ...arr<string>(k.tags), ...arr<string>(r?.stack_tags), ...arr<string>(r?.topics_json)].filter(Boolean).slice(0, 16),
        meta: r ? { estrellas: r.stars, licencia: r.license, lenguajes: Object.keys(obj(r.languages_json)).slice(0, 6), ultimo_commit: r.last_commit_at, destilado: 'generado' } : { destilado: 'generado' },
        origenId: ORIGEN('knowledge', k.id),
      })
    }
  }
  if (ctx.quiere('investigaciones')) {
    const packs = new Map(x.T('depro_research_packs').map((p) => [p.id, p.topic]))
    for (const h of x.hallazgos) {
      if (!h.body?.trim()) continue
      const tema = packs.get(h.pack_id) ?? 'Investigación'
      ctx.pieza('investigaciones', {
        titulo: h.title, contenido: h.body, url: h.url || null, fecha: h.created_at,
        etiquetas: [tema.slice(0, 60), h.axis_title].filter(Boolean),
        meta: { pack: tema, eje: h.axis_title, estado: h.status }, origenId: ORIGEN('finding', h.id),
      })
    }
  }
  if (ctx.quiere('informes')) {
    for (const { tipo, r } of x.informes) {
      const [titulo, contenido, fecha, id] =
        tipo === 'resumidor' ? [`Resumidor · ${r.scope ?? 'organismo'} · ${String(r.created_at).slice(0, 10)}`, r.markdown, r.created_at, r.id]
          : tipo === 'directo' ? [`Directo · ${String(r.generated_at).slice(0, 10)}`, r.summary, r.generated_at, r.session_id]
            : [r.title, r.content_raw, r.created_at, r.id]
      ctx.pieza('informes', { titulo, contenido, fecha, etiquetas: [tipo], meta: { modelo: r.model ?? undefined }, origenId: ORIGEN(`informe-${tipo}`, id) })
    }
  }
  if (ctx.quiere('listas')) {
    const items = x.T('ama_list_items')
    for (const l of x.listas) {
      const propios = items.filter((i) => i.list_id === l.id).sort((a, b) => a.position - b.position)
      ctx.pieza('listas', {
        tipo: 'lista', titulo: l.title,
        contenido: [l.notes, ...propios.map((i, n) => `${n + 1}. ${i.label}${i.notes ? ` — ${i.notes}` : ''}`)].filter(Boolean).join('\n'),
        etiquetas: [l.kind, ...arr<string>(l.tags)], meta: { clase: l.kind, tamano: l.size, origen: l.source, elementos: propios.map((i) => i.label) },
        origenId: ORIGEN('lista', l.id),
      })
    }
  }
  if (ctx.quiere('enlaces')) {
    for (const l of x.enlaces) {
      const url = l.url_norm || l.url_cruda
      let titulo = url
      try {
        const u = new URL(url)
        titulo = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 160)
      } catch { /* queda la url */ }
      ctx.pieza('enlaces', {
        tipo: 'enlace', estado: 'pendiente', titulo, contenido: url, url, fecha: l.timestamp_captura,
        meta: { cosechado_de: l.source_type, remitente: l.remitente ?? undefined }, origenId: ORIGEN('link', url),
      })
    }
  }
  if (ctx.quiere('quantomos')) {
    const lattices = new Map(x.T('quantomo_lattices').map((l) => [l.quantomo_id, l]))
    const haikus = new Map<string, any[]>()
    for (const h of x.T('haikus')) haikus.set(h.quantomo_id, [...(haikus.get(h.quantomo_id) ?? []), h])
    // Bookmarks y bloques de chat apuntan a su quántomo; las entradas, al revés.
    for (const q of x.quantomos) {
      const l = lattices.get(q.id)
      ctx.quantomo('quantomos', {
        titulo: q.title, texto: q.content || q.title, peso: q.human_weight ?? q.hermetic_weight ?? null,
        etapa: q.stage === 'sealed' ? 'sellado' : 'proto', universo: q.universe ?? null, procedencia: q.procedencia ?? q.source_kind ?? null,
        piezaId: piezaDeEntrada.get(q.entry_id) ?? null,
        l72: l ? { codec: l.codec, celdas: l.cells, sello: l.seal, permutacion: l.permutation_id, premium: !!l.premium } : null,
        facetas: (haikus.get(q.id) ?? []).map((h) => ({ tipo: 'haiku', versos: [h.line1, h.line2, h.line3], valido: !!h.valid, cara: !!h.is_face })),
        origenId: ORIGEN('quantomo', q.id),
      })
    }
    for (const c of x.candidatos) {
      ctx.quantomo('quantomos', {
        texto: c.text, peso: c.peso ?? null, etapa: c.status === 'accepted' ? 'sellado' : 'proto',
        procedencia: [c.procedencia, c.source_kind, c.justificacion_peso && `peso: ${c.justificacion_peso}`].filter(Boolean).join(' · '),
        piezaId: piezaDeEntrada.get(c.source_ref) ?? null, origenId: ORIGEN('candidato', c.id),
      })
    }
  }
}

export const deprocastRespaldo: Importador = {
  id: 'deprocast-respaldo',
  nombre: 'Respaldo de Deprocast 0.7',
  detectar: (d) => d.json?.format === 'deprocast-backup',
  analizar: analizarRespaldo,
  ejecutar: ejecutarRespaldo,
}

// ─── exporte de quántomos ───────────────────────────────────────────────

export const deprocastQuantomos: Importador = {
  id: 'deprocast-quantomos',
  nombre: 'Quántomos de Deprocast 0.7',
  detectar: (d) => d.json?.format === 'deprocast-quantomos',
  analizar(d) {
    const j = d.json
    const n = Array.isArray(j.quantomos) ? j.quantomos.length : 0
    return {
      importador: 'deprocast-quantomos',
      titulo: `${j.label ?? 'Quántomos'} · ${String(j.exported_at ?? '').slice(0, 10)}`,
      descripcion: `Etapa ${j.stage ?? '?'} · ${n} quántomos · ${j.lattices?.length ?? 0} sellos L72.`,
      segmentos: [{ id: 'quantomos', nombre: 'Quántomos', descripcion: 'Entran en su etapa (proto o sellado). Los repetidos no se duplican.', nivel: null, destino: 'quantomos', cantidad: n, porDefecto: true }],
      fuente: { id: INSTANCIA, nombre: 'Deprocast 0.7.1', nivel: 'propia', padreId: 'deprocast-0.7' },
      nivelEditable: false,
      avisos: n ? [] : ['El archivo no trae quántomos: el formato es válido pero está vacío.'],
    }
  },
  ejecutar(d, ctx) {
    const j = d.json
    const lattices = new Map((j.lattices ?? []).map((l: any) => [l.quantomo_id, l]))
    for (const q of j.quantomos ?? []) {
      const l: any = lattices.get(q.id)
      ctx.quantomo('quantomos', {
        titulo: q.title ?? null, texto: q.content || q.text || q.title, peso: q.human_weight ?? q.hermetic_weight ?? q.peso ?? null,
        etapa: q.stage === 'sealed' ? 'sellado' : 'proto', universo: q.universe ?? null, procedencia: q.procedencia ?? q.source_kind ?? null,
        l72: l ? { codec: l.codec, celdas: l.cells, sello: l.seal, permutacion: l.permutation_id } : null,
        origenId: ORIGEN('quantomo', q.id),
      })
    }
  },
}
