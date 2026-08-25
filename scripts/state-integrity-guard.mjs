function text(value) {
  return String(value ?? "").trim();
}

function productKey(row) {
  return text(row?.barcode) || text(row?.name) || text(row?.id);
}

function duplicateValues(rows, field, label) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = text(row?.[field]);
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].map(value => `${label}重复：${value}`);
}

function keys(rows, field, keyFn = row => text(row?.[field])) {
  return new Set((Array.isArray(rows) ? rows : []).map(keyFn).filter(Boolean));
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function createStateIntegrityGuard(baseState) {
  const base = clone(baseState || {});
  const baseStores = keys(base.stores, "store");
  const baseCabinets = keys(base.cabinets, "key");
  const baseSkus = keys(base.skus, "id");
  const basePool = keys(base.productPool, "", productKey);

  function validate(nextState, options = {}) {
    const next = nextState || {};
    const reference = options.referenceState || null;
    const errors = [];
    const stores = Array.isArray(next.stores) ? next.stores : [];
    const cabinets = Array.isArray(next.cabinets) ? next.cabinets : [];
    const skus = Array.isArray(next.skus) ? next.skus : [];
    const pool = Array.isArray(next.productPool) ? next.productPool : [];
    const storeKeys = keys(stores, "store");
    const cabinetKeys = keys(cabinets, "key");
    const skuKeys = keys(skus, "id");
    const poolKeys = keys(pool, "", productKey);

    if (!Array.isArray(next.stores) || !Array.isArray(next.cabinets) || !Array.isArray(next.skus)) {
      errors.push("状态结构不完整：门店、柜体或SKU列表缺失");
    }
    errors.push(...duplicateValues(stores, "store", "门店"));
    errors.push(...duplicateValues(cabinets, "key", "柜体主键"));
    errors.push(...duplicateValues(skus, "id", "SKU主键"));

    for (const store of baseStores) {
      if (!storeKeys.has(store)) errors.push(`正式门店被移除：${store}`);
    }
    for (const key of baseCabinets) {
      if (!cabinetKeys.has(key)) errors.push(`正式柜体被移除：${key}`);
    }

    const allowedRemovedSkuIds = new Set((options.allowedRemovedSkuIds || []).map(text).filter(Boolean));
    for (const id of baseSkus) {
      if (!skuKeys.has(id) && !allowedRemovedSkuIds.has(id)) errors.push(`未授权SKU被移除：${id}`);
    }
    for (const key of basePool) {
      if (!poolKeys.has(key)) errors.push(`正式产品池记录被移除：${key}`);
    }

    if (reference) {
      const referenceStores = keys(reference.stores, "store");
      const referenceCabinets = keys(reference.cabinets, "key");
      const referenceSkus = keys(reference.skus, "id");
      const referencePool = keys(reference.productPool, "", productKey);
      for (const store of referenceStores) {
        if (!storeKeys.has(store)) errors.push(`当前页面门店被覆盖：${store}`);
      }
      for (const key of referenceCabinets) {
        if (!cabinetKeys.has(key)) errors.push(`当前页面柜体被覆盖：${key}`);
      }
      for (const id of referenceSkus) {
        if (!skuKeys.has(id) && !allowedRemovedSkuIds.has(id)) errors.push(`当前页面SKU被覆盖：${id}`);
      }
      for (const key of referencePool) {
        if (!poolKeys.has(key)) errors.push(`当前页面产品池记录被覆盖：${key}`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      removedSkuIds: [...baseSkus].filter(id => !skuKeys.has(id)),
    };
  }

  return { validate, snapshot: clone(base) };
}

export default { createStateIntegrityGuard };
