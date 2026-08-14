import { EPSILON, asNumber, gradeScore, stableCompare } from "./common.mjs";
import { calculateSkuInventoryMetrics, summarizeStoreInventoryMetrics } from "./inventory-metrics.mjs";
import { summarizeAllocation } from "./phase3-base-allocation.mjs";
import { canFitPlacement, expandPlacementOneColumn, validateSegmentWidthLedgers } from "./segment-width-ledger.mjs";
import { resolveDeterministicSearchBudget } from "./deterministic-search-config.mjs";

function productFor(stage, skuKey) {
  return stage.rankedSkus.find(product => product.skuKey === skuKey);
}

function nextMetrics(stage, row) {
  const product = productFor(stage, row.skuKey);
  return calculateSkuInventoryMetrics({
    perCol: row.perCol,
    displayCols: row.displayCols + 1,
    cartonQty: product.carton,
    triggerRate: stage.params.triggerRate,
    unitVolumeL: product.volume,
    dailyQty: product.dailyQty,
    faceWidth: row.faceWidth
  });
}

function categoryContinuity(stage, row, segment) {
  const rowsBySku = new Map(stage.temporaryIncluded.map(item => [item.skuKey, item]));
  let category4Count = 0;
  let category3Count = 0;
  for (const placement of segment.placements) {
    if (placement.skuKey === row.skuKey) continue;
    const other = rowsBySku.get(placement.skuKey);
    if (!other) continue;
    if (row.category4 && other.category4 === row.category4) category4Count += 1;
    if (row.category3 && other.category3 === row.category3) category3Count += 1;
  }
  return { category4Count, category3Count };
}

function expansionAction(stage, row, currentSummary) {
  const segment = stage.cabinetStates.get(row.segmentKey);
  if (!segment || !canFitPlacement(segment, row.faceWidth)) return null;
  const metrics = nextMetrics(stage, row);
  const nextList = stage.temporaryIncluded.map(item => item.skuKey === row.skuKey ? metrics : item.metrics);
  const nextSummary = summarizeStoreInventoryMetrics(nextList, stage.params);
  const externalUnitReduction = row.metrics.externalUnits - metrics.externalUnits;
  const staticReductionL = row.metrics.staticExternalL - metrics.staticExternalL;
  const suggestedReductionL = currentSummary.suggestedExternalL - nextSummary.suggestedExternalL;
  const directTransition = !row.metrics.directCase && metrics.directCase;
  const hasRealBenefit = directTransition
    || externalUnitReduction > 0
    || staticReductionL > 0
    || suggestedReductionL > 0;
  if (!hasRealBenefit) return null;
  const continuity = categoryContinuity(stage, row, segment);
  return {
    row,
    segment,
    metrics,
    nextSummary,
    directTransition,
    externalUnitReduction,
    staticReductionL,
    suggestedReductionL,
    reductionPerWidth: row.faceWidth > 0 ? staticReductionL / row.faceWidth : 0,
    category4Continuity: continuity.category4Count,
    category3Continuity: continuity.category3Count
  };
}

function expansionActions(stage) {
  const currentSummary = summarizeStoreInventoryMetrics(stage.temporaryIncluded.map(row => row.metrics), stage.params);
  const actions = stage.temporaryIncluded
    .map(row => expansionAction(stage, row, currentSummary))
    .filter(Boolean);
  return actions.sort((left, right) => Number(right.directTransition) - Number(left.directTransition)
    || right.reductionPerWidth - left.reductionPerWidth
    || right.externalUnitReduction - left.externalUnitReduction
    || right.row.dailyQty - left.row.dailyQty
    || gradeScore(right.row.grade) - gradeScore(left.row.grade)
    || left.row.priorityOrder - right.row.priorityOrder
    || right.category4Continuity - left.category4Continuity
    || right.category3Continuity - left.category3Continuity
    || stableCompare(left.row.skuKey, right.row.skuKey)
    || stableCompare(left.row.segmentKey, right.row.segmentKey));
}

