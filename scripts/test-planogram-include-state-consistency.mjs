import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { includePlanogramSku, isPlanogramSkuIncluded } from "./display-module-state.mjs";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

assert.equal(isPlanogramSkuIncluded({ included: false }), false, "显式未纳入必须保持未纳入");
assert.equal(isPlanogramSkuIncluded({ included: true }), true, "显式纳入必须保持已纳入");
assert.equal(isPlanogramSkuIncluded({ included: undefined, cabinetKey: "", inStaging: false }), false, "历史空值且无柜段的行必须按未纳入处理");
assert.equal(isPlanogramSkuIncluded({ included: undefined, cabinetKey: "cab-1", inStaging: false }), true, "历史空值但已有柜段的行必须按已纳入处理");
assert.equal(isPlanogramSkuIncluded({ included: undefined, cabinetKey: "", inStaging: true }), true, "待选区行必须按已纳入处理");

const state = {
  stores: [{ store: "甲店" }],
  productPool: [{ barcode: "690000000001", active: true }],
  skus: [{ id: "legacy-unplaced", store: "甲店", barcode: "690000000001", included: undefined, cabinetKey: "", inStaging: false }],
};
const included = includePlanogramSku(state, { id: "legacy-unplaced" });
assert.equal(included.ok, true, "历史空值未纳入行必须可以纳入");
assert.equal(included.row.included, true);
assert.equal(included.row.inStaging, true, "纳入后必须进入待选区");

const poolStart = app.indexOf("function 陈列图池SKU(store)");
const poolEnd = app.indexOf("function 陈列图池列表(store)", poolStart);
assert.ok(poolStart >= 0 && poolEnd > poolStart, "未找到陈列图商品池筛选逻辑");
assert.match(app.slice(poolStart, poolEnd), /!SKU已纳入\(r\)/, "未纳入筛选必须与纳入操作使用同一口径");
assert.match(app, /function SKU已纳入\(r\)\{return window\.DisplayModuleState\?\.isPlanogramSkuIncluded\?\./, "页面必须复用统一的纳入状态函数");
assert.match(app, /if\(SKU已纳入\(row\)&&active\)/, "门店快照必须复用统一的纳入状态函数");

const listStart = app.indexOf("const listHtml=", poolEnd);
const listEnd = app.indexOf("const stageHost=q('#displayStagingHost')", listStart);
assert.ok(listEnd > listStart, "未找到陈列图商品池列表逻辑");
const listSource = app.slice(listStart, listEnd);
assert.match(listSource, /const included=SKU已纳入\(r\)/, "商品状态显示必须使用统一纳入口径");
assert.doesNotMatch(listSource, /!r\.included|r\.included\?|\(r\.included\?/, "商品池列表不能再使用与核心逻辑不同的 included 真假判断");

console.log("planogram include state consistency: PASS");
