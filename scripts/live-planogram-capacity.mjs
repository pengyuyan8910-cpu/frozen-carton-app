const EPSILON = 0.001;

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value) {
  return String(value ?? "").trim();
}

function isVertical(cabinet) {
  return /立柜|vertical/i.test([cabinet?.kind, cabinet?.type, cabinet?.label].map(text).join(" "));
}

function normalizeOrientation(value) {
  const raw = text(value);
  if (raw === "length" || raw === "length-face" || raw === "长" || raw === "长做陈列面") return "length";
  if (raw === "width" || raw === "width-face" || raw === "宽" || raw === "宽做陈列面") return "width";
  return "";
}

function inferOrientation(row) {
  const face = number(row?.faceWidth);
  const length = number(row?.length);
  const width = number(row?.width);
  if (!(face > 0 && length > 0 && width > 0)) return "";
  return Math.abs(face - length) <= Math.abs(face - width) ? "length" : "width";
}

function layoutFor(row, cabinet, preferred) {
  const length = number(row?.length);
  const width = number(row?.width);
  const height = number(row?.height);
  const cabinetWidth = number(cabinet?.depth);
  const cabinetHeight = number(cabinet?.height);
  const orientation = normalizeOrientation(preferred) || inferOrientation(row);
  if (!(length > 0 && width > 0 && height > 0 && cabinetWidth > 0 && cabinetHeight > 0 && orientation)) return null;

  const vertical = isVertical(cabinet);
  const faceWidth = orientation === "length" ? length : width;
  // The stored cabinet.depth field is the business cabinet width used for
  // longitudinal capacity. It is not the semantic cabinet depth.
  const orientedDepth = vertical ? height : orientation === "length" ? width : length;
  const orientedHeight = vertical ? orientation === "length" ? width : length : height;
  if (orientedDepth > cabinetWidth + EPSILON || orientedHeight > cabinetHeight + (vertical ? 50 : 0) + EPSILON) return null;

  const depthCount = Math.floor(cabinetWidth / orientedDepth);
  const stackCount = vertical ? 1 : Math.floor(cabinetHeight / orientedHeight);
  const perCol = depthCount * stackCount;
  if (!(faceWidth > 0 && perCol > 0)) return null;
  return {
    orientation,
    faceWidth,
    orientedDepth,
    orientedHeight,
    depthCount,
    stackCount,
    perCol
  };
}

function rowKey(row) {
  return text(row?.barcode) || text(row?.name) || text(row?.id);
}

function setPlacementCapacity(placement, row, cabinet, preferred, fallbackColumns) {
  const layout = layoutFor(row, cabinet, preferred);
  if (!layout) return null;
  const displayCols = Math.max(1, Math.floor(number(placement?.displayCols) || fallbackColumns || 1));
  Object.assign(placement, {
    orientation: `${layout.orientation}-face`,
    faceWidth: layout.faceWidth,
    orientedDepth: layout.orientedDepth,
    orientedHeight: layout.orientedHeight,
    depth: layout.orientedDepth,
    height: layout.orientedHeight,
    depthCount: layout.depthCount,
    stackCount: layout.stackCount,
    perCol: layout.perCol,
    displayCols,
    fullCount: displayCols * layout.perCol,
    widthUsed: displayCols * layout.faceWidth
  });
  return { ...layout, displayCols };
}

/**
 * Rehydrates the already loaded planogram with the current physical-capacity
 * rule while preserving store, cabinet, position, order and display columns.
 */
export function recalculateLoadedPlanogram(state) {
  if (!state || !Array.isArray(state.skus) || !Array.isArray(state.cabinets)) return state;
  const cabinetMap = new Map(state.cabinets.map(cabinet => [text(cabinet.key), cabinet]));

  for (const row of state.skus) {
    const placements = Array.isArray(row.placements) ? row.placements : [];
    const rowCabinet = cabinetMap.get(text(row.cabinetKey));
    // A manual move can update the row's cabinetKey while leaving the legacy
    // single placement pointing at the source cabinet. The row is authoritative
    // for a single module, so repair that link before calculating capacity.
    if (rowCabinet && placements.length === 1 && text(placements[0].cabinetKey) !== text(row.cabinetKey)) {
      Object.assign(placements[0], {
        cabinetKey: rowCabinet.key,
        cabinetLabel: rowCabinet.label,
        cabinetType: isVertical(rowCabinet) ? "vertical" : "chest",
        cabinetKind: rowCabinet.kind || rowCabinet.type || "",
        section: rowCabinet.position,
        zone: rowCabinet.position,
        position: rowCabinet.position,
        layer: rowCabinet.position
      });
    }
    let primary = null;
    if (placements.length) {
      for (let index = 0; index < placements.length; index += 1) {
        const placement = placements[index];
        const cabinet = cabinetMap.get(text(placement.cabinetKey)) || cabinetMap.get(text(row.cabinetKey));
        const preferred = normalizeOrientation(placement.orientation)
          || normalizeOrientation(row.faceOrientation)
          || inferOrientation(row);
        const layout = setPlacementCapacity(placement, row, cabinet, preferred, index === 0 ? row.displayCols : 1);
        if (!layout) continue;
        if (!primary || text(placement.cabinetKey) === text(row.cabinetKey) || index === 0) primary = { ...layout, cabinet };
      }
    } else {
      const cabinet = cabinetMap.get(text(row.cabinetKey));
      const preferred = normalizeOrientation(row.faceOrientation) || inferOrientation(row);
      const layout = layoutFor(row, cabinet, preferred);
      if (layout) primary = { ...layout, cabinet };
    }

    if (!primary) continue;
    row.faceOrientation = primary.orientation;
    row.faceWidth = primary.faceWidth;
    row.perCol = primary.perCol;
    row.rowFull = Math.max(0, Math.floor(number(row.displayCols)) * primary.perCol);
    delete row.externalCountOverride;
    delete row.staticExternalOverride;
    delete row.avgExternalOverride;
  }

  const groups = new Map();
  for (const row of state.skus) {
    if (row.included === false) continue;
    const key = `${text(row.store)}|${rowKey(row)}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const triggerRate = number(state.params?.triggerRate || 0.1);
  for (const rows of groups.values()) {
    const full = rows.reduce((sum, row) => sum + Math.max(0, Math.floor(number(row.rowFull) || number(row.displayCols) * number(row.perCol))), 0);
    const first = rows[0];
    const trigger = Math.ceil(full * triggerRate);
    const receivable = Math.max(0, full - trigger);
    const carton = Math.max(0, Math.floor(number(first.carton)));
    const external = Math.max(0, carton - Math.min(carton, receivable));
    let remaining = external;
    for (const row of rows) {
      row.skuFull = full;
      for (let index = 0; index < (row.placements || []).length; index += 1) {
        const placement = row.placements[index];
        const share = index === row.placements.length - 1
          ? remaining
          : Math.min(remaining, Math.floor(external * number(placement.fullCount) / Math.max(1, full)));
        placement.externalQty = share;
        placement.staticExternalL = share * number(row.volume);
        placement.avgExternalL = placement.staticExternalL / 2;
        remaining -= share;
      }
    }
  }

  return state;
}

export default { recalculateLoadedPlanogram };

