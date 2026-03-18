// ── FIELDSURVEYOR ── voice.js ──────────────────────────────────────────────────
// Hold-to-record voice annotations.
// Each clip is saved to IndexedDB as a base64 data-URL (persists across reloads).
// A temporary blob URL is also kept in voiceState for immediate in-session playback.

import { sensors, voiceState, session } from './state.js';
import { log, haptic }                  from './utils.js';
import { saveAudio }                    from './db.js';

// ── Start (mousedown / touchstart on annotateBtn) ──────────────────────────────
export function startAnnotation() {
  if (voiceState.annotationActive || !session.active) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    log('Microphone not available', 'warn');
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      voiceState.annotationRecorder = new MediaRecorder(stream);
      const chunks = [];

      voiceState.annotationRecorder.ondataavailable = e => chunks.push(e.data);

      voiceState.annotationRecorder.onstop = () => {
        const blob    = new Blob(chunks, { type: 'audio/webm' });
        const blobUrl = URL.createObjectURL(blob);   // ephemeral — for this session only
        const audioId = `ann_${session.startTime}_${voiceState.annotations.length}`;

        // Persist to IndexedDB as base64
        const reader = new FileReader();
        reader.onloadend = () => {
          saveAudio(audioId, String(session.startTime), reader.result)
            .catch(e => log('Audio save failed: ' + e.message, 'warn'));
        };
        reader.readAsDataURL(blob);

        const ann = {
          ts:      new Date().toISOString(),
          lat:     sensors.gps.lat,
          lng:     sensors.gps.lng,
          audioId,
          blobUrl,  // valid until page unload
        };
        voiceState.annotations.push(ann);
        stream.getTracks().forEach(t => t.stop());

        const ab = document.getElementById('annotateBtn');
        if (ab) { ab.textContent = '🎙 HOLD NOTE'; ab.classList.remove('btn-rec'); }
        log(`Annotation ${voiceState.annotations.length} saved — ${ann.lat.toFixed(4)}°N`, 'ok');
      };

      voiceState.annotationRecorder.start();
      voiceState.annotationActive = true;

      const ab = document.getElementById('annotateBtn');
      if (ab) { ab.textContent = '🎙 RECORDING…'; ab.classList.add('btn-rec'); }
      haptic(50);
    })
    .catch(e => log('Mic error: ' + e.message, 'err'));
}

// ── Stop (mouseup / touchend) ──────────────────────────────────────────────────
export function stopAnnotation() {
  if (!voiceState.annotationActive || !voiceState.annotationRecorder) return;
  voiceState.annotationActive = false;
  voiceState.annotationRecorder.stop();
  voiceState.annotationRecorder = null;
}

// ── Render annotation list (shown after session stops) ────────────────────────
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
        <div class="ai-time" style="color:var(--text-dim);font-size:9px">${a.audioId}</div>
      </div>
    </div>`).join('');
}
