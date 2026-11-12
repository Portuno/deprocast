'use strict'
// La Matriz 72 · el esqueleto (en La máquina): todo lo que trabaja en Deprocast en una sola geometría. En cada celda
// conviven los órganos del sistema (lo que ya corre solo), las cartas de la liga y los agentes propuestos (se forjan
// desde acá). Arriba, la grilla de 8 dominios × 9 oficios; abajo, la ficha de cada uno: función, virtudes, qué hace,
// cuándo, con qué modelos piensa y su actividad real de la semana.

const esq = { datos: null, dominio: null }
const OFICIO_LARGO = ['Input · Cuerpo', 'Input · Mente', 'Input · Alma', 'Procesa · Cuerpo', 'Procesa · Mente', 'Procesa · Alma', 'Output · Cuerpo', 'Output · Mente', 'Output · Alma']

async function montarEsqueleto() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Matriz 72 · el esqueleto</h1>
    <p>Todo lo que trabaja en Deprocast, en 8 dominios × 9 oficios (entra · procesa · sale, por cuerpo · mente · alma). En cada celda: los órganos del sistema, las cartas de tu liga y los agentes propuestos.</p></div>
    <div id="esq"><p class="tenue">Armando el esqueleto…</p></div>`
  await pintarEsqueleto(true)
}

async function pintarEsqueleto(cargar = false) {
  const raiz = $('#esq')
  if (!raiz) return
  if (cargar || !esq.datos) { try { esq.datos = await api('/esqueleto') } catch (e) { return error(e) } }
  const d = esq.datos
  const cartas = E.roster ?? []
  const enCelda = (n) => ({ organos: d.organos.filter((o) => o.celda === n), cartas: cartas.filter((f) => f.celda === n) })
  const organos = d.organos.filter((o) => o.tipo === 'organo'), propuestos = d.organos.filter((o) => o.tipo === 'propuesto')
  const conCelda = cartas.filter((f) => f.celda).length
  const domDe = (celda) => Math.floor((celda - 1) / 9)

  const resumen = `<div class="esq-resumen">
    <span class="esq-num"><b>${organos.length}</b>órganos trabajando</span>
    <span class="esq-num"><b>${cartas.length}</b>cartas en la liga${cartas.length > conCelda ? ` <small class="tenue">(${cartas.length - conCelda} sin celda)</small>` : ''}</span>
    <span class="esq-num"><b>${propuestos.length}</b>propuestos por forjar</span>
    <span class="esq-leyenda"><i class="esq-pin organo"></i>órgano <i class="esq-pin liga"></i>carta <i class="esq-pin propuesto"></i>propuesto</span></div>`

  const chips = `<div class="chips esq-dominios"><button class="chip ${esq.dominio == null ? 'on' : ''}" data-esq-dom="">Todos</button>${d.dominios.map((nombre, i) => {
    const k = d.porDominio[i]
    const nCartas = cartas.filter((f) => f.celda && domDe(f.celda) === i).length
    return `<button class="chip ${esq.dominio === i ? 'on' : ''}" data-esq-dom="${i}">${esc(nombre)} <small class="tenue">${k.organos + nCartas + k.propuestos}</small></button>`
  }).join('')}</div>`

  let grilla = `<div class="cab"></div>${OFICIO_LARGO.map((o) => `<div class="cab">${o.replace(' · ', '<br>')}</div>`).join('')}`
  d.dominios.forEach((nombre, di) => {
    grilla += `<div class="dom ${esq.dominio != null && esq.dominio !== di ? 'apagado' : ''}">${esc(nombre)}</div>`
    for (let o = 0; o < 9; o++) {
      const n = di * 9 + o + 1
      const x = enCelda(n)
      const hay = x.organos.length + x.cartas.length
      const titulo = [...x.organos.map((y) => `${y.nombre}${y.tipo === 'propuesto' ? ' (propuesto)' : ''}`), ...x.cartas.map((f) => f.nombre ?? f.id)].join(' · ')
      grilla += `<div class="celda esq-celda ${hay ? 'llena' : ''} ${esq.dominio != null && esq.dominio !== di ? 'apagado' : ''}" data-esq-celda="${n}" title="${n} · ${esc(nombre)} · ${OFICIO_LARGO[o]}${titulo ? ` — ${esc(titulo)}` : ''}">
        <small>${String(n).padStart(2, '0')}</small>
        <span class="ocupa">${x.organos.map((y) => `<span class="esq-pin ${y.tipo}" title="${esc(y.nombre)}">${y.glifo}</span>`).join('')}${x.cartas.map((f) => `<span class="esq-pin liga" style="color:${colorDe(f.clase)}" title="${esc(f.nombre ?? f.id)}">${claseDe(f.clase).glifo}</span>`).join('')}</span>
        ${x.organos.length === 1 && !x.cartas.length ? `<em class="esq-nombre">${esc(x.organos[0].nombre)}</em>` : ''}
      </div>`
    }
  })

  const dominiosVisibles = esq.dominio == null ? d.dominios.map((_, i) => i) : [esq.dominio]
  const fichas = dominiosVisibles.map((i) => {
    const os = d.organos.filter((o) => domDe(o.celda) === i)
    const cs = cartas.filter((f) => f.celda && domDe(f.celda) === i)
    if (!os.length && !cs.length) return ''
    return `<section class="esq-seccion"><h2 class="sub">${esc(d.dominios[i])} <small class="tenue">${os.filter((o) => o.tipo === 'organo').length} órganos · ${cs.length} cartas · ${os.filter((o) => o.tipo === 'propuesto').length} propuestos</small></h2>
      <div class="esq-fichas">${os.sort((a, b) => a.celda - b.celda).map(fichaOrgano).join('')}</div>
      ${cs.length ? `<div class="mazo esq-mazo">${cs.map(cartaHTML).join('')}</div>` : ''}</section>`
  }).join('')

  raiz.innerHTML = `${resumen}${chips}<div class="esq-grilla-caja"><div class="matriz esq-matriz">${grilla}</div></div>${fichas}`
  $$('[data-esq-dom]', raiz).forEach((b) => (b.onclick = () => { esq.dominio = b.dataset.esqDom === '' ? null : Number(b.dataset.esqDom); pintarEsqueleto() }))
  $$('[data-esq-celda]', raiz).forEach((c) => (c.onclick = () => modalCeldaEsqueleto(Number(c.dataset.esqCelda))))
  conectarFichas(raiz)
  $$('[data-agente]', raiz).forEach((a) => (a.onclick = () => modalAgente(a.dataset.agente)))
}

function fichaOrgano(o) {
  const semana = (o.semana ?? []).filter((s) => s.n != null)
  const activo = semana.some((s) => s.n > 0)
  const estado = o.tipo === 'propuesto'
    ? (o.propuestaEstado && o.propuestaEstado !== 'abierta' ? 'forjado' : 'propuesto')
    : semana.length ? (activo ? 'trabajando' : 'quieto esta semana') : 'a pedido'
  const cadena = o.modelos?.length ? `<span title="Con qué modelos piensa, en orden">🧠 ${o.modelos.map(esc).join(' → ')}</span>` : ''
  return `<article class="esq-ficha ${o.tipo}" id="esq-${esc(o.id)}">
    <header><span class="esq-glifo">${o.glifo}</span>
      <div><b>${esc(o.nombre)}</b><small class="tenue">⬡ ${esc(o.celdaInfo.etiqueta)} · ${esc(o.celdaInfo.dominio)} · ${esc(o.celdaInfo.ipo)} · ${esc(o.celdaInfo.cma)}</small></div>
      <span class="esq-estado ${estado.replace(/\s.*/, '')}">${estado}</span></header>
    <p class="esq-funcion">${esc(o.funcion)}</p>
    <div class="esq-dos">
      <div><h4>Virtudes</h4><ul>${o.virtudes.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>
      <div><h4>Qué hace</h4><ul>${o.hace.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>
    </div>
    <footer class="esq-pie">
      <span>🕑 ${esc(o.cuando)}</span>
      ${semana.length ? `<span>📈 ${semana.map((s) => `<b>${s.n}</b> ${esc(s.etiqueta)}`).join(' · ')} <small class="tenue">(7 días)</small></span>` : ''}
      ${o.erroresSemana ? `<span class="esq-err">⚠ ${o.erroresSemana} error${o.erroresSemana === 1 ? '' : 'es'} esta semana</span>` : ''}
      ${cadena}
      ${o.propuesta ? `<span>Fragua #${o.propuesta}</span>` : ''}
    </footer>
    <div class="fila esq-acciones">
      ${o.forja ? `<button class="btn btn-primario btn-chico" data-esq-forjar="${esc(o.id)}">⚒ Forjar ${esc(o.nombre)}</button>` : ''}
      ${o.vista ? `<button class="btn btn-chico" data-esq-ver="${esc(o.vista)}">Verlo trabajar</button>` : ''}
    </div>
  </article>`
}

function conectarFichas(raiz) {
  $$('[data-esq-forjar]', raiz).forEach((b) => (b.onclick = () => forjarPropuesto(b.dataset.esqForjar)))
  $$('[data-esq-ver]', raiz).forEach((b) => (b.onclick = () => {
    cerrarModal()
    if (b.dataset.esqVer === 'modal:cuaderno') return modalCuadernoVivo()
    irA(b.dataset.esqVer)
  }))
}

/** Un propuesto pasa a la Forja con su clase, sus instrucciones y su celda: él revisa y forja. */
function forjarPropuesto(id) {
  const o = esq.datos?.organos.find((x) => x.id === id)
  if (!o?.forja) return
  forja.clase = o.forja.clase
  forja.instrucciones = o.forja.instrucciones
  forja.celda = o.celda
  forja.reparto = {}
  cerrarModal()
  irA('forja')
  toast(`⚒ ${esc(o.nombre)} listo para forjar: revisá y apretá Forjar.`)
}

function modalCeldaEsqueleto(n) {
  const d = esq.datos
  const di = Math.floor((n - 1) / 9), oficio = (n - 1) % 9
  const os = d.organos.filter((o) => o.celda === n)
  const cs = (E.roster ?? []).filter((f) => f.celda === n)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button>
    <h2>⬡ ${String(n).padStart(2, '0')} · ${esc(d.dominios[di])} · ${OFICIO_LARGO[oficio]}</h2>
    ${!os.length && !cs.length ? '<p class="tenue">Celda vacía: hay geometría, no hay acto.</p>' : ''}
    ${os.length ? `<div class="esq-fichas esq-fichas-modal">${os.map(fichaOrgano).join('')}</div>` : ''}
    ${cs.length ? `<h3 class="sub">Cartas de la liga</h3><div class="mazo">${cs.map(cartaHTML).join('')}</div>` : ''}
    <div class="fila mt-4"><button class="btn" id="esq-forjar-aqui">⚒ Forjar un agente en esta celda</button></div>`)
  $('#modal').classList.add('modal-ancho')
  conectarFichas($('#modal'))
  $$('#modal [data-agente]').forEach((a) => (a.onclick = () => modalAgente(a.dataset.agente)))
  $('#esq-forjar-aqui').onclick = () => { forja.celda = n; cerrarModal(); irA('forja') }
}
