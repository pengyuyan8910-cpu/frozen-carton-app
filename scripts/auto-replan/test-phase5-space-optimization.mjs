import fs from "node:fs";
import { runPhase0To5 } from "./index.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));
const compactOutput = process.argv.includes("--compact");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summaryFields(summary) {
  return {
    temporaryIncluded: summary.temporaryIncludedCount,
    pending: summary.pendingCount,
    一列SKU数: summary.oneColumnSkuCount,
    二列SKU数: summary.twoColumnSkuCount,
    三列SKU数: summary.threeColumnSkuCount,
    四列及以上SKU数: summary.fourOrMoreColumnSkuCount,
    总陈列列数: summary.totalDisplayColumns,
    直接整箱SKU数: summary.directCaseSkuCount,
    外储SKU数: summary.externalSkuCount,
    静态外储L: summary.staticExternalL,
    建议外储L: summary.suggestedExternalL,
    已使用宽度mm: summary.usedWidth,
    剩余宽度mm: summary.remainingWidth
  };
}

function runStore(store) {
  const startedAt = Date.now();
  const result = runPhase0To5({
    store,
    productPool: data.productPool,
    cabinets: data.cabinets,
    params: data.params,
    physicalRecords: confirmed.records
  }, {
    phase4: { maxRuntimeMs: 60000 },
    phase5: {
      maxRuntimeMs: 30000,
      maxRounds: 50,
      maxMoveCandidates: 80,
      maxSwapCandidates: 40
    }
  });
  const elapsedMs = Date.now() - startedAt;
  const phase5 = result.phase5;
  assert(phase5, `${store}没有生成PHASE 5结果`);
  const before = phase5.phase4Summary;
  const after = phase5.summary;
  const validation = phase5.phase5Validation;
  assert(elapsedMs <= 30000, `${store}空间优化超过30秒`);
  assert(result.ok, `${store}PHASE 5验收未通过：${phase5.warnings.join("；")}`);
  assert(validation.overWidthCount === 0, `${store}存在柜段超宽`);
  assert(validation.widthLedgerMismatchCount === 0, `${store}存在宽度账不一致`);
  assert(validation.placementSyncErrorCount === 0, `${store}存在陈列列数与占宽不同步`);
  assert(validation.layer6SalesCount === 0, `${store}存在第6层销售`);
  assert(validation.iceMismatchCount === 0, `${store}存在冰品错柜`);
  assert(validation.temporaryIncludedUnchanged, `${store}PHASE 5改变了temporaryIncluded集合`);
  assert(validation.pendingUnchanged, `${store}PHASE 5改变了pending集合`);
  assert(validation.moveOpportunityRemainingCount === 0, `${store}仍有明显移动改善机会`);
  assert(validation.swapOpportunityRemainingCount === 0, `${store}仍有明显互换改善机会`);
  const improved = after.directCaseSkuCount > before.directCaseSkuCount
    || after.externalUnits < before.externalUnits
    || after.staticExternalL < before.staticExternalL;
  assert(improved, `${store}跨柜段优化没有形成真实经营改善`);

  const top10 = phase5.phase5Actions.slice().sort((left, right) =>
    right.直接整箱SKU改善 - left.直接整箱SKU改善
    || right.外储SKU改善 - left.外储SKU改善
    || right.静态外储改善L - left.静态外储改善L
    || right.外储件数改善 - left.外储件数改善
    || left.round - right.round
  ).slice(0, 10);
  const actionTypes = phase5.phase5Actions.reduce((counts, action) => {
    counts[action.动作类型] = (counts[action.动作类型] || 0) + 1;
    return counts;
  }, {});
  return {
    门店: store,
    PHASE4: summaryFields(before),
    PHASE5: summaryFields(after),
    接受动作数: phase5.phase5Actions.length,
    动作类型统计: actionTypes,
    ...(compactOutput ? {} : { 接受的全部动作: phase5.phase5Actions }),
    改善最大Top10动作: top10,
    柜段超宽数: validation.overWidthCount,
    宽度账不一致数: validation.widthLedgerMismatchCount,
    陈列列数与占宽不同步数: validation.placementSyncErrorCount,
    第6层违规数: validation.layer6SalesCount,
    冰品错柜数: validation.iceMismatchCount,
    temporaryIncluded是否保持: validation.temporaryIncludedUnchanged ? "是" : "否",
    pending是否保持: validation.pendingUnchanged ? "是" : "否",
    明显移动机会剩余数: validation.moveOpportunityRemainingCount,
    明显互换机会剩余数: validation.swapOpportunityRemainingCount,
    耗时ms: elapsedMs
  };
}

const totalStartedAt = Date.now();
const ningguo = runStore("宁国津河西路生活馆");
console.log(JSON.stringify({ 测试顺序: "第一步：宁国津河", 测试结论: "通过", ...ningguo }, null, 2));

const hanxian = runStore("和县生活馆");
const totalElapsedMs = Date.now() - totalStartedAt;
assert(totalElapsedMs <= 60000, "宁国津河与和县PHASE 5合计超过60秒");
console.log(JSON.stringify({
  测试顺序: "第二步：和县",
  测试结论: "通过",
  ...hanxian,
  两店合计耗时ms: totalElapsedMs,
  是否开发PHASE6至11: "否",
  是否修改原界面: "否",
  是否写入正式数据: "否"
}, null, 2));
