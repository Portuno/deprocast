'use strict'
// Para validar: todo lo que Mastropiero propone y espera tu ok, en un solo lugar (plan v22: el patrón de una bandeja de
// aprobación). En la compu, lista a la izquierda y la cosa elegida a la derecha, con de dónde viene y qué pasa si la
// aceptás; se maneja con el teclado (j/k, a, x, espacio, A, z). En el celular, una por vez, deslizando.
// Decidir es un gesto de un segundo y se puede deshacer: lo resuelto queda tenue unos segundos con «Deshacer» antes de
// mandarse (si cerrás, se manda en el acto). Abajo, lo que hizo solo hoy (con ↩) y cuánto acierta cada clase de cosa.
// Cada grupo viene de a tandas: al terminar una se trae la siguiente sola, y «r» (o ↻) trae todo lo nuevo en el momento.

const MODOS_SOMBRA = [['sombra', 'Propone y espera'], ['auto', 'Lo hace solo'], ['manual', 'Siempre pregunta']]
/** Qué pasa si lo aceptás, por clase de cosa (para decidir sin adivinar). */
const QUE_HACE = {
  directo: 'Lo vio o lo escuchó el Directo. Aceptar lo crea (la tarea, la persona, la conexión…); descartar lo olvida.',
  inventario: 'Salió de lo que contaste. Aceptar lo suma a lo que tenés; descartar lo archiva.',
  recuerdo: 'Lo anotó de vos. Aceptar lo da por bien anotado; descartar lo archiva (deja de usarse).',
  monto: 'Un monto que contaste. Aceptar lo anota en la plata.',
  primaria: 'Una primaria que te propone para la semana. Aceptar la activa.',
  propuesta: 'Una mejora para Deprocast. Aceptar la marca para construir en La Fragua.',
  mano_puente: 'Dos cartas tuyas que conectan sin parecerse. ¿Es real o casualidad?',
  mano_contradiccion: 'Algo nuevo choca con lo que creías. ¿Lo actualizás, lo sostenés o lo probás?',
  mano_combo: 'Una hipótesis que sale de juntar cartas. ¿Vale?',
  publicacion: 'Lo redactó Mastropiero para una cuenta tuya (una idea en todas tus redes, una campaña o lo de siempre). Aprobar la programa en el próximo horario de la cuenta; si la cuenta no tiene conector, la copiás y la marcás publicada en Cuentas.',
  agente_borrador: 'Lo redactó un agente de una misión para una pista. «Lo mando» = lo mandás vos (copialo, o editalo en Agentes → Pistas) y queda como enviada; descartarlo le enseña qué no.',
  agente_cliente: 'Entró un ingreso del proyecto después de mandarle algo a esa pista. Si es de ahí, la pista pasa a cliente (y el agente cobra).',
}
const DESHACER_MS = 5000
const bj = { datos: null, sombra: null, sel: 0, estado: new Map(), marcadas: new Set(), timer: null, cola: [], ultimo: null }
const claveBj = (tipo, id) => `${tipo}:${id}`
const angosto = () => matchMedia('(max-width: 720px)').matches

/** Las cosas que se deciden acá (los grupos con acciones), en orden. */
function itemsBj() {
  return (bj.datos?.grupos ?? []).filter((g) => g.acciones && g.items.length).flatMap((g) => g.items.map((i) => ({ g, i, k: claveBj(g.tipo, i.id) })))
}
const pendientesBj = () => itemsBj().filter((x) => !bj.estado.has(x.k))

async function modalBandeja() {
  if (!(await traerBj())) return
  abrirModal('<div id="bj"></div>', { alCerrar: () => { mandarBj(true); if (vista === 'hoy') traerHoy() } })
  $('#modal').classList.add('modal-ancho', 'modal-bj')
  pintarBj()
}

/** Lo que espera su ok, de nuevo desde el servidor. Si lo que estaba elegido sigue ahí, sigue elegido. */
async function traerBj() {
  const elegida = pendientesBj()[bj.sel]?.k
  try { [bj.datos, bj.sombra] = await Promise.all([api('/bandeja'), api('/sombra')]) } catch (e) { error(e); return false }
  bj.estado = new Map()
  bj.marcadas = new Set(itemsBj().map((x) => x.k))
  bj.sel = Math.max(0, pendientesBj().findIndex((x) => x.k === elegida))
  return true
}

