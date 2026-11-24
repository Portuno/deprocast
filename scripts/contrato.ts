// Escribe el contrato de la API del dispositivo en docs/api-dispositivo.json (para los clientes que no son TypeScript).
import fs from 'node:fs'
import { comoJson } from '../src/contrato-dispositivo.ts'

fs.writeFileSync('docs/api-dispositivo.json', JSON.stringify(comoJson(), null, 2) + '\n')
console.log('docs/api-dispositivo.json escrito')
