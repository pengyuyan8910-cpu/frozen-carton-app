import { asNumber, gradeScore, stableCompare } from "./common.mjs";

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)];
}

function categoryCoreValue(product, pool) {
  if (asNumber(product.categoryCore) > 0) return asNumber(product.categoryCore);
  return pool
    .filter(item => item.category4 && item.category4 === product.category4)
    .reduce((sum, item) => sum + Math.max(0, asNumber(item.dailyQty)), 0);
}

function bestDisplayEfficiency(candidates) {
  return candidates.reduce((best, candidate) => Math.max(best, candidate.perCol / candidate.faceWidth), 0);
}

function comparePriority(left, right) {
  return Number(right.highValueProtected) - Number(left.highValueProtected)
    || right.dailyQty - left.dailyQty
    || right.gradeScore - left.gradeScore
    || left.rank - right.rank
    || right.businessPriority - left.businessPriority
    || right.categoryCoreValue - left.categoryCoreValue
    || right.displayEfficiency - left.displayEfficiency
    || stableCompare(left.skuKey, right.skuKey);
}

export function buildSkuPriority(phase1) {
  const positiveSales = phase1.products.map(product => product.dailyQty).filter(value => value > 0);
  const topQuartile = percentile(positiveSales, 0.75);
  const rankedSkus = phase1.products.map(product => {
    const candidates = phase1.candidatesBySku.get(product.skuKey) || [];
    const evidence = {
      dailyQty: asNumber(product.dailyQty),
      gradeScore: gradeScore(product.grade),
      rank: asNumber(product.rank) || 999999,
      businessPriority: asNumber(product.businessPriority),
      categoryCoreValue: categoryCoreValue(product, phase1.products),
      displayEfficiency: bestDisplayEfficiency(candidates)
    };
    return {
      ...product,
      ...evidence,
      highValueProtected: evidence.gradeScore >= gradeScore("A")
        || evidence.businessPriority > 0
        || (topQuartile > 0 && evidence.dailyQty >= topQuartile),
      legalCandidateCount: candidates.length,
      priorityEvidence: evidence
    };
  }).sort(comparePriority).map((product, index) => ({ ...product, priorityOrder: index + 1 }));
  return {
    phase: "PHASE_2",
    store: phase1.store,
    cabinets: phase1.cabinets,
    params: phase1.params,
    previousPlan: phase1.previousPlan,
    candidatesBySku: phase1.candidatesBySku,
    rankedSkus,
    topSalesQuartile: topQuartile,
    summary: {
      candidateSkuCount: rankedSkus.length,
      highValueProtectedCount: rankedSkus.filter(product => product.highValueProtected).length,
      skuWithLegalCandidateCount: rankedSkus.filter(product => product.legalCandidateCount > 0).length
    }
  };
}
