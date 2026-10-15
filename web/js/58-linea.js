'use strict'
// La línea temporal: lo que pasó y lo que iba a pasar según todo su archivo, mes a mes, con la crónica de cada mes.
// Arriba lo que todavía viene (para agendarlo); a la izquierda los años con cuánto pasó en cada mes, para saltar.

const lin = { entidad: null, entidadNombre: '', tema: '', tipo: '' }
const TIPO_EV = { pasado: ['●', 'pasó'], futuro: ['◇', 'iba a pasar'], grabacion: ['🎙', 'grabación'] }

function montarLinea() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Línea</h1><p>Lo que pasó y lo que iba a pasar, según todo lo que escribiste, dijiste y guardaste. Cada mes con su crónica.</p></div></div>
    <div class="fila per-filtros">
      <input class="campo-suelto" id="lin-quien" placeholder="Persona, proyecto o lugar…" list="lin-ents" value="${esc(lin.entidadNombre)}"><datalist id="lin-ents"></datalist>
      <input class="campo-suelto" id="lin-tema" placeholder="Tema…" value="${esc(lin.tema)}">
      <select class="campo-suelto" id="lin-tipo"><option value="">Todo</option><option value="pasado">Lo que pasó</option><option value="futuro">Lo que iba a pasar</option><option value="grabacion">Grabaciones</option></select>
      ${lin.entidad || lin.tema || lin.tipo ? '<button class="btn btn-chico" id="lin-limpiar">Limpiar</button>' : ''}
    </div>
    <div id="lin-cuerpo"><p class="tenue">Cargando…</p></div>`
  $('#lin-tipo').value = lin.tipo
  $('#lin-tipo').onchange = (e) => { lin.tipo = e.target.value; refrescarLinea() }
  let t
  $('#lin-tema').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { lin.tema = e.target.value.trim(); refrescarLinea() }, 350) }
  $('#lin-quien').oninput = async (e) => {
    const q = e.target.value.trim()
    const elegida = [...$('#lin-ents').options].find((o) => o.value === q)
    if (elegida) { lin.entidad = Number(elegida.dataset.id); lin.entidadNombre = q; return refrescarLinea() }
    if (!q) { lin.entidad = null; lin.entidadNombre = ''; return refrescarLinea() }
    try {
      const r = await api(`/entidades?q=${encodeURIComponent(q)}&limite=12`)
      $('#lin-ents').innerHTML = (r.entidades ?? r).map((x) => `<option value="${esc(x.nombre)}" data-id="${x.id}">${esc(x.tipo)}</option>`).join('')
    } catch { /* sin sugerencias */ }
  }
  const lim = $('#lin-limpiar')
  if (lim) lim.onclick = () => { Object.assign(lin, { entidad: null, entidadNombre: '', tema: '', tipo: '' }); montarLinea() }
  refrescarLinea()
}

const mesLargo = (m) => { const t = new Date(`${m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1) }

