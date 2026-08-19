import { calculatePhysicalCandidates } from "./phase1-physical-candidates.mjs";
import { loadAndValidatePhase0 } from "./phase0-input.mjs";
import { calculateSkuInventoryMetrics, summarizeStoreInventoryMetrics } from "./inventory-metrics.mjs";
import { asNumber, asText, gradeScore, stableCompare, stableSkuKey, isIceProduct, clone } from "./common.mjs";
import { detectStoreImpact } from "./impact-detection.mjs";
import { validateSegmentWidthLedgers } from "./segment-width-ledger.mjs";

const EPSILON = 0.0001;
const EXTERNAL_CAP_L = 754;
const NOOP_MESSAGE = "当前产品池及柜体未发生需要重排的变化，保持现有排柜。";
const STORE_CAPACITY_REASON = "STORE_CAPACITY_PRIORITY";
const PHYSICAL_FIT_REASON = "PHYSICAL_FIT";
const HIGHER_VALUE_REASON = "HIGHER_VALUE_REPLACEMENT";

function rowsOf(plan) {
  return Array.isArray(plan?.rows) ? plan.rows : Array.isArray(plan?.placements) ? plan.placements : [];
}

function productKey(product) {
  return stableSkuKey(product) || asText(product?.skuKey);
}

function productIce(product) {
  return typeof product?.ice === "boolean" ? product.ice : isIceProduct(product);
}

function productMap(products = []) {
  return new Map((Array.isArray(products) ? products : []).map(product => [productKey(product), product]));
}

function activeProducts(products = []) {
  return (Array.isArray(products) ? products : []).filter(product => product?.active !== false);
}

function canonicalRows(plan) {
  return rowsOf(plan).map(row => ({
    skuKey: productKey(row),
    included: row.included !== false,
    excludedForStore: row.excludedForStore === true || row.included === false,
    cabinetKey: asText(row.cabinetKey || row.segmentKey),
    segmentKey: asText(row.segmentKey || row.cabinetKey),
    position: asText(row.position),
    orientation: asText(row.orientation),
    displayCols: Math.max(0, Math.floor(asNumber(row.displayCols))),
    reasonCode: asText(row.reasonCode)
  })).sort((left, right) => stableCompare(left.skuKey, right.skuKey));
}

export function buildIncrementalPlanSignature(plan) {
  return JSON.stringify({
    store: asText(plan?.store),
    rows: canonicalRows(plan)
  });
}

export function buildIncrementalMetricsSignature(plan) {
  const summary = plan?.summary || {};
  return [
    asNumber(summary.includedSkuCount ?? summary.placedSkuCount),
    asNumber(summary.excludedForStoreCount ?? summary.unplacedSkuCount),
    asNumber(summary.directCaseSkuCount ?? summary.directCartonSkuCount),
    asNumber(summary.externalSkuCount),
    asNumber(summary.staticExternalL),
    asNumber(summary.suggestedExternalL),
    asNumber(summary.usedWidth),
    asNumber(summary.remainingWidth)
  ].join("|");
}

function isZeroDelta(delta = {}) {
  return !(delta.removedProducts || []).length
    && !(delta.addedProducts || []).length
    && !(delta.dimensionChangedProducts || []).length
    && !(delta.cartonChangedProducts || []).length
    && !(delta.priorityChangedProducts || []).length
    && !(delta.cabinetStoreKeys || []).length
    && !delta.physicalRuleChanged
    && !delta.productPoolChanged
    && !delta.cabinetChanged;
}

function includedRows(plan) {
  return rowsOf(plan).filter(row => row.included !== false && asText(row.cabinetKey || row.segmentKey));
}

function includedKeys(plan) {
  return new Set(includedRows(plan).map(productKey).filter(Boolean));
}

function cabinetIceOnly(cabinet) {
  if (typeof cabinet?.iceOnly === "boolean") return cabinet.iceOnly;
  return /冰淇淋|冰柜/.test([cabinet?.label, cabinet?.kind, cabinet?.type].map(asText).join("|"));
}

function storageOnly(cabinet) {
  return Boolean(cabinet?.storageOnly) || (/立柜/.test([cabinet?.label, cabinet?.kind, cabinet?.type].map(asText).join("|")) && /第\s*6\s*层/.test(asText(cabinet?.position)));
}

