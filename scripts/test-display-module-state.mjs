import assert from "node:assert/strict";
import {
  clonePlanogramModule,
  deletePlanogramModule,
  includePlanogramSku,
  sameStoreSkuCabinetSegment,
} from "./display-module-state.mjs";


const baseState = {
  productPool: [{ id: "pool-1", barcode: "690000000001", active: true }],
  stores: [{ store: "甲店" }, { store: "乙店" }],
  skus: [
    {
      id: "sku-chest",
      store: "甲店",
      barcode: "690000000001",
      name: "测试水饺",
      included: true,
      cabinetKey: "甲店-卧柜-1",
      cabinetLabel: "卧柜1",
      position: "分区1",
      displayCols: 3,
      perCol: 10,
      faceWidth: 200,
      placements: [{ cabinetKey: "甲店-卧柜-1" }],
    },
    {
      id: "sku-other-store",
      store: "乙店",
      barcode: "690000000001",
      name: "测试水饺",
      included: true,
      cabinetKey: "乙店-卧柜-1",
      displayCols: 1,
      perCol: 10,
      faceWidth: 200,
      placements: [{ cabinetKey: "乙店-卧柜-1" }],
    },
  ],
};

const includeState = {
  productPool: [{ id: "pool-include", barcode: "690000000099", active: true }],
  stores: [{ store: "甲店" }, { store: "乙店" }],
  skus: [
    {
      id: "sku-not-included",
      store: "甲店",
      barcode: "690000000099",
      name: "待纳入水饺",
      included: false,
      ice: false,
      excluded: true,
      excludeReason: "STORE_CAPACITY_PRIORITY",
      cabinetKey: "",
      cabinetLabel: "",
      position: "",
      displayCols: 0,
      perCol: 0,
      faceWidth: 0,
      placements: [],
    },
    {
      id: "sku-other-store",
      store: "乙店",
      barcode: "690000000099",
      name: "其他店水饺",
      included: false,
    },
  ],
};

const included = includePlanogramSku(includeState, { id: "sku-not-included" });
assert.equal(included.ok, true, "未纳入SKU应可纳入当前门店");
assert.equal(included.row.included, true);
assert.equal(included.row.inStaging, true, "纳入后应先进入待选区，不自动排柜");
assert.equal(included.row.cabinetLabel, "待选区");
assert.equal(included.row.position, "待选区");
assert.equal(included.row.cabinetKey, "");
assert.equal(included.row.stagingCabinetType, "待分配", "普通冻品纳入后应允许人工选择立柜或卧柜");
assert.equal(included.row.stagingIce, false);
assert.equal(includeState.skus[0].included, false, "操作应返回新状态，不直接改原状态");
assert.deepEqual(included.state.productPool, includeState.productPool, "产品池不得被纳入操作改写");
assert.equal(included.state.skus.find((row) => row.id === "sku-other-store").included, false, "其他门店不得被改写");

const alreadyIncluded = includePlanogramSku(included.state, { id: "sku-not-included" });
assert.equal(alreadyIncluded.ok, false, "已纳入SKU不能重复纳入");

const cloned = clonePlanogramModule(baseState, {
  sourceId: "sku-chest",
  idFactory: () => "sku-upright",
});

assert.equal(cloned.ok, true);
assert.equal(cloned.state.skus.length, 3);
assert.equal(cloned.state.skus.filter((row) => row.store === "甲店").length, 2);
assert.equal(cloned.state.skus.find((row) => row.id === "sku-chest").cabinetKey, "甲店-卧柜-1");
assert.equal(cloned.row.inStaging, true);
assert.equal(cloned.row.cabinetKey, "");
assert.equal(cloned.row.cabinetLabel, "待选区");
assert.equal(cloned.row.position, "待选区");
assert.equal(cloned.row.displayCols, 1, "新增模块默认陈列列数应为1");
assert.equal(cloned.row.stagingFrom.key, "甲店-卧柜-1");
assert.equal(cloned.row.placementCloneOf, "sku-chest");
assert.equal(cloned.row.placements.length, 0);
assert.deepEqual(cloned.state.productPool, baseState.productPool);

const segmentState = {
  skus: [
    {
      id: "sku-segment-1",
      store: "甲店",
      barcode: "690000000002",
      included: true,
      inStaging: false,
      cabinetKey: "甲店__卧柜2505-柜1__分区1",
    },
    {
      id: "sku-segment-2",
      store: "甲店",
      barcode: "690000000003",
      included: true,
      inStaging: false,
      cabinetKey: "甲店__卧柜2505-柜1__分区2",
    },
    {
      id: "sku-staged",
      store: "甲店",
      barcode: "690000000002",
      included: true,
      inStaging: true,
      cabinetKey: "",
    },
  ],
};

assert.equal(
  sameStoreSkuCabinetSegment(segmentState, segmentState.skus[2], "甲店__卧柜2505-柜1__分区1"),
  true,
  "同SKU进入已有分区1应被禁止",
);
assert.equal(
  sameStoreSkuCabinetSegment(segmentState, segmentState.skus[2], "甲店__卧柜2505-柜1__分区2"),
  false,
  "同一台柜子的分区2属于不同柜段，应允许进入",
);

const deleted = deletePlanogramModule(cloned.state, { id: "sku-upright" });
assert.equal(deleted.ok, true);
assert.deepEqual(deleted.state.skus.map((row) => row.id), ["sku-chest", "sku-other-store"]);
assert.deepEqual(deleted.state.productPool, baseState.productPool);

const refused = deletePlanogramModule(baseState, { id: "sku-chest" });
assert.equal(refused.ok, false);
assert.match(refused.reason, /唯一陈列模块/);

const orderState = {
  skus: [
    { id: "order-a", store: "甲店", included: true, cabinetKey: "甲店-卧柜-1", planogramOrder: 0 },
    { id: "order-b", store: "甲店", included: true, cabinetKey: "甲店-卧柜-1", planogramOrder: 1 },
    { id: "order-c", store: "甲店", included: true, cabinetKey: "甲店-卧柜-1", planogramOrder: 2 },
    { id: "order-other", store: "甲店", included: true, cabinetKey: "甲店-卧柜-2", planogramOrder: 0 },
  ],
};

const moved = (await import("./display-module-state.mjs")).movePlanogramModule?.(orderState, {
  sourceId: "order-a",
  targetId: "order-c",
});
assert.equal(typeof moved, "object", "同柜任意移动函数必须存在");
assert.equal(moved.ok, true);
assert.deepEqual(
  moved.state.skus.filter((row) => row.cabinetKey === "甲店-卧柜-1").sort((a, b) => a.planogramOrder - b.planogramOrder).map((row) => row.id),
  ["order-b", "order-a", "order-c"],
);
assert.equal(moved.state.skus.find((row) => row.id === "order-other").planogramOrder, 0);

console.log("display module state tests passed");
