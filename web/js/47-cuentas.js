'use strict'
// Cuentas: varias agentes por red, con contexto en Markdown y cupos de comentarios o piezas.

const MODO_TXT = { lectura: 'Solo lectura', redacta: 'Redacta (espera tu ok)', libre: 'Libre (publica sola)' }

async function montarCuentas() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Cuentas</h1>
      <p>Varios agentes por red. Cada uno tiene usuario, correo y un contexto en Markdown. <b>lectura</b> solo lee, <b>redacta</b> espera tu ok y <b>libre</b> publica sola, sin pasarse de los cupos.</p></div>
      <div class="fila"><button class="btn" id="cu-nueva">+ Agente</button></div></div>
    <div class="panel tg-panel" id="tg"></div>
    <div class="redes" id="cu"></div>`
  $('#cu-nueva').onclick = () => modalCuenta()
  traerCuentas()
  pintarTelegram()
}

// El canal de Telegram: Mastropiero en el celular. Va en su panel, no en la grilla de Hoy.
async function pintarTelegram() {
  const cont = $('#tg')
  if (!cont) return
  let t
  try { t = await api('/telegram') } catch (e) { return error(e) }
  const listo = t.configurado && t.chat
  cont.innerHTML = `<h3>Telegram ${listo ? (t.ultimoError ? '<span class="chip">⚠ con errores</span>' : '<span class="chip">✓ conectado</span>') : '<span class="chip">sin configurar</span>'}</h3>
    ${listo ? `<p>Le hablás desde el celular: texto, audios, fotos, links y archivos (un chat de WhatsApp exportado, el CSV del banco). Lo que Mastropiero dice solo te llega por ahí, y cada banda de la run con botones. Comandos: /hoy /run /gasto /ingreso /nota /bitacora /buscar /criba /pregunta /voz.${t.ultimoMensaje ? ` Último mensaje tuyo: ${new Date(t.ultimoMensaje).toLocaleString('es-AR')}.` : ''}${t.ultimoError ? `<br>Último error: ${esc(t.ultimoError)}` : ''}</p>
      <div class="fila"><button class="btn btn-chico" id="tg-probar">Mandarme una prueba</button>
        <label>Responder en audio <select id="tg-voz"><option value="0">no</option><option value="1">cuando le mando audio</option><option value="siempre">siempre</option></select></label>
        <label><input type="checkbox" id="tg-bandas" ${t.bandas !== '0' ? 'checked' : ''}> avisarme cada banda de la run</label></div>`
    : `<ol>
        <li>En Telegram, hablale a <b>@BotFather</b> → <code>/newbot</code> → elegí nombre y usuario. Te da un token.</li>
        <li>Pegalo en el <code>.env</code> de Mastropiero: <code>TELEGRAM_BOT_TOKEN=…</code> y reiniciá el servidor.</li>
        <li>Escribile cualquier cosa a tu bot: te contesta con tu número de chat. Ponelo en <code>.env</code> como <code>TELEGRAM_CHAT_ID=…</code> y reiniciá de nuevo.</li>
        <li>Volvé acá y tocá «Mandarme una prueba». Solo te va a atender a vos.</li>
      </ol>${t.configurado ? '<p>Ya tiene el token: falta el <code>TELEGRAM_CHAT_ID</code> (paso 3).</p>' : ''}`}`
  if (!listo) return
  $('#tg-voz').value = t.voz ?? '0'
  $('#tg-voz').onchange = (e) => api('/telegram', { voz: e.target.value }).catch(error)
  $('#tg-bandas').onchange = (e) => api('/telegram', { bandas: e.target.checked }).catch(error)
  $('#tg-probar').onclick = async () => { try { await api('/telegram/probar', {}); toast('Mandado<small>Fijate en Telegram.</small>') } catch (e) { error(e) } }
}

let cuentasDatos = null

function deLaRed(c, r) {
  return c.red === r.id || String(c.red).toLowerCase() === r.nombre.toLowerCase()
}

async function traerCuentas() {
  const cont = $('#cu')
  if (!cont) return
  try {
    const d = await api('/cuentas')
    cuentasDatos = d
    const pubs = (c) => d.publicaciones.filter((p) => p.cuentaId === c.id)
    const pub = (p) => `<div class="pub ${p.estado}" data-pub="${p.id}">
      <small>${esc(p.tipo ? `${p.tipo} · ` : '')}${esc(p.estado)}${p.programadaPara ? ` · ${new Date(p.programadaPara).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}${p.error ? ` · ${esc(p.error)}` : ''}</small>
      <p>${esc(p.texto)}</p>
      <div class="fila">${p.estado === 'borrador' ? '<button class="btn btn-chico btn-primario" data-pa="aprobar">Aprobar</button><button class="btn btn-chico" data-pa="editar">✎</button>' : ''}
        ${p.estado !== 'publicada' && p.estado !== 'descartada' ? '<button class="btn btn-chico" data-pa="copiar">Copiar</button><button class="btn btn-chico" data-pa="publicada" title="Ya la publiqué">✓ Publicada</button><button class="btn btn-chico" data-pa="descartar">✕</button>' : ''}</div></div>`
    const tarjeta = (c) => `<article class="red-agente" data-cu="${c.id}">
      <div class="fila"><h4>${esc(c.nombre || c.usuario)}</h4><span class="tipo-chip">${esc(MODO_TXT[c.modo] ?? c.modo)}</span>${c.contexto ? '<span class="tipo-chip">.md</span>' : ''}${c.activa ? '' : '<span class="tipo-chip">pausada</span>'}</div>
      <p class="tenue chico">${esc(c.usuario)}${c.correo ? ` · ${esc(c.correo)}` : ''}</p>
      ${(c.cupos ?? []).length ? `<div class="cupos">${c.cupos.map((x) => `<span class="cupo">${esc(x.tipo)} ${x.cantidad}</span>`).join('')}</div>` : ''}
      <div class="fila">${c.modo !== 'lectura' ? '<input class="campo-suelto" data-cu-tema placeholder="Tema (opcional)"><button class="btn btn-chico btn-primario" data-cu-redactar>Redactar</button>' : ''}<button class="btn btn-chico" data-cu-editar>Editar</button></div>
      ${pubs(c).length ? `<div class="pubs">${pubs(c).map(pub).join('')}</div>` : ''}</article>`
    const redes = d.redes ?? []
    const otras = d.cuentas.filter((c) => !redes.some((r) => deLaRed(c, r)))
    cont.innerHTML = `${redes.map((r) => {
      const ag = d.cuentas.filter((c) => deLaRed(c, r))
      return `<section class="red-red"><div class="fila"><h3>${esc(r.nombre)}</h3><span class="tipo-chip">${r.oficio === 'creador' ? 'creador' : 'operador'}</span><span style="flex:1"></span><button class="btn btn-chico" data-red="${esc(r.id)}">+</button></div>
        ${ag.map(tarjeta).join('') || '<p class="tenue chico">Ningún agente.</p>'}</section>`
    }).join('')}${otras.length ? `<section class="red-red"><h3>Otras</h3>${otras.map(tarjeta).join('')}</section>` : ''}`
    $$('[data-red]', cont).forEach((b) => (b.onclick = () => modalCuenta(null, b.dataset.red)))
    $$('[data-cu]', cont).forEach((el) => {
      const c = d.cuentas.find((x) => x.id === Number(el.dataset.cu))
      $('[data-cu-editar]', el).onclick = () => modalCuenta(c)
      const r = $('[data-cu-redactar]', el)
      if (r) r.onclick = () => trabajando(r, 'Redactando…', async () => { await api(`/cuentas/${c.id}/redactar`, { n: 3, tema: $('[data-cu-tema]', el).value.trim() || null }); traerCuentas() })
    })
    $$('[data-pub]', cont).forEach((el) => {
      const p = d.publicaciones.find((x) => x.id === Number(el.dataset.pub))
      $$('[data-pa]', el).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.pa
        try {
          if (a === 'copiar') { await navigator.clipboard.writeText(p.texto); return toast('Copiada', 'suave') }
          if (a === 'editar') { const t = await preguntar('Editar:', p.texto, { ok: 'Guardar', largo: true }); if (t === null) return; await api(`/publicaciones/${p.id}`, { accion: 'editar', texto: t }) }
          else if (a === 'publicada') { const u = await preguntar('¿Link de la publicación? (opcional)', '', { ok: 'Marcar publicada', tipo: 'url' }); if (u === null) return; await api(`/publicaciones/${p.id}`, { accion: 'publicada', url: u || null }) }
          else await api(`/publicaciones/${p.id}`, { accion: a })
          traerCuentas()
        } catch (e) { error(e) }
      }))
    })
  } catch (e) { error(e) }
}

