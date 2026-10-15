'use strict'
// Personas: vos primero, y después tu gente. Tres clases (físicas, jurídicas, ficticias), dos números del 1 al 12
// (nivel de contacto: cuánto la conocés; importancia en tu vida), conocidas o por conocer, y en qué proyectos está.

const VINCULOS = ['familia', 'pareja', 'amistad', 'trabajo', 'proyecto', 'mentor', 'contacto']
const CLASES_PER = { fisica: 'Física', juridica: 'Jurídica', ficticia: 'Ficticia' }
const ESTADOS_PER = { conocida: 'Conocida', contactada: 'Contactada', por_conocer: 'Por conocer' }
const per = { q: '', solo: 'todas', clase: '', estado: '', orden: '' }

function montarPersonas() {
  Object.assign(per, JSON.parse(pref.leer('mastro-personas', '{}') || '{}'))
  $('#principal').innerHTML = `
    <div class="cabecera"><div class="cabecera-texto"><h1>Personas</h1><p>Vos primero; después tu gente: cuánto la conocés, cuánto importa y en qué proyectos está.</p></div>
      <div class="fila"><button class="btn btn-chico" id="per-grafo" title="Tu gente como red: quién se relaciona con quién">☍ Red</button><button class="btn btn-primario btn-chico" id="per-nueva">＋ Persona</button></div></div>
    <div id="per-yo"></div>
    <div class="fila per-filtros">
      <input class="campo-suelto" id="per-q" placeholder="Buscar…" value="${esc(per.q)}">
      <select class="campo-suelto" id="per-clase"><option value="">Todas las clases</option>${Object.entries(CLASES_PER).map(([k, n]) => `<option value="${k}">${n}s</option>`).join('')}</select>
      <select class="campo-suelto" id="per-estado"><option value="">Conocidas y no</option>${Object.entries(ESTADOS_PER).map(([k, n]) => `<option value="${k}">${n}s</option>`).join('')}</select>
      <select class="campo-suelto" id="per-orden"><option value="">Orden: lo definido primero</option><option value="nivel">Por nivel de contacto</option><option value="importancia">Por importancia</option><option value="contacto">Por último contacto</option><option value="proyecto">Por proyecto</option></select>
      <select class="campo-suelto" id="per-solo"><option value="todas">Todas</option><option value="definidas">Con relación definida</option><option value="vencidas">A contactar</option></select>
    </div>
    <div id="per-puentes"></div>
    <div id="per-grid"></div>`
  for (const k of ['clase', 'estado', 'orden', 'solo']) {
    $(`#per-${k}`).value = per[k]
    $(`#per-${k}`).onchange = (e) => { per[k] = e.target.value; guardarFiltrosPer(); refrescarPersonas() }
  }
  let t
  $('#per-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { per.q = e.target.value; refrescarPersonas() }, 250) }
  $('#per-nueva').onclick = modalNuevaPersona
  $('#per-grafo').onclick = modalGrafo
  pintarYo()
  refrescarPersonas()
  pintarPuentes()
}

const guardarFiltrosPer = () => pref.guardar('mastro-personas', JSON.stringify({ clase: per.clase, estado: per.estado, orden: per.orden, solo: per.solo }))

// ─── vos ────────────────────────────────────────────────────────────────

async function pintarYo() {
  const cont = $('#per-yo')
  if (!cont) return
  let y
  try { y = await api('/yo') } catch { return }
  const campos = Object.entries(y.campos).filter(([k]) => y.perfil[k])
  cont.innerHTML = `<div class="per-yo">
    <div class="per-cab"><span class="avatar">◉</span><div><h2>${y.entidad ? esc(y.entidad.nombre) : 'Vos'}</h2>${y.entidad?.alias?.length ? `<small class="tenue">también ${y.entidad.alias.map(esc).join(', ')}</small>` : ''}</div>
      <button class="btn btn-chico" id="yo-editar">${campos.length ? 'Editar mi perfil' : 'Escribir mi perfil'}</button></div>
    ${!y.entidad ? '<p class="tenue">Todavía no sé quién sos. Escribí tu perfil: es lo primero que Mastropiero tiene que conocer.</p>' : ''}
    ${campos.length ? `<dl class="per-perfil">${campos.map(([k, n]) => `<dt>${esc(n)}</dt><dd>${esc(y.perfil[k])}</dd>`).join('')}</dl>` : y.entidad ? '<p class="tenue">Tu perfil está vacío: contale a Deprocast quién sos (dónde vivís, de qué trabajás, tus proyectos, cómo trabajás).</p>' : ''}
    <div class="tenue chico">${y.horario ? `Horario fijo: ${esc(y.horario)} · ` : ''}Mastropiero sabe ${y.memoria.total} cosas de vos${y.memoria.sinRevisar ? ` (${y.memoria.sinRevisar} sin revisar)` : ''}</div>
    ${y.clave.length ? `<div class="per-clave">${y.clave.map((p) => `<a href="#" class="chip ref" data-ref-ent="${p.id}">${esc(p.nombre)}${p.nivel ? ` · ${p.nivel}` : ''}</a>`).join('')}</div>` : ''}
  </div>`
  $('#yo-editar').onclick = () => modalYo(y)
}

function modalYo(y) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Quién soy</h2>
    <p class="tenue">Lo primero que Mastropiero lee de vos, entero. Lo que dejes vacío no se inventa.</p>
    <form id="yo-form" class="per-form">
      <label class="campo">Cómo te llamás<input name="nombre" value="${esc(y.entidad?.nombre ?? '')}"></label>
      <label class="campo">Cómo te dicen (separado por comas)<input name="alias" value="${esc((y.entidad?.alias ?? []).join(', '))}"></label>
      ${Object.entries(y.campos).map(([k, n]) => `<label class="campo">${esc(n)}<textarea name="${k}" rows="${k === 'saber' ? 4 : 2}">${esc(y.perfil[k] ?? '')}</textarea></label>`).join('')}
      <button class="btn btn-primario">Guardar</button>
    </form>`)
  $('#yo-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    const perfil = Object.fromEntries(Object.keys(y.campos).map((k) => [k, f[k] ?? '']))
    try {
      await api('/yo', { nombre: f.nombre, alias: String(f.alias ?? '').split(',').map((a) => a.trim()).filter(Boolean), perfil })
      cerrarModal(); toast('Tu perfil quedó guardado', 'suave'); pintarYo()
    } catch (e) { error(e) }
  }
}

// ─── puentes ────────────────────────────────────────────────────────────

async function pintarPuentes() {
  const cont = $('#per-puentes')
  if (!cont) return
  let ps
  try { ps = await api('/puentes') } catch { return }
  if (!ps.length) { cont.innerHTML = ''; return }
  const tarjetas = ps.map((p) => `<div class="per" data-puente="${p.id}"><div class="per-cab"><span class="chip">${p.tipo === 'presentar' ? 'presentar' : 'retomar'}</span><b>${p.personas.map((x) => `<a href="#" class="ref" data-ref-ent="${x.id}">${esc(x.nombre)}</a>`).join(' ↔ ')}</b></div>
      <div>${esc(p.motivo)}</div>${p.mensaje ? `<details><summary class="tenue">Borrador</summary><p>${esc(p.mensaje)}</p><button class="btn btn-chico" data-copiar>Copiar</button></details>` : ''}
      <div class="fila"><button class="btn btn-chico" data-hecho>Hecho</button><button class="btn btn-chico" data-descartar>Descartar</button></div></div>`).join('')
  cont.innerHTML = `<details class="puentes"><summary><b>Puentes</b> <span class="tenue">${ps.length} a quién presentar o con quién retomar</span></summary>
    <div class="puentes-cab"><p>Nada se manda solo.</p><button class="btn btn-chico" id="pu-proponer">Proponer puentes</button></div>
    <div class="puentes-lista">${tarjetas}</div></details>`
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

// ─── tu gente ───────────────────────────────────────────────────────────

/** Doce rayitas: cuánto (lleno) de 12. */
const barra12 = (v, sugerido) => `<span class="per-12">${Array.from({ length: 12 }, (_, i) => `<i class="${v && i < v ? 'on' : !v && sugerido && i < sugerido ? 'sug' : ''}"></i>`).join('')}</span><b>${v ?? (sugerido ? `~${sugerido}` : '—')}</b>`

function tarjetaPersona(p) {
  return `<div class="per ${p.vencida ? 'vencida' : ''} ${p.estado !== 'conocida' ? 'lejana' : ''}" data-id="${p.id}">
    <div class="per-cab"><b><a href="#" class="ref" data-ref-ent="${p.id}">${esc(p.nombre)}</a></b>
      ${p.clase !== 'fisica' ? `<span class="chip">${CLASES_PER[p.clase]}</span>` : ''}${p.estado !== 'conocida' ? `<span class="chip">${ESTADOS_PER[p.estado]}</span>` : ''}${p.vinculo ? `<span class="chip">${esc(p.vinculo)}</span>` : ''}</div>
    <div class="per-medidas"><span title="Nivel de contacto: cuánto la conocés">Nivel ${barra12(p.nivel, p.nivelSugerido)}</span><span title="Importancia en tu vida">Importancia ${barra12(p.importancia)}</span></div>
    ${p.proyectos.length ? `<div class="per-proy">${p.proyectos.map((x) => `<a href="#" class="chip ref" data-ref-ent="${x.id}">◆ ${esc(x.nombre)}${x.rol ? ` · ${esc(x.rol)}` : ''}${x.importancia ? ` · ${x.importancia}` : ''}</a>`).join('')}</div>` : ''}
    <div class="tenue chico">${p.ultimoContacto ? `Último contacto: ${esc(p.ultimoContacto)} (hace ${p.diasSinContacto} d)` : 'Sin contacto registrado'}${p.cadaDias ? ` · querías cada ${p.cadaDias} d` : ''} · ${p.menciones} piezas</div>
    ${p.proxima ? `<div>Próximo: ${esc(p.proxima)}</div>` : ''}
    ${p.misiones.length ? `<div class="tenue chico">Misiones: ${p.misiones.map((m) => esc(m.titulo)).join(' · ')}</div>` : ''}
    ${p.con?.length ? `<div class="tenue chico">Aparece con: ${p.con.map((c) => esc(c.nombre)).join(', ')}</div>` : ''}
    ${p.notas ? `<div class="tenue recorte">${esc(p.notas)}</div>` : ''}
    <div class="fila"><button class="btn btn-chico" data-contacto>Hablamos hoy</button><button class="btn btn-chico" data-editar>Editar</button><button class="btn btn-chico" data-unir title="Es la misma que otra entidad">Unir con…</button></div>
  </div>`
}

let personasVistas = []

async function refrescarPersonas() {
  const cont = $('#per-grid')
  if (!cont) return
  let ps
  try { ps = await api(`/personas?${new URLSearchParams({ q: per.q, clase: per.clase, estado: per.estado, orden: per.orden === 'proyecto' ? 'nivel' : per.orden })}`) } catch (e) { return error(e) }
  if (per.solo === 'definidas') ps = ps.filter((p) => p.definida)
  if (per.solo === 'vencidas') ps = ps.filter((p) => p.vencida)
  personasVistas = ps
  if (!ps.length) return void (cont.innerHTML = '<p class="vacio">Nadie por acá con ese filtro. Las personas aparecen cuando cargás material o las nombrás; las que no conocés todavía, sumalas con «＋ Persona».</p>')
  if (per.orden === 'proyecto') {
    // Agrupadas por proyecto (alguien en dos proyectos aparece en los dos), por la importancia que tiene en cada uno.
    const grupos = new Map()
    for (const p of ps) for (const x of p.proyectos.length ? p.proyectos : [{ id: 0, nombre: 'Sin proyecto', importancia: null }]) {
      const g = grupos.get(x.id) ?? { nombre: x.nombre, ps: [] }
      g.ps.push({ p, imp: x.importancia ?? 0 })
      grupos.set(x.id, g)
    }
    cont.innerHTML = [...grupos.entries()].sort(([a, ga], [b, gb]) => (a === 0) - (b === 0) || gb.ps.length - ga.ps.length)
      .map(([, g]) => `<h3 class="sub">${esc(g.nombre)} <small class="tenue">${g.ps.length}</small></h3><div class="per-grid">${g.ps.sort((a, b) => b.imp - a.imp).map((x) => tarjetaPersona(x.p)).join('')}</div>`).join('')
  } else cont.innerHTML = `<div class="per-grid">${ps.map(tarjetaPersona).join('')}</div>`
  $$('.per[data-id]', cont).forEach((el) => {
    const p = ps.find((x) => x.id === Number(el.dataset.id))
    $('[data-contacto]', el).onclick = async () => { try { await api(`/personas/${p.id}`, { contacto: true }); refrescarPersonas() } catch (e) { error(e) } }
    $('[data-editar]', el).onclick = () => editarPersona(p)
    $('[data-unir]', el).onclick = () => modalUnir(p.id, p.nombre, () => { refrescarPersonas(); pintarYo() })
  })
}

/** Botones del 1 al 12 (como en la criba) para un número. */
const elegir12 = (nombre, v) => `<div class="per-elegir" data-campo="${nombre}">${Array.from({ length: 12 }, (_, i) => `<button type="button" class="${v === i + 1 ? 'on' : ''}" data-n="${i + 1}">${i + 1}</button>`).join('')}<button type="button" class="${v ? '' : 'on'}" data-n="">—</button></div><input type="hidden" name="${nombre}" value="${v ?? ''}">`

async function editarPersona(p) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${esc(p.nombre)}</h2>
    <form id="per-form" class="per-form">
      <div class="fila"><label class="campo">Nombre<input name="nombre" value="${esc(p.nombre)}"></label><label class="campo">También le decís (comas)<input name="alias" value="${esc(p.alias.join(', '))}"></label></div>
      <div class="fila"><label class="campo">Clase<select name="clase">${Object.entries(CLASES_PER).map(([k, n]) => `<option value="${k}" ${p.clase === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="campo">Estado<select name="estado">${Object.entries(ESTADOS_PER).map(([k, n]) => `<option value="${k}" ${p.estado === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="campo">Vínculo<select name="vinculo"><option value="">—</option>${VINCULOS.map((v) => `<option ${p.vinculo === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <div class="campo">Nivel de contacto <small class="tenue">(cuánto la conocés, qué tienen juntos${p.nivelSugerido ? `; sugerido ~${p.nivelSugerido}` : ''})</small>${elegir12('nivel', p.nivel)}</div>
      <div class="campo">Importancia en tu vida${elegir12('importancia', p.importancia)}</div>
      <div class="fila"><label class="campo">Cada cuántos días querés saber de ella<input name="cadaDias" type="number" min="0" value="${p.cadaDias ?? ''}" placeholder="vacío = sin ritmo"></label>
        <label class="campo">Último contacto<input name="contacto" type="date" value="${esc(p.ultimoContacto ?? '')}"></label></div>
      <label class="campo">Lo próximo<input name="proxima" value="${esc(p.proxima ?? '')}" placeholder="devolverle el libro, invitarla a…"></label>
      <label class="campo">Notas<textarea name="notas" rows="3">${esc(p.notas ?? '')}</textarea></label>
      <div class="campo">En qué proyectos está
        <div id="per-proys">${p.proyectos.map((x) => `<div class="sq"><span>◆ ${esc(x.nombre)}${x.rol ? ` · ${esc(x.rol)}` : ''}${x.importancia ? ` · importancia ${x.importancia}` : ''}</span><button type="button" class="btn btn-chico" data-quitar="${x.id}">✕</button></div>`).join('')}</div>
        <div class="fila"><input class="campo-suelto" id="pp-proy" list="pp-lista" placeholder="Proyecto o empresa…"><datalist id="pp-lista"></datalist><input class="campo-suelto" id="pp-rol" placeholder="Rol (socia, cliente…)"><input class="campo-suelto" id="pp-imp" type="number" min="1" max="12" placeholder="1–12" style="width:5em"><button type="button" class="btn btn-chico" id="pp-sumar">Sumar</button></div>
      </div>
      <button class="btn btn-primario">Guardar</button>
    </form>`)
  $$('#per-form .per-elegir').forEach((g) => $$('button', g).forEach((b) => (b.onclick = () => {
    $$('button', g).forEach((x) => x.classList.toggle('on', x === b))
    $(`#per-form input[name="${g.dataset.campo}"]`).value = b.dataset.n
  })))
  // Proyectos y empresas para elegir (por nombre).
  let candidatos = []
  try { candidatos = [...(await api('/entidades?tipo=proyecto&limite=300')).entidades, ...(await api('/entidades?tipo=agrupacion&limite=300')).entidades].filter((e) => e.id !== p.id) } catch { /* sin lista, se escribe */ }
  $('#pp-lista').innerHTML = candidatos.map((e) => `<option value="${esc(e.nombre)}">`).join('')
  const proyectos = async (cuerpo) => {
    try { p.proyectos = await api(`/personas/${p.id}/proyectos`, cuerpo); editarPersonaProyectos(p) } catch (e) { error(e) }
  }
  const editarPersonaProyectos = (x) => {
    $('#per-proys').innerHTML = x.proyectos.map((y) => `<div class="sq"><span>◆ ${esc(y.nombre)}${y.rol ? ` · ${esc(y.rol)}` : ''}${y.importancia ? ` · importancia ${y.importancia}` : ''}</span><button type="button" class="btn btn-chico" data-quitar="${y.id}">✕</button></div>`).join('')
    $$('#per-proys [data-quitar]').forEach((b) => (b.onclick = () => proyectos({ proyecto: Number(b.dataset.quitar), quitar: true })))
  }
  editarPersonaProyectos(p)
  $('#pp-sumar').onclick = () => {
    const n = $('#pp-proy').value.trim().toLowerCase()
    const e = candidatos.find((c) => c.nombre.toLowerCase() === n) ?? candidatos.find((c) => c.nombre.toLowerCase().includes(n))
    if (!n || !e) return toast('Elegí un proyecto o empresa de la lista')
    proyectos({ proyecto: e.id, rol: $('#pp-rol').value.trim() || null, importancia: $('#pp-imp').value || null })
    $('#pp-proy').value = ''; $('#pp-rol').value = ''; $('#pp-imp').value = ''
  }
  $('#per-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.target))
    const alias = String(f.alias ?? '').split(',').map((a) => a.trim()).filter(Boolean)
    if (!f.contacto || f.contacto === p.ultimoContacto) delete f.contacto
    try {
      if (f.nombre.trim() !== p.nombre || alias.join('|') !== p.alias.join('|')) await api(`/entidades/${p.id}`, { nombre: f.nombre.trim(), alias })
      delete f.nombre; delete f.alias
      await api(`/personas/${p.id}`, f)
      cerrarModal(); refrescarPersonas(); pintarYo()
    } catch (e) { error(e) }
  }
}

