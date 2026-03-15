// ── FIELDSURVEYOR ── map.js ────────────────────────────────────────────────────
// Owns the MapLibre GL instance and all map layer management.
// Other modules import mapState.map to call setData() on sources.

import { mapState, uiState }  from './state.js';
import { log, lngLatToTile }  from './utils.js';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAX_ROUTE_DISPLAY } from './constants.js';

// ── Init ───────────────────────────────────────────────────────────────────────
export function initMap(onLongPress) {
  mapState.map = new maplibregl.Map({
    container: 'map',
    style:     'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center:    DEFAULT_CENTER,
    zoom:      DEFAULT_ZOOM,
    pitch:     60,
    bearing:   0,
    antialias: true,
  });

  const m = mapState.map;

  // Unlock camera follow when user manually pans/zooms
  const unlockCam = (e) => {
    if (mapState.cameraFollow && e.originalEvent) {
      mapState.cameraFollow = false;
      const b = document.getElementById('camToggleBtn');
      if (b) { b.textContent = '🎥 FREE-LOOK'; b.style.color = 'var(--amber)'; }
    }
  };
  m.on('dragstart',   unlockCam);
  m.on('zoomstart',   unlockCam);
  m.on('rotatestart', unlockCam);
  m.on('pitchstart',  unlockCam);

  // Long-press to drop POI
  let pressTimer;
  m.on('mousedown',  e => { pressTimer = setTimeout(() => onLongPress(e.lngLat.lng, e.lngLat.lat, e.originalEvent), 600); });
  m.on('touchstart', e => {
    if (e.originalEvent.touches.length === 1) {
      const t = e.originalEvent.touches[0];
      pressTimer = setTimeout(() => onLongPress(e.lngLat.lng, e.lngLat.lat, t), 600);
    }
  });
  m.on('mouseup',  () => clearTimeout(pressTimer));
  m.on('touchend', () => clearTimeout(pressTimer));
  m.on('drag',     () => clearTimeout(pressTimer));

  m.on('load', () => {
    mapState.loaded = true;
    document.getElementById('mapLoader').style.display = 'none';
    log('3D Map Engine loaded', 'ok');
    addMapLayers();
    // History source refreshed by history.js after map is ready
  });
}

