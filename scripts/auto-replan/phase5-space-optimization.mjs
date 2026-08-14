import { EPSILON, asNumber, gradeScore, round, stableCompare } from "./common.mjs";
import { calculateSkuInventoryMetrics } from "./inventory-metrics.mjs";
import { optimizeDisplayColumns } from "./phase4-display-columns.mjs";
import { summarizeAllocation } from "./phase3-base-allocation.mjs";
import { acceptPlacement, canFitPlacement, releasePlacement, validateSegmentWidthLedgers } from "./segment-width-ledger.mjs";
import { resolveDeterministicSearchBudget } from "./deterministic-search-config.mjs";
import { buildActionSequenceSignature, buildMetricsSignature, buildPlanSignature } from "./deterministic-signatures.mjs";

function cloneStage(source) {
  return {
    ...source,
    rankedSkus: source.rankedSkus,
    candidatesBySku: source.candidatesBySku,
    cabinetStates: new Map([...source.cabinetStates].map(([key, segment]) => [key, {
      ...segment,
      placements: segment.placements.map(placement => ({ ...placement }))
    }])),
    temporaryIncluded: source.temporaryIncluded.map(row => ({ ...row, metrics: { ...row.metrics } })),
    pendingSkus: source.pendingSkus.map(row => ({ ...row })),
    warnings: [...(source.warnings || [])]
  };
}

function productFor(stage, skuKey) {
  return stage.rankedSkus.find(product => product.skuKey === skuKey);
}

function metricsFor(product, candidate, displayCols, params) {
  return calculateSkuInventoryMetrics({
    perCol: candidate.perCol,
    displayCols,
    cartonQty: product.carton,
    triggerRate: params.triggerRate,
    unitVolumeL: product.volume,
    dailyQty: product.dailyQty,
    faceWidth: candidate.faceWidth
  });
}

function compareColumnChoice(left, right) {
  if (!right) return -1;
  return Number(right.metrics.directCase) - Number(left.metrics.directCase)
    || left.metrics.externalUnits - right.metrics.externalUnits
    || left.metrics.staticExternalL - right.metrics.staticExternalL
    || left.displayCols - right.displayCols;
}

function bestColumns(product, candidate, availableWidth, params) {
  const maxColumns = Math.floor((asNumber(availableWidth) + EPSILON) / asNumber(candidate.faceWidth));
  let best = null;
  for (let displayCols = 1; displayCols <= maxColumns; displayCols += 1) {
    const choice = { displayCols, metrics: metricsFor(product, candidate, displayCols, params) };
    if (!best || compareColumnChoice(choice, best) < 0) best = choice;
  }
  return best;
}

function applyCandidate(row, candidate, cabinet, choice) {
  row.cabinetKey = candidate.cabinetKey;
  row.segmentKey = candidate.cabinetKey;
  row.cabinetLabel = candidate.cabinetLabel;
  row.cabinetNo = candidate.cabinetLabel;
  row.cabinetType = cabinet.kind || cabinet.type;
  row.position = candidate.position;
  row.cabinetClass = candidate.cabinetClass;
  row.orientation = candidate.orientation;
  row.faceWidth = candidate.faceWidth;
  row.orientedDepth = candidate.orientedDepth;
  row.orientedHeight = candidate.orientedHeight;
  row.depthCount = candidate.depthCount;
  row.stackCount = candidate.stackCount;
  row.perCol = candidate.perCol;
  row.displayCols = choice.displayCols;
  row.metrics = choice.metrics;
  row.physicalSource = candidate.physicalSource;
  row.usedWidth = choice.metrics.usedWidth;
}

function positionNumber(value) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

function categoryPenalty(stage) {
  const groups = new Map();
  for (const row of stage.temporaryIncluded) {
    const key = row.category4 || row.category3 || "未分类";
    const group = groups.get(key) || { cabinets: new Set(), positions: [] };
    group.cabinets.add(row.cabinetLabel);
    group.positions.push({ cabinet: row.cabinetLabel, position: positionNumber(row.position) });
    groups.set(key, group);
  }
  let cabinetSplitPenalty = 0;
  let adjacencyPenalty = 0;
  for (const group of groups.values()) {
    cabinetSplitPenalty += Math.max(0, group.cabinets.size - 1);
    const byCabinet = new Map();
    for (const item of group.positions) {
      if (!Number.isFinite(item.position)) continue;
      const values = byCabinet.get(item.cabinet) || [];
      values.push(item.position);
      byCabinet.set(item.cabinet, values);
    }
    for (const values of byCabinet.values()) {
      values.sort((left, right) => left - right);
      for (let index = 1; index < values.length; index += 1) {
        if (values[index] - values[index - 1] > 1) adjacencyPenalty += 1;
      }
    }
  }
  return { cabinetSplitPenalty, adjacencyPenalty };
}

