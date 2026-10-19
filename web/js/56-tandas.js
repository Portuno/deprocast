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

/** YouTube: pegar videos o canales; la cola dice qué se leyó y qué espera (al servicio o a la compu). */
const ICONO_YT = { pendiente: '⏳', compu: '🖥', listo: '✓', sin_subtitulos: '∅', fallo: '✗' }
async function pintarYoutube() {
  const cont = $('#yt-estado')
  if (!cont) return
  let d
  try { d = await api('/youtube') } catch (e) { cont.innerHTML = `<p class="tenue">${esc(e.message)}</p>`; return }
  const c = d.cuenta
  const hace = (ms) => { const m = Math.round((Date.now() - ms) / 60_000); return m < 2 ? 'recién' : m < 120 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h` }
  cont.innerHTML = `
    <p>${[c.listo ? `✓ ${c.listo} leídos` : '', c.pendiente ? `⏳ ${c.pendiente} en cola` : '', c.compu ? `🖥 ${c.compu} esperan tu compu` : '', c.sin_subtitulos ? `∅ ${c.sin_subtitulos} sin subtítulos` : '', c.fallo ? `✗ ${c.fallo} fallaron` : '', d.canales ? `📺 ${d.canales} canales por listar` : ''].filter(Boolean).join(' · ') || 'Todavía no importaste videos.'}</p>
    <p class="tenue chico">Servicio de transcripciones: ${d.servicio.configurado ? (d.servicio.disponible ? 'activo' : `en pausa (${esc(d.servicio.motivo ?? 'sin cupo')})`) : 'no configurado (SUPADATA_API_KEY)'} · Tu compu: ${d.compu.activa ? 'leyendo ahora' : d.compu.vista ? `la última vez ${hace(d.compu.vista)}` : 'nunca se conectó'}</p>
    ${c.compu && !d.compu.activa ? `<p class="chico">Para que tu compu los lea, dejá corriendo en la carpeta de Deprocast:</p><pre>npm run mastro -- youtube ${esc(location.origin)}</pre>` : ''}
    ${d.ultimos.length ? `<div class="cu-fuentes">${d.ultimos.slice(0, 25).map((u) => `<div class="cu-fuente"><span title="${esc(u.motivo ?? '')}">${ICONO_YT[u.estado] ?? '·'} ${u.tipo === 'canal' ? '📺' : '▶'} ${esc(u.titulo ?? u.id)}${u.recomendado ? ' <small class="tenue">recomendado</small>' : ''}${u.motivo && u.estado !== 'listo' ? ` <small class="tenue">${esc(u.motivo.slice(0, 90))}</small>` : ''}</span>${u.piezaId ? `<a href="#" data-pieza="${u.piezaId}">ver</a>` : ''}</div>`).join('')}</div>` : ''}
    ${c.fallo || c.sin_subtitulos ? '<button class="btn btn-chico" id="yt-reintentar">Reintentar los que no salieron</button>' : ''}`
  $('#yt-reintentar')?.addEventListener('click', async () => { try { const r = await api('/youtube/reintentar', {}); toast(`${r.reintentados} de vuelta a la cola`, 'suave'); pintarYoutube() } catch (e) { error(e) } })
  $$('[data-pieza]', cont).forEach((a) => (a.onclick = (e) => { e.preventDefault(); modalPieza(Number(a.dataset.pieza)) }))
}

async function modalTakeout() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🗂 Importaciones</h2>
    <div class="yt-caja"><h3>▶ YouTube</h3>
      <p class="tenue chico">Videos o canales enteros, uno por línea. Cada video entra con su transcripción y se analiza solo: qué plantea, si el título cumple, ideas (protoquántomos) y las fuentes que recomienda, que también se leen. También podés mandarlos por el chat.</p>
      <textarea id="yt-links" class="campo" rows="3" placeholder="https://www.youtube.com/watch?v=…&#10;https://www.youtube.com/@canal"></textarea>
      <div class="fila"><label class="chico">Videos por canal <input id="yt-max" class="campo-suelto" type="number" min="1" max="5000" value="50" style="width:90px"></label><button class="btn btn-primario" id="yt-importar">Importar</button></div>
      <div id="yt-estado"><p class="tenue">Cargando…</p></div></div>
    <h3>Google Takeout, ChatGPT y carpetas</h3><div id="tk-cuerpo"><p class="tenue">Cargando…</p></div>`)
  $('#yt-importar').onclick = async () => {
    const texto = $('#yt-links').value
    if (!texto.trim()) return toast('Pegá uno o más links de YouTube')
    try {
      const r = await api('/youtube/importar', { texto, max: Number($('#yt-max').value) || 50 })
      toast([r.videos ? `${r.videos} videos` : '', r.canales ? `${r.canales} canales` : '', r.yaEstaban ? `${r.yaEstaban} ya estaban` : '', r.noSonDeYoutube ? `${r.noSonDeYoutube} no son de YouTube` : ''].filter(Boolean).join(' · ') || 'Nada nuevo', 'suave')
      $('#yt-links').value = ''
      pintarYoutube()
    } catch (e) { error(e) }
  }
  pintarYoutube()
  const ty = setInterval(() => ($('#yt-estado') ? pintarYoutube() : clearInterval(ty)), 10_000)
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
      ? `<p>Todavía no importaste nada. Desde la compu, con la carpeta del Takeout (los zips) o la de la exportación de ChatGPT:</p><pre>npm run mastro -- takeout "C:\ruta\a\la\carpeta" ${esc(location.origin)}</pre><p class="tenue">La compu solo lee los zips y achica los medios; escuchar, mirar, destilar y armar la historia de cada proyecto lo hace Deprocast acá, sin gastar tu tope.</p>`
      : `<p><b>${esc(l.id)}</b> · ${esc(ESTADO_LOTE[l.estado] ?? l.estado)}${l.error ? ` · <span class="mal">${esc(l.error)}</span>` : ''}${d.trabajando ? ' · <span class="tenue">trabajando ahora</span>' : ''}</p>
        <div class="hud-fichas">${medios}<span class="hud-ficha"><small>🧪 Destilado</small><b>${dh}/${dt}</b><em>${n(d.destilado, (x) => x.estado === 'fallo') ? `${n(d.destilado, (x) => x.estado === 'fallo')} fallaron` : ''}</em></span></div>
        ${dt ? `<span class="hud-barra" style="margin:8px 0"><i style="width:${Math.round((dh / dt) * 100)}%"></i></span>` : ''}
        <p class="tenue chico">${Object.entries(l.resumen ?? {}).filter(([k]) => k.startsWith('ingesta_')).map(([k, v]) => `${v} ${k.slice(8).replace('_', ' ')}`).join(' · ')}${d.archivosEnEspera ? ` · ${d.archivosEnEspera} archivos esperando (se borran al procesarlos)` : ''}</p>
        ${d.errores.length ? `<details><summary>${d.errores.length} con error</summary>${d.errores.map((e) => `<p class="chico"><b>${esc(e.que)}</b> ${esc(e.titulo ?? '')}: ${esc(e.error ?? '')}</p>`).join('')}<button class="btn btn-chico" id="tk-reintentar">Reintentar lo que falló</button></details>` : ''}`
      + (d.temas.length ? `<h3>Los temas que más volvieron</h3><div class="hud-chips">${d.temas.map((t) => `<span class="tipo-chip" title="${esc(t.primera ?? '')} → ${esc(t.ultima ?? '')}">${esc(t.tema)} · ${t.veces}</span>`).join(' ')}</div>` : '')
      + (d.nombres.length ? `<h3>Nombres que aparecieron <small class="tenue">personas, proyectos y lugares · esperan tu ok</small></h3><div class="cu-fuentes">${d.nombres.map((x) => `<div class="sq" data-clave="${esc(x.clave)}"><span>${x.tipo === 'proyecto' ? '◆' : x.tipo === 'lugar' ? '⌖' : '●'} <input class="campo-suelto tk-nombre" value="${esc(x.nombre)}" title="Si se leyó mal, corregilo antes de aceptar"> · ${x.veces} ${x.veces === 1 ? 'vez' : 'veces'}${x.parecida ? ` · <span class="dir-parece">¿es <b>«${esc(x.parecida.nombre)}»</b>?</span>` : ''}<small>${esc(x.primera ?? '')}${x.ultima && x.ultima !== x.primera ? ` → ${esc(x.ultima)}` : ''}${x.nota ? ` · ${esc(x.nota.slice(0, 90))}` : ''}</small></span>
          <span class="fila">${x.parecida ? `<button class="btn btn-chico btn-primario" data-tk="es" data-ent="${x.parecida.id}" title="Es la que ya existe: se suma como otro nombre">Es esa</button>` : ''}<button class="btn btn-chico" data-tk="aceptar" title="${x.parecida ? 'Es otra: crear la entidad' : 'Crear la entidad'}">${x.parecida ? 'Es otra' : '✓'}</button><button class="btn btn-chico" data-tk="fusionar" title="Es una que ya existe">≈</button><button class="btn btn-chico" data-tk="descartar" title="No es nadie / no importa">✕</button></span></div>`).join('')}</div>` : '')
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
        } else if (accion === 'es') {
          await api('/takeout/nombre', { clave, accion: 'aceptar', entidadId: Number(b.dataset.ent) })
          toast('Sumado como otro nombre de la que ya estaba', 'suave')
        } else await api('/takeout/nombre', { clave, accion, nombre: b.closest('[data-clave]').querySelector('.tk-nombre')?.value })
        pintar()
      } catch (e) { error(e) }
    }))
  }
  await pintar()
  const t = setInterval(() => ($('#tk-cuerpo') ? pintar() : clearInterval(t)), 10_000)
}