function storeCabinets(store, cabinets = []) {
  return (Array.isArray(cabinets) ? cabinets : [])
    .filter(cabinet => asText(cabinet.store) === asText(store))
    .map(cabinet => ({
      ...clone(cabinet),
      key: asText(cabinet.key) || `${asText(cabinet.store)}__${asText(cabinet.label)}__${asText(cabinet.position)}`,
      length: asNumber(cabinet.length),
      depth: asNumber(cabinet.depth),
      height: asNumber(cabinet.height),
      iceOnly: cabinetIceOnly(cabinet),
      storageOnly: storageOnly(cabinet),
      saleEligible: cabinet.saleEligible !== false && !storageOnly(cabinet),
      usedWidth: 0,
      leftWidth: asNumber(cabinet.length),
      items: []
    }))
    .sort((left, right) => stableCompare(left.key, right.key));
}

function candidateIndex({ store, productPool, cabinets, params, physicalRecords }) {
  const phase0 = loadAndValidatePhase0({ store, productPool, cabinets, params, physicalRecords });
  if (!phase0.ok) return { phase0, bySku: new Map() };
  const phase1 = calculatePhysicalCandidates(phase0);
  return { phase0, bySku: phase1.candidatesBySku };
}

function rowWidth(row) {
  const face = asNumber(row.faceWidth || row.metrics?.faceWidth);
  const cols = Math.max(0, Math.floor(asNumber(row.displayCols || row.metrics?.displayCols)));
  return face * cols;
}

function buildWidthState(plan, cabinets) {
  const states = new Map(cabinets.map(cabinet => [cabinet.key, cabinet]));
  for (const row of includedRows(plan)) {
    const key = asText(row.segmentKey || row.cabinetKey);
    const segment = states.get(key);
    if (!segment) continue;
    const width = rowWidth(row);
    segment.usedWidth += width;
    segment.items.push(productKey(row));
  }
  for (const segment of states.values()) {
    segment.leftWidth = segment.length - segment.usedWidth;
    segment.overWidth = segment.leftWidth < -EPSILON;
  }
  return states;
}

function valueScore(row) {
  return asNumber(row.dailyQty) * 100000
    + gradeScore(row.grade) * 10000
    - asNumber(row.rank)
    + asNumber(row.businessPriority) * 100
    + asNumber(row.categoryCore);
}

function rankedProducts(products = []) {
  return products.slice().sort((left, right) => gradeScore(right.grade) - gradeScore(left.grade)
    || asNumber(left.rank || 999999) - asNumber(right.rank || 999999)
    || asNumber(right.dailyQty) - asNumber(left.dailyQty)
    || stableCompare(productKey(left), productKey(right))).map((product, priorityOrder) => ({
      ...product,
      skuKey: productKey(product),
      priorityOrder
    }));
}

function metricFor(row, product, displayCols = row.displayCols, candidate = null, params = {}) {
  const perCol = asNumber(candidate?.perCol || row.perCol || row.metrics?.perCol);
  const faceWidth = asNumber(candidate?.faceWidth || row.faceWidth || row.metrics?.faceWidth);
  return calculateSkuInventoryMetrics({
    perCol,
    displayCols,
    cartonQty: product?.carton ?? row.carton,
    triggerRate: asNumber(params.triggerRate ?? 0.1),
    unitVolumeL: product?.volume ?? row.volume,
    dailyQty: product?.dailyQty ?? row.dailyQty,
    faceWidth
  });
}

function summaryForPlan(plan, params = {}) {
  const included = includedRows(plan);
  const metrics = included.map(row => row.metrics).filter(Boolean);
  const inventory = summarizeStoreInventoryMetrics(metrics, params);
  const cabinets = Array.isArray(plan.cabinets) ? plan.cabinets : [];
  return {
    ...plan.summary,
    candidateSkuCount: rowsOf(plan).length,
    includedSkuCount: included.length,
    excludedForStoreCount: rowsOf(plan).length - included.length,
    placedSkuCount: included.length,
    unplacedSkuCount: rowsOf(plan).length - included.length,
    directCaseSkuCount: inventory.directCaseSkuCount,
    directCartonSkuCount: inventory.directCaseSkuCount,
    externalSkuCount: inventory.externalSkuCount,
    staticExternalL: inventory.staticExternalL,
    avgExternalL: inventory.avgExternalL,
    suggestedExternalL: inventory.suggestedExternalL,
    usedWidth: cabinets.reduce((sum, cabinet) => sum + asNumber(cabinet.usedWidth), 0),
    remainingWidth: cabinets.reduce((sum, cabinet) => sum + Math.max(0, asNumber(cabinet.leftWidth)), 0),
    overWidthCount: cabinets.filter(cabinet => cabinet.overWidth).length
  };
}

function makeExcludedRow(product, reasonCode = STORE_CAPACITY_REASON, reason = "现有柜体容量及商品结构下，本店暂不纳入该商品。") {
  return {
    ...clone(product),
    skuKey: productKey(product),
    included: false,
    excludedForStore: true,
    cabinetKey: "",
    segmentKey: "",
    displayCols: 0,
    perCol: 0,
    faceWidth: 0,
    usedWidth: 0,
    metrics: null,
    reasonCode,
    reason,
    status: "未纳入"
  };
}

