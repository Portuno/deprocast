/**
 * La calibración del grafo (plan v25, fase 0): corre el pipeline sobre una base y muestra qué sale, para ajustar
 * stopwords y lemas con su corpus real antes de confiar en los números. Solo lee.
 *   npm run grafo:muestra -- [ruta.db] [voz|todo] [maxCaracteres]
 */
import { DatabaseSync } from 'node:sqlite'
import { calcular } from '../src/grafo/calcular.ts'
import { documentosDe } from '../src/grafo/fuentes.ts'

const [ruta = 'data/prueba-ui.db', tipo = 'voz', tope = '400000'] = process.argv.slice(2)
const db = new DatabaseSync(ruta, { readOnly: true })
const t0 = Date.now()
const docs = documentosDe(db, { tipo: tipo as 'voz' | 'todo', topeCaracteres: Number(tope) })
const t1 = Date.now()
const r = calcular(docs, { vos: tipo === 'voz' })
const mb = Math.round(process.memoryUsage().heapUsed / 1e6)
console.log(`${ruta} · ${tipo} · ${docs.length} documentos, ${docs.reduce((s, d) => s + d.texto.length, 0).toLocaleString('es-AR')} caracteres, ${r.metricas.lemas.toLocaleString('es-AR')} lemas`)
console.log(`leer ${t1 - t0} ms · calcular ${r.ms} ms · memoria ${mb} MB`)
console.log(`métricas: n=${r.metricas.n} m=${r.metricas.m} M=${r.metricas.M} C1=${r.metricas.C1} C2=${r.metricas.C2} E=${r.metricas.E} → ${r.metricas.estado} (${r.metricas.comunidades} comunidades)`)
console.log(`automáticas (aparecen en casi todo): ${r.automaticas.join(', ') || '—'}`)
const top = [...r.nodos].filter((n) => !n.vos).sort((a, b) => b.btw - a.btw).slice(0, 30)
console.log(`\nbisagras: ${top.map((n) => `${n.forma}(${n.lema})`).join(' · ')}`)
console.log(`\npuntos de entrada: ${r.nodos.filter((n) => n.entrada).map((n) => n.forma).join(' · ')}`)
console.log('\ncomunidades:')
for (const c of r.comunidades.slice(0, 12)) console.log(`  ${c.id} (${c.tam}): ${c.top.join(', ')}`)
console.log('\nhuecos:')
for (const h of r.huecos.slice(0, 6)) console.log(`  ${h.a}↔${h.b} puntaje ${h.puntaje} puente ${h.puente}: [${h.terminosA.slice(0, 4).join(', ')}] ↔ [${h.terminosB.slice(0, 4).join(', ')}]${h.bisagras.length ? ` · bisagras: ${h.bisagras.join(', ')}` : ''}`)
