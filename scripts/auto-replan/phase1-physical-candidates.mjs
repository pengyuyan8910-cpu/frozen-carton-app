import { EPSILON, asText, stableCompare } from "./common.mjs";
import { calculateSkuInventoryMetrics } from "./inventory-metrics.mjs";
import { calculatePhysicalStackCount } from "./physical-business-rules.mjs";

function orientedDimensions(product, orientationKey, cabinet) {
  if (cabinet.cabinetClass === "vertical") {
    return orientationKey === "length-face"
      ? { faceWidth: product.length, depth: product.height, height: product.width }
      : { faceWidth: product.width, depth: product.height, height: product.length };
  }
  return orientationKey === "length-face"
    ? { faceWidth: product.length, depth: product.width, height: product.height }
    : { faceWidth: product.width, depth: product.length, height: product.height };
}

function cabinetTypeAllowed(product, cabinet) {
  if (!product.allowedCabinetTypes.length) return true;
  const source = [cabinet.type, cabinet.kind, cabinet.cabinetClass, cabinet.label].map(asText).join("|");
  return product.allowedCabinetTypes.some(type => source.includes(type));
}

function candidatesForPair(product, cabinet, params) {
  if (!cabinet.saleEligible || cabinet.storageOnly) return [];
  if (product.ice !== cabinet.iceOnly) return [];
  if (!cabinetTypeAllowed(product, cabinet)) return [];
  const unique = new Set();
  const output = [];
  for (const orientationKey of product.allowedOrientations) {
    const oriented = orientedDimensions(product, orientationKey, cabinet);
    const key = `${oriented.faceWidth}|${oriented.depth}|${oriented.height}`;
    if (unique.has(key)) continue;
    unique.add(key);
    if (!(oriented.faceWidth > 0 && oriented.depth > 0 && oriented.height > 0)) continue;
    if (oriented.faceWidth > cabinet.length + EPSILON) continue;
    if (oriented.depth > cabinet.depth + EPSILON) continue;
    if (oriented.height > cabinet.height + EPSILON) continue;
    // 卧柜/冰淇淋柜的 cabinet.depth 是业务上的柜体宽度字段。
    const depthCount = Math.floor(cabinet.depth / oriented.depth);
    const stackCount = calculatePhysicalStackCount(cabinet.cabinetClass, cabinet.height, oriented.height);
    const perCol = depthCount * stackCount;
    if (!(perCol > 0)) continue;
    const oneColumnMetrics = calculateSkuInventoryMetrics({
      perCol,
      displayCols: 1,
      cartonQty: product.carton,
      triggerRate: params.triggerRate,
      unitVolumeL: product.volume,
      dailyQty: product.dailyQty,
      faceWidth: oriented.faceWidth
    });
    output.push({
      skuKey: product.skuKey,
      cabinetKey: cabinet.key,
      cabinetLabel: cabinet.label,
      position: cabinet.position,
      cabinetClass: cabinet.cabinetClass,
      iceOnly: cabinet.iceOnly,
      orientation: orientationKey,
      faceWidth: oriented.faceWidth,
      orientedDepth: oriented.depth,
      orientedHeight: oriented.height,
      depthCount,
      stackCount,
      perCol,
      oneColumnMetrics,
      physicalSource: cabinet.physicalSource
    });
  }
  return output.sort((left, right) => left.faceWidth - right.faceWidth
    || right.perCol - left.perCol
    || stableCompare(left.orientation, right.orientation));
}

export function calculatePhysicalCandidates(phase0) {
  if (!phase0?.ok) throw new Error("PHASE 0未通过，不能计算物理候选");
  const bySku = new Map();
  const all = [];
  for (const product of phase0.candidateSkus) {
    const candidates = [];
    for (const cabinet of phase0.cabinets) candidates.push(...candidatesForPair(product, cabinet, phase0.params));
    candidates.sort((left, right) => stableCompare(left.cabinetKey, right.cabinetKey)
      || left.faceWidth - right.faceWidth
      || stableCompare(left.orientation, right.orientation));
    bySku.set(product.skuKey, candidates);
    all.push(...candidates);
  }
  const illegalVerticalStackCount = all.filter(candidate => candidate.cabinetClass === "vertical" && candidate.stackCount !== 1
    && !phase0.cabinets.find(cabinet => cabinet.key === candidate.cabinetKey)?.allowVerticalStack).length;
  return {
    phase: "PHASE_1",
    store: phase0.store,
    products: phase0.candidateSkus,
    cabinets: phase0.cabinets,
    params: phase0.params,
    previousPlan: phase0.previousPlan,
    candidatesBySku: bySku,
    allCandidates: all,
    summary: {
      candidateSkuCount: phase0.candidateSkus.length,
      skuWithLegalCandidateCount: phase0.candidateSkus.filter(product => (bySku.get(product.skuKey) || []).length > 0).length,
      skuWithoutLegalCandidateCount: phase0.candidateSkus.filter(product => !(bySku.get(product.skuKey) || []).length).length,
      physicalCandidateCount: all.length,
      illegalVerticalStackCount,
      layer6CandidateCount: all.filter(candidate => phase0.cabinets.find(cabinet => cabinet.key === candidate.cabinetKey)?.storageOnly).length,
      iceMismatchCandidateCount: all.filter(candidate => {
        const product = phase0.candidateSkus.find(item => item.skuKey === candidate.skuKey);
        return Boolean(product?.ice) !== Boolean(candidate.iceOnly);
      }).length
    }
  };
}