function hydrateProductRows(plan, products, removedKeys) {
  const map = productMap(products);
  const rows = rowsOf(plan)
    .filter(row => !removedKeys.has(productKey(row)))
    .map(row => ({ ...clone(row), skuKey: productKey(row), segmentKey: asText(row.segmentKey || row.cabinetKey) }));
  const seen = new Set(rows.map(productKey));
  for (const product of activeProducts(products)) {
    const key = productKey(product);
    if (!key || seen.has(key) || removedKeys.has(key)) continue;
    rows.push(makeExcludedRow(product));
  }
  return rows.map(row => {
    const product = map.get(productKey(row));
    return { ...product, ...row, ice: typeof row.ice === "boolean" ? row.ice : productIce(product || row) };
  });
}

function candidateForRow(row, candidates) {
  const list = candidates.get(productKey(row)) || [];
  return list.find(item => item.cabinetKey === asText(row.cabinetKey || row.segmentKey)
    && (!row.orientation || item.orientation === row.orientation))
    || list.find(item => item.cabinetKey === asText(row.cabinetKey || row.segmentKey))
    || list[0];
}

function recalculateChangedPlan(plan, products, cabinets, params, candidateMap) {
  const map = productMap(products);
  const states = buildWidthState(plan, cabinets);
  for (const row of includedRows(plan)) {
    const product = map.get(productKey(row)) || row;
    const candidate = candidateForRow(row, candidateMap);
    const needsPhysicalHydration = !(asNumber(row.faceWidth) > 0 && asNumber(row.perCol) > 0 && asText(row.orientation));
    if (candidate && needsPhysicalHydration) {
      row.orientation = candidate.orientation;
      row.faceWidth = candidate.faceWidth;
      row.perCol = candidate.perCol;
      row.orientedDepth = candidate.orientedDepth;
      row.orientedHeight = candidate.orientedHeight;
      row.depthCount = candidate.depthCount;
      row.stackCount = candidate.stackCount;
      row.cabinetClass = candidate.cabinetClass;
      row.physicalSource = candidate.physicalSource;
    }
    row.displayCols = Math.max(1, Math.floor(asNumber(row.displayCols)));
    row.segmentKey = asText(row.segmentKey || row.cabinetKey);
    row.usedWidth = rowWidth(row);
    row.metrics = metricFor(row, product, row.displayCols, needsPhysicalHydration ? candidate : null, params);
    row.ice = productIce(product);
  }
  for (const segment of states.values()) {
    segment.usedWidth = 0;
    segment.items = [];
  }
  for (const row of includedRows(plan)) {
    const segment = states.get(row.segmentKey);
    if (!segment) continue;
    segment.usedWidth += row.usedWidth;
    segment.items.push(productKey(row));
  }
  for (const segment of states.values()) {
    segment.leftWidth = segment.length - segment.usedWidth;
    segment.overWidth = segment.leftWidth < -EPSILON;
  }
  plan.cabinets = [...states.values()];
  plan.summary = summaryForPlan(plan, params);
  return states;
}

function actionKey(action) {
  return [action.type, action.skuKey, action.segmentKey || "", action.displayCols || ""].join("|");
}

function sortedRows(rows) {
  return rows.slice().sort((left, right) => valueScore(right) - valueScore(left) || stableCompare(productKey(left), productKey(right)));
}

function actualSegmentUsed(plan, segmentKey) {
  return includedRows(plan).filter(row => asText(row.segmentKey || row.cabinetKey) === asText(segmentKey)).reduce((sum, row) => sum + rowWidth(row), 0);
}

