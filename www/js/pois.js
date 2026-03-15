// ── FIELDSURVEYOR ── pois.js ───────────────────────────────────────────────────
// Point-of-interest pins: the picker popup, dropping onto the map, and the list.

import { mapState, poiState, session } from './state.js';
import { log, haptic, speak }          from './utils.js';

const EMOJI = { pothole: '🕳', obstacle: '⚠️', roadwork: '🚧', landmark: '🏛', note: '✏️' };

// ── Picker ─────────────────────────────────────────────────────────────────────
export function openPOIPicker(lng, lat, touchEvt, autoCategory = null) {
  poiState.dropLng = lng;
  poiState.dropLat = lat;

  if (autoCategory) { dropPOI(autoCategory); return; }

  const picker = document.getElementById('poiPicker');
  if (!picker) return;
  picker.classList.add('active');

  // Position near touch or centred
  if (touchEvt) {
    const x = Math.min(touchEvt.clientX || touchEvt.pageX || 160, window.innerWidth - 220);
    const y = Math.min(touchEvt.clientY || touchEvt.pageY || 200, window.innerHeight - 260);
    picker.style.left = x + 'px'; picker.style.top = y + 'px'; picker.style.transform = '';
  } else {
    picker.style.left = '50%'; picker.style.top = '50%';
    picker.style.transform = 'translate(-50%,-50%)';
  }
}

export function closePOIPicker() {
  const picker = document.getElementById('poiPicker');
  if (!picker) return;
  picker.classList.remove('active');
  picker.style.transform = '';
  const ni = document.getElementById('poiNoteInput');
  if (ni) { ni.style.display = 'none'; ni.value = ''; }
}

export function showPoiNoteInput() {
  const ni = document.getElementById('poiNoteInput');
  if (ni) { ni.style.display = 'block'; ni.focus(); }
}

// ── Drop ───────────────────────────────────────────────────────────────────────
export function dropPOI(category, note = '') {
  closePOIPicker();
  const poi = { ts: new Date().toISOString(), lat: poiState.dropLat, lng: poiState.dropLng, category, note };
  poiState.pois.push(poi);

  mapState.geojsonPOIs.features.push({
    type: 'Feature',
    properties: { category, note },
    geometry: { type: 'Point', coordinates: [poiState.dropLng, poiState.dropLat] },
  });
  if (mapState.loaded) mapState.map.getSource('poiSource').setData(mapState.geojsonPOIs);

  haptic(100);
  log(`PIN: ${category}${note ? ' — ' + note : ''} at ${poiState.dropLat.toFixed(4)}°N`, 'ok');

  const pc = document.getElementById('poiCount'); if (pc) pc.textContent = poiState.pois.length;
  const pp = document.getElementById('poisPanel'); if (pp) pp.style.display = 'block';
  renderPOIList();
  speak('Pin dropped.', true);
}

// ── List ───────────────────────────────────────────────────────────────────────
export function renderPOIList() {
  const list = document.getElementById('poiList'); if (!list) return;
  list.innerHTML = poiState.pois.map(p => `
    <div class="ann-item">
      <span style="font-size:18px">${EMOJI[p.category] || '📍'}</span>
      <div class="ann-info">
        <div class="ai-time">${p.category}${p.note ? ' — ' + p.note : ''}</div>
        <div class="ai-coords">${p.lat.toFixed(5)}°N, ${p.lng.toFixed(5)}°E</div>
      </div>
    </div>`).join('');
}