function continuousSpaceScore(stage) {
  return round([...stage.cabinetStates.values()].reduce((sum, segment) => {
    const remaining = Math.max(0, asNumber(segment.remainingWidth));
    return sum + remaining * remaining;
  }, 0));
}

function movementCount(stage, originalSegments) {
  return stage.temporaryIncluded.filter(row => originalSegments.get(row.skuKey) !== row.segmentKey).length;
}

function stablePlanKey(stage) {
  return stage.temporaryIncluded.map(row => `${row.skuKey}|${row.segmentKey}|${row.orientation}|${row.displayCols}`)
    .sort(stableCompare).join("||");
}

function evaluatePlan(stage, originalSegments, expectedIncluded, expectedPending) {
  const width = validateSegmentWidthLedgers(stage.cabinetStates);
  const summary = {
    ...summarizeAllocation(stage),
    wastedUsableSpaceCount: asNumber(stage.stageValidation?.wastedUsableSpaceCount)
  };
  const category = categoryPenalty(stage);
  const layer6SalesCount = stage.temporaryIncluded.filter(row => /第\s*6\s*层/.test(row.position)).length;
  const iceMismatchCount = stage.temporaryIncluded.filter(row => {
    const segment = stage.cabinetStates.get(row.segmentKey);
    return Boolean(row.ice) !== Boolean(segment?.iceOnly);
  }).length;
  const placementSyncErrorCount = stage.temporaryIncluded.filter(row => {
    const segment = stage.cabinetStates.get(row.segmentKey);
    const placement = segment?.placements.find(item => item.skuKey === row.skuKey);
    return !placement
      || placement.displayCols !== row.displayCols
      || Math.abs(asNumber(placement.usedWidth) - asNumber(row.usedWidth)) > EPSILON;
  }).length;
  const includedUnchanged = stage.temporaryIncluded.length === expectedIncluded;
  const pendingUnchanged = stage.pendingSkus.length === expectedPending;
  return {
    hardValid: width.ok && layer6SalesCount === 0 && iceMismatchCount === 0
      && placementSyncErrorCount === 0 && includedUnchanged && pendingUnchanged,
    summary,
    width,
    layer6SalesCount,
    iceMismatchCount,
    placementSyncErrorCount,
    includedUnchanged,
    pendingUnchanged,
    category,
    continuousSpaceScore: continuousSpaceScore(stage),
    movementCount: movementCount(stage, originalSegments),
    stableKey: stablePlanKey(stage)
  };
}

function comparePlans(left, right) {
  if (left.hardValid !== right.hardValid) return left.hardValid ? -1 : 1;
  return right.summary.directCaseSkuCount - left.summary.directCaseSkuCount
    || left.summary.externalSkuCount - right.summary.externalSkuCount
    || left.summary.suggestedExternalL - right.summary.suggestedExternalL
    || left.summary.staticExternalL - right.summary.staticExternalL
    || left.summary.externalUnits - right.summary.externalUnits
    || left.summary.wastedUsableSpaceCount - right.summary.wastedUsableSpaceCount
    || right.continuousSpaceScore - left.continuousSpaceScore
    || left.category.cabinetSplitPenalty - right.category.cabinetSplitPenalty
    || left.category.adjacencyPenalty - right.category.adjacencyPenalty
    || left.movementCount - right.movementCount
    || stableCompare(left.stableKey, right.stableKey);
}