function expandInReleasedSegment(plan, targetSegment, retiredRow, products, params, candidateMap, actions) {
  if (!targetSegment) return;
  const map = productMap(products);
  const candidates = includedRows(plan)
    .filter(row => row.segmentKey === targetSegment.key)
    .filter(row => row.category4 === retiredRow.category4 || row.category3 === retiredRow.category3 || row.metrics?.externalUnits > 0)
    .sort((left, right) => {
      const leftProduct = map.get(productKey(left)) || left;
      const rightProduct = map.get(productKey(right)) || right;
      const leftNext = metricFor(left, leftProduct, left.displayCols + 1, candidateForRow(left, candidateMap), params);
      const rightNext = metricFor(right, rightProduct, right.displayCols + 1, candidateForRow(right, candidateMap), params);
      const leftRelief = (left.metrics?.staticExternalL || 0) - leftNext.staticExternalL;
      const rightRelief = (right.metrics?.staticExternalL || 0) - rightNext.staticExternalL;
      const leftCategory = Number(left.category4 === retiredRow.category4) * 2 + Number(left.category3 === retiredRow.category3);
      const rightCategory = Number(right.category4 === retiredRow.category4) * 2 + Number(right.category3 === retiredRow.category3);
      return Number(rightNext.directCase) - Number(leftNext.directCase)
        || rightRelief - leftRelief
        || rightCategory - leftCategory
        || valueScore(right) - valueScore(left)
        || stableCompare(productKey(left), productKey(right));
    });
  for (const row of candidates) {
    if (targetSegment.leftWidth + EPSILON < asNumber(row.faceWidth)
      || actualSegmentUsed(plan, targetSegment.key) + asNumber(row.faceWidth) > targetSegment.length + EPSILON) continue;
    const product = map.get(productKey(row)) || row;
    const candidate = candidateForRow(row, candidateMap);
    const nextMetrics = metricFor(row, product, row.displayCols + 1, candidate, params);
    targetSegment.leftWidth -= asNumber(row.faceWidth);
    targetSegment.usedWidth += asNumber(row.faceWidth);
    row.displayCols += 1;
    row.metrics = nextMetrics;
    row.usedWidth = rowWidth(row);
    actions.push({ type: "expand-released-segment", skuKey: productKey(row), segmentKey: targetSegment.key, displayCols: row.displayCols, action: "增加1列", stableActionKey: actionKey({ type: "expand", skuKey: productKey(row), segmentKey: targetSegment.key, displayCols: row.displayCols }) });
    break;
  }
}

function fillReleasedSegment(plan, targetSegment, products, params, candidateMap, actions) {
  if (!targetSegment) return;
  const map = productMap(products);
  const excluded = rowsOf(plan).filter(row => row.included === false).filter(row => (candidateMap.get(productKey(row)) || []).length);
  for (const row of sortedRows(excluded)) {
    const candidate = (candidateMap.get(productKey(row)) || [])
      .filter(item => item.cabinetKey === targetSegment.key && !targetSegment.storageOnly && targetSegment.iceOnly === productIce(map.get(productKey(row)) || row))
      .sort((left, right) => left.faceWidth - right.faceWidth || right.perCol - left.perCol || stableCompare(left.orientation, right.orientation))[0];
    if (!candidate || targetSegment.leftWidth + EPSILON < candidate.faceWidth
      || actualSegmentUsed(plan, targetSegment.key) + candidate.faceWidth > targetSegment.length + EPSILON) continue;
    const product = map.get(productKey(row)) || row;
    Object.assign(row, {
      included: true,
      excludedForStore: false,
      cabinetKey: targetSegment.key,
      segmentKey: targetSegment.key,
      cabinetLabel: candidate.cabinetLabel,
      position: candidate.position,
      orientation: candidate.orientation,
      faceWidth: candidate.faceWidth,
      perCol: candidate.perCol,
      orientedDepth: candidate.orientedDepth,
      orientedHeight: candidate.orientedHeight,
      depthCount: candidate.depthCount,
      stackCount: candidate.stackCount,
      displayCols: 1,
      usedWidth: candidate.faceWidth,
      metrics: metricFor(row, product, 1, candidate, params),
      reason: "",
      reasonCode: "",
      status: "已纳入"
    });
    targetSegment.leftWidth -= candidate.faceWidth;
    targetSegment.usedWidth += candidate.faceWidth;
    targetSegment.items.push(productKey(row));
    actions.push({ type: "fill-released-segment", skuKey: productKey(row), segmentKey: targetSegment.key, displayCols: 1, stableActionKey: actionKey({ type: "fill", skuKey: productKey(row), segmentKey: targetSegment.key, displayCols: 1 }) });
  }
}

