// ── FIELDSURVEYOR ── recording.js ──────────────────────────────────────────────
// Owns the recording lifecycle: start → GPS/IMU tick → stop → export.

import { sensors, session, mapState, poiState,
         potholeState, voiceState, settings }                 from './state.js';
import { log, setBadge, haversine, fmt, csvEscape,
         fmtDuration, fmtDurationShort,
         computeRoughness, roughnessLabel,
         computeIRI, haptic, speak }                          from './utils.js';
import { requestWakeLock, initGenericSensors, stopGenericSensors,
         handleMotion, handleOrientation }                    from './sensors.js';
import { mapFollowCar, showCarLayers, pushRouteSegment,
         pushBump, resetLiveLayers, drawCompass }             from './map.js';
import { buildHistoryBumpIndex, saveSessionToHistory }       from './history.js';
import { saveSession }                                        from './db.js';
import { SESSION_KEY, GPS_TIMEOUT_WARN,
         POTHOLE_ALERT_COOLDOWN, POTHOLE_ALERT_RADIUS_KM }   from './constants.js';

// ── START ──────────────────────────────────────────────────────────────────────
export async function startRecording() {
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(''); u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch(_) {}

  if (typeof DeviceMotionEvent?.requestPermission === 'function') {
    try {
      const p = await DeviceMotionEvent.requestPermission();
      if (p !== 'granted') { alert('Motion sensor permission denied'); return; }
    } catch(e) { console.error(e); }
  }

  Object.assign(session, {
    active: true, data: [], startTime: Date.now(),
    distKm: 0, bumpCount: 0, maxSpeed: 0,
    magBuffer: [], usingGravityFreeAccel: false,
    tripSpeedSamples: [], tripIRISamples: [],
    prevLat: 0, prevLng: 0, prevRoutePoint: null,
    lastGpsTime: 0,
  });
  voiceState.annotations = [];
  poiState.pois = [];
  resetLiveLayers();
  setUI({ recording: true });

  await requestWakeLock();
  initGenericSensors();

  if ('geolocation' in navigator) {
    session.geoWatchId = navigator.geolocation.watchPosition(
      onGPSUpdate,
      e => log('GPS error: ' + e.message, 'err'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    log('GPS: searching for signal…', 'info');
  } else {
    log('Geolocation not available', 'err');
  }

  window.addEventListener('devicemotion',      handleMotion);
  window.addEventListener('deviceorientation', handleOrientation);
  setBadge('badgeMotion', 'IMU: ON', 'ok');
  session.recordingInterval = setInterval(onRecordingTick, 1000);
  log('Recording started', 'ok');
  speak('Telemetry online. Searching for GPS satellites.');
}

// ── GPS UPDATE ─────────────────────────────────────────────────────────────────
function onGPSUpdate(pos) {
  const c = pos.coords;
  sensors.gps = {
    lat: c.latitude, lng: c.longitude, alt: c.altitude,
    speed: c.speed ?? 0, heading: c.heading ?? null,
    acc: c.accuracy, altAcc: c.altitudeAccuracy,
  };
  session.lastGpsTime = Date.now();

  if (session.prevLat === 0) {
    if (mapState.loaded) {
      mapState.map.jumpTo({ center: [sensors.gps.lng, sensors.gps.lat], zoom: 16 });
      showCarLayers();
    }
    speak('GPS lock acquired. Route mapping initiated.');
    buildHistoryBumpIndex();
  }

  const kmh = sensors.gps.speed * 3.6;
  if (kmh > session.maxSpeed) {
    session.maxSpeed = kmh;
    const el = document.getElementById('statMaxSpd');
    if (el) el.textContent = Math.round(session.maxSpeed);
  }
  if (session.prevLat && session.prevLng) {
    const d = haversine(session.prevLat, session.prevLng, sensors.gps.lat, sensors.gps.lng);
    if (d > 0 && d < 0.05) {
      session.distKm += d;
      const el = document.getElementById('statDist');
      if (el) el.textContent = session.distKm.toFixed(2);
    }
  }
  session.prevLat = sensors.gps.lat;
  session.prevLng = sensors.gps.lng;

  const quality = Math.max(0, Math.min(100, 100 - (sensors.gps.acc / 50) * 100));
  const bar = document.getElementById('gpsBar'); if (bar) bar.style.width = quality + '%';
  setBadge('badgeGPS', `GPS: ${sensors.gps.acc?.toFixed(0) ?? '?'}m`, quality > 60 ? 'ok' : 'warn');
  const vh = document.getElementById('v-heading');
  if (vh) vh.textContent = sensors.gps.heading !== null ? fmt(sensors.gps.heading, 0) : '—';
  const dgps = document.getElementById('dash-gps');
  if (dgps) dgps.textContent = sensors.gps.acc ? fmt(sensors.gps.acc, 0) + 'm' : '—';

  checkPotholeAhead();
}

// ── RECORDING TICK (1 Hz) ──────────────────────────────────────────────────────
function onRecordingTick() {
  const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
  const ts      = new Date().toISOString();

  const peakMag = session.magBuffer.length ? Math.max(...session.magBuffer) : 0;
  const avgMag  = session.magBuffer.length
    ? session.magBuffer.reduce((a, b) => a + b, 0) / session.magBuffer.length : 0;
  session.magBuffer = [];

  // Use live sensitivity settings
  const bumpThr   = session.usingGravityFreeAccel
    ? settings.bumpThresholdClean
    : settings.bumpThresholdRaw;
  const isBump    = peakMag > bumpThr;
  const roughness = computeRoughnessWithThreshold(peakMag, session.usingGravityFreeAccel, settings.bumpThresholdClean);
  const kmh       = sensors.gps.speed * 3.6;

  if (kmh > 2) session.tripSpeedSamples.push(kmh);
  const avgSpeed = session.tripSpeedSamples.length
    ? session.tripSpeedSamples.reduce((a, b) => a + b, 0) / session.tripSpeedSamples.length : 0;
  const iri = computeIRI(avgMag, kmh, session.usingGravityFreeAccel);
  if (iri !== null) session.tripIRISamples.push(iri);
  const avgIRI     = session.tripIRISamples.length
    ? session.tripIRISamples.reduce((a, b) => a + b, 0) / session.tripIRISamples.length : null;
  const bumpsPerKm = session.distKm > 0.1 ? (session.bumpCount / session.distKm).toFixed(1) : '—';

  if (session.lastGpsTime > 0 && Date.now() - session.lastGpsTime > GPS_TIMEOUT_WARN) {
    const age = Date.now() - session.lastGpsTime;
    if (age < GPS_TIMEOUT_WARN + 2000) {
      log('⚠ No GPS signal for 30+ seconds — check line-of-sight to sky', 'warn');
      speak('Warning. GPS signal lost.', true);
    }
  }

  // ── DOM updates ──────────────────────────────────────────────────────────────
  const timer = document.getElementById('elapsedTimer'); if (timer) timer.textContent = fmtDuration(elapsed);
  const de    = document.getElementById('dash-elapsed'); if (de)    de.textContent    = fmtDuration(elapsed);
  setText('tc-avg',  avgSpeed > 0 ? avgSpeed.toFixed(1) : '—');
  setText('tc-iri',  avgIRI !== null ? avgIRI.toFixed(2) : '—');
  setText('tc-bpk',  bumpsPerKm);
  const dashAvg  = document.getElementById('dash-avg');   if (dashAvg)  dashAvg.textContent  = avgSpeed > 0 ? Math.round(avgSpeed) + '' : '—';
  const dashDist = document.getElementById('dash-dist');  if (dashDist) dashDist.textContent = session.distKm.toFixed(2);
  const dashBmps = document.getElementById('dash-bumps'); if (dashBmps) dashBmps.textContent = session.bumpCount;
  const dashSurf = document.getElementById('dash-surface'); if (dashSurf) dashSurf.innerHTML = roughnessLabel(roughness);
  const hs = document.getElementById('hud-speed'); if (hs) hs.textContent = Math.round(kmh);
  mapFollowCar(sensors.gps.lng, sensors.gps.lat, kmh, sensors.gps.heading);
  if (mapState.dashboardActive) drawCompass(sensors.gps.heading ?? sensors.orient.alpha);
  updateSensorDisplay(peakMag, kmh);

  // ── Bump event ───────────────────────────────────────────────────────────────
  if (isBump && sensors.gps.lat !== 0) {
    session.bumpCount++;
    const el = document.getElementById('statBumps'); if (el) el.textContent = session.bumpCount;
    const flash = document.getElementById('bumpFlash');
    if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 200); }
    haptic([80, 30, 80]);
    pushBump(sensors.gps.lng, sensors.gps.lat, peakMag);
    if (peakMag > 25) speak(`Warning. Severe impact. ${Math.round(peakMag)} meters per second squared.`);
    log(`⚠ BUMP! peak=${peakMag.toFixed(1)} m/s²`, 'warn');
  }

  // ── Route segment ────────────────────────────────────────────────────────────
  if (sensors.gps.lat !== 0) {
    const pt = [sensors.gps.lng, sensors.gps.lat];
    if (session.prevRoutePoint) pushRouteSegment(session.prevRoutePoint, pt, roughness);
    session.prevRoutePoint = pt;
  }

  // ── Stats panel ──────────────────────────────────────────────────────────────
  const sp = document.getElementById('statPoints'); if (sp) sp.textContent = session.data.length;
  const cd = document.getElementById('coordsDisplay');
  if (cd) cd.innerHTML =
    `<span class="highlight">${fmt(sensors.gps.lat, 5)}°N, ${fmt(sensors.gps.lng, 5)}°E</span>` +
    (sensors.gps.alt !== null ? `  <span class="highlight-amber">alt ${fmt(sensors.gps.alt, 0)}m</span>` : '');

  // ── Find nearest annotation for this tick (for CSV column) ──────────────────
  const tickTime = Date.now();
  const recentAnn = voiceState.annotations.find(a => {
    const at = new Date(a.ts).getTime();
    return at >= tickTime - 1000 && at < tickTime;
  });

  // ── CSV row ──────────────────────────────────────────────────────────────────
  const magTot = sensors.mag.x !== null
    ? Math.sqrt(sensors.mag.x ** 2 + sensors.mag.y ** 2 + sensors.mag.z ** 2) : null;

  const dp = {
    timestamp: ts, elapsed_s: elapsed,
    lat: fmt(sensors.gps.lat, 7), lng: fmt(sensors.gps.lng, 7),
    altitude_m: fmt(sensors.gps.alt, 1), alt_accuracy_m: fmt(sensors.gps.altAcc, 1),
    speed_kmh: fmt(kmh, 2),
    heading_deg: sensors.gps.heading !== null ? fmt(sensors.gps.heading, 2) : '',
    gps_accuracy_m: fmt(sensors.gps.acc, 1),
    accel_x: fmt(sensors.accel.x, 3), accel_y: fmt(sensors.accel.y, 3), accel_z: fmt(sensors.accel.z, 3),
    accel_peak_mag: fmt(peakMag, 3), accel_avg_mag: fmt(avgMag, 3),
    bump_detected: isBump ? 1 : 0,
    road_roughness: roughness.toFixed(3),
    iri_estimate: iri !== null ? iri.toFixed(3) : '',
    linear_accel_x: sensors.linAccel.x !== null ? fmt(sensors.linAccel.x, 3) : '',
    linear_accel_y: sensors.linAccel.y !== null ? fmt(sensors.linAccel.y, 3) : '',
    linear_accel_z: sensors.linAccel.z !== null ? fmt(sensors.linAccel.z, 3) : '',
    gyro_alpha: fmt(sensors.gyro.x, 3), gyro_beta: fmt(sensors.gyro.y, 3), gyro_gamma: fmt(sensors.gyro.z, 3),
    orient_alpha: fmt(sensors.orient.alpha, 2), orient_beta: fmt(sensors.orient.beta, 2), orient_gamma: fmt(sensors.orient.gamma, 2),
    mag_x: sensors.mag.x !== null ? fmt(sensors.mag.x, 2) : '',
    mag_y: sensors.mag.y !== null ? fmt(sensors.mag.y, 2) : '',
    mag_z: sensors.mag.z !== null ? fmt(sensors.mag.z, 2) : '',
    mag_total_uT: fmt(magTot, 2),
    quat_w: sensors.abs.w !== null ? fmt(sensors.abs.w, 4) : '',
    quat_x: sensors.abs.x !== null ? fmt(sensors.abs.x, 4) : '',
    quat_y: sensors.abs.y !== null ? fmt(sensors.abs.y, 4) : '',
    quat_z: sensors.abs.z !== null ? fmt(sensors.abs.z, 4) : '',
    gravity_z: sensors.gravZ !== null ? fmt(sensors.gravZ, 3) : '',
    battery_pct: sensors.battery.level !== null ? Math.round(sensors.battery.level * 100) : '',
    charging: sensors.battery.charging !== null ? (sensors.battery.charging ? 1 : 0) : '',
    net_type: sensors.network.type ?? '',
    net_eff_type: sensors.network.effType ?? '',
    net_downlink_mbps: sensors.network.downlink ?? '',
    net_rtt_ms: sensors.network.rtt ?? '',
    voice_annotation_id: recentAnn ? recentAnn.audioId : '',  // ← new column
  };
  if (sensors.gps.lat !== 0) session.data.push(dp);

  if (session.data.length > 0 && session.data.length % 60 === 0) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ts, data: session.data }));
      log(`Auto-saved ${session.data.length} records`, 'ok');
    } catch(e) { log('Auto-save failed — storage full?', 'err'); }
  }
}

