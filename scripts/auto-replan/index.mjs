export { loadAndValidatePhase0 } from "./phase0-input.mjs";
export { calculatePhysicalCandidates } from "./phase1-physical-candidates.mjs";
export { buildSkuPriority } from "./phase2-sku-priority.mjs";
export { buildBaseAllocation } from "./phase3-base-allocation.mjs";
export { optimizeDisplayColumns } from "./phase4-display-columns.mjs";
export { optimizeCrossSegmentSpace } from "./phase5-space-optimization.mjs";
export { calculateSkuInventoryMetrics, summarizeStoreInventoryMetrics } from "./inventory-metrics.mjs";
export { detectStoreImpact } from "./impact-detection.mjs";
export { canFitPlacement, validateSegmentWidthLedgers } from "./segment-width-ledger.mjs";
export { DETERMINISTIC_SEARCH_BUDGET, resolveDeterministicSearchBudget } from "./deterministic-search-config.mjs";
export { buildActionSequenceSignature, buildMetricsSignature, buildPlanSignature } from "./deterministic-signatures.mjs";
export * from "./chinese-messages.mjs";

import { loadAndValidatePhase0 } from "./phase0-input.mjs";
import { calculatePhysicalCandidates } from "./phase1-physical-candidates.mjs";
import { buildSkuPriority } from "./phase2-sku-priority.mjs";
import { buildBaseAllocation } from "./phase3-base-allocation.mjs";
import { optimizeDisplayColumns } from "./phase4-display-columns.mjs";
import { optimizeCrossSegmentSpace } from "./phase5-space-optimization.mjs";

export function runPhase0To4(input, options = {}) {
  const phase0 = loadAndValidatePhase0(input);
  if (!phase0.ok) return { ok: false, phase: "PHASE_0", phase0, errors: phase0.errors };
  const phase1 = calculatePhysicalCandidates(phase0);
  const phase2 = buildSkuPriority(phase1);
  const phase3 = buildBaseAllocation(phase2);
  const phase4 = optimizeDisplayColumns(phase3, options);
  return {
    ok: !phase4.warnings.length
      && phase4.stageValidation.overWidthCount === 0
      && phase4.stageValidation.widthLedgerMismatchCount === 0
      && phase4.stageValidation.placementSyncErrorCount === 0
      && phase4.stageValidation.phase4NotOptimizedCount === 0
      && phase4.stageValidation.layer6SalesCount === 0
      && phase4.stageValidation.iceMismatchCount === 0
      && phase4.stageValidation.illegalVerticalStackCount === 0
      && phase4.stageValidation.inventoryMetricErrorCount === 0,
    phase: "PHASE_4",
    phase0,
    phase1,
    phase2,
    phase3: {
      summary: {
        candidateSkuCount: phase2.rankedSkus.length,
        temporaryIncludedCount: phase4.temporaryIncluded.length,
        pendingCount: phase4.pendingSkus.length
      }
    },
    phase4
  };
}

export function runPhase0To5(input, options = {}) {
  const phase0To4 = runPhase0To4(input, options.phase4 || options);
  if (!phase0To4.ok) return phase0To4;
  const phase5 = optimizeCrossSegmentSpace(phase0To4.phase4, options.phase5 || options);
  const validation = phase5.phase5Validation;
  return {
    ...phase0To4,
    ok: !phase5.warnings.length
      && validation.overWidthCount === 0
      && validation.widthLedgerMismatchCount === 0
      && validation.placementSyncErrorCount === 0
      && validation.layer6SalesCount === 0
      && validation.iceMismatchCount === 0
      && validation.temporaryIncludedUnchanged
      && validation.pendingUnchanged
      && (validation.deterministicBudgetLimited
        || (validation.moveOpportunityRemainingCount === 0
          && validation.swapOpportunityRemainingCount === 0)),
    phase: "PHASE_5",
    phase5
  };
}
