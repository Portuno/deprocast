'use strict'
// Encargos programados (plan v35, fase 7): lo que Mastropiero hace solo, cada tanto, y te deja el informe (en Hoy, de
// ahí a Telegram o WhatsApp, y si querés en tu Drive). El reemplazo de los agentes ejecutivos de Grok.

const EJEMPLOS_PROGRAMADO = [
  ['Cada lunes a las 9', 'Revisá qué se publicó esta semana sobre inteligencia artificial y política en España y resumime lo importante, con links.'],
  ['De lunes a viernes a las 8', 'Mirá mis mails de las últimas 24 horas y decime cuáles necesitan respuesta hoy.'],
  ['El 1 de cada mes a las 10', 'Hacé el balance de mis gastos del mes pasado contra mi meta y decime dónde se fue la plata.'],
]

async function montarProgramados() {
  $('#principal').innerHTML = `<div class="programados">
    <div class="titulo"><h1>Encargos programados</h1><p>Lo que Mastropiero hace solo, cada tanto: busca, lee tu correo o tu Drive, compara con la vez anterior y te deja el informe en Hoy (y por ahí en Telegram o WhatsApp). También se los podés pedir en el chat: «todos los lunes a las 9 revisá…».</p></div>
    <form id="prg-nuevo" class="prg-form tarjeta">
      <label class="campo">Qué tiene que hacer<textarea name="pedido" rows="3" required placeholder="Como se lo pedirías: «Revisá qué salió sobre… y resumime lo importante, con links»"></textarea></label>
      <div class="prg-fila">
        <label class="campo">Cuándo<input name="cuando" required placeholder="todos los días a las 8 · los lunes 9:30 · cada 6 horas" autocomplete="off"><small class="tenue" id="prg-cuando"></small></label>
        <label class="campo">Nombre (opcional)<input name="titulo" placeholder="Resumen de IA" autocomplete="off"></label>
      </div>
      <label class="fila g-1 chico"><input type="checkbox" name="drive"> Guardar también cada informe en mi Drive (Mastropiero/Informes)</label>
      <div class="fila"><button class="btn btn-primario">Programar</button><span class="tenue chico">Ideas: ${EJEMPLOS_PROGRAMADO.map(([c], i) => `<button type="button" class="btn-link" data-prg-ej="${i}">${esc(c)}</button>`).join(' · ')}</span></div>
    </form>
    <div id="prg-lista" class="prg-lista"><p class="tenue">Cargando…</p></div>
  </div>`
  const f = $('#prg-nuevo')
  f.cuando.onblur = async () => {
    const v = f.cuando.value.trim()
    if (!v) return ($('#prg-cuando').textContent = '')
    try { const r = await api('/programados/interpretar', { cuando: v }); $('#prg-cuando').textContent = `✓ ${r.cuando} · el próximo: ${new Date(r.proximo).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` } catch (e) { $('#prg-cuando').textContent = e.message ?? String(e) }
  }
  $$('[data-prg-ej]').forEach((b) => (b.onclick = () => { const [c, p] = EJEMPLOS_PROGRAMADO[Number(b.dataset.prgEj)]; f.cuando.value = c; f.pedido.value = p; f.cuando.onblur() }))
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    const d = Object.fromEntries(new FormData(f))
    try { const p = await api('/programados', { ...d, drive: !!d.drive }); toast(`Programado<small>${esc(p.cuandoTexto)}</small>`, 'suave'); f.reset(); $('#prg-cuando').textContent = ''; pintarProgramados() } catch (e) { error(e) }
  }
  pintarProgramados()
}

async function pintarProgramados() {
  const cont = $('#prg-lista')
  if (!cont) return
  let ps
  try { ps = await api('/programados') } catch (e) { return error(e) }
  const fecha = (ms) => (ms ? new Date(ms).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
  cont.innerHTML = ps.length ? ps.map((p) => `<article class="tarjeta prg-item ${p.activo ? '' : 'pausado'}" data-prg="${p.id}">
      <header class="fila entre"><h3>${esc(p.titulo)}</h3><span class="chip">${p.activo ? esc(p.cuandoTexto) : 'en pausa'}</span></header>
      <p class="tenue chico">${esc(p.pedido)}</p>
      <p class="chico">${p.activo ? `Próximo: <b>${fecha(p.proximo)}</b> · ` : ''}Último: ${fecha(p.ultimo)}${p.drive ? ' · también a tu Drive' : ''}${p.error ? ` · <span class="mal">falló: ${esc(p.error)}</span>` : ''}</p>
      ${p.resultado ? `<details class="prg-informe"><summary>El último informe</summary><div class="prg-texto">${esc(p.resultado)}</div></details>` : ''}
      <div class="fila"><button class="btn btn-chico" data-prg-correr>▶ Correr ahora</button><button class="btn btn-chico" data-prg-pausa>${p.activo ? 'Pausar' : 'Reanudar'}</button><button class="btn btn-chico btn-peligro" data-prg-borrar>Borrar</button></div>
    </article>`).join('') : '<div class="vacio"><p>Todavía no hay encargos programados. Probá con una de las ideas de arriba.</p></div>'
  $$('[data-prg]', cont).forEach((el) => {
    const id = Number(el.dataset.prg)
    const p = ps.find((x) => x.id === id)
    $('[data-prg-correr]', el).onclick = async (e) => {
      e.target.disabled = true
      e.target.textContent = 'Corriendo…'
      try { await api(`/programados/${id}/correr`, {}); toast('Lo estoy haciendo<small>El informe llega a Hoy en unos minutos.</small>') ; esperarProgramado(id, p.ultimo) } catch (x) { error(x); e.target.disabled = false }
    }
    $('[data-prg-pausa]', el).onclick = async () => { try { await api(`/programados/${id}`, { activo: !p.activo }); pintarProgramados() } catch (x) { error(x) } }
    $('[data-prg-borrar]', el).onclick = async () => { if (!(await confirmar(`¿Borrar «${p.titulo}»?`, { si: 'Borrar', peligro: true }))) return; try { await api(`/programados/${id}/borrar`, {}); pintarProgramados() } catch (x) { error(x) } }
  })
}

/** Después de «Correr ahora»: se fija cada 10 s hasta que llega el informe (o 10 minutos). */
async function esperarProgramado(id, ultimoAntes) {
  for (let i = 0; i < 60; i++) {
    await dormir(10_000)
    if (vista !== 'programados') return
    const ps = await api('/programados').catch(() => null)
    const p = ps?.find((x) => x.id === id)
    if (p && p.ultimo !== ultimoAntes) return pintarProgramados()
  }
}
