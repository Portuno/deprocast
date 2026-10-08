'use strict'
// Cuadernos: fuentes elegidas, preguntas que se responden solo con ellas (con citas), guía y charla en audio.

let cuadernoAbierto = null
let cuEspera = null

function montarCuadernos() {
  clearTimeout(cuEspera)
  if (cuadernoAbierto) return montarCuaderno(cuadernoAbierto)
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Cuadernos</h1><p>Juntá fuentes sobre un tema (piezas de tu corpus, un texto, una página) y preguntale: responde solo con eso y te dice de dónde sale cada cosa. También te arma una guía y una charla en audio para escuchar caminando.</p>
      <div class="fila"><input id="cu-nuevo" placeholder="Nombre del cuaderno nuevo"><button class="btn btn-primario" id="cu-crear">Crear</button></div></div>
    <div class="cu-grid" id="cu-lista"></div>`
  const crear = async () => {
    const t = $('#cu-nuevo').value.trim()
    if (!t) return
    try { const c = await api('/cuadernos', { titulo: t }); cuadernoAbierto = c.id; montarCuadernos() } catch (e) { error(e) }
  }
  $('#cu-crear').onclick = crear
  $('#cu-nuevo').onkeydown = (e) => { if (e.key === 'Enter') crear() }
  refrescarCuadernos()
}

async function refrescarCuadernos() {
  if (cuadernoAbierto) return
  const cont = $('#cu-lista')
  if (!cont) return
  let cs
  try { cs = await api('/cuadernos') } catch (e) { return error(e) }
  cont.innerHTML = cs.length ? cs.map((c) => `<div class="cu-tarjeta" data-cu="${c.id}"><b>${esc(c.titulo)}</b><span class="tenue">${c.fuentes.length} fuente${c.fuentes.length === 1 ? '' : 's'} · ${c.notas} nota${c.notas === 1 ? '' : 's'}</span></div>`).join('')
    : '<p class="vacio">Ningún cuaderno todavía. Creá uno para un tema que estés estudiando o un proyecto.</p>'
  $$('[data-cu]', cont).forEach((el) => (el.onclick = () => { cuadernoAbierto = Number(el.dataset.cu); montarCuadernos() }))
}

/** Las citas [n] del texto se vuelven links a la pieza. */
function conCitas(texto, citas) {
  const porN = new Map(citas.map((c) => [c.n, c]))
  return md(texto).replace(/\[(\d+)\]/g, (m, n) => {
    const c = porN.get(Number(n))
    return c ? `<a href="#" class="cu-cita" data-pieza="${c.piezaId}" title="${esc(c.titulo)}">[${n}]</a>` : m
  })
}

async function montarCuaderno(id) {
  let c
  try { c = await api(`/cuadernos/${id}`) } catch (e) { cuadernoAbierto = null; return error(e) }
  $('#principal').innerHTML = `
    <div class="titulo"><h1>${esc(c.titulo)}</h1><p><a href="#" id="cu-volver">← Cuadernos</a></p>
      <div class="fila"><button class="btn" id="cu-guia" ${c.fuentes.length ? '' : 'disabled'}>Guía</button><button class="btn" id="cu-charla" ${c.fuentes.length && !c.haciendo ? '' : 'disabled'}>🎧 Charla en audio</button><button class="btn btn-chico btn-peligro" id="cu-borrar">Borrar cuaderno</button></div></div>
    ${c.haciendo ? `<p class="pensando">${esc(c.haciendo)}…</p>` : ''}
    <div class="cu-cols">
      <aside class="panel">
        <h3>Fuentes (${c.fuentes.length})</h3>
        <div class="cu-fuentes">${c.fuentes.map((f) => `<div class="cu-fuente"><span data-pieza="${f.id}" title="${esc(f.titulo)}">${esc(f.titulo)}</span>${nivelBadge(f.nivel)}<button class="btn btn-chico" data-quitar="${f.id}" title="Quitar">✕</button></div>`).join('') || '<p class="tenue">Sumá fuentes abajo.</p>'}</div>
        <h3>Sumar</h3>
        <input id="cu-buscar" placeholder="Buscar en tu corpus…" style="width:100%"><div id="cu-res" class="cu-fuentes"></div>
        <input id="cu-url" placeholder="o una URL" style="width:100%;margin-top:8px"><button class="btn btn-chico" id="cu-url-ok">Leer y sumar</button>
        <textarea id="cu-texto" rows="3" placeholder="o pegá un texto" style="width:100%;margin-top:8px"></textarea><button class="btn btn-chico" id="cu-texto-ok">Sumar texto</button>
      </aside>
      <section>
        <div class="cu-notas">${c.notas.map((n) => `
          <div class="cu-nota">
            ${n.tipo === 'respuesta' ? `<div class="q">${esc(n.pregunta)}</div>` : `<div class="q">${n.tipo === 'guia' ? 'Guía' : '🎧 Charla'}</div>`}
            ${n.tipo === 'audio' && n.artefactoId ? `<audio controls preload="none" src="/taller/${n.artefactoId}/charla.mp3" style="width:100%"></audio><details><summary class="tenue">Guion</summary><div class="md">${md(n.texto)}</div></details>` : `<div class="md">${conCitas(n.texto, n.citas)}</div>`}
            ${n.citas.length ? `<div class="cu-citas">${n.citas.map((x) => `<a href="#" data-pieza="${x.piezaId}">[${x.n}] ${esc(x.titulo)}</a>`).join('')}</div>` : ''}
          </div>`).join('') || `<p class="vacio">${c.fuentes.length ? 'Preguntale algo, o pedile la guía.' : 'Primero sumá fuentes.'}</p>`}</div>
        <form class="fila" id="cu-preguntar" style="margin-top:12px"><input name="pregunta" placeholder="Preguntale al cuaderno…" style="flex:1" ${c.fuentes.length ? '' : 'disabled'} autocomplete="off"><button class="btn btn-primario" ${c.fuentes.length ? '' : 'disabled'}>Preguntar</button></form>
      </section>
    </div>`
  const otra = () => montarCuaderno(id)
  $('#cu-volver').onclick = (e) => { e.preventDefault(); cuadernoAbierto = null; montarCuadernos() }
  $('#cu-borrar').onclick = async () => { if (!confirm(`¿Borrar el cuaderno «${c.titulo}»? Las fuentes quedan en el corpus.`)) return; try { await api(`/cuadernos/${id}/borrar`, {}); cuadernoAbierto = null; montarCuadernos() } catch (e) { error(e) } }
  $$('[data-quitar]').forEach((b) => (b.onclick = async () => { try { await api(`/cuadernos/${id}/quitar`, { pieza: Number(b.dataset.quitar) }); otra() } catch (e) { error(e) } }))
  const ocupado = async (boton, texto, fn) => { boton.disabled = true; const t = boton.textContent; boton.textContent = texto; try { await fn(); otra() } catch (e) { error(e); boton.disabled = false; boton.textContent = t } }
  $('#cu-guia').onclick = (e) => ocupado(e.target, 'Leyendo las fuentes…', () => api(`/cuadernos/${id}/guia`, {}))
  $('#cu-charla').onclick = (e) => ocupado(e.target, 'Arrancando…', async () => { await api(`/cuadernos/${id}/charla`, {}); toast('Armando la charla<small>Tarda unos minutos; te aviso acá cuando esté.</small>') })
  $('#cu-preguntar').onsubmit = (e) => { e.preventDefault(); const q = e.target.pregunta.value.trim(); if (q) ocupado(e.target.querySelector('button'), 'Pensando…', () => api(`/cuadernos/${id}/preguntar`, { pregunta: q })) }
  $('#cu-url-ok').onclick = (e) => { const u = $('#cu-url').value.trim(); if (u) ocupado(e.target, 'Leyendo…', () => api(`/cuadernos/${id}/fuentes`, { url: u })) }
  $('#cu-texto-ok').onclick = (e) => { const t = $('#cu-texto').value.trim(); if (t) ocupado(e.target, 'Sumando…', () => api(`/cuadernos/${id}/fuentes`, { texto: { contenido: t } })) }
  let espera
  $('#cu-buscar').oninput = (e) => {
    clearTimeout(espera)
    espera = setTimeout(async () => {
      const q = e.target.value.trim()
      if (q.length < 3) return void ($('#cu-res').innerHTML = '')
      try {
        const r = await api(`/buscar?q=${encodeURIComponent(q)}&limite=8`)
        const ya = new Set(c.fuentes.map((f) => f.id))
        $('#cu-res').innerHTML = r.piezas.filter((p) => !ya.has(p.id)).map((p) => `<div class="cu-fuente"><span title="${esc(p.titulo)}">${esc(p.titulo)}</span>${nivelBadge(p.nivel)}<button class="btn btn-chico" data-sumar="${p.id}">＋</button></div>`).join('') || '<p class="tenue">Nada.</p>'
        $$('[data-sumar]').forEach((b) => (b.onclick = () => ocupado(b, '…', () => api(`/cuadernos/${id}/fuentes`, { piezas: [Number(b.dataset.sumar)] }))))
      } catch (err) { error(err) }
    }, 300)
  }
  // Mientras graba la charla, se refresca solo.
  clearTimeout(cuEspera)
  if (c.haciendo) cuEspera = setTimeout(() => { if (vista === 'cuadernos' && cuadernoAbierto === id) otra() }, 5000)
}