function tryAddProduct(plan, product, states, products, params, candidateMap, actions) {
  const existing = rowsOf(plan).find(row => productKey(row) === productKey(product));
  if (!existing) plan.rows.push(makeExcludedRow(product, PHYSICAL_FIT_REASON, "现有柜体容量及商品结构下，本店暂不纳入该新品。"));
  const row = existing || plan.rows[plan.rows.length - 1];
  const candidates = (candidateMap.get(productKey(product)) || []).filter(candidate => {
    const state = states.get(candidate.cabinetKey);
    return state && state.saleEligible && state.iceOnly === productIce(product) && state.leftWidth + EPSILON >= candidate.faceWidth;
  }).sort((left, right) => {
    const leftState = states.get(left.cabinetKey);
    const rightState = states.get(right.cabinetKey);
    const leftDirect = metricFor(row, product, 1, left, params).directCase;
    const rightDirect = metricFor(row, product, 1, right, params).directCase;
    return Number(rightDirect) - Number(leftDirect)
      || (rightState?.leftWidth || 0) - (leftState?.leftWidth || 0)
      || left.faceWidth - right.faceWidth
      || stableCompare(left.cabinetKey, right.cabinetKey)
      || stableCompare(left.orientation, right.orientation);
  });
  const candidate = candidates[0];
  if (candidate) {
    const state = states.get(candidate.cabinetKey);
    Object.assign(row, {
      ...clone(product),
      skuKey: productKey(product),
      included: true,
      excludedForStore: false,
      cabinetKey: candidate.cabinetKey,
      segmentKey: candidate.cabinetKey,
      cabinetLabel: candidate.cabinetLabel,
      position: candidate.position,
      orientation: candidate.orientation,
      faceWidth: candidate.faceWidth,
      perCol: candidate.perCol,
      orientedDepth: candidate.orientedDepth,
      orientedHeight: candidate.orientedHeight,
      depthCount: candidate.depthCount,
      stackCount: candidate.stackCount,
      displayCols: 1,
      usedWidth: candidate.faceWidth,
      metrics: metricFor(row, product, 1, candidate, params),
      reason: "",
      reasonCode: "",
      status: "已纳入"
    });
    state.usedWidth += candidate.faceWidth;
    state.leftWidth -= candidate.faceWidth;
    state.items.push(productKey(product));
    actions.push({ type: "add-in-empty-space", skuKey: productKey(product), segmentKey: candidate.cabinetKey, displayCols: 1, stableActionKey: actionKey({ type: "add", skuKey: productKey(product), segmentKey: candidate.cabinetKey, displayCols: 1 }) });
    return { included: true, replacedSkuKey: "", swap: false };
  }

  const replaceable = sortedRows(includedRows(plan)).reverse();
  for (const oldRow of replaceable) {
    const state = states.get(oldRow.segmentKey || oldRow.cabinetKey);
    if (!state || valueScore(product) <= valueScore(oldRow)) continue;
    const oldWidth = rowWidth(oldRow);
    const replacement = (candidateMap.get(productKey(product)) || []).find(item => item.cabinetKey === state.key && state.iceOnly === productIce(product) && item.faceWidth <= oldWidth + EPSILON);
    if (!replacement) continue;
    const oldKey = productKey(oldRow);
    Object.assign(oldRow, makeExcludedRow({ ...oldRow, skuKey: oldKey, barcode: oldKey }, HIGHER_VALUE_REASON, "为保留更高经营价值的新品，本店暂不纳入原低优先级商品。"));
    Object.assign(row, {
      ...clone(product), skuKey: productKey(product), included: true, excludedForStore: false,
      cabinetKey: state.key, segmentKey: state.key, cabinetLabel: replacement.cabinetLabel, position: replacement.position,
      orientation: replacement.orientation, faceWidth: replacement.faceWidth, perCol: replacement.perCol,
      orientedDepth: replacement.orientedDepth, orientedHeight: replacement.orientedHeight, depthCount: replacement.depthCount,
      stackCount: replacement.stackCount, displayCols: 1, usedWidth: replacement.faceWidth,
      metrics: metricFor(row, product, 1, replacement, params), reason: "", reasonCode: "", status: "已纳入"
    });
    state.usedWidth += replacement.faceWidth - oldWidth;
    state.leftWidth = state.length - state.usedWidth;
    actions.push({ type: "one-for-one-swap", skuKey: productKey(product), replacedSkuKey: oldKey, segmentKey: state.key, displayCols: 1, stableActionKey: actionKey({ type: "swap", skuKey: productKey(product), segmentKey: state.key, displayCols: 1 }) });
    return { included: true, replacedSkuKey: oldKey, swap: true };
  }
  row.reasonCode = STORE_CAPACITY_REASON;
  row.reason = "现有柜体容量及商品结构下，本店暂不纳入该新品。";
  row.excludedForStore = true;
  row.included = false;
  return { included: false, replacedSkuKey: "", swap: false };
}

