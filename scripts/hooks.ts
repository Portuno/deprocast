/**
 * npm install (prepare) → los hooks del repo en .githooks (Fragua #213: medir antes de cada push a main). Sin git (la
 * nube baja el código como paquete) no hace nada.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const raiz = path.resolve(import.meta.dirname, '..')
if (fs.existsSync(path.join(raiz, '.git'))) {
  try { execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: raiz, stdio: 'ignore' }) } catch { /* sin git */ }
}
