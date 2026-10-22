import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'

const { abrir } = await import('../src/db.ts')
const ac = await import('../src/academia.ts')

const T = new Date(2026, 9, 22, 10).getTime()
const MIN = 60_000

/** El modelo falso: temario, clase (con su visual), examen y devoluciones que aprueban si la respuesta dice «bien». */
const pedidos: string[] = []
const visuales: { tipo: string; prioridad: number }[] = []
const contextos: string[] = []
ac._probarAcademia({
  nube: () => false,
  alPedirVisual: (_db, s, prioridad) => visuales.push({ tipo: s.paquete.visual!.tipo, prioridad }),
  modelo: async (_db, sistema, usuario) => {
    pedidos.push(sistema)
    if (/búsquedas web para encontrar material/.test(sistema)) return { consultas: [`${/Tema: (.+)/.exec(usuario)?.[1]} intro`, 'segunda', 'tercera'] }
    if (/consejero de su Academia/.test(sistema)) {
      contextos.push(usuario)
      return { sugerencias: [
        { tema: 'Drones', por_que: 'Llegar al evento de defensa-tech sabiendo de qué se habla', horizonte: 'corto', para: 'Evento defensa-tech', fecha: '2026-11-14', primer_paso: 'Cómo vuela un cuadricóptero' },
        { tema: 'electricidad', por_que: 'repetida', horizonte: 'medio', para: null, fecha: null, primer_paso: '' },
        { tema: 'Cocina', por_que: 'la descartó', horizonte: 'largo', para: null, fecha: 'pronto', primer_paso: '' },
      ] }
    }
    if (/temario/.test(sistema)) return { temario: ['Qué es la corriente', 'Resistencia y ley de Ohm', 'Circuitos en serie'] }
    if (/Corregís UNA respuesta/.test(sistema)) return { correcto: /bien/.test(usuario.split('Respuesta del alumno:')[1]), devolucion: 'Devolución.' }
    if (/examen/i.test(sistema)) return { tema: 'Examen del nivel 1', explicacion: 'Cinco preguntas.', preguntas: Array.from({ length: 5 }, (_, i) => ({ pregunta: `P${i}`, clave: 'k' })) }
    const tema = /Tema de la clase: (.+)/.exec(usuario)?.[1] ?? '?'
    return {
      tema, explicacion: `Explicación de ${tema}.`, ejemplos: ['Una linterna'], ideas: ['La corriente es carga que se mueve.'],
      preguntas: [{ pregunta: '¿Qué es la corriente?', clave: 'carga en movimiento' }, { pregunta: '¿Qué la empuja?', clave: 'el voltaje' }],
      tarjetas: [{ frente: '¿Unidad de corriente?', dorso: 'Ampere' }, { frente: '¿Qué mide el voltaje?', dorso: 'La diferencia de potencial' }],
      visual: { tipo: 'diagrama', pedido: 'Un circuito con pila, cable y lámpara; tocar cada pieza la explica.' },
    }
  },
})

async function clase(db: any, id: number, respuestas: string[], ahora: number) {
  const s = await ac.abrirSesionTutor(db, id, { ahora })
  for (const [i, r] of respuestas.entries()) await ac.responderTutor(db, s.id, i, r, ahora + MIN)
  return ac.cerrarSesionTutor(db, s.id, ahora + 20 * MIN)
}