function modalNuevaPersona() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Alguien nuevo</h2>
    <p class="tenue">Alguien que todavía no conocés, que contactaste, una empresa o un personaje.</p>
    <form id="pn-form" class="per-form">
      <label class="campo">Nombre<input name="nombre" required autofocus></label>
      <div class="fila"><label class="campo">Clase<select name="clase">${Object.entries(CLASES_PER).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
        <label class="campo">Estado<select name="estado"><option value="por_conocer">Por conocer</option><option value="contactada">Contactada (no la conozco)</option><option value="conocida">Conocida</option></select></label>
        <label class="campo">Importancia (1–12)<input name="importancia" type="number" min="1" max="12"></label></div>
      <label class="campo">Quién es, por qué importa<textarea name="notas" rows="3"></textarea></label>
      <button class="btn btn-primario">Sumar</button>
    </form>`)
  $('#pn-form').onsubmit = async (ev) => {
    ev.preventDefault()
    try { await api('/personas/nueva', Object.fromEntries(new FormData(ev.target))); cerrarModal(); toast('Sumada', 'suave'); refrescarPersonas() } catch (e) { error(e) }
  }
}

/** Unir dos entidades que son la misma (una persona que quedó dos veces, una empresa con dos nombres). Se elige cuál queda. */
function modalUnir(id, nombre, alTerminar = () => {}) {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Unir «${esc(nombre)}» con…</h2>
    <p class="tenue">Todo lo de las dos (piezas, misiones, proyectos, relación, plata, alias) queda en una sola. No se puede deshacer.</p>
    <div class="fila"><input class="campo-suelto" id="un-q" placeholder="Buscá la otra…" autofocus></div>
    <div id="un-res"></div>`)
  let t
  $('#un-q').oninput = (e) => { clearTimeout(t); t = setTimeout(async () => {
    const q = e.target.value.trim()
    if (q.length < 2) { $('#un-res').innerHTML = ''; return }
    let r
    try { r = (await api(`/entidades?q=${encodeURIComponent(q)}&limite=12`)).entidades.filter((x) => x.id !== id) } catch (err) { return error(err) }
    $('#un-res').innerHTML = r.map((x) => `<div class="sq"><span>${esc(x.nombre)} <small class="tenue">${esc(x.tipo)} · ${x.piezas} piezas${x.alias?.length ? ` · ${x.alias.slice(0, 3).map(esc).join(', ')}` : ''}</small></span>
      <span class="fila"><button class="btn btn-chico" data-queda="${id}" data-absorbe="${x.id}" title="Se queda «${esc(nombre)}»">Queda «${esc(nombre.slice(0, 18))}»</button><button class="btn btn-chico" data-queda="${x.id}" data-absorbe="${id}">Queda esta</button></span></div>`).join('') || '<p class="tenue">Nada con ese nombre.</p>'
    $$('#un-res [data-queda]').forEach((b) => (b.onclick = async () => {
      if (!confirm('¿Unirlas? Lo de las dos queda en una sola y no se puede deshacer.')) return
      try { await api(`/entidades/${b.dataset.queda}/fusionar`, { absorbe: [Number(b.dataset.absorbe)] }); cerrarModal(); toast('Unidas', 'suave'); alTerminar(Number(b.dataset.queda)) } catch (err) { error(err) }
    }))
  }, 250) }
}

