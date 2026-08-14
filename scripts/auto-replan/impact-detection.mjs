import { asText, stableSkuKey } from "./common.mjs";
import { IMPACT_REASON_TEXT } from "./chinese-messages.mjs";

function previousIncludedKeys(previousPlan) {
  const rows = previousPlan?.rows || previousPlan?.placements || [];
  return new Set(rows
    .filter(row => row.included !== false)
    .map(row => asText(row.skuKey || row.barcode))
    .filter(Boolean));
}

function result(storeKey, affected, scope, reasonCodes, recommendedAction) {
  const codes = reasonCodes.length ? reasonCodes : ["NO_IMPACT"];
  return {
    storeKey,
    affected,
    scope,
    reasons: codes.map(reasonCode => ({ reasonCode, reason: IMPACT_REASON_TEXT[reasonCode] })),
    recommendedAction
  };
}

export function detectStoreImpact({
  storeKey,
  mode = "affected",
  selectedStoreKeys = [],
  changes = {},
  previousPlan = null,
  phase1 = null,
  phase2 = null
}) {
  const store = asText(storeKey);
  if (mode === "all") return result(store, true, "ALL_STORES", ["FULL_REPLAN_REQUESTED"], "FULL_REPLAN");
  if (mode === "selected") {
    const selected = new Set(selectedStoreKeys.map(asText));
    return selected.has(store)
      ? result(store, true, "SELECTED_STORES", ["MANUAL_STORE_REPLAN"], "STORE_REPLAN")
      : result(store, false, "SELECTED_STORES", [], "KEEP_PREVIOUS_PLAN");
  }

  const previousKeys = previousIncludedKeys(previousPlan);
  const reasons = [];
  if ((changes.cabinetStoreKeys || []).map(asText).includes(store)) reasons.push("CABINET_CHANGED");

  for (const product of changes.removedProducts || []) {
    if (previousKeys.has(stableSkuKey(product))) reasons.push("PRODUCT_REMOVED_FROM_STORE");
  }

  const changedProducts = [
    ...(changes.dimensionChangedProducts || []).map(product => ({ product, code: "PRODUCT_DIMENSION_CHANGED" })),
    ...(changes.cartonChangedProducts || []).map(product => ({ product, code: "PRODUCT_CARTON_CHANGED" })),
    ...(changes.priorityChangedProducts || []).map(product => ({ product, code: "PRODUCT_PRIORITY_CHANGED" }))
  ];
  for (const item of changedProducts) {
    if (previousKeys.has(stableSkuKey(item.product))) reasons.push(item.code);
  }

  const priorityOrder = new Map((phase2?.rankedSkus || []).map(product => [product.skuKey, product.priorityOrder]));
  const previousOrders = [...previousKeys].map(key => priorityOrder.get(key)).filter(Number.isFinite);
  const lowestCurrentPriority = previousOrders.length ? Math.max(...previousOrders) : Infinity;
  for (const product of changes.addedProducts || []) {
    const key = stableSkuKey(product);
    const hasPhysicalCandidate = (phase1?.candidatesBySku?.get(key) || []).length > 0;
    const worthConsidering = (priorityOrder.get(key) || Infinity) < lowestCurrentPriority || !previousKeys.size;
    if (hasPhysicalCandidate && worthConsidering) reasons.push("PRODUCT_ADDED_RELEVANT");
  }

  const uniqueReasons = [...new Set(reasons)];
  return uniqueReasons.length
    ? result(store, true, "AFFECTED_STORES", uniqueReasons, "LOCAL_REPLAN")
    : result(store, false, "AFFECTED_STORES", [], "KEEP_PREVIOUS_PLAN");
}
