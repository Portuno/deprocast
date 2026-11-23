'use strict'
// Páginas propias y el Menú general.
// - Menú general (#menu): todo Deprocast en una página: cada lugar, qué es y cuánto hay.
// - Arquetipos (#arquetipos, #arquetipo/12): las 72 celdas de la Matriz, cada una con su página.
// - Dominios (#dominios, #dominio/3): cada dominio de la Academia con su página.
//   Cada página se construye sola con lo que pasa en ella y él la moldea con instrucciones en lenguaje natural.
// - A mano (#hojas, #hojas/Rojo): los cuadernos de la tableta, hoja por hoja.
// - Compras (#compras): la lista de compras.
// - Extracciones (#extracciones, #extracciones/12): los clientes de extracción de datos (Fragua #264).
// - Encuestas y cuotas (#mercados, #mercados/29N): cada mercado por separado (Fragua #263).
// - Reservas (#reservas): las reservas con sus textos y su seguimiento (Fragua #254).

const OFICIOS_72 = ['Entra · Cuerpo', 'Entra · Mente', 'Entra · Alma', 'Procesa · Cuerpo', 'Procesa · Mente', 'Procesa · Alma', 'Sale · Cuerpo', 'Sale · Mente', 'Sale · Alma']
const fechaPag = (ms) => (ms ? new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '')

// ─── Menú general ───────────────────────────────────────────────────────

/** Qué es cada lugar, en una línea (y qué cuenta lo muestra). */
const QUE_ES_VISTA = {
  menu: ['Este mapa: todo Deprocast en una página.'],
  hoy: ['Tu día: el saludo, la agenda, lo que toca y lo que Mastropiero hizo solo.'],
  correo: ['Tu Gmail leído: lo que importa, borradores (nunca envía).'],
  informe: ['El informe de la semana, todo junto.'],
  directo: ['Mastropiero ve tu pantalla y te escucha mientras trabajás.'],
  chat: ['Hablar con Mastropiero: el mismo cerebro que Telegram y WhatsApp.', 'mensajes'],
  misiones: ['Tus misiones: primarias de la semana, side quests y runs.', 'misiones'],
  calendario: ['Tu agenda de Google y lo que se agenda desde acá.'],
  linea: ['La línea de tiempo de tu vida en el corpus.'],
  mapa: ['Dónde estuviste: el recorrido del celular y los lugares.'],
  salud: ['Comidas, ejercicio, sueño y peso contra tus metas.', 'salud'],
  tudia: ['Tu día en el mapa y en números.'],
  personas: ['La gente de tu vida: fichas, relaciones y puentes.', 'personas'],
  escalas: ['Tu vida por escalas: cada día desde sus piezas, y la semana, el mes… hasta el lustro.'],
  monedero: ['El Monedero del Tesorero: patrimonio, cuentas, arcas de cada agente y arquetipo, y lo que espera tu firma.'],
  compras: ['La lista de compras: lo que mandás para comprar, junto y tachable.', 'compras'],
  extracciones: ['Tus clientes de extracción de datos: ficha, plan para quien ejecuta y los correos del día, listos para mandar.'],
  mercados: ['Encuestas y cuotas de un evento: cada mercado con el margen de cada casa, el consenso y quién se aparta.'],
  reservas: ['Tus reservas: el pedido armado (mail, WhatsApp, llamada), el seguimiento y las confirmadas en la agenda.', 'reservas'],
  capsulas: ['Cápsulas del tiempo: mensajes para tu yo futuro.'],
  jugador: ['Tu personaje: nivel, inventario e historia.'],
  suenos: ['Tus sueños anotados y lo que dicen.', 'suenos'],
  aprender: ['La Academia: un tutor de seis niveles por dominio.'],
  dominios: ['Cada dominio con su página propia, que crece sola.', 'dominios'],
  idiomas: ['Práctica de idiomas con tarjetas y conversación.', 'idiomas'],
  criba72: ['La Criba del 72: puntuar tu archivo del 1 al 12.'],
  criba: ['La criba en juego.'],
  grafo: ['El grafo de tus temas: qué conecta con qué.', 'entidades'],
  grafos: ['Grafos armados a mano o desde un texto.'],
  grafosalud: ['Tu salud como grafo.'],
  agsala: ['La sala de los agentes: quién está trabajando.', 'agentes'],
  agmisiones: ['Misiones de los agentes.'],
  programados: ['Encargos que corren solos cada tanto.', 'programados'],
  agpistas: ['Pistas que encontraron los agentes.'],
  agtemporada: ['La temporada de la liga: quién rinde.'],
  liga: ['El roster: tus agentes como cartas.', 'agentes'],
  forja: ['Forjar agentes nuevos.'],
  encargos: ['El tablero de encargos de la liga.', 'encargos'],
  cementerio: ['Los agentes retirados.'],
  mapamundi: ['El mapamundi de hexágonos y sus disputas.'],
  corpus: ['Todo lo que entró: piezas por nivel y fuente.', 'corpus'],
  prensa: ['El diario: noticias que siguen tus temas.'],
  cuadernos: ['Cuadernos de fuentes para preguntarles (estilo NotebookLM).', 'cuadernos'],
  hojas: ['Tus cuadernos a mano (la tableta), hoja por hoja.', 'hojas'],
  libreria: ['Tu librería: libros y obras.', 'obras'],
  entidades: ['Personas, proyectos, lugares y conceptos del corpus.', 'entidades'],
  feed: ['Lo que seguís afuera.'],
  taller: ['El taller: crear con el corpus (textos, visuales).'],
  radar: ['Oportunidades que encuentra el radar.'],
  observatorio: ['Qué se dice afuera de tus temas.'],
  campanas: ['Campañas de difusión.'],
  cuentas: ['Tus cuentas en redes.'],
  discovery: ['Discovery de procesos: qué automatizar.'],
  matriz: ['La Matriz 72: todo lo que trabaja, en 8 dominios × 9 oficios.'],
  arquetipos: ['Los 72 arquetipos, cada uno con su página y su mundo.', 'arquetiposNombrados'],
  fragua: ['La Fragua: propuestas de mejora del propio código.', 'propuestas'],
  revision: ['Revisión de lo que hizo el sistema.'],
  perfil: ['Tu perfil, conexiones (Google, Telegram, WhatsApp) y ajustes.'],
}

async function montarMenu() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Menú general</h1>
    <p>Todo Deprocast desde acá: cada lugar, para qué sirve y cuánto hay en tu base. Tocá cualquiera para ir.</p></div>
    <div id="menu-g"><p class="tenue">Contando…</p></div>`
  let c = {}
  try { c = (await api('/menu')).cuentas ?? {} } catch (e) { error(e) }
  const n = (k) => (k && c[k] != null ? `<b class="menu-n">${Number(c[k]).toLocaleString('es-AR')}</b>` : '')
  const destacadas = [
    ['arquetipos', 'Arquetipos', 'hexagon', `${c.arquetiposNombrados ?? 0} con nombre de 72`],
    ['dominios', 'Dominios', 'graduation-cap', `${c.dominios ?? 0} dominios`],
    ['hojas', 'Cuadernos a mano', 'notebook-pen', `${c.cuadernosHuion ?? 0} cuaderno${c.cuadernosHuion === 1 ? '' : 's'} · ${c.hojas ?? 0} hoja${c.hojas === 1 ? '' : 's'}`],
    ['compras', 'Compras', 'list', `${c.compras ?? 0} por comprar`],
  ]
  $('#menu-g').innerHTML = `
    <section class="menu-paginas">${destacadas.map(([v, t, i, s]) => `<a class="menu-pagina" href="${rutaA(v)}">${ico(i, 'grande')}<span><b>${esc(t)}</b><small>${esc(s)}</small></span></a>`).join('')}</section>
    <div class="menu-espacios">${ESPACIOS.filter((e) => e.id !== 'menu').map((e) => `<section class="menu-espacio">
      <h2>${ico(e.ico)} ${esc(e.nombre)} <kbd title="Atajo">g ${e.tecla}</kbd></h2>
      <ul>${e.vistas.map(([v, nombre]) => { const [que, k] = QUE_ES_VISTA[v] ?? ['']; return `<li><a href="${rutaA(v)}"><span><b>${esc(nombre)}</b>${que ? `<small>${esc(que)}</small>` : ''}</span>${n(k)}</a></li>` }).join('')}</ul>
    </section>`).join('')}</div>
    <section class="menu-entradas"><h2 class="sub">Por dónde entra lo tuyo</h2><ul>
      <li><b>Telegram y WhatsApp</b> — texto, notas de voz, fotos (se leen enteras y quedan en el corpus), links, ubicación y hojas del cuaderno.</li>
      <li><b>La tableta</b> — el Cuaderno en vivo en la compu o las hojas por el bot: van a <a href="${rutaA('hojas')}">A mano</a>.</li>
      <li><b>El chat</b> — imágenes y archivos (PDF, Word, Excel), y todo lo que le pidas a Mastropiero.</li>
      <li><b>Google</b> — Gmail, Drive, Calendar y Takeout (Gemini, NotebookLM).</li>
      <li><b>La app del celular</b> — escucha, recorrido y el mapa del día.</li>
    </ul><p class="tenue">${c.corpus != null ? `${Number(c.corpus).toLocaleString('es-AR')} piezas en el corpus · ${Number(c.mensajes ?? 0).toLocaleString('es-AR')} mensajes · ${c.rutinas ?? 0} rutinas activas` : ''}</p></section>`
}

// ─── páginas propias (arquetipos y dominios) ────────────────────────────

async function montarArquetipos() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Arquetipos</h1>
    <p>Las 72 celdas de la Matriz, cada una con su página: un mundo propio que se construye solo con lo que pasa ahí (sus órganos, sus agentes, su monedero) y con lo que vos le pidas. El nombre (El Modista, El Comprador…) se lo ponés vos.</p></div>
    <div id="arq"><p class="tenue">Armando la grilla…</p></div>`
  let d
  try { d = await api('/paginas/arquetipos') } catch (e) { return error(e) }
  const con = d.arquetipos.filter((a) => a.nombre).length
  let grilla = `<div class="cab"></div>${OFICIOS_72.map((o) => `<div class="cab">${o.replace(' · ', '<br>')}</div>`).join('')}`
  d.dominios.forEach((dom, di) => {
    grilla += `<div class="dom">${esc(dom)}</div>`
    for (let o = 0; o < 9; o++) {
      const a = d.arquetipos[di * 9 + o]
      const hay = a.organos.length + a.agentes + a.propuestos
      grilla += `<a class="celda esq-celda arq-celda ${a.nombre || a.construida ? 'llena' : ''}" href="${rutaA('arquetipo', a.n)}" title="${a.etiqueta} · ${esc(dom)} · ${OFICIOS_72[o]}${a.descripcion ? ` — ${esc(a.descripcion)}` : ''}">
        <small>${a.etiqueta}${hay ? ` · ${hay}` : ''}${a.elemento ? ` · ${esc(a.elemento)}` : ''}${a.estado === 'en prueba' || a.estado === 'activo' ? ` · ${esc(a.estado)}` : ''}</small>${a.nombre ? `<em class="esq-nombre">${esc(a.nombre)}</em>` : a.organos[0] ? `<em class="esq-nombre tenue">${esc(a.organos[0])}</em>` : ''}</a>`
    }
  })
  $('#arq').innerHTML = `<p class="tenue">${con} de 72 con nombre · ${d.arquetipos.filter((a) => a.construida).length} páginas construidas. Para nombrar uno: entrá a su página, o decile a Mastropiero «la celda 12 es El Modista».</p>
    <div class="esq-grilla-caja"><div class="matriz esq-matriz">${grilla}</div></div>
    <section id="oficios-nuevos" class="seccion"></section>
    <section id="plantel" class="seccion"></section>`
  void pintarOficiosNuevos()
  void pintarPlantel()
}

