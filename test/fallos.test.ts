import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { clasificar, errorEnRespuesta, erroresRecientes, registrarFallo } from '../src/fallos.ts'
import { registrarError } from '../src/autocritica.ts'
import { ejecutarHerramienta } from '../src/chat/herramientas.ts'

test('fallos estructurados (Fragua #191): códigos cerrados a partir del texto o del estado HTTP', () => {
  assert.equal(clasificar('The operation was aborted due to timeout').codigo, 'tiempo_agotado')
  assert.equal(clasificar('telegram: Too Many Requests: retry after 5').codigo, 'limite')
  assert.equal(clasificar('read ECONNRESET').codigo, 'sin_red')
  assert.equal(clasificar('UNIQUE constraint failed: corpus.origen_id').codigo, 'base_de_datos')
  assert.equal(clasificar("Cannot read properties of undefined (reading 'x')").codigo, 'codigo')
  assert.equal(clasificar('El modelo no devolvió un JSON válido: vino vacía').codigo, 'json_invalido')
  assert.deepEqual(clasificar('El sitio respondió 409 (nombre_ocupado): # @Mastropiero ya existe'), { codigo: 'nombre_ocupado', ajeno: true })
  assert.equal(clasificar('Google 403: forbidden').codigo, 'sin_permiso')
})

test('una página que devuelve un JSON de error no es contenido; los cuatro 409 de corruptopolis son un solo grupo ×4', async () => {
  assert.deepEqual(errorEnRespuesta('```json\n{"estadoHttp":409,"code":"conflict","message":"# @Mastropiero ya existe","error":"nombre_ocupado"}\n```'), { estado: 409, codigo: 'nombre_ocupado', mensaje: '# @Mastropiero ya existe' })
  assert.equal(errorEnRespuesta('# Una página normal\n\nCon texto.'), null)
  const db = abrir(':memory:')
  for (const n of ['Mastropiero', 'MastropieroII', 'MastropieroIII', 'MastropieroDeprocast']) {
    registrarFallo(db, { origen: 'herramienta:leer_pagina', mensaje: `El sitio respondió 409 (nombre_ocupado): # @${n} ya existe`, donde: `https://corruptopolis.world/api/agente/entrar?nombre=${n}`, entrada: n })
  }
  registrarError(db, 'servidor', "misión 2: Cannot read properties of undefined (reading 'plan')")
  registrarError(db, 'servidor', "misión 2: Cannot read properties of undefined (reading 'plan')")
  registrarError(db, 'lento', 'GET /api/x tardó 1200 ms')
  const r = erroresRecientes(db)
  const corr = r.grupos.find((g) => g.codigo === 'nombre_ocupado')!
  assert.equal(corr.veces, 4)
  assert.equal(corr.ajeno, true)
  assert.match(corr.accion, /Reusar la identidad guardada/)
  // Los propios van primero; lo ajeno no tapa a un bug de Deprocast; lo lento no entra acá.
  assert.deepEqual(r.top.map((x) => [x.codigo, x.veces]), [['codigo', 2]])
  assert.ok(!r.grupos.some((g) => g.origen === 'lento'))
})

test('una herramienta que falla: la salida útil queda limpia y el fallo viaja aparte, registrado', async () => {
  const db = abrir(':memory:')
  const hs = [{ nombre: 'leer_algo', familia: 'lectura', descripcion: '', parametros: {}, ejecutar: async () => { throw new Error('fetch failed') } }] as any
  const x = await ejecutarHerramienta(hs, 'leer_algo', JSON.stringify({ url: 'https://ejemplo.org/a?b=1' }), { db, conversacionId: null } as any)
  assert.equal(x.ok, false)
  const res = x.resultado as any
  assert.equal(res.error, 'fetch failed')
  assert.deepEqual([res.fallo.codigo, res.fallo.reintentable, res.fallo.donde], ['sin_red', true, 'https://ejemplo.org/a?b=1'])
  assert.equal((db.prepare(`SELECT origen FROM errores WHERE codigo = 'sin_red'`).get() as any).origen, 'herramienta:leer_algo')
})
