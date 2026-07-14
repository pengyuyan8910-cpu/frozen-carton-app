import fs from "node:fs";
import path from "node:path";

const text = v => String(v ?? "").trim();
const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round = (v, d = 4) => Number(num(v).toFixed(d));
const first = (row, names, fallback = "") => {
  for (const n of names) {
    if (row && row[n] !== undefined && row[n] !== null && text(row[n]) !== "") return row[n];
  }
  return fallback;
};
const skuKey = r => text(r?.barcode || r?.["条码"] || r?.name || r?.["商品名称"]);
const cabinetKey = (store, label, pos) => `${text(store)}__${text(label)}__${text(pos)}`;

function sheetRows(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return workbook.utils.sheet_to_json(sheet, { defval: "" });
}

async function readWorkbook(filePath) {
  const xlsx = await import("xlsx");
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  workbook.utils = xlsx.utils;
  const sheets = {};
  for (const name of workbook.SheetNames) sheets[name] = sheetRows(workbook, name);
  return { sheets };
}

function normalizeExistingJson(raw, sourceName) {
  const data = raw?.data || raw;
  if (!data || !Array.isArray(data.stores) || !Array.isArray(data.skus) || !Array.isArray(data.cabinets)) {
    throw new Error("JSON 数据不是小程序数据结构，缺少 stores/skus/cabinets");
  }
  return reconcileStoreSummaries({
    ...data,
    meta: {
      ...(data.meta || {}),
      source: sourceName,
      generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      version: data.meta?.version || "10%触发-当前版"
    },
    productPool: Array.isArray(data.productPool) && data.productPool.length
      ? data.productPool
      : buildProductPoolFromSkus(data.skus)
  });
}

function calcSkuForSummary(r, data) {
  const full = num(r.skuFull) || num(r.rowFull) || Math.round(num(r.displayCols) * num(r.perCol));
  const trigger = Math.ceil(full * num(data.params?.triggerRate || 0.1));
  const receivable = Math.max(0, full - trigger);
  const inShelf = Math.min(num(r.carton), receivable);
  const computedExternal = Math.max(0, num(r.carton) - inShelf);
  const external = r.externalOwner === false ? 0 : r.externalCountOverride !== undefined ? num(r.externalCountOverride) : computedExternal;
  const staticVol = r.staticExternalOverride !== undefined ? num(r.staticExternalOverride) : external * num(r.volume);
  const avgVol = r.avgExternalOverride !== undefined ? num(r.avgExternalOverride) : staticVol / 2;
  return { external, staticVol, avgVol };
}

function reconcileStoreSummaries(data) {
  const poolCount = buildProductPoolFromSkus(data.skus).length || (data.productPool || []).filter(p => p.active !== false).length;
  for (const s of data.stores || []) {
    const rows = (data.skus || []).filter(r => r.store === s.store && r.included !== false);
    const bySku = new Map();
    let staticVol = 0;
    let avgVol = 0;
    for (const r of rows) {
      const k = skuKey(r);
      if (!k) continue;
      if (!bySku.has(k)) bySku.set(k, { external: false });
      const c = calcSkuForSummary(r, data);
      if (c.external > 0) bySku.get(k).external = true;
      staticVol += c.staticVol;
      avgVol += c.avgVol;
    }
    let directSku = 0;
    let externalSku = 0;
    for (const v of bySku.values()) v.external ? externalSku++ : directSku++;
    const p95 = avgVol * num(s.p95Factor || data.params?.p95Factor || 1.241748);
    s.skuCount = bySku.size;
    s.directSku = directSku;
    s.externalSku = externalSku;
    s.staticExternalL = round(staticVol, 1);
    s.dynamicAvgExternalL = round(avgVol, 1);
    s.dynamicP95L = round(p95, 1);
    s.suggestedExternalL = Math.ceil(p95 * num(data.params?.externalSafetyFactor || 1.2));
    s.over754 = s.suggestedExternalL > num(data.params?.externalCapL || 754);
    s.missingSkuCount = Math.max(0, poolCount - bySku.size);
    s.excludedSku = s.missingSkuCount;
  }
  return data;
}
function buildProductPoolFromSkus(skus) {
  const map = new Map();
  for (const r of skus || []) {
    const key = skuKey(r);
    if (!key || map.has(key)) continue;
    map.set(key, {
      id: `pool_${map.size + 1}`,
      active: true,
      name: r.name,
      barcode: r.barcode,
      grade: r.grade,
      rank: r.rank,
      category2: r.category2,
      category3: r.category3,
      category4: r.category4,
      length: r.length,
      width: r.width,
      height: r.height,
      volume: r.volume,
      carton: r.carton,
      dailyQty: r.dailyQty,
      dailySales: r.dailySales,
      moq: r.moq,
      moqDays: r.moqDays
    });
  }
  return [...map.values()];
}

