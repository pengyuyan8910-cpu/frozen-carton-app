import fs from "node:fs";
import path from "node:path";

const text = value => String(value ?? "").trim();
const num = value => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value, digits = 4) => Number(num(value).toFixed(digits));
const skuKey = row => text(row?.barcode || row?.name);

function externalMetrics(row, data) {
  const full = num(row.skuFull) || num(row.rowFull) || Math.round(num(row.displayCols) * num(row.perCol));
  const trigger = Math.ceil(full * num(data.params?.triggerRate || 0.1));
  const receivable = Math.max(0, full - trigger);
  const inShelf = Math.min(num(row.carton), receivable);
  const external = row.externalOwner === false ? 0 : row.externalCountOverride !== undefined
    ? num(row.externalCountOverride)
    : Math.max(0, num(row.carton) - inShelf);
  const staticL = row.staticExternalOverride !== undefined ? num(row.staticExternalOverride) : external * num(row.volume);
  const avgL = row.avgExternalOverride !== undefined ? num(row.avgExternalOverride) : staticL / 2;
  return { full, trigger, receivable, inShelf, external, staticL, avgL };
}

function sheet(xlsx, rows, name, widths = []) {
  const ws = xlsx.utils.json_to_sheet(rows);
  if (rows.length) ws['!autofilter'] = { ref: xlsx.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: Math.max(0, Object.keys(rows[0]).length - 1), r: rows.length } }) };
  if (widths.length) ws['!cols'] = widths.map(w => ({ wch: w }));
  return { name, ws };
}

export async function writeAppDataWorkbook(data, outputPath) {
  const module = await import("xlsx");
  const xlsx = module.default || module;
  const workbook = xlsx.utils.book_new();
  const pool = (data.productPool || []).filter(row => row.active !== false);
  const stores = (data.stores || []).map(store => ({
    '门店': store.store,
    '触发口径': '小于等于10%触发',
    '门店类型': store.type,
    '有效SKU池': pool.length,
    '纳入唯一SKU数': store.skuCount,
    '未纳入SKU数': store.missingSkuCount,
    '直接整箱到店SKU数': store.directSku,
    '需外储SKU数': store.externalSku,
    '静态外储满载L': store.staticExternalL,
    '动态平均占用L': store.dynamicAvgExternalL,
    '动态P95高峰L': store.dynamicP95L,
    '建议外储L含20%': store.suggestedExternalL,
    '是否超754L': store.over754 ? '超754L' : '未超754L',
    '立柜资源': store.vertical,
    '卧柜资源': store.chest,
    '冰淇淋柜资源': store.ice,
    '说明': store.sourceNote
  }));

  const skus = (data.skus || []).map(row => {
    const calc = externalMetrics(row, data);
    return {
      '门店': row.store, '商品名称': row.name, '条码': row.barcode, '等级': row.grade, '综合排名': row.rank,
      '二级类目': row.category2, '三级类目': row.category3, '四级类目': row.category4, '场景分区': row.sceneGroup,
      '四级品类集中组': row.familyGroup, '冰柜类型': row.cabinetTypeFilter, '陈列柜': row.cabinetLabel,
      '具体位置': row.position, '陈列角色': row.placementRole, '陈列列数': row.displayCols,
      '单列容量': row.perCol, '单列占宽mm': row.faceWidth, '最大限值满陈数': calc.full,
      '陈列行满陈': row.rowFull || calc.full, '同SKU合计满陈': row.skuFull || calc.full,
      '箱规': row.carton, '单品长毫米': row.length, '单品宽毫米': row.width, '单品高毫米': row.height,
      '单品体积L': row.volume, '标准化单店日销件': row.dailyQty, '标准化单店日销额': row.dailySales,
      '起订量': row.moq, '起订量周转': row.moqDays, '触发库存': calc.trigger,
      '到货后可入柜件数': calc.inShelf, '需外储件数': calc.external,
      '静态外储L': round(calc.staticL, 4), '动态平均外储L': round(calc.avgL, 4),
      '外储周转天数': row.externalDaysOverride, '外储周转风险': row.riskOverride,
      '是否计入外储汇总': row.externalOwner === false ? '否' : '是'
    };
  });

  const usedByCabinet = new Map();
  for (const row of data.skus || []) {
    if (row.included === false || !row.cabinetKey) continue;
    usedByCabinet.set(row.cabinetKey, (usedByCabinet.get(row.cabinetKey) || 0) + num(row.displayCols) * num(row.faceWidth));
  }
  const cabinets = (data.cabinets || []).map(cabinet => {
    const used = round(usedByCabinet.get(cabinet.key) || 0, 1);
    return {
      '门店': cabinet.store, '原冰柜类型': cabinet.kind, '冰柜类型': cabinet.kind,
      '陈列柜': cabinet.label, '具体位置': cabinet.position, '场景分区': cabinet.sceneGroup,
      '四级类目集中组': cabinet.categoryMix, '总宽度mm': cabinet.length,
      '已用宽度mm': used, '剩余宽度mm': round(num(cabinet.length) - used, 1),
      '深度mm': cabinet.depth, '高度mm': cabinet.height, '占用品明细': cabinet.itemSummary, '状态': cabinet.status
    };
  });
  const excluded = (data.excluded || []).map(row => ({
    '门店': row.store, '触发口径': row.trigger || '小于等于10%触发', '执行状态': row.status || '暂不纳入',
    '暂不纳入原因': row.reason, '等级': row.grade, '综合排名': row.rank, '二级类目': row.category2,
    '三级类目': row.category3, '四级类目': row.category4, '商品名称': row.name, '条码': row.barcode
  }));
  const products = (data.productPool || []).map(row => ({
    '商品名称': row.name, '条码': row.barcode, '等级': row.grade, '综合排名': row.rank,
    '二级类目': row.category2, '三级类目': row.category3, '四级类目': row.category4,
    '单品长毫米': row.length, '单品宽毫米': row.width, '单品高毫米': row.height, '单品体积L': row.volume,
    '箱规': row.carton, '标准化单店日销件': row.dailyQty, '标准化单店日销额': row.dailySales,
    '起订量': row.moq, '起订量周转': row.moqDays, '有效可排柜': row.active === false ? '否' : '是'
  }));
  const external = (data.skus || []).filter(row => externalMetrics(row, data).external > 0).map(row => {
    const calc = externalMetrics(row, data);
    return { '门店': row.store, '商品名称': row.name, '条码': row.barcode, '等级': row.grade, '陈列柜': row.cabinetLabel,
      '具体位置': row.position, '箱规': row.carton, '需外储件数': calc.external, '单品体积L': row.volume,
      '静态外储L': round(calc.staticL, 4), '动态平均外储L': round(calc.avgL, 4), '外储周转天数': row.externalDaysOverride,
      '外储周转风险': row.riskOverride };
  });
  const ruleRows = (data.rules || []).length ? data.rules : [{ '规则': '10%触发', '说明': '库存小于等于最大限值满陈数的10%时触发整箱补货。' }];
  const entries = [
    sheet(xlsx, stores, '10%触发_门店汇总'), sheet(xlsx, skus, '10%触发_SKU明细'),
    sheet(xlsx, external, '10%触发_外储明细'), sheet(xlsx, cabinets, '10%触发_柜段余量'),
    sheet(xlsx, excluded, '10%触发_未排入SKU清单'), sheet(xlsx, products, '71SKU有效池明细'),
    sheet(xlsx, ruleRows, '测算规则说明')
  ];
  for (const entry of entries) xlsx.utils.book_append_sheet(workbook, entry.ws, entry.name);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  xlsx.writeFile(workbook, outputPath, { compression: true });
}

