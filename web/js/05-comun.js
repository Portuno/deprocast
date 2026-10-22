'use strict'
// Lo compartido entre vistas y la carga perezosa: al arrancar baja solo el núcleo (Hoy, el chat, el HUD, el Directo, la
// liga); cada otra vista se pide la primera vez que se abre. El servidor manda en window.PEREZOSOS qué archivo tiene qué
// funciones (y qué otros archivos necesita); acá cada una de esas funciones queda como un «stub» que carga su archivo y
// la llama. Cuando el archivo carga, su declaración reemplaza al stub.

const cargandoScripts = new Map()

/** Carga un script de /js/ una vez (y antes, los que necesita), con su versión para la caché inmutable. */
function cargarScript(nombre) {
  if (cargandoScripts.has(nombre)) return cargandoScripts.get(nombre)
  const info = window.PEREZOSOS?.[nombre]
  const p = (async () => {
    for (const d of info?.necesita ?? []) await cargarScript(d)
    await new Promise((ok, mal) => {
      const s = document.createElement('script')
      s.src = `/js/${nombre}${info?.v ? `?v=${info.v}` : ''}`
      s.onload = ok
      s.onerror = () => mal(new Error(`No pude cargar ${nombre} (¿sin conexión?)`))
      document.head.append(s)
    })
  })()
  cargandoScripts.set(nombre, p)
  p.catch(() => cargandoScripts.delete(nombre)) // un error de red no queda pegado: se reintenta la próxima vez
  return p
}

/** Los stubs: misma firma, devuelven una promesa. Montar una vista dice cuál está abriendo mientras baja su archivo. */
for (const [archivo, info] of Object.entries(window.PEREZOSOS ?? {})) {
  for (const fn of info.funciones) {
    if (fn in window) continue
    const stub = function (...args) {
      if (fn.startsWith('montar') && $('#principal') && !document.querySelector(`script[src^="/js/${archivo}"]`)) $('#principal').innerHTML = `<p class="tenue cargando-vista" role="status">Abriendo ${esc(typeof nombreDeVista === 'function' ? nombreDeVista(VISTA_PADRE?.[vista] ?? vista) : '')}…</p>`
      return cargarScript(archivo).then(() => {
        if (window[fn] === stub) throw new Error(`${fn} no está en ${archivo}`)
        return window[fn](...args)
      })
    }
    window[fn] = stub
  }
}

// ─── compartido (antes vivía en una vista; lo usan otras al instante) ──────

const TIPO_ENT = {
  persona: { glifo: '◐', nombre: 'Personas' }, proyecto: { glifo: '◆', nombre: 'Proyectos' }, agrupacion: { glifo: '⬡', nombre: 'Agrupaciones' },
  dominio: { glifo: '▦', nombre: 'Dominios' }, lugar: { glifo: '⌖', nombre: 'Lugares' }, concepto: { glifo: '✧', nombre: 'Conceptos' },
}

const haceCuanto = (ms) => {
  const min = Math.round((Date.now() - ms) / 60000)
  return min < 60 ? `hace ${Math.max(1, min)} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} d`
}

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const corrDia = (f, n) => { const [a, m, d] = f.split('-').map(Number); const x = new Date(a, m - 1, d + n, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
