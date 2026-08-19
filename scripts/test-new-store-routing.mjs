import assert from "node:assert/strict";
import fs from "node:fs";
import { runStrictAllocation } from "./strict-allocation-adapter.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const strictAssignment = appSource.lastIndexOf("预排新增门店=function");
assert.ok(strictAssignment >= 0, "新增门店必须有唯一的运行时入口");
const strictBody = appSource.slice(strictAssignment, appSource.indexOf("window.改新增门店SKU", strictAssignment));
assert.match(strictBody, /adapter\?\.allocateStore|adapter\.allocateStore/, "新增门店必须调用严格排柜适配层");
assert.doesNotMatch(strictBody, /原预排新增门店_严格版|新店压缩到可执行|chooseCab/, "新增门店运行时不得调用旧贪心路径");
assert.match(indexSource, /scripts\/strict-allocation-engine\.mjs/, "页面必须加载严格排柜引擎");
assert.match(indexSource, /scripts\/strict-allocation-adapter\.mjs/, "页面必须加载严格排柜适配层");
assert.doesNotMatch(appSource, /function 估算陈列面\(r,c\)\{const dims=\[数\(r\.length\),数\(r\.width\),数\(r\.height\)\]/, "运营端占宽不得把产品高纳入候选尺寸");

const store = "NEW_STORE_ROUTE_TEST";
const product = {
  id: "new-store-route-product",
  barcode: "NEW-STORE-ROUTE-1",
  name: "新增门店尺寸规则测试商品",
  category3: "冷冻食材",
  category4: "测试品类",
  grade: "A",
  rank: 1,
  length: 270,
  width: 220,
  height: 70,
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
  physicalSource: "test"
};
const plan = runStrictAllocation({
  store,
  productPool: [product],
  cabinets: [cabinet],
  params: { triggerRate: 0.1, p95Factor: 1, externalSafetyFactor: 1.2, externalCapL: 754 },
  physicalRecords: []
}, { maxIterations: 0, maxExpansions: 0 });
const placement = plan.rows[0]?.placements[0];
assert.ok(placement, "新增门店严格引擎应生成陈列方案");
assert.ok([product.length, product.width].includes(placement.faceWidth), "新增门店占宽只能取产品长或宽");
assert.notEqual(placement.faceWidth, product.height, "新增门店产品高不能作为占宽");
assert.equal(plan.validation.conservationOk, true, "新增门店必须保持 SKU 守恒");
assert.equal(plan.summary.overWidthCount, 0, "新增门店不得产生柜段超宽");
assert.equal(plan.summary.layer6SalesCount, 0, "新增门店不得使用立柜第6层销售陈列");

console.log("new store routing rule passed");
