'use strict'
// La Fragua: propuestas de mejora → cambio en su propia rama, con tests → él lo lee y decide si se aplica.

const ESTADO_FORJA = {
  haciendo: ['forjando', 'vivo'], lista: ['pasa los tests', 'ok'], rota: ['no pasa los tests', 'mal'], fallo: ['no salió', 'mal'],
  aplicada: ['aplicada', 'ok'], descartada: ['descartada', ''],
}
let fraguaEspera = null

function montarFragua() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>La Fragua</h1><p>Donde Mastropiero mejora su propio código sin tocar lo que está andando. Cada mejora se escribe en una copia aparte, se compila y se prueba entera (todo lo que toca del servidor trae su test); vos leés el cambio y decidís. Nada entra solo.</p></div>
    <div class="pasos"><span><b>1</b>Propuesta o pedido</span><span><b>2</b>Elige archivos y arma un plan</span><span><b>3</b>Escribe en una rama aparte</span><span><b>4</b>Typecheck y tests (si falla, se corrige hasta 2 veces)</span><span><b>5</b>Vos lo aplicás y reiniciás el servidor</span></div>
    <form class="seccion" id="fr-pedir">
      <h3>Pedir una mejora</h3>
      <textarea name="pedido" rows="2" placeholder="Qué querés que cambie, con el detalle que tengas («que en la Criba la tecla d también descarte»). O forjá una de las propuestas de abajo." class="w-full"></textarea>
      <div class="fila mt-2"><span class="tenue" style="flex:1;font-size:12.5px">Mejor si es algo concreto y chico: un cambio por forja.</span><button class="btn btn-primario">⚒ Forjar</button></div>
    </form>
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
  const fecha = (ms) => new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  cont.innerHTML = `
    <section class="seccion">
      <div class="seccion-cab"><h3>Propuestas abiertas · ${d.propuestas.length}</h3><span class="tenue">Las deja Mastropiero cuando ve algo para mejorar (o se las pedís en el chat). Forjar una la convierte en un cambio para revisar.</span></div>
      ${d.propuestas.length ? `<div class="tarjetas">${d.propuestas.map((p) => `
        <article class="tarjeta" data-prop="${p.id}">
          <div class="tarjeta-cab">#${p.id}${p.area ? `<span class="chip">${esc(p.area)}</span>` : ''}${p.prioridad ? `<span class="estado-chip ${p.prioridad === 'alta' ? 'vivo' : ''}">${esc(p.prioridad)}</span>` : ''}</div>
          <h4>${esc(p.titulo)}</h4>
          ${p.detalle ? `<p class="recorte" title="Tocá para ver todo">${esc(p.detalle)}</p>` : ''}
          <div class="tarjeta-pie"><button class="btn btn-chico btn-primario" data-forjar ${haciendo ? 'disabled title="Hay una forja en curso"' : ''}>⚒ Forjar</button><span class="espacio"></span><button class="btn btn-chico" data-hecha title="Ya se resolvió por otro lado: queda como forjada">✓ Ya está</button><button class="btn btn-chico" data-descartar title="Descartar la propuesta">Descartar</button></div>
        </article>`).join('')}</div>` : '<p class="vacio">No hay propuestas abiertas. Pedí una mejora arriba o contale al chat qué cambiarías.</p>'}
    </section>
    <section class="seccion">
      <div class="seccion-cab"><h3>Forjas</h3><span class="tenue">${d.rama ? `Se aplican sobre la rama <code>${esc(d.rama)}</code>.` : ''}</span></div>
      ${d.forjas.map((f) => {
        const [txt, clase] = ESTADO_FORJA[f.estado] ?? [f.estado, '']
        const titulo = (f.pedido || '').split('\n')[0]
        return `<div class="forja-fila">
          <span class="num">#${f.id}</span>
          <span class="que"><b title="${esc(titulo)}">${esc(titulo)}</b><small>${fecha(f.creadaEn)}${f.archivos?.length ? ` · ${f.archivos.map(esc).join(', ')}` : ''}${f.paso ? ` · <span class="pensando">${esc(f.paso)}…</span>` : ''}</small></span>
          <span class="estado-chip ${clase}">${txt}</span>
          ${['lista', 'rota', 'fallo', 'aplicada'].includes(f.estado) ? `<button class="btn btn-chico" data-ver="${f.id}">Ver</button>` : '<span></span>'}
        </div>`
      }).join('') || '<p class="vacio">Nada forjado todavía.</p>'}
    </section>`
  $$('[data-prop]', cont).forEach((el) => {
    const id = Number(el.dataset.prop)
    $('[data-forjar]', el).onclick = async () => { try { await api('/fragua', { propuestaId: id }); toast('A la fragua<small>Te aviso en Hoy cuando termine.</small>'); refrescarFragua() } catch (e) { error(e) } }
    $('[data-descartar]', el).onclick = async () => { try { await api(`/propuestas/${id}`, { estado: 'descartada' }); refrescarFragua() } catch (e) { error(e) } }
    $('[data-hecha]', el).onclick = async () => { try { await api(`/propuestas/${id}`, { estado: 'hecha' }); toast(`#${id} forjada`, 'suave'); refrescarFragua() } catch (e) { error(e) } }
    const det = $('.recorte', el)
    if (det) det.onclick = () => det.classList.toggle('abierto')
  })
  $$('[data-ver]', cont).forEach((b) => (b.onclick = () => verForja(Number(b.dataset.ver), d.rama)))
  clearTimeout(fraguaEspera)
  if (haciendo) fraguaEspera = setTimeout(() => { if (vista === 'fragua') refrescarFragua() }, 5000)
}

