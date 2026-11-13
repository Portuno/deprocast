'use strict'
// La Fragua: propuestas de mejora → cambio en su propia rama, con tests → él lo lee y decide si se aplica.

const ESTADO_FORJA = {
  haciendo: ['forjando', 'vivo'], lista: ['pasa los tests', 'ok'], rota: ['no pasa los tests', 'mal'], fallo: ['no salió', 'mal'],
  aplicada: ['aplicada', 'ok'], descartada: ['descartada', ''], revertida: ['revertida', 'mal'],
}
let fraguaEspera = null
/** La categoría que se está mirando (Fragua #258): null = la que tiene más urgentes; «todas» = sin filtro. */
let frArea = null

function montarFragua() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>La Fragua</h1><p>Donde Mastropiero mejora su propio código sin tocar lo que está andando. Cada mejora se escribe en una copia aparte, se compila y se prueba entera (todo lo que toca del servidor trae su test); vos leés el cambio y decidís. Nada entra solo.</p></div>
    <div class="pasos"><span><b>1</b>Propuesta o pedido</span><span><b>2</b>Elige archivos y arma un plan</span><span><b>3</b>Escribe en una rama aparte</span><span><b>4</b>Typecheck y tests (si falla, se corrige hasta 2 veces)</span><span><b>5</b>Vos lo aplicás y reiniciás el servidor</span></div>
    <form class="seccion" id="fr-pedir">
      <h3>Pedir una mejora</h3>
      <textarea name="pedido" rows="2" placeholder="Qué querés que cambie, con el detalle que tengas («que en la Criba la tecla d también descarte»). O forjá una de las propuestas de abajo." class="w-full"></textarea>
      <div class="fila mt-2"><span class="tenue" style="flex:1;font-size:12.5px">Mejor si es algo concreto y chico: un cambio por forja.</span><button class="btn btn-primario">⚒ Forjar</button></div>
    </form>
    <div id="fr-cuerpo"></div>
    <div id="fr-errores"></div>`
  $('#fr-pedir').onsubmit = async (e) => {
    e.preventDefault()
    const p = e.target.pedido.value.trim()
    if (!p) return
    try { await api('/fragua', { pedido: p }); e.target.reset(); toast('A la fragua<small>Tarda unos minutos; te aviso en Hoy.</small>'); refrescarFragua() } catch (err) { error(err) }
  }
  refrescarFragua()
  pintarErrores()
}

// Los errores, legibles (Fragua #216): uno por huella, con cuántas veces, qué se intentaba, qué pasó en llano y qué hacer.
let erroresHoras = 24
async function pintarErrores() {
  const cont = $('#fr-errores')
  if (!cont) return
  let r
  try { r = await api(`/errores?horas=${erroresHoras}`) } catch (e) { return error(e) }
  const fecha = (ms) => new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  cont.innerHTML = `<section class="seccion">
    <div class="seccion-cab"><h3>Errores · ${r.grupos.length}</h3><span class="tenue">Uno por huella (el mismo fallo repetido va una vez, con su cuenta). Los 🐞 son bugs de Deprocast; los demás, cortes o de otros servicios.</span>
      <span class="espacio"></span>
      <select class="campo-suelto" id="fr-err-horas">${[[24, '24 h'], [168, '7 días'], [720, '30 días']].map(([h, t]) => `<option value="${h}" ${h === erroresHoras ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn btn-chico" id="fr-err-md" title="Copia todo como Markdown y lo baja como archivo">Exportar a Markdown</button></div>
    ${r.grupos.length ? `<div class="fr-errores">${r.grupos.map((g) => `<details class="fr-error ${g.bug ? 'bug' : ''}" data-huella="${esc(g.huella ?? '')}">
      <summary><span class="chip">${g.bug ? '🐞 bug' : esc(g.codigo)}</span> <b>${esc(g.origen)}</b> <span class="tenue">×${g.veces} · ${fecha(g.ultima)}</span><br><span class="chico">${esc(g.mensaje.slice(0, 160))}</span></summary>
      <p class="chico"><b>En llano:</b> ${esc(g.llano)}</p>
      <p class="chico"><b>Qué hacer:</b> ${esc(g.accion)}</p>
      <p class="chico tenue">Huella <code>${esc(g.huella ?? '—')}</code> · ${g.bug ? 'bug, no reintentable' : g.reintentable ? 'reintentable' : 'no reintentable'}${g.ajeno ? ' · de otro servicio' : ''}${g.recuperado ? ' · se recuperó solo' : ''}${g.primera ? ` · desde ${fecha(g.primera)}` : ''}</p>
      ${g.entrada ? `<pre class="fr-diff">${esc(g.entrada)}</pre>` : ''}
      ${g.huella && !g.ajeno ? '<div class="fila"><button class="btn btn-chico" data-err-fragua>⚒ A La Fragua</button></div>' : ''}
    </details>`).join('')}</div>` : '<p class="vacio">Sin errores en este período.</p>'}
  </section>`
  $('#fr-err-horas').onchange = (e) => { erroresHoras = Number(e.target.value); pintarErrores() }
  $('#fr-err-md').onclick = async () => {
    try {
      const { markdown } = await api(`/errores/md?horas=${erroresHoras}`)
      try { await navigator.clipboard.writeText(markdown) } catch { /* sin portapapeles: igual se baja */ }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
      a.download = `errores-${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      toast('Errores exportados<small>Copiados y bajados como .md</small>', 'suave')
    } catch (e) { error(e) }
  }
  $$('[data-err-fragua]', cont).forEach((b) => (b.onclick = async () => {
    const h = b.closest('[data-huella]').dataset.huella
    try { const x = await api(`/errores/${h}/fragua`, {}); toast(x.sumada ? `Sumado a la #${x.propuestaId}<small>Ya había una con la misma causa.</small>` : `Propuesta #${x.propuestaId}`, 'suave'); refrescarFragua() } catch (e) { error(e) }
  }))
}

