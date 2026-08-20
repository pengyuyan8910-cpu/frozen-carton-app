import assert from "node:assert/strict";
import fs from "node:fs";
import { recalculateLoadedPlanogram } from "./live-planogram-capacity.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const bootstrapSource = fs.readFileSync(new URL("../bootstrap.js", import.meta.url), "utf8");
assert.match(appSource, /刷新已加载陈列容量\(状态\)/, "启动流程必须回填已加载陈列容量");
assert.match(bootstrapSource, /LivePlanogramCapacity/, "启动流程必须加载已加载陈列容量模块");

const state = {
  params: { triggerRate: 0.1 },
  cabinets: [
    { key: "店__卧柜2505-柜1__分区1", kind: "卧柜", label: "卧柜2505-柜1", position: "分区1", length: 1988, depth: 697, height: 460 },
    { key: "店__立柜2250-柜1__第1层", kind: "立柜", label: "立柜2250-柜1", position: "第1层", length: 710, depth: 534, height: 250 }
  ],
  skus: [
    {
      id: "chest",
      store: "店",
      included: true,
      name: "青虾滑",
      barcode: "1001",
      length: 240,
      width: 150,
      height: 20,
      volume: 1,
      carton: 30,
      cabinetKey: "店__卧柜2505-柜1__分区1",
      cabinetLabel: "卧柜2505-柜1",
      position: "分区1",
      faceWidth: 150,
      faceOrientation: "width",
      displayCols: 1,
      perCol: 69,
      rowFull: 69,
      skuFull: 69,
      externalCountOverride: 1,
      staticExternalOverride: 1,
      avgExternalOverride: 0.5,
      placements: [{
        cabinetKey: "店__卧柜2505-柜1__分区1",
        orientation: "width-face",
        faceWidth: 150,
        orientedDepth: 240,
        orientedHeight: 20,
        depthCount: 3,
        stackCount: 23,
        perCol: 69,
        displayCols: 1,
        fullCount: 69,
        widthUsed: 150
      }]
    },
    {
      id: "vertical",
      store: "店",
      included: true,
      name: "汤圆",
      barcode: "1002",
      length: 265,
      width: 160,
      height: 45,
      volume: 1,
      carton: 30,
      cabinetKey: "店__立柜2250-柜1__第1层",
      cabinetLabel: "立柜2250-柜1",
      position: "第1层",
      faceWidth: 265,
      faceOrientation: "length",
      displayCols: 2,
      perCol: 12,
      rowFull: 24,
      skuFull: 24,
      placements: [{
        cabinetKey: "店__立柜2250-柜1__第1层",
        orientation: "length-face",
        faceWidth: 265,
        orientedDepth: 45,
        orientedHeight: 160,
        depthCount: 12,
        stackCount: 1,
        perCol: 12,
        displayCols: 2,
        fullCount: 24,
        widthUsed: 530
      }]
    }
  ]
};

const originalLocations = state.skus.map(row => [row.id, row.cabinetKey, row.position]);
const result = recalculateLoadedPlanogram(state);
const chest = result.skus.find(row => row.id === "chest");
const vertical = result.skus.find(row => row.id === "vertical");

assert.equal(chest.perCol, 46, "卧柜必须按柜体宽697÷产品长240=2，再乘高度堆叠23，得到46");
assert.equal(chest.rowFull, 46);
assert.equal(chest.placements[0].depthCount, 2);
assert.equal(chest.placements[0].stackCount, 23);
assert.equal(chest.placements[0].perCol, 46);
assert.equal(vertical.perCol, 11, "立柜必须按柜体宽534÷产品高45向下取整");
assert.equal(vertical.rowFull, 22);
assert.equal(vertical.placements[0].depthCount, 11);
assert.equal(vertical.placements[0].stackCount, 1);
assert.deepEqual(result.skus.map(row => [row.id, row.cabinetKey, row.position]), originalLocations, "重算不得改变柜段和位置");
assert.equal(Object.hasOwn(chest, "externalCountOverride"), false, "旧外储覆盖值不能继续遮蔽新满陈");
assert.equal(Object.hasOwn(chest, "staticExternalOverride"), false);
assert.equal(Object.hasOwn(chest, "avgExternalOverride"), false);

console.log("loaded planogram capacity recalculation: PASS");