// ─── el reproceso ───────────────────────────────────────────────────────

/** El reproceso: cuánto va (pasajes, recuerdos, destilado, eventos, relaciones, crónicas), lo gastado y lo último destilado. */
async function modalReproceso() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>⚙ Procesar</h2>
    <p class="tenue">Pasa tu corpus por los modelos de NaN, en la nube y de fondo: lo corta en pasajes para buscar, lo destila y saca eventos para tu <a href="#" id="rp-linea">Línea</a> y relaciones para el grafo. Lo que importás se procesa solo al subirlo.</p>
    <div id="rp-cuerpo"><p class="tenue">Cargando…</p></div>`)
  $('#rp-linea').onclick = (e) => { e.preventDefault(); cerrarModal(); irA('linea') }
  const mill = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n))
  const pintar = async () => {
    const cont = $('#rp-cuerpo')
    if (!cont) return
    let d
    try { d = await api('/reproceso') } catch (e) { cont.innerHTML = `<p class="tenue">${esc(e.message)}</p>`; return }
    const fmt = (n) => Number(n || 0).toLocaleString('es-AR')
    const pct = (a, b) => (b ? Math.min(100, Math.floor((a / b) * 100)) : 100)
    // Cuánto falta, en minutos u horas, al ritmo de la última hora.
    const eta = (faltan, porHora) => (!faltan || !porHora ? '' : faltan / porHora < 1 ? `~${Math.max(1, Math.round((faltan / porHora) * 60))} min` : `~${Math.ceil(faltan / porHora)} h`)
    const ahora = new Set(d.ahora || [])
    const lotes = d.importado?.lotes || []
    const mediosPend = lotes.reduce((t, l) => t + (l.medios.total - l.medios.hechos), 0)
    const dTotal = d.destilado.hechos + d.destilado.pendientes
    const itemsTotal = d.items.hechos + d.items.faltan

    /** Un paso: qué es, cuánto va (escrito entero) y en qué está: ahora, listo, en cola o esperando a otro. */
    const paso = ({ icono, titulo, que, hechos, total, unidad, activo, espera, nota }) => {
      const listo = !total || hechos >= total
      const est = activo ? 'ahora' : listo ? 'listo' : espera ? 'espera' : 'cola'
      return `<div class="rp-paso ${est}">
        <div class="rp-cab"><span class="rp-tit">${icono} ${titulo}</span><span class="rp-estado">${{ ahora: '● Ahora', listo: '✓ Listo', espera: '⏸ Espera', cola: 'En cola' }[est]}</span></div>
        ${que ? `<p class="rp-que">${que}</p>` : ''}
        <div class="rp-num"><span><b>${fmt(hechos)}</b> de ${fmt(total)} ${unidad}</span><span class="rp-pct">${pct(hechos, total)}%</span></div>
        <span class="rp-barra"><i style="width:${pct(hechos, total)}%"></i></span>
        ${nota ? `<p class="rp-nota">${nota}</p>` : ''}
      </div>`
    }

    // Lo importado, lote por lote: primero sus imágenes y audios; después se destila (cada cosa con sus adjuntos ya leídos).
    const importado = lotes.map((l) => {
      const mFaltan = l.medios.total - l.medios.hechos
      const dFaltan = l.destilado.total - l.destilado.hechos
      const trabajando = ahora.has('takeout') || ahora.has('importado')
      const extra = l.estado === 'subiendo' || l.estado === 'ingiriendo' ? 'Todavía está llegando desde tu compu.' : l.estado === 'historia' ? 'Ya destiló todo: está armando la historia de cada proyecto.' : ''
      return `<div class="rp-lote"><h4>🗂 ${esc(l.nombre)}${extra ? ` <small>· ${extra}</small>` : ''}</h4>
        ${l.medios.total ? paso({ icono: '🖼', titulo: 'Imágenes y audios', que: 'Describe cada imagen y transcribe cada audio (después el archivo se borra).', hechos: l.medios.hechos, total: l.medios.total, unidad: 'archivos', activo: mFaltan > 0 && ahora.has('takeout'), nota: [mFaltan ? `Faltan ${fmt(mFaltan)}` : '', eta(mFaltan, l.medios.porHora), l.medios.fallos ? `${fmt(l.medios.fallos)} no se pudieron leer` : ''].filter(Boolean).join(' · ') }) : ''}
        ${paso({ icono: '🧪', titulo: 'Destilar lo importado', que: 'Lee cada conversación o documento en su fecha: resumen, ideas, proyectos, personas, eventos.', hechos: l.destilado.hechos, total: l.destilado.total, unidad: 'piezas', activo: !mFaltan && dFaltan > 0 && trabajando, espera: mFaltan > 0, nota: mFaltan && dFaltan ? 'Empieza cuando terminen sus imágenes y audios (así cada pieza se lee con sus adjuntos).' : [dFaltan ? `Faltan ${fmt(dFaltan)}` : '', eta(dFaltan, l.destilado.porHora), l.destilado.fallos ? `${fmt(l.destilado.fallos)} fallaron` : ''].filter(Boolean).join(' · ') })}
      </div>`
    }).join('')

    // YouTube: las transcripciones que esperan (la nube no puede leer YouTube: las trae el servicio o la compu).
    const yt = d.youtube
    const ytPend = yt ? yt.cuenta.pendiente + yt.cuenta.compu : 0
    const ytPaso = ytPend ? paso({ icono: '🎬', titulo: 'Transcripciones de YouTube', que: 'Cada video que mandaste, con su transcripción; después se destila con lo importado.', hechos: yt.cuenta.listo, total: yt.cuenta.listo + ytPend, unidad: 'videos', activo: yt.trabajando || yt.compu.activa, espera: yt.cuenta.compu > 0 && !yt.compu.activa && !yt.servicio.disponible, nota: yt.cuenta.compu && !yt.compu.activa ? `${fmt(yt.cuenta.compu)} esperan tu compu: npm run mastro -- youtube ${esc(location.origin)}` : '' }) : ''
    // La frase de arriba: qué está haciendo y qué falta.
    const QUE = { pasajes: 'cortando piezas en pasajes', recuerdos: 'preparando recuerdos y quántomos para buscarlos', destilado: 'destilando tu corpus', importado: 'destilando lo importado', tarjetas: 'armando tarjetas de lo que miraste', bucles: 'juntando lo que sigue volviendo', takeout: mediosPend ? 'leyendo las imágenes y audios de lo importado' : 'destilando lo importado', sintesis: d.paso || 'escribiendo crónicas e historias' }
    const haciendo = [...new Set([...ahora].map((k) => QUE[k]).filter(Boolean))]
    const falta = [
      mediosPend ? `${fmt(mediosPend)} imágenes y audios importados` : '',
      ytPend ? `${fmt(ytPend)} videos de YouTube por transcribir${yt.cuenta.compu && !yt.compu.activa ? ' (esperan tu compu)' : ''}` : '',
      ...lotes.map((l) => (l.destilado.total - l.destilado.hechos ? `${fmt(l.destilado.total - l.destilado.hechos)} piezas de ${esc(l.nombre)} por destilar` : '')),
      d.destilado.pendientes ? `${fmt(d.destilado.pendientes)} piezas de tu corpus por destilar${d.destilado.horasQueFaltan ? ` (~${d.destilado.horasQueFaltan} h)` : ''}` : '',
      d.pasajes.total - d.pasajes.piezas > 0 ? `${fmt(d.pasajes.total - d.pasajes.piezas)} piezas sin pasajes` : '',
      d.items.faltan ? `${fmt(d.items.faltan)} recuerdos y quántomos` : '',
      d.tarjetas?.faltan ? `${fmt(d.tarjetas.faltan)} videos o links por pasar a tarjetas` : '',
    ].filter(Boolean)
    const titulo = !d.activo ? '⏸ En pausa' : d.trabajando || ahora.size ? '▶ Trabajando' : falta.length ? 'Prendido, esperando' : '✓ Al día'

    cont.innerHTML = `
      <div class="rp-resumen">
        <div class="rp-estado-grande">${titulo}</div>
        <p><b>Ahora:</b> ${haciendo.length ? haciendo.join(' · ') : d.activo ? 'nada en este momento' : 'nada (está en pausa)'}</p>
        ${falta.length ? `<p><b>Falta:</b></p><ul class="rp-falta">${falta.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p><b>Falta:</b> nada, todo está procesado.</p>'}
      </div>
      ${lotes.length || ytPend ? `<h3 class="rp-h">Lo que importaste</h3>${ytPaso}${importado}` : ''}
      <h3 class="rp-h">Tu corpus</h3>
      ${paso({ icono: '🔎', titulo: 'Pasajes', que: 'Corta cada pieza en pedazos con sentido, para encontrar cualquier cosa al buscar.', hechos: d.pasajes.piezas, total: d.pasajes.total, unidad: 'piezas', activo: ahora.has('pasajes'), nota: [`${fmt(d.pasajes.pasajes)} pasajes en total`, d.pasajes.fallos ? `${fmt(d.pasajes.fallos)} fallaron` : ''].filter(Boolean).join(' · ') })}
      ${paso({ icono: '🧪', titulo: 'Destilado', que: 'Lee cada pieza que no vino de una importación y saca resumen, temas, ideas, personas, lugares y eventos.', hechos: d.destilado.hechos, total: dTotal, unidad: 'piezas', activo: ahora.has('destilado'), nota: [d.destilado.pendientes ? `Faltan ${fmt(d.destilado.pendientes)}` : '', d.destilado.horasQueFaltan ? `~${d.destilado.horasQueFaltan} h` : '', d.destilado.fallos ? `${fmt(d.destilado.fallos)} fallaron` : ''].filter(Boolean).join(' · ') })}
      ${d.tarjetas ? paso({ icono: '🃏', titulo: 'Tarjetas de lo que miraste', que: 'De cada video, link o libro que valió la pena: 3 a 5 preguntas para recordarlo de verdad (no solo reconocerlo).', hechos: d.tarjetas.piezas, total: d.tarjetas.piezas + d.tarjetas.faltan, unidad: 'piezas', activo: ahora.has('tarjetas'), nota: d.tarjetas.hechas ? `${fmt(d.tarjetas.hechas)} tarjetas en «Lo que miraste»` : '' }) : ''}
      ${paso({ icono: '🧠', titulo: 'Recuerdos y quántomos', que: 'Los prepara para que se encuentren por significado, no solo por palabra.', hechos: d.items.hechos, total: itemsTotal, unidad: '', activo: ahora.has('recuerdos') })}
      <div class="rp-paso ${ahora.has('sintesis') ? 'ahora' : 'cola'}"><div class="rp-cab"><span class="rp-tit">📜 Crónicas e historias</span><span class="rp-estado">${ahora.has('sintesis') ? '● Ahora' : 'Al final'}</span></div>
        <p class="rp-que">${ahora.has('sintesis') ? esc(d.paso) : 'Cuando se vacía el destilado: la crónica de cada mes con material nuevo y la historia de cada proyecto.'}</p>
        ${d.cronicasFallidas ? `<p class="rp-nota">${fmt(d.cronicasFallidas)} ${d.cronicasFallidas === 1 ? 'mes no salió' : 'meses no salieron'} (3 intentos): vuelven solos cuando el mes tenga material nuevo, o con «Reintentar lo que falló».</p>` : ''}</div>
      <h3 class="rp-h">Lo que salió hasta ahora</h3>
      <div class="rp-salio">
        <div><b>${fmt(d.eventos)}</b><span>eventos con fecha en tu Línea</span></div>
        <div><b>${fmt(d.cronicas)}</b><span>crónicas de mes</span></div>
        <div><b>${fmt(d.relaciones)}</b><span>relaciones entre personas</span></div>
        <div><b>${fmt(d.items.hechos)}</b><span>recuerdos y quántomos buscables</span></div>
        ${d.tarjetas?.hechas ? `<div><b>${fmt(d.tarjetas.hechas)}</b><span>tarjetas de lo que miraste</span></div>` : ''}
        ${d.bucles?.abierto ? `<div><b>${fmt(d.bucles.abierto)}</b><span>cosas que siguen volviendo</span></div>` : ''}
        <div><b>${mill(d.tokens.hoy)}</b><span>tokens de NaN hoy · ${mill(d.tokens.total)} en total</span></div>
      </div>
      <div class="fila" style="margin-top:12px">${d.activo ? '<button class="btn" data-rp="pausar">Pausar</button>' : `<button class="btn btn-primario" data-rp="empezar" ${d.enLaNube ? '' : 'disabled title="Corre en la nube: prendelo desde tu Deprocast en la nube"'}>${d.destilado.hechos ? 'Procesar lo pendiente' : 'Procesar'}</button>`}
        ${d.destilado.fallos || d.pasajes.fallos || d.cronicasFallidas ? '<button class="btn" data-rp="reintentar">Reintentar lo que falló</button>' : ''}</div>
      ${d.enLaNube ? '' : '<p class="tenue chico">Esta es la copia de la compu: acá no se gasta nada. Se procesa desde la nube.</p>'}
      ${d.ultimos.length ? `<h3 class="rp-h">Lo último que destiló</h3>${d.ultimos.map((u) => `<div class="sq"><span><a href="#" class="ref" data-pieza="${u.id}"><b>${esc(u.titulo.slice(0, 80))}</b></a><small>${esc(u.resumen)}</small></span></div>`).join('')}` : ''}`
    $$('[data-rp]', cont).forEach((b) => (b.onclick = async () => { try { await api('/reproceso', { accion: b.dataset.rp }); pintar() } catch (e) { error(e) } }))
    $$('[data-pieza]', cont).forEach((a) => (a.onclick = (e) => { e.preventDefault(); modalPieza(Number(a.dataset.pieza)) }))
  }
  await pintar()
  const reloj = setInterval(() => { if (!$('#rp-cuerpo')) return clearInterval(reloj); pintar() }, 8000)
}