function pintarDiff(diff) {
  return esc(diff ?? '').split('\n').map((l) => l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') ? `<span class="arch">${l}</span>` : l.startsWith('+') ? `<span class="mas">${l}</span>` : l.startsWith('-') ? `<span class="menos">${l}</span>` : l).join('\n')
}

async function verForja(id, rama) {
  let f
  try { f = await api(`/fragua/${id}`) } catch (e) { return error(e) }
  const [txt, clase] = ESTADO_FORJA[f.estado] ?? [f.estado, '']
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Forja #${f.id} <span class="estado-chip ${clase}">${txt}</span></h2>
    <p class="tenue">${esc(f.pedido.split('\n')[0])}</p>
    ${f.resumen ? `<div class="seccion"><h3>Plan y resumen</h3><div class="md">${esc(f.resumen).replace(/\n/g, '<br>')}</div></div>` : ''}
    ${f.archivos.length ? `<p class="tenue">Toca: ${f.archivos.map((a) => `<code>${esc(a)}</code>`).join(' ')} · rama <code>${esc(f.rama)}</code></p>` : ''}
    ${f.diff ? `<div class="fr-diff">${pintarDiff(f.diff)}</div>` : ''}
    ${f.salida ? `<details ${f.estado !== 'lista' ? 'open' : ''}><summary class="tenue">Salida de la verificación</summary><pre class="fr-diff">${esc(f.salida)}</pre></details>` : ''}
    <div class="fila mt-3">${f.estado === 'lista' ? `<button class="btn btn-primario" id="fr-aplicar">Aplicar a ${esc(rama ?? 'la rama actual')}</button>` : ''}${['lista', 'rota', 'fallo'].includes(f.estado) ? '<button class="btn" id="fr-descartar">Descartar</button>' : ''}</div>`)
  if ($('#fr-aplicar')) $('#fr-aplicar').onclick = async () => {
    if (!(await confirmar(`¿Aplicar este cambio al código (rama ${rama ?? 'actual'})?`, { detalle: 'Después hay que reiniciar el servidor.', si: 'Aplicar el cambio' }))) return
    try { await api(`/fragua/${id}/aplicar`, {}); cerrarModal(); toast('Aplicada<small>Reiniciá el servidor para que corra lo nuevo.</small>'); refrescarFragua() } catch (e) { error(e) }
  }
  if ($('#fr-descartar')) $('#fr-descartar').onclick = async () => { try { await api(`/fragua/${id}/descartar`, {}); cerrarModal(); refrescarFragua() } catch (e) { error(e) } }
}
