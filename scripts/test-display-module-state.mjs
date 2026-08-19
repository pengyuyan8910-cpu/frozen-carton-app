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

console.log("display module state tests passed");
