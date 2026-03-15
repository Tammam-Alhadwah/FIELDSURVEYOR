const CACHE     = 'fieldsurveyor-v3';
const MAP_CACHE = 'fieldsurveyor-maps';
const ASSETS    = ['./index.html', './manifest.json', './styles/main.css',
                   './js/app.js', './js/constants.js', './js/state.js',
                   './js/utils.js', './js/sensors.js', './js/map.js',
                   './js/recording.js', './js/history.js', './js/replay.js',
                   './js/pois.js', './js/coverage.js', './js/voice.js',
                   './js/panel-dock.js'];

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

  // Offline map tile caching — cache-first, then network
  if (url.includes('basemaps.cartocdn.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(MAP_CACHE).then(c => c.put(e.request, clone));
          return res;
        }).catch(() => {});
      })
    );
    return;
  }

  // App shell — cache-first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