async function refrescarLinea() {
  const cont = $('#lin-cuerpo')
  if (!cont) return
  let d
  try { d = await api(`/linea?${new URLSearchParams(Object.fromEntries(Object.entries({ entidad: lin.entidad ?? '', tema: lin.tema, tipo: lin.tipo }).filter(([, v]) => v)))}`) } catch (e) { return error(e) }
  if (!d.eventos.length && !d.futuros.length) {
    cont.innerHTML = `<div class="vacio"><div class="gran">⟿</div><h2>${lin.entidad || lin.tema || lin.tipo ? 'Nada con ese filtro' : 'La línea todavía está vacía'}</h2><p>Se arma sola cuando el reproceso destila tu archivo (Corpus → ♻ Reproceso): cada evento con fecha que aparezca en lo que escribiste, dijiste o guardaste.</p></div>`
    return
  }
  const porMes = new Map()
  for (const e of d.eventos) { const m = e.fecha.slice(0, 7); porMes.set(m, [...(porMes.get(m) ?? []), e]) }
  const cronica = new Map(d.cronicas.map((c) => [c.mes, c]))
  const meses = [...porMes.keys()].sort().reverse()
  // El mapa de años: cada mes una barrita según cuánto pasó.
  const anios = [...new Set(meses.map((m) => m.slice(0, 4)))].sort().reverse()
  const max = Math.max(...[...porMes.values()].map((x) => x.length))
  const mapa = `<div class="lin-anios">${anios.map((a) => `<div class="lin-anio"><b>${a}</b><div class="lin-meses">${Array.from({ length: 12 }, (_, i) => {
    const m = `${a}-${String(i + 1).padStart(2, '0')}`
    const n = porMes.get(m)?.length ?? 0
    return `<button class="${n ? '' : 'vacio-mes'}" ${n ? `data-ir-mes="${m}"` : 'disabled'} title="${esc(mesLargo(m))}: ${n} evento${n === 1 ? '' : 's'}"><i style="height:${n ? Math.max(12, Math.round((n / max) * 100)) : 4}%"></i></button>`
  }).join('')}</div></div>`).join('')}</div>`
  const evHTML = (e, futuro = false) => {
    const [g, t] = TIPO_EV[e.tipo] ?? ['·', e.tipo]
    return `<div class="lin-ev ${e.tipo} ${e.estado}" data-ev="${e.id}">
      <span class="lin-g" title="${esc(t)}">${g}</span>
      <span class="lin-f">${esc(e.precision === 'mes' ? mesLargo(e.fecha) : new Date(`${e.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }))}${e.hora ? ` · ${esc(e.hora)}${e.fin ? `–${esc(e.fin)}` : ''}` : ''}</span>
      <span class="lin-t"><b>${esc(e.titulo)}</b><small>${e.lugar ? `⌖ ${esc(e.lugar)} · ` : ''}${e.personas.map((p) => p.id ? `<a href="#" class="ref" data-ref-ent="${p.id}">${esc(p.nombre)}</a>` : esc(p.nombre)).join(', ')}${e.personas.length ? ' · ' : ''}<a href="#" class="ref" data-pieza="${e.piezaId}">de «${esc(e.pieza.slice(0, 60))}»</a></small></span>
      ${futuro ? `<span class="fila"><button class="btn btn-chico btn-primario" data-agendar title="Que quede como side quest con su fecha">¿Lo agendo?</button><button class="btn btn-chico" data-descartar-ev title="Ya no va">✕</button></span>` : e.estado === 'agendado' ? '<span class="tipo-chip">agendado</span>' : ''}
    </div>`
  }
  cont.innerHTML = `
    ${d.futuros.length ? `<section class="seccion lin-futuros"><h3>Lo que viene · ${d.futuros.length}</h3><p class="tenue chico">Cosas con fecha que aparecen en tu archivo y todavía no pasaron.</p>${d.futuros.map((e) => evHTML(e, true)).join('')}</section>` : ''}
    <div class="lin-grid">
      <aside>${mapa}</aside>
      <div>${meses.map((m) => {
        const c = cronica.get(m)
        return `<section class="lin-mes" id="lin-${m}"><h2>${esc(mesLargo(m))} <small class="tenue">${porMes.get(m).length} evento${porMes.get(m).length === 1 ? '' : 's'}</small></h2>
          ${c ? `<article class="lin-cronica" data-pieza="${c.id}"><small>Crónica del mes</small><h4>${esc(c.titulo.replace(/^Mes · \d{4}-\d{2} · /, ''))}</h4><p>${esc(c.extracto.split(/\n#+ /)[0].trim())}${c.extracto.length >= 600 || /\n#+ /.test(c.extracto) ? ' …' : ''}</p></article>` : ''}
          ${porMes.get(m).map((e) => evHTML(e)).join('')}</section>`
      }).join('')}</div>
    </div>`
  $$('[data-ir-mes]', cont).forEach((b) => (b.onclick = () => $(`#lin-${b.dataset.irMes}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })))
  $$('[data-pieza]', cont).forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); modalPieza(Number(a.dataset.pieza)) }))
  $$('[data-ref-ent]', cont).forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); Object.assign(lin, { entidad: Number(a.dataset.refEnt), entidadNombre: a.textContent }); montarLinea() }))
  $$('[data-agendar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/linea/${b.closest('[data-ev]').dataset.ev}`, { accion: 'agendar' }); toast('Agendado<small>Quedó como side quest con su fecha.</small>', 'suave'); refrescarLinea() } catch (e) { error(e) } }))
  $$('[data-descartar-ev]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/linea/${b.closest('[data-ev]').dataset.ev}`, { accion: 'descartar' }); refrescarLinea() } catch (e) { error(e) } }))
}
