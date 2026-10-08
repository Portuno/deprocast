'use strict'
// Exportar e importar todo el estado: para llevar Deprocast de una compu a otra y seguir donde quedó.

function modalEstado() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Exportar o importar</h2>
    <div class="bloque">
      <h3>Exportar todo</h3>
      <p class="tenue">Un solo JSON con todo: corpus, memoria, misiones, runs, chats, personas, plata, bitácora (lo cifrado sigue cifrado), agentes, ajustes y rutinas. Con los archivos, también lo que subiste y lo del Taller. No lleva tu <code>.env</code> (las claves): copialo a mano.</p>
      <label><input type="checkbox" id="es-archivos" checked> incluir archivos (cargas y Taller; pesa más)</label>
      <div class="fila" style="margin-top:8px"><button class="btn btn-primario" id="es-exportar">⇩ Exportar</button></div>
    </div>
    <div class="bloque">
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
        const r = await fetch('/api/importar-estado?forzar=1', { method: 'POST', body: archivo }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
        $('#es-info').innerHTML = `<p>Listo: ${r.filas.toLocaleString('es-AR')} filas en ${r.tablas} tablas y ${r.archivos} archivos.${r.respaldo ? `<br><span class="tenue">Lo que había quedó en ${esc(r.respaldo)}</span>` : ''}</p><button class="btn btn-primario" onclick="location.reload()">Recargar</button>`
      } catch (e) { error(e); b.disabled = false; b.textContent = 'Reemplazar esta base con esa exportación' }
    }
  }
}

$('#btn-estado').onclick = modalEstado
