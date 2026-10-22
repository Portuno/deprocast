'use strict'
// El calendario: un componente (Mes · Semana · Agenda) que usan la sección Calendario y el Radar. Su Google Calendar va
// ida y vuelta (crear, editar, borrar) si está conectado; lo de Deprocast se puede llevar allá.

const CAPAS_CAL_UI = {
  google: { nombre: 'Mi calendario', color: '#c58ad6', icono: '▦' },
  linea: { nombre: 'Línea', color: '#7aa2d6', icono: '⟿' },
  radar: { nombre: 'Radar', color: '#e0a64f', icono: '◍' },
  mision: { nombre: 'Misiones', color: '#86c08a', icono: '⚔' },
  horario: { nombre: 'Horario fijo', color: '#8a8a8a', icono: '▭' },
}
const DIAS_SEM = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const aFecha = (s) => new Date(`${s}T12:00:00`)
const sumarDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return iso(d) }
const lunesDe = (s) => { const d = aFecha(s); return sumarDias(s, -((d.getDay() + 6) % 7)) }
/** Un lugar que es un link (Zoom, Meet) se muestra como «🔗 enlace», no como una dirección kilométrica. */
const lugarHTML = (l) => (/^https?:\/\//i.test(l ?? '') ? `<a href="${esc(l)}" target="_blank" rel="noopener">🔗 enlace</a>` : `📍 ${esc(l)}`)
const minutos = (h) => (h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : null)

function rangoCal(vista, ancla) {
  if (vista === 'semana') { const l = lunesDe(ancla); return { desde: l, hasta: sumarDias(l, 6) } }
  if (vista === 'agenda') return { desde: ancla, hasta: sumarDias(ancla, 29) }
  const primero = `${ancla.slice(0, 7)}-01`
  const l = lunesDe(primero)
  return { desde: l, hasta: sumarDias(l, 41) }
}
function tituloPeriodo(vista, ancla) {
  const d = aFecha(ancla)
  if (vista === 'mes') return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const { desde, hasta } = rangoCal(vista, ancla)
  const f = (s) => aFecha(s).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
  return `${f(desde)} – ${f(hasta)}`
}

/**
 * Pinta el calendario en «el». o.soloCapas: fija las capas (el Radar muestra solo las suyas); o.vista: la de arranque.
 * El estado (vista, fecha, capas) vive en el elemento, así se puede tener más de uno.
 */
async function pintarCalendario(el, o = {}) {
  const guardadas = (() => { try { return JSON.parse(localStorage.getItem('mastro-cal-capas') ?? 'null') } catch { return null } })()
  el._cal ??= { vista: o.vista ?? (window.innerWidth < 700 ? 'agenda' : 'mes'), ancla: iso(new Date()), capas: new Set(o.soloCapas ?? guardadas ?? Object.keys(CAPAS_CAL_UI)) }
  const c = el._cal
  const { desde, hasta } = rangoCal(c.vista, c.ancla)
  let d
  try { d = await api(`/calendario?desde=${desde}&hasta=${hasta}&capas=${[...c.capas].join(',') || 'ninguna'}`) } catch (e) { el.innerHTML = `<p class="tenue">${esc(e.message)}</p>`; return }
  el._items = d.items
  el._estado = d.estado
  const conectado = d.estado.conectado
  el.innerHTML = `
    <div class="cal-cab">
      <div class="fila"><button class="btn btn-chico" data-cal="atras">←</button><button class="btn btn-chico" data-cal="hoy">Hoy</button><button class="btn btn-chico" data-cal="adelante">→</button><b class="cal-periodo">${esc(tituloPeriodo(c.vista, c.ancla))}</b></div>
      <div class="fila"><div class="cal-vistas">${['mes', 'semana', 'agenda'].map((v) => `<button class="${c.vista === v ? 'activo' : ''}" data-vista-cal="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>${conectado ? '<button class="btn btn-chico btn-primario" data-cal="nuevo">＋ Evento</button>' : ''}</div>
    </div>
    ${o.soloCapas ? '' : `<div class="mp-capas">${Object.entries(CAPAS_CAL_UI).map(([k, x]) => `<button class="chip-capa ${c.capas.has(k) ? 'activo' : ''}" data-capa-cal="${k}" style="--c:${x.color}">${x.icono} ${esc(x.nombre)}</button>`).join('')}</div>`}
    ${!conectado && !o.soloCapas ? avisoConexion(d.estado) : ''}
    ${d.aviso ? `<p class="chico mal">${esc(d.aviso)}</p>` : ''}
    <div class="cal-cuerpo">${c.vista === 'mes' ? vistaMes(d.items, c, desde) : c.vista === 'semana' ? vistaSemana(d.items, desde) : vistaAgenda(d.items, desde, hasta)}</div>`
  const recargar = () => pintarCalendario(el, o)
  $$('[data-cal]', el).forEach((b) => (b.onclick = () => {
    const a = b.dataset.cal
    if (a === 'nuevo') return formularioEvento(null, iso(new Date()), recargar)
    const paso = c.vista === 'mes' ? null : c.vista === 'semana' ? 7 : 30
    if (a === 'hoy') c.ancla = iso(new Date())
    else if (paso) c.ancla = sumarDias(c.ancla, a === 'atras' ? -paso : paso)
    else { const x = aFecha(c.ancla); x.setDate(1); x.setMonth(x.getMonth() + (a === 'atras' ? -1 : 1)); c.ancla = iso(x) }
    recargar()
  }))
  $$('[data-vista-cal]', el).forEach((b) => (b.onclick = () => { c.vista = b.dataset.vistaCal; recargar() }))
  $$('[data-capa-cal]', el).forEach((b) => (b.onclick = () => {
    const k = b.dataset.capaCal
    c.capas.has(k) ? c.capas.delete(k) : c.capas.add(k)
    try { localStorage.setItem('mastro-cal-capas', JSON.stringify([...c.capas])) } catch {}
    recargar()
  }))
  $$('[data-item]', el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const it = d.items.find((x) => x.id === b.dataset.item); if (it) detalleItem(it, d.estado, recargar) }))
  $$('[data-dia]', el).forEach((b) => (b.onclick = () => diaDelCalendario(b.dataset.dia, d.items, d.estado, recargar)))
}

function avisoConexion(e) {
  return `<details class="cal-conectar"><summary>${e.soloLectura ? 'Tu Google Calendar se ve en solo lectura.' : 'Tu Google Calendar no está conectado.'} Conectalo para crear, editar y borrar desde acá →</summary>
    <ol>
      <li>En <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud</a>: creá un proyecto, activá <b>Google Calendar API</b> y creá una <b>cuenta de servicio</b> (IAM → Cuentas de servicio). En su pestaña «Claves», agregá una clave <b>JSON</b> y bajala.</li>
      <li>En Google Calendar → Configuración de tu calendario → «Compartir con personas específicas»: agregá el mail de la cuenta de servicio (termina en <code>iam.gserviceaccount.com</code>) con permiso <b>«Hacer cambios en los eventos»</b>.</li>
      <li>En el <code>.env</code> de la nube: <code>GOOGLE_CUENTA_SERVICIO=</code> el contenido de ese JSON (o en base64) y <code>GOOGLE_CALENDARIO_ID=</code> tu gmail. Reiniciá.</li>
    </ol><p class="tenue chico">Deprocast nunca ve tu contraseña: entra solo a ese calendario, con el permiso que le diste.</p></details>`
}

const chipItem = (it) => {
  const x = CAPAS_CAL_UI[it.capa] ?? { color: '#999' }
  return `<button class="cal-ev ${it.cierre ? 'cierre' : ''} ${it.google && it.capa !== 'google' ? 'en-google' : ''}" data-item="${esc(it.id)}" style="--c:${x.color}" title="${esc(it.titulo)}">${it.hora && !it.todoElDia ? `<i>${esc(it.hora)}</i>` : ''}${esc(it.titulo)}</button>`
}

function vistaMes(items, c, desde) {
  const hoy = iso(new Date())
  const mes = c.ancla.slice(0, 7)
  const porDia = new Map()
  for (const it of items) if (!it.fondo) { if (!porDia.has(it.fecha)) porDia.set(it.fecha, []); porDia.get(it.fecha).push(it) }
  return `<div class="cal-mes">${DIAS_SEM.map((d) => `<div class="cal-dsem">${d}</div>`).join('')}${Array.from({ length: 42 }, (_, i) => {
    const dia = sumarDias(desde, i)
    const xs = porDia.get(dia) ?? []
    return `<div class="cal-celda ${dia.slice(0, 7) !== mes ? 'fuera' : ''} ${dia === hoy ? 'hoy' : ''}" data-dia="${dia}"><span class="cal-num">${Number(dia.slice(8))}</span>${xs.slice(0, 3).map(chipItem).join('')}${xs.length > 3 ? `<small class="cal-mas">+${xs.length - 3} más</small>` : ''}</div>`
  }).join('')}</div>`
}

function vistaSemana(items, desde) {
  const hoy = iso(new Date())
  const H0 = 7, H1 = 24, ALTO = 38
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(desde, i))
  const col = (dia) => {
    const xs = items.filter((x) => x.fecha === dia && !x.todoElDia && x.hora)
    return xs.map((it) => {
      const ini = Math.max(minutos(it.hora), H0 * 60)
      const fin = Math.min(minutos(it.fin) ?? ini + 60, H1 * 60)
      const x = CAPAS_CAL_UI[it.capa] ?? { color: '#999' }
      const top = ((ini - H0 * 60) / 60) * ALTO
      const alto = Math.max(18, ((Math.max(fin, ini + 30) - ini) / 60) * ALTO - 2)
      return it.fondo
        ? `<div class="cal-fondo" style="top:${top}px;height:${alto}px" title="${esc(it.titulo)} ${esc(it.hora)}–${esc(it.fin ?? '')}">${esc(it.titulo)}</div>`
        : `<button class="cal-bloque" data-item="${esc(it.id)}" style="top:${top}px;height:${alto}px;--c:${x.color}"><i>${esc(it.hora)}</i> ${esc(it.titulo)}</button>`
    }).join('')
  }
  return `<div class="cal-semana">
    <div class="cal-sem-cab"><div></div>${dias.map((d) => `<div class="${d === hoy ? 'hoy' : ''}" data-dia="${d}"><b>${DIAS_SEM[(aFecha(d).getDay() + 6) % 7]}</b> ${Number(d.slice(8))}</div>`).join('')}</div>
    <div class="cal-sem-todo"><div class="tenue chico">todo el día</div>${dias.map((d) => `<div>${items.filter((x) => x.fecha === d && x.todoElDia && !x.fondo).map(chipItem).join('')}</div>`).join('')}</div>
    <div class="cal-sem-horas" style="--alto:${ALTO}px"><div class="cal-reloj">${Array.from({ length: H1 - H0 }, (_, i) => `<span style="height:${ALTO}px">${String(H0 + i).padStart(2, '0')}:00</span>`).join('')}</div>${dias.map((d) => `<div class="cal-col ${d === hoy ? 'hoy' : ''}" style="height:${(H1 - H0) * ALTO}px">${col(d)}</div>`).join('')}</div>
  </div>`
}

function vistaAgenda(items, desde, hasta) {
  const xs = items.filter((x) => !x.fondo)
  if (!xs.length) return '<p class="tenue" style="padding:12px 0">Nada en estos días (en las capas prendidas).</p>'
  const dias = [...new Set(xs.map((x) => x.fecha))].sort()
  return `<div class="cal-agenda">${dias.map((d) => `<div class="cal-ag-dia"><h4 data-dia="${d}">${esc(aFecha(d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</h4>${xs.filter((x) => x.fecha === d).map((it) => {
    const x = CAPAS_CAL_UI[it.capa] ?? { color: '#999', icono: '·' }
    return `<button class="cal-ag-item" data-item="${esc(it.id)}" style="--c:${x.color}"><span class="cal-ag-hora">${it.todoElDia || !it.hora ? 'todo el día' : `${esc(it.hora)}${it.fin ? `–${esc(it.fin)}` : ''}`}</span><span><b>${esc(it.titulo)}</b>${it.lugar ? `<small>${/^https?:/i.test(it.lugar) ? '🔗 enlace' : `📍 ${esc(it.lugar)}`}</small>` : ''}</span><small style="color:${x.color}">${x.icono} ${esc(x.nombre)}${it.google && it.capa !== 'google' ? ' · en tu calendario' : ''}</small></button>`
  }).join('')}</div>`).join('')}</div>`
}

/** Un día: lo que tiene y, si está conectado, crear algo ese día. */
function diaDelCalendario(dia, items, estado, recargar) {
  const xs = items.filter((x) => x.fecha === dia && !x.fondo)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${esc(aFecha(dia).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2>
    ${xs.length ? `<div class="cal-agenda">${xs.map((it) => { const x = CAPAS_CAL_UI[it.capa] ?? { color: '#999', icono: '·' }; return `<button class="cal-ag-item" data-item="${esc(it.id)}" style="--c:${x.color}"><span class="cal-ag-hora">${it.todoElDia || !it.hora ? 'todo el día' : esc(it.hora)}</span><span><b>${esc(it.titulo)}</b></span><small style="color:${x.color}">${x.icono} ${esc(x.nombre)}</small></button>` }).join('')}</div>` : '<p class="tenue">Nada este día.</p>'}
    ${estado.conectado ? '<div class="fila mt-3"><button class="btn btn-primario" id="cal-nuevo-dia">＋ Nuevo evento este día</button></div>' : ''}`)
  $$('.velo [data-item], .modal [data-item]').forEach((b) => (b.onclick = () => { const it = xs.find((x) => x.id === b.dataset.item); if (it) detalleItem(it, estado, recargar) }))
  const n = $('#cal-nuevo-dia')
  if (n) n.onclick = () => formularioEvento(null, dia, recargar)
}

