import fs from "node:fs";
import {
  calculatePhysicalCandidates,
  calculateSkuInventoryMetrics,
  detectStoreImpact,
  loadAndValidatePhase0,
  runPhase0To4,
  summarizeStoreInventoryMetrics
} from "./index.mjs";
import { assertGoldenBaseline } from "./golden-baseline/golden-gate.mjs";

try {
  assertGoldenBaseline();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const startedAt = Date.now();
const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));
const stores = [
  "和县生活馆",
  "宁国津河西路生活馆",
  "当涂阳光里生活馆",
  "宁国上乘财富中心生活馆"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function signature(result) {
  return JSON.stringify(result.phase4.temporaryIncluded
    .map(row => `${row.skuKey}|${row.cabinetKey}|${row.orientation}|${row.displayCols}`)
    .sort());
}

function syntheticProduct(overrides = {}) {
  return {
    barcode: "synthetic-1",
    name: "物理规则测试商品",
    active: true,
    length: 100,
    width: 100,
    height: 100,
    volume: 1,
    carton: 20,
    dailyQty: 1,
    grade: "B",
    rank: 1,
    category3: "测试三级类目",
    category4: "测试四级品类",
    allowedOrientations: ["length-face"],
    ...overrides
  };
}

function syntheticCabinet(overrides = {}) {
  return {
    key: "测试门店__立柜3m-柜1__第1层",
    store: "测试门店",
    label: "立柜3m-柜1",
    position: "第1层",
    kind: "立柜",
    type: "立柜",
    length: 710,
    depth: 500,
    height: 500,
    status: "正常",
    physicalSource: "test-confirmed",
    ...overrides
  };
}

function physicalRuleTests() {
  const product = syntheticProduct();
  const baseInput = { store: "测试门店", productPool: [product], params: data.params };
  const vertical0 = loadAndValidatePhase0({ ...baseInput, cabinets: [syntheticCabinet()] });
  const vertical1 = calculatePhysicalCandidates(vertical0);
  const verticalCandidate = vertical1.candidatesBySku.get(product.barcode)[0];
  assert(verticalCandidate.stackCount === 1, "立柜销售层不得根据高度自动堆叠");
  assert(verticalCandidate.perCol === 5, "立柜单列容量必须只按纵深计算");

  const verticalRoundingProduct = syntheticProduct({
    barcode: "synthetic-vertical-rounding",
    length: 240,
    width: 300,
    height: 20,
    allowedOrientations: ["length-face", "width-face"]
  });
  const verticalRounding0 = loadAndValidatePhase0({
    ...baseInput,
    productPool: [verticalRoundingProduct],
    cabinets: [syntheticCabinet({ depth: 534, height: 250 })]
  });
  const verticalRoundingCandidate = calculatePhysicalCandidates(verticalRounding0).candidatesBySku.get(verticalRoundingProduct.barcode)
    .find(candidate => candidate.orientation === "width-face");
  assert(verticalRoundingCandidate?.orientedDepth === 20, "立柜必须用商品高作为纵深");
  assert(verticalRoundingCandidate?.orientedHeight === 240, "立柜宽做陈列面时商品长作为层高");
  assert(verticalRoundingCandidate?.depthCount === 26 && verticalRoundingCandidate?.perCol === 26, "立柜纵深除法必须按实际尺寸向下取整：534÷20=26.7→26");

  const chestRoundingProduct = syntheticProduct({
    barcode: "synthetic-chest-rounding",
    length: 240,
    width: 800,
    height: 20,
    allowedOrientations: ["length-face", "width-face"]
  });
  const chestRounding0 = loadAndValidatePhase0({
    ...baseInput,
    productPool: [chestRoundingProduct],
    cabinets: [syntheticCabinet({ key: "测试门店__卧柜rounding__分区1", label: "卧柜rounding", position: "分区1", kind: "卧柜", type: "卧柜", length: 1988, depth: 697, height: 460 })]
  });
  const chestRoundingCandidate = calculatePhysicalCandidates(chestRounding0).candidatesBySku.get(chestRoundingProduct.barcode)[0];
  assert(chestRoundingCandidate?.depthCount === 2 && chestRoundingCandidate?.stackCount === 23 && chestRoundingCandidate?.perCol === 46, "卧柜柜体宽度和堆叠除法必须按实际尺寸向下取整：2×23=46");

  const chestWithoutStack = syntheticCabinet({ key: "测试门店__卧柜1__分区1", label: "卧柜1", position: "分区1", kind: "卧柜", type: "卧柜" });
  const chest0 = loadAndValidatePhase0({ ...baseInput, cabinets: [chestWithoutStack] });
  const chestCandidate0 = calculatePhysicalCandidates(chest0).candidatesBySku.get(product.barcode)[0];
  assert(chestCandidate0.stackCount === 5, "卧柜按统一物理规则允许按高度堆叠，不依赖历史allowStack字段");

  const chestWithStack = { ...chestWithoutStack, allowStack: true };
  const chest1 = loadAndValidatePhase0({ ...baseInput, cabinets: [chestWithStack] });
  const chestCandidate1 = calculatePhysicalCandidates(chest1).candidatesBySku.get(product.barcode)[0];
  assert(chestCandidate1.stackCount === 5, "卧柜明确allowStack时仍按真实高度计算堆叠");

  const layer6 = syntheticCabinet({ key: "测试门店__立柜3m-柜1__第6层", position: "第6层" });
  const layer60 = loadAndValidatePhase0({ ...baseInput, cabinets: [layer6] });
  assert(calculatePhysicalCandidates(layer60).allCandidates.length === 0, "立柜第6层不得产生销售候选");

  const ordinaryProduct = syntheticProduct();
  const iceCabinet = syntheticCabinet({ key: "测试门店__冰淇淋柜1__分区1", label: "冰淇淋柜1", position: "分区1", kind: "冰淇淋柜", type: "冰淇淋柜" });
  const ice0 = loadAndValidatePhase0({ ...baseInput, productPool: [ordinaryProduct], cabinets: [iceCabinet] });
  assert(calculatePhysicalCandidates(ice0).allCandidates.length === 0, "普通冻品不得进入冰淇淋柜");

  const cabinet3 = syntheticCabinet({ key: "测试门店__立柜3m-柜3__第1层", label: "立柜3m-柜3" });
  const cabinet4 = syntheticCabinet({ key: "测试门店__立柜3m-柜4__第1层", label: "立柜3m-柜4" });
  const equal0 = loadAndValidatePhase0({ ...baseInput, cabinets: [cabinet3, cabinet4] });
  const equalCandidates = calculatePhysicalCandidates(equal0).candidatesBySku.get(product.barcode);
  assert(equalCandidates.filter(candidate => candidate.cabinetLabel === "立柜3m-柜3").length
    === equalCandidates.filter(candidate => candidate.cabinetLabel === "立柜3m-柜4").length, "柜4不得存在特殊候选限制");

  const metrics = calculateSkuInventoryMetrics({ perCol: 5, displayCols: 2, cartonQty: 20, triggerRate: 0.1, unitVolumeL: 1, dailyQty: 2, faceWidth: 100 });
  assert(metrics.fullDisplay === 10 && metrics.triggerInventory === 1 && metrics.externalUnits === 11 && metrics.staticExternalL === 11, "统一SKU库存公式计算错误");
  const summary = summarizeStoreInventoryMetrics([metrics], data.params);
  assert(summary.suggestedExternalL === Math.ceil((11 / 2) * data.params.p95Factor * data.params.externalSafetyFactor), "统一门店外储公式计算错误");

  const dynamicProducts = [9, 18, 27, 36].map((carton, index) => syntheticProduct({
    barcode: `dynamic-${index + 1}`,
    name: `动态${index + 1}列测试商品`,
    carton,
    grade: "A",
    allowedCabinetTypes: [`测试柜型${index + 1}`]
  }));
  const dynamicCabinets = dynamicProducts.map((product, index) => syntheticCabinet({
    key: `测试门店__测试柜型${index + 1}__分区1`,
    label: `测试柜型${index + 1}`,
    position: "分区1",
    kind: `测试柜型${index + 1}`,
    type: `测试柜型${index + 1}`,
    length: 500,
    depth: 1000,
    height: 100
  }));
  const dynamicResult = runPhase0To4({
    store: "测试门店",
    productPool: dynamicProducts,
    cabinets: dynamicCabinets,
    params: data.params
  });
  assert(dynamicResult.ok, "动态列数合成测试未通过");
  const dynamicColumns = dynamicResult.phase4.temporaryIncluded.map(row => row.displayCols).sort((left, right) => left - right);
  assert(JSON.stringify(dynamicColumns) === JSON.stringify([1, 2, 3, 4]), "动态列数必须能够产生1列、2列、3列和4列结果");

  const previousPlan = { rows: [{ skuKey: product.barcode, included: true }] };
  const removedImpact = detectStoreImpact({
    storeKey: "测试门店",
    changes: { removedProducts: [product] },
    previousPlan
  });
  assert(removedImpact.affected && removedImpact.recommendedAction === "LOCAL_REPLAN", "经营中的淘汰SKU必须触发本店局部重排");
  const unrelatedImpact = detectStoreImpact({
    storeKey: "测试门店",
    changes: { removedProducts: [{ barcode: "not-in-store" }] },
    previousPlan
  });
  assert(!unrelatedImpact.affected && unrelatedImpact.recommendedAction === "KEEP_PREVIOUS_PLAN", "未经营的淘汰SKU不得触发本店重排");
  return {
    name: "PHASE 0–4物理与库存规则",
    passed: true,
    checks: 13
  };
}

const ruleTests = physicalRuleTests();
const storeResults = [];
for (const store of stores) {
  if (Date.now() - startedAt > 180000) throw new Error("快速测试运行时间超过预期，请检查候选计算或循环规模。");
  const input = {
    store,
    productPool: data.productPool,
    cabinets: data.cabinets,
    params: data.params,
    physicalRecords: confirmed.records
  };
  const storeStartedAt = Date.now();
  const first = runPhase0To4(input, { maxRuntimeMs: 120000 });
  const second = runPhase0To4(input, { maxRuntimeMs: 120000 });
  assert(first.ok && second.ok, `${store} PHASE 0–4阶段检查未通过`);
  assert(signature(first) === signature(second), `${store}相同输入结果不一致`);
  const phase4 = first.phase4;
  const summary = phase4.summary;
  assert(summary.candidateSkuCount === data.productPool.filter(product => product.active !== false).length, `${store}候选商品不完整`);
  assert(summary.candidateSkuCount === summary.temporaryIncludedCount + summary.pendingCount, `${store}阶段SKU守恒失败`);
  storeResults.push({
    门店: store,
    候选SKU数: summary.candidateSkuCount,
    基础排入SKU数: summary.temporaryIncludedCount,
    待后续优化SKU数: summary.pendingCount,
    一列SKU数: summary.oneColumnSkuCount,
    二列SKU数: summary.twoColumnSkuCount,
    三列SKU数: summary.threeColumnSkuCount,
    四列及以上SKU数: summary.fourOrMoreColumnSkuCount,
    总陈列列数: summary.totalDisplayColumns,
    直接整箱SKU数: summary.directCaseSkuCount,
    当前静态外储L: summary.staticExternalL,
    当前建议外储L: summary.suggestedExternalL,
    柜段总销售宽度mm: summary.totalSalesWidth,
    已使用宽度mm: summary.usedWidth,
    剩余宽度mm: summary.remainingWidth,
    存在可继续利用空间的柜段数: summary.usableRemainingSegmentCount,
    柜段超宽数: phase4.stageValidation.overWidthCount,
    第6层销售违规数: phase4.stageValidation.layer6SalesCount,
    冰品错柜数: phase4.stageValidation.iceMismatchCount,
    立柜错误堆叠数: phase4.stageValidation.illegalVerticalStackCount,
    确定性: "一致",
    单店两次耗时ms: Date.now() - storeStartedAt
  });
}

const elapsedMs = Date.now() - startedAt;
assert(elapsedMs <= 180000, "快速测试运行时间超过预期，请检查候选计算或循环规模。");
assert(storeResults.some(row => row.二列SKU数 + row.三列SKU数 + row.四列及以上SKU数 > 0), "动态多列没有产生有效结果");

console.log(JSON.stringify({
  测试类型: "PHASE 0–4四店快速测试",
  测试结论: "通过",
  说明: "当前仅为PHASE 4阶段结果，不是最终门店排柜",
  规则测试: ruleTests,
  代表门店: storeResults,
  动态多列: "成功",
  总耗时ms: elapsedMs,
  是否运行30店FULL: "否",
  是否写入正式数据: "否"
}, null, 2));
