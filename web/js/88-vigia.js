'use strict'
// La máquina → Estado: la salud de Deprocast en vivo (el vigía). Cada pieza con su estado, el gasto de hoy y del mes,
// los errores de las últimas 24 horas, y el aviso por WhatsApp cuando algo se rompe. Se refresca solo cada minuto.

let vigiaReloj = null
const VIGIA_ROTULO = { bien: 'bien', ojo: 'ojo', mal: 'mal' }

async function montarVigia() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Estado</h1><p>Cómo está Deprocast ahora: cada pieza, el gasto y los errores. Si algo se rompe, te avisa por WhatsApp (una vez cada 12 horas por problema).</p></div>
    <div id="vigia"><p class="tenue">Mirando…</p></div>`
  await pintarVigia()
  clearInterval(vigiaReloj)
  vigiaReloj = setInterval(() => { if (vista !== 'vigia') return clearInterval(vigiaReloj); if (!document.hidden) pintarVigia() }, 60_000)
}

async function pintarVigia() {
  let d
  try { d = await api('/vigia') } catch (e) { return error(e) }
  if (vista !== 'vigia' || !$('#vigia')) return
  const credito = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : `${Math.round(n / 1000).toLocaleString('es-AR')} mil`)
  const pc = (x) => (x.entrada ? `${Math.round((x.cache / x.entrada) * 100)} %` : '—')
  $('#vigia').innerHTML = `
    <div class="vg-resumen vg-${d.estado}"><b>${d.estado === 'bien' ? 'Todo anda' : d.estado === 'ojo' ? 'Anda, con cosas para mirar' : 'Hay algo roto'}</b>
      <span class="tenue chico">Mirado ${new Date(d.en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · se actualiza solo</span>
      <label class="fila g-1 chico"><input type="checkbox" id="vg-avisos" ${d.avisos ? 'checked' : ''}> Avisarme por WhatsApp</label></div>
    <div class="vg-piezas">${d.piezas.map((p) => `<div class="vg-pieza"><div class="vg-cab"><b>${esc(p.nombre)}</b><span class="vg-chip vg-${p.estado}">${VIGIA_ROTULO[p.estado]}</span></div>
      <p class="tenue chico">${esc(p.detalle)}</p>${p.problemas.length ? `<ul class="vg-problemas">${p.problemas.map((x) => `<li>${esc(x.texto)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
    <h3 class="tl-h">Gasto</h3>
    <div class="vg-tabla"><table><thead><tr><th></th><th class="n">Llamadas</th><th class="n">Tokens</th><th class="n">Caché</th><th class="n">Créditos</th></tr></thead><tbody>
      <tr><td>Hoy</td><td class="n">${d.gasto.hoy.llamadas.toLocaleString('es-AR')}</td><td class="n">${tokens(d.gasto.hoy.entrada + d.gasto.hoy.salida)}</td><td class="n">${pc(d.gasto.hoy)}</td><td class="n">${credito(d.gasto.hoy.creditos)}</td></tr>
      <tr><td>Hoy, el chat</td><td class="n">${d.gasto.chatHoy.llamadas.toLocaleString('es-AR')}</td><td class="n">${tokens(d.gasto.chatHoy.entrada + d.gasto.chatHoy.salida)}</td><td class="n">${pc(d.gasto.chatHoy)}</td><td class="n">${credito(d.gasto.chatHoy.creditos)}</td></tr>
      <tr><td>Este mes</td><td class="n">${d.gasto.mes.llamadas.toLocaleString('es-AR')}</td><td class="n">${tokens(d.gasto.mes.entrada + d.gasto.mes.salida)}</td><td class="n">${pc(d.gasto.mes)}</td><td class="n">${credito(d.gasto.mes.creditos)}</td></tr>
    </tbody></table></div>
    <h3 class="tl-h">Errores de las últimas 24 horas</h3>
    ${d.errores.length ? `<div class="vg-tabla"><table><thead><tr><th class="n">Veces</th><th>Qué</th><th>Dónde</th><th>Último</th></tr></thead><tbody>${d.errores.map((e) => `<tr class="${e.propio ? '' : 'tenue'}"><td class="n">${e.veces}</td><td>${esc(e.texto)}</td><td class="chico">${esc(e.donde)}</td><td class="chico">${esc(haceCuanto(e.ultima))}</td></tr>`).join('')}</tbody></table></div><p class="tenue chico">En gris, los que se recuperaron solos o vienen de servicios de afuera.</p>` : '<p class="tenue">Ninguno.</p>'}`
  $('#vg-avisos').onchange = async (ev) => { try { await api('/vigia/avisos', { prender: ev.target.checked }); toast(ev.target.checked ? 'Te aviso por WhatsApp si algo se rompe' : 'Sin avisos por WhatsApp', 'suave') } catch (e) { error(e) } }
}
