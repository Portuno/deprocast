// Service worker mínimo: hace instalable la app y guarda la cáscara (HTML, estilos, scripts) para abrir rápido.
// Los datos (/api) siempre van al servidor. Solo lo propio (no los scripts que mete un proxy, como el de Cloudflare)
// y solo respuestas buenas: una redirección o la página de la clave no se guardan nunca.
const CACHE = 'mastro-v6'
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (e) => {
  // Las versiones viejas se borran (una pudo haber guardado una redirección).
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/taller/') || url.pathname === '/entrar') return
  // Primero la red (siempre lo último); si no hay red, lo guardado; si tampoco, un error de red de verdad.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && r.type === 'basic') {
      const copia = r.clone()
      caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {})
    }
    return r
  }).catch(async () => (await caches.match(e.request)) ?? Response.error()))
})
