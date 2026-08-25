function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value) {
  return String(value ?? "").trim();
}

function scopedNewStoreSkuId(row, index, multiple) {
  const store = text(row?.store) || "新增门店";
  const base = text(row?.id) || `row_${index + 1}`;
  return `newstore_${store}__${base}${multiple ? `::module::${index + 1}` : ""}`;
}

function updateSkuReferences(row, oldId, newId) {
  for (const field of ["sourceRowId", "placementCloneOf", "skuId", "rowId"]) {
    if (row?.[field] === oldId) row[field] = newId;
  }
  for (const placement of Array.isArray(row?.placements) ? row.placements : []) {
    for (const field of ["sourceRowId", "placementCloneOf", "skuId", "rowId"]) {
      if (placement?.[field] === oldId) placement[field] = newId;
    }
  }
}

/**
 * Repairs duplicate row IDs already present in a saved current-page state.
 * It changes identity only; all store/product/planogram fields are retained.
 */
export function repairDuplicateSkuIds(state, baselineState = {}) {
  const next = typeof structuredClone === "function"
    ? structuredClone(state || {})
    : JSON.parse(JSON.stringify(state || {}));
  const rows = Array.isArray(next.skus) ? next.skus : [];
  const counts = new Map();
  for (const row of rows) {
    const id = text(row?.id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const baselineRows = Array.isArray(baselineState?.skus) ? baselineState.skus : [];
  const baselineById = new Map(baselineRows.filter(row => text(row?.id)).map(row => [text(row.id), row]));
  const used = new Set(rows.filter(row => (counts.get(text(row?.id)) || 0) === 1).map(row => text(row.id)).filter(Boolean));
  const preserved = new Set();

  for (const row of rows) {
    const oldId = text(row?.id);
    if (!oldId || (counts.get(oldId) || 0) <= 1) continue;
    const baseline = baselineById.get(oldId);
    const isBaselineRow = baseline && text(row?.store) === text(baseline?.store) && !preserved.has(oldId);
    const isFirstNewRow = !baseline && !preserved.has(oldId);
    if (isBaselineRow || isFirstNewRow) {
      preserved.add(oldId);
      used.add(oldId);
      continue;
    }
    const store = text(row?.store) || "新增门店";
    let nextId = `newstore_${store}__${oldId}`;
    let suffix = 2;
    while (used.has(nextId)) nextId = `newstore_${store}__${oldId}__${suffix++}`;
    row.id = nextId;
    updateSkuReferences(row, oldId, nextId);
    used.add(nextId);
  }
  return next;
}

function placementRow(row, placement, index, multiple) {
  const next = { ...row, ...(placement || {}) };
  const sourceId = scopedNewStoreSkuId(row, 0, false);
  next.sourceRowId = sourceId;
  next.id = multiple ? `${sourceId}::module::${index + 1}` : sourceId;
  next.placements = placement ? [{ ...placement }] : [];
  next.cabinetKey = placement?.cabinetKey || row.cabinetKey || "";
  next.cabinetLabel = placement?.cabinetLabel || row.cabinetLabel || "";
  next.position = placement?.position || placement?.section || row.position || "";
  if (placement?.displayCols !== undefined) next.displayCols = number(placement.displayCols);
  if (placement?.faceWidth !== undefined) next.faceWidth = number(placement.faceWidth);
  if (placement?.perCol !== undefined) next.perCol = number(placement.perCol);
  if (placement?.fullCount !== undefined) next.rowFull = number(placement.fullCount);
  return next;
}

export function normalizeNewStorePlanogramRows(rows) {
  const output = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const placements = Array.isArray(row?.placements)
      ? row.placements.filter(placement => placement?.cabinetKey)
      : [];
    if (placements.length <= 1) {
      output.push(placementRow(row, placements[0], 0, false));
      continue;
    }
    placements.forEach((placement, index) => output.push(placementRow(row, placement, index, true)));
  }
  return output;
}

function projectionFor(row, placement, index, multiple) {
  const projection = { ...row, ...(placement || {}) };
  projection.sourceRowId = row.id;
  projection.id = multiple ? `${row.id}::placement::${index}` : row.id;
  projection.placements = [];
  projection.cabinetKey = placement?.cabinetKey || row.cabinetKey || "";
  projection.cabinetLabel = placement?.cabinetLabel || row.cabinetLabel || "";
  projection.position = placement?.position || placement?.section || row.position || "";
  if (placement?.displayCols !== undefined) projection.displayCols = number(placement.displayCols);
  if (placement?.faceWidth !== undefined) projection.faceWidth = number(placement.faceWidth);
  if (placement?.perCol !== undefined) projection.perCol = number(placement.perCol);
  if (placement?.fullCount !== undefined) projection.rowFull = number(placement.fullCount);
  return projection;
}

/**
 * Converts saved multi-placement rows into the individual modules used by the
 * planogram view. It is a view projection only; source rows are never mutated.
 */
export function buildPlanogramRows(rows, store) {
  const output = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (store && row.store !== store) continue;
    if (row.included === false || row.inStaging) continue;
    const placements = Array.isArray(row.placements)
      ? row.placements.filter(placement => placement?.cabinetKey)
      : [];
    if (!placements.length) {
      if (row.cabinetKey) output.push(projectionFor(row, null, 0, false));
      continue;
    }
    placements.forEach((placement, index) => output.push(projectionFor(row, placement, index, placements.length > 1)));
  }
  return output;
}

function rowWidth(row) {
  const direct = number(row?.displayCols) * number(row?.faceWidth);
  return Math.max(0, direct);
}

export function buildCabinetUsage(cabinets, rows) {
  const usage = new Map((Array.isArray(cabinets) ? cabinets : []).map(cabinet => [cabinet.key, {
    ...cabinet,
    used: 0,
    items: []
  }]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const cabinet = usage.get(row.cabinetKey);
    if (!cabinet) continue;
    const used = rowWidth(row);
    cabinet.used += used;
    cabinet.items.push({
      id: row.sourceRowId || row.id,
      projectionId: row.id,
      name: row.name,
      used,
      cols: number(row.displayCols)
    });
  }
  for (const cabinet of usage.values()) {
    cabinet.used = Number(Math.max(0, cabinet.used).toFixed(1));
    cabinet.left = Number((number(cabinet.length) - cabinet.used).toFixed(1));
    cabinet.over = cabinet.left < -0.5;
  }
  return usage;
}

export default { buildPlanogramRows, buildCabinetUsage, normalizeNewStorePlanogramRows, repairDuplicateSkuIds };
