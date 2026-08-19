import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { isIceProduct, stableSkuKey, clone } from "./common.mjs";
import { calculateSkuInventoryMetrics, summarizeStoreInventoryMetrics } from "./inventory-metrics.mjs";
import {
  buildIncrementalMetricsSignature,
  buildIncrementalPlanSignature,
  runIncrementalReplan
} from "./incremental-replan.mjs";
import { runGoldenBaseline } from "./golden-baseline/golden-baseline-test.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const physical = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));
const STORE_NAMES = ["宁国津河西路生活馆", "和县生活馆", "当涂阳光里生活馆"];
const NOOP_MESSAGE = "当前产品池及柜体未发生需要重排的变化，保持现有排柜。";

function key(value) {
  return stableSkuKey(value);
}

function productIce(product) {
  return typeof product?.ice === "boolean" ? product.ice : isIceProduct(product);
}

function isStorage(cabinet) {
  return /立柜/.test(`${cabinet.label || ""}|${cabinet.kind || ""}|${cabinet.type || ""}`) && /第\s*6\s*层/.test(cabinet.position || "");
}

function isIceCabinet(cabinet) {
  return /冰淇淋|冰柜/.test(`${cabinet.label || ""}|${cabinet.kind || ""}|${cabinet.type || ""}`);
}

function buildCabinets(store) {
  return data.cabinets.filter(cabinet => cabinet.store === store).map(cabinet => ({
    ...clone(cabinet),
    key: cabinet.key || `${cabinet.store}__${cabinet.label}__${cabinet.position}`,
    saleEligible: !isStorage(cabinet),
    storageOnly: isStorage(cabinet),
    iceOnly: isIceCabinet(cabinet),
    usedWidth: 0,
    leftWidth: Number(cabinet.length) || 0,
    overWidth: false
  }));
}

function makeRow(product, source, included) {
  const faceWidth = Number(source?.faceWidth || source?.length || product.length) || 0;
  const perCol = Number(source?.perCol || 1) || 1;
  const displayCols = included ? Math.max(1, Number(source?.displayCols || 1)) : 0;
  return {
    ...clone(product),
    ...clone(source || {}),
    skuKey: key(product),
    barcode: product.barcode,
    name: product.name,
    included,
    excludedForStore: !included,
    cabinetKey: included ? (source.cabinetKey || source.segmentKey || "") : "",
    segmentKey: included ? (source.segmentKey || source.cabinetKey || "") : "",
    orientation: included ? (source.orientation || (faceWidth === Number(product.width) ? "width-face" : "length-face")) : "",
    faceWidth,
    perCol,
    displayCols,
    usedWidth: faceWidth * displayCols,
    ice: productIce(product),
    metrics: included ? calculateSkuInventoryMetrics({
      perCol,
      displayCols,
      cartonQty: product.carton,
      triggerRate: data.params.triggerRate,
      unitVolumeL: product.volume,
      dailyQty: product.dailyQty,
      faceWidth
    }) : null,
    reasonCode: included ? "" : (source?.reasonCode || "STORE_CAPACITY_PRIORITY"),
    reason: included ? "" : (source?.reason || "现有柜体容量及商品结构下，本店暂不纳入该商品。")
  };
}

