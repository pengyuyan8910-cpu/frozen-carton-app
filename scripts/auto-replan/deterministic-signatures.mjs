import { round, stableCompare } from "./common.mjs";

export function buildPlanSignature(rows = []) {
  return rows.map(row => [row.skuKey, row.segmentKey, row.orientation, row.displayCols].join("|"))
    .sort(stableCompare)
    .join("||");
}
export function buildMetricsSignature(summary = {}) {
  return [
    summary.temporaryIncludedCount,
    summary.pendingCount,
    summary.totalDisplayColumns,
    summary.directCaseSkuCount,
    round(summary.staticExternalL),
    summary.suggestedExternalL,
    round(summary.usedWidth)
  ].join("|");
}

export function buildActionSequenceSignature(actions = []) {
  return actions.map(action => `${action.round}|${action.stableActionKey}`).join("||");
}
