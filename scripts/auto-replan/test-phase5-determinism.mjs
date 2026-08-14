import crypto from "node:crypto";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { DETERMINISTIC_SEARCH_BUDGET, runPhase0To5 } from "./index.mjs";
import { assertGoldenBaseline } from "./golden-baseline/golden-gate.mjs";

assertGoldenBaseline();

const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function executeStore(store) {
  const started = performance.now();
  const result = runPhase0To5({
    store,
    productPool: data.productPool,
    cabinets: data.cabinets,
    params: data.params,
    physicalRecords: confirmed.records
  });
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  if (elapsedMs > DETERMINISTIC_SEARCH_BUDGET.outerWatchdogMs) {
    throw new Error("自动排柜运行时间超过安全上限，本次结果未采用。");
  }
  assert(result.phase5, `${store}没有生成柜位优化结果。`);
  return { result, elapsedMs };
}

function summary(run) {
  const phase5 = run.result.phase5;
  const rows = phase5.temporaryIncluded;
  const validation = phase5.phase5Validation;
  return {
    耗时毫秒: run.elapsedMs,
    候选商品: phase5.rankedSkus.length,
    暂时排入商品: rows.length,
    待后续处理商品: phase5.pendingSkus.length,
    总陈列列数: rows.reduce((sum, row) => sum + row.displayCols, 0),
    直接整箱商品: rows.filter(row => row.metrics.directCase).length,
    外储商品: rows.filter(row => row.metrics.externalUnits > 0).length,
    静态外储L: phase5.summary.staticExternalL,
    建议外储L: phase5.summary.suggestedExternalL,
    已用宽度mm: phase5.summary.usedWidth,
    剩余宽度mm: phase5.summary.remainingWidth,
    接受动作数: phase5.phase5Actions.length,
    实际搜索轮数: phase5.summary.searchRoundsExecuted,
    移动候选评估数: phase5.summary.moveCandidatesEvaluated,
    互换候选评估数: phase5.summary.swapCandidatesEvaluated,
    达到固定预算: phase5.summary.deterministicBudgetLimited,
    柜段超宽: validation.overWidthCount,
    宽度账不一致: validation.widthLedgerMismatchCount,
    第6层销售违规: validation.layer6SalesCount,
    冰品错柜: validation.iceMismatchCount,
    列数宽度不同步: validation.placementSyncErrorCount,
    动作序列签名: digest(phase5.actionSequenceSignature),
    最终方案签名: digest(phase5.planSignature),
    指标签名: digest(phase5.metricsSignature)
  };
}

function validatePhysical(store, run) {
  const validation = run.result.phase5.phase5Validation;
  assert(validation.overWidthCount === 0, `${store}存在柜段超宽。`);
  assert(validation.widthLedgerMismatchCount === 0, `${store}存在宽度账不一致。`);
  assert(validation.layer6SalesCount === 0, `${store}存在第6层销售违规。`);
  assert(validation.iceMismatchCount === 0, `${store}存在冰品错柜。`);
  assert(validation.placementSyncErrorCount === 0, `${store}存在列数和宽度不同步。`);
}

function runTwice(store) {
  const first = executeStore(store);
  const second = executeStore(store);
  validatePhysical(store, first);
  validatePhysical(store, second);
  const phase5A = first.result.phase5;
  const phase5B = second.result.phase5;
  const signatures = {
    动作序列签名一致: phase5A.actionSequenceSignature === phase5B.actionSequenceSignature,
    最终方案签名一致: phase5A.planSignature === phase5B.planSignature,
    指标签名一致: phase5A.metricsSignature === phase5B.metricsSignature
  };
  const actionCountSame = phase5A.phase5Actions.length === phase5B.phase5Actions.length;
  assert(Object.values(signatures).every(Boolean) && actionCountSame, "相同输入产生了不同排柜结果。");
  return {
    门店: store,
    第一次: summary(first),
    第二次: summary(second),
    ...signatures,
    接受动作数量一致: actionCountSame
  };
}

const ningguo = runTwice("宁国津河西路生活馆");
console.log(JSON.stringify(ningguo, null, 2));
const hexian = runTwice("和县生活馆");
console.log(JSON.stringify(hexian, null, 2));
