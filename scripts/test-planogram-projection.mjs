import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPlanogramRows, buildCabinetUsage, normalizeNewStorePlanogramRows } from "./planogram-projection.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
assert.match(appSource, /陈列图行投影\(store\)/, "陈列图必须使用统一模块投影");
assert.match(appSource, /rows\.filter\(r=>r\.cabinetKey===seg\?\.key\)/, "立柜商品必须按柜段唯一键渲染");
assert.match(appSource, /rows\.filter\(r=>r\.cabinetKey===seg\.key\)/, "卧柜商品必须按柜段唯一键渲染");

const cabinets = [
  { key: "店__卧柜2505-柜1__分区1", store: "店", label: "卧柜2505-柜1", position: "分区1", length: 1988 },
  { key: "店__立柜2500-柜1__第1层", store: "店", label: "立柜2500-柜1", position: "第1层", length: 710 }
];

const rows = [
  {
    id: "multi",
    store: "店",
    included: true,
    name: "双模块商品",
    cabinetKey: cabinets[0].key,
    displayCols: 1,
    faceWidth: 120,
    placements: [
      { cabinetKey: cabinets[0].key, displayCols: 1, faceWidth: 120 },
      { cabinetKey: cabinets[1].key, displayCols: 1, faceWidth: 140 }
    ]
  },
  {
    id: "staging",
    store: "店",
    included: true,
    inStaging: true,
    name: "待选商品",
    cabinetKey: cabinets[0].key,
    displayCols: 1,
    faceWidth: 300
  }
];

const projected = buildPlanogramRows(rows, "店");
assert.equal(projected.length, 2, "多模块SKU必须投影为两个可见模块，待选区不应进入陈列图");
assert.deepEqual(projected.map(row => row.cabinetKey), cabinets.map(cabinet => cabinet.key));
assert.equal(projected[0].sourceRowId, "multi");
assert.notEqual(projected[0].id, projected[1].id, "两个模块必须有独立的陈列图投影ID");

const staleFullCount = buildPlanogramRows([{
  id: "stale-capacity",
  store: "店",
  included: true,
  name: "物理容量已更新但模块满陈未更新",
  cabinetKey: cabinets[0].key,
  displayCols: 2,
  perCol: 12,
  rowFull: 24,
  placements: [{
    cabinetKey: cabinets[0].key,
    displayCols: 2,
    perCol: 12,
    fullCount: 4,
  }],
}], "店", cabinets);
assert.equal(staleFullCount.length, 1);
assert.equal(staleFullCount[0].rowFull, 24, "陈列图不能用旧模块满陈覆盖实际列数×单列容量");

const staleSingleColumn = buildPlanogramRows([{
  id: "stale-single-column",
  store: "店",
  included: true,
  name: "单列物理容量已更新但模块满陈未更新",
  cabinetKey: cabinets[0].key,
  displayCols: 1,
  perCol: 12,
  rowFull: 12,
  placements: [{ cabinetKey: cabinets[0].key, displayCols: 1, perCol: 12, fullCount: 2 }],
}], "店", cabinets);
assert.equal(staleSingleColumn[0].rowFull, 12, "单列容量不能被旧满陈压成1或2件");

const stalePlacementColumns = buildPlanogramRows([{
  id: "stale-placement-columns",
  store: "店",
  included: true,
  name: "主记录单列但历史模块仍为两列",
  cabinetKey: cabinets[0].key,
  displayCols: 1,
  faceWidth: 185,
  perCol: 28,
  rowFull: 28,
  placements: [{
    cabinetKey: cabinets[0].key,
    displayCols: 2,
    faceWidth: 185,
    perCol: 28,
    fullCount: 56,
    widthUsed: 370,
  }],
}], "店", cabinets);
assert.equal(stalePlacementColumns.length, 1);
assert.equal(stalePlacementColumns[0].displayCols, 1, "单模块投影必须以主记录列数为准，不能显示历史两列");
assert.equal(stalePlacementColumns[0].rowFull, 28, "单模块投影满陈必须与主记录单列容量一致");
assert.equal(
  buildCabinetUsage(cabinets, stalePlacementColumns).get(cabinets[0].key).used,
  185,
  "单模块柜段占用必须按主记录单列宽度统计"
);

const normalizedStaleFullCount = normalizeNewStorePlanogramRows([{
  id: "new-store-stale-capacity",
  store: "店",
  included: true,
  displayCols: 2,
  perCol: 12,
  placements: [{
    cabinetKey: cabinets[0].key,
    displayCols: 2,
    perCol: 12,
    fullCount: 4,
  }],
}]);
assert.equal(normalizedStaleFullCount[0].rowFull, 24, "新增门店临时结果不能继承旧模块满陈");

const usage = buildCabinetUsage(cabinets, projected);
assert.equal(usage.get(cabinets[0].key).used, 120, "第一柜段统计必须与第一模块一致");
assert.equal(usage.get(cabinets[1].key).used, 140, "第二柜段统计必须包含第二模块");
assert.equal(usage.get(cabinets[0].key).items.length, 1);
assert.equal(usage.get(cabinets[1].key).items.length, 1);

console.log("planogram projection and usage: PASS");
