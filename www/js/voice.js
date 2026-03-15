// ── FIELDSURVEYOR ── voice.js ──────────────────────────────────────────────────
// Two responsibilities:
//   1. Voice commands: continuous speech recognition in EN-US + AR-SY
//      recognised phrases are dispatched to a simple command table.
//   2. Voice annotations: hold-to-record audio clips geotagged to GPS position.
//
// The command dispatch table lives entirely in this file — the functions it
// calls are imported. No global side-effects outside this module.

import { sensors, voiceState, session } from './state.js';
import { log, setBadge, speak, haptic } from './utils.js';
import { openPOIPicker, dropPOI }       from './pois.js';

// ─────────────────────────────────────────────────────────────────────────────
//  VOICE COMMANDS
// ─────────────────────────────────────────────────────────────────────────────

// Arabic → normalised English. Patterns matched via regex.includes().
const ARABIC_COMMANDS = [
  [/توجه إلى (.+)|انتقل إلى (.+)|اذهب إلى (.+)|خذني إلى (.+)/, m => 'navigate to ' + (m[1]||m[2]||m[3]||m[4]).trim()],
  [/أسقط دبوس|ضع علامة|دبوس|علامة/, () => 'drop pin'],
  [/سجل ملاحظة|ملاحظة|تعليق/,       () => 'annotate'],
  [/تكبير|كبّر/,                      () => 'zoom in'],
  [/تصغير|صغّر/,                      () => 'zoom out'],
  [/تتبع|مركز/,                       () => 'follow'],
  [/ابدأ التسجيل|ابدأ/,              () => 'start recording'],
  [/أوقف التسجيل|أوقف|توقف/,        () => 'stop recording'],
];

function normaliseArabic(transcript) {
  for (const [pat, fn] of ARABIC_COMMANDS) {
    const m = transcript.match(pat);
    if (m) return fn(m);
  }
  return null;
}

function makeRecognizer(lang) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = true; r.interimResults = false; r.maxAlternatives = 2; r.lang = lang;

  r.onresult = e => {
    const raw = e.results[e.results.length - 1][0].transcript.trim();
    let cmd;
    if (lang === 'ar-SY') {
      cmd = normaliseArabic(raw);
      if (!cmd) return;
      log(`Voice [AR]: "${raw}" → "${cmd}"`, 'info');
    } else {
      cmd = raw.toLowerCase();
      log(`Voice [EN]: "${cmd}"`, 'info');
    }
    handleVoiceCommand(cmd);
  };

  r.onerror = e => {
    if (e.error !== 'no-speech' && e.error !== 'aborted')
      log(`Voice [${lang}] error: ${e.error}`, 'warn');
  };

  // Auto-restart on end (only if still active)
  r.onend = () => {
    if (voiceState.active) try { r.start(); } catch(_) {}
  };

  return r;
}

export function initVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    log('Speech Recognition: not supported', 'warn');
    setBadge('badgeVoice', 'VOICE: N/A', 'idle');
    return;
  }
  voiceState.recognition   = makeRecognizer('en-US');
  voiceState.recognitionAR = makeRecognizer('ar-SY');
  log('Voice: en-US + ar-SY recognizers ready', 'ok');
}

export function toggleVoice(/* callbacks injected by app.js */) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Speech recognition not available.\nUse Chrome on Android for best results.');
    return;
  }
  if (!voiceState.recognition) initVoiceRecognition();
  voiceState.active = !voiceState.active;
  const btn = document.getElementById('voiceBtn');

  if (voiceState.active) {
    try { voiceState.recognition.start(); } catch(_) {}
    setTimeout(() => {
      try { if (voiceState.recognitionAR) voiceState.recognitionAR.start(); } catch(_) {}
    }, 400);
    if (btn) { btn.textContent = '🎤 EN+AR'; btn.classList.add('btn-on'); }
    setBadge('badgeVoice', 'VOICE: EN+AR', 'ok');
    log('Voice commands: EN + AR active', 'ok');
    speak('Voice commands active.', true);
  } else {
    stopVoice();
  }
}

export function stopVoice() {
  voiceState.active = false;
  try { if (voiceState.recognition)   voiceState.recognition.stop(); }   catch(_) {}
  try { if (voiceState.recognitionAR) voiceState.recognitionAR.stop(); } catch(_) {}
  const btn = document.getElementById('voiceBtn');
  if (btn) { btn.textContent = '🎤 VOICE'; btn.classList.remove('btn-on'); btn.style.color = 'var(--text-dim)'; }
  setBadge('badgeVoice', 'VOICE: OFF', 'idle');
}

