import { EPSILON, stableCompare } from "./common.mjs";
import { PENDING_REASON_TEXT } from "./chinese-messages.mjs";
import { calculateSkuInventoryMetrics, summarizeStoreInventoryMetrics } from "./inventory-metrics.mjs";
import { acceptPlacement, canFitPlacement, createSegmentState } from "./segment-width-ledger.mjs";

function priorPlacement(previousPlan, skuKey) {
  const rows = previousPlan?.rows || previousPlan?.placements || [];
  return rows.find(row => (row.skuKey || row.barcode) === skuKey && (row.included !== false));
}

function placementMetrics(product, candidate, columns, params) {
  return calculateSkuInventoryMetrics({
    perCol: candidate.perCol,
    displayCols: columns,
    cartonQty: product.carton,
    triggerRate: params.triggerRate,
    unitVolumeL: product.volume,
    dailyQty: product.dailyQty,
    faceWidth: candidate.faceWidth
  });
}

function positionOrder(value) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

function candidateCategoryCount(placements, candidate, field, value) {
  return placements.filter(row => {
    if (!row[field] || row[field] !== value || row.cabinetLabel !== candidate.cabinetLabel) return false;
    if (field === "category4") return true;
    const left = positionOrder(row.position);
    const right = positionOrder(candidate.position);
    return row.cabinetKey === candidate.cabinetKey
      || (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1);
  }).length;
}

function directCaseColumns(product, candidate, params, maxColumns) {
  for (let columns = 1; columns <= maxColumns; columns += 1) {
    if (placementMetrics(product, candidate, columns, params).directCase) return columns;
  }
  return 0;
}

function chooseCandidate(stage, product) {
  const candidates = (stage.candidatesBySku.get(product.skuKey) || [])
    .filter(candidate => {
      const cabinet = stage.cabinetStates.get(candidate.cabinetKey);
      return cabinet && canFitPlacement(cabinet, candidate.faceWidth);
    })
    .map(candidate => {
      const cabinet = stage.cabinetStates.get(candidate.cabinetKey);
      const metrics = placementMetrics(product, candidate, 1, stage.params);
      const emptyMetrics = placementMetrics(product, candidate, 0, stage.params);
      const previous = priorPlacement(stage.previousPlan, product.skuKey);
      const maxColumnsInCurrentSpace = Math.floor((cabinet.remainingWidth + EPSILON) / candidate.faceWidth);
      const requiredDirectCaseColumns = directCaseColumns(product, candidate, stage.params, maxColumnsInCurrentSpace);
      return {
        candidate,
        metrics,
        directCase: requiredDirectCaseColumns > 0,
        requiredDirectCaseColumns,
        externalReliefL: emptyMetrics.staticExternalL - metrics.staticExternalL,
        displayEfficiency: candidate.perCol / candidate.faceWidth,
        category4Count: candidateCategoryCount(stage.temporaryIncluded, candidate, "category4", product.category4),
        category3Count: candidateCategoryCount(stage.temporaryIncluded, candidate, "category3", product.category3),
        remainingAfter: cabinet.remainingWidth - candidate.faceWidth,
        previousPlanMatch: Boolean(previous && previous.cabinetKey === candidate.cabinetKey && (!previous.orientation || previous.orientation === candidate.orientation))
      };
    });
  candidates.sort((left, right) => Number(right.directCase) - Number(left.directCase)
    || left.requiredDirectCaseColumns - right.requiredDirectCaseColumns
    || right.externalReliefL - left.externalReliefL
    || right.displayEfficiency - left.displayEfficiency
    || right.category4Count - left.category4Count
    || right.category3Count - left.category3Count
    || left.remainingAfter - right.remainingAfter
    || Number(right.previousPlanMatch) - Number(left.previousPlanMatch)
    || stableCompare(left.candidate.cabinetKey, right.candidate.cabinetKey)
    || stableCompare(left.candidate.orientation, right.candidate.orientation));
  return candidates[0] || null;
}

export function summarizeAllocation(stage) {
  const metrics = stage.temporaryIncluded.map(row => row.metrics);
  const inventory = summarizeStoreInventoryMetrics(metrics, stage.params);
  const cabinets = [...stage.cabinetStates.values()];
  return {
    candidateSkuCount: stage.rankedSkus.length,
    temporaryIncludedCount: stage.temporaryIncluded.length,
    pendingCount: stage.pendingSkus.length,
    ...inventory,
    totalSalesWidth: cabinets.reduce((sum, cabinet) => sum + cabinet.length, 0),
    usedWidth: cabinets.reduce((sum, cabinet) => sum + cabinet.usedWidth, 0),
    remainingWidth: cabinets.reduce((sum, cabinet) => sum + Math.max(0, cabinet.remainingWidth), 0),
    overWidthCount: cabinets.filter(cabinet => cabinet.remainingWidth < -EPSILON).length
  };
}

export function buildBaseAllocation(phase2) {
  const saleCabinets = phase2.cabinets.filter(cabinet => cabinet.saleEligible);
  const stage = {
    phase: "PHASE_3",
    store: phase2.store,
    params: phase2.params,
    previousPlan: phase2.previousPlan,
    rankedSkus: phase2.rankedSkus,
    candidatesBySku: phase2.candidatesBySku,
    cabinetStates: new Map(saleCabinets.map(cabinet => [cabinet.key, createSegmentState(cabinet)])),
    temporaryIncluded: [],
    pendingSkus: []
  };
  for (const product of stage.rankedSkus) {
    const physicalCandidates = stage.candidatesBySku.get(product.skuKey) || [];
    const chosen = chooseCandidate(stage, product);
    if (!chosen) {
      const reasonCode = physicalCandidates.length ? "NO_REMAINING_WIDTH" : "NO_LEGAL_PHYSICAL_CANDIDATE";
      stage.pendingSkus.push({
        skuKey: product.skuKey,
        name: product.name,
        priorityOrder: product.priorityOrder,
        highValueProtected: product.highValueProtected,
        reasonCode,
        reason: PENDING_REASON_TEXT[reasonCode]
      });
      continue;
    }
    const cabinet = stage.cabinetStates.get(chosen.candidate.cabinetKey);
    const row = {
      skuKey: product.skuKey,
      name: product.name,
      category3: product.category3,
      category4: product.category4,
      grade: product.grade,
      rank: product.rank,
      dailyQty: product.dailyQty,
      businessPriority: product.businessPriority,
      highValueProtected: product.highValueProtected,
      priorityOrder: product.priorityOrder,
      cabinetKey: chosen.candidate.cabinetKey,
      segmentKey: chosen.candidate.cabinetKey,
      cabinetLabel: chosen.candidate.cabinetLabel,
      cabinetNo: chosen.candidate.cabinetLabel,
      cabinetType: cabinet.kind || cabinet.type,
      position: chosen.candidate.position,
      cabinetClass: chosen.candidate.cabinetClass,
      orientation: chosen.candidate.orientation,
      faceWidth: chosen.candidate.faceWidth,
      orientedDepth: chosen.candidate.orientedDepth,
      orientedHeight: chosen.candidate.orientedHeight,
      depthCount: chosen.candidate.depthCount,
      stackCount: chosen.candidate.stackCount,
      perCol: chosen.candidate.perCol,
      displayCols: 1,
      metrics: chosen.metrics,
      physicalSource: chosen.candidate.physicalSource,
      ice: product.ice
    };
    acceptPlacement(cabinet, row);
    stage.temporaryIncluded.push(row);
  }
  stage.summary = summarizeAllocation(stage);
  return stage;
}
