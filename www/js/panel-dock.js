// ── FIELDSURVEYOR ── panel-dock.js ────────────────────────────────────────────
// Draggable, snappable, collapsible side panel.
//
// Key design decision: collapse is done with max-width → 0 (not transform).
// This actually removes the flex space so #map-wrapper expands into it.
// transform-only moves pixels on screen but the flex item still occupies its
// slot — the map has nowhere to grow. max-width collapses the slot itself.
//
// Usage: import { initPanelDock } from './panel-dock.js';
//        call initPanelDock() once after map has loaded.

import { mapState } from './state.js';
import { log }      from './utils.js';

const SNAP_THRESHOLD = 0.40;  // outer 40% of viewport triggers snap
const FLICK_VEL      = 0.45;  // px/ms — faster than this collapses the panel
const ANIM_MS        = 300;

let panel      = null;
let handle     = null;
let tab        = null;
let snapOverlay= null;

let side      = 'right';
let collapsed = false;

let dragging          = false;
let pointerOffset     = 0;
let panelWidthAtStart = 0;
let lastX = 0, lastT = 0, velX = 0;

// ── Public ────────────────────────────────────────────────────────────────────
export function initPanelDock() {
  panel = document.querySelector('.scroll-panel');
  if (!panel) { console.warn('panel-dock: .scroll-panel not found'); return; }

  injectCSS();
  buildHandle();
  buildSnapOverlay();
  buildTab();

  document.body.classList.add('pd-side-right');
  log('Panel dock ready — drag grip to snap, flick to collapse', 'ok');
}

// ── Handle ────────────────────────────────────────────────────────────────────
function buildHandle() {
  handle = document.createElement('div');
  handle.id = 'pd-handle';
  handle.innerHTML =
    '<div id="pd-grip">' +
      '<svg width="22" height="14" viewBox="0 0 22 14" fill="none">' +
        '<rect y="0"  width="22" height="2" rx="1" fill="currentColor"/>' +
        '<rect y="6"  width="22" height="2" rx="1" fill="currentColor"/>' +
        '<rect y="12" width="22" height="2" rx="1" fill="currentColor"/>' +
      '</svg>' +
    '</div>' +
    '<span id="pd-label">DRAG TO SNAP</span>' +
    '<button id="pd-close" title="Collapse panel" aria-label="Collapse panel">' +
      '<svg width="9" height="14" viewBox="0 0 9 14">' +
        '<path id="pd-close-arrow" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
      '</svg>' +
    '</button>';

  panel.insertBefore(handle, panel.firstChild);

  handle.addEventListener('mousedown', e => {
    if (e.target.closest('#pd-close')) return;
    e.preventDefault();
    startDrag(e.clientX);
  });
  handle.addEventListener('touchstart', e => {
    if (e.target.closest('#pd-close')) return;
    e.preventDefault();
    startDrag(e.touches[0].clientX);
  }, { passive: false });

  document.addEventListener('mousemove',  e => moveDrag(e.clientX));
  document.addEventListener('touchmove',  e => moveDrag(e.touches[0].clientX), { passive: true });
  document.addEventListener('mouseup',    endDrag);
  document.addEventListener('touchend',   endDrag);

  document.getElementById('pd-close').addEventListener('click', collapsePanel);
  updateCloseArrow();
}

// ── Snap overlay ──────────────────────────────────────────────────────────────
function buildSnapOverlay() {
  snapOverlay = document.createElement('div');
  snapOverlay.id = 'pd-snap-overlay';
  snapOverlay.innerHTML =
    '<div class="pd-zone" id="pd-zone-left"><span>SNAP LEFT</span></div>' +
    '<div class="pd-zone" id="pd-zone-right"><span>SNAP RIGHT</span></div>';
  document.body.appendChild(snapOverlay);
}

// ── Reopen tab ────────────────────────────────────────────────────────────────
function buildTab() {
  tab = document.createElement('button');
  tab.id = 'pd-tab';
  tab.setAttribute('aria-label', 'Open panel');
  tab.innerHTML =
    '<svg width="9" height="14" viewBox="0 0 9 14">' +
      '<path id="pd-tab-arrow" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
    '</svg>';
  document.body.appendChild(tab);
  tab.addEventListener('click', restorePanel);
  updateTabArrow();
}

