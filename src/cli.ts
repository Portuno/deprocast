/**
 * mastro — la consola de la liga.  `npm run mastro -- <comando>`
 */
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ATRIBUTO_MAX, ATRIBUTOS, CLASE_IDS, CLASES, PUNTOS_LIBRES, type AtributoId, type Atributos } from './clases.ts'
import { abrir } from './db.ts'
import { asientos } from './auditor.ts'
import { publicar, tareas, type EstadoTarea } from './bus.ts'
import { carta } from './carta.ts'
import { fuentes, NIVELES, resumenCorpus } from './corpus.ts'
import { ejecutar as ejecutarCarga, reetiquetar, subir } from './cargas/index.ts'
import { crearProyecto, estadoLiga, ingerir, tick, type Evento } from './mastropiero.ts'
import { motoresDisponibles } from './motores.ts'
import { cadena, nanModelos, usoDelMes } from './nan.ts'
import {
  alias, bautizar, cambiarEstado, forjar, lapidas, leer, listar, nivel, validarPedido,
  type Estado, type PedidoForja,
} from './roster.ts'
import { CAPAS, umbral } from './xp.ts'
import { PREGUNTA_EJEMPLO, sembrarEjemplo } from './semilla.ts'
import { respaldar, restaurar } from './respaldo.ts'
import { chequear, informe } from './doctor.ts'
import { arrancarRun, cerrarRun, conAvance, enCurso, listarMisiones, misionesDeRun, prepararRun, principalDe, runActual, semanaDe } from './misiones.ts'

function parsear(argv: string[]) {
  const pos: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const sig = argv[i + 1]
      if (sig === undefined || sig.startsWith('--')) flags[a.slice(2)] = 'true'
      else (flags[a.slice(2)] = sig), i++
    } else pos.push(a)
  }
  return { pos, flags }
}

/** "pot=2,rit=4" o "potencia=2,ritmo=4" */
function parsearReparto(s: string | undefined): Partial<Atributos> {
  const r: Partial<Atributos> = {}
  if (!s) return r
  for (const par of s.split(',')) {
    const [k, v] = par.split('=').map((x) => x.trim().toLowerCase())
    const a = ATRIBUTOS.find((x) => x.id === k || x.sigla.toLowerCase() === k)
    if (!a) throw new Error(`Atributo desconocido: ${k}`)
    r[a.id] = Number(v)
  }
  return r
}

const ICONO: Record<Evento['tipo'], string> = {
  purga: '✝', asigna: '→', recluta: '+', vacante: '?', corre: '✓', falla: '✗',
  nivel: '▲', bautismo: '★', promovido: '◆', banca: '⇣', retirado: '✝', publica: '↻',
}

function imprimirEventos(ev: Evento[]) {
  if (!ev.length) return console.log('  (tick sin novedades)')
  for (const e of ev) console.log(`  ${ICONO[e.tipo]} ${e.texto}`)
}

function tablaRoster(fichas: ReturnType<typeof listar>) {
  if (!fichas.length) return console.log('Roster vacío. Forjá el primero: npm run mastro -- forja')
  console.log('  ' + ['', 'ID', 'NOMBRE', 'NV', 'XP', 'ESTADO', '✓/✗', 'PROYECTO', 'MOTOR'].map((h, i) => h.padEnd([2, 9, 16, 3, 6, 8, 8, 14, 10][i])).join(''))
  for (const f of fichas) {
    console.log('  ' + [
      CLASES[f.clase].glifo, f.id, f.nombre ?? '—', String(nivel(f)), String(f.xp), f.estado,
      `${f.exitos}/${f.fallos}`, f.proyectoId ?? '—', f.motor,
    ].map((c, i) => c.padEnd([2, 9, 16, 3, 6, 8, 8, 14, 10][i])).join(''))
  }
}

