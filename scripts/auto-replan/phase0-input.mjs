import {
  INVALID_PHYSICAL_SOURCES,
  asNumber,
  asText,
  cabinetClass,
  cabinetIdentity,
  explicitTrue,
  isExplicitlyRetired,
  isIceProduct,
  isLayer6,
  stableCompare,
  stableSkuKey
} from "./common.mjs";
import {
  PHYSICAL_BUSINESS_RULES,
  allowedPhysicalOrientations,
  physicalStackRule
} from "./physical-business-rules.mjs";

function physicalIndex(records = []) {
  const index = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = cabinetIdentity(record.store, record.label, record.position);
    const list = index.get(key) || [];
    list.push(record);
    index.set(key, list);
  }
  return index;
}

function normalizeOrientations() {
  return allowedPhysicalOrientations();
}

function normalizeProducts(productPool, errors) {
  const products = [];
  const seen = new Set();
  for (const source of Array.isArray(productPool) ? productPool : []) {
    if (isExplicitlyRetired(source)) continue;
    const skuKey = stableSkuKey(source);
    if (!skuKey) {
      errors.push("发现缺少条码、SKU键和商品名称的有效产品记录");
      continue;
    }
    if (seen.has(skuKey)) {
      errors.push(`有效产品池存在重复SKU：${skuKey}`);
      continue;
    }
    seen.add(skuKey);
    const length = asNumber(source.length);
    const width = asNumber(source.width);
    const height = asNumber(source.height);
    const volume = asNumber(source.volume);
    const carton = Math.max(0, Math.floor(asNumber(source.carton)));
    const missing = [];
    if (!(length > 0)) missing.push("length");
    if (!(width > 0)) missing.push("width");
    if (!(height > 0)) missing.push("height");
    if (!(volume > 0)) missing.push("volume");
    if (!(carton > 0)) missing.push("carton");
    if (missing.length) errors.push(`商品“${asText(source.name) || skuKey}”缺少有效字段：${missing.join("、")}`);
    products.push({
      skuKey,
      barcode: asText(source.barcode),
      name: asText(source.name) || skuKey,
      active: true,
      length,
      width,
      height,
      volume,
      carton,
      dailyQty: asNumber(source.dailyQty),
      grade: asText(source.grade),
      rank: asNumber(source.rank) > 0 ? asNumber(source.rank) : 999999,
      businessPriority: asNumber(source.businessPriority ?? source.priority ?? source.priorityScore),
      categoryCore: asNumber(source.categoryCore),
      category2: asText(source.category2),
      category3: asText(source.category3),
      category4: asText(source.category4),
      sceneGroup: asText(source.sceneGroup) || asText(source.category3) || "未分类",
      ice: isIceProduct(source),
      allowedCabinetTypes: Array.isArray(source.allowedCabinetTypes) ? source.allowedCabinetTypes.map(asText).filter(Boolean) : [],
      allowedOrientations: normalizeOrientations()
    });
  }
  return products.sort((left, right) => stableCompare(left.skuKey, right.skuKey));
}

