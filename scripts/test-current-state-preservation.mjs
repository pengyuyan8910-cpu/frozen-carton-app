import assert from "node:assert/strict";
import fs from "node:fs";
import { createStateIntegrityGuard } from "./state-integrity-guard.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../data/app-data.json", import.meta.url), "utf8"));
const guard = createStateIntegrityGuard(data);
assert.equal(guard.validate(data).ok, true, "正式底表自身必须通过结构校验");

const current = structuredClone(data);
for (let i = 1; i <= 6; i++) {
  const store = `当前页面新增门店${i}`;
  const key = `current-page-cab-${i}`;
  current.stores.push({ store, type: "新店" });
  current.cabinets.push({ key, store, label: `新增柜${i}`, position: "分区1", length: 1000 });
  current.skus.push({ id: `current-page-sku-${i}`, store, barcode: `69999999999${i}` });
}
assert.equal(current.stores.length, 38, "回归样本应模拟当前页面38家门店");
assert.equal(guard.validate(current).ok, true, "当前页面新增门店必须允许保留");
assert.equal(guard.validate(data, { referenceState: current }).ok, false, "旧32店底表不得覆盖当前38店页面");

console.log("current-state-preservation: passed");