// ── Drag ──────────────────────────────────────────────────────────────────────
function startDrag(clientX) {
  if (collapsed) return;
  dragging = true;
  lastX    = clientX;
  lastT    = Date.now();
  velX     = 0;

  const r           = panel.getBoundingClientRect();
  pointerOffset     = clientX - r.left;
  panelWidthAtStart = r.width;

  // Lift out of flex so it can move freely across the screen
  panel.style.cssText =
    'position:fixed !important;' +
    'top:'      + r.top    + 'px !important;' +
    'left:'     + r.left   + 'px !important;' +
    'width:'    + r.width  + 'px !important;' +
    'height:'   + r.height + 'px !important;' +
    'max-width:none !important;' +
    'z-index:9000 !important;' +
    'overflow-y:scroll !important;' +
    'transition:none !important;';

  document.body.classList.add('pd-dragging');
  snapOverlay.classList.add('pd-overlay-on');

  // Show placeholder gap so map doesn't jump
  const ghost = document.getElementById('pd-ghost');
  if (ghost) { ghost.style.display = 'block'; ghost.style.width = panelWidthAtStart + 'px'; }
}

function moveDrag(clientX) {
  if (!dragging) return;

  const now = Date.now();
  const dt  = now - lastT;
  if (dt > 0) velX = (clientX - lastX) / dt;
  lastX = clientX; lastT = now;

  panel.style.left = (clientX - pointerOffset) + 'px';

  // Fade as it goes off-edge
  const W      = window.innerWidth;
  const panL   = clientX - pointerOffset;
  const panR   = panL + panelWidthAtStart;
  const offL   = Math.max(0, -panL);
  const offR   = Math.max(0, panR - W);
  const maxOff = panelWidthAtStart * 0.55;
  panel.style.opacity = Math.max(0.12, 1 - Math.max(offL, offR) / maxOff).toFixed(2);

  // Snap zone hints
  const cx = panL + panelWidthAtStart / 2;
  document.getElementById('pd-zone-left') .classList.toggle('pd-zone-hot', cx < W * SNAP_THRESHOLD);
  document.getElementById('pd-zone-right').classList.toggle('pd-zone-hot', cx > W * (1 - SNAP_THRESHOLD));
}

function endDrag() {
  if (!dragging) return;
  dragging = false;

  document.body.classList.remove('pd-dragging');
  snapOverlay.classList.remove('pd-overlay-on');
  document.getElementById('pd-zone-left') .classList.remove('pd-zone-hot');
  document.getElementById('pd-zone-right').classList.remove('pd-zone-hot');

  const ghost = document.getElementById('pd-ghost');
  if (ghost) ghost.style.display = 'none';

  const finalLeft   = parseFloat(panel.style.left) || 0;
  const panelCenter = finalLeft + panelWidthAtStart / 2;
  const W           = window.innerWidth;

  // Reset all inline styles — CSS transitions re-engage
  panel.style.cssText = '';
  panel.style.opacity = '';

  // Flick collapses
  if ((velX >  FLICK_VEL && side === 'right') ||
      (velX < -FLICK_VEL && side === 'left'))  { collapsePanel(); return; }

  // Snap if center crossed zone boundary
  if (panelCenter < W * SNAP_THRESHOLD && side !== 'left')         snapTo('left');
  else if (panelCenter > W * (1 - SNAP_THRESHOLD) && side !== 'right') snapTo('right');
}

// ── Snap ──────────────────────────────────────────────────────────────────────
function snapTo(newSide) {
  side = newSide;
  document.body.classList.remove('pd-side-left', 'pd-side-right');
  document.body.classList.add('pd-side-' + newSide);

  const label = document.getElementById('pd-label');
  if (label) label.textContent = newSide.toUpperCase();

  updateCloseArrow();
  updateTabArrow();
  notifyResize();
  log('Panel snapped: ' + newSide.toUpperCase(), 'ok');
}

// ── Collapse / restore ────────────────────────────────────────────────────────
function collapsePanel() {
  collapsed = true;
  panel.classList.add('pd-collapsed');
  tab.classList.remove('pd-tab-on-left', 'pd-tab-on-right');
  tab.classList.add(side === 'right' ? 'pd-tab-on-right' : 'pd-tab-on-left');
  tab.classList.add('pd-tab-show');
  notifyResize();
  log('Panel collapsed', 'ok');
}

function restorePanel() {
  collapsed = false;
  panel.classList.remove('pd-collapsed');
  tab.classList.remove('pd-tab-show');
  notifyResize();
  log('Panel restored', 'ok');
}

// ── Arrows ────────────────────────────────────────────────────────────────────
function updateCloseArrow() {
  const el = document.getElementById('pd-close-arrow');
  if (!el) return;
  // Points toward the edge the panel lives on (collapse that way)
  el.setAttribute('d', side === 'right' ? 'M2 1L7 7L2 13' : 'M7 1L2 7L7 13');
}

function updateTabArrow() {
  const el = document.getElementById('pd-tab-arrow');
  if (!el) return;
  // Points inward — toward the map — meaning "open this panel"
  el.setAttribute('d', side === 'right' ? 'M7 1L2 7L7 13' : 'M2 1L7 7L2 13');
}

