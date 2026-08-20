const INVALID_SOURCES = new Set(["default", "inferred", "fallback"]);
const EPSILON = 0.0001;

export const DEFAULT_EXTERNAL_CAP_L = 754;
// Kept as a compatibility export. The formal engine does not use 650L as a
// business acceptance target; the only hard external-storage limit is 754L.
export const TARGET_EXTERNAL_L = 650;

export const STORE_EXCLUSION_REASONS = Object.freeze({
  STORE_CAPACITY_PRIORITY: "门店柜体容量有限，按销售及经营优先级未纳入本店。",
  ICE_CABINET_CAPACITY: "冰淇淋柜容量不足，按销售优先级未纳入本店。",
  PHYSICAL_FIT: "现有柜体物理尺寸无法合法陈列。",
  EXTERNAL_CAP_PRIORITY: "完成合法布局优化后仍超过754L，按门店资源与经营优先级未纳入本店。"
});

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function integer(value, fallback = 0) {
  const n = Math.floor(number(value));
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function isLegalHorizontalFace(product, orientation, capacityOverride) {
  const faceWidth = number(capacityOverride?.faceWidth);
  if (!(faceWidth > 0 && orientation)) return false;
  const matchesProductDimension = Math.abs(faceWidth - number(product?.length)) <= EPSILON
    || Math.abs(faceWidth - number(product?.width)) <= EPSILON;
  return matchesProductDimension && Math.abs(faceWidth - number(orientation.faceWidth)) <= EPSILON;
}

function stableCompare(left, right) {
  return text(left).localeCompare(text(right), "zh-CN", { numeric: true });
}

function stableKey(value) {
  return text(value?.skuKey) || text(value?.barcode) || text(value?.id) || text(value?.key) || text(value?.name);
}

function gradeScore(value) {
  return ({ A: 4, B: 3, C: 2, D: 1 }[text(value).toUpperCase()] ?? 0);
}

function isRetired(product) {
  const state = [product?.status, product?.lifecycleStatus, product?.lifecycleState, product?.action]
    .map(text).join("|");
  return product?.active === false || /淘汰|退休|retired|completed/i.test(state);
}

function isIceSku(product) {
  if (product?.ice === true) return true;
  const value = [product?.category2, product?.category3, product?.category4, product?.name]
    .map(text).join("|");
  return /雪糕|冰淇淋|冰激凌|冰品|冰棍/.test(value);
}

function isIceCabinet(cabinet) {
  if (cabinet?.iceOnly === true) return true;
  const value = [cabinet?.kind, cabinet?.type, cabinet?.label, cabinet?.sceneGroup]
    .map(text).join("|");
  return /冰淇淋柜|冰品柜|冰淇淋|冰柜/.test(value);
}

function isVertical(cabinet) {
  const value = [cabinet?.kind, cabinet?.type, cabinet?.label].map(text).join("|");
  return /立柜|绔嬫煖|vertical/i.test(value);
}

function isStorageOnly(cabinet) {
  if (!isVertical(cabinet)) return false;
  const position = text(cabinet?.position);
  return /第\s*6\s*层|第6层|6\s*层|layer\s*6|绗.*6.*灞/i.test(position);
}

function isSaleCabinet(cabinet) {
  // Cabinet 4 is a normal automatic-allocation cabinet. Historical
  // reservation metadata must not affect the formal strict engine.
  return !isStorageOnly(cabinet);
}

function cabinetType(cabinet) {
  if (isIceCabinet(cabinet)) return "ice";
  if (isVertical(cabinet)) return "vertical";
  return "chest";
}

function categoryScene(product) {
  return text(product?.category3) || text(product?.sceneGroup) || "未分类";
}

const SCENE_ORDER = Object.freeze({
  "雪糕冰品": 0,
  "预制主食": 1,
  "预制菜类": 2,
  "火锅食材": 3,
  "冷冻食材": 4
});

function sceneOrder(product) {
  return SCENE_ORDER[categoryScene(product)] ?? 99;
}

function businessPriority(product) {
  return number(product?.businessPriority ?? product?.priority ?? product?.storePriority ?? product?.priorityScore);
}

function categoryCore(product) {
  return number(product?.categoryCore ?? product?.categoryCoreScore);
}

function hasMeasuredBusinessSignal(product) {
  return (number(product?.rank) > 0 && number(product?.rank) < 9999)
    || number(product?.dailyQty) > 0
    || number(product?.businessPriority ?? product?.priority ?? product?.storePriority ?? product?.priorityScore) > 0
    || number(product?.categoryCore ?? product?.categoryCoreScore) > 0;
}

function dimensions(product) {
  const length = number(product?.length);
  const width = number(product?.width);
  const height = number(product?.height);
  const volume = number(product?.volume) > 0
    ? number(product.volume)
    : length > 0 && width > 0 && height > 0 ? length * width * height / 1e6 : 0;
  return { length, width, height, volume };
}

export function activeProductPool(productPool = []) {
  const result = [];
  const seen = new Set();
  for (const product of Array.isArray(productPool) ? productPool : []) {
    if (isRetired(product)) continue;
    const skuKey = stableKey(product);
    if (!skuKey || seen.has(skuKey)) continue;
    seen.add(skuKey);
    const d = dimensions(product);
    result.push({
      ...product,
      skuKey,
      barcode: text(product?.barcode) || skuKey,
      name: text(product?.name) || skuKey,
      category3: text(product?.category3),
      category4: text(product?.category4),
      sceneGroup: categoryScene(product),
      grade: text(product?.grade),
      rank: number(product?.rank) > 0 ? number(product.rank) : 999999,
      dailyQty: number(product?.dailyQty),
      businessPriority: businessPriority(product),
      categoryCore: categoryCore(product),
      carton: Math.max(0, integer(product?.carton ?? product?.cartonQty)),
      length: d.length,
      width: d.width,
      height: d.height,
      volume: d.volume,
      ice: isIceSku(product)
    });
  }
  return result.sort((a, b) => stableCompare(a.skuKey, b.skuKey));
}

function cabinetIdentity(store, label, position) {
  return `${text(store)}__${text(label)}__${text(position)}`;
}

function sourceIndex(records = []) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = text(record?.key) || cabinetIdentity(record?.store, record?.label, record?.position);
    const list = map.get(key) || [];
    list.push({ ...record, key });
    map.set(key, list);
  }
  return map;
}

export function normalizeCabinets(cabinets = [], { store = "", physicalRecords = [] } = {}) {
  const sources = sourceIndex(physicalRecords);
  return (Array.isArray(cabinets) ? cabinets : [])
    .filter(cabinet => !store || text(cabinet?.store) === text(store))
    .sort((a, b) => stableCompare(a?.key || a?.id || cabinetIdentity(a?.store || store, a?.label, a?.position), b?.key || b?.id || cabinetIdentity(b?.store || store, b?.label, b?.position)))
    .map((raw, index) => {
      const key = text(raw?.key) || cabinetIdentity(raw?.store || store, raw?.label, raw?.position);
      const sourceKey = cabinetIdentity(raw?.store || store, raw?.label, raw?.position);
      const matches = sources.get(sourceKey) || sources.get(key) || [];
      const source = matches.length === 1 ? matches[0] : null;
      const d = source || raw;
      const length = number(d?.length);
      const depth = number(d?.depth);
      const height = number(d?.height);
      const physicalSource = source
        ? text(source.source || "user-confirmed-physical-dimensions")
        : text(raw?.physicalSource) || (length > 0 && depth > 0 && height > 0 ? "app-data" : "");
      const sourceCabinetKey = source
        ? text(source.sourceCabinetKey) || sourceKey
        : text(raw?.sourceCabinetKey) || sourceKey;
      const storageOnly = isStorageOnly(raw);
      const reservedForOtherCategory = false;
      return {
        ...raw,
        key,
        store: text(raw?.store) || text(store),
        label: text(raw?.label) || key,
        position: text(raw?.position),
        kind: text(raw?.kind) || text(raw?.type),
        type: text(raw?.type) || text(raw?.kind),
        length,
        depth,
        height,
        physicalSource,
        sourceCabinetKey,
        physicalSourceMatches: matches.length,
        physicalSourceError: matches.length > 1 ? "柜段物理尺寸来源不唯一" : "",
        index,
        cabinetType: cabinetType(raw),
        storageOnly,
        reservedForOtherCategory,
        saleEligible: !storageOnly && isSaleCabinet(raw),
        iceOnly: isIceCabinet(raw),
        usedWidth: 0,
        leftWidth: length,
        items: [],
        largeRemainderReason: ""
      };
    });
}

function orientationOptions(product, cabinet) {
  const p = dimensions(product);
  if (!(p.length > 0 && p.width > 0 && p.height > 0 && cabinet?.depth > 0 && cabinet?.height > 0)) return [];
  const vertical = isVertical(cabinet);
  const candidates = vertical
    ? [
      { orientation: "length-face", faceWidth: p.length, orientedDepth: p.height, orientedHeight: p.width },
      { orientation: "width-face", faceWidth: p.width, orientedDepth: p.height, orientedHeight: p.length }
    ]
    : [
      { orientation: "length-face", faceWidth: p.length, orientedDepth: p.width, orientedHeight: p.height },
      { orientation: "width-face", faceWidth: p.width, orientedDepth: p.length, orientedHeight: p.height }
    ];
  const options = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.faceWidth}|${candidate.orientedDepth}|${candidate.orientedHeight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const heightAllowance = vertical ? 50 : 0;
    if (candidate.orientedDepth > cabinet.depth + EPSILON || candidate.orientedHeight > cabinet.height + heightAllowance + EPSILON) continue;
    // 卧柜/冰淇淋柜的纵深使用柜体宽度字段 cabinet.depth；所有物理除法
    // 按实际尺寸向下取整，不能把放不下的商品计入容量。
    const depthCount = Math.floor(cabinet.depth / candidate.orientedDepth);
    const stackCount = vertical ? 1 : Math.floor(cabinet.height / candidate.orientedHeight);
    const perCol = depthCount * stackCount;
    if (!(perCol > 0 && candidate.faceWidth > 0)) continue;
    options.push({
      ...candidate,
      depth: candidate.orientedDepth,
      height: candidate.orientedHeight,
      depthCount,
      stackCount,
      perCol
    });
  }
  return options.sort((a, b) => {
    // Historical planograms use the narrower feasible front for ice items so
    // the freezer presents more visible facings.  Keep physical feasibility
    // and height fixed; this only resolves the two legal horizontal rotations.
    if (product?.ice && a.faceWidth !== b.faceWidth) {
      return a.faceWidth - b.faceWidth
        || b.perCol - a.perCol
        || stableCompare(a.orientation, b.orientation);
    }
    if (!isVertical(cabinet)) {
      return b.perCol - a.perCol
        || a.faceWidth - b.faceWidth
        || stableCompare(a.orientation, b.orientation);
    }
    return b.perCol - a.perCol
      || a.faceWidth - b.faceWidth
      || stableCompare(a.orientation, b.orientation);
  });
}

function legalCabinetFor(product, cabinet) {
  return Boolean(cabinet?.saleEligible)
    && Boolean(product?.ice) === Boolean(cabinet?.iceOnly)
    && orientationOptions(product, cabinet).length > 0;
}

function orientationOptionsForPlan(plan, product, cabinet) {
  const cached = plan?.staticCandidateBlueprints?.get(stableKey(product));
  if (cached) {
    return cached.filter(candidate => candidate.cabinetKey === cabinet?.key).map(candidate => candidate.orientation);
  }
  return orientationOptions(product, cabinet);
}

function bestOrientation(product, cabinet) {
  return orientationOptions(product, cabinet)[0] || null;
}

function rowMetrics(product, placements, params) {
  const full = placements.reduce((sum, placement) => sum + number(placement.fullCount), 0);
  const trigger = Math.ceil(full * number(params?.triggerRate ?? 0.1));
  const receivable = Math.max(0, full - trigger);
  const carton = Math.max(0, integer(product?.carton));
  const externalQty = Math.max(0, carton - Math.min(carton, receivable));
  const staticExternalL = externalQty * number(product?.volume);
  return {
    displayCols: placements.reduce((sum, placement) => sum + integer(placement.displayCols), 0),
    full,
    trigger,
    receivable,
    carton,
    externalQty,
    staticExternalL: round(staticExternalL),
    avgExternalL: round(staticExternalL / 2),
    turnoverDays: number(product?.dailyQty) > 0 ? round(externalQty / number(product.dailyQty)) : 0,
    directCarton: externalQty === 0,
    usedWidth: round(placements.reduce((sum, placement) => sum + number(placement.widthUsed), 0)),
    perCol: placements.length === 1 ? number(placements[0].perCol) : 0,
    faceWidth: placements.length === 1 ? number(placements[0].faceWidth) : 0,
    columns: placements.reduce((sum, placement) => sum + integer(placement.displayCols), 0)
  };
}

function newPlacement(product, cabinet, orientation, displayCols = 1, capacityOverride = null) {
  const columns = Math.max(1, integer(displayCols, 1));
  const hasFaceOverride = text(capacityOverride?.capacitySource) === "current-export-json"
    && isLegalHorizontalFace(product, orientation, capacityOverride);
  const faceWidth = hasFaceOverride ? round(number(capacityOverride.faceWidth)) : round(orientation.faceWidth);
  const perCol = orientation.perCol;
  const capacitySource = hasFaceOverride
    ? "current-export-json"
    : text(orientation.capacitySource) || "physical-candidate";
  return {
    skuKey: product.skuKey,
    cabinetType: cabinet.cabinetType,
    cabinetKind: cabinet.kind,
    cabinetKey: cabinet.key,
    cabinetLabel: cabinet.label,
    section: cabinet.position,
    zone: cabinet.position,
    position: cabinet.position,
    layer: cabinet.position,
    orientation: orientation.orientation,
    faceWidth,
    orientedDepth: round(orientation.orientedDepth),
    orientedHeight: round(orientation.orientedHeight),
    depth: round(orientation.orientedDepth),
    height: round(orientation.orientedHeight),
    depthCount: orientation.depthCount,
    stackCount: orientation.stackCount,
    perCol,
    capacitySource,
    displayCols: columns,
    fullCount: columns * perCol,
    externalQty: 0,
    staticExternalL: 0,
    widthUsed: round(columns * faceWidth)
  };
}

function createRow(product) {
  return {
    ...product,
    id: `strict_${product.skuKey}`,
    included: false,
    excluded: false,
    excludedForStore: false,
    status: "未排入",
    excludeReason: "",
    reasonCode: "",
    reason: "",
    placements: [],
    cabinetKey: "",
    cabinetLabel: "",
    position: "",
    cabinetType: "",
    orientation: "",
    displayCols: 0,
    totalDisplayCols: 0,
    fullCount: 0,
    externalQty: 0,
    staticExternalL: 0,
    suggestedExternalL: 0,
    perCol: 0,
    faceWidth: 0,
    usedWidth: 0,
    widthUsed: 0,
    metrics: null
  };
}

function clonePlan(plan) {
  return {
    ...plan,
    cabinets: plan.cabinets.map(cabinet => ({ ...cabinet, items: [...(cabinet.items || [])] })),
    rows: plan.rows.map(row => ({
      ...row,
      placements: (row.placements || []).map(placement => ({ ...placement }))
    })),
    operations: (plan.operations || []).map(operation => ({ ...operation })),
    softReviewItems: [...(plan.softReviewItems || [])],
    optimizationAudit: { ...(plan.optimizationAudit || {}) },
    selectionAudit: { ...(plan.selectionAudit || {}) },
    sourceAudit: { ...(plan.sourceAudit || {}) },
    pipelineAudit: plan.pipelineAudit ? {
      ...plan.pipelineAudit,
      stageTimesMs: { ...(plan.pipelineAudit.stageTimesMs || {}) },
      stageAcceptedActions: { ...(plan.pipelineAudit.stageAcceptedActions || {}) },
      largeRemainderBucketCounts: { ...(plan.pipelineAudit.largeRemainderBucketCounts || {}) },
      largeRemainderBucketChecks: { ...(plan.pipelineAudit.largeRemainderBucketChecks || {}) },
      stepTimesMs: { ...(plan.pipelineAudit.stepTimesMs || {}) }
    } : plan.pipelineAudit,
    basePlacementAudit: {
      ...(plan.basePlacementAudit || {}),
      changes: [...(plan.basePlacementAudit?.changes || [])]
    },
    excludedKeys: new Set(plan.excludedKeys || []),
    summary: plan.summary ? { ...plan.summary, businessMetrics: { ...(plan.summary.businessMetrics || {}) } } : plan.summary
  };
}

function assignExternalToPlacements(row) {
  const total = integer(row.externalQty);
  let remaining = total;
  for (let index = 0; index < row.placements.length; index += 1) {
    const placement = row.placements[index];
    const share = index === row.placements.length - 1
      ? remaining
      : Math.min(remaining, Math.floor(total * number(placement.fullCount) / Math.max(1, row.fullCount)));
    placement.externalQty = share;
    placement.staticExternalL = round(share * number(row.volume));
    remaining -= share;
  }
}

