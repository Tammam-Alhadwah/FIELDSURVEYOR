const CACHE      = 'fieldsurveyor-v2';
const MAP_CACHE  = 'fieldsurveyor-maps';
const ASSETS     =['./index.html', './manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE && k !== MAP_CACHE).map(k => caches.delete(k)))
        )
    );
});

self.addEventListener('fetch', e => {
    const url = e.request.url;

    // 🗺️ OFFLINE MAP TILE CACHING
    // If the app requests a map tile from CARTO, check the cache first.
    // If it's not in the cache, fetch it from the internet and save it for later.
    if (url.includes('basemaps.cartocdn.com')) {
        e.respondWith(
            caches.match(e.request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse; // Return saved tile immediately
                
                return fetch(e.request).then(networkResponse => {
                    const responseClone = networkResponse.clone();
                    caches.open(MAP_CACHE).then(cache => cache.put(e.request, responseClone));
                    return networkResponse;
                }).catch(() => {
                    // Ignore offline errors for map tiles
                });
            })
        );
        return;
    }

    // Normal caching for the rest of the app
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});