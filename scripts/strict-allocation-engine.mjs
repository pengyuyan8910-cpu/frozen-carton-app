const INVALID_SOURCES = new Set(["default", "inferred", "fallback"]);
const EPSILON = 0.0001;
export const DEFAULT_EXTERNAL_CAP_L = 754;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function validNumber(value) {
  return Number.isFinite(Number(value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function stableCompare(a, b) {
  return text(a).localeCompare(text(b), "zh-CN", { numeric: true });
}

function stableKey(value) {
  return text(value?.barcode) || text(value?.skuKey) || text(value?.id) || text(value?.name);
}

function isRetired(product) {
  const states = [product?.status, product?.lifecycleStatus, product?.lifecycleState, product?.action].map(text).join("|");
  return product?.active === false || /淘汰|退休|retired|completed/i.test(states);
}

function isIceSku(product) {
  const value = [product?.category2, product?.category3, product?.category4, product?.name].map(text).join("|");
  return /冰淇淋|冰激凌|雪糕/.test(value);
}

function isIceCabinet(cabinet) {
  return /冰淇淋|冰激凌|冰品柜/.test([cabinet?.kind, cabinet?.type, cabinet?.label].map(text).join("|"));
}

function isVertical(cabinet) {
  return /立柜/.test([cabinet?.kind, cabinet?.type, cabinet?.label].map(text).join("|"));
}

function isStorageOnly(cabinet) {
  return isVertical(cabinet) && /第\s*6\s*层/.test(text(cabinet?.position));
}

function isSaleCabinet(cabinet) {
  return !isStorageOnly(cabinet);
}

function categoryScene(product) {
  return text(product?.category3) || text(product?.sceneGroup) || "未分类";
}

function gradeScore(value) {
  return ({ A: 4, B: 3, C: 2, D: 1 }[text(value).toUpperCase()] ?? 0);
}

function productDimensions(product) {
  const length = number(product?.length);
  const width = number(product?.width);
  const height = number(product?.height);
  const volume = number(product?.volume) > 0 ? number(product.volume) : length > 0 && width > 0 && height > 0 ? length * width * height / 1e6 : 0;
  return { length, width, height, volume };
}

export function activeProductPool(productPool = []) {
  const active = [];
  const seen = new Set();
  for (const product of Array.isArray(productPool) ? productPool : []) {
    if (isRetired(product)) continue;
    const key = stableKey(product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const dims = productDimensions(product);
    active.push({
      ...product,
      skuKey: key,
      barcode: text(product.barcode),
      name: text(product.name) || key,
      category4: text(product.category4),
      category3: text(product.category3),
      sceneGroup: categoryScene(product),
      grade: text(product.grade),
      rank: number(product.rank) || 999999,
      dailyQty: number(product.dailyQty),
      carton: Math.max(0, Math.floor(number(product.carton))),
      length: dims.length,
      width: dims.width,
      height: dims.height,
      volume: dims.volume,
      ice: isIceSku(product)
    });
  }
  return active.sort((a, b) => stableCompare(a.skuKey, b.skuKey));
}

function cabinetIdentity(store, label, position) {
  return `${text(store)}__${text(label)}__${text(position)}`;
}

function sourceIndex(records = []) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = record.key || cabinetIdentity(record.store, record.label, record.position);
    const list = map.get(key) || [];
    list.push({ ...record, key });
    map.set(key, list);
  }
  return map;
}

export function normalizeCabinets(cabinets = [], { store = "", physicalRecords = [] } = {}) {
  const index = sourceIndex(physicalRecords);
  return (Array.isArray(cabinets) ? cabinets : [])
    .filter(cabinet => !store || text(cabinet.store) === text(store))
    .sort((a, b) => stableCompare(a.key || a.id, b.key || b.id))
    .map((raw, indexInStore) => {
      const key = text(raw.key) || cabinetIdentity(raw.store || store, raw.label, raw.position);
      const sourceKey = cabinetIdentity(raw.store || store, raw.label, raw.position);
      const matches = index.get(sourceKey) || index.get(key) || [];
      const match = matches.length === 1 ? matches[0] : null;
      const dimensions = match || raw;
      const length = number(dimensions.length);
      const depth = number(dimensions.depth);
      const height = number(dimensions.height);
      const physicalSource = match ? text(match.source || "user-confirmed-physical-dimensions") : text(raw.physicalSource) || (length > 0 && depth > 0 && height > 0 ? "app-data" : "");
      const sourceCabinetKey = match ? text(match.sourceCabinetKey) || sourceKey : text(raw.sourceCabinetKey) || sourceKey;
      return {
        ...raw,
        key,
        store: text(raw.store) || text(store),
        label: text(raw.label) || key,
        position: text(raw.position),
        kind: text(raw.kind) || text(raw.type),
        type: text(raw.type) || text(raw.kind),
        length,
        depth,
        height,
        physicalSource,
        sourceCabinetKey,
        physicalSourceMatches: matches.length,
        physicalSourceError: matches.length > 1 ? "柜段物理尺寸来源不唯一" : "",
        index: indexInStore,
        saleEligible: isSaleCabinet(raw),
        storageOnly: isStorageOnly(raw),
        iceOnly: isIceCabinet(raw),
        usedWidth: 0,
        leftWidth: length,
        items: []
      };
    });
}

function orientationOptions(product, cabinet) {
  const p = productDimensions(product);
  if (!(p.length > 0 && p.width > 0 && p.height > 0 && cabinet.depth > 0 && cabinet.height > 0)) return [];
  const options = [
    { faceWidth: p.length, depth: p.width, height: p.height, orientation: "length-face" },
    { faceWidth: p.width, depth: p.length, height: p.height, orientation: "width-face" },
    { faceWidth: p.length, depth: p.height, height: p.width, orientation: "length-face-height-rotated" },
    { faceWidth: p.width, depth: p.height, height: p.length, orientation: "width-face-height-rotated" },
    { faceWidth: p.height, depth: p.length, height: p.width, orientation: "height-face" },
    { faceWidth: p.height, depth: p.width, height: p.length, orientation: "height-face-length-rotated" }
  ];
  const unique = new Set();
  return options.filter(option => {
    const key = [option.faceWidth, option.depth, option.height].join("|");
    if (unique.has(key)) return false;
    unique.add(key);
    const depthCount = Math.floor(cabinet.depth / option.depth);
    const heightCount = Math.floor(cabinet.height / option.height);
    const perCol = depthCount * heightCount;
    if (!(option.faceWidth > 0 && perCol > 0)) return false;
    if (option.depth > cabinet.depth + EPSILON || option.height > cabinet.height + EPSILON) return false;
    return { ...option, perCol, depthCount, heightCount };
  }).map(option => ({
    ...option,
    perCol: Math.floor(cabinet.depth / option.depth) * Math.floor(cabinet.height / option.height)
  }));
}

function legalCabinetFor(product, cabinet) {
  if (!cabinet.saleEligible) return false;
  if (product.ice !== cabinet.iceOnly) return false;
  return orientationOptions(product, cabinet).length > 0;
}

function bestOrientation(product, cabinet) {
  const options = orientationOptions(product, cabinet);
  return options.sort((a, b) => a.faceWidth - b.faceWidth || b.perCol / b.faceWidth - a.perCol / a.faceWidth || b.perCol - a.perCol || stableCompare(a.orientation, b.orientation))[0] || null;
}

function savedOrientation(product, cabinet, saved) {
  if (!saved) return bestOrientation(product, cabinet);
  return orientationOptions(product, cabinet).find(option => option.orientation === saved.orientation && option.faceWidth === saved.faceWidth && option.depth === saved.depth && option.height === saved.height) || bestOrientation(product, cabinet);
}

function rowMetrics(row, orientation, columns, params) {
  const cols = Math.max(0, Math.floor(number(columns)));
  const full = cols * orientation.perCol;
  const trigger = Math.ceil(full * number(params.triggerRate ?? 0.1));
  const receivable = Math.max(0, full - trigger);
  const carton = Math.max(0, Math.floor(number(row.carton)));
  const externalUnits = Math.max(0, carton - receivable);
  const staticExternalL = externalUnits * number(row.volume);
  const avgExternalL = staticExternalL / 2;
  const turnoverDays = row.dailyQty > 0 ? externalUnits / row.dailyQty : 0;
  return {
    full,
    trigger,
    receivable,
    externalUnits,
    staticExternalL: round(staticExternalL),
    avgExternalL: round(avgExternalL),
    turnoverDays: round(turnoverDays),
    directCarton: externalUnits === 0,
    usedWidth: round(cols * orientation.faceWidth),
    perCol: orientation.perCol,
    faceWidth: orientation.faceWidth,
    columns: cols
  };
}

function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

function recompute(plan) {
  const cabinetMap = new Map(plan.cabinets.map(cabinet => [cabinet.key, cabinet]));
  for (const cabinet of plan.cabinets) {
    cabinet.usedWidth = 0;
    cabinet.leftWidth = number(cabinet.length);
    cabinet.items = [];
  }
  for (const row of plan.rows) {
    if (!row.included || !row.cabinetKey) {
      row.usedWidth = 0;
      continue;
    }
    const cabinet = cabinetMap.get(row.cabinetKey);
    if (!cabinet) continue;
    const orientation = savedOrientation(row, cabinet, row.orientation);
    if (!orientation) continue;
    row.orientation = orientation;
    row.metrics = rowMetrics(row, orientation, row.displayCols, plan.params);
    row.perCol = row.metrics.perCol;
    row.faceWidth = row.metrics.faceWidth;
    row.usedWidth = row.metrics.usedWidth;
    cabinet.usedWidth += row.usedWidth;
    cabinet.leftWidth = number(cabinet.length) - cabinet.usedWidth;
    cabinet.items.push(row.skuKey);
  }
  for (const cabinet of plan.cabinets) {
    cabinet.usedWidth = round(cabinet.usedWidth);
    cabinet.leftWidth = round(number(cabinet.length) - cabinet.usedWidth);
    cabinet.sourceUsed = cabinet.usedWidth;
    cabinet.sourceLeft = cabinet.leftWidth;
    cabinet.overWidth = cabinet.leftWidth < -EPSILON;
  }
  plan.summary = summarize(plan);
  return plan;
}

export function recalculatePlan(plan) {
  return recompute(plan);
}

function createRow(product) {
  return {
    ...product,
    id: `strict_${product.skuKey}`,
    included: false,
    status: "未排入",
    cabinetKey: "",
    cabinetLabel: "",
    position: "",
    displayCols: 0,
    perCol: 0,
    faceWidth: 0,
    usedWidth: 0,
    reason: ""
  };
}

function categoryConcentration(plan) {
  const groups = new Map();
  for (const row of plan.rows.filter(row => row.included)) {
    const category = row.category4 || "未分类";
    const list = groups.get(category) || new Map();
    list.set(row.cabinetKey, (list.get(row.cabinetKey) || 0) + 1);
    groups.set(category, list);
  }
  let total = 0;
  let concentrated = 0;
  for (const locations of groups.values()) {
    const count = [...locations.values()].reduce((sum, value) => sum + value, 0);
    total += count;
    concentrated += Math.max(...locations.values(), 0);
  }
  return total ? concentrated / total : 1;
}

function fragmentCount(plan) {
  return plan.cabinets.filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > EPSILON).length;
}

function stablePlanKey(plan) {
  return plan.rows
    .slice()
    .sort((a, b) => stableCompare(a.skuKey, b.skuKey))
    .map(row => `${row.skuKey}:${row.included ? `${row.cabinetKey}:${row.displayCols}` : `unplaced:${row.reason}`}`)
    .join(";");
}

function summaryForRows(plan) {
  const included = plan.rows.filter(row => row.included);
  const external = included.map(row => row.metrics).filter(Boolean).filter(metrics => metrics.externalUnits > 0);
  const staticExternalL = external.reduce((sum, metrics) => sum + metrics.staticExternalL, 0);
  const avgExternalL = external.reduce((sum, metrics) => sum + metrics.avgExternalL, 0);
  const p95 = avgExternalL * number(plan.params.p95Factor ?? 1);
  const suggestedExternalL = Math.ceil(p95 * number(plan.params.externalSafetyFactor ?? 1));
  return {
    activeSkuCount: plan.rows.length,
    placedSkuCount: included.length,
    unplacedSkuCount: plan.rows.length - included.length,
    directCartonSkuCount: included.filter(row => row.metrics?.directCarton).length,
    externalSkuCount: external.length,
    externalUnits: external.reduce((sum, metrics) => sum + metrics.externalUnits, 0),
    staticExternalL: round(staticExternalL),
    avgExternalL: round(avgExternalL),
    p95ExternalL: round(p95),
    suggestedExternalL,
    category4Concentration: round(categoryConcentration(plan), 6),
    fragmentCount: fragmentCount(plan),
    remainingWidth: round(plan.cabinets.reduce((sum, cabinet) => sum + Math.max(0, cabinet.leftWidth), 0)),
    overWidthCount: plan.cabinets.filter(cabinet => cabinet.overWidth).length,
    layer6SalesCount: plan.rows.filter(row => row.included && plan.cabinets.find(c => c.key === row.cabinetKey)?.storageOnly).length,
    iceWrongCount: plan.rows.filter(row => row.included && row.ice !== plan.cabinets.find(c => c.key === row.cabinetKey)?.iceOnly).length
  };
}

function summarize(plan) {
  return summaryForRows(plan);
}

export function comparePlans(left, right) {
  const a = left.summary || summarize(left);
  const b = right.summary || summarize(right);
  const av = left.validation?.structuralOk !== false;
  const bv = right.validation?.structuralOk !== false;
  if (av !== bv) return av ? 1 : -1;
  const checks = [
    [a.placedSkuCount, b.placedSkuCount],
    [a.suggestedExternalL <= number(left.params.externalCapL), b.suggestedExternalL <= number(right.params.externalCapL)],
    [a.directCartonSkuCount, b.directCartonSkuCount],
    [-a.externalSkuCount, -b.externalSkuCount],
    [-a.suggestedExternalL, -b.suggestedExternalL],
    [a.category4Concentration, b.category4Concentration],
    [-a.fragmentCount, -b.fragmentCount]
  ];
  for (const [x, y] of checks) {
    if (x === y) continue;
    if (typeof x === "boolean") return x ? 1 : -1;
    return x > y ? 1 : -1;
  }
  return stableCompare(stablePlanKey(left), stablePlanKey(right)) < 0 ? 1 : -1;
}

function candidateCount(product, cabinets) {
  return cabinets.filter(cabinet => legalCabinetFor(product, cabinet)).length;
}

function productOrder(a, b, cabinets) {
  return candidateCount(a, cabinets) - candidateCount(b, cabinets)
    || stableCompare(a.sceneGroup, b.sceneGroup)
    || stableCompare(a.category4, b.category4)
    || gradeScore(b.grade) - gradeScore(a.grade)
    || number(a.rank) - number(b.rank)
    || number(b.dailyQty) - number(a.dailyQty)
    || stableCompare(a.skuKey, b.skuKey);
}

function candidateEffect(plan, row, cabinet, orientation, columns = 1) {
  const metrics = rowMetrics(row, orientation, columns, plan.params);
  const sameCategory = cabinet.items.some(key => plan.rows.find(item => item.skuKey === key)?.category4 === row.category4);
  const sameScene = cabinet.items.some(key => plan.rows.find(item => item.skuKey === key)?.sceneGroup === row.sceneGroup);
  return {
    cabinet,
    orientation,
    metrics,
    direct: metrics.directCarton ? 1 : 0,
    externalUnits: metrics.externalUnits,
    staticExternalL: metrics.staticExternalL,
    efficiency: metrics.perCol / metrics.faceWidth,
    sameCategory: sameCategory ? 1 : 0,
    sameScene: sameScene ? 1 : 0,
    leftAfter: cabinet.leftWidth - metrics.usedWidth,
    stable: `${cabinet.key}|${orientation.orientation}`
  };
}

function candidateCompare(a, b) {
  return a.direct - b.direct
    || b.externalUnits - a.externalUnits
    || b.staticExternalL - a.staticExternalL
    || b.metrics.faceWidth - a.metrics.faceWidth
    || a.efficiency - b.efficiency
    || a.sameCategory - b.sameCategory
    || a.sameScene - b.sameScene
    || b.leftAfter - a.leftAfter
    || stableCompare(a.stable, b.stable) * -1;
}

function locationsFor(plan, row, { includeCurrent = true, limit = 24 } = {}) {
  const candidates = [];
  for (const cabinet of plan.cabinets) {
    if (!legalCabinetFor(row, cabinet)) continue;
    if (!includeCurrent && cabinet.key === row.cabinetKey) continue;
    for (const orientation of orientationOptions(row, cabinet)) {
      if (!orientation || cabinet.leftWidth + EPSILON < orientation.faceWidth) continue;
      candidates.push(candidateEffect(plan, row, cabinet, orientation, 1));
    }
  }
  return candidates.sort((a, b) => candidateCompare(b, a)).slice(0, limit);
}

function removeFromPlan(plan, row) {
  row.included = false;
  row.status = "未排入";
  row.cabinetKey = "";
  row.cabinetLabel = "";
  row.position = "";
  row.displayCols = 0;
  row.perCol = 0;
  row.faceWidth = 0;
  row.metrics = null;
  row.orientation = null;
  recompute(plan);
}

function placeRow(plan, row, candidate) {
  row.included = true;
  row.status = "纳入-严格自动排柜";
  row.cabinetKey = candidate.cabinet.key;
  row.cabinetLabel = candidate.cabinet.label;
  row.position = candidate.cabinet.position;
  row.displayCols = 1;
  row.orientation = candidate.orientation;
  row.perCol = candidate.orientation.perCol;
  row.faceWidth = candidate.orientation.faceWidth;
  row.reason = "";
  recompute(plan);
}

function explainUnplaced(plan, row) {
  const legal = plan.cabinets.filter(cabinet => legalCabinetFor(row, cabinet));
  if (!row.volume || !(row.length > 0 && row.width > 0 && row.height > 0)) return "SKU尺寸或体积数据缺失";
  if (!legal.length) return row.ice ? "冰淇淋柜容量不足或SKU尺寸不适配" : "没有合法陈列位或SKU尺寸不适配";
  return legal.some(cabinet => cabinet.leftWidth + EPSILON >= (bestOrientation(row, cabinet)?.faceWidth || Infinity)) ? "指定柜型无剩余空间" : "柜段宽度不足";
}

function initialPlan({ store, type = "", productPool, cabinets, params, physicalRecords = [] }) {
  const pool = activeProductPool(productPool);
  const normalizedCabinets = normalizeCabinets(cabinets, { store, physicalRecords });
  const storeRecords = (Array.isArray(physicalRecords) ? physicalRecords : []).filter(record => text(record.store) === text(store));
  const plan = {
    version: "strict-allocation-v2",
    store,
    type,
    params: {
      triggerRate: number(params?.triggerRate ?? 0.1),
      p95Factor: number(params?.p95Factor ?? 1),
      externalSafetyFactor: number(params?.externalSafetyFactor ?? 1),
      externalCapL: number(params?.externalCapL ?? DEFAULT_EXTERNAL_CAP_L)
    },
    cabinets: normalizedCabinets,
    sourceAudit: {
      configuredCabinetCount: normalizedCabinets.length,
      physicalRecordCount: storeRecords.length,
      matchedSourceCount: normalizedCabinets.filter(cabinet => cabinet.physicalSourceMatches === 1).length
    },
    rows: pool.map(createRow),
    unplacedSkus: [],
    validation: null,
    summary: null
  };
  recompute(plan);
  for (const row of plan.rows.slice().sort((a, b) => productOrder(a, b, plan.cabinets))) {
    const candidates = locationsFor(plan, row, { limit: plan.cabinets.length });
    if (!candidates.length) {
      row.reason = explainUnplaced(plan, row);
      continue;
    }
    const chosen = candidates.slice().sort((a, b) => candidateCompare(b, a))[0];
    placeRow(plan, row, chosen);
  }
  for (const row of plan.rows) {
    if (!row.included && !row.reason) row.reason = explainUnplaced(plan, row);
  }
  recompute(plan);
  plan.unplacedSkus = plan.rows.filter(row => !row.included).map(row => ({ skuKey: row.skuKey, name: row.name, reason: row.reason }));
  return plan;
}

function simulateExpansion(plan, row) {
  if (!row.included) return null;
  const cabinet = plan.cabinets.find(c => c.key === row.cabinetKey);
  if (!cabinet || cabinet.leftWidth + EPSILON < row.faceWidth) return null;
  const candidate = clonePlan(plan);
  const target = candidate.rows.find(r => r.skuKey === row.skuKey);
  target.displayCols += 1;
  recompute(candidate);
  if (candidate.cabinets.some(c => c.overWidth)) return null;
  return candidate;
}

function simulateMove(plan, row, candidate) {
  const next = clonePlan(plan);
  const target = next.rows.find(r => r.skuKey === row.skuKey);
  target.cabinetKey = "";
  target.included = false;
  target.displayCols = 0;
  target.reason = "局部优化待重新安置";
  recompute(next);
  const nextCabinet = next.cabinets.find(c => c.key === candidate.cabinet.key);
  if (!nextCabinet || nextCabinet.leftWidth + EPSILON < candidate.orientation.faceWidth) return null;
  const nextCandidate = candidateEffect(next, target, nextCabinet, candidate.orientation, 1);
  placeRow(next, target, nextCandidate);
  return next.cabinets.some(c => c.overWidth) ? null : next;
}

function simulateSwap(plan, leftRow, rightRow) {
  if (!leftRow.included || !rightRow.included || leftRow.cabinetKey === rightRow.cabinetKey) return null;
  const next = clonePlan(plan);
  const left = next.rows.find(row => row.skuKey === leftRow.skuKey);
  const right = next.rows.find(row => row.skuKey === rightRow.skuKey);
  const leftCabinet = next.cabinets.find(cabinet => cabinet.key === left.cabinetKey);
  const rightCabinet = next.cabinets.find(cabinet => cabinet.key === right.cabinetKey);
  if (!leftCabinet || !rightCabinet || !legalCabinetFor(left, rightCabinet) || !legalCabinetFor(right, leftCabinet)) return null;
  const leftOrientation = bestOrientation(left, rightCabinet);
  const rightOrientation = bestOrientation(right, leftCabinet);
  if (!leftOrientation || !rightOrientation) return null;
  left.cabinetKey = rightCabinet.key;
  right.cabinetKey = leftCabinet.key;
  left.orientation = leftOrientation;
  right.orientation = rightOrientation;
  recompute(next);
  return next.cabinets.some(c => c.overWidth) ? null : next;
}

function bestCandidatePlan(plan, candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!best || comparePlans(candidate, best) > 0) best = candidate;
  }
  return best;
}

function expansionScore(plan, row) {
  const cabinet = plan.cabinets.find(item => item.key === row.cabinetKey);
  if (!cabinet || cabinet.leftWidth + EPSILON < row.faceWidth || !row.metrics) return null;
  const nextMetrics = rowMetrics(row, row.orientation, row.displayCols + 1, plan.params);
  const nextDirect = plan.summary.directCartonSkuCount - (row.metrics.directCarton ? 1 : 0) + (nextMetrics.directCarton ? 1 : 0);
  const nextExternalSku = plan.summary.externalSkuCount - (row.metrics.externalUnits > 0 ? 1 : 0) + (nextMetrics.externalUnits > 0 ? 1 : 0);
  const nextStatic = plan.summary.staticExternalL - row.metrics.staticExternalL + nextMetrics.staticExternalL;
  const nextAvg = plan.summary.avgExternalL - row.metrics.avgExternalL + nextMetrics.avgExternalL;
  const nextSuggested = Math.ceil(nextAvg * plan.params.p95Factor * plan.params.externalSafetyFactor);
  const nextFragments = plan.summary.fragmentCount - (cabinet.leftWidth > EPSILON && cabinet.leftWidth - row.faceWidth <= EPSILON ? 1 : 0);
  return {
    row,
    nextMetrics,
    withinCap: nextSuggested <= plan.params.externalCapL,
    direct: nextDirect,
    externalSku: nextExternalSku,
    suggested: nextSuggested,
    staticExternalL: round(nextStatic),
    fragments: nextFragments,
    stable: row.skuKey
  };
}

