import { asNumber, round } from "./common.mjs";

export function calculateSkuInventoryMetrics({
  perCol,
  displayCols,
  cartonQty,
  triggerRate,
  unitVolumeL,
  dailyQty,
  faceWidth
}) {
  const columns = Math.max(0, Math.floor(asNumber(displayCols)));
  const capacityPerColumn = Math.max(0, Math.floor(asNumber(perCol)));
  const fullDisplay = columns * capacityPerColumn;
  const triggerInventory = Math.ceil(fullDisplay * asNumber(triggerRate));
  const triggerAvailable = Math.max(0, fullDisplay - triggerInventory);
  const carton = Math.max(0, Math.floor(asNumber(cartonQty)));
  const externalUnits = Math.max(0, carton - triggerAvailable);
  const staticExternalL = externalUnits * asNumber(unitVolumeL);
  const avgExternalL = staticExternalL / 2;
  const turnoverDays = asNumber(dailyQty) > 0 ? externalUnits / asNumber(dailyQty) : 0;
  return Object.freeze({
    fullDisplay,
    triggerInventory,
    triggerAvailable,
    directCase: externalUnits === 0,
    externalUnits,
    staticExternalL: round(staticExternalL),
    avgExternalL: round(avgExternalL),
    turnoverDays: round(turnoverDays),
    usedWidth: round(columns * asNumber(faceWidth)),
    perCol: capacityPerColumn,
    faceWidth: asNumber(faceWidth),
    displayCols: columns
  });
}

export function summarizeStoreInventoryMetrics(metricsList = [], params = {}) {
  const external = metricsList.filter(metrics => metrics && metrics.externalUnits > 0);
  const staticExternalL = external.reduce((sum, metrics) => sum + asNumber(metrics.staticExternalL), 0);
  const avgExternalL = external.reduce((sum, metrics) => sum + asNumber(metrics.avgExternalL), 0);
  const p95ExternalL = avgExternalL * asNumber(params.p95Factor ?? 1);
  const suggestedExternalL = Math.ceil(p95ExternalL * asNumber(params.externalSafetyFactor ?? 1));
  return Object.freeze({
    directCaseSkuCount: metricsList.filter(metrics => metrics?.directCase).length,
    externalSkuCount: external.length,
    externalUnits: external.reduce((sum, metrics) => sum + asNumber(metrics.externalUnits), 0),
    staticExternalL: round(staticExternalL),
    avgExternalL: round(avgExternalL),
    p95ExternalL: round(p95ExternalL),
    suggestedExternalL
  });
}
