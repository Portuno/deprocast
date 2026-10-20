'use strict'
// Para decidir: todo lo que Mastropiero propone y espera tu ok, en un solo lugar (lo que más bloquea primero), lo que
// hizo solo hoy (con ↩) y cuánto acierta cada clase de cosa. Lo que acierta casi siempre te lo ofrece hacer solo: nunca
// pasa a «auto» sin tu ok, y siempre se deshace.

const MODOS_SOMBRA = [['sombra', 'Propone y espera'], ['auto', 'Lo hace solo'], ['manual', 'Siempre pregunta']]

async function modalBandeja() {
  let b, s
  try { [b, s] = await Promise.all([api('/bandeja'), api('/sombra')]) } catch (e) { return error(e) }
  const hora = (ms) => new Date(ms).toTimeString().slice(0, 5)
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>📥 Para decidir</h2>
    <p class="tenue">Lo que te propuse y espera tu ok. Cada cosa que decidís me enseña cuánto acierto: lo que acierto casi siempre te lo ofrezco hacer solo.</p>
    ${b.ofertas.length ? b.ofertas.map((o) => `<div class="bj-oferta"><span>🎯 <b>${esc(o.nombre)}</b>: acerté ${o.aciertos} de ${o.n} (${Math.round((o.tasa ?? 0) * 100)} %). ¿Lo hago solo? Siempre deshacible.</span><button class="btn btn-chico btn-primario" data-bj-auto="${esc(o.tipo)}">Sí, solo</button></div>`).join('') : ''}
    ${b.grupos.length ? b.grupos.map((g) => `<section class="bj-grupo"><h3>${esc(g.nombre)} <small class="tenue">${g.n}</small></h3>
        ${g.items.length ? g.items.map((i) => `<div class="bj-item" data-bj-tipo="${g.tipo}" data-bj-id="${esc(i.id)}"><div><span>${esc(i.texto)}</span>${i.sub ? `<small class="tenue">${esc(String(i.sub).slice(0, 140))}</small>` : ''}</div>
          <span class="bj-acc">${g.acciones.map(([a, t]) => `<button class="btn btn-chico ${a === 'aceptar' ? 'btn-primario' : ''}" data-bj-acc="${a}">${t}</button>`).join('')}</span></div>`).join('')
          : `<button class="btn btn-chico" data-bj-ir="${g.ir}">Abrir →</button>`}
        ${g.items.length && g.n > g.items.length ? `<small class="tenue">y ${g.n - g.items.length} más</small>` : ''}</section>`).join('')
      : '<div class="vacio"><div class="gran">✓</div><h2>Nada esperando tu ok</h2></div>'}
    ${b.hechoSolo.length ? `<section class="bj-grupo"><h3>🤖 Lo que hice solo hoy <small class="tenue">${b.hechoSolo.length}</small></h3>
      ${b.hechoSolo.map((d) => `<div class="bj-item"><div><span>${esc(d.texto ?? d.nombre)}</span><small class="tenue">${esc(d.nombre)} · ${hora(d.en)}${d.confianza != null ? ` · confianza ${Math.round(d.confianza * 100)} %` : ''}</small></div><span class="bj-acc"><button class="btn btn-chico" data-bj-deshacer="${d.id}" title="Deshacer (cuenta como error: la próxima voy con más cuidado)">↩</button></span></div>`).join('')}</section>` : ''}
    <details class="bj-acierto" ${s.tipos.length ? '' : 'hidden'}><summary>Cómo acierto, por clase de cosa</summary>
      <table><thead><tr><th>Qué</th><th>Acierto</th><th>Últimas</th><th>Modo</th></tr></thead><tbody>
      ${s.tipos.map((t) => `<tr><td>${esc(t.nombre)}</td><td>${t.tasa == null ? '—' : `${Math.round(t.tasa * 100)} %`}<small class="tenue"> (≥ ${Math.round(t.cota * 100)} %)</small></td><td>${t.n}</td>
        <td><select class="campo-suelto" data-bj-modo="${esc(t.tipo)}">${MODOS_SOMBRA.filter(([m]) => m !== 'auto' || t.puedeAuto).map(([m, nom]) => `<option value="${m}" ${t.modo === m ? 'selected' : ''}>${nom}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table>
      <p class="tenue chico">El acierto es sobre las últimas 100: aceptado tal cual (o hecho solo y no deshecho) cuenta a favor; editado, rechazado o deshecho, en contra. Entre paréntesis, el piso con 95 % de confianza: te ofrezco hacerlo solo cuando ese piso llega a 95 % (unos 80 aciertos casi seguidos).</p>
    </details>`)
  const recargar = async () => { await modalBandeja(); if (vista === 'hoy') traerHoy() }
  $$('[data-bj-acc]').forEach((btn) => (btn.onclick = async () => {
    const it = btn.closest('[data-bj-tipo]')
    try { await api(`/bandeja/${it.dataset.bjTipo}/${it.dataset.bjId}`, { accion: btn.dataset.bjAcc }); it.remove() } catch (e) { error(e) }
  }))
  $$('[data-bj-deshacer]').forEach((btn) => (btn.onclick = async () => { try { await api(`/decisiones/${btn.dataset.bjDeshacer}/deshacer`, {}); toast('↩ Deshecho', 'suave'); recargar() } catch (e) { error(e) } }))
  $$('[data-bj-auto]').forEach((btn) => (btn.onclick = async () => { try { await api('/sombra', { tipo: btn.dataset.bjAuto, modo: 'auto' }); toast('🤖 De ahora en más lo hago solo', 'suave'); recargar() } catch (e) { error(e) } }))
  $$('[data-bj-modo]').forEach((sel) => (sel.onchange = async () => { try { await api('/sombra', { tipo: sel.dataset.bjModo, modo: sel.value }); toast('Guardado', 'suave') } catch (e) { error(e) } }))
  $$('[data-bj-ir]').forEach((btn) => (btn.onclick = () => { cerrarModal(); btn.dataset.bjIr === 'takeout' ? modalTakeout() : irA(btn.dataset.bjIr) }))
}
