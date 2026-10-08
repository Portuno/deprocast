'use strict'
// Criba lúdica: una pieza por vez; peso 1–12 o descartar, con teclas. Marcador del día y racha.

let cribaPieza = null
let cribaSaltear = []
let cribaNivel = ''
// Con el teclado numérico: el punto (o la coma, según el teclado) es 11 y Enter es 12.
const TECLAS_PESO = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 10, q: 11, w: 12, '.': 11, ',': 11, Decimal: 11, Enter: 12, Backspace: 0, x: 0 }

function montarCriba() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Criba</h1><p>Pesá tu corpus jugando: una pieza por vez, del 1 al 12 (o descartala). Lo pesado sube en las búsquedas y en lo que leen los ayudantes. Primero salen los links compartidos y lo tuyo.</p>
      <div class="fila"><select id="cr-nivel"><option value="">Todo</option><option value="propia">Lo mío</option><option value="primaria">Fuentes primarias</option><option value="investigacion">Investigación</option></select></div></div>
    <div class="criba">
      <div class="criba-marcador" id="cr-marcador"></div>
      <div class="criba-carta" id="cr-carta"></div>
      <div class="criba-pesos" id="cr-pesos">
        <button class="btn" data-peso="0" title="Descartar (x)">✕</button>
        ${Array.from({ length: 12 }, (_, i) => `<button class="btn" data-peso="${i + 1}">${i + 1}</button>`).join('')}
      </div>
      <div class="fila" style="justify-content:center"><button class="btn btn-chico" id="cr-saltear">Saltear (espacio)</button><button class="btn btn-chico" id="cr-deshacer">Deshacer (z)</button></div>
      <p class="criba-ayuda">Teclas: 1–9, 0 = 10, q o . = 11, w o Enter = 12, x = descartar, espacio = saltear, z = deshacer</p>
    </div>`
  $('#cr-nivel').value = cribaNivel
  $('#cr-nivel').onchange = (e) => { cribaNivel = e.target.value; cribaSaltear = []; traerCriba() }
  $$('#cr-pesos [data-peso]').forEach((b) => (b.onclick = () => pesar(Number(b.dataset.peso))))
  $('#cr-saltear').onclick = saltearCriba
  $('#cr-deshacer').onclick = deshacerCriba
  traerCriba()
}

function pintarMarcador(m) {
  $('#cr-marcador').innerHTML = `<span><b>${m.hoy}</b>hoy</span><span><b>${m.racha}</b>día${m.racha === 1 ? '' : 's'} de racha${m.racha >= 3 ? ' 🔥' : ''}</span><span><b>${m.cribadas.toLocaleString('es-AR')}</b>pesadas</span><span><b>${m.faltan.toLocaleString('es-AR')}</b>faltan</span>`
}

function pintarCarta(p) {
  cribaPieza = p
  const c = $('#cr-carta')
  if (!c) return
  if (!p) return void (c.innerHTML = '<p class="vacio">No queda nada sin pesar acá. 🎉</p>')
  c.innerHTML = `<div class="p-top"><span>#${p.id}</span>${nivelBadge(p.nivel)}${p.fecha ? `<span>${esc(String(p.fecha).slice(0, 10))}</span>` : ''}${p.tipo !== 'materia' ? `<span class="tipo-chip">${esc(p.tipo)}</span>` : ''}</div>
    <h2>${esc(p.titulo)}</h2>
    ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url.slice(0, 90))}</a>` : ''}
    <div class="cuerpo">${esc(p.contenido.slice(0, 2500))}</div>`
}

async function traerCriba() {
  try {
    const r = await api(`/criba?${new URLSearchParams({ nivel: cribaNivel, saltear: cribaSaltear.slice(-50).join(',') })}`)
    pintarMarcador(r.marcador)
    pintarCarta(r.pieza)
  } catch (e) { error(e) }
}

async function pesar(peso) {
  if (!cribaPieza) return
  document.activeElement?.blur?.() // que Enter o espacio no vuelvan a apretar el último botón tocado
  try {
    const m = await api(`/criba/${cribaPieza.id}`, { peso })
    pintarMarcador(m)
    if (m.hoy && m.hoy % 25 === 0) toast(`¡${m.hoy} hoy!<small>Seguís afilando lo que sabe Mastropiero.</small>`)
    traerCriba()
  } catch (e) { error(e) }
}

function saltearCriba() { if (cribaPieza) { cribaSaltear.push(cribaPieza.id); traerCriba() } }

async function deshacerCriba() {
  try { const r = await api('/criba/deshacer', {}); pintarMarcador(r.marcador); if (r.pieza) pintarCarta(r.pieza) } catch (e) { error(e) }
}

document.addEventListener('keydown', (e) => {
  if (vista !== 'criba' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || !$('#velo').hidden) return
  if (e.key in TECLAS_PESO) { e.preventDefault(); pesar(TECLAS_PESO[e.key]) }
  else if (e.key === ' ') { e.preventDefault(); saltearCriba() }
  else if (e.key === 'z') { e.preventDefault(); deshacerCriba() }
})
