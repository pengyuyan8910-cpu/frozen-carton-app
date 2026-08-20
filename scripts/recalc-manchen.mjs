/**
 * 满陈重算脚本 — 仅重算 perCol（四舍五入），保留原有陈列面方向和占宽。
 * 若原有方向不可行，自动尝试另一方向。
 *
 * 规则：
 *  卧柜/冰淇淋柜（可堆叠）：
 *    长做陈列面: perCol = Math.round(柜深/产品宽) × Math.round(柜高/产品高)
 *    宽做陈列面: perCol = Math.round(柜深/产品长) × Math.round(柜高/产品高)
 *
 *  立柜（不可堆叠，产品高沿纵深）：
 *    perCol = Math.round(柜深/产品高) × 1
 *
 *  所有除法使用 Math.round（四舍五入），产品尺寸已含余量。
 */

import fs from "node:fs";
import path from "node:path";

const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const text = v => String(v ?? "").trim();
const round = (v, d = 4) => Number(num(v).toFixed(d));

const dataPath = path.resolve("data/app-data.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8").replace(/^\uFEFF/, ""));

const cabMap = new Map((data.cabinets || []).map(c => [c.key, c]));
let changed = 0, unchanged = 0, skipped = 0;

for (const sku of data.skus || []) {
  const cab = cabMap.get(sku.cabinetKey);
  if (!cab) { skipped++; continue; }

  const L = num(sku.length), W = num(sku.width), H = num(sku.height);
  const D = num(cab.depth), CH = num(cab.height);
  if (!(L > 0 && W > 0 && H > 0 && D > 0 && CH > 0)) { skipped++; continue; }

  const upright = /立柜/.test(text(cab.kind) + text(cab.type) + text(cab.label));
  const EPS = 0.001;

  // 推断原有陈列面方向
  const inferredOri = text(sku.faceOrientation) === "width" ? "width"
    : text(sku.faceOrientation) === "length" ? "length"
    : (Math.abs(num(sku.faceWidth) - W) < Math.abs(num(sku.faceWidth) - L) ? "width" : "length");

  // 尝试两个方向：优先原有，不可行则换另一方向
  const tryOrientations = inferredOri === "length" ? ["length", "width"] : ["width", "length"];
  let best = null;
  for (const ori of tryOrientations) {
    let depthDim, hDim, faceDim;
    if (upright) {
      depthDim = H;
      hDim = ori === "length" ? W : L;
      faceDim = ori === "length" ? L : W;
    } else {
      hDim = H;
      depthDim = ori === "length" ? W : L;
      faceDim = ori === "length" ? L : W;
    }
    if (depthDim > D + EPS || hDim > CH + (upright ? 50 : 0) + EPS) continue;
    const depthCount = Math.round(D / depthDim);
    const stackCount = upright ? 1 : Math.round(CH / hDim);
    const perCol = depthCount * stackCount;
    if (!(perCol > 0)) continue;
    best = { ori, faceDim, perCol };
    break;
  }
  if (!best) { skipped++; continue; }

  if (best.perCol !== num(sku.perCol) || best.faceDim !== num(sku.faceWidth) || best.ori !== text(sku.faceOrientation)) changed++;
  else unchanged++;

  sku.faceOrientation = best.ori;
  sku.faceWidth = best.faceDim;
  sku.perCol = best.perCol;
  sku.rowFull = Math.max(0, Math.round(num(sku.displayCols) * best.perCol));

  delete sku.externalCountOverride;
  delete sku.staticExternalOverride;
  delete sku.avgExternalOverride;
  delete sku.externalDaysOverride;
  delete sku.riskOverride;

  const cols = Math.max(0, num(sku.displayCols));
  sku.sourceCapacityNote = `占宽=${Math.round(cols * best.faceDim)}mm；单列容量=${best.perCol}（四舍五入）`;

  if (Array.isArray(sku.placements)) {
    sku.placements = sku.placements.map(p => ({
      ...p, faceWidth: best.faceDim, width: best.faceDim, perCol: best.perCol,
      fullCount: Math.max(0, Math.round(num(p.displayCols) * best.perCol)),
      widthUsed: Math.round(num(p.displayCols) * best.faceDim)
    }));
  }
}