export function validateIncrementalDraft(plan, { productPool, externalCapL = EXTERNAL_CAP_L } = {}) {
  const rows = rowsOf(plan);
  const errors = [];
  const seen = new Set();
  for (const row of rows) {
    const key = productKey(row);
    if (!key || seen.has(key)) errors.push(`SKU守恒异常或重复SKU：${key || "空"}`);
    seen.add(key);
    if (row.included === false && !row.excludedForStore) errors.push(`未纳入SKU缺少门店去向：${key}`);
    if (row.included === false && !asText(row.reasonCode)) errors.push(`未纳入SKU缺少原因：${key}`);
    if (row.included !== false && (!asText(row.segmentKey || row.cabinetKey) || !(asNumber(row.displayCols) >= 1))) errors.push(`纳入SKU缺少合法柜段或列数：${key}`);
  }
  const activeKeys = new Set(activeProducts(productPool).map(productKey));
  for (const key of activeKeys) if (!seen.has(key)) errors.push(`当前有效SKU无明确去向：${key}`);
  const ledgerStates = new Map((plan.cabinets || []).map(cabinet => [cabinet.key, {
    ...cabinet,
    placements: rows.filter(row => row.included !== false && asText(row.segmentKey || row.cabinetKey) === asText(cabinet.key)).map(row => ({
      skuKey: productKey(row),
      name: row.name,
      segmentKey: asText(row.segmentKey || row.cabinetKey),
      faceWidth: asNumber(row.faceWidth),
      displayCols: Math.max(0, Math.floor(asNumber(row.displayCols))),
      usedWidth: rowWidth(row)
    })),
    usedWidth: 0,
    remainingWidth: asNumber(cabinet.length)
  }]));
  for (const segment of ledgerStates.values()) {
    segment.usedWidth = segment.placements.reduce((sum, placement) => sum + placement.usedWidth, 0);
    segment.remainingWidth = segment.length - segment.usedWidth;
  }
  const ledger = validateSegmentWidthLedgers(ledgerStates);
  if (!ledger.ok) errors.push("柜段宽度账校验失败");
  for (const cabinet of plan.cabinets || []) {
    if (asNumber(cabinet.length) <= 0 || asNumber(cabinet.depth) <= 0 || asNumber(cabinet.height) <= 0) errors.push(`柜段物理尺寸无效：${cabinet.key}`);
    if (asNumber(cabinet.leftWidth) < -EPSILON || cabinet.overWidth) errors.push(`柜段超宽：${cabinet.key}`);
    const actualUsedWidth = rows.filter(row => row.included !== false && asText(row.segmentKey || row.cabinetKey) === asText(cabinet.key)).reduce((sum, row) => sum + rowWidth(row), 0);
    if (actualUsedWidth > asNumber(cabinet.length) + EPSILON) errors.push(`柜段实际占宽超出：${cabinet.key}`);
  }
  const products = productMap(productPool);
  for (const row of rows.filter(item => item.included !== false)) {
    const cabinet = (plan.cabinets || []).find(item => item.key === asText(row.segmentKey || row.cabinetKey));
    if (!cabinet) { errors.push(`纳入SKU没有对应柜段：${productKey(row)}`); continue; }
    if (!cabinet.saleEligible || storageOnly(cabinet)) errors.push(`第6层或非销售位被用于销售：${productKey(row)}`);
    if (productIce(products.get(productKey(row)) || row) !== Boolean(cabinet.iceOnly)) errors.push(`冰品柜隔离错误：${productKey(row)}`);
    if (asNumber(row.faceWidth) * Math.max(1, Math.floor(asNumber(row.displayCols))) > asNumber(cabinet.length) + EPSILON) errors.push(`SKU占宽不适配柜段：${productKey(row)}`);
    if (asNumber(row.orientedDepth) > 0 && asNumber(row.orientedDepth) > asNumber(cabinet.depth) + EPSILON) errors.push(`SKU纵深不适配柜段：${productKey(row)}`);
    if (asNumber(row.orientedHeight) > 0 && asNumber(row.orientedHeight) > asNumber(cabinet.height) + EPSILON) errors.push(`SKU高度不适配柜段：${productKey(row)}`);
    if (row.metrics && Object.values(row.metrics).some(value => typeof value === "number" && !Number.isFinite(value))) errors.push(`SKU指标存在NaN：${productKey(row)}`);
  }
  if (asNumber(plan.summary?.suggestedExternalL) > externalCapL) errors.push(`建议外储超过754L：${plan.summary.suggestedExternalL}L`);
  return { ok: errors.length === 0, errors, overWidthCount: errors.filter(error => error.startsWith("柜段超宽")).length, widthLedgerMismatchCount: ledger.ledgerMismatchCount, layer6SalesCount: errors.filter(error => error.includes("第6层")).length, iceMismatchCount: errors.filter(error => error.includes("冰品柜隔离")).length };
}

