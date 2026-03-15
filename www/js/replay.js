// ── FIELDSURVEYOR ── replay.js ─────────────────────────────────────────────────
// Replays a recorded session on the map at variable speed.
// Data is passed in via window.__replayData (set by recording.js on stop).

import { mapState, replayState } from './state.js';
import { log, fmtDuration, roughnessLabel, computeRoughness } from './utils.js';
import { MAX_ROUTE_DISPLAY } from './constants.js';

// ── Init ───────────────────────────────────────────────────────────────────────
export function initReplay() {
  const data = window.__replayData;
  if (!data?.length) return;

  // Clear live layers before replay draws its own
  mapState.geojsonRoute = { type: 'FeatureCollection', features: [] };
  mapState.geojsonBumps = { type: 'FeatureCollection', features: [] };
  if (mapState.loaded) {
    mapState.map.getSource('routeSource').setData(mapState.geojsonRoute);
    mapState.map.getSource('bumpSource').setData(mapState.geojsonBumps);
  }

  replayState.data    = data;
  replayState.idx     = 0;
  replayState.bumps   = 0;
  replayState.playing = false;

  const panel = document.getElementById('replayPanel');
  if (panel) panel.classList.add('active');

  const sc = document.getElementById('replayScrubber');
  if (sc) { sc.max = Math.max(0, data.length - 1); sc.value = 0; }

  const rt = document.getElementById('r-total'); if (rt) rt.textContent = data.length;
  const pl = document.getElementById('replayPlayBtn'); if (pl) pl.textContent = '▶ PLAY';
  const dl = document.getElementById('replayDateLabel');
  if (dl && data[0]?.timestamp) dl.textContent = new Date(data[0].timestamp).toLocaleString();

  const first = data.find(d => d.lat && parseFloat(d.lat) !== 0);
  if (first && mapState.loaded) {
    mapState.map.jumpTo({ center: [parseFloat(first.lng), parseFloat(first.lat)], zoom: 16 });
  }

  log(`Replay ready — ${data.length} points`, 'ok');
}

// ── Play / Pause ───────────────────────────────────────────────────────────────
export function toggleReplayPlay() {
  replayState.playing ? pauseReplay() : resumeReplay();
}

function resumeReplay() {
  replayState.playing = true;
  const btn = document.getElementById('replayPlayBtn'); if (btn) btn.textContent = '⏸ PAUSE';
  replayState.timer = setInterval(stepFrame, Math.round(1000 / replayState.speed));
}

function pauseReplay() {
  replayState.playing = false;
  clearInterval(replayState.timer); replayState.timer = null;
  const btn = document.getElementById('replayPlayBtn'); if (btn) btn.textContent = '▶ PLAY';
}

export function closeReplay() {
  pauseReplay();
  const panel = document.getElementById('replayPanel'); if (panel) panel.classList.remove('active');
  replayState.data = []; replayState.idx = 0; replayState.bumps = 0;
  mapState.geojsonRoute = { type: 'FeatureCollection', features: [] };
  mapState.geojsonBumps = { type: 'FeatureCollection', features: [] };
  if (mapState.loaded) {
    mapState.map.getSource('routeSource').setData(mapState.geojsonRoute);
    mapState.map.getSource('bumpSource').setData(mapState.geojsonBumps);
  }
  log('Replay closed', 'ok');
}

export function setReplaySpeed(speed) {
  replayState.speed = speed;
  document.querySelectorAll('.spd-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.speed) === speed)
  );
  if (replayState.playing) { pauseReplay(); resumeReplay(); }
}

// ── Scrub ──────────────────────────────────────────────────────────────────────
export function onReplayScrub(val) {
  const idx = parseInt(val);
  replayState.idx   = idx;
  replayState.bumps = 0;
  mapState.geojsonRoute = { type: 'FeatureCollection', features: [] };
  mapState.geojsonBumps = { type: 'FeatureCollection', features: [] };

  let prev = null;
  for (let i = 0; i <= idx; i++) {
    const dp = replayState.data[i]; if (!dp) continue;
    const lat = parseFloat(dp.lat), lng = parseFloat(dp.lng);
    if (!lat || !lng) { prev = null; continue; }
    const r = replayRoughness(dp);
    if (prev) mapState.geojsonRoute.features.push(segment(prev, [lng, lat], r));
    prev = [lng, lat];
    if (parseInt(dp.bump_detected) === 1) {
      replayState.bumps++;
      mapState.geojsonBumps.features.push(bumpFeature(lng, lat, parseFloat(dp.accel_peak_mag) || 18));
    }
  }

  if (mapState.loaded) {
    const disp = truncateRoute(mapState.geojsonRoute.features);
    mapState.map.getSource('routeSource').setData({ type: 'FeatureCollection', features: disp });
    mapState.map.getSource('bumpSource').setData(mapState.geojsonBumps);
  }
  renderReplayPoint(idx);
}

