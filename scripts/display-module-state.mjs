function text(value) {
  return String(value ?? "").trim();
}

function defaultKey(row) {
  return text(row?.barcode) || text(row?.name) || text(row?.productKey) || text(row?.productName);
}

function productKey(row, keyOf) {
  return text((keyOf || defaultKey)(row));
}

export function sameStoreSkuModules(state, row, { keyOf } = {}) {
  if (!state || !row) return [];
  const key = productKey(row, keyOf);
  if (!key) return [];
  return (state.skus || []).filter((candidate) => (
    candidate.store === row.store &&
    candidate.included !== false &&
    productKey(candidate, keyOf) === key
  ));
}

export function clonePlanogramModule(state, { sourceId, target, layout, idFactory, keyOf } = {}) {
  const source = (state?.skus || []).find((row) => row.id === sourceId);
  if (!source || source.included === false || source.inStaging) {
    return { ok: false, reason: "只能从当前已陈列模块创建新模块" };
  }
  if (!target?.key || !layout?.faceWidth || !layout?.perCol) {
    return { ok: false, reason: "目标柜段或目标陈列参数无效" };
  }
  const modules = sameStoreSkuModules(state, source, { keyOf });
  if (modules.some((row) => row.cabinetKey === target.key)) {
    return { ok: false, reason: "该SKU在目标柜段已有陈列模块" };
  }
  const clone = structuredClone(source);
  clone.id = idFactory ? idFactory(source, target) : `sku_module_${Date.now()}`;
  clone.included = true;
  clone.inStaging = false;
  delete clone.stagingCabinetType;
  delete clone.stagingIce;
  delete clone.stagingFrom;
  clone.cabinetKey = target.key;
  clone.cabinetLabel = target.label || "";
  clone.position = target.position || "";
  clone.displayCols = Math.max(1, Number(source.displayCols) || 1);
  clone.faceOrientation = layout.faceOrientation;
  clone.faceWidth = Number(layout.faceWidth);
  clone.perCol = Number(layout.perCol);
  clone.rowFull = Math.max(0, Math.round(clone.displayCols * clone.perCol));
  clone.skuFull = undefined;
  clone.placements = [];
  clone.customPlacement = true;
  clone.placementCloneOf = source.id;
  clone.placementCloneType = target.kind || target.type || "";
  clone.modifiedFields = [...new Set([...(source.modifiedFields || []), "分身陈列"])];
  clone.changeNote = "同商品跨柜型分身";
  clone.sourceAdvice = "分身陈列";
  clone.sourceAction = "跨柜型分身";
  clone.note = `由 ${source.name || source.barcode || source.id} 生成的跨柜型陈列实例`;

  const next = structuredClone(state);
  next.skus = [...(next.skus || []), clone];
  return { ok: true, state: next, row: clone };
}

export function deletePlanogramModule(state, { id, keyOf } = {}) {
  const row = (state?.skus || []).find((candidate) => candidate.id === id);
  if (!row) return { ok: false, reason: "未找到要删除的陈列模块" };
  const modules = sameStoreSkuModules(state, row, { keyOf });
  if (modules.length <= 1) return { ok: false, reason: "不能删除唯一陈列模块" };
  const next = structuredClone(state);
  next.skus = (next.skus || []).filter((candidate) => candidate.id !== id);
  return { ok: true, state: next, row };
}
