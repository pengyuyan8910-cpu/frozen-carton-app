import assert from "node:assert/strict";
import { applyPlanogramStagingSearch } from "./planogram-staging-search.mjs";

const rows = [
  { id: "a", name: "菌菇三鲜水饺", barcode: "69000001", category2: "预制主食", category3: "水饺馄饨", category4: "水饺" },
  { id: "b", name: "虾滑150g", barcode: "69000002", category2: "冷冻食材", category3: "火锅食材", category4: "丸滑类" },
];
const items = rows.map((row) => ({ dataset: { skuId: row.id }, hidden: false }));
const empty = { hidden: true };

assert.equal(applyPlanogramStagingSearch(items, empty, rows, "虾滑"), 1, "搜索应只显示匹配的待选 SKU");
assert.equal(items[0].hidden, true, "不匹配的 SKU 应隐藏");
assert.equal(items[1].hidden, false, "匹配的 SKU 应保留显示");
assert.equal(empty.hidden, true, "有匹配结果时不应显示无匹配提示");

assert.equal(applyPlanogramStagingSearch(items, empty, rows, ""), 2, "清空搜索应恢复全部待选 SKU");
assert.equal(items[0].hidden, false, "清空搜索后第一个 SKU 应恢复显示");
assert.equal(items[1].hidden, false, "清空搜索后第二个 SKU 应恢复显示");

console.log("planogram staging DOM filter tests passed");
