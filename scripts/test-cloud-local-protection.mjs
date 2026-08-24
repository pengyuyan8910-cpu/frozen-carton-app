import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('async function cloudProtectCurrentPage()');
const end = source.indexOf('function cloudSaveFailure', start);
assert.ok(start >= 0 && end > start, '应存在云端保存前的本机保护函数');

const functionSource = source.slice(start, end);
const getProtect = Function(
  '保存',
  '删除本地值',
  '写入本地值',
  '等待本地持久化',
  'CLOUD_ROLLBACK_KEY',
  '数据签名',
  '统一状态保存键',
  `${functionSource}; return cloudProtectCurrentPage;`
);

const primary = { key: '', value: '' };
let oldRollbackPresentDuringSave = null;
const storage = {
  removeItem(key) { delete this[key]; },
  setItem(key, value) {
    if (key === 'frozen_carton_cloud_rollback_v1' && this.failRollback) throw new Error('QuotaExceededError');
    if (key === 'frozen_carton_unified_scene_state_v2') primary.value = String(value);
    this[key] = String(value);
  },
  failRollback: false,
};
storage.frozen_carton_cloud_rollback_v1 = JSON.stringify({ state: 'old-full-copy' });
const protect = getProtect(
  () => {
    oldRollbackPresentDuringSave = Object.hasOwn(storage, 'frozen_carton_cloud_rollback_v1');
    storage.setItem('frozen_carton_unified_scene_state_v2', '{"local":true}');
    return true;
  },
  key => storage.removeItem(key),
  (key, value) => storage.setItem(key, JSON.stringify(value)),
  async () => true,
  'frozen_carton_cloud_rollback_v1',
  'test-signature',
  'frozen_carton_unified_scene_state_v2',
);

assert.equal(await protect(), true, '本机主状态保存成功时，云端保护不应因重复回退副本失败');
assert.equal(oldRollbackPresentDuringSave, false, '主状态保存前应清理旧版完整回退副本');
assert.equal(JSON.parse(storage.frozen_carton_cloud_rollback_v1).storageKey, 'frozen_carton_unified_scene_state_v2', '回退记录应只引用主状态，不重复保存完整状态');
assert.equal(Object.hasOwn(JSON.parse(storage.frozen_carton_cloud_rollback_v1), 'state'), false, '回退记录不得再写入完整状态副本');

storage.failRollback = true;
const originalWarn = console.warn;
console.warn = () => {};
try {
  assert.equal(await protect(), true, '回退标记写入失败时，已成功保存的本机主状态仍应保护当前页面');
} finally {
  console.warn = originalWarn;
}
assert.ok(primary.value, '测试必须确认本机主状态确实已写入');

console.log('云端本机保护回归测试通过');