// ─── el grafo ───────────────────────────────────────────────────────────

const COLOR_REL = { pareja: '#e46b8a', familia: '#e0a24a', amistad: '#5bb98c', trabajo: '#5b8fd9', socios: '#9a6bdc', cliente: '#3fb4c4', proveedor: '#7f9c4a', conocidos: '#8c8c8c', otro: '#8c8c8c' }

/** Fuerzas simples (repulsión entre todos, resortes en las aristas, gravedad al centro): se acomoda en unos cientos de pasos. */
function acomodarGrafo(nodos, aristas, ancho, alto) {
  const pos = new Map(nodos.map((n, i) => [n.id, { x: ancho / 2 + Math.cos(i * 2.4) * (40 + i * 3), y: alto / 2 + Math.sin(i * 2.4) * (40 + i * 3), vx: 0, vy: 0 }]))
  const ar = aristas.map((a) => ({ a: pos.get(a.a), b: pos.get(a.b), fuerte: a.tipo !== 'aparecen juntas' }))
  const ps = [...pos.values()]
  for (let paso = 0; paso < 320; paso++) {
    const t = 1 - paso / 320
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const p = ps[i], q = ps[j]
      let dx = p.x - q.x, dy = p.y - q.y
      const d2 = dx * dx + dy * dy || 0.01
      if (d2 > 90_000) continue // lejos no se empujan: los grupos sueltos no se escapan
      const f = 1800 / d2
      dx *= f; dy *= f
      p.vx += dx; p.vy += dy; q.vx -= dx; q.vy -= dy
    }
    for (const e of ar) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d - (e.fuerte ? 70 : 120)) * (e.fuerte ? 0.02 : 0.004)
      e.a.vx += (dx / d) * f * d * 0.05; e.a.vy += (dy / d) * f * d * 0.05
      e.b.vx -= (dx / d) * f * d * 0.05; e.b.vy -= (dy / d) * f * d * 0.05
    }
    for (const p of ps) {
      p.vx += (ancho / 2 - p.x) * 0.02; p.vy += (alto / 2 - p.y) * 0.02
      const v = Math.min(12 * t + 1, Math.hypot(p.vx, p.vy))
      const h = Math.hypot(p.vx, p.vy) || 1
      p.x += (p.vx / h) * v; p.y += (p.vy / h) * v
      p.vx *= 0.5; p.vy *= 0.5
    }
  }
  // Que entre en el lienzo.
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const k = Math.min((ancho - 80) / ((x1 - x0) || 1), (alto - 60) / ((y1 - y0) || 1), 1.6)
  for (const p of ps) { p.x = 40 + (p.x - x0) * k; p.y = 30 + (p.y - y0) * k }
  return pos
}

