'use strict'
// El perfil (plan v35): quién sos, cuánto gasta tu Deprocast, acciones rápidas y lo que tenés conectado (Google, el
// teléfono, otras apps), todo a mano. Se entra por el pie del menú (tu nombre) o con «g y».

async function montarPerfil() {
  $('#principal').innerHTML = '<div class="perfil"><p class="tenue">Cargando tu perfil…</p></div>'
  let p
  let g = null
  let w = null
  try { [p, g, w] = await Promise.all([api('/perfil'), api('/google').catch(() => null), api('/whatsapp').catch(() => null)]) } catch (e) { return error(e) }
  const base = document.documentElement.dataset.base
  const nombre = p.nombre || 'Tu perfil'
  const hoy = p.uso.hoy
  $('#principal').innerHTML = `<div class="perfil">
    <header class="perfil-cab">
      <div class="perfil-avatar" aria-hidden="true">${esc(nombre.trim()[0]?.toUpperCase() ?? '☿')}</div>
      <div><h1>${esc(nombre)}</h1>
        <p class="tenue">${[g?.conectado && g.email ? esc(g.email) : null, base ? 'tu Deprocast' : 'el dueño de este Deprocast', p.version ? `versión ${esc(String(p.version).slice(0, 7))}` : null].filter(Boolean).join(' · ')}</p></div>
    </header>
    <div class="perfil-cuerpo"><div class="perfil-col">

    <section class="perfil-bloque"><h2>Uso</h2>
      <div class="perfil-kpis">
        <div class="perfil-kpi"><small>Hoy</small><b>${fmtTokens(hoy.total)}</b><span class="tenue">vos ${fmtTokens(hoy.mastropiero - hoy.fondo)} · agentes ${fmtTokens(hoy.liga)} · solo ${fmtTokens(hoy.fondo)}</span></div>
        <div class="perfil-kpi"><small>Este mes</small><b>${fmtTokens(p.uso.mes.tokens)}</b><span class="tenue">${p.uso.mes.llamadas.toLocaleString('es-AR')} pedidos al modelo${p.uso.mes.errores ? ` · ${p.uso.mes.errores} fallaron` : ''}</span></div>
        ${p.uso.tope ? `<div class="perfil-kpi"><small>Tu tope diario</small><b>${fmtTokens(p.uso.tope)}</b><span class="tenue">${Math.min(100, Math.round((hoy.total / p.uso.tope) * 100))}% usado hoy</span></div>` : ''}
      </div>
      ${graficoDias(p.uso.dias)}
      ${p.uso.mes.modelos.length ? `<p class="tenue chico">Modelos del mes: ${p.uso.mes.modelos.map((m) => `${esc(m.modelo)} ${fmtTokens(m.tokens)}`).join(' · ')}</p>` : ''}
    </section>

    <section class="perfil-bloque"><h2>Tu Deprocast</h2>
      <div class="perfil-numeros">${[['piezas', 'piezas en el corpus'], ['entidades', 'entidades'], ['misiones', 'misiones activas'], ['agentes', 'agentes en la liga'], ['correos', 'mails']].filter(([k]) => p.numeros[k] != null).map(([k, t]) => `<div><b>${p.numeros[k].toLocaleString('es-AR')}</b><small>${t}</small></div>`).join('')}</div>
    </section>
    </div><div class="perfil-col">

    <section class="perfil-bloque"><h2>Acciones rápidas</h2>
      <div class="perfil-acciones">
        <button class="btn" data-perfil-acc="tarea">${ico('plus')} Nueva tarea</button>
        <button class="btn" data-perfil-acc="anotar">${ico('pencil')} Anotar algo</button>
        <a class="btn" href="/vincular">${ico('link')} Vincular un teléfono</a>
        <button class="btn" data-perfil-acc="ajustes">${ico('settings')} Ajustes</button>
        <button class="btn" data-perfil-acc="exportar">${ico('arrow-up-down')} Exportar o importar todo</button>
        <button class="btn" data-perfil-acc="tema">${ico('sun-moon')} Tema</button>
        <button class="btn" data-perfil-acc="atajos">${ico('keyboard')} Atajos</button>
        ${base ? '<a class="btn" href="/cuenta">Tu cuenta (contraseña, salir)</a>' : '<a class="btn" href="/usuarios">Usuarios e invitaciones</a>'}
      </div>
    </section>

    <section class="perfil-bloque" id="perfil-apps"><h2>Apps conectadas</h2>
      <div id="perfil-google"></div>
      <div id="perfil-whatsapp"></div>
      <div class="perfil-tarjeta"><h3>📱 Teléfonos, apps y la puerta MCP</h3>
        <p class="tenue chico">La app de Deprocast en tu teléfono, Morpheon y los agentes que entran por MCP (Claude Code, Claude Desktop…), cada uno con su token.</p>
        <button class="btn" id="perfil-apps-ver">Ver y administrar</button></div>
    </section>
    </div></div>
  </div>`
  // Siempre desde arriba (la vista anterior pudo haber dejado el scroll abajo).
  $('#principal').scrollTop = 0
  window.scrollTo(0, 0)
  pintarGooglePerfil(g)
  pintarWhatsappPerfil(w)
  $('#perfil-apps-ver').onclick = () => cargarScript('59-suenos.js').then(() => modalApps())
  $$('[data-perfil-acc]').forEach((b) => (b.onclick = () => {
    const a = b.dataset.perfilAcc
    if (a === 'tarea' || a === 'anotar') return enHoy(() => accionHud(a))
    if (a === 'ajustes') return enHoy(() => modalAjustesHoy())
    if (a === 'exportar') return modalEstado()
    if (a === 'tema') return $('#btn-tema').click()
    if (a === 'atajos') return mostrarAtajos()
  }))
}

