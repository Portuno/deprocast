'use strict'
// Criba lúdica: una pieza por vez; peso 1–12 o descartar, con teclas. Las de hoy y los días del mes (nada que se pierda).
// Mientras pesa, puede anotar: una nota (o algo para hacer) que entra al corpus con la pieza citada, y @ para nombrar.

let cribaPieza = null
let cribaSaltear = []
let cribaNivel = ''
let cribaOrden = 'auto'
// Con el teclado numérico: el punto (o la coma, según el teclado) es 11 y Enter es 12.
const TECLAS_PESO = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 10, q: 11, w: 12, '.': 11, ',': 11, Decimal: 11, Enter: 12, Backspace: 0, x: 0 }
const ORDENES_CRIBA = [['auto', 'Lo tuyo primero'], ['fecha_desc', 'Más nuevas'], ['fecha_asc', 'Más viejas'], ['id_desc', 'Nº mayor'], ['id_asc', 'Nº menor'], ['azar', 'Al azar']]

function montarCriba() {
  cribaOrden = pref.leer('mastro-criba-orden', 'auto')
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Criba</h1>
      <div class="fila"><select class="campo-suelto" style="width:auto;margin:0" id="cr-nivel"><option value="">Todo</option><option value="propia">Lo mío</option><option value="primaria">Fuentes primarias</option><option value="investigacion">Investigación</option></select>
        <select class="campo-suelto" style="width:auto;margin:0" id="cr-orden" title="En qué orden salen">${ORDENES_CRIBA.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div></div>
    <div class="criba-mesa">
      <div class="criba">
        <div class="criba-marcador" id="cr-marcador"></div>
        <div class="criba-carta" id="cr-carta"></div>
        <div class="criba-pesos" id="cr-pesos">
          <button class="btn" data-peso="0" title="Descartar (x)">✕</button>
          ${Array.from({ length: 12 }, (_, i) => `<button class="btn" data-peso="${i + 1}" title="Tecla ${i + 1 === 10 ? '0' : i + 1 === 11 ? 'q' : i + 1 === 12 ? 'w' : i + 1}">${i + 1}</button>`).join('')}
        </div>
        <div class="fila" style="justify-content:center"><button class="btn btn-chico" id="cr-saltear" title="Espacio">Saltear</button><button class="btn btn-chico" id="cr-deshacer" title="z">Deshacer</button></div>
      </div>
      <aside class="criba-nota">
        <textarea id="cr-nota" placeholder="Anotá algo sobre esto… (@ para nombrar a alguien o un proyecto)"></textarea>
        <small class="tenue">Se guarda al puntuar. Si es algo para hacer, queda como side quest solo.</small>
        <div id="cr-notas"></div>
      </aside>
    </div>`
  $('#cr-nivel').value = cribaNivel
  $('#cr-orden').value = cribaOrden
  $('#cr-nivel').onchange = (e) => { cribaNivel = e.target.value; cribaSaltear = []; traerCriba() }
  $('#cr-orden').onchange = (e) => { cribaOrden = e.target.value; pref.guardar('mastro-criba-orden', cribaOrden); cribaSaltear = []; traerCriba() }
  $$('#cr-pesos [data-peso]').forEach((b) => (b.onclick = () => pesar(Number(b.dataset.peso))))
  $('#cr-saltear').onclick = saltearCriba
  $('#cr-deshacer').onclick = deshacerCriba
  // Escape suelta la caja: las teclas vuelven a puntuar.
  $('#cr-nota').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur() })
  traerCriba()
}

function pintarMarcador(m) {
  $('#cr-marcador').innerHTML = `<span><b>${m.hoy}</b>hoy</span><span><b>${m.diasMes}</b>día${m.diasMes === 1 ? '' : 's'} este mes</span><span><b>${m.cribadas.toLocaleString('es-AR')}</b>pesadas</span><span><b>${m.faltan.toLocaleString('es-AR')}</b>faltan</span>`
}

function pintarNotas(notas) {
  const c = $('#cr-notas')
  if (!c) return
  c.innerHTML = (notas ?? []).map((n) => `<div class="sq"><span>${n.hacer ? '⚑ ' : '✎ '}${conMenciones(esc(n.texto))}</span></div>`).join('')
}

function pintarCarta(p) {
  cribaPieza = p
  const c = $('#cr-carta')
  if (!c) return
  if (!p) { c.innerHTML = '<p class="vacio">No queda nada sin pesar acá. 🎉</p>'; pintarNotas([]); return }
  c.innerHTML = `<div class="p-top"><span>#${p.id}</span>${nivelBadge(p.nivel)}${p.fecha ? `<span>${esc(String(p.fecha).slice(0, 10))}</span>` : ''}${p.tipo !== 'materia' ? `<span class="tipo-chip">${esc(p.tipo)}</span>` : ''}</div>
    <h2 title="${esc(p.tituloOriginal ?? p.titulo)}">${esc(p.titulo)}</h2>
    ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url.slice(0, 90))}</a>` : ''}
    <div class="cuerpo">${esc(p.contenido.slice(0, 2500))}</div>`
  pintarNotas(p.notas)
}

async function traerCriba() {
  try {
    const r = await api(`/criba?${new URLSearchParams({ nivel: cribaNivel, orden: cribaOrden, saltear: cribaSaltear.slice(-50).join(',') })}`)
    pintarMarcador(r.marcador)
    pintarCarta(r.pieza)
  } catch (e) { error(e) }
}

/** Lo escrito en la caja (y la vacía): viaja con la puntuación. */
function notaPendiente() {
  const c = $('#cr-nota')
  const t = c?.value.trim() ?? ''
  if (c) c.value = ''
  return t
}

async function pesar(peso) {
  if (!cribaPieza) return
  document.activeElement?.blur?.() // que Enter o espacio no vuelvan a apretar el último botón tocado
  const nota = notaPendiente()
  try {
    const m = await api(`/criba/${cribaPieza.id}`, { peso, nota })
    pintarMarcador(m)
    if (nota) toast('Nota guardada<small>Si es algo para hacer, queda como side quest.</small>', 'suave')
    else if (m.hoy && m.hoy % 25 === 0) toast(`¡${m.hoy} hoy!<small>Seguís afilando lo que sabe Mastropiero.</small>`)
    traerCriba()
  } catch (e) { error(e) }
}

/** Saltear tampoco pierde lo escrito: la nota se guarda igual. */
async function saltearCriba() {
  if (!cribaPieza) return
  const nota = notaPendiente()
  if (nota) await api(`/criba/${cribaPieza.id}/nota`, { texto: nota }).then(() => toast('Nota guardada', 'suave')).catch(error)
  cribaSaltear.push(cribaPieza.id)
  traerCriba()
}

async function deshacerCriba() {
  try { const r = await api('/criba/deshacer', {}); pintarMarcador(r.marcador); if (r.pieza) pintarCarta(r.pieza) } catch (e) { error(e) }
}

document.addEventListener('keydown', (e) => {
  if (vista !== 'criba' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || !$('#velo').hidden) return
  if (e.key in TECLAS_PESO) { e.preventDefault(); pesar(TECLAS_PESO[e.key]) }
  else if (e.key === ' ') { e.preventDefault(); saltearCriba() }
  else if (e.key === 'z') { e.preventDefault(); deshacerCriba() }
})