/**
 * Oficios nuevos (Fragua #323): un oficio pedido entra al plantel como arquetipo, no como un generativo descartable.
 * Se propone (una plantilla o uno propio), queda en Para validar con su celda sugerida, y el nombre lo ponés vos.
 */
async function pintarOficiosNuevos() {
  const cont = $('#oficios-nuevos')
  if (!cont) return
  let d
  try { d = await api('/oficios') } catch (e) { return error(e) }
  if (!$('#oficios-nuevos')) return
  const enCola = new Set(d.pendientes.map((p) => p.oficio.toLowerCase()))
  cont.innerHTML = `<h2>Oficios nuevos</h2>
    <p class="tenue chico">Un oficio que vas a necesitar seguido (un filtro de revisión, un especialista) entra como arquetipo con su celda, su elemento y su instrucción. Queda en Para validar; el nombre propio se lo ponés en su página.</p>
    <div class="chips">${Object.entries(d.plantillas).filter(([, p]) => !enCola.has(p.oficio.toLowerCase())).map(([k, p]) => `<button class="chip" data-of-plantilla="${esc(k)}" title="${esc(p.maneja)}">+ ${esc(p.oficio)}</button>`).join('')}</div>
    <form class="lg-nuevo" id="of-nuevo"><input class="campo-suelto" name="oficio" placeholder="Otra profesión (Traductor jurídico, Curador visual…)" required><input class="campo-suelto" name="maneja" placeholder="Qué maneja, en una línea"><input class="campo-suelto" name="ejemplo" placeholder="Un ejemplo concreto">
      ${d.agentes.length ? `<select class="campo-suelto" name="agente"><option value="">Sin ascenso</option>${d.agentes.map((a) => `<option value="${esc(a.id)}">Asciende ${esc(a.nombre)}</option>`).join('')}</select>` : ''}<button class="btn btn-chico">Proponer</button></form>
    ${d.pendientes.length ? `<ul class="f2-lista">${d.pendientes.map((p) => `<li><b>${esc(p.oficio)}</b> → celda ${p.celda}${p.elemento ? ` · ${esc(p.elemento)}` : ''}${p.agenteId ? ` · asciende ${esc(p.agenteId)}` : ''}
      <span class="fila g-1"><input type="number" min="1" max="72" value="${p.celda}" data-of-celda="${p.id}" title="Otra celda" class="campo-suelto of-celda"><button class="btn btn-chico btn-primario" data-of-aceptar="${p.id}">Abrir la celda</button><button class="btn btn-chico" data-of-descartar="${p.id}">✕</button></span></li>`).join('')}</ul>` : ''}`
  const proponer = async (cuerpo) => { try { const p = await api('/oficios', cuerpo); toast(`Propuesto: ${esc(p.oficio)} en la celda ${p.celda}<small>Queda en Para validar.</small>`, 'suave'); pintarOficiosNuevos() } catch (e) { error(e) } }
  $$('[data-of-plantilla]', cont).forEach((b) => (b.onclick = () => proponer({ plantilla: b.dataset.ofPlantilla })))
  $('#of-nuevo').onsubmit = (ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); proponer({ oficio: f.oficio, maneja: f.maneja || null, ejemplo: f.ejemplo || null, agente: f.agente || null }) }
  $$('[data-of-aceptar]', cont).forEach((b) => (b.onclick = async () => { try { const r = await api(`/oficios/${b.dataset.ofAceptar}`, { accion: 'aceptar', celda: $(`[data-of-celda="${b.dataset.ofAceptar}"]`).value }); toast(`Celda ${r.arquetipo} abierta${r.ascendio ? `: asciende ${esc(r.ascendio)}` : ''}<small>Ponele el nombre propio en su página.</small>`, 'suave'); montarArquetipos() } catch (e) { error(e) } }))
  $$('[data-of-descartar]', cont).forEach((b) => (b.onclick = async () => { try { await api(`/oficios/${b.dataset.ofDescartar}`, { accion: 'descartar' }); pintarOficiosNuevos() } catch (e) { error(e) } }))
}

