import fs from "node:fs";
import {
  auditCrossSegmentConvergence,
  optimizeCrossSegmentSpace,
  runPhase0To4,
  scanDisplayColumnImprovements
} from "./index.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function widthBucket(remainingWidth) {
  if (remainingWidth < 50) return "0-49mm";
  if (remainingWidth < 100) return "50-99mm";
  if (remainingWidth < 150) return "100-149mm";
  if (remainingWidth < 200) return "150-199mm";
  if (remainingWidth < 300) return "200-299mm";
  return ">=300mm";
}

function cabinetClassText(value) {
  if (value === "vertical") return "立柜";
  if (value === "chest") return "卧柜";
  if (value === "ice") return "冰淇淋柜";
  return value || "未知柜型";
}

function noOpportunityReason(stage, row, directBySku, moveOpportunityKeys) {
  if (directBySku.has(row.skuKey)) return "当前柜段可直接加列。";
  if (moveOpportunityKeys.has(row.skuKey)) return "其他合法柜段存在整体改善机会。";
  const current = stage.cabinetStates.get(row.segmentKey);
  const canAddByWidth = Number(current?.remainingWidth) + 1e-9 >= Number(row.faceWidth);
  const otherPhysicallyAvailable = (stage.candidatesBySku.get(row.skuKey) || []).some(candidate => {
    if (candidate.cabinetKey === row.segmentKey) return false;
    const target = stage.cabinetStates.get(candidate.cabinetKey);
    return target && Number(target.remainingWidth) + 1e-9 >= Number(candidate.faceWidth);
  });
  if (!canAddByWidth && !otherPhysicallyAvailable) {
    return "当前柜段连续剩余宽度不足，其他合法柜段也无足够连续宽度。";
  }
  if (canAddByWidth && row.metrics.externalUnits <= 0) return "商品已无外储，增加列数不改善外储。";
  if (canAddByWidth) return "当前柜段虽可容纳一列，但增加后不产生整箱或外储改善。";
  return "存在可放置柜段，但按当前统一比较规则不能改善整体方案。";
}

