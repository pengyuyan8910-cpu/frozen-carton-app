import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stores = new Map();
const legacy = new Map([['main', JSON.stringify({ version: 1, stores: ['三山星悦广场生活馆'] })]]);

function request(run) {
  const result = {};
  queueMicrotask(() => {
    try {
      result.result = run();
      result.onsuccess?.({ target: result });
    } catch (error) {
      result.error = error;
      result.onerror?.({ target: result });
    }
  });
  return result;
}

const fakeIndexedDB = {
  open() {
    const result = {};
    queueMicrotask(() => {
      const db = {
        objectStoreNames: { contains: name => stores.has(`__store__${name}`) },
        createObjectStore(name) {
          stores.set(`__store__${name}`, true);
          return {};
        },
        transaction() {
          return {
            objectStore() {
              return {
                get: key => request(() => stores.get(key)),
                put: (value, key) => request(() => { stores.set(key, structuredClone(value)); return key; }),
                delete: key => request(() => { stores.delete(key); }),
              };
            },
          };
        },
      };
      result.result = db;
      result.onupgradeneeded?.({ target: result });
      result.onsuccess?.({ target: result });
    });
    return result;
  },
};

const storage = {
  getItem(key) { return legacy.has(key) ? legacy.get(key) : null; },
  removeItem(key) { legacy.delete(key); },
  setItem(key, value) { legacy.set(key, String(value)); },
};

const { createLocalStateStore } = await import('./local-state-store.mjs');
const first = createLocalStateStore({ indexedDB: fakeIndexedDB, storage });
await first.preload(['main']);
assert.deepEqual(first.getSync('main'), { version: 1, stores: ['三山星悦广场生活馆'] });
assert.equal(storage.getItem('main'), null, '只有 IndexedDB 写入成功后才清理旧 localStorage 数据');

first.queueSet('main', { version: 2, stores: ['三山星悦广场生活馆'], skuCount: 67 });
await first.flush();

const second = createLocalStateStore({ indexedDB: fakeIndexedDB, storage });
await second.preload(['main']);
assert.deepEqual(second.getSync('main'), { version: 2, stores: ['三山星悦广场生活馆'], skuCount: 67 });
assert.equal(second.getSync('main').skuCount, 67, '刷新后必须读回最新 IndexedDB 状态');

const failedLegacy = new Map([['keep', JSON.stringify({ safe: true })]]);
const failingIndexedDB = {
  open() {
    const result = {};
    queueMicrotask(() => result.onerror?.({ target: { error: new Error('blocked') } }));
    return result;
  },
};
const fallbackStorage = {
  getItem(key) { return failedLegacy.has(key) ? failedLegacy.get(key) : null; },
  removeItem(key) { failedLegacy.delete(key); },
  setItem(key, value) { failedLegacy.set(key, String(value)); },
};
const fallback = createLocalStateStore({ indexedDB: failingIndexedDB, storage: fallbackStorage });
await fallback.preload(['keep']);
assert.deepEqual(fallback.getSync('keep'), { safe: true });
assert.equal(fallbackStorage.getItem('keep'), JSON.stringify({ safe: true }), 'IndexedDB 不可用时不得先删除旧 localStorage 数据');

console.log('indexeddb local state migration passed');

const root = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(root, '..', 'app.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, '..', 'bootstrap.js'), 'utf8');
assert.match(bootstrapSource, /local-state-store\.mjs/, 'bootstrap 必须在 app.js 前加载 IndexedDB 本地存储模块');
assert.match(bootstrapSource, /preload\(/, 'bootstrap 必须预加载本地状态，保证 app.js 同步初始化时能读取');
assert.match(appSource, /FrozenCartonLocalStore\?\.getSync/, '应用状态读取必须优先使用 IndexedDB 同步缓存');
assert.match(appSource, /FrozenCartonLocalStore\?\.queueSet/, '应用状态保存必须进入 IndexedDB 写入队列');
assert.match(appSource, /FrozenCartonLocalStore\?\.flush/, '云端保存前必须等待 IndexedDB 写入完成');

console.log('indexeddb app integration contract passed');
