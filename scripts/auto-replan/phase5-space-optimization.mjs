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

function applyCandidateBudget(actions, limit, requiredStableActionKey) {
  const selected = actions.slice(0, limit);
  if (!requiredStableActionKey || selected.some(action => action.stableActionKey === requiredStableActionKey)) {
    return selected;
  }
  const required = actions.find(action => action.stableActionKey === requiredStableActionKey);
  if (!required || limit <= 0) return selected;
  if (selected.length < limit) selected.push(required);
  else selected[selected.length - 1] = required;
  return selected;
}

function findBest(stage, currentEval, originalSegments, expectedIncluded, expectedPending, options) {
  let best = null;
  let bestEval = null;
  let bestAction = null;
  const requiredStableActionKey = options.requiredStableActionKey;
  const moveCandidates = applyCandidateBudget(
    roughMoveCandidates(stage, Number.MAX_SAFE_INTEGER),
    options.maxMoveCandidates,
    requiredStableActionKey?.startsWith("MOVE|") ? requiredStableActionKey : ""
  );
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
  const swapCandidates = applyCandidateBudget(
    roughSwapCandidates(stage, Number.MAX_SAFE_INTEGER),
    options.maxSwapCandidates,
    requiredStableActionKey?.startsWith("SWAP|") ? requiredStableActionKey : ""
  );
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
  const optimizationBatches = [];
  const visitedPlanSignatures = new Set([buildPlanSignature(current.temporaryIncluded)]);
  let finalAudit = null;
  let optimizationConverged = false;
  let cycleDetected = false;
  let totalRound = 0;
  let auditedActionToResume = "";

  for (let batch = 1; batch <= options.maxOptimizationBatches; batch += 1) {
    const batchActions = [];
    for (let batchRound = 1; batchRound <= options.optimizationBatchRounds; batchRound += 1) {
      const roundOptions = auditedActionToResume
        ? { ...options, requiredStableActionKey: auditedActionToResume }
        : options;
      const found = findBest(current, currentEval, originalSegments, expectedIncluded, expectedPending, roundOptions);
      totalRound += 1;
      searchDiagnostics.push({
        batch,
        batchRound,
        round: totalRound,
        moveCandidateCount: found.moveCandidateCount,
        swapCandidateCount: found.swapCandidateCount,
        accepted: Boolean(found.best)
      });
      if (!found.best) break;
      if (!materiallyImproves(found.bestEval, currentEval) || comparePlans(found.bestEval, currentEval) >= 0) {
        throw new Error("柜位优化候选没有严格优于当前方案，已拒绝接受。");
      }
      const acceptedAction = {
        round: totalRound,
        batch,
        batchRound,
        ...actionLog(current, found.best, found.bestAction, currentEval, found.bestEval)
      };
      current = found.best;
      currentEval = found.bestEval;
      auditedActionToResume = "";
      actions.push(acceptedAction);
      batchActions.push(acceptedAction);
      const acceptedPlanSignature = buildPlanSignature(current.temporaryIncluded);
      if (visitedPlanSignatures.has(acceptedPlanSignature)) {
        cycleDetected = true;
        break;
      }
      visitedPlanSignatures.add(acceptedPlanSignature);
    }

    finalAudit = auditCrossSegmentConvergence(current, phase4, options);
    optimizationBatches.push({
      batch,
      acceptedActionCount: batchActions.length,
      cumulativeActionCount: actions.length,
      roundsExecuted: searchDiagnostics.filter(item => item.batch === batch).length,
      directCaseSkuCount: currentEval.summary.directCaseSkuCount,
      externalSkuCount: currentEval.summary.externalSkuCount,
      staticExternalL: currentEval.summary.staticExternalL,
      suggestedExternalL: currentEval.summary.suggestedExternalL,
      remainingImprovementCandidates: finalAudit.improvingCandidateCount,
      bestRemainingAction: finalAudit.bestImprovingAction
    });
    if (cycleDetected) break;
    if (finalAudit.improvingCandidateCount === 0) {
      optimizationConverged = true;
      break;
    }
    auditedActionToResume = finalAudit.bestImprovingAction?.stableActionKey || "";
  }

  const safetyLimitReached = !optimizationConverged
    && !cycleDetected
    && optimizationBatches.length >= options.maxOptimizationBatches;
  const stopReason = cycleDetected
    ? {
      code: "OPTIMIZATION_CYCLE_DETECTED",
      message: "\u67dc\u4f4d\u4f18\u5316\u51fa\u73b0\u91cd\u590d\u65b9\u6848\u5faa\u73af\uff0c\u672c\u6b21\u7ed3\u679c\u4e0d\u80fd\u4f7f\u7528\u3002"
    }
    : optimizationConverged
      ? { code: "OPTIMIZATION_CONVERGED", message: "\u67dc\u4f4d\u4f18\u5316\u5df2\u6536\u655b\u3002" }
      : safetyLimitReached
        ? {
          code: "OPTIMIZATION_SAFETY_LIMIT_REACHED",
          message: "\u67dc\u4f4d\u4f18\u5316\u8fbe\u5230\u786e\u5b9a\u6027\u5b89\u5168\u4e0a\u9650\uff0c\u4f46\u4ecd\u5b58\u5728\u53ef\u6539\u5584\u65b9\u6848\uff0c\u672c\u6b21\u7ed3\u679c\u4e0d\u80fd\u8fdb\u5165\u6700\u7ec8\u5546\u54c1\u53d6\u820d\u3002"
        }
        : { code: "ABNORMAL_STOP", message: "\u67dc\u4f4d\u4f18\u5316\u5f02\u5e38\u505c\u6b62\u3002" };
  const finalSkuKeys = current.temporaryIncluded.map(row => row.skuKey).sort(stableCompare).join("|");
  const finalPendingKeys = current.pendingSkus.map(row => row.skuKey).sort(stableCompare).join("|");
  current.phase = "PHASE_5";
  current.phase4Summary = phase4Summary;
  current.phase5Actions = actions;
  current.summary = {
    ...current.summary,
    ...currentEval.summary,
    phase5ActionCount: actions.length,
    movedSkuCount: currentEval.movementCount,
    performanceLimited: false,
    deterministicBudgetLimited: safetyLimitReached,
    roundLimited: false,
    optimizationConverged,
    safetyLimitReached,
    cycleDetected,
    remainingImprovementCandidates: finalAudit?.improvingCandidateCount ?? 0,
    bestRemainingAction: finalAudit?.bestImprovingAction ?? null,
    optimizationStopReason: stopReason,
    searchBudget: { ...options },
    optimizationBatchCount: optimizationBatches.length,
    optimizationBatches,
    totalOptimizationRounds: totalRound,
    visitedPlanSignatureCount: visitedPlanSignatures.size,
    externalCapL: 754,
    externalLimitSatisfied: currentEval.summary.suggestedExternalL <= 754,
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
    moveOpportunityRemainingCount: finalAudit?.improvingMoveCandidateCount ?? 0,
    swapOpportunityRemainingCount: finalAudit?.improvingSwapCandidateCount ?? 0,
    remainingImprovementCandidates: finalAudit?.improvingCandidateCount ?? 0,
    optimizationConverged,
    safetyLimitReached,
    cycleDetected,
    performanceLimited: false,
    deterministicBudgetLimited: safetyLimitReached,
    roundLimited: false,
    optimizationStopReason: stopReason,
    widthLedger: currentEval.width
  };
  current.warnings = optimizationConverged ? [] : [stopReason.message];
  current.notices = optimizationConverged ? [stopReason.message] : [];
  current.actionSequenceSignature = buildActionSequenceSignature(actions);
  current.planSignature = buildPlanSignature(current.temporaryIncluded);
  current.metricsSignature = buildMetricsSignature(current.summary);
  current.searchDiagnostics = searchDiagnostics;
  return current;
}

