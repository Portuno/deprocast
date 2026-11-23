import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { crearMision, semanaDe } from '../src/misiones.ts'
import { registrarSalud } from '../src/salud.ts'
import { registrarMovimiento } from '../src/finanzas.ts'
import { parteDeLaManana } from '../src/parte-manana.ts'

const AHORA = new Date(2026, 10, 23, 8, 30).getTime()

test('Fragua #329: el resumen de la mañana va por puntos: agenda con horas, primarias con %, side quests, y cuerpo y plata al final', () => {
  const db = abrir(':memory:')
  crearMision(db, { nivel: 'primaria', titulo: 'Cerrar el piloto', estado: 'activa', progreso: 40, semana: semanaDe(AHORA) }, { ahora: AHORA })
  crearMision(db, { nivel: 'terciaria', titulo: 'Devolver el libro', estado: 'activa', vence: '2026-11-25' }, { ahora: AHORA })
  crearMision(db, { nivel: 'terciaria', titulo: 'Comprar pilas', estado: 'activa' }, { ahora: AHORA })
  registrarSalud(db, { tipo: 'sueno', fecha: '2026-11-23', datos: { horas: 7.5 } }, AHORA)
  registrarSalud(db, { tipo: 'comida', fecha: '2026-11-22', datos: { kcal: 1900, proteina: 110 } }, AHORA)
  registrarSalud(db, { tipo: 'ejercicio', fecha: '2026-11-22', datos: { minutos: 45 } }, AHORA)
  fijarAjuste(db, 'meta_ingresos_mes', '3000')
  registrarMovimiento(db, { fecha: '2026-11-10', monto: 1200, descripcion: 'Factura' })
  registrarMovimiento(db, { fecha: '2026-11-12', monto: -350, descripcion: 'Super' })

  const eventos = [
    { titulo: 'Llamada con el equipo', inicio: new Date(2026, 10, 23, 11, 0).getTime(), todoElDia: false },
    { titulo: 'Feria del libro', todoElDia: true },
    { titulo: 'Dentista', inicio: new Date(2026, 10, 23, 9, 15).getTime(), todoElDia: false },
  ]
  const t = parteDeLaManana(db, { ahora: AHORA, eventos })
  const bloques = t.split('\n\n')
  assert.equal(bloques[0], 'Buen día.')
  assert.equal(bloques[1], '**Agenda**\n- todo el día Feria del libro\n- 09:15 Dentista\n- 11:00 Llamada con el equipo')
  assert.match(bloques[2], /^\*\*Primarias de la semana\*\*\n- Cerrar el piloto — \d+%$/)
  assert.equal(bloques[3], '**Side quests**\n- Devolver el libro (vence 25/11)\n- Comprar pilas')
  assert.equal(bloques.at(-1), '- Cuerpo: dormiste 7,5 h · ayer 1900 kcal y 110 g de proteína · 45 min de ejercicio\n- Plata: noviembre: entró 1200 € de 3000 € (40%), gastaste 350 €')
  assert.ok(t.split('\n').every((l) => l.length < 140), 'sin párrafos largos')

  // Sin datos de cuerpo ni plata, esas líneas no aparecen (nada de relleno).
  const vacio = parteDeLaManana(abrir(':memory:'), { ahora: AHORA, eventos: [], saludo: false })
  assert.equal(vacio, '**Agenda**\n- Nada agendado\n\n**Primarias de la semana**\n- Ninguna esta semana')
})
