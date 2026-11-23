import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { FAMILIAS, NO_SON_TAXONOMIA, auditar, catalogo, revisarRegistro, taxonomia, taxonomiaMarkdown } from '../src/taxonomia.ts'
import { HERRAMIENTAS, lineamientos } from '../src/chat/herramientas.ts'
import { TIPOS_ENTIDAD } from '../src/entidades.ts'

const SRC = path.resolve(import.meta.dirname, '..', 'src')

test('Fragua #321: el registro es uno solo, con ids únicos, familias válidas y herramientas que existen', () => {
  const tipos = taxonomia()
  assert.equal(new Set(tipos.map((t) => t.id)).size, tipos.length, 'ids únicos')
  for (const t of tipos) {
    assert.ok(t.familia in FAMILIAS, `${t.id}: familia ${t.familia}`)
    assert.ok(fs.existsSync(path.resolve(SRC, '..', t.modulo)), `${t.id}: el módulo ${t.modulo} existe`)
    assert.ok(t.valores || t.rango || t.falta || t.valores === null, t.id)
  }
  assert.deepEqual(revisarRegistro(HERRAMIENTAS.map((h) => h.nombre)).filter((h) => h.que === 'herramienta_inexistente'), [])
  // Describe lo que ya existe: los valores son los de la constante, no una copia.
  assert.equal(tipos.find((t) => t.id === 'entidad.tipo')!.valores, TIPOS_ENTIDAD)
})

test('Fragua #321: ninguna enumeración de tipos queda afuera del registro', () => {
  const tax = fs.readFileSync(path.join(SRC, 'taxonomia.ts'), 'utf8')
  const registradas = new Set<string>()
  for (const m of tax.matchAll(/import \{([^}]+)\} from '\.\/([^']+)'/g)) {
    for (const n of m[1].split(',')) registradas.add(`src/${m[2]}:${n.trim().split(/\s+as\s+/)[0]}`)
  }
  const ENUM = /^export const ((?:TIPOS|ESTADOS|NIVELES|CLASES|ROLES|ELEMENTOS|VINCULOS|ETAPAS|CATEGORIAS|CAPAS|FINALES|HORIZONTES|CALIDADES|FUENTES|MODOS|PLATAFORMAS|METRICAS|CANALES|DESTINOS|ESCALAS)\w*)\b[^=]*= *[[{]/gm
  const sueltas: string[] = []
  for (const f of fs.readdirSync(SRC, { recursive: true }).map(String).filter((x) => x.endsWith('.ts'))) {
    const rel = `src/${f.replace(/\\/g, '/')}`
    for (const m of fs.readFileSync(path.join(SRC, f), 'utf8').matchAll(ENUM)) {
      const clave = `${rel}:${m[1]}`
      if (!registradas.has(clave) && !(clave in NO_SON_TAXONOMIA)) sueltas.push(clave)
    }
  }
  assert.deepEqual(sueltas, [], 'Cada enumeración nueva entra en src/taxonomia.ts (o en NO_SON_TAXONOMIA con el motivo)')
})

test('Fragua #321: la auditoría encuentra valores no declarados, números fuera de rango y listas que no coinciden', async () => {
  const db = abrir(':memory:')
  const ahora = Date.now()
  db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('persona', 'Ana', ?), ('marciano', 'Zorg', ?)`).run(ahora, ahora)
  db.prepare(`INSERT INTO quantomos (texto, peso, etapa, creado_en, actualizado_en) VALUES ('uno', 7, 'sellado', ?, ?), ('dos', 40, 'proto', ?, ?)`).run(ahora, ahora, ahora, ahora)
  const { hallazgos, estados } = await auditar(db, HERRAMIENTAS.map((h) => h.nombre))
  assert.ok(hallazgos.some((h) => h.tipo === 'entidad.tipo' && h.que === 'valor_no_declarado' && /«marciano»/.test(h.detalle) && h.veces === 1))
  assert.ok(hallazgos.some((h) => h.tipo === 'quantomo.peso' && h.que === 'fuera_de_rango' && /= 40 \(va de 1 a 12\)/.test(h.detalle)))
  assert.ok(hallazgos.some((h) => h.tipo === 'entidad.tipo' && h.que === 'variante_distinta' && /segmento\.ts.*empresa/.test(h.detalle)), 'segmento.ts declara su propia lista sin empresa')
  assert.equal(estados['entidad.tipo'], 'inconsistente')
  assert.equal(estados['quantomo.etapa'], 'existe')
  assert.equal(estados['idea.tipo'], 'falta')
  assert.ok(hallazgos.some((h) => h.que === 'sin_herramientas'), 'avisa los tipos que ninguna herramienta usa')

  const c = catalogo(hallazgos)
  assert.deepEqual(c.familias.map((f) => f.id), Object.keys(FAMILIAS))
  assert.equal(c.resumen.tipos, taxonomia().length)
})

test('Fragua #321: los lineamientos traen la sección «Taxonomía» regenerada desde el registro', async () => {
  const s = await lineamientos('Taxonomía') as { seccion: string; texto: string }
  assert.equal(s.seccion, 'Taxonomía')
  assert.equal(s.texto, taxonomiaMarkdown())
  for (const t of taxonomia()) assert.ok(s.texto.includes(`\`${t.id}\``), t.id)
  assert.match(s.texto, /\*\*Tipo de entidad\*\* \(`entidad\.tipo`, inconsistente\): persona · proyecto/)

  const db = abrir(':memory:')
  const r = await HERRAMIENTAS.find((h) => h.nombre === 'ver_taxonomia')!.ejecutar({ q: 'sueño' }, { db } as any) as any
  assert.ok(r.familias.every((f: any) => f.tipos.every((t: any) => /sue[ñn]o/i.test(JSON.stringify(t)))))
  assert.ok(r.familias.some((f: any) => f.tipos.some((t: any) => t.id === 'sueno.fuente')))
})