function compareExpansionScores(a, b) {
  return Number(a.withinCap) - Number(b.withinCap)
    || a.direct - b.direct
    || b.externalSku - a.externalSku
    || b.suggested - a.suggested
    || b.fragments - a.fragments
    || stableCompare(b.stable, a.stable);
}

function applyBestExpansion(plan) {
  const scores = plan.rows.filter(row => row.included).map(row => expansionScore(plan, row)).filter(Boolean);
  const best = scores.sort((a, b) => compareExpansionScores(b, a))[0];
  if (!best) return false;
  const currentScore = {
    withinCap: plan.summary.suggestedExternalL <= plan.params.externalCapL,
    direct: plan.summary.directCartonSkuCount,
    externalSku: plan.summary.externalSkuCount,
    suggested: plan.summary.suggestedExternalL,
    fragments: plan.summary.fragmentCount,
    stable: ""
  };
  if (compareExpansionScores(best, currentScore) <= 0) return false;
  best.row.displayCols += 1;
  recompute(plan);
  return true;
}

export function improvePlan(plan, { maxIterations = 12, maxExpansions = 180 } = {}) {
  let current = clonePlan(plan);
  recompute(current);
  for (let step = 0; step < maxExpansions; step += 1) {
    if (!applyBestExpansion(current)) break;
  }
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const candidates = [];
    const unplaced = current.rows.filter(row => !row.included).sort((a, b) => productOrder(a, b, current.cabinets));
    for (const row of unplaced) {
      for (const location of locationsFor(current, row, { limit: 12 })) {
        const next = clonePlan(current);
        const target = next.rows.find(r => r.skuKey === row.skuKey);
        placeRow(next, target, location);
        candidates.push(next);
      }
    }
    for (const row of current.rows.filter(item => item.included).sort((a, b) => stableCompare(a.skuKey, b.skuKey))) {
      for (const move of locationsFor(current, row, { includeCurrent: false, limit: 6 })) candidates.push(simulateMove(current, row, move));
    }
    const included = current.rows.filter(row => row.included).sort((a, b) => stableCompare(a.skuKey, b.skuKey));
    for (let i = 0; i < included.length && i < 24; i += 1) {
      for (let j = i + 1; j < included.length && j < i + 8; j += 1) candidates.push(simulateSwap(current, included[i], included[j]));
    }
    const best = bestCandidatePlan(current, candidates);
    if (!best || comparePlans(best, current) <= 0) break;
    current = best;
    for (const row of current.rows) if (!row.included && !row.reason) row.reason = explainUnplaced(current, row);
  }
  recompute(current);
  current.unplacedSkus = current.rows.filter(row => !row.included).map(row => ({ skuKey: row.skuKey, name: row.name, reason: row.reason }));
  return current;
}

