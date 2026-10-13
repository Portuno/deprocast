'use strict'
// Salud: lo que comés, el ejercicio, el sueño y el peso, contra tus metas. Entra solo por Telegram (una foto con o sin
// explicación, o un texto), por el chat, o desde acá: una foto, unas palabras o a mano.

let saludFecha = null
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const corrDia = (f, n) => { const [a, m, d] = f.split('-').map(Number); const x = new Date(a, m - 1, d + n, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const ICONO_SALUD = { comida: '🍽', ejercicio: '💪', sueno: '😴', medida: '⚖', sintoma: '🩹', otro: '·' }
const CALIDAD = ['', 'mal', 'bien', 'muy bien']

function barraMeta(etiqueta, valor, meta, unidad) {
  const pct = meta ? Math.min(100, Math.round((valor / meta) * 100)) : 0
  return `<div class="sal-barra"><div class="fila" style="justify-content:space-between"><span>${etiqueta}</span><b>${valor}${unidad}${meta ? ` <small class="tenue">de ${meta}${unidad}</small>` : ''}</b></div>
    ${meta ? `<div class="sal-pista"><i style="width:${pct}%" class="${pct >= 100 ? 'lleno' : ''}"></i></div>` : ''}</div>`
}

function montarSalud() {
  saludFecha = saludFecha ?? hoyISO()
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Salud</h1><p>Lo que comés, el ejercicio, el sueño y el peso, contra tus metas. Lo más fácil: mandale a Mastropiero una foto por Telegram (un plato, un ticket, la balanza) con dos palabras, y se anota solo.</p>
      <div class="fila"><button class="btn" id="sal-metas">Metas</button></div></div>
    <section class="seccion">
      <div class="fila sal-alta">
        <form class="fila" id="sal-texto" style="flex:1;min-width:16em"><input name="texto" placeholder="Contalo: «almorcé milanesa con puré», «corrí 5 km», «dormí 7 h», «peso 82,4»" autocomplete="off" style="flex:1"><button class="btn btn-primario">Anotar</button></form>
        <label class="btn" title="Una foto de la comida, la balanza o la app del reloj">📷 Foto<input type="file" accept="image/*" id="sal-foto" hidden></label>
      </div>
      <p class="pensando" id="sal-trabajando" hidden></p>
    </section>
    <div id="sal-cuerpo"></div>`
  $('#sal-texto').onsubmit = async (ev) => {
    ev.preventDefault()
    const texto = ev.target.texto.value.trim()
    if (!texto) return
    trabajandoSalud('Anotando…')
    try {
      const r = await api('/captura', { texto })
      if (r.registrado) { toast(r.registrado.resumen, 'suave'); ev.target.reset() }
      else toast(`No me pareció algo para anotar${r.captura?.descripcion ? `<small>${esc(r.captura.descripcion)}</small>` : ''}`, 'suave')
      pintarSalud()
    } catch (e) { error(e) } finally { trabajandoSalud() }
  }
  $('#sal-foto').onchange = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const texto = $('#sal-texto').texto.value.trim()
    trabajandoSalud('Mirando la foto…')
    try {
      const r = await fetch(`/api/captura/foto?nombre=${encodeURIComponent(f.name || 'foto.jpg')}&texto=${encodeURIComponent(texto)}`, { method: 'POST', body: f }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j })
      if (r.registrado) { toast(r.registrado.resumen, 'suave'); $('#sal-texto').reset() }
      else toast(`No me pareció algo para anotar${r.captura?.descripcion ? `<small>${esc(r.captura.descripcion)}</small>` : ''}`, 'suave')
      pintarSalud()
    } catch (err) { error(err) } finally { trabajandoSalud() }
  }
  $('#sal-metas').onclick = modalMetasSalud
  pintarSalud()
}

function trabajandoSalud(texto) {
  const p = $('#sal-trabajando')
  if (!p) return
  p.hidden = !texto
  p.textContent = texto ?? ''
}

async function pintarSalud() {
  const cont = $('#sal-cuerpo')
  if (!cont) return
  let d
  try { d = await api(`/salud?fecha=${saludFecha}`) } catch (e) { return error(e) }
  const { dia, semana } = d
  const m = dia.metas
  const esHoy = saludFecha === hoyISO()
  const fechaTxt = new Date(`${saludFecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const fila = (r) => `<div class="sal-reg" data-reg="${r.id}">
      ${r.foto ? `<img src="${esc(r.foto)}" alt="" loading="lazy">` : `<span class="sal-ico">${ICONO_SALUD[r.tipo] ?? '·'}</span>`}
      <div><b>${esc(r.titulo)}</b><small class="tenue">${[r.hora,
        r.tipo === 'comida' ? `${Math.round(r.datos.kcal ?? 0)} kcal · P ${Math.round(r.datos.proteina ?? 0)} · C ${Math.round(r.datos.carbos ?? 0)} · G ${Math.round(r.datos.grasa ?? 0)}` : '',
        r.tipo === 'ejercicio' ? [r.datos.minutos ? `${r.datos.minutos} min` : '', r.datos.distancia_km ? `${r.datos.distancia_km} km` : '', r.datos.intensidad_texto ?? ''].filter(Boolean).join(' · ') : '',
        r.tipo === 'medida' && r.datos.peso != null ? `${r.datos.peso} kg` : '',
        r.tipo === 'sueno' && r.datos.calidad ? CALIDAD[r.datos.calidad] : '',
        r.fuente !== 'pantalla' ? `por ${r.fuente}` : ''].filter(Boolean).join(' · ')}</small></div>
      <button class="btn btn-chico" data-borrar-reg="${r.id}" title="Borrar">✕</button></div>`
  const comidas = dia.registros.filter((r) => r.tipo === 'comida')
  const resto = dia.registros.filter((r) => r.tipo !== 'comida')
  const max = Math.max(1, ...semana.dias.map((x) => x.kcal), m.kcal ?? 0)
  cont.innerHTML = `
    <div class="fila sal-nav"><button class="btn btn-chico" data-dia="-1">‹</button><h2>${esc(fechaTxt)}</h2><button class="btn btn-chico" data-dia="1" ${esHoy ? 'disabled' : ''}>›</button>${esHoy ? '' : '<button class="btn btn-chico" data-dia="hoy">Hoy</button>'}</div>
    <div class="tarjetas">
      <article class="tarjeta"><h4>🍽 Comida</h4>
        ${barraMeta('Calorías', dia.kcal, m.kcal, ' kcal')}${barraMeta('Proteína', dia.proteina, m.proteina, ' g')}
        <p>Carbos ${dia.carbos} g · grasa ${dia.grasa} g · ${dia.comidas} comida${dia.comidas === 1 ? '' : 's'} anotada${dia.comidas === 1 ? '' : 's'}</p></article>
      <article class="tarjeta"><h4>💪 Movimiento</h4>
        <p><b>${dia.ejercicio.minutos} min</b> ${dia.ejercicio.sesiones ? `(${esc(dia.ejercicio.titulos.join(', '))})` : 'sin ejercicio anotado'}</p>
        ${barraMeta('Días con ejercicio esta semana', semana.entrenos, m.entrenos, '')}</article>
      <article class="tarjeta"><h4>😴 Sueño</h4>
        ${dia.sueno?.horas != null ? `<p><b>${dia.sueno.horas} h</b>${dia.sueno.calidad ? ` · ${CALIDAD[dia.sueno.calidad]}` : ''}${m.sueno ? ` <span class="tenue">(meta ${m.sueno} h)</span>` : ''}</p>` : `<div class="fila">${[5, 6, 7, 8, 9].map((h) => `<button class="btn btn-chico" data-dormi="${h}">${h === 5 ? '≤5' : h === 9 ? '9+' : h} h</button>`).join('')}</div>`}
        <p class="tenue">Promedio de la semana: ${semana.suenoPromedio ?? '—'} h</p></article>
      <article class="tarjeta"><h4>⚖ Peso</h4>
        <p>${dia.peso ? `<b>${dia.peso.peso} kg</b> <span class="tenue">(${esc(dia.peso.fecha)})</span>` : 'Sin peso anotado.'}${semana.peso?.cambio != null ? ` · ${semana.peso.cambio > 0 ? '+' : ''}${semana.peso.cambio} en la semana` : ''}${m.peso ? ` · objetivo ${m.peso}` : ''}</p>
        <form class="fila" id="sal-peso"><input name="peso" type="number" step="0.1" min="30" max="250" placeholder="kg" style="width:6em"><button class="btn btn-chico">Anotar peso</button></form></article>
    </div>
    <section class="seccion"><h3>Lo del día</h3>
      ${comidas.length || resto.length ? `<div class="sal-regs">${[...comidas, ...resto].map(fila).join('')}</div>` : '<p class="tenue">Nada anotado este día.</p>'}</section>
    <section class="seccion"><h3>La semana</h3>
      <div class="sal-semana">${semana.dias.map((x) => `<div class="sal-col ${x.fecha === saludFecha ? 'hoy' : ''}" data-ir="${x.fecha}" title="${x.kcal} kcal · ${x.proteina} g prot · ${x.minutos} min${x.sueno != null ? ` · ${x.sueno} h de sueño` : ''}">
        <div class="sal-col-barra"><i style="height:${Math.round((x.kcal / max) * 100)}%"></i>${m.kcal ? `<s style="bottom:${Math.round((m.kcal / max) * 100)}%"></s>` : ''}</div>
        <small>${new Date(`${x.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short' })}</small><small>${x.entreno ? '💪' : '·'}${x.sueno != null ? ` ${x.sueno}h` : ''}</small></div>`).join('')}</div>
      <p class="tenue chico">${semana.kcalPromedio != null ? `${semana.kcalPromedio} kcal y ${semana.proteinaPromedio} g de proteína por día anotado · ` : ''}${semana.minutos} min de ejercicio en ${semana.entrenos} días</p></section>`
  $$('[data-dia]', cont).forEach((b) => (b.onclick = () => { saludFecha = b.dataset.dia === 'hoy' ? hoyISO() : corrDia(saludFecha, Number(b.dataset.dia)); pintarSalud() }))
  $$('[data-ir]', cont).forEach((b) => (b.onclick = () => { saludFecha = b.dataset.ir; pintarSalud() }))
  $$('[data-dormi]', cont).forEach((b) => (b.onclick = async () => { try { await api('/salud', { tipo: 'sueno', fecha: saludFecha, datos: { horas: Number(b.dataset.dormi) } }); pintarSalud() } catch (e) { error(e) } }))
  $$('[data-borrar-reg]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/salud/${b.dataset.borrarReg}`, { borrar: true }); pintarSalud() } catch (e) { error(e) } }))
  $('#sal-peso').onsubmit = async (ev) => {
    ev.preventDefault()
    const peso = Number(ev.target.peso.value)
    if (!peso) return
    try { await api('/salud', { tipo: 'medida', fecha: saludFecha, titulo: 'Peso', datos: { peso } }); pintarSalud() } catch (e) { error(e) }
  }
}

async function modalMetasSalud() {
  let m
  try { m = (await api(`/salud?fecha=${hoyISO()}`)).dia.metas } catch (e) { return error(e) }
  const campo = (k, etiqueta, paso) => `<label class="campo">${etiqueta}<input name="${k}" type="number" min="0" step="${paso}" value="${m[k] ?? ''}" placeholder="sin meta"></label>`
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Metas de salud</h2>
    <p class="tenue">Vacío = sin meta. Mastropiero las usa en la Brújula, el audio de la mañana y para avisarte (poca proteína a la noche, días sin moverte, noches cortas).</p>
    <form class="form-ing" id="sal-metas-f">${campo('kcal', 'Calorías por día', 50)}${campo('proteina', 'Proteína por día (g)', 5)}${campo('sueno', 'Horas de sueño', 0.5)}${campo('entrenos', 'Días con ejercicio por semana', 1)}${campo('peso', 'Peso objetivo (kg)', 0.5)}
      <div class="fila"><button class="btn btn-primario">Guardar</button></div></form>`)
  $('#sal-metas-f').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    try { await api('/salud/metas', Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : Number(v)]))); cerrarModal(); toast('Metas guardadas', 'suave'); pintarSalud() } catch (e) { error(e) }
  }
}