// ── Command dispatcher ─────────────────────────────────────────────────────────
// External callbacks wired by app.js to avoid circular imports.
let _onNavigate    = null;   // (query: string) => void
let _onStartRec    = null;
let _onStopRec     = null;

export function setVoiceCallbacks({ onNavigate, onStartRecording, onStopRecording }) {
  _onNavigate = onNavigate;
  _onStartRec = onStartRecording;
  _onStopRec  = onStopRecording;
}

function handleVoiceCommand(t) {
  // Navigate to [destination]
  const navMatch = t.match(/(?:navigate|go|take me)\s+to\s+(.+)/);
  if (navMatch) { if (_onNavigate) _onNavigate(navMatch[1].trim()); return; }

  if (t.includes('drop pin') || t.includes('mark') || t.includes('pin')) {
    openPOIPicker(sensors.gps.lng, sensors.gps.lat, null, 'pothole');
    return;
  }
  if (t.includes('annotate') || t.includes('note') || t.includes('record note')) {
    startAnnotation(); return;
  }
  if (t.includes('zoom in'))  { if (window.__map) window.__map.zoomIn();  return; }
  if (t.includes('zoom out')) { if (window.__map) window.__map.zoomOut(); return; }
  if (t.includes('follow') || t.includes('center')) {
    // Re-enable camera follow
    if (window.__mapState) window.__mapState.cameraFollow = true;
    const cb = document.getElementById('camToggleBtn');
    if (cb) { cb.textContent = '🎥 FOLLOW'; cb.style.color = 'var(--accent)'; }
    return;
  }
  if (t.includes('start recording')) { if (_onStartRec && !session.active) _onStartRec(); return; }
  if (t.includes('stop recording'))  { if (_onStopRec  &&  session.active) _onStopRec();  return; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VOICE ANNOTATIONS
// ─────────────────────────────────────────────────────────────────────────────

export function startAnnotation() {
  if (voiceState.annotationActive || !session.active) return;
  if (!navigator.mediaDevices?.getUserMedia) { log('Microphone not available', 'warn'); return; }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    voiceState.annotationRecorder = new MediaRecorder(stream);
    const chunks = [];
    voiceState.annotationRecorder.ondataavailable = e => chunks.push(e.data);
    voiceState.annotationRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const url  = URL.createObjectURL(blob);
      const ann  = { ts: new Date().toISOString(), lat: sensors.gps.lat, lng: sensors.gps.lng, blobUrl: url };
      voiceState.annotations.push(ann);
      stream.getTracks().forEach(t => t.stop());
      const ab = document.getElementById('annotateBtn');
      if (ab) { ab.textContent = '🎙 HOLD NOTE'; ab.classList.remove('btn-rec'); }
      log(`Annotation saved at ${ann.lat.toFixed(4)}°N`, 'ok');
    };
    voiceState.annotationRecorder.start();
    voiceState.annotationActive = true;
    const ab = document.getElementById('annotateBtn');
    if (ab) { ab.textContent = '🎙 RECORDING…'; ab.classList.add('btn-rec'); }
    haptic(50);
  }).catch(e => log('Mic error: ' + e.message, 'err'));
}

export function stopAnnotation() {
  if (!voiceState.annotationActive || !voiceState.annotationRecorder) return;
  voiceState.annotationActive = false;
  voiceState.annotationRecorder.stop();
  voiceState.annotationRecorder = null;
}

export function renderAnnotationList() {
  const panel = document.getElementById('annotationsPanel'); if (!panel) return;
  const list  = document.getElementById('annList');
  const count = document.getElementById('annCount');
  panel.style.display = 'block';
  if (count) count.textContent = voiceState.annotations.length;
  if (!list) return;

  list.innerHTML = voiceState.annotations.map((a, i) => `
    <div class="ann-item">
      <button class="ann-play" data-ann-idx="${i}">▶</button>
      <audio id="ann-audio-${i}" src="${a.blobUrl}" style="display:none"></audio>
      <div class="ann-info">
        <div class="ai-time">${new Date(a.ts).toLocaleTimeString()}</div>
        <div class="ai-coords">${a.lat.toFixed(5)}°N, ${a.lng.toFixed(5)}°E</div>
      </div>
    </div>`).join('');
}
