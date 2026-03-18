// ── FIELDSURVEYOR ── viewer.js ─────────────────────────────────────────────────
// Trip Viewer — loads sessions from IndexedDB, renders on map, and lets you
// drag a sensitivity slider to recolor the trail and recount bumps in real time.

import { listSessions, getSession, deleteSession, getAudio } from './db.js';
import { fmtDuration, fmtDurationShort }                      from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────────
let map           = null;
let mapLoaded     = false;
let currentSess   = null;   // full session object
let allSessions   = [];     // metadata list
let threshold     = 8;      // m/s² — clean threshold, slider controls this

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  initMap();
  allSessions = await listSessions().catch(() => []);
  renderSessionList();

  const params = new URLSearchParams(location.search);
  const id     = params.get('id') || allSessions[0]?.id || null;
  if (id) {
    await loadSession(id);
  } else {
    showEmpty();
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
//  MAP INIT
// ─────────────────────────────────────────────────────────────────────────────
function initMap() {
  map = new maplibregl.Map({
    container: 'v-map',
    style:     'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center:    [36.57, 32.71],
    zoom:      13,
    pitch:     45,
    antialias: true,
  });

  map.on('load', () => {
    mapLoaded = true;
    addMapLayers();
    if (currentSess) drawSession();
  });
}

function addMapLayers() {
  // Route — colored by roughness property
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'route-layer', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['interpolate', ['linear'], ['get', 'roughness'],
        0, '#39ff84', 0.35, '#ffb830', 0.7, '#ff4444'],
      'line-width': 5,
      'line-opacity': 0.9,
    },
  });

  // Bumps heatmap
  map.addSource('bumps', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'bumps-heat', type: 'heatmap', source: 'bumps',
    paint: {
      'heatmap-weight':    ['interpolate', ['linear'], ['get', 'mag'], 8, 1, 30, 3],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, 3],
      'heatmap-color':     ['interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(255,68,68,0)',
        0.3, 'rgba(255,68,68,0.5)',
        0.7, 'rgba(255,150,0,0.8)',
        1,   'rgba(255,220,0,1)'],
      'heatmap-radius':   ['interpolate', ['linear'], ['zoom'], 13, 15, 18, 50],
      'heatmap-opacity':  0.75,
    },
  });

  // POI pins
  map.addSource('pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'pois-layer', type: 'circle', source: 'pois',
    paint: {
      'circle-radius': 7,
      'circle-color': ['match', ['get', 'category'],
        'pothole', '#ff4444', 'obstacle', '#ffb830',
        'roadwork', '#4af',   'landmark', '#39ff84', '#c084fc'],
      'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
      'circle-pitch-alignment': 'map',
    },
  });

  // Annotation markers
  map.addSource('anns', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'anns-layer', type: 'circle', source: 'anns',
    paint: {
      'circle-radius': 8,
      'circle-color': '#c084fc',
      'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
      'circle-pitch-alignment': 'map',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOAD SESSION
// ─────────────────────────────────────────────────────────────────────────────
async function loadSession(id) {
  document.getElementById('v-loading').style.display = 'flex';

  currentSess = await getSession(id).catch(() => null);
  if (!currentSess) { showEmpty(); return; }

  // Highlight active in session list
  document.querySelectorAll('.vs-item').forEach(el =>
    el.classList.toggle('vs-active', el.dataset.id === id)
  );

  // Update URL without reload
  history.replaceState(null, '', '?id=' + encodeURIComponent(id));

  // Update header
  const dt = new Date(id);
  setText('v-session-date', dt.toLocaleString());
  const st = currentSess.stats || {};
  setText('v-stat-dist',   (st.distKm  ?? 0) + ' km');
  setText('v-stat-dur',    fmtDurationShort(st.duration ?? 0));
  setText('v-stat-pts',    (st.points  ?? 0) + ' pts');
  setText('v-stat-maxspd', Math.round(st.maxSpeed ?? 0) + ' km/h max');

  if (mapLoaded) drawSession();

  document.getElementById('v-loading').style.display = 'none';
  drawChart();
  renderAnnotations();
  renderPOIs();
}

// ─────────────────────────────────────────────────────────────────────────────
//  DRAW SESSION ON MAP
// ─────────────────────────────────────────────────────────────────────────────
function drawSession() {
  if (!currentSess || !mapLoaded) return;
  reprocessAndDraw(threshold);

  // Fit map to route bounds
  const data = currentSess.data || [];
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const dp of data) {
    const lat = parseFloat(dp.lat), lng = parseFloat(dp.lng);
    if (!lat || !lng) continue;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  if (isFinite(minLng)) {
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, pitch: 45, duration: 800 });
  }

  // POIs
  const poiFeatures = (currentSess.pois || []).map(p => ({
    type: 'Feature',
    properties: { category: p.category, note: p.note || '' },
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
  }));
  map.getSource('pois').setData({ type: 'FeatureCollection', features: poiFeatures });

  // Annotation markers
  const annFeatures = (currentSess.annotations || []).map(a => ({
    type: 'Feature',
    properties: { audioId: a.audioId },
    geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
  }));
  map.getSource('anns').setData({ type: 'FeatureCollection', features: annFeatures });
}

