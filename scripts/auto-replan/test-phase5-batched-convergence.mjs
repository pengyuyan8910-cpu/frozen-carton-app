import crypto from "node:crypto";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { DETERMINISTIC_SEARCH_BUDGET, runPhase0To5 } from "./index.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));
const storeByArgument = {
  ningguo: "\u5b81\u56fd\u6d25\u6cb3\u897f\u8def\u751f\u6d3b\u9986",
  hexian: "\u548c\u53bf\u751f\u6d3b\u9986"
};
const store = storeByArgument[process.argv[2]];
if (!store) throw new Error("请指定 ningguo 或 hexian。");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function execute() {
  const started = performance.now();
  const result = runPhase0To5({
    store,
    productPool: data.productPool,
    cabinets: data.cabinets,
    params: data.params,
    physicalRecords: confirmed.records
  });
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  assert(result.phase5, `${store}没有生成PHASE 5结果。`);
  assert(elapsedMs <= DETERMINISTIC_SEARCH_BUDGET.outerWatchdogMs,
    "自动排柜运行时间超过安全上限，本次计算结果未采用。");
  const phase5 = result.phase5;
  const validation = phase5.phase5Validation;
  assert(validation.overWidthCount === 0, `${store}存在柜段超宽。`);
  assert(validation.widthLedgerMismatchCount === 0, `${store}存在宽度账不一致。`);
  assert(validation.layer6SalesCount === 0, `${store}存在第6层销售违规。`);
  assert(validation.iceMismatchCount === 0, `${store}存在冰品错柜。`);
  assert(validation.placementSyncErrorCount === 0, `${store}存在列数/宽度不同步。`);
  return { result, elapsedMs };
}

function compact(run) {
  const phase5 = run.result.phase5;
  return {
    elapsedMs: run.elapsedMs,
    batchCount: phase5.summary.optimizationBatchCount,
    totalRounds: phase5.summary.totalOptimizationRounds,
    totalActions: phase5.phase5Actions.length,
    batches: phase5.summary.optimizationBatches.map(batch => ({
      batch: batch.batch,
      acceptedActions: batch.acceptedActionCount,
      cumulativeActions: batch.cumulativeActionCount,
      directCaseSkuCount: batch.directCaseSkuCount,
      externalSkuCount: batch.externalSkuCount,
      staticExternalL: batch.staticExternalL,
      suggestedExternalL: batch.suggestedExternalL,
      remainingImprovementCandidates: batch.remainingImprovementCandidates
    })),
    stopReason: phase5.summary.optimizationStopReason,
    optimizationConverged: phase5.summary.optimizationConverged,
    safetyLimitReached: phase5.summary.safetyLimitReached,
    cycleDetected: phase5.summary.cycleDetected,
    remainingImprovementCandidates: phase5.summary.remainingImprovementCandidates,
    bestRemainingAction: phase5.summary.bestRemainingAction,
    totalDisplayColumns: phase5.temporaryIncluded.reduce((sum, row) => sum + row.displayCols, 0),
    directCaseSkuCount: phase5.summary.directCaseSkuCount,
    externalSkuCount: phase5.summary.externalSkuCount,
    staticExternalL: phase5.summary.staticExternalL,
    suggestedExternalL: phase5.summary.suggestedExternalL,
    externalLimitSatisfied: phase5.summary.externalLimitSatisfied,
    usedWidth: phase5.summary.usedWidth,
    remainingWidth: phase5.summary.remainingWidth,
    validation: {
      overWidthCount: phase5.phase5Validation.overWidthCount,
      widthLedgerMismatchCount: phase5.phase5Validation.widthLedgerMismatchCount,
      layer6SalesCount: phase5.phase5Validation.layer6SalesCount,
      iceMismatchCount: phase5.phase5Validation.iceMismatchCount,
      placementSyncErrorCount: phase5.phase5Validation.placementSyncErrorCount
    },
    actionSequenceSignature: digest(phase5.actionSequenceSignature),
    planSignature: digest(phase5.planSignature),
    metricsSignature: digest(phase5.metricsSignature)
  };
}

const first = execute();
const second = execute();
const firstSummary = compact(first);
const secondSummary = compact(second);
const deterministic = {
  batchCountSame: firstSummary.batchCount === secondSummary.batchCount,
  totalRoundsSame: firstSummary.totalRounds === secondSummary.totalRounds,
  batchActionsSame: JSON.stringify(firstSummary.batches.map(item => item.acceptedActions))
    === JSON.stringify(secondSummary.batches.map(item => item.acceptedActions)),
  batchAuditsSame: JSON.stringify(firstSummary.batches.map(item => item.remainingImprovementCandidates))
    === JSON.stringify(secondSummary.batches.map(item => item.remainingImprovementCandidates)),
  totalActionsSame: firstSummary.totalActions === secondSummary.totalActions,
  actionSequenceSignatureSame: firstSummary.actionSequenceSignature === secondSummary.actionSequenceSignature,
  planSignatureSame: firstSummary.planSignature === secondSummary.planSignature,
  metricsSignatureSame: firstSummary.metricsSignature === secondSummary.metricsSignature
};
assert(Object.values(deterministic).every(Boolean), `${store}两次运行结果不确定。`);
console.log(JSON.stringify({ store, first: firstSummary, second: secondSummary, deterministic }, null, 2));
