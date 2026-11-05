'use strict'
// El perfil (plan v35): quién sos, cuánto gasta tu Deprocast, acciones rápidas y lo que tenés conectado (Google, el
// teléfono, otras apps), todo a mano. Se entra por el pie del menú (tu nombre) o con «g y».

async function montarPerfil() {
  $('#principal').innerHTML = '<div class="perfil"><p class="tenue">Cargando tu perfil…</p></div>'
  let p
  let g = null
  try { [p, g] = await Promise.all([api('/perfil'), api('/google').catch(() => null)]) } catch (e) { return error(e) }
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
      <p class="tenue chico">Correo: ${m.correos.toLocaleString('es-AR')} guardados · ${m.noLeidos} sin leer · ${m.suyos} tuyos en el corpus · última pasada ${m.sincronizado ? new Date(m.sincronizado).toTimeString().slice(0, 5) : 'todavía no'}.${g.alcances.some((a) => a.includes('spreadsheets')) ? '' : ' <b>Volvé a conectar para sumar Google Sheets.</b>'}</p>
      <div class="fila"><button class="btn btn-chico" id="g-sinc">Traer lo nuevo</button>${g.alcances.some((a) => a.includes('spreadsheets')) ? '' : '<a class="btn btn-chico" href="/google/conectar">Volver a conectar</a>'}<button class="btn btn-chico btn-peligro" id="g-desc">Desconectar</button></div>`
  }
  cont.innerHTML = `<div class="perfil-tarjeta"><h3>🔗 Google</h3>${cuerpo}</div>`
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
