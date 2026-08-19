import assert from "node:assert/strict";
import fs from "node:fs";
import { runStrictAllocation } from "./strict-allocation-adapter.mjs";

const store = "FACE_WIDTH_RULE_TEST";
const product = {
  id: "face-width-1",
  barcode: "FACE-WIDTH-1",
  name: "尺寸规则测试商品",
  category3: "冷冻食材",
  category4: "测试品类",
  grade: "A",
  rank: 1,
  length: 235,
  width: 176,
  height: 49,
  volume: 2,
  carton: 10,
  dailyQty: 1,
  active: true
};
const cabinet = {
  key: `${store}__立柜1__第1层`,
  store,
  label: "立柜1",
  position: "第1层",
  kind: "立柜",
  type: "立柜",
  length: 710,
  depth: 534,
  height: 250,
  status: "正常",
  physicalSource: "app-data"
};

const previousPlan = {
  rows: [{
    skuKey: product.barcode,
    included: true,
    placements: [{
      cabinetKey: cabinet.key,
      orientation: "length-face",
      faceWidth: product.height,
      perCol: 2,
      displayCols: 1,
      capacitySource: "current-export-json"
    }]
  }]
};

const plan = runStrictAllocation({
  store,
  productPool: [product],
  cabinets: [cabinet],
  params: { triggerRate: 0.1, p95Factor: 1, externalSafetyFactor: 1, externalCapL: 754 },
  previousPlan
}, { maxIterations: 0, maxExpansions: 0 });

const placement = plan.rows[0]?.placements[0];
assert.ok(placement, "测试商品应有陈列方案");
assert.notEqual(placement.faceWidth, product.height, "产品高不能作为占宽");
assert.ok([product.length, product.width].includes(placement.faceWidth), "占宽只能来自产品长或宽");

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
assert.doesNotMatch(appSource, /\[\[?"高做陈列面"|face:\s*数\(r\.height\)/, "运营端不能把产品高作为陈列面或占宽候选");
console.log("horizontal face width rule passed");
