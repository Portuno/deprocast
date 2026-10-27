'use strict'
// El informe único (plan v29): todo lo de un período junto (lo que hizo, su archivo, su grafo, sus agentes, el
// Observatorio, la Academia, el cuerpo, la plata, lo que espera su ok, lo que dejaron las rutinas y los tokens).
// La semana o entre dos fechas. La vista previa sale al instante y no se guarda; «Guardar» lo deja en su archivo y
// «Con Mastropiero» le suma la apertura (en la nube).

const inf = { desde: null, hasta: null, abierto: null }
const diaInf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fechaInf = (f) => new Date(`${f}T12:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

/** Los atajos de período, calculados hoy. */
function atajosInf(semana) {
  const hoy = new Date()
  const lunes = new Date(`${semana.desde}T12:00`)
  const menos = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - n)
  return [
    ['semana', 'Esta semana', semana.desde, semana.hasta],
    ['anterior', 'La anterior', diaInf(menos(lunes, 7)), diaInf(menos(lunes, 1))],
    ['mes', 'Este mes', diaInf(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), diaInf(hoy)],
    ['mespasado', 'El mes pasado', diaInf(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), diaInf(new Date(hoy.getFullYear(), hoy.getMonth(), 0))],
    ['30', 'Últimos 30 días', diaInf(menos(hoy, 29)), diaInf(hoy)],
  ]
}

async function montarInforme() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Informe</h1><p>Todo lo de un período en un solo lugar: la semana o entre las fechas que elijas. El del domingo llega solo; acá armás el que quieras.</p></div><div id="inf-cuerpo"><p class="tenue">Juntando…</p></div>`
  let r
  try { r = await api('/informes') } catch (e) { return error(e) }
  const cuerpo = $('#inf-cuerpo')
  if (!cuerpo) return
  const atajos = atajosInf(r.semana)
  if (!inf.desde) [inf.desde, inf.hasta] = [r.semana.desde, r.semana.hasta]
  cuerpo.innerHTML = `<div class="inf-grilla">
    <section class="inf-principal">
      <div class="inf-controles">
        <div class="ob-temas">${atajos.map(([k, n, d, h]) => `<button class="chip ${d === inf.desde && h === inf.hasta ? 'on' : ''}" data-inf-atajo="${k}">${n}</button>`).join('')}</div>
        <form class="fila inf-fechas" id="inf-form">
          <label class="campo">Desde<input type="date" name="desde" value="${inf.desde}" required></label>
          <label class="campo">Hasta<input type="date" name="hasta" value="${inf.hasta}" required></label>
          <button class="btn">Ver</button>
          <button class="btn" type="button" id="inf-guardar" title="Lo guarda en su archivo (sin modelo)">Guardar</button>
          <button class="btn btn-primario" type="button" id="inf-modelo" ${r.enLaNube ? '' : 'disabled title="Solo en la nube: gasta tokens"'}>Con Mastropiero</button>
        </form>
      </div>
      <div id="inf-hoja"><p class="tenue">Juntando…</p></div>
    </section>
    <aside class="inf-lista"><h3 class="sub">Guardados</h3>${r.informes.length ? r.informes.map((i) => `<button class="inf-item ${inf.abierto === i.id ? 'on' : ''}" data-inf-id="${i.id}"><b>${i.tipo === 'semanal' ? 'Semana' : 'Período'}</b> ${fechaInf(i.desde)} → ${fechaInf(i.hasta)}${i.apertura ? ' ✦' : ''}</button>`).join('') : '<p class="tenue chico">Todavía ninguno. El primero semanal llega el domingo a la noche.</p>'}</aside>
  </div>`
  $$('[data-inf-atajo]', cuerpo).forEach((b) => (b.onclick = () => { const a = atajos.find(([k]) => k === b.dataset.infAtajo); [inf.desde, inf.hasta, inf.abierto] = [a[2], a[3], null]; montarInforme() }))
  $$('[data-inf-id]', cuerpo).forEach((b) => (b.onclick = () => { inf.abierto = Number(b.dataset.infId); montarInforme() }))
  $('#inf-form').onsubmit = (ev) => { ev.preventDefault(); const f = new FormData(ev.target); [inf.desde, inf.hasta, inf.abierto] = [f.get('desde'), f.get('hasta'), null]; montarInforme() }
  const guardar = (conModelo) => async (ev) => {
    const b = ev.target
    const f = new FormData($('#inf-form'))
    b.disabled = true
    b.textContent = conModelo ? 'Escribiendo…' : 'Guardando…'
    try { const i = await api('/informes', { desde: f.get('desde'), hasta: f.get('hasta'), conModelo }); [inf.desde, inf.hasta, inf.abierto] = [i.desde, i.hasta, i.id]; toast('📋 Guardado en su archivo', 'suave'); montarInforme() } catch (e) { error(e); montarInforme() }
  }
  $('#inf-guardar').onclick = guardar(false)
  $('#inf-modelo').onclick = guardar(true)
  pintarHojaInf()
}

async function pintarHojaInf() {
  let d
  try { d = inf.abierto ? await api(`/informes/${inf.abierto}`) : await api(`/informes/periodo?desde=${encodeURIComponent(inf.desde)}&hasta=${encodeURIComponent(inf.hasta)}`) } catch (e) { const h = $('#inf-hoja'); if (h) h.innerHTML = `<p class="ob-aviso chico">⚠ ${esc(e.message ?? String(e))}</p>`; return }
  const hoja = $('#inf-hoja')
  if (!hoja) return
  hoja.innerHTML = `<header class="inf-cab"><h2>Del ${fechaInf(d.desde)} al ${fechaInf(d.hasta)}</h2><small class="tenue">${inf.abierto ? `Guardado${d.tipo === 'semanal' ? ' · el de la semana' : ''}` : 'Vista previa: no se guarda'}</small></header>
    ${d.apertura ? `<div class="inf-apertura">${md(d.apertura)}</div>` : ''}
    ${d.secciones.length ? `<div class="inf-secciones">${d.secciones.map((s) => `<section class="inf-seccion"><h3>${esc(s.titulo)}${s.vista ? ` <button class="btn btn-chico" data-inf-ir="${esc(s.vista)}">abrir →</button>` : ''}</h3><ul>${s.lineas.map((l) => `<li>${md(l)}</li>`).join('')}</ul></section>`).join('')}</div>` : '<div class="vacio"><p>No hubo movimiento en este período.</p></div>'}`
  $$('[data-inf-ir]', hoja).forEach((b) => (b.onclick = () => irA(b.dataset.infIr)))
}