async function forjaInteractiva(): Promise<PedidoForja> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log('\n  ══ LA FORJA ══  Elegí clase. (El Omnívoro no se elige: es Mastropiero.)\n')
    CLASE_IDS.forEach((id, i) => console.log(`  ${i + 1}. ${CLASES[id].glifo} ${CLASES[id].nombre.padEnd(13)} ${CLASES[id].produce}`))
    const n = Number(await rl.question('\n  Clase [1-9]: '))
    const clase = CLASE_IDS[n - 1]
    if (!clase) throw new Error('Clase inválida')
    const base = CLASES[clase].base
    console.log(`\n  Base del ${CLASES[clase].nombre}: ${ATRIBUTOS.map((a) => `${a.sigla} ${base[a.id]}`).join(' · ')}`)
    console.log(`  Tenés ${PUNTOS_LIBRES} puntos para repartir (tope ${ATRIBUTO_MAX} por atributo).\n`)
    const reparto: Partial<Atributos> = {}
    let quedan = PUNTOS_LIBRES
    for (const a of ATRIBUTOS) {
      if (!quedan) break
      const tope = Math.min(quedan, ATRIBUTO_MAX - base[a.id])
      if (!tope) continue
      const v = Number((await rl.question(`  +${a.sigla} ${a.nombre} (${a.efecto}) [0-${tope}]: `)) || 0)
      reparto[a.id as AtributoId] = Math.max(0, Math.min(tope, Math.floor(v) || 0))
      quedan -= reparto[a.id]!
    }
    const motores = motoresDisponibles().filter((m) => (clase === 'ejecutivo') === m.startsWith('funcion:'))
    const motor = (await rl.question(`\n  Motor [${motores.join(' | ')}] (${motores[0]}): `)).trim() || motores[0]
    const instrucciones = (await rl.question('  Instrucciones (una línea, Enter = por defecto): ')).trim()
    const proyecto = (await rl.question('  Proyecto (id, Enter = agente libre): ')).trim()
    const celdaTxt = (await rl.question('  Celda de la Matriz 72 (1-72, Enter = ninguna): ')).trim()
    return { clase, reparto, motor, instrucciones, proyectoId: proyecto || null, celda: celdaTxt ? Number(celdaTxt) : null }
  } finally {
    rl.close()
  }
}

const AYUDA = `
  mastro — la liga de Mastropiero (Deprocast 1.0)

  ROSTER
    forja [--clase c --motor m --instrucciones "…" --reparto pot=2,rit=4 --proyecto p --celda n]
    roster [--clase c] [--estado prueba|activo|banca]
    carta <id|nombre>
    bautizar <id> <nombre>          (desde nivel 3)
    banca <id> | activar <id>
    cementerio

  LIGA
    proyecto <nombre>               crea proyecto + su gerente
    tarea <clase> <texto…> [--proyecto p] [--dominio d] [--url u]
    ingerir <fuente> <archivo> | --texto "…"  [--titulo t] [--dominio d] [--proyecto p]
    tick [n]                        purga → reparte → corre (n veces)
    liga                            el estado que ve el omnívoro
    bus [pendiente|asignada|hecha|fallida]
    log [id]                        auditoría
    clases                          las 9 clases + capas de nivel

  NAN
    nan cadenas                     qué modelo atiende a cada clase
    nan modelos                     ids que expone tu key (GET /models)
    nan uso                         tokens del mes por modelo contra el cupo
    demo                            arma una liga de ejemplo en data/demo.db

  CORPUS
    fuentes                         las fuentes y su nivel
    cargar <archivo> [--todo] [--pipeline ninguna|vectorizar|completa] [--fuente f]
                                    analiza una carga; con --todo la ejecuta con lo que propone
    reetiquetar <carga>             recalcula entidades y etiquetas de una carga hecha

  MISIONES
    misiones                        tu principal, las primarias de la semana, la run y las side quests
    run "<pedido en tus palabras>" [--plantilla p] [--duracion min]
                                    prepara una run (queda propuesta)
    run arrancar | run cerrar       arranca la propuesta / cierra la que está en curso

  MUDANZA
    respaldo                        copia la base y las cargas a data/respaldos/
    restaurar <carpeta> [--forzar]  la pone en esta compu
    doctor [--rapido]               revisa que esta compu tenga todo

  Niveles: ${Object.values(NIVELES).map((n) => `${n.numero} ${n.nombre}`).join(' · ')}
`

