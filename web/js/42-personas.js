'use strict'
// Personas: su gente como relaciones (vínculo, cada cuánto, último contacto, lo pendiente, lo que les asignó).

const VINCULOS = ['familia', 'pareja', 'amistad', 'trabajo', 'proyecto', 'mentor', 'contacto']
let perFiltro = ''
let perSolo = 'todas'

function montarPersonas() {
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Personas</h1><p>Tu gente, el vínculo y cada cuánto querés saber de cada una.</p></div>
      <div class="fila"><input id="per-q" placeholder="Buscar…" value="${esc(perFiltro)}">
        <select id="per-solo"><option value="todas">Todas</option><option value="definidas">Con relación definida</option><option value="vencidas">A contactar</option></select></div></div>
    <div id="per-puentes"></div>
    <div class="per-grid" id="per-grid"></div>`
  $('#per-solo').value = perSolo
  let t
  $('#per-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { perFiltro = e.target.value; refrescarPersonas() }, 250) }
  $('#per-solo').onchange = (e) => { perSolo = e.target.value; refrescarPersonas() }
  refrescarPersonas()
  pintarPuentes()
}

async function pintarPuentes() {
  const cont = $('#per-puentes')
  if (!cont) return
  let ps
  try { ps = await api('/puentes') } catch { return }
  const tarjetas = ps.map((p) => `<div class="per" data-puente="${p.id}"><div class="per-cab"><span class="chip">${p.tipo === 'presentar' ? 'presentar' : 'retomar'}</span><b>${p.personas.map((x) => `<a href="#" class="ref" data-ref-ent="${x.id}">${esc(x.nombre)}</a>`).join(' ↔ ')}</b></div>
      <div>${esc(p.motivo)}</div>${p.mensaje ? `<details><summary class="tenue">Borrador</summary><p>${esc(p.mensaje)}</p><button class="btn btn-chico" data-copiar>Copiar</button></details>` : ''}
      <div class="fila"><button class="btn btn-chico" data-hecho>Hecho</button><button class="btn btn-chico" data-descartar>Descartar</button></div></div>`).join('')
  cont.innerHTML = `<div class="puentes"><div class="puentes-cab"><div><h3>Puentes</h3><p>A quién presentar o con quién retomar. Nada se manda solo.</p></div><button class="btn btn-chico" id="pu-proponer">Proponer puentes</button></div>
    <div class="puentes-lista">${tarjetas || '<p class="tenue">Ninguno pendiente.</p>'}</div></div>`
  $('#pu-proponer').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Mirando tu gente…'; try { await api('/puentes', {}); pintarPuentes() } catch (err) { error(err); e.target.disabled = false; e.target.textContent = 'Proponer puentes' } }
  $$('[data-puente]', cont).forEach((el) => {
    const p = ps.find((x) => x.id === Number(el.dataset.puente))
    const marcar = async (estado) => { try { await api(`/puentes/${p.id}`, { estado }); pintarPuentes(); refrescarPersonas() } catch (e) { error(e) } }
    $('[data-hecho]', el).onclick = () => marcar('hecho')
    $('[data-descartar]', el).onclick = () => marcar('descartado')
    const c = $('[data-copiar]', el)
    if (c) c.onclick = () => navigator.clipboard?.writeText(p.mensaje).then(() => toast('Copiado'), () => {})
  })
}

async function refrescarPersonas() {
  const cont = $('#per-grid')
  if (!cont) return
  let ps
  try { ps = await api(`/personas${perFiltro ? `?q=${encodeURIComponent(perFiltro)}` : ''}`) } catch (e) { return error(e) }
  if (perSolo === 'definidas') ps = ps.filter((p) => p.vinculo || p.cadaDias || p.proxima)
  if (perSolo === 'vencidas') ps = ps.filter((p) => p.vencida)
  if (!ps.length) return void (cont.innerHTML = '<p class="vacio">Nadie por acá todavía. Las personas aparecen cuando cargás material o las nombrás.</p>')
  cont.innerHTML = ps.map((p) => `
    <div class="per ${p.vencida ? 'vencida' : ''}" data-id="${p.id}">
      <div class="per-cab"><b><a href="#" class="ref" data-ref-ent="${p.id}">${esc(p.nombre)}</a></b>${p.vinculo ? `<span class="chip">${esc(p.vinculo)}</span>` : ''}${p.cercania ? `<span class="tenue">${'●'.repeat(p.cercania)}${'○'.repeat(5 - p.cercania)}</span>` : ''}</div>
      <div class="tenue">${p.ultimoContacto ? `Último contacto: ${esc(p.ultimoContacto)} (hace ${p.diasSinContacto} d)` : 'Sin contacto registrado'}${p.cadaDias ? ` · quería cada ${p.cadaDias} d` : ''} · ${p.menciones} piezas</div>
      ${p.proxima ? `<div>Próximo: ${esc(p.proxima)}</div>` : ''}
      ${p.misiones.length ? `<div class="tenue">Le asignaste: ${p.misiones.map((m) => esc(m.titulo)).join(' · ')}</div>` : ''}
      ${p.notas ? `<div class="tenue recorte">${esc(p.notas)}</div>` : ''}
      <div class="fila"><button class="btn btn-chico" data-contacto>Hablamos hoy</button><button class="btn btn-chico" data-editar>Editar</button></div>
    </div>`).join('')
  $$('.per', cont).forEach((el) => {
    const p = ps.find((x) => x.id === Number(el.dataset.id))
    $('[data-contacto]', el).onclick = async () => { try { await api(`/personas/${p.id}`, { contacto: true }); refrescarPersonas() } catch (e) { error(e) } }
    $('[data-editar]', el).onclick = () => editarPersona(p)
  })
}

function editarPersona(p) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${esc(p.nombre)}</h2>
    <form id="per-form" class="campo">
      <label>Vínculo <select name="vinculo"><option value="">—</option>${VINCULOS.map((v) => `<option ${p.vinculo === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Cercanía (1–5) <input name="cercania" type="number" min="1" max="5" value="${p.cercania ?? ''}"></label>
      <label>Cada cuántos días querés saber de ${esc(p.nombre)} <input name="cadaDias" type="number" min="0" value="${p.cadaDias ?? ''}" placeholder="vacío = sin ritmo"></label>
      <label>Lo próximo <input name="proxima" value="${esc(p.proxima ?? '')}" placeholder="devolverle el libro, invitarla a…"></label>
      <label>Notas <textarea name="notas" rows="3">${esc(p.notas ?? '')}</textarea></label>
      <label>Último contacto <input name="contacto" type="date" value="${esc(p.ultimoContacto ?? '')}"></label>
      <button class="btn btn-primario">Guardar</button>
    </form>`)
  $('#per-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    if (!f.contacto || f.contacto === p.ultimoContacto) delete f.contacto
    try { await api(`/personas/${p.id}`, f); cerrarModal(); refrescarPersonas() } catch (e) { error(e) }
  }
}
