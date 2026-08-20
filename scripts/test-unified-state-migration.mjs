import assert from 'node:assert/strict';
import { migrateUnifiedState, hasMeaningfulEdits } from './unified-state-migration.mjs';

const initial = {
  meta: { version: 'v1' },
  stores: [{ store: '老店' }],
  cabinets: [{ key: 'cab-1' }],
  skus: [{ id: 'sku-1', cabinetKey: 'cab-1', displayCols: 1, perCol: 2, faceWidth: 100 }]
};
const published = structuredClone(initial);
const draft = structuredClone(initial);
draft.skus[0].displayCols = 3;
draft.skus[0].perCol = 4;
draft.skus[0].faceOrientation = 'length';
draft.skus[0].cabinetKey = 'cab-2';
draft.skus[0].placements = [{ cabinetKey: 'cab-2', displayCols: 2, perCol: 4 }];

assert.equal(hasMeaningfulEdits(draft, initial), true, '手动陈列调整应被识别');
assert.equal(hasMeaningfulEdits(published, initial), false, '未修改发布状态不应被识别为编辑');
const migrated = migrateUnifiedState({ initial, draft, published, signature: 'sig-1' });
assert.equal(migrated.source, 'draft', '有手动修改时应优先迁移草稿');
assert.equal(migrated.state.skus[0].displayCols, 3);
assert.equal(migrated.state.skus[0].perCol, 4);
assert.equal(migrated.state.skus[0].faceOrientation, 'length');
assert.equal(migrated.state.skus[0].cabinetKey, 'cab-2', '迁移不能改变手动调整的柜段');
assert.deepEqual(migrated.state.skus[0].placements, [{ cabinetKey: 'cab-2', displayCols: 2, perCol: 4 }], '迁移不能丢失分身模块');
assert.equal(migrated.state.meta.version, 'v1', '迁移不能改变正式数据元信息');
assert.equal(migrated.state._dataSignature, 'sig-1');

const fresh = migrateUnifiedState({ initial, draft: null, published: null, signature: 'sig-2' });
assert.equal(fresh.source, 'initial');
assert.deepEqual(fresh.state, { ...initial, _dataSignature: 'sig-2' });

console.log('unified state migration passed');
