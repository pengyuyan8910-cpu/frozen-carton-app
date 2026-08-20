import assert from "node:assert/strict";
import fs from "node:fs";
import { recalculateLoadedPlanogram } from "./live-planogram-capacity.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const bootstrapSource = fs.readFileSync(new URL("../bootstrap.js", import.meta.url), "utf8");
assert.match(appSource, /刷新已加载陈列容量\(状态\)/, "启动流程必须回填已加载陈列容量");
assert.match(appSource, /function 刷新单SKU陈列容量\(row\)/, "换柜后必须立即重算当前SKU容量");
assert.match(appSource, /刷新单SKU陈列容量\(r\)/, "陈列移动路径必须触发当前SKU容量重算");
assert.match(bootstrapSource, /LivePlanogramCapacity/, "启动流程必须加载已加载陈列容量模块");

const state = {
  params: { triggerRate: 0.1 },
  cabinets: [
    { key: "店__卧柜2505-柜1__分区1", kind: "卧柜", label: "卧柜2505-柜1", position: "分区1", length: 1988, depth: 697, height: 460 },
    { key: "店__卧柜2505-柜2__分区1", kind: "卧柜", label: "卧柜2505-柜2", position: "分区1", length: 1988, depth: 697, height: 460 },
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
    },
    {
      id: "moved-to-chest",
      store: "店",
      included: true,
      name: "澳洲谷饲肥牛卷450g",
      barcode: "1003",
      length: 235,
      width: 176,
      height: 49,
      volume: 1,
      carton: 30,
      cabinetKey: "店__卧柜2505-柜2__分区1",
      cabinetLabel: "卧柜2505-柜2",
      position: "分区1",
      faceWidth: 176,
      faceOrientation: "width",
      displayCols: 1,
      perCol: 10,
      placements: [{
        cabinetKey: "店__立柜2250-柜1__第1层",
        orientation: "width-face",
        faceWidth: 176,
        orientedDepth: 49,
        orientedHeight: 235,
        depthCount: 10,
        stackCount: 1,
        perCol: 10,
        displayCols: 1,
        fullCount: 10,
        widthUsed: 176
      }]
    },
    {
      id: "turned-to-width",
      store: "店",
      included: true,
      name: "方向切换测试",
      barcode: "1004",
      length: 240,
      width: 150,
      height: 20,
      volume: 1,
      carton: 30,
      cabinetKey: "店__卧柜2505-柜2__分区1",
      cabinetLabel: "卧柜2505-柜2",
      position: "分区1",
      faceWidth: 150,
      faceOrientation: "width",
      displayCols: 1,
      perCol: 69,
      placements: [{
        cabinetKey: "店__卧柜2505-柜2__分区1",
        orientation: "length-face",
        faceWidth: 240,
        orientedDepth: 150,
        orientedHeight: 20,
        depthCount: 4,
        stackCount: 23,
        perCol: 92,
        displayCols: 1,
        fullCount: 92,
        widthUsed: 240
      }]
    }
  ]
};

const originalLocations = state.skus.map(row => [row.id, row.cabinetKey, row.position]);
const result = recalculateLoadedPlanogram(state);
const chest = result.skus.find(row => row.id === "chest");
const vertical = result.skus.find(row => row.id === "vertical");
const movedToChest = result.skus.find(row => row.id === "moved-to-chest");
const turnedToWidth = result.skus.find(row => row.id === "turned-to-width");

assert.equal(chest.perCol, 46, "卧柜必须按柜体宽697÷产品长240=2，再乘高度堆叠23，得到46");
assert.equal(chest.rowFull, 46);
assert.equal(chest.placements[0].depthCount, 2);
assert.equal(chest.placements[0].stackCount, 23);
assert.equal(chest.placements[0].perCol, 46);
assert.equal(vertical.perCol, 11, "立柜必须按柜体宽534÷产品高45向下取整");
assert.equal(vertical.rowFull, 22);
assert.equal(vertical.placements[0].depthCount, 11);
assert.equal(vertical.placements[0].stackCount, 1);
assert.equal(movedToChest.perCol, 18, "行已换到卧柜时，不能继续读取旧立柜模块的10；应为697÷235=2乘460÷49=9，即18");
assert.equal(movedToChest.placements[0].cabinetKey, "店__卧柜2505-柜2__分区1", "换柜后主模块必须同步到行的当前柜段");
assert.equal(movedToChest.placements[0].depthCount, 2);
assert.equal(movedToChest.placements[0].stackCount, 9);
assert.equal(movedToChest.placements[0].perCol, 18);
assert.equal(turnedToWidth.faceOrientation, "width", "方向切换后必须保留用户选择的宽做陈列面");
assert.equal(turnedToWidth.faceWidth, 150, "方向切换后占宽必须使用产品宽");
assert.equal(turnedToWidth.perCol, 46, "方向切换后单列容量必须按宽做陈列面重算");
assert.equal(turnedToWidth.placements[0].orientation, "width-face", "模块方向必须与用户选择同步");
assert.equal(turnedToWidth.placements[0].perCol, 46);
turnedToWidth.faceOrientation = "length";
recalculateLoadedPlanogram(result);
assert.equal(turnedToWidth.faceWidth, 240, "再次切回长做陈列面必须使用产品长");
assert.equal(turnedToWidth.perCol, 92, "再次切回长做陈列面必须按产品宽计算堆叠");
assert.equal(turnedToWidth.placements[0].orientation, "length-face");
assert.equal(turnedToWidth.placements[0].perCol, 92);
assert.deepEqual(result.skus.map(row => [row.id, row.cabinetKey, row.position]), originalLocations, "重算不得改变柜段和位置");
assert.equal(Object.hasOwn(chest, "externalCountOverride"), false, "旧外储覆盖值不能继续遮蔽新满陈");
assert.equal(Object.hasOwn(chest, "staticExternalOverride"), false);
assert.equal(Object.hasOwn(chest, "avgExternalOverride"), false);

console.log("loaded planogram capacity recalculation: PASS");


