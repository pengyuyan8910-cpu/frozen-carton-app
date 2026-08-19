import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { runCurrentTablePolicy } from "./current-table-policy.mjs";
import { assertGoldenBaseline } from "./golden-baseline/golden-gate.mjs";

const baseline = JSON.parse(fs.readFileSync(new URL("./current-table-regression-baseline.json", import.meta.url), "utf8"));
const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const physical = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));

function check(name, actual, expected, ok, note = "") {
  return { name, actual, expected, ok: Boolean(ok), note };
}

function qualityChecks(store, summary, reference) {
  const largeStore = reference.includedSkuCount === reference.candidateSkuCount;
  return [
    check("有效SKU池", summary.candidateSkuCount, reference.candidateSkuCount, summary.candidateSkuCount === reference.candidateSkuCount),
    check("纳入SKU", summary.includedSkuCount, reference.includedSkuCount,
      largeStore ? summary.includedSkuCount === summary.candidateSkuCount : summary.includedSkuCount >= reference.includedSkuCount * 0.85,
      "大资源门店不得无故减少覆盖；小资源门店允许按经营价值取舍。"),
    check("未纳入SKU", summary.excludedForStoreCount, reference.excludedForStoreCount,
      summary.candidateSkuCount === summary.includedSkuCount + summary.excludedForStoreCount),
    check("直接整箱SKU", summary.directCaseSkuCount, reference.directCaseSkuCount, summary.directCaseSkuCount >= reference.directCaseSkuCount * 0.8),
    check("需外储SKU", summary.externalSkuCount, reference.externalSkuCount, summary.externalSkuCount <= Math.ceil(reference.externalSkuCount * 1.35)),
    check("静态外储L", summary.staticExternalL, reference.staticExternalL, summary.staticExternalL <= reference.staticExternalL * 1.35),
    check("建议外储L", summary.suggestedExternalL, reference.suggestedExternalL,
      summary.suggestedExternalL <= 754 && summary.suggestedExternalL <= reference.suggestedExternalL * 1.35),
    check("总陈列列数", summary.totalDisplayColumns, reference.totalDisplayColumns, summary.totalDisplayColumns >= reference.totalDisplayColumns * 0.8),
    check("柜段已用宽度", summary.usedWidth, reference.usedWidth, summary.usedWidth >= reference.usedWidth * 0.8),
    check(">300mm大余量柜段", summary.largeRemainingSegmentCount, reference.largeRemainingSegmentCount,
      summary.largeRemainingSegmentCount <= reference.largeRemainingSegmentCount + 1),
    check("同SKU同柜型拆分", summary.sameTypeSplitCount, 0, summary.sameTypeSplitCount === 0),
    check("四级品类单柜集中", summary.category4SingleCabinetCount, reference.category4SingleCabinetCount,
      summary.category4SingleCabinetCount >= Math.floor(reference.category4SingleCabinetCount * 0.7)),
    check("四级品类两柜内集中", summary.category4TwoCabinetCount, reference.category4TwoCabinetCount,
      summary.category4TwoCabinetCount >= Math.floor(reference.category4TwoCabinetCount * 0.7)),
    check("柜段超宽", summary.validation.overWidthCount, 0, summary.validation.overWidthCount === 0),
    check("第6层销售", summary.validation.layer6SalesCount, 0, summary.validation.layer6SalesCount === 0),
    check("冰品错柜", summary.validation.iceMismatchCount, 0, summary.validation.iceMismatchCount === 0),
    check("宽度账错误", summary.validation.widthLedgerMismatchCount, 0, summary.validation.widthLedgerMismatchCount === 0)
  ];
}

export function runCurrentTableRegression({ print = true } = {}) {
  const golden = assertGoldenBaseline();
  const stores = [];
  for (const [store, reference] of Object.entries(baseline.stores)) {
    const startedAt = Date.now();
    const result = runCurrentTablePolicy({
      store,
      productPool: data.productPool,
      cabinets: data.cabinets,
      params: data.params,
      physicalRecords: physical.records
    });
    const checks = qualityChecks(store, result.summary, reference);
    stores.push({
      store,
      elapsedMs: Date.now() - startedAt,
      passed: checks.every(item => item.ok),
      message: checks.every(item => item.ok) ? "当前版逻辑回归通过" : "当前版逻辑尚未复现",
      reference,
      actual: {
        candidateSkuCount: result.summary.candidateSkuCount,
        includedSkuCount: result.summary.includedSkuCount,
        excludedForStoreCount: result.summary.excludedForStoreCount,
        directCaseSkuCount: result.summary.directCaseSkuCount,
        externalSkuCount: result.summary.externalSkuCount,
        staticExternalL: result.summary.staticExternalL,
        suggestedExternalL: result.summary.suggestedExternalL,
        totalDisplayColumns: result.summary.totalDisplayColumns,
        usedWidth: result.summary.usedWidth,
        remainingWidth: result.summary.remainingWidth,
        largeRemainingSegmentCount: result.summary.largeRemainingSegmentCount,
        sameTypeSplitCount: result.summary.sameTypeSplitCount,
        category4SingleCabinetCount: result.summary.category4SingleCabinetCount,
        category4TwoCabinetCount: result.summary.category4TwoCabinetCount,
        category4ThreePlusCount: result.summary.category4ThreePlusCount
      },
      checks,
      excludedForStore: result.excludedForStore
    });
  }
  const report = {
    ok: golden.ok && stores.every(store => store.passed),
    message: stores.every(store => store.passed) ? "当前版逻辑回归通过" : "当前版逻辑尚未复现",
    workbook: baseline.sourceWorkbook,
    workbookSha256: baseline.sourceWorkbookSha256,
    goldenBaseline: `${golden.consistentCount}/${golden.assertionCount}`,
    stores
  };
  if (print) console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = runCurrentTableRegression({ print: true });
  if (!report.ok) process.exitCode = 1;
}
