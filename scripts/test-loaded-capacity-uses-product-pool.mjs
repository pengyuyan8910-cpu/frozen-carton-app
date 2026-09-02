import assert from "node:assert/strict";
import fs from "node:fs";
import { recalculateLoadedPlanogram } from "./live-planogram-capacity.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const bootstrapSource = fs.readFileSync(new URL("../bootstrap.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(appSource, /function SKU计算行\(r/,
  "手动切换陈列面必须使用产品池的原始商品尺寸");
assert.match(appSource, /const dims=SKU计算行\(r\)/,
  "柜型容量计算必须通过统一商品尺寸来源");
assert.match(bootstrapSource, /20260902_product_dimensions_v1/,
  "容量模块和 app.js 修改后必须更新缓存版本");
assert.match(indexSource, /bootstrap\.js\?v=20260902_product_dimensions_v1/,
  "入口必须引用新的 bootstrap 缓存版本");

const cabinet = {
  key: "STORE__立柜3m-柜1__第3层",
  store: "STORE",
  label: "立柜3m-柜1",
  position: "第3层",
  kind: "立柜",
  length: 710,
  depth: 534,
  height: 250
};

const state = {
  params: { triggerRate: 0.1 },
  productPool: [{
    id: "pool- shrimp",
    barcode: "6971806122026",
    name: "抽肠青虾仁150g",
    length: 275,
    width: 205,
    height: 25,
    volume: 1.409,
    active: true
  }],
  cabinets: [cabinet],
  skus: [{
    id: "corrupted-saved-row",
    store: "STORE",
    barcode: "6971806122026",
    name: "抽肠青虾仁150g",
    // These are legacy placement values accidentally persisted as product data.
    length: 275,
    width: 205,
    height: 275,
    volume: 1.409,
    carton: 30,
    included: true,
    cabinetKey: cabinet.key,
    cabinetLabel: cabinet.label,
    position: cabinet.position,
    faceOrientation: "width",
    displayCols: 3,
    faceWidth: 205,
    perCol: 1,
    rowFull: 3,
    placements: [{
      cabinetKey: cabinet.key,
      orientation: "width-face",
      displayCols: 3,
      faceWidth: 205,
      perCol: 1,
      fullCount: 3,
      height: 275
    }]
  }]
};

const result = recalculateLoadedPlanogram(state);
const row = result.skus[0];

assert.equal(row.perCol, 21, "已保存的错误摆放高度不能覆盖产品池真实高度25mm");
assert.equal(row.rowFull, 63, "3列必须按21件/列得到63件满陈");
assert.equal(row.placements[0].perCol, 21);
assert.equal(row.placements[0].fullCount, 63);
assert.equal(row.height, 275, "本次容量修复不得回写或覆盖用户现有SKU字段");

console.log("saved capacity uses canonical product dimensions: PASS");
