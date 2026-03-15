// ── FIELDSURVEYOR ── history.js ────────────────────────────────────────────────
// Saves completed survey sessions to localStorage, renders the history list,
// keeps the map history overlay in sync, and maintains the pothole bump index.

import { session, mapState, potholeState } from './state.js';
import { log, haversine, fmtDurationShort } from './utils.js';
import { HISTORY_KEY, MAX_HISTORY_SESSIONS, STORAGE_WARN_BYTES } from './constants.js';

// ── Persistence ────────────────────────────────────────────────────────────────
export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch(_) { return []; }
}

function estimateStorageBytes() {
  let total = 0;
  for (const key of Object.keys(localStorage)) {
    total += (localStorage.getItem(key) || '').length * 2; // UTF-16
  }
  return total;
}

export function saveSessionToHistory() {
  try {
    const history = loadHistory();

    // Build compressed track from route GeoJSON
    const track = [];
    const feats  = mapState.geojsonRoute.features;
    if (feats.length > 0) {
      const first = feats[0].geometry.coordinates[0];
      track.push([+first[0].toFixed(6), +first[1].toFixed(6), 0]);
    }
    for (const feat of feats) {
      const end = feat.geometry.coordinates[1];
      track.push([+end[0].toFixed(6), +end[1].toFixed(6), +(feat.properties.roughness || 0).toFixed(3)]);
    }

    const bumps = mapState.geojsonBumps.features.map(f => [
      +f.geometry.coordinates[0].toFixed(6),
      +f.geometry.coordinates[1].toFixed(6),
    ]);

    history.unshift({
      id:    new Date().toISOString(),
      stats: {
        points:  session.data.length,
        distKm:  +session.distKm.toFixed(2),
        bumps:   session.bumpCount,
        duration: Math.floor((Date.now() - session.startTime) / 1000),
      },
      track,
      bumps,
    });

    // Check storage before trimming
    if (estimateStorageBytes() > STORAGE_WARN_BYTES) {
      log('⚠ Storage nearly full — trimming oldest sessions', 'warn');
      if (history.length > 5) history.splice(5);
    } else if (history.length > MAX_HISTORY_SESSIONS) {
      history.splice(MAX_HISTORY_SESSIONS);
    }

    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    log(`Session saved to history (${history.length} total)`, 'ok');

    renderHistoryList();
    refreshHistorySource();
    buildHistoryBumpIndex();
  } catch(e) { log('History save failed: ' + e.message, 'err'); }
}

export function deleteHistorySession(id) {
  if (!confirm('Delete this session?')) return;
  try {
    const h = loadHistory().filter(s => s.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    renderHistoryList();
    refreshHistorySource();
    buildHistoryBumpIndex();
  } catch(e) { log('Delete failed', 'err'); }
}

// ── Map history overlay ────────────────────────────────────────────────────────
export function refreshHistorySource() {
  if (!mapState.loaded) return;
  const history  = loadHistory();
  mapState.geojsonHistory = buildHistoryGeoJSON(history);
  mapState.map.getSource('historySource').setData(mapState.geojsonHistory);
  mapState.map.setLayoutProperty('historyLayer', 'visibility', mapState.historyVisible ? 'visible' : 'none');
}

function buildHistoryGeoJSON(history) {
  const features = [];
  for (const s of history) {
    for (let i = 1; i < (s.track || []).length; i++) {
      const t = s.track;
      features.push({
        type: 'Feature',
        properties: { roughness: t[i][2] },
        geometry: { type: 'LineString', coordinates: [[t[i-1][0], t[i-1][1]], [t[i][0], t[i][1]]] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export function toggleHistoryOverlay() {
  mapState.historyVisible = !mapState.historyVisible;
  const btn = document.getElementById('historyToggleBtn');
  if (mapState.historyVisible) {
    btn.textContent = '📍 HIST: ON'; btn.classList.add('btn-blue');
    refreshHistorySource();
  } else {
    btn.textContent = '📍 HIST: OFF'; btn.classList.remove('btn-blue'); btn.style.color = 'var(--text-dim)';
    if (mapState.loaded) mapState.map.setLayoutProperty('historyLayer', 'visibility', 'none');
  }
  log('History overlay: ' + (mapState.historyVisible ? 'ON' : 'OFF'), 'ok');
}

// ── Render list ────────────────────────────────────────────────────────────────
export function renderHistoryList() {
  const history = loadHistory();
  const countEl = document.getElementById('historyCount');
  if (countEl) countEl.textContent = history.length + ' stored';

  const list = document.getElementById('historyList');
  if (!list) return;

  if (!history.length) {
    list.innerHTML = '<div class="history-empty">No past sessions yet.<br>Complete a recording and it will appear here.</div>';
    return;
  }

  list.innerHTML = history.map(s => {
    const st   = s.stats || {};
    const avgR = s.track?.length
      ? s.track.reduce((a, t) => a + t[2], 0) / s.track.length : 0;
    const bar  = avgR < 0.25 ? '#39ff84' : avgR < 0.55 ? '#ffb830' : '#ff4444';
    return `
      <div class="history-session-item">
        <div class="history-session-info">
          <div class="history-session-date">${new Date(s.id).toLocaleString()}</div>
          <div class="history-session-stats">
            <b>${st.distKm || 0}km</b> · ${fmtDurationShort(st.duration || 0)} ·
            <b>${st.bumps || 0}</b> bumps · ${st.points || 0} pts
          </div>
          <div class="history-quality-bar"
               style="background:linear-gradient(90deg,${bar} 0%,var(--border) ${Math.round(avgR * 100)}%)">
          </div>
        </div>
        <button class="history-btn" data-delete-session="${s.id}">✕</button>
      </div>`;
  }).join('');
}

// ── Pothole index ──────────────────────────────────────────────────────────────
export function buildHistoryBumpIndex() {
  potholeState.bumpIndex = [];
  const history = loadHistory();
  for (const s of history) {
    for (const b of (s.bumps || [])) {
      potholeState.bumpIndex.push({ lat: b[1], lng: b[0] });
    }
  }
  if (potholeState.bumpIndex.length > 0) {
    log(`Pothole index: ${potholeState.bumpIndex.length} known impacts`, 'ok');
  }
}

// ── Coverage hash helpers (used by coverage.js) ────────────────────────────────
export function buildHistoryCoverageHash() {
  const hash = new Set();
  for (const s of loadHistory()) {
    for (const pt of (s.track || [])) {
      hash.add(`${Math.round(pt[0] / 0.0003)}_${Math.round(pt[1] / 0.0003)}`);
    }
  }
  return hash;
}
