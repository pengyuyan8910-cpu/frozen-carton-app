import assert from "node:assert/strict";
import fs from "node:fs";
import { recalcAllCapacity } from "./source-to-app-data.mjs";
import { runStrictAllocation } from "./strict-allocation-adapter.mjs";
import { calculatePhysicalStackCount, PHYSICAL_BUSINESS_RULES } from "./auto-replan/physical-business-rules.mjs";

const root = new URL("../", import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), "utf8");
const product = {
  barcode: "PHYSICAL-FLOOR-1",
  name: "实际尺寸规则测试商品",
  length: 240,
  width: 800,
  height: 20,
  volume: 1,
  carton: 20,
  dailyQty: 1,
  active: true,
  allowedOrientations: ["width-face"]
};
const chest = {
  key: "FLOOR__卧柜2505-柜1__分区1",
  store: "FLOOR",
  label: "卧柜2505-柜1",
  position: "分区1",
  kind: "卧柜",
  type: "卧柜",
  length: 1988,
  depth: 697,
  height: 460,
  status: "正常",
  physicalSource: "test"
};
const vertical = {
  ...chest,
  key: "FLOOR__立柜2250-柜1__第1层",
  label: "立柜2250-柜1",
  position: "第1层",
  kind: "立柜",
  type: "立柜",
  length: 710,
  depth: 534,
  height: 250
};
const params = { triggerRate: 0.1, p95Factor: 1, externalSafetyFactor: 1, externalCapL: 754 };

assert.equal(PHYSICAL_BUSINESS_RULES.capacityRoundingRule.includes("向下取整"), true);
assert.equal(calculatePhysicalStackCount("chest", 460, 20), 23);
assert.equal(calculatePhysicalStackCount("chest", 460, 70), 6);

const strictChest = runStrictAllocation({ store: "FLOOR", productPool: [product], cabinets: [chest], params }, { maxIterations: 0, maxExpansions: 0 });
const strictChestPlacement = strictChest.rows[0].placements[0];
assert.equal(strictChestPlacement.depthCount, 2, "严格引擎卧柜纵深必须按柜体宽697÷产品长240向下取整");
assert.equal(strictChestPlacement.stackCount, 23);
assert.equal(strictChestPlacement.perCol, 46);

const verticalProduct = { ...product, width: 300 };
const strictVerticalPlan = runStrictAllocation({ store: "FLOOR", productPool: [verticalProduct], cabinets: [vertical], params }, { maxIterations: 0, maxExpansions: 0 });
const strictVerticalPlacement = strictVerticalPlan.rows[0].placements[0];
assert.equal(strictVerticalPlacement.depthCount, 26, "严格引擎立柜纵深必须按柜体宽534÷产品高20向下取整");
assert.equal(strictVerticalPlacement.perCol, 26);

const sourceData = recalcAllCapacity({
  stores: [{ store: "FLOOR" }],
  cabinets: [chest, vertical],
  skus: [
    { ...product, id: "chest-row", store: "FLOOR", cabinetKey: chest.key, displayCols: 1, faceOrientation: "width", faceWidth: product.width, perCol: 999 },
    { ...product, id: "vertical-row", store: "FLOOR", cabinetKey: vertical.key, displayCols: 1, faceOrientation: "width", faceWidth: product.width, perCol: 999 }
  ]
});
assert.equal(sourceData.skus[0].perCol, 46);
assert.equal(sourceData.skus[1].perCol, 26);

const app = read("app.js");
const lifecycle = read("product-lifecycle.html");
const recalc = read("scripts/recalc-manchen.mjs");
const phase1 = read("scripts/auto-replan/phase1-physical-candidates.mjs");
assert.match(app, /per:Math\.floor\(D\/o\.depth\)\*\(upright\?1:Math\.floor\(CH\/o\.h\)\)/);
assert.match(lifecycle, /const depthCount=Math\.floor\(/);
assert.match(lifecycle, /const stackCount=vertical\?1:Math\.floor\(/);
assert.match(recalc, /const depthCount = Math\.floor\(D \/ depthDim\)/);
assert.match(recalc, /const stackCount = upright \? 1 : Math\.floor\(CH \/ hDim\)/);
assert.match(phase1, /const depthCount = Math\.floor\(cabinet\.depth \/ oriented\.depth\)/);

console.log(JSON.stringify({ rule: "physical-floor", chestPerCol: 46, verticalPerCol: 26 }, null, 2));