// ── Roughness with configurable threshold ──────────────────────────────────────
// roughness = eff / (threshold * 1.5) so trail colors shift with sensitivity.
// At threshold=8 (default) this matches the original computeRoughness output.
export function computeRoughnessWithThreshold(peak, gravFree, cleanThreshold) {
  const baseline = gravFree ? 0 : 9.0;
  const eff      = Math.max(0, peak - baseline);
  return Math.min(1, Math.max(0, eff / (cleanThreshold * 1.5)));
}

// ── Sensor display ─────────────────────────────────────────────────────────────
function updateSensorDisplay(peakMag, kmh) {
  const bumpThr = session.usingGravityFreeAccel
    ? settings.bumpThresholdClean
    : settings.bumpThresholdRaw;
  const lbl = document.getElementById('v-bump-label');
  if (lbl) lbl.textContent = `m/s² — bump fires at >${bumpThr} (${session.usingGravityFreeAccel ? 'gravity-free' : 'raw+gravity'})`;
  setText('v-speed',    kmh.toFixed(1));
  setText('v-altitude', sensors.gps.alt !== null ? fmt(sensors.gps.alt, 0) : '—');
  setText('v-accuracy', sensors.gps.acc !== null ? fmt(sensors.gps.acc, 0) : '—');
  setText('v-ax',  fmt(sensors.accel.x, 2));
  setText('v-ay',  fmt(sensors.accel.y, 2));
  setText('v-az',  fmt(sensors.accel.z, 2));
  setText('v-lx',  sensors.linAccel.x !== null ? fmt(sensors.linAccel.x, 2) : '—');
  setText('v-ly',  sensors.linAccel.y !== null ? fmt(sensors.linAccel.y, 2) : '—');
  setText('v-lz',  sensors.linAccel.z !== null ? fmt(sensors.linAccel.z, 2) : '—');
  setText('v-mag', peakMag.toFixed(2));
  setText('v-gx',  fmt(sensors.gyro.x, 2));
  setText('v-gy',  fmt(sensors.gyro.y, 2));
  setText('v-gz',  fmt(sensors.gyro.z, 2));
}

