import assert from "node:assert/strict";
import { normalizeNewStorePlanogramRows } from "./planogram-projection.mjs";

const source = [{
  id: "strict_6937506895554",
  store: "测试新增门店",
  barcode: "6937506895554",
  name: "澳洲西冷牛排400g",
  included: true,
  cabinetKey: "cab_chest_2",
  placements: [
    {
      cabinetKey: "cab_chest_2",
      cabinetLabel: "卧柜2505-柜1",
      position: "分区2",
      displayCols: 1,
      faceWidth: 235,
      perCol: 12,
      fullCount: 12,
    },
    {
      cabinetKey: "cab_vertical_3",
      cabinetLabel: "立柜2.25m-柜1",
      position: "第3层",
      displayCols: 3,
      faceWidth: 176,
      perCol: 10,
      fullCount: 30,
    },
  ],
}];

const result = normalizeNewStorePlanogramRows(source);

assert.equal(result.length, 2, "一个多柜段 SKU 应拆成两个独立模块行");
assert.deepEqual(result.map(row => row.id), [
  "newstore_测试新增门店__strict_6937506895554::module::1",
  "newstore_测试新增门店__strict_6937506895554::module::2",
]);
assert.deepEqual(result.map(row => row.cabinetKey), ["cab_chest_2", "cab_vertical_3"]);
assert.deepEqual(result.map(row => row.placements.length), [1, 1]);
assert.deepEqual(result.map(row => row.displayCols), [1, 3]);
assert.deepEqual(result.map(row => row.faceWidth), [235, 176]);
assert.equal(result[0].sourceRowId, "newstore_测试新增门店__strict_6937506895554");
assert.equal(result[1].sourceRowId, "newstore_测试新增门店__strict_6937506895554");
assert.equal(source[0].placements.length, 2, "不能改写严格测算缓存原行");

console.log("new-store-module-normalization: passed");