function materiallyImproves(next, current) {
  if (!next.hardValid || comparePlans(next, current) >= 0) return false;
  if (next.summary.directCaseSkuCount > current.summary.directCaseSkuCount) return true;
  if (next.summary.externalUnits < current.summary.externalUnits) return true;
  if (next.summary.wastedUsableSpaceCount < current.summary.wastedUsableSpaceCount) return true;
  const noInventoryLoss = next.summary.directCaseSkuCount === current.summary.directCaseSkuCount
    && next.summary.externalSkuCount === current.summary.externalSkuCount
    && next.summary.suggestedExternalL <= current.summary.suggestedExternalL
    && next.summary.staticExternalL <= current.summary.staticExternalL + EPSILON;
  if (!noInventoryLoss) return false;
  return next.continuousSpaceScore > current.continuousSpaceScore + EPSILON
    || next.category.cabinetSplitPenalty < current.category.cabinetSplitPenalty
    || (next.category.cabinetSplitPenalty === current.category.cabinetSplitPenalty
      && next.category.adjacencyPenalty < current.category.adjacencyPenalty);
}

function roughMoveCandidates(stage, limit) {
  const actions = [];
  const rows = stage.temporaryIncluded.slice().sort((left, right) =>
    Number(right.metrics.externalUnits > 0) - Number(left.metrics.externalUnits > 0)
    || right.metrics.externalUnits - left.metrics.externalUnits
    || right.dailyQty - left.dailyQty
    || gradeScore(right.grade) - gradeScore(left.grade)
    || stableCompare(left.skuKey, right.skuKey));
  for (const row of rows) {
    const product = productFor(stage, row.skuKey);
    for (const candidate of stage.candidatesBySku.get(row.skuKey) || []) {
      if (candidate.cabinetKey === row.segmentKey) continue;
      const target = stage.cabinetStates.get(candidate.cabinetKey);
      if (!target || !canFitPlacement(target, candidate.faceWidth)) continue;
      const choice = bestColumns(product, candidate, target.remainingWidth, stage.params);
      if (!choice) continue;
      actions.push({
        type: "MOVE",
        skuKey: row.skuKey,
        candidate,
        choice,
        directTransition: !row.metrics.directCase && choice.metrics.directCase,
        externalUnitReduction: row.metrics.externalUnits - choice.metrics.externalUnits,
        staticReductionL: row.metrics.staticExternalL - choice.metrics.staticExternalL,
        releasedWidth: row.usedWidth,
        stableActionKey: ["MOVE", row.skuKey, row.segmentKey, candidate.cabinetKey, candidate.orientation, choice.displayCols].join("|")
      });
    }
  }
  actions.sort((left, right) => Number(right.directTransition) - Number(left.directTransition)
    || right.externalUnitReduction - left.externalUnitReduction
    || right.staticReductionL - left.staticReductionL
    || right.releasedWidth - left.releasedWidth
    || stableCompare(left.skuKey, right.skuKey)
    || stableCompare(left.candidate.cabinetKey, right.candidate.cabinetKey)
    || stableCompare(left.candidate.orientation, right.candidate.orientation)
    || stableCompare(left.stableActionKey, right.stableActionKey));
  return actions.slice(0, limit);
}

function bestCandidateForSegment(stage, row, segmentKey, availableWidth) {
  const product = productFor(stage, row.skuKey);
  return (stage.candidatesBySku.get(row.skuKey) || [])
    .filter(candidate => candidate.cabinetKey === segmentKey && candidate.faceWidth <= availableWidth + EPSILON)
    .map(candidate => ({ candidate, choice: bestColumns(product, candidate, availableWidth, stage.params) }))
    .filter(item => item.choice)
    .sort((left, right) => compareColumnChoice(left.choice, right.choice)
      || left.candidate.faceWidth - right.candidate.faceWidth
      || stableCompare(left.candidate.orientation, right.candidate.orientation))[0] || null;
}