async function main() {
  try {
    process.loadEnvFile()
  } catch {
    // sin .env: valen las variables del entorno
  }
  const [cmd, ...resto] = process.argv.slice(2)
  const { pos, flags } = parsear(resto)
  if (!cmd || cmd === 'ayuda' || cmd === 'help') return console.log(AYUDA)

  if (cmd === 'demo') {
    const ruta = path.resolve('data', 'demo.db')
    for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(ruta + sufijo, { force: true })
    process.env.MASTRO_DB = ruta
  }
  if (cmd === 'restaurar') {
    const r = restaurar(pos[0] ?? '', { forzar: !!flags.forzar })
    return console.log(`  Restaurado en ${r.base}${r.anterior ? ` (la anterior quedó en ${r.anterior})` : ''}
  ${r.cargas} archivos de cargas · ${JSON.stringify(r.conteos)}`)
  }
  const db = abrir()

  switch (cmd) {
    case 'forja': {
      const pedido: PedidoForja = flags.clase
        ? {
            clase: flags.clase, motor: flags.motor, instrucciones: flags.instrucciones, reparto: parsearReparto(flags.reparto),
            proyectoId: flags.proyecto ?? null, celda: flags.celda ? Number(flags.celda) : null,
          }
        : await forjaInteractiva()
      validarPedido(pedido)
      const f = forjar(db, pedido)
      console.log('\n' + carta(db, f) + `\n\n  ${f.id} entra en PRUEBA: 3 éxitos y juega; 3 fallos y se retira. 7 días sin correr y se borra.\n`)
      break
    }
    case 'roster':
      tablaRoster(listar(db, { clase: flags.clase as any, estado: flags.estado as Estado }))
      break
    case 'carta': {
      const f = leer(db, pos[0] ?? '')
      if (!f) throw new Error(`No existe ${pos[0]}`)
      console.log(carta(db, f))
      break
    }
    case 'bautizar':
      bautizar(db, pos[0], pos.slice(1).join(' '))
      console.log(carta(db, leer(db, pos[0])!))
      break
    case 'banca':
    case 'activar':
      cambiarEstado(db, pos[0], cmd === 'banca' ? 'banca' : 'activo')
      console.log(`${pos[0]} → ${cmd === 'banca' ? 'banca' : 'activo'}`)
      break
    case 'cementerio': {
      const l = lapidas(db)
      if (!l.length) console.log('Nadie murió todavía.')
      for (const x of l) console.log(`  ✝ ${alias(x)} · ${CLASES[x.clase].nombre} · ${x.xp} XP · ${x.especializacion ?? 'sin especialidad'} · ${x.causa} · ${new Date(x.retirado_en).toLocaleDateString('es-AR')}`)
      break
    }
    case 'proyecto': {
      const { id, gerente } = crearProyecto(db, pos.join(' '))
      console.log(`Proyecto ${id} creado. Su entrenador:\n${carta(db, gerente)}`)
      break
    }
    case 'tarea': {
      const [clase, ...texto] = pos
      const payload: Record<string, unknown> = { texto: texto.join(' ') }
      if (flags.url) payload.url = flags.url
      const t = publicar(db, { clase, payload, publicadaPor: 'operador', proyectoId: flags.proyecto ?? null, dominio: flags.dominio ?? null })
      console.log(`Tarea ${t.id} en el bus para ${CLASES[t.clase].nombre}.`)
      break
    }
    case 'ingerir': {
      const [fuente, archivo] = pos
      const contenido = flags.texto ?? (archivo ? fs.readFileSync(archivo, 'utf8') : '')
      if (!contenido.trim()) throw new Error('Nada que ingerir: pasá un archivo o --texto')
      const titulo = flags.titulo ?? (archivo ? path.basename(archivo) : contenido.slice(0, 60))
      const { corpusId, tarea } = ingerir(db, { fuente, titulo, contenido, proyectoId: flags.proyecto ?? null, dominio: flags.dominio ?? null })
      console.log(`Corpus ${corpusId} crudo. Pipeline arrancada: tarea ${tarea.id} → extractor.`)
      break
    }
    case 'fuentes':
      for (const f of fuentes(db)) console.log(`  ${NIVELES[f.nivel].numero.padEnd(4)}${f.padreId ? '  └ ' : ''}${f.nombre.padEnd(34)} ${String(f.piezas).padStart(6)} piezas  [${f.id}]`)
      break
    case 'cargar': {
      const archivo = pos[0]
      if (!archivo) throw new Error('cargar <archivo>')
      const carga = subir(db, path.basename(archivo), fs.readFileSync(archivo))
      const a = carga.analisis!
      console.log(`
  Carga #${carga.id} · ${a.titulo}
  ${a.descripcion}
`)
      for (const s of a.segmentos) console.log(`  [${s.porDefecto ? 'x' : ' '}] ${s.nombre.padEnd(28)} ${String(s.cantidad).padStart(6)}  ${s.nivel ? NIVELES[s.nivel].nombre : '→ ' + s.destino}`)
      for (const av of a.avisos) console.log(`  ! ${av}`)
      if (flags.todo) {
        const hecha = ejecutarCarga(db, carga.id, { pipeline: (flags.pipeline as any) ?? 'ninguna', fuenteId: flags.fuente })
        console.log(`
  Hecha: ${JSON.stringify(hecha.resumen)}`)
      } else console.log(`
  Analizada. Para ejecutarla: npm run mastro -- cargar ${archivo} --todo`)
      break
    }
    case 'respaldo': {
      const r = respaldar(db)
      console.log(`  Respaldo en ${r.carpeta}
  ${JSON.stringify(r.manifiesto.conteos)}
  Llevá esa carpeta y tu .env a la otra compu.`)
      break
    }
    case 'misiones': {
      const p = principalDe(db, 'jugador')
      console.log(`\n  Principal: ${p ? p.titulo : '(sin fijar)'}\n\n  Primarias de la semana ${semanaDe()}:`)
      for (const m of conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe() }).filter((x) => x.estado !== 'descartada'))) {
        console.log(`    ${m.estado === 'sugerida' ? '?' : m.estado === 'hecha' ? '✓' : '·'} ${m.titulo}  ${m.avance.progreso}% · ${m.avance.bandas.hechas} bandas`)
      }
      const v = enCurso(db)
      const r = runActual(db)
      if (r) {
        console.log(`\n  Run ${r.estado} ${r.inicio}–${r.fin}${v?.actual ? ` · ahora: ${v.actual.titulo}` : ''}`)
        const marca: Record<string, string> = { hecha: '✓', parcial: '◐', no: '✗', activa: ' ' }
        for (const m of misionesDeRun(db, r.id)) console.log(`    ${m.inicio} ${marca[m.estado] ?? '·'} ${m.titulo}`)
      }
      const t = listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', abiertas: true })
      if (t.length) console.log(`\n  Side quests:\n${t.map((m) => `    ⚑ ${m.titulo}${m.disparador ? ` (${Object.values(m.disparador).filter(Boolean).join(', ')})` : ''}`).join('\n')}`)
      console.log('')
      break
    }
    case 'run': {
      if (pos[0] === 'arrancar' || pos[0] === 'cerrar') {
        const r = runActual(db)
        if (!r) throw new Error('No hay run viva')
        if (pos[0] === 'arrancar') console.log(`  Arrancó: ${arrancarRun(db, r.id).inicio}–${r.fin}`)
        else console.log(`\n${(await cerrarRun(db, r.id)).texto}\n`)
        break
      }
      const { run, misiones, avisos } = await prepararRun(db, { texto: pos.join(' ') || null, plantilla: flags.plantilla ?? null, duracion: flags.duracion ? Number(flags.duracion) : null })
      console.log(`\n  Run propuesta ${run.inicio}–${run.fin}${run.agentes.length ? ` (con ${run.agentes.map((a) => a.nombre).join(', ')})` : ''}\n  ${run.resumen ?? ''}\n`)
      for (const m of misiones) console.log(`    ${m.inicio} ${m.titulo}${m.detalle ? `\n           ${m.detalle}` : ''}`)
      if (avisos.length) console.log(`\n  ${avisos.join(' ')}`)
      console.log('\n  Para arrancarla: npm run mastro -- run arrancar\n')
      break
    }
    case 'doctor':
      console.log(informe(await chequear({ conRed: !flags.rapido })))
      break
    case 'reetiquetar': {
      const r = reetiquetar(db, Number(pos[0]))
      console.log(`  Carga #${pos[0]}: ${r.piezas} piezas revisadas, ${r.cambiadas} con etiquetas corregidas.`)
      break
    }
    case 'tick': {
      const n = Number(pos[0] ?? 1)
      for (let i = 1; i <= n; i++) {
        console.log(`── tick ${i}/${n}`)
        imprimirEventos(await tick(db))
      }
      break
    }
    case 'liga': {
      const e = estadoLiga(db)
      console.log('\n  ☿ MASTROPIERO — el Omnívoro. No es una ficha: es la liga.\n')
      console.log(`  Proyectos: ${e.proyectos.map((p) => p.nombre).join(', ') || '—'}`)
      console.log(`  Bus: ${e.tareas.map((t) => `${t.estado} ${t.n}`).join(' · ') || 'vacío'}`)
      console.log(`  Corpus: ${resumenCorpus(db).map((c) => `${NIVELES[c.nivel]?.nombre ?? c.nivel}/${c.estado} ${c.n}`).join(' · ') || 'vacío'}`)
      console.log(`  Cementerio: ${e.lapidas}\n`)
      console.log('  TABLA')
      tablaRoster(listar(db))
      console.log()
      break
    }
    case 'bus':
      for (const t of tareas(db, pos[0] as EstadoTarea | undefined)) {
        console.log(`  #${t.id} ${t.estado.padEnd(9)} ${t.clase.padEnd(13)} ${t.tipo.padEnd(10)} ${t.asignadaA ?? '—'}${t.error ? `  ✗ ${t.error}` : ''}`)
      }
      break
    case 'log':
      for (const a of asientos(db, { agenteId: pos[0] })) {
        console.log(`  ${a.ok ? '✓' : '✗'} ${new Date(a.en).toLocaleString('es-AR')} ${a.agenteId.padEnd(12)} tarea ${a.tareaId ?? '—'} · ${a.decision ?? ''}`)
      }
      break
    case 'clases':
      for (const id of CLASE_IDS) {
        const c = CLASES[id]
        console.log(`  ${c.glifo} ${c.nombre.padEnd(13)} ${c.produce}\n      salida ${c.salida}\n      base   ${ATRIBUTOS.map((a) => `${a.sigla} ${c.base[a.id]}`).join(' · ')}`)
      }
      console.log('\n  ☿ Omnívoro      Mastropiero. No se forja.\n\n  CAPAS')
      for (const k of CAPAS) console.log(`  Nv ${k.nivel} (${String(umbral(k.nivel)).padStart(4)} XP) ${k.nombre.padEnd(13)} ${k.abre} · lee hasta ${k.lecturaMax}`)
      break
    case 'nan': {
      const sub = pos[0] ?? 'cadenas'
      if (sub === 'cadenas') {
        for (const id of CLASE_IDS) console.log(`  ${CLASES[id].glifo} ${CLASES[id].nombre.padEnd(13)} ${cadena(id).join(' → ') || '— (no usa modelo)'}`)
      } else if (sub === 'modelos') {
        for (const m of await nanModelos()) console.log(`  ${m}`)
      } else if (sub === 'uso') {
        const filas = usoDelMes(db)
        if (!filas.length) console.log('  Sin llamadas a NaN este mes.')
        for (const f of filas) {
          const pct = f.cupo ? ` / ${f.cupo >= 1e9 ? `${f.cupo / 1e9}B` : `${f.cupo / 1e6}M`} (${((f.tokens / f.cupo) * 100).toFixed(4)}%)` : ''
          console.log(`  ${f.modelo.padEnd(20)} ${(f.tokens / 1e3).toFixed(1).padStart(10)}K${pct}  · ${f.llamadas} llamadas, ${f.errores} con error`)
        }
      } else throw new Error(`nan ${sub}? (cadenas | modelos | uso)`)
      break
    }
    case 'demo':
      await demo(db)
      break
    default:
      console.log(AYUDA)
  }
}

