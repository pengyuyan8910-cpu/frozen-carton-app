import fs from "node:fs";
import path from "node:path";

const text = v => String(v ?? "").trim();
const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const skuKey = r => text(r?.barcode || r?.name);
const isIceSku = r => /雪糕|冰品|冰淇淋|冰杯|大布丁|可爱多|巧乐兹|随变|脆筒|老冰棍|绿舌头|8次方/.test([r.category2, r.category3, r.category4, r.name].map(text).join(" "));
const isIceCabinet = c => /冰淇淋|雪糕|冰品/.test([c.kind, c.type, c.label].map(text).join(" "));
const cabinetKind = c => isIceCabinet(c) ? "冰淇淋柜" : /立柜/.test([c.kind, c.label].map(text).join(" ")) ? "立柜" : "卧柜";
const usedWidth = r => Math.max(0, num(r.displayCols) * num(r.faceWidth));
const uniqueCount = rows => {
  const s = new Set();
  for (const r of rows) {
    const k = skuKey(r);
    if (k) s.add(k);
  }
  return s.size;
};

function calcSku(r, data) {
  const full = num(r.skuFull) || num(r.rowFull) || Math.round(num(r.displayCols) * num(r.perCol));
  const trigger = Math.ceil(full * num(data.params?.triggerRate || 0.1));
  const receivable = Math.max(0, full - trigger);
  const inShelf = Math.min(num(r.carton), receivable);
  const computedExternal = Math.max(0, num(r.carton) - inShelf);
  const external = r.externalOwner === false ? 0 : r.externalCountOverride !== undefined ? num(r.externalCountOverride) : computedExternal;
  const staticVol = r.staticExternalOverride !== undefined ? num(r.staticExternalOverride) : external * num(r.volume);
  const avgVol = r.avgExternalOverride !== undefined ? num(r.avgExternalOverride) : staticVol / 2;
  return { full, trigger, receivable, inShelf, external, staticVol, avgVol };
}

