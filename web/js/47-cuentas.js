'use strict'
// Cuentas: cada red con su modo (lectura, redacta, libre) y la cola de publicaciones

const MODO_TXT = { lectura: 'Solo lectura', redacta: 'Redacta (espera tu ok)', libre: 'Libre (publica sola)' }

async function montarCuentas() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Cuentas</h1><p>Tus redes y cómo actúa Mastropiero en cada una: <b>lectura</b> (solo lee), <b>redacta</b> (prepara y espera tu ok, nunca publica solo) o <b>libre</b> (publica sola en sus horarios, con tope por día). Todo lo publicado queda registrado.</p>
      <div class="fila"><button class="btn" id="cu-nueva">+ Cuenta</button></div></div>
    <div class="bloque" id="tg"></div>
    <div id="cu"></div>`
  $('#cu-nueva').onclick = () => modalCuenta()
  traerCuentas()
  pintarTelegram()
}

// El canal de Telegram: Mastropiero en el celular.
async function pintarTelegram() {
  const cont = $('#tg')
  if (!cont) return
  let t
  try { t = await api('/telegram') } catch (e) { return error(e) }
  const listo = t.configurado && t.chat
  cont.innerHTML = `<h3>Telegram ${listo ? (t.ultimoError ? '<span class="chip">⚠ con errores</span>' : '<span class="chip">✓ conectado</span>') : '<span class="chip">sin configurar</span>'}</h3>
    ${listo ? `<p class="tenue">Le hablás desde el celular: texto, audios, fotos, links y archivos (un chat de WhatsApp exportado, el CSV del banco). Lo que Mastropiero dice solo te llega por ahí, y cada banda de la run con botones. Comandos: /hoy /run /gasto /ingreso /nota /bitacora /buscar /criba /pregunta /voz.${t.ultimoMensaje ? ` Último mensaje tuyo: ${new Date(t.ultimoMensaje).toLocaleString('es-AR')}.` : ''}${t.ultimoError ? `<br>Último error: ${esc(t.ultimoError)}` : ''}</p>
      <div class="fila"><button class="btn btn-chico" id="tg-probar">Mandarme una prueba</button>
        <label>Responder en audio <select id="tg-voz"><option value="0">no</option><option value="1">cuando le mando audio</option><option value="siempre">siempre</option></select></label>
        <label><input type="checkbox" id="tg-bandas" ${t.bandas !== '0' ? 'checked' : ''}> avisarme cada banda de la run</label></div>`
    : `<ol class="tenue">
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
async function traerCuentas() {
  const cont = $('#cu')
  if (!cont) return
  try {
    const d = await api('/cuentas')
    cuentasDatos = d
    const pubs = (c) => d.publicaciones.filter((p) => p.cuentaId === c.id)
    const pub = (p) => `<div class="pub ${p.estado}" data-pub="${p.id}">
      <small>${esc(p.estado)}${p.programadaPara ? ` · ${new Date(p.programadaPara).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}${p.error ? ` · ${esc(p.error)}` : ''}</small>
      <p>${esc(p.texto)}</p>
      <div class="fila">${p.estado === 'borrador' ? '<button class="btn btn-chico btn-primario" data-pa="aprobar">Aprobar</button><button class="btn btn-chico" data-pa="editar">✎</button>' : ''}
        ${p.estado !== 'publicada' && p.estado !== 'descartada' ? '<button class="btn btn-chico" data-pa="copiar">Copiar</button><button class="btn btn-chico" data-pa="publicada" title="Ya la publiqué">✓ Publicada</button><button class="btn btn-chico" data-pa="descartar">✕</button>' : ''}</div></div>`
    cont.innerHTML = `${d.telegram ? '' : '<p class="hoy-nota">El canal de Telegram (hablarle a Mastropiero desde el celular, y publicar en un canal) se activa con <code>TELEGRAM_BOT_TOKEN</code> en <code>.env</code>: creá un bot con @BotFather.</p>'}
      ${d.cuentas.length ? d.cuentas.map((c) => `<section class="panel cuenta" data-cu="${c.id}">
        <div class="fila"><h3 style="margin:0">${esc(c.red)} · ${esc(c.usuario)}</h3><span class="tipo-chip">${esc(MODO_TXT[c.modo] ?? c.modo)}</span><span class="tipo-chip">${esc(d.conectores[c.conector] ?? 'manual')}</span>${c.activa ? '' : '<span class="tipo-chip">pausada</span>'}
          <span style="flex:1"></span>${c.modo !== 'lectura' ? '<input class="campo-suelto" data-cu-tema placeholder="Tema (opcional)"><button class="btn btn-chico btn-primario" data-cu-redactar>Redactar 3</button>' : ''}<button class="btn btn-chico" data-cu-editar>⚙</button></div>
        ${c.reglas?.temas ? `<p class="tenue chico">Temas: ${esc(c.reglas.temas)}${c.reglas.tono ? ` · Tono: ${esc(c.reglas.tono)}` : ''}</p>` : ''}
        <div class="pubs">${pubs(c).map(pub).join('') || '<p class="tenue chico">Nada en cola.</p>'}</div></section>`).join('')
        : '<div class="vacio"><div class="gran">◈</div><h2>Sin cuentas</h2><p>Sumá tus redes y elegí el modo de cada una.</p></div>'}`
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
          if (a === 'editar') { const t = prompt('Editar:', p.texto); if (t === null) return; await api(`/publicaciones/${p.id}`, { accion: 'editar', texto: t }) }
          else if (a === 'publicada') { const u = prompt('¿Link de la publicación? (opcional)') ?? ''; await api(`/publicaciones/${p.id}`, { accion: 'publicada', url: u || null }) }
          else await api(`/publicaciones/${p.id}`, { accion: a })
          traerCuentas()
        } catch (e) { error(e) }
      }))
    })
  } catch (e) { error(e) }
}