// ── Layers ─────────────────────────────────────────────────────────────────────
export function addMapLayers() {
  const m = mapState.map;

  // 1. History overlay (lowest — drawn first)
  m.addSource('historySource', { type: 'geojson', data: mapState.geojsonHistory });
  m.addLayer({ id: 'historyLayer', type: 'line', source: 'historySource',
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
    paint:  { 'line-color': ['interpolate', ['linear'], ['get', 'roughness'],
                0, '#44aaff', 0.35, '#c084fc', 0.7, '#ff84aa'],
              'line-width': 4, 'line-opacity': 0.45 },
  });

  // 2. Coverage gap
  m.addSource('coverageSource', { type: 'geojson', data: mapState.geojsonCoverage });
  m.addLayer({ id: 'coverageLayer', type: 'line', source: 'coverageSource',
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
    paint:  { 'line-color': '#4af', 'line-width': 2.5, 'line-opacity': 0.55,
              'line-dasharray': [4, 3] },
  });

  // 3. Destination marker (Find feature)
  m.addSource('destSource', { type: 'geojson', data: mapState.geojsonDest });
  m.addLayer({ id: 'destLayer', type: 'circle', source: 'destSource',
    paint: { 'circle-radius': 10, 'circle-color': '#c084fc',
             'circle-stroke-width': 3, 'circle-stroke-color': '#fff',
             'circle-pitch-alignment': 'map' },
  });

  // 4. Live quality trail
  m.addSource('routeSource', { type: 'geojson', data: mapState.geojsonRoute });
  m.addLayer({ id: 'routeQualityLayer', type: 'line', source: 'routeSource',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint:  { 'line-color': ['interpolate', ['linear'], ['get', 'roughness'],
                0, '#39ff84', 0.35, '#ffb830', 0.7, '#ff4444'],
              'line-width': 6, 'line-opacity': 0.85 },
  });

  // 5. POI pins
  m.addSource('poiSource', { type: 'geojson', data: mapState.geojsonPOIs });
  m.addLayer({ id: 'poiLayer', type: 'circle', source: 'poiSource',
    paint: { 'circle-radius': 7,
             'circle-color': ['match', ['get', 'category'],
               'pothole', '#ff4444', 'obstacle', '#ffb830',
               'roadwork', '#4af', 'landmark', '#39ff84', '#c084fc'],
             'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
             'circle-pitch-alignment': 'map' },
  });

  // 6. Bump heatmap
  m.addSource('bumpSource', { type: 'geojson', data: mapState.geojsonBumps });
  m.addLayer({ id: 'bumpHeatmapLayer', type: 'heatmap', source: 'bumpSource',
    paint: {
      'heatmap-weight':     ['interpolate', ['linear'], ['get', 'mag'], 18, 1, 30, 3],
      'heatmap-intensity':  ['interpolate', ['linear'], ['zoom'], 15, 1, 20, 3],
      'heatmap-color':      ['interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(255,68,68,0)',
        0.3, 'rgba(255,68,68,0.6)',
        0.6, 'rgba(255,150,0,0.8)',
        0.9, 'rgba(255,220,0,1)',
        1,   'rgba(255,255,255,1)'],
      'heatmap-radius':   ['interpolate', ['linear'], ['zoom'], 15, 20, 20, 60],
      'heatmap-opacity':  0.8,
    },
  });
  m.addLayer({ id: 'bumpCoreLayer', type: 'circle', source: 'bumpSource',
    paint: { 'circle-radius': 4, 'circle-color': '#fff',
             'circle-stroke-width': 2, 'circle-stroke-color': '#ff4444',
             'circle-pitch-alignment': 'map' },
  });

  // 7. Car marker (hidden until first GPS fix)
  m.addSource('carSource', { type: 'geojson', data: mapState.geojsonCar });
  m.addLayer({ id: 'carGlowLayer', type: 'circle', source: 'carSource',
    layout: { visibility: 'none' },
    paint:  { 'circle-radius': 20, 'circle-color': '#39ff84',
              'circle-blur': 1, 'circle-opacity': 0.4, 'circle-pitch-alignment': 'map' },
  });
  m.addLayer({ id: 'carLayer', type: 'circle', source: 'carSource',
    layout: { visibility: 'none' },
    paint:  { 'circle-radius': 8, 'circle-color': '#39ff84',
              'circle-stroke-width': 3, 'circle-stroke-color': '#fff',
              'circle-pitch-alignment': 'map' },
  });
}

// ── Car position + camera ──────────────────────────────────────────────────────
export function mapFollowCar(lng, lat, kmh, heading) {
  if (!mapState.loaded || lat === 0) return;
  mapState.geojsonCar.geometry.coordinates = [lng, lat];
  mapState.map.getSource('carSource').setData(mapState.geojsonCar);
  if (!mapState.cameraFollow) return;
  const z       = Math.max(15, Math.min(18.5, 18.5 - (kmh / 60) * 2.5));
  let bearing   = mapState.map.getBearing();
  if (kmh > 4 && heading !== null) bearing = heading;
  mapState.map.easeTo({ center: [lng, lat], bearing, pitch: 60, zoom: z, duration: 1000, easing: t => t });
}

export function showCarLayers() {
  if (!mapState.loaded) return;
  mapState.map.setLayoutProperty('carLayer',     'visibility', 'visible');
  mapState.map.setLayoutProperty('carGlowLayer', 'visibility', 'visible');
}

// ── Route / bump source helpers ────────────────────────────────────────────────
export function pushRouteSegment(prev, next, roughness) {
  if (!mapState.loaded || !prev) return;
  mapState.geojsonRoute.features.push({
    type: 'Feature',
    properties: { roughness },
    geometry: { type: 'LineString', coordinates: [prev, next] },
  });
  const disp = mapState.geojsonRoute.features.length > MAX_ROUTE_DISPLAY
    ? mapState.geojsonRoute.features.slice(-MAX_ROUTE_DISPLAY)
    : mapState.geojsonRoute.features;
  mapState.map.getSource('routeSource').setData({ type: 'FeatureCollection', features: disp });
}

export function pushBump(lng, lat, mag) {
  if (!mapState.loaded) return;
  mapState.geojsonBumps.features.push({
    type: 'Feature', properties: { mag },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  });
  mapState.map.getSource('bumpSource').setData(mapState.geojsonBumps);
}

