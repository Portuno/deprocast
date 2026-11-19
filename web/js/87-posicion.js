'use strict'
// Afuera → Posición en IAs (Fragua #293): si los asistentes recomiendan un proyecto suyo. Sus preguntas de cliente, la
// serie por semana (en cuántas respuestas lo nombran, el mejor puesto, la semana en que cambió su hoja citable) y la
// respuesta cruda de cada modelo. Se mide solo los lunes; «Medir ahora» lo hace ya (sin repetir lo de esta semana).

const po = { entidad: null, datos: null, portada: null, midiendo: false }
const NOMBRE_MODELO = (m) => String(m).replace(/-flash$|-v\d[\w.]*$/i, '').replace(/^(\w)/, (c) => c.toUpperCase())

async function montarPosicion() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Posición en IAs</h1><p>¿Las IAs recomiendan tus proyectos? Cada lunes les hago tus preguntas de cliente a varios modelos, sin contexto, como un desconocido, y marco si te nombran, en qué puesto y con qué frase.</p></div></div>
    <div id="po-portada"><p class="tenue">Mirando…</p></div>
    <div id="po-tablero"></div>`
  await pintarPortadaPosicion()
}

async function pintarPortadaPosicion() {
  let d
  try { d = await api('/posicion') } catch (e) { return error(e) }
  if (vista !== 'posicion' || !$('#po-portada')) return
  po.portada = d
  const delta = (t) => (t.ultima && t.anterior ? t.ultima.porcentaje - t.anterior.porcentaje : null)
  $('#po-portada').innerHTML = `
    ${d.tableros.length ? `<div class="po-proyectos">${d.tableros.map((t) => `<button class="po-proyecto ${po.entidad === t.entidad.id ? 'on' : ''}" data-po-ent="${t.entidad.id}">
      <b>${esc(t.entidad.nombre)}</b>
      <span class="po-num">${t.ultima ? `${t.ultima.porcentaje} %` : '—'}</span>
      <small class="tenue">${t.ultima ? `${t.ultima.apariciones} de ${t.ultima.respuestas} respuestas${delta(t) != null ? ` · ${delta(t) > 0 ? '▲' : delta(t) < 0 ? '▼' : '='} ${Math.abs(delta(t))} pts` : ''}` : 'sin medir todavía'} · ${t.preguntas} ${t.preguntas === 1 ? 'pregunta' : 'preguntas'}</small>
    </button>`).join('')}</div>` : '<p class="tenue">Todavía no medís ningún proyecto. Elegí uno y escribí la pregunta que haría un cliente que no te conoce.</p>'}
    <form class="po-nueva" id="po-nueva">
      <input class="campo-suelto" id="po-nueva-ent" list="po-entidades" placeholder="Proyecto" required>
      <datalist id="po-entidades"></datalist>
      <input class="campo-suelto po-nueva-preg" id="po-nueva-preg" placeholder="La pregunta de un cliente, sin nombrar el proyecto: ¿qué … recomendás en …?" required minlength="10">
      <button class="btn btn-primario">Medir este proyecto</button>
    </form>
    <p class="tenue chico">Modelos: ${d.modelos.map((m) => esc(NOMBRE_MODELO(m))).join(', ')}. Responden con lo que saben, sin buscar en la web.</p>`
  $$('[data-po-ent]').forEach((b) => (b.onclick = () => abrirTableroPosicion(Number(b.dataset.poEnt))))
  let t
  $('#po-nueva-ent').oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { try { const xs = await api(`/segmento/entidades?q=${encodeURIComponent(e.target.value)}`); $('#po-entidades').innerHTML = xs.slice(0, 12).map((x) => `<option value="${esc(x.nombre)}">${esc(x.tipo)}</option>`).join('') } catch { /* sin sugerencias */ } }, 200) }
  $('#po-nueva').onsubmit = async (e) => {
    e.preventDefault()
    try {
      const q = await api('/posicion/preguntas', { entidad: $('#po-nueva-ent').value, pregunta: $('#po-nueva-preg').value })
      toast('Pregunta guardada: se mide el lunes, o ahora con «Medir ahora»', 'suave')
      po.entidad = q.entidadId
      await pintarPortadaPosicion()
      await abrirTableroPosicion(q.entidadId)
    } catch (er) { error(er) }
  }
  // La primera vez, abre el último que miró (o el primero); después, la portada solo se repinta.
  if (!$('#po-tablero').innerHTML.trim()) { const id = po.entidad ?? d.tableros[0]?.entidad.id; if (id) abrirTableroPosicion(id) }
}

async function abrirTableroPosicion(id) {
  po.entidad = id
  $$('[data-po-ent]').forEach((b) => b.classList.toggle('on', Number(b.dataset.poEnt) === id))
  try { po.datos = await api(`/posicion/${id}`) } catch (e) { return error(e) }
  if (vista !== 'posicion' || !$('#po-tablero')) return
  pintarTableroPosicion()
}

/** Barras por semana (un solo tono: es una sola serie); la semana en que cambió la hoja citable lleva su rótulo. */
function seriePosicion(serie) {
  const medidas = serie.filter((s) => s.respuestas || s.hoja)
  if (!medidas.length) return '<p class="tenue">Todavía no hay semanas medidas.</p>'
  const margen = 40, ancho = margen + Math.max(300, medidas.length * 56), alto = 180, base = 140, tope = 20, paso = (ancho - margen) / medidas.length, barra = Math.min(28, paso * 0.5)
  const y = (p) => base - ((base - tope) * p) / 100
  const semanaCorta = (s) => s.replace(/^\d{4}-W/, 'S')
  const barras = medidas.map((s, i) => {
    const x = margen + i * paso + (paso - barra) / 2, h = base - y(s.porcentaje)
    const tip = s.respuestas ? `${s.semana}: ${s.apariciones} de ${s.respuestas} respuestas (${s.porcentaje} %)${s.mejorPuesto ? ` · mejor puesto ${s.mejorPuesto}` : ''}${s.hoja ? ' · cambió la hoja citable' : ''}` : `${s.semana}: sin medir · cambió la hoja citable`
    return `<g class="po-col"><title>${esc(tip)}</title>
      <rect class="po-hit" x="${margen + i * paso}" y="${tope - 10}" width="${paso}" height="${alto - tope}"></rect>
      ${s.respuestas ? (h > 0 ? `<path class="po-barra" d="M${x},${base} V${y(s.porcentaje) + 4} q0,-4 4,-4 h${barra - 8} q4,0 4,4 V${base} Z"></path>` : `<rect class="po-cero" x="${x}" y="${base - 2}" width="${barra}" height="2"></rect>`) : ''}
      ${s.respuestas && (i === medidas.length - 1 || medidas.length <= 8) ? `<text class="po-val" x="${x + barra / 2}" y="${y(s.porcentaje) - 6}" text-anchor="middle">${s.porcentaje} %</text>` : ''}
      <text class="po-eje" x="${x + barra / 2}" y="${base + 16}" text-anchor="middle">${esc(semanaCorta(s.semana))}</text>
      ${s.hoja ? `<text class="po-hoja" x="${x + barra / 2}" y="${base + 32}" text-anchor="middle">◆ hoja</text>` : ''}
    </g>`
  }).join('')
  const grilla = [0, 50, 100].map((p) => `<line class="po-grilla" x1="${margen}" x2="${ancho}" y1="${y(p)}" y2="${y(p)}"></line><text class="po-eje" x="${margen - 6}" y="${y(p) + 4}" text-anchor="end">${p} %</text>`).join('')
  return `<div class="po-grafico"><svg viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" role="img" aria-label="En qué porcentaje de las respuestas lo nombran, por semana">${grilla}${barras}</svg></div>
    <details class="po-tabla"><summary class="tenue chico">Ver como tabla</summary><table class="lib-tabla"><thead><tr><th>Semana</th><th>Lo nombran</th><th>%</th><th>Mejor puesto</th><th>Hoja citable</th></tr></thead><tbody>
      ${medidas.map((s) => `<tr><td>${esc(s.semana)}</td><td>${s.respuestas ? `${s.apariciones} de ${s.respuestas}` : '—'}</td><td>${s.respuestas ? `${s.porcentaje} %` : '—'}</td><td>${s.mejorPuesto ?? '—'}</td><td>${s.hoja ? 'cambió' : ''}</td></tr>`).join('')}
    </tbody></table></details>`
}

function pintarTableroPosicion() {
  const d = po.datos
  const activas = d.preguntas.filter((p) => p.activa)
  $('#po-tablero').innerHTML = `
    <div class="po-cab"><h2>${esc(d.entidad.nombre)}</h2>
      <button class="btn" id="po-medir" ${po.midiendo || !activas.length ? 'disabled' : ''}>${po.midiendo ? 'Midiendo…' : 'Medir ahora'}</button></div>
    <p class="tenue chico">Se busca «${esc([d.entidad.nombre, ...d.entidad.alias].join('», «'))}» en cada respuesta (como palabra entera).</p>
    ${seriePosicion(d.serie)}
    <h3 class="tl-h">Las preguntas</h3>
    ${d.preguntas.length ? d.preguntas.map((p) => `<section class="po-preg ${p.activa ? '' : 'tenue'}">
      <div class="po-preg-cab"><b>«${esc(p.pregunta)}»</b>${p.activa ? `<button class="btn btn-chico" data-po-quitar="${p.id}" title="Dejar de medirla (lo medido queda)">Quitar</button>` : '<small>ya no se mide</small>'}</div>
      ${p.ultimas.length ? `<div class="po-modelos">${p.ultimas.map((r) => `<details class="po-resp ${r.aparece ? 'si' : 'no'}">
        <summary><span class="po-modelo">${esc(NOMBRE_MODELO(r.modelo))}</span><span class="po-veredicto">${r.aparece ? `✓ ${r.puesto ? `puesto ${r.puesto}` : 'lo nombra'}` : '✗ no lo nombra'}</span><small class="tenue">${esc(r.semana)}</small></summary>
        ${r.fragmento ? `<p class="po-frase">«${esc(r.fragmento)}»</p>` : ''}
        <div class="po-crudo md">${md(r.texto)}</div>
      </details>`).join('')}</div>` : '<p class="tenue chico">Sin medir todavía.</p>'}
    </section>`).join('') : ''}
    <form class="po-nueva" id="po-agregar"><input class="campo-suelto po-nueva-preg" id="po-agregar-preg" placeholder="Otra pregunta de cliente para ${esc(d.entidad.nombre)}" required minlength="10"><button class="btn">Agregar</button></form>`
  $('#po-medir').onclick = medirPosicionYa
  $$('[data-po-quitar]').forEach((b) => (b.onclick = async () => { try { await api(`/posicion/preguntas/${b.dataset.poQuitar}/quitar`, {}); await abrirTableroPosicion(po.entidad); pintarPortadaPosicion() } catch (e) { error(e) } }))
  $('#po-agregar').onsubmit = async (e) => {
    e.preventDefault()
    try { await api('/posicion/preguntas', { entidad: d.entidad.id, pregunta: $('#po-agregar-preg').value }); await abrirTableroPosicion(po.entidad); pintarPortadaPosicion() } catch (er) { error(er) }
  }
}

async function medirPosicionYa() {
  po.midiendo = true
  pintarTableroPosicion()
  try {
    const r = await api('/posicion/medir', { entidad: po.entidad })
    toast(r.nuevas ? `${r.nuevas} respuestas nuevas${r.fallas.length ? ` (${r.fallas.length} modelos no contestaron)` : ''}` : r.fallas.length ? `Ningún modelo contestó: ${esc(r.fallas[0])}` : 'Esta semana ya estaba medida', r.nuevas ? 'suave' : '')
  } catch (e) { error(e) }
  po.midiendo = false
  if (vista !== 'posicion') return
  await abrirTableroPosicion(po.entidad)
  pintarPortadaPosicion()
}
