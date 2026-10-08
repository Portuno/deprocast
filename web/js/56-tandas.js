'use strict'
// Tandas: notas de voz y páginas de cuadernos, de a muchas. Se suben una por una y se procesan en cola en el servidor.

let tandasEspera = null

function modalTandas(tipo = 'audio') {
  const audio = tipo === 'audio'
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <h2>${audio ? '🎙 Notas de voz' : '📓 Cuaderno escaneado'}</h2>
    <p class="tenue">${audio
      ? 'Elegí varios audios o una carpeta entera. Cada uno se transcribe, se separan las voces (si hay más de una, Mastropiero aprende solo de lo que dijiste vos) y entra como pieza tuya con su fecha (del nombre del archivo o de cuándo se grabó). Los largos se parten solos.'
      : 'Fotos o escaneos de las páginas, en orden. Cada una se lee con visión (texto, listas, flechas y dibujos) y entra como «Cuaderno · hoja N». Un PDF, exportalo como imágenes primero.'}</p>
    ${audio ? '' : `<div class="fila"><label>Cuaderno <input id="ta-cuaderno" list="ta-cuadernos" placeholder="El Castillo" style="width:14em"></label><datalist id="ta-cuadernos"></datalist>
      <label>Primera hoja <input id="ta-hoja" type="number" min="1" style="width:6em" placeholder="auto"></label></div>`}
    <div class="fila" style="margin:10px 0">
      <label class="btn btn-primario">Elegir ${audio ? 'audios' : 'páginas'}<input type="file" id="ta-archivos" multiple accept="${audio ? 'audio/*,.m4a,.mp3,.ogg,.opus,.wav,.webm,.aac,.amr' : 'image/*'}" hidden></label>
      ${audio ? '<label class="btn">Elegir carpeta<input type="file" id="ta-carpeta" webkitdirectory hidden></label>' : ''}
    </div>
    <div id="ta-subida"></div>
    <div id="ta-cola" class="cu-fuentes"></div>`)
  if (!audio) api('/tandas').then((d) => {
    $('#ta-cuadernos').innerHTML = d.cuadernos.map((c) => `<option value="${esc(c.nombre)}">`).join('')
    $('#ta-cuaderno').oninput = (e) => { const c = d.cuadernos.find((x) => x.nombre === e.target.value); $('#ta-hoja').placeholder = c ? `sigue en ${c.ultimaHoja + 1}` : 'auto' }
  }).catch(() => {})
  const subir = async (lista) => {
    const archivos = [...lista].filter((f) => audio ? /^audio\//.test(f.type) || /\.(m4a|mp3|ogg|oga|opus|wav|webm|aac|amr|flac)$/i.test(f.name) : /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
    if (!archivos.length) return toast('No encontré archivos de ese tipo')
    const caja = $('#ta-subida')
    let hoja = audio ? null : Number($('#ta-hoja').value) || null
    const cuaderno = audio ? null : $('#ta-cuaderno').value.trim() || 'Cuaderno'
    let repetidos = 0
    for (const [i, f] of archivos.entries()) {
      caja.innerHTML = `<p class="pensando">Subiendo ${i + 1} de ${archivos.length}: ${esc(f.name)}…</p>`
      const q = new URLSearchParams({ tipo, nombre: f.name, fecha: new Date(f.lastModified).toISOString().slice(0, 16).replace('T', ' ') })
      if (!audio) { q.set('cuaderno', cuaderno); if (hoja) q.set('hoja', String(hoja++)) }
      try {
        const r = await fetch(`/api/tandas?${q}`, { method: 'POST', body: f }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
        if (r.repetida) repetidos++
      } catch (e) { error(e) }
    }
    caja.innerHTML = `<p>Subidos ${archivos.length - repetidos}${repetidos ? ` (${repetidos} ya estaban)` : ''}. Se procesan de a uno: podés cerrar esto, sigue solo.</p>`
    pintarCola()
  }
  $('#ta-archivos').onchange = (e) => subir(e.target.files)
  if ($('#ta-carpeta')) $('#ta-carpeta').onchange = (e) => subir(e.target.files)
  pintarCola()
}

async function pintarCola() {
  const cont = $('#ta-cola')
  if (!cont) return
  let d
  try { d = await api('/tandas') } catch { return }
  const icono = { pendiente: '⏳', procesando: '⚙', hecha: '✓', fallo: '✗' }
  cont.innerHTML = `<p class="tenue">${d.cuenta.pendiente + d.cuenta.procesando ? `En cola: ${d.cuenta.pendiente + d.cuenta.procesando} · ` : ''}${d.cuenta.hecha} hechas${d.cuenta.fallo ? ` · ${d.cuenta.fallo} con error` : ''}</p>` +
    d.tandas.slice(0, 30).map((t) => `<div class="cu-fuente"><span title="${esc(t.error ?? t.archivo)}">${icono[t.estado]} ${t.tipo === 'audio' ? '🎙' : '📓'} ${esc(t.cuaderno ? `${t.cuaderno} · hoja ${t.hoja}` : t.archivo)}${t.fecha ? ` <small class="tenue">${esc(t.fecha)}</small>` : ''}${t.error ? ` <small style="color:var(--malo,#d27272)">${esc(t.error)}</small>` : ''}</span>
      ${t.piezaId ? `<a href="#" data-pieza="${t.piezaId}">ver</a>` : ''}${t.estado === 'fallo' ? `<button class="btn btn-chico" data-reintentar="${t.id}">Reintentar</button>` : ''}</div>`).join('')
  $$('[data-reintentar]', cont).forEach((b) => (b.onclick = async () => { await api(`/tandas/${b.dataset.reintentar}/reintentar`, {}).catch(error); pintarCola() }))
  clearTimeout(tandasEspera)
  if (d.cuenta.pendiente + d.cuenta.procesando) tandasEspera = setTimeout(pintarCola, 4000)
}