// ── Frame ──────────────────────────────────────────────────────────────────────
function stepFrame() {
  if (replayState.idx >= replayState.data.length) { pauseReplay(); return; }
  renderReplayPoint(replayState.idx);
  replayState.idx++;
  const sc = document.getElementById('replayScrubber'); if (sc) sc.value = replayState.idx;
}

function renderReplayPoint(idx) {
  const dp = replayState.data[idx]; if (!dp) return;
  const lat = parseFloat(dp.lat), lng = parseFloat(dp.lng);
  const kmh = parseFloat(dp.speed_kmh) || 0;
  const elapsed = parseInt(dp.elapsed_s) || 0;
  const r = replayRoughness(dp);

  // Move car
  if (lat && lng && mapState.loaded) {
    mapState.geojsonCar.geometry.coordinates = [lng, lat];
    mapState.map.getSource('carSource').setData(mapState.geojsonCar);

    if (idx > 0 && replayState.playing) {
      const prev = replayState.data[idx - 1];
      const pl = parseFloat(prev.lat), plng = parseFloat(prev.lng);
      if (pl && plng) {
        mapState.geojsonRoute.features.push(segment([plng, pl], [lng, lat], r));
        const disp = truncateRoute(mapState.geojsonRoute.features);
        mapState.map.getSource('routeSource').setData({ type: 'FeatureCollection', features: disp });
      }
    }

    if (mapState.cameraFollow) {
      const h = parseFloat(dp.heading_deg);
      let bearing = mapState.map.getBearing();
      if (kmh > 4 && !isNaN(h)) bearing = h;
      mapState.map.easeTo({ center: [lng, lat], bearing, pitch: 60, zoom: 17, duration: 900, easing: t => t });
    }
  }

  // Bump flash
  if (parseInt(dp.bump_detected) === 1 && replayState.playing) {
    replayState.bumps++;
    const flash = document.getElementById('bumpFlash');
    if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 200); }
    if (mapState.loaded && lat && lng) {
      mapState.geojsonBumps.features.push(bumpFeature(lng, lat, parseFloat(dp.accel_peak_mag) || 18));
      mapState.map.getSource('bumpSource').setData(mapState.geojsonBumps);
    }
  }

  // UI updates
  const totalE = parseInt(replayState.data[replayState.data.length - 1]?.elapsed_s) || 0;
  setText('hud-speed',      Math.round(kmh));
  setText('elapsedTimer',   fmtDuration(elapsed));
  setText('replayTimeLabel', fmtDuration(elapsed) + ' / ' + fmtDuration(totalE));
  setText('r-speed',  kmh.toFixed(1));
  setText('r-point',  idx + 1);
  setText('r-bumps',  replayState.bumps);

  const rr = document.getElementById('r-roughness');
  if (rr) rr.innerHTML = 'Surface: ' + roughnessLabel(r);
  const cd = document.getElementById('coordsDisplay');
  if (cd && lat && lng) cd.innerHTML = `<span class="highlight">▶ REPLAY ${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E</span>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function replayRoughness(dp) {
  const peak    = parseFloat(dp.accel_peak_mag) || 0;
  const gravFree = dp.linear_accel_z !== '' && dp.linear_accel_z != null;
  return computeRoughness(peak, gravFree);
}

function segment(from, to, roughness) {
  return { type: 'Feature', properties: { roughness }, geometry: { type: 'LineString', coordinates: [from, to] } };
}

function bumpFeature(lng, lat, mag) {
  return { type: 'Feature', properties: { mag }, geometry: { type: 'Point', coordinates: [lng, lat] } };
}

function truncateRoute(features) {
  return features.length > MAX_ROUTE_DISPLAY ? features.slice(-MAX_ROUTE_DISPLAY) : features;
}

function setText(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}
