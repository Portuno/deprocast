'use strict'
// Agentes → Corridas (Fragua #262): la liga como juego. Cada arquetipo con agentes en su celda tiene su corrida: época,
// avatar geométrico (Punto → Hexágono, diez puntos por nivel), influencia, tienda, artefactos y diario. Cada punto es
// algo hecho de verdad por sus agentes (una línea positiva de la economía de la semana).

const jg = { datos: null }

async function montarJuego() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Corridas</h1><p>Cada arquetipo con agentes en su celda juega su corrida. Los puntos salen solo de lo que sus agentes hicieron de verdad; cada diez, un nivel (Punto, Línea, Triángulo, Cuadrado, Pentágono, Hexágono), y cada nivel desbloquea algo real. Al completar el Hexágono cierra la época. Si se queda sin agentes activos o quiebra dos semanas seguidas, la corrida se pierde y vuelve a empezar con un legado; los artefactos quedan.</p></div></div>
    <div id="jg"><p class="tenue">Mirando…</p></div>`
  await traerJuego()
}

async function traerJuego() {
  try { jg.datos = await api('/juego') } catch (e) { return error(e) }
  if (vista !== 'juego' || !$('#jg')) return
  pintarJuego()
}

/** El avatar: la figura del nivel (un punto, una línea, o el polígono de n lados), con el avance del nivel abajo. */
function avatarJuego(nivel, enNivel) {
  const c = 40, r = 26
  const pts = (k) => Array.from({ length: k }, (_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / k; return `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}` }).join(' ')
  const figura = nivel === 1 ? `<circle class="jg-fig" cx="${c}" cy="${c}" r="6"></circle>`
    : nivel === 2 ? `<line class="jg-fig" x1="${c - r}" y1="${c}" x2="${c + r}" y2="${c}"></line>`
      : `<polygon class="jg-fig" points="${pts(nivel)}"></polygon>`
  return `<svg class="jg-avatar" viewBox="0 0 80 92" width="80" height="92" role="img" aria-label="Nivel ${nivel} de 6, ${enNivel} de 10 puntos">${figura}
    <rect class="jg-barra-fondo" x="10" y="84" width="60" height="4" rx="2"></rect><rect class="jg-barra" x="10" y="84" width="${Math.max(0, Math.min(60, (enNivel / 10) * 60)).toFixed(1)}" height="4" rx="2"></rect></svg>`
}

function pintarJuego() {
  const d = jg.datos
  const num = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  const ranking = d.ranking.length ? `<details class="jg-ranking" open><summary class="tl-h">Ranking de agentes · semana ${esc(d.semana)}</summary><ol>${d.ranking.slice(0, 10).map((r) => `<li><b>${esc(r.nombre)}</b> <span class="tenue">${r.arquetipo ? `arquetipo ${r.arquetipo}` : 'sin arquetipo'}</span> <span class="jg-pts">${num(r.puntos)} pts</span><small class="tenue" title="${esc(r.detalle.join('\n'))}">${esc(r.detalle.slice(0, 2).join(' · '))}${r.detalle.length > 2 ? '…' : ''}</small></li>`).join('')}</ol></details>` : '<p class="tenue chico">Esta semana ningún agente sumó todavía.</p>'
  $('#jg').innerHTML = `${ranking}
    ${d.arquetipos.length ? `<div class="jg-grilla">${d.arquetipos.map((a, i) => {
      const tienda = Object.entries(d.tienda).map(([k, t]) => { const abierto = a.alcanzado >= t.nivel, alcanza = a.influencia >= t.costo
        return `<button class="btn btn-chico" data-jg-comprar="${k}" data-jg-arq="${a.arquetipo}" ${abierto && alcanza ? '' : 'disabled'} title="${esc(t.que)}${abierto ? (alcanza ? '' : ` · te faltan ${num(t.costo - a.influencia)}`) : ` · se abre en el ${d.geometria[t.nivel - 1].nombre}`}">${abierto ? '' : '🔒 '}${esc(t.nombre)} · ${t.costo}</button>` }).join('')
      return `<article class="jg-carta">
        <div class="jg-cab">${avatarJuego(a.nivel, a.enNivel)}
          <div><small class="tenue">#${i + 1} · arquetipo ${a.arquetipo}${a.fila ? ` · fila ${a.fila}, columna ${a.columna}` : ''}</small>
            <h3>${esc(a.nombre ?? a.oficio ?? `Arquetipo ${a.arquetipo}`)}</h3>
            <p class="jg-linea">Corrida ${a.numero} · época ${a.epoca} · <b>${esc(a.geometria.nombre)}</b> (${num(a.enNivel)}/10)</p>
            <p class="jg-linea tenue">${num(a.puntos)} pts · influencia <b>${num(a.influencia)}</b>${a.recibido ? ` (${num(a.recibido)} de sus vecinos)` : ''}${a.legado ? ` · legado ${num(a.legado)}` : ''}${a.monedero ? ` · monedero ${num(a.monedero)} €` : ''}</p></div></div>
        <ul class="jg-niveles">${d.geometria.map((g) => `<li class="${a.alcanzado >= g.n ? 'si' : ''}" title="${esc(g.desbloquea)}"><span>${a.alcanzado >= g.n ? '✓' : '🔒'}</span> ${esc(g.nombre)}</li>`).join('')}</ul>
        <div class="jg-agentes">${a.agentes.map((x) => `<span class="tipo-chip ${x.estado === 'banca' ? 'tenue' : ''}" title="${esc(x.clase)} · ${esc(x.estado)}">${esc(x.nombre)}${x.estado === 'banca' ? ' · banca' : ''}</span>`).join('')}${Object.keys(a.misiones).length ? `<small class="tenue">misiones: ${Object.entries(a.misiones).map(([k, n]) => `${n} ${k}`).join(', ')}</small>` : ''}</div>
        <div class="jg-tienda">${tienda}</div>
        ${a.vecinos.length ? `<p class="tenue chico">En red con: ${a.vecinos.map((v) => `arquetipo ${v}`).join(', ')}${a.alcanzado >= 4 ? '' : ' (reparte desde el Cuadrado)'}</p>` : ''}
        ${a.artefactos.length ? `<details><summary class="chico">🏺 ${a.artefactos.length} artefacto${a.artefactos.length === 1 ? '' : 's'}</summary><ul class="jg-lista">${a.artefactos.map((x) => `<li><b>${esc(x.nombre)}</b> <small class="tenue">época ${x.epoca} · ${esc(x.de_que)}</small></li>`).join('')}</ul></details>` : ''}
        ${a.diario.length ? `<details><summary class="chico">Diario de la corrida</summary><ul class="jg-lista">${a.diario.map((x) => `<li><small class="tenue">${esc(new Date(x.en).toLocaleDateString('es-AR'))} · c${x.numero} · época ${x.epoca}</small> ${esc(x.texto)}${x.costo ? ` <small class="tenue">(−${x.costo})</small>` : ''}</li>`).join('')}</ul></details>` : ''}
        ${a.anteriores.length ? `<details><summary class="chico">${a.anteriores.length} corrida${a.anteriores.length === 1 ? '' : 's'} perdida${a.anteriores.length === 1 ? '' : 's'}</summary><ul class="jg-lista">${a.anteriores.map((x) => `<li>Corrida ${x.numero}: ${esc(x.causa ?? '')} <small class="tenue">${esc(new Date(x.terminada).toLocaleDateString('es-AR'))}</small></li>`).join('')}</ul></details>` : ''}
      </article>` }).join('')}</div>` : '<p class="tenue">Ningún arquetipo en juego todavía. Un arquetipo entra cuando tiene agentes en su celda (en la Forja, al forjar, o cambiando la celda de un agente).</p>'}
    <details class="jg-reglas"><summary class="tl-h">Qué desbloquea cada nivel</summary><ul class="jg-lista">${d.geometria.map((g) => `<li><b>${esc(g.nombre)}</b> (${(g.n - 1) * d.reglas.puntosNivel}–${g.n * d.reglas.puntosNivel - 1} pts): ${esc(g.desbloquea)}</li>`).join('')}</ul></details>`
  $$('[data-jg-comprar]').forEach((b) => (b.onclick = () => comprarEnJuego(Number(b.dataset.jgArq), b.dataset.jgComprar)))
}

function comprarEnJuego(arq, item) {
  const d = jg.datos
  const a = d.arquetipos.find((x) => x.arquetipo === arq)
  const t = d.tienda[item]
  const agentes = item === 'indulto' ? a.agentes.filter((x) => x.estado === 'banca') : a.agentes
  const campos = item === 'fichaje'
    ? `<label class="campo">Clase<select name="clase">${d.clases.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>`
    : `<label class="campo">Agente<select name="agente">${agentes.map((x) => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('')}</select></label>
       ${item === 'entrenamiento' ? `<label class="campo">Atributo<select name="atributo">${d.atributos.map((x) => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('')}</select></label>` : ''}`
  if (item !== 'fichaje' && !agentes.length) return toast(item === 'indulto' ? 'No tiene agentes en la banca' : 'No tiene agentes', 'suave')
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${esc(t.nombre)}</h2>
    <p class="tenue">${esc(t.que)}. Cuesta ${t.costo} de influencia (tiene ${a.influencia}). Lo hace de verdad.</p>
    <form id="jg-compra" class="lg-ficha">${campos}<div class="fila"><button class="btn btn-primario">Comprar</button></div></form>`)
  $('#jg-compra').onsubmit = async (ev) => {
    ev.preventDefault()
    try {
      const r = await api(`/juego/${arq}/comprar`, { item, ...Object.fromEntries(new FormData(ev.target)) })
      cerrarModal()
      toast(esc(r.texto), 'suave')
      traerJuego()
    } catch (e) { error(e) }
  }
}