function auditAction(stage, simulated, action, beforeEval, afterEval) {
  const skuKeys = action.type === "SWAP" ? [action.leftSkuKey, action.rightSkuKey] : [action.skuKey];
  const before = skuKeys.map(skuKey => stage.temporaryIncluded.find(row => row.skuKey === skuKey));
  const after = skuKeys.map(skuKey => simulated.temporaryIncluded.find(row => row.skuKey === skuKey));
  const directImprovement = afterEval.summary.directCaseSkuCount > beforeEval.summary.directCaseSkuCount;
  const inventoryImprovement = afterEval.summary.externalUnits < beforeEval.summary.externalUnits;
  const categoryImprovement = afterEval.category.cabinetSplitPenalty < beforeEval.category.cabinetSplitPenalty
    || afterEval.category.adjacencyPenalty < beforeEval.category.adjacencyPenalty;
  const movedAndExpanded = after.some((row, index) => row.displayCols > before[index].displayCols);
  let auditType = action.type;
  if (action.type !== "SWAP" && movedAndExpanded) auditType = "MOVE_AND_EXPAND";
  else if (!directImprovement && !inventoryImprovement && categoryImprovement) auditType = "CATEGORY整理";
  else if (!directImprovement && afterEval.continuousSpaceScore > beforeEval.continuousSpaceScore) auditType = "FRAGMENT整理";
  const rowSnapshot = row => ({
    skuKey: row.skuKey,
    name: row.name,
    segmentKey: row.segmentKey,
    cabinetNo: row.cabinetNo,
    position: row.position,
    displayCols: row.displayCols,
    directCase: row.metrics.directCase,
    externalUnits: row.metrics.externalUnits,
    staticExternalL: row.metrics.staticExternalL
  });
  return {
    type: auditType,
    stableActionKey: action.stableActionKey,
    skuKeys,
    before: before.map(rowSnapshot),
    after: after.map(rowSnapshot),
    targetSegmentKeys: after.map(row => row.segmentKey),
    directCaseImprovement: afterEval.summary.directCaseSkuCount - beforeEval.summary.directCaseSkuCount,
    externalSkuImprovement: beforeEval.summary.externalSkuCount - afterEval.summary.externalSkuCount,
    externalUnitImprovement: beforeEval.summary.externalUnits - afterEval.summary.externalUnits,
    staticExternalLImprovement: round(beforeEval.summary.staticExternalL - afterEval.summary.staticExternalL),
    suggestedExternalLImprovement: round(beforeEval.summary.suggestedExternalL - afterEval.summary.suggestedExternalL),
    categoryCabinetPenaltyImprovement: beforeEval.category.cabinetSplitPenalty - afterEval.category.cabinetSplitPenalty,
    categoryAdjacencyPenaltyImprovement: beforeEval.category.adjacencyPenalty - afterEval.category.adjacencyPenalty,
    continuousSpaceImprovement: round(afterEval.continuousSpaceScore - beforeEval.continuousSpaceScore)
  };
}