async function demo(db: ReturnType<typeof abrir>) {
  console.log('\n  Demo en data/demo.db (se recrea cada vez).\n')
  const { proyectoId: id } = sembrarEjemplo(db)
  for (let i = 1; i <= 4; i++) {
    console.log(`── tick ${i}`)
    imprimirEventos(await tick(db))
  }
  publicar(db, { clase: 'buscador', payload: { texto: PREGUNTA_EJEMPLO }, publicadaPor: 'operador', proyectoId: id, dominio: 'huerta' })
  publicar(db, { clase: 'ejecutivo', payload: { texto: 'Anotar: probar riego temprano esta semana' }, publicadaPor: 'operador', proyectoId: id, dominio: 'huerta' })
  publicar(db, { clase: 'auditor', payload: { texto: 'Revisá la liga' }, publicadaPor: 'operador' })
  console.log('── tick 5 (consultas del operador)')
  imprimirEventos(await tick(db))
  const hecha = tareas(db, 'hecha').find((t) => t.clase === 'buscador')
  if (hecha) console.log(`\n  Respuesta del buscador:\n  ${String(hecha.resultado?.respuesta).split('\n').join('\n  ')}\n  citas: ${JSON.stringify(hecha.resultado?.citas)}`)
  console.log()
  tablaRoster(listar(db))
  console.log('\n' + carta(db, listar(db, { clase: 'extractor' })[0]))
  console.log('\n  Seguí con: npm run mastro -- liga   (con MASTRO_DB=data/demo.db)\n')
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`)
  process.exitCode = 1
})