// ─────────────────────────────────────────────────────────────────────────────
//  REPROCESS TRAIL — the heart of the slider feature
// ─────────────────────────────────────────────────────────────────────────────
function reprocessAndDraw(thr) {
  if (!currentSess || !mapLoaded) return;
  const data = currentSess.data || [];

  const routeFeatures = [];
  const bumpFeatures  = [];
  let prev = null, bumpCount = 0, roughCount = 0;

  for (const dp of data) {
    const lat = parseFloat(dp.lat), lng = parseFloat(dp.lng);
    if (!lat || !lng) { prev = null; continue; }

    const peak     = parseFloat(dp.accel_peak_mag) || 0;
    const gravFree = (dp.linear_accel_z !== '' && dp.linear_accel_z != null);
    const baseline = gravFree ? 0 : 9.0;
    const eff      = Math.max(0, peak - baseline);
    const adjThr   = gravFree ? thr : thr * 2.25;

    // roughness shifts with threshold so trail recolors as you drag
    const roughness = Math.min(1, Math.max(0, eff / (thr * 1.5)));
    const isBump    = eff > adjThr;

    if (isBump) {
      bumpCount++;
      bumpFeatures.push({
        type: 'Feature', properties: { mag: peak },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      });
    }
    if (roughness > 0.35) roughCount++;

    if (prev) {
      routeFeatures.push({
        type: 'Feature', properties: { roughness },
        geometry: { type: 'LineString', coordinates: [prev, [lng, lat]] },
      });
    }
    prev = [lng, lat];
  }

  map.getSource('route').setData({ type: 'FeatureCollection', features: routeFeatures });
  map.getSource('bumps').setData({ type: 'FeatureCollection', features: bumpFeatures });

  // Update live stats
  const pctRough = data.length > 0 ? Math.round(roughCount / data.length * 100) : 0;
  setText('v-live-bumps',  bumpCount);
  setText('v-live-rough',  pctRough + '%');
  setText('v-live-thresh', thr.toFixed(1) + ' m/s²');
  setText('v-live-label',  thresholdLabel(thr));

  // Color the slider track
  const pct = ((thr - 3) / (18 - 3)) * 100;
  const sliderEl = document.getElementById('v-sens-slider');
  if (sliderEl) {
    // green = less sensitive (high threshold), red = more sensitive (low threshold)
    const fill = `linear-gradient(to right, #ff4444 0%, #ffb830 35%, #39ff84 100%)`;
    sliderEl.style.setProperty('--track-fill', fill);
  }
}

function thresholdLabel(thr) {
  if (thr <= 4)  return 'VERY HIGH';
  if (thr <= 6)  return 'HIGH';
  if (thr <= 10) return 'MEDIUM';
  if (thr <= 14) return 'LOW';
  return 'VERY LOW';
}

// ─────────────────────────────────────────────────────────────────────────────
//  SESSION LIST
// ─────────────────────────────────────────────────────────────────────────────
function renderSessionList() {
  const list = document.getElementById('v-session-list');
  if (!list) return;

  if (!allSessions.length) {
    list.innerHTML = '<div class="vs-empty">No trips recorded yet.</div>';
    return;
  }

  list.innerHTML = allSessions.map(s => {
    const st  = s.stats || {};
    const dt  = new Date(s.id);
    return `
      <div class="vs-item" data-id="${s.id}">
        <div class="vs-date">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <div class="vs-stats">${st.distKm ?? 0} km · ${fmtDurationShort(st.duration ?? 0)} · ${st.bumps ?? 0} bumps</div>
        <button class="vs-del" data-del="${s.id}" title="Delete">✕</button>
      </div>`;
  }).join('');

  list.addEventListener('click', async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!confirm('Delete this session?')) return;
      await deleteSession(del.dataset.del);
      allSessions = allSessions.filter(s => s.id !== del.dataset.del);
      renderSessionList();
      if (currentSess?.id === del.dataset.del) showEmpty();
      return;
    }
    const item = e.target.closest('[data-id]');
    if (item) {
      closeDrawer();
      await loadSession(item.dataset.id);
    }
  });
}

