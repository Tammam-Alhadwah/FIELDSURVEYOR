// ── FIELDSURVEYOR ── app.js ────────────────────────────────────────────────────
// Single entry point: imports every module, runs boot sequence,
// and wires every UI event listener.
// Nothing else should touch addEventListener().

import { mapState, uiState, session }              from './state.js';
import { log, speak }                               from './utils.js';
import { initBattery, initNetwork } from './sensors.js';
import { initMap, mapFollowCar, cacheCurrentArea,
         setLayerVisibility, drawCompass,
         setDestinationMarker }                     from './map.js';
import { startRecording, stopRecording,
         exportCSV, exportGeoJSON,
         checkBackup, restoreBackup }               from './recording.js';
import { loadHistory, renderHistoryList,
         deleteHistorySession, refreshHistorySource,
         buildHistoryBumpIndex, toggleHistoryOverlay } from './history.js';
import { initReplay, toggleReplayPlay, closeReplay,
         setReplaySpeed, onReplayScrub }            from './replay.js';
import { openPOIPicker, closePOIPicker,
         showPoiNoteInput, dropPOI }                from './pois.js';
import { toggleCoverageGap }                        from './coverage.js';
import { toggleVoice, startAnnotation, stopAnnotation,
         setVoiceCallbacks, renderAnnotationList }  from './voice.js';
import { initPanelDock }                            from './panel-dock.js';

// ── Expose map to voice.js shortcuts ─────────────────────────────────────────
window.__mapState = mapState;

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  // Hide APK banner if running as installed PWA or native app
  if (window.matchMedia('(display-mode: standalone)').matches || window.Capacitor) {
    const b = document.getElementById('apkBanner');
    if (b) b.style.display = 'none';
  }

  // Init map — pass POI long-press handler
  initMap((lng, lat, touchEvt) => openPOIPicker(lng, lat, touchEvt));

  // Map-ready callback: refresh history overlay
  // (addMapLayers fires inside map.js on 'load'; we need to call refreshHistorySource
  //  after map.js has set mapState.loaded = true)
  const waitForMap = setInterval(() => {
    if (mapState.loaded) {
      clearInterval(waitForMap);
      refreshHistorySource();
      initPanelDock();   // start dock system once map is ready
    }
  }, 100);

  // Non-map init
  initNetwork();
  await initBattery();
  checkBackup();
  renderHistoryList();
  buildHistoryBumpIndex();
  initRotatingTips();   // replaces static notice

  // Wire voice callbacks (avoids circular imports)
  setVoiceCallbacks({
    onNavigate:       q => { showFindSearch(); doLocationSearch(q); },
    onStartRecording: startRecording,
    onStopRecording:  () => stopRecording(),
  });

  // Wake lock re-acquisition on visibility restore
  document.addEventListener('visibilitychange', async () => {
    if (session.active && document.visibilityState === 'visible' && session.wakeLock?.released) {
      const { requestWakeLock } = await import('./sensors.js');
      requestWakeLock();
    }
  });

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => log('Service Worker registered', 'ok'))
      .catch(e => log('SW error: ' + e.message, 'warn'));
  }

  log('FieldSurveyor V3 ready — go outside and press START', 'ok');
})();

// ─────────────────────────────────────────────────────────────────────────────
//  RECORDING CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', startRecording);

document.getElementById('stopBtn').addEventListener('click', () => {
  stopRecording();
  // Show annotations list if any were recorded
  const { voiceState } = window.__voiceState ?? {};
  // Annotations are rendered at stop time inside recording.js → voice.js exported
  import('./voice.js').then(m => {
    if (m.voiceState?.annotations?.length) m.renderAnnotationList();
  });
});

document.getElementById('downloadBtn').addEventListener('click', exportCSV);
document.getElementById('geoExportBtn').addEventListener('click', exportGeoJSON);
document.getElementById('restoreBtn').addEventListener('click', restoreBackup);

document.getElementById('replayBtn').addEventListener('click', () => {
  if (window.__replayData?.length) initReplay();
});

// ─────────────────────────────────────────────────────────────────────────────
//  REPLAY CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('replayPlayBtn').addEventListener('click', toggleReplayPlay);

document.getElementById('replayScrubber').addEventListener('input', e => {
  onReplayScrub(e.target.value);
});

document.getElementById('replayCloseBtn').addEventListener('click', closeReplay);

// Speed buttons — event delegation on the replay panel
document.getElementById('replayPanel').addEventListener('click', e => {
  const btn = e.target.closest('.spd-btn');
  if (btn) setReplaySpeed(parseInt(btn.dataset.speed));
});