/** «r» o ↻: manda lo decidido y trae todo lo nuevo, sin cerrar. */
let recargandoBj = false
async function recargarBj() {
  if (recargandoBj || !$('#bj')) return
  recargandoBj = true
  try {
    await mandarBj(true)
    if (await traerBj()) pintarBj()
  } finally { recargandoBj = false }
}

/** ¿Quedan más en el servidor de algún grupo que se decide acá (más allá de esta tanda)? */
const quedanBj = () => (bj.datos?.grupos ?? []).filter((g) => g.acciones).reduce((t, g) => t + Math.max(0, g.n - g.items.length), 0)
/** Un grupo terminó su tanda y en el servidor tiene más: hay que traer la siguiente. */
const tandaTerminadaBj = () => (bj.datos?.grupos ?? []).some((g) => g.acciones && g.n > 0 && !g.items.length)

/** Cómo se dice lo que hizo: «Aceptada», «Descartada» o la respuesta (en La Mano, «✓ Es real»…). */
const dichoBj = (accion, nombre, n = 1) => (accion === 'aceptar' ? (n > 1 ? `${n} aceptadas` : 'Aceptada') : accion === 'descartar' ? (n > 1 ? `${n} descartadas` : 'Descartada') : n > 1 ? `${n} · ${nombre}` : nombre)

/** Lo resuelto se manda después de unos segundos (o ya, al cerrar): hasta entonces, «Deshacer» lo devuelve. */
function resolverBj(xs, accion, nombre) {
  if (!xs.length) return
  for (const x of xs) bj.estado.set(x.k, { accion, nombre: dichoBj(accion, nombre) })
  bj.cola.push(...xs.map((x) => ({ tipo: x.g.tipo, id: x.i.id, accion, k: x.k })))
  bj.ultimo = xs.map((x) => x.k)
  clearTimeout(bj.timer)
  bj.timer = setTimeout(() => mandarBj(), DESHACER_MS)
  const resto = pendientesBj()
  bj.sel = Math.min(bj.sel, Math.max(0, resto.length - 1))
  pintarBj()
  if (xs.length > 1) toast(esc(dichoBj(accion, nombre, xs.length)), 'suave', { accion: { texto: 'Deshacer', hacer: () => deshacerBj(xs.map((x) => x.k)) }, ms: DESHACER_MS })
}

function deshacerBj(ks = bj.ultimo) {
  if (!ks?.length) return
  const quedan = ks.filter((k) => bj.cola.some((c) => c.k === k))
  if (!quedan.length) return toast('Ya se mandó: eso se cambia desde su sección', 'suave')
  bj.cola = bj.cola.filter((c) => !quedan.includes(c.k))
  for (const k of quedan) bj.estado.delete(k)
  bj.ultimo = null
  pintarBj()
}

async function mandarBj(yaMismo = false) {
  clearTimeout(bj.timer)
  const items = bj.cola.splice(0)
  if (!items.length) return
  try {
    const r = await api('/bandeja/lote', { items: items.map(({ tipo, id, accion }) => ({ tipo, id, accion })) })
    if (r.errores.length) toast(`${r.errores.length} no se pudieron<small>${esc(r.errores[0])}</small>`, 'error')
    if (!yaMismo && $('#bj')) {
      // Lo mandado sale de la lista (y de la cuenta de 📥 en el próximo latido).
      const mandadas = new Set(items.map((x) => x.k))
      for (const g of bj.datos.grupos) { const antes = g.items.length; g.items = g.items.filter((i) => !mandadas.has(claveBj(g.tipo, i.id))); g.n -= antes - g.items.length }
      for (const k of mandadas) bj.estado.delete(k)
      // Un grupo terminó su tanda y tiene más: la siguiente viene sola (lo demás queda como estaba).
      if (tandaTerminadaBj()) return recargarBj()
      pintarBj()
    }
  } catch (e) { error(e) }
}

