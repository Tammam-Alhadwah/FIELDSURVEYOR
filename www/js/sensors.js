// ── FIELDSURVEYOR ── sensors.js ────────────────────────────────────────────────
// Handles: Battery API, Network Info, Wake Lock, Generic Sensor API
// (Linear Acceleration, Magnetometer, AbsoluteOrientation, Gravity, AmbientLight)
// Also handles DeviceMotion and DeviceOrientation raw event processing.
//
// GPS is NOT started here — it is tied to the recording lifecycle in recording.js.

import { sensors, session, genericSensorInstances } from './state.js';
import { log, setBadge }                                      from './utils.js';

// ── Battery API ────────────────────────────────────────────────────────────────
export async function initBattery() {
  if (!('getBattery' in navigator)) {
    log('Battery API: not supported', 'warn');
    return;
  }
  try {
    const bat = await navigator.getBattery();
    const update = () => {
      sensors.battery.level    = bat.level;
      sensors.battery.charging = bat.charging;
      const pct = Math.round(bat.level * 100);
      setBadge('badgeBattery', `BAT: ${pct}%${bat.charging ? '⚡' : ''}`, pct > 20 ? 'ok' : 'err');
      const el = document.getElementById('v-bat');
      if (el) el.textContent = pct + '%';
      const st = document.getElementById('v-bat-status');
      if (st) st.textContent = bat.charging
        ? 'Charging'
        : (bat.dischargingTime === Infinity ? 'Unknown' : `~${Math.round(bat.dischargingTime / 60)}m`);
      const db = document.getElementById('dash-bat');
      if (db) db.textContent = pct + '%';
    };
    bat.addEventListener('levelchange', update);
    bat.addEventListener('chargingchange', update);
    update();
    log('Battery API: OK', 'ok');
  } catch(e) { log('Battery API error: ' + e.message, 'warn'); }
}

// ── Network Info API ───────────────────────────────────────────────────────────
export function initNetwork() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) { log('Network Info API: not supported', 'warn'); return; }
  const update = () => {
    sensors.network.type      = c.type || '?';
    sensors.network.effType   = c.effectiveType || '?';
    sensors.network.downlink  = c.downlink ?? null;
    sensors.network.rtt       = c.rtt ?? null;
    const eff = sensors.network.effType;
    setBadge('badgeNetwork', `NET: ${eff}`, eff?.includes('4g') ? 'ok' : 'warn');
    const vn  = document.getElementById('v-net');     if (vn)  vn.textContent  = eff;
    const vnd = document.getElementById('v-net-dl');  if (vnd) vnd.textContent = sensors.network.downlink ? sensors.network.downlink + ' Mbps' : '';
    const vr  = document.getElementById('v-rtt');     if (vr)  vr.textContent  = sensors.network.rtt ?? '—';
  };
  c.addEventListener('change', update);
  update();
  log('Network Info API: OK', 'ok');
}

// ── Wake Lock ──────────────────────────────────────────────────────────────────
export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) { setBadge('badgeWakeLock', 'WAKE: N/A', 'idle'); return; }
  try {
    session.wakeLock = await navigator.wakeLock.request('screen');
    setBadge('badgeWakeLock', 'WAKE: ON', 'ok');
    log('Wake Lock: screen will stay on', 'ok');
    session.wakeLock.addEventListener('release', () => {
      setBadge('badgeWakeLock', 'WAKE: LOST', 'warn');
      log('Wake Lock released', 'warn');
    });
  } catch(e) {
    setBadge('badgeWakeLock', 'WAKE: FAIL', 'err');
    log('Wake Lock failed: ' + e.message, 'err');
  }
}

// ── Generic Sensor API ─────────────────────────────────────────────────────────
export function stopGenericSensors() {
  genericSensorInstances.forEach(s => { try { s.stop(); } catch(_) {} });
  genericSensorInstances.length = 0;
  if (window.Capacitor?.Plugins?.Sensors) {
    try { window.Capacitor.Plugins.Sensors.stop({ type: 'MAGNETOMETER' }); } catch(_) {}
  }
}

