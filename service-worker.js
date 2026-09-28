// Brak cache danych pacjentów, API, tokenów i odpowiedzi AI. Interfejs zawsze z sieci.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
