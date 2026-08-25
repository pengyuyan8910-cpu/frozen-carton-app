import assert from "node:assert/strict";

const records = new Map([["main", { stores: 32, note: "旧正式底表" }]]);
let blockWrites = true;

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
        objectStoreNames: { contains: () => true },
        transaction() {
          return {
            objectStore() {
              return {
                get: key => request(() => records.get(key)),
                put: (value, key) => {
                  if (blockWrites) return { never: true };
                  return request(() => {
                    records.set(key, structuredClone(value));
                    return key;
                  });
                },
                delete: key => request(() => records.delete(key)),
              };
            },
          };
        },
      };
      result.result = db;
      result.onsuccess?.({ target: result });
    });
    return result;
  },
};

const legacy = new Map();
const storage = {
  getItem: key => legacy.get(key) ?? null,
  removeItem: key => legacy.delete(key),
  setItem: (key, value) => legacy.set(key, String(value)),
};

const { createLocalStateStore } = await import("./local-state-store.mjs");
const first = createLocalStateStore({ indexedDB: fakeIndexedDB, storage });
await first.preload(["main"]);
first.queueSet("main", { stores: 35, note: "六安陈列已完成" });

const reloaded = createLocalStateStore({ indexedDB: fakeIndexedDB, storage });
await reloaded.preload(["main"]);
assert.deepEqual(
  reloaded.getSync("main"),
  { stores: 35, note: "六安陈列已完成" },
  "IndexedDB 尚未完成异步写入时，刷新也必须读到最新本地状态",
);

console.log("durable local save regression passed");
