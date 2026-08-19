import assert from "node:assert/strict";
import fs from "node:fs";
import { allocateStore } from "./strict-allocation-engine.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bootstrapSource = fs.readFileSync(new URL("../bootstrap.js", import.meta.url), "utf8");
const engineSource = fs.readFileSync(new URL("./strict-allocation-engine.mjs", import.meta.url), "utf8");
const draftSource = fs.readFileSync(new URL("./generate-new-store-draft.mjs", import.meta.url), "utf8");

const strictAssignment = appSource.lastIndexOf("预排新增门店=function");
assert.ok(strictAssignment >= 0, "新增门店必须有唯一运行时入口");
const strictBody = appSource.slice(strictAssignment, appSource.indexOf("window.改新增门店SKU", strictAssignment));
assert.match(strictBody, /StrictAllocationAdapter\.allocateStore|adapter\?\.allocateStore/, "新增门店必须调用严格排柜适配层");
assert.doesNotMatch(strictBody, /原预排新增门店_严格版|新店压缩到可执行|chooseCab/, "新增门店运行时不得调用旧贪心路径");
assert.match(indexSource, /scripts\/strict-allocation-engine\.mjs/, "页面必须加载严格排柜引擎");
assert.match(indexSource, /scripts\/strict-allocation-adapter\.mjs/, "页面必须加载严格排柜适配层");
assert.match(bootstrapSource, /strict-allocation-adapter\.mjs/, "数据加载完成后必须保证适配层先于 app.js 加载");
assert.doesNotMatch(appSource, /function 估算陈列面\(r,c\)\{const dims=\[数\(r\.length\),数\(r\.width\),数\(r\.height\)\]/, "运营端占宽不得把产品高纳入候选尺寸");
assert.doesNotMatch(engineSource, /height-face|faceWidth\s*:\s*H/, "严格引擎不得把产品高作为横向占宽");
assert.doesNotMatch(engineSource, /reserved[^\n]*柜4|柜4[^\n]*reserved/, "严格引擎不得保留柜4预留特例");
assert.match(draftSource, /strict-allocation-engine\.mjs/, "自动草稿必须引用统一严格引擎");
assert.match(draftSource, /function strictSolve\(/, "自动草稿必须有严格测算入口");
assert.match(draftSource, /solve\s*=\s*strictSolve/, "自动草稿不得继续使用旧贪心求解入口");
assert.match(draftSource, /verify\s*=\s*strictVerify/, "自动草稿必须使用严格复核结果");
assert.doesNotMatch(draftSource, /function isReserve\(|reserved vertical cabinet 4|U\.cab\+'4\$'/, "自动草稿不得残留新店柜4预留旧算法");

const store = "NEW_STORE_ROUTE_TEST";
const product = {
  active: true,
  lifecycleStatus: "在售SKU",
  name: "新增门店尺寸规则测试商品",
  barcode: "NEW-STORE-ROUTE-1",
  grade: "A",
  rank: 1,
  category2: "预制主食",
  category3: "冷冻食材",
  category4: "测试品类",
  length: 270,
  width: 220,
  height: 70,
  volume: 2,
  carton: 10,
  dailyQty: 1
};
const oversized = {...product, barcode: "NEW-STORE-ROUTE-OVERSIZED", name: "新增门店尺寸不适配测试商品", length: 900, width: 800};
const cabinets = [
  {store, key: `${store}__立柜1__第1层`, label: "立柜1", position: "第1层", kind: "立柜", length: 710, depth: 534, height: 250, status: "正常"},
  {store, key: `${store}__立柜1__第6层`, label: "立柜1", position: "第6层", kind: "立柜", length: 710, depth: 534, height: 250, status: "存储位"}
];
const plan = allocateStore({
  store,
  type: "新店",
  productPool: [product, oversized],
  cabinets,
  params: {triggerRate: 0.1, externalCapL: 754, p95Factor: 1, externalSafetyFactor: 1.2}
});
const placed = plan.skuDecisions.find(row => row.barcode === product.barcode);
assert.equal(placed?.included, true, "新增门店严格引擎应生成陈列方案");
assert.ok([product.length, product.width].includes(placed.placements[0].faceWidth), "新增门店占宽只能取产品长或宽");
const unplaced = plan.skuDecisions.find(row => row.barcode === oversized.barcode);
assert.equal(unplaced?.included, false, "尺寸不适配SKU不得被强行纳入");
assert.ok(unplaced?.reason, "未排入SKU必须保留明确原因");
assert.equal(plan.validation.ok, true, "严格方案硬规则应通过");
assert.equal(plan.summary.unplacedSkuCount, 1, "未排入SKU数量应准确保留");
assert.equal(plan.skus.some(row => row.cabinetKey?.includes("第6层")), false, "新增门店不得使用立柜第6层销售陈列");

const reserveStore = "CABINET4_RESERVE_GUARD";
const reserveProduct = {...product, barcode: "CABINET4-RESERVE-1", name: "柜4预留保护测试商品", carton: 1};
const reservedCabinet4 = [{
  store: reserveStore,
  key: `${reserveStore}__立柜3m-柜4__第1层`,
  label: "立柜3m-柜4",
  position: "第1层",
  kind: "立柜",
  length: 710,
  depth: 534,
  height: 250,
  status: "其他品类预留"
}];
const reservedPlan = allocateStore({
  store: reserveStore,
  type: "新店",
  productPool: [reserveProduct],
  cabinets: reservedCabinet4,
  params: {triggerRate: 0.1, externalCapL: 754, p95Factor: 1, externalSafetyFactor: 1.2}
});
assert.equal(reservedPlan.skuDecisions[0]?.included, false, "标记为其他品类预留的柜段不得因柜号为4而重新变成销售位");

const normalCabinet4Plan = allocateStore({
  store: reserveStore,
  type: "新店",
  productPool: [reserveProduct],
  cabinets: reservedCabinet4.map(c => ({...c, key: `${reserveStore}__立柜3m-柜4__第2层`, position: "第2层", status: "正常"})),
  params: {triggerRate: 0.1, externalCapL: 754, p95Factor: 1, externalSafetyFactor: 1.2}
});
assert.equal(normalCabinet4Plan.skuDecisions[0]?.included, true, "正常柜4必须与其他销售柜段一视同仁参与排柜");

console.log("new store routing rule passed");