function makePlanResult({ storeKey, draft, beforePlan, mode, affected, reasonCodes, actions, delta, fullReplanCalled = false }) {
  const beforeSignature = buildIncrementalPlanSignature(beforePlan);
  const afterSignature = buildIncrementalPlanSignature(draft);
  const actionSequenceSignature = actions.map(action => action.stableActionKey || actionKey(action)).sort(stableCompare).join("||");
  const metricsSignature = buildIncrementalMetricsSignature(draft);
  const validation = draft.validation || { ok: true, errors: [] };
  const status = validation.ok ? (draft.softReviewItems?.length ? "review_required" : "passed") : "failed";
  draft.planSignature = afterSignature;
  draft.metricsSignature = metricsSignature;
  draft.actionSequenceSignature = actionSequenceSignature;
  draft.replanMeta = {
    mode, affected, reasonCodes, delta: { added: (delta.addedProducts || []).map(productKey), removed: (delta.removedProducts || []).map(productKey) },
    beforePlanSignature: beforeSignature, afterPlanSignature: afterSignature,
    movedSkuCount: new Set(actions.filter(action => ["move", "swap", "local-adjust"].includes(action.type)).flatMap(action => [action.skuKey, action.replacedSkuKey].filter(Boolean))).size,
    fullReplanCalled,
    message: affected ? "仅对受影响区域执行增量重排。" : NOOP_MESSAGE
  };
  return {
    store: storeKey,
    mode,
    affected,
    status,
    reasonCodes,
    beforePlanSignature: beforeSignature,
    afterPlanSignature: afterSignature,
    actionSequenceSignature,
    metricsSignature,
    replanDraft: draft,
    validation,
    fullReplanCalled,
    movedSkuCount: draft.replanMeta.movedSkuCount,
    actions,
    changeSummary: {
      addedSkuKeys: (delta.addedProducts || []).map(productKey).filter(key => rowsOf(draft).some(row => productKey(row) === key && row.included !== false)),
      removedSkuKeys: (delta.removedProducts || []).map(productKey),
      includedChanges: rowsOf(draft).filter(row => row.included !== false).length - includedRows(beforePlan).length,
      excludedChanges: rowsOf(draft).filter(row => row.included === false).length - rowsOf(beforePlan).filter(row => row.included === false).length,
      beforeSuggestedExternalL: beforePlan.summary?.suggestedExternalL,
      afterSuggestedExternalL: draft.summary?.suggestedExternalL
    }
  };
}

export function createDraftFromCurrentPlan({
  store,
  currentPlan,
  previousPlan = currentPlan,
  productPool,
  cabinets,
  params = {},
  physicalRecords = [],
  delta = {},
  mode = "affected",
  selectedStoreKeys = [],
  fullReplanEngine = null
}) {
  const storeKey = asText(store || currentPlan?.store);
  if (!currentPlan) {
    if (typeof fullReplanEngine !== "function") throw new Error("currentPlan不存在，不能静默进入完整重排。请提供已验收完整排柜核心。 ");
    const full = fullReplanEngine({ store: storeKey, productPool, cabinets, params, physicalRecords });
    return makePlanResult({ storeKey, draft: full, beforePlan: { store: storeKey, rows: [], cabinets: [] }, mode: "all", affected: true, reasonCodes: ["CURRENT_PLAN_MISSING"], actions: [], delta, fullReplanCalled: true });
  }
  if (mode === "all" && typeof fullReplanEngine === "function") {
    const full = fullReplanEngine({ store: storeKey, productPool, cabinets, params, physicalRecords, previousPlan });
    return makePlanResult({ storeKey, draft: full, beforePlan: currentPlan, mode, affected: true, reasonCodes: ["FULL_REPLAN_REQUESTED"], actions: [], delta, fullReplanCalled: true });
  }
  if (mode === "all" && !fullReplanEngine) throw new Error("mode=all只能调用已验收完整排柜核心，当前未提供核心入口。");
  if (isZeroDelta(delta)) {
    const draft = clone(currentPlan);
    draft.message = NOOP_MESSAGE;
    return makePlanResult({ storeKey, draft, beforePlan: currentPlan, mode, affected: false, reasonCodes: ["NO_IMPACT"], actions: [], delta });
  }
  const removedKeys = new Set((delta.removedProducts || []).map(productKey));
  const products = activeProducts(productPool);
  const draft = clone(currentPlan);
  draft.store = storeKey;
  draft.rows = hydrateProductRows(currentPlan, products, removedKeys);
  draft.cabinets = storeCabinets(storeKey, cabinets);
  draft.params = { ...(currentPlan.params || {}), ...params };
  const index = candidateIndex({ store: storeKey, productPool: products, cabinets, params: draft.params, physicalRecords });
  const impact = detectStoreImpact({ storeKey, mode, selectedStoreKeys, changes: delta, previousPlan: currentPlan, phase1: { candidatesBySku: index.bySku }, phase2: { rankedSkus: rankedProducts(products) } });
  if (!impact.affected) {
    const unchanged = clone(currentPlan);
    unchanged.message = NOOP_MESSAGE;
    return makePlanResult({ storeKey, draft: unchanged, beforePlan: currentPlan, mode, affected: false, reasonCodes: impact.reasons.map(reason => reason.reasonCode), actions: [], delta });
  }
  const actions = [];
  const states = recalculateChangedPlan(draft, products, storeCabinets(storeKey, cabinets), draft.params, index.bySku);
  for (const removed of delta.removedProducts || []) {
    const retiredKey = productKey(removed);
    const retiredRow = rowsOf(currentPlan).find(row => productKey(row) === retiredKey) || { ...removed, skuKey: retiredKey };
    const targetSegment = states.get(asText(retiredRow.segmentKey || retiredRow.cabinetKey));
    draft.rows = rowsOf(draft).filter(row => productKey(row) !== retiredKey);
    actions.push({ type: "retire", skuKey: retiredKey, segmentKey: targetSegment?.key || "", releasedWidth: rowWidth(retiredRow), stableActionKey: actionKey({ type: "retire", skuKey: retiredKey, segmentKey: targetSegment?.key || "", displayCols: retiredRow.displayCols }) });
    if (targetSegment) {
      targetSegment.usedWidth = Math.max(0, targetSegment.usedWidth - rowWidth(retiredRow));
      targetSegment.leftWidth = targetSegment.length - targetSegment.usedWidth;
      expandInReleasedSegment(draft, targetSegment, retiredRow, products, draft.params, index.bySku, actions);
      fillReleasedSegment(draft, targetSegment, products, draft.params, index.bySku, actions);
    }
  }
  for (const added of delta.addedProducts || []) tryAddProduct(draft, added, states, products, draft.params, index.bySku, actions);
  recalculateChangedPlan(draft, products, storeCabinets(storeKey, cabinets), draft.params, index.bySku);
  draft.validation = validateIncrementalDraft(draft, { productPool: products, externalCapL: draft.params.externalCapL ?? EXTERNAL_CAP_L });
  return makePlanResult({ storeKey, draft, beforePlan: currentPlan, mode, affected: true, reasonCodes: impact.reasons.map(reason => reason.reasonCode), actions, delta });
}

