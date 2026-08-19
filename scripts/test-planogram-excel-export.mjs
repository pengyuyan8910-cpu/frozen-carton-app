import assert from "node:assert/strict";
import { buildPlanogramExportData, toExcelXmlWorkbook } from "./planogram-excel-export.mjs";

const rows = [
  {
    id: "module-chest",
    store: "测试门店",
    included: true,
    barcode: "69000001",
    name: "双模块商品",
    grade: "A",
    category3: "冷冻食材",
    carton: 24,
    dailyQty: 1.2,
    length: 200,
    width: 100,
    height: 50,
    displayCols: 1,
    perCol: 10,
    faceWidth: 200,
    faceOrientation: "length",
    rowFull: 10,
    cabinetLabel: "卧柜2505-柜1",
    position: "分区1",
  },
  {
    id: "module-upright",
    store: "测试门店",
    included: true,
    barcode: "69000001",
    name: "双模块商品",
    grade: "A",
    category3: "冷冻食材",
    carton: 24,
    dailyQty: 1.2,
    length: 200,
    width: 100,
    height: 50,
    displayCols: 1,
    perCol: 10,
    faceWidth: 100,
    faceOrientation: "width",
    rowFull: 10,
    cabinetLabel: "立柜3m-柜1",
    position: "第3层",
  },
  {
    id: "module-other",
    store: "测试门店",
    included: true,
    barcode: "69000002",
    name: "单模块商品 & 特殊字符",
    grade: "B",
    category3: "预制主食",
    carton: 12,
    dailyQty: 0.5,
    length: 180,
    width: 90,
    height: 40,
    displayCols: 1,
    perCol: 6,
    faceWidth: 180,
    faceOrientation: "length",
    rowFull: 6,
    cabinetLabel: "卧柜2000-柜1",
    position: "分区2",
  },
  {
    id: "module-staging",
    store: "测试门店",
    included: true,
    inStaging: true,
    barcode: "69000003",
    name: "待选区不应导出",
    rowFull: 99,
  },
];

function calculate(row) {
  const rowFull = Number(row.rowFull) || 0;
  const skuFull = row.barcode === "69000001" ? 20 : rowFull;
  const trigger = Math.ceil(skuFull * 0.1);
  const external = row.barcode === "69000001" ? 3 : 1;
  return {
    full: rowFull,
    rowFull,
    skuFull,
    trigger,
    receivable: 12,
    external,
    staticVol: external * 0.5,
    risk: "低风险",
  };
}

const result = buildPlanogramExportData({
  store: "测试门店",
  rows,
  productKey: (row) => row.barcode,
  cabinetInfo: (row) => ({ kind: row.cabinetLabel.startsWith("立柜") ? "立柜" : "卧柜", label: row.cabinetLabel, position: row.position }),
  calculate,
  productVolume: () => 0.5,
  displayDirection: (row) => row.faceOrientation === "length" ? "长做陈列面" : "宽做陈列面",
});

assert.equal(result.summaryRows.length, 2, "商品汇总应按条码去重");
assert.equal(result.moduleRows.length, 3, "陈列模块明细应保留每个物理模块");
assert.equal(result.summaryRows[0]["满陈数量"], 20, "双模块商品应汇总满陈数量");
assert.equal(result.summaryRows[0]["外储数量"], 3, "双模块商品外储数量只能计一次");
assert.equal(result.summaryRows[0]["外储容积L"], 1.5, "双模块商品外储容积只能计一次");
assert.equal(result.moduleRows.filter((row) => row["产品条码"] === "69000001").length, 2, "双模块商品应保留卧柜和立柜两条明细");
assert.equal(result.moduleRows.some((row) => row["陈列面方向"] === "宽做陈列面"), true, "模块明细应保留陈列面方向");

const workbookXml = toExcelXmlWorkbook([
  { name: "商品汇总", rows: result.summaryRows },
  { name: "陈列模块明细", rows: result.moduleRows },
]);
assert.match(workbookXml, /Worksheet ss:Name="商品汇总"/);
assert.match(workbookXml, /Worksheet ss:Name="陈列模块明细"/);
assert.match(workbookXml, /单模块商品 &amp; 特殊字符/);
assert.match(workbookXml, /69000001/);

console.log("planogram Excel export tests passed");
