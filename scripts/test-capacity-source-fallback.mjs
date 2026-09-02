import assert from "node:assert/strict";
import fs from "node:fs";
import { recalculateLoadedPlanogram } from "./live-planogram-capacity.mjs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(
  app,
  /正式产品池/,
  "容量计算必须有正式产品池兜底，不能因为当前草稿产品池缺少一条记录就沿用旧容量",
);
assert.match(
  app,
  /formalProductPool/,
  "已加载陈列容量必须把正式产品池作为只读计算兜底传入",
);
assert.match(
  app,
  /function 当前产品池\(state=状态\)\{return Array\.isArray\(state\?\.productPool\)&&state\.productPool\.length\?state\.productPool:\[\]\}/,
  "手动容量计算不能把空产品池按历史 SKU 行重新生成",
);
assert.match(
  app,
  /if\(Array\.isArray\(patch\.productPool\)&&patch\.productPool\.length\)state\.productPool=patch\.productPool/,
  "读取补丁时空产品池不得覆盖正式产品池",
);

const cabinet = {
  key: "NEW__立柜3m-柜1__第3层",
  store: "NEW",
  label: "立柜3m-柜1",
  position: "第3层",
  kind: "立柜",
  length: 710,
  depth: 534,
  height: 250,
};
const product = {
  barcode: "6971806122026",
  name: "抽肠青虾仁150g",
  length: 275,
  width: 205,
  height: 25,
  volume: 1.409,
};
const state = {
  params: { triggerRate: 0.1 },
  productPool: [],
  formalProductPool: [product],
  cabinets: [cabinet],
  skus: [{
    id: "new-store-legacy-row",
    store: "NEW",
    barcode: product.barcode,
    name: product.name,
    // Legacy placement data must not become the product height.
    length: product.length,
    width: product.width,
    height: 275,
    volume: product.volume,
    included: true,
    cabinetKey: cabinet.key,
    cabinetLabel: cabinet.label,
    position: cabinet.position,
    faceOrientation: "width",
    displayCols: 3,
    perCol: 1,
    rowFull: 3,
    placements: [{
      cabinetKey: cabinet.key,
      displayCols: 3,
      perCol: 1,
      fullCount: 3,
    }],
  }],
};

const beforeProduct = { ...state.skus[0] };
recalculateLoadedPlanogram(state);
const row = state.skus[0];

assert.equal(row.perCol, 21, "正式产品池兜底后，立柜应按534÷25向下取整为21件/列");
assert.equal(row.rowFull, 63, "3列陈列的满陈必须为63件");
assert.equal(row.placements[0].perCol, 21);
assert.equal(row.placements[0].fullCount, 63);
assert.equal(row.height, beforeProduct.height, "容量修复不得回写用户当前SKU的商品高度字段");

console.log("capacity source fallback regression: PASS");
