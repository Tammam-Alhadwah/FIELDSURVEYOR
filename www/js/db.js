// ── FIELDSURVEYOR ── db.js ─────────────────────────────────────────────────────
// IndexedDB wrapper. Two object stores:
//   sessions — full CSV data rows + annotations + POIs + compressed track
//   audio    — base64-encoded webm clips keyed by audioId

const DB_NAME = 'fieldsurveyor_V4';
const DB_VER  = 1;

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sessions'))
        db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio'))
        db.createObjectStore('audio', { keyPath: 'id' });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// ── Sessions ───────────────────────────────────────────────────────────────────
export async function saveSession(obj) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(obj);
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

export async function listSessions() {
  const db = await open();
  return new Promise((res, rej) => {
    const tx  = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').getAll();
    req.onsuccess = e => {
      // Return metadata only — skip the heavy data array for the list
      const list = (e.target.result || [])
        .sort((a, b) => b.id.localeCompare(a.id))
        .map(s => ({ id: s.id, stats: s.stats }));
      res(list);
    };
    req.onerror = e => rej(e.target.error);
  });
}

export async function getSession(id) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx  = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = e => res(e.target.result ?? null);
    req.onerror   = e => rej(e.target.error);
  });
}

export async function deleteSession(id) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(['sessions', 'audio'], 'readwrite');
    tx.objectStore('sessions').delete(id);
    // Delete all audio clips belonging to this session
    const cursor = tx.objectStore('audio').openCursor();
    cursor.onsuccess = e => {
      const c = e.target.result;
      if (!c) return;
      if (c.value.sessionId === id) c.delete();
      c.continue();
    };
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

// ── Audio ──────────────────────────────────────────────────────────────────────
export async function saveAudio(id, sessionId, dataUrl) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction('audio', 'readwrite');
    tx.objectStore('audio').put({ id, sessionId, dataUrl });
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

export async function getAudio(id) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx  = db.transaction('audio', 'readonly');
    const req = tx.objectStore('audio').get(id);
    req.onsuccess = e => res(e.target.result?.dataUrl ?? null);
    req.onerror   = e => rej(e.target.error);
  });
}
