'use strict'
// Exportar e importar todo el estado: para llevar Deprocast de una compu a otra y seguir donde quedó.

function modalEstado() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Exportar o importar</h2>
    <div class="seccion">
      <h3>Exportar todo</h3>
      <p class="tenue">Un solo JSON con todo: corpus, memoria, misiones, runs, chats, personas, plata, bitácora (lo cifrado sigue cifrado), agentes, ajustes y rutinas. Con los archivos, también lo que subiste y lo del Taller. No lleva tu <code>.env</code> (las claves): copialo a mano.</p>
      <label><input type="checkbox" id="es-archivos" checked> incluir archivos (cargas y Taller; pesa más)</label>
      <div class="fila" style="margin-top:8px"><button class="btn btn-primario" id="es-exportar">⇩ Exportar</button></div>
    </div>
    <div class="seccion">
      <h3>Importar</h3>
      <p class="tenue">Deja esta base igual a la exportada. Si acá ya hay datos, se reemplazan (antes guardo un respaldo en <code>data/respaldos/</code>).</p>
      <label class="btn">Elegir exportación (.json)<input type="file" accept=".json,application/json" hidden id="es-archivo"></label>
      <div id="es-info"></div>
    </div>`)
  $('#es-exportar').onclick = () => {
    const b = $('#es-exportar')
    b.disabled = true
    b.textContent = 'Armando el archivo…'
    // La descarga la hace el navegador (el archivo puede pesar mucho).
    const a = document.createElement('a')
    a.href = `/api/exportar?archivos=${$('#es-archivos').checked ? 1 : 0}`
    a.download = ''
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => { b.disabled = false; b.textContent = '⇩ Exportar' ; toast('Exportando<small>Se baja a tu carpeta de descargas; también queda una copia en data/exportaciones/.</small>') }, 1500)
  }
  $('#es-archivo').onchange = async (ev) => {
    const archivo = ev.target.files[0]
    if (!archivo) return
    // Leo solo la cabecera (fecha y conteos) para confirmar antes de subirlo entero.
    const cabeza = await archivo.slice(0, 256 * 1024).text()
    const fecha = /"exported_at":"([^"]+)"/.exec(cabeza)?.[1]
    if (!/"format":"deprocast-estado"/.test(cabeza)) return error(new Error('Ese archivo no es una exportación de estado de Deprocast. (El respaldo de la 0.7 se carga en Corpus → Ingerir.)'))
    let conteos = {}
    try { conteos = JSON.parse(/"counts":(\{[^}]*\})/.exec(cabeza)?.[1] ?? '{}') } catch { /* sin conteos */ }
    const n = (t) => (conteos[t] ?? 0).toLocaleString('es-AR')
    $('#es-info').innerHTML = `<p>Exportación del <b>${esc(fecha ? new Date(fecha).toLocaleString('es-AR') : '?')}</b> · ${(archivo.size / 1024 / 1024).toFixed(1)} MB<br>
      <span class="tenue">${n('corpus')} piezas · ${n('memoria')} recuerdos · ${n('misiones')} misiones · ${n('runs')} runs · ${n('mensajes')} mensajes · ${n('entidades')} entidades · ${n('agentes')} agentes</span></p>
      <button class="btn btn-peligro" id="es-importar">Reemplazar esta base con esa exportación</button>`
    $('#es-importar').onclick = async () => {
      if (!confirm('¿Reemplazar todo lo de esta base por la exportación? Lo actual queda respaldado en data/respaldos/.')) return
      const b = $('#es-importar')
      b.disabled = true
      b.textContent = 'Importando…'
      try {
        const r = await importarEnPedazos(archivo, (t) => { b.textContent = t })
        $('#es-info').innerHTML = `<p>Listo: ${r.filas.toLocaleString('es-AR')} filas en ${r.tablas} tablas y ${r.archivos} archivos.${r.respaldo ? `<br><span class="tenue">Lo que había quedó en ${esc(r.respaldo)}</span>` : ''}</p><button class="btn btn-primario" onclick="location.reload()">Recargar</button>`
      } catch (e) { error(e); b.disabled = false; b.textContent = 'Reemplazar esta base con esa exportación' }
    }
  }
}

/**
 * Sube la exportación en pedazos de 16 MB (la nube corta los pedidos grandes) y espera a que el servidor la importe
 * de fondo. Cada pedazo va con su posición: si uno falla, se reintenta sin duplicar nada.
 */
async function importarEnPedazos(archivo, avisar) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const PEDAZO = 16 * 1024 * 1024
  const pedir = async (ruta, cuerpo) => {
    for (let intento = 1; ; intento++) {
      try {
        const x = await fetch(ruta, cuerpo ? { method: 'POST', body: cuerpo } : {})
        const j = await x.json().catch(() => ({ error: `El servidor respondió ${x.status}` }))
        if (!x.ok) throw new Error(j.error || `El servidor respondió ${x.status}`)
        return j
      } catch (e) {
        if (intento >= 4) throw e
        await new Promise((ok) => setTimeout(ok, 2000 * intento))
      }
    }
  }
  for (let desde = 0; desde < archivo.size; desde += PEDAZO) {
    avisar(`Subiendo… ${Math.round((desde / archivo.size) * 100)}%`)
    await pedir(`/api/importar-estado/parte?id=${id}&desde=${desde}`, archivo.slice(desde, desde + PEDAZO))
  }
  await pedir(`/api/importar-estado/fin?id=${id}&forzar=1&total=${archivo.size}`, new Blob([]))
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1500))
    const e = await pedir(`/api/importar-estado/estado?id=${id}`)
    if (e.estado === 'listo') return e.resultado
    if (e.estado === 'error') throw new Error(e.error)
    avisar(`Importando… ${Math.min(99, Math.round((e.leidos / e.total) * 100))}%`)
  }
}

$('#btn-estado').onclick = modalEstado

// ─── Velocidad ──────────────────────────────────────────────────────────

/** Cuánto tarda cada ruta (p50, p95, máximo) y cuánto se trabó el servidor, desde que arrancó o desde el último reinicio. */
async function modalVelocidad() {
  let v
  try { v = await api('/velocidad') } catch (e) { return error(e) }
  const color = (ms) => (ms >= 1000 ? 'mal' : ms >= 200 ? 'aviso' : 'ok')
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>⏱ Velocidad</h2>
    <p class="tenue">Medido en vivo desde hace ${v.minutos} min. El bucle es cuánto tuvo que esperar algo para correr: si pasa de unos cientos de ms, el servidor se está trabando.</p>
    <div class="dsc-fichas"><div><b class="vel-${color(v.bucle.p99)}">${v.bucle.p99} ms</b><span>bucle p99</span></div><div><b class="vel-${color(v.bucle.max)}">${v.bucle.max} ms</b><span>bloqueo más largo</span></div><div><b>${v.rutas.reduce((s, r) => s + r.veces, 0)}</b><span>pedidos</span></div></div>
    <table class="dsc-tabla vel-tabla"><thead><tr><th>Ruta</th><th>Veces</th><th>p50</th><th>p95</th><th>Máx</th><th>KB</th></tr></thead><tbody>
      ${v.rutas.slice(0, 40).map((r) => `<tr><td><code>${esc(r.ruta)}</code>${r.lentos ? ` <span class="chip vel-mal">${r.lentos} lentos</span>` : ''}</td><td>${r.veces}</td><td class="vel-${color(r.p50)}">${r.p50}</td><td class="vel-${color(r.p95)}">${r.p95}</td><td class="vel-${color(r.max)}">${r.max}</td><td>${r.kbPromedio}</td></tr>`).join('')}
    </tbody></table>
    <div class="fila"><button class="btn" id="vel-reiniciar">Empezar a medir de nuevo</button></div>`)
  $('#modal').classList.add('modal-ancho')
  $('#vel-reiniciar').onclick = async () => { try { await api('/velocidad/reiniciar', {}); modalVelocidad() } catch (e) { error(e) } }
}
