// Service worker mínimo: hace instalable la app y guarda la cáscara (HTML, estilos, scripts) para abrir rápido.
// Los datos (/api) siempre van al servidor.
const CACHE = 'mastro-v1'
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/taller/')) return
  // Primero la red (siempre lo último); si no hay red, lo guardado.
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone()
    caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {})
    return r
  }).catch(() => caches.match(e.request)))
})
