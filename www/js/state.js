// ── FIELDSURVEYOR ── state.js ──────────────────────────────────────────────────
// Single source of truth for all mutable state.
// Import the relevant object in each module — never copy values out.

// ── Sensor readings ────────────────────────────────────────────────────────────
export const sensors = {
  gps: { lat: 0, lng: 0, alt: null, speed: 0, heading: null, acc: null, altAcc: null },
  accel:   { x: 0,    y: 0,    z: 0    },
  gyro:    { x: 0,    y: 0,    z: 0    },
  orient:  { alpha: 0, beta: 0, gamma: 0 },
  linAccel:{ x: null, y: null, z: null },
  mag:     { x: null, y: null, z: null },
  abs:     { w: null, x: null, y: null, z: null },
  gravZ:   null,
  lux:     null,
  battery: { level: null, charging: null },
  network: { type: null, effType: null, downlink: null, rtt: null },
};

// ── Active recording session ────────────────────────────────────────────────────
export const session = {
  active:                false,
  data:                  [],      // CSV row objects
  startTime:             0,
  distKm:                0,
  bumpCount:             0,
  maxSpeed:              0,
  magBuffer:             [],      // mag samples accumulated between ticks
  usingGravityFreeAccel: false,
  tripSpeedSamples:      [],
  tripIRISamples:        [],
  prevLat:               0,
  prevLng:               0,
  prevRoutePoint:        null,    // [lng, lat] of last mapped point
  wakeLock:              null,
  geoWatchId:            null,
  recordingInterval:     null,
  lastGpsTime:           0,       // timestamp of most recent GPS update
};

// ── Map / GeoJSON state ────────────────────────────────────────────────────────
export const mapState = {
  map:             null,   // MapLibre GL instance — set by map.js on init
  loaded:          false,
  cameraFollow:    true,
  historyVisible:  false,
  coverageVisible: false,
  dashboardActive: false,
  // Live GeoJSON datasets updated in place; sources reference these objects
  geojsonRoute:    { type: 'FeatureCollection', features: [] },
  geojsonBumps:    { type: 'FeatureCollection', features: [] },
  geojsonCar:      { type: 'Feature', geometry: { type: 'Point', coordinates: [36.57, 32.71] } },
  geojsonHistory:  { type: 'FeatureCollection', features: [] },
  geojsonCoverage: { type: 'FeatureCollection', features: [] },
  geojsonPOIs:     { type: 'FeatureCollection', features: [] },
  geojsonDest:     { type: 'FeatureCollection', features: [] }, // "Find" destination marker
};

// ── UI toggles ─────────────────────────────────────────────────────────────────
export const uiState = {
  debugMode: false,
};

// ── Session replay ─────────────────────────────────────────────────────────────
export const replayState = {
  data:    [],
  idx:     0,
  timer:   null,
  playing: false,
  speed:   1,
  bumps:   0,
};

// ── POI pins ───────────────────────────────────────────────────────────────────
export const poiState = {
  pois:    [],
  dropLng: 0,
  dropLat: 0,
};

// ── Voice ──────────────────────────────────────────────────────────────────────
export const voiceState = {
  recognition:        null,
  recognitionAR:      null,
  active:             false,
  annotationRecorder: null,
  annotationActive:   false,
  annotations:        [],
};

// ── Pothole ahead alerts ────────────────────────────────────────────────────────
export const potholeState = {
  bumpIndex: [],   // [{lat, lng}] from all history
  lastAlert: 0,
};

// ── Generic Sensor API instances (for teardown) ─────────────────────────────────
export const genericSensorInstances = [];