function hasNaN(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNaN);
  if (value && typeof value === "object") return Object.values(value).some(hasNaN);
  return false;
}

function physicalFit(row, cabinet) {
  const orientation = savedOrientation(row, cabinet, row.orientation);
  if (!orientation) return false;
  return orientation.faceWidth > 0 && orientation.depth <= cabinet.depth + EPSILON && orientation.height <= cabinet.height + EPSILON && orientation.perCol > 0;
}

function expansionOptions(plan, row) {
  const options = new Map();
  for (const cabinet of plan.cabinets) {
    if (!legalCabinetFor(row, cabinet)) continue;
    for (const orientation of orientationOptions(row, cabinet)) {
      if (!orientation || cabinet.leftWidth + EPSILON < orientation.faceWidth) continue;
      const candidate = { cabinetKey: cabinet.key, additionalWidth: round(orientation.faceWidth) };
      const existing = options.get(cabinet.key);
      if (!existing || candidate.additionalWidth < existing.additionalWidth) options.set(cabinet.key, candidate);
    }
  }
  return [...options.values()].sort((a, b) => a.additionalWidth - b.additionalWidth || stableCompare(a.cabinetKey, b.cabinetKey));
}

export function validatePlan(plan, { productPool, externalCapL = plan.params.externalCapL } = {}) {
  const active = activeProductPool(productPool || plan.rows);
  const activeKeys = new Set(active.map(row => row.skuKey));
  const rows = Array.isArray(plan.rows) ? plan.rows : [];
  const cabinets = Array.isArray(plan.cabinets) ? plan.cabinets : [];
  const errors = [];
  const warnings = [];
  const included = rows.filter(row => row.included);
  const unplaced = rows.filter(row => !row.included);
  const seen = new Set();
  for (const row of rows) {
    if (!activeKeys.has(row.skuKey)) errors.push(`SKU不在当前有效产品池：${row.skuKey}`);
    if (seen.has(row.skuKey)) errors.push(`SKU异常重复：${row.skuKey}`);
    seen.add(row.skuKey);
    if (!row.included && !text(row.reason)) errors.push(`未排入SKU缺少原因：${row.skuKey}`);
  }
  for (const key of activeKeys) if (!seen.has(key)) errors.push(`有效SKU无结果：${key}`);
  const cabinetMap = new Map(cabinets.map(cabinet => [cabinet.key, cabinet]));
  if (plan.sourceAudit && plan.sourceAudit.physicalRecordCount > 0 && (plan.sourceAudit.physicalRecordCount !== plan.sourceAudit.configuredCabinetCount || plan.sourceAudit.matchedSourceCount !== plan.sourceAudit.physicalRecordCount)) {
    errors.push("柜段数量与物理数据源不一致");
  }
  for (const cabinet of cabinets) {
    if (!(cabinet.length > 0)) errors.push(`柜段length无效：${cabinet.key}`);
    if (!(cabinet.depth > 0)) errors.push(`柜段depth无效：${cabinet.key}`);
    if (!(cabinet.height > 0)) errors.push(`柜段height无效：${cabinet.key}`);
    if (!text(cabinet.physicalSource) || INVALID_SOURCES.has(text(cabinet.physicalSource).toLowerCase())) errors.push(`柜段物理来源无效：${cabinet.key}`);
    if (cabinet.physicalSourceError) errors.push(`${cabinet.physicalSourceError}：${cabinet.key}`);
    if (!(cabinet.physicalSourceMatches === 0 || cabinet.physicalSourceMatches === 1)) errors.push(`柜段物理来源匹配数量异常：${cabinet.key}`);
    if (cabinet.overWidth) errors.push(`柜段超宽：${cabinet.key}`);
  }
  for (const row of included) {
    const cabinet = cabinetMap.get(row.cabinetKey);
    if (!cabinet) {
      errors.push(`纳入SKU无柜段：${row.skuKey}`);
      continue;
    }
    if (!cabinet.saleEligible) errors.push(`立柜第6层被作为销售位：${row.skuKey}`);
    if (row.ice !== cabinet.iceOnly) errors.push(`冰品错柜：${row.skuKey}`);
    if (!Number.isInteger(row.displayCols) || row.displayCols < 1) errors.push(`陈列列数非法：${row.skuKey}`);
    if (!physicalFit(row, cabinet)) errors.push(`SKU尺寸不适配：${row.skuKey}`);
    const orientation = savedOrientation(row, cabinet, row.orientation);
    if (orientation && row.perCol !== orientation.perCol) errors.push(`单列容量异常：${row.skuKey}`);
    if (orientation && row.faceWidth !== orientation.faceWidth) errors.push(`单列占宽异常：${row.skuKey}`);
    if (!row.metrics || row.metrics.full !== row.displayCols * row.perCol) errors.push(`满陈数据异常：${row.skuKey}`);
    if (row.metrics && row.metrics.trigger !== Math.ceil(row.metrics.full * number(plan.params.triggerRate))) errors.push(`触发库存数据异常：${row.skuKey}`);
    if (row.metrics && row.metrics.usedWidth > cabinet.length + EPSILON) errors.push(`SKU占宽超出柜段：${row.skuKey}`);
  }
  const summary = plan.summary || summarize(plan);
  if (summary.suggestedExternalL > number(externalCapL)) errors.push(`建议外储超过754L：${summary.suggestedExternalL}L`);
  if (summary.unplacedSkuCount) warnings.push(`存在明确原因的未排入SKU：${summary.unplacedSkuCount}`);
  if (included.some(row => row.dailyQty <= 0)) warnings.push("存在缺少日销的纳入SKU，周转天数按0记录");
  if (hasNaN({ summary, rows, cabinets })) errors.push("关键数据存在NaN或Infinity");
  const conservationOk = activeKeys.size === seen.size && [...activeKeys].every(key => seen.has(key));
  const structuralErrors = errors.filter(error => !error.includes("建议外储超过754L"));
  const structuralOk = structuralErrors.length === 0;
  const hardRulesOk = errors.length === 0;
  return {
    ok: hardRulesOk,
    hardRulesOk,
    structuralOk,
    conservationOk,
    errors,
    warnings,
    summary,
    unplacedSkus: unplaced.map(row => ({ skuKey: row.skuKey, name: row.name, reason: row.reason }))
  };
}