async function refrescarFragua() {
  const cont = $('#fr-cuerpo')
  if (!cont) return
  let d
  try { d = await api('/fragua') } catch (e) { return error(e) }
  const haciendo = d.forjas.some((f) => f.estado === 'haciendo')
  const fecha = (ms) => new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const tk = d.token ?? {}
  const vencido = !!tk.vencido
  // Las agrupadas por causa (Fragua #208) se muestran dentro de su grupo, no sueltas.
  const grupos = d.grupos ?? []
  const enGrupo = new Set(grupos.flatMap((g) => g.ids))
  const porId = new Map(d.propuestas.map((p) => [p.id, p]))
  const area = frArea ?? d.inicial ?? 'todas'
  const sueltas = d.propuestas.filter((p) => !enGrupo.has(p.id) && (area === 'todas' || p.area === area))
  const chipsArea = (d.areas ?? []).length ? `<div class="chips fr-areas">${d.areas.map((a) => `<button class="chip ${a.id === area ? 'on' : ''}" data-fr-area="${a.id}" title="${esc(a.cubre)}">${esc(a.nombre)} <small>${a.abiertas}${a.altas ? ` · ${a.altas} alta${a.altas === 1 ? '' : 's'}` : ''}</small></button>`).join('')}<button class="chip ${area === 'todas' ? 'on' : ''}" data-fr-area="todas">Todas <small>${d.propuestas.length}</small></button></div>` : ''
  // Dónde está lo forjado de cada una (Fragua #209): en rama, aplicada en la nube, descartada… y si lleva una semana esperando.
  const lineaForja = (f) => f ? `<p class="tenue chico fr-estado">⚒ Forja #${f.id}: ${esc(f.texto)}${f.archivos ? ` · ${f.archivos} archivos` : ''}${f.viejo ? ` · <b class="fr-viejo">hace ${f.dias} días sin aplicar</b>` : ''} <button class="btn btn-chico" data-ver="${f.id}">Ver</button>${f.enlace ? ` <a href="${esc(f.enlace)}" target="_blank" rel="noopener">diff ↗</a>` : ''}</p>` : ''
  const tarjeta = (p) => `
        <article class="tarjeta" data-prop="${p.id}">
          <div class="tarjeta-cab">#${p.id}<button class="chip" data-fr-cambiar-area title="Cambiar de categoría (queda registro de la anterior)">${esc((d.areas ?? []).find((a) => a.id === p.area)?.nombre ?? p.area ?? 'sin categoría')}</button>${p.prioridad ? `<span class="estado-chip ${p.prioridad === 'alta' ? 'vivo' : ''}">${esc(p.prioridad)}</span>` : ''}${p.origen === 'bloqueos' ? '<span class="chip" title="La armó sola el vigía de bloqueos">vigía</span>' : ''}</div>
          <h4>${esc(p.titulo)}</h4>
          ${lineaForja(p.forja)}
          ${p.nota ? `<p class="tenue chico">◐ ${esc(p.nota)}</p>` : ''}
          ${p.enCola ? `<p class="tenue chico">⏳ En cola desde ${fecha(p.enCola)}: se forja sola cuando vuelva el token. <button class="btn btn-chico" data-sacar-cola>Sacar de la cola</button></p>` : ''}
          ${p.detalle ? `<p class="recorte" title="Tocá para ver todo">${esc(p.detalle)}</p>` : ''}
          <div class="tarjeta-pie">${d.noSePuede ? '<button class="btn btn-chico btn-primario" data-copiar title="Copia la propuesta como pedido, para pegarla en Claude Code">Copiar para Claude Code</button>' : `<button class="btn btn-chico btn-primario" data-forjar ${haciendo && !vencido ? 'disabled title="Hay una forja en curso"' : tk.aviso ? `title="${esc(tk.aviso)}"` : ''}>${vencido ? '⏳ A la cola' : '⚒ Forjar'}</button>`}<span class="espacio"></span><button class="btn btn-chico" data-mover title="No es de Deprocast: pasala a un encargo, una idea o un proyecto">Mover a…</button><button class="btn btn-chico" data-hecha title="Ya se resolvió por otro lado: queda como forjada">✓ Ya está</button><button class="btn btn-chico" data-descartar title="Descartar la propuesta">Descartar</button></div>
        </article>`
  const cierre = (c) => c.cerradaPor === 'commit' && c.cierre
    ? `<span class="chip" title="Cerrada sola porque el commit la nombra">por commit</span> ${c.cierre.url ? `<a href="${esc(c.cierre.url)}" target="_blank" rel="noopener"><code>${esc(c.cierre.sha.slice(0, 7))}</code> ↗</a>` : `<code>${esc(c.cierre.sha.slice(0, 7))}</code>`} <small class="tenue">${esc(c.cierre.autor)} · ${esc(String(c.cierre.fecha).slice(0, 10))}</small>`
    : c.cerradaPor === 'grupo' ? `<span class="chip">cubierta por #${c.cubiertaPor}</span>`
    : c.cerradaPor === 'forja' ? '<span class="chip">por su forja</span>' : '<span class="chip">a mano</span>'
  cont.innerHTML = `${d.noSePuede ? `<p class="aviso">${esc(d.noSePuede)}</p>` : ''}
    ${tk.aviso ? `<div class="aviso"><b>⚠ ${esc(tk.aviso)}</b>${tk.enCola ? ` · ${tk.enCola} en cola` : ''}${tk.pasos ? `<details><summary class="tenue">Cómo renovarlo</summary><p class="chico">${esc(tk.pasos)}</p></details>` : ''}</div>` : ''}
    ${grupos.length ? `<section class="seccion">
      <div class="seccion-cab"><h3>Misma causa · ${grupos.length} ${grupos.length === 1 ? 'grupo' : 'grupos'}</h3><span class="tenue">Propuestas que son el mismo problema con otro nombre: se arreglan una vez. Forjar el grupo escribe el arreglo común; al aplicarse, las otras quedan cubiertas.</span></div>
      ${grupos.map((g) => `<div class="fr-grupo" data-grupo="${g.ids.join(',')}" data-principal="${g.principal}">
        <div class="fila"><b>${esc(g.nombre)}</b><span class="tenue chico">${g.ids.map((x) => `#${x}`).join(' · ')}</span><span class="espacio"></span>${d.noSePuede ? '' : `<button class="btn btn-chico btn-primario" data-forjar-grupo ${haciendo && !vencido ? 'disabled' : ''}>⚒ Forjar el grupo</button>`}<button class="btn btn-chico" data-cubrir title="El arreglo común ya está: cierra las otras como cubiertas por #${g.principal}">Cubrir con #${g.principal}</button></div>
        <div class="tarjetas">${g.ids.map((x) => porId.get(x)).filter(Boolean).map(tarjeta).join('')}</div>
      </div>`).join('')}
    </section>` : ''}
    <section class="seccion">
      ${chipsArea}
      <div class="seccion-cab"><h3>Propuestas abiertas · ${area === 'todas' ? d.propuestas.length : `${sueltas.length} de ${d.propuestas.length}`}</h3><span class="tenue">Las deja Mastropiero cuando ve algo para mejorar (o se las pedís en el chat). Forjar una la convierte en un cambio para revisar. Un commit que dice «Fragua #N» la cierra sola.</span></div>
      ${sueltas.length ? `<div class="tarjetas">${sueltas.map(tarjeta).join('')}</div>` : d.propuestas.length ? '<p class="tenue">Nada abierto en esta categoría.</p>' : '<p class="vacio">No hay propuestas abiertas. Pedí una mejora arriba o contale al chat qué cambiarías.</p>'}
    </section>
    ${(d.cerradas ?? []).length ? `<section class="seccion"><details>
      <summary><h3 class="en-linea">Cerradas en las últimas dos semanas · ${d.cerradas.length}</h3> <span class="tenue">las que cerró un commit se pueden reabrir</span></summary>
      ${d.cerradas.map((c) => `<div class="forja-fila" data-cerrada="${c.id}">
        <span class="num">#${c.id}</span>
        <span class="que"><b title="${esc(c.titulo)}">${esc(c.titulo)}</b><small>${c.estado === 'descartada' ? 'descartada · ' : ''}${fecha(c.resueltaEn)}</small></span>
        <span>${cierre(c)}</span>
        ${c.cerradaPor === 'commit' || c.cerradaPor === 'grupo' ? '<button class="btn btn-chico" data-reabrir title="No era el commit que correspondía: vuelve a abierta">Reabrir</button>' : '<span></span>'}
      </div>`).join('')}
    </details></section>` : ''}
    <section class="seccion">
      <div class="seccion-cab"><h3>Forjas</h3><span class="tenue">${d.rama ? `Se aplican sobre la rama <code>${esc(d.rama)}</code>.` : ''}</span></div>
      ${d.forjas.map((f) => {
        const [txt, clase] = ESTADO_FORJA[f.estado] ?? [f.estado, '']
        const titulo = (f.pedido || '').split('\n')[0]
        return `<div class="forja-fila">
          <span class="num">#${f.id}</span>
          <span class="que"><b title="${esc(titulo)}">${esc(titulo)}</b><small>${fecha(f.creadaEn)}${f.real ? ` · ${esc(f.real.texto)}${f.real.viejo ? ` · <b>hace ${f.real.dias} días sin aplicar</b>` : ''}` : ''}${f.archivos?.length ? ` · ${f.archivos.map(esc).join(', ')}` : ''}${f.paso ? ` · <span class="pensando">${esc(f.paso)}…</span>` : ''}</small></span>
          <span class="estado-chip ${clase}">${txt}</span>
          ${['lista', 'rota', 'fallo', 'aplicada', 'revertida'].includes(f.estado) ? `<button class="btn btn-chico" data-ver="${f.id}">Ver</button>` : '<span></span>'}
        </div>`
      }).join('') || '<p class="vacio">Nada forjado todavía.</p>'}
    </section>`
  $$('[data-fr-area]', cont).forEach((b) => (b.onclick = () => { frArea = b.dataset.frArea; refrescarFragua() }))
  $$('[data-prop]', cont).forEach((el) => {
    const id = Number(el.dataset.prop)
    const copiar = $('[data-copiar]', el)
    if (copiar) copiar.onclick = async () => {
      const p = d.propuestas.find((x) => x.id === id)
      try { await navigator.clipboard.writeText(`Propuesta #${p.id} de La Fragua de Deprocast${p.area ? ` (${p.area})` : ''}: ${p.titulo}

${p.detalle ?? ''}

Revisá si sigue vigente en el código, implementala con tests y marcala hecha.`); toast(`#${id} copiada<small>Pegala en Claude Code.</small>`, 'suave') } catch (e) { error(e) }
    }
    const forjar = $('[data-forjar]', el)
    if (forjar) forjar.onclick = async () => {
      try {
        const r = await api('/fragua', { propuestaId: id })
        toast(r.encolada ? `#${id} en cola<small>Se forja sola cuando vuelva el token.</small>` : 'A la fragua<small>Te aviso en Hoy cuando termine.</small>')
        refrescarFragua()
      } catch (e) { error(e) }
    }
    const cambiar = $('[data-fr-cambiar-area]', el)
    if (cambiar) cambiar.onclick = () => {
      abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>#${id} · ¿En qué categoría va?</h2><p class="tenue">Queda registro de la anterior.</p><div class="fr-areas-elegir">${(d.areas ?? []).map((a) => `<button class="btn" data-a="${a.id}"><b>${esc(a.nombre)}</b><small class="tenue">${esc(a.cubre)}</small></button>`).join('')}</div>`)
      $$('#modal [data-a]').forEach((b) => (b.onclick = async () => { try { await api(`/propuestas/${id}/area`, { area: b.dataset.a }); cerrarModal(); refrescarFragua() } catch (e) { error(e) } }))
    }
    const sacar = $('[data-sacar-cola]', el)
    if (sacar) sacar.onclick = async () => { try { await api(`/propuestas/${id}/cola`, {}); refrescarFragua() } catch (e) { error(e) } }
    $('[data-descartar]', el).onclick = async () => { try { await api(`/propuestas/${id}`, { estado: 'descartada' }); refrescarFragua() } catch (e) { error(e) } }
    $('[data-mover]', el).onclick = async () => {
      // No es de Deprocast (plan v38): a un encargo (Para delegar), una idea o una nota de un proyecto.
      const a = await preguntar('¿A dónde va? Escribí «encargo», «idea» o el nombre de un proyecto', 'encargo', { ok: 'Mover' })
      if (a == null || !a.trim()) return
      const v = a.trim().toLowerCase()
      const cuerpo = v === 'encargo' || v === 'idea' ? { a: v } : { a: 'proyecto', proyecto: a.trim() }
      try { const r = await api(`/propuestas/${id}/mover`, cuerpo); toast(`#${id} movida<small>${esc(r.destino)}</small>`, 'suave'); refrescarFragua() } catch (e) { error(e) }
    }
    $('[data-hecha]', el).onclick = async () => { try { await api(`/propuestas/${id}`, { estado: 'hecha' }); toast(`#${id} forjada`, 'suave'); refrescarFragua() } catch (e) { error(e) } }
    const det = $('.recorte', el)
    if (det) det.onclick = () => det.classList.toggle('abierto')
  })
  $$('[data-ver]', cont).forEach((b) => (b.onclick = () => verForja(Number(b.dataset.ver), d.rama)))
  $$('[data-grupo]', cont).forEach((g) => {
    const ids = g.dataset.grupo.split(',').map(Number)
    const principal = Number(g.dataset.principal)
    const forjarG = $('[data-forjar-grupo]', g)
    if (forjarG) forjarG.onclick = async () => {
      try { const r = await api('/fragua', { propuestaId: principal, grupo: ids }); toast(r.encolada ? 'En cola<small>Se forja sola cuando vuelva el token.</small>' : `El grupo a la fragua<small>Un arreglo para ${ids.length} propuestas.</small>`); refrescarFragua() } catch (e) { error(e) }
    }
    $('[data-cubrir]', g).onclick = async () => {
      if (!(await confirmar(`¿Cerrar ${ids.length - 1} como cubiertas por #${principal}?`, { detalle: 'Queda el rastro de cuál las absorbió; se pueden reabrir.', si: 'Cubrir' }))) return
      try { await api('/propuestas/cubrir', { principal, ids }); toast(`Cubiertas por #${principal}`, 'suave'); refrescarFragua() } catch (e) { error(e) }
    }
  })
  $$('[data-cerrada]', cont).forEach((fila) => {
    const b = $('[data-reabrir]', fila)
    if (b) b.onclick = async () => { try { await api(`/propuestas/${fila.dataset.cerrada}/reabrir`, {}); toast(`#${fila.dataset.cerrada} reabierta`, 'suave'); refrescarFragua() } catch (e) { error(e) } }
  })
  clearTimeout(fraguaEspera)
  if (haciendo) fraguaEspera = setTimeout(() => cuandoSeVea(() => { if (vista === 'fragua') refrescarFragua() }), 5000)
}

