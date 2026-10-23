import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-'))

const { abrir } = await import('../src/db.ts')
const vis = await import('../src/visuales.ts')
const { crearVisual, leerArtefacto, reservarVisual, carpeta } = await import('../src/taller.ts')

/** Un PDB de juguete con el formato de columnas real: una hélice corta y una lámina. */
function pdbDeJuguete(n = 10): string {
  const pad = (s: string | number, w: number, izq = false) => (izq ? String(s).padEnd(w) : String(s).padStart(w))
  const atomo = (i: number) => `ATOM  ${pad(i * 4 + 2, 5)}  CA  ${'ALA'} A${pad(i + 1, 4)}    ${pad((i * 3.8).toFixed(3), 8)}${pad((Math.sin(i) * 2).toFixed(3), 8)}${pad('1.000', 8)}  1.00 10.00           C`
  return [
    'HEADER    PROTEINA DE JUGUETE',
    'TITLE     UNA PROTEINA DE JUGUETE PARA PROBAR',
    `HELIX    1   1 ALA A    2  ALA A    5  1                                   4`,
    `SHEET    1   A 2 ALA A   7  ALA A   9  0`,
    ...Array.from({ length: n }, (_, i) => atomo(i)),
    'ENDMDL',
    `ATOM  99999  CA  ALA A  99      99.000  99.000  99.000  1.00 10.00           C`,
  ].join('\n')
}

test('Expresiones: se calculan sin eval, y lo que no es matemática se rechaza', () => {
  const f = vis.compilarExpr('a*sin(b*x) + 2^3^2/512 - -1', ['x', 'a', 'b'])
  assert.equal(f({ x: Math.PI / 2, a: 2, b: 1 }), 2 + 1 + 1)
  assert.equal(vis.compilarExpr('2x + 3(x+1)', ['x'])({ x: 2 }), 13, 'multiplicación implícita')
  assert.equal(vis.compilarExpr('max(x, pi)', ['x'])({ x: 1 }), Math.PI)
  for (const malo of ['process.exit()', 'x; alert(1)', 'constructor', 'constructor(x)', '__proto__', 'y*2', 'sin(', 'foo(x)', '']) assert.throws(() => vis.compilarExpr(malo, ['x']), Error, malo)
})

