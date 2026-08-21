import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyDimensionUpdates, groupRefrigerators, validateDimensionUpdates } from './refrigerator-module.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../data/app-data.json', import.meta.url), 'utf8'));
const groups = groupRefrigerators(data.cabinets, '三山星悦广场生活馆');
const chest = groups.find(group => group.label === '卧柜2505-柜1');

assert.ok(chest, '冰箱模块必须按门店和冰箱编号分组');
assert.equal(chest.sections.length, 2, '卧柜的多个分区必须保留在同一台冰箱下');
assert.deepEqual(
  chest.sections.map(section => [section.position, section.length, section.depth, section.height]),
  [['分区1', 1988, 697, 460], ['分区2', 360, 697, 204]],
  '冰箱模块必须读取现有柜段物理尺寸',
);

const target = chest.sections[0];
const originalTarget = data.cabinets.find(cabinet => cabinet.key === target.key);
const originalOther = data.cabinets.find(cabinet => cabinet.key !== target.key && cabinet.store === originalTarget.store);
const next = applyDimensionUpdates(data.cabinets, [{ key: target.key, length: 1900, depth: 680, height: 450 }]);
const nextTarget = next.find(cabinet => cabinet.key === target.key);
const nextOther = next.find(cabinet => cabinet.key === originalOther.key);

assert.deepEqual(
  { length: nextTarget.length, depth: nextTarget.depth, height: nextTarget.height },
  { length: 1900, depth: 680, height: 450 },
  '尺寸保存必须只更新指定柜段',
);
assert.deepEqual(
  { length: originalTarget.length, depth: originalTarget.depth, height: originalTarget.height },
  { length: 1988, depth: 697, height: 460 },
  '尺寸预览/应用不得修改正式输入对象',
);
assert.deepEqual(
  { length: nextOther.length, depth: nextOther.depth, height: nextOther.height },
  { length: originalOther.length, depth: originalOther.depth, height: originalOther.height },
  '未选中的柜段尺寸不得被联动改写',
);

assert.deepEqual(validateDimensionUpdates([{ key: target.key, length: 0, depth: 680, height: 450 }]), {
  ok: false,
  errors: [`${target.key}：长、宽/深、高必须大于0`],
}, '非正尺寸必须被拦截');

console.log('refrigerator module checks passed');