function modalCuenta(c = null) {
  const d = cuentasDatos
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${c ? 'Cuenta' : 'Nueva cuenta'}</h2>
    <div class="form-ing">
      <label class="campo">Red<input id="cu-red" value="${esc(c?.red ?? '')}" placeholder="Instagram, X, Telegram, WhatsApp…"></label>
      <label class="campo">Usuario<input id="cu-usuario" value="${esc(c?.usuario ?? '')}" placeholder="@…"></label>
      <label class="campo">Modo<select id="cu-modo">${(d?.modos ?? ['lectura', 'redacta', 'libre']).map((m) => `<option value="${m}" ${c?.modo === m ? 'selected' : ''}>${MODO_TXT[m]}</option>`).join('')}</select></label>
      <label class="campo">Publica por<select id="cu-conector">${Object.entries(d?.conectores ?? { manual: 'Manual' }).map(([k, v]) => `<option value="${k}" ${c?.conector === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label class="campo campo-ancho">Temas<input id="cu-temas" value="${esc(c?.reglas?.temas ?? '')}" placeholder="De qué habla esta cuenta"></label>
      <label class="campo">Tono<input id="cu-tono" value="${esc(c?.reglas?.tono ?? '')}" placeholder="irónico, cercano, técnico…"></label>
      <label class="campo">Horas (libre)<input id="cu-horas" value="${esc((c?.reglas?.horas ?? [10, 19]).join(','))}"></label>
      <label class="campo">Tope por día<input id="cu-tope" type="number" min="1" max="20" value="${esc(c?.reglas?.topeDia ?? 3)}"></label>
      <label class="campo">Chat del canal (Telegram)<input id="cu-chat" value="${esc(c?.reglas?.chatId ?? '')}" placeholder="@micanal o -100…"></label>
      <label class="campo fila" style="gap:6px"><input type="checkbox" id="cu-activa" ${c?.activa === false ? '' : 'checked'}> Activa</label>
    </div>
    <div class="fila" style="margin-top:12px"><button class="btn btn-primario" id="cu-guardar">Guardar</button></div>`)
  $('#cu-guardar').onclick = async () => {
    try {
      await api('/cuentas', {
        id: c?.id, red: $('#cu-red').value, usuario: $('#cu-usuario').value, modo: $('#cu-modo').value, conector: $('#cu-conector').value, activa: $('#cu-activa').checked,
        reglas: { temas: $('#cu-temas').value.trim() || undefined, tono: $('#cu-tono').value.trim() || undefined, horas: $('#cu-horas').value.split(',').map(Number).filter((n) => n >= 0 && n < 24), topeDia: Number($('#cu-tope').value) || 3, chatId: $('#cu-chat').value.trim() || undefined },
      })
      cerrarModal()
      traerCuentas()
    } catch (e) { error(e) }
  }
}

function refrescarCuentas() {}