function setText(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}

// ── STOP ───────────────────────────────────────────────────────────────────────
export function stopRecording() {
  session.active = false;
  clearInterval(session.recordingInterval);
  if (session.geoWatchId != null) navigator.geolocation.clearWatch(session.geoWatchId);
  window.removeEventListener('devicemotion',      handleMotion);
  window.removeEventListener('deviceorientation', handleOrientation);
  if (session.wakeLock && !session.wakeLock.released) session.wakeLock.release();
  stopGenericSensors();

  const ab = document.getElementById('annotateBtn'); if (ab) ab.style.display = 'none';

  if (session.data.length > 0) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ ts: new Date().toISOString(), data: session.data })); } catch(_) {}
  }

  const { features } = mapState.geojsonRoute;
  if (features.length >= 2) saveSessionToHistory();

  // ── Save full session to IndexedDB for the Trip Viewer ────────────────────
  if (session.data.length > 0) {
    const sessionId = new Date().toISOString();
    const elapsed   = Math.floor((Date.now() - session.startTime) / 1000);

    // Build compressed track for history overlay
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

    const dbSession = {
      id:          sessionId,
      stats: {
        points:   session.data.length,
        distKm:   +session.distKm.toFixed(2),
        bumps:    session.bumpCount,
        maxSpeed: +session.maxSpeed.toFixed(1),
        duration: elapsed,
      },
      data:        session.data,           // full CSV rows — the viewer uses these
      annotations: voiceState.annotations.map(a => ({
        ts:      a.ts,
        lat:     a.lat,
        lng:     a.lng,
        audioId: a.audioId,
      })),
      pois:  poiState.pois,
      track,                               // compressed, for history compatibility
    };

    saveSession(dbSession)
      .then(() => log(`Trip saved to viewer (${session.data.length} pts)`, 'ok'))
      .catch(e => log('Trip save failed: ' + e.message, 'err'));
  }

  setUI({ recording: false });

  if (session.data.length > 0) {
    document.getElementById('replayBtn').style.display = 'block';
    window.__replayData = [...session.data];
  }
  if (session.data.length > 1) drawSessionChart();

  const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
  speak('Telemetry offline. Survey data secured.');
  log(`Done — ${session.data.length} records · ${session.distKm.toFixed(2)} km · ${session.bumpCount} bumps · ${fmtDurationShort(elapsed)}`, 'ok');

  const cd = document.getElementById('coordsDisplay');
  if (cd) cd.innerHTML = `<span class="highlight-amber">✓ ${session.data.length} pts · ${session.distKm.toFixed(2)} km · ${session.bumpCount} bumps</span>`;

  ['badgeMotion', 'badgeWakeLock', 'badgeMag'].forEach(id =>
    setBadge(id, id.replace('badge', '').toUpperCase() + ': OFF', 'idle')
  );
}