/** El detalle de algo del calendario y lo que se puede hacer con eso. */
function detalleItem(it, estado, recargar) {
  const x = CAPAS_CAL_UI[it.capa] ?? { nombre: it.capa, color: '#999', icono: '·' }
  const [origen, oid] = it.id.split(':')
  const origenLlevable = { oportunidad: 'oportunidad', evento: 'evento', mision: 'mision' }[origen]
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <p class="chico" style="color:${x.color};margin:0">${x.icono} ${esc(x.nombre)}${it.google && it.capa !== 'google' ? ' · también en tu calendario' : ''}</p>
    <h2 class="mt-1">${esc(it.titulo)}</h2>
    <p><b>${esc(aFecha(it.fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</b>${it.hora && !it.todoElDia ? ` · ${esc(it.hora)}${it.fin ? `–${esc(it.fin)}` : ''}` : ' · todo el día'}</p>
    ${it.lugar ? `<p>${lugarHTML(it.lugar)}</p>` : ''}
    ${it.detalle ? `<p class="tenue" style="white-space:pre-wrap">${esc(it.detalle)}</p>` : ''}
    ${it.url ? `<p><a href="${esc(it.url)}" target="_blank" rel="noopener">${it.capa === 'google' ? 'Abrir en Google Calendar ↗' : 'Abrir el link ↗'}</a></p>` : ''}
    <div class="fila" style="margin-top:12px;flex-wrap:wrap;gap:8px">
      ${it.editable ? '<button class="btn" data-acc-cal="editar">Editar</button><button class="btn btn-peligro" data-acc-cal="borrar">Borrar</button>' : ''}
      ${it.llevable && origenLlevable && estado.conectado ? `<button class="btn btn-primario" data-acc-cal="llevar">${it.google ? '↻ Actualizar en mi calendario' : '📅 Llevar a mi calendario'}</button>${it.google ? '<button class="btn" data-acc-cal="quitar">Sacar de mi calendario</button>' : ''}` : ''}
      ${it.llevable && !estado.conectado ? '<span class="tenue chico">Conectá tu Google Calendar para llevarlo allá.</span>' : ''}
      ${it.ref?.tipo === 'pieza' ? '<button class="btn" data-acc-cal="pieza">Ver de dónde salió</button>' : ''}
      ${it.ref?.tipo === 'oportunidad' ? '<button class="btn" data-acc-cal="radar">Ver en el Radar</button>' : ''}
      ${it.ref?.tipo === 'mision' ? '<button class="btn" data-acc-cal="misiones">Ver en Misiones</button>' : ''}
    </div>`)
  $$('[data-acc-cal]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.accCal
    try {
      if (a === 'editar') return formularioEvento(it, it.fecha, recargar)
      if (a === 'borrar') {
        if (!(await confirmar(`¿Borrar «${it.titulo}» de tu Google Calendar?`, { si: 'Borrar del calendario', peligro: true }))) return
        await api(`/calendario/evento/${encodeURIComponent(it.google)}/borrar`, {})
        toast('Borrado de tu calendario', 'suave')
      } else if (a === 'llevar') {
        await trabajando(b, 'Agendando…', () => api('/calendario/llevar', { origen: origenLlevable, id: Number(oid) }))
        toast(it.google ? 'Actualizado en tu calendario' : 'Agendado en tu calendario', 'suave')
      } else if (a === 'quitar') {
        if (!(await confirmar('¿Sacarlo de tu Google Calendar?', { detalle: 'En Deprocast sigue.', si: 'Sacar del calendario' }))) return
        await api('/calendario/quitar', { origen: origenLlevable, id: Number(oid) })
      } else if (a === 'pieza') { cerrarModal(); return modalPieza(Number(it.ref.id)) }
      else if (a === 'radar') { cerrarModal(); return irA('radar') }
      else if (a === 'misiones') { cerrarModal(); return irA('misiones') }
      cerrarModal()
      recargar()
    } catch (e) { error(e) }
  }))
}

/** Crear (it = null) o editar un evento de su Google Calendar. */
function formularioEvento(it, fecha, recargar) {
  const dur = it?.hora && it?.fin ? Math.max(15, minutos(it.fin) - minutos(it.hora)) : 60
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${it ? 'Editar evento' : 'Nuevo evento'}</h2>
    <div class="cal-form">
      <label>Título <input class="campo" id="ce-titulo" value="${esc(it?.titulo ?? '')}" placeholder="Qué es"></label>
      <div class="fila"><label>Día <input class="campo" type="date" id="ce-fecha" value="${esc(it?.fecha ?? fecha)}"></label><label>Hora <input class="campo" type="time" id="ce-hora" value="${esc(it && !it.todoElDia ? it.hora ?? '' : '')}"></label><label>Duración (min) <input class="campo" type="number" min="5" step="5" id="ce-dur" value="${dur}"></label></div>
      <p class="tenue chico">Sin hora, queda todo el día.</p>
      <label>Lugar <input class="campo" id="ce-lugar" value="${esc(it?.lugar ?? '')}"></label>
      <label>Nota <textarea class="campo" id="ce-nota" rows="3">${esc(it?.detalle ?? '')}</textarea></label>
      <div class="fila"><button class="btn btn-primario" id="ce-guardar">${it ? 'Guardar' : 'Crear en mi calendario'}</button></div>
    </div>`)
  $('#ce-titulo').focus()
  $('#ce-guardar').onclick = async () => {
    const datos = { titulo: $('#ce-titulo').value.trim(), fecha: $('#ce-fecha').value, hora: $('#ce-hora').value || null, duracionMin: Number($('#ce-dur').value) || 60, lugar: $('#ce-lugar').value.trim() || null, descripcion: $('#ce-nota').value.trim() || null }
    if (!datos.titulo) return toast('Ponele un título')
    if (!datos.fecha) return toast('Elegí el día')
    try {
      await trabajando($('#ce-guardar'), 'Guardando…', () => api(it ? `/calendario/evento/${encodeURIComponent(it.google)}` : '/calendario', datos))
      toast(it ? 'Cambiado en tu calendario' : 'Creado en tu calendario', 'suave')
      cerrarModal()
      recargar()
    } catch (e) { error(e) }
  }
}

// ─── la sección Calendario ──────────────────────────────────────────────

async function montarCalendario() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Calendario</h1><p>Tu Google Calendar y lo que Deprocast sabe con fecha: lo que viene en tu Línea, las fechas del Radar (y cuándo cierran), las misiones que vencen y tu horario fijo. Lo de Deprocast lo podés llevar a tu calendario con un toque.</p></div>
    <div class="panel" id="cal-principal"><p class="tenue" role="status">Trayendo tu calendario…</p></div>`
  await pintarCalendario($('#cal-principal'))
}
