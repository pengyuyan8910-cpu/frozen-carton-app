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
  const full = num(row.skuFull) || num(row.rowFull) || Math.floor(num(row.displayCols) * num(row.perCol));
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

function sheet(xlsx, rows, name, widths = [], emptyHeaders = []) {
  const ws = rows.length ? xlsx.utils.json_to_sheet(rows) : xlsx.utils.aoa_to_sheet([emptyHeaders]);
  const widthCount = rows.length ? Object.keys(rows[0]).length : emptyHeaders.length;
  if (widthCount) ws['!autofilter'] = { ref: xlsx.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: widthCount - 1, r: Math.max(0, rows.length) } }) };
  if (widths.length) ws['!cols'] = widths.map(w => ({ wch: w }));
  return { name, ws };
}
function excelCol(index) {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function headers(ws, xlsx) {
  const range = xlsx.utils.decode_range(ws['!ref']);
  const result = new Map();
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cell = ws[xlsx.utils.encode_cell({ r: 0, c: col })];
    result.set(String(cell?.v || '').trim(), excelCol(col));
  }
  return { map: result, lastRow: range.e.r + 1 };
}

function formula(ws, cell, expression) {
  const old = ws[cell] || {};
  ws[cell] = { ...old, t: 'n', f: expression.replace(/^=/, ''), v: Number(old.v) || 0 };
}

