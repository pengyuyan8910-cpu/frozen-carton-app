import assert from "node:assert/strict";
import fs from "node:fs";
import { runStrictAllocation } from "./strict-allocation-adapter.mjs";
import { normalizeNewStorePlanogramRows } from "./planogram-projection.mjs";
import { recalculateLoadedPlanogram } from "./live-planogram-capacity.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const appendStart = appSource.indexOf("window.追加新增门店=");
const appendEnd = appSource.indexOf("function 产品池字段", appendStart);
assert.ok(appendStart >= 0 && appendEnd > appendStart, "未找到新增门店追加入口");
const appendSource = appSource.slice(appendStart, appendEnd);
assert.match(
  appendSource,
  /刷新已加载陈列容量\(\{params:状态\.params,cabinets:pre\.cabinets,skus:newRows\}\)/,
  "新增门店转成当前页面行后必须按实际新增柜体重新回填物理容量"
);

const store = "NEW_STORE_CAPACITY_HYDRATION";
const product = {
  id: "capacity-product",
  barcode: "6971806122026",
  name: "抽肠青虾仁150g",
  category3: "冷冻食材",
  category4: "冷冻水产",
  grade: "C",
  rank: 36,
  length: 275,
  width: 205,
  height: 25,
  volume: 1.409,
  carton: 30,
  dailyQty: 0.5774,
  active: true,
};
const cabinet = {
  key: `${store}__立柜3m-柜1__第3层`,
  store,
  label: "立柜3m-柜1",
  position: "第3层",
  kind: "立柜",
  type: "3m",
  length: 710,
  depth: 534,
  height: 250,
  physicalSource: "test",
};
const input = {
  store,
  productPool: [product],
  cabinets: [cabinet],
  params: { triggerRate: 0.1, p95Factor: 1, externalSafetyFactor: 1.2, externalCapL: 754 },
  physicalRecords: [],
};

const plan = runStrictAllocation(input, { maxIterations: 0, maxExpansions: 0 });
const sourceRow = plan.rows[0];
assert.equal(sourceRow.placements[0].perCol, 21, "严格引擎必须按534÷25向下取整为21");

const newRows = normalizeNewStorePlanogramRows([sourceRow]);
assert.equal(newRows[0].length, 275, "模块转换不能改写商品长");
assert.equal(newRows[0].width, 205, "模块转换不能改写商品宽");
assert.equal(newRows[0].height, 25, "模块转换不能把摆放高度写回商品高度");
recalculateLoadedPlanogram({ params: input.params, cabinets: [cabinet], skus: newRows });
assert.equal(newRows[0].perCol, 21, "新增门店行入页后单列容量必须仍为21");
assert.equal(newRows[0].rowFull, 42, "新增门店行入页后两列满陈必须为42");
assert.equal(newRows[0].placements[0].perCol, 21, "新增门店模块容量必须与行容量一致");

console.log("new-store capacity hydration: PASS");