test('Las plantillas validan: aceptan lo bueno, acotan y descartan lo roto', () => {
  const dg = vis.validarDiagrama({
    titulo: 'Un circuito', nodos: [{ id: 'p', tipo: 'pila', etiqueta: 'Pila', valor: '9 V' }, { id: 'r', tipo: 'resistencia' }, { id: 'l', tipo: 'foco raro', etiqueta: 'Lámpara' }],
    conexiones: [{ de: 'p', a: 'r', flujo: 'corriente' }, { de: 'r', a: 'l' }, { de: 'l', a: 'p' }, { de: 'p', a: 'nadie' }],
    pasos: [{ texto: 'Sale del +', resaltar: ['p', 'zzz'] }],
    control: { tipo: 'deslizador', nombre: 'V', min: 0, max: 12, valor: 99, salida: { expr: 'V/220', etiqueta: 'I', unidad: 'A' }, afecta: ['l'] },
  })
  assert.ok(dg.ok)
  if (!dg.ok) return
  assert.equal(dg.datos.nodos[2].tipo, 'caja', 'un tipo desconocido es una caja')
  assert.equal(dg.datos.conexiones.length, 3, 'la conexión a una pieza que no existe se va')
  assert.deepEqual(dg.datos.pasos[0].resaltar, ['p'])
  assert.equal(dg.datos.control.valor, 12, 'el valor queda dentro del rango')
  assert.equal(dg.datos.control.salida.expr, 'V/220')
  assert.equal(vis.validarDiagrama({ nodos: [{ id: 'a' }], conexiones: [] }).ok, false)

  const fn = vis.validarFuncion({ x: { min: 0, max: 10 }, parametros: [{ nombre: 'a', min: 0, max: 5, valor: 1 }, { nombre: 'x', min: 0, max: 1 }, { nombre: 'pi', min: 0, max: 1 }], curvas: [{ expr: 'a*x^2' }, { expr: 'eval(x)' }] })
  assert.ok(fn.ok && fn.datos.parametros.length === 1 && fn.datos.curvas.length === 1, 'x y las constantes no son parámetros; la curva rota se va')
  assert.match((vis.validarFuncion({ curvas: [{ expr: 'b*x' }] }) as any).motivo, /Variable desconocida: b/)

  const mv = vis.validarMovimiento({ fases: [{ nombre: 'Arriba', pose: { tronco: 0, rodilla: 0 } }, { nombre: 'Abajo', ms: 99999, pose: { tronco: 40, cadera: 100, rodillaD: 110, codo: 'x' } }], errores: [{ nombre: 'Rodillas adentro', fase: 9, pose: { caderaAbd: -10 } }] })
  assert.ok(mv.ok)
  if (mv.ok) {
    assert.equal(mv.datos.fases[1].ms, 6000)
    assert.deepEqual(mv.datos.fases[1].pose, { tronco: 40, cadera: 100, rodillaD: 110 }, 'lo que no es un número no entra')
    assert.equal(mv.datos.errores[0].fase, 1, 'la fase del error queda dentro')
  }
  assert.equal(vis.validarMovimiento({ fases: [{ nombre: 'Sola', pose: { tronco: 1 } }] }).ok, false)

  assert.equal((vis.validarMolecula({ pdb: '1ubq' }) as any).datos.pdb, '1UBQ')
  assert.equal(vis.validarMolecula({ pdb: 'XXXXX' }).ok, false)
  const agua = vis.validarMolecula({ atomos: [{ e: 'O', x: 0, y: 0 }, { e: 'H', x: 0.96, y: 0 }, { e: 'H', x: -0.24, y: 0.93 }], enlaces: [[0, 1, 1], [0, 2], [0, 7]] })
  assert.ok(agua.ok && agua.datos.enlaces.length === 2)
})

test('El PDB: los Cα del primer modelo, con hélices y láminas, centrados', () => {
  const p = vis.parsearPdb(pdbDeJuguete())
  assert.equal(p.cadena.length, 10, 'lo que viene después de ENDMDL no entra')
  assert.equal(p.titulo, 'Una Proteina De Juguete Para Probar')
  assert.deepEqual(p.cadena.map((a) => a.ss).join(''), 'CHHHHCEEEC')
  assert.ok(Math.abs(p.cadena.reduce((s, a) => s + a.x, 0)) < 0.1, 'centrada')
})

