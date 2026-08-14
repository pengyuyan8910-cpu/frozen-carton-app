import fs from "node:fs";
import { runPhase0To4 } from "./index.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function runStore(store) {
  const startedAt = Date.now();
  const result = runPhase0To4({
    store,
    productPool: data.productPool,
    cabinets: data.cabinets,
    params: data.params,
    physicalRecords: confirmed.records
  }, { maxRuntimeMs: 60000 });
  const elapsedMs = Date.now() - startedAt;
  assert(elapsedMs <= 60000, `${store}动态扩陈超过60秒，已停止验收。`);
  assert(result.ok, `${store}动态陈列列数验收未通过`);
  const phase4 = result.phase4;
  const summary = phase4.summary;
  const validation = phase4.stageValidation;
  assert(validation.overWidthCount === 0, `${store}存在柜段超宽`);
  assert(validation.widthLedgerMismatchCount === 0, `${store}存在柜段宽度账不一致`);
  assert(validation.placementSyncErrorCount === 0, `${store}存在陈列列数与占宽不同步`);
  assert(validation.phase4NotOptimizedCount === 0, `${store}仍存在可改善整箱或外储的扩陈机会`);
  assert(summary.candidateSkuCount === summary.temporaryIncludedCount + summary.pendingCount, `${store}阶段SKU守恒失败`);
  assert(summary.oneColumnSkuCount + summary.twoColumnSkuCount + summary.threeColumnSkuCount
    + summary.fourOrMoreColumnSkuCount === summary.temporaryIncludedCount, `${store}陈列列数分布与已排入SKU数不一致`);
  assert(summary.totalDisplayColumns === phase4.temporaryIncluded.reduce((sum, row) => sum + row.displayCols, 0), `${store}总陈列列数汇总不一致`);
  assert(summary.displayColumnActionCount === summary.directCaseTransitionActionCount
    + summary.externalReductionOnlyActionCount, `${store}扩列动作分类汇总不一致`);
  assert(Math.abs(summary.usedWidth + summary.remainingWidth - summary.totalSalesWidth) < 0.0001, `${store}门店销售宽度汇总不闭合`);

  const top10 = phase4.phase4Actions.slice().sort((left, right) =>
    right.reducedStaticExternalL - left.reducedStaticExternalL
    || right.reducedExternalUnits - left.reducedExternalUnits
    || left.skuKey.localeCompare(right.skuKey, "zh-CN", { numeric: true })
  ).slice(0, 10).map(action => ({
    商品: action.name,
    原列数: action.previousDisplayCols,
    新列数: action.nextDisplayCols,
    柜号: action.cabinetNo,
    位置: action.position,
    新增宽度mm: action.addedWidth,
    扩列前外储件数: action.beforeExternalUnits,
    扩列后外储件数: action.afterExternalUnits,
    减少外储L: round(action.reducedStaticExternalL),
    是否转直接整箱: action.directCaseTransition ? "是" : "否"
  }));

  return {
    门店: store,
    candidate: summary.candidateSkuCount,
    temporaryIncluded: summary.temporaryIncludedCount,
    pending: summary.pendingCount,
    一列SKU数: summary.oneColumnSkuCount,
    二列SKU数: summary.twoColumnSkuCount,
    三列SKU数: summary.threeColumnSkuCount,
    四列及以上SKU数: summary.fourOrMoreColumnSkuCount,
    总陈列列数: summary.totalDisplayColumns,
    直接整箱SKU数: summary.directCaseSkuCount,
    静态外储L: summary.staticExternalL,
    建议外储L: summary.suggestedExternalL,
    销售总宽度mm: summary.totalSalesWidth,
    实际使用宽度mm: summary.usedWidth,
    真实剩余宽度mm: summary.remainingWidth,
    扩列动作总数: summary.displayColumnActionCount,
    转直接整箱动作数: summary.directCaseTransitionActionCount,
    纯降低外储动作数: summary.externalReductionOnlyActionCount,
    外储改善最大Top10扩列动作: top10,
    PHASE4未优化机会数: validation.phase4NotOptimizedCount,
    可用空间浪费柜段数: validation.wastedUsableSpaceCount,
    柜段超宽数: validation.overWidthCount,
    宽度账不一致数: validation.widthLedgerMismatchCount,
    陈列列数与占宽不同步数: validation.placementSyncErrorCount,
    耗时ms: elapsedMs
  };
}

const totalStartedAt = Date.now();
const ningguo = runStore("宁国津河西路生活馆");
console.log(JSON.stringify({ 测试顺序: "第一步：宁国津河", 测试结论: "通过", ...ningguo }, null, 2));

const hanxian = runStore("和县生活馆");
const totalElapsedMs = Date.now() - totalStartedAt;
assert(totalElapsedMs <= 60000, "宁国津河与和县动态扩陈合计超过60秒，已停止验收。");
console.log(JSON.stringify({
  测试顺序: "第二步：和县",
  测试结论: "通过",
  ...hanxian,
  两店合计耗时ms: totalElapsedMs,
  是否开发PHASE5至11: "否",
  是否修改原界面: "否",
  是否写入正式数据: "否"
}, null, 2));