// ── EXPORT — CSV ───────────────────────────────────────────────────────────────
export async function exportCSV() {
  if (!session.data.length) { log('No data to export', 'warn'); return; }
  const headers = Object.keys(session.data[0]).join(',');
  const rows    = session.data.map(r => Object.values(r).map(csvEscape).join(','));
  const csv     = headers + '\n' + rows.join('\n');
  const fileName = `fieldsurveyor_${new Date().toISOString().slice(0, 10)}.csv`;

  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      const { Filesystem, Share } = window.Capacitor.Plugins;
      const result = await Filesystem.writeFile({ path: fileName, data: csv, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: 'Export Survey Data', text: 'FieldSurveyor CSV export.', url: result.uri, dialogTitle: 'Save or Share CSV' });
      log('CSV shared successfully', 'ok');
    } catch(e) { log('Export failed: ' + e.message, 'err'); }
  } else {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: fileName,
    });
    a.click(); URL.revokeObjectURL(a.href);
    log(`CSV exported: ${session.data.length} rows`, 'ok');
  }
}

// ── EXPORT — GeoJSON ───────────────────────────────────────────────────────────
export function exportGeoJSON() {
  const fc = {
    type: 'FeatureCollection',
    properties: { exported: new Date().toISOString(), records: session.data.length, distKm: session.distKm },
    features: [
      ...mapState.geojsonRoute.features,
      ...mapState.geojsonBumps.features.map(f => ({ ...f, properties: { ...f.properties, type: 'bump' } })),
      ...poiState.pois.map(p => ({
        type: 'Feature',
        properties: { type: 'poi', category: p.category, note: p.note || '', timestamp: p.ts },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
      ...voiceState.annotations.map(a => ({
        type: 'Feature',
        properties: { type: 'annotation', audio_id: a.audioId, timestamp: a.ts },
        geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      })),
    ],
  };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `fieldsurveyor_${new Date().toISOString().slice(0, 10)}.geojson`,
  });
  a.click(); URL.revokeObjectURL(a.href);
  log('GeoJSON exported', 'ok');
}

// ── BACKUP / RESTORE ───────────────────────────────────────────────────────────
export function checkBackup() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved?.data?.length > 0) {
      const rb = document.getElementById('restoreBtn');
      if (rb) { rb.style.display = 'block'; rb.textContent = `↺ RESTORE BACKUP (${saved.data.length} pts)`; }
      log(`Backup found: ${saved.data.length} records from ${saved.ts?.slice(0, 16) ?? '?'}`, 'warn');
    }
  } catch(_) {}
}

