'use strict'
// La Revisión (plan v24): cómo le viene sirviendo Deprocast, medido con su propio feedback. Cuánto acierta cada cosa
// (clases, explicaciones, preguntas, visuales, fuentes, sugerencias, proyectos, el chat), los visuales por plantilla, qué
// sitios sirven, cuánto domina y retiene en cada dominio, y las lecciones que salieron de su feedback (se corrigen acá).

async function montarRevision() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Revisión</h1><p>Lo que te sirve y lo que no, medido con tu feedback (👍/👎, estrellas, «no entendí», lo que aceptás y descartás). Los domingos se vuelve lecciones que entran a los prompts.</p></div>
    <div id="rev-cuerpo"><p class="tenue">Juntando…</p></div>`
  pintarRevision()
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`)

async function pintarRevision() {
  const cont = $('#rev-cuerpo')
  if (!cont) return
  let r
  try { r = await api('/revision') } catch (e) { return error(e) }
  const conDatos = r.porSuperficie.filter((s) => s.n)
  cont.innerHTML = `
    <section class="seccion"><h3>Cuánto acierta cada cosa</h3>
      ${conDatos.length ? `<table class="rev-tabla"><thead><tr><th>Qué</th><th>Valoraciones</th><th>Le sirvió</th><th title="Lo mínimo que acierta con un 95 % de seguridad (con pocas valoraciones, baja)">Seguro</th></tr></thead><tbody>
        ${conDatos.map((s) => `<tr><td>${esc(s.nombre)}</td><td>${s.n}</td><td>${pct(s.tasa)}</td><td>${pct(s.cota)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="tenue">Todavía no valoraste nada. Usá 👍/👎 en el chat y en las clases, las ★ en los visuales y en el material de cada dominio.</p>'}
      ${r.sugerencias.aceptadas + r.sugerencias.rechazadas ? `<p class="chico">Lo que te propone aprender: aceptaste ${r.sugerencias.aceptadas} de ${r.sugerencias.aceptadas + r.sugerencias.rechazadas} (seguro: ${pct(r.sugerencias.cota)}).</p>` : ''}
    </section>
    <section class="seccion"><div class="aca-sec-cab"><h3>Lecciones</h3><button class="btn btn-chico" id="rev-destilar" title="Volver a sacar las lecciones de tu feedback ahora (en la nube)">↻ Destilar ahora</button></div>
      ${r.lecciones.length ? `<ul class="rev-lecciones">${r.lecciones.map((l) => `<li><span class="chip">${esc(r.porSuperficie.find((s) => s.superficie === l.superficie)?.nombre ?? l.superficie)}</span>
        <span class="f1">${esc(l.texto)}${l.fijada ? ' <small class="tenue">(tuya)</small>' : ` <small class="tenue">(${l.apoyo})</small>`}</span>
        <button class="btn btn-chico btn-icono" data-lec-editar="${l.id}" title="Corregirla (queda fija)">✎</button><button class="btn btn-chico btn-icono" data-lec-borrar="${l.id}" title="Borrarla">✕</button></li>`).join('')}</ul>`
        : '<p class="tenue">Cuando haya feedback suficiente (3 valoraciones nuevas de algo), los domingos salen las primeras.</p>'}
    </section>
    ${r.visuales.length ? `<section class="seccion"><h3>Visuales por plantilla</h3><table class="rev-tabla"><thead><tr><th>Plantilla</th><th>Hechos</th><th>Valorados</th><th>★</th><th>Tokens</th></tr></thead><tbody>
      ${r.visuales.map((v) => `<tr><td>${esc(v.plantilla)}</td><td>${v.n}</td><td>${v.valorados}</td><td>${v.estrellas ?? '—'}</td><td>${v.tokens != null ? v.tokens.toLocaleString('es-AR') : '—'}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${r.dominios.length ? `<section class="seccion"><h3>Tus dominios</h3><table class="rev-tabla"><thead><tr><th>Dominio</th><th>Nivel</th><th title="Promedio de lo que domina en los conceptos que ya vio">Domina</th><th title="Tarjetas que recordó de las que repasó">Retiene</th></tr></thead><tbody>
      ${r.dominios.map((d) => `<tr><td>${esc(d.tema)}</td><td>${d.nivel}</td><td>${pct(d.dominio)}</td><td>${d.repasos ? `${pct(d.retencion)} <small class="tenue">(${d.repasos})</small>` : '—'}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${r.fuentes.length ? `<section class="seccion"><h3>Qué sitios te sirven</h3><table class="rev-tabla"><thead><tr><th>Sitio</th><th>👍</th><th>👎</th></tr></thead><tbody>
      ${r.fuentes.map((f) => `<tr><td>${esc(f.sitio)}</td><td>${f.sirve}</td><td>${f.noSirve}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${r.chat.length ? `<section class="seccion"><h3>El chat, por semana</h3><table class="rev-tabla"><thead><tr><th>Semana del</th><th>👍</th><th>👎</th></tr></thead><tbody>
      ${r.chat.map((c) => `<tr><td>${esc(c.semana)}</td><td>${c.bien}</td><td>${c.mal}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${r.ultimas.length ? `<section class="seccion"><h3>Tus últimas notas</h3><ul class="rev-notas">${r.ultimas.map((d) => `<li>${d.valor === 1 || d.valor >= 4 ? '👍' : '👎'} <span class="tenue">${esc(r.porSuperficie.find((s) => s.superficie === d.superficie)?.nombre ?? d.superficie)}:</span> ${esc(d.nota)}</li>`).join('')}</ul></section>` : ''}`
  $('#rev-destilar').onclick = async () => {
    const b = $('#rev-destilar')
    b.disabled = true
    try { const x = await api('/lecciones/destilar', {}); toast(Object.keys(x).length ? 'Lecciones al día' : 'Nada nuevo para aprender todavía', 'suave'); pintarRevision() } catch (e) { error(e) } finally { b.disabled = false }
  }
  $$('[data-lec-editar]', cont).forEach((b) => (b.onclick = async () => {
    const l = r.lecciones.find((x) => x.id === Number(b.dataset.lecEditar))
    const texto = await preguntar('Corregí la lección (queda fija: la destilación no la cambia)', l.texto, { ok: 'Guardar' })
    if (!texto?.trim()) return
    try { await api(`/lecciones/${l.id}`, { texto }); pintarRevision() } catch (e) { error(e) }
  }))
  $$('[data-lec-borrar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/lecciones/${b.dataset.lecBorrar}`, { borrar: true }); pintarRevision() } catch (e) { error(e) } }))
}