// 重算同 SKU 合计满陈
const skuGroupKey = r => text(r?.barcode) || text(r?.name);
for (const store of data.stores || []) {
  const storeSkus = (data.skus || []).filter(r => r.store === store.store && r.included !== false);
  const groups = new Map();
  for (const r of storeSkus) {
    const key = skuGroupKey(r);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [, rows] of groups) {
    const total = rows.reduce((sum, r) => sum + (num(r.rowFull) || Math.max(0, Math.round(num(r.displayCols) * num(r.perCol)))), 0);
    for (const r of rows) r.skuFull = total;
  }
}

// 重算柜段 sourceUsed / sourceLeft
for (const cab of data.cabinets || []) {
  let used = 0;
  for (const sku of data.skus || []) {
    if (sku.cabinetKey !== cab.key || sku.included === false) continue;
    used += Math.max(0, num(sku.displayCols) * num(sku.faceWidth));
  }
  cab.sourceUsed = Math.round(used);
  cab.sourceLeft = Math.round(num(cab.length) - used);
}

// 重算门店汇总
function calcSkuForSummary(r, params) {
  const full = num(r.skuFull) || num(r.rowFull) || Math.round(num(r.displayCols) * num(r.perCol));
  const trigger = Math.ceil(full * num(params?.triggerRate || 0.1));
  const receivable = Math.max(0, full - trigger);
  const inShelf = Math.min(num(r.carton), receivable);
  const external = r.externalOwner === false ? 0 : Math.max(0, num(r.carton) - inShelf);
  const vol = num(r.volume) || num(r.length) * num(r.width) * num(r.height) / 1e6;
  return { external, staticVol: external * vol, avgVol: external * vol / 2 };
}

const poolCount = (data.productPool || []).filter(p => p.active !== false).length;
for (const s of data.stores || []) {
  const rows = (data.skus || []).filter(r => r.store === s.store && r.included !== false);
  const bySku = new Map();
  let staticVol = 0, avgVol = 0;
  for (const r of rows) {
    const key = skuGroupKey(r);
    if (!key) continue;
    if (!bySku.has(key)) bySku.set(key, { external: false });
    const c = calcSkuForSummary(r, data.params);
    if (c.external > 0) bySku.get(key).external = true;
    staticVol += c.staticVol;
    avgVol += c.avgVol;
  }
  let directSku = 0, externalSku = 0;
  for (const v of bySku.values()) v.external ? externalSku++ : directSku++;
  const p95 = avgVol * num(s.p95Factor || data.params?.p95Factor || 1.241748);
  s.skuCount = bySku.size;
  s.directSku = directSku;
  s.externalSku = externalSku;
  s.staticExternalL = Math.round(staticVol * 10) / 10;
  s.dynamicAvgExternalL = Math.round(avgVol * 10) / 10;
  s.dynamicP95L = Math.round(p95 * 10) / 10;
  s.suggestedExternalL = Math.ceil(p95 * num(data.params?.externalSafetyFactor || 1.2));
  s.over754 = s.suggestedExternalL > num(data.params?.externalCapL || 754);
  s.missingSkuCount = Math.max(0, poolCount - bySku.size);
  s.excludedSku = s.missingSkuCount;
}

data.meta = data.meta || {};
data.meta.generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
data.meta.version = "10%触发-满陈四舍五入重算版";
data.meta.note = "满陈计算统一使用Math.round（四舍五入）；卧柜可堆叠，立柜不堆叠。";

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf8");

console.log(`\n=== 满陈重算完成 ===`);
console.log(`变更: ${changed} 条`);
console.log(`未变: ${unchanged} 条`);
console.log(`跳过: ${skipped} 条`);
console.log(`总计: ${changed + unchanged + skipped} 条`);

