'use strict'
// Sueños: lo que soñaste (por Telegram, a mano o desde Morpheon), lo que Mastropiero leyó de cada uno, los símbolos que
// vuelven, quién aparece y las emociones por semana. Y las apps conectadas (el token para Morpheon y las que vengan).

const FUENTE_SUENO = { corporal: '🫀 corporal', mental: '🧠 mental', emocional: '💗 emocional', transpersonal: '✴ transpersonal' }

async function montarSuenos() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Sueños</h1><p>Contalos al despertar: por Telegram (/sueno, o un audio que empiece con «soñé…»), acá, o desde Morpheon. Mastropiero los lee (escenas, personas, símbolos, emociones y de qué fuente parecen venir) y los cruza con tu día anterior. No son oráculos: son material tuyo.</p>
      <div class="fila"><button class="btn btn-primario" id="sn-nuevo">🌙 Anotar un sueño</button><button class="btn" id="sn-apps">🔌 Conectar Morpheon</button></div></div>
    <div id="sn-cuerpo"></div>`
  $('#sn-nuevo').onclick = modalSueno
  $('#sn-apps').onclick = modalApps
  await pintarSuenos()
}

async function pintarSuenos() {
  const cont = $('#sn-cuerpo')
  if (!cont) return
  let d
  try { d = await api('/suenos') } catch (e) { return error(e) }
  if (!d.total) {
    cont.innerHTML = '<div class="vacio"><div class="gran">🌙</div><h2>Todavía no anotaste sueños</h2><p>Lo mejor: apenas te despertás, un audio de un minuto por Telegram que empiece con «soñé…».</p><button class="btn btn-primario" data-paso-hacer="sueno">Anotar un sueño</button></div>'
    return
  }
  const maxSem = Math.max(1, ...d.semanas.map((s) => s.suenos))
  cont.innerHTML = `
    <div class="sn-resumen">
      <div><b>${d.total}</b><span>sueños</span></div><div><b>${d.lucidos}</b><span>lúcidos</span></div>
      ${d.fuentes.map((f) => `<div><b>${f.n}</b><span>${esc(FUENTE_SUENO[f.k] ?? f.k)}</span></div>`).join('')}
      ${d.pendientes ? `<div><b>${d.pendientes}</b><span>sin leer todavía</span></div>` : ''}
    </div>
    <div class="sn-grilla">
      <section class="panel"><h3>Símbolos que vuelven</h3>${d.simbolos.length ? `<div class="chips">${d.simbolos.map((s) => `<span class="chip" title="En ${s.n} sueños">${esc(s.k)} <b>${s.n}</b></span>`).join('')}</div>` : '<p class="tenue chico">Cuando un símbolo aparezca en dos sueños, va a estar acá.</p>'}</section>
      <section class="panel"><h3>Quién aparece</h3>${d.personas.length ? `<div class="chips">${d.personas.map((p) => `<span class="chip">${esc(p.k)} <b>${p.n}</b></span>`).join('')}</div>` : '<p class="tenue chico">Nadie todavía.</p>'}</section>
      <section class="panel sn-semanas"><h3>Emociones por semana</h3>${d.semanas.map((s) => `<div class="sn-sem"><small>${esc(s.desde.slice(8, 10))}/${esc(s.desde.slice(5, 7))}</small><i style="width:${Math.round((s.suenos / maxSem) * 100)}%"></i><span>${s.emociones.map((e) => esc(e.e)).join(' · ') || (s.suenos ? '—' : '')}</span></div>`).join('')}</section>
    </div>
    <h3 class="sub">Los últimos</h3>
    ${d.suenos.map((s) => `<details class="sn-sueno"><summary><b>${esc(s.destilado?.titulo ?? s.texto.slice(0, 60))}</b><small class="tenue">${esc(s.fecha)}${s.despertar ? ` · ${esc(s.despertar)}` : ''}${(s.destilado?.lucido ?? s.lucido) ? ' · ✦ lúcido' : ''}${s.destilado?.fuente ? ` · ${esc(FUENTE_SUENO[s.destilado.fuente] ?? s.destilado.fuente)}` : ''}${s.origen.startsWith('app:') ? ` · desde ${esc(s.origen.slice(4))}` : ''}</small></summary>
      <p class="sn-texto">${esc(s.texto)}</p>
      ${s.destilado ? `${s.destilado.escenas.length ? `<ol class="sn-escenas">${s.destilado.escenas.map((e) => `<li>${esc(e)}</li>`).join('')}</ol>` : ''}
        <p class="tenue chico">${[s.destilado.simbolos.length ? `Símbolos: ${s.destilado.simbolos.map(esc).join(', ')}` : '', s.destilado.personas.length ? `Personas: ${s.destilado.personas.map(esc).join(', ')}` : '', s.destilado.emociones.length ? `Emociones: ${s.destilado.emociones.map(esc).join(', ')}` : ''].filter(Boolean).join(' · ')}</p>
        ${s.destilado.por_que_fuente ? `<p class="chico">${esc(s.destilado.por_que_fuente)}</p>` : ''}
        ${s.destilado.cruce ? `<p class="sn-cruce">↔ ${esc(s.destilado.cruce)}</p>` : ''}`
        : `<p class="tenue chico">${s.estado === 'fallo' ? 'No se pudo leer.' : 'Todavía sin leer: el Procesar lo lee en la nube.'}</p>`}
    </details>`).join('')}`
}

function modalSueno() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🌙 Un sueño</h2>
    <form id="sn-form">
      <label class="campo">Contalo como te acuerdes<textarea name="texto" rows="6" required autofocus></textarea></label>
      <div class="fila"><label class="campo">Día en que te despertaste<input name="fecha" type="date" value="${hoyISO()}"></label>
        <label class="campo">Hora<input name="despertar" type="time"></label>
        <label class="campo">Emociones (separadas por coma)<input name="emociones" placeholder="miedo, alivio"></label></div>
      <label class="fila" style="gap:6px;margin-top:8px"><input type="checkbox" name="lucido"> Me di cuenta de que soñaba (lúcido)</label>
      <button class="btn btn-primario mt-3">Guardar</button>
    </form>`)
  $('#sn-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { await api('/suenos', { texto: f.texto, fecha: f.fecha || null, despertar: f.despertar || null, emociones: f.emociones || null, lucido: f.lucido ? true : null }); cerrarModal(); toast('🌙 Guardado', 'suave'); pintarSuenos() } catch (e) { error(e) }
  }
}

