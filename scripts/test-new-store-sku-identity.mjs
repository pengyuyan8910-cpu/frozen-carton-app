import assert from "node:assert/strict";
import {
  normalizeNewStorePlanogramRows,
  repairDuplicateSkuIds,
} from "./planogram-projection.mjs";

const sameProduct = {
  id: "strict_6907992822723",
  barcode: "6907992822723",
  name: "测试商品",
  included: true,
  displayCols: 1,
  faceWidth: 100,
  perCol: 10,
  placements: [{ cabinetKey: "cab-a", cabinetLabel: "卧柜-柜1", position: "分区1" }],
};

const rows = normalizeNewStorePlanogramRows([
  { ...sameProduct, store: "新增店甲" },
  { ...sameProduct, store: "新增店乙", placements: [{ cabinetKey: "cab-b", cabinetLabel: "立柜-柜1", position: "第1层" }] },
]);

assert.equal(rows.length, 2, "两家新增门店应保留两条SKU记录");
assert.notEqual(rows[0].id, rows[1].id, "不同新增门店不能复用同一个SKU主键");
assert.ok(rows[0].id.includes("新增店甲"), "主键必须包含新增门店作用域");
assert.ok(rows[1].id.includes("新增店乙"), "主键必须包含新增门店作用域");

const duplicateState = {
  stores: [{ store: "新增店甲" }, { store: "新增店乙" }, { store: "新增店丙" }],
  cabinets: [],
  skus: [
    { ...sameProduct, store: "新增店甲" },
    { ...sameProduct, store: "新增店乙" },
    { ...sameProduct, store: "新增店丙" },
  ],
};
const repaired = repairDuplicateSkuIds(duplicateState, { skus: [] });
assert.equal(new Set(repaired.skus.map(row => row.id)).size, 3, "历史重复主键应被修复为唯一主键");
assert.deepEqual(repaired.skus.map(row => row.store), ["新增店甲", "新增店乙", "新增店丙"], "修复不得改变门店归属");
assert.deepEqual(repaired.skus.map(row => row.barcode), ["6907992822723", "6907992822723", "6907992822723"], "修复不得改变条码");

console.log("new-store-sku-identity: passed");