/** Los últimos 14 días: lo tuyo y lo de los agentes, apilado (SVG: el alto va en atributos, no en estilos). */
function graficoDias(dias) {
  const max = Math.max(1, ...dias.map((d) => d.suyo + d.liga))
  const ancho = 14
  const alto = 64
  const barras = dias.map((d, i) => {
    const hs = Math.round((d.suyo / max) * alto)
    const hl = Math.round((d.liga / max) * alto)
    const x = i * (ancho + 4)
    return `<g><title>${d.fecha}: vos ${fmtTokens(d.suyo)}, agentes ${fmtTokens(d.liga)}</title><rect class="perfil-barra-liga" x="${x}" y="${alto - hs - hl}" width="${ancho}" height="${hl}" rx="2"/><rect class="perfil-barra-suyo" x="${x}" y="${alto - hs}" width="${ancho}" height="${hs}" rx="2"/></g>`
  }).join('')
  return `<figure class="perfil-grafico"><svg viewBox="0 0 ${dias.length * (ancho + 4)} ${alto}" preserveAspectRatio="none" role="img" aria-label="Tokens de los últimos 14 días">${barras}</svg>
    <figcaption class="tenue chico"><span class="perfil-ref suyo"></span> vos <span class="perfil-ref liga"></span> agentes · últimos 14 días</figcaption></figure>`
}