function roughSwapCandidates(stage, limit) {
  const rows = stage.temporaryIncluded.slice().sort((left, right) =>
    Number(right.metrics.externalUnits > 0) - Number(left.metrics.externalUnits > 0)
    || right.metrics.externalUnits - left.metrics.externalUnits
    || stableCompare(left.skuKey, right.skuKey));
  const actions = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex];
      if (left.segmentKey === right.segmentKey) continue;
      const leftSegment = stage.cabinetStates.get(left.segmentKey);
      const rightSegment = stage.cabinetStates.get(right.segmentKey);
      const leftTargetWidth = rightSegment.remainingWidth + right.usedWidth;
      const rightTargetWidth = leftSegment.remainingWidth + left.usedWidth;
      const leftTarget = bestCandidateForSegment(stage, left, right.segmentKey, leftTargetWidth);
      const rightTarget = bestCandidateForSegment(stage, right, left.segmentKey, rightTargetWidth);
      if (!leftTarget || !rightTarget) continue;
      const directGain = Number(leftTarget.choice.metrics.directCase) + Number(rightTarget.choice.metrics.directCase)
        - Number(left.metrics.directCase) - Number(right.metrics.directCase);
      const externalUnitReduction = left.metrics.externalUnits + right.metrics.externalUnits
        - leftTarget.choice.metrics.externalUnits - rightTarget.choice.metrics.externalUnits;
      actions.push({
        type: "SWAP",
        leftSkuKey: left.skuKey,
        rightSkuKey: right.skuKey,
        leftTarget,
        rightTarget,
        directGain,
        externalUnitReduction,
        stableActionKey: [
          "SWAP",
          left.skuKey,
          left.segmentKey,
          right.segmentKey,
          leftTarget.candidate.orientation,
          leftTarget.choice.displayCols,
          right.skuKey,
          right.segmentKey,
          left.segmentKey,
          rightTarget.candidate.orientation,
          rightTarget.choice.displayCols
        ].join("|")
      });
    }
  }
  actions.sort((left, right) => right.directGain - left.directGain
    || right.externalUnitReduction - left.externalUnitReduction
    || stableCompare(left.stableActionKey, right.stableActionKey));
  return actions.slice(0, limit);
}

function optimizeLocalColumns(stage, maxColumnActions) {
  return optimizeDisplayColumns(stage, { maxColumnActions });
}

function simulateMove(stage, action, maxColumnActions) {
  const next = cloneStage(stage);
  const row = next.temporaryIncluded.find(item => item.skuKey === action.skuKey);
  const source = next.cabinetStates.get(row.segmentKey);
  const target = next.cabinetStates.get(action.candidate.cabinetKey);
  releasePlacement(source, row);
  const product = productFor(next, row.skuKey);
  const choice = bestColumns(product, action.candidate, target.remainingWidth, next.params);
  if (!choice) return null;
  applyCandidate(row, action.candidate, target, choice);
  acceptPlacement(target, row);
  optimizeLocalColumns(next, maxColumnActions);
  next.phase = "PHASE_5";
  return next;
}

function simulateSwap(stage, action, maxColumnActions) {
  const next = cloneStage(stage);
  const left = next.temporaryIncluded.find(item => item.skuKey === action.leftSkuKey);
  const right = next.temporaryIncluded.find(item => item.skuKey === action.rightSkuKey);
  const leftSource = next.cabinetStates.get(left.segmentKey);
  const rightSource = next.cabinetStates.get(right.segmentKey);
  releasePlacement(leftSource, left);
  releasePlacement(rightSource, right);
  const leftTarget = bestCandidateForSegment(next, left, rightSource.key, rightSource.remainingWidth);
  const rightTarget = bestCandidateForSegment(next, right, leftSource.key, leftSource.remainingWidth);
  if (!leftTarget || !rightTarget) return null;
  applyCandidate(left, leftTarget.candidate, rightSource, leftTarget.choice);
  applyCandidate(right, rightTarget.candidate, leftSource, rightTarget.choice);
  acceptPlacement(rightSource, left);
  acceptPlacement(leftSource, right);
  optimizeLocalColumns(next, maxColumnActions);
  next.phase = "PHASE_5";
  return next;
}

function segmentSnapshot(stage, keys) {
  return [...new Set(keys)].sort(stableCompare).map(key => {
    const segment = stage.cabinetStates.get(key);
    return segment ? {
      segmentKey: key,
      cabinetNo: segment.label,
      position: segment.position,
      usedWidth: segment.usedWidth,
      remainingWidth: segment.remainingWidth
    } : null;
  }).filter(Boolean);
}

