'use strict'
// El Observatorio (plan v27): «qué se dice en cada lado» de los temas que seguís. Cada ronda busca en X, Reddit, YouTube,
// noticias y foros (solo lo público, a través de los buscadores), y el modelo resume las narrativas de cada plataforma,
// los saltos de una a otra y lo nuevo. Acá: los temas, la última ronda en columnas, los saltos, la línea de tiempo, lo
// encontrado y el grafo del debate.

const ob = { tema: null }
const fechaOb = (t) => new Date(t).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const pesoOb = (n) => '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n))

async function montarObservatorio() {
  $('#principal').innerHTML = `<div class="titulo fila"><div class="f1"><h1>Observatorio</h1><p>Qué se dice de un tema en cada lado: X, Reddit, YouTube, noticias y foros. Solo lee lo público, cada tanto, y te resume las narrativas, cómo saltan de una plataforma a otra y qué hay de nuevo.</p></div><button class="btn btn-primario" id="ob-nuevo">＋ Seguir un tema</button></div><div id="ob-cuerpo"><p class="tenue">Juntando…</p></div>`
  $('#ob-nuevo').onclick = () => modalTemaOb()
  pintarObservatorio()
}

async function pintarObservatorio() {
  let r
  try { r = await api('/observatorio') } catch (e) { return error(e) }
  const cuerpo = $('#ob-cuerpo')
  if (!cuerpo) return
  const cuotas = r.cuotas.filter((c) => c.disponible && c.id !== 'wikipedia')
  const notaCuotas = cuotas.length ? `Búsquedas este mes: ${cuotas.map((c) => `${esc(c.id)} ${c.usadas}/${c.limite}`).join(' · ')}.` : 'Sin un buscador con clave (Tavily o Brave) el Observatorio no puede mirar las redes.'
  if (!r.temas.length) {
    cuerpo.innerHTML = `<div class="vacio"><p>Todavía no seguís ningún tema. Puede ser una persona, un hashtag, un programa o un debate: cada ronda mira qué se dice en cada plataforma.</p></div><p class="chico tenue">${notaCuotas}</p>`
    return
  }
  if (!ob.tema || !r.temas.some((t) => t.id === ob.tema)) ob.tema = r.temas[0].id
  cuerpo.innerHTML = `<div class="ob-temas">${r.temas.map((t) => `<button class="chip ${t.id === ob.tema ? 'on' : ''} ${t.activo ? '' : 'apagado'}" data-ob-tema="${t.id}">${esc(t.nombre)}${t.intensivoHasta && t.intensivoHasta > Date.now() ? ' · 🔴 en vivo' : ''}</button>`).join('')}</div>
    <div id="ob-tema"><p class="tenue">Juntando…</p></div>
    <p class="chico tenue">${notaCuotas} De X se ve lo que indexan los buscadores (no hay API): no es todo lo que se dice ahí. Nunca publica ni interactúa: solo lee.</p>`
  $$('[data-ob-tema]', cuerpo).forEach((b) => (b.onclick = () => { ob.tema = Number(b.dataset.obTema); pintarObservatorio() }))
  pintarTemaOb(ob.tema)
}