function buildCurrentPlan(store) {
  const pool = data.productPool.filter(product => product.active !== false);
  const byKey = new Map(pool.map(product => [key(product), product]));
  const selected = new Map(data.skus.filter(row => row.store === store).map(row => [key(row), row]));
  const historicalExcluded = new Map(data.excluded.filter(row => row.store === store).map(row => [key(row), row]));
  const cabinets = buildCabinets(store);
  const rows = pool.map(product => {
    const productKey = key(product);
    if (selected.has(productKey)) {
      const source = selected.get(productKey);
      const cabinet = cabinets.find(item => item.key === (source.cabinetKey || source.segmentKey));
      const faceWidth = Number(source.faceWidth || source.length || product.length) || 0;
      const requestedCols = Math.max(1, Number(source.displayCols || 1));
      const availableCols = cabinet && faceWidth > 0 ? Math.floor((cabinet.length - cabinet.usedWidth) / faceWidth) : 0;
      const compatible = cabinet && cabinet.saleEligible && cabinet.iceOnly === productIce(product);
      if (compatible && availableCols > 0) {
        const safeSource = { ...source, displayCols: Math.min(requestedCols, availableCols), faceWidth };
        const row = makeRow(product, safeSource, true);
        cabinet.usedWidth += row.usedWidth;
        return row;
      }
    }
    return makeRow(product, historicalExcluded.get(productKey), false);
  });
  for (const cabinet of cabinets) {
    cabinet.leftWidth = cabinet.length - cabinet.usedWidth;
    cabinet.overWidth = cabinet.leftWidth < 0;
  }
  const summarize = () => summarizeStoreInventoryMetrics(rows.filter(row => row.included).map(row => row.metrics), data.params);
  let inventory = summarize();
  while (inventory.suggestedExternalL > 754) {
    const removable = rows.filter(row => row.included && row.metrics?.externalUnits > 0).sort((left, right) => {
      const leftValue = (Number(left.dailyQty) || 0) * 100000 + (Number(left.rank) || 999999) * -1;
      const rightValue = (Number(right.dailyQty) || 0) * 100000 + (Number(right.rank) || 999999) * -1;
      return leftValue - rightValue || (right.metrics.staticExternalL - left.metrics.staticExternalL) || key(left).localeCompare(key(right));
    })[0];
    if (!removable) break;
    const cabinet = cabinets.find(item => item.key === removable.segmentKey);
    if (cabinet) cabinet.usedWidth -= removable.usedWidth;
    Object.assign(removable, makeRow(byKey.get(key(removable)), removable, false));
    inventory = summarize();
  }
  const summary = {
    candidateSkuCount: rows.length,
    includedSkuCount: rows.filter(row => row.included).length,
    excludedForStoreCount: rows.filter(row => !row.included).length,
    placedSkuCount: rows.filter(row => row.included).length,
    unplacedSkuCount: rows.filter(row => !row.included).length,
    directCaseSkuCount: inventory.directCaseSkuCount,
    externalSkuCount: inventory.externalSkuCount,
    staticExternalL: inventory.staticExternalL,
    avgExternalL: inventory.avgExternalL,
    suggestedExternalL: inventory.suggestedExternalL,
    usedWidth: cabinets.reduce((sum, cabinet) => sum + cabinet.usedWidth, 0),
    remainingWidth: cabinets.reduce((sum, cabinet) => sum + Math.max(0, cabinet.leftWidth), 0),
    overWidthCount: cabinets.filter(cabinet => cabinet.overWidth).length
  };
  return { version: "test-current-plan-v1", store, params: { ...data.params, externalCapL: 754 }, cabinets, rows, summary, status: "passed" };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function planMap() {
  return new Map(data.stores.map(store => [store.store, buildCurrentPlan(store.store)]));
}

function signatureSnapshot(plan) {
  return {
    skuSet: plan.rows.map(row => `${key(row)}:${row.included !== false ? "included" : "excluded"}`).sort().join("||"),
    placements: plan.rows.map(row => `${key(row)}:${row.segmentKey || row.cabinetKey || ""}`).sort().join("||"),
    orientations: plan.rows.map(row => `${key(row)}:${row.orientation || ""}`).sort().join("||"),
    displayCols: plan.rows.map(row => `${key(row)}:${row.displayCols || 0}`).sort().join("||"),
    planSignature: buildIncrementalPlanSignature(plan),
    metricsSignature: buildIncrementalMetricsSignature(plan)
  };
}

function runZeroDelta(plans) {
  const results = [];
  for (const store of STORE_NAMES) {
    const currentPlan = plans.get(store);
    const before = signatureSnapshot(currentPlan);
    const result = runIncrementalReplan({
      stores: [store], currentPlans: new Map([[store, currentPlan]]), productPool: data.productPool,
      cabinets: data.cabinets, params: data.params, physicalRecords: physical.records,
      delta: {}, mode: "affected"
    }).results[0];
    const after = signatureSnapshot(result.replanDraft);
    const unchanged = JSON.stringify(before) === JSON.stringify(after) && result.affected === false && result.replanDraft.message === NOOP_MESSAGE;
    assert(unchanged, `${store} zero-delta不是100% NO-OP`);
    results.push({ store, unchanged, before, after, status: result.status });
  }
  return results;
}

function chooseRetirementSku(plans) {
  const counts = new Map();
  for (const plan of plans.values()) for (const row of plan.rows.filter(item => item.included)) counts.set(key(row), (counts.get(key(row)) || 0) + 1);
  const partial = [...counts.entries()].filter(([, count]) => count > 1 && count < plans.size);
  return (partial.length ? partial : [...counts.entries()]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function runRetirement(plans, retirementKey) {
  const oldProduct = data.productPool.find(product => key(product) === retirementKey);
  const changedPool = data.productPool.map(product => key(product) === retirementKey ? { ...product, active: false } : clone(product));
  const before = new Map([...plans].map(([store, plan]) => [store, signatureSnapshot(plan)]));
  const started = performance.now();
  const run = runIncrementalReplan({
    stores: data.stores.map(store => store.store), currentPlans: plans, productPool: changedPool,
    cabinets: data.cabinets, params: data.params, physicalRecords: physical.records,
    delta: { removedProducts: [oldProduct] }, mode: "affected"
  });
  const repeat = runIncrementalReplan({
    stores: data.stores.map(store => store.store), currentPlans: plans, productPool: changedPool,
    cabinets: data.cabinets, params: data.params, physicalRecords: physical.records,
    delta: { removedProducts: [oldProduct] }, mode: "affected"
  });
  const deterministic = JSON.stringify(run.results.map(result => [result.store, result.afterPlanSignature, result.actionSequenceSignature, result.metricsSignature]))
    === JSON.stringify(repeat.results.map(result => [result.store, result.afterPlanSignature, result.actionSequenceSignature, result.metricsSignature]));
  assert(deterministic, "淘汰增量重排重复运行签名不一致");
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const affected = run.results.filter(result => result.affected);
  const unaffected = run.results.filter(result => !result.affected);
  const unchangedUnaffected = unaffected.filter(result => result.beforePlanSignature === before.get(result.store).planSignature).length;
  const invalidUnrelatedMoves = affected.filter(result => result.movedSkuCount > 2).length;
  assert(unaffected.length + affected.length === data.stores.length, "淘汰测试门店结果不完整");
  assert(unchangedUnaffected === unaffected.length, "未经营淘汰SKU的门店方案发生变化");
  assert(invalidUnrelatedMoves === 0, "淘汰单SKU造成了不必要的整店移动");
  assert(affected.every(result => !result.fullReplanCalled), "淘汰测试错误触发完整重排");
  return {
    sku: retirementKey,
    name: oldProduct.name,
    affectedStoreCount: affected.length,
    unaffectedStoreCount: unaffected.length,
    unaffectedStores: unaffected.map(result => result.store),
    unchangedUnaffectedStoreCount: unchangedUnaffected,
    erroneousFullReplanStoreCount: affected.filter(result => result.fullReplanCalled).length,
    invalidUnrelatedMoveStoreCount: invalidUnrelatedMoves,
    deterministic,
    averageMovedSkuCount: affected.length ? affected.reduce((sum, result) => sum + result.movedSkuCount, 0) / affected.length : 0,
    fullReplanCalled: affected.some(result => result.fullReplanCalled),
    stores: affected.map(result => ({ store: result.store, beforeSuggestedExternalL: result.changeSummary.beforeSuggestedExternalL, afterSuggestedExternalL: result.changeSummary.afterSuggestedExternalL, removedSku: retirementKey, actions: result.actions, movedSkuCount: result.movedSkuCount, validation: result.validation })),
    elapsedMs
  };
}

function runAddition(plans) {
  const seed = data.productPool.find(product => product.active !== false);
  const newProduct = {
    ...clone(seed), barcode: "incremental-test-new-sku", id: "incremental-test-new-sku", name: "增量测试新品", active: true,
    dailyQty: Math.max(1, Number(seed.dailyQty) || 1), grade: "A", rank: 1
  };
  const changedPool = [...data.productPool.map(clone), newProduct];
  const before = new Map([...plans].map(([store, plan]) => [store, signatureSnapshot(plan)]));
  const run = runIncrementalReplan({
    stores: data.stores.map(store => store.store), currentPlans: plans, productPool: changedPool,
    cabinets: data.cabinets, params: data.params, physicalRecords: physical.records,
    delta: { addedProducts: [newProduct] }, mode: "affected"
  });
  const repeat = runIncrementalReplan({
    stores: data.stores.map(store => store.store), currentPlans: plans, productPool: changedPool,
    cabinets: data.cabinets, params: data.params, physicalRecords: physical.records,
    delta: { addedProducts: [newProduct] }, mode: "affected"
  });
  const deterministic = JSON.stringify(run.results.map(result => [result.store, result.afterPlanSignature, result.actionSequenceSignature, result.metricsSignature]))
    === JSON.stringify(repeat.results.map(result => [result.store, result.afterPlanSignature, result.actionSequenceSignature, result.metricsSignature]));
  assert(deterministic, "新品增量重排重复运行签名不一致");
  const affected = run.results.filter(result => result.affected);
  const unaffected = run.results.filter(result => !result.affected);
  const unchangedUnaffected = unaffected.filter(result => result.beforePlanSignature === before.get(result.store).planSignature).length;
  assert(unaffected.length + affected.length === data.stores.length, "新品测试门店结果不完整");
  assert(unchangedUnaffected === unaffected.length, "新品未影响门店方案发生变化");
  assert(affected.every(result => !result.fullReplanCalled), "新品测试错误触发完整重排");
  const physicalFailures = affected.filter(result => result.validation.errors.filter(error => /柜段超宽|第6层|冰品柜隔离|SKU指标/.test(error)).length > 0);
  assert(physicalFailures.length === 0, `新品局部方案出现物理安全错误：${JSON.stringify(physicalFailures.map(result => ({ store: result.store, errors: result.validation.errors })))}`);
  return {
    sku: newProduct.barcode,
    affectedStoreCount: affected.length,
    includedStoreCount: affected.filter(result => result.replanDraft.rows.some(row => key(row) === newProduct.barcode && row.included !== false)).length,
    excludedStoreCount: affected.filter(result => result.replanDraft.rows.some(row => key(row) === newProduct.barcode && row.included === false)).length,
    unaffectedStoreCount: unaffected.length,
    unaffectedStores: unaffected.map(result => result.store),
    unchangedUnaffectedStoreCount: unchangedUnaffected,
    averageMovedSkuCount: affected.length ? affected.reduce((sum, result) => sum + result.movedSkuCount, 0) / affected.length : 0,
    swapCount: affected.reduce((sum, result) => sum + result.actions.filter(action => action.type === "one-for-one-swap").length, 0),
    erroneousFullReplanStoreCount: affected.filter(result => result.fullReplanCalled).length,
    deterministic,
    stores: affected.map(result => ({ store: result.store, included: result.replanDraft.rows.find(row => key(row) === newProduct.barcode)?.included !== false, placement: result.replanDraft.rows.find(row => key(row) === newProduct.barcode)?.segmentKey || "", orientation: result.replanDraft.rows.find(row => key(row) === newProduct.barcode)?.orientation || "", movedSkuCount: result.movedSkuCount, swap: result.actions.some(action => action.type === "one-for-one-swap"), beforeSuggestedExternalL: result.changeSummary.beforeSuggestedExternalL, afterSuggestedExternalL: result.changeSummary.afterSuggestedExternalL, validation: result.validation }))
  };
}

const startedAt = performance.now();
const golden = runGoldenBaseline({ print: false });
assert(golden.ok, "1817黄金物理基准未通过");
const plans = planMap();
const zeroDelta = runZeroDelta(plans);
const retirementSku = chooseRetirementSku(plans);
const retirement = runRetirement(plans, retirementSku);
const addition = runAddition(plans);
const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;

console.log(JSON.stringify({
  test: "currentPlan + delta incremental replan",
  architecture: "currentPlan + delta",
  golden: { ok: golden.ok, assertionCount: golden.assertionCount, failureCount: golden.failureCount },
  zeroDelta,
  retirement,
  addition,
  scope: { fullAllocationCoreModified: false, originalUiModified: false, formalDataModified: false, commit: false, push: false },
  elapsedMs
}, null, 2));