function auditStore(store) {
  console.error(`[audit] ${store}: running PHASE 0-4 and fixed 20-round PHASE 5`);
  const phase04 = runPhase0To4({
    store,
    productPool: data.productPool,
    cabinets: data.cabinets,
    params: data.params,
    physicalRecords: confirmed.records
  });
  if (!phase04.ok) throw new Error(`${store}: PHASE 0-4 failed`);
  const phase5 = optimizeCrossSegmentSpace(phase04.phase4);
  console.error(`[audit] ${store}: scanning all remaining move/swap candidates without applying them`);
  const convergence = auditCrossSegmentConvergence(phase5, phase04.phase4);
  const directExpansions = scanDisplayColumnImprovements(phase5);
  const directBySku = new Map(directExpansions.map(item => [item.skuKey, item]));
  const moveOpportunityKeys = new Set(convergence.skuOpportunityKeys);
  const usefulSegmentKeys = new Set([
    ...convergence.usefulSegmentKeys,
    ...directExpansions.map(item => item.segmentKey)
  ]);

  const segments = [...phase5.cabinetStates.values()].sort((left, right) => left.key.localeCompare(right.key, "zh-CN"));
  const widthDistribution = {
    "0-49mm": 0,
    "50-99mm": 0,
    "100-149mm": 0,
    "150-199mm": 0,
    "200-299mm": 0,
    ">=300mm": 0
  };
  for (const segment of segments) widthDistribution[widthBucket(Number(segment.remainingWidth))] += 1;

  const externalRows = phase5.temporaryIncluded
    .filter(row => row.metrics.externalUnits > 0)
    .sort((left, right) => right.metrics.staticExternalL - left.metrics.staticExternalL
      || right.metrics.externalUnits - left.metrics.externalUnits
      || left.skuKey.localeCompare(right.skuKey, "zh-CN"));
  const externalByCabinetClass = {};
  for (const row of externalRows) {
    const key = cabinetClassText(row.cabinetClass);
    const value = externalByCabinetClass[key] || { skuCount: 0, staticExternalL: 0 };
    value.skuCount += 1;
    value.staticExternalL += row.metrics.staticExternalL;
    externalByCabinetClass[key] = value;
  }
  for (const value of Object.values(externalByCabinetClass)) value.staticExternalL = round(value.staticExternalL);

  const top15ExternalSkus = externalRows.slice(0, 15).map(row => {
    const current = phase5.cabinetStates.get(row.segmentKey);
    const direct = directBySku.get(row.skuKey);
    const otherOpportunity = moveOpportunityKeys.has(row.skuKey);
    return {
      skuKey: row.skuKey,
      name: row.name,
      cabinetClass: cabinetClassText(row.cabinetClass),
      cabinetNo: row.cabinetNo,
      position: row.position,
      segmentKey: row.segmentKey,
      displayCols: row.displayCols,
      perCol: row.perCol,
      fullDisplay: row.metrics.fullDisplay,
      cartonQty: phase5.rankedSkus.find(product => product.skuKey === row.skuKey)?.carton,
      externalUnits: row.metrics.externalUnits,
      staticExternalL: round(row.metrics.staticExternalL),
      currentSegmentRemainingWidth: round(current?.remainingWidth),
      requiredWidthForOneMoreColumn: round(row.faceWidth),
      currentSegmentCanExpandWithBenefit: Boolean(direct),
      otherLegalSegmentHasImprovement: otherOpportunity,
      reasonWhenNoOpportunity: direct || otherOpportunity ? "" : noOpportunityReason(phase5, row, directBySku, moveOpportunityKeys)
    };
  });

  return {
    store,
    phase5Summary: {
      includedSkuCount: phase5.temporaryIncluded.length,
      pendingSkuCount: phase5.pendingSkus.length,
      directCaseSkuCount: phase5.summary.directCaseSkuCount,
      externalSkuCount: phase5.summary.externalSkuCount,
      staticExternalL: phase5.summary.staticExternalL,
      suggestedExternalL: phase5.summary.suggestedExternalL,
      totalSalesWidth: phase5.summary.totalWidth,
      usedWidth: phase5.summary.usedWidth,
      remainingWidth: phase5.summary.remainingWidth,
      acceptedActionCount: phase5.phase5Actions.length,
      searchRoundsExecuted: phase5.summary.searchRoundsExecuted,
      maxRounds: phase5.summary.searchBudget.maxRounds
    },
    validation: {
      overWidthCount: phase5.phase5Validation.overWidthCount,
      widthLedgerMismatchCount: phase5.phase5Validation.widthLedgerMismatchCount,
      layer6SalesCount: phase5.phase5Validation.layer6SalesCount,
      iceMismatchCount: phase5.phase5Validation.iceMismatchCount,
      placementSyncErrorCount: phase5.phase5Validation.placementSyncErrorCount
    },
    convergence: {
      stopReason: convergence.stopReason,
      stopReasonZh: phase5.summary.optimizationStopReason?.message,
      generatedMoveCandidateCount: convergence.generatedMoveCandidateCount,
      generatedSwapCandidateCount: convergence.generatedSwapCandidateCount,
      improvingCandidateCount: convergence.improvingCandidateCount,
      improvingCandidateCountByType: convergence.improvingCandidateCountByType,
      bestImprovingAction: convergence.bestImprovingAction
    },
    directExpansionOpportunityCount: directExpansions.length,
    widthDistribution,
    usefulSegmentCount: usefulSegmentKeys.size,
    externalByCabinetClass,
    top15ExternalSkus
  };
}

const stores = ["\u5b81\u56fd\u6d25\u6cb3\u897f\u8def\u751f\u6d3b\u9986", "\u548c\u53bf\u751f\u6d3b\u9986"];
const report = stores.map(auditStore);
console.log(JSON.stringify(report, null, 2));