export function detectAffectedStores({ stores = [], currentPlans, productPool, cabinets, params = {}, physicalRecords = [], delta = {}, mode = "affected", selectedStoreKeys = [] }) {
  const planFor = store => currentPlans instanceof Map ? currentPlans.get(store) : Array.isArray(currentPlans) ? currentPlans.find(plan => asText(plan?.store) === asText(store)) : currentPlans?.[store];
  return stores.map(store => {
    const currentPlan = planFor(store);
    if (!currentPlan) return { store, affected: true, scope: "AFFECTED_STORES", reasons: [{ reasonCode: "CURRENT_PLAN_MISSING", reason: "当前门店没有currentPlan" }], recommendedAction: "FULL_REPLAN" };
    const index = (delta.addedProducts || []).length
      ? candidateIndex({ store, productPool: activeProducts(productPool).concat(delta.addedProducts || []), cabinets, params, physicalRecords })
      : { bySku: new Map() };
    return detectStoreImpact({
      storeKey: store,
      mode,
      selectedStoreKeys,
      changes: delta,
      previousPlan: currentPlan,
      phase1: { candidatesBySku: index.bySku },
      phase2: { rankedSkus: rankedProducts(activeProducts(productPool).concat(delta.addedProducts || [])) }
    });
  }).sort((left, right) => stableCompare(left.storeKey || left.store, right.storeKey || right.store));
}

export function runIncrementalReplan({ stores = [], currentPlans, productPool, cabinets, params = {}, physicalRecords = [], delta = {}, mode = "affected", selectedStoreKeys = [], fullReplanEngine = null }) {
  const impact = detectAffectedStores({ stores, currentPlans, productPool, cabinets, params, physicalRecords, delta, mode, selectedStoreKeys });
  const planFor = store => currentPlans instanceof Map ? currentPlans.get(store) : Array.isArray(currentPlans) ? currentPlans.find(plan => asText(plan?.store) === asText(store)) : currentPlans?.[store];
  const results = impact.map(item => {
    const store = item.storeKey || item.store;
    const currentPlan = planFor(store);
    if (!item.affected && currentPlan) return createDraftFromCurrentPlan({ store, currentPlan, productPool, cabinets, params, physicalRecords, delta, mode, selectedStoreKeys });
    return createDraftFromCurrentPlan({ store, currentPlan, productPool: activeProducts(productPool).concat(delta.addedProducts || []), cabinets, params, physicalRecords, delta, mode, selectedStoreKeys, fullReplanEngine });
  });
  return { mode, delta, impact, results, affectedStoreKeys: results.filter(result => result.affected).map(result => result.store), unaffectedStoreKeys: results.filter(result => !result.affected).map(result => result.store) };
}
