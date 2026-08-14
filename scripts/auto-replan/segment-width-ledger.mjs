import { EPSILON, asNumber, round } from "./common.mjs";

export const INSUFFICIENT_SEGMENT_WIDTH_MESSAGE = "该柜段剩余宽度不足，不能继续陈列。";

export function createSegmentState(cabinet) {
  return {
    ...cabinet,
    usedWidth: 0,
    remainingWidth: asNumber(cabinet.length),
    placements: []
  };
}

export function canFitPlacement(segment, requiredWidth) {
  const width = asNumber(requiredWidth);
  return width >= 0 && width <= asNumber(segment?.remainingWidth) + EPSILON;
}

function normalizedPlacement(row) {
  const usedWidth = round(asNumber(row.faceWidth) * Math.max(0, Math.floor(asNumber(row.displayCols))));
  return {
    skuKey: row.skuKey,
    name: row.name,
    cabinetType: row.cabinetType,
    cabinetNo: row.cabinetNo,
    position: row.position,
    segmentKey: row.segmentKey,
    faceWidth: asNumber(row.faceWidth),
    displayCols: Math.max(0, Math.floor(asNumber(row.displayCols))),
    usedWidth
  };
}

export function acceptPlacement(segment, row) {
  const placement = normalizedPlacement(row);
  if (!segment || placement.segmentKey !== segment.key) throw new Error("目标柜段与商品陈列记录不一致。");
  if (!(placement.displayCols > 0 && placement.faceWidth > 0)) throw new Error("商品陈列列数或单列宽度无效。");
  if (!canFitPlacement(segment, placement.usedWidth)) throw new Error(INSUFFICIENT_SEGMENT_WIDTH_MESSAGE);
  if (segment.placements.some(item => item.skuKey === placement.skuKey)) throw new Error("同一商品不能在同一柜段重复生成基础陈列记录。");
  const nextUsedWidth = round(asNumber(segment.usedWidth) + placement.usedWidth);
  const nextRemainingWidth = round(asNumber(segment.length) - nextUsedWidth);
  segment.placements.push(placement);
  segment.usedWidth = nextUsedWidth;
  segment.remainingWidth = nextRemainingWidth;
  row.usedWidth = placement.usedWidth;
  return placement;
}

export function releasePlacement(segment, row) {
  if (!segment || row.segmentKey !== segment.key) throw new Error("释放商品与原柜段不一致。");
  const placementIndex = segment.placements.findIndex(item => item.skuKey === row.skuKey);
  if (placementIndex < 0) throw new Error("原柜段中找不到需要释放的商品记录。");
  const placement = segment.placements[placementIndex];
  const expectedUsedWidth = round(asNumber(placement.faceWidth) * Math.floor(asNumber(placement.displayCols)));
  if (Math.abs(expectedUsedWidth - asNumber(placement.usedWidth)) > EPSILON
    || Math.abs(expectedUsedWidth - asNumber(row.usedWidth)) > EPSILON) {
    throw new Error("释放前商品陈列列数与柜段占宽不一致。");
  }
  segment.placements.splice(placementIndex, 1);
  segment.usedWidth = round(asNumber(segment.usedWidth) - expectedUsedWidth);
  segment.remainingWidth = round(asNumber(segment.length) - asNumber(segment.usedWidth));
  if (segment.usedWidth < -EPSILON || segment.remainingWidth > asNumber(segment.length) + EPSILON) {
    throw new Error("释放商品后柜段宽度账不合法。");
  }
  return placement;
}

export function expandPlacementOneColumn(segment, row, nextMetrics) {
  if (!segment || row.segmentKey !== segment.key) throw new Error("扩陈商品与目标柜段不一致。");
  const placement = segment.placements.find(item => item.skuKey === row.skuKey);
  if (!placement) throw new Error("柜段中找不到需要扩陈的商品记录。");
  const additionalWidth = asNumber(row.faceWidth);
  if (!canFitPlacement(segment, additionalWidth)) return { accepted: false, reason: INSUFFICIENT_SEGMENT_WIDTH_MESSAGE };
  const nextDisplayCols = row.displayCols + 1;
  const nextPlacementUsedWidth = round(additionalWidth * nextDisplayCols);
  if (Math.abs(asNumber(nextMetrics?.usedWidth) - nextPlacementUsedWidth) > EPSILON) {
    throw new Error("扩陈后的库存宽度与柜段宽度账不一致。");
  }
  const nextSegmentUsedWidth = round(asNumber(segment.usedWidth) + additionalWidth);
  const nextRemainingWidth = round(asNumber(segment.length) - nextSegmentUsedWidth);
  placement.displayCols = nextDisplayCols;
  placement.usedWidth = nextPlacementUsedWidth;
  row.displayCols = nextDisplayCols;
  row.metrics = nextMetrics;
  row.usedWidth = nextPlacementUsedWidth;
  segment.usedWidth = nextSegmentUsedWidth;
  segment.remainingWidth = nextRemainingWidth;
  return { accepted: true };
}

export function validateSegmentWidthLedgers(segmentStates) {
  const segments = [...segmentStates.values()].map(segment => {
    const placementErrors = [];
    for (const placement of segment.placements) {
      const expected = round(asNumber(placement.faceWidth) * Math.floor(asNumber(placement.displayCols)));
      if (Math.abs(expected - asNumber(placement.usedWidth)) > EPSILON) {
        placementErrors.push(`商品“${placement.name || placement.skuKey}”的陈列列数与占用宽度不一致`);
      }
      if (!placement.segmentKey || placement.segmentKey !== segment.key) {
        placementErrors.push(`商品“${placement.name || placement.skuKey}”缺少唯一正确的柜段标识`);
      }
    }
    const calculatedUsedWidth = round(segment.placements.reduce(
      (sum, placement) => sum + asNumber(placement.faceWidth) * Math.floor(asNumber(placement.displayCols)),
      0
    ));
    const calculatedRemainingWidth = round(asNumber(segment.length) - calculatedUsedWidth);
    const usedWidthMismatch = Math.abs(calculatedUsedWidth - asNumber(segment.usedWidth)) > EPSILON;
    const remainingWidthMismatch = Math.abs(calculatedRemainingWidth - asNumber(segment.remainingWidth)) > EPSILON;
    const overWidth = calculatedUsedWidth > asNumber(segment.length) + EPSILON || calculatedRemainingWidth < -EPSILON;
    const errors = [...placementErrors];
    if (usedWidthMismatch || remainingWidthMismatch) errors.push("柜段宽度账不一致");
    if (overWidth) errors.push("柜段超宽");
    return {
      segmentKey: segment.key,
      store: segment.store,
      cabinetType: segment.kind || segment.type,
      cabinetNo: segment.label,
      position: segment.position,
      length: asNumber(segment.length),
      usedWidth: asNumber(segment.usedWidth),
      remainingWidth: asNumber(segment.remainingWidth),
      calculatedUsedWidth,
      calculatedRemainingWidth,
      skuCount: segment.placements.length,
      overWidth,
      usedWidthMismatch,
      remainingWidthMismatch,
      placementErrorCount: placementErrors.length,
      exceededWidth: round(Math.max(0, calculatedUsedWidth - asNumber(segment.length))),
      errors
    };
  });
  return {
    ok: segments.every(segment => !segment.errors.length),
    overWidthCount: segments.filter(segment => segment.overWidth).length,
    ledgerMismatchCount: segments.filter(segment => segment.usedWidthMismatch || segment.remainingWidthMismatch || segment.placementErrorCount > 0).length,
    segments
  };
}