function statusFor(validation) {
  if (!validation.ok) return "failed";
  if (validation.summary.unplacedSkuCount > 0) return "review_required";
  return "passed";
}

export function allocateStore(options) {
  const base = initialPlan(options);
  const optimized = improvePlan(base, options.optimization || {});
  optimized.validation = validatePlan(optimized, { productPool: options.productPool, externalCapL: optimized.params.externalCapL });
  optimized.status = statusFor(optimized.validation);
  const evidenceRows = optimized.rows.filter(row => row.included && row.metrics?.externalUnits > 0).sort((a, b) => b.metrics.staticExternalL - a.metrics.staticExternalL || stableCompare(a.skuKey, b.skuKey)).slice(0, 10);
  const oneMoreColumn = evidenceRows.map(row => {
    const next = simulateExpansion(optimized, row);
    const before = optimized.summary.suggestedExternalL;
    const after = next?.summary.suggestedExternalL ?? before;
    const options = expansionOptions(optimized, row);
    return {
      skuKey: row.skuKey,
      name: row.name,
      currentDisplayCols: row.displayCols,
      currentExternalUnits: row.metrics?.externalUnits || 0,
      currentExternalL: row.metrics?.staticExternalL || 0,
      additionalWidth: row.faceWidth,
      reduceSuggestedExternalL: Math.max(0, before - after),
      hasLegalExpansionCabinet: options.length > 0,
      legalExpansionCabinets: options.map(item => item.cabinetKey)
    };
  }).sort((a, b) => b.reduceSuggestedExternalL - a.reduceSuggestedExternalL || b.currentExternalL - a.currentExternalL || stableCompare(a.skuKey, b.skuKey));
  optimized.evidence = {
    minimumSuggestedExternalLFound: optimized.summary.suggestedExternalL,
    excessOverCapL: Math.max(0, optimized.summary.suggestedExternalL - optimized.params.externalCapL),
    topExternalContributors: evidenceRows.map(row => {
      const detail = oneMoreColumn.find(item => item.skuKey === row.skuKey);
      return {
        skuKey: row.skuKey,
        name: row.name,
        currentDisplayCols: detail?.currentDisplayCols || row.displayCols,
        currentExternalUnits: row.metrics.externalUnits,
        currentExternalL: row.metrics.staticExternalL,
        additionalWidth: detail?.additionalWidth || row.faceWidth,
        reduceSuggestedExternalL: detail?.reduceSuggestedExternalL || 0,
        hasLegalExpansionCabinet: detail?.hasLegalExpansionCabinet || false,
        legalExpansionCabinets: detail?.legalExpansionCabinets || []
      };
    }),
    oneMoreColumn: oneMoreColumn.slice(0, 10),
    remainingUsableWidth: optimized.cabinets.filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > EPSILON).map(cabinet => ({ cabinetKey: cabinet.key, leftWidth: cabinet.leftWidth })),
    maximumContinuousRemainingWidth: Math.max(0, ...optimized.cabinets.filter(cabinet => cabinet.saleEligible).map(cabinet => cabinet.leftWidth))
  };
  return optimized;
}

