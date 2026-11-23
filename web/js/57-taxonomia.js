'use strict'
// La taxonomía (Fragua #321): todos los tipos de clasificación del conocimiento, de un solo registro
// (src/taxonomia.ts). Familia → tipos → valores, buscable; la auditoría revisa la base a pedido.

let taxDatos = null
let taxAuditada = false

async function montarTaxonomia() {
  $('#principal').innerHTML = `
    <div class="titulo"><h1>Taxonomía</h1><p>Cada tipo de clasificación que usa Deprocast, con sus valores, dónde vive y qué herramientas lo leen y lo escriben. Sale de un solo registro: lo que se ve acá es lo que hay en el código.</p></div>
    <div class="tax-barra">
      <input class="campo-suelto tax-buscar" id="tax-q" type="search" placeholder="Buscar un tipo, un valor o una herramienta…" autocomplete="off">
      <button class="btn btn-chico" id="tax-auditar" title="Revisa la base: valores usados que no están declarados y números fuera de rango">Auditar la base</button>
    </div>
    <div id="tax-resumen" class="chico tenue"></div>
    <div id="tax-cuerpo"><p class="tenue">Leyendo el registro…</p></div>`
  $('#tax-q').oninput = () => pintarTaxonomia()
  $('#tax-auditar').onclick = async (e) => {
    const b = e.currentTarget
    b.disabled = true
    b.textContent = 'Auditando…'
    try { taxDatos = await api('/taxonomia/auditoria'); taxAuditada = true; pintarTaxonomia() } catch (err) { error(err) } finally { b.disabled = false; b.textContent = 'Auditar la base' }
  }
  try { taxDatos = await api('/taxonomia'); taxAuditada = false } catch (e) { return error(e) }
  pintarTaxonomia()
}

const TAX_ESTADO = { existe: 'ok', falta: 'aviso', inconsistente: 'mal' }

function pintarTaxonomia() {
  const cuerpo = $('#tax-cuerpo')
  if (!cuerpo || !taxDatos) return
  const q = ($('#tax-q')?.value ?? '').trim().toLowerCase()
  const pasa = (t) => !q || [t.id, t.nombre, t.descripcion ?? '', t.valoresTexto, t.modulo, t.tabla ?? '', ...t.lee, ...t.escribe].some((x) => String(x).toLowerCase().includes(q))
  const r = taxDatos.resumen
  $('#tax-resumen').textContent = `${r.tipos} tipos: ${r.existe} existen, ${r.inconsistente} inconsistentes, ${r.falta} faltan. ${taxAuditada ? 'Con la base auditada.' : 'Sin auditar la base (solo el registro contra el código).'}`
  const porTipo = {}
  for (const h of taxDatos.hallazgos) (porTipo[h.tipo] ??= []).push(h)
  const familias = taxDatos.familias.map((f) => ({ ...f, tipos: f.tipos.filter(pasa) })).filter((f) => f.tipos.length)
  cuerpo.innerHTML = familias.length ? familias.map((f) => `<section class="seccion">
      <div class="aca-sec-cab"><h3>${esc(f.id[0].toUpperCase() + f.id.slice(1))}</h3><span class="tenue chico">${esc(f.descripcion)}</span></div>
      ${f.tipos.map((t) => `<div class="tax-tipo">
        <div class="tax-cab"><strong>${esc(t.nombre)}</strong> <code class="chico">${esc(t.id)}</code> <span class="estado-chip ${TAX_ESTADO[t.estado] ?? ''}">${esc(t.estado)}</span></div>
        ${t.descripcion ? `<p class="chico tenue">${esc(t.descripcion)}</p>` : ''}
        <div class="tax-valores">${t.rango ? `<span class="chip">${t.rango[0]} a ${t.rango[1]}</span>` : t.valores ? t.valores.map((v) => `<span class="chip">${esc(String(v))}</span>`).join('') : '<span class="chip">libre</span>'}</div>
        <p class="chico tenue">En ${esc(t.tabla ? `${t.tabla}.${t.columna}` : t.modulo)} · ${esc(t.modulo)}${t.lee.length ? ` · lee: ${esc(t.lee.join(', '))}` : ''}${t.escribe.length ? ` · escribe: ${esc(t.escribe.join(', '))}` : ''}</p>
        ${(porTipo[t.id] ?? []).length ? `<ul class="chico tax-hallazgos">${porTipo[t.id].map((h) => `<li>${esc(h.detalle)}${h.veces ? ` <span class="tenue">(${h.veces})</span>` : ''}</li>`).join('')}</ul>` : ''}
      </div>`).join('')}
    </section>`).join('') : '<p class="tenue">Nada coincide con esa búsqueda.</p>'
}
