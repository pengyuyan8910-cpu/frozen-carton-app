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

function orderValue(row) {
  const value = Number(row?.planogramOrder);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function orderedCabinetRows(rows) {
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => orderValue(a.row) - orderValue(b.row) || a.index - b.index)
    .map(({ row }) => row);
}

export function movePlanogramModule(state, { sourceId, targetId } = {}) {
  const source = (state?.skus || []).find((row) => row.id === sourceId);
  const target = (state?.skus || []).find((row) => row.id === targetId);
  if (!source || !target) return { ok: false, reason: "未找到要移动的陈列模块" };
  if (source.id === target.id) return { ok: false, reason: "不能移动到商品自身位置" };
  if (source.included === false || target.included === false || source.inStaging || target.inStaging) {
    return { ok: false, reason: "待选区商品不能执行同柜位置移动" };
  }
  if (!source.cabinetKey || source.store !== target.store || source.cabinetKey !== target.cabinetKey) {
    return { ok: false, reason: "只能移动同一门店同一柜段内的商品位置" };
  }

  const next = structuredClone(state);
  const rows = orderedCabinetRows((next.skus || []).filter((row) => (
    row.store === source.store &&
    row.included !== false &&
    !row.inStaging &&
    row.cabinetKey === source.cabinetKey
  )));
  const sourceRow = rows.find((row) => row.id === sourceId);
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  if (!sourceRow || targetIndex < 0) return { ok: false, reason: "未找到同柜排序位置" };

  const remaining = rows.filter((row) => row.id !== sourceId);
  const insertAt = remaining.findIndex((row) => row.id === targetId);
  remaining.splice(insertAt, 0, sourceRow);
  remaining.forEach((row, index) => { row.planogramOrder = index; });
  return { ok: true, state: next, row: sourceRow, target, order: remaining.map((row) => row.id) };
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
  clone.changeNote = "同商品多模块陈列";
  clone.sourceAdvice = "多模块陈列";
  clone.sourceAction = "新增陈列模块";
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