// ── Map resize ────────────────────────────────────────────────────────────────
function notifyResize() {
  setTimeout(() => {
    if (mapState?.map && mapState.loaded) mapState.map.resize();
  }, ANIM_MS + 50);
}

// ── CSS ───────────────────────────────────────────────────────────────────────
function injectCSS() {
  // Ghost div sits in the flex layout as a placeholder during drag
  const ghost = document.createElement('div');
  ghost.id = 'pd-ghost';
  document.body.appendChild(ghost);

  const s = document.createElement('style');
  s.id = 'pd-styles';
  s.textContent = `

/* Layout direction ---------------------------------------------------------- */
body.pd-side-right { flex-direction: row         !important; }
body.pd-side-left  { flex-direction: row-reverse !important; }

/* Panel collapse via max-width so the flex slot actually shrinks ------------- */
.scroll-panel {
  max-width: 480px;
  overflow-x: hidden;
  transition:
    max-width ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1),
    opacity   ${ANIM_MS}ms ease,
    padding   ${ANIM_MS}ms ease !important;
}
.scroll-panel.pd-collapsed {
  max-width:      0 !important;
  padding-left:   0 !important;
  padding-right:  0 !important;
  opacity:        0 !important;
  pointer-events: none;
  overflow:       hidden !important;
}

/* Ghost placeholder ---------------------------------------------------------- */
#pd-ghost {
  display: none;
  flex-shrink: 0;
  background: transparent;
  border-left: 2px dashed var(--accent-dim);
  opacity: 0.35;
  pointer-events: none;
}
body.pd-side-left #pd-ghost {
  border-left: none;
  border-right: 2px dashed var(--accent-dim);
}

/* Drag handle ---------------------------------------------------------------- */
#pd-handle {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 10px 0 12px;
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 100;
  transition: background 0.15s;
}
#pd-handle:hover          { background: rgba(57,255,132,0.07); }
body.pd-dragging #pd-handle { cursor: grabbing; background: rgba(57,255,132,0.12); }
#pd-grip { color: var(--text-dim); opacity: 0.55; display: flex; transition: opacity 0.15s; }
#pd-grip:hover { opacity: 1; }
#pd-label {
  flex: 1;
  font-family: var(--display);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .22em;
  color: var(--accent-dim);
  text-align: center;
  pointer-events: none;
}
#pd-close {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  line-height: 0;
  transition: color 0.15s, background 0.15s;
}
#pd-close:hover { color: var(--accent); background: rgba(57,255,132,0.09); }

/* Snap zone overlay ---------------------------------------------------------- */
#pd-snap-overlay {
  position: fixed;
  inset: 0;
  z-index: 8500;
  display: flex;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s;
}
#pd-snap-overlay.pd-overlay-on { opacity: 1; }
.pd-zone {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed transparent;
  transition: background 0.15s, border-color 0.15s;
}
.pd-zone span {
  font-family: var(--display);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .25em;
  color: transparent;
  transition: color 0.15s;
}
.pd-zone.pd-zone-hot {
  background: rgba(57,255,132,0.05);
  border-color: var(--accent-dim);
}
.pd-zone.pd-zone-hot span { color: var(--accent); }

/* Reopen tab ----------------------------------------------------------------- */
#pd-tab {
  position: fixed;
  top: 50%;
  z-index: 8000;
  width: 26px;
  height: 60px;
  background: var(--surface2);
  border: 1px solid var(--accent-dim);
  color: var(--accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  opacity: 0;
  pointer-events: none;
  transition: transform ${ANIM_MS}ms cubic-bezier(0.34,1.56,0.64,1), opacity ${ANIM_MS}ms ease;
}
#pd-tab.pd-tab-on-right {
  right: 0;
  border-right: none;
  border-radius: 6px 0 0 6px;
  transform: translateY(-50%) translateX(100%);
}
#pd-tab.pd-tab-on-left {
  left: 0;
  border-left: none;
  border-radius: 0 6px 6px 0;
  transform: translateY(-50%) translateX(-100%);
}
#pd-tab.pd-tab-show {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(-50%) translateX(0) !important;
}
#pd-tab:hover { background: rgba(57,255,132,0.12); }

/* Body cursor during drag ---------------------------------------------------- */
body.pd-dragging, body.pd-dragging * { cursor: grabbing !important; }

/* Portrait: hide drag controls (snap is landscape-only) ---------------------- */
@media (orientation: portrait) {
  #pd-handle { display: none; }
  #pd-snap-overlay { display: none; }
}

`.replace(/\${ANIM_MS}/g, ANIM_MS);

  document.head.appendChild(s);
}
