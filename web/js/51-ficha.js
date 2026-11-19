'use strict'
// La ficha v2 (Fragua #302): un molde para empresa, proyecto y lugar, dentro de la vista de la entidad (Saber →
// Entidades). Datos con su fuente, órganos y equipo (quién firma), cuentas anuales con la solvencia que sale de ellas,
// clientes y sus cruces con tus proyectos, tu gente ahí, y la historia de cada dato. «Investigar en fuentes» busca en
// registros, su web, prensa y tu corpus, y solo guarda lo que trae link.

/** De dónde sale un dato: un link (su dominio), una pieza tuya, o a mano / el chat. */
function fuenteFicha(f) {
  if (!f) return ''
  if (/^https?:\/\//.test(f)) {
    let host = f
    try { host = new URL(f).host.replace(/^www\./, '') } catch { /* tal cual */ }
    return `<a class="f2-fuente" href="${esc(f)}" target="_blank" rel="noopener" title="${esc(f)}">${esc(host)}</a>`
  }
  const m = /^pieza:(\d+)$/.exec(f)
  if (m) return `<a class="f2-fuente" href="#" data-pieza="${m[1]}">tu pieza #${m[1]}</a>`
  return `<span class="f2-fuente">${esc(f)}</span>`
}
const eurFicha = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('es-ES')} €`)
/** Los campos que ya edita la ficha de empresa de siempre (#164): acá solo se muestran. */
const CAMPOS_EMPRESA_164 = new Set(['razonSocial', 'cif', 'direccion', 'web', 'redes'])

/** Un cambio de la historia, en palabras: «Ana Pérez entró como administradora», «Web: x → y», «Cliente: X (sumado)». */
function cambioLegible(h, f) {
  const corto = (s) => esc(String(s ?? '').slice(0, 160))
  const de = (a, d) => `${a ? `<s>${corto(a)}</s> → ` : ''}${d ? corto(d) : '<i>(vacío)</i>'}`
  if (h.campo.startsWith('persona:')) {
    const n = esc(h.campo.slice(8))
    return h.despues ? `<b>${n}</b> ${h.antes ? `pasó de ${corto(h.antes)} a` : 'entró como'} ${corto(h.despues)}` : `<b>${n}</b> ${h.antes && h.antes !== 'sí' ? `dejó de ser ${corto(h.antes)}` : `ya no está en ${esc(f.entidad.nombre)}`}`
  }
  if (h.campo.startsWith('cliente:')) return `Cliente <b>${esc(h.campo.slice(8))}</b> ${h.despues ? 'sumado' : 'quitado'}`
  if (/^cuentas \d{4}$/.test(h.campo)) return `<b>Cuentas ${esc(h.campo.slice(8))}</b>: ${de(h.antes, h.despues)}`
  const nombre = f.campos.find((c) => c.k === h.campo)?.n ?? h.campo.replace(/^criterio · /, 'Criterio · ')
  return `<b>${esc(nombre)}</b>: ${de(h.antes, h.despues)}`
}

async function pintarFicha2(id) {
  const cont = $('#ent-ficha2')
  if (!cont) return
  let f
  try { f = await api(`/entidades/${id}/ficha`) } catch (e) { cont.innerHTML = ''; return error(e) }
  if (!$('#ent-ficha2')) return
  const empresa = f.entidad.tipo === 'empresa'
  const valor = (v) => (Array.isArray(v) ? v.join(' ') : v ?? '')
  const editables = f.campos.filter((c) => !empresa || !CAMPOS_EMPRESA_164.has(c.k))
  const ultimoDe = (k) => f.historia.find((h) => h.campo === k)
  const vig = f.personas.filter((p) => p.vigente)
  const ceso = f.personas.filter((p) => !p.vigente)
  const conLink = (nombre, entId) => (entId ? `<a href="#" data-ver-ent="${entId}">${esc(nombre)}</a>` : esc(nombre))

  const datosRO = empresa ? f.campos.filter((c) => CAMPOS_EMPRESA_164.has(c.k) && valor(c.valor)) : []
  const cuentas = !empresa ? '' : `<h4 class="f2-h">Cuentas anuales</h4>${f.cuentas.length
    ? `<div class="f2-tabla"><table class="lib-tabla"><thead><tr><th>Ejercicio</th><th class="n">Ingresos</th><th class="n">Resultado</th><th class="n">Patrimonio</th><th class="n">Activo</th><th class="n">Empleados</th><th>Depositadas</th><th>Fuente</th></tr></thead><tbody>
      ${f.cuentas.map((c) => `<tr><td>${c.ejercicio}</td><td class="n">${eurFicha(c.ingresos)}</td><td class="n">${eurFicha(c.resultado)}</td><td class="n">${eurFicha(c.patrimonio)}</td><td class="n">${eurFicha(c.activo)}</td><td class="n">${c.empleados ?? '—'}</td><td>${esc(c.depositadas ?? '—')}</td><td>${fuenteFicha(c.fuente)}</td></tr>`).join('')}</tbody></table></div>
      ${f.solvencia ? `<p class="f2-solvencia"><b>Solvencia ${f.solvencia.valor}/10</b> <small class="tenue">${esc(f.solvencia.nota)}</small></p>` : '<p class="tenue chico">Faltan patrimonio y activo para calcular la solvencia.</p>'}`
    : '<p class="tenue chico">Sin cuentas todavía: «Investigar en fuentes» las busca.</p>'}`

  cont.innerHTML = `
    <div class="f2-cab"><h3 class="sub">Ficha</h3>
      <button class="btn btn-chico btn-primario" id="f2-investigar" title="Registros, su web, prensa y tu corpus: cada dato con su link">Investigar en fuentes</button>
      ${f.piezaId ? `<a class="btn btn-chico" href="#" data-pieza="${f.piezaId}" title="La ficha entera, como pieza de tu corpus">En tu corpus</a>` : ''}
      <small class="tenue">${f.investigada ? `Investigada ${haceCuanto(f.investigada)}` : 'Sin investigar todavía'}</small></div>
    ${datosRO.length ? `<div class="f2-datos-ro">${datosRO.map((c) => `<span><small class="tenue">${esc(c.n)}</small> ${esc(valor(c.valor))} ${fuenteFicha(ultimoDe(c.k)?.fuente)}</span>`).join('')}</div>` : ''}
    <form id="f2-datos" class="f2-datos">${editables.map((c) => `<label class="campo">${esc(c.n)}<input name="${c.k}" value="${esc(valor(c.valor))}" autocomplete="off">${ultimoDe(c.k)?.fuente ? `<small class="tenue">de ${fuenteFicha(ultimoDe(c.k).fuente)}</small>` : ''}</label>`).join('')}
      <div class="fila"><button class="btn btn-chico">Guardar datos</button></div></form>

    <h4 class="f2-h">${empresa ? 'Órganos y equipo' : 'Equipo'}</h4>
    ${vig.length ? `<ul class="f2-lista">${vig.map((p) => `<li><b>${conLink(p.nombre, p.personaId)}</b>${p.rol ? ` · ${esc(p.rol)}` : ''}${p.firma ? ' <span class="tipo-chip">firma</span>' : ''}${p.fecha ? ` <small class="tenue">${esc(p.fecha)}</small>` : ''} ${fuenteFicha(p.fuente)} <button class="btn btn-chico btn-icono" data-f2-quitar-persona="${p.id}" title="Ya no está">✕</button></li>`).join('')}</ul>` : '<p class="tenue chico">Nadie anotado todavía.</p>'}
    ${ceso.length ? `<details class="f2-ceso"><summary class="tenue chico">${ceso.length} que ya no ${ceso.length === 1 ? 'está' : 'están'}</summary>${ceso.map((p) => `<div class="chico">${esc(p.nombre)}${p.rol ? ` · ${esc(p.rol)}` : ''} ${fuenteFicha(p.fuente)}</div>`).join('')}</details>` : ''}
    <form class="f2-agregar" id="f2-persona"><input class="campo-suelto" name="nombre" placeholder="Nombre" required><input class="campo-suelto" name="rol" placeholder="Rol (administrador, directora…)"><button class="btn btn-chico">Sumar</button></form>

    ${cuentas}

    <h4 class="f2-h">Clientes</h4>
    ${f.clientes.length ? `<div class="f2-chips">${f.clientes.map((c) => `<span class="f2-chip">${conLink(c.nombre, c.clienteId)} ${fuenteFicha(c.fuente)}<button class="btn btn-chico btn-icono" data-f2-quitar-cliente="${c.id}" title="No es cliente">✕</button></span>`).join('')}</div>` : '<p class="tenue chico">Ninguno detectado todavía.</p>'}
    ${f.cruces.length ? `<ul class="f2-cruces">${f.cruces.map((c) => `<li class="${c.alerta ? 'alerta' : ''}">${c.alerta ? '⚠' : '↔'} <b>${esc(c.cliente)}</b> → ${esc(c.proyecto)}: ${esc(c.como)}</li>`).join('')}</ul>` : ''}
    <form class="f2-agregar" id="f2-cliente"><input class="campo-suelto" name="cliente" placeholder="Un cliente" required><button class="btn btn-chico">Sumar</button></form>

    ${f.vinculos.length ? `<h4 class="f2-h">Tu gente acá</h4><ul class="f2-lista">${f.vinculos.map((v) => `<li><b>${conLink(v.nombre, v.personaId)}</b>${v.rol ? ` · ${esc(v.rol)}` : ''}${v.ultimaPieza ? ` · juntos por última vez ${esc(v.ultimaPieza.fecha ?? '')} en <a href="#" data-pieza="${v.ultimaPieza.id}">${esc(v.ultimaPieza.titulo)}</a>` : ''}${v.ultimoContacto ? ` · último contacto ${esc(v.ultimoContacto)}` : ''} <small class="tenue">${v.piezas} ${v.piezas === 1 ? 'pieza' : 'piezas'}</small></li>`).join('')}</ul>` : ''}

    ${f.historia.length ? `<details class="f2-historia"><summary class="sub">Lo que cambió · ${f.historia.length}</summary><ul class="f2-lista">${f.historia.map((h) => `<li><small class="tenue">${esc(new Date(h.en).toLocaleDateString('es-AR'))}</small> ${cambioLegible(h, f)} ${fuenteFicha(h.fuente)}</li>`).join('')}</ul></details>` : ''}`

  const mandar = async (cuerpo, aviso) => {
    try { await api(`/entidades/${id}/ficha`, cuerpo); if (aviso) toast(aviso, 'suave') } catch (e) { return error(e) }
    pintarFicha2(id)
    if (empresa && typeof pintarEmpresa === 'function') pintarEmpresa(id)
  }
  $('#f2-datos').onsubmit = (ev) => { ev.preventDefault(); mandar({ datos: Object.fromEntries(new FormData(ev.target)) }, 'Ficha guardada') }
  $('#f2-persona').onsubmit = (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); mandar({ persona: { nombre: d.nombre, rol: d.rol || null } }) }
  $('#f2-cliente').onsubmit = (ev) => { ev.preventDefault(); mandar({ cliente: new FormData(ev.target).get('cliente') }) }
  $$('[data-f2-quitar-persona]', cont).forEach((b) => (b.onclick = () => mandar({ quitarPersona: Number(b.dataset.f2QuitarPersona) })))
  $$('[data-f2-quitar-cliente]', cont).forEach((b) => (b.onclick = () => mandar({ quitarCliente: Number(b.dataset.f2QuitarCliente) })))
  $$('[data-ver-ent]', cont).forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); verEntidad(Number(a.dataset.verEnt)) }))
  $('#f2-investigar').onclick = async (ev) => {
    const b = ev.currentTarget
    b.disabled = true
    b.textContent = 'Investigando…'
    try {
      const r = await api(`/entidades/${id}/ficha/investigar`, {})
      const hallado = [r.llenados.length && `${r.llenados.length} datos`, r.personas && `${r.personas} personas`, r.cuentas && `${r.cuentas} ejercicios`, r.clientes && `${r.clientes} clientes`].filter(Boolean).join(', ')
      toast(`${hallado ? `Sumé ${hallado}` : 'No encontré nada nuevo'}<small>${r.fuentes} fuentes leídas${r.descartados ? ` · ${r.descartados} datos sin fuente, descartados` : ''}</small>`, 'suave')
      if (r.discrepancias.length) abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Una fuente dice otra cosa</h2><p class="tenue">No pisé lo tuyo. Si la fuente tiene razón, cambialo en la ficha.</p>
        <ul class="f2-lista">${r.discrepancias.map((d) => `<li><b>${esc(d.campo)}</b>: tenías «${esc(d.tenias)}»; ${fuenteFicha(d.fuente)} dice «${esc(d.dice)}»</li>`).join('')}</ul>`)
    } catch (e) { error(e) }
    pintarFicha2(id)
    if (empresa && typeof pintarEmpresa === 'function') pintarEmpresa(id)
  }
}
