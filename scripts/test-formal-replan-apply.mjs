import assert from "node:assert/strict";
import { applyStrictDraftToFormalData } from "./apply-formal-replan.mjs";

const data = {
  meta: { version: "test" },
  params: { triggerRate: 0.1, externalCapL: 754, externalSafetyFactor: 1.2 },
  productPool: [{ barcode: "100", name: "测试商品", active: true, length: 100, width: 50, height: 20, volume: 1, carton: 10 }],
  stores: [{ store: "测试店", p95Factor: 1.2 }],
  cabinets: [
    { key: "测试店__卧柜1__分区1", store: "测试店", label: "卧柜1", position: "分区1", kind: "卧柜", type: "卧柜", length: 500, depth: 300, height: 200 },
    { key: "测试店__卧柜2__分区1", store: "测试店", label: "卧柜2", position: "分区1", kind: "卧柜", type: "卧柜", length: 500, depth: 300, height: 200 }
  ],
  skus: [{ id: "old", store: "测试店", barcode: "100", name: "测试商品", included: true, cabinetKey: "测试店__卧柜1__分区1", displayCols: 1, perCol: 1, faceWidth: 1 }],
  excluded: [],
  externalRows: []
};

const draft = {
  generatedAt: "2026-08-20T00:00:00+08:00",
  productPoolRevision: "pool-test",
  summary: { storeCount: 1 },
  results: [{
    store: "测试店",
    plan: {
      summary: { includedSkuCount: 1, directCartonSkuCount: 1, externalSkuCount: 0, staticExternalL: 0, dynamicAvgExternalL: 0, dynamicP95ExternalL: 0, suggestedExternalL: 0 },
      rows: [{
        id: "strict_100", skuKey: "100", barcode: "100", name: "测试商品", active: true, included: true,
        grade: "A", rank: 1, length: 100, width: 50, height: 20, volume: 1, carton: 10,
        displayCols: 2, totalDisplayCols: 2, fullCount: 15, perCol: 0, faceWidth: 0,
        cabinetKey: "测试店__卧柜1__分区1", cabinetLabel: "卧柜1", position: "分区1", cabinetType: "chest",
        placements: [
          { skuKey: "100", cabinetKey: "测试店__卧柜1__分区1", cabinetLabel: "卧柜1", position: "分区1", cabinetType: "chest", orientation: "length-face", displayCols: 1, perCol: 10, faceWidth: 100, fullCount: 10, externalQty: 0, staticExternalL: 0, widthUsed: 100 },
          { skuKey: "100", cabinetKey: "测试店__卧柜2__分区1", cabinetLabel: "卧柜2", position: "分区1", cabinetType: "chest", orientation: "width-face", displayCols: 1, perCol: 5, faceWidth: 50, fullCount: 5, externalQty: 0, staticExternalL: 0, widthUsed: 50 }
        ],
        externalQty: 0, staticExternalL: 0, metrics: { avgExternalL: 0 }
      }],
      cabinets: [
        { ...data.cabinets[0], usedWidth: 100, leftWidth: 400, items: ["100"] },
        { ...data.cabinets[1], usedWidth: 50, leftWidth: 450, items: ["100"] }
      ],
      validation: { ok: true }
    },
    validation: { ok: true }
  }]
};

const next = applyStrictDraftToFormalData(data, draft, [{ store: "测试店", label: "卧柜1", position: "分区1", length: 600, depth: 400, height: 300 }]);
assert.equal(next.skus.length, 2);
assert.deepEqual(next.skus.map(row => row.perCol).sort((a, b) => a - b), [5, 10]);
assert.deepEqual(next.skus.map(row => row.faceWidth).sort((a, b) => a - b), [50, 100]);
assert.deepEqual(next.skus.map(row => row.rowFull).sort((a, b) => a - b), [5, 10]);
assert.equal(next.cabinets[0].usedWidth, 100);
assert.equal(next.cabinets[0].leftWidth, 400);
assert.match(next.cabinets[0].largeRemainderReason, /严格排柜/);
assert.equal(next.cabinets[0].length, 600);
assert.equal(next.cabinets[0].depth, 400);
assert.equal(next.cabinets[0].height, 300);
assert.equal(next.cabinets[1].usedWidth, 50);
assert.equal(next.cabinets[1].leftWidth, 450);
assert.equal(next.stores[0].skuCount, 1);
assert.equal(next.productPool.length, 1);
console.log("formal replan apply test passed");