function cuposDe(oficio) {
  const d = cuentasDatos?.cuposDefecto ?? {}
  return (d[oficio] ?? d.operador ?? []).map((x) => ({ ...x }))
}

function htmlCupos(cupos) {
  return cupos.map((x) => `<div class="cu-cupo">
    <input class="campo-suelto" data-tipo value="${esc(x.tipo)}" placeholder="tipo">
    <input class="campo-suelto" data-cant type="number" min="1" max="50" value="${esc(x.cantidad)}">
    <select data-clase><option value="comentario" ${x.clase === 'pieza' ? '' : 'selected'}>comentario</option><option value="pieza" ${x.clase === 'pieza' ? 'selected' : ''}>pieza</option></select>
    <button type="button" class="btn btn-chico" data-quitar>✕</button></div>`).join('')
}

function leerCupos() {
  return $$('#cu-cupos .cu-cupo').map((el) => ({
    tipo: $('[data-tipo]', el).value.trim(),
    cantidad: Number($('[data-cant]', el).value),
    clase: $('[data-clase]', el).value,
  })).filter((x) => x.tipo && x.cantidad > 0)
}

async function modalCuenta(c = null, redId = null) {
  let full = c
  if (c?.id) {
    try { full = await api(`/cuentas/${c.id}`) } catch (e) { return error(e) }
  }
  const redes = cuentasDatos?.redes ?? []
  const redActual = full?.red ?? redId ?? redes[0]?.id ?? ''
  const conocida = redes.some((r) => r.id === redActual)
  const cat = redes.find((r) => r.id === redActual || r.nombre.toLowerCase() === String(redActual).toLowerCase())
  const cupos = full?.cupos?.length ? full.cupos : cuposDe(cat?.oficio ?? 'operador')
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${full?.id ? 'Agente' : 'Nuevo agente'}</h2>
    <p class="tenue chico">El Markdown es la voz y el contexto de este agente. Las contraseñas de las redes no se guardan acá.</p>
    <div class="form-ing">
      <label class="campo">Red<select id="cu-red">${redes.map((r) => `<option value="${esc(r.id)}" ${redActual === r.id || String(redActual).toLowerCase() === r.nombre.toLowerCase() ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}${!conocida && redActual ? `<option value="${esc(redActual)}" selected>${esc(redActual)}</option>` : ''}</select></label>
      <label class="campo">Nombre<input id="cu-nombre" value="${esc(full?.nombre ?? '')}" placeholder="Cómo lo ves en la grilla"></label>
      <label class="campo">Usuario<input id="cu-usuario" value="${esc(full?.usuario ?? '')}" placeholder="@usuario"></label>
      <label class="campo">Correo<input id="cu-correo" value="${esc(full?.correo ?? '')}" placeholder="correo@…"></label>
      <label class="campo">Modo<select id="cu-modo">${(cuentasDatos?.modos ?? ['lectura', 'redacta', 'libre']).map((m) => `<option value="${m}" ${(full?.modo ?? 'redacta') === m ? 'selected' : ''}>${MODO_TXT[m]}</option>`).join('')}</select></label>
      <label class="campo">Publica por<select id="cu-conector">${Object.entries(cuentasDatos?.conectores ?? { manual: 'Manual' }).map(([k, v]) => `<option value="${k}" ${full?.conector === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label class="campo fila" style="gap:6px"><input type="checkbox" id="cu-activa" ${full?.activa === false ? '' : 'checked'}> Activa</label>
      <label class="campo campo-ancho">Temas<input id="cu-temas" value="${esc(full?.reglas?.temas ?? '')}" placeholder="De qué habla este agente"></label>
      <label class="campo">Tono<input id="cu-tono" value="${esc(full?.reglas?.tono ?? '')}" placeholder="irónico, cercano, técnico…"></label>
      <label class="campo">Horas (libre)<input id="cu-horas" value="${esc((full?.reglas?.horas ?? [10, 19]).join(','))}"></label>
      <label class="campo">Chat del canal (Telegram)<input id="cu-chat" value="${esc(full?.reglas?.chatId ?? '')}" placeholder="@micanal o -100…"></label>
      <div class="campo campo-ancho"><span>Tipos y cantidades</span><div class="cu-cupos" id="cu-cupos">${htmlCupos(cupos)}</div>
        <button type="button" class="btn btn-chico" id="cu-sumar" style="margin-top:6px">+ tipo</button></div>
      <label class="campo campo-ancho">Contexto (.md)<textarea id="cu-md" class="cu-md" placeholder="# Voz&#10;De qué habla, qué no dice, a quién le contesta.">${esc(full?.markdown ?? '')}</textarea></label>
    </div>
    <div class="fila" style="margin-top:12px"><button class="btn btn-primario" id="cu-guardar">Guardar</button></div>`)
  const engancharQuitar = () => $$('#cu-cupos [data-quitar]').forEach((b) => (b.onclick = () => b.closest('.cu-cupo').remove()))
  engancharQuitar()
  $('#cu-sumar').onclick = () => {
    $('#cu-cupos').insertAdjacentHTML('beforeend', htmlCupos([{ tipo: '', cantidad: 1, clase: 'comentario' }]))
    engancharQuitar()
  }
  if (!full?.id) {
    $('#cu-red').onchange = () => {
      const r = redes.find((x) => x.id === $('#cu-red').value)
      $('#cu-cupos').innerHTML = htmlCupos(cuposDe(r?.oficio ?? 'operador'))
      engancharQuitar()
    }
  }
  $('#cu-guardar').onclick = async () => {
    try {
      const red = $('#cu-red').value
      const catRed = redes.find((r) => r.id === red)
      await api('/cuentas', {
        id: full?.id, red, nombre: $('#cu-nombre').value.trim() || null, usuario: $('#cu-usuario').value, correo: $('#cu-correo').value.trim() || null,
        modo: $('#cu-modo').value, conector: $('#cu-conector').value, activa: $('#cu-activa').checked,
        oficio: catRed?.oficio ?? full?.oficio ?? null, cupos: leerCupos(), markdown: $('#cu-md').value,
        reglas: { temas: $('#cu-temas').value.trim() || undefined, tono: $('#cu-tono').value.trim() || undefined, horas: $('#cu-horas').value.split(',').map(Number).filter((n) => n >= 0 && n < 24), chatId: $('#cu-chat').value.trim() || undefined },
      })
      cerrarModal()
      traerCuentas()
    } catch (e) { error(e) }
  }
}

function refrescarCuentas() {}