function detalleBj(x) {
  if (!x && quedanBj()) return `<div class="vacio"><div class="gran">✓</div><h2>Tanda lista</h2><p>Quedan ${quedanBj()} más: llegan solas apenas se manda lo que decidiste (o ya mismo con <kbd>r</kbd>).</p><button class="btn btn-primario" data-bj-recargar>↻ Traer las que siguen</button></div>`
  if (!x) return `<div class="vacio"><div class="gran">✓</div><h2>Nada esperando tu ok</h2><p>Lo nuevo va a aparecer acá (y su número arriba, en 📥). <kbd>r</kbd> vuelve a mirar.</p></div>`
  const { g, i } = x
  const resto = pendientesBj()
  const n = resto.findIndex((y) => y.k === x.k) + 1
  return `<div class="bj-detalle-cab"><small class="hud-etq">${esc(g.nombre)}</small><small class="tenue num">${n} de ${resto.length}</small></div>
    <h3 class="bj-titulo">${esc(i.texto)}</h3>
    ${i.sub ? `<p class="bj-sub">${esc(String(i.sub))}</p>` : ''}
    <p class="tenue bj-que">${esc(QUE_HACE[g.tipo] ?? 'Aceptar lo aplica; descartar lo saca de acá.')}</p>
    <div class="bj-decidir">${g.acciones.map(([a, t], k) => `<button class="btn ${k === 0 ? 'btn-primario' : ''}" data-bj-acc="${a}">${esc(t)} <kbd>${k === 0 ? 'a' : k === 1 ? 'x' : k + 1}</kbd></button>`).join('')}</div>`
}

