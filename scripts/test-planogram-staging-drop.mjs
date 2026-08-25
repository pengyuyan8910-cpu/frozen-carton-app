import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { includePlanogramSku } from "./display-module-state.mjs";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

const duplicateIdState = {
  skus: [
    { id: "same-id", store: "甲店", included: true, cabinetKey: "甲柜" },
    { id: "same-id", store: "乙店", included: false, cabinetKey: "" },
  ],
};
const included = includePlanogramSku(duplicateIdState, { id: "same-id", store: "乙店" });
assert.equal(included.ok, true, "跨门店重复旧ID时必须按当前门店纳入未纳入SKU");
assert.equal(included.row.store, "乙店");
assert.equal(included.row.included, true);

assert.match(
  app,
  /const result=helper\(状态,\{id,store:row\.store\}\)/,
  "纳入操作必须把当前门店传给状态助手",
);
assert.match(
  app,
  /const columns=r\.inStaging\?Math\.max\(1,数\(r\.displayCols\)\):数\(r\.displayCols\)/,
  "待选区落位校验必须按至少一列计算占宽",
);
assert.match(
  app,
  /if\(r\.inStaging\)r\.displayCols=Math\.max\(1,数\(r\.displayCols\)\)/,
  "待选区落位后必须恢复为至少一列",
);
assert.match(
  app,
  /staging-item.*draggable=\"true\"/,
  "待选区模块必须明确可拖拽",
);

console.log("planogram staging drop tests passed");