test('Los datos del visual: elige plantilla, reintenta si no cierran, baja el PDB y vuelve al libre si no entra', async () => {
  const db = abrir(':memory:')
  const respuestas: any[] = []
  const pedidos: string[] = []
  vis._probarVisuales(async (_db, sistema, usuario) => { pedidos.push(`${sistema}\n---\n${usuario}`); return { datos: respuestas.shift(), modelo: 'falso', tokens: 900 } })
  vis._probarPdb(async (c) => { if (c !== '1UBQ') throw new Error(`El PDB ${c} no está (404)`); return pdbDeJuguete(12) })

  respuestas.push({ plantilla: 'funcion', datos: { curvas: [{ expr: 'k*x' }] } }, { plantilla: 'funcion', datos: { parametros: [{ nombre: 'k', min: 0, max: 2, valor: 1 }], curvas: [{ expr: 'k*x' }] } })
  const f = await vis.datosVisual(db, { clase: 'simulacion', concepto: 'Proporcionalidad', pedido: 'una recta' })
  assert.equal(f!.plantilla, 'funcion')
  assert.equal(f!.tokens, 1800)
  assert.match(pedidos[1], /Lo anterior no sirvió: .*Variable desconocida: k/, 'el segundo intento sabe qué falló')
  assert.match(pedidos[0], /"molecula"/)
  assert.doesNotMatch(pedidos[0], /"movimiento" —/, 'una simulación no ofrece la figura humana')

  respuestas.push({ plantilla: 'molecula', datos: { pdb: '9ZZZ' } }, { plantilla: 'molecula', datos: { pdb: '1UBQ', residuos: [{ n: 3, nota: 'clave' }] } })
  const m = await vis.datosVisual(db, { clase: 'simulacion', concepto: 'Ubiquitina', pedido: 'cómo se pliega' })
  assert.equal(m!.datos.cadena.length, 12)
  assert.deepEqual(m!.datos.cadena[2].slice(3, 6), ['H', 'ALA', 3], '[x, y, z, estructura, residuo, número, cadena]')
  assert.match(pedidos.at(-1)!, /9ZZZ no está/)

  respuestas.push({ plantilla: 'libre', datos: null })
  assert.equal(await vis.datosVisual(db, { clase: 'diagrama', concepto: 'Algo raro', pedido: 'x' }), null)
  respuestas.push({ plantilla: 'movimiento', datos: {} })
  assert.equal(await vis.datosVisual(db, { clase: 'diagrama', concepto: 'Otra cosa', pedido: 'x' }), null, 'una plantilla que esa clase no admite: al libre')
  respuestas.push({ plantilla: 'diagrama', datos: {} }, { plantilla: 'diagrama', datos: {} })
  assert.equal(await vis.datosVisual(db, { clase: 'diagrama', concepto: 'Roto', pedido: 'x' }), null, 'dos veces mal: al libre')

  // Mejorar: misma plantilla, con los datos de antes.
  respuestas.push({ plantilla: 'funcion', datos: { curvas: [{ expr: 'x^2' }] } })
  const mej = await vis.datosVisual(db, { clase: 'simulacion', concepto: 'Parábola', pedido: 'más ancha' }, { plantilla: 'funcion', datos: { curvas: [{ expr: 'x' }] } })
  assert.equal(mej!.plantilla, 'funcion')
  assert.match(pedidos.at(-1)!, /Los datos actuales \(plantilla funcion\)[\s\S]*Lo que hay que mejorar: más ancha/)
  assert.doesNotMatch(pedidos.at(-1)!, /"diagrama" —/)
})

test('La cáscara: los datos inline sin poder cerrar el script, y el dibujante de su plantilla; crearVisual la escribe', async () => {
  const html = vis.shellVisual('diagrama', { titulo: '</script><script>alert(1)</script>' }, 'A < B')
  assert.ok(!html.includes('</script><script>alert'), 'un «</script>» en los datos no corta el bloque')
  assert.match(html, /<title>A &lt; B<\/title>/)
  assert.match(html, /<script src="\/visual\/comun\.js"><\/script><script src="\/visual\/diagrama\.js"><\/script>/)
  assert.ok(fs.existsSync(path.resolve(import.meta.dirname, '..', 'web', 'visual', 'diagrama.js')))

  const db = abrir(':memory:')
  vis._probarVisuales(async () => ({ datos: { plantilla: 'diagrama', datos: { nodos: [{ id: 'a', tipo: 'pila' }, { id: 'b', tipo: 'lampara' }], conexiones: [{ de: 'a', a: 'b' }, { de: 'b', a: 'a' }] } }, modelo: 'falso', tokens: 700 }))
  const r = reservarVisual(db, { clase: 'diagrama', pedido: 'Una pila y una lámpara', concepto: 'Circuito simple' })
  const a = await crearVisual(db, r.id)
  assert.equal(a.estado, 'listo')
  assert.equal(a.meta.plantilla, 'diagrama')
  assert.deepEqual(a.archivos, ['index.html', 'datos.json'])
  assert.match(fs.readFileSync(path.join(carpeta(a.id), 'index.html'), 'utf8'), /window\.VISUAL = \{"titulo"/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(carpeta(a.id), 'datos.json'), 'utf8')).nodos.length, 2)
  assert.equal(leerArtefacto(db, a.id)!.progreso, null)
})