// ─── apps conectadas ────────────────────────────────────────────────────

async function modalApps() {
  let d
  try { d = await api('/apps-conectadas') } catch (e) { return error(e) }
  const fecha = (ms) => (ms ? new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : 'nunca')
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>🔌 Apps conectadas</h2>
    <p class="tenue">Otras apps tuyas que le hablan a Deprocast (Morpheon manda tus sueños). Cada una con su token: se ve una sola vez al crearla y se puede revocar. El contrato para pegar en la app está en <code>docs/apps/morpheon.md</code>.</p>
    <p class="tenue chico">Con el permiso <b>leer</b>, la app entra por la puerta MCP (<code>${esc(location.origin)}/mcp</code>): Claude Code, Claude Desktop u otro agente tuyo leen tu archivo, tu grafo, tu Observatorio, tus misiones y tu día. Solo lectura: ${d.mcp.herramientas.length} herramientas, nada que escriba o publique.</p>
    ${d.apps.length ? d.apps.map((a) => `<div class="fila app-fila ${a.revocadaEn ? 'revocada' : ''}"><b>${esc(a.nombre)}</b><code>${esc(a.prefijo)}…</code><small class="tenue">${a.permisos.join(', ')} · ${a.usos} usos · último ${fecha(a.ultimaVez)}${a.revocadaEn ? ' · revocada' : ''}</small>${a.revocadaEn ? '' : `<button class="btn btn-chico btn-peligro" data-app-revocar="${a.id}">Revocar</button>`}</div>`).join('') : '<p class="tenue chico">Ninguna todavía.</p>'}
    <form id="app-form" class="seccion"><h3 class="sub">Una app nueva</h3>
      <div class="fila"><label class="campo">Nombre<input name="nombre" value="${d.apps.some((a) => a.nombre === 'Morpheon' && !a.revocadaEn) ? '' : 'Morpheon'}" required></label>
        ${d.permisos.map((p) => `<label class="fila g-1"><input type="checkbox" name="permisos" value="${p}" ${p === 'suenos' ? 'checked' : ''}> ${p}</label>`).join('')}</div>
      <button class="btn btn-primario">Crear y ver el token</button>
    </form>
    <div id="app-token"></div>
    ${d.mcp.llamadas.length ? `<details class="seccion"><summary class="sub">Lo último que pidieron por MCP</summary>${d.mcp.llamadas.map((l) => `<div class="fila app-fila"><b>${esc(l.app)}</b><code>${esc(l.herramienta)}</code><small class="tenue">${l.ok ? '' : 'falló · '}${l.ms} ms · ${new Date(l.en).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')}</details>` : ''}`)
  $$('[data-app-revocar]').forEach((b) => (b.onclick = async () => { try { await api(`/apps-conectadas/${b.dataset.appRevocar}/revocar`, {}); modalApps() } catch (e) { error(e) } }))
  $('#app-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = new FormData(ev.target)
    try {
      const r = await api('/apps-conectadas', { nombre: f.get('nombre'), permisos: f.getAll('permisos') })
      $('#app-form').hidden = true
      $('#app-token').innerHTML = `<div class="app-token"><p><b>Token de ${esc(r.app.nombre)}</b> — copialo ahora: no se vuelve a mostrar.</p>
        <div class="fila"><code id="app-token-txt">${esc(r.token)}</code><button class="btn btn-chico" id="app-copiar">Copiar</button></div>
        ${r.app.permisos.includes('leer') ? `<p class="tenue chico">Para Claude Code:</p><div class="fila"><code id="app-mcp-txt">${esc(`claude mcp add --transport http deprocast ${location.origin}/mcp --header "Authorization: Bearer ${r.token}"`)}</code><button class="btn btn-chico" id="app-mcp-copiar">Copiar</button></div><p class="tenue chico">En otro cliente MCP: la URL <code>${esc(location.origin)}/mcp</code> (HTTP) con el encabezado <code>Authorization: Bearer &lt;token&gt;</code>.</p>` : ''}
        ${r.app.permisos.some((p) => p !== 'leer') ? `<p class="tenue chico">En la app: <code>POST ${esc(location.origin)}/api/apps/${r.app.permisos.includes('suenos') ? 'suenos' : 'eventos'}</code> con <code>Authorization: Bearer &lt;token&gt;</code>.</p>` : ''}</div>`
      if ($('#app-mcp-copiar')) $('#app-mcp-copiar').onclick = async () => { try { await navigator.clipboard.writeText($('#app-mcp-txt').textContent); toast('Copiado', 'suave') } catch { toast('Seleccionalo y copialo a mano', 'suave') } }
      $('#app-copiar').onclick = async () => { try { await navigator.clipboard.writeText(r.token); toast('Copiado', 'suave') } catch { toast('Seleccionalo y copialo a mano', 'suave') } }
    } catch (e) { error(e) }
  }
}
