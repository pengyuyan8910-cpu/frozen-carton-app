/**
 * 满陈重算脚本
 *
 * 规则：
 *  - 卧柜/冰淇淋柜（水平柜）：长做陈列面，可堆叠
 *    perCol = Math.round(柜深 / 产品宽) × Math.round(柜高 / 产品高)
 *    faceWidth = 产品长（首选）；若长度面不可行则回退到宽做陈列面
 *
 *  - 立柜（垂直柜）：不可堆叠，产品高沿纵深方向
 *    perCol = Math.round(柜深 / 产品高) × 1
 *    faceWidth = 首选能放入的面（两者 perCol 相同，取面宽较小的以放更多列）
 *
 *  四舍五入（Math.round）用于所有除法，因为产品尺寸已含余量。
 */

import fs from "node:fs";
import path from "node:path";

const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const text = v => String(v ?? "").trim();
const round = v => Math.round(num(v));

// ---- 柜型判断 ----
function isVertical(cabinet) {
  const t = text(cabinet?.kind) + " " + text(cabinet?.type) + " " + text(cabinet?.label);
  return /立柜/.test(t);
}

// ---- 满陈摆法计算（与 app.js 柜型摆法 + strict-allocation-engine orientationOptions 一致）----
function calcLayout(product, cabinet) {
  const L = num(product?.length), W = num(product?.width), H = num(product?.height);
  const D = num(cabinet?.depth), CH = num(cabinet?.height);
  if (!(L > 0 && W > 0 && H > 0 && D > 0 && CH > 0)) return null;

  const vertical = isVertical(cabinet);
  const EPS = 0.001;

  // 两种摆放方向
  const raw = vertical
    ? [
        { faceOrientation: "length", face: L, depth: H, h: W }, // 长做陈列面：高沿纵深，宽朝上
        { faceOrientation: "width",  face: W, depth: H, h: L }  // 宽做陈列面：高沿纵深，长朝上
      ]
    : [
        { faceOrientation: "length", face: L, depth: W, h: H }, // 长做陈列面：宽沿纵深，高朝上（堆叠）
        { faceOrientation: "width",  face: W, depth: L, h: H }  // 宽做陈列面：长沿纵深，高朝上（堆叠）
      ];

  // 过滤可行方向 + 计算单列容量（四舍五入）
  const feasible = raw
    .filter(o => o.face > 0 && o.depth > 0 && o.h > 0 && o.depth <= D + EPS && o.h <= CH + EPS)
    .map(o => ({
      ...o,
      depthCount: Math.round(D / o.depth),
      stackCount: vertical ? 1 : Math.round(CH / o.h),
      per: Math.round(D / o.depth) * (vertical ? 1 : Math.round(CH / o.h))
    }))
    .filter(o => o.per > 0);

  if (!feasible.length) return null;

  // 卧柜/冰淇淋柜：首选"长做陈列面"
  // 立柜：两者 perCol 相同，取面宽较小的（能放更多列）
  let best;
  if (!vertical) {
    best = feasible.find(o => o.faceOrientation === "length")
       || feasible.sort((a, b) => b.per - a.per || a.face - b.face)[0];
  } else {
    best = feasible.sort((a, b) => b.per - a.per || a.face - b.face)[0];
  }

  return {
    faceOrientation: best.faceOrientation,
    faceWidth: best.face,
    perCol: best.per,
    depthCount: best.depthCount,
    stackCount: best.stackCount
  };
}

// ---- 读取数据 ----
const dataPath = path.resolve("data/app-data.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8").replace(/^\uFEFF/, ""));

const cabMap = new Map((data.cabinets || []).map(c => [c.key, c]));
let changed = 0, unchanged = 0, skipped = 0;

// ---- 重算每个 SKU ----
for (const sku of data.skus || []) {
  const cab = cabMap.get(sku.cabinetKey);
  if (!cab) { skipped++; continue; }

  const layout = calcLayout(sku, cab);
  if (!layout) { skipped++; continue; }

  const oldPer = num(sku.perCol);
  const oldFace = num(sku.faceWidth);
  const oldOri = text(sku.faceOrientation);

  if (layout.perCol !== oldPer || layout.faceWidth !== oldFace || layout.faceOrientation !== oldOri) {
    changed++;
  } else {
    unchanged++;
  }

  sku.faceOrientation = layout.faceOrientation;
  sku.faceWidth = layout.faceWidth;
  sku.perCol = layout.perCol;

  // 重算行满陈
  sku.rowFull = Math.max(0, Math.round(num(sku.displayCols) * layout.perCol));

  // 清除外储覆写，让运行时自动重算
  delete sku.externalCountOverride;
  delete sku.staticExternalOverride;
  delete sku.avgExternalOverride;
  delete sku.externalDaysOverride;
  delete sku.riskOverride;

  // 更新 sourceCapacityNote
  const cols = Math.max(0, num(sku.displayCols));
  sku.sourceCapacityNote = `占宽=${Math.round(cols * layout.faceWidth)}mm；单列容量=${layout.perCol}（四舍五入）`;

  // 更新 placements
  if (Array.isArray(sku.placements)) {
    sku.placements = sku.placements.map(p => ({
      ...p,
      faceWidth: layout.faceWidth,
      width: layout.faceWidth,
      perCol: layout.perCol,
      depthCount: layout.depthCount,
      stackCount: layout.stackCount,
      fullCount: Math.max(0, Math.round(num(p.displayCols) * layout.perCol)),
      widthUsed: Math.round(num(p.displayCols) * layout.faceWidth)
    }));
  }
}

// ---- 重算同 SKU 合计满陈（skuFull）----
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

// ---- 重算柜段 sourceUsed / sourceLeft ----
for (const cab of data.cabinets || []) {
  let used = 0;
  for (const sku of data.skus || []) {
    if (sku.cabinetKey !== cab.key || sku.included === false) continue;
    used += Math.max(0, num(sku.displayCols) * num(sku.faceWidth));
  }
  cab.sourceUsed = Math.round(used);
  cab.sourceLeft = Math.round(num(cab.length) - used);
}

// ---- 重算门店汇总 ----
function calcSkuForSummary(r, params) {
  const full = num(r.skuFull) || num(r.rowFull) || Math.round(num(r.displayCols) * num(r.perCol));
  const trigger = Math.ceil(full * num(params?.triggerRate || 0.1));
  const receivable = Math.max(0, full - trigger);
  const inShelf = Math.min(num(r.carton), receivable);
  const external = r.externalOwner === false ? 0 : Math.max(0, num(r.carton) - inShelf);
  const vol = num(r.volume) || num(r.length) * num(r.width) * num(r.height) / 1e6;
  const staticVol = external * vol;
  const avgVol = staticVol / 2;
  return { external, staticVol, avgVol };
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

// ---- 更新 meta ----
data.meta = data.meta || {};
data.meta.generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
data.meta.version = "10%触发-满陈四舍五入重算版";
data.meta.note = "满陈计算统一使用Math.round（四舍五入）；卧柜长做陈列面+堆叠，立柜不堆叠。";

// ---- 写回 ----
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf8");

console.log(`\n=== 满陈重算完成 ===`);
console.log(`变更: ${changed} 条`);
console.log(`未变: ${unchanged} 条`);
console.log(`跳过: ${skipped} 条（无柜段或尺寸缺失）`);
console.log(`总计: ${changed + unchanged + skipped} 条`);
console.log(`门店数: ${(data.stores || []).length}`);
console.log(`柜段数: ${(data.cabinets || []).length}`);
