import assert from 'node:assert/strict';
import { createCloudBaseline, evaluateCloudPull, shouldInitializeCloud } from './cloud-state-guard.mjs';

const current = { stores: [{ store: '当前页面' }], skus: [{ id: 'sku-1', displayCols: 2 }] };
const baseline = createCloudBaseline(current, 1);

assert.equal(shouldInitializeCloud(null), true, '没有基线时仍表示本地未记录云端版本');
assert.equal(shouldInitializeCloud({ initialized: false }), true);
assert.equal(evaluateCloudPull({ baseline: null, remote: { doc_revision: 9, payload: { old: true } } }).action, 'first-pull');
assert.equal(evaluateCloudPull({ baseline, remote: { doc_revision: 1, payload: current } }).action, 'unchanged');
assert.equal(evaluateCloudPull({ baseline, remote: { doc_revision: 2, payload: { stores: [{ store: '旧云端' }] } } }).action, 'confirm-required');
assert.equal(evaluateCloudPull({ baseline: { ...baseline, initialized: false }, remote: { doc_revision: 1, payload: { old: true } } }).action, 'first-pull');
assert.equal(evaluateCloudPull({ baseline, remote: null }).action, 'unavailable');

console.log('cloud state guard passed');