function actionLog(beforeStage, afterStage, action, beforeEval, afterEval) {
  const skuKeys = action.type === "SWAP" ? [action.leftSkuKey, action.rightSkuKey] : [action.skuKey];
  const beforeRows = skuKeys.map(key => beforeStage.temporaryIncluded.find(row => row.skuKey === key));
  const afterRows = skuKeys.map(key => afterStage.temporaryIncluded.find(row => row.skuKey === key));
  const segmentKeys = [...beforeRows, ...afterRows].map(row => row.segmentKey);
  const directImprovement = afterEval.summary.directCaseSkuCount > beforeEval.summary.directCaseSkuCount;
  const inventoryImprovement = afterEval.summary.externalUnits < beforeEval.summary.externalUnits;
  const categoryImprovement = afterEval.category.cabinetSplitPenalty < beforeEval.category.cabinetSplitPenalty
    || afterEval.category.adjacencyPenalty < beforeEval.category.adjacencyPenalty;
  const movedAndExpanded = afterRows.some((row, index) => row.displayCols > beforeRows[index].displayCols);
  let typeText = action.type === "SWAP" ? "互换位置" : "移动商品";
  if (action.type !== "SWAP" && movedAndExpanded) typeText = "移动后增加陈列列数";
  else if (!directImprovement && !inventoryImprovement && categoryImprovement) typeText = "品类整理";
  else if (!directImprovement && afterEval.continuousSpaceScore > beforeEval.continuousSpaceScore) typeText = "整理柜段空间";
  const reason = directImprovement
    ? "移动后增加陈列列数并提高直接整箱商品数。"
    : inventoryImprovement
      ? "利用目标柜段连续空间增加有效陈列，降低外储件数。"
      : categoryImprovement
        ? "在不损害整箱和外储指标的前提下改善品类集中。"
        : "释放原柜段碎片并形成更有价值的连续空间。";
  return {
    type: action.type,
    stableActionKey: action.stableActionKey,
    动作类型: typeText,
    商品: beforeRows.map(row => row.name).join(" ↔ "),
    调整前: beforeRows.map(row => ({
      商品: row.name,
      柜号: row.cabinetNo,
      位置: row.position,
      列数: row.displayCols,
      直接整箱: row.metrics.directCase,
      外储件数: row.metrics.externalUnits,
      静态外储L: row.metrics.staticExternalL
    })),
    调整后: afterRows.map(row => ({
      商品: row.name,
      柜号: row.cabinetNo,
      位置: row.position,
      列数: row.displayCols,
      直接整箱: row.metrics.directCase,
      外储件数: row.metrics.externalUnits,
      静态外储L: row.metrics.staticExternalL
    })),
    调整前柜段宽度: segmentSnapshot(beforeStage, segmentKeys),
    调整后柜段宽度: segmentSnapshot(afterStage, segmentKeys),
    直接整箱SKU改善: afterEval.summary.directCaseSkuCount - beforeEval.summary.directCaseSkuCount,
    外储SKU改善: beforeEval.summary.externalSkuCount - afterEval.summary.externalSkuCount,
    外储件数改善: beforeEval.summary.externalUnits - afterEval.summary.externalUnits,
    静态外储改善L: round(beforeEval.summary.staticExternalL - afterEval.summary.staticExternalL),
    建议外储改善L: beforeEval.summary.suggestedExternalL - afterEval.summary.suggestedExternalL,
    移动原因: reason
  };
}

function findBest(stage, currentEval, originalSegments, expectedIncluded, expectedPending, options) {
  let best = null;
  let bestEval = null;
  let bestAction = null;
  const moveCandidates = roughMoveCandidates(stage, options.maxMoveCandidates);
  for (const action of moveCandidates) {
    const simulated = simulateMove(stage, action, options.maxColumnActions);
    if (!simulated) continue;
    const evaluation = evaluatePlan(simulated, originalSegments, expectedIncluded, expectedPending);
    if (!materiallyImproves(evaluation, currentEval)) continue;
    if (!bestEval || comparePlans(evaluation, bestEval) < 0) {
      best = simulated;
      bestEval = evaluation;
      bestAction = action;
    }
  }
  const swapCandidates = roughSwapCandidates(stage, options.maxSwapCandidates);
  for (const action of swapCandidates) {
    const simulated = simulateSwap(stage, action, options.maxColumnActions);
    if (!simulated) continue;
    const evaluation = evaluatePlan(simulated, originalSegments, expectedIncluded, expectedPending);
    if (!materiallyImproves(evaluation, currentEval)) continue;
    if (!bestEval || comparePlans(evaluation, bestEval) < 0) {
      best = simulated;
      bestEval = evaluation;
      bestAction = action;
    }
  }
  return {
    best,
    bestEval,
    bestAction,
    moveCandidateCount: moveCandidates.length,
    swapCandidateCount: swapCandidates.length
  };
}

