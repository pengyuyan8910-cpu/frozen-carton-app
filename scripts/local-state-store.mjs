const DEFAULT_DB_NAME = 'frozen-carton-local-state-v1';
const OBJECT_STORE = 'records';
const MIRROR_MARKER = '__frozenCartonLocalMirror_v1';

const clone = value => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function parseLegacy(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return clone(value);
  try { return JSON.parse(value); } catch (_) { return value; }
}

function parseMirror(value) {
  const parsed = parseLegacy(value);
  if (!parsed || typeof parsed !== 'object' || parsed[MIRROR_MARKER] !== true) return null;
  return parsed.deleted ? { deleted: true } : { value: clone(parsed.value) };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error || new Error('IndexedDB request failed'));
  });
}

export function createLocalStateStore({ indexedDB: indexedDBApi = globalThis.indexedDB, storage = globalThis.localStorage, dbName = DEFAULT_DB_NAME } = {}) {
  const sync = new Map();
  let dbPromise = null;
  let indexedDBDisabled = !indexedDBApi;
  let pending = Promise.resolve();
  let lastError = null;

  const warn = error => {
    if (typeof window !== 'undefined') {
      window.__storageWarnings = (window.__storageWarnings || []).concat(String(error?.message || error));
    }
  };

  const writeMirror = (key, value) => {
    try {
      storage?.setItem?.(key, JSON.stringify({ [MIRROR_MARKER]: true, value: clone(value) }));
      return true;
    } catch (error) {
      warn(error);
      return false;
    }
  };

  const writeDeleteMirror = key => {
    try {
      storage?.setItem?.(key, JSON.stringify({ [MIRROR_MARKER]: true, deleted: true }));
      return true;
    } catch (error) {
      warn(error);
      return false;
    }
  };

  function openDb() {
    if (indexedDBDisabled) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let request;
      try { request = indexedDBApi.open(dbName, 1); } catch (error) { reject(error); return; }
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE);
      };
      request.onsuccess = event => resolve(event.target.result);
      request.onerror = event => reject(event.target.error || new Error('IndexedDB open failed'));
    }).catch(error => {
      indexedDBDisabled = true;
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  async function readDb(key) {
    const db = await openDb();
    return requestResult(db.transaction(OBJECT_STORE, 'readonly').objectStore(OBJECT_STORE).get(key));
  }

  async function writeDb(key, value) {
    const db = await openDb();
    await requestResult(db.transaction(OBJECT_STORE, 'readwrite').objectStore(OBJECT_STORE).put(clone(value), key));
  }

  async function deleteDb(key) {
    const db = await openDb();
    await requestResult(db.transaction(OBJECT_STORE, 'readwrite').objectStore(OBJECT_STORE).delete(key));
  }

  async function migrateKey(key) {
    let stored;
    try { stored = await readDb(key); } catch (error) {
      indexedDBDisabled = true;
      warn(error);
      stored = undefined;
    }
    let legacyValue = null;
    try { legacyValue = storage?.getItem?.(key) ?? null; } catch (error) { warn(error); }
    const mirror = parseMirror(legacyValue);
    if (mirror?.deleted) {
      sync.delete(key);
      return;
    }
    if (mirror) {
      sync.set(key, clone(mirror.value));
      return;
    }
    if (stored !== undefined) {
      sync.set(key, clone(stored));
      return;
    }
    const parsed = parseLegacy(legacyValue);
    if (parsed === undefined) return;
    if (!indexedDBDisabled) {
      try {
        await writeDb(key, parsed);
        sync.set(key, clone(parsed));
        try { storage?.removeItem?.(key); } catch (error) { warn(error); }
        return;
      } catch (error) {
        indexedDBDisabled = true;
        warn(error);
      }
    }
    sync.set(key, clone(parsed));
  }

  async function preload(keys = []) {
    for (const key of keys) await migrateKey(key);
    return new Map(sync);
  }

  function getSync(key) {
    return sync.has(key) ? clone(sync.get(key)) : undefined;
  }

  function queue(operation) {
    pending = pending.catch(() => {}).then(operation).catch(error => {
      lastError = error;
      warn(error);
    });
    return true;
  }

  function queueSet(key, value) {
    const next = clone(value);
    sync.set(key, next);
    writeMirror(key, next);
    return queue(async () => {
      if (indexedDBDisabled) {
        writeMirror(key, next);
        return;
      }
      try { await writeDb(key, next); } catch (error) {
        indexedDBDisabled = true;
        try {
          if (!writeMirror(key, next)) throw error;
        } catch (fallbackError) {
          fallbackError.cause = error;
          throw fallbackError;
        }
      }
    });
  }

  function queueRemove(key) {
    sync.delete(key);
    writeDeleteMirror(key);
    return queue(async () => {
      if (indexedDBDisabled) { writeDeleteMirror(key); return; }
      try { await deleteDb(key); } catch (error) {
        indexedDBDisabled = true;
        try {
          if (!writeDeleteMirror(key)) throw error;
        } catch (fallbackError) {
          fallbackError.cause = error;
          throw fallbackError;
        }
      }
    });
  }

  async function flush() {
    await pending;
    if (lastError) {
      const error = lastError;
      lastError = null;
      throw error;
    }
  }

  return { preload, getSync, queueSet, queueRemove, flush };
}

export const LOCAL_STATE_DB_NAME = DEFAULT_DB_NAME;
export const LOCAL_STATE_OBJECT_STORE = OBJECT_STORE;
