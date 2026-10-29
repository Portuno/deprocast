'use strict'
// El Observatorio (plan v27): «qué se dice en cada lado» de los temas que seguís. Cada ronda busca en X, Reddit, YouTube,
// noticias y foros (solo lo público, a través de los buscadores), y el modelo resume las narrativas de cada plataforma,
// los saltos de una a otra y lo nuevo. Acá: los temas, la última ronda en columnas, los saltos, la línea de tiempo, lo
// encontrado y el grafo del debate.

const ob = { tema: null }
const fechaOb = (t) => new Date(t).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const enVivoOb = (t) => !!t.intensivoHasta && t.intensivoHasta > Date.now() && (t.intensivoDesde ?? 0) <= Date.now()
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
  cuerpo.innerHTML = `<div class="ob-temas">${r.temas.map((t) => `<button class="chip ${t.id === ob.tema ? 'on' : ''} ${t.activo ? '' : 'apagado'}" data-ob-tema="${t.id}">${esc(t.nombre)}${enVivoOb(t) ? ' · 🔴 en vivo' : ''}</button>`).join('')}</div>
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
  const vivo = enVivoOb(t)
  // Cada columna muestra lo ÚLTIMO que se sabe de esa plataforma: la narrativa de la ronda más reciente que trajo algo
  // de ahí (con su fecha si no es la última) y los últimos items encontrados. Antes, si la última ronda no traía nada de
  // una plataforma, la columna quedaba vacía aunque abajo hubiera de todo.
  const columnas = t.plataformas.map((p) => {
    const conCol = r.rondas.find((x) => x.resumen?.plataformas.some((c) => c.plataforma === p))
    const col = conCol?.resumen.plataformas.find((x) => x.plataforma === p)
    const vieja = conCol && conCol !== ultima
    const ultimos = r.items.filter((x) => x.plataforma === p).sort((a, b) => b.en - a.en).slice(0, 3)
    return `<section class="ob-col"><h4>${esc(N[p])}${col?.tono ? ` <small class="tenue">· ${esc(col.tono)}</small>` : ''}</h4>
      ${col ? `${vieja ? `<small class="tenue">de la ronda del ${fechaOb(conCol.en)}</small>` : ''}<ul>${col.narrativas.map((n) => `<li><span class="ob-peso" title="Cuánto aparece">${pesoOb(n.peso)}</span> ${esc(n.frase)}${n.ejemplos.length ? `<br><small>${n.ejemplos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">ejemplo ${i + 1} ↗</a>`).join(' · ')}</small>` : ''}</li>`).join('')}</ul>` : ''}
      ${ultimos.length ? `<div class="ob-ultimos"><small class="hud-etq">Lo último encontrado</small><ul>${ultimos.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.titulo || x.url)}</a> <small class="tenue">${fechaOb(x.en)}</small></li>`).join('')}</ul></div>` : ''}
      ${!col && !ultimos.length ? '<p class="tenue chico">Todavía nada de acá.</p>' : ''}</section>`
  }).join('')
  const porPlat = t.plataformas.map((p) => ({ p, xs: r.items.filter((x) => x.plataforma === p) })).filter((x) => x.xs.length)
  caja.innerHTML = `<header class="ob-cab"><div class="f1"><h2>${esc(t.nombre)}${vivo ? ' <span class="chip ob-vivo">🔴 en vivo</span>' : ''}</h2>
      <small class="tenue">Busca: ${t.consultas.map(esc).join(' · ')} · en ${t.plataformas.map((p) => esc(N[p])).join(', ')} · cada ${t.cadaHoras} h${t.activo ? '' : ' · en pausa'}${ultima ? ` · última ronda ${fechaOb(ultima.en)}` : ''}</small></div>
      <div class="fila ob-acciones"><button class="btn btn-primario" id="ob-ronda" ${r.enRonda ? 'disabled' : ''} title="Una ronda ahora (en la nube: gasta búsquedas y tokens)">${r.enRonda ? '⏳ En ronda…' : '↻ Ronda ahora'}</button><button class="btn" id="ob-grafo" title="Los conceptos del debate y cómo se conectan">☍ El grafo del debate</button><button class="btn" id="ob-editar">✎</button><button class="btn" id="ob-pausar">${t.activo ? '⏸' : '▶'}</button></div></header>
    ${t.aviso ? `<p class="ob-aviso chico">⚠ ${esc(t.aviso)}</p>` : ''}
    ${res ? '' : `<p class="tenue">${ultima ? 'La última ronda no trajo nada nuevo para resumir: abajo, lo último que se sabe de cada lado.' : 'Todavía no hubo ninguna ronda: la primera corre sola en la nube (o con «Ronda ahora»).'}</p>`}
    ${r.items.length || res ? `<div class="ob-columnas">${columnas}</div>` : ''}
    ${res ? `<p class="ob-resumen">${esc(res.resumen)}</p>
      ${res.saltos.length ? `<section class="seccion"><h3>Saltos entre plataformas</h3><ul class="ob-saltos">${res.saltos.map((s) => `<li><b>${esc(N[s.de])} → ${esc(N[s.a])}</b> ${esc(s.idea)}${s.evidencia.length ? ` <small>${s.evidencia.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1} ↗</a>`).join(' ')}</small>` : ''}</li>`).join('')}</ul></section>` : ''}
      ${res.nuevo.length ? `<section class="seccion"><h3>Lo nuevo</h3><ul>${res.nuevo.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}`
    : ''}
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

// ─── campañas con tu gente ──────────────────────────────────────────────
// Una iniciativa tuya alrededor de un momento: el hashtag (con su chequeo), las piezas para tus cuentas antes, durante
// y después (en borrador: nada sale sin tu ok), la invitación para tu gente, el calendario y el Observatorio en vivo.

const ca = { id: null }
const ESTADO_CAMPANA = { borrador: 'En borrador', armada: 'Armada', cerrada: 'Cerrada' }
const MOMENTO_CA = (p, c) => (p.tipo === 'invitacion' ? 'Invitación' : p.programadaPara && p.programadaPara < c.inicio ? 'Antes' : p.programadaPara && p.programadaPara <= c.fin ? 'Durante' : 'Después')

async function montarCampanas() {
  $('#principal').innerHTML = `<div class="titulo fila"><div class="f1"><h1>Campañas</h1><p>Una iniciativa tuya alrededor de un momento (un programa, un evento): tu mensaje, el hashtag, lo que publicás en tus cuentas antes, durante y después, la invitación para tu gente y el Observatorio siguiéndola en vivo. Solo tus cuentas y gente real que elige sumarse; nada sale sin tu ok.</p></div><button class="btn btn-primario" id="ca-nueva">＋ Nueva campaña</button></div><div id="ca-cuerpo"><p class="tenue">Juntando…</p></div>`
  $('#ca-nueva').onclick = () => modalCampana()
  ca.id ? pintarCampana(ca.id) : pintarCampanas()
}

async function pintarCampanas() {
  let r
  try { r = await api('/campanas') } catch (e) { return error(e) }
  const cuerpo = $('#ca-cuerpo')
  if (!cuerpo) return
  cuerpo.innerHTML = r.campanas.length ? `<div class="ag-misiones">${r.campanas.map((c) => `<button class="tarjeta ca-tarjeta ${c.estado}" data-ca="${c.id}"><div class="fila"><h4 class="f1">${esc(c.titulo)}</h4><span class="chip">${esc(ESTADO_CAMPANA[c.estado] ?? c.estado)}</span></div>
      <small class="tenue">${fechaOb(c.inicio)}${c.hashtag ? ` · ${esc(c.hashtag)}` : ' · sin hashtag todavía'} · ${c.piezas} pieza${c.piezas === 1 ? '' : 's'}</small><p class="chico recorte">${esc(c.objetivo)}</p></button>`).join('')}</div>`
    : '<div class="vacio"><p>Todavía ninguna. Una campaña es algo como «el día del programa, pedir con un hashtag que lo entrevisten»: le contás qué, para qué y cuándo, y te arma todo para que lo hagas con tu cuenta y tu gente.</p></div>'
  $$('[data-ca]', cuerpo).forEach((b) => (b.onclick = () => pintarCampana(Number(b.dataset.ca))))
}

async function pintarCampana(id) {
  ca.id = id
  let r
  try { r = await api(`/campanas/${id}`) } catch (e) { ca.id = null; return error(e) }
  const cuerpo = $('#ca-cuerpo')
  if (!cuerpo) return
  const c = r.campana
  const piezas = [...r.piezas].sort((a, b) => (a.programadaPara ?? 0) - (b.programadaPara ?? 0))
  const invitacion = piezas.find((p) => p.tipo === 'invitacion')
  cuerpo.innerHTML = `<div class="ca-detalle">
    <header class="aca-dom-cab"><button class="btn btn-chico" id="ca-volver">←</button><div class="f1"><h2>${esc(c.titulo)}</h2><small class="tenue">${fechaOb(c.inicio)} → ${fechaOb(c.fin)}</small></div><span class="chip">${esc(ESTADO_CAMPANA[c.estado] ?? c.estado)}</span></header>
    <p>${esc(c.objetivo)}</p>${c.mensaje ? `<blockquote class="ag-dice">${esc(c.mensaje)}</blockquote>` : ''}
    <section class="seccion"><h3>1 · El hashtag</h3>${c.hashtag ? `<p class="ca-tag">${esc(c.hashtag)}</p>` : '<p class="tenue chico">Todavía no lo elegiste.</p>'}
      ${c.candidatos.length ? `<ul class="ca-candidatos">${c.candidatos.map((x) => `<li><button class="btn btn-chico" data-ca-tag="${esc(x.hashtag)}">${esc(x.hashtag)}</button> ${x.enUso ? `<span class="chip ob-vivo">ya se usa</span> <small>${x.ejemplos.map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.titulo.slice(0, 50))} ↗</a>`).join(' · ')}</small>` : '<small class="tenue">no aparece en la búsqueda: libre</small>'}</li>`).join('')}</ul>` : ''}
      ${c.estado !== 'cerrada' ? `<div class="fila"><button class="btn" id="ca-proponer" title="Tres opciones y si cada una ya se usa (en la nube)">💡 Proponeme</button><input id="ca-propio" class="f1" placeholder="O escribí el tuyo: #…"><button class="btn" id="ca-elegir">Elegir</button></div>` : ''}</section>
    <section class="seccion"><h3>2 · Lo que publicás en tus cuentas</h3>${piezas.filter((p) => p.tipo !== 'invitacion').length ? `<ul class="ca-piezas">${piezas.filter((p) => p.tipo !== 'invitacion').map((p) => `<li class="pub ${p.estado}"><small>${MOMENTO_CA(p, c)} · ${esc(p.red)} · ${esc(p.usuario)} · ${p.programadaPara ? fechaOb(p.programadaPara) : 'sin hora'} · ${esc(p.estado)}</small><p>${esc(p.texto)}</p></li>`).join('')}</ul><p class="chico tenue">Las aprobás en 📥 (Para publicar) o en Cuentas; salen a la hora de su momento.</p><button class="btn btn-chico" id="ca-bandeja">Abrir 📥</button>`
      : c.estado === 'borrador' ? `<p class="tenue chico">Con el hashtag elegido, «Armar» redacta las piezas para antes, durante y después en cada cuenta tuya.</p>${c.hashtag ? '<button class="btn btn-primario" id="ca-armar" title="Piezas, invitación, calendario y Observatorio (en la nube)">▶ Armar la campaña</button>' : ''}` : '<p class="tenue chico">Sin piezas.</p>'}</section>
    <section class="seccion"><h3>3 · La invitación para tu gente</h3>${c.comunidad ? `<textarea class="ci-texto" id="ca-comunidad" rows="6" readonly>${esc(c.comunidad)}</textarea><div class="fila"><button class="btn btn-chico" id="ca-copiar">Copiar</button>${invitacion ? `<small class="tenue">Y en borrador en tu canal de Telegram (${esc(invitacion.estado)}).</small>` : '<small class="tenue">Para tus grupos, WhatsApp o mail: cada uno decide si se suma.</small>'}</div>` : '<p class="tenue chico">Sale al armar la campaña.</p>'}</section>
    <section class="seccion"><h3>4 · En vivo</h3>${r.tema ? `<p class="chico">El Observatorio la sigue${r.tema.intensivoDesde ? `: en vivo de ${fechaOb(r.tema.intensivoDesde)} a ${fechaOb(r.tema.intensivoHasta)}, una ronda cada 15 minutos (cada ronda te avisa en Hoy)` : ''}.</p>${r.ultima?.resumen ? `<p class="ob-resumen">${esc(r.ultima.resumen.resumen)}</p>` : ''}<button class="btn btn-chico" id="ca-observatorio">Ver en el Observatorio</button>` : '<p class="tenue chico">Al armarla, el Observatorio la sigue en vivo desde 30 minutos antes hasta una hora después.</p>'}</section>
    <section class="seccion"><h3>5 · El cierre</h3>${c.estado === 'cerrada' ? (c.informePieza ? `<a href="#" class="ref" data-pieza="${c.informePieza}">El informe de la campaña</a>` : '<p class="tenue chico">Cerrada sin informe.</p>') : `<p class="tenue chico">Una hora después del fin se cierra sola y deja el informe en tu corpus.</p>${c.estado === 'armada' ? '<button class="btn btn-chico" id="ca-cerrar">Cerrarla ahora (en la nube)</button>' : ''}`}</section>
    <div class="fila"><button class="btn btn-chico" id="ca-borrar">Borrar la campaña</button></div></div>`
  $('#ca-volver').onclick = () => { ca.id = null; pintarCampanas() }
  const enNube = async (boton, ruta, cuerpoPost = {}) => { const b = $(boton); if (b) b.disabled = true; try { await api(ruta, cuerpoPost) } catch (e) { error(e) } pintarCampana(id) }
  const prop = $('#ca-proponer'); if (prop) prop.onclick = () => enNube('#ca-proponer', `/campanas/${id}/hashtags`)
  $$('[data-ca-tag]', cuerpo).forEach((b) => (b.onclick = () => enNube(null, `/campanas/${id}/hashtag`, { hashtag: b.dataset.caTag })))
  const eleg = $('#ca-elegir'); if (eleg) eleg.onclick = () => { const v = $('#ca-propio').value.trim(); if (v) enNube('#ca-elegir', `/campanas/${id}/hashtag`, { hashtag: v }) }
  const armar = $('#ca-armar'); if (armar) armar.onclick = () => { armar.textContent = 'Armando…'; enNube('#ca-armar', `/campanas/${id}/armar`) }
  const cerrar = $('#ca-cerrar'); if (cerrar) cerrar.onclick = () => enNube('#ca-cerrar', `/campanas/${id}/cerrar`)
  const bj = $('#ca-bandeja'); if (bj) bj.onclick = () => modalBandeja()
  const cop = $('#ca-copiar'); if (cop) cop.onclick = async () => { try { await navigator.clipboard.writeText(c.comunidad); toast('Copiada', 'suave') } catch { toast('No pude copiar: seleccionala a mano', 'error') } }
  const obs = $('#ca-observatorio'); if (obs) obs.onclick = () => { ob.tema = c.temaId; irA('observatorio') }
  $('#ca-borrar').onclick = async () => { if (!(await confirmar('¿Borrar la campaña?', { detalle: 'Sus piezas en borrador se descartan.', si: 'Borrar', peligro: true }))) return; try { await api(`/campanas/${id}`, { borrar: true }); ca.id = null; pintarCampanas() } catch (e) { error(e) } }
}

async function modalCampana() {
  let r
  try { r = await api('/campanas') } catch (e) { return error(e) }
  const local = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) }
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Una campaña nueva</h2>
    <label class="campo">Qué es<input id="cam-titulo" placeholder="Ej.: El día del programa, pedir que lo entrevisten"></label>
    <label class="campo">Para qué<textarea id="cam-objetivo" rows="3" placeholder="Qué querés que pase"></textarea></label>
    <label class="campo">Tu mensaje <small class="tenue">(opcional)</small><textarea id="cam-mensaje" rows="3" placeholder="Lo que querés decir, con tus palabras"></textarea></label>
    <div class="fila"><label class="campo f1">Empieza<input id="cam-inicio" type="datetime-local" value="${local(Date.now() + 7 * 86_400_000)}"></label><label class="campo f1">Termina<input id="cam-fin" type="datetime-local"></label></div>
    <label class="campo">Hashtag <small class="tenue">(si ya lo tenés; si no, te propongo tres)</small><input id="cam-hashtag" placeholder="#…"></label>
    <div class="campo">Tus cuentas${r.cuentas.length ? `<div class="fila ci-cuentas">${r.cuentas.map((c) => `<label class="chico"><input type="checkbox" value="${c.id}" checked> ${esc(c.red)} · ${esc(c.usuario)}</label>`).join('')}</div>` : '<p class="tenue chico">No tenés cuentas cargadas (Cuentas): igual te armo la invitación para tu gente y el seguimiento en vivo.</p>'}</div>
    <p class="chico tenue">Solo tus cuentas y gente real que elige sumarse: nada de cuentas falsas ni de hacerse pasar por otros. Nada se publica sin tu ok.</p>
    <div class="fila"><button class="btn btn-primario" id="cam-ok">Crear</button></div>`)
  $('#cam-ok').onclick = async () => {
    try {
      const fin = $('#cam-fin').value
      const c = await api('/campanas', { titulo: $('#cam-titulo').value, objetivo: $('#cam-objetivo').value, mensaje: $('#cam-mensaje').value || null, inicio: new Date($('#cam-inicio').value).getTime(), fin: fin ? new Date(fin).getTime() : null, hashtag: $('#cam-hashtag').value || null, cuentas: $$('.ci-cuentas input:checked').map((i) => Number(i.value)) })
      cerrarModal(); pintarCampana(c.id)
    } catch (e) { error(e) }
  }
}