export function optimizeCrossSegmentSpace(phase4, rawOptions = {}) {
  const options = resolveDeterministicSearchBudget(rawOptions);
  const expectedIncluded = phase4.temporaryIncluded.length;
  const expectedPending = phase4.pendingSkus.length;
  const expectedSkuKeys = phase4.temporaryIncluded.map(row => row.skuKey).sort(stableCompare).join("|");
  const expectedPendingKeys = phase4.pendingSkus.map(row => row.skuKey).sort(stableCompare).join("|");
  const originalSegments = new Map(phase4.temporaryIncluded.map(row => [row.skuKey, row.segmentKey]));
  const phase4Summary = { ...phase4.summary };
  let current = cloneStage(phase4);
  let currentEval = evaluatePlan(current, originalSegments, expectedIncluded, expectedPending);
  const actions = [];
  const searchDiagnostics = [];
  let normalCompletion = false;
  for (let round = 1; round <= options.maxRounds; round += 1) {
    const found = findBest(current, currentEval, originalSegments, expectedIncluded, expectedPending, options);
    searchDiagnostics.push({
      round,
      moveCandidateCount: found.moveCandidateCount,
      swapCandidateCount: found.swapCandidateCount,
      accepted: Boolean(found.best)
    });
    if (!found.best) {
      normalCompletion = true;
      break;
    }
    actions.push({ round, ...actionLog(current, found.best, found.bestAction, currentEval, found.bestEval) });
    current = found.best;
    currentEval = found.bestEval;
  }
  const finalSkuKeys = current.temporaryIncluded.map(row => row.skuKey).sort(stableCompare).join("|");
  const finalPendingKeys = current.pendingSkus.map(row => row.skuKey).sort(stableCompare).join("|");
  const roundLimited = !normalCompletion && actions.length >= options.maxRounds;
  current.phase = "PHASE_5";
  current.phase4Summary = phase4Summary;
  current.phase5Actions = actions;
  current.summary = {
    ...current.summary,
    phase5ActionCount: actions.length,
    movedSkuCount: currentEval.movementCount,
    performanceLimited: false,
    deterministicBudgetLimited: roundLimited,
    roundLimited,
    searchBudget: { ...options },
    searchRoundsExecuted: searchDiagnostics.length,
    moveCandidatesEvaluated: searchDiagnostics.reduce((sum, item) => sum + item.moveCandidateCount, 0),
    swapCandidatesEvaluated: searchDiagnostics.reduce((sum, item) => sum + item.swapCandidateCount, 0)
  };
  current.phase5Validation = {
    overWidthCount: currentEval.width.overWidthCount,
    widthLedgerMismatchCount: currentEval.width.ledgerMismatchCount,
    placementSyncErrorCount: currentEval.placementSyncErrorCount,
    layer6SalesCount: currentEval.layer6SalesCount,
    iceMismatchCount: currentEval.iceMismatchCount,
    temporaryIncludedUnchanged: currentEval.includedUnchanged && expectedSkuKeys === finalSkuKeys,
    pendingUnchanged: currentEval.pendingUnchanged && expectedPendingKeys === finalPendingKeys,
    moveOpportunityRemainingCount: normalCompletion ? 0 : 1,
    swapOpportunityRemainingCount: normalCompletion ? 0 : 1,
    performanceLimited: false,
    deterministicBudgetLimited: roundLimited,
    roundLimited,
    widthLedger: currentEval.width
  };
  current.warnings = [];
  current.notices = roundLimited ? ["柜位优化达到固定搜索轮数，已保留当前确定性方案。"] : [];
  current.actionSequenceSignature = buildActionSequenceSignature(actions);
  current.planSignature = buildPlanSignature(current.temporaryIncluded);
  current.metricsSignature = buildMetricsSignature(current.summary);
  current.searchDiagnostics = searchDiagnostics;
  return current;
}