function applyFormulaDrivenNewStore(workbook, xlsx) {
  const skuWs = workbook.Sheets['10%触发_SKU明细'];
  const cabinetWs = workbook.Sheets['10%触发_柜段余量'];
  const storeWs = workbook.Sheets['10%触发_门店汇总'];
  if (!skuWs || !cabinetWs || !storeWs) throw new Error('formula-driven workbook requires SKU, cabinet and store sheets');

  const sku = headers(skuWs, xlsx);
  const cab = headers(cabinetWs, xlsx);
  const store = headers(storeWs, xlsx);
  const params = "'可调整参数'!$B$";
  const c = name => sku.map.get(name);
  const s = name => store.map.get(name);
  const b = name => cab.map.get(name);
  const skuRange = name => `'10%触发_SKU明细'!$${c(name)}$2:$${c(name)}$${sku.lastRow}`;

  for (let row = 2; row <= sku.lastRow; row++) {
    const v = name => `$${c(name)}${row}`;
    formula(skuWs, `${c('占用总宽mm')}${row}`, `=IF(${v('纳入状态')}<>"纳入",0,${v('陈列列数')}*${v('单列占宽mm')})`);
    formula(skuWs, `${c('陈列行满陈')}${row}`, `=IF(${v('纳入状态')}<>"纳入",0,${v('陈列列数')}*${v('单列容量')})`);
    formula(skuWs, `${c('同SKU合计满陈')}${row}`, `=SUMIFS(${skuRange('陈列行满陈')},${skuRange('门店')},${v('门店')},${skuRange('条码')},${v('条码')})`);
    formula(skuWs, `${c('触发库存')}${row}`, `=IF(${v('纳入状态')}<>"纳入",0,ROUNDUP(${v('陈列行满陈')}*${params}2,0))`);
    formula(skuWs, `${c('触发时陈列可收货量')}${row}`, `=IF(${v('纳入状态')}<>"纳入",0,MAX(0,${v('陈列行满陈')}-${v('触发库存')}))`);
    formula(skuWs, `${c('到货后可入柜件数')}${row}`, `=IF(${v('纳入状态')}<>"纳入",0,MIN(${v('箱规')},${v('触发时陈列可收货量')}))`);
    formula(skuWs, `${c('需外储件数')}${row}`, `=IF(OR(${v('纳入状态')}<>"纳入",${v('是否计入外储汇总')}<>"是"),0,MAX(0,${v('箱规')}-${v('到货后可入柜件数')}))`);
    formula(skuWs, `${c('静态外储L')}${row}`, `=${v('需外储件数')}*${v('单品体积L')}`);
    formula(skuWs, `${c('动态平均外储L')}${row}`, `=${v('静态外储L')}/2`);
    formula(skuWs, `${c('在架库存周转天数')}${row}`, `=IFERROR(${v('陈列行满陈')}/${v('标准化单店日销件')},0)`);
    formula(skuWs, `${c('外储周转天数')}${row}`, `=IFERROR(${v('需外储件数')}/${v('标准化单店日销件')},0)`);
    const riskCell = `${c('外储周转风险')}${row}`;
    const old = skuWs[riskCell] || {};
    skuWs[riskCell] = { ...old, t: 'str', f: `IF(${v('需外储件数')}=0,"无外储",IF(${v('外储周转天数')}>60,"高风险",IF(${v('外储周转天数')}>30,"中风险","低风险")))`, v: old.v || '' };
  }

  for (let row = 2; row <= cab.lastRow; row++) {
    const v = name => `$${b(name)}${row}`;
    formula(cabinetWs, `${b('已用宽度mm')}${row}`, `=SUMIFS(${skuRange('占用总宽mm')},${skuRange('门店')},${v('门店')},${skuRange('优化后陈列柜')},${v('陈列柜')},${skuRange('优化后具体位置')},${v('具体位置')},${skuRange('纳入状态')},"纳入")`);
    formula(cabinetWs, `${b('剩余宽度mm')}${row}`, `=${v('总宽度mm')}-${v('已用宽度mm')}`);
  }

  const poolWs = workbook.Sheets['71SKU有效池明细'];
  const poolInfo = headers(poolWs, xlsx);
  const poolActive = `'71SKU有效池明细'!$${poolInfo.map.get('有效可排柜')}$2:$${poolInfo.map.get('有效可排柜')}$${poolInfo.lastRow}`;
  for (let row = 2; row <= store.lastRow; row++) {
    const v = name => `$${s(name)}${row}`;
    formula(storeWs, `${s('有效SKU池')}${row}`, `=COUNTIF(${poolActive},"是")`);
    formula(storeWs, `${s('纳入唯一SKU数')}${row}`, `=COUNTIFS(${skuRange('门店')},${v('门店')},${skuRange('纳入状态')},"纳入")`);
    formula(storeWs, `${s('未纳入SKU数')}${row}`, `=${v('有效SKU池')}-${v('纳入唯一SKU数')}`);
    formula(storeWs, `${s('直接整箱到店SKU数')}${row}`, `=COUNTIFS(${skuRange('门店')},${v('门店')},${skuRange('纳入状态')},"纳入",${skuRange('需外储件数')},0)`);
    formula(storeWs, `${s('需外储SKU数')}${row}`, `=COUNTIFS(${skuRange('门店')},${v('门店')},${skuRange('纳入状态')},"纳入",${skuRange('需外储件数')},">0")`);
    formula(storeWs, `${s('静态外储满载L')}${row}`, `=SUMIFS(${skuRange('静态外储L')},${skuRange('门店')},${v('门店')},${skuRange('纳入状态')},"纳入")`);
    formula(storeWs, `${s('动态平均占用L')}${row}`, `=SUMIFS(${skuRange('动态平均外储L')},${skuRange('门店')},${v('门店')},${skuRange('纳入状态')},"纳入")`);
    formula(storeWs, `${s('动态P95高峰L')}${row}`, `=${v('动态平均占用L')}*${v('动态P95系数')}`);
    formula(storeWs, `${s('建议外储L含20%')}${row}`, `=ROUNDUP(${v('动态P95高峰L')}*${params}3,0)`);
    const statusCell = `${s('是否超754L')}${row}`;
    const old = storeWs[statusCell] || {};
    storeWs[statusCell] = { ...old, t: 'str', f: `IF(${v('建议外储L含20%')}>${params}4,"超754L","未超754L")`, v: old.v || '' };
  }
}
export async function writeAppDataWorkbook(data, outputPath, options = {}) {
  const module = await import("xlsx");
  const xlsx = module.default || module;
  const workbook = xlsx.utils.book_new();
  const formulaDriven = Boolean(options.formulaDriven);
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
    '说明': store.sourceNote,
    ...(formulaDriven ? { '动态P95系数': store.p95Factor || data.params?.p95Factor || 1.241748 } : {})
  }));

  const skus = (data.skus || []).map(row => {
    const calc = externalMetrics(row, data);
    return {
      '门店': row.store, '商品名称': row.name, '条码': row.barcode, '等级': row.grade, '综合排名': row.rank,
      '二级类目': row.category2, '三级类目': row.category3, '场景分区': row.sceneGroup,
      '四级品类集中组': row.familyGroup || row.category4, '三级类目集中组': row.category3,
      '冰柜类型': row.cabinetTypeFilter, '优化后陈列柜': row.cabinetLabel,
      '优化后具体位置': row.position, '陈列角色': row.placementRole || '单陈列', '主/副陈列': row.placementRole || '主陈列', '纳入状态': row.included === false ? '暂不纳入' : '纳入',
      '箱规': row.carton, '陈列列数': row.displayCols, '单列占宽mm': row.faceWidth,
      '占用总宽mm': num(row.displayCols) * num(row.faceWidth), '单列容量': row.perCol,
      '陈列行满陈': row.rowFull || calc.full, '同SKU合计满陈': row.skuFull || calc.full,
      '触发库存': calc.trigger, '触发时陈列可收货量': calc.receivable,
      '到货后可入柜件数': calc.inShelf, '需外储件数': calc.external,
      '静态外储L': round(calc.staticL, 4), '动态平均外储L': round(calc.avgL, 4),
      '在架库存周转天数': num(row.dailyQty) ? round(calc.full / num(row.dailyQty), 2) : '',
      '外储周转天数': row.externalDaysOverride || (num(row.dailyQty) ? round(calc.external / num(row.dailyQty), 2) : ''),
      '外储周转风险': row.riskOverride, '标准化单店日销件': row.dailyQty, '标准化单店日销额': row.dailySales,
      '起订量': row.moq, '起订量周转': row.moqDays,
      '单品长毫米': row.length, '单品宽毫米': row.width, '单品高毫米': row.height, '单品体积L': row.volume,
      '是否计入外储汇总': row.externalOwner === false ? '否' : '是',
      '场景优化说明': row.sourceNote || '新增门店严格排柜初始方案'
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
    '二级类目': row.category2, '三级类目': row.category3, '场景分区': row.sceneGroup, '四级品类集中组': row.familyGroup || row.category4, '四级类目': row.category4,
    '单品长毫米': row.length, '单品宽毫米': row.width, '单品高毫米': row.height, '单品体积L': row.volume,
    '箱规': row.carton, '标准化单店日销件': row.dailyQty, '标准化单店日销额': row.dailySales,
    '起订量': row.moq, '起订量周转': row.moqDays, '有效可排柜': row.active === false ? '否' : '是'
  }));
  const external = (data.skus || []).filter(row => externalMetrics(row, data).external > 0).map(row => {
    const calc = externalMetrics(row, data);
    return {
      '门店': row.store, '商品名称': row.name, '条码': row.barcode, '等级': row.grade, '综合排名': row.rank,
      '三级类目': row.category3, '场景分区': row.sceneGroup, '四级品类集中组': row.familyGroup || row.category4,
      '冰柜类型': row.cabinetTypeFilter, '陈列柜': row.cabinetLabel, '具体位置': row.position,
      '主/副陈列': row.placementRole || '主陈列', '箱规': row.carton,
      '同SKU合计满陈': row.skuFull || calc.full, '触发库存': calc.trigger,
      '触发时陈列可收货量': calc.receivable, '到货后可入柜件数': calc.inShelf,
      '需外储件数': calc.external, '单品体积L': row.volume,
      '静态外储L': round(calc.staticL, 4), '动态平均外储L': round(calc.avgL, 4),
      '外储周转天数': row.externalDaysOverride || (num(row.dailyQty) ? round(calc.external / num(row.dailyQty), 2) : ''),
      '外储周转风险': row.riskOverride
    };
  });
  const externalHeaders = ['门店','商品名称','条码','等级','综合排名','三级类目','场景分区','四级品类集中组','冰柜类型','陈列柜','具体位置','主/副陈列','箱规','同SKU合计满陈','触发库存','触发时陈列可收货量','到货后可入柜件数','需外储件数','单品体积L','静态外储L','动态平均外储L','外储周转天数','外储周转风险'];
  const excludedHeaders = ['门店','触发口径','执行状态','暂不纳入原因','等级','综合排名','二级类目','三级类目','四级类目','商品名称','条码'];  const ruleRows = (data.rules || []).length ? data.rules : [{ '规则': '10%触发', '说明': '库存小于等于最大限值满陈数的10%时触发整箱补货。' }];
  const entries = [
    sheet(xlsx, stores, '10%触发_门店汇总'), sheet(xlsx, skus, '10%触发_SKU明细'),
    sheet(xlsx, external, '10%触发_外储明细', [], externalHeaders), sheet(xlsx, cabinets, '10%触发_柜段余量'),
    sheet(xlsx, excluded, '10%触发_未排入SKU清单', [], excludedHeaders), sheet(xlsx, products, '71SKU有效池明细'),
    sheet(xlsx, ruleRows, '测算规则说明')
  ];
  if (formulaDriven) entries.push(sheet(xlsx, [
    { '参数': '触发比例', '数值': num(data.params?.triggerRate || 0.1), '说明': '修改后会联动触发库存、可入柜、外储。' },
    { '参数': '外储安全系数', '数值': num(data.params?.externalSafetyFactor || 1.2), '说明': '建议外储柜容量 = 动态P95高峰L × 本系数。' },
    { '参数': '外储容量上限L', '数值': num(data.params?.externalCapL || 754), '说明': '超过本值时，门店汇总会提示。' }
  ], '可调整参数'));
  for (const entry of entries) xlsx.utils.book_append_sheet(workbook, entry.ws, entry.name);
  if (formulaDriven) applyFormulaDrivenNewStore(workbook, xlsx);
  workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: '1', forceFullCalc: '1' } };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  xlsx.writeFile(workbook, outputPath, { compression: true });
}