test('Una clase del tutor: temario del nivel, la clase con su visual, devolución, y al cerrar pieza, quántomo, tarjetas y práctica', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad', porQue: 'Armar el drone del evento de defensa' }, T)
  assert.equal(d.tutorNivel, 1)
  const s = await ac.abrirSesionTutor(db, d.id, { ahora: T })
  assert.equal(s.tema, 'Qué es la corriente', 'empieza por el primer tema del temario que armó')
  assert.equal(s.estado, 'en_curso')
  assert.deepEqual(visuales.at(-1), { tipo: 'diagrama', prioridad: 9 }, 'pide su visual al Taller, con prioridad (la está mirando)')
  assert.match(pedidos[1], /UNA clase del nivel 1 \(Niño de 10\)/)

  const r = await ac.responderTutor(db, s.id, 0, 'está bien: carga que se mueve', T + MIN)
  assert.equal(r.correcto, true)
  await ac.responderTutor(db, s.id, 1, 'no sé', T + 2 * MIN)
  const c = ac.cerrarSesionTutor(db, s.id, T + 15 * MIN)
  assert.equal(c.puntaje, 0.5)
  assert.equal(c.quantomos, 1)
  assert.equal(c.tarjetas, 2)

  const pieza = db.prepare('SELECT titulo, nivel, contenido FROM corpus WHERE id = ?').get(c.piezaId) as any
  assert.equal(pieza.nivel, 'propia')
  assert.match(pieza.contenido, /Respondí: está bien: carga que se mueve\n  - ✓ Devolución\./)
  assert.equal((db.prepare(`SELECT etapa FROM quantomos WHERE pieza_id = ?`).get(c.piezaId) as any).etapa, 'proto', 'La Mano lo toma')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM tarjetas WHERE mazo = ?`).get(`aprender:${d.id}`) as any).n, 2)
  const p = db.prepare(`SELECT minutos, fuente FROM practicas WHERE aprendizaje_id = ?`).get(d.id) as any
  assert.deepEqual([p.minutos, p.fuente], [15, 'academia'])
  assert.equal(ac.leerDominio(db, d.id)!.temaIdx, 1, 'el temario avanza')
  assert.throws(() => ac.cerrarSesionTutor(db, s.id), /ya se cerró/)
})

test('Subir de nivel: el examen se habilita con dos clases seguidas de 80 % o más, y solo aprobarlo sube', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  await assert.rejects(ac.abrirSesionTutor(db, d.id, { examen: true, ahora: T }), /se habilita con dos clases/)
  await clase(db, d.id, ['bien', 'bien'], T)
  assert.equal(ac.examenHabilitado(db, d.id), false, 'con una sola, todavía no')
  const c2 = await clase(db, d.id, ['bien', 'bien'], T + 60 * MIN)
  assert.equal(c2.examen, true)
  assert.match(ac.academiaParaPrompt(db), /Electricidad en nivel 1 \(Niño de 10\), con el examen habilitado/)

  const ex = await ac.abrirSesionTutor(db, d.id, { examen: true, ahora: T + 120 * MIN })
  assert.equal(ex.tipo, 'examen')
  for (const i of [0, 1, 2]) await ac.responderTutor(db, ex.id, i, 'bien', T + 121 * MIN)
  for (const i of [3, 4]) await ac.responderTutor(db, ex.id, i, 'ni idea', T + 121 * MIN)
  const mal = ac.cerrarSesionTutor(db, ex.id, T + 130 * MIN)
  assert.deepEqual([mal.subio, mal.nivel, mal.repasar], [false, 1, ['P3', 'P4']], '3 de 5 no alcanza: dice qué repasar')

  await clase(db, d.id, ['bien', 'bien'], T + 200 * MIN)
  const ex2 = await ac.abrirSesionTutor(db, d.id, { examen: true, ahora: T + 300 * MIN })
  for (const i of [0, 1, 2, 3, 4]) await ac.responderTutor(db, ex2.id, i, i === 4 ? 'no' : 'bien', T + 301 * MIN)
  const ok = ac.cerrarSesionTutor(db, ex2.id, T + 310 * MIN)
  assert.deepEqual([ok.subio, ok.nivel], [true, 2], '4 de 5: nivel 2 (Instituto)')
  assert.equal(ac.leerDominio(db, d.id)!.temaIdx, 0, 'el nivel nuevo arranca su temario')
  const s3 = await ac.abrirSesionTutor(db, d.id, { ahora: T + 400 * MIN })
  assert.equal(s3.nivel, 2)
  assert.ok(pedidos.some((x) => /UNA clase del nivel 2 \(Instituto\)/.test(x)))
})

test('Los dominios de la Academia: Idiomas aparece marcado, lo sugerido y lo descartado no se mezclan', async () => {
  const db = abrir(':memory:')
  ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  db.prepare(`INSERT INTO aprendizajes (tema, estado, creado_en) VALUES ('Drones', 'sugerido', ?), ('Cocina', 'descartado', ?)`).run(T, T)
  const fr = ac.sumarDominio(db, { tema: 'Idioma · Francés' }, T)
  db.prepare(`INSERT INTO idiomas (aprendizaje_id, nombre, codigo, nivel, creado_en) VALUES (?, 'Francés', 'fr', 'A1', ?)`).run(fr.id, T)
  const ds = ac.listarDominios(db, T)
  assert.deepEqual(ds.map((d) => [d.tema, d.idioma]), [['Electricidad', false], ['Idioma · Francés', true]])
  const dr = ac.sumarDominio(db, { tema: 'Drones', porQue: 'Para el evento' }, T)
  assert.equal(dr.estado, 'activo', 'sumar lo sugerido lo activa')
})

test('Qué le conviene aprender: mira lo que viene y lo que quiere, propone sin repetir, y se acepta o descarta desde 📥', async () => {
  const db = abrir(':memory:')
  const { guardarOportunidad } = await import('../src/radar.ts')
  const { fijarPrincipal } = await import('../src/misiones.ts')
  const { bandeja, resolverBandeja } = await import('../src/sombra.ts')
  fijarPrincipal(db, 'jugador', { titulo: 'Construir una empresa de hardware' })
  guardarOportunidad(db, { titulo: 'Evento defensa-tech', cierre: '2026-11-14', porQue: 'Contactos de drones' }, T)
  ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  db.prepare(`INSERT INTO aprendizajes (tema, estado, creado_en) VALUES ('Cocina', 'descartado', ?)`).run(T)

  const xs = await ac.sugerirAprendizajes(db, { ahora: T })
  assert.match(contextos.at(-1)!, /Evento defensa-tech \(cierra 2026-11-14\)/)
  assert.match(contextos.at(-1)!, /Construir una empresa de hardware/)
  assert.match(contextos.at(-1)!, /Descartó \(no lo propongas de nuevo\): Cocina/)
  assert.deepEqual(xs.map((d) => d.tema), ['Drones'], 'lo que ya aprende o descartó no vuelve')
  assert.equal(xs[0].estado, 'sugerido')
  assert.equal(ac.textoSugerencia(xs[0]), 'Llegar al evento de defensa-tech sabiendo de qué se habla · para Evento defensa-tech (2026-11-14) · corto plazo')
  assert.deepEqual(ac.listarDominios(db, T).map((d) => d.tema), ['Electricidad'], 'lo sugerido no es un dominio todavía')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM entidades WHERE nombre = 'Drones'`).get() as any).n, 0, 'ni una entidad')

  const g = bandeja(db, T).grupos.find((x) => x.tipo === 'aprender')!
  assert.equal(g.items[0].texto, 'Drones')
  let aceptados: string[] = []
  ac._alAceptar((_db, d) => aceptados.push(d.tema))
  const d = await resolverBandeja(db, 'aprender', g.items[0].id, 'aceptar', T) as any
  assert.deepEqual([d.estado, aceptados], ['activo', ['Drones']], 'aceptar lo vuelve dominio y busca sus fuentes')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM entidades WHERE nombre = 'Drones'`).get() as any).n, 1)

  // Con 3 pendientes no propone más; las viejas sin responder se van solas.
  db.prepare(`INSERT INTO aprendizajes (tema, estado, creado_en) VALUES ('A', 'sugerido', ?), ('B', 'sugerido', ?), ('C', 'sugerido', ?)`).run(T, T, T)
  const n = pedidos.length
  assert.deepEqual(await ac.sugerirAprendizajes(db, { ahora: T }), [])
  assert.equal(pedidos.length, n, 'ni llamó al modelo')
  await ac.sugerirAprendizajes(db, { ahora: T + 22 * 86_400_000 })
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM aprendizajes WHERE tema IN ('A', 'B', 'C')`).get() as any).n, 0)
  db.prepare(`INSERT INTO aprendizajes (tema, estado, creado_en) VALUES ('Soldadura', 'sugerido', ?)`).run(T)
  const desc = ac.sugeridosDe(db)[0]
  ac.descartarSugerencia(db, desc.id)
  assert.equal(ac.leerDominio(db, desc.id)!.estado, 'descartado')
})

