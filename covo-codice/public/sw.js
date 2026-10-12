// Service worker minimo: serve solo a rendere Conv installabile come app.
// Non salva niente in memoria e non cambia nessuna richiesta: il sito funziona esattamente come nel browser.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
