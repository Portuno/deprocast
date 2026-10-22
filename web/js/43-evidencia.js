'use strict'
// El libro de evidencia (en Jugador): quién querés ser, tu historia vieja y los hechos que lo votan. Y el foco (en el
// Directo y en Hoy): cuánto sostenés la atención, cuánto se va en apps de estímulo y la meta de bloque.

const TIPO_EVID = { banda: '⚔', mision: '◆', habito: '✓', practica: '◷', anotada: '✎' }

async function montarEvidencia(cont) {
  let d
  try { d = await api('/identidades') } catch (e) { return error(e) }
  const xs = d.identidades
  cont.innerHTML = `
    <p class="tenue">La identidad se vota con hechos. Elegí hasta tres frases de quién querés ser y atalas a lo que ya hacés (primarias, hábitos, aprendizajes, categorías de bandas o palabras): cada cosa que cae ahí suma una línea, sola. El domingo te llega una pregunta para mirarlo contra tu historia vieja.</p>
    ${xs.length < 3 ? '<div class="fila my-3"><button class="btn btn-primario" id="ev-nueva">＋ Quién quiero ser</button></div>' : ''}
    ${xs.length ? `<div class="tarjetas">${xs.map((i) => `<article class="tarjeta ev-id">
        <h3>${esc(i.frase)}</h3>
        ${i.historiaVieja ? `<p class="ev-vieja">Historia vieja: <s>${esc(i.historiaVieja)}</s></p>` : ''}
        <div class="ev-num"><b>${i.dias30}</b><span>${i.dias30 === 1 ? 'evidencia' : 'evidencias'} en 30 días · ${i.diasConEvidencia} ${i.diasConEvidencia === 1 ? 'día' : 'días'}</span></div>
        <div class="ev-semanas" title="Por semana (la última a la derecha)">${i.semanas.map((n) => `<span><i style="height:${Math.min(100, n * 12)}%"></i><small>${n}</small></span>`).join('')}</div>
        ${i.ultimas.length ? `<ul class="ev-lineas">${i.ultimas.map((e) => `<li><i>${TIPO_EVID[e.tipo] ?? '·'}</i><span>${esc(e.texto)}</span><small>${esc(e.fecha.slice(8, 10))}/${esc(e.fecha.slice(5, 7))}</small></li>`).join('')}</ul>` : '<p class="tenue chico">Todavía sin evidencia: atala a algo que hagas seguido, o anotá lo que hiciste.</p>'}
        <form class="fila ev-anotar" data-ev-anotar="${i.id}"><input class="campo-suelto" name="texto" placeholder="Hoy hice algo que lo vota…"><button class="btn btn-chico">Sumar</button></form>
        <div class="fila"><button class="btn btn-chico" data-ev-editar="${i.id}">✎ Atar y editar</button><button class="btn btn-chico" data-ev-archivar="${i.id}" title="Archivar">✕</button></div>
      </article>`).join('')}</div>` : '<div class="vacio"><div class="gran">🗳</div><h2>Sin identidades todavía</h2><p>«Soy alguien que termina lo que empieza», «Soy alguien que entrena». Una frase, y la historia vieja que querés dejar atrás.</p></div>'}`
  const recargar = () => montarEvidencia(cont)
  if ($('#ev-nueva', cont)) $('#ev-nueva', cont).onclick = () => modalIdentidad(null, d.opciones, recargar)
  $$('[data-ev-editar]', cont).forEach((b) => (b.onclick = () => modalIdentidad(xs.find((x) => x.id === Number(b.dataset.evEditar)), d.opciones, recargar)))
  $$('[data-ev-archivar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/identidades/${b.dataset.evArchivar}`, { estado: 'archivada' }); recargar() } catch (e) { error(e) } }))
  $$('[data-ev-anotar]', cont).forEach((f) => (f.onsubmit = async (ev) => {
    ev.preventDefault()
    if (!f.texto.value.trim()) return
    try { await api(`/identidades/${f.dataset.evAnotar}/evidencia`, { texto: f.texto.value }); toast('🗳 Sumada', 'suave'); recargar() } catch (e) { error(e) }
  }))
}

function modalIdentidad(i, op, alTerminar) {
  const a = i?.ataduras ?? { primarias: [], habitos: [], aprendizajes: [], categorias: [], palabras: [] }
  const checks = (nombre, xs, sel, etq) => xs.length ? `<fieldset class="ev-checks"><legend>${etq}</legend>${xs.map((x) => `<label><input type="checkbox" name="${nombre}" value="${esc(x.id)}" ${sel.map(String).includes(String(x.id)) ? 'checked' : ''}> ${esc(x.titulo ?? x.tema)}</label>`).join('')}</fieldset>` : ''
  abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>${i ? 'Tu identidad' : 'Quién querés ser'}</h2>
    <form id="ev-form">
      <label class="campo">La frase<input name="frase" required minlength="8" value="${esc(i?.frase ?? '')}" placeholder="Soy alguien que termina lo que empieza"></label>
      <label class="campo">La historia vieja (la que querés dejar atrás)<input name="historiaVieja" value="${esc(i?.historiaVieja ?? '')}" placeholder="Arranco mil cosas y no termino ninguna"></label>
      <p class="tenue chico">¿Qué hechos la votan? Lo que marques suma solo.</p>
      ${checks('primarias', op.primarias, a.primarias, 'Primarias activas')}
      ${checks('habitos', op.habitos, a.habitos, 'Hábitos')}
      ${checks('aprendizajes', op.aprendizajes, a.aprendizajes, 'Aprendizajes')}
      <div class="fila"><label class="campo">Categorías de bandas (separadas por coma)<input name="categorias" value="${esc(a.categorias.join(', '))}" placeholder="escritura, entreno"></label>
        <label class="campo">Palabras en el título (separadas por coma)<input name="palabras" value="${esc(a.palabras.join(', '))}" placeholder="terminar, publicar"></label></div>
      <button class="btn btn-primario">Guardar</button>
    </form>`)
  $('#ev-form').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = new FormData(ev.target)
    const ataduras = { primarias: f.getAll('primarias').map(Number), habitos: f.getAll('habitos').map(String), aprendizajes: f.getAll('aprendizajes').map(Number), categorias: String(f.get('categorias') ?? ''), palabras: String(f.get('palabras') ?? '') }
    try {
      if (i) await api(`/identidades/${i.id}`, { frase: f.get('frase'), historiaVieja: f.get('historiaVieja'), ataduras })
      else await api('/identidades', { frase: f.get('frase'), historiaVieja: f.get('historiaVieja'), ataduras })
      cerrarModal()
      alTerminar()
    } catch (e) { error(e) }
  }
}

// ─── foco ───────────────────────────────────────────────────────────────

/** El panel del Directo: 14 días de bloque más largo (barras) y minutos de estímulo (línea de abajo). */
async function pintarFoco(cont) {
  if (!cont) return
  let f
  try { f = await api('/foco?dias=14') } catch { return void (cont.innerHTML = '') }
  const max = Math.max(30, ...f.dias.map((x) => x.bloqueMax), f.meta ?? 0)
  const hayDatos = f.dias.some((x) => x.minutos)
  cont.innerHTML = `<section class="panel foco-panel"><h3>Tu foco · 14 días</h3>
    ${hayDatos ? `<div class="foco-fichas">
        <div><b>${f.meta ?? '—'}′</b><span>meta de bloque (lo mejor de la semana + 5)</span></div>
        <div><b>${f.promedioBloque ?? '—'}′</b><span>bloque promedio sin cambiar de tema</span></div>
        <div><b>${f.promedioEstimulo ?? '—'}′</b><span>por día en apps de estímulo</span></div></div>
      <div class="foco-barras">${f.dias.map((x) => `<span title="${x.fecha}: bloque más largo ${x.bloqueMax}′${x.bloqueQue ? ` (${x.bloqueQue})` : ''} · ${x.cambiosPorHora ?? '—'} cambios por hora · ${x.estimulo}′ de estímulo · ${x.minutos}′ mirados">
          <i style="height:${Math.round((x.bloqueMax / max) * 100)}%"></i>${x.estimulo ? `<em style="height:${Math.min(100, Math.round((x.estimulo / max) * 100))}%"></em>` : ''}<small>${Number(x.fecha.slice(8, 10))}</small></span>`).join('')}
        ${f.meta ? `<hr class="foco-meta" style="bottom:calc(16px + (100% - 16px) * ${(f.meta / max).toFixed(3)})" title="Meta de bloque: ${f.meta}′">` : ''}</div>
      <p class="tenue chico">Barra: el tramo más largo sin cambiar de app ni de tema. Rojo: minutos en apps de alto estímulo. La run usa la meta para el largo de tus bandas de foco.</p>`
      : '<p class="tenue chico">Cuando uses el Directo, acá vas a ver cuánto sostenés la atención y cuánto se va en apps de estímulo.</p>'}
    <details class="foco-apps"><summary>Apps de alto estímulo</summary><form class="fila" id="foco-apps"><input class="campo-suelto" name="apps" value="${esc(f.apps.join(', '))}"><button class="btn btn-chico">Guardar</button></form></details>
  </section>`
  $('#foco-apps', cont).onsubmit = async (ev) => { ev.preventDefault(); try { await api('/ajustes', { apps_estimulo: ev.target.apps.value }); pintarFoco(cont) } catch (e) { error(e) } }
}