export function resetLiveLayers() {
  mapState.geojsonRoute = { type: 'FeatureCollection', features: [] };
  mapState.geojsonBumps = { type: 'FeatureCollection', features: [] };
  mapState.geojsonPOIs  = { type: 'FeatureCollection', features: [] };
  if (mapState.loaded) {
    mapState.map.getSource('routeSource').setData(mapState.geojsonRoute);
    mapState.map.getSource('bumpSource').setData(mapState.geojsonBumps);
    mapState.map.getSource('poiSource').setData(mapState.geojsonPOIs);
  }
}

export function setLayerVisibility(id, visible) {
  if (!mapState.loaded) return;
  mapState.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

// ── Find-location destination marker ──────────────────────────────────────────
export function setDestinationMarker(lng, lat) {
  if (!mapState.loaded) return;
  mapState.geojsonDest = {
    type: 'FeatureCollection',
    features: lat !== null ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }] : [],
  };
  mapState.map.getSource('destSource').setData(mapState.geojsonDest);
  if (lat !== null) mapState.map.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 });
}

// ── Compass canvas ─────────────────────────────────────────────────────────────
export function drawCompass(heading) {
  const canvas = document.getElementById('compassCanvas');
  if (!canvas) return;
  const W = 130, H = 130, cx = W / 2, cy = H / 2, r = 55;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Ring
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(57,255,132,0.3)'; ctx.lineWidth = 2; ctx.stroke();

  // Cardinal labels
  const dirs = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  ctx.font = 'bold 11px Barlow Condensed,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  dirs.forEach(([d, a]) => {
    const rad = (a - heading) * Math.PI / 180;
    ctx.fillStyle = d === 'N' ? '#ff4444' : 'rgba(57,255,132,0.7)';
    ctx.fillText(d, cx + Math.sin(rad) * 43, cy - Math.cos(rad) * 43);
  });

  // North needle
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath(); ctx.moveTo(0, -r + 12); ctx.lineTo(-5, 0); ctx.lineTo(5, 0); ctx.closePath();
  ctx.fillStyle = '#ff4444'; ctx.fill();
  // South needle
  ctx.beginPath(); ctx.moveTo(0, r - 12); ctx.lineTo(-5, 0); ctx.lineTo(5, 0); ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fill();
  ctx.restore();

  // Heading text
  ctx.fillStyle = 'rgba(57,255,132,0.9)';
  ctx.font = 'bold 12px Space Mono,monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(heading) + '°', cx, cy + H / 2 - 12);

  const dh = document.getElementById('dash-heading');
  if (dh) dh.textContent = Math.round(heading);
}

// ── Offline tile caching ───────────────────────────────────────────────────────
export async function cacheCurrentArea() {
  if (!mapState.loaded) { log('Map not ready', 'warn'); return; }
  const bounds = mapState.map.getBounds();
  const { _sw: sw, _ne: ne } = bounds;

  const urls = [];
  for (let z = 13; z <= 17; z++) {
    const [x0, y0] = lngLatToTile(sw.lng, ne.lat, z);
    const [x1, y1] = lngLatToTile(ne.lng, sw.lat, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        urls.push(`https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`);
      }
    }
  }

  const progress = document.getElementById('cacheProgress');
  const fill     = document.getElementById('cacheProgressFill');
  const status   = document.getElementById('cacheStatus');
  if (progress) progress.style.display = 'block';
  log(`Caching ${urls.length} tiles…`, 'ok');

  let done = 0;
  const BATCH = 10;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    await Promise.all(batch.map(url => fetch(url, { mode: 'no-cors' }).catch(() => {})));
    done += batch.length;
    const pct = Math.round((done / urls.length) * 100);
    if (fill)   fill.style.width = pct + '%';
    if (status) status.textContent = `Fetched ${done}/${urls.length} tiles (${pct}%)…`;
  }
  if (status) status.textContent = `✓ ${urls.length} tiles cached. Area works offline.`;
  log(`Offline cache complete: ${urls.length} tiles`, 'ok');
  setTimeout(() => { if (progress) progress.style.display = 'none'; }, 4000);
}