function showEmpty() {
  document.getElementById('v-loading').style.display = 'none';
  setText('v-session-date', 'No session loaded');
  setText('v-stat-dist',    '—');
  setText('v-stat-dur',     '—');
  setText('v-stat-pts',     '—');
  setText('v-stat-maxspd',  '—');
  setText('v-live-bumps',   '—');
  setText('v-live-rough',   '—');
}

// ─────────────────────────────────────────────────────────────────────────────
//  CHART
// ─────────────────────────────────────────────────────────────────────────────
function drawChart() {
  const canvas = document.getElementById('v-chart');
  if (!canvas || !currentSess?.data?.length) return;
  const data = currentSess.data;
  const n    = data.length; if (n < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  || 320;
  const H   = 120;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0f1612'; ctx.fillRect(0, 0, W, H);

  const speeds    = data.map(d => parseFloat(d.speed_kmh) || 0);
  const roughness = data.map(d => parseFloat(d.road_roughness) || 0);
  const bumps     = data.map(d => parseInt(d.bump_detected)    || 0);
  const maxSpd    = Math.max(...speeds, 1);

  const PAD = { t: 8, b: 18, l: 6, r: 6 };
  const cW  = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;

  ctx.strokeStyle = 'rgba(57,255,132,0.06)'; ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => {
    const y = PAD.t + cH * (1 - f);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cW, y); ctx.stroke();
  });

  const xOf    = i => PAD.l + cW * (i / (n - 1));
  const speedY = v => PAD.t + cH * (1 - v / maxSpd);
  const roughY = v => PAD.t + cH * (1 - Math.min(v, 1));

  ctx.beginPath(); ctx.moveTo(xOf(0), H - PAD.b);
  roughness.forEach((v, i) => ctx.lineTo(xOf(i), roughY(v)));
  ctx.lineTo(xOf(n - 1), H - PAD.b); ctx.closePath();
  ctx.fillStyle = 'rgba(255,68,68,0.2)'; ctx.fill();

  ctx.beginPath(); ctx.strokeStyle = 'rgba(255,68,68,0.6)'; ctx.lineWidth = 1.5;
  roughness.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(0), roughY(v)) : ctx.lineTo(xOf(i), roughY(v)));
  ctx.stroke();

  ctx.beginPath(); ctx.strokeStyle = 'rgba(57,255,132,0.85)'; ctx.lineWidth = 2;
  speeds.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(0), speedY(v)) : ctx.lineTo(xOf(i), speedY(v)));
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,184,48,0.7)'; ctx.lineWidth = 1.2;
  bumps.forEach((b, i) => {
    if (!b) return;
    const x = xOf(i);
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
  });

  ctx.fillStyle = 'rgba(90,112,99,0.7)'; ctx.font = '9px Space Mono,monospace';
  ctx.textAlign = 'left';   ctx.fillText('0', PAD.l, H - 2);
  ctx.textAlign = 'right';  ctx.fillText(fmtDurationShort(data[n - 1]?.elapsed_s || 0), W - PAD.r, H - 2);
  ctx.textAlign = 'center'; ctx.fillText(Math.round(maxSpd) + ' km/h max', W / 2, H - 2);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANNOTATIONS
// ─────────────────────────────────────────────────────────────────────────────
function renderAnnotations() {
  const panel = document.getElementById('v-anns-panel');
  const list  = document.getElementById('v-anns-list');
  if (!list) return;
  const anns = currentSess?.annotations || [];
  if (!anns.length) {
    list.innerHTML = '<div class="vs-empty">No voice annotations in this session.</div>';
    return;
  }
  list.innerHTML = anns.map((a, i) => `
    <div class="ann-item">
      <button class="ann-play" data-ann-i="${i}">▶</button>
      <audio id="v-ann-audio-${i}" style="display:none"></audio>
      <div class="ann-info">
        <div class="ai-time">${new Date(a.ts).toLocaleTimeString()}</div>
        <div class="ai-coords">${a.lat.toFixed(5)}°N, ${a.lng.toFixed(5)}°E</div>
      </div>
    </div>`).join('');

  list.addEventListener('click', async e => {
    const btn = e.target.closest('[data-ann-i]');
    if (!btn) return;
    const i   = parseInt(btn.dataset.annI);
    const ann = anns[i];
    const el  = document.getElementById(`v-ann-audio-${i}`);
    if (!el) return;
    if (el.src && !el.src.startsWith('blob:null')) { el.play(); return; }
    // Load from IndexedDB
    btn.textContent = '…';
    const dataUrl = await getAudio(ann.audioId).catch(() => null);
    if (!dataUrl) { btn.textContent = '✕'; return; }
    el.src = dataUrl;
    el.play();
    btn.textContent = '▶';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  POIs
// ─────────────────────────────────────────────────────────────────────────────
function renderPOIs() {
  const list = document.getElementById('v-pois-list');
  if (!list) return;
  const pois = currentSess?.pois || [];
  if (!pois.length) {
    list.innerHTML = '<div class="vs-empty">No pins dropped in this session.</div>';
    return;
  }
  const EMOJI = { pothole: '🕳', obstacle: '⚠️', roadwork: '🚧', landmark: '🏛', note: '✏️' };
  list.innerHTML = pois.map(p => `
    <div class="ann-item">
      <span style="font-size:18px">${EMOJI[p.category] || '📍'}</span>
      <div class="ann-info">
        <div class="ai-time">${p.category}${p.note ? ' — ' + p.note : ''}</div>
        <div class="ai-coords">${p.lat.toFixed(5)}°N, ${p.lng.toFixed(5)}°E</div>
      </div>
    </div>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT FROM VIEWER
// ─────────────────────────────────────────────────────────────────────────────
function exportCurrentCSV() {
  if (!currentSess?.data?.length) return;
  const headers = Object.keys(currentSess.data[0]).join(',');
  const rows    = currentSess.data.map(r =>
    Object.values(r).map(v => {
      const s = String(v ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  );
  const blob = new Blob([headers + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: `fieldsurveyor_${currentSess.id.slice(0, 10)}.csv`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

function exportCurrentGeoJSON() {
  if (!currentSess) return;
  const routeFeatures = [];
  const data = currentSess.data || [];
  let prev = null;
  for (const dp of data) {
    const lat = parseFloat(dp.lat), lng = parseFloat(dp.lng);
    if (!lat || !lng) { prev = null; continue; }
    const roughness = parseFloat(dp.road_roughness) || 0;
    if (prev) {
      routeFeatures.push({
        type: 'Feature', properties: { roughness, speed_kmh: dp.speed_kmh },
        geometry: { type: 'LineString', coordinates: [prev, [lng, lat]] },
      });
    }
    prev = [lng, lat];
  }
  const fc = {
    type: 'FeatureCollection',
    properties: { exported: new Date().toISOString(), session_id: currentSess.id, ...currentSess.stats },
    features: [
      ...routeFeatures,
      ...(currentSess.pois || []).map(p => ({
        type: 'Feature',
        properties: { type: 'poi', category: p.category, note: p.note || '', timestamp: p.ts },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
      ...(currentSess.annotations || []).map(a => ({
        type: 'Feature',
        properties: { type: 'annotation', audio_id: a.audioId, timestamp: a.ts },
        geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      })),
    ],
  };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: `fieldsurveyor_${currentSess.id.slice(0, 10)}.geojson`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────────────────────────────────────
//  TABS
// ─────────────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.v-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name)
  );
  document.querySelectorAll('.v-tab-pane').forEach(p =>
    p.style.display = p.id === 'v-tab-' + name ? 'block' : 'none'
  );
  if (name === 'chart') {
    // re-draw in case canvas resized
    requestAnimationFrame(drawChart);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DRAWER
// ─────────────────────────────────────────────────────────────────────────────
function openDrawer()  { document.getElementById('v-drawer').classList.add('open');  }
function closeDrawer() { document.getElementById('v-drawer').classList.remove('open'); }

// ─────────────────────────────────────────────────────────────────────────────
//  EVENT WIRING (after DOM is ready)
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Slider
  const slider = document.getElementById('v-sens-slider');
  if (slider) {
    slider.value = threshold;
    slider.addEventListener('input', () => {
      threshold = parseFloat(slider.value);
      reprocessAndDraw(threshold);
    });
  }

  // Tabs
  document.querySelectorAll('.v-tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // Drawer
  document.getElementById('v-sessions-btn')?.addEventListener('click', openDrawer);
  document.getElementById('v-drawer-close')?.addEventListener('click', closeDrawer);
  document.getElementById('v-drawer-backdrop')?.addEventListener('click', closeDrawer);

  // Export buttons
  document.getElementById('v-export-csv')?.addEventListener('click', exportCurrentCSV);
  document.getElementById('v-export-geojson')?.addEventListener('click', exportCurrentGeoJSON);

  // Default tab
  switchTab('chart');
});

// ── Helper ─────────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}