export function restoreBackup() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    session.data = saved.data;
    document.getElementById('statPoints').textContent = session.data.length;
    document.getElementById('downloadBtn').style.display  = 'block';
    document.getElementById('geoExportBtn').style.display = 'block';
    if (session.data.length > 0) {
      document.getElementById('replayBtn').style.display = 'block';
      window.__replayData = [...session.data];
    }
    if (session.data.length > 1) drawSessionChart();
    log(`Restored ${session.data.length} records`, 'ok');
  } catch(e) { log('Restore failed', 'err'); }
}

// ── POTHOLE AHEAD ──────────────────────────────────────────────────────────────
function checkPotholeAhead() {
  const { bumpIndex, lastAlert } = potholeState;
  if (bumpIndex.length === 0 || sensors.gps.lat === 0 || sensors.gps.speed * 3.6 < 5) return;
  if (Date.now() - lastAlert < POTHOLE_ALERT_COOLDOWN) return;
  const heading  = (sensors.gps.heading ?? sensors.orient.alpha ?? 0) * Math.PI / 180;
  const aheadLat = sensors.gps.lat + (0.08 / 111.32) * Math.cos(heading);
  const aheadLng = sensors.gps.lng + (0.08 / 111.32) * Math.sin(heading) / Math.cos(sensors.gps.lat * Math.PI / 180);
  for (const b of bumpIndex) {
    if (haversine(aheadLat, aheadLng, b.lat, b.lng) < POTHOLE_ALERT_RADIUS_KM) {
      potholeState.lastAlert = Date.now();
      speak('Pothole ahead.', true);
      haptic([50, 30, 50, 30, 50]);
      log('⚠ Pothole ahead from history data', 'warn');
      return;
    }
  }
}