function categoryConcentration(plan) {
  const groups = new Map();
  for (const row of plan.rows.filter(item => item.included)) {
    const locations = groups.get(row.category4 || "未分类") || new Map();
    for (const placement of row.placements) {
      const key = placement.cabinetKey;
      locations.set(key, (locations.get(key) || 0) + 1);
    }
    groups.set(row.category4 || "未分类", locations);
  }
  let total = 0;
  let concentrated = 0;
  for (const locations of groups.values()) {
    const values = [...locations.values()];
    total += values.reduce((sum, value) => sum + value, 0);
    concentrated += Math.max(0, ...values);
  }
  return total ? concentrated / total : 1;
}

function fragmentCount(plan) {
  return plan.cabinets.filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > EPSILON).length;
}

function movedSkuCount(plan) {
  const previous = plan.previousPlan;
  if (!previous || !Array.isArray(previous.rows)) return 0;
  const oldRows = new Map(previous.rows.map(row => [row.skuKey, row]));
  return plan.rows.reduce((count, row) => {
    const old = oldRows.get(row.skuKey);
    if (!old) return count;
    const oldKey = (old.placements || []).map(item => `${item.cabinetKey}|${item.orientation}|${item.displayCols}`).sort().join(",");
    const newKey = (row.placements || []).map(item => `${item.cabinetKey}|${item.orientation}|${item.displayCols}`).sort().join(",");
    return count + (oldKey === newKey ? 0 : 1);
  }, 0);
}

