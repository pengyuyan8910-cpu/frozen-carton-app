import assert from "node:assert/strict";
import {
  clonePlanogramModule,
  deletePlanogramModule,
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
      displayCols: 1,
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

const target = {
  key: "甲店-立柜-1",
  label: "立柜1",
  position: "第1层",
  kind: "立柜",
};

const cloned = clonePlanogramModule(baseState, {
  sourceId: "sku-chest",
  target,
  layout: { faceOrientation: "width", faceWidth: 180, perCol: 3 },
  idFactory: () => "sku-upright",
});

assert.equal(cloned.ok, true);
assert.equal(cloned.state.skus.length, 3);
assert.equal(cloned.state.skus.filter((row) => row.store === "甲店").length, 2);
assert.equal(cloned.state.skus.find((row) => row.id === "sku-chest").cabinetKey, "甲店-卧柜-1");
assert.equal(cloned.row.cabinetKey, "甲店-立柜-1");
assert.equal(cloned.row.placementCloneOf, "sku-chest");
assert.equal(cloned.row.placements.length, 0);
assert.deepEqual(cloned.state.productPool, baseState.productPool);

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