// ── POST-SESSION CHART ─────────────────────────────────────────────────────────
function drawSessionChart() {
  const panel  = document.getElementById('chartPanel');
  if (panel) panel.classList.add('active');
  const canvas = document.getElementById('sessionChart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 320, H = 160;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0f1612'; ctx.fillRect(0, 0, W, H);
  const n = session.data.length; if (n < 2) return;
  const speeds    = session.data.map(d => parseFloat(d.speed_kmh) || 0);
  const roughness = session.data.map(d => parseFloat(d.road_roughness) || 0);
  const bumps     = session.data.map(d => parseInt(d.bump_detected) || 0);
  const maxSpeed  = Math.max(...speeds, 1);
  const PAD = { t: 10, b: 22, l: 8, r: 8 };
  const cW  = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
  ctx.strokeStyle = 'rgba(57,255,132,0.06)'; ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const y = PAD.t + cH * (1 - f);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cW, y); ctx.stroke();
  });
  const xOf    = i => PAD.l + cW * (i / (n - 1));
  const speedY = v => PAD.t + cH * (1 - v / maxSpeed);
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
  ctx.strokeStyle = 'rgba(255,184,48,0.8)'; ctx.lineWidth = 1.5;
  bumps.forEach((b, i) => {
    if (!b) return;
    const x = xOf(i);
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
  });
  ctx.fillStyle = 'rgba(90,112,99,0.8)'; ctx.font = '9px Space Mono,monospace';
  ctx.textAlign = 'left';   ctx.fillText('0', PAD.l, H - 4);
  ctx.textAlign = 'right';  ctx.fillText(fmtDurationShort(session.data[n - 1]?.elapsed_s || 0), W - PAD.r, H - 4);
  ctx.textAlign = 'center'; ctx.fillText(Math.round(maxSpeed) + ' km/h max', W / 2, H - 4);
}

// ── UI state toggle ────────────────────────────────────────────────────────────
function setUI({ recording }) {
  document.getElementById('startBtn').style.display    = recording ? 'none'  : 'block';
  document.getElementById('stopBtn').style.display     = recording ? 'block' : 'none';
  document.getElementById('downloadBtn').style.display = recording ? 'none'  : (session.data.length ? 'block' : 'none');
  document.getElementById('geoExportBtn').style.display= recording ? 'none'  : (session.data.length ? 'block' : 'none');
  document.getElementById('restoreBtn').style.display  = 'none';
  document.getElementById('replayBtn').style.display   = 'none';
  if (recording) {
    document.getElementById('annotateBtn').style.display = 'block';
    document.getElementById('chartPanel').classList.remove('active');
  } else {
    document.getElementById('annotateBtn').style.display = 'none';
    const hs = document.getElementById('hud-speed'); if (hs) hs.textContent = '—';
  }
}