export async function sourceToAppData(sourcePath, oldData = {}) {
  const sourceName = path.basename(sourcePath);
  if (/\.json$/i.test(sourcePath)) {
    const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, ""));
    return normalizeExistingJson(raw, sourceName);
  }

  const raw = await readWorkbook(sourcePath);
  const sheets = raw.sheets || {};
  const productRows = sheets["71SKU有效池明细"] || sheets["74SKU标准化日销"] || [];
  const productMap = new Map();
  for (const r of productRows) {
    const key = text(first(r, ["条码", "商品条码", "barcode"])) || text(first(r, ["商品名称", "商品", "name"]));
    if (key) productMap.set(key, r);
  }
  const productInfo = row => productMap.get(text(first(row, ["条码", "商品条码"]))) || productMap.get(text(first(row, ["商品名称", "商品"]))) || {};

  const storeRows = sheets["10%触发_门店汇总"] || [];
  const stores = storeRows.map(r => {
    const avg = num(first(r, ["动态平均占用L", "动态平均占用体积L", "动态平均外储体积L"]));
    const p95 = num(first(r, ["动态P95高峰L", "动态P95高峰体积L"]));
    return {
      store: text(first(r, ["门店"])),
      type: text(first(r, ["门店类型"])),
      vertical: text(first(r, ["立柜资源"])),
      chest: text(first(r, ["卧柜资源"])),
      ice: text(first(r, ["冰淇淋柜资源"])),
      sourceNote: text(first(r, ["说明", "备注"])),
      p95Factor: avg > 0 && p95 > 0 ? p95 / avg : num(oldData?.params?.p95Factor) || 1.241748,
      skuCount: num(first(r, ["纳入唯一SKU数", "纳入SKU数"])),
      directSku: num(first(r, ["直接整箱到店SKU数", "可整箱的sku数", "可整箱SKU数"])),
      externalSku: num(first(r, ["需外储SKU数"])),
      staticExternalL: num(first(r, ["静态外储满载L", "静态外储满载体积L"])),
      dynamicAvgExternalL: avg,
      dynamicP95L: p95,
      suggestedExternalL: num(first(r, ["建议外储L含20%", "建议外储容量L含20", "建议外储"])),
      over754: text(first(r, ["是否超754L"])).includes("超") && !text(first(r, ["是否超754L"])).includes("未超"),
      missingSkuCount: num(first(r, ["未纳入SKU数"])),
      excludedSku: num(first(r, ["未纳入SKU数"]))
    };
  }).filter(r => r.store);

  const oldCabMap = new Map((oldData.cabinets || []).map(c => [c.key, c]));
  const cabinetRows = sheets["10%触发_柜段余量"] || [];
  const cabinets = cabinetRows.map((r, i) => {
    const label = text(first(r, ["陈列柜", "优化后陈列柜"]));
    const position = text(first(r, ["具体位置", "优化后具体位置"]));
    const key = cabinetKey(first(r, ["门店"]), label, position);
    const oldCab = oldCabMap.get(key) || {};
    const kind = text(first(r, ["冰柜类型", "原冰柜类型"], oldCab.kind));
    return {
      id: `cab_${i + 1}`,
      store: text(first(r, ["门店"])),
      key,
      label,
      position,
      rawNo: (label.match(/柜(\d+)/) || [, ""])[1],
      rawPosition: (position.match(/第(\d+)层|分区(\d+)/) || [, "", ""]).slice(1).filter(Boolean)[0] || position,
      kind,
      type: kind,
      length: num(first(r, ["总宽度mm", "总宽度毫米"])),
      depth: num(first(r, ["深度mm"], oldCab.depth)),
      height: num(first(r, ["高度mm"], oldCab.height)),
      sourceUsed: num(first(r, ["已用宽度mm", "已用宽度毫米"])),
      sourceLeft: num(first(r, ["剩余宽度mm", "剩余宽度毫米"])),
      sceneGroup: text(first(r, ["场景分区"])),
      categoryMix: text(first(r, ["三级类目集中组", "四级类目集中组"])),
      itemSummary: text(first(r, ["占用品明细"])),
      status: text(first(r, ["状态"]))
    };
  }).filter(r => r.store && r.key);
  const cabinetMap = new Map(cabinets.map(c => [c.key, c]));

  const skuRows = sheets["10%触发_SKU明细"] || [];
  const skus = skuRows.map((r, i) => {
    const p = productInfo(r);
    const label = text(first(r, ["优化后陈列柜", "陈列柜"]));
    const position = text(first(r, ["优化后具体位置", "具体位置"]));
    const key = cabinetKey(first(r, ["门店"]), label, position);
    const cab = cabinetMap.get(key) || {};
    const externalOwner = text(first(r, ["是否计入外储汇总"], "是")) !== "否";
    const external = externalOwner ? num(first(r, ["需外储件数", "需外储"])) : 0;
    const staticVol = externalOwner ? num(first(r, ["静态外储L", "静态外储体积L"])) : 0;
    const avgVol = externalOwner ? num(first(r, ["动态平均外储L", "动态平均外储体积L"])) : 0;
    const displayCols = Math.max(0, num(first(r, ["陈列列数", "列数"])));
    const perCol = num(first(r, ["单列容量"]));
    const faceWidth = num(first(r, ["单列占宽mm", "单列占宽毫米", "占宽mm"]));
    return {
      id: `sku_${i + 1}`,
      store: text(first(r, ["门店"])),
      included: true,
      status: external > 0 ? "纳入-动态外储承接" : "纳入-陈列位整箱",
      grade: text(first(r, ["等级"])),
      rank: num(first(r, ["综合排名"])) || 9999,
      category2: text(first(p, ["二级类目", "二级品类名称"])),
      category3: text(first(r, ["三级类目"])),
      category4: text(first(r, ["四级类目", "四级品类集中组"], first(p, ["四级类目", "四级品类名称"]))),
      sceneGroup: text(first(r, ["场景分区"])),
      familyGroup: text(first(r, ["四级品类集中组", "四级类目"])),
      name: text(first(r, ["商品名称", "商品"])),
      barcode: text(first(r, ["条码", "商品条码"])),
      length: num(first(r, ["单品长毫米"], first(p, ["单品长毫米", "长"]))),
      width: num(first(r, ["单品宽毫米"], first(p, ["单品宽毫米", "宽"]))),
      height: num(first(r, ["单品高毫米"], first(p, ["单品高毫米", "高"]))),
      volume: num(first(r, ["单品体积L"], first(p, ["单品体积L", "体积L"]))),
      carton: num(first(r, ["箱规"], first(p, ["箱规"]))),
      dailyQty: num(first(r, ["标准化单店日销件"], first(p, ["标准化单店日销件", "日销"]))),
      dailySales: num(first(r, ["标准化单店日销额"], first(p, ["标准化单店日销额", "日销额"]))),
      moq: num(first(r, ["起订量"], first(p, ["起订量"]))),
      moqDays: num(first(r, ["起订量周转"], first(p, ["起订量周转"]))),
      cabinetKey: key,
      cabinetLabel: label,
      position,
      displayCols,
      perCol,
      faceWidth,
      placements: [],
      customPlacement: false,
      currentStock: "",
      planCartons: 1,
      sourceCabinet: label,
      sourcePosition: position,
      sourceCapacityNote: `占宽=${round(displayCols * faceWidth, 0)}mm；单列容量=${perCol}`,
      sourceAdvice: external > 0 ? "整箱到店-需外储" : "整箱到店-陈列位可承接",
      sourceAction: `10%触发：库存≤${num(first(r, ["触发库存"]))}件时补1箱；可入柜${num(first(r, ["到货后可入柜件数", "可入柜"]))}件，进外储${external}件`,
      note: "",
      skuGroupId: `sku_${i + 1}`,
      placementRole: text(first(r, ["陈列角色"])),
      cabinetTypeFilter: text(first(r, ["冰柜类型"], cab.kind)),
      cabinetNoFilter: label,
      positionFilter: position,
      rowFull: num(first(r, ["陈列行满陈", "最大限值满陈数", "满陈"])),
      skuFull: num(first(r, ["同SKU合计满陈"], first(r, ["陈列行满陈", "最大限值满陈数", "满陈"]))),
      externalOwner,
      externalCountOverride: external,
      staticExternalOverride: staticVol,
      avgExternalOverride: avgVol,
      externalDaysOverride: num(first(r, ["外储周转天数"])),
      riskOverride: text(first(r, ["外储周转风险"]))
    };
  }).filter(r => r.store && r.name);

  const excludedRows = sheets["10%触发_未排入SKU清单"] || [];
  const excluded = excludedRows.map((r, i) => {
    const p = productInfo(r);
    return {
      id: `ex_${i + 1}`,
      store: text(first(r, ["门店"])),
      trigger: text(first(r, ["触发口径"])),
      status: text(first(r, ["执行状态"])),
      reason: text(first(r, ["暂不纳入原因"])),
      grade: text(first(r, ["等级"])),
      rank: num(first(r, ["综合排名"])) || 9999,
      category2: text(first(p, ["二级类目", "二级品类名称"])),
      category3: text(first(r, ["三级类目"])),
      category4: text(first(r, ["四级类目"], first(p, ["四级类目", "四级品类名称"]))),
      name: text(first(r, ["商品名称", "商品"])),
      barcode: text(first(r, ["条码", "商品条码"])),
      length: num(first(p, ["单品长毫米", "长"])),
      width: num(first(p, ["单品宽毫米", "宽"])),
      height: num(first(p, ["单品高毫米", "高"])),
      volume: num(first(p, ["单品体积L", "体积L"])),
      carton: num(first(p, ["箱规"])),
      dailyQty: num(first(p, ["标准化单店日销件", "日销"])),
      dailySales: num(first(p, ["标准化单店日销额", "日销额"])),
      moq: num(first(p, ["起订量"])),
      moqDays: num(first(p, ["起订量周转"]))
    };
  }).filter(r => r.store && r.name);

  const productPool = productRows.map((p, i) => ({
    id: `pool_${i + 1}`,
    active: text(first(p, ["有效可排柜"], "是")) !== "否",
    name: text(first(p, ["商品名称", "商品"])),
    barcode: text(first(p, ["条码", "商品条码"])),
    grade: text(first(p, ["等级"])),
    rank: num(first(p, ["综合排名"])) || 9999,
    category2: text(first(p, ["二级类目", "二级品类名称"])),
    category3: text(first(p, ["三级类目", "三级品类名称"])),
    category4: text(first(p, ["四级类目", "四级品类名称"])),
    length: num(first(p, ["单品长毫米", "长"])),
    width: num(first(p, ["单品宽毫米", "宽"])),
    height: num(first(p, ["单品高毫米", "高"])),
    volume: num(first(p, ["单品体积L", "体积L"])),
    carton: num(first(p, ["箱规"])),
    dailyQty: num(first(p, ["标准化单店日销件", "日销"])),
    dailySales: num(first(p, ["标准化单店日销额", "日销额"])),
    moq: num(first(p, ["起订量"])),
    moqDays: num(first(p, ["起订量周转"]))
  })).filter(p => p.name);

  // 汇总表的有效SKU池是业务口径，必须与有效SKU明细一致，不能静默覆盖。
  const actualPoolCount = productPool.filter(p => p.active !== false).length;
  const sourceErrors = storeRows
    .map(r => ({
      store: text(first(r, ["门店"])),
      declaredPoolCount: num(first(r, ["有效SKU池"]))
    }))
    .filter(r => r.store && r.declaredPoolCount > 0 && r.declaredPoolCount !== actualPoolCount)
    .map(r => `${r.store}：门店汇总“有效SKU池”为${r.declaredPoolCount}，但“71SKU有效池明细”实际为${actualPoolCount}个有效SKU。请补齐/删除明细后再上传。`);

  return reconcileStoreSummaries({
    meta: {
      source: sourceName,
      generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      version: "10%触发-当前版-自动同步",
      sourceErrors
    },
    params: {
      triggerRate: 0.1,
      externalCapL: 754,
      p95Factor: num(oldData?.params?.p95Factor) || 1.241748,
      externalSafetyFactor: 1.2
    },
    stores,
    skus,
    cabinets,
    excluded,
    productPool: productPool.length ? productPool : buildProductPoolFromSkus(skus),
    rules: sheets["测算规则说明"] || [],
    externalRows: sheets["10%触发_外储明细"] || []
  });
}