export function planSignature(plan) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {});
    return value;
  };
  return JSON.stringify(canonical({
    version: plan.version,
    store: plan.store,
    rows: plan.rows,
    cabinets: plan.cabinets,
    summary: plan.summary,
    validation: plan.validation,
    status: plan.status
  }));
}

export const 新店业务候选 = locationsFor;
export const 新店业务方案比较 = comparePlans;
export const 新店业务扩陈 = simulateExpansion;
export const 新店业务尝试补位 = (plan, row) => locationsFor(plan, row, { limit: 20 });
export const 新店业务尝试换柜 = simulateMove;
export const 新店业务尝试互换 = simulateSwap;
export const 新店业务局部优化 = improvePlan;
export const 严格校验新增门店排柜业务优化 = validatePlan;
export const 严格预排新增门店业务优化 = allocateStore;
export const 新店业务证据 = plan => plan.evidence;

if (typeof globalThis !== "undefined") {
  globalThis.StrictAllocationEngine = {
    activeProductPool,
    normalizeCabinets,
    recalculatePlan,
    allocateStore,
    improvePlan,
    comparePlans,
    validatePlan,
    planSignature,
    新店业务候选,
    新店业务方案比较,
    新店业务扩陈,
    新店业务尝试补位,
    新店业务尝试换柜,
    新店业务尝试互换,
    新店业务局部优化,
    严格校验新增门店排柜业务优化,
    严格预排新增门店业务优化,
    新店业务证据
  };
}
