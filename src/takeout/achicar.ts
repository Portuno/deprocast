/**
 * Achicar un medio en la compu antes de subirlo (ffmpeg): audio a MP3 mono de 32 kbps (16 si sigue pesando más de
 * 60 MB), imágenes a JPG de 1600 px. Los documentos van tal cual. Lo usan el Takeout, ChatGPT y las carpetas.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import type { ClaseMedio } from './leer.ts'

const ejecutar = (args: string[]) => new Promise<boolean>((ok) => {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'ignore' })
  p.on('error', () => ok(false))
  p.on('exit', (c) => ok(c === 0))
})

/** Achica un medio: el resultado queda en «salida». false si no se pudo (formato roto, sin ffmpeg). */
export async function achicar(datos: Buffer, ext: string, clase: ClaseMedio, salida: string, tmp: string): Promise<boolean> {
  if (clase === 'documento') { fs.writeFileSync(salida, datos); return true }
  const entrada = path.join(tmp, `entrada-${crypto.randomBytes(6).toString('hex')}.${ext || 'bin'}`)
  fs.writeFileSync(entrada, datos)
  try {
    const ok = clase === 'audio'
      ? await ejecutar(['-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', salida])
      : await ejecutar(['-i', entrada, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-q:v', '4', salida])
    if (ok && clase === 'audio' && fs.statSync(salida).size > 60 * 1024 * 1024) await ejecutar(['-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '16k', salida])
    return ok && fs.existsSync(salida) && fs.statSync(salida).size > 0
  } finally {
    fs.rmSync(entrada, { force: true })
  }
}

/** Lo que no vale subir: volcados de datos enormes (json, xml, html de varios MB) y documentos gigantes. */
export const descartable = (ext: string, bytes: number) => (/^(json|xml|html?)$/.test(ext) && bytes > 2 * 1024 * 1024) || bytes > 400 * 1024 * 1024 || (/^(pdf|docx|xlsx|pptx|md|txt|csv)$/.test(ext) && bytes > 30 * 1024 * 1024)