// ─────────────────────────────────────────────────────────────────────────────
//  FIND LOCATION (simplified navigation: search → fly to)
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('findBtn').addEventListener('click', () => {
  const panel = document.getElementById('findSearchOverlay');
  if (panel.classList.contains('active')) {
    panel.classList.remove('active');
  } else {
    showFindSearch();
  }
});

document.getElementById('findSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLocationSearch(e.target.value.trim());
});

function showFindSearch() {
  const panel = document.getElementById('findSearchOverlay');
  panel.classList.add('active');
  const inp = document.getElementById('findSearchInput');
  inp.focus(); inp.value = '';
  document.getElementById('findSearchResults').innerHTML = '';
}

async function doLocationSearch(query) {
  if (!query) return;
  const spinner = document.getElementById('findSearchSpinner');
  const results = document.getElementById('findSearchResults');
  if (spinner) spinner.style.display = 'block';
  results.innerHTML = '';

  try {
    const lat = session.active && mapState.loaded
      ? mapState.geojsonCar.geometry.coordinates[1] : 32.71;
    const lng = session.active && mapState.loaded
      ? mapState.geojsonCar.geometry.coordinates[0] : 36.57;

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1&countrycodes=sy&viewbox=${lng-0.5},${lat-0.5},${lng+0.5},${lat+0.5}&bounded=0`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (spinner) spinner.style.display = 'none';

    if (!data.length) {
      results.innerHTML = '<div class="nav-result" style="cursor:default"><div class="nr-name" style="color:var(--text-dim)">No results found</div></div>';
      return;
    }

    data.forEach(item => {
      const d    = document.createElement('div');
      d.className = 'nav-result';
      const name = item.namedetails?.name || item.display_name.split(',')[0];
      const addr = item.display_name;
      d.innerHTML = `<div class="nr-name">${name}</div><div class="nr-addr">${addr.slice(0, 80)}${addr.length > 80 ? '…' : ''}</div>`;
      d.addEventListener('click', () => {
        document.getElementById('findSearchOverlay').classList.remove('active');
        setDestinationMarker(parseFloat(item.lon), parseFloat(item.lat));
        log(`Destination: ${name}`, 'ok');
        speak(`Flying to ${name}.`, true);
      });
      results.appendChild(d);
    });
  } catch(err) {
    if (spinner) spinner.style.display = 'none';
    results.innerHTML = '<div class="nav-result" style="cursor:default"><div class="nr-name" style="color:var(--red)">Search failed. Check connection.</div></div>';
    log('Location search failed: ' + err.message, 'err');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAP LAYER TOGGLES
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('historyToggleBtn').addEventListener('click', toggleHistoryOverlay);
document.getElementById('coverageBtn').addEventListener('click', toggleCoverageGap);

// Camera follow
document.getElementById('camToggleBtn').addEventListener('click', () => {
  mapState.cameraFollow = !mapState.cameraFollow;
  const btn = document.getElementById('camToggleBtn');
  btn.textContent  = mapState.cameraFollow ? '🎥 FOLLOW' : '🎥 FREE-LOOK';
  btn.style.color  = mapState.cameraFollow ? 'var(--accent)' : 'var(--amber)';
  if (mapState.cameraFollow && mapState.loaded)
    mapFollowCar(mapState.geojsonCar.geometry.coordinates[0],
                 mapState.geojsonCar.geometry.coordinates[1], 0, null);
});

// Dashboard (HUD + side stat panels + compass)
document.getElementById('dashBtn').addEventListener('click', () => {
  mapState.dashboardActive = !mapState.dashboardActive;
  const btn = document.getElementById('dashBtn');
  if (mapState.dashboardActive) {
    document.body.classList.add('hud-active');
    btn.textContent = '⊞ DASH: ON'; btn.classList.add('btn-on');
    setTimeout(() => { if (mapState.loaded) mapState.map.resize(); }, 150);
    import('./sensors.js').then(m => drawCompass(0));
    log('Dashboard mode: ON', 'ok');
  } else {
    document.body.classList.remove('hud-active');
    btn.textContent = '⊞ DASH'; btn.classList.remove('btn-on'); btn.style.color = 'var(--text-dim)';
    setTimeout(() => { if (mapState.loaded) mapState.map.resize(); }, 150);
    log('Dashboard mode: OFF', 'ok');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  DEBUG PANEL TOGGLE
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('debugToggleBtn').addEventListener('click', () => {
  uiState.debugMode = !uiState.debugMode;
  const panels = document.getElementById('debugPanels');
  const btn    = document.getElementById('debugToggleBtn');
  if (panels) panels.style.display = uiState.debugMode ? 'block' : 'none';
  btn.textContent = uiState.debugMode ? '⚙ DEV: ON' : '⚙ DEV: OFF';
  btn.classList.toggle('btn-on', uiState.debugMode);
});

// ─────────────────────────────────────────────────────────────────────────────
//  POI PICKER
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('poiBtn').addEventListener('click', () => {
  if (!session.active) { log('Start recording first to drop pins', 'warn'); return; }
  import('./state.js').then(({ sensors }) => openPOIPicker(sensors.gps.lng, sensors.gps.lat, null));
});

// Category buttons inside the picker — event delegation
document.getElementById('poiPicker').addEventListener('click', e => {
  const btn = e.target.closest('[data-category]');
  if (btn) { dropPOI(btn.dataset.category); return; }
  if (e.target.id === 'poiShowNote') showPoiNoteInput();
  if (e.target.closest('.pp-cancel'))  closePOIPicker();
});

document.getElementById('poiNoteInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') dropPOI('note', e.target.value.trim());
});

// ─────────────────────────────────────────────────────────────────────────────
//  VOICE
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('voiceBtn').addEventListener('click', toggleVoice);

const annotateBtn = document.getElementById('annotateBtn');
annotateBtn.addEventListener('mousedown',  startAnnotation);
annotateBtn.addEventListener('touchstart', e => { e.preventDefault(); startAnnotation(); }, { passive: false });
annotateBtn.addEventListener('mouseup',    stopAnnotation);
annotateBtn.addEventListener('touchend',   stopAnnotation);

// ─────────────────────────────────────────────────────────────────────────────
//  OFFLINE TILE CACHE
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('cacheAreaBtn').addEventListener('click', cacheCurrentArea);

// ─────────────────────────────────────────────────────────────────────────────
//  HISTORY LIST — event delegation for delete buttons
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('historyList').addEventListener('click', e => {
  const btn = e.target.closest('[data-delete-session]');
  if (btn) deleteHistorySession(btn.dataset.deleteSession);
});

// ─────────────────────────────────────────────────────────────────────────────
//  ANNOTATION LIST — event delegation for play buttons
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('annList').addEventListener('click', e => {
  const btn = e.target.closest('[data-ann-idx]');
  if (btn) {
    const audio = document.getElementById('ann-audio-' + btn.dataset.annIdx);
    if (audio) audio.play();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROTATING TIPS
//  Cycles through useful hints every 12 seconds. GPS tip always shows first.
// ─────────────────────────────────────────────────────────────────────────────
const TIPS = [
  { icon: '⚠', html: '<strong>GO OUTSIDE FIRST</strong> — GPS needs open sky (~15 sec to lock). Badge turns green when ready. Disable battery optimisation for this app in Android Settings.' },
  { icon: '📌', html: '<strong>LONG-PRESS the map</strong> to drop a pin at any location — no need to open the PIN menu first.' },
  { icon: '↔', html: '<strong>DRAG the grip</strong> at the top of this panel to snap it left or right. Flick it quickly to collapse it and go full-screen map.' },
  { icon: '🎤', html: '<strong>VOICE COMMANDS</strong> work in English and Arabic — say "drop pin", "zoom in", or "أسقط دبوس" while recording.' },
  { icon: '📊', html: '<strong>BUMPS/KM</strong> in the Trip Computer is the most useful single metric — a consistently high value means a road section needs attention.' },
  { icon: '💾', html: '<strong>EXPORT GEOJSON</strong> after a session to load it directly into QGIS, Google Earth, or any GIS tool for further analysis.' },
  { icon: '📚', html: '<strong>HISTORY OVERLAY</strong> — tap 📍 HIST to colour-code all your past routes on the map. Green = smooth, amber = moderate, red = rough.' },
  { icon: '📦', html: '<strong>OFFLINE CACHE</strong> — before heading into low-signal areas, use the Offline Map Cache panel to pre-fetch tiles for the current view.' },
];

let _tipIdx = 0;

function initRotatingTips() {
  const banner = document.getElementById('tipBanner');
  if (!banner) return;

  function showTip(idx) {
    const t = TIPS[idx];
    banner.style.opacity = '0';
    banner.style.transition = 'opacity 0.4s';
    setTimeout(() => {
      banner.innerHTML = `${t.icon} ${t.html}`;
      banner.style.opacity = '1';
    }, 400);
  }

  // First tip already in HTML — just start the rotation timer
  setInterval(() => {
    _tipIdx = (_tipIdx + 1) % TIPS.length;
    showTip(_tipIdx);
  }, 12000);
}
