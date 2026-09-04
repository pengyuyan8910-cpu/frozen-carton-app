import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { findBatchLaunchPlacement, placeBatchLaunchRows } from './lifecycle-batch-placement.mjs';

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const lifecycleHtml = fs.readFileSync(new URL('../product-lifecycle.html', import.meta.url), 'utf8');
const bridgeHtml = fs.readFileSync(new URL('../product-lifecycle-bridge.js', import.meta.url), 'utf8');
assert.match(indexHtml, /lifecycle-batch-placement\.mjs\?v=20260904_batch_launch_space_v2/);
assert.match(indexHtml, /product-lifecycle\.html\?v=20260904_batch_launch_space_v2/);
assert.match(indexHtml, /product-lifecycle-bridge\.js\?v=20260904_batch_launch_space_v2/);
assert.match(lifecycleHtml, /findBatchLaunchPlacement/);
assert.match(lifecycleHtml, /自动寻找同店空位/);
assert.match(bridgeHtml, /simpleLaunch/);
assert.match(bridgeHtml, /findBatchLaunchPlacement/);

const targetCabinet = {
  key: 'store-a|chest-1|segment-1', store: '店A', kind: '卧柜', label: '卧柜1', position: '分区1',
  length: 500, depth: 697, height: 460,
};
const fallbackCabinet = {
  key: 'store-a|chest-2|segment-1', store: '店A', kind: '卧柜', label: '卧柜2', position: '分区1',
  length: 600, depth: 697, height: 460,
};
const product = {
  id: 'pool-new', name: '批量上新测试品', barcode: '690000000001',
  length: 210, width: 160, height: 40, carton: 10, active: true,
};
const existing = {
  id: 'existing-1', store: '店A', included: true, name: '占位商品', barcode: '690000000099', active: true, cabinetKey: targetCabinet.key,
  displayCols: 1, faceWidth: 465, perCol: 1,
};
const task = {
  id: 'TASK-L-TEST', type: '上新',
  rows: [{
    id: 'TASK-L-TEST-0', store: '店A', productName: product.name, barcode: product.barcode,
    cabinetKey: targetCabinet.key, cabinetLabel: targetCabinet.label, position: targetCabinet.position,
    displayCols: 2, faceWidth: 210, needWidth: 420, perCol: 10,
  }],
};
const data = {
  productPool: [product],
  cabinets: [targetCabinet, fallbackCabinet],
  skus: [existing],
};

const before = structuredClone(data);
const result = placeBatchLaunchRows(task, data);
assert.equal(result.ok, true, '目标柜段放不下时应在同店寻找空位');
assert.equal(result.task.rows[0].cabinetKey, fallbackCabinet.key);
assert.equal(result.task.rows[0].cabinetLabel, fallbackCabinet.label);
assert.equal(result.task.rows[0].displayCols, 2, '备用柜段有足够空间时保留原上新排面');
assert.deepEqual(data, before, '预览分配不得改写正式门店、柜体或SKU数据');

const oneColumnFallback = placeBatchLaunchRows(task, {
  ...data,
  cabinets: [{ ...targetCabinet, length: 500 }, { ...fallbackCabinet, length: 215 }],
});
assert.equal(oneColumnFallback.ok, true, '备用柜段仅容纳一列时仍应先放入新品');
assert.equal(oneColumnFallback.task.rows[0].cabinetKey, fallbackCabinet.key);
assert.equal(oneColumnFallback.task.rows[0].displayCols, 1);
assert.equal(oneColumnFallback.task.rows[0].needWidth, 210);

const noFullWidthProduct = { ...product, id: 'pool-new-tight', name: '没有完整单列余量测试品', barcode: '690000000004', length: 200 };
const noFullWidthTask = {
  id: 'TASK-L-TEST-TIGHT', type: '上新',
  rows: [{
    id: 'TASK-L-TEST-TIGHT-0', store: '店A', productName: noFullWidthProduct.name, barcode: noFullWidthProduct.barcode,
    cabinetKey: targetCabinet.key, cabinetLabel: targetCabinet.label, position: targetCabinet.position,
    displayCols: 1, faceWidth: 200, needWidth: 200, perCol: 10,
  }],
};
const noFullWidthData = {
  stores: [{ store: '店A' }],
  productPool: [noFullWidthProduct],
  cabinets: [
    { ...targetCabinet, length: 500 },
    { ...fallbackCabinet, length: 200 },
  ],
  skus: [
    { ...existing, displayCols: 1, faceWidth: 360 },
    { ...existing, id: 'existing-2', cabinetKey: fallbackCabinet.key, faceWidth: 100 },
  ],
};
const noFullWidthBefore = structuredClone(noFullWidthData);
const temporaryPlacement = placeBatchLaunchRows(noFullWidthTask, noFullWidthData);
assert.equal(temporaryPlacement.ok, true, '同店没有完整单列余量时也应先生成临时入柜方案');
assert.equal(temporaryPlacement.task.rows[0].cabinetKey, targetCabinet.key, '临时方案应选择当前可承接空间最大的合法柜段');
assert.equal(temporaryPlacement.task.rows[0].displayCols, 1);
assert.equal(temporaryPlacement.task.rows[0].needWidth, 200);
assert.equal(temporaryPlacement.task.rows[0].placementStatus, '待手动调整');
assert.equal(temporaryPlacement.task.rows[0].overflowWidth, 60);
assert.deepEqual(noFullWidthData, noFullWidthBefore, '临时入柜预览不得改写正式门店、柜体或SKU数据');

