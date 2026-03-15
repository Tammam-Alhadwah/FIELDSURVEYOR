// ── FIELDSURVEYOR ── utils.js ──────────────────────────────────────────────────
// Pure helpers with no side-effects, plus speak() and log().

// ── Logging ────────────────────────────────────────────────────────────────────
export function log(msg, type = '') {
  const feed = document.getElementById('logFeed');
  if (!feed) return;
  const d = document.createElement('div');
  d.className = `log-line ${type}`;
  d.textContent = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
  feed.prepend(d);
  while (feed.children.length > 40) feed.removeChild(feed.lastChild);
}

// ── Badge ──────────────────────────────────────────────────────────────────────
export function setBadge(id, text, state) {
  const b = document.getElementById(id);
  if (b) { b.className = `badge ${state}`; b.textContent = text; }
}

// ── Geo maths ──────────────────────────────────────────────────────────────────
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dN = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dL / 2) ** 2
           + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
           * Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function lngLatToTile(lng, lat, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n
  );
  return [x, y];
}

// ── Formatting ─────────────────────────────────────────────────────────────────
export function fmt(v, d = 2) {
  return (v !== null && v !== undefined && v !== '') ? parseFloat(v).toFixed(d) : '';
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function fmtDuration(s) {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function fmtDurationShort(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Road quality ───────────────────────────────────────────────────────────────
export function computeRoughness(peak, gravFree) {
  if (gravFree) return Math.min(1, Math.max(0, peak / 12));
  return Math.min(1, Math.max(0, (peak - 9.0) / 12));
}

export function roughnessLabel(r) {
  if (r < 0.25) return '<span style="color:var(--accent)">Smooth</span>';
  if (r < 0.55) return '<span style="color:var(--amber)">Moderate</span>';
  return '<span style="color:var(--red)">Rough</span>';
}

export function computeIRI(avgMag, speedKmh, gravFree) {
  if (speedKmh < 2) return null;
  const baseline = gravFree ? 0 : 9.0;
  return Math.max(0, (avgMag - baseline) / Math.max(speedKmh / 3.6, 1) * 2.5);
}

// ── Device ─────────────────────────────────────────────────────────────────────
export function haptic(pattern) {
  if ('vibrate' in navigator) try { navigator.vibrate(pattern); } catch(e) {}
}

// ── Text-to-speech ─────────────────────────────────────────────────────────────
let _lastSpeakTime = 0;

export async function speak(text, priority = false) {
  if (!priority && Date.now() - _lastSpeakTime < 3000) return;
  _lastSpeakTime = Date.now();
  try {
    if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.TextToSpeech) {
      await window.Capacitor.Plugins.TextToSpeech.speak({ text, rate: 1.0, pitch: 0.9, volume: 1.0 });
    } else if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 0.9;
      try {
        const v = window.speechSynthesis.getVoices()
          .find(v => v.lang.includes('en') && v.name.includes('Google'));
        if (v) u.voice = v;
      } catch(_) {}
      window.speechSynthesis.speak(u);
    }
  } catch(e) { console.warn('speak() failed:', e); }
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
