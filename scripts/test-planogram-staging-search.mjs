import assert from "node:assert/strict";
import { filterPlanogramStagingRows } from "./planogram-staging-search.mjs";

const rows = [
  { id: "a", name: "菌菇三鲜水饺", barcode: "69000001", category2: "预制主食", category3: "水饺馄饨", category4: "水饺" },
  { id: "b", name: "虾滑150g", barcode: "69000002", category2: "冷冻食材", category3: "火锅食材", category4: "丸滑类" },
  { id: "c", name: "牛肉卷", barcode: "69000003", category2: "冷冻食材", category3: "冷冻肉类", category4: "牛肉" },
];

assert.deepEqual(filterPlanogramStagingRows(rows, ""), rows, "清空搜索应恢复全部待选SKU");
assert.deepEqual(filterPlanogramStagingRows(rows, "虾滑").map((row) => row.id), ["b"], "应支持按商品名称搜索");
assert.deepEqual(filterPlanogramStagingRows(rows, "69000003").map((row) => row.id), ["c"], "应支持按条码搜索");
assert.deepEqual(filterPlanogramStagingRows(rows, "火锅食材").map((row) => row.id), ["b"], "应支持按三级类目搜索");
assert.deepEqual(filterPlanogramStagingRows(rows, "不存在").map((row) => row.id), [], "无匹配时应返回空列表");

console.log("planogram staging search tests passed");
