// ── FIELDSURVEYOR ── coverage.js ───────────────────────────────────────────────
// Fetches OSM roads in the current map view via Overpass, then subtracts
// roads already covered by the device's survey history to show "gaps".

import { mapState, session }   from './state.js';
import { log }                  from './utils.js';
import { buildHistoryCoverageHash } from './history.js';

// ── Toggle ─────────────────────────────────────────────────────────────────────
export async function toggleCoverageGap() {
  mapState.coverageVisible = !mapState.coverageVisible;
  const btn = document.getElementById('coverageBtn');

  if (!mapState.coverageVisible) {
    btn.textContent = '🗺 GAPS: OFF'; btn.classList.remove('btn-blue'); btn.style.color = 'var(--text-dim)';
    if (mapState.loaded) mapState.map.setLayoutProperty('coverageLayer', 'visibility', 'none');
    return;
  }

  btn.textContent = '🗺 GAPS: LOADING'; btn.classList.add('btn-warn');

  try {
    await fetchAndBuildCoverageGap();
    btn.textContent = '🗺 GAPS: ON'; btn.classList.remove('btn-warn'); btn.classList.add('btn-blue');
    if (mapState.loaded) mapState.map.setLayoutProperty('coverageLayer', 'visibility', 'visible');
    log('Coverage gap layer ready', 'ok');
  } catch(e) {
    mapState.coverageVisible = false;
    btn.textContent = '🗺 GAPS: ERR'; btn.classList.remove('btn-warn', 'btn-blue'); btn.style.color = 'var(--red)';
    log('Coverage gap fetch failed: ' + e.message, 'err');
  }
}

// ── Fetch + build ──────────────────────────────────────────────────────────────
async function fetchAndBuildCoverageGap() {
  const bounds = mapState.loaded
    ? mapState.map.getBounds()
    : { _sw: { lat: 32.68, lng: 36.55 }, _ne: { lat: 32.74, lng: 36.60 } };

  const s = bounds._sw.lat - 0.005, w = bounds._sw.lng - 0.005;
  const n = bounds._ne.lat + 0.005, e = bounds._ne.lng + 0.005;

  const query = `[out:json][timeout:25];
(way["highway"~"^(residential|secondary|tertiary|primary|trunk|unclassified|living_street)$"](${s},${w},${n},${e}););
out geom;`;

  const res  = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query));
  const data = await res.json();

  // Build hash from history + current session
  const hash = buildHistoryCoverageHash();
  for (const dp of session.data) {
    if (!dp.lng || !dp.lat) continue;
    hash.add(`${Math.round(parseFloat(dp.lng) / 0.0003)}_${Math.round(parseFloat(dp.lat) / 0.0003)}`);
  }

  // Build uncovered segments
  const uncovered = [];
  for (const way of (data.elements || [])) {
    const nodes = way.geometry || [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const midLng = (nodes[i].lon + nodes[i+1].lon) / 2;
      const midLat = (nodes[i].lat + nodes[i+1].lat) / 2;
      if (!isCovered(midLng, midLat, hash)) {
        uncovered.push({
          type: 'Feature',
          properties: { highway: way.tags?.highway },
          geometry: { type: 'LineString', coordinates: [[nodes[i].lon, nodes[i].lat], [nodes[i+1].lon, nodes[i+1].lat]] },
        });
      }
    }
  }

  mapState.geojsonCoverage = { type: 'FeatureCollection', features: uncovered };
  if (mapState.loaded) mapState.map.getSource('coverageSource').setData(mapState.geojsonCoverage);
  log(`Coverage gap: ${uncovered.length} uncovered / ${data.elements?.length || 0} total road segments`, 'ok');
}

function isCovered(lng, lat, hash) {
  const gl = Math.round(lng / 0.0003), gla = Math.round(lat / 0.0003);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (hash.has(`${gl + di}_${gla + dj}`)) return true;
    }
  }
  return false;
}
