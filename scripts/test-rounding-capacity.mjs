import assert from "node:assert/strict";
import { runStrictAllocation } from "./strict-allocation-adapter.mjs";

const product = {
  barcode: "6950716066958",
  name: "青虾滑95% 150g",
  category3: "火锅食材",
  category4: "丸滑类",
  grade: "C",
  rank: 1,
  length: 240,
  width: 150,
  height: 20,
  volume: 0.72,
  carton: 1,
  dailyQty: 1,
  active: true,
  allowedOrientations: ["width-face"]
};

const cabinet = (kind, label, length, depth, height) => ({
  key: `ROUNDING__${label}`,
  store: "ROUNDING",
  label,
  position: kind === "立柜" ? "第1层" : "分区1",
  kind,
  type: kind,
  length,
  depth,
  height,
  status: "正常",
  physicalSource: "test-confirmed"
});

const params = { triggerRate: 0.1, p95Factor: 1, externalSafetyFactor: 1, externalCapL: 754 };
const chestProduct = { ...product, width: 800 };
const uprightProduct = { ...product, width: 300 };

const chest = runStrictAllocation({
  store: "ROUNDING",
  productPool: [chestProduct],
  cabinets: [cabinet("卧柜", "卧柜2505-柜1", 1988, 697, 460)],
  params
}, { maxIterations: 0, maxExpansions: 0 });
const chestPlacement = chest.rows[0].placements[0];
assert.equal(chestPlacement.orientation, "width-face");
assert.equal(chestPlacement.depthCount, 3, "卧柜纵深数量必须四舍五入：697÷240=2.90→3");
assert.equal(chestPlacement.stackCount, 23, "卧柜堆叠数量必须四舍五入：460÷20=23");
assert.equal(chestPlacement.perCol, 69);
assert.equal(chest.rows[0].fullCount, 138, "满陈必须等于柜内列数×单列容量：2列×69=138");

const upright = runStrictAllocation({
  store: "ROUNDING",
  productPool: [uprightProduct],
  cabinets: [cabinet("立柜", "立柜2250-柜1", 710, 534, 250)],
  params
}, { maxIterations: 0, maxExpansions: 0 });
const uprightPlacement = upright.rows[0].placements[0];
assert.equal(uprightPlacement.orientation, "width-face");
assert.equal(uprightPlacement.orientedDepth, 20, "立柜必须用商品高作为纵深");
assert.equal(uprightPlacement.orientedHeight, 240, "立柜宽做陈列面时商品长满足层高");
assert.equal(uprightPlacement.depthCount, 27, "立柜纵深数量必须四舍五入：534÷20=26.7→27");
assert.equal(uprightPlacement.stackCount, 1);
assert.equal(uprightPlacement.perCol, 27);

const previous = runStrictAllocation({
  store: "ROUNDING",
  productPool: [chestProduct],
  cabinets: [cabinet("卧柜", "卧柜2505-柜1", 1988, 697, 460)],
  params,
  previousPlan: {
    rows: [{
      skuKey: chestProduct.barcode,
      included: true,
      placements: [{
        cabinetKey: "ROUNDING__卧柜2505-柜1",
        orientation: "width-face",
        faceWidth: 800,
        perCol: 46,
        displayCols: 1,
        capacitySource: "current-export-json"
      }]
    }]
  }
}, { maxIterations: 0, maxExpansions: 0 });
assert.equal(previous.rows[0].placements[0].perCol, 69, "历史底表单列容量不能覆盖新公式");

console.log(JSON.stringify({
  chest: { depthCount: chestPlacement.depthCount, stackCount: chestPlacement.stackCount, perCol: chestPlacement.perCol },
  upright: { orientedDepth: uprightPlacement.orientedDepth, depthCount: uprightPlacement.depthCount, stackCount: uprightPlacement.stackCount, perCol: uprightPlacement.perCol },
  previousRecalculatedPerCol: previous.rows[0].placements[0].perCol
}, null, 2));
