/**
 * La ficha como carta, en la terminal.
 */
import { ATRIBUTO_MAX, ATRIBUTOS, CLASES } from './clases.ts'
import type { Db } from './db.ts'
import { especializacion } from './auditor.ts'
import { describirCelda } from './geometria72.ts'
import { nivel, type Ficha } from './roster.ts'
import { capa, NIVEL_BAUTISMO, NIVEL_MAX, umbral } from './xp.ts'

const W = 46

function pad(s: string, n: number): string {
  const largo = [...s].length
  return largo > n ? [...s].slice(0, n - 1).join('') + '…' : s + ' '.repeat(n - largo)
}

const fila = (s = '') => `│ ${pad(s, W - 2)} │`
const linea = (izq: string, der: string) => izq + '─'.repeat(W) + der

function barra(v: number, max: number, largo: number, lleno = '█', vacio = '░') {
  const n = Math.round((Math.min(v, max) / max) * largo)
  return lleno.repeat(n) + vacio.repeat(largo - n)
}

export function carta(db: Db | null, f: Ficha): string {
  const c = CLASES[f.clase]
  const n = nivel(f)
  const piso = umbral(n)
  const techo = n < NIVEL_MAX ? umbral(n + 1) : piso
  const esp = db ? especializacion(db, f.id) : null
  const nombre = f.nombre ?? (n >= NIVEL_BAUTISMO ? '«bautismo pendiente»' : `«sin nombre · se gana en nivel ${NIVEL_BAUTISMO}»`)
  const xp = n < NIVEL_MAX ? `${f.xp}/${techo}  ${barra(f.xp - piso, techo - piso, 16)}` : `${f.xp}  MÁXIMO`
  const stats = ATRIBUTOS.map((a) => `${a.sigla} ${barra(f.atributos[a.id], ATRIBUTO_MAX, ATRIBUTO_MAX, '■', '·')}`)
  const k = capa(n)
  return [
    linea('┌', '┐'),
    fila(`${c.glifo} ${f.id}${' '.repeat(Math.max(1, W - 12 - f.id.length - String(n).length))}NIVEL ${n}`),
    fila(nombre),
    fila(`${c.nombre} — ${c.produce}`),
    linea('├', '┤'),
    fila(`XP ${xp}`),
    fila(`Estado ${f.estado.toUpperCase()}   ✓${f.exitos}  ✗${f.fallos}${f.rachaFallos ? `  racha ✗${f.rachaFallos}` : ''}`),
    fila(`Especialización ${esp ?? '—'}`),
    fila(`Creador ${f.creador}   Proyecto ${f.proyectoId ?? '—'}`),
    fila(`Celda ${f.celda ? describirCelda(f.celda) : '—'}`),
    linea('├', '┤'),
    fila(`${stats[0]}   ${stats[1]}   ${stats[2]}`),
    fila(`${stats[3]}   ${stats[4]}   ${stats[5]}`),
    linea('├', '┤'),
    fila(`Motor ${f.motor}`),
    fila(`Capa ${k.nivel} · ${k.nombre}: ${k.abre}`),
    fila(`“${f.instrucciones.replace(/\s+/g, ' ')}”`),
    linea('└', '┘'),
  ].join('\n')
}