export function initGenericSensors() {
  stopGenericSensors();

  // Linear Acceleration (gravity-free) ─────────────────────────────────────────
  if ('LinearAccelerationSensor' in window) {
    try {
      const s = new LinearAccelerationSensor({ frequency: 20 });
      s.addEventListener('reading', () => {
        sensors.linAccel = { x: s.x, y: s.y, z: s.z };
      });
      s.addEventListener('error', e => log('LinearAccel error: ' + e.error, 'warn'));
      s.start();
      genericSensorInstances.push(s);
      log('LinearAccelerationSensor: active', 'ok');
    } catch(e) { log('LinearAccel: ' + e.message, 'warn'); }
  }

  // Magnetometer ────────────────────────────────────────────────────────────────
  const updateMag = (x, y, z) => {
    sensors.mag = { x, y, z };
    const t = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    const mx = document.getElementById('v-mx'); if (mx) mx.textContent = x.toFixed(1);
    const my = document.getElementById('v-my'); if (my) my.textContent = y.toFixed(1);
    const mz = document.getElementById('v-mz'); if (mz) mz.textContent = z.toFixed(1);
    const mt = document.getElementById('v-mtotal'); if (mt) mt.textContent = t.toFixed(1);
    setBadge('badgeMag', `MAG: ${t.toFixed(0)}µT`, 'ok');
  };

  if (window.Capacitor?.Plugins?.Sensors) {
    const S = window.Capacitor.Plugins.Sensors;
    S.init({ type: 'MAGNETOMETER' }).then(() => {
      S.start({ type: 'MAGNETOMETER' });
      S.addListener('MAGNETOMETER', d => updateMag(d.values[0], d.values[1], d.values[2]));
      setBadge('badgeMag', 'MAG: ON', 'ok');
      log('Native Magnetometer: active', 'ok');
    }).catch(e => {
      setBadge('badgeMag', 'MAG: ERR', 'err');
      log('Native Magnetometer failed: ' + e.message, 'warn');
    });
  } else if ('Magnetometer' in window) {
    try {
      const s = new Magnetometer({ frequency: 5 });
      s.addEventListener('reading', () => updateMag(s.x ?? 0, s.y ?? 0, s.z ?? 0));
      s.addEventListener('error', e => { setBadge('badgeMag', 'MAG: ERR', 'err'); log('Magnetometer: ' + e.error, 'warn'); });
      s.start();
      genericSensorInstances.push(s);
      setBadge('badgeMag', 'MAG: ON', 'ok');
      log('Web Magnetometer: active', 'ok');
    } catch(e) { setBadge('badgeMag', 'MAG: N/A', 'idle'); log('Magnetometer: ' + e.message, 'warn'); }
  } else { setBadge('badgeMag', 'MAG: N/A', 'idle'); }

  // Absolute Orientation (quaternion) ───────────────────────────────────────────
  if ('AbsoluteOrientationSensor' in window) {
    try {
      const s = new AbsoluteOrientationSensor({ frequency: 10 });
      s.addEventListener('reading', () => {
        if (s.quaternion) {
          sensors.abs = { x: s.quaternion[0], y: s.quaternion[1], z: s.quaternion[2], w: s.quaternion[3] };
          const qw = document.getElementById('v-qw'); if (qw) qw.textContent = sensors.abs.w?.toFixed(3) ?? '—';
          const qx = document.getElementById('v-qx'); if (qx) qx.textContent = sensors.abs.x?.toFixed(3) ?? '—';
          const qy = document.getElementById('v-qy'); if (qy) qy.textContent = sensors.abs.y?.toFixed(3) ?? '—';
          const qz = document.getElementById('v-qz'); if (qz) qz.textContent = sensors.abs.z?.toFixed(3) ?? '—';
        }
      });
      s.start();
      genericSensorInstances.push(s);
      log('AbsoluteOrientationSensor: active', 'ok');
    } catch(e) { log('AbsoluteOrientation: ' + e.message, 'warn'); }
  }

  // Gravity Sensor ──────────────────────────────────────────────────────────────
  if ('GravitySensor' in window) {
    try {
      const s = new GravitySensor({ frequency: 5 });
      s.addEventListener('reading', () => {
        sensors.gravZ = s.z;
        const el = document.getElementById('v-gvz'); if (el) el.textContent = s.z?.toFixed(2) ?? '—';
      });
      s.start();
      genericSensorInstances.push(s);
      log('GravitySensor: active', 'ok');
    } catch(e) { log('GravitySensor: ' + e.message, 'warn'); }
  }

  // Ambient Light ───────────────────────────────────────────────────────────────
  if ('AmbientLightSensor' in window) {
    try {
      const s = new AmbientLightSensor({ frequency: 2 });
      s.addEventListener('reading', () => {
        sensors.lux = s.illuminance;
        const el = document.getElementById('v-lux'); if (el) el.textContent = s.illuminance?.toFixed(0) ?? '—';
        setBadge('badgeLight', `LUX: ${s.illuminance?.toFixed(0)}`, 'ok');
      });
      s.addEventListener('error', e => { setBadge('badgeLight', 'LUX: N/A', 'idle'); log('AmbientLight: ' + e.error, 'warn'); });
      s.start();
      genericSensorInstances.push(s);
      setBadge('badgeLight', 'LUX: ON', 'ok');
      log('AmbientLightSensor: active', 'ok');
    } catch(e) { setBadge('badgeLight', 'LUX: N/A', 'idle'); log('AmbientLight: ' + e.message, 'warn'); }
  } else { setBadge('badgeLight', 'LUX: N/A', 'idle'); }
}

// ── DeviceMotion ───────────────────────────────────────────────────────────────
export function handleMotion(e) {
  const g = e.accelerationIncludingGravity;
  const a = e.acceleration;
  sensors.accel.x = g?.x ?? 0;
  sensors.accel.y = g?.y ?? 0;
  sensors.accel.z = g?.z ?? 0;
  sensors.gyro.x  = e.rotationRate?.alpha ?? 0;
  sensors.gyro.y  = e.rotationRate?.beta  ?? 0;
  sensors.gyro.z  = e.rotationRate?.gamma ?? 0;

  if (a && a.x !== null && a.y !== null && a.z !== null) {
    session.usingGravityFreeAccel = true;
    session.magBuffer.push(Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2));
  } else {
    session.usingGravityFreeAccel = false;
    session.magBuffer.push(Math.sqrt(sensors.accel.x ** 2 + sensors.accel.y ** 2 + sensors.accel.z ** 2));
  }
}

// ── DeviceOrientation ──────────────────────────────────────────────────────────
export function handleOrientation(e) {
  sensors.orient.alpha = e.alpha ?? 0;
  sensors.orient.beta  = e.beta  ?? 0;
  sensors.orient.gamma = e.gamma ?? 0;
  const oa = document.getElementById('v-oa'); if (oa) oa.textContent = sensors.orient.alpha.toFixed(1);
  const ob = document.getElementById('v-ob'); if (ob) ob.textContent = sensors.orient.beta.toFixed(1);
  const og = document.getElementById('v-og'); if (og) og.textContent = sensors.orient.gamma.toFixed(1);
}