function recompute(plan) {
  const cabinetMap = new Map(plan.cabinets.map(cabinet => [cabinet.key, cabinet]));
  for (const cabinet of plan.cabinets) {
    cabinet.usedWidth = 0;
    cabinet.leftWidth = number(cabinet.length);
    cabinet.items = [];
    cabinet.overWidth = false;
  }
  for (const row of plan.rows) {
    if (!Array.isArray(row.placements)) row.placements = [];
    row.placements = row.placements.filter(placement => cabinetMap.has(placement.cabinetKey));
    if (!row.placements.length) {
      row.included = false;
      row.displayCols = 0;
      row.totalDisplayCols = 0;
      row.fullCount = 0;
      row.externalQty = 0;
      row.staticExternalL = 0;
      row.suggestedExternalL = 0;
      row.usedWidth = 0;
      row.widthUsed = 0;
      row.metrics = null;
      continue;
    }
    row.included = true;
    row.excluded = false;
    row.excludedForStore = false;
    row.status = "已纳入";
    let full = 0;
    let displayCols = 0;
    let usedWidth = 0;
    for (const placement of row.placements) {
      const cabinet = cabinetMap.get(placement.cabinetKey);
      const orientation = orientationOptionsForPlan(plan, row, cabinet).find(option => option.orientation === placement.orientation)
        || orientationOptionsForPlan(plan, row, cabinet)[0]
        || bestOrientation(row, cabinet);
      if (orientation) {
        const preserveSourceFace = text(placement.capacitySource) === "current-export-json"
          && isLegalHorizontalFace(row, orientation, placement);
        placement.faceWidth = preserveSourceFace ? round(number(placement.faceWidth)) : round(orientation.faceWidth);
        placement.orientedDepth = round(orientation.orientedDepth);
        placement.orientedHeight = round(orientation.orientedHeight);
        placement.depth = round(orientation.orientedDepth);
        placement.height = round(orientation.orientedHeight);
        placement.depthCount = orientation.depthCount;
        placement.stackCount = orientation.stackCount;
        placement.perCol = orientation.perCol;
        placement.capacitySource = preserveSourceFace ? "current-export-json" : "physical-candidate";
        placement.widthUsed = round(integer(placement.displayCols) * placement.faceWidth);
        placement.fullCount = integer(placement.displayCols) * placement.perCol;
      }
      full += number(placement.fullCount);
      displayCols += integer(placement.displayCols);
      usedWidth += number(placement.widthUsed);
      cabinet.usedWidth += number(placement.widthUsed);
      cabinet.items.push(row.skuKey);
      placement.cabinetType = cabinet.cabinetType;
      placement.cabinetLabel = cabinet.label;
      placement.section = cabinet.position;
      placement.zone = cabinet.position;
      placement.position = cabinet.position;
    }
    row.displayCols = displayCols;
    row.totalDisplayCols = displayCols;
    row.fullCount = full;
    row.usedWidth = round(usedWidth);
    row.widthUsed = row.usedWidth;
    row.metrics = rowMetrics(row, row.placements, plan.params);
    row.externalQty = row.metrics.externalQty;
    row.staticExternalL = row.metrics.staticExternalL;
    row.suggestedExternalL = round(row.metrics.avgExternalL * number(plan.params.p95Factor) * number(plan.params.externalSafetyFactor));
    assignExternalToPlacements(row);
    const primary = row.placements[0];
    row.cabinetKey = primary.cabinetKey;
    row.cabinetLabel = primary.cabinetLabel;
    row.position = primary.position;
    row.cabinetType = primary.cabinetType;
    row.orientation = primary.orientation;
    row.perCol = row.placements.length === 1 ? primary.perCol : 0;
    row.faceWidth = row.placements.length === 1 ? primary.faceWidth : 0;
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

function businessValue(row) {
  return [
    number(row?.dailyQty),
    gradeScore(row?.grade),
    -number(row?.rank || 999999),
    businessPriority(row),
    categoryCore(row)
  ];
}

function compareBusinessValue(a, b) {
  const av = businessValue(a);
  const bv = businessValue(b);
  for (let index = 0; index < av.length; index += 1) {
    if (av[index] !== bv[index]) return bv[index] - av[index];
  }
  return stableCompare(stableKey(a), stableKey(b));
}

function productOrder(a, b, candidateMap = new Map()) {
  const grade = gradeScore(b.grade) - gradeScore(a.grade);
  if (grade) return grade;
  const business = compareBusinessValue(a, b);
  if (business) return business;
  const scene = sceneOrder(a) - sceneOrder(b);
  if (scene) return scene;
  const category = stableCompare(a.category4, b.category4);
  if (category) return category;
  const candidateCount = (candidateMap.get(a.skuKey)?.length || 0) - (candidateMap.get(b.skuKey)?.length || 0);
  return candidateCount || stableCompare(a.skuKey, b.skuKey);
}

function formalSkillProductOrder(a, b, candidateMap = new Map()) {
  const measured = Number(hasMeasuredBusinessSignal(b)) - Number(hasMeasuredBusinessSignal(a));
  if (measured) return measured;
  const scene = sceneOrder(a) - sceneOrder(b);
  if (scene) return scene;
  const category = stableCompare(a.category4, b.category4);
  if (category) return category;
  const business = compareBusinessValue(a, b);
  if (business) return business;
  const candidateCount = (candidateMap.get(a.skuKey)?.length || 0) - (candidateMap.get(b.skuKey)?.length || 0);
  return candidateCount || stableCompare(a.skuKey, b.skuKey);
}

function candidateLocations(plan, row, { includeCurrent = false } = {}) {
  const result = [];
  const cabinetByKey = new Map(plan.cabinets.map(cabinet => [cabinet.key, cabinet]));
  const staticCandidates = plan.staticCandidateBlueprints?.get(row.skuKey)
    || makeCandidateMap(plan).get(row.skuKey)
    || [];
  for (const blueprint of staticCandidates) {
    const cabinet = cabinetByKey.get(blueprint.cabinetKey);
    if (!cabinet) continue;
    const orientation = blueprint.orientation;
    const already = row.placements.some(placement => placement.cabinetType === cabinet.cabinetType);
    if (!includeCurrent && already) continue;
    const existingWidth = cabinet.usedWidth;
    if (existingWidth + orientation.faceWidth > cabinet.length + EPSILON) continue;
    const sameCategory = cabinet.items.some(skuKey => {
      const item = plan.rows.find(itemRow => itemRow.skuKey === skuKey);
      return item && item.category4 === row.category4;
    });
    const sameScene = cabinet.items.some(skuKey => {
      const item = plan.rows.find(itemRow => itemRow.skuKey === skuKey);
      return item && item.category3 === row.category3;
    });
    result.push({
      cabinet,
      cabinetKey: cabinet.key,
      orientation,
      additionalWidth: orientation.faceWidth,
      sameCategory,
      sameScene,
      leftAfter: cabinet.length - existingWidth - orientation.faceWidth,
      cabinetType: cabinet.cabinetType
    });
  }
  return result.sort((a, b) => {
    if (!row.ice && gradeScore(row.grade) >= gradeScore("B")) {
      const typeRank = value => value === "chest" ? 0 : value === "vertical" ? 1 : 2;
      const typePreference = typeRank(a.cabinetType) - typeRank(b.cabinetType);
      if (typePreference) return typePreference;
    }
    const sameCategory = Number(b.sameCategory) - Number(a.sameCategory);
    if (sameCategory) return sameCategory;
    const sameScene = Number(b.sameScene) - Number(a.sameScene);
    if (sameScene) return sameScene;
    const type = stableCompare(a.cabinetType, b.cabinetType);
    if (type) return type;
    const capacity = b.orientation.perCol - a.orientation.perCol;
    if (capacity) return capacity;
    const efficiency = b.orientation.perCol / b.orientation.faceWidth - a.orientation.perCol / a.orientation.faceWidth;
    if (efficiency) return efficiency;
    const width = a.additionalWidth - b.additionalWidth;
    if (width) return width;
    return stableCompare(a.cabinetKey, b.cabinetKey);
  });
}

function categoryBlockDistance(plan, row, cabinetKey) {
  const saleCabinets = plan.cabinets.filter(cabinet => cabinet.saleEligible);
  const position = new Map(saleCabinets.map((cabinet, index) => [cabinet.key, index]));
  const targetIndex = position.get(cabinetKey);
  if (targetIndex === undefined) return Infinity;
  const categoryCabinets = saleCabinets.filter(cabinet => (cabinet.items || []).some(skuKey => {
    const item = plan.rows.find(candidateRow => candidateRow.skuKey === skuKey);
    return item && item.skuKey !== row.skuKey && item.category4 && item.category4 === row.category4;
  }));
  if (!categoryCabinets.length) return Infinity;
  return Math.min(...categoryCabinets.map(cabinet => Math.abs(targetIndex - position.get(cabinet.key))));
}

function futureExpansionBenefit(plan, row, candidate) {
  const width = number(candidate.orientation.faceWidth);
  if (candidate.leftAfter + EPSILON < width) return { possible: false, directGain: 0, externalReduction: 0, staticReduction: 0 };
  const one = newPlacement(row, candidate.cabinet, candidate.orientation, 1);
  const two = newPlacement(row, candidate.cabinet, candidate.orientation, 2);
  const oneMetrics = rowMetrics(row, [one], plan.params);
  const twoMetrics = rowMetrics(row, [two], plan.params);
  return {
    possible: true,
    directGain: Number(twoMetrics.directCarton) - Number(oneMetrics.directCarton),
    externalReduction: number(oneMetrics.externalQty) - number(twoMetrics.externalQty),
    staticReduction: number(oneMetrics.staticExternalL) - number(twoMetrics.staticExternalL)
  };
}

function baseCoverageFeasible(plan, row, candidate, additionalWidth = candidate.orientation.faceWidth) {
  const pending = plan.rows.filter(item => item.skuKey !== row.skuKey && !item.placements.length);
  const extraWidth = number(additionalWidth);
  const usedAfter = new Map(plan.cabinets.map(cabinet => [cabinet.key, number(cabinet.usedWidth)]));
  usedAfter.set(candidate.cabinetKey, number(usedAfter.get(candidate.cabinetKey)) + extraWidth);
  const cabinetMap = new Map(plan.cabinets.map(cabinet => [cabinet.key, cabinet]));
  return pending.every(item => (plan.staticCandidateBlueprints.get(item.skuKey) || []).some(blueprint => {
    const cabinet = cabinetMap.get(blueprint.cabinetKey);
    return cabinet && number(usedAfter.get(cabinet.key)) + number(blueprint.orientation.faceWidth) <= number(cabinet.length) + EPSILON;
  }));
}

function baseCandidateLocations(plan, row) {
  const candidates = candidateLocations(plan, row, { includeCurrent: true });
  const categoryExists = plan.rows.some(item => item.skuKey !== row.skuKey && item.category4 === row.category4 && item.placements.length);
  const decorated = candidates.map((candidate, index) => {
    const categoryDistance = categoryBlockDistance(plan, row, candidate.cabinetKey);
    const future = futureExpansionBenefit(plan, row, candidate);
    const coverageSafe = baseCoverageFeasible(plan, row, candidate);
    return {
      candidate,
      originalIndex: index,
      categoryDistance,
      categoryExists,
      anchorEligible: categoryExists && !candidate.cabinet.items.length,
      future,
      coverageSafe,
      continuityRank: candidate.sameScene ? 0 : 1,
      categoryRank: candidate.sameCategory ? 0 : 1
    };
  });
  // The first SKU of a category establishes that category's anchor. Keep the
  // existing legal candidate order for that first anchor; the new continuity
  // and empty-segment tie-breakers apply only after a category block exists.
  if (!categoryExists) {
    const coverageSafeCandidates = decorated.filter(item => item.coverageSafe);
    return (coverageSafeCandidates.length ? coverageSafeCandidates : decorated)
      .sort((left, right) => left.originalIndex - right.originalIndex)
      .map(item => ({ ...item.candidate, baseMeta: item }));
  }
  const compare = (left, right) => left.continuityRank - right.continuityRank
    || left.categoryRank - right.categoryRank
    || (categoryExists ? left.categoryDistance - right.categoryDistance : 0)
    || Number(right.anchorEligible) - Number(left.anchorEligible)
    || Number(right.future.directGain) - Number(left.future.directGain)
    || Number(right.future.externalReduction) - Number(left.future.externalReduction)
    || Number(right.future.staticReduction) - Number(left.future.staticReduction)
    || Number(right.candidate.orientation.perCol) - Number(left.candidate.orientation.perCol)
    || (Number(right.candidate.orientation.perCol) / Math.max(Number(right.candidate.orientation.faceWidth), EPSILON))
      - (Number(left.candidate.orientation.perCol) / Math.max(Number(left.candidate.orientation.faceWidth), EPSILON))
    || Number(left.candidate.additionalWidth) - Number(right.candidate.additionalWidth)
    || stableCompare(left.candidate.cabinetKey, right.candidate.cabinetKey)
    || stableCompare(left.candidate.orientation.orientation, right.candidate.orientation.orientation);
  const coverageSafeCandidates = decorated.filter(item => item.coverageSafe);
  return (coverageSafeCandidates.length ? coverageSafeCandidates : decorated)
    .sort(compare)
    .map(item => ({ ...item.candidate, baseMeta: item }));
}

function addPlacement(plan, row, candidate, columns = 1) {
  const product = row;
  const placement = newPlacement(product, candidate.cabinet, candidate.orientation, columns);
  row.placements.push(placement);
  recompute(plan);
  return placement;
}

function removePlacement(row, placementIndex) {
  row.placements.splice(placementIndex, 1);
  if (!row.placements.length) {
    row.included = false;
    row.excludedForStore = true;
  }
}

function activePlacementTypeSet(row) {
  return new Set((row.placements || []).map(placement => placement.cabinetType));
}

function canHaveAdditionalPlacement(row, candidate) {
  const types = activePlacementTypeSet(row);
  if (types.has(candidate.cabinetType)) return false;
  return gradeScore(row.grade) >= gradeScore("A") || gradeScore(row.grade) >= gradeScore("B");
}

function categoryScore(plan, candidate, row) {
  let score = 0;
  if (candidate.sameCategory) score += 100000;
  if (candidate.sameScene) score += 10000;
  score += gradeScore(row.grade) * 100;
  score += number(row.dailyQty);
  return score;
}

function candidateBenefit(plan, row, candidate, columns = 1) {
  const before = row.metrics?.externalQty ?? row.carton;
  const trial = clonePlan(plan);
  const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
  const trialCandidate = trial.cabinets.find(cabinet => cabinet.key === candidate.cabinetKey);
  if (!trialRow || !trialCandidate) return null;
  const trialOrientation = candidate.orientation;
  trialRow.placements.push(newPlacement(trialRow, trialCandidate, trialOrientation, columns));
  recompute(trial);
  const afterRow = trial.rows.find(item => item.skuKey === row.skuKey);
  return {
    trial,
    externalReduction: before - number(afterRow?.metrics?.externalQty),
    suggestedReduction: number(plan.summary?.suggestedExternalL) - number(trial.summary?.suggestedExternalL),
    directGain: Number(afterRow?.metrics?.directCarton) - Number(row.metrics?.directCarton),
    width: candidate.additionalWidth,
    score: categoryScore(plan, candidate, row)
  };
}

function estimateAdditionalBenefit(plan, row, candidate, columns = 1) {
  const placement = newPlacement(row, candidate.cabinet, candidate.orientation, columns);
  const before = row.metrics || rowMetrics(row, row.placements, plan.params);
  const after = rowMetrics(row, [...row.placements, placement], plan.params);
  return {
    externalReduction: number(before.externalQty) - number(after.externalQty),
    staticReduction: number(before.staticExternalL) - number(after.staticExternalL),
    suggestedReduction: number(before.avgExternalL) * number(plan.params.p95Factor) * number(plan.params.externalSafetyFactor)
      - number(after.avgExternalL) * number(plan.params.p95Factor) * number(plan.params.externalSafetyFactor)
  };
}

function createEmptyPlan({ store = "", type = "", productPool = [], cabinets = [], params = {}, physicalRecords = [], storeRecord = null, previousPlan = null } = {}) {
 const active = activeProductPool(productPool);
  const hasStoreRecord = Boolean(storeRecord);
  const storeP95 = number(hasStoreRecord ? (storeRecord?.p95Factor ?? storeRecord?.p95) : params.p95Factor);
 const p95Factor = storeP95 > 0 ? storeP95 : 0;
  const p95Source = hasStoreRecord ? text(storeRecord?.p95Source || (p95Factor > 0 ? `store-record:${text(store)}` : "")) : text(params.p95Source || (p95Factor > 0 ? `store-config:${text(store)}` : ""));
  const normalizedParams = {
    triggerRate: number(params.triggerRate ?? 0.1),
    p95Factor,
    p95Source,
    externalSafetyFactor: number(params.externalSafetyFactor ?? 1.2),
    externalCapL: number(params.externalCapL ?? DEFAULT_EXTERNAL_CAP_L)
  };
  const normalizedCabinets = normalizeCabinets(cabinets, { store, physicalRecords });
  const storePhysicalRecords = (Array.isArray(physicalRecords) ? physicalRecords : [])
    .filter(record => !store || text(record?.store) === text(store));
  const rows = active.map(createRow);
  const plan = {
    version: "strict-allocation-v3-multi-placement",
    store: text(store),
    type: text(type),
    params: normalizedParams,
    cabinets: normalizedCabinets,
    rows,
    placements: [],
    included: [],
    excludedForStore: [],
    unplacedSkus: [],
    operations: [],
    softReviewItems: [],
    sourceAudit: {
      configuredCabinetCount: normalizedCabinets.length,
      physicalRecordCount: storePhysicalRecords.length,
      matchedSourceCount: normalizedCabinets.filter(cabinet => cabinet.physicalSourceMatches === 1).length,
      missingPhysicalCount: normalizedCabinets.filter(cabinet => !(cabinet.length > 0 && cabinet.depth > 0 && cabinet.height > 0)).length,
      invalidSourceCount: normalizedCabinets.filter(cabinet => !cabinet.physicalSource || INVALID_SOURCES.has(text(cabinet.physicalSource).toLowerCase())).length
    },
    optimizationAudit: { expansionCount: 0, moveCount: 0, swapCount: 0, fillCount: 0, secondaryPlacementCount: 0 },
    selectionAudit: {},
    evidence: {},
    staticCandidateBlueprints: new Map(),
    excludedKeys: new Set(),
    basePlacementAudit: { changes: [], anchorPriorityChanges: 0 }
  };
  plan.previousPlan = previousPlan || null;
  plan.sourceAudit.p95Source = p95Source;
  plan.sourceAudit.p95Factor = p95Factor;
  const candidateMap = makeCandidateMap(plan);
  plan.staticCandidateBlueprints = new Map([...candidateMap.entries()].map(([skuKey, candidates]) => [
    skuKey,
    candidates.map(candidate => ({
      cabinetKey: candidate.cabinetKey,
      cabinetType: candidate.cabinetType,
      orientation: { ...candidate.orientation }
    }))
  ]));
  return plan;
}

function seedPreviousPlan(plan) {
  const previousRows = new Map((plan.previousPlan?.rows || []).map(row => [row.skuKey, row]));
  const cabinetMap = new Map(plan.cabinets.map(cabinet => [cabinet.key, cabinet]));
  // Previous-plan placements are validated as a set. The cabinet objects are
  // still empty while this pass is building the seed, so keep an explicit
  // per-segment width ledger instead of validating each placement against 0.
  const seededWidthByCabinet = new Map(plan.cabinets.map(cabinet => [cabinet.key, 0]));
  const audit = {
    attemptedSkuCount: 0,
    preservedSkuCount: 0,
    preservedPlacementCount: 0,
    rejectedPlacementCount: 0,
    rejectedReasons: {}
  };
  plan.basePlacementAudit ||= { changes: [], anchorPriorityChanges: 0 };
  plan.basePlacementAudit.previousPlan = audit;

  for (const row of plan.rows) {
    if (!hasMeasuredBusinessSignal(row)) continue;
    const previous = previousRows.get(row.skuKey);
    if (!previous?.included || !Array.isArray(previous.placements) || !previous.placements.length) continue;
    audit.attemptedSkuCount += 1;
    const placements = [];
    for (const previousPlacement of previous.placements) {
      const cabinet = cabinetMap.get(previousPlacement.cabinetKey);
      if (!cabinet) {
        audit.rejectedPlacementCount += 1;
        audit.rejectedReasons.missingCabinet = number(audit.rejectedReasons.missingCabinet) + 1;
        continue;
      }
      if (!cabinet.saleEligible) {
        audit.rejectedPlacementCount += 1;
        audit.rejectedReasons.storageOnly = number(audit.rejectedReasons.storageOnly) + 1;
        continue;
      }
      if (Boolean(row.ice) !== Boolean(cabinet.iceOnly)) {
        audit.rejectedPlacementCount += 1;
        audit.rejectedReasons.cabinetTypeMismatch = number(audit.rejectedReasons.cabinetTypeMismatch) + 1;
        continue;
      }
      if (placements.some(placement => placement.cabinetType === cabinet.cabinetType)) {
        audit.rejectedPlacementCount += 1;
        audit.rejectedReasons.sameCabinetTypeSplit = number(audit.rejectedReasons.sameCabinetTypeSplit) + 1;
        continue;
      }
      if (placements.length && gradeScore(row.grade) < gradeScore("B")) {
        audit.rejectedPlacementCount += 1;
        audit.rejectedReasons.gradeDoesNotAllowSecondType = number(audit.rejectedReasons.gradeDoesNotAllowSecondType) + 1;
        continue;
      }
      const options = orientationOptionsForPlan(plan, row, cabinet);
      const preferred = options.find(option => previousPlacement.orientation && option.orientation === previousPlacement.orientation)
        || options.find(option => number(previousPlacement.faceWidth) > 0 && option.faceWidth === number(previousPlacement.faceWidth))
        || options[0];
      const columns = Math.max(1, integer(previousPlacement.displayCols, 1));
      const addedWidth = columns * number(preferred?.faceWidth);
      const seededWidth = number(seededWidthByCabinet.get(cabinet.key));
      if (!preferred || seededWidth + addedWidth > number(cabinet.length) + EPSILON) {
        audit.rejectedPlacementCount += 1;
        audit.rejectedReasons.physicalFit = number(audit.rejectedReasons.physicalFit) + 1;
        continue;
      }
      placements.push(newPlacement(row, cabinet, preferred, columns, previousPlacement));
      seededWidthByCabinet.set(cabinet.key, round(seededWidth + addedWidth));
    }
    if (placements.length) {
      row.placements = placements;
      row.reasonCode = "";
      row.reason = "";
      row.excludeReason = "";
      audit.preservedSkuCount += 1;
      audit.preservedPlacementCount += placements.length;
    }
  }
  recompute(plan);
  return plan;
}

function baseExpansionOpportunity(plan) {
  let directPotential = 0;
  let externalReduction = 0;
  let staticReduction = 0;
  let maxDirectPotential = 0;
  let maxExternalReduction = 0;
  let maxStaticReduction = 0;
  let expandablePlacements = 0;
  for (const row of plan.rows.filter(item => item.included)) {
    const before = row.metrics || rowMetrics(row, row.placements, plan.params);
    for (let index = 0; index < row.placements.length; index += 1) {
      const placement = row.placements[index];
      const cabinet = plan.cabinets.find(item => item.key === placement.cabinetKey);
      if (!cabinet || cabinet.leftWidth + EPSILON < placement.faceWidth) continue;
      const placements = row.placements.map((item, itemIndex) => itemIndex === index
        ? {
          ...item,
          displayCols: integer(item.displayCols) + 1,
          fullCount: (integer(item.displayCols) + 1) * number(item.perCol),
          widthUsed: round((integer(item.displayCols) + 1) * number(item.faceWidth))
        }
        : item);
      const after = rowMetrics(row, placements, plan.params);
      directPotential += Number(after.directCarton) - Number(before.directCarton);
      externalReduction += number(before.externalQty) - number(after.externalQty);
      staticReduction += number(before.staticExternalL) - number(after.staticExternalL);
      const maxColumns = Math.max(1, Math.floor((cabinet.leftWidth + EPSILON) / Math.max(number(placement.faceWidth), EPSILON)));
      const maxPlacements = row.placements.map((item, itemIndex) => itemIndex === index
        ? {
          ...item,
          displayCols: integer(item.displayCols) + maxColumns,
          fullCount: (integer(item.displayCols) + maxColumns) * number(item.perCol),
          widthUsed: round((integer(item.displayCols) + maxColumns) * number(item.faceWidth))
        }
        : item);
      const maxAfter = rowMetrics(row, maxPlacements, plan.params);
      maxDirectPotential += Math.max(0, Number(maxAfter.directCarton) - Number(before.directCarton));
      maxExternalReduction += Math.max(0, number(before.externalQty) - number(maxAfter.externalQty));
      maxStaticReduction += Math.max(0, number(before.staticExternalL) - number(maxAfter.staticExternalL));
      expandablePlacements += 1;
    }
  }
  return { directPotential, externalReduction, staticReduction, maxDirectPotential, maxExternalReduction, maxStaticReduction, expandablePlacements };
}

function baseRemainderOpportunity(plan) {
  const sale = plan.cabinets.filter(item => item.saleEligible);
  return {
    emptySegments: sale.filter(item => item.items.length === 0 && item.leftWidth > EPSILON).length,
    largeRemainderWidth: sale.reduce((sum, item) => sum + (item.leftWidth > 300 + EPSILON ? item.leftWidth : 0), 0)
  };
}

function compareStructural(left, right) {
  const leftValid = left.validation?.structuralOk !== false && number(left.summary?.overWidthCount) === 0;
  const rightValid = right.validation?.structuralOk !== false && number(right.summary?.overWidthCount) === 0;
  return Number(leftValid) - Number(rightValid);
}

function planStableKey(plan) {
  return plan.rows.slice().sort((a, b) => stableCompare(a.skuKey, b.skuKey)).map(row => {
    const placements = (row.placements || []).slice().sort((a, b) => stableCompare(`${a.cabinetKey}|${a.orientation}`, `${b.cabinetKey}|${b.orientation}`));
    return `${row.skuKey}:${row.included ? placements.map(p => `${p.cabinetKey}:${p.orientation}:${p.displayCols}`).join(",") : `excluded:${row.reasonCode}`}`;
  }).join(";");
}

function businessMetrics(plan) {
  const included = plan.rows.filter(row => row.included);
  return {
    salesQty: round(included.reduce((sum, row) => sum + number(row.dailyQty), 0), 6),
    gradeScore: included.reduce((sum, row) => sum + gradeScore(row.grade), 0),
    businessPriority: round(included.reduce((sum, row) => sum + businessPriority(row), 0), 6),
    categoryCoreScore: round(included.reduce((sum, row) => sum + categoryCore(row), 0), 6),
    protectedSkuCount: included.filter(row => gradeScore(row.grade) >= 3).length
  };
}

function summarize(plan) {
  const included = plan.rows.filter(row => row.included);
  const excluded = plan.rows.filter(row => !row.included);
  const externalRows = included.filter(row => number(row.externalQty) > 0);
  const staticExternalL = externalRows.reduce((sum, row) => sum + number(row.staticExternalL), 0);
  const avgExternalL = staticExternalL / 2;
  const p95ExternalL = avgExternalL * number(plan.params.p95Factor);
  const suggestedExternalL = Math.ceil(p95ExternalL * number(plan.params.externalSafetyFactor));
  const placementCount = included.reduce((sum, row) => sum + row.placements.length, 0);
  return {
    activeSkuCount: plan.rows.length,
    candidateSkuCount: plan.rows.length,
    includedSkuCount: included.length,
    excludedForStoreCount: excluded.length,
    placedSkuCount: included.length,
    unplacedSkuCount: excluded.length,
    directCartonSkuCount: included.filter(row => number(row.externalQty) === 0).length,
    externalSkuCount: externalRows.length,
    externalUnits: externalRows.reduce((sum, row) => sum + number(row.externalQty), 0),
    staticExternalL: round(staticExternalL),
    avgExternalL: round(avgExternalL),
    dynamicAvgExternalL: round(avgExternalL),
    p95ExternalL: round(p95ExternalL),
    dynamicP95ExternalL: round(p95ExternalL),
    suggestedExternalL,
    p95Factor: number(plan.params.p95Factor),
    p95Source: text(plan.params.p95Source),
    externalRiskLevel: suggestedExternalL > number(plan.params.externalCapL) ? "FAILED" : suggestedExternalL > 700 ? "HIGH" : suggestedExternalL > 650 ? "WATCH" : "SAFE",
    businessMetrics: businessMetrics(plan),
    category4Concentration: round(categoryConcentration(plan), 6),
    fragmentCount: fragmentCount(plan),
    movedSkuCount: movedSkuCount(plan),
    placementCount,
    totalDisplayCols: included.reduce((sum, row) => sum + number(row.displayCols), 0),
    remainingWidth: round(plan.cabinets.reduce((sum, cabinet) => sum + (cabinet.saleEligible ? Math.max(0, cabinet.leftWidth) : 0), 0)),
    overWidthCount: plan.cabinets.filter(cabinet => cabinet.overWidth).length,
    layer6SalesCount: included.reduce((sum, row) => sum + row.placements.filter(placement => plan.cabinets.find(cabinet => cabinet.key === placement.cabinetKey)?.storageOnly).length, 0),
    iceWrongCount: included.reduce((sum, row) => sum + row.placements.filter(placement => row.ice !== Boolean(plan.cabinets.find(cabinet => cabinet.key === placement.cabinetKey)?.iceOnly)).length, 0),
    widthLedgerMismatchCount: 0,
    placementSyncErrorCount: 0
  };
}

export function comparePlans(left, right) {
  const structural = compareStructural(left, right);
  if (structural) return structural;
  const leftCap = number(left.summary?.suggestedExternalL) <= number(left.params?.externalCapL ?? DEFAULT_EXTERNAL_CAP_L);
  const rightCap = number(right.summary?.suggestedExternalL) <= number(right.params?.externalCapL ?? DEFAULT_EXTERNAL_CAP_L);
  if (leftCap !== rightCap) return Number(leftCap) - Number(rightCap);
  const lm = left.summary?.businessMetrics || businessMetrics(left);
  const rm = right.summary?.businessMetrics || businessMetrics(right);
  for (const [field, direction] of [["protectedSkuCount", 1], ["salesQty", 1], ["gradeScore", 1], ["businessPriority", 1], ["categoryCoreScore", 1]]) {
    if (lm[field] !== rm[field]) return direction * (lm[field] > rm[field] ? 1 : -1);
  }
  for (const [field, direction] of [["directCartonSkuCount", 1], ["externalSkuCount", -1], ["suggestedExternalL", -1], ["staticExternalL", -1], ["externalUnits", -1], ["category4Concentration", 1], ["includedSkuCount", 1], ["fragmentCount", -1], ["movedSkuCount", -1]]) {
    const lv = number(left.summary?.[field]);
    const rv = number(right.summary?.[field]);
    if (lv !== rv) return direction * (lv > rv ? 1 : -1);
  }
  return stableCompare(planStableKey(left), planStableKey(right)) < 0 ? 1 : stableCompare(planStableKey(left), planStableKey(right)) > 0 ? -1 : 0;
}

function placeBaseSku(plan, row, candidate) {
  row.placements.push(newPlacement(row, candidate.cabinet, candidate.orientation, 1));
  recompute(plan);
}

function makeCandidateMap(plan) {
  const map = new Map();
  for (const row of plan.rows) {
    const candidates = [];
    for (const cabinet of plan.cabinets) {
      if (!legalCabinetFor(row, cabinet)) continue;
      for (const orientation of orientationOptions(row, cabinet)) {
        candidates.push({
          cabinet,
          cabinetKey: cabinet.key,
          orientation,
          additionalWidth: orientation.faceWidth,
          cabinetType: cabinet.cabinetType
        });
      }
    }
    map.set(row.skuKey, candidates.sort((a, b) => stableCompare(a.cabinetKey, b.cabinetKey) || stableCompare(a.orientation.orientation, b.orientation.orientation)));
  }
  return map;
}

function candidateForBase(plan, row) {
  const candidates = candidateLocations(plan, row, { includeCurrent: true });
  const scored = candidates.map(candidate => {
    const benefit = estimateAdditionalBenefit(plan, row, candidate, 1);
    return { candidate, benefit };
  });
  return scored.sort((left, right) => {
    const lb = left.benefit;
    const rb = right.benefit;
    return number(rb?.directGain) - number(lb?.directGain)
      || number(rb?.externalReduction) - number(lb?.externalReduction)
      || number(rb?.staticReduction) - number(lb?.staticReduction)
      || number(rb?.suggestedReduction) - number(lb?.suggestedReduction)
      || (Number(right.candidate.sameCategory) - Number(left.candidate.sameCategory))
      || (Number(right.candidate.sameScene) - Number(left.candidate.sameScene))
      || (number(right.candidate.orientation.perCol) / Math.max(number(right.candidate.orientation.faceWidth), EPSILON))
        - (number(left.candidate.orientation.perCol) / Math.max(number(left.candidate.orientation.faceWidth), EPSILON))
      || number(left.candidate.additionalWidth) - number(right.candidate.additionalWidth)
      || stableCompare(`${left.candidate.cabinetKey}|${left.candidate.orientation.orientation}`, `${right.candidate.cabinetKey}|${right.candidate.orientation.orientation}`);
  })[0]?.candidate || null;
}

function baseStateCompare(left, right) {
  const li = left.rows.filter(row => row.included).length;
  const ri = right.rows.filter(row => row.included).length;
  if (li !== ri) return li > ri ? 1 : -1;
  const lm = businessMetrics(left);
  const rm = businessMetrics(right);
  for (const field of ["protectedSkuCount", "salesQty", "gradeScore", "businessPriority", "categoryCoreScore"]) {
    if (lm[field] !== rm[field]) return lm[field] > rm[field] ? 1 : -1;
  }
  const leftSummary = left.summary || summarize(left);
  const rightSummary = right.summary || summarize(right);
  for (const [field, direction] of [["directCartonSkuCount", 1], ["externalSkuCount", -1], ["staticExternalL", -1], ["suggestedExternalL", -1]]) {
    const lv = number(leftSummary[field]);
    const rv = number(rightSummary[field]);
    if (lv !== rv) return direction * (lv > rv ? 1 : -1);
  }
  const leftRemainder = baseRemainderOpportunity(left);
  const rightRemainder = baseRemainderOpportunity(right);
  for (const [field, direction] of [["emptySegments", -1], ["largeRemainderWidth", -1]]) {
    if (leftRemainder[field] !== rightRemainder[field]) {
      return direction * (leftRemainder[field] > rightRemainder[field] ? 1 : -1);
    }
  }
  const leftOpportunity = baseExpansionOpportunity(left);
  const rightOpportunity = baseExpansionOpportunity(right);
  for (const [field, direction] of [["maxDirectPotential", 1], ["maxExternalReduction", 1], ["maxStaticReduction", 1], ["directPotential", 1], ["externalReduction", 1], ["staticReduction", 1], ["expandablePlacements", 1]]) {
    if (leftOpportunity[field] !== rightOpportunity[field]) {
      return direction * (leftOpportunity[field] > rightOpportunity[field] ? 1 : -1);
    }
  }
  const lc = categoryConcentration(left);
  const rc = categoryConcentration(right);
  if (lc !== rc) return lc > rc ? 1 : -1;
  const lf = fragmentCount(left);
  const rf = fragmentCount(right);
  if (lf !== rf) return lf < rf ? 1 : -1;
  const lk = planStableKey(left);
  const rk = planStableKey(right);
  return stableCompare(lk, rk) < 0 ? 1 : stableCompare(lk, rk) > 0 ? -1 : 0;
}

function keepBaseStates(states, limit = 128) {
  const unique = new Map();
  for (const state of states) {
    const key = planStableKey(state);
    if (!unique.has(key) || baseStateCompare(state, unique.get(key)) > 0) unique.set(key, state);
  }
  return [...unique.values()].sort((a, b) => baseStateCompare(a, b) * -1).slice(0, Math.max(1, integer(limit, 128)));
}

function groupRowsForBase(plan) {
  const groups = new Map();
  for (const row of plan.rows.filter(item => !item.placements?.length)) {
    const key = `${categoryScene(row)}|${row.category4 || "未分类"}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].sort((a, b) => {
    const aMeasured = Number(a[1].some(hasMeasuredBusinessSignal));
    const bMeasured = Number(b[1].some(hasMeasuredBusinessSignal));
    if (aMeasured !== bMeasured) return bMeasured - aMeasured;
    const ar = a[1].reduce((best, row) => Math.min(best, plan.staticCandidateBlueprints.get(row.skuKey)?.length || 999999), 999999);
    const br = b[1].reduce((best, row) => Math.min(best, plan.staticCandidateBlueprints.get(row.skuKey)?.length || 999999), 999999);
    return sceneOrder(a[1][0]) - sceneOrder(b[1][0])
      || ar - br
      || stableCompare(a[0], b[0]);
  }).map(([, rows]) => rows.sort((a, b) => formalSkillProductOrder(a, b, plan.staticCandidateBlueprints)));
}

function minimumReasonableColumns(plan, row, candidate) {
  const faceWidth = number(candidate.orientation.faceWidth);
  const maxColumns = Math.floor((number(candidate.cabinet.leftWidth) + EPSILON) / Math.max(faceWidth, EPSILON));
  if (maxColumns < 1) return 0;
  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const placement = newPlacement(row, candidate.cabinet, candidate.orientation, columns);
    const metrics = rowMetrics(row, [placement], plan.params);
    if (metrics.directCarton) return columns;
  }
  return 1;
}

function nonGreedyBaseLayout(plan) {
  let states = [plan];
  const groups = groupRowsForBase(plan);
  // The formal caps are 64 layouts per category and 128 globally.  For a
  // large live pool we use a deterministic pressure cap derived only from
  // input size; this is a search safety limit, never a wall-clock decision.
  const requestedGroupBeamWidth = 64;
  const requestedGlobalBeamWidth = 128;
  const largePool = plan.rows.length > 24;
  const groupBeamWidth = largePool ? 4 : requestedGroupBeamWidth;
  const globalBeamWidth = largePool ? 8 : requestedGlobalBeamWidth;
  plan.searchAudit = {
    requestedPerCategoryStates: requestedGroupBeamWidth,
    requestedGlobalStates: requestedGlobalBeamWidth,
    effectivePerCategoryStates: groupBeamWidth,
    effectiveGlobalStates: globalBeamWidth,
    searchTruncated: largePool
  };
  for (const group of groups) {
    let groupStates = states;
    for (const row of group) {
      const next = [];
      for (const state of groupStates) {
        const stateRow = state.rows.find(item => item.skuKey === row.skuKey);
        if (!stateRow) continue;
        const candidates = baseCandidateLocations(state, stateRow).slice(0, 3);
        for (const candidate of candidates) {
          const displayCols = minimumReasonableColumns(state, stateRow, candidate);
          if (!(displayCols > 0)) continue;
          const coverageWidth = displayCols * number(candidate.orientation.faceWidth);
          const coverageSafe = baseCoverageFeasible(state, stateRow, candidate, coverageWidth);
          const oneColumnSafe = baseCoverageFeasible(state, stateRow, candidate, candidate.orientation.faceWidth);
          const selectedColumns = displayCols;
          const trial = clonePlan(state);
          const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
          const trialCandidate = trial.cabinets.find(item => item.key === candidate.cabinetKey);
          if (!trialRow || !trialCandidate) continue;
          const orientation = candidate.orientation;
          if (trialCandidate.usedWidth + selectedColumns * number(orientation.faceWidth) > trialCandidate.length + EPSILON) continue;
          trialRow.placements.push(newPlacement(trialRow, trialCandidate, orientation, selectedColumns));
          recompute(trial);
          trial.basePlacementAudit.changes.push({
            skuKey: row.skuKey,
            newSegment: candidate.cabinetKey,
            categoryDistance: candidate.baseMeta?.categoryDistance,
            futureExpansionBenefit: candidate.baseMeta?.future || null,
            anchorPriority: Boolean(candidate.baseMeta?.anchorEligible)
          });
          if (candidate.baseMeta?.anchorEligible) trial.basePlacementAudit.anchorPriorityChanges += 1;
          next.push(trial);
        }
        // A state that cannot place this SKU remains a valid candidate.  The
        // formal selection phase records the explicit store-level exclusion;
        // it must never silently disappear from the state search.
        if (!candidates.length) {
          const trial = clonePlan(state);
          const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
          if (trialRow) {
            markExcludedRow(trialRow, exclusionReasonForProduct(trial, trialRow));
            recompute(trial);
            next.push(trial);
          }
        }
      }
      groupStates = keepBaseStates(next.length ? next : groupStates, groupBeamWidth);
    }
    states = keepBaseStates(groupStates, globalBeamWidth);
  }
  const selected = keepBaseStates(states, globalBeamWidth)[0] || plan;
  if (selected.searchAudit) selected.searchAudit.exploredStateCount = states.length;
  return selected;
}

function initialPlan(plan) {
  seedPreviousPlan(plan);
  const candidateMap = plan.staticCandidateBlueprints || makeCandidateMap(plan);
  const selected = plan.pipelineMode === "formal"
    ? nonGreedyBaseLayout(plan)
    : (() => {
      for (const row of plan.rows.slice().sort((a, b) => productOrder(a, b, candidateMap))) {
        const candidate = candidateForBase(plan, row);
        if (candidate) placeBaseSku(plan, row, candidate);
        else markExcludedRow(row, exclusionReasonForProduct(plan, row));
      }
      return plan;
    })();
  if (selected !== plan) {
    plan.rows = selected.rows;
    plan.cabinets = selected.cabinets;
    plan.operations = selected.operations;
    plan.basePlacementAudit = selected.basePlacementAudit;
    plan.optimizationAudit = selected.optimizationAudit;
    plan.searchAudit = selected.searchAudit;
  }
  recompute(plan);
  // A/B products may use at most one placement per cabinet type. Add a
  // second type only when it has a deterministic external-storage benefit.
  const secondaryCandidates = [];
  for (const row of plan.rows.filter(item => item.included && gradeScore(item.grade) >= 3)) {
    const candidates = candidateLocations(plan, row).slice(0, 8);
    for (const candidate of candidates) {
      if (!canHaveAdditionalPlacement(row, candidate)) continue;
      const benefit = estimateAdditionalBenefit(plan, row, candidate, 1);
      if (!benefit || benefit.externalReduction <= 0) continue;
      secondaryCandidates.push({ row, candidate, benefit });
    }
  }
  secondaryCandidates.sort((a, b) => b.benefit.externalReduction - a.benefit.externalReduction
    || b.benefit.suggestedReduction - a.benefit.suggestedReduction
    || compareBusinessValue(a.row, b.row)
    || stableCompare(a.row.skuKey, b.row.skuKey)
    || stableCompare(a.candidate.cabinetKey, b.candidate.cabinetKey));
  for (const item of secondaryCandidates) {
    const row = plan.rows.find(current => current.skuKey === item.row.skuKey);
    const candidate = candidateLocations(plan, row).find(current => current.cabinetKey === item.candidate.cabinetKey && current.cabinetType === item.candidate.cabinetType);
    if (!candidate || !canHaveAdditionalPlacement(row, candidate)) continue;
    const benefit = estimateAdditionalBenefit(plan, row, candidate, 1);
    if (!benefit || benefit.externalReduction <= 0) continue;
    row.placements.push(newPlacement(row, candidate.cabinet, candidate.orientation, 1));
    plan.optimizationAudit.secondaryPlacementCount += 1;
    plan.operations.push({ type: "secondary-placement", skuKey: row.skuKey, targetCabinetKey: candidate.cabinetKey, displayCols: 1 });
    recompute(plan);
  }
  return plan;
}

function simulateExpansion(plan, row, placementIndex = 0, additionalColumns = 1) {
  const source = plan.rows.find(item => item.skuKey === row.skuKey) || row;
  const index = Math.max(0, integer(placementIndex));
  const placement = source.placements?.[index];
  if (!placement) return null;
  const cabinet = plan.cabinets.find(item => item.key === placement.cabinetKey);
  const columns = Math.max(1, integer(additionalColumns, 1));
  if (!cabinet || cabinet.leftWidth + EPSILON < placement.faceWidth * columns) return null;
  const trial = clonePlan(plan);
  const trialRow = trial.rows.find(item => item.skuKey === source.skuKey);
  trialRow.placements[index].displayCols += columns;
  recompute(trial);
  return trial;
}

function firstBeneficialExpansion(plan, row, placementIndex, maxAdditionalColumns) {
  const limit = Math.max(0, integer(maxAdditionalColumns));
  for (let columns = 1; columns <= limit; columns += 1) {
    const trial = simulateExpansion(plan, row, placementIndex, columns);
    if (!trial) break;
    const before = plan.rows.find(item => item.skuKey === row.skuKey) || row;
    const after = trial.rows.find(item => item.skuKey === row.skuKey);
    const directGain = Number(after?.metrics?.directCarton) - Number(before.metrics?.directCarton);
    const externalReduction = number(before.externalQty) - number(after?.externalQty);
    const staticReduction = number(before.staticExternalL) - number(after?.staticExternalL);
    if (directGain > 0 || externalReduction > 0 || staticReduction > 0) {
      return { trial, columns, directGain, externalReduction, staticReduction };
    }
  }
  return null;
}

function simulateMove(plan, row, candidate, placementIndex = 0) {
  const source = plan.rows.find(item => item.skuKey === row.skuKey) || row;
  const index = Math.max(0, integer(placementIndex));
  const placement = source.placements?.[index];
  const target = plan.cabinets.find(item => item.key === candidate?.cabinetKey);
  const targetTypeAlreadyUsed = source.placements.some((item, itemIndex) => itemIndex !== index && item.cabinetType === target?.cabinetType);
  // A/B may keep both cabinet types, while C/D may keep only one placement
  // type.  That rule limits simultaneous placements; it does not forbid a
  // single C/D placement from moving to a more efficient legal cabinet type.
  const crossTypeAllowed = !targetTypeAlreadyUsed;
  if (!placement || !target || (target.cabinetType !== placement.cabinetType && !crossTypeAllowed) || target.usedWidth + candidate.orientation.faceWidth > target.length + EPSILON) return null;
  const trial = clonePlan(plan);
  const trialRow = trial.rows.find(item => item.skuKey === source.skuKey);
  trialRow.placements[index] = newPlacement(trialRow, trial.cabinets.find(item => item.key === target.key), candidate.orientation, placement.displayCols);
  recompute(trial);
  return trial;
}

function simulateSwap(plan, leftRow, rightRow, leftIndex = 0, rightIndex = 0) {
  const left = plan.rows.find(item => item.skuKey === leftRow.skuKey) || leftRow;
  const right = plan.rows.find(item => item.skuKey === rightRow.skuKey) || rightRow;
  const leftPlacement = left.placements?.[leftIndex];
  const rightPlacement = right.placements?.[rightIndex];
  if (!leftPlacement || !rightPlacement || leftPlacement.cabinetType !== rightPlacement.cabinetType) return null;
  const leftCabinet = plan.cabinets.find(cabinet => cabinet.key === leftPlacement.cabinetKey);
  const rightCabinet = plan.cabinets.find(cabinet => cabinet.key === rightPlacement.cabinetKey);
  if (!leftCabinet || !rightCabinet) return null;
  const leftOrientation = orientationOptionsForPlan(plan, left, rightCabinet).find(option => option.orientation === leftPlacement.orientation)
    || orientationOptionsForPlan(plan, left, rightCabinet)[0]
    || bestOrientation(left, rightCabinet);
  const rightOrientation = orientationOptionsForPlan(plan, right, leftCabinet).find(option => option.orientation === rightPlacement.orientation)
    || orientationOptionsForPlan(plan, right, leftCabinet)[0]
    || bestOrientation(right, leftCabinet);
  if (!leftOrientation || !rightOrientation) return null;
  if (leftCabinet.usedWidth - leftPlacement.widthUsed + rightOrientation.faceWidth * leftPlacement.displayCols > leftCabinet.length + EPSILON) return null;
  if (rightCabinet.usedWidth - rightPlacement.widthUsed + leftOrientation.faceWidth * rightPlacement.displayCols > rightCabinet.length + EPSILON) return null;
  const trial = clonePlan(plan);
  const trialLeft = trial.rows.find(item => item.skuKey === left.skuKey);
  const trialRight = trial.rows.find(item => item.skuKey === right.skuKey);
  trialLeft.placements[leftIndex] = newPlacement(trialLeft, trial.cabinets.find(cabinet => cabinet.key === rightCabinet.key), leftOrientation, leftPlacement.displayCols);
  trialRight.placements[rightIndex] = newPlacement(trialRight, trial.cabinets.find(cabinet => cabinet.key === leftCabinet.key), rightOrientation, rightPlacement.displayCols);
  recompute(trial);
  return trial;
}

function expansionScore(plan, row, placementIndex, trial) {
  const sourcePlacement = row.placements[placementIndex];
  const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
  const sourceExternal = number(row.externalQty);
  const trialExternal = number(trialRow?.externalQty);
  return {
    directGain: Number(trialRow?.metrics?.directCarton) - Number(row.metrics?.directCarton),
    externalReduction: sourceExternal - trialExternal,
    staticReduction: number(row.staticExternalL) - number(trialRow?.staticExternalL),
    width: sourcePlacement?.faceWidth || 0,
    grade: gradeScore(row.grade),
    dailyQty: number(row.dailyQty),
    rank: number(row.rank) || 999999,
    stableKey: `${row.skuKey}|${sourcePlacement?.cabinetKey || ""}|${placementIndex}`
  };
}

function compareAction(a, b) {
  const actionRank = value => ({ expand: 0, fill: 1, "secondary-placement": 2, "move-expand": 3, move: 4, swap: 5 }[value] ?? 9);
  const actionType = actionRank(a.type) - actionRank(b.type);
  if (actionType) return actionType;
  for (const [field, direction] of [["directGain", 1], ["externalReduction", 1], ["staticReduction", 1], ["grade", 1], ["dailyQty", 1], ["rank", -1], ["width", -1]]) {
    if (a.score[field] !== b.score[field]) return direction * (a.score[field] > b.score[field] ? 1 : -1);
  }
  return stableCompare(a.score.stableKey, b.score.stableKey) < 0 ? 1 : -1;
}

function buildExpansionActions(plan) {
  const actions = [];
  for (const row of plan.rows.filter(item => item.included && !plan.excludedKeys?.has(item.skuKey))) {
    for (let placementIndex = 0; placementIndex < row.placements.length; placementIndex += 1) {
      const placement = row.placements[placementIndex];
      const cabinet = plan.cabinets.find(item => item.key === placement.cabinetKey);
      const maxAdditionalColumns = cabinet
        ? Math.floor((cabinet.leftWidth + EPSILON) / Math.max(placement.faceWidth, EPSILON))
        : 0;
      const improvement = firstBeneficialExpansion(plan, row, placementIndex, maxAdditionalColumns);
      if (!improvement) continue;
      const score = expansionScore(plan, row, placementIndex, improvement.trial);
      actions.push({ type: "expand", row, placementIndex, trial: improvement.trial, score, targetCabinetKey: placement.cabinetKey });
    }
  }
  // Explicitly scan >300mm segments and offer the same unified action set.
  for (const cabinet of plan.cabinets.filter(item => item.saleEligible && item.leftWidth > 300 + EPSILON)) {
    cabinet.largeRemainderReason = "待按正式Skill执行同四级品类、同三级A/B、外储改善或暂不纳入SKU补位";
  }
  return actions.sort(compareAction);
}

function buildFillActions(plan) {
  return buildExpansionActions(plan)
    .filter(action => {
      const cabinet = plan.cabinets.find(item => item.key === action.targetCabinetKey);
      return cabinet && cabinet.leftWidth > 300 + EPSILON;
    })
    .map(action => ({ ...action, type: "fill" }))
    .sort(compareAction);
}

function storeSpaceFillCompare(a, b) {
  const category = Number(b.score.sameCategory) - Number(a.score.sameCategory);
  if (category) return category;
  const scene = Number(b.score.sameScene) - Number(a.score.sameScene);
  if (scene) return scene;
  const business = compareBusinessValue(a.row, b.row);
  if (business) return business;
  for (const [field, direction] of [["directGain", 1], ["externalReduction", 1], ["staticReduction", 1], ["width", -1]]) {
    if (a.score[field] !== b.score[field]) return direction * (a.score[field] > b.score[field] ? 1 : -1);
  }
  return stableCompare(a.score.stableKey, b.score.stableKey);
}

function buildStoreSpaceFillActions(plan) {
  const actions = [];
  const rows = plan.rows.filter(row => !row.included && !plan.excludedKeys?.has(row.skuKey))
    .sort(compareBusinessValue);
  const cabinets = plan.cabinets.filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > EPSILON)
    .sort((a, b) => stableCompare(a.key, b.key));
  for (const cabinet of cabinets) {
    const segmentRows = remainderRows(plan, cabinet);
    const category4 = new Set(segmentRows.map(row => row.category4).filter(Boolean));
    const category3 = new Set(segmentRows.map(row => row.category3).filter(Boolean));
    for (const row of rows) {
      const candidate = candidateLocations(plan, row, { includeCurrent: true })
        .find(item => item.cabinetKey === cabinet.key);
      if (!candidate) continue;
      const sameCategory = !segmentRows.length || category4.has(row.category4);
      const sameScene = !segmentRows.length || category3.has(row.category3);
      if (segmentRows.length && !sameCategory && !(sameScene && gradeScore(row.grade) >= gradeScore("B"))) continue;
      const trial = clonePlan(plan);
      const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
      const trialCabinet = trial.cabinets.find(item => item.key === cabinet.key);
      if (!trialRow || !trialCabinet) continue;
      trialRow.placements = [];
      trialRow.reasonCode = "";
      trialRow.reason = "";
      trialRow.excludeReason = "";
      trialRow.placements.push(newPlacement(trialRow, trialCabinet, candidate.orientation, 1));
      recompute(trial);
      const after = trial.rows.find(item => item.skuKey === row.skuKey);
      if (!after?.included) continue;
      if (number(trial.summary.suggestedExternalL) > number(plan.params.externalCapL) + EPSILON) continue;
      actions.push({
        type: "fill",
        fillMode: "store-space-fill",
        row,
        targetCabinetKey: cabinet.key,
        candidate,
        trial,
        score: {
          sameCategory,
          sameScene,
          directGain: Number(after.metrics?.directCarton) - Number(row.metrics?.directCarton || 0),
          externalReduction: number(row.externalQty) - number(after.externalQty),
          staticReduction: number(row.staticExternalL) - number(after.staticExternalL),
          grade: gradeScore(row.grade),
          dailyQty: number(row.dailyQty),
          rank: number(row.rank) || 999999,
          width: candidate.additionalWidth,
          stableKey: `${row.skuKey}|store-space-fill|${cabinet.key}`
        }
      });
    }
  }
  return actions.sort(storeSpaceFillCompare);
}

function remainderActionCompare(a, b) {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  const business = compareBusinessValue(a.row, b.row);
  if (business) return business;
  return stableCompare(`${a.row.skuKey}|${a.targetCabinetKey}|${a.placementIndex ?? "new"}`, `${b.row.skuKey}|${b.targetCabinetKey}|${b.placementIndex ?? "new"}`);
}

function remainderRows(plan, cabinet) {
  const rows = new Map(plan.rows.map(row => [row.skuKey, row]));
  return (cabinet.items || []).map(skuKey => rows.get(skuKey)).filter(Boolean);
}

function remainderActionFromPlacement(plan, cabinet, row, bucket, placementIndex, trial = null) {
  const placement = row.placements?.[placementIndex];
  if (!placement || placement.cabinetKey !== cabinet.key || cabinet.leftWidth + EPSILON < placement.faceWidth) return null;
  const next = trial || simulateExpansion(plan, row, placementIndex, 1);
  if (!next) return null;
  const nextCabinet = next.cabinets.find(item => item.key === cabinet.key);
  if (!nextCabinet || !(cabinet.leftWidth - nextCabinet.leftWidth > EPSILON)) return null;
  const before = row.metrics || rowMetrics(row, row.placements, plan.params);
  const nextRow = next.rows.find(item => item.skuKey === row.skuKey);
  const after = nextRow?.metrics || {};
  return {
    type: "fill",
    bucket,
    row,
    placementIndex,
    targetCabinetKey: cabinet.key,
    trial: next,
    score: {
      directGain: Number(after.directCarton) - Number(before.directCarton),
      externalReduction: number(before.externalQty) - number(after.externalQty),
      staticReduction: number(row.staticExternalL) - number(nextRow?.staticExternalL),
      grade: gradeScore(row.grade),
      dailyQty: number(row.dailyQty),
      rank: number(row.rank) || 999999,
      width: placement.faceWidth,
      stableKey: `${row.skuKey}|fill|${cabinet.key}|${placementIndex}`
    }
  };
}

function remainderPlacementTarget(plan, cabinet, row) {
  const existingIndex = (row.placements || []).findIndex(placement => placement.cabinetKey === cabinet.key);
  if (existingIndex >= 0) return { mode: "expand", placementIndex: existingIndex };
  if ((row.placements || []).some(placement => placement.cabinetType === cabinet.cabinetType)) return null;
  if (row.placements?.length && gradeScore(row.grade) < gradeScore("B")) return null;
  const candidate = candidateLocations(plan, row, { includeCurrent: true })
    .find(item => item.cabinetKey === cabinet.key);
  if (!candidate || cabinet.leftWidth + EPSILON < candidate.orientation.faceWidth) return null;
  return { mode: "new", candidate };
}

function remainderActionForRow(plan, cabinet, row, bucket) {
  const target = remainderPlacementTarget(plan, cabinet, row);
  if (!target) return null;
  if (target.mode === "expand") return remainderActionFromPlacement(plan, cabinet, row, bucket, target.placementIndex);
  const trial = clonePlan(plan);
  const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
  const trialCabinet = trial.cabinets.find(item => item.key === cabinet.key);
  if (!trialRow || !trialCabinet) return null;
  trialRow.placements.push(newPlacement(trialRow, trialCabinet, target.candidate.orientation, 1));
  recompute(trial);
  const nextCabinet = trial.cabinets.find(item => item.key === cabinet.key);
  if (!nextCabinet || !(cabinet.leftWidth - nextCabinet.leftWidth > EPSILON)) return null;
  const before = row.metrics || rowMetrics(row, row.placements, plan.params);
  const nextRow = trial.rows.find(item => item.skuKey === row.skuKey);
  const after = nextRow?.metrics || {};
  return {
    type: "fill",
    bucket,
    row,
    placementIndex: null,
    targetCabinetKey: cabinet.key,
    candidate: target.candidate,
    trial,
    score: {
      directGain: Number(after.directCarton) - Number(before.directCarton),
      externalReduction: number(before.externalQty) - number(after.externalQty),
      staticReduction: number(row.staticExternalL) - number(nextRow?.staticExternalL),
      grade: gradeScore(row.grade),
      dailyQty: number(row.dailyQty),
      rank: number(row.rank) || 999999,
      width: target.candidate.additionalWidth,
      stableKey: `${row.skuKey}|fill|${cabinet.key}|new`
    }
  };
}

function buildLargeRemainderBucket1(plan, cabinet, segmentRows, recordStats = true) {
  const actions = [];
  const segmentCategory4 = new Set(segmentRows.map(row => row.category4).filter(Boolean));
  for (const row of plan.rows.filter(item => item.included && !plan.excludedKeys?.has(item.skuKey))) {
    if (recordStats) plan.pipelineAudit.largeRemainderBucketChecks.bucket1 += 1;
    if (!row.category4 || !segmentCategory4.has(row.category4)) continue;
    const action = remainderActionForRow(plan, cabinet, row, 1);
    if (action) actions.push(action);
  }
  return actions.sort(remainderActionCompare);
}

function buildLargeRemainderBucket2(plan, cabinet, segmentRows, recordStats = true) {
  const actions = [];
  const segmentCategory3 = new Set(segmentRows.map(row => row.category3).filter(Boolean));
  for (const row of plan.rows.filter(item => item.included && gradeScore(item.grade) >= gradeScore("B") && !plan.excludedKeys?.has(item.skuKey))) {
    if (recordStats) plan.pipelineAudit.largeRemainderBucketChecks.bucket2 += 1;
    if (!row.category3 || !segmentCategory3.has(row.category3)) continue;
    const action = remainderActionForRow(plan, cabinet, row, 2);
    if (action) actions.push(action);
  }
  return actions.sort(remainderActionCompare);
}

function buildLargeRemainderBucket3(plan, cabinet, recordStats = true) {
  const actions = [];
  for (const row of plan.rows.filter(item => item.included && gradeScore(item.grade) >= gradeScore("B") && !plan.excludedKeys?.has(item.skuKey))) {
    if (recordStats) plan.pipelineAudit.largeRemainderBucketChecks.bucket3 += 1;
    const action = remainderActionForRow(plan, cabinet, row, 3);
    if (action) {
      const before = row.metrics || {};
      const after = action.trial.rows.find(item => item.skuKey === row.skuKey)?.metrics || {};
      if (number(before.externalQty) - number(after.externalQty) <= EPSILON
        && number(row.staticExternalL) - number(action.trial.rows.find(item => item.skuKey === row.skuKey)?.staticExternalL) <= EPSILON
        && Number(after.directCarton) <= Number(before.directCarton)) continue;
      actions.push(action);
    }
  }
  return actions.sort((a, b) => b.score.externalReduction - a.score.externalReduction
    || b.score.staticReduction - a.score.staticReduction
    || b.score.directGain - a.score.directGain
    || remainderActionCompare(a, b));
}

function buildLargeRemainderBucket4(plan, cabinet, segmentRows, recordStats = true) {
  const occupiedCategory4 = new Set(segmentRows.map(row => row.category4).filter(Boolean));
  const occupiedCategory3 = new Set(segmentRows.map(row => row.category3).filter(Boolean));
  const candidates = [];
  for (const row of plan.rows
    .filter(item => !item.included && !plan.excludedKeys?.has(item.skuKey))
    .sort(compareBusinessValue)) {
    if (recordStats) plan.pipelineAudit.largeRemainderBucketChecks.bucket4 += 1;
    const candidate = candidateLocations(plan, row, { includeCurrent: true })
      .find(item => item.cabinetKey === cabinet.key);
    if (!candidate) continue;
    const sameCategory = !segmentRows.length || occupiedCategory4.has(row.category4);
    const sameScene = !segmentRows.length || occupiedCategory3.has(row.category3) || gradeScore(row.grade) >= gradeScore("B");
    if (!sameCategory && !sameScene) continue;
    const action = remainderActionForRow(plan, cabinet, row, 4);
    if (action) candidates.push(action);
  }
  return candidates.sort(remainderActionCompare);
}

/*
 * The four buckets are intentionally evaluated as a fallback chain for each
 * segment.  A missing bucket-1 action is not a reason to stop the segment.
 */
function largeRemainderBucketDiagnostics(plan, cabinet, recordStats = true) {
  const segmentRows = remainderRows(plan, cabinet);
  return {
    bucket1: buildLargeRemainderBucket1(plan, cabinet, segmentRows, recordStats),
    bucket2: buildLargeRemainderBucket2(plan, cabinet, segmentRows, recordStats),
    bucket3: buildLargeRemainderBucket3(plan, cabinet, recordStats),
    bucket4: buildLargeRemainderBucket4(plan, cabinet, segmentRows, recordStats)
  };
}

function largeRemainderCandidates(plan, onlyCabinet = null, recordStats = true) {
  const cabinets = (onlyCabinet ? [onlyCabinet] : plan.cabinets)
    .filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > 300 + EPSILON)
    .sort((a, b) => stableCompare(a.key, b.key));
  const actions = [];
  for (const cabinet of cabinets) {
    const segmentRows = remainderRows(plan, cabinet);
    const bucket1 = buildLargeRemainderBucket1(plan, cabinet, segmentRows, recordStats);
    if (bucket1.length) {
      actions.push(bucket1[0]);
      continue;
    }
    const bucket2 = buildLargeRemainderBucket2(plan, cabinet, segmentRows, recordStats);
    if (bucket2.length) {
      actions.push(bucket2[0]);
      continue;
    }
    const bucket3 = buildLargeRemainderBucket3(plan, cabinet, recordStats);
    if (bucket3.length) {
      actions.push(bucket3[0]);
      continue;
    }
    const bucket4 = buildLargeRemainderBucket4(plan, cabinet, segmentRows, recordStats);
    if (bucket4.length) actions.push(bucket4[0]);
  }
  return actions.sort((a, b) => stableCompare(a.targetCabinetKey, b.targetCabinetKey) || a.bucket - b.bucket || remainderActionCompare(a, b));
}

function applyLargeRemainderFillStage(plan) {
  let current = plan;
  let accepted = 0;
  while (true) {
    const action = largeRemainderCandidates(current)[0];
    if (!action) break;
    const before = current.cabinets.find(item => item.key === action.targetCabinetKey);
    const after = action.trial.cabinets.find(item => item.key === action.targetCabinetKey);
    if (!before || !after || !(before.leftWidth - after.leftWidth > EPSILON)) break;
    current = acceptOptimizationAction(current, action);
    current.pipelineAudit.largeRemainderBucketCounts[`bucket${action.bucket}`] += 1;
    accepted += 1;
  }
  return { plan: current, accepted };
}

function runLargeRemainderFillStage(plan, stepKey = "fill") {
  const startedAt = Date.now();
  const result = applyLargeRemainderFillStage(plan);
  const elapsed = Date.now() - startedAt;
  result.plan.pipelineAudit.stageAcceptedActions.fill = number(result.plan.pipelineAudit.stageAcceptedActions.fill) + result.accepted;
  result.plan.pipelineAudit.stageTimesMs.fill = number(result.plan.pipelineAudit.stageTimesMs.fill) + elapsed;
  result.plan.pipelineAudit.stepTimesMs[stepKey] = number(result.plan.pipelineAudit.stepTimesMs[stepKey]) + elapsed;
  return result.plan;
}

function runStoreSpaceFillStage(plan) {
  const startedAt = Date.now();
  const result = applyOptimizationStage(plan, buildStoreSpaceFillActions);
  const elapsed = Date.now() - startedAt;
  result.plan.pipelineAudit.stageAcceptedActions.storeFill = number(result.plan.pipelineAudit.stageAcceptedActions.storeFill) + result.accepted;
  result.plan.pipelineAudit.stageTimesMs.storeFill = number(result.plan.pipelineAudit.stageTimesMs.storeFill) + elapsed;
  result.plan.pipelineAudit.stepTimesMs.storeFill = number(result.plan.pipelineAudit.stepTimesMs.storeFill) + elapsed;
  result.plan.pipelineAudit.storeSpaceFillCount = number(result.plan.pipelineAudit.storeSpaceFillCount) + result.accepted;
  return result.plan;
}

function finalizeLargeRemainderFill(plan) {
  const remaining = largeRemainderCandidates(plan);
  plan.pipelineAudit.largeRemainderLegalActionCount = remaining.length;
  plan.pipelineAudit.largeRemainderFillIncomplete = remaining.length > 0;
  if (remaining.length) {
    plan.optimizationStopReason = "LARGE_REMAINDER_FILL_INCOMPLETE";
    plan.pipelineAudit.stopReason = "LARGE_REMAINDER_FILL_INCOMPLETE";
    plan.pipelineAudit.converged = false;
    plan.converged = false;
    return false;
  }
  for (const cabinet of plan.cabinets.filter(item => item.saleEligible && item.leftWidth > 300 + EPSILON)) {
    cabinet.largeRemainderReason = "完整四档补位扫描后无合法Skill候选";
  }
  return true;
}

function explainLargeRemainders(plan) {
  return plan.cabinets
    .filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > 300 + EPSILON)
    .sort((a, b) => stableCompare(a.key, b.key))
    .map(cabinet => {
      const diagnostics = largeRemainderBucketDiagnostics(plan, cabinet, false);
      const currentRows = remainderRows(plan, cabinet);
      const candidateCounts = Object.fromEntries(Object.entries(diagnostics).map(([key, actions]) => [key, actions.length]));
      const hasLegalAction = Object.values(candidateCounts).some(count => count > 0);
      return {
        segmentKey: cabinet.key,
        remainingWidth: cabinet.leftWidth,
        currentPlacementSku: currentRows.map(row => row.skuKey),
        currentScene: cabinet.sceneGroup || "",
        currentCategory3: [...new Set(currentRows.map(row => row.category3).filter(Boolean))],
        currentCategory4: [...new Set(currentRows.map(row => row.category4).filter(Boolean))],
        candidateCounts,
        hasLegalAction,
        noCandidateReason: hasLegalAction ? "" : "四个BUCKET均无合法候选"
      };
    });
}

function buildMoveActions(plan) {
  const actions = [];
  const actionKeys = new Set();
  const moveRows = plan.rows.filter(item => item.included)
    .sort((a, b) => number(b.staticExternalL) - number(a.staticExternalL) || stableCompare(a.skuKey, b.skuKey))
    .slice(0, 64);
  for (const row of moveRows) {
    // candidateLocations is plan-state dependent only through dynamic width
    // and affinity fields.  The static physical part is already held in the
    // plan cache, so evaluate this unchanged target list once per SKU rather
    // than once per placement.
    const allCandidates = candidateLocations(plan, row, { includeCurrent: true });
    const candidateByKey = new Map();
    const addCandidates = (items) => {
      for (const candidate of items) {
        const key = `${candidate.cabinetKey}|${candidate.cabinetType}|${candidate.orientation.orientation}`;
        if (!candidateByKey.has(key)) candidateByKey.set(key, candidate);
      }
    };
    addCandidates(allCandidates.slice(0, 8));
    addCandidates([...allCandidates]
      .sort((a, b) => number(b.leftAfter) - number(a.leftAfter)
        || stableCompare(a.cabinetKey, b.cabinetKey)
        || stableCompare(a.orientation.orientation, b.orientation.orientation))
      .slice(0, 8));
    addCandidates([...allCandidates]
      .sort((a, b) => (number(b.orientation.perCol) / Math.max(number(b.orientation.faceWidth), EPSILON))
        - (number(a.orientation.perCol) / Math.max(number(a.orientation.faceWidth), EPSILON))
        || stableCompare(a.cabinetKey, b.cabinetKey)
        || stableCompare(a.orientation.orientation, b.orientation.orientation))
      .slice(0, 8));
    const candidatePool = [...candidateByKey.values()].sort((a, b) =>
      stableCompare(`${a.cabinetKey}|${a.orientation.orientation}`, `${b.cabinetKey}|${b.orientation.orientation}`));

    for (let placementIndex = 0; placementIndex < row.placements.length; placementIndex += 1) {
      const placement = row.placements[placementIndex];
      for (const candidate of candidatePool) {
        const actionKey = `MOVE|${row.skuKey}|${placement.cabinetKey}|${placementIndex}|${candidate.cabinetKey}|${candidate.cabinetType}|${candidate.orientation.orientation}`;
        if (actionKeys.has(actionKey)) continue;
        if (candidate.cabinetKey === placement.cabinetKey) continue;
        const target = candidate.cabinet;
        if (!target) continue;
        const targetTypeAlreadyUsed = row.placements.some((item, itemIndex) => itemIndex !== placementIndex && item.cabinetType === target.cabinetType);
        const crossTypeAllowed = !targetTypeAlreadyUsed;
        if (target.cabinetType !== placement.cabinetType && !crossTypeAllowed) continue;
        if (target.usedWidth + candidate.orientation.faceWidth > target.length + EPSILON) continue;
        actionKeys.add(actionKey);

        let trial = simulateMove(plan, row, candidate, placementIndex);
        if (!trial) continue;
        let actionType = "move";
        const movedCabinet = trial.cabinets.find(item => item.key === candidate.cabinetKey);
        const movedRow = trial.rows.find(item => item.skuKey === row.skuKey);
        const movedPlacement = movedRow?.placements?.[placementIndex];
        if (movedCabinet && movedPlacement && movedCabinet.leftWidth + EPSILON >= movedPlacement.faceWidth) {
          const maxAdditionalColumns = Math.floor((movedCabinet.leftWidth + EPSILON) / movedPlacement.faceWidth);
          const combined = firstBeneficialExpansion(trial, movedRow, placementIndex, maxAdditionalColumns);
          if (combined && comparePlans(combined.trial, trial) > 0) {
            trial = combined.trial;
            actionType = "move-expand";
          }
        }
        const before = row.metrics || {};
        const after = trial.rows.find(item => item.skuKey === row.skuKey)?.metrics || {};
        if (number(after.externalQty) > number(before.externalQty)) continue;
        actions.push({ type: actionType, row, placementIndex, candidate, trial, score: {
          directGain: Number(after.directCarton) - Number(before.directCarton),
          externalReduction: number(before.externalQty) - number(after.externalQty),
          staticReduction: number(row.staticExternalL) - number(trial.rows.find(item => item.skuKey === row.skuKey)?.staticExternalL),
          grade: gradeScore(row.grade), dailyQty: number(row.dailyQty), rank: number(row.rank) || 999999,
          width: candidate.additionalWidth, stableKey: `${row.skuKey}|move|${candidate.cabinetKey}`
        }});
      }
    }
  }
  return actions.sort(compareAction);
}

function buildSecondaryPlacementActions(plan) {
  const actions = [];
  const rows = plan.rows.filter(row => row.included
    && !plan.excludedKeys?.has(row.skuKey)
    && gradeScore(row.grade) >= gradeScore("B")
    && number(row.externalQty) > 0)
    .sort((a, b) => number(b.staticExternalL) - number(a.staticExternalL)
      || compareBusinessValue(a, b)
      || stableCompare(a.skuKey, b.skuKey));
  for (const row of rows) {
    for (const candidate of candidateLocations(plan, row)) {
      if (!canHaveAdditionalPlacement(row, candidate)) continue;
      const trial = clonePlan(plan);
      const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
      const trialCabinet = trial.cabinets.find(item => item.key === candidate.cabinetKey);
      if (!trialRow || !trialCabinet) continue;
      trialRow.placements.push(newPlacement(trialRow, trialCabinet, candidate.orientation, 1));
      recompute(trial);
      const before = plan.rows.find(item => item.skuKey === row.skuKey) || row;
      const after = trial.rows.find(item => item.skuKey === row.skuKey);
      const externalReduction = number(before.externalQty) - number(after?.externalQty);
      const staticReduction = number(before.staticExternalL) - number(after?.staticExternalL);
      if (externalReduction <= EPSILON && staticReduction <= EPSILON) continue;
      if (comparePlans(trial, plan) <= 0) continue;
      actions.push({
        type: "secondary-placement",
        row,
        candidate,
        trial,
        score: {
          directGain: Number(after?.metrics?.directCarton) - Number(before.metrics?.directCarton),
          externalReduction,
          staticReduction,
          grade: gradeScore(row.grade),
          dailyQty: number(row.dailyQty),
          rank: number(row.rank) || 999999,
          width: candidate.additionalWidth,
          stableKey: `SECONDARY|${row.skuKey}|${candidate.cabinetKey}|${candidate.orientation.orientation}`
        }
      });
    }
  }
  return actions.sort(compareAction);
}

function buildDirectedMoveActions(plan) {
  const actions = [];
  const actionKeys = new Set();
  const rows = plan.rows.filter(row => row.included && !plan.excludedKeys?.has(row.skuKey) && number(row.externalQty) > 0)
    .sort((a, b) => number(b.staticExternalL) - number(a.staticExternalL)
      || compareBusinessValue(a, b)
      || stableCompare(a.skuKey, b.skuKey));
  for (const row of rows) {
    const candidates = candidateLocations(plan, row, { includeCurrent: true });
    for (let placementIndex = 0; placementIndex < row.placements.length; placementIndex += 1) {
      const placement = row.placements[placementIndex];
      for (const candidate of candidates) {
        const actionKey = `DIRECT-MOVE|${row.skuKey}|${placementIndex}|${candidate.cabinetKey}|${candidate.orientation.orientation}`;
        if (actionKeys.has(actionKey) || candidate.cabinetKey === placement.cabinetKey) continue;
        const target = candidate.cabinet;
        if (!target || target.usedWidth + candidate.orientation.faceWidth > target.length + EPSILON) continue;
        const targetTypeAlreadyUsed = row.placements.some((item, itemIndex) => itemIndex !== placementIndex && item.cabinetType === target.cabinetType);
        if (target.cabinetType !== placement.cabinetType && targetTypeAlreadyUsed) continue;
        actionKeys.add(actionKey);
        let trial = simulateMove(plan, row, candidate, placementIndex);
        if (!trial) continue;
        let actionType = "move";
        const movedCabinet = trial.cabinets.find(item => item.key === candidate.cabinetKey);
        const movedRow = trial.rows.find(item => item.skuKey === row.skuKey);
        const movedPlacement = movedRow?.placements?.[placementIndex];
        if (movedCabinet && movedPlacement && movedCabinet.leftWidth + EPSILON >= movedPlacement.faceWidth) {
          const maxAdditionalColumns = Math.floor((movedCabinet.leftWidth + EPSILON) / movedPlacement.faceWidth);
          const combined = firstBeneficialExpansion(trial, movedRow, placementIndex, maxAdditionalColumns);
          if (combined && comparePlans(combined.trial, trial) > 0) {
            trial = combined.trial;
            actionType = "move-expand";
          }
        }
        const before = row.metrics || {};
        const trialRow = trial.rows.find(item => item.skuKey === row.skuKey);
        const after = trialRow?.metrics || {};
        const externalReduction = number(before.externalQty) - number(after.externalQty);
        const staticReduction = number(row.staticExternalL) - number(trialRow?.staticExternalL);
        // This stage is targeted external relief. Do not let the global
        // comparator accept a move that leaves the external state unchanged
        // merely because it improves a softer layout metric; that creates
        // repeated full candidate scans without advancing the stage goal.
        if (externalReduction <= EPSILON && staticReduction <= EPSILON) continue;
        if (comparePlans(trial, plan) <= 0) continue;
        actions.push({ type: actionType, row, placementIndex, candidate, trial, score: {
          directGain: Number(after.directCarton) - Number(before.directCarton),
          externalReduction,
          staticReduction,
          grade: gradeScore(row.grade), dailyQty: number(row.dailyQty), rank: number(row.rank) || 999999,
          width: candidate.additionalWidth, stableKey: actionKey
        }});
      }
    }
  }
  return [...actions, ...buildSecondaryPlacementActions(plan)].sort(compareAction);
}

function buildDirectedSwapActions(plan) {
  const actions = [];
  const actionKeys = new Set();
  const rows = plan.rows.filter(row => row.included && !plan.excludedKeys?.has(row.skuKey) && number(row.externalQty) > 0)
    .sort((a, b) => number(b.staticExternalL) - number(a.staticExternalL)
      || compareBusinessValue(a, b)
      || stableCompare(a.skuKey, b.skuKey))
    .slice(0, 12);
  for (const left of rows) {
    for (let leftIndex = 0; leftIndex < left.placements.length; leftIndex += 1) {
      const leftPlacement = left.placements[leftIndex];
      const targetCabinetKeys = candidateLocations(plan, left, { includeCurrent: true })
        .filter(candidate => candidate.cabinetKey !== leftPlacement.cabinetKey)
        .map(candidate => candidate.cabinetKey);
      for (const targetCabinetKey of [...new Set(targetCabinetKeys)].sort(stableCompare).slice(0, 4)) {
        const targetCabinet = plan.cabinets.find(cabinet => cabinet.key === targetCabinetKey);
        if (!targetCabinet) continue;
        for (const right of plan.rows.filter(row => targetCabinet.items.includes(row.skuKey) && row.included)) {
          for (let rightIndex = 0; rightIndex < right.placements.length; rightIndex += 1) {
            if (right.placements[rightIndex].cabinetKey !== targetCabinetKey) continue;
            const actionKey = `DIRECT-SWAP|${left.skuKey}|${leftIndex}|${right.skuKey}|${rightIndex}|${targetCabinetKey}`;
            if (actionKeys.has(actionKey)) continue;
            actionKeys.add(actionKey);
            const trial = simulateSwap(plan, left, right, leftIndex, rightIndex);
            if (!trial || comparePlans(trial, plan) <= 0) continue;
            actions.push({ type: "swap", left, right, leftIndex, rightIndex, trial, score: {
              directGain: number(trial.summary.directCartonSkuCount) - number(plan.summary.directCartonSkuCount),
              externalReduction: number(plan.summary.externalUnits) - number(trial.summary.externalUnits),
              staticReduction: number(plan.summary.staticExternalL) - number(trial.summary.staticExternalL),
              grade: gradeScore(left.grade) + gradeScore(right.grade),
              dailyQty: number(left.dailyQty) + number(right.dailyQty),
              rank: number(left.rank) + number(right.rank),
              width: 0,
              stableKey: actionKey
            }});
          }
        }
      }
    }
  }
  return actions.sort(compareAction);
}

function buildSwapActions(plan, maxCandidates = 1000) {
  const actions = [];
  const rows = plan.rows.filter(row => row.included).sort((a, b) => number(b.staticExternalL) - number(a.staticExternalL) || stableCompare(a.skuKey, b.skuKey)).slice(0, 40);
  let generated = 0;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i];
      const right = rows[j];
      for (let leftIndex = 0; leftIndex < left.placements.length; leftIndex += 1) {
        for (let rightIndex = 0; rightIndex < right.placements.length; rightIndex += 1) {
          const trial = simulateSwap(plan, left, right, leftIndex, rightIndex);
          if (!trial) continue;
          if (number(trial.summary.suggestedExternalL) > number(plan.summary.suggestedExternalL)) continue;
          const change = number(plan.summary.suggestedExternalL) - number(trial.summary.suggestedExternalL);
          if (change <= 0 && categoryConcentration(trial) <= categoryConcentration(plan)) continue;
          actions.push({ type: "swap", left, right, leftIndex, rightIndex, trial, score: {
            directGain: number(trial.summary.directCartonSkuCount) - number(plan.summary.directCartonSkuCount),
            externalReduction: number(plan.summary.externalUnits) - number(trial.summary.externalUnits),
            staticReduction: number(plan.summary.staticExternalL) - number(trial.summary.staticExternalL),
            grade: gradeScore(left.grade) + gradeScore(right.grade), dailyQty: number(left.dailyQty) + number(right.dailyQty), rank: number(left.rank) + number(right.rank), width: 0,
            stableKey: `${left.skuKey}|${right.skuKey}|swap`
          }});
          generated += 1;
          if (generated >= maxCandidates) return actions.sort(compareAction);
        }
      }
    }
  }
  return actions.sort(compareAction);
}

function acceptOptimizationAction(plan, action) {
  const current = action.trial;
  current.operations.push({
    type: action.type,
    skuKey: action.row?.skuKey || action.left?.skuKey || "",
    targetCabinetKey: action.candidate?.cabinetKey || action.targetCabinetKey || "",
    displayCols: action.row?.displayCols || 0
  });
  current.optimizationAudit.acceptedActionCount = number(plan.optimizationAudit?.acceptedActionCount) + 1;
  if (action.type === "expand") current.optimizationAudit.expansionCount += 1;
  if (action.type === "fill") current.optimizationAudit.fillCount += 1;
  if (action.type === "secondary-placement") current.optimizationAudit.secondaryPlacementCount += 1;
  if (action.type === "move" || action.type === "move-expand") current.optimizationAudit.moveCount += 1;
  if (action.type === "swap") current.optimizationAudit.swapCount += 1;
  return recompute(current);
}

function applyOptimizationStage(plan, builder) {
  let current = plan;
  let accepted = 0;
  while (true) {
    const actions = builder(current)
      .filter(action => comparePlans(action.trial, current) > 0)
      .sort(compareAction);
    const best = actions[0];
    if (!best) break;
    current = acceptOptimizationAction(current, best);
    accepted += 1;
  }
  return { plan: current, accepted };
}

function countRemainingImprovementActions(plan, maxSwapCandidates) {
  const builders = [
    current => buildExpansionActions(current),
    current => buildFillActions(current),
    current => buildMoveActions(current),
    current => buildSwapActions(current, maxSwapCandidates)
  ];
  return builders.reduce((count, builder) => count + builder(plan)
    .filter(action => comparePlans(action.trial, plan) > 0).length, 0);
}

export function improvePlan(plan, { maxIterations = 100, maxExpansions = 1000, maxSwapCandidates = 1000 } = {}) {
  let current = recompute(plan);
  const maxCycles = Math.max(1, integer(maxIterations, 100));
  const seenSignatures = new Set([planSignature(current)]);
  let completedCycles = 0;
  let converged = false;
  let safetyBudgetExhausted = false;
  let stopReason = "OPTIMIZATION_NOT_CONVERGED";

  // maxExpansions remains a compatibility input, but it no longer decides
  // whether an individual action may trigger SKU exit. The safety budget is
  // measured in complete deterministic A-B-C-D cycles.
  void maxExpansions;
  while (completedCycles < maxCycles) {
    let cycleAccepted = 0;
    const expansion = applyOptimizationStage(current, buildExpansionActions);
    current = expansion.plan;
    cycleAccepted += expansion.accepted;

    const fill = applyOptimizationStage(current, buildFillActions);
    current = fill.plan;
    cycleAccepted += fill.accepted;

    const move = applyOptimizationStage(current, buildMoveActions);
    current = move.plan;
    cycleAccepted += move.accepted;

    const swap = applyOptimizationStage(current, planState => buildSwapActions(planState, Math.max(0, integer(maxSwapCandidates, 1000))));
    current = swap.plan;
    cycleAccepted += swap.accepted;

    completedCycles += 1;
    const signature = planSignature(current);
    if (cycleAccepted === 0) {
      converged = true;
      stopReason = "OPTIMIZATION_CONVERGED";
      break;
    }
    if (seenSignatures.has(signature)) {
      stopReason = "OPTIMIZATION_CYCLE_DETECTED";
      break;
    }
    seenSignatures.add(signature);
    if (completedCycles >= maxCycles) {
      safetyBudgetExhausted = true;
      stopReason = "OPTIMIZATION_NOT_CONVERGED";
      break;
    }
  }

  const remainingImprovementActions = converged || stopReason === "OPTIMIZATION_CYCLE_DETECTED"
    ? 0
    : countRemainingImprovementActions(current, Math.max(0, integer(maxSwapCandidates, 1000)));
  current.converged = converged;
  current.safetyBudgetExhausted = safetyBudgetExhausted;
  current.optimizationStopReason = stopReason;
  current.remainingImprovementActions = remainingImprovementActions;
  current.optimizationAudit.acceptedActionCount = number(current.optimizationAudit.acceptedActionCount);
  current.optimizationAudit.completedCycles = completedCycles;
  current.optimizationAudit.maxIterations = maxCycles;
  current.optimizationAudit.stoppedBecause = converged ? "柜位优化已收敛" : stopReason;
  return recompute(current);
}

function coreAllocation(options, selectedPool, optimization = {}) {
  const plan = createEmptyPlan({ ...options, productPool: selectedPool });
  initialPlan(plan);
  const optimized = improvePlan(plan, optimization);
  optimized.validation = validatePlan(optimized, { productPool: selectedPool, externalCapL: optimized.params.externalCapL });
  return optimized;
}

function exclusionReasonForProduct(plan, product) {
  if (product.ice && !plan.cabinets.some(cabinet => cabinet.saleEligible && cabinet.iceOnly && orientationOptions(product, cabinet).length)) return "ICE_CABINET_CAPACITY";
  if (!plan.cabinets.some(cabinet => cabinet.saleEligible && legalCabinetFor(product, cabinet))) return "PHYSICAL_FIT";
  return "STORE_CAPACITY_PRIORITY";
}

function markExcludedRow(row, reasonCode) {
  row.included = false;
  row.excluded = true;
  row.excludedForStore = true;
  row.status = "未纳入本店";
  row.excludeReason = reasonCode;
  row.reasonCode = reasonCode;
  row.reason = STORE_EXCLUSION_REASONS[reasonCode] || reasonCode;
  row.placements = [];
  row.cabinetKey = "";
  row.cabinetLabel = "";
  row.position = "";
  row.cabinetType = "";
  row.orientation = "";
  row.displayCols = 0;
  row.totalDisplayCols = 0;
  row.fullCount = 0;
  row.externalQty = 0;
  row.staticExternalL = 0;
  row.suggestedExternalL = 0;
  row.perCol = 0;
  row.faceWidth = 0;
  row.usedWidth = 0;
  row.widthUsed = 0;
  row.metrics = null;
}

function mergeRows(plan, activePool, removedReasons) {
  const current = new Map(plan.rows.map(row => [row.skuKey, row]));
  plan.rows = activePool.map(product => {
    const row = current.get(product.skuKey) || createRow(product);
    if (!row.included) markExcludedRow(row, removedReasons.get(product.skuKey) || row.reasonCode || exclusionReasonForProduct(plan, product));
    return row;
  });
  recompute(plan);
  plan.included = plan.rows.filter(row => row.included);
  plan.excludedForStore = plan.rows.filter(row => !row.included).map(row => ({
    skuKey: row.skuKey,
    name: row.name,
    category3: row.category3,
    category4: row.category4,
    reasonCode: row.reasonCode,
    reason: row.reason,
    excludedForStore: true
  }));
  plan.unplacedSkus = plan.excludedForStore;
  // A store-level exclusion with a recorded reason is a valid result.  It is
  // not a review item by itself; review is reserved for search truncation,
  // critical business choices or other explicit soft warnings.
  plan.softReviewItems = [];
  return plan;
}

function runPipelineStage(plan, stageName, builder) {
  const startedAt = Date.now();
  const result = applyOptimizationStage(plan, builder);
  result.plan.pipelineAudit.stageAcceptedActions[stageName] = number(result.plan.pipelineAudit.stageAcceptedActions[stageName]) + result.accepted;
  result.plan.pipelineAudit.stageTimesMs[stageName] = number(result.plan.pipelineAudit.stageTimesMs[stageName]) + (Date.now() - startedAt);
  return result.plan;
}

function runStrictStageLog(label, task) {
  console.log(`[STRICT] START ${label}`);
  const startedAt = Date.now();
  const result = task();
  console.log(`[STRICT] END ${label} ${Date.now() - startedAt} ms`);
  return result;
}

function runIncrementalStage(plan, label, stageName, builder, stepKey) {
  const startedAt = Date.now();
  const current = runStrictStageLog(label, () => runPipelineStage(plan, stageName, builder));
  current.pipelineAudit.stepTimesMs[stepKey] = number(current.pipelineAudit.stepTimesMs[stepKey]) + (Date.now() - startedAt);
  return current;
}

export function runAllocationPipeline(options, selectedPool) {
  const stepTimesMs = {};
  const startedAt = Date.now();
  const plan = runStrictStageLog("static-candidates", () => createEmptyPlan({ ...options, productPool: selectedPool }));
  plan.pipelineMode = "formal";
  stepTimesMs.staticCandidatePrecompute = 0;
  plan.pipelineAudit = {
    stageTimesMs: {},
    stageAcceptedActions: { expansion: 0, fill: 0, storeFill: 0, move: 0, swap: 0 },
    largeRemainderBucketCounts: { bucket1: 0, bucket2: 0, bucket3: 0, bucket4: 0 },
    largeRemainderBucketChecks: { bucket1: 0, bucket2: 0, bucket3: 0, bucket4: 0 },
    stepTimesMs,
    completedCycles: 0,
    converged: false,
    safetyBudgetExhausted: false,
    stopReason: "PIPELINE_RUNNING",
    staticCandidateCount: [...plan.staticCandidateBlueprints.values()].reduce((sum, items) => sum + items.length, 0)
  };

  runStrictStageLog("base-coverage", () => initialPlan(plan));
  stepTimesMs.baseCoverage = plan.pipelineAudit.stageTimesMs.baseCoverage || 0;
  plan.pipelineAudit.baseIncludedSkuCount = plan.rows.filter(row => row.included).length;

  let current = runStrictStageLog("expansion", () => runPipelineStage(plan, "expansion", buildExpansionActions));
  stepTimesMs.expansion = current.pipelineAudit.stageTimesMs.expansion || 0;

  current = runStrictStageLog("large-remainder-fill", () => runLargeRemainderFillStage(current));
  current.pipelineAudit.largeRemainderCabinetCount = current.cabinets.filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > 300 + EPSILON).length;
  current = runStrictStageLog("store-space-fill", () => runStoreSpaceFillStage(current));
  const fillComplete = finalizeLargeRemainderFill(current);

  if (fillComplete) current = runStrictStageLog("targeted-external-relief", () => {
    if (current.summary.externalSkuCount > 0) {
      current = runPipelineStage(current, "move", buildDirectedMoveActions);
      current = runPipelineStage(current, "expansion", buildExpansionActions);
      current = runPipelineStage(current, "swap", buildDirectedSwapActions);
      current = runPipelineStage(current, "expansion", buildExpansionActions);
    }
    return current;
  });
  stepTimesMs.externalRecall = current.pipelineAudit.stageTimesMs.move || 0;
  stepTimesMs.externalRecall += current.pipelineAudit.stageTimesMs.swap || 0;

  current.pipelineAudit.completedCycles = 1;
  current.pipelineAudit.converged = fillComplete;
  current.pipelineAudit.safetyBudgetExhausted = false;
  current.pipelineAudit.stopReason = fillComplete ? "PIPELINE_CONVERGED" : "LARGE_REMAINDER_FILL_INCOMPLETE";
  current.converged = fillComplete;
  current.safetyBudgetExhausted = false;
  current.optimizationStopReason = fillComplete ? "OPTIMIZATION_CONVERGED" : "LARGE_REMAINDER_FILL_INCOMPLETE";
  current.remainingImprovementActions = 0;
  current.pipelineAudit.stepTimesMs.total = Date.now() - startedAt;
  current.pipelineAudit.expansionCount = current.optimizationAudit.expansionCount;
  current.pipelineAudit.fillCount = current.optimizationAudit.fillCount;
  current.pipelineAudit.directedMoveCount = current.optimizationAudit.moveCount;
  current.pipelineAudit.directedSwapCount = current.optimizationAudit.swapCount;
  current.pipelineAudit.skuExitCount = 0;
  return recompute(current);
}

function removeAllPlacementsForSku(plan, row, reasonCode) {
  const current = plan.rows.find(item => item.skuKey === row.skuKey) || row;
  plan.excludedKeys ||= new Set();
  plan.excludedKeys.add(current.skuKey);
  markExcludedRow(current, reasonCode);
  return recompute(plan);
}

function resumeAllocationAfterSkuExit(plan) {
  let current = recompute(plan);
  current = runIncrementalStage(current, "expansion", "expansion", buildExpansionActions, "expansion");
  current = runStrictStageLog("large-remainder-fill", () => runLargeRemainderFillStage(current));
  current.pipelineAudit.largeRemainderCabinetCount = current.cabinets.filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > 300 + EPSILON).length;
  if (!finalizeLargeRemainderFill(current)) return current;

  const reliefStartedAt = Date.now();
  current = runStrictStageLog("targeted-external-relief", () => {
    if (current.summary.suggestedExternalL > current.params.externalCapL) {
      current = runPipelineStage(current, "move", buildDirectedMoveActions);
      if (current.summary.suggestedExternalL > current.params.externalCapL) {
        current = runPipelineStage(current, "swap", buildDirectedSwapActions);
      }
    }
    return current;
  });
  current.pipelineAudit.stepTimesMs.externalRecall = number(current.pipelineAudit.stepTimesMs.externalRecall) + (Date.now() - reliefStartedAt);
  current.pipelineAudit.completedCycles = number(current.pipelineAudit.completedCycles) + 1;
  current.pipelineAudit.converged = true;
  current.pipelineAudit.stopReason = "PIPELINE_CONVERGED";
  current.converged = true;
  current.safetyBudgetExhausted = false;
  current.optimizationStopReason = "OPTIMIZATION_CONVERGED";
  current.remainingImprovementActions = 0;
  return recompute(current);
}

function exitCompare(a, b) {
  const grade = gradeScore(a.grade) - gradeScore(b.grade);
  if (grade) return grade;
  const aC = gradeScore(a.grade) === 2;
  const bC = gradeScore(b.grade) === 2;
  if (aC !== bC) return Number(aC) - Number(bC);
  const rank = (number(b.rank) || 999999) - (number(a.rank) || 999999);
  if (rank) return rank;
  const daily = number(a.dailyQty) - number(b.dailyQty);
  if (daily) return daily;
  const priority = businessPriority(a) - businessPriority(b);
  if (priority) return priority;
  const external = number(b.staticExternalL) - number(a.staticExternalL);
  return external || stableCompare(a.skuKey, b.skuKey);
}

function buildEvidence(plan) {
  const top = plan.rows.filter(row => row.included && number(row.externalQty) > 0)
    .sort((a, b) => number(b.staticExternalL) - number(a.staticExternalL) || stableCompare(a.skuKey, b.skuKey))
    .slice(0, 10);
  const oneMoreColumn = top.map(row => {
    const candidates = [];
    for (let index = 0; index < row.placements.length; index += 1) {
      const trial = simulateExpansion(plan, row, index);
      if (!trial) continue;
      const after = trial.rows.find(item => item.skuKey === row.skuKey);
      candidates.push({
        placementIndex: index,
        cabinetKey: row.placements[index].cabinetKey,
        additionalWidth: row.placements[index].faceWidth,
        reducedExternalQty: number(row.externalQty) - number(after?.externalQty),
        reducedExternalL: number(row.staticExternalL) - number(after?.staticExternalL),
        reducedSuggestedExternalL: number(plan.summary.suggestedExternalL) - number(trial.summary.suggestedExternalL)
      });
    }
    for (const candidate of candidateLocations(plan, row)) {
      if (!canHaveAdditionalPlacement(row, candidate)) continue;
      const benefit = estimateAdditionalBenefit(plan, row, candidate, 1);
      if (!benefit) continue;
      candidates.push({
        cabinetKey: candidate.cabinetKey,
        additionalWidth: candidate.additionalWidth,
        reducedExternalQty: benefit.externalReduction,
        reducedExternalL: benefit.externalReduction * number(row.volume),
        reducedSuggestedExternalL: benefit.suggestedReduction
      });
    }
    candidates.sort((a, b) => b.reducedSuggestedExternalL - a.reducedSuggestedExternalL || b.reducedExternalL - a.reducedExternalL || a.additionalWidth - b.additionalWidth || stableCompare(a.cabinetKey, b.cabinetKey));
    const best = candidates[0];
    return {
      skuKey: row.skuKey,
      name: row.name,
      category4: row.category4,
      currentDisplayCols: row.displayCols,
      currentExternalQty: row.externalQty,
      currentExternalL: row.staticExternalL,
      additionalWidth: best?.additionalWidth || 0,
      reduceExternalQty: best?.reducedExternalQty || 0,
      reduceExternalL: best?.reducedExternalL || 0,
      reduceSuggestedExternalL: best?.reducedSuggestedExternalL || 0,
      hasLegalExpansionCabinet: Boolean(best),
      legalExpansionCabinets: candidates.map(candidate => candidate.cabinetKey)
    };
  });
  return {
    minimumSuggestedExternalLFound: plan.summary.suggestedExternalL,
    excessOverCapL: Math.max(0, plan.summary.suggestedExternalL - plan.params.externalCapL),
    topExternalContributors: oneMoreColumn,
    oneMoreColumn,
    remainingUsableWidth: plan.cabinets.filter(cabinet => cabinet.saleEligible && cabinet.leftWidth > EPSILON).map(cabinet => ({ cabinetKey: cabinet.key, leftWidth: cabinet.leftWidth })),
    maximumContinuousRemainingWidth: Math.max(0, ...plan.cabinets.filter(cabinet => cabinet.saleEligible).map(cabinet => cabinet.leftWidth)),
    largeRemainders: explainLargeRemainders(plan),
    layoutOptimization: plan.optimizationAudit
  };
}

function selectStorePlan(options, activePool, optimization = {}) {
  const cap = number(options.params?.externalCapL ?? DEFAULT_EXTERNAL_CAP_L);
  let selected = activePool.slice();
  const removedReasons = new Map();
  let current = coreAllocation(options, selected, optimization);
  let exitIterations = 0;
  const maxExitIterations = Math.max(0, integer(optimization.maxSelectionIterations ?? activePool.length, activePool.length));
  while (current.converged === true && current.summary.suggestedExternalL > cap && exitIterations < maxExitIterations) {
    const candidates = current.rows.filter(row => row.included).sort(exitCompare);
    if (!candidates.length) break;
    // The formal exit order is deterministic and business-defined. Remove
    // exactly one SKU, rebuild the complete plan, and then decide whether a
    // further exit is necessary. Do not test a batch of removals or choose by
    // a new metric after the fact.
    const row = candidates[0];
    selected = selected.filter(product => product.skuKey !== row.skuKey);
    current = coreAllocation(options, selected, optimization);
    removedReasons.set(row.skuKey, "EXTERNAL_CAP_PRIORITY");
    exitIterations += 1;
  }
  const beforeMerge = current.summary;
  current = mergeRows(current, activePool, removedReasons);
  if (current.converged !== true) current.optimizationStopReason = current.optimizationStopReason || "OPTIMIZATION_NOT_CONVERGED";
  current.selectionAudit = {
    candidateSkuCount: activePool.length,
    selectedCandidateSkuCount: selected.length,
    excludedForStoreCount: activePool.length - selected.length,
    exitIterations,
    selectionStopReason: current.optimizationStopReason || (current.summary.suggestedExternalL <= cap ? "布局优化或逐个SKU退出后满足754L" : "合法布局优化和逐个SKU退出后仍超过754L"),
    objective: "硬结构合法 > 建议外储<=754L > 高价值SKU保留 > 经营价值 > 直接整箱 > 外储SKU > 建议外储L > 品类集中 > 纳入数量 > 碎片空间 > 稳定Key",
    beforeSelection: beforeMerge,
    deterministic: true
  };
  current.externalOptimizationEvidence = {
    hardCapExternalL: cap,
    before: beforeMerge,
    after: current.summary,
    excludedOneByOne: exitIterations,
    remainingOverLimitL: Math.max(0, current.summary.suggestedExternalL - cap)
  };
  return { plan: current, activePool, removedReasons, selected };
}

function hasNaN(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNaN);
  if (value && typeof value === "object") return Object.values(value).some(hasNaN);
  return false;
}

function validationErrorForPlacement(plan, row, placement, cabinetMap, typeCounts) {
  const errors = [];
  const cabinet = cabinetMap.get(placement.cabinetKey);
  if (!cabinet) {
    errors.push(`纳入SKU无柜段：${row.skuKey}`);
    return errors;
  }
  if (!cabinet.saleEligible) errors.push(`销售placement使用预留或存储柜段：${row.skuKey}`);
  if (row.ice !== cabinet.iceOnly) errors.push(`冰品/普通冻品错柜：${row.skuKey}`);
  if (!["length-face", "width-face"].includes(placement.orientation)) errors.push(`存在非法物理方向：${row.skuKey}`);
  const orientation = orientationOptionsForPlan(plan, row, cabinet).find(option => option.orientation === placement.orientation);
  if (!orientation) {
    errors.push(`SKU尺寸不适配：${row.skuKey}`);
    return errors;
  }
  if (placement.orientedDepth !== orientation.orientedDepth || placement.orientedHeight !== orientation.orientedHeight) errors.push(`物理方向尺寸不同步：${row.skuKey}`);
  if (placement.stackCount < 1 || placement.stackCount !== orientation.stackCount) errors.push(`物理堆叠数量不同步：${row.skuKey}`);
  if (!Number.isInteger(placement.displayCols) || placement.displayCols < 1) errors.push(`陈列列数非法：${row.skuKey}`);
  if (placement.fullCount !== placement.displayCols * placement.perCol) errors.push(`placement满陈异常：${row.skuKey}`);
  if (placement.widthUsed !== round(placement.displayCols * placement.faceWidth)) errors.push(`列数与宽度账不同步：${row.skuKey}`);
  const types = typeCounts.get(row.skuKey) || new Map();
  types.set(cabinet.cabinetType, (types.get(cabinet.cabinetType) || 0) + 1);
  typeCounts.set(row.skuKey, types);
  return errors;
}

export function validatePlan(plan, { productPool, externalCapL = plan?.params?.externalCapL ?? DEFAULT_EXTERNAL_CAP_L } = {}) {
  const active = activeProductPool(productPool || plan?.rows || []);
  const activeKeys = new Set(active.map(row => row.skuKey));
  const rows = Array.isArray(plan?.rows) ? plan.rows : [];
  const cabinets = Array.isArray(plan?.cabinets) ? plan.cabinets : [];
  const cabinetMap = new Map(cabinets.map(cabinet => [cabinet.key, cabinet]));
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const typeCounts = new Map();
  for (const row of rows) {
    if (!activeKeys.has(row.skuKey)) errors.push(`SKU不在当前有效产品池：${row.skuKey}`);
    if (seen.has(row.skuKey)) errors.push(`SKU异常重复：${row.skuKey}`);
    seen.add(row.skuKey);
    if (!row.included && !row.excludedForStore) errors.push(`门店SKU去向标记缺失：${row.skuKey}`);
    if (!row.included && (!text(row.reasonCode) || !text(row.reason))) errors.push(`未纳入SKU缺少明确原因：${row.skuKey}`);
  }
  for (const key of activeKeys) if (!seen.has(key)) errors.push(`有效SKU无结果：${key}`);
  for (const cabinet of cabinets) {
    if (!(cabinet.length > 0)) errors.push(`柜段length无效：${cabinet.key}`);
    if (!(cabinet.depth > 0)) errors.push(`柜段depth无效：${cabinet.key}`);
    if (!(cabinet.height > 0)) errors.push(`柜段height无效：${cabinet.key}`);
    if (!text(cabinet.physicalSource) || INVALID_SOURCES.has(text(cabinet.physicalSource).toLowerCase())) errors.push(`柜段物理来源无效：${cabinet.key}`);
    if (cabinet.physicalSourceError) errors.push(`${cabinet.physicalSourceError}：${cabinet.key}`);
    if (cabinet.physicalSourceMatches > 1) errors.push(`柜段物理尺寸来源不唯一：${cabinet.key}`);
    if (cabinet.overWidth) errors.push(`柜段超宽：${cabinet.key}`);
  }
  if (!(number(plan?.params?.p95Factor) > 0)) errors.push("门店P95系数缺失或无效");
  if (!text(plan?.params?.p95Source)) errors.push("门店P95来源缺失");
  for (const row of rows.filter(item => item.included)) {
    if (!row.placements?.length) errors.push(`纳入SKU缺少placement：${row.skuKey}`);
    for (const placement of row.placements || []) validationErrorForPlacement(plan, row, placement, cabinetMap, typeCounts).forEach(error => errors.push(error));
    const types = typeCounts.get(row.skuKey) || new Map();
    if ([...types.values()].some(count => count > 1)) errors.push(`同SKU同柜型拆分：${row.skuKey}`);
    if (gradeScore(row.grade) < gradeScore("B") && row.placements.length > 1) errors.push(`C/D级SKU存在多个placement：${row.skuKey}`);
    const expected = rowMetrics(row, row.placements, plan.params);
    if (row.fullCount !== expected.full || row.displayCols !== expected.displayCols || row.externalQty !== expected.externalQty) errors.push(`SKU级placement聚合异常：${row.skuKey}`);
    if (row.staticExternalL !== expected.staticExternalL) errors.push(`SKU级静态外储异常：${row.skuKey}`);
  }
  const included = rows.filter(row => row.included);
  const external = included.filter(row => row.externalQty > 0);
  const summary = plan.summary || summarize(plan);
  if (summary.directCartonSkuCount + summary.externalSkuCount !== summary.includedSkuCount) errors.push("直接整箱SKU与外储SKU数量不守恒");
  if (summary.suggestedExternalL > number(externalCapL)) errors.push(`建议外储超过754L：${summary.suggestedExternalL}L`);
  if (summary.layer6SalesCount > 0) errors.push(`立柜第6层参与销售陈列：${summary.layer6SalesCount}`);
  if (summary.iceWrongCount > 0) errors.push(`冰品错柜：${summary.iceWrongCount}`);
  if (plan.sourceAudit?.physicalRecordCount > 0 && plan.sourceAudit.matchedSourceCount !== plan.sourceAudit.physicalRecordCount) errors.push("柜段数量与物理数据源不一致");
  if (hasNaN({ summary, rows, cabinets })) errors.push("关键数据存在NaN或Infinity");
  for (const cabinet of cabinets.filter(item => item.saleEligible && item.leftWidth > 300 + EPSILON)) {
    if (!cabinet.largeRemainderReason) warnings.push(`柜段剩余大于300mm未记录补位说明：${cabinet.key}`);
  }
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
    unplacedSkus: rows.filter(row => !row.included).map(row => ({ skuKey: row.skuKey, name: row.name, reasonCode: row.reasonCode, reason: row.reason, excludedForStore: true })),
    checks: {
      skuConservation: conservationOk,
      overWidthCount: summary.overWidthCount,
      layer6SalesCount: summary.layer6SalesCount,
      iceWrongCount: summary.iceWrongCount,
      placementAggregation: errors.every(error => !error.includes("placement聚合")),
      externalCap: summary.suggestedExternalL <= number(externalCapL),
      noNaN: !hasNaN({ summary, rows, cabinets })
    }
  };
}

function statusFor(validation, plan) {
  if (plan.optimizationStopReason && plan.optimizationStopReason !== "OPTIMIZATION_CONVERGED") return "failed";
  if (!validation.ok) return "failed";
  if (plan.searchAudit?.searchTruncated) return "review_required";
  if (plan.softReviewItems?.length) return "review_required";
  return "passed";
}

export function allocateStore(options = {}, optimization = {}) {
  const activePool = activeProductPool(options.productPool);
  let selectedPool = activePool.slice();
  const removedReasons = new Map();
  const cap = number(options.params?.externalCapL ?? DEFAULT_EXTERNAL_CAP_L);
  let plan = runAllocationPipeline(options, selectedPool);
  plan.pipelineAudit.createStateCount = 1;
  plan.pipelineAudit.staticCandidatesBuildCount = 1;
  plan.pipelineAudit.fullPipelineRebuildCount = 0;
  let exitIterations = 0;
  const skuExitStartedAt = Date.now();
  plan = runStrictStageLog("sku-exit", () => {
    while (plan.converged === true && plan.summary.suggestedExternalL > cap) {
      const candidates = plan.rows.filter(row => row.included).sort(exitCompare);
      if (!candidates.length) break;
      const row = candidates[0];
      selectedPool = selectedPool.filter(product => product.skuKey !== row.skuKey);
      removedReasons.set(row.skuKey, "EXTERNAL_CAP_PRIORITY");
      exitIterations += 1;
      plan = removeAllPlacementsForSku(plan, row, "EXTERNAL_CAP_PRIORITY");
      plan = resumeAllocationAfterSkuExit(plan);
    }
    return plan;
  });
  plan = mergeRows(plan, activePool, removedReasons);
  plan.pipelineAudit.stepTimesMs.skuExit = Date.now() - skuExitStartedAt;
  plan.pipelineAudit.skuExitCount = exitIterations;
  plan.pipelineAudit.skuExitIncrementalCount = exitIterations;
  plan.pipelineAudit.totalWithSkuExit = number(plan.pipelineAudit.stepTimesMs.total) + plan.pipelineAudit.stepTimesMs.skuExit;
  plan.validation = runStrictStageLog("validator", () => validatePlan(plan, { productPool: options.productPool, externalCapL: plan.params.externalCapL }));
  plan.status = statusFor(plan.validation, plan);
  plan.externalRiskLevel = plan.summary.externalRiskLevel;
  plan.evidence = buildEvidence(plan);
  plan.evidence.minimumSuggestedExternalLFound = plan.summary.suggestedExternalL;
  plan.evidence.excessOverCapL = Math.max(0, plan.summary.suggestedExternalL - plan.params.externalCapL);
  plan.selectionAudit = {
    candidateSkuCount: activePool.length,
    selectedCandidateSkuCount: selectedPool.length,
    excludedForStoreCount: activePool.length - selectedPool.length,
    exitIterations,
    selectionStopReason: plan.summary.suggestedExternalL <= cap
      ? "固定业务流水线完成后满足754L"
      : "固定业务流水线完成后仍超过754L，无可继续退出SKU",
    objective: "Skill固定流水线：静态候选 > 基础覆盖 > 扩陈 > >300mm补位 > 外储回调 > 逐个SKU退出 > 校验",
    beforeSelection: plan.pipelineAudit,
    deterministic: true
  };
  plan.placements = plan.rows.flatMap(row => row.included ? row.placements : []);
  return plan;
}

export function planSignature(plan) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonical(value[key]);
      return out;
    }, {});
    return value;
  };
  return JSON.stringify(canonical({
    version: plan.version,
    store: plan.store,
    rows: plan.rows.map(row => ({
      skuKey: row.skuKey,
      included: row.included,
      reasonCode: row.reasonCode,
      placements: row.placements,
      displayCols: row.displayCols,
      fullCount: row.fullCount,
      externalQty: row.externalQty
    })),
    cabinets: plan.cabinets.map(cabinet => ({ key: cabinet.key, usedWidth: cabinet.usedWidth, leftWidth: cabinet.leftWidth })),
    summary: plan.summary,
    validation: plan.validation,
    status: plan.status
  }));
}

// Compatibility exports. All of them point into this same core; none is a
// second business implementation.
export const 新店业务候选 = candidateLocations;
export const 新店业务方案比较 = comparePlans;
export const 新店业务扩陈 = simulateExpansion;
export const 新店业务尝试补位 = (plan, row) => candidateLocations(plan, row, { includeCurrent: false });
export const 新店业务尝试换柜 = simulateMove;
export const 新店业务尝试互换 = simulateSwap;
export const 新店业务局部优化 = improvePlan;
export const 严格校验新增门店排柜业务优化 = validatePlan;
export const 严格预排新增门店业务优化 = allocateStore;
export const 新店业务证据 = plan => plan.evidence;

// Keep the default export for the browser adapter shipped on master.
// The named exports remain the canonical API; this object is only the
// compatibility surface expected by older loaders.
const strictAllocationEngine = {
  activeProductPool,
  normalizeCabinets,
  recalculatePlan,
  allocateStore,
  runAllocationPipeline,
  improvePlan,
  comparePlans,
  validatePlan,
  planSignature
};
export default strictAllocationEngine;

if (typeof globalThis !== "undefined") {
  globalThis.StrictAllocationEngine = {
    activeProductPool,
    normalizeCabinets,
    recalculatePlan,
    allocateStore,
    runAllocationPipeline,
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
