// ── FIELDSURVEYOR ── state.js ──────────────────────────────────────────────────
// Single source of truth for all mutable state.
// Import the relevant object in each module — never copy values out.

// ── Sensor readings ────────────────────────────────────────────────────────────
export const sensors = {
  gps:      { lat: 0, lng: 0, alt: null, speed: 0, heading: null, acc: null, altAcc: null },
  accel:    { x: 0,    y: 0,    z: 0    },
  gyro:     { x: 0,    y: 0,    z: 0    },
  orient:   { alpha: 0, beta: 0, gamma: 0 },
  linAccel: { x: null, y: null, z: null },
  mag:      { x: null, y: null, z: null },
  abs:      { w: null, x: null, y: null, z: null },
  gravZ:    null,
  battery:  { level: null, charging: null },
  network:  { type: null, effType: null, downlink: null, rtt: null },
};

// ── Active recording session ────────────────────────────────────────────────────
export const session = {
  active:                false,
  data:                  [],
  startTime:             0,
  distKm:                0,
  bumpCount:             0,
  maxSpeed:              0,
  magBuffer:             [],
  usingGravityFreeAccel: false,
  tripSpeedSamples:      [],
  tripIRISamples:        [],
  prevLat:               0,
  prevLng:               0,
  prevRoutePoint:        null,
  wakeLock:              null,
  geoWatchId:            null,
  recordingInterval:     null,
  lastGpsTime:           0,
};

// ── Live sensitivity settings ──────────────────────────────────────────────────
export const settings = {
  preset:             'medium',
  bumpThresholdClean: 8,   // m/s² gravity-free — updated by preset buttons
  bumpThresholdRaw:   18,  // m/s² raw+gravity
};

// ── Map / GeoJSON state ────────────────────────────────────────────────────────
export const mapState = {
  map:             null,
  loaded:          false,
  cameraFollow:    true,
  historyVisible:  false,
  coverageVisible: false,
  dashboardActive: false,
  geojsonRoute:    { type: 'FeatureCollection', features: [] },
  geojsonBumps:    { type: 'FeatureCollection', features: [] },
  geojsonCar:      { type: 'Feature', geometry: { type: 'Point', coordinates: [36.57, 32.71] } },
  geojsonHistory:  { type: 'FeatureCollection', features: [] },
  geojsonCoverage: { type: 'FeatureCollection', features: [] },
  geojsonPOIs:     { type: 'FeatureCollection', features: [] },
  geojsonDest:     { type: 'FeatureCollection', features: [] },
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

// ── Voice annotations ──────────────────────────────────────────────────────────
export const voiceState = {
  annotationRecorder: null,
  annotationActive:   false,
  annotations:        [],   // { ts, lat, lng, audioId, blobUrl }
};

// ── Pothole ahead alerts ────────────────────────────────────────────────────────
export const potholeState = {
  bumpIndex: [],
  lastAlert: 0,
};

// ── Generic Sensor API instances (for teardown) ─────────────────────────────────
export const genericSensorInstances = [];
