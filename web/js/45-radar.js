'use strict'
// Radar: oportunidades que la liga encuentra afuera, con por qué te sirven y un borrador en tu voz

const TIPO_OPOR = { comunidad: '◍', evento: '◷', convocatoria: '✉', beca: '✦', premio: '★', contacto: '◐', medio: '▤', otro: '·' }
let radarFirma = ''

async function montarRadar() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Radar</h1><p>Lo que la liga encuentra afuera para tus metas: comunidades donde está tu gente, eventos, convocatorias, becas, medios, contactos. Cada una con por qué te sirve y, si querés, un borrador en tu voz. Nada se manda solo.</p></div>
    <div class="panel radar-buscar">
      <div class="fila">
        <input class="campo-suelto" id="rd-texto" placeholder="¿Qué busco? «gente que juegue juegos de mesa políticos», «festivales de cortos en Valencia»… (vacío: según tus metas)">
        <select class="campo-suelto" id="rd-mision"><option value="">Para mis metas en general</option></select>
        <button class="btn btn-primario" id="rd-buscar">Salir a buscar</button>
      </div>
      <p class="tenue chico" id="rd-cuotas"></p>
    </div>
    <div id="rd-lista"></div>`
  $('#rd-buscar').onclick = () => trabajando($('#rd-buscar'), 'Buscando…', async () => {
    const r = await api('/radar/buscar', { texto: $('#rd-texto').value.trim() || null, misionId: $('#rd-mision').value || null })
    toast(`${r.nuevas.length} oportunidad${r.nuevas.length === 1 ? '' : 'es'} nueva${r.nuevas.length === 1 ? '' : 's'}${r.aviso ? `<small>${esc(r.aviso)}</small>` : ''}`, r.nuevas.length ? '' : 'suave')
    traerRadar()
  })
  $('#rd-texto').onkeydown = (e) => e.key === 'Enter' && $('#rd-buscar').click()
  traerRadar()
}

async function traerRadar() {
  const cont = $('#rd-lista')
  if (!cont) return
  try {
    const d = await api('/radar')
    const sel = $('#rd-mision')
    if (sel && sel.options.length === 1) sel.innerHTML += d.primarias.map((p) => `<option value="${p.id}">Para «${esc(p.titulo)}»</option>`).join('')
    $('#rd-cuotas').innerHTML = d.conBuscador
      ? `Buscadores este mes: ${d.cuotas.filter((c) => c.disponible).map((c) => `${c.id} ${c.usadas}/${c.limite}`).join(' · ')}`
      : 'Sin clave de buscador solo consulto Wikipedia. Para encontrar comunidades y gente, cargá <code>TAVILY_API_KEY</code> (gratis en tavily.com) en <code>.env</code> y reiniciá.'
    const grupos = [['me_interesa', 'Te interesan'], ['nueva', 'Nuevas'], ['hecha', 'Hechas']]
    cont.innerHTML = d.oportunidades.length ? grupos.map(([e, n]) => {
      const xs = d.oportunidades.filter((o) => o.estado === e)
      return xs.length ? `<h3 class="sub">${n} · ${xs.length}</h3><div class="opor-grid">${xs.map(oporHTML).join('')}</div>` : ''
    }).join('') : '<div class="vacio"><div class="gran">◍</div><h2>El radar todavía no salió</h2><p>Buscá algo arriba, sumale un ayudante <b>explorador</b> a una primaria, o esperá a la rutina (lunes y jueves a la mañana).</p></div>'
    $$('[data-op]', cont).forEach((card) => {
      const id = card.dataset.op
      $$('[data-op-estado]', card).forEach((b) => (b.onclick = async () => { try { await api(`/radar/${id}`, { estado: b.dataset.opEstado }); traerRadar() } catch (e) { error(e) } }))
      const br = $('[data-op-borrador]', card)
      if (br) br.onclick = () => trabajando(br, 'Redactando…', async () => { await api(`/radar/${id}/borrador`, {}); traerRadar() })
      const cp = $('[data-op-copiar]', card)
      if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(card.querySelector('.borrador pre').textContent); toast('Copiado', 'suave') } catch { toast('No pude copiar: seleccionalo a mano', 'error') } }
    })
  } catch (e) { error(e) }
}

function oporHTML(o) {
  return `<div class="opor ${o.estado}" data-op="${o.id}">
    <div class="p-top"><span class="tipo-chip">${TIPO_OPOR[o.tipo] ?? '·'} ${esc(o.tipo)}</span>${o.cierre ? `<span class="tipo-chip cierre">cierra ${esc(o.cierre)}</span>` : ''}</div>
    <h3>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.titulo)}</a>` : esc(o.titulo)}</h3>
    ${o.descripcion ? `<p>${esc(o.descripcion)}</p>` : ''}
    ${o.porQue ? `<p class="porque">${esc(o.porQue)}</p>` : ''}
    ${o.borrador ? `<details class="borrador" open><summary>Borrador en tu voz</summary><pre>${esc(o.borrador)}</pre><button class="btn btn-chico" data-op-copiar>Copiar</button></details>` : ''}
    <div class="fila p-acc">
      ${o.borrador ? '<button class="btn btn-chico" data-op-borrador>Rehacer borrador</button>' : '<button class="btn btn-chico btn-primario" data-op-borrador>Armame el borrador</button>'}
      ${o.estado === 'nueva' ? '<button class="btn btn-chico" data-op-estado="me_interesa">Me interesa</button>' : ''}
      ${o.estado !== 'hecha' ? '<button class="btn btn-chico" data-op-estado="hecha" title="Ya lo hice">✓</button>' : ''}
      <button class="btn btn-chico" data-op-estado="descartada" title="No va">✕</button>
    </div>
  </div>`
}

function refrescarRadar() {
  const f = JSON.stringify(E.hoy?.aviso ?? null)
  if (f !== radarFirma) { radarFirma = f; traerRadar() }
}
