function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

export default { buildPlanogramRows, buildCabinetUsage };
