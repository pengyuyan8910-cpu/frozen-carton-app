import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyDimensionUpdates, createRefrigeratorSection, groupRefrigerators, validateDimensionUpdates, validateNewSection } from './refrigerator-module.mjs';

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

const added = createRefrigeratorSection(
  chest,
  { position: '分区3', length: 360, depth: 697, height: 204 },
  data.cabinets,
  originalTarget,
);
assert.equal(added.ok, true, '完整的新分区资料必须允许创建');
assert.equal(added.cabinet.store, chest.store, '新增分区必须归属原门店');
assert.equal(added.cabinet.label, chest.label, '新增分区必须归属原冰箱');
assert.deepEqual(
  { position: added.cabinet.position, length: added.cabinet.length, depth: added.cabinet.depth, height: added.cabinet.height },
  { position: '分区3', length: 360, depth: 697, height: 204 },
  '新增分区必须保存用户填写的分区和尺寸',
);
const expanded = groupRefrigerators([...data.cabinets, added.cabinet], chest.store).find(group => group.label === chest.label);
assert.equal(expanded.sections.length, 3, '新增分区必须加入原冰箱而不是创建第二台冰箱');
assert.ok(expanded.sections.some(section => section.key === added.cabinet.key), '新增分区必须有唯一柜段标识');
assert.deepEqual(validateNewSection({ position: '分区3', length: 360, depth: 0, height: 204 }), {
  ok: false,
  errors: ['分区3：分区名称、长、宽/深、高必须大于0'],
}, '分区尺寸不完整时必须禁止创建');

console.log('refrigerator module checks passed');