export function optimizeDisplayColumns(phase3, options = {}) {
  const stage = phase3;
  stage.phase = "PHASE_4";
  const { maxColumnActions } = resolveDeterministicSearchBudget(options);
  let actionCount = 0;
  const acceptedActions = [];
  while (actionCount < maxColumnActions) {
    const action = expansionActions(stage)[0];
    if (!action) break;
    const before = action.row.metrics;
    const previousDisplayCols = action.row.displayCols;
    const accepted = expandPlacementOneColumn(action.segment, action.row, action.metrics);
    if (!accepted.accepted) continue;
    acceptedActions.push({
      skuKey: action.row.skuKey,
      name: action.row.name,
      cabinetNo: action.row.cabinetNo,
      position: action.row.position,
      segmentKey: action.row.segmentKey,
      previousDisplayCols,
      nextDisplayCols: action.row.displayCols,
      addedWidth: action.row.faceWidth,
      beforeExternalUnits: before.externalUnits,
      afterExternalUnits: action.metrics.externalUnits,
      reducedExternalUnits: action.externalUnitReduction,
      reducedStaticExternalL: action.staticReductionL,
      reducedSuggestedExternalL: action.suggestedReductionL,
      directCaseTransition: action.directTransition
    });
    actionCount += 1;
  }
  const remainingBeneficialActions = expansionActions(stage);
  const deterministicBudgetLimited = actionCount >= maxColumnActions && remainingBeneficialActions.length > 0;
  const notOptimized = remainingBeneficialActions.map(action => ({
    code: "PHASE4_NOT_OPTIMIZED",
    message: "当前柜段仍存在可以改善整箱或外储的扩陈机会。",
    skuKey: action.row.skuKey,
    name: action.row.name,
    segmentKey: action.row.segmentKey,
    cabinetNo: action.row.cabinetNo,
    position: action.row.position,
    requiredWidth: action.row.faceWidth,
    remainingWidth: action.segment.remainingWidth,
    directCaseTransition: action.directTransition,
    externalUnitReduction: action.externalUnitReduction,
    staticReductionL: action.staticReductionL,
    suggestedReductionL: action.suggestedReductionL
  }));
  const wastedSegmentKeys = new Set(notOptimized.map(item => item.segmentKey));
  const columnDistribution = { one: 0, two: 0, three: 0, fourOrMore: 0 };
  for (const row of stage.temporaryIncluded) {
    if (row.displayCols === 1) columnDistribution.one += 1;
    else if (row.displayCols === 2) columnDistribution.two += 1;
    else if (row.displayCols === 3) columnDistribution.three += 1;
    else if (row.displayCols >= 4) columnDistribution.fourOrMore += 1;
  }
  stage.summary = {
    ...summarizeAllocation(stage),
    oneColumnSkuCount: columnDistribution.one,
    twoColumnSkuCount: columnDistribution.two,
    threeColumnSkuCount: columnDistribution.three,
    fourOrMoreColumnSkuCount: columnDistribution.fourOrMore,
    totalDisplayColumns: stage.temporaryIncluded.reduce((sum, row) => sum + row.displayCols, 0),
    phase4NotOptimizedCount: notOptimized.length,
    wastedUsableSpaceCount: wastedSegmentKeys.size,
    displayColumnActionCount: actionCount,
    directCaseTransitionActionCount: acceptedActions.filter(action => action.directCaseTransition).length,
    externalReductionOnlyActionCount: acceptedActions.filter(action => !action.directCaseTransition).length,
    performanceLimited: false,
    deterministicBudgetLimited,
    maxColumnActions
  };
  const widthLedgerValidation = validateSegmentWidthLedgers(stage.cabinetStates);
  const placementSyncErrorCount = stage.temporaryIncluded.filter(row => {
    const segment = stage.cabinetStates.get(row.segmentKey);
    const placement = segment?.placements.find(item => item.skuKey === row.skuKey);
    return !placement
      || placement.displayCols !== row.displayCols
      || Math.abs(asNumber(placement.usedWidth) - asNumber(row.usedWidth)) > EPSILON
      || Math.abs(asNumber(row.usedWidth) - asNumber(row.faceWidth) * row.displayCols) > EPSILON;
  }).length;
  stage.stageValidation = {
    overWidthCount: widthLedgerValidation.overWidthCount,
    widthLedgerMismatchCount: widthLedgerValidation.ledgerMismatchCount,
    placementSyncErrorCount,
    phase4NotOptimizedCount: notOptimized.length,
    wastedUsableSpaceCount: wastedSegmentKeys.size,
    phase4NotOptimized: notOptimized,
    wastedUsableSpaceSegmentKeys: [...wastedSegmentKeys].sort(stableCompare),
    layer6SalesCount: stage.temporaryIncluded.filter(row => /第\s*6\s*层/.test(row.position)).length,
    iceMismatchCount: stage.temporaryIncluded.filter(row => {
      const cabinet = stage.cabinetStates.get(row.cabinetKey);
      return Boolean(row.ice) !== Boolean(cabinet?.iceOnly);
    }).length,
    illegalVerticalStackCount: stage.temporaryIncluded.filter(row => row.cabinetClass === "vertical" && row.stackCount !== 1).length,
    inventoryMetricErrorCount: stage.temporaryIncluded.filter(row => [
      row.metrics.fullDisplay,
      row.metrics.triggerInventory,
      row.metrics.triggerAvailable,
      row.metrics.externalUnits,
      row.metrics.staticExternalL,
      row.metrics.usedWidth
    ].some(value => !Number.isFinite(Number(value)))).length,
    widthLedger: widthLedgerValidation
  };
  stage.phase4Actions = acceptedActions;
  stage.warnings = deterministicBudgetLimited ? ["动态陈列达到固定动作预算，已保留当前确定性方案。"] : [];
  return stage;
}