async function montarDominios() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Dominios</h1>
    <p>Cada dominio tuyo con su página propia: crece sola con tu material, tus clases y lo que entra a su fuente, y la vas moldeando con instrucciones. Un dominio nuevo: «creame el dominio X» en el chat, o desde la Academia.</p></div>
    <div id="doms"><p class="tenue">Trayendo tus dominios…</p></div>`
  let ds
  try { ds = await api('/paginas/dominios') } catch (e) { return error(e) }
  $('#doms').innerHTML = ds.length ? `<div class="grilla-tarjetas">${ds.map((d) => `<a class="tarjeta tarjeta-link" href="${rutaA('dominio', d.id)}">
      <div class="tarjeta-cab">Nivel ${d.nivel}${d.estado !== 'activo' ? ` · ${esc(d.estado)}` : ''}${d.construida ? ` · ${fechaPag(d.construida)}` : ' · sin construir'}</div>
      <h4>${esc(d.tema)}</h4>${d.descripcion ? `<p class="recorte">${esc(d.descripcion)}</p>` : ''}</a>`).join('')}</div>`
    : `<div class="vacio"><div class="gran">▦</div><h2>Todavía no hay dominios</h2><p>Pedile a Mastropiero «creame el dominio Energía y almacenamiento» y aparece acá con su página.</p></div>`
}

// ─── El plantel (Fragua #260) ───────────────────────────────────────────

const ELEMENTOS_GNOSIS = ['partícula', 'materia', 'campo', 'onda', 'tiempo-espacio', 'posición']
const ESTADO_PLANTEL = { 'vacío': '', 'nombrado': '', 'en prueba': 'vivo', 'activo': 'ok' }

/** La ficha de un arquetipo en su página: oficio, elemento, celda 6×6, qué maneja, un ejemplo y su estado. */
async function pintarFichaArquetipo(n) {
  const cont = $('#arq-ficha')
  if (!cont) return
  let f
  try { f = await api(`/arquetipos/${n}/ficha`) } catch (e) { return void (cont.innerHTML = `<h3>Su ficha</h3><p class="tenue">${esc(e.message)}</p>`) }
  cont.innerHTML = `<h3>Su ficha <span class="estado-chip ${ESTADO_PLANTEL[f.estado] ?? ''}">${esc(f.estado)}</span></h3>
    <form id="f-arq-ficha" class="arq-ficha">
      <label class="chico tenue">Oficio (una profesión)<input name="oficio" value="${esc(f.oficio ?? '')}" placeholder="Tesorero, Modista…" maxlength="60"></label>
      <label class="chico tenue">Elemento<select name="elemento"><option value="">—</option>${ELEMENTOS_GNOSIS.map((e) => `<option ${f.elemento === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <div class="fila"><label class="chico tenue">Fila 6×6<input name="fila" type="number" min="1" max="6" value="${f.fila ?? ''}"></label><label class="chico tenue">Columna<input name="columna" type="number" min="1" max="6" value="${f.columna ?? ''}"></label></div>
      <label class="chico tenue">Qué maneja (una línea)<input name="maneja" value="${esc(f.maneja ?? '')}" maxlength="200"></label>
      <label class="chico tenue">Un ejemplo concreto<input name="ejemplo" value="${esc(f.ejemplo ?? '')}" maxlength="300"></label>
      <label class="chico tenue">Estado<select name="estado">${['nombrado', 'en prueba', 'activo'].map((e) => `<option ${f.estado === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <button class="btn btn-chico btn-primario">Guardar la ficha</button>
    </form>`
  $('#f-arq-ficha').onsubmit = async (e) => {
    e.preventDefault()
    const x = Object.fromEntries(new FormData(e.currentTarget))
    const cuerpo = { oficio: x.oficio || null, elemento: x.elemento || null, fila: x.fila ? Number(x.fila) : null, columna: x.columna ? Number(x.columna) : null, maneja: x.maneja || null, ejemplo: x.ejemplo || null, estado: f.nombre ? x.estado : undefined }
    try { await api(`/arquetipos/${n}/ficha`, cuerpo); toast('Ficha guardada', 'suave'); pintarFichaArquetipo(n) } catch (err) { error(err) }
  }
}

/** El plantel, aparte de la Matriz: los que tienen nombre, cuántos en cada estado y lo que no cumple las reglas. */
async function pintarPlantel() {
  const cont = $('#plantel')
  if (!cont) return
  let p
  try { p = await api('/arquetipos/plantel') } catch (e) { return error(e) }
  cont.innerHTML = `<h2 class="sub">El plantel</h2>
    <p class="tenue">La Matriz de arriba es el reparto (dónde trabaja cada cosa); el plantel son los arquetipos con nombre propio, cada uno con su oficio, su elemento y su estado. ${Object.entries(p.porEstado).map(([e, k]) => `${k} ${esc(e)}`).join(' · ')}</p>
    ${p.problemas.length ? `<div class="aviso"><b>Para corregir</b><ul>${p.problemas.map((x) => `<li><a href="${rutaA('arquetipo', x.n)}">#${String(x.n).padStart(2, '0')}</a>: ${esc(x.problema)}</li>`).join('')}</ul></div>` : ''}
    ${p.plantel.length ? `<table class="tabla-mercado"><thead><tr><th>Celda</th><th>Nombre</th><th>Oficio</th><th>Elemento</th><th>6×6</th><th>Qué maneja</th><th>Estado</th></tr></thead><tbody>${p.plantel.map((f) => `<tr><td><a href="${rutaA('arquetipo', f.n)}">${String(f.n).padStart(2, '0')}</a></td><td><b>${esc(f.nombre)}</b></td><td>${esc(f.oficio ?? '—')}</td><td>${esc(f.elemento ?? '—')}</td><td>${f.fila && f.columna ? `${f.fila}·${f.columna}` : '—'}</td><td>${esc(f.maneja ?? '')}${f.ejemplo ? `<br><small class="tenue">${esc(f.ejemplo)}</small>` : ''}</td><td><span class="estado-chip ${ESTADO_PLANTEL[f.estado] ?? ''}">${esc(f.estado)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="tenue">Todavía ninguno con nombre: entrá a una celda y ponéselo.</p>'}`
}

// Declaradas con «function»: la carga perezosa solo anuncia esas (con const, VISTAS no las encontraría al arrancar).
function montarArquetipo(param) { return montarPaginaPropia('arquetipo', param) }

// La run del arquetipo (Fragua #330): su canal, su corte, sus bandas de 12 minutos y su bitácora.
let pestanaArq = 'pagina'
const ESTADO_BANDA_ARQ = { hecha: ['ok', 'hecha'], parcial: ['aviso', 'a medias'], no: ['mal', 'no'], pendiente: ['', 'pendiente'] }
async function pintarRunArquetipo(n) {
  const cont = $('#arq-run')
  if (!cont) return
  let r
  try { r = await api(`/arquetipos/${n}/run`) } catch (e) { return void (cont.innerHTML = `<p class="tenue">${esc(e.message)}</p>`) }
  const cuenta = r.canal.startsWith('cuenta:') ? r.canal.slice(7) : ''
  const corte = r.corte ? `${r.corte.slice(8, 10)}/${r.corte.slice(5, 7)}${r.vencida ? ' · <span class="estado-chip mal">vencida</span>' : r.diasAlCorte != null ? ` · faltan ${r.diasAlCorte} día${r.diasAlCorte === 1 ? '' : 's'}` : ''}` : 'sin corte'
  const pend = r.bandas.filter((b) => b.estado === 'pendiente'), cerradas = r.bandas.filter((b) => b.estado !== 'pendiente')
  cont.innerHTML = `
    <section class="seccion"><div class="aca-sec-cab"><h3>Su run</h3><span class="tenue chico">${esc(r.ficha.nombre ?? `Arquetipo ${n}`)}${r.ficha.oficio ? ` · ${esc(r.ficha.oficio)}` : ''} · celda ${n} · ${r.sesiones} ${r.sesiones === 1 ? 'sesión' : 'sesiones'} ·${r.minutos} min · corte: ${corte}</span></div>
      <form id="f-arq-run" class="arq-run-ajustes">
        <label class="chico tenue">Canal<select name="canal"><option value="interno" ${cuenta ? '' : 'selected'}>Interno</option><option value="cuenta" ${cuenta ? 'selected' : ''}>Una cuenta</option></select></label>
        <label class="chico tenue">Rótulo de la cuenta<input name="cuenta" class="campo-suelto" value="${esc(cuenta)}" placeholder="@modista" maxlength="80"></label>
        <label class="chico tenue">Corte<input name="corte" class="campo-suelto" type="date" value="${esc(r.corte ?? '')}"></label>
        <label class="chico tenue">Umbral<input name="umbral" class="campo-suelto" value="${esc(r.umbral ?? '')}" placeholder="3 sesiones con resultado" maxlength="200"></label>
        <button class="btn btn-chico">Guardar</button>
      </form></section>
    <section class="seccion"><h3>Bandas <small class="tenue">(${pend.length} pendiente${pend.length === 1 ? '' : 's'}; sin cuerpo, día ni urgencia propia)</small></h3>
      ${pend.length ? `<ul class="pag-lista">${pend.map((b) => `<li class="arq-banda" data-banda="${b.id}"><b>${esc(b.titulo)}</b><small class="tenue">${b.minutos} min${b.origen ? ` · de ${esc(b.origen)}` : ''}${b.detalle ? ` · ${esc(b.detalle)}` : ''}</small>
        <div class="fila"><input class="campo-suelto arq-res" placeholder="Qué salió (opcional)" maxlength="300"><button class="btn btn-chico btn-primario" data-marcar="hecha">Hecha</button><button class="btn btn-chico" data-marcar="parcial">A medias</button><button class="btn btn-chico" data-marcar="no">No</button></div></li>`).join('')}</ul>` : '<p class="tenue">No tiene bandas pendientes.</p>'}
      <form id="f-arq-bandas"><label class="chico tenue" for="arq-nuevas">Cargar bandas, una por línea (12 minutos cada una)</label><textarea id="arq-nuevas" class="campo-suelto" rows="3" placeholder="Probar tres ruedos con la tela nueva"></textarea><div class="fila"><button class="btn btn-chico">Cargar</button></div></form>
      ${cerradas.length ? `<details><summary class="chico">Corridas (${cerradas.length})</summary><ul class="pag-lista">${cerradas.map((b) => `<li><b>${esc(b.titulo)}</b> <span class="estado-chip ${ESTADO_BANDA_ARQ[b.estado][0]}">${ESTADO_BANDA_ARQ[b.estado][1]}</span>${b.resultado ? `<small>${esc(b.resultado)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
    </section>
    <section class="seccion"><h3>Bitácora</h3>
      <form id="f-arq-bit" class="fila"><input id="arq-linea" class="campo-suelto" placeholder="Una línea: qué corrió, qué aprendió" maxlength="500"><button class="btn btn-chico">Anotar</button></form>
      ${r.bitacora.length ? `<ul class="pag-lista">${r.bitacora.map((x) => `<li>${esc(x.texto)}<small class="tenue">${fechaPag(x.en)}</small></li>`).join('')}</ul>` : '<p class="tenue">Todavía no corrió nada.</p>'}
    </section>`
  const recargar = () => pintarRunArquetipo(n)
  $('#f-arq-run').onsubmit = async (e) => {
    e.preventDefault()
    const f = e.currentTarget
    const canal = f.canal.value === 'cuenta' ? `cuenta:${f.cuenta.value.trim()}` : 'interno'
    if (canal === 'cuenta:') return f.cuenta.focus()
    try { await api(`/arquetipos/${n}/run`, { canal, corte: f.corte.value || null, umbral: f.umbral.value }); toast('Run guardada', 'suave'); recargar() } catch (x) { error(x) }
  }
  $('#f-arq-bandas').onsubmit = async (e) => {
    e.preventDefault()
    const texto = $('#arq-nuevas').value.trim()
    if (!texto) return $('#arq-nuevas').focus()
    try { await api(`/arquetipos/${n}/run/bandas`, { texto }); toast('Bandas cargadas', 'suave'); recargar() } catch (x) { error(x) }
  }
  $('#f-arq-bit').onsubmit = async (e) => {
    e.preventDefault()
    const texto = $('#arq-linea').value.trim()
    if (!texto) return $('#arq-linea').focus()
    try { await api(`/arquetipos/${n}/run/bitacora`, { texto }); recargar() } catch (x) { error(x) }
  }
  $$('[data-marcar]', cont).forEach((b) => (b.onclick = async () => {
    const li = b.closest('[data-banda]')
    b.disabled = true
    try { await api(`/arquetipos/bandas/${li.dataset.banda}`, { estado: b.dataset.marcar, resultado: $('.arq-res', li).value }); recargar() } catch (x) { error(x); b.disabled = false }
  }))
}
function montarDominio(param) { return montarPaginaPropia('dominio', param) }
/** La ruta de la API de una página (tipo: arquetipo | dominio). */
const urlPagina = (tipo, clave, extra = '') => `/paginas/${tipo}/${encodeURIComponent(clave)}${extra}`

async function montarPaginaPropia(tipo, clave) {
  if (!clave) return irA(tipo === 'arquetipo' ? 'arquetipos' : 'dominios')
  $('#principal').innerHTML = `<div id="pag" class="pagina-propia"><p class="tenue">Abriendo la página…</p></div>`
  let r
  try { r = await api(urlPagina(tipo, clave)) } catch (e) { $('#pag').innerHTML = `<div class="vacio"><h2>No existe esta página</h2><p>${esc(e.message)}</p><a class="btn" href="${rutaA(tipo === 'arquetipo' ? 'arquetipos' : 'dominios')}">Volver</a></div>`; return }
  pintarPaginaPropia(tipo, clave, r.pagina, r.datos)
}

function pintarPaginaPropia(tipo, clave, p, d) {
  const raiz = $('#pag')
  if (!raiz) return
  const esArq = tipo === 'arquetipo'
  const n = Number(clave)
  const titulo = esArq ? (p.nombre || `Arquetipo ${d.celda.etiqueta}`) : d.dominio.tema
  const sub = esArq ? `${d.celda.etiqueta} · ${d.celda.dominio} · ${OFICIOS_72[d.celda.oficio]}` : `Nivel ${d.dominio.nivel} · ${d.dominio.nivelNombre ?? ''}${d.dominio.estado !== 'activo' ? ` · ${d.dominio.estado}` : ''}`
  const pendientes = p.instrucciones.filter((x) => !x.aplicada)
  const secciones = p.secciones.length
    ? p.secciones.map((s) => `<section class="pag-seccion" data-seccion="${esc(s.id)}"><h2 class="sub">${esc(s.titulo)}${s.origen === 'operador' ? ' <span class="chip chip-chico">tuya</span>' : ''}<button class="btn btn-chico btn-icono" data-editar-seccion="${esc(s.id)}" title="Escribirla vos (queda tuya: el constructor no la pisa)">${ico('pencil')}</button></h2><div class="md">${md(s.cuerpo)}</div></section>`).join('')
    : `<div class="vacio"><div class="gran">${esArq ? '⬡' : '▦'}</div><h2>Esta página todavía no se construyó</h2><p>Se arma con lo que pasa acá${esArq ? ' (sus órganos, sus agentes, su monedero)' : ' (tu material, tus clases, su fuente)'} y con lo que le pidas abajo. También se construye sola de noche si algo cambia.</p><button class="btn btn-primario" data-construir>Construirla ahora</button></div>`

  const lado = esArq ? `
    <section id="arq-ficha"><h3>Su ficha</h3><p class="tenue chico">Trayéndola…</p></section>
    <section><h3>Lo que trabaja acá</h3>${d.organos.length ? `<ul class="pag-lista">${d.organos.map((o) => `<li><b>${esc(o.nombre)}</b>${o.tipo === 'propuesto' ? ' <span class="chip chip-chico">propuesto</span>' : ''}<small>${esc(o.funcion)}</small>${o.semana?.length ? `<small class="tenue">${o.semana.map((s) => `${s.n ?? '—'} ${esc(s.etiqueta)}`).join(' · ')} esta semana</small>` : ''}</li>`).join('')}</ul>` : '<p class="tenue">Ningún órgano del sistema en esta celda.</p>'}</section>
    <section><h3>Agentes</h3>${d.agentes.length ? `<ul class="pag-lista">${d.agentes.map((a) => `<li><button class="link" data-agente="${esc(a.id)}">${esc(a.nombre || a.id)}</button><small>${esc(a.clase)} · ${esc(a.estado)} · ${a.exitos}✓ ${a.fallos}✗ · puntos de liga ${a.monedero} · arcas ${a.arcas} €</small></li>`).join('')}</ul>` : '<p class="tenue">Ningún agente con esta celda todavía (se asigna al forjarlo).</p>'}</section>
    <section><h3>Sus arcas</h3><p>El arquetipo: <b>${d.arcas.arquetipo} €</b> · sus agentes: <b>${d.arcas.agentes} €</b></p>${d.arcas.generado.length ? `<ul class="pag-lista">${d.arcas.generado.map((g) => `<li><b>${esc(g.nombre)}</b><small>generó ${g.total} € en ${g.ingresos} ingreso${g.ingresos === 1 ? '' : 's'}</small></li>`).join('')}</ul>` : '<p class="tenue">Todavía no generó nada (un ingreso se le atribuye desde el Monedero o diciendo «este ingreso lo generó…»).</p>'}<a class="btn btn-chico" href="${rutaA('monedero')}">Abrir el Monedero</a></section>
    <section><h3>Vecinos</h3><div class="fila">${n > 1 ? `<a class="btn btn-chico" href="${rutaA('arquetipo', n - 1)}">← ${String(n - 1).padStart(2, '0')}</a>` : ''}${n < 72 ? `<a class="btn btn-chico" href="${rutaA('arquetipo', n + 1)}">${String(n + 1).padStart(2, '0')} →</a>` : ''}<a class="btn btn-chico" href="${rutaA('arquetipos')}">Los 72</a></div></section>`
    : `
    <section><h3>En la Academia</h3><p>${d.dominio.temaSiguiente ? `Sigue: <b>${esc(d.dominio.temaSiguiente)}</b><br>` : ''}${d.dominio.clases} clases hechas · ${d.dominio.tarjetasHoy} tarjetas para hoy${d.dominio.examen ? ' · <b>examen habilitado</b>' : ''}</p><a class="btn btn-chico" href="${rutaA('aprender')}">Abrir la Academia</a></section>
    <section><h3>Material</h3>${d.material.length ? `<ul class="pag-lista">${d.material.map((m) => `<li>${m.piezaId ? `<button class="link" data-pieza="${m.piezaId}">${esc(m.titulo)}</button>` : esc(m.titulo)}<small class="tenue">${esc(m.origen)}</small></li>`).join('')}</ul>` : '<p class="tenue">Sin material atado todavía.</p>'}</section>
    <section><h3>Su fuente</h3>${d.fuente ? `<p>${d.fuente.piezas} piezas</p><ul class="pag-lista">${d.fuente.ultimas.map((x) => `<li><button class="link" data-pieza="${x.id}">${esc(x.titulo)}</button></li>`).join('')}</ul>` : '<p class="tenue">No tiene fuente propia en el corpus.</p>'}</section>`

  raiz.innerHTML = `
    <div class="titulo pag-titulo"><div><small class="tenue">${esc(sub)}</small><h1>${esc(titulo)}</h1>${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}</div>
      <div class="fila">${esArq ? `<button class="btn btn-chico" data-nombrar>${p.nombre ? 'Cambiar el nombre' : 'Ponerle nombre'}</button>` : ''}${p.secciones.length ? `<button class="btn btn-chico" data-construir title="Rehacerla ahora con lo que pasa">${ico('refresh-cw')} Reconstruir</button>` : ''}</div></div>
    ${esArq ? `<div class="pestanas" role="tablist"><button type="button" role="tab" data-pest="pagina" class="${pestanaArq === 'pagina' ? 'on' : ''}">Página</button><button type="button" role="tab" data-pest="run" class="${pestanaArq === 'run' ? 'on' : ''}">Run</button></div>
    <div id="arq-run" class="arq-run" ${pestanaArq === 'run' ? '' : 'hidden'}><p class="tenue">Trayendo su run…</p></div>` : ''}
    <div class="pag-cuerpo" ${esArq && pestanaArq === 'run' ? 'hidden' : ''}>
      <div class="pag-principal">${secciones}
        <form class="pag-instruir" data-instruir><label for="pag-instr"><b>Decile qué querés en esta página</b> <small class="tenue">(en tus palabras: «sumale una sección de proveedores», «sacá lo de las clases viejas»)</small></label>
          <div class="fila"><textarea id="pag-instr" rows="2" maxlength="1000" placeholder="Qué agregar, sacar o cambiar…"></textarea><button class="btn btn-primario">Construir</button></div></form>
        ${p.instrucciones.length ? `<details class="pag-instrucciones" ${pendientes.length ? 'open' : ''}><summary>Lo que le pediste (${p.instrucciones.length}${pendientes.length ? ` · ${pendientes.length} sin aplicar` : ''})</summary><ul>${p.instrucciones.slice().reverse().map((x) => `<li class="${x.aplicada ? '' : 'pendiente'}">${x.aplicada ? '✓' : '…'} ${esc(x.texto)} <small class="tenue">${fechaPag(x.en)}${!x.aplicada && x.nota ? ` · ${esc(x.nota)}` : ''}</small></li>`).join('')}</ul></details>` : ''}
        ${p.construidaEn ? `<p class="tenue chico">Construida ${haceCuanto(p.construidaEn)}. Se rehace sola de noche si algo cambió.</p>` : ''}
      </div>
      <aside class="pag-lado">${lado}</aside>
    </div>`

  if (esArq) void pintarFichaArquetipo(n)
  if (esArq) {
    $$('[data-pest]', raiz).forEach((b) => (b.onclick = () => {
      pestanaArq = b.dataset.pest
      $$('[data-pest]', raiz).forEach((x) => x.classList.toggle('on', x === b))
      $('.pag-cuerpo', raiz).hidden = pestanaArq === 'run'
      $('#arq-run').hidden = pestanaArq !== 'run'
      if (pestanaArq === 'run') void pintarRunArquetipo(n)
    }))
    if (pestanaArq === 'run') void pintarRunArquetipo(n)
  }
  const reconstruir = async (que) => {
    $$('[data-construir], [data-instruir] button', raiz).forEach((b) => { b.disabled = true; b.textContent = 'Construyendo…' })
    try {
      await que()
      const r = await api(urlPagina(tipo, clave))
      if (vista === tipo && vistaParam === String(clave)) pintarPaginaPropia(tipo, clave, r.pagina, r.datos)
      toast('Página construida', 'suave')
    } catch (e) { error(e); $$('[data-construir], [data-instruir] button', raiz).forEach((b) => { b.disabled = false; b.textContent = 'Construir' }) }
  }
  $$('[data-construir]', raiz).forEach((b) => (b.onclick = () => reconstruir(() => api(urlPagina(tipo, clave, "/construir"), {}))))
  $('[data-instruir]', raiz).onsubmit = (e) => {
    e.preventDefault()
    const texto = $('#pag-instr').value.trim()
    if (!texto) return $('#pag-instr').focus()
    reconstruir(() => api(urlPagina(tipo, clave, "/instruir"), { texto }))
  }
  const nombrar = $('[data-nombrar]', raiz)
  if (nombrar) nombrar.onclick = () => {
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Nombre del arquetipo ${d.celda.etiqueta}</h2>
      <p class="tenue">${esc(sub)}. El nombre lo elegís vos («El Modista», «El Comprador»).</p>
      <form id="f-nombre" class="fila"><input id="nombre-arq" maxlength="80" value="${esc(p.nombre ?? '')}" placeholder="El …" autofocus><button class="btn btn-primario">Guardar</button></form>`)
    $('#f-nombre').onsubmit = async (e) => {
      e.preventDefault()
      try { await api(`/paginas/arquetipo/${n}/nombre`, { nombre: $('#nombre-arq').value }); cerrarModal(); montarPaginaPropia(tipo, clave) } catch (x) { error(x) }
    }
  }
  $$('[data-editar-seccion]', raiz).forEach((b) => (b.onclick = () => {
    const s = p.secciones.find((x) => x.id === b.dataset.editarSeccion)
    abrirModal(`<button class="btn btn-chico cerrar" data-cerrar>✕</button><h2>Escribir «${esc(s.titulo)}»</h2>
      <p class="tenue">Queda como tuya: el constructor no la pisa (salvo que se lo pidas). Vacía, se borra.</p>
      <form id="f-seccion"><input id="sec-titulo" value="${esc(s.titulo)}" maxlength="120"><textarea id="sec-cuerpo" rows="12">${esc(s.cuerpo)}</textarea><div class="fila"><button class="btn btn-primario">Guardar</button></div></form>`)
    $('#f-seccion').onsubmit = async (e) => {
      e.preventDefault()
      try { await api(urlPagina(tipo, clave, "/seccion"), { id: s.id, titulo: $('#sec-titulo').value, cuerpo: $('#sec-cuerpo').value }); cerrarModal(); montarPaginaPropia(tipo, clave) } catch (x) { error(x) }
    }
  }))
  $$('[data-agente]', raiz).forEach((a) => (a.onclick = () => modalAgente(a.dataset.agente)))
  $$('[data-pieza]', raiz).forEach((a) => (a.onclick = () => modalPieza(Number(a.dataset.pieza))))
}

// ─── A mano: los cuadernos de la tableta ────────────────────────────────

async function montarHojas(cuaderno) {
  if (!cuaderno) {
    $('#principal').innerHTML = `<div class="titulo"><h1>A mano</h1>
      <p>Tus cuadernos de la tableta (Huion): lo que escribiste en el Cuaderno en vivo o mandaste como hoja por Telegram o WhatsApp, hoja por hoja, con lo que se leyó.</p></div>
      <div id="hojas"><p class="tenue">Trayendo tus cuadernos…</p></div>`
    let cs
    try { cs = await api('/hojas') } catch (e) { return error(e) }
    $('#hojas').innerHTML = cs.length ? `<div class="grilla-tarjetas">${cs.map((c) => `<a class="tarjeta tarjeta-link" href="${rutaA('hojas', c.nombre)}">
        <div class="tarjeta-cab">${ico('notebook-pen')} ${c.hojas} hoja${c.hojas === 1 ? '' : 's'}${c.fallas ? ` · ${c.fallas} sin leer` : ''}</div>
        <h4>${esc(c.nombre)}</h4><p>${c.desde ? `${esc(String(c.desde).slice(0, 10))}${c.hasta && c.hasta !== c.desde ? ` → ${esc(String(c.hasta).slice(0, 10))}` : ''}` : fechaPag(c.ultima)}</p></a>`).join('')}</div>
        <p class="fila"><button class="btn" data-vivo>${ico('pen-tool')} Abrir el Cuaderno en vivo</button></p>`
      : `<div class="vacio"><div class="gran">✒</div><h2>Todavía no hay hojas</h2><p>Escribí en la tableta con el Cuaderno en vivo, o mandá una foto de la hoja por Telegram o WhatsApp diciendo «hoja».</p><button class="btn btn-primario" data-vivo>Abrir el Cuaderno en vivo</button></div>`
    $$('[data-vivo]').forEach((b) => (b.onclick = () => modalCuadernoVivo()))
    return
  }
  $('#principal').innerHTML = `<div class="titulo"><small class="tenue"><a href="${rutaA('hojas')}">A mano</a></small><h1>${esc(cuaderno)}</h1></div><div id="hojas"><p class="tenue">Trayendo las hojas…</p></div>`
  let hs
  try { hs = await api(`/hojas/cuaderno?nombre=${encodeURIComponent(cuaderno)}`) } catch (e) { return error(e) }
  $('#hojas').innerHTML = hs.length ? hs.map((h) => `<article class="hoja-a-mano">
      <a class="hoja-img" href="/api/hojas/${h.id}/imagen" target="_blank" rel="noopener"><img loading="lazy" src="/api/hojas/${h.id}/imagen" alt="Hoja ${h.hoja ?? ''}" onerror="this.closest('.hoja-img').classList.add('sin-imagen'); this.remove()"><span class="tenue">sin imagen guardada</span></a>
      <div class="hoja-texto"><div class="tarjeta-cab">Hoja ${h.hoja ?? '—'}${h.fecha ? ` · ${esc(String(h.fecha))}` : ''}${h.estado !== 'hecha' ? ` · ${esc(h.estado)}` : ''}</div>
        ${h.contenido ? `<div class="md">${md(h.contenido)}</div>` : `<p class="tenue">${h.estado === 'fallo' ? `No se pudo leer: ${esc(h.error ?? '')}` : 'Todavía no se leyó.'}</p>`}
        ${h.piezaId ? `<button class="btn btn-chico" data-pieza="${h.piezaId}">Ver en el corpus</button>` : ''}</div></article>`).join('')
    : `<div class="vacio"><h2>Este cuaderno no tiene hojas</h2></div>`
  $$('[data-pieza]').forEach((a) => (a.onclick = () => modalPieza(Number(a.dataset.pieza))))
}

// ─── Compras ────────────────────────────────────────────────────────────

async function montarCompras() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Compras</h1>
    <p>Lo que mandás para comprar (por el chat, Telegram o WhatsApp, en texto, audio o foto de una lista) queda acá. Tocá para tachar.</p></div>
    <form id="f-compras" class="fila compras-sumar"><input id="compras-txt" placeholder="leche, huevos, pilas AA…" maxlength="500" aria-label="Qué hay que comprar"><button class="btn btn-primario">Anotar</button></form>
    <div id="compras"><p class="tenue">Trayendo la lista…</p></div>`
  $('#f-compras').onsubmit = async (e) => {
    e.preventDefault()
    const texto = $('#compras-txt').value.trim()
    if (!texto) return
    try { await api('/compras', { texto }); $('#compras-txt').value = ''; pintarCompras() } catch (x) { error(x) }
  }
  await pintarCompras()
}

async function pintarCompras() {
  let xs
  try { xs = await api('/compras') } catch (e) { return error(e) }
  const pend = xs.filter((x) => x.estado === 'pendiente'), hechas = xs.filter((x) => x.estado !== 'pendiente').slice(0, 40)
  const fila = (x) => `<li class="compra ${x.estado}"><label><input type="checkbox" data-compra="${x.id}" ${x.estado === 'comprado' ? 'checked' : ''}><span><b>${esc(x.item)}</b>${x.cantidad ? ` <small>${esc(x.cantidad)}</small>` : ''}${x.nota ? `<small class="tenue"> · ${esc(x.nota)}</small>` : ''}</span></label>${x.estado === 'pendiente' ? `<button class="btn btn-chico btn-icono" data-descartar="${x.id}" title="Sacar de la lista">${ico('x')}</button>` : ''}</li>`
  $('#compras').innerHTML = `${pend.length ? `<ul class="compras-lista">${pend.map(fila).join('')}</ul>` : `<div class="vacio"><h2>Nada por comprar</h2><p>Mandale a Mastropiero «comprar leche y pilas» y aparece acá.</p></div>`}
    <p class="fila"><button class="btn btn-chico" data-importar title="Lee tus mensajes de los últimos meses que hablan de compras y anota lo que falte">${ico('search')} Recuperar las listas que ya mandé</button></p>
    ${hechas.length ? `<details class="compras-hechas"><summary>Ya comprado o sacado (${hechas.length})</summary><ul class="compras-lista">${hechas.map(fila).join('')}</ul></details>` : ''}`
  $$('[data-compra]').forEach((c) => (c.onchange = async () => { try { await api('/compras/marcar', { ids: [Number(c.dataset.compra)], estado: c.checked ? 'comprado' : 'pendiente' }); pintarCompras() } catch (e) { error(e) } }))
  $$('[data-descartar]').forEach((b) => (b.onclick = async () => { try { await api('/compras/marcar', { ids: [Number(b.dataset.descartar)], estado: 'descartado' }); pintarCompras() } catch (e) { error(e) } }))
  $('[data-importar]').onclick = async (e) => {
    const b = e.currentTarget
    b.disabled = true; b.textContent = 'Leyendo tus mensajes…'
    try { const r = await api('/compras/importar', {}); toast(`Revisé ${r.revisados} mensajes: ${r.nuevos} ítems nuevos de ${r.mensajes} listas.`, 'suave'); pintarCompras() } catch (x) { error(x); b.disabled = false }
  }
}

// ─── Extracciones (Fragua #264) ─────────────────────────────────────────

const CAMPOS_EXTRACCION = [
  ['origen', 'Origen (Microsoft, Azure Blob, GCS, S3…)'], ['destino', 'Destino'], ['que', 'Qué se copia'], ['herramienta', 'Herramienta'], ['ventana', 'Ventana'], ['volumen', 'Volumen'], ['costo', 'Costo estimado'], ['ejecuta', 'Quién ejecuta'],
  ['decide', 'Quién decide'], ['firma', 'Quién firma'], ['sistema', 'Qué sistema usa'], ['dolor', 'Qué le duele'], ['contacto', 'Contacto'], ['email', 'Email del cliente'],
  ['cobroEstado', 'Cobro: estado'], ['cobroFecha', 'Cobro: fecha comprometida (AAAA-MM-DD)'], ['cobroQuien', 'Cobro: quién responde'], ['notas', 'Notas'],
]
const ESTADO_EXTR = { prospecto: ['prospecto', ''], plan: ['con plan', 'vivo'], en_curso: ['en curso', 'vivo'], hecha: ['hecha', 'ok'], pausa: ['en pausa', 'mal'] }

/** #extracciones o #extracciones/12 (un cliente). */
async function montarExtracciones(param) {
  if (param) return montarExtraccion(Number(param))
  let xs
  try { xs = await api('/extracciones') } catch (e) { return error(e) }
  $('#principal').innerHTML = `<div class="titulo"><h1>Extracciones</h1>
    <p>Cada cliente de extracción de datos con su ficha (quién decide, quién firma, qué le duele, el cobro), el plan para quien lo ejecuta y los correos listos para mandar —en tus borradores, nunca solos—. De lunes a viernes a las 8:30 te deja los correos del día; si un cliente lleva 10 días sin contestar, te avisa.</p></div>
    <form id="f-extr" class="fila compras-sumar"><input name="cliente" placeholder="Cliente nuevo" maxlength="120" required aria-label="Cliente"><button class="btn btn-primario">Agregar</button></form>
    ${xs.length ? `<div class="tarjetas">${xs.map((x) => { const [t, cl] = ESTADO_EXTR[x.estado] ?? [x.estado, '']; return `<a class="tarjeta" href="${rutaA('extracciones', x.id)}"><div class="tarjeta-cab">${esc(x.cliente)}<span class="estado-chip ${cl}">${esc(t)}</span></div><p class="chico">${esc([x.ficha.origen, x.ficha.destino].filter(Boolean).join(' → ') || 'sin origen ni destino todavía')}</p><p class="tenue chico">${x.correos} correo${x.correos === 1 ? '' : 's'}${x.diasSinRespuesta != null ? ` · <b>${x.diasSinRespuesta} días sin contestar</b>` : ''}${x.ficha.cobroEstado ? ` · cobro: ${esc(x.ficha.cobroEstado)}` : ''}</p></a>` }).join('')}</div>` : '<div class="vacio"><h2>Sin clientes todavía</h2><p>Agregá uno arriba o contale a Mastropiero («nuevo cliente de extracción: …»).</p></div>'}`
  $('#f-extr').onsubmit = async (e) => {
    e.preventDefault()
    const cliente = new FormData(e.currentTarget).get('cliente')
    try { const x = await api('/extracciones', { cliente }); irA(`extracciones/${x.id}`) } catch (x) { error(x) }
  }
}

async function montarExtraccion(id) {
  let x
  try { x = await api(`/extracciones/${id}`) } catch (e) { return error(e) }
  const [t, cl] = ESTADO_EXTR[x.estado] ?? [x.estado, '']
  $('#principal').innerHTML = `<div class="titulo"><h1>${esc(x.cliente)} <span class="estado-chip ${cl}">${esc(t)}</span></h1><p><a href="${rutaA('extracciones')}">← Todos los clientes</a>${x.diasSinRespuesta != null ? ` · <b>${x.diasSinRespuesta} días sin contestar</b>` : ''}</p></div>
    <div class="chips">${Object.entries(ESTADO_EXTR).map(([k, [n]]) => `<button class="chip ${k === x.estado ? 'on' : ''}" data-estado-extr="${k}">${esc(n)}</button>`).join('')}</div>
    <form id="f-ficha" class="reservas-form">${CAMPOS_EXTRACCION.map(([k, n]) => `<label class="chico tenue">${esc(n)}<input name="${k}" value="${esc(x.ficha[k] ?? '')}" aria-label="${esc(n)}"></label>`).join('')}<button class="btn btn-primario">Guardar la ficha</button></form>
    <div class="fila"><button class="btn btn-primario" id="x-plan">${x.plan ? 'Rehacer el plan' : 'Armar el plan'}</button><button class="btn" id="x-correo">Armar un correo</button></div>
    ${x.plan ? `<section class="seccion"><div class="seccion-cab"><h3>Plan</h3><button class="btn btn-chico" data-copiar-x="plan">Copiar</button></div><pre class="fr-copia">${esc(x.plan)}</pre>
      ${x.paraTecnico ? `<h4>Para el técnico</h4><p class="chico">${esc(x.paraTecnico)}</p>` : ''}${x.paraQuienPaga ? `<h4>Para el que paga</h4><p class="chico">${esc(x.paraQuienPaga)}</p>` : ''}</section>` : ''}
    <section class="seccion"><div class="seccion-cab"><h3>Correos · ${x.correos.length}</h3><span class="tenue">Quedan en tus borradores de Gmail (si el cliente tiene email); los mandás vos. Lo mandado y lo respondido se ve solo desde tu Gmail.</span></div>
      ${x.correos.map((c) => `<article class="tarjeta" data-correo-x="${c.id}"><div class="tarjeta-cab">${esc(c.asunto)}<span class="estado-chip ${c.estado === 'respondido' ? 'ok' : c.estado === 'mandado' ? 'vivo' : ''}">${esc(c.estado)}</span></div><pre class="fr-copia">${esc(c.cuerpo)}</pre>${c.pedido ? `<p class="tenue chico">Pedido: ${esc(c.pedido)}</p>` : ''}
        <div class="tarjeta-pie"><button class="btn btn-chico" data-copiar-correo>Copiar</button>${c.estado === 'borrador' ? '<button class="btn btn-chico" data-marcar="mandado">Ya lo mandé</button>' : ''}${c.estado !== 'respondido' ? '<button class="btn btn-chico" data-marcar="respondido">Contestó</button>' : ''}${c.estado === 'borrador' ? '<button class="btn btn-chico" data-marcar="descartado">Descartar</button>' : ''}</div></article>`).join('') || '<p class="tenue">Todavía ninguno.</p>'}
    </section>`
  const recargar = () => montarExtraccion(id)
  $$('[data-estado-extr]').forEach((b) => (b.onclick = async () => { try { await api(`/extracciones/${id}`, { estado: b.dataset.estadoExtr }); recargar() } catch (e) { error(e) } }))
  $('#f-ficha').onsubmit = async (e) => {
    e.preventDefault()
    try { await api(`/extracciones/${id}`, { ficha: Object.fromEntries(new FormData(e.currentTarget)) }); toast('Ficha guardada', 'suave'); recargar() } catch (x) { error(x) }
  }
  $('#x-plan').onclick = async (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Armando el plan…'; try { await api(`/extracciones/${id}/plan`, {}); recargar() } catch (x) { error(x); recargar() } }
  $('#x-correo').onclick = async (e) => {
    const p = await preguntar('¿Para qué es el correo? (primer contacto, seguimiento, mandar el plan, el cobro…)', 'seguimiento', { ok: 'Armarlo' })
    if (p == null) return
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Armando…'
    try { const c = await api(`/extracciones/${id}/correo`, { proposito: p }); toast(esc(c.nota), 'suave'); recargar() } catch (x) { error(x); recargar() }
  }
  const pc = $('[data-copiar-x]')
  if (pc) pc.onclick = async () => { try { await navigator.clipboard.writeText(x.plan); toast('Plan copiado', 'suave') } catch { toast('No pude copiar: seleccionalo a mano', 'error') } }
  $$('[data-correo-x]').forEach((el) => {
    const c = x.correos.find((y) => y.id === Number(el.dataset.correoX))
    $('[data-copiar-correo]', el).onclick = async () => { try { await navigator.clipboard.writeText(`${c.asunto}\n\n${c.cuerpo}`); toast('Correo copiado', 'suave') } catch { toast('No pude copiar', 'error') } }
    $$('[data-marcar]', el).forEach((b) => (b.onclick = async () => { try { await api(`/extracciones/correos/${c.id}`, { estado: b.dataset.marcar }); recargar() } catch (e) { error(e) } }))
  })
}

// ─── Encuestas y cuotas (Fragua #263) ───────────────────────────────────

const coma = (n) => (n == null ? '—' : String(n).replace('.', ','))

/** #mercados o #mercados/29N. */
async function montarMercados(param) {
  let d
  try { d = await api(`/mercados${param ? `?evento=${encodeURIComponent(param)}` : ''}`) } catch (e) { return error(e) }
  const ev = d.evento
  const tarjeta = (a) => `<article class="tarjeta mercado">
      <div class="tarjeta-cab">${esc(a.mercado.nombre)}<span class="tenue chico">${a.casas.length} casa${a.casas.length === 1 ? '' : 's'}</span></div>
      ${a.casas.length ? `<table class="tabla-mercado"><thead><tr><th>Casa</th>${a.mercado.resultados.map((r) => `<th>${esc(r)}</th>`).join('')}<th>Margen</th></tr></thead><tbody>
        ${a.casas.map((c) => `<tr><td>${esc(c.casa)} <small class="tenue">${esc(c.actualizada)}</small></td>${a.mercado.resultados.map((r) => `<td>${coma(c.cuotas[r])}</td>`).join('')}<td>${c.margen == null ? '<span class="tenue" title="No publicó todos los resultados">?</span>' : `${coma(c.margen)} %`}</td></tr>`).join('')}
      </tbody></table>
      <ul class="lista-mercado">${a.resultados.map((r) => `<li><b>${esc(r.resultado)}</b>: consenso ${coma(r.consenso)} %${r.movimiento ? ` <small>(${r.movimiento > 0 ? '+' : ''}${coma(r.movimiento)} desde ayer)</small>` : ''}${r.mejor ? ` · paga más <b>${esc(r.mejor.casa)}</b> a ${coma(r.mejor.cuota)}` : ''}${r.avisos.map((x) => `<br><span class="aviso-mercado">⚠ ${esc(x.casa)}: ${coma(x.prob)} %, ${x.desvio > 0 ? '+' : ''}${coma(x.desvio)} puntos contra el resto</span>`).join('')}</li>`).join('')}</ul>` : '<p class="tenue">Sin cuotas todavía.</p>'}
    </article>`
  const enc = d.encuestas
  $('#principal').innerHTML = `<div class="titulo"><h1>Encuestas y cuotas</h1>
    <p>Cada mercado por separado (nunca mezclados), con el margen de cada casa, el consenso sin ese margen, quién paga más y la casa que se aparta del resto (eso es la oportunidad). Es información: apostar es plata y va por el Monedero, con su tope. Las cuotas las cargás acá o se las mandás a Mastropiero («Retabet: Feijóo presidente 1,16»).</p></div>
    ${d.eventos.length > 1 ? `<div class="chips">${d.eventos.map((e) => `<a class="chip ${e === ev ? 'on' : ''}" href="${rutaA('mercados', e)}">${esc(e)}</a>`).join('')}</div>` : ''}
    <form id="f-cuota" class="reservas-form">
      <input name="evento" placeholder="Evento (29N)" value="${esc(ev ?? '')}" required aria-label="Evento">
      <input name="mercado" placeholder="Mercado (Feijóo presidente)" required aria-label="Mercado">
      <input name="casa" placeholder="Casa" required aria-label="Casa">
      <input name="si" placeholder="Cuota «sí»" inputmode="decimal" required aria-label="Cuota sí">
      <input name="no" placeholder="Cuota «no» (para el margen)" inputmode="decimal" aria-label="Cuota no">
      <button class="btn btn-primario">Anotar cuotas</button>
    </form>
    ${ev ? `<div class="tarjetas">${d.mercados.map(tarjeta).join('') || '<p class="tenue">Sin mercados.</p>'}</div>
    <section class="seccion"><div class="seccion-cab"><h3>Encuestas · ${esc(ev)}</h3><span class="tenue">Promedio de las últimas cinco, con la dispersión.</span></div>
      ${enc?.promedio?.length ? `<ul class="lista-mercado">${enc.promedio.map((p) => `<li><b>${esc(p.opcion)}</b> ${coma(p.promedio)} % <small class="tenue">±${coma(p.desvio)} · ${p.min}–${p.max} · ${p.encuestas} encuestas</small></li>`).join('')}</ul>
        <details><summary class="tenue">Las últimas</summary><ul class="chico">${enc.ultimas.map((u) => `<li>${esc(u.encuestadora)} · ${esc(u.campo)}${u.muestra ? ` · n=${u.muestra}` : ''} · ${Object.entries(u.cifras).map(([k, v]) => `${esc(k)} ${coma(v)}`).join(', ')}</li>`).join('')}</ul></details>` : '<p class="tenue">Sin encuestas todavía.</p>'}
      <form id="f-encuestas" class="fila compras-sumar"><input name="url" placeholder="Link a una tabla pública de encuestas (la de Wikipedia)" aria-label="Link de encuestas"><button class="btn">Traer encuestas</button></form>
    </section>
    <p><button class="btn btn-chico" id="m-informe">Copiar el informe del día</button></p>` : '<div class="vacio"><h2>Sin mercados todavía</h2><p>Anotá la primera cuota arriba (con su evento y su mercado) o mandásela a Mastropiero.</p></div>'}`
  $('#f-cuota').onsubmit = async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = Object.fromEntries(new FormData(form))
    const cuotas = [{ resultado: 'sí', cuota: Number(String(f.si).replace(',', '.')) }, ...(String(f.no).trim() ? [{ resultado: 'no', cuota: Number(String(f.no).replace(',', '.')) }] : [])]
    try { await api('/mercados/cuotas', { evento: f.evento, mercado: f.mercado, casa: f.casa, cuotas }); toast('Cuotas anotadas', 'suave'); montarMercados(String(f.evento)) } catch (x) { error(x) }
  }
  const fe = $('#f-encuestas')
  if (fe) fe.onsubmit = async (e) => {
    e.preventDefault()
    const url = new FormData(e.currentTarget).get('url')
    if (!String(url).trim()) return
    const b = $('button', fe); b.disabled = true; b.textContent = 'Leyendo la tabla…'
    try { const r = await api('/mercados/encuestas', { evento: ev, url }); toast(`${r.leidas} encuestas leídas: ${r.nuevas} nuevas`, 'suave'); montarMercados(ev) } catch (x) { error(x); b.disabled = false; b.textContent = 'Traer encuestas' }
  }
  const inf = $('#m-informe')
  if (inf) inf.onclick = async () => { try { const r = await api(`/mercados/informe?evento=${encodeURIComponent(ev)}`); await navigator.clipboard.writeText(r.informe); toast('Informe copiado', 'suave') } catch (x) { error(x) } }
}

// ─── Reservas (Fragua #254) ─────────────────────────────────────────────

const ESTADO_RESERVA = { a_buscar: ['a buscar', ''], pedida: ['pedida', 'vivo'], confirmada: ['confirmada', 'ok'], cancelada: ['cancelada', 'mal'] }

async function montarReservas() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Reservas</h1>
    <p>Un restaurante, un médico, una mesa para seis: anotala acá o pedísela a Mastropiero («reservame en … para 6 el viernes a las 21»). Te deja el mail, el WhatsApp y el guion de la llamada listos; la mandás vos con un toque. Si a las 48 horas no confirmaron, te avisa con el recordatorio armado. Las confirmadas entran a tu agenda.</p></div>
    <form id="f-reserva" class="reservas-form">
      <input name="sitio" placeholder="Dónde (restaurante, médico…)" maxlength="120" required aria-label="Dónde">
      <input name="fecha" type="date" aria-label="Fecha">
      <input name="hora" type="time" aria-label="Hora">
      <input name="personas" type="number" min="1" max="99" placeholder="Personas" aria-label="Personas">
      <input name="telefono" placeholder="Teléfono" maxlength="40" aria-label="Teléfono">
      <input name="email" type="email" placeholder="Mail" maxlength="120" aria-label="Mail">
      <input name="link" placeholder="Link de reservas o web" maxlength="500" aria-label="Link">
      <input name="nota" placeholder="Algo a pedir: terraza, celíaco…" maxlength="500" aria-label="Nota">
      <button class="btn btn-primario">Anotar</button>
    </form>
    <div id="reservas"><p class="tenue">Trayendo tus reservas…</p></div>`
  $('#f-reserva').onsubmit = async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const d = Object.fromEntries([...f.entries()].filter(([, v]) => String(v).trim()))
    if (d.personas) d.personas = Number(d.personas)
    try { await api('/reservas', d); form.reset(); pintarReservas() } catch (x) { error(x) }
  }
  await pintarReservas()
}

async function pintarReservas() {
  let xs
  try { xs = await api('/reservas') } catch (e) { return error(e) }
  const abiertas = xs.filter((x) => x.estado !== 'cancelada' && !(x.estado === 'confirmada' && x.fecha && x.fecha < hoyISO()))
  const viejas = xs.filter((x) => !abiertas.includes(x)).slice(0, 30)
  const cuando = (x) => x.fecha ? `${new Date(`${x.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}${x.hora ? ` · ${x.hora}` : ''}` : (x.hora ?? 'sin fecha')
  const tarjeta = (x) => {
    const [txt, clase] = ESTADO_RESERVA[x.estado] ?? [x.estado, '']
    const horas = x.pedidaEn ? Math.round((Date.now() - x.pedidaEn) / 3_600_000) : null
    return `<article class="tarjeta" data-reserva="${x.id}">
      <div class="tarjeta-cab">#${x.id}<span class="estado-chip ${clase}">${esc(txt)}</span>${x.estado === 'pedida' && horas != null ? `<span class="tenue chico">${horas >= 48 ? `<b>hace ${Math.floor(horas / 24)} días sin confirmar</b>` : `pedida hace ${horas} h`}</span>` : ''}</div>
      <h4>${esc(x.sitio)}</h4>
      <p class="chico">${esc(cuando(x))}${x.personas ? ` · ${x.personas} persona${x.personas === 1 ? '' : 's'}` : ''}${x.nota ? ` · ${esc(x.nota)}` : ''}</p>
      ${x.comprobante ? `<p class="tenue chico">✓ ${esc(x.comprobante)}</p>` : ''}
      <div class="tarjeta-pie" data-acciones><span class="tenue chico">Armando los textos…</span></div>
    </article>`
  }
  $('#reservas').innerHTML = `${abiertas.length ? `<div class="tarjetas">${abiertas.map(tarjeta).join('')}</div>` : '<div class="vacio"><h2>Sin reservas abiertas</h2><p>Anotá una arriba o pedísela a Mastropiero.</p></div>'}
    ${viejas.length ? `<details class="compras-hechas"><summary>Pasadas o canceladas (${viejas.length})</summary><div class="tarjetas">${viejas.map(tarjeta).join('')}</div></details>` : ''}`
  for (const el of $$('[data-reserva]')) {
    const id = Number(el.dataset.reserva)
    const x = xs.find((r) => r.id === id)
    let t
    try { t = await api(`/reservas/${id}/textos`) } catch { continue }
    const pie = $('[data-acciones]', el)
    const insistir = x.estado === 'pedida'
    const texto = insistir ? t.recordatorio : `${t.asunto}\n\n${t.cuerpo}`
    pie.innerHTML = `${t.links.mail ? `<a class="btn btn-chico" href="${esc(t.links.mail)}">✉ Mail</a>` : ''}${t.links.whatsapp ? `<a class="btn btn-chico" href="${esc(t.links.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}${t.links.llamar ? `<a class="btn btn-chico" href="${esc(t.links.llamar)}">📞 Llamar</a>` : ''}${t.links.web ? `<a class="btn btn-chico" href="${esc(t.links.web)}" target="_blank" rel="noopener">↗ Web</a>` : ''}
      <button class="btn btn-chico" data-copiar-reserva>${insistir ? 'Copiar el recordatorio' : 'Copiar el pedido'}</button>
      <span class="espacio"></span>
      ${x.estado === 'a_buscar' ? '<button class="btn btn-chico btn-primario" data-reserva-estado="pedida">Ya la pedí</button>' : ''}
      ${x.estado === 'a_buscar' || x.estado === 'pedida' ? '<button class="btn btn-chico btn-primario" data-reserva-estado="confirmada">Confirmada</button>' : ''}
      ${x.estado !== 'cancelada' ? '<button class="btn btn-chico" data-reserva-estado="cancelada">Cancelar</button>' : ''}
      <details class="reserva-guion"><summary class="tenue chico">Guion de la llamada</summary><ol class="chico">${t.llamada.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>`
    $('[data-copiar-reserva]', pie).onclick = async () => { try { await navigator.clipboard.writeText(texto); toast('Copiado', 'suave') } catch { toast('No pude copiar: seleccionalo a mano', 'error') } }
    $$('[data-reserva-estado]', pie).forEach((b) => (b.onclick = async () => {
      const estado = b.dataset.reservaEstado
      const cuerpo = { estado }
      if (estado === 'confirmada') { const c = await preguntar('¿A nombre de quién quedó, o el código de la reserva? (opcional)', '', { ok: 'Confirmada' }); if (c == null) return; if (c.trim()) cuerpo.comprobante = c.trim() }
      try { await api(`/reservas/${id}`, cuerpo); pintarReservas() } catch (e) { error(e) }
    }))
  }
}

// ─── Diario por escalas (Fragua #286) ───────────────────────────────────

const ESCALAS_VISTA = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['trimestre', 'Trimestre'], ['cuatrimestre', 'Cuatrimestre'], ['semestre', 'Semestre'], ['año', 'Año'], ['lustro', 'Lustro']]

/** #escalas o #escalas/semana:2026-11-16 (la escala y una fecha adentro del período). */
async function montarEscalas(param) {
  const [escala, fecha] = String(param ?? '').split(':')
  const e = ESCALAS_VISTA.some(([x]) => x === escala) ? escala : 'dia'
  const f = fecha || hoyISO()
  $('#principal').innerHTML = `<div class="titulo"><h1>Diario por escalas</h1>
    <p>Cada pieza tuya (un audio, una foto, una nota, una hoja) cae sola en su día. El día se resume desde sus piezas; la semana, desde sus días; el mes, desde sus semanas… hasta el lustro. Se arma de noche.</p></div>
    <div class="chips">${ESCALAS_VISTA.map(([x, n]) => `<a class="chip ${x === e ? 'on' : ''}" href="${rutaA('escalas', x + ':' + f)}">${n}</a>`).join('')}</div>
    <div id="esc"><p class="tenue">Trayendo…</p></div>`
  let r
  try { r = await api('/escalas?escala=' + encodeURIComponent(e) + '&fecha=' + encodeURIComponent(f)) } catch (x) { return error(x) }
  const nombreDe = (x) => ESCALAS_VISTA.find(([k]) => k === x)?.[1] ?? x
  const rango = r.desde === r.hasta ? '' : `${esc(r.desde)} → ${esc(r.hasta)}`
  const cuerpo = r.texto
    ? `<section class="pag-seccion"><div class="md">${md(r.texto)}</div><p class="tenue chico">${r.piezas} pieza${r.piezas === 1 ? '' : 's'} · armado ${haceCuanto(r.hechoEn)}</p></section>`
    : `<div class="vacio"><h2>Todavía no está armado</h2><p>${e === 'dia' ? 'Se arma de noche si ese día dejaste piezas o actividad.' : 'Se arma desde los resúmenes de sus partes.'}</p></div>`
  const partes = r.partes.length
    ? `<h3 class="sub">Sus partes (${esc(nombreDe(r.de)).toLowerCase()})</h3><div class="grilla-tarjetas">${r.partes.map((p) => `<a class="tarjeta tarjeta-link" href="${rutaA('escalas', r.de + ':' + p.desde)}"><div class="tarjeta-cab">${esc(p.clave)}</div>${p.texto ? `<p class="recorte">${esc(p.texto)}</p>` : '<p class="tenue">sin armar</p>'}</a>`).join('')}</div>`
    : ''
  const piezas = r.piezasDelDia.length
    ? `<h3 class="sub">Sus piezas</h3><ul class="pag-lista">${r.piezasDelDia.map((p) => `<li><button class="link" data-pieza="${p.id}">${esc(p.titulo)}</button><small>${esc(p.fuente)}</small></li>`).join('')}</ul>`
    : ''
  $('#esc').innerHTML = `<div class="fila esc-nav"><a class="btn btn-chico" href="${rutaA('escalas', e + ':' + r.anterior)}">←</a><h2 class="sub">${esc(nombreDe(e))} ${esc(r.clave)} <small class="tenue">${rango}</small></h2><a class="btn btn-chico" href="${rutaA('escalas', e + ':' + r.siguiente)}">→</a><button class="btn btn-chico" data-armar title="Armarlo ahora (y lo que lo contiene)">${ico('refresh-cw')} Armar</button>${e === 'dia' ? '<button class="btn btn-chico btn-primario" data-cargar title="Trae lo de Drive y la cola, guarda la charla del día y arma el diario">Cargar este día</button>' : ''}</div>${cuerpo}${partes}${piezas}`
  $$('#esc [data-pieza]').forEach((a) => (a.onclick = () => modalPieza(Number(a.dataset.pieza))))
  const cargar = $('#esc [data-cargar]')
  if (cargar) cargar.onclick = async () => {
    cargar.disabled = true
    cargar.textContent = 'Cargando…'
    try {
      const x = await api('/cargar-dia', { fecha: r.desde })
      toast(`Cargué ${x.piezas.length} pieza${x.piezas.length === 1 ? '' : 's'} del ${esc(x.fecha)}${x.charla ? ' (con la charla del día)' : ''}${x.avisos.length ? `<small>${esc(x.avisos.join(' · '))}</small>` : ''}`, 'suave')
      montarEscalas('dia:' + r.desde)
    } catch (y) { error(y); cargar.disabled = false }
  }
  $('#esc [data-armar]').onclick = async (ev) => {
    const b = ev.currentTarget
    b.disabled = true
    b.textContent = 'Armando…'
    try {
      const x = await api('/escalas/armar', { fecha: r.desde })
      toast(x.hechas.length ? `Armé: ${esc(x.hechas.join(', '))}` : 'No había nada nuevo para armar', 'suave')
      montarEscalas(e + ':' + r.desde)
    } catch (y) { error(y); b.disabled = false }
  }
}

// ─── El Monedero del Tesorero (Fragua #255 y #261) ──────────────────────

const euros = (n, moneda = 'EUR') => `${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${moneda === 'EUR' ? '€' : moneda}`
const NOMBRE_TIPO_CUENTA = { caja: 'Caja', banco: 'Cuenta', reserva: 'Reserva', inversion: 'Inversión', deuda: 'Deuda', arquetipo: 'Arquetipo', agente: 'Agente', proyecto: 'Proyecto' }

async function montarMonedero() {
  $('#principal').innerHTML = `<div class="titulo"><h1>Monedero</h1>
    <p>El libro del Tesorero sobre tus cuentas de siempre: lo que entra y sale de verdad viene de Finanzas; acá se ve tu patrimonio, cada cuenta, las arcas de tus agentes y arquetipos (lo que generan, que crece) y lo que espera tu firma. El Tesorero calcula y propone: no mueve plata.</p></div>
    <div id="mon"><p class="tenue">Contando…</p></div>`
  await pintarMonedero()
}

async function pintarMonedero() {
  let v
  try { v = await api('/monedero') } catch (e) { return error(e) }
  const p = v.patrimonio
  const max = Math.max(1, ...v.serie.map((x) => Math.abs(x.total)))
  const barras = v.serie.map((x) => `<div class="mon-barra" title="${esc(x.mes)}: ${esc(euros(x.total))}"><i class="mon-alto-${Math.max(1, Math.round((Math.abs(x.total) / max) * 10))} ${x.total < 0 ? 'neg' : ''}"></i><small>${esc(x.mes.slice(5))}</small></div>`).join('')
  const otras = Object.entries(p.porMoneda).filter(([m]) => m !== 'EUR')
  const cuenta = (c) => `<div class="tarjeta"><div class="tarjeta-cab">${esc(NOMBRE_TIPO_CUENTA[c.tipo] ?? c.tipo)}${c.frenada ? ' · ⛔ frenada' : ''}${c.tasa != null ? ` · ${c.tasa} % anual` : ''}</div><h4>${esc(c.nombre)}</h4><p><b>${esc(euros(c.saldo, c.moneda))}</b>${c.riesgo ? ` · riesgo: ${esc(c.riesgo)}` : ''}</p></div>`
  const nombreDe = (clave) => [...p.cuentas, ...p.arcas].find((c) => c.clave === clave)?.nombre ?? clave
  $('#mon').innerHTML = `
    ${v.alerta ? `<div class="mon-alerta">⚠ ${esc(v.alerta)}</div>` : ''}
    ${v.sinSaldoInicial.length ? `<div class="mon-alerta">Falta el saldo inicial de ${esc(v.sinSaldoInicial.join(', '))}: sin él, el patrimonio solo suma lo que entró y salió. Decile a Mastropiero cuánto tenía cada una y desde cuándo («la caja tenía 3.200 € el 1/11»).</div>` : ''}
    <section class="mon-cabeza">
      <div><small class="tenue">Patrimonio hoy</small><div class="mon-total">${esc(euros(p.total))}</div><small class="tenue">activos ${esc(euros(p.activos))} · pasivos ${esc(euros(p.pasivos))}${otras.length ? ` · además ${otras.map(([m, n]) => esc(euros(n, m))).join(', ')}` : ''}</small></div>
      <div class="mon-serie" aria-label="Patrimonio de los últimos 12 meses">${barras}</div>
    </section>
    ${v.propuestos.length ? `<h2 class="sub">Esperan tu firma</h2><ul class="pag-lista mon-firmas">${v.propuestos.map((a) => `<li><span><b>${esc(euros(a.monto, a.moneda))}</b> ${esc(nombreDe(a.desde))} → ${esc(nombreDe(a.hacia))}${a.monto > v.tope ? ' <span class="chip chip-chico">pasa el tope</span>' : ''}<small>${esc(a.motivo)}</small></span><span class="fila"><button class="btn btn-chico btn-primario" data-firmar="${a.id}">✓ Firmar</button><button class="btn btn-chico" data-rechazar="${a.id}">✕</button></span></li>`).join('')}</ul>` : ''}
    <h2 class="sub">Tus cuentas</h2><div class="grilla-tarjetas">${p.cuentas.map(cuenta).join('')}</div>
    <h2 class="sub">Arcas de tus agentes, arquetipos y proyectos</h2>
    ${p.arcas.length ? `<div class="grilla-tarjetas">${p.arcas.map(cuenta).join('')}</div>` : '<p class="tenue">Todavía ninguna tiene plata: un ingreso que generó un agente o un arquetipo se le atribuye abajo, y crece en sus arcas.</p>'}
    ${v.generadoTotal.length ? `<h3 class="sub">Lo que generó cada uno</h3><ul class="pag-lista">${v.generadoTotal.map((g) => `<li><b>${esc(g.nombre)}</b><small>${esc(euros(g.total))} en ${g.ingresos} ingreso${g.ingresos === 1 ? '' : 's'}${v.generadoMes.find((x) => x.clave === g.clave) ? ` · este mes ${esc(euros(v.generadoMes.find((x) => x.clave === g.clave).total))}` : ''}</small></li>`).join('')}</ul>` : ''}
    ${v.sinAtribuir.length ? `<h3 class="sub">Ingresos del mes sin atribuir</h3><ul class="pag-lista">${v.sinAtribuir.map((m) => `<li><span><b>${esc(euros(m.monto, m.moneda))}</b> ${esc(m.descripcion)} <small>${esc(m.fecha)}</small></span><form class="fila" data-atribuir="${m.id}"><input placeholder="¿Quién lo generó? (agente, celda 12, proyecto)" aria-label="Quién lo generó"><button class="btn btn-chico">Atribuir</button></form></li>`).join('')}</ul>` : ''}
    <div class="mon-ajustes">
      <section><h3>Reparto de cada ingreso</h3><p class="tenue chico">El Tesorero propone, vos firmás. Lo que queda es para gastar.</p>
        <form class="fila" id="mon-reparto"><label>Reserva <input type="number" min="0" max="100" value="${v.reparto?.reserva ?? 0}" name="reserva"> %</label><label>Inversión <input type="number" min="0" max="100" value="${v.reparto?.inversion ?? 0}" name="inversion"> %</label><button class="btn btn-chico">Guardar</button></form></section>
      <section><h3>Metas de patrimonio</h3>${v.metas.length ? `<ul class="pag-lista">${v.metas.map((m) => `<li><b>${esc(euros(m.monto))} al ${esc(m.fecha)}</b><small>${m.avance} % · faltan ${esc(euros(m.falta))} (${esc(euros(m.porMes))} por mes)${m.nota ? ` · ${esc(m.nota)}` : ''}</small></li>`).join('')}</ul>` : '<p class="tenue chico">Sin metas todavía.</p>'}
        <form class="fila" id="mon-meta"><input type="number" min="1" name="monto" placeholder="Monto" aria-label="Monto de la meta"><input type="date" name="fecha" aria-label="Para cuándo"><button class="btn btn-chico">Fijar</button></form></section>
      ${v.proyeccion.length ? `<section><h3>A interés compuesto (12 meses)</h3><ul class="pag-lista">${v.proyeccion.map((x) => `<li><b>${esc(x.cuenta)}: ${esc(euros(x.seria))}</b><small>+${esc(euros(x.ganancia))} al ${x.tasaAnual} % · riesgo: ${esc(x.riesgo)}</small></li>`).join('')}</ul></section>` : ''}
    </div>
    <p class="tenue chico">Para cargar Belo o el banco: importá su CSV en Finanzas con el nombre de la cuenta; aparece sola acá. El saldo inicial de cada cuenta, la tasa, una deuda o el freno de mano: pedíselo a Mastropiero («la caja tenía 3.200 € el 1/11»).</p>`
  $$('[data-firmar]').forEach((b) => (b.onclick = async () => { try { await api('/monedero/firmar', { id: Number(b.dataset.firmar), si: true }); pintarMonedero() } catch (e) { error(e) } }))
  $$('[data-rechazar]').forEach((b) => (b.onclick = async () => { try { await api('/monedero/firmar', { id: Number(b.dataset.rechazar), si: false }); pintarMonedero() } catch (e) { error(e) } }))
  $$('[data-atribuir]').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault()
    const hacia = $('input', f).value.trim()
    if (!hacia) return $('input', f).focus()
    try { await api('/monedero/atribuir', { movimiento: Number(f.dataset.atribuir), hacia }); toast('Atribuido: va a sus arcas', 'suave'); pintarMonedero() } catch (x) { error(x) }
  }))
  $('#mon-reparto').onsubmit = async (e) => {
    e.preventDefault()
    const f = e.currentTarget
    try { await api('/monedero/reparto', { reserva: Number(f.reserva.value), inversion: Number(f.inversion.value) }); toast('Reparto guardado: desde hoy, cada ingreso se propone repartido', 'suave'); pintarMonedero() } catch (x) { error(x) }
  }
  $('#mon-meta').onsubmit = async (e) => {
    e.preventDefault()
    const f = e.currentTarget
    try { await api('/monedero/meta', { monto: Number(f.monto.value), fecha: f.fecha.value }); pintarMonedero() } catch (x) { error(x) }
  }
}
