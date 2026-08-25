import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCabinetUsage, buildPlanogramRows } from "./planogram-projection.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
assert.match(appSource, /let 柜段使用缓存=null/, "柜段使用必须有缓存，避免拖动时重复扫描全部门店");
assert.match(appSource, /if\(柜段使用缓存\)return 柜段使用缓存/, "柜段使用必须复用当前状态缓存");
assert.match(appSource, /function 清空柜段使用缓存\(\)/, "状态保存前必须提供柜段使用缓存失效入口");

const cabinets = [{ key: "c1", store: "店", length: 500 }];
const sourceRows = [{
  id: "r1",
  store: "店",
  included: true,
  cabinetKey: "c1",
  displayCols: 2,
  faceWidth: 100,
  placements: [{ cabinetKey: "c1", displayCols: 2, faceWidth: 100 }]
}];
const before = structuredClone(sourceRows);
const projected = buildPlanogramRows(sourceRows, "店");
buildCabinetUsage(cabinets, projected);
assert.deepEqual(sourceRows, before, "统计和投影不得改写当前陈列数据");

console.log("planogram usage cache and immutability: PASS");
