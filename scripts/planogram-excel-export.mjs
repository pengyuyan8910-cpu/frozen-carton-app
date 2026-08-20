function text(value) {
  return String(value ?? "");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validXmlText(value) {
  return text(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sheetName(value, index) {
  const name = text(value).replace(/[\\/:*?\[\]]/g, "").slice(0, 31).trim();
  return name || `Sheet${index + 1}`;
}

function normalizedRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = [];
  const seen = new Set();
  for (const row of list) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return { list, keys };
}

function numericCell(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function excelCell(value, styleId = "") {
  const style = styleId ? ` ss:StyleID="${styleId}"` : "";
  const type = numericCell(value) ? "Number" : "String";
  const cellValue = numericCell(value) ? String(value) : validXmlText(value);
  return `<Cell${style}><Data ss:Type="${type}">${cellValue}</Data></Cell>`;
}

export function buildPlanogramExportData({
  store,
  rows,
  productKey,
  cabinetInfo,
  calculate,
  productVolume,
  displayDirection,
} = {}) {
  const activeRows = (Array.isArray(rows) ? rows : []).filter((row) => (
    row &&
    (!store || row.store === store) &&
    row.included !== false &&
    !row.inStaging
  ));
  const groups = new Map();
  const keyOf = typeof productKey === "function" ? productKey : (row) => row.barcode || row.name || row.id;
  for (const row of activeRows) {
    const key = text(keyOf(row)) || text(row.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const calculateRow = typeof calculate === "function" ? calculate : (row) => ({
    full: Math.floor(number(row.displayCols) * number(row.perCol)),
    rowFull: Math.floor(number(row.displayCols) * number(row.perCol)),
    skuFull: Math.floor(number(row.displayCols) * number(row.perCol)),
    trigger: 0,
    receivable: 0,
    external: 0,
    staticVol: 0,
    risk: "",
  });
  const infoOf = typeof cabinetInfo === "function" ? cabinetInfo : (row) => ({
    kind: row.cabinetType || "",
    label: row.cabinetLabel || "",
    position: row.position || "",
  });
  const volumeOf = typeof productVolume === "function" ? productVolume : () => 0;
  const directionOf = typeof displayDirection === "function" ? displayDirection : () => "";
  const summaryRows = [];
  const moduleRows = [];

  for (const group of groups.values()) {
    const first = group[0];
    const rowFull = group.reduce((sum, row) => sum + number(row.rowFull || calculateRow(row).rowFull), 0);
    const calculated = calculateRow({ ...first, rowFull, skuFull: rowFull });
    const locations = group.map((row) => {
      const info = infoOf(row) || {};
      return [info.label || row.cabinetLabel, info.position || row.position].filter(Boolean).join(" / ");
    }).filter(Boolean);
    const uniqueLocations = [...new Set(locations)];
    const volume = number(calculated.vol || volumeOf(first));
    const summary = {
      "门店": store || first.store || "",
      "产品条码": first.barcode || "",
      "产品名称": first.name || "",
      "等级": first.grade || "",
      "三级类目": first.category3 || "",
      "箱规": number(first.carton),
      "日销": number(first.dailyQty),
      "陈列模块数": group.length,
      "陈列位置": uniqueLocations.join("；"),
      "陈列总列数": group.reduce((sum, row) => sum + number(row.displayCols), 0),
      "满陈数量": number(calculated.skuFull || calculated.full || rowFull),
      "触发数量": number(calculated.trigger),
      "触发后可入柜数量": number(calculated.receivable),
      "外储数量": number(calculated.external),
      "外储容积L": number(calculated.staticVol),
      "单品体积L": volume,
      "外储风险": calculated.risk || "",
    };
    summaryRows.push(summary);

    group.forEach((row, index) => {
      const info = infoOf(row) || {};
      const moduleCalculated = calculateRow(row);
      moduleRows.push({
        "门店": store || row.store || "",
        "产品条码": row.barcode || first.barcode || "",
        "产品名称": row.name || first.name || "",
        "模块序号": index + 1,
        "模块总数": group.length,
        "柜型": info.kind || "",
        "陈列柜": info.label || row.cabinetLabel || "",
        "具体位置": info.position || row.position || "",
        "陈列面方向": directionOf(row),
        "陈列列数": number(row.displayCols),
        "单列容量": number(row.perCol),
        "单列占宽mm": number(row.faceWidth),
        "模块满陈数量": number(moduleCalculated.rowFull || moduleCalculated.full),
        "SKU合计满陈数量": number(calculated.skuFull || calculated.full || rowFull),
        "触发数量": number(calculated.trigger),
        "外储数量": number(calculated.external),
        "外储容积L": number(calculated.staticVol),
        "箱规": number(row.carton || first.carton),
        "单品长mm": number(row.length || first.length),
        "单品宽mm": number(row.width || first.width),
        "单品高mm": number(row.height || first.height),
      });
    });
  }

  return { summaryRows, moduleRows };
}

export function toExcelXmlWorkbook(sheets = []) {
  const worksheets = (Array.isArray(sheets) ? sheets : []).map((sheet, index) => {
    const { list, keys } = normalizedRows(sheet?.rows);
    const header = `<Row>${keys.map((key) => excelCell(key, "Header")).join("")}</Row>`;
    const data = list.map((row) => `<Row>${keys.map((key) => excelCell(row?.[key])).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${validXmlText(sheetName(sheet?.name, index))}"><Table>${header}${data}</Table></Worksheet>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">` +
    `<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#EAF2F8" ss:Pattern="Solid"/></Style></Styles>${worksheets}</Workbook>`;
}