function pintarDiff(diff) {
  return esc(diff ?? '').split('\n').map((l) => l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') ? `<span class="arch">${l}</span>` : l.startsWith('+') ? `<span class="mas">${l}</span>` : l.startsWith('-') ? `<span class="menos">${l}</span>` : l).join('\n')
}

async function verForja(id, rama) {
  let f
  try { f = await api(`/fragua/${id}`) } catch (e) { return error(e) }
  const [txt, clase] = ESTADO_FORJA[f.estado] ?? [f.estado, '']
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Forja #${f.id} <span class="estado-chip ${clase}">${txt}</span></h2>
    <p class="tenue">${esc(f.pedido.split('\n')[0])}</p>
    ${f.resumen ? `<div class="seccion"><h3>Plan y resumen</h3><div class="md">${esc(f.resumen).replace(/\n/g, '<br>')}</div></div>` : ''}
    ${f.archivos.length ? `<p class="tenue">Toca: ${f.archivos.map((a) => `<code>${esc(a)}</code>`).join(' ')} · ${f.modo === 'pr' ? 'copia en la nube' : `rama <code>${esc(f.rama)}</code>`}</p>` : ''}
    ${f.prUrl ? `<p><a href="${esc(f.prUrl)}" target="_blank" rel="noopener">Pull request #${f.prNumero} en GitHub ↗</a></p>` : ''}
    ${f.diff ? `<div class="fr-diff">${pintarDiff(f.diff)}</div>` : ''}
    ${f.salida ? `<details ${f.estado !== 'lista' ? 'open' : ''}><summary class="tenue">Salida de la verificación</summary><pre class="fr-diff">${esc(f.salida)}</pre></details>` : ''}
    <div class="fila mt-3">${f.estado === 'lista' ? `<button class="btn btn-primario" id="fr-aplicar">${f.modo === 'pr' ? 'Aprobar (mergea el pull request)' : `Aplicar a ${esc(rama ?? 'la rama actual')}`}</button>` : ''}${['lista', 'rota', 'fallo'].includes(f.estado) ? '<button class="btn" id="fr-descartar">Descartar</button>' : ''}${f.estado === 'aplicada' && f.mergeSha ? '<button class="btn btn-peligro" id="fr-revertir">Revertir</button>' : ''}</div>`)
  if ($('#fr-aplicar')) $('#fr-aplicar').onclick = async () => {
    const nube = f.modo === 'pr'
    if (!(await confirmar(nube ? '¿Aprobar este cambio?' : `¿Aplicar este cambio al código (rama ${rama ?? 'actual'})?`, { detalle: nube ? 'Se mergea en GitHub y la nube se actualiza sola en unos minutos. Si la versión nueva no levanta, la revierto sola.' : 'Después hay que reiniciar el servidor.', si: nube ? 'Aprobar' : 'Aplicar el cambio' }))) return
    try { await api(`/fragua/${id}/aplicar`, {}); cerrarModal(); toast(nube ? 'Aprobada<small>La nube se actualiza sola en unos minutos.</small>' : 'Aplicada<small>Reiniciá el servidor para que corra lo nuevo.</small>'); refrescarFragua() } catch (e) { error(e) }
  }
  if ($('#fr-revertir')) $('#fr-revertir').onclick = async () => {
    if (!(await confirmar('¿Revertir este cambio en main?', { detalle: 'Vuelve el código de antes; la nube se actualiza sola.', si: 'Revertir', peligro: true }))) return
    try { await api(`/fragua/${id}/revertir`, {}); cerrarModal(); toast('Revertida', 'suave'); refrescarFragua() } catch (e) { error(e) }
  }
  if ($('#fr-descartar')) $('#fr-descartar').onclick = async () => { try { await api(`/fragua/${id}/descartar`, {}); cerrarModal(); refrescarFragua() } catch (e) { error(e) } }
}