const suppliedUsage = placeBatchLaunchRows(task, {
  productPool: [product],
  usageByCabinet: { [targetCabinet.key]: 465, [fallbackCabinet.key]: 0 },
  cabinets: [{ ...targetCabinet, used: 999 }, { ...fallbackCabinet, used: 999 }],
  skus: [],
});
assert.equal(suppliedUsage.task.rows[0].cabinetKey, fallbackCabinet.key, '使用外部柜段占用快照时不得重复累计 used');

const cabinetUsedFallback = placeBatchLaunchRows(task, {
  productPool: [product],
  cabinets: [{ ...targetCabinet, used: 465 }, { ...fallbackCabinet, used: 0 }],
});
assert.equal(cabinetUsedFallback.task.rows[0].cabinetKey, fallbackCabinet.key, '没有SKU明细时应使用柜段自身的 used 占用');

const ordinaryCabinet = { ...fallbackCabinet, key: 'store-a|ice-1|segment-1', kind: '冰淇淋柜', label: '冰淇淋柜1' };
const iceProduct = { ...product, id: 'pool-ice', name: '冰淇淋测试品', barcode: '690000000002', category3: '冰淇淋' };
const iceResult = placeBatchLaunchRows({ ...task, rows: [{ ...task.rows[0], productName: iceProduct.name, barcode: iceProduct.barcode }] }, {
  productPool: [iceProduct], cabinets: [targetCabinet, ordinaryCabinet], skus: [existing],
});
assert.equal(iceResult.ok, true);
assert.equal(iceResult.task.rows[0].cabinetKey, ordinaryCabinet.key, '冰品必须进入冰淇淋柜');

const bridgeContext = {
  window: {
    LifecycleBatchPlacement: { findBatchLaunchPlacement },
    dispatchEvent() {},
  },
  document: { getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
  CustomEvent: class CustomEvent {},
  console,
};
bridgeContext.window.window = bridgeContext.window;
vm.runInNewContext(fs.readFileSync(new URL('../product-lifecycle-bridge.js', import.meta.url), 'utf8'), bridgeContext);
const bridgeData = {
  stores: [{ store: '店A' }], productPool: [product], cabinets: [targetCabinet, fallbackCabinet], skus: [existing],
};
assert.equal(bridgeContext.window.ProductLifecycle.prepareData(bridgeData), true);
const bridgeTask = structuredClone(task);
const directBridgeFallback = findBatchLaunchPlacement(product, bridgeTask.rows[0], [targetCabinet, fallbackCabinet], new Map([[targetCabinet.key, 465], [fallbackCabinet.key, 0]]));
assert.equal(directBridgeFallback.ok, true);
assert.equal(directBridgeFallback.row.cabinetKey, fallbackCabinet.key);
const bridgeValidation = bridgeContext.window.ProductLifecycle.validateTaskCompletion(bridgeTask);
assert.equal(bridgeValidation.ok, true, '任务完成校验应与预览使用同店空位兜底');
assert.equal(bridgeTask.rows[0].cabinetKey, fallbackCabinet.key);

assert.equal(bridgeContext.window.ProductLifecycle.prepareData(noFullWidthData), true);
const tightBridgeTask = structuredClone(noFullWidthTask);
const tightBridgeValidation = bridgeContext.window.ProductLifecycle.validateTaskCompletion(tightBridgeTask);
assert.equal(tightBridgeValidation.ok, true, '没有完整单列余量时完成校验也应允许临时入柜');
assert.equal(tightBridgeTask.rows[0].cabinetKey, targetCabinet.key);
assert.equal(tightBridgeTask.rows[0].placementStatus, '待手动调整');

const atomicTask = {
  ...structuredClone(task),
  rows: [
    ...structuredClone(task.rows),
    { ...structuredClone(task.rows[0]), id: 'TASK-L-TEST-IMPOSSIBLE', productName: '无可用空位测试品', barcode: '690000000003', length: 1000, width: 1000, height: 1000 },
  ],
};
const atomicValidation = bridgeContext.window.ProductLifecycle.validateTaskCompletion(atomicTask);
assert.equal(atomicValidation.ok, false, '存在无法放置的门店时不得完成任务');
assert.equal(atomicTask.rows[0].cabinetKey, targetCabinet.key, '校验失败时不得把前一行的兜底位置写入任务');

console.log(JSON.stringify({ pass: true, fallback: result.task.rows[0].cabinetLabel, oneColumn: oneColumnFallback.task.rows[0].displayCols }));