function pintarBj() {
  const raiz = $('#bj')
  if (!raiz) return
  const b = bj.datos
  const s = bj.sombra
  const hora = (ms) => new Date(ms).toTimeString().slice(0, 5)
  const resto = pendientesBj()
  const actual = resto[bj.sel] ?? null
  const lista = b.grupos.map((g) => {
    if (!g.acciones || !g.items.length) return g.n ? `<section class="bj-grupo"><h3>${esc(g.nombre)} <small class="tenue">${g.n}</small></h3><button class="btn btn-chico" data-bj-ir="${g.ir}">Abrir →</button></section>` : ''
    const pend = g.items.filter((i) => !bj.estado.has(claveBj(g.tipo, i.id)))
    const marcadas = pend.filter((i) => bj.marcadas.has(claveBj(g.tipo, i.id)))
    return `<section class="bj-grupo" data-bj-grupo="${g.tipo}"><h3>${esc(g.nombre)} <small class="tenue">${pend.length}${g.n > g.items.length ? ` de ${g.n}` : ''}</small>
      ${pend.length > 1 ? `<span class="bj-todas">${g.acciones.slice(0, 2).map(([a, t], k) => `<button class="btn btn-chico" data-bj-todas="${a}" title="${esc(t)} las marcadas de este grupo (${k === 0 ? 'Shift+A' : 'Shift+X'})">${esc(t)} ${marcadas.length === pend.length ? 'todas' : `${marcadas.length} de ${pend.length}`}</button>`).join('')}</span>` : ''}</h3>
      ${g.items.map((i) => {
        const k = claveBj(g.tipo, i.id)
        const hecho = bj.estado.get(k)
        const sel = actual?.k === k
        return `<div class="bj-item${hecho ? ' resuelto' : ''}${sel ? ' sel' : ''}" data-bj-k="${esc(k)}" role="option" aria-selected="${sel}">
          ${hecho ? '' : `<input type="checkbox" class="bj-marca" ${bj.marcadas.has(k) ? 'checked' : ''} aria-label="Incluir en «todas»" tabindex="-1">`}
          <div class="bj-item-txt"><span>${esc(i.texto)}</span>${i.sub && !hecho ? `<small class="tenue">${esc(String(i.sub).slice(0, 120))}</small>` : ''}</div>
          ${hecho ? `<span class="bj-hecho">${esc(hecho.nombre)}<button class="btn-link" data-bj-deshacer-k="${esc(k)}">Deshacer</button></span>` : `<span class="bj-acc">${g.acciones.map(([a, t], n) => `<button class="btn btn-chico ${n === 0 ? 'btn-primario' : ''}" data-bj-acc="${a}" title="${esc(t)}">${esc(t)}</button>`).join('')}</span>`}
        </div>`
      }).join('')}</section>`
  }).join('')
  raiz.innerHTML = `<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>📥 Para validar <button class="btn btn-chico btn-icono bj-recargar" data-bj-recargar title="Traer todo lo nuevo (r)" aria-label="Traer todo lo nuevo">↻</button></h2>
    <p class="tenue bj-intro">Todo lo que espera tu ok, junto. Una por una o las marcadas de un grupo; lo que decidís se puede deshacer unos segundos. <span class="bj-teclas"><kbd>j</kbd><kbd>k</kbd> moverse · <kbd>a</kbd> aceptar · <kbd>x</kbd> descartar · <kbd>espacio</kbd> marcar · <kbd>A</kbd> todas · <kbd>z</kbd> deshacer · <kbd>r</kbd> traer lo nuevo</span></p>
    ${b.ofertas.length ? b.ofertas.map((o) => `<div class="bj-oferta"><span>🎯 <b>${esc(o.nombre)}</b>: acerté ${o.aciertos} de ${o.n} (${Math.round((o.tasa ?? 0) * 100)} %). ¿Lo hago solo? Siempre deshacible.</span><button class="btn btn-chico btn-primario" data-bj-auto="${esc(o.tipo)}">Sí, solo</button></div>`).join('') : ''}
    <div class="bj-cuerpo">
      <div class="bj-lista" role="listbox" aria-label="Lo que espera tu ok">${lista || ''}</div>
      <div class="bj-detalle" id="bj-detalle" aria-live="polite">${detalleBj(actual)}</div>
    </div>
    ${b.hechoSolo.length ? `<section class="bj-grupo"><h3>🤖 Lo que hice solo hoy <small class="tenue">${b.hechoSolo.length}</small></h3>
      ${b.hechoSolo.map((d) => `<div class="bj-item"><div class="bj-item-txt"><span>${esc(d.texto ?? d.nombre)}</span><small class="tenue">${esc(d.nombre)} · ${hora(d.en)}${d.confianza != null ? ` · confianza ${Math.round(d.confianza * 100)} %` : ''}</small></div><span class="bj-acc"><button class="btn btn-chico" data-bj-deshacer="${d.id}" title="Deshacer (cuenta como error: la próxima voy con más cuidado)">↩ Deshacer</button></span></div>`).join('')}</section>` : ''}
    <details class="bj-acierto" ${s.tipos.length ? '' : 'hidden'}><summary>Cómo acierto, por clase de cosa</summary>
      <table class="tabla"><thead><tr><th>Qué</th><th>Acierto</th><th class="n">Últimas</th><th>Modo</th></tr></thead><tbody>
      ${s.tipos.map((t) => `<tr><td>${esc(t.nombre)}</td><td>${t.tasa == null ? '—' : `${Math.round(t.tasa * 100)} %`}<small class="tenue"> (≥ ${Math.round(t.cota * 100)} %)</small></td><td class="n">${t.n}</td>
        <td><select class="campo-suelto" data-bj-modo="${esc(t.tipo)}">${MODOS_SOMBRA.filter(([m]) => m !== 'auto' || t.puedeAuto).map(([m, nom]) => `<option value="${m}" ${t.modo === m ? 'selected' : ''}>${nom}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table>
      <p class="tenue chico">El acierto es sobre las últimas 100: aceptado tal cual (o hecho solo y no deshecho) cuenta a favor; editado, rechazado o deshecho, en contra. Entre paréntesis, el piso con 95 % de confianza: te ofrezco hacerlo solo cuando ese piso llega a 95 % (unos 80 aciertos casi seguidos).</p>
    </details>`
  engancharBj(raiz)
  raiz.querySelector('.bj-item.sel')?.scrollIntoView({ block: 'nearest' })
}

function engancharBj(raiz) {
  const porK = (k) => itemsBj().find((x) => x.k === k)
  const recargar = async () => { await mandarBj(true); await modalBandeja() }
  // En la lista: tocar una fila la elige; sus botones deciden.
  $$('.bj-lista [data-bj-k]', raiz).forEach((fila) => (fila.onclick = (e) => {
    if (e.target.closest('button, input')) return
    const i = pendientesBj().findIndex((x) => x.k === fila.dataset.bjK)
    if (i >= 0) { bj.sel = i; pintarBj() }
  }))
  $$('.bj-lista [data-bj-acc]', raiz).forEach((b) => (b.onclick = () => {
    const x = porK(b.closest('[data-bj-k]').dataset.bjK)
    resolverBj([x], b.dataset.bjAcc, b.textContent.trim())
  }))
  $$('#bj-detalle [data-bj-acc]', raiz).forEach((b) => (b.onclick = () => {
    const x = pendientesBj()[bj.sel]
    if (x) resolverBj([x], b.dataset.bjAcc, b.firstChild.textContent.trim())
  }))
  $$('.bj-marca', raiz).forEach((c) => (c.onchange = () => {
    const k = c.closest('[data-bj-k]').dataset.bjK
    c.checked ? bj.marcadas.add(k) : bj.marcadas.delete(k)
    pintarBj()
  }))
  $$('[data-bj-todas]', raiz).forEach((b) => (b.onclick = () => todasBj(b.closest('[data-bj-grupo]').dataset.bjGrupo, b.dataset.bjTodas)))
  $$('[data-bj-deshacer-k]', raiz).forEach((b) => (b.onclick = () => deshacerBj([b.dataset.bjDeshacerK])))
  $$('[data-bj-recargar]', raiz).forEach((b) => (b.onclick = () => recargarBj()))
  $$('[data-bj-deshacer]', raiz).forEach((btn) => (btn.onclick = async () => { try { await api(`/decisiones/${btn.dataset.bjDeshacer}/deshacer`, {}); toast('↩ Deshecho', 'suave'); recargar() } catch (e) { error(e) } }))
  $$('[data-bj-auto]', raiz).forEach((btn) => (btn.onclick = async () => { try { await api('/sombra', { tipo: btn.dataset.bjAuto, modo: 'auto' }); toast('🤖 De ahora en más lo hago solo', 'suave'); recargar() } catch (e) { error(e) } }))
  $$('[data-bj-modo]', raiz).forEach((sel) => (sel.onchange = async () => { try { await api('/sombra', { tipo: sel.dataset.bjModo, modo: sel.value }); toast('Guardado', 'suave') } catch (e) { error(e) } }))
  $$('[data-bj-ir]', raiz).forEach((btn) => (btn.onclick = () => { cerrarModal(); btn.dataset.bjIr === 'takeout' ? modalTakeout() : irA(btn.dataset.bjIr) }))
  // En el celular: deslizar la cosa elegida, a la derecha acepta y a la izquierda descarta.
  const det = $('#bj-detalle', raiz)
  if (det && angosto()) {
    let x0 = null
    det.onpointerdown = (e) => { if (!e.target.closest('button')) { x0 = e.clientX; try { det.setPointerCapture(e.pointerId) } catch { /* sin captura igual anda */ } } }
    det.onpointermove = (e) => { if (x0 != null) det.style.transform = `translateX(${e.clientX - x0}px)` }
    det.onpointerup = (e) => {
      if (x0 == null) return
      const dx = e.clientX - x0
      x0 = null
      det.style.transform = ''
      const x = pendientesBj()[bj.sel]
      if (!x || Math.abs(dx) < 80) return
      const [a, t] = x.g.acciones[dx > 0 ? 0 : 1] ?? x.g.acciones[0]
      resolverBj([x], a, t)
    }
  }
}

/** Las marcadas de un grupo, de una (con «Deshacer» en el aviso). */
function todasBj(tipo, accion) {
  const g = bj.datos.grupos.find((x) => x.tipo === tipo)
  const xs = pendientesBj().filter((x) => x.g.tipo === tipo && bj.marcadas.has(x.k))
  const nombre = g?.acciones.find(([a]) => a === accion)?.[1] ?? accion
  resolverBj(xs, accion, nombre)
}

function teclaBj(e) {
  if (!$('#bj') || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.classList.contains('bj-marca')) return
  const resto = pendientesBj()
  const x = resto[bj.sel]
  const mover = (d) => { e.preventDefault(); bj.sel = Math.max(0, Math.min(resto.length - 1, bj.sel + d)); pintarBj() }
  if (e.key === 'j' || e.key === 'ArrowDown') return mover(1)
  if (e.key === 'k' || e.key === 'ArrowUp') return mover(-1)
  if (e.key === 'z') { e.preventDefault(); return deshacerBj() }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); return recargarBj() }
  if (!x) return
  const acc = x.g.acciones
  if (e.key === 'A' || e.key === 'X') { e.preventDefault(); const [a] = acc[e.key === 'A' ? 0 : 1] ?? acc[0]; return todasBj(x.g.tipo, a) }
  if (e.key === ' ') { e.preventDefault(); bj.marcadas.has(x.k) ? bj.marcadas.delete(x.k) : bj.marcadas.add(x.k); return pintarBj() }
  const n = e.key === 'a' || e.key === 'Enter' ? 0 : e.key === 'x' ? 1 : /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1
  if (n >= 0 && acc[n]) { e.preventDefault(); resolverBj([x], acc[n][0], acc[n][1]) }
}
document.addEventListener('keydown', teclaBj)
