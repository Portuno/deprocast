'use strict'
// Aprender: tu plan con fecha (los Cien Días: verbos, hábitos, WOOP, tareas y el mapa de los cien) y lo que querés
// aprender (temas, práctica y repaso espaciado). Casi todo se marca solo: por Telegram a la noche (los verbos y los
// hábitos), con una nota de voz a la mañana (el WOOP), o contándoselo a Mastropiero.

let aprTab = 'dia'
let aprFecha = null
const NOMBRES_VERBOS = [['estudio', 'Estudio'], ['trabajo', 'Trabajo'], ['entreno', 'Entreno'], ['ensenio', 'Enseño'], ['construyo', 'Construyo'], ['disenio', 'Diseño']]

function montarAprender() {
  aprFecha = aprFecha ?? hoyISO()
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Aprender</h1><p>Tu plan de los Cien Días y lo que querés aprender. Lo más fácil: a la noche te llegan por Telegram los seis verbos y los hábitos para tocar; a la mañana le dictás el WOOP en una nota de voz; y lo que estudiás se lo contás a Mastropiero (te repregunta en 1, 3, 7 y 16 días).</p></div>
    <div class="tabs" id="apr-tabs">${[['dia', 'El día'], ['cien', 'Los 100'], ['frentes', 'Frentes'], ['temas', 'Quiero aprender'], ['repaso', 'Repaso']].map(([k, n]) => `<button data-tab="${k}" class="${aprTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div id="apr-cuerpo"></div>`
  $$('#apr-tabs button').forEach((b) => (b.onclick = () => { aprTab = b.dataset.tab; montarAprender() }))
  pintarAprender()
}

async function pintarAprender() {
  const cont = $('#apr-cuerpo')
  if (!cont) return
  try {
    if (['dia', 'cien', 'frentes'].includes(aprTab)) {
      const d = await api(`/cien?fecha=${aprFecha}`)
      if (!d.plan) { cont.innerHTML = '<div class="vacio"><div class="gran">◷</div><h2>Todavía no hay un plan con fecha</h2><p>Pedile a Mastropiero que importe tus Cien Días.</p><button class="btn btn-primario" data-paso-preguntar="Importá mis Cien Días al plan.">Pedírselo a Mastropiero</button></div>'; return }
      if (aprTab === 'dia') pintarDiaPlan(cont, d)
      else if (aprTab === 'cien') pintarCien(cont, d)
      else pintarFrentes(cont, d)
    } else {
      const d = await api('/aprender')
      if (aprTab === 'temas') pintarTemas(cont, d)
      else pintarRepaso(cont, d)
    }
  } catch (e) { error(e) }
}

function filaTarea(t) {
  return `<div class="apr-tarea ${t.estado}"><label><input type="checkbox" data-tarea="${t.id}" ${t.estado === 'hecha' ? 'checked' : ''}> <span>${t.hito ? '◆ ' : ''}${esc(t.titulo)}</span></label>
    <small class="tenue">${t.obligatoria ? '<b class="apr-oblig">obligatoria</b> · ' : ''}${esc(t.categoria ?? '')}${t.vence && t.vence !== aprFecha ? ` · ${esc(t.vence)}` : ''}</small></div>`
}

function pintarDiaPlan(cont, d) {
  const fechaTxt = new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const w = d.dia.woop ?? {}
  const hs = d.habitos.filter((h) => h.toca)
  cont.innerHTML = `
    <div class="fila sal-nav"><button class="btn btn-chico" data-dia="-1">‹</button><h2>${esc(fechaTxt)}</h2><button class="btn btn-chico" data-dia="1">›</button>${d.fecha === hoyISO() ? '' : '<button class="btn btn-chico" data-dia="hoy">Hoy</button>'}
      <span class="chip">Día ${d.n} de ${d.total} · semana ${d.semana}</span><span class="apr-int">${'●'.repeat(d.intensidad)}${'○'.repeat(4 - d.intensidad)}</span></div>
    ${d.foco ? `<p class="apr-foco">${esc(d.foco)}</p>` : ''}
    <div class="tarjetas">
      <article class="tarjeta"><h4>Los seis verbos</h4><p>De noche: ¿qué votaste hoy con hechos? Con 3 o 4 reales ya es un buen día.</p>
        <div class="apr-verbos">${NOMBRES_VERBOS.map(([k, n]) => `<button class="${d.dia.verbos[k] ? 'on' : ''}" data-verbo="${k}">${n}</button>`).join('')}</div></article>
      <article class="tarjeta"><h4>Hábitos de hoy</h4>
        ${hs.length ? hs.map((h) => `<label class="apr-hab"><input type="checkbox" data-hab="${esc(h.id)}" ${h.hecho ? 'checked' : ''}> <span>${esc(h.titulo)}</span><small class="tenue">${h.enSemana}/${h.porSemana}</small></label>`).join('') : '<p>Hoy no toca ninguno.</p>'}</article>
      <article class="tarjeta"><h4>WOOP</h4>
        <form class="apr-woop" id="apr-woop">
          <label>Deseo<textarea name="w" rows="2">${esc(w.w ?? '')}</textarea></label>
          <label>Resultado<textarea name="o" rows="2">${esc(w.o ?? '')}</textarea></label>
          <label>Obstáculo interno<textarea name="ob" rows="2" placeholder="Una emoción, un hábito o una creencia tuya">${esc(w.ob ?? '')}</textarea></label>
          <label>Plan si-entonces<textarea name="p" rows="2" placeholder="Si aparece el obstáculo, entonces…">${esc(w.p ?? '')}</textarea></label>
          <button class="btn btn-chico">Guardar</button></form></article>
    </div>
    <section class="seccion"><h3>Tareas del día</h3>${d.tareas.length ? d.tareas.map(filaTarea).join('') : '<p class="tenue">Nada agendado para este día.</p>'}</section>
    ${d.atrasadas.length ? `<section class="seccion"><h3>Atrasadas (reubicalas o hacelas)</h3>${d.atrasadas.map(filaTarea).join('')}</section>` : ''}
    <section class="seccion"><h3>Nota del día</h3><form class="fila" id="apr-nota"><textarea name="nota" rows="2" class="f1" placeholder="Qué pasó, qué aprendiste">${esc(d.dia.nota ?? '')}</textarea><button class="btn btn-chico">Guardar</button></form></section>`
  $$('[data-dia]', cont).forEach((b) => (b.onclick = () => { aprFecha = b.dataset.dia === 'hoy' ? hoyISO() : corrDia(aprFecha, Number(b.dataset.dia)); pintarAprender() }))
  $$('[data-verbo]', cont).forEach((b) => (b.onclick = async () => { try { await api('/cien/voto', { fecha: aprFecha, verbo: b.dataset.verbo }); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-hab]', cont).forEach((c) => (c.onchange = async () => { try { await api('/cien/habito', { fecha: aprFecha, id: c.dataset.hab, valor: c.checked }); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-tarea]', cont).forEach((c) => (c.onchange = async () => { try { await api(`/cien/tarea/${c.dataset.tarea}`, { hecha: c.checked }); pintarAprender() } catch (e) { error(e) } }))
  $('#apr-woop').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/cien/woop', { fecha: aprFecha, ...Object.fromEntries(new FormData(ev.target)) }); toast('WOOP guardado', 'suave') } catch (e) { error(e) } }
  $('#apr-nota').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/cien/nota', { fecha: aprFecha, nota: ev.target.nota.value }); toast('Nota guardada', 'suave') } catch (e) { error(e) } }
}

function pintarCien(cont, d) {
  const hoy = hoyISO()
  cont.innerHTML = `<div class="apr-cien">
      <div><div class="apr-grilla">${d.mapa.map((c) => `<button class="apr-celda i${c.intensidad} ${c.fecha > hoy ? 'fut' : ''} ${c.fecha === hoy ? 'hoy' : ''} ${c.hito ? 'hito' : ''}" data-ir="${c.fecha}" title="Día ${c.n} · ${c.fecha}">${c.n}</button>`).join('')}</div>
        <p class="tenue chico">Cada casilla es un día: el color es la intensidad (verbos + hábitos); ◆ hay un hito.</p></div>
      <div><div class="apr-grande">${d.quedan}</div><p class="tenue">días por delante · día ${d.n} de ${d.total}</p></div></div>`
  $$('[data-ir]', cont).forEach((b) => (b.onclick = () => { aprFecha = b.dataset.ir; aprTab = 'dia'; montarAprender() }))
}

function pintarFrentes(cont, d) {
  cont.innerHTML = `<div class="tarjetas">${d.frentes.map((f) => {
    const hs = d.habitos.filter((h) => h.frenteId === f.id)
    return `<article class="tarjeta"><h4>${esc(f.nombre)}</h4><p>${esc(f.ganar ?? '')}</p>${f.principio ? `<p><i>${esc(f.principio)}</i></p>` : ''}
      ${hs.length ? `<small class="tenue">${hs.map((h) => `${esc(h.titulo)} ${h.enSemana}/${h.porSemana}`).join(' · ')}</small>` : ''}</article>`
  }).join('')}</div>`
}

function pintarTemas(cont, d) {
  cont.innerHTML = `
    <section class="seccion"><form class="fila" id="apr-nuevo"><input name="tema" placeholder="Quiero aprender… (francés, SQL, a negociar)" required style="flex:2;min-width:12em"><input name="nivelObjetivo" placeholder="Hasta dónde (opcional)" style="flex:1;min-width:10em"><button class="btn btn-primario">＋ Sumar</button></form></section>
    ${d.aprendizajes.length ? `<div class="tarjetas">${d.aprendizajes.map((a) => `<article class="tarjeta apr-tema ${a.estado}" data-tema="${a.id}">
      <h4>${esc(a.tema)} ${a.estado !== 'activo' ? `<small class="tenue">(${esc(a.estado)})</small>` : ''}</h4>
      <p>${a.practicas ? `${a.minutosSemana} min esta semana · ${a.minutos} en total · ${a.diasMes} día${a.diasMes === 1 ? '' : 's'} este mes · última ${esc(a.ultima)}` : 'Todavía sin práctica anotada.'}</p>
      ${a.nivelObjetivo ? `<p>Objetivo: ${esc(a.nivelObjetivo)}</p>` : ''}
      <form class="fila" data-practica="${a.id}"><input name="minutos" type="number" min="1" placeholder="min" style="width:5em"><input name="que" placeholder="Qué practicaste" class="f1"><button class="btn btn-chico">Anotar</button></form>
      <div class="fila"><button class="btn btn-chico" data-recursos="${a.id}">Recursos</button><button class="btn btn-chico" data-estado="${a.id}" data-a="${a.estado === 'activo' ? 'pausado' : 'activo'}">${a.estado === 'activo' ? 'Pausar' : 'Reactivar'}</button></div>
      <div class="apr-recursos" id="apr-rec-${a.id}"></div></article>`).join('')}</div>` : '<p class="tenue">Todavía no anotaste nada para aprender.</p>'}`
  $('#apr-nuevo').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/aprender', Object.fromEntries(new FormData(ev.target))); pintarAprender() } catch (e) { error(e) } }
  $$('[data-practica]', cont).forEach((f) => (f.onsubmit = async (ev) => {
    ev.preventDefault()
    const v = Object.fromEntries(new FormData(f))
    try { await api(`/aprender/${f.dataset.practica}/practica`, { minutos: v.minutos ? Number(v.minutos) : null, que: v.que }); toast('Anotado<small>Te repregunto mañana</small>', 'suave'); pintarAprender() } catch (e) { error(e) }
  }))
  $$('[data-estado]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/aprender/${b.dataset.estado}`, { estado: b.dataset.a }); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-recursos]', cont).forEach((b) => (b.onclick = async () => {
    try {
      const r = await api(`/aprender/${b.dataset.recursos}`)
      const lista = [...r.recursos.obras.map((o) => `📖 ${esc(o.titulo)}${o.autor ? ` — ${esc(o.autor)}` : ''} <small class="tenue">(${esc(o.estado)})</small>`), ...r.recursos.piezas.map((p) => `<a href="#" class="ref" data-pieza="${p.id}">${esc(p.titulo)}</a>`)]
      $(`#apr-rec-${b.dataset.recursos}`).innerHTML = lista.length ? `<ul>${lista.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="tenue chico">No encontré nada en tu Librería ni en el corpus. Sumá una obra o pedile al Mentor.</p>'
    } catch (e) { error(e) }
  }))
}

function pintarRepaso(cont, d) {
  const tocan = d.repaso.filter((p) => p.toca)
  const vienen = d.repaso.filter((p) => !p.toca)
  cont.innerHTML = `
    <section class="seccion"><h3>Para repasar ahora (${tocan.length})</h3>
      ${tocan.length ? tocan.map((p) => `<form class="apr-rep" data-rep="${p.id}"><b>${esc(p.texto)}</b><small class="tenue">${esc(p.porQue ?? '')} · vuelta ${p.vuelta + 1} de 4</small>
        <div class="fila"><input name="respuesta" placeholder="De memoria…" class="f1"><button class="btn btn-chico btn-primario">Responder</button><button class="btn btn-chico" type="button" data-saltar="${p.id}">Mañana</button></div></form>`).join('') : '<p class="tenue">Nada para repasar ahora.</p>'}</section>
    ${vienen.length ? `<section class="seccion"><h3>Vienen</h3>${vienen.map((p) => `<div class="fila item"><span class="f1">${esc(p.texto)}</span><small class="tenue">${new Date(p.vuelveEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</small></div>`).join('')}</section>` : ''}`
  $$('[data-rep]', cont).forEach((f) => (f.onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/repaso/${f.dataset.rep}`, { respuesta: f.respuesta.value }); toast('Bien. Vuelve más adelante.', 'suave'); pintarAprender() } catch (e) { error(e) } }))
  $$('[data-saltar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/repaso/${b.dataset.saltar}`, { respuesta: null }); pintarAprender() } catch (e) { error(e) } }))
}