export function verifyAppData(data) {
  const errors = [];
  const warnings = [];
  const metrics = {};
  if (!data || !Array.isArray(data.stores) || !data.stores.length) errors.push("缺少门店数据 stores");
  if (!Array.isArray(data.skus) || !data.skus.length) errors.push("缺少SKU明细 skus");
  if (!Array.isArray(data.cabinets) || !data.cabinets.length) errors.push("缺少柜段数据 cabinets");
  if (errors.length) return { passed: false, errors, warnings, metrics };

  const cabinetMap = new Map(data.cabinets.map(c => [c.key, c]));
  const included = data.skus.filter(r => r.included !== false);
  const missingCabinet = included.filter(r => !cabinetMap.has(r.cabinetKey));
  if (missingCabinet.length) errors.push(`SKU陈列柜段不存在 ${missingCabinet.length} 行`);

  const useMap = new Map(data.cabinets.map(c => [c.key, { cabinet: c, used: 0, rows: [] }]));
  for (const r of included) {
    const box = useMap.get(r.cabinetKey);
    if (!box) continue;
    box.used += usedWidth(r);
    box.rows.push(r);
  }

  const overCabinets = [];
  const largeUsedLeft = [];
  const reserveEmptySegments = [];
  for (const box of useMap.values()) {
    const c = box.cabinet;
    const left = num(c.length) - box.used;
    if (left < -0.001) overCabinets.push({ store: c.store, cabinet: c.label, position: c.position, length: num(c.length), used: box.used, over: -left });
    if (box.used > 0 && !isIceCabinet(c) && left > 300) largeUsedLeft.push({ store: c.store, cabinet: c.label, position: c.position, left });
    if (box.used === 0) reserveEmptySegments.push({ store: c.store, cabinet: c.label, position: c.position, length: num(c.length) });
  }
  if (overCabinets.length) {
    const details = overCabinets
      .slice(0, 10)
      .map(r => `${r.store}-${r.cabinet}-${r.position}（已用${r.used}mm/总${r.length}mm，超出${r.over}mm）`)
      .join("；");
    errors.push(`柜段超宽 ${overCabinets.length} 个：${details}`);
  }
  if (largeUsedLeft.length) {
    const details = largeUsedLeft
      .slice(0, 10)
      .map(r => `${r.store}-${r.cabinet}-${r.position}（剩余${r.left}mm）`)
      .join("；");
    errors.push(`已陈列柜段剩余宽度大于300mm ${largeUsedLeft.length} 个：${details}`);
  }

  const newStores = new Set((data.stores || []).filter(s => text(s.type).includes("新店")).map(s => s.store));
  const reservedRows = included.filter(r => {
    if (!newStores.has(r.store)) return false;
    const c = cabinetMap.get(r.cabinetKey) || {};
    return /柜4/.test(text(c.label || r.cabinetLabel)) && /第[1-4]层/.test(text(c.position || r.position));
  });
  if (reservedRows.length) errors.push(`新店柜4第1-4层被冻品占用 ${reservedRows.length} 行`);

  const splitMap = new Map();
  for (const r of included) {
    const c = cabinetMap.get(r.cabinetKey) || {};
    const key = `${r.store}__${skuKey(r)}__${cabinetKind(c)}`;
    if (!splitMap.has(key)) splitMap.set(key, new Set());
    splitMap.get(key).add(r.cabinetKey);
  }
  const splitBad = [...splitMap.entries()].filter(([, set]) => set.size > 1);
  if (splitBad.length) errors.push(`同一门店同一SKU同一柜型被拆分 ${splitBad.length} 个`);

  const iceWrong = included.filter(r => {
    const c = cabinetMap.get(r.cabinetKey) || {};
    return isIceCabinet(c) !== isIceSku(r);
  });
  if (iceWrong.length) errors.push(`雪糕冰品柜别不匹配 ${iceWrong.length} 行`);

  const storeReports = [];
  for (const s of data.stores) {
    const rows = included.filter(r => r.store === s.store);
    const bySku = new Map();
    for (const r of rows) {
      const k = skuKey(r);
      if (!k) continue;
      if (!bySku.has(k)) bySku.set(k, { external: false });
      if (calcSku(r, data).external > 0) bySku.get(k).external = true;
    }
    let directSku = 0;
    let externalSku = 0;
    for (const v of bySku.values()) v.external ? externalSku++ : directSku++;
    const avg = rows.reduce((sum, r) => sum + calcSku(r, data).avgVol, 0);
    const p95 = avg * num(s.p95Factor || data.params?.p95Factor || 1.241748);
    const suggested = Math.ceil(p95 * num(data.params?.externalSafetyFactor || 1.2));
    if (suggested > num(data.params?.externalCapL || 754)) errors.push(`${s.store} 建议外储 ${suggested}L 超过 ${data.params?.externalCapL || 754}L`);
    if (num(s.skuCount) && uniqueCount(rows) !== num(s.skuCount)) warnings.push(`${s.store} 纳入SKU数与汇总不一致：计算${uniqueCount(rows)}，汇总${s.skuCount}`);
    if (num(s.directSku) && directSku !== num(s.directSku)) warnings.push(`${s.store} 直接整箱SKU数与汇总不一致：计算${directSku}，汇总${s.directSku}`);
    if (num(s.externalSku) && externalSku !== num(s.externalSku)) warnings.push(`${s.store} 需外储SKU数与汇总不一致：计算${externalSku}，汇总${s.externalSku}`);
    storeReports.push({ store: s.store, includedSku: uniqueCount(rows), directSku, externalSku, dynamicAvgL: Number(avg.toFixed(1)), dynamicP95L: Number(p95.toFixed(1)), suggestedExternalL: suggested });
  }

  metrics.storeCount = data.stores.length;
  metrics.skuRows = data.skus.length;
  metrics.includedRows = included.length;
  metrics.uniqueSkuPool = uniqueCount(data.skus);
  metrics.cabinetRows = data.cabinets.length;
  metrics.excludedRows = Array.isArray(data.excluded) ? data.excluded.length : 0;
  metrics.productPool = Array.isArray(data.productPool) ? data.productPool.length : 0;
  metrics.overCabinetCount = overCabinets.length;
  metrics.largeUsedLeftCount = largeUsedLeft.length;
  metrics.reserveEmptySegmentCount = reserveEmptySegments.length;
  metrics.newStoreReservedRows = reservedRows.length;
  metrics.sameTypeSplitCount = splitBad.length;
  metrics.iceWrongCount = iceWrong.length;
  metrics.maxSuggestedExternalL = Math.max(0, ...storeReports.map(r => r.suggestedExternalL));

  return {
    passed: errors.length === 0,
    generatedAt: new Date().toISOString(),
    source: data.meta?.source || "",
    version: data.meta?.version || "",
    errors,
    warnings,
    metrics,
    details: {
      overCabinets: overCabinets.slice(0, 100),
      largeUsedLeft: largeUsedLeft.slice(0, 100),
      reserveEmptySegments: reserveEmptySegments.slice(0, 100),
      sameTypeSplit: splitBad.slice(0, 100).map(([key, set]) => ({ key, positions: [...set] })),
      storeReports
    }
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const file = process.argv[2] || path.resolve("data/app-data.json");
  const out = process.argv[3] || path.resolve("data/verify-report.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const report = verifyAppData(data);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report.metrics, null, 2));
  if (!report.passed) {
    console.error(report.errors.join("\n"));
    process.exit(1);
  }
}