export function auditCrossSegmentConvergence(phase5, phase4, rawOptions = {}) {
  const options = resolveDeterministicSearchBudget(rawOptions);
  const stage = cloneStage(phase5);
  const expectedIncluded = stage.temporaryIncluded.length;
  const expectedPending = stage.pendingSkus.length;
  const originalSegments = new Map((phase4?.temporaryIncluded || stage.temporaryIncluded)
    .map(row => [row.skuKey, row.segmentKey]));
  const currentEval = evaluatePlan(stage, originalSegments, expectedIncluded, expectedPending);
  const moveCandidates = roughMoveCandidates(stage, Number.MAX_SAFE_INTEGER);
  const swapCandidates = roughSwapCandidates(stage, Number.MAX_SAFE_INTEGER);
  let improvingCandidateCount = 0;
  let improvingMoveCandidateCount = 0;
  let improvingSwapCandidateCount = 0;
  let best = null;
  let bestEval = null;
  const byType = {};
  const usefulSegmentKeys = new Set();
  const skuOpportunityKeys = new Set();

  const inspect = (action, simulated) => {
    if (!simulated) return;
    const evaluation = evaluatePlan(simulated, originalSegments, expectedIncluded, expectedPending);
    if (!materiallyImproves(evaluation, currentEval)) return;
    const audit = auditAction(stage, simulated, action, currentEval, evaluation);
    improvingCandidateCount += 1;
    if (action.type === "SWAP") improvingSwapCandidateCount += 1;
    else improvingMoveCandidateCount += 1;
    byType[audit.type] = (byType[audit.type] || 0) + 1;
    audit.targetSegmentKeys.forEach(key => usefulSegmentKeys.add(key));
    audit.skuKeys.forEach(key => skuOpportunityKeys.add(key));
    if (!bestEval || comparePlans(evaluation, bestEval) < 0
      || (comparePlans(evaluation, bestEval) === 0
        && stableCompare(audit.stableActionKey, best.stableActionKey) < 0)) {
      best = audit;
      bestEval = evaluation;
    }
  };

  for (const action of moveCandidates) inspect(action, simulateMove(stage, action, options.maxColumnActions));
  for (const action of swapCandidates) inspect(action, simulateSwap(stage, action, options.maxColumnActions));

  let stopReason = improvingCandidateCount === 0 ? "NO_BETTER_ACTION" : "IMPROVEMENT_REMAINS";
  if (moveCandidates.length + swapCandidates.length === 0) stopReason = "CANDIDATE_EMPTY";
  if (!currentEval.hardValid) stopReason = "ABNORMAL_STOP";
  return {
    stopReason,
    generatedMoveCandidateCount: moveCandidates.length,
    generatedSwapCandidateCount: swapCandidates.length,
    improvingCandidateCount,
    improvingMoveCandidateCount,
    improvingSwapCandidateCount,
    improvingCandidateCountByType: byType,
    usefulSegmentKeys: [...usefulSegmentKeys].sort(stableCompare),
    skuOpportunityKeys: [...skuOpportunityKeys].sort(stableCompare),
    bestImprovingAction: best
  };
}
