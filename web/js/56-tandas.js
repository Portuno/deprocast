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

// ─── Google Takeout (Gemini y NotebookLM) ───────────────────────────────
// Se sube desde la compu (npm run mastro -- takeout <carpeta> <url>); acá se ve cómo va y se confirman los nombres nuevos.

const ESTADO_LOTE = { subiendo: 'subiendo desde la compu', ingiriendo: 'leyendo el paquete', procesando: 'escuchando, mirando y destilando', historia: 'armando la historia de cada proyecto', terminado: 'terminado', error: 'con error' }

async function modalTakeout() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🗂 Google Takeout</h2><div id="tk-cuerpo"><p class="tenue">Cargando…</p></div>`)
  const pintar = async () => {
    if (!$('#tk-cuerpo')) return
    let d
    try { d = await api('/takeout') } catch (e) { $('#tk-cuerpo').innerHTML = `<p class="tenue">${esc(e.message)}</p>`; return }
    const n = (xs, f) => xs.filter(f).reduce((s, x) => s + x.n, 0)
    const l = d.lotes[0]
    const medios = ['audio', 'imagen', 'documento'].map((c) => {
      const de = d.medios.filter((m) => m.clase === c)
      const total = n(de, () => true)
      return total ? `<span class="hud-ficha"><small>${c === 'audio' ? '🎧 Audios' : c === 'imagen' ? '🖼 Imágenes' : '📄 Documentos'}</small><b>${n(de, (m) => m.estado === 'hecho')}/${total}</b><em>${n(de, (m) => m.estado === 'fallo') ? `${n(de, (m) => m.estado === 'fallo')} fallaron` : n(de, (m) => m.estado === 'salteado') ? `${n(de, (m) => m.estado === 'salteado')} salteados` : ''}</em></span>` : ''
    }).join('')
    const dt = n(d.destilado, () => true)
    const dh = n(d.destilado, (x) => x.estado === 'hecho')
    $('#tk-cuerpo').innerHTML = !l
      ? `<p>Todavía no subiste un Takeout. Desde la compu, con los zips en una carpeta:</p><pre>npm run mastro -- takeout "C:\ruta\a\takeout" ${esc(location.origin)}</pre><p class="tenue">La compu solo lee los zips y achica los medios; escuchar, mirar, destilar y armar la historia de cada proyecto lo hace Deprocast acá, sin gastar tu tope.</p>`
      : `<p><b>${esc(l.id)}</b> · ${esc(ESTADO_LOTE[l.estado] ?? l.estado)}${l.error ? ` · <span class="mal">${esc(l.error)}</span>` : ''}${d.trabajando ? ' · <span class="tenue">trabajando ahora</span>' : ''}</p>
        <div class="hud-fichas">${medios}<span class="hud-ficha"><small>🧪 Destilado</small><b>${dh}/${dt}</b><em>${n(d.destilado, (x) => x.estado === 'fallo') ? `${n(d.destilado, (x) => x.estado === 'fallo')} fallaron` : ''}</em></span></div>
        ${dt ? `<span class="hud-barra" style="margin:8px 0"><i style="width:${Math.round((dh / dt) * 100)}%"></i></span>` : ''}
        <p class="tenue chico">${Object.entries(l.resumen ?? {}).filter(([k]) => k.startsWith('ingesta_')).map(([k, v]) => `${v} ${k.slice(8).replace('_', ' ')}`).join(' · ')}${d.archivosEnEspera ? ` · ${d.archivosEnEspera} archivos esperando (se borran al procesarlos)` : ''}</p>
        ${d.errores.length ? `<details><summary>${d.errores.length} con error</summary>${d.errores.map((e) => `<p class="chico"><b>${esc(e.que)}</b> ${esc(e.titulo ?? '')}: ${esc(e.error ?? '')}</p>`).join('')}<button class="btn btn-chico" id="tk-reintentar">Reintentar lo que falló</button></details>` : ''}`
      + (d.temas.length ? `<h3>Los temas que más volvieron</h3><div class="hud-chips">${d.temas.map((t) => `<span class="tipo-chip" title="${esc(t.primera ?? '')} → ${esc(t.ultima ?? '')}">${esc(t.tema)} · ${t.veces}</span>`).join(' ')}</div>` : '')
      + (d.nombres.length ? `<h3>Personas y proyectos nuevos <small class="tenue">esperan tu ok</small></h3><div class="cu-fuentes">${d.nombres.map((x) => `<div class="sq" data-clave="${esc(x.clave)}"><span>${x.tipo === 'proyecto' ? '◆' : '●'} <b>${esc(x.nombre)}</b> · ${x.veces} ${x.veces === 1 ? 'vez' : 'veces'}<small>${esc(x.primera ?? '')}${x.ultima && x.ultima !== x.primera ? ` → ${esc(x.ultima)}` : ''}${x.nota ? ` · ${esc(x.nota.slice(0, 90))}` : ''}</small></span>
          <span class="fila"><button class="btn btn-chico" data-tk="aceptar" title="Crear la entidad">✓</button><button class="btn btn-chico" data-tk="fusionar" title="Es una que ya existe">≈</button><button class="btn btn-chico" data-tk="descartar" title="No es nadie / no importa">✕</button></span></div>`).join('')}</div>` : '')
    $('#tk-reintentar')?.addEventListener('click', async () => { await api('/takeout/reintentar', {}); pintar() })
    $$('#tk-cuerpo [data-tk]').forEach((b) => (b.onclick = async () => {
      const clave = b.closest('[data-clave]').dataset.clave
      const accion = b.dataset.tk
      try {
        if (accion === 'fusionar') {
          const nombre = prompt('¿Con qué entidad es la misma? (escribí su nombre)')
          if (!nombre) return
          const e = (await api(`/entidades?q=${encodeURIComponent(nombre)}`)).entidades?.[0]
          if (!e) return toast('No encontré esa entidad')
          await api('/takeout/nombre', { clave, accion: 'aceptar', entidadId: e.id })
          toast(`Ahora es un alias de ${esc(e.nombre)}`, 'suave')
        } else await api('/takeout/nombre', { clave, accion })
        pintar()
      } catch (e) { error(e) }
    }))
  }
  await pintar()
  const t = setInterval(() => ($('#tk-cuerpo') ? pintar() : clearInterval(t)), 10_000)
}