function normalizeCabinets(store, cabinets, records, errors) {
  const index = physicalIndex(records);
  return (Array.isArray(cabinets) ? cabinets : [])
    .filter(cabinet => asText(cabinet.store) === asText(store))
    .sort((left, right) => stableCompare(left.key || left.id, right.key || right.id))
    .map((source, order) => {
      const key = asText(source.key) || cabinetIdentity(store, source.label, source.position);
      const sourceKey = cabinetIdentity(store, source.label, source.position);
      const matches = index.get(sourceKey) || [];
      if (matches.length > 1) errors.push(`柜段物理尺寸来源不唯一：${asText(source.label)} ${asText(source.position)}`);
      const matched = matches.length === 1 ? matches[0] : null;
      const dimensions = matched || source;
      const length = asNumber(dimensions.length);
      const depth = asNumber(dimensions.depth);
      const height = asNumber(dimensions.height);
      const physicalSource = matched
        ? asText(matched.physicalSource || matched.source) || "user-confirmed-physical-dimensions"
        : asText(source.physicalSource) || (length > 0 && depth > 0 && height > 0 ? "app-data" : "");
      const missing = [];
      if (!(length > 0)) missing.push("length");
      if (!(depth > 0)) missing.push("depth");
      if (!(height > 0)) missing.push("height");
      if (missing.length) errors.push(`柜段“${asText(source.label)} ${asText(source.position)}”物理尺寸缺失：${missing.join("、")}`);
      if (!physicalSource || INVALID_PHYSICAL_SOURCES.has(physicalSource.toLowerCase())) {
        errors.push(`柜段“${asText(source.label)} ${asText(source.position)}”没有真实有效的物理数据来源`);
      }
      const typeClass = cabinetClass(source);
      const stackRule = physicalStackRule(typeClass);
      const storageOnly = isLayer6(source) || /存储位/.test(asText(source.status));
      const disabled = /停用|禁用|关闭|废弃|封存/.test(asText(source.status));
      return {
        key,
        sourceCabinetKey: matched ? asText(matched.sourceCabinetKey) || sourceKey : asText(source.sourceCabinetKey) || sourceKey,
        store: asText(store),
        label: asText(source.label) || key,
        position: asText(source.position),
        kind: asText(source.kind) || asText(source.type),
        type: asText(source.type) || asText(source.kind),
        cabinetClass: typeClass,
        length,
        depth,
        height,
        physicalSource,
        physicalSourceMatches: matches.length,
        storageOnly,
        saleEligible: !storageOnly && !disabled,
        iceOnly: typeClass === "ice" || explicitTrue(source.iceOnly),
        allowStack: typeClass === "vertical" ? false : stackRule.allowStack,
        allowVerticalStack: false,
        physicalRuleSource: PHYSICAL_BUSINESS_RULES.source,
        sceneGroup: asText(source.sceneGroup),
        order
      };
    });
}

export function loadAndValidatePhase0({
  store,
  productPool,
  cabinets,
  params = {},
  physicalRecords = [],
  previousPlan = null
}) {
  const errors = [];
  const warnings = [];
  const storeKey = asText(store);
  if (!storeKey) errors.push("缺少门店标识");
  const candidateSkus = normalizeProducts(productPool, errors);
  const normalizedCabinets = normalizeCabinets(storeKey, cabinets, physicalRecords, errors);
  if (!candidateSkus.length) errors.push("当前有效产品池为空");
  if (!normalizedCabinets.length) errors.push("当前门店没有柜体配置");
  const normalizedParams = {
    triggerRate: asNumber(params.triggerRate ?? 0.1),
    p95Factor: asNumber(params.p95Factor ?? 1),
    externalSafetyFactor: asNumber(params.externalSafetyFactor ?? 1),
    externalCapL: asNumber(params.externalCapL ?? 754)
  };
  if (!(normalizedParams.triggerRate >= 0 && normalizedParams.triggerRate < 1)) errors.push("触发库存比例必须大于等于0且小于1");
  if (!(normalizedParams.p95Factor > 0)) errors.push("P95外储系数必须大于0");
  if (!(normalizedParams.externalSafetyFactor > 0)) errors.push("外储安全系数必须大于0");
  if (normalizedParams.externalCapL !== 754) errors.push("当前自动排柜外储硬上限必须为754L");
  return {
    phase: "PHASE_0",
    ok: errors.length === 0,
    store: storeKey,
    candidateSkus,
    cabinets: normalizedCabinets,
    params: normalizedParams,
    previousPlan: previousPlan ? JSON.parse(JSON.stringify(previousPlan)) : null,
    errors,
    warnings,
    sourceAudit: {
      productSource: "productPool",
      inputProductCount: Array.isArray(productPool) ? productPool.length : 0,
      candidateSkuCount: candidateSkus.length,
      configuredCabinetCount: normalizedCabinets.length,
      saleCabinetCount: normalizedCabinets.filter(cabinet => cabinet.saleEligible).length,
      storageCabinetCount: normalizedCabinets.filter(cabinet => cabinet.storageOnly).length,
      confirmedPhysicalCount: normalizedCabinets.filter(cabinet => cabinet.physicalSource === "user-confirmed-physical-dimensions").length,
      appDataPhysicalCount: normalizedCabinets.filter(cabinet => cabinet.physicalSource === "app-data").length
    }
  };
}