/** Google: configurar el cliente (el JSON), conectar, ver el estado, traer lo nuevo, desconectar. */
function pintarGooglePerfil(g) {
  const cont = $('#perfil-google')
  if (!cont) return
  if (!g) { cont.innerHTML = ''; return }
  const origen = location.origin
  const paraGoogle = `<details class="perfil-ayuda"><summary>Lo que pide la pantalla de Google para publicar la app</summary>
    <p class="chico">Página principal: <code>${esc(origen)}/acerca</code><br>Política de privacidad: <code>${esc(origen)}/privacidad</code><br>Dominio autorizado: <code>${esc(location.hostname.split('.').slice(-2).join('.'))}</code><br>URI de redirección (en el cliente): <code>${esc(origen)}/google/volver</code></p></details>`
  let cuerpo
  if (!g.configurado) {
    cuerpo = `<p class="tenue chico">Pegá el JSON del cliente OAuth que bajaste de Google Cloud («Aplicación web»). Queda guardado en tu Deprocast: no hace falta reiniciar la nube.</p>
      <form id="g-cliente" class="perfil-form"><textarea name="json" rows="4" placeholder='{"web":{"client_id":"…apps.googleusercontent.com","client_secret":"…"}}' required></textarea><button class="btn btn-primario">Guardar el cliente</button></form>${paraGoogle}`
  } else if (!g.conectado) {
    cuerpo = `<p class="tenue chico">${g.error ? `${esc(g.error)} ` : ''}Conectá tu cuenta: Deprocast lee tu correo (y deja borradores, nunca envía), busca en tu Drive, lee y escribe tus planillas, y ve tu agenda, tus contactos y tus tareas.</p>
      <div class="fila"><a class="btn btn-primario" href="/google/conectar">Conectar Google</a>${g.clientePropio ? '<button class="btn btn-chico" id="g-cambiar">Cambiar el cliente</button>' : ''}</div>${paraGoogle}`
  } else {
    const m = g.gmail
    cuerpo = `<p class="chico">Conectado como <b>${esc(g.email || 'tu cuenta')}</b>${g.desde ? ` desde el ${new Date(g.desde).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}` : ''}.</p>
      ${g.faltan?.length ? `<p class="aviso chico">Deprocast necesita permisos nuevos (${g.faltan.map(esc).join(', ')}): tocá «Volver a conectar» y aceptá todo.</p>` : ''}
      <p class="tenue chico">Correo: ${m.correos.toLocaleString('es-AR')} guardados · ${m.noLeidos} sin leer · ${m.suyos} tuyos en el corpus · última pasada ${m.sincronizado ? new Date(m.sincronizado).toTimeString().slice(0, 5) : 'todavía no'}.</p>
      <div class="fila"><button class="btn btn-chico" id="g-sinc">Traer lo nuevo</button>${g.faltan?.length ? '<a class="btn btn-chico btn-primario" href="/google/conectar">Volver a conectar</a>' : ''}<button class="btn btn-chico btn-peligro" id="g-desc">Desconectar</button></div>
      <div id="perfil-drive"></div>`
  }
  cont.innerHTML = `<div class="perfil-tarjeta"><h3>🔗 Google</h3>${cuerpo}</div>`
  if (g.conectado) pintarDrivePerfil()
  const refrescar = async () => pintarGooglePerfil(await api('/google').catch(() => null))
  const form = $('#g-cliente')
  if (form) form.onsubmit = async (ev) => {
    ev.preventDefault()
    try {
      const r = await api('/google/cliente', { json: new FormData(form).get('json'), origen })
      toast(`Cliente de Google guardado${r.aviso ? `<small>${esc(r.aviso)}</small>` : '<small>Ahora tocá «Conectar Google».</small>'}`, r.aviso ? '' : 'suave')
      refrescar()
    } catch (e) { error(e) }
  }
  if ($('#g-cambiar')) $('#g-cambiar').onclick = () => { cont.querySelector('.perfil-tarjeta').insertAdjacentHTML('beforeend', `<form id="g-cliente2" class="perfil-form"><textarea name="json" rows="4" required placeholder="El JSON nuevo"></textarea><button class="btn">Guardar</button></form>`); $('#g-cliente2').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/google/cliente', { json: new FormData(ev.target).get('json'), origen }); refrescar() } catch (e) { error(e) } } }
  if ($('#g-sinc')) $('#g-sinc').onclick = async (e) => { e.target.disabled = true; try { const r = await api('/google/sincronizar', {}); toast(`Correo al día<small>${r.nuevos} nuevos</small>`, 'suave'); refrescar() } catch (x) { error(x); e.target.disabled = false } }
  if ($('#g-desc')) $('#g-desc').onclick = async () => { if (!(await confirmar('¿Desconectar Google? Deprocast deja de leer tu correo, tu Drive y tus planillas (lo ya guardado queda).', { si: 'Desconectar', peligro: true }))) return; try { await api('/google/desconectar', {}); refrescar() } catch (x) { error(x) } }
}

/** WhatsApp (plan v35): Mastropiero en WhatsApp. Se configura con lo de Meta y se vincula con un código desde tu número. */
function pintarWhatsappPerfil(w) {
  const cont = $('#perfil-whatsapp')
  if (!cont || !w) return
  const webhook = `${ORIGEN_PUBLICO}/api/whatsapp/webhook`
  const copiable = (id, valor) => `<span class="perfil-copiar"><code id="${id}">${esc(valor)}</code><button class="btn btn-chico" data-copiar-de="${id}">Copiar</button></span>`
  const formulario = (abierto) => `<details class="perfil-ayuda" ${abierto ? 'open' : ''}><summary>${w.configurado ? 'Cambiar la configuración' : 'Cómo se configura (unos 15 minutos, en Meta)'}</summary>
      <ol class="chico perfil-pasos">
        <li>En <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</a>: <b>Crear app</b> → tipo <b>Empresa</b> → agregale el producto <b>WhatsApp</b>.</li>
        <li>WhatsApp → <b>Configuración de la API</b>: anotá el <b>ID del número de teléfono</b> (el número de prueba es gratis) y agregá tu número como destinatario (te llega un código).</li>
        <li>Token permanente: en <b>Configuración del negocio → Usuarios del sistema</b>, creá uno (admin), asignale la app y la cuenta de WhatsApp, y generá un token con <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.</li>
        <li>El secreto: <b>Configuración de la app → Básica → Clave secreta de la app</b>.</li>
        <li>Pegá los tres acá y guardá. Después, en WhatsApp → <b>Configuración</b> → Webhook, poné la dirección y el token de verificación que aparecen abajo, y suscribí el campo <b>messages</b>.</li>
      </ol>
      <form id="wa-config" class="perfil-form">
        <input name="numeroId" placeholder="ID del número de teléfono" value="${esc(w.numeroId ?? '')}" required autocomplete="off">
        <input name="token" placeholder="Token de acceso permanente" required autocomplete="off">
        <input name="secreto" placeholder="Clave secreta de la app" required autocomplete="off">
        <button class="btn btn-primario">Guardar</button>
      </form></details>`
  let cuerpo
  if (!w.configurado) {
    cuerpo = `<p class="tenue chico">Le escribís a Mastropiero por WhatsApp como a cualquier contacto: texto, audios, fotos y archivos, con todas sus herramientas (tu correo, tu Drive, tu agenda). El reemplazo de Instinct.</p>${formulario(true)}`
  } else {
    const webhookInfo = `<div class="perfil-datos chico"><div>Webhook: ${copiable('wa-url', webhook)}</div><div>Token de verificación: ${copiable('wa-verif', w.verificar ?? '')}</div></div>`
    if (!w.vinculado) {
      cuerpo = `<p class="chico">Configurado. Falta vincular tu número: desde tu WhatsApp, mandale este código al número de Deprocast:</p><p class="perfil-codigo">${esc(w.codigo ?? '')}</p>
        <p class="tenue chico">Si no contesta, revisá en Meta que el webhook esté verificado y suscripto a <b>messages</b>:</p>${webhookInfo}${formulario(false)}`
    } else {
      cuerpo = `<p class="chico">Vinculado con <b>${esc(w.vinculado)}</b>${w.ultimoMensaje ? ` · tu último mensaje: ${new Date(w.ultimoMensaje).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.</p>
        <p class="tenue chico">${w.ventanaAbierta ? 'Ventana abierta: lo que Mastropiero dice solo (el matinal, un aviso) también te llega por WhatsApp.' : 'Ventana cerrada: WhatsApp solo deja que Mastropiero te escriba primero si le escribiste en las últimas 24 horas. Mandale cualquier cosa y se abre.'}</p>
        <div class="fila"><button class="btn btn-chico" id="wa-probar">Mandar una prueba</button><button class="btn btn-chico btn-peligro" id="wa-desvincular">Desvincular</button></div>${webhookInfo}${formulario(false)}`
    }
  }
  cont.innerHTML = `<div class="perfil-tarjeta"><h3>💬 WhatsApp</h3>${cuerpo}</div>`
  const refrescar = async () => pintarWhatsappPerfil(await api('/whatsapp').catch(() => null))
  $$('[data-copiar-de]', cont).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText($(`#${b.dataset.copiarDe}`).textContent); toast('Copiado', 'suave') } catch (e) { error(e) } }))
  const f = $('#wa-config')
  if (f) f.onsubmit = async (ev) => { ev.preventDefault(); try { await api('/whatsapp/config', Object.fromEntries(new FormData(f))); toast('WhatsApp configurado<small>Ahora el webhook en Meta y el código desde tu teléfono.</small>'); refrescar() } catch (e) { error(e) } }
  if ($('#wa-probar')) $('#wa-probar').onclick = async () => { try { await api('/whatsapp/probar', {}); toast('Mandada<small>Fijate tu WhatsApp.</small>', 'suave') } catch (e) { error(e) } }
  if ($('#wa-desvincular')) $('#wa-desvincular').onclick = async () => { if (!(await confirmar('¿Desvincular tu número? Mastropiero deja de atenderte por WhatsApp hasta que mandes el código nuevo.', { si: 'Desvincular', peligro: true }))) return; try { await api('/whatsapp/desvincular', {}); refrescar() } catch (e) { error(e) } }
}

/** Drive (plan v35): la carpeta Mastropiero (lo que va: audios, imágenes, archivos y conversaciones) y las carpetas de tu Drive que entran al corpus. */
async function pintarDrivePerfil() {
  const cont = $('#perfil-drive')
  if (!cont) return
  let d
  try { d = await api('/drive') } catch { return }
  const cuando = (ms) => (ms ? new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'todavía no')
  cont.innerHTML = `<div class="perfil-drive">
    <h4>📁 Tu carpeta «Mastropiero» en Drive</h4>
    ${d.puedeEscribir ? '' : '<p class="tenue chico">Para escribir en tu Drive hace falta volver a conectar Google (arriba).</p>'}
    <p class="tenue chico">Lo que mandás por el chat, Telegram, WhatsApp o el teléfono (audios con su transcripción, imágenes con lo que se ve, archivos) queda en tu Drive, no en Deprocast. Las conversaciones, un documento por día. ${d.carpeta ? `<a href="${esc(d.carpeta)}" target="_blank" rel="noopener">Abrir la carpeta</a>` : '(Se crea con lo primero que guarde.)'}</p>
    <label class="fila g-1 chico"><input type="checkbox" id="drv-medios" ${d.medios ? 'checked' : ''}> Guardar mis audios, imágenes y archivos</label>
    <label class="fila g-1 chico"><input type="checkbox" id="drv-conv" ${d.conversaciones ? 'checked' : ''}> Guardar las conversaciones</label>
    <p class="tenue chico">${d.cola.subidos} subidos${d.cola.pendientes ? ` · ${d.cola.pendientes} esperando` : ''}${d.cola.error ? ` · último problema: ${esc(d.cola.error)}` : ''}</p>
    <h4>📚 Carpetas de tu Drive en el corpus</h4>
    <p class="tenue chico">Sus documentos, planillas, presentaciones y PDF entran al corpus (Mastropiero los usa y los cita) y se actualizan cuando cambian. ${d.piezas} piezas de Drive · última pasada ${cuando(d.sincronizado)}.</p>
    ${d.corpus.length ? `<div class="perfil-carpetas">${d.corpus.map((c) => `<span class="chip">${esc(c.nombre)} <button class="btn-x" data-drv-sacar="${esc(c.id)}" title="Sacar del corpus (lo que ya entró queda)">✕</button></span>`).join('')}</div>` : ''}
    <form id="drv-buscar" class="fila"><input name="q" placeholder="Buscar una carpeta de tu Drive…" autocomplete="off"><button class="btn btn-chico">Buscar</button></form>
    <div id="drv-resultados" class="perfil-carpetas"></div>
    <div class="fila"><button class="btn btn-chico" id="drv-sinc">Sincronizar ahora</button></div>
  </div>`
  const ajustar = async (cambio) => { try { await api('/drive/ajustes', cambio); toast('Guardado', 'suave') } catch (e) { error(e) } }
  $('#drv-medios').onchange = (e) => ajustar({ medios: e.target.checked })
  $('#drv-conv').onchange = (e) => ajustar({ conversaciones: e.target.checked })
  $$('[data-drv-sacar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/drive/carpetas/${encodeURIComponent(b.dataset.drvSacar)}/sacar`, {}); pintarDrivePerfil() } catch (e) { error(e) } }))
  $('#drv-buscar').onsubmit = async (ev) => {
    ev.preventDefault()
    const q = ev.target.q.value.trim()
    if (!q) return
    try {
      const r = await api(`/drive/carpetas?q=${encodeURIComponent(q)}`)
      $('#drv-resultados').innerHTML = r.length ? r.map((c) => `<button class="btn btn-chico" data-drv-sumar="${esc(c.id)}" data-nombre="${esc(c.nombre)}">＋ ${esc(c.nombre)}</button>`).join('') : '<span class="tenue chico">No encontré carpetas con ese nombre.</span>'
      $$('[data-drv-sumar]', cont).forEach((b) => (b.onclick = async () => { try { await api('/drive/carpetas', { id: b.dataset.drvSumar, nombre: b.dataset.nombre }); toast(`«${b.dataset.nombre}» va al corpus<small>Tocá «Sincronizar ahora» o esperá la próxima pasada.</small>`, 'suave'); pintarDrivePerfil() } catch (e) { error(e) } }))
    } catch (e) { error(e) }
  }
  $('#drv-sinc').onclick = async (e) => {
    e.target.disabled = true
    e.target.textContent = 'Sincronizando…'
    try {
      const r = await api('/drive/sincronizar', {})
      toast(`Drive al día<small>${r.corpus.nuevos} documentos nuevos y ${r.corpus.actualizados} actualizados en el corpus · ${r.conversaciones} conversaciones · ${r.subidos} archivos subidos</small>`)
      pintarDrivePerfil()
    } catch (x) { error(x); e.target.disabled = false; e.target.textContent = 'Sincronizar ahora' }
  }
}
