import { runStrictAllocation, planSignature } from "./strict-allocation-adapter.mjs";

export { planSignature };

export const REPLAN_DRAFT_KEY = "frozen_carton_replan_draft_v2";

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalProductKey(product) {
  return text(product?.barcode) || text(product?.productKey) || text(product?.id) || text(product?.name);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashString(value) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + index;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function productPoolRevision(productPool = []) {
  const canonical = (Array.isArray(productPool) ? productPool : [])
    .map(product => stableValue(product))
    .sort((a, b) => text(canonicalProductKey(a)).localeCompare(text(canonicalProductKey(b)), "zh-CN", { numeric: true }));
  return `pool-v2-${hashString(stableStringify(canonical))}`;
}

export function activeProductPool(productPool = []) {
  const seen = new Set();
  return (Array.isArray(productPool) ? productPool : []).filter(product => {
    const state = `${text(product?.lifecycleStatus)}|${text(product?.status)}`;
    if (product?.active === false || /淘汰完成|已淘汰|retired/i.test(state)) return false;
    const key = canonicalProductKey(product);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(clone);
}

function findProduct(pool, selector = {}) {
  const barcode = text(selector.barcode || selector.productKey);
  const name = text(selector.name || selector.productName);
  if (barcode) {
    const byBarcode = pool.find(product => text(product.barcode) === barcode);
    if (byBarcode) return byBarcode;
  }
  if (name) {
    const byName = pool.find(product => text(product.name) === name);
    if (byName) return byName;
  }
  const key = text(selector.id);
  return key ? pool.find(product => text(product.id) === key) || null : null;
}

function lifecycleTask(batchId, operation, product, index, effectiveAt) {
  const type = operation.type === "retire" ? "淘汰" : operation.type === "restore" ? "恢复" : operation.type === "add" ? "上新" : "产品资料修改";
  return {
    id: `${batchId}:${String(index + 1).padStart(3, "0")}`,
    type,
    productKey: canonicalProductKey(product),
    productName: text(product.name),
    status: "已完成",
    completedAt: text(effectiveAt),
    source: "产品池维护",
    changeSetId: batchId
  };
}

export function applyProductPoolChanges(productPool = [], operations = [], { batchId = "pool-batch", effectiveAt = "" } = {}) {
  const next = (Array.isArray(productPool) ? productPool : []).map(clone);
  const applied = [];
  const errors = [];
  for (const [index, operation] of (Array.isArray(operations) ? operations : []).entries()) {
    const type = text(operation?.type);
    if (!["add", "update", "retire", "restore"].includes(type)) {
      errors.push(`不支持的产品池操作：${type || "空"}`);
      continue;
    }
    const target = findProduct(next, operation?.product || operation || {});
    if (type === "add") {
      const product = clone(operation.product || {});
      if (!text(product.barcode) || !text(product.name)) {
        errors.push("新增SKU必须同时提供商品条码和商品名称");
        continue;
      }
      if (findProduct(next, product)) {
        errors.push(`SKU已存在，不能重复新增：${text(product.barcode) || text(product.name)}`);
        continue;
      }
      product.id = text(product.id) || `pool_${text(product.barcode)}`;
      product.active = true;
      product.lifecycleStatus = "上新完成";
      next.push(product);
      applied.push({ type, product: clone(product), task: lifecycleTask(batchId, operation, product, index, effectiveAt) });
      continue;
    }
    if (!target) {
      errors.push(`找不到产品池SKU：${text(operation?.barcode || operation?.name || operation?.productKey)}`);
      continue;
    }
    const before = clone(target);
    if (type === "update") {
      const changes = clone(operation.changes || {});
      delete changes.active;
      delete changes.lifecycleStatus;
      Object.assign(target, changes);
    } else if (type === "retire") {
      target.active = false;
      target.lifecycleStatus = "淘汰完成";
    } else if (type === "restore") {
      target.active = true;
      target.lifecycleStatus = "在售SKU";
    }
    const task = lifecycleTask(batchId, operation, target, index, effectiveAt);
    target.lifecycleTaskId = task.id;
    target.lifecycleChangedAt = text(effectiveAt);
    applied.push({ type, before, product: clone(target), task });
  }
  return {
    ok: errors.length === 0,
    errors,
    productPool: next,
    applied,
    revision: productPoolRevision(next),
    activeProductCount: activeProductPool(next).length
  };
}

export function publishProductPoolChanges(state, operations = [], options = {}) {
  const source = clone(state || {});
  const batchId = text(options.batchId) || `pool-batch-${productPoolRevision(source.productPool || []).slice(-8)}`;
  const result = applyProductPoolChanges(source.productPool || [], operations, { ...options, batchId });
  if (!result.ok) return { ...result, state: source };
  source.productPool = result.productPool;
  source.productPoolRevision = result.revision;
  source.productPoolChangeLog = [
    ...(Array.isArray(source.productPoolChangeLog) ? source.productPoolChangeLog : []),
    {
      batchId,
      revision: result.revision,
      effectiveAt: text(options.effectiveAt),
      operations: result.applied.map(item => ({ type: item.type, skuKey: canonicalProductKey(item.product), taskId: item.task.id }))
    }
  ];
  const lifecycle = source.lifecycle && typeof source.lifecycle === "object" ? source.lifecycle : {};
  lifecycle.version = number(lifecycle.version) || 2;
  lifecycle.tasks = Array.isArray(lifecycle.tasks) ? lifecycle.tasks : [];
  lifecycle.tasks = [...result.applied.map(item => item.task), ...lifecycle.tasks];
  lifecycle.updatedAt = text(options.effectiveAt);
  source.lifecycle = lifecycle;
  return { ...result, state: source };
}

function cabinetSignature(cabinets = []) {
  return hashString(stableStringify((Array.isArray(cabinets) ? cabinets : []).map(cabinet => ({
    key: cabinet.key,
    store: cabinet.store,
    label: cabinet.label,
    position: cabinet.position,
    length: number(cabinet.length),
    depth: number(cabinet.depth),
    height: number(cabinet.height),
    physicalSource: cabinet.physicalSource,
    sourceCabinetKey: cabinet.sourceCabinetKey
  })).sort((a, b) => text(a.key).localeCompare(text(b.key), "zh-CN", { numeric: true }))));
}

function scopeStores(stores, scope) {
  const names = Array.isArray(scope) && scope.length ? new Set(scope.map(text)) : new Set((stores || []).map(store => text(store.store)));
  return (Array.isArray(stores) ? stores : []).filter(store => names.has(text(store.store)));
}

export function generateReplanDraft({ productPool = [], stores = [], cabinets = [], params = {}, previousPlans = {}, scope = [], physicalRecords = [], optimization = {}, generatedAt = "" } = {}) {
  const selectedStores = scopeStores(stores, scope);
  const revision = productPoolRevision(productPool);
  const results = [];
  for (const store of selectedStores) {
    const name = text(store.store);
    const previousPlan = previousPlans?.[name] || null;
    const plan = runStrictAllocation({
      store: name,
      type: store.type,
      productPool,
      cabinets: (cabinets || []).filter(cabinet => text(cabinet.store) === name),
      params: { ...params, p95Factor: store.p95Factor ?? params.p95Factor, p95Source: store.p95Source || params.p95Source || `store-config:${name}` },
      storeRecord: store,
      previousPlan,
      physicalRecords: (physicalRecords || []).filter(record => text(record.store) === name)
    }, optimization);
    results.push({
      store: name,
      status: plan.status,
      sourcePlanSignature: previousPlan ? planSignature(previousPlan) : "",
      planSignature: planSignature(plan),
      p95Factor: plan.params.p95Factor,
      p95Source: plan.params.p95Source,
      metrics: clone(plan.summary),
      validation: clone(plan.validation),
      evidence: clone(plan.evidence),
      plan: clone(plan)
    });
  }
  return {
    key: REPLAN_DRAFT_KEY,
    version: 2,
    generatedAt: text(generatedAt),
    productPoolRevision: revision,
    cabinetSignature: cabinetSignature(cabinets),
    scope: selectedStores.map(store => text(store.store)),
    results,
    summary: {
      storeCount: results.length,
      passed: results.filter(result => result.status === "passed").length,
      reviewRequired: results.filter(result => result.status === "review_required").length,
      failed: results.filter(result => result.status === "failed").length,
      blocked: results.filter(result => result.status === "blocked").length
    }
  };
}

export function previousPlanFromStoreState(state, storeName) {
  const productPool = Array.isArray(state?.productPool) ? state.productPool : [];
  const storeRows = (state?.skus || []).filter(row => text(row.store) === text(storeName));
  const byKey = new Map(storeRows.map(row => [canonicalProductKey(row), row]));
  const rows = productPool.map(product => {
    const key = canonicalProductKey(product);
    const source = byKey.get(key);
    const placements = Array.isArray(source?.placements) && source.placements.length
      ? clone(source.placements)
      : source?.cabinetKey
        ? [{ cabinetKey: source.cabinetKey, cabinetType: source.cabinetType || "", orientation: source.orientation || "", displayCols: number(source.displayCols || 1), perCol: number(source.perCol || 1), faceWidth: number(source.faceWidth || 0), capacitySource: "current-export-json" }]
        : [];
    return { ...clone(product), skuKey: key, included: source?.included !== false && placements.length > 0, reasonCode: source?.reasonCode || "", placements };
  });
  return {
    version: "previous-plan-snapshot-v1",
    store: text(storeName),
    rows,
    cabinets: (state?.cabinets || []).filter(cabinet => text(cabinet.store) === text(storeName)).map(cabinet => ({
      key: cabinet.key,
      cabinetType: cabinet.cabinetType || cabinet.kind || cabinet.type || "",
      kind: cabinet.kind || cabinet.type || "",
      label: cabinet.label || "",
      position: cabinet.position || "",
      length: number(cabinet.length),
      depth: number(cabinet.depth),
      height: number(cabinet.height),
      physicalSource: cabinet.physicalSource || "current-export-json",
      usedWidth: number(cabinet.usedWidth || cabinet.used || 0),
      leftWidth: number((cabinet.leftWidth ?? cabinet.left ?? cabinet.length) || 0)
    })),
    summary: {},
    validation: {}
  };
}

export function isReplanDraftStale(draft, { productPool = [], cabinets = [], currentPlanSignatures = {} } = {}) {
  if (!draft) return { stale: true, reasons: ["重排草稿不存在"] };
  const reasons = [];
  if (draft.productPoolRevision !== productPoolRevision(productPool)) reasons.push("产品池版本已变化");
  if (draft.cabinetSignature !== cabinetSignature(cabinets)) reasons.push("柜体配置或物理尺寸已变化");
  for (const result of draft.results || []) {
    const current = currentPlanSignatures[result.store] || "";
    if (current && result.sourcePlanSignature && current !== result.sourcePlanSignature) reasons.push(`${result.store}正式草稿已变化`);
  }
  return { stale: reasons.length > 0, reasons };
}

function rowKey(row) {
  return text(row?.skuKey) || text(row?.barcode) || text(row?.name);
}

function primaryPlacement(row) {
  return Array.isArray(row?.placements) && row.placements.length ? row.placements[0] : null;
}

export function applyReplanDraftToOperationalState(state, draft, stores = [], selectedStoreNames = null) {
  const next = clone(state || {});
  const activeKeys = new Set(activeProductPool(next.productPool || []).map(canonicalProductKey));
  const byStore = new Map((next.skus || []).map(row => [`${text(row.store)}|${canonicalProductKey(row)}`, row]));
  const appliedStores = [];
  const selected = Array.isArray(selectedStoreNames) ? new Set(selectedStoreNames.map(text)) : null;
  for (const result of draft?.results || []) {
    const store = text(result.store);
    if (selected && !selected.has(store)) continue;
    const planRows = result.plan?.rows || [];
    for (const planRow of planRows) {
      const key = rowKey(planRow);
      if (!key || !activeKeys.has(key)) continue;
      const mapKey = `${store}|${key}`;
      const existing = byStore.get(mapKey) || {
        id: `replan_${hashString(mapKey)}`,
        store,
        name: planRow.name,
        barcode: planRow.barcode || key
      };
      const primary = primaryPlacement(planRow);
      Object.assign(existing, {
        store,
        name: planRow.name,
        barcode: planRow.barcode || existing.barcode || key,
        grade: planRow.grade,
        rank: planRow.rank,
        category2: planRow.category2,
        category3: planRow.category3,
        category4: planRow.category4,
        length: planRow.length,
        width: planRow.width,
        height: planRow.height,
        volume: planRow.volume,
        carton: planRow.carton,
        dailyQty: planRow.dailyQty,
        dailySales: planRow.dailySales,
        included: Boolean(planRow.included),
        status: planRow.included ? "产品池重排-纳入" : "产品池重排-本店未纳入",
        reasonCode: planRow.included ? "" : planRow.reasonCode,
        reason: planRow.included ? "" : planRow.reason,
        cabinetKey: primary?.cabinetKey || "",
        cabinetLabel: primary?.cabinetLabel || "",
        position: primary?.position || "",
        cabinetType: primary?.cabinetType || "",
        orientation: primary?.orientation || "",
        displayCols: number(planRow.displayCols),
        perCol: number(planRow.perCol),
        faceWidth: number(planRow.faceWidth),
        placements: clone(planRow.placements || []),
        rowFull: number(planRow.fullCount),
        skuFull: number(planRow.fullCount),
        externalCountOverride: number(planRow.externalQty),
        staticExternalOverride: number(planRow.staticExternalL),
        avgExternalOverride: number(planRow.metrics?.avgExternalL),
        customPlacement: true,
        sourceAdvice: "产品池重排草稿",
        sourceAction: planRow.included ? "严格引擎重排纳入" : "严格引擎重排未纳入"
      });
      if (!byStore.has(mapKey)) {
        next.skus.push(existing);
        byStore.set(mapKey, existing);
      }
    }
    appliedStores.push(store);
  }
  next.frozen_carton_replan_draft_v2 = clone(draft);
  next.frozen_carton_replan_draft_v2.appliedStores = appliedStores;
  next.frozen_carton_replan_draft_v2.appliedAt = text(draft.appliedAt || "");
  return next;
}

export function draftSignaturesByStore(draft) {
  return Object.fromEntries((draft?.results || []).map(result => [text(result.store), text(result.planSignature)]));
}
