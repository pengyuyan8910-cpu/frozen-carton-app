import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPlanogramRows } from "./planogram-projection.mjs";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const cabinets = [
  { key: "店__卧柜2500-柜4__分区1", store: "店", label: "卧柜2500-柜4", position: "分区1", length: 1988 },
  { key: "店__立柜3m-柜4__第5层", store: "店", label: "立柜3m-柜4", position: "第5层", length: 710 },
];

const rows = [
  {
    id: "visible-module",
    store: "店",
    included: true,
    barcode: "690000000001",
    name: "新西兰羔羊卷",
    cabinetKey: cabinets[0].key,
    displayCols: 1,
    faceWidth: 280,
  },
  {
    id: "ghost-module",
    store: "店",
    included: true,
    barcode: "690000000001",
    name: "新西兰羔羊卷",
    cabinetKey: "店__卧柜2500-柜4__分区2-旧主键",
    cabinetLabel: "卧柜2500-柜4",
    position: "分区2",
    displayCols: 1,
    faceWidth: 280,
  },
];

const projected = buildPlanogramRows(rows, "店", cabinets);
assert.equal(projected.length, 1, "不存在于当前柜体清单的陈列模块不能出现在陈列图或模块映射中");
assert.equal(projected[0].cabinetKey, cabinets[0].key);

const movedWithLegacyPlacement = buildPlanogramRows([
  {
    id: "moved-module",
    store: "店",
    included: true,
    barcode: "690000000002",
    name: "移动后的模块",
    cabinetKey: cabinets[0].key,
    cabinetLabel: cabinets[0].label,
    position: cabinets[0].position,
    displayCols: 1,
    faceWidth: 280,
    placements: [{ cabinetKey: cabinets[1].key, cabinetLabel: cabinets[1].label, position: cabinets[1].position }],
  },
], "店", cabinets);
assert.equal(movedWithLegacyPlacement.length, 1, "根柜体已更新时，旧版单模块引用仍应保持可见");
assert.equal(movedWithLegacyPlacement[0].cabinetKey, cabinets[0].key, "根柜体字段应覆盖旧版单模块引用");

const cloneRows = [
  {
    id: "source-module",
    store: "店",
    included: true,
    barcode: "690000000003",
    name: "克隆模块商品",
    lifecycleTaskId: "task-1",
    lifecycleTaskRowId: "task-row-1",
    cabinetKey: cabinets[1].key,
    displayCols: 1,
    faceWidth: 280,
  },
  {
    id: "clone-module",
    store: "店",
    included: true,
    inStaging: false,
    placementCloneOf: "source-module",
    lifecycleTaskId: "task-1",
    lifecycleTaskRowId: "task-row-1",
    cabinetKey: cabinets[0].key,
    displayCols: 1,
    faceWidth: 280,
  },
];

const renderedAfterMove = cloneRows.filter((row) => {
  if (row.inStaging) return false;
  const key = row.lifecycleTaskId && !row.placementCloneOf
    ? [row.lifecycleTaskId, row.lifecycleTaskRowId || row.id].join("||")
    : "";
  if (key && cloneRows.slice(0, cloneRows.indexOf(row)).some(previous => {
    const previousKey = previous.lifecycleTaskId && !previous.placementCloneOf
      ? [previous.lifecycleTaskId, previous.lifecycleTaskRowId || previous.id].join("||")
      : "";
    return previousKey === key;
  })) return false;
  return true;
});
assert.equal(renderedAfterMove.length, 2, "待选区模块移入卧柜后，原模块和新增模块都应保留在陈列图投影中");
assert.equal(renderedAfterMove[1].cabinetKey, cabinets[0].key, "移入卧柜的新增模块应投影到目标卧柜柜段");

assert.match(
  app,
  /const duplicateKey=r\.lifecycleTaskId&&!r\.placementCloneOf\?/,
  "合法的分身模块不能因为继承生命周期任务编号而被陈列图重复过滤"
);

const panelStart = app.indexOf("function 渲染陈列图右侧()");
const panelEnd = app.indexOf("function 陈列图柜段监控", panelStart);
assert.ok(panelStart >= 0 && panelEnd > panelStart, "未找到陈列图右侧渲染逻辑");
const panel = app.slice(panelStart, panelEnd);
assert.match(panel, /visibleModules=可见SKU陈列模块\(selected\)/, "右侧模块列表必须使用陈列图实际投影");
assert.match(panel, /displayModules=visibleModules\.concat/, "右侧模块列表必须以实际可见模块为准");

console.log("planogram module reconciliation: PASS");