test('El corpus crece por dominio: busca a su nivel, guarda solo lo que volvió de la búsqueda (5 como mucho, variado) y anota cuándo', async () => {
  const db = abrir(':memory:')
  const guardadas: { url: string; nota: string }[] = []
  ac._probarFuentes({
    buscador: async (_db, q) => q === 'tercera' ? [] : Array.from({ length: 6 }, (_, i) => ({ titulo: `${q} ${i}`, url: `https://ej.org/${encodeURIComponent(q)}/${i}` })),
    guardador: async (_db, url, nota) => { guardadas.push({ url, nota }); return { piezaId: guardadas.length, nueva: !url.endsWith('/1'), lectura: null } },
  })
  const d = ac.sumarDominio(db, { tema: 'Drones' }, T)
  const r = await ac.buscarFuentes(db, d.id, { ahora: T })
  assert.deepEqual(r.consultas, ['Drones intro', 'segunda', 'tercera'])
  assert.ok(pedidos.at(-1)!.includes('nivel 1 (Niño de 10)') && /introducciones claras/.test(pedidos.at(-1)!), 'busca a su nivel')
  assert.equal(r.nuevas.length, ac.MAX_FUENTES)
  assert.deepEqual(guardadas.slice(0, 4).map((g) => g.url.split('/').slice(-2).join('/')), ['Drones%20intro/0', 'segunda/0', 'Drones%20intro/1', 'segunda/1'], 'de a una por consulta')
  assert.ok(r.nuevas.every((x) => !x.url.endsWith('/1')), 'lo que ya estaba no cuenta como nuevo')
  assert.match(guardadas[0].nota, /Fuente para aprender Drones \(nivel 1, Niño de 10\)/)
  assert.equal(ac.leerDominio(db, d.id)!.fuentesEn, T)
  assert.equal(ac.dominioParaFuentes(db, T + 86_400_000), null, 'buscó hace poco: la rutina espera')
  assert.equal(ac.dominioParaFuentes(db, T + 7 * 86_400_000)!.id, d.id)

  const { fijarAjuste } = await import('../src/db.ts')
  fijarAjuste(db, 'tokens_dia_max', '10')
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, en) VALUES ('nan', 'x', 'gerente', 'g', 50, 50, ?)`).run(T)
  const n = guardadas.length
  assert.ok((await ac.buscarFuentes(db, d.id, { ahora: T })).aviso, 'con el tope, frena')
  assert.equal(guardadas.length, n)
})
