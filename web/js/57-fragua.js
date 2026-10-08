'use strict'
// La Fragua: propuestas de mejora → cambio en su propia rama, con tests → él lo lee y decide si se aplica.

const ESTADO_FORJA = { haciendo: '⏳ forjando', lista: '✓ pasa los tests', rota: '✗ no pasa los tests', fallo: '✗ no salió', aplicada: '◆ aplicada', descartada: 'descartada' }
let fraguaEspera = null

function montarFragua() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>La Fragua</h1><p>Donde Mastropiero se mejora a sí mismo sin tocar lo que está andando: cada mejora se escribe en una rama aparte, se le corren el typecheck y los tests, y vos leés el cambio. Solo si lo aplicás entra; después reiniciá el servidor.</p></div>
    <div class="bloque"><h3>Pedir una mejora</h3><form class="fila" id="fr-pedir"><input name="pedido" placeholder="Qué querés que cambie (o forjá una propuesta de abajo)" style="flex:1" autocomplete="off"><button class="btn btn-primario">Forjar</button></form></div>
    <div id="fr-cuerpo"></div>`
  $('#fr-pedir').onsubmit = async (e) => {
    e.preventDefault()
    const p = e.target.pedido.value.trim()
    if (!p) return
    try { await api('/fragua', { pedido: p }); e.target.reset(); toast('A la fragua<small>Tarda unos minutos; te aviso en Hoy.</small>'); refrescarFragua() } catch (err) { error(err) }
  }
  refrescarFragua()
}

async function refrescarFragua() {
  const cont = $('#fr-cuerpo')
  if (!cont) return
  let d
  try { d = await api('/fragua') } catch (e) { return error(e) }
  const haciendo = d.forjas.some((f) => f.estado === 'haciendo')
  cont.innerHTML = `
    ${d.propuestas.length ? `<div class="bloque"><h3>Propuestas abiertas</h3>${d.propuestas.map((p) => `<div class="fila item"><span style="flex:1"><b>#${p.id}</b> ${esc(p.titulo)} <small class="tenue">${esc(p.area ?? '')} ${esc(p.prioridad ?? '')}</small></span><button class="btn btn-chico" data-forjar="${p.id}" ${haciendo ? 'disabled' : ''}>Forjar</button></div>`).join('')}</div>` : ''}
    <div class="bloque"><h3>Forjas</h3>${d.forjas.map((f) => `
      <div class="fila item"><span style="flex:1"><b>#${f.id}</b> ${esc((f.resumen || f.pedido).split('\n')[0].slice(0, 140))}</span><span class="chip">${ESTADO_FORJA[f.estado] ?? f.estado}</span>${['lista', 'rota', 'fallo'].includes(f.estado) ? `<button class="btn btn-chico" data-ver="${f.id}">Ver</button>` : ''}</div>`).join('') || '<p class="vacio">Nada forjado todavía.</p>'}</div>`
  $$('[data-forjar]', cont).forEach((b) => (b.onclick = async () => { try { await api('/fragua', { propuestaId: Number(b.dataset.forjar) }); toast('A la fragua<small>Te aviso en Hoy cuando termine.</small>'); refrescarFragua() } catch (e) { error(e) } }))
  $$('[data-ver]', cont).forEach((b) => (b.onclick = () => verForja(Number(b.dataset.ver))))
  clearTimeout(fraguaEspera)
  if (haciendo) fraguaEspera = setTimeout(() => { if (vista === 'fragua') refrescarFragua() }, 8000)
}

function pintarDiff(diff) {
  return esc(diff ?? '').split('\n').map((l) => l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') ? `<span class="arch">${l}</span>` : l.startsWith('+') ? `<span class="mas">${l}</span>` : l.startsWith('-') ? `<span class="menos">${l}</span>` : l).join('\n')
}

async function verForja(id) {
  let f
  try { f = await api(`/fragua/${id}`) } catch (e) { return error(e) }
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Forja #${f.id} · ${ESTADO_FORJA[f.estado]}</h2>
    ${f.resumen ? `<p>${esc(f.resumen)}</p>` : ''}
    ${f.archivos.length ? `<p class="tenue">Toca: ${f.archivos.map(esc).join(', ')} · rama ${esc(f.rama)}</p>` : ''}
    ${f.diff ? `<div class="fr-diff">${pintarDiff(f.diff)}</div>` : ''}
    ${f.salida ? `<details ${f.estado !== 'lista' ? 'open' : ''}><summary class="tenue">Salida de la verificación</summary><pre class="fr-diff">${esc(f.salida)}</pre></details>` : ''}
    <div class="fila" style="margin-top:12px">${f.estado === 'lista' ? '<button class="btn btn-primario" id="fr-aplicar">Aplicar a main</button>' : ''}<button class="btn" id="fr-descartar">Descartar</button></div>`)
  if ($('#fr-aplicar')) $('#fr-aplicar').onclick = async () => {
    if (!confirm('¿Aplicar este cambio al código? Después hay que reiniciar el servidor.')) return
    try { await api(`/fragua/${id}/aplicar`, {}); cerrarModal(); toast('Aplicada<small>Reiniciá el servidor para que corra lo nuevo.</small>'); refrescarFragua() } catch (e) { error(e) }
  }
  $('#fr-descartar').onclick = async () => { try { await api(`/fragua/${id}/descartar`, {}); cerrarModal(); refrescarFragua() } catch (e) { error(e) } }
}