async function modalGrafo() {
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>☍ Tu gente, como red</h2>
    <p class="tenue chico">El tamaño es lo que pesa en tu vida (importancia o nivel). En color, las relaciones que dice tu archivo o que anotaste; en gris punteado, los que solo aparecen juntos en tus piezas. Tocá a alguien para abrir su ficha.</p>
    <div class="fila per-filtros"><label class="tenue chico"><input type="checkbox" id="gr-juntas" checked> mostrar «aparecen juntas»</label><span class="gr-leyenda">${Object.entries(COLOR_REL).filter(([k]) => k !== 'otro').map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')}</span></div>
    <div id="gr-lienzo" class="gr-lienzo"><p class="tenue">Armando la red…</p></div>`)
  let g
  try { g = await api('/personas/grafo') } catch (e) { return error(e) }
  const cont = $('#gr-lienzo')
  if (!cont) return
  if (g.nodos.length < 2) return void (cont.innerHTML = '<p class="vacio">Todavía hay muy poca gente para una red. Crece sola con el reproceso (Corpus → ♻ Reproceso) y con lo que cargues.</p>')
  const ancho = Math.max(640, cont.clientWidth || 860), alto = 560
  const pos = acomodarGrafo(g.nodos, g.aristas, ancho, alto)
  const nombre = new Map(g.nodos.map((n) => [n.id, n.nombre]))
  const pintar = () => {
    const juntas = $('#gr-juntas').checked
    const as = g.aristas.filter((a) => juntas || a.tipo !== 'aparecen juntas')
    const conAlgo = new Set(as.flatMap((a) => [a.a, a.b]))
    cont.innerHTML = `<svg viewBox="0 0 ${ancho} ${alto}" class="gr-svg">
      ${as.map((a) => { const p = pos.get(a.a), q = pos.get(a.b); const t = a.tipo !== 'aparecen juntas'; return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="${t ? COLOR_REL[a.tipo] ?? COLOR_REL.otro : 'var(--debil)'}" stroke-width="${t ? Math.min(4, 1.4 + a.veces * 0.4) : Math.min(2.5, 0.5 + a.veces * 0.15)}" ${t ? '' : 'stroke-dasharray="3 4" opacity=".55"'}><title>${esc(nombre.get(a.a))} — ${esc(nombre.get(a.b))}: ${esc(a.tipo)}${t ? '' : ` (${a.veces} piezas)`}${a.nota ? `\n${esc(a.nota.slice(0, 300))}` : ''}</title></line>` }).join('')}
      ${g.nodos.filter((n) => juntas || conAlgo.has(n.id) || n.clase === 'yo').map((n) => { const p = pos.get(n.id); const r = n.clase === 'yo' ? 16 : 5 + n.peso * 0.9; return `<g class="gr-nodo ${n.clase}" data-id="${n.id}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><circle r="${r.toFixed(1)}"><title>${esc(n.nombre)}${n.menciones ? ` · ${n.menciones} piezas` : ''}</title></circle><text y="${(r + 12).toFixed(1)}">${esc(n.nombre.length > 22 ? `${n.nombre.slice(0, 21)}…` : n.nombre)}</text></g>` }).join('')}
    </svg>`
    $$('.gr-nodo', cont).forEach((el) => (el.onclick = async () => {
      const id = Number(el.dataset.id)
      if (el.classList.contains('yo')) return
      const p = personasVistas?.find((x) => x.id === id) ?? (await api(`/personas?q=${encodeURIComponent(nombre.get(id))}`).catch(() => [])).find((x) => x.id === id)
      if (p) editarPersona(p)
    }))
  }
  $('#gr-juntas').onchange = pintar
  pintar()
}
