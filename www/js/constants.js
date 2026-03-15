// ── FIELDSURVEYOR ── constants.js ──────────────────────────────────────────────
// All tuneable constants in one place.

export const SESSION_KEY            = 'fieldsurveyor_v1';
export const HISTORY_KEY            = 'fieldsurveyor_history';

export const BUMP_THRESHOLD_RAW     = 18;   // m/s² — raw accel incl. gravity
export const BUMP_THRESHOLD_CLEAN   = 8;    // m/s² — gravity-free linear accel
export const MAX_ROUTE_DISPLAY      = 600;  // max segments kept in live map layer
export const MAX_HISTORY_SESSIONS   = 10;   // sessions stored in localStorage

export const POTHOLE_ALERT_RADIUS_KM  = 0.08;   // 80 m look-ahead radius
export const POTHOLE_ALERT_COOLDOWN   = 15000;  // ms between pothole alerts
export const GPS_TIMEOUT_WARN         = 30000;  // ms — warn if no GPS update

export const DEFAULT_CENTER = [36.57, 32.71]; // As-Suwayda, Syria
export const DEFAULT_ZOOM   = 16;

export const STORAGE_WARN_BYTES = 4 * 1024 * 1024; // 4 MB — trim history early