async function pintarTemaOb(id) {
  let r
  try { r = await api(`/observatorio/${id}`) } catch (e) { return error(e) }
  const caja = $('#ob-tema')
  if (!caja) return
  const t = r.tema, ultima = r.rondas[0] ?? null, res = ultima?.resumen ?? null, N = r.nombres
  const enVivo = t.intensivoHasta && t.intensivoHasta > Date.now()
  const columnas = t.plataformas.map((p) => {
    const col = res?.plataformas.find((x) => x.plataforma === p)
    return `<section class="ob-col"><h4>${esc(N[p])}${col?.tono ? ` <small class="tenue">· ${esc(col.tono)}</small>` : ''}</h4>${col ? `<ul>${col.narrativas.map((n) => `<li><span class="ob-peso" title="Cuánto aparece">${pesoOb(n.peso)}</span> ${esc(n.frase)}${n.ejemplos.length ? `<br><small>${n.ejemplos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">ejemplo ${i + 1} ↗</a>`).join(' · ')}</small>` : ''}</li>`).join('')}</ul>` : '<p class="tenue chico">Nada útil en esta ronda.</p>'}</section>`
  }).join('')
  const porPlat = t.plataformas.map((p) => ({ p, xs: r.items.filter((x) => x.plataforma === p) })).filter((x) => x.xs.length)
  caja.innerHTML = `<header class="ob-cab"><div class="f1"><h2>${esc(t.nombre)}${enVivo ? ' <span class="chip ob-vivo">🔴 en vivo</span>' : ''}</h2>
      <small class="tenue">Busca: ${t.consultas.map(esc).join(' · ')} · en ${t.plataformas.map((p) => esc(N[p])).join(', ')} · cada ${t.cadaHoras} h${t.activo ? '' : ' · en pausa'}${ultima ? ` · última ronda ${fechaOb(ultima.en)}` : ''}</small></div>
      <div class="fila ob-acciones"><button class="btn btn-primario" id="ob-ronda" ${r.enRonda ? 'disabled' : ''} title="Una ronda ahora (en la nube: gasta búsquedas y tokens)">${r.enRonda ? '⏳ En ronda…' : '↻ Ronda ahora'}</button><button class="btn" id="ob-grafo" title="Los conceptos del debate y cómo se conectan">☍ El grafo del debate</button><button class="btn" id="ob-editar">✎</button><button class="btn" id="ob-pausar">${t.activo ? '⏸' : '▶'}</button></div></header>
    ${t.aviso ? `<p class="ob-aviso chico">⚠ ${esc(t.aviso)}</p>` : ''}
    ${res ? `<p class="ob-resumen">${esc(res.resumen)}</p>
      <div class="ob-columnas">${columnas}</div>
      ${res.saltos.length ? `<section class="seccion"><h3>Saltos entre plataformas</h3><ul class="ob-saltos">${res.saltos.map((s) => `<li><b>${esc(N[s.de])} → ${esc(N[s.a])}</b> ${esc(s.idea)}${s.evidencia.length ? ` <small>${s.evidencia.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1} ↗</a>`).join(' ')}</small>` : ''}</li>`).join('')}</ul></section>` : ''}
      ${res.nuevo.length ? `<section class="seccion"><h3>Lo nuevo</h3><ul>${res.nuevo.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}`
    : `<p class="tenue">${ultima ? 'La última ronda no trajo nada para resumir.' : 'Todavía no hubo ninguna ronda: la primera corre sola en la nube (o con «Ronda ahora»).'}</p>`}
    ${r.rondas.length > 1 ? `<section class="seccion"><h3>Cómo viene</h3><ol class="ob-linea">${r.rondas.map((x) => `<li><small class="tenue">${fechaOb(x.en)} · ${x.nuevos} nuevo${x.nuevos === 1 ? '' : 's'}</small> ${esc(x.resumen?.resumen ?? '—')}</li>`).join('')}</ol></section>` : ''}
    ${porPlat.length ? `<section class="seccion"><h3>Lo encontrado (${r.items.length})</h3>${porPlat.map(({ p, xs }) => `<details class="ob-items"><summary>${esc(N[p])} <small class="tenue">${xs.length}</small></summary><ul>${xs.slice(0, 60).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.titulo || x.url)}</a>${x.extracto ? `<br><small class="tenue">${esc(x.extracto.slice(0, 220))}</small>` : ''}</li>`).join('')}</ul></details>`).join('')}</section>` : ''}`
  $('#ob-ronda').onclick = async () => {
    const b = $('#ob-ronda'); b.disabled = true; b.textContent = '⏳ En ronda…'
    try { await api(`/observatorio/${t.id}/ronda`, {}); toast('Ronda hecha', 'suave') } catch (e) { error(e) }
    pintarTemaOb(t.id)
  }
  $('#ob-grafo').onclick = () => abrirGrafoDe({ tipo: 'observatorio', id: t.id }, `${t.nombre} (Observatorio)`)
  $('#ob-editar').onclick = () => modalTemaOb(t)
  $('#ob-pausar').onclick = async () => { try { await api(`/observatorio/${t.id}`, { activo: !t.activo }); pintarObservatorio() } catch (e) { error(e) } }
}

function modalTemaOb(t = null) {
  const PL = [['x', 'X'], ['reddit', 'Reddit'], ['youtube', 'YouTube'], ['noticias', 'Noticias'], ['foros', 'Foros']]
  const sel = new Set(t?.plataformas ?? PL.map(([k]) => k))
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${t ? 'Ajustar el tema' : 'Seguir un tema'}</h2>
    <label class="campo">El tema<input id="obm-nombre" value="${esc(t?.nombre ?? '')}" placeholder="Una persona, un hashtag, un programa, un debate"></label>
    <label class="campo">Qué buscar <small class="tenue">(una búsqueda por línea, hasta 5: rotan de a una por ronda)</small><textarea id="obm-consultas" rows="4" placeholder="Si lo dejás vacío, busca el nombre del tema">${esc((t?.consultas ?? []).join('\n'))}</textarea></label>
    <div class="campo">Dónde<div class="fila ob-plataformas">${PL.map(([k, n]) => `<label class="chico"><input type="checkbox" value="${k}" ${sel.has(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div></div>
    <label class="campo">Cada cuántas horas<input id="obm-cada" type="number" min="1" max="168" value="${t?.cadaHoras ?? 12}"></label>
    <p class="chico tenue">Cada ronda usa una búsqueda por plataforma (los buscadores tienen cuota mensual). Solo lee lo público: nunca publica ni interactúa.</p>
    <div class="fila"><button class="btn btn-primario" id="obm-ok">${t ? 'Guardar' : 'Seguirlo'}</button>${t ? '<button class="btn" id="obm-borrar">Dejar de seguirlo</button>' : ''}</div>`)
  const datos = () => ({ nombre: $('#obm-nombre').value, consultas: $('#obm-consultas').value.split('\n').map((x) => x.trim()).filter(Boolean), plataformas: $$('.ob-plataformas input:checked').map((i) => i.value), cadaHoras: Number($('#obm-cada').value) || 12 })
  $('#obm-ok').onclick = async () => {
    try { const x = t ? await api(`/observatorio/${t.id}`, datos()) : await api('/observatorio', datos()); ob.tema = x?.id ?? ob.tema; cerrarModal(); pintarObservatorio() } catch (e) { error(e) }
  }
  const borrar = $('#obm-borrar')
  if (borrar) borrar.onclick = async () => { try { await api(`/observatorio/${t.id}`, { borrar: true }); ob.tema = null; cerrarModal(); pintarObservatorio() } catch (e) { error(e) } }
}
