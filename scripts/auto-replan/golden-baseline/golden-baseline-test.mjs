import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { calculateSkuInventoryMetrics } from "../inventory-metrics.mjs";
import { loadAndValidatePhase0 } from "../phase0-input.mjs";
import { calculatePhysicalCandidates } from "../phase1-physical-candidates.mjs";
import { PHYSICAL_BUSINESS_RULES } from "../physical-business-rules.mjs";
import { runGoldenSourceAudit } from "./golden-source-audit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const baseline = JSON.parse(fs.readFileSync(path.join(HERE, "golden-baseline.json"), "utf8"));

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function same(left, right) {
  return typeof left === "number" && typeof right === "number"
    ? Math.abs(left - right) <= 0.0001
    : left === right;
}

export function runGoldenBaseline({ print = true } = {}) {
  const started = performance.now();
  const data = readJson("data/app-data.json");
  const physicalData = readJson("data/user-confirmed-physical-dimensions.json");
  const audit = runGoldenSourceAudit();
  const assertions = [];
  const failures = [];
  const assert = (ok, detail, group = "原597条") => {
    assertions.push({ ok, group, ...detail });
    if (!ok) failures.push(detail);
  };

  const poolByBarcode = new Map(data.productPool.map(product => [String(product.barcode), product]));
  for (const sample of baseline.skuSamples) {
    const source = poolByBarcode.get(sample.skuKey);
    assert(Boolean(source), { type: "数据来源", sku: sample.name, field: "skuKey", expected: sample.skuKey, actual: source?.barcode });
    for (const field of ["length", "width", "height"]) {
      assert(same(source?.[field], sample[field]), { type: "数据来源", sku: sample.name, field, expected: sample[field], actual: source?.[field] });
    }
    assert(same(source?.carton, sample.cartonQty), { type: "数据来源", sku: sample.name, field: "carton", expected: sample.cartonQty, actual: source?.carton });
    assert(same(source?.volume, sample.unitVolumeL), { type: "数据来源", sku: sample.name, field: "volume", expected: sample.unitVolumeL, actual: source?.volume });
    for (const tuple of sample.expected) {
      const [displayCols, fullDisplay, triggerInventory, triggerAvailable, externalUnits, staticExternalL, avgExternalL, directCase] = tuple;
      const actual = calculateSkuInventoryMetrics({
        perCol: sample.arithmeticPerCol,
        displayCols,
        cartonQty: sample.cartonQty,
        triggerRate: baseline.triggerRate,
        unitVolumeL: sample.unitVolumeL,
        dailyQty: sample.dailyQty,
        faceWidth: sample.historicalEvidence.faceWidth
      });
      for (const [field, expected] of Object.entries({ fullDisplay, triggerInventory, triggerAvailable, externalUnits, staticExternalL, avgExternalL, directCase })) {
        assert(same(actual[field], expected), {
          type: "库存算术",
          sku: sample.name,
          cabinet: `${sample.historicalEvidence.cabinetNo} ${sample.historicalEvidence.position}`,
          displayCols,
          field,
          expected,
          actual: actual[field]
        });
      }
    }
  }

  const physicalIndex = new Map((physicalData.records || []).map(record => [
    `${record.store}__${record.label}__${record.position}`,
    record
  ]));
  for (const sample of baseline.cabinetSamples) {
    const record = physicalIndex.get(sample.segmentKey);
    assert(Boolean(record), { type: "柜体来源", cabinet: sample.segmentKey, field: "唯一真实尺寸记录", expected: "存在", actual: record ? "存在" : "缺失" });
    for (const field of ["length", "depth", "height"]) {
      assert(same(record?.[field], sample[field]), { type: "柜体来源", cabinet: sample.segmentKey, field, expected: sample[field], actual: record?.[field] });
    }
  }

  // 只运行20个样本与12个真实柜段的物理候选计算，不执行门店排柜。
  const selectedProducts = baseline.skuSamples.map(sample => poolByBarcode.get(sample.skuKey));
  const cabinetKeys = new Set(baseline.cabinetSamples.map(sample => sample.segmentKey));
  const selectedCabinets = data.cabinets.filter(cabinet => cabinetKeys.has(cabinet.key));
  const phase0 = loadAndValidatePhase0({
    store: "和县生活馆",
    productPool: selectedProducts,
    cabinets: selectedCabinets,
    params: data.params,
    physicalRecords: physicalData.records
  });
  const phase1 = phase0.ok ? calculatePhysicalCandidates(phase0) : null;
  assert(phase0.ok, { type: "物理候选入口", field: "PHASE 0", expected: "通过", actual: phase0.errors.join("；") });
  assert(Boolean(phase1), { type: "物理候选入口", field: "PHASE 1", expected: "已执行", actual: phase1 ? "已执行" : "未执行" });

  const firstCase = baseline.physicalCases[0];
  const firstActualCandidates = phase1?.candidatesBySku.get(firstCase[1])
    ?.filter(candidate => candidate.cabinetKey === firstCase[4]) || [];
  const firstLengthFace = firstActualCandidates.find(candidate => candidate.orientation === "length-face");
  const verticalCase = baseline.physicalCases.find(item => item[3] === "vertical");
  const verticalActual = phase1?.candidatesBySku.get(verticalCase[1])
    ?.find(candidate => candidate.cabinetKey === verticalCase[4] && candidate.orientation === "length-face");
  const chestCase = baseline.physicalCases.find(item => item[3] === "chest");
  const chestActual = phase1?.candidatesBySku.get(chestCase[1])
    ?.find(candidate => candidate.cabinetKey === chestCase[4] && candidate.orientation === "length-face");
  assert(JSON.stringify(PHYSICAL_BUSINESS_RULES.allowedOrientations) === JSON.stringify(["length-face", "width-face"]), { type: "正式物理规则", field: "orientation", expected: "仅长宽两个水平方向", actual: PHYSICAL_BUSINESS_RULES.allowedOrientations.join("、") });
  assert(firstLengthFace?.faceWidth === firstCase[8][0][1], { type: "正式物理规则", field: "faceWidth", expected: firstCase[8][0][1], actual: firstLengthFace?.faceWidth });
  assert(firstLengthFace?.orientedDepth === firstCase[8][0][2], { type: "正式物理规则", field: "orientedDepth", expected: firstCase[8][0][2], actual: firstLengthFace?.orientedDepth });
  assert(firstLengthFace?.orientedHeight === firstCase[8][0][3], { type: "正式物理规则", field: "orientedHeight", expected: firstCase[8][0][3], actual: firstLengthFace?.orientedHeight });
  assert(firstLengthFace?.depthCount === firstCase[8][0][4], { type: "正式物理规则", field: "depthCount", expected: firstCase[8][0][4], actual: firstLengthFace?.depthCount });
  assert(verticalActual?.stackCount === 1 && chestActual?.stackCount > 1 && firstLengthFace?.stackCount > 1, { type: "正式物理规则", field: "stackCount", expected: "立柜=1，卧柜/冰淇淋柜按真实高度大于1", actual: `立柜=${verticalActual?.stackCount}，卧柜=${chestActual?.stackCount}，冰淇淋柜=${firstLengthFace?.stackCount}` });
  assert(firstLengthFace?.perCol === firstCase[8][0][6], { type: "正式物理规则", field: "perCol", expected: firstCase[8][0][6], actual: firstLengthFace?.perCol });

  const physicalFields = baseline.physicalCandidateFields;
  for (const physicalCase of baseline.physicalCases) {
    const [storeKey, skuKey, name, cabinetClass, segmentKey, cabinetLength, cabinetDepth, cabinetHeight, expectedCandidates] = physicalCase;
    const actualCandidates = phase1?.candidatesBySku.get(skuKey)?.filter(candidate => candidate.cabinetKey === segmentKey) || [];
    for (const expectedCandidate of expectedCandidates) {
      const expected = Object.fromEntries(physicalFields.map((field, index) => [field, expectedCandidate[index]]));
      const actual = actualCandidates.find(candidate => candidate.orientation === expected.orientation);
      assert(Boolean(actual), { type: "新增物理候选", sku: name, cabinet: segmentKey, field: "候选存在", expected: "存在", actual: actual ? "存在" : "缺失" }, "新增断言");
      for (const field of ["orientation", "faceWidth", "orientedDepth", "orientedHeight", "depthCount", "stackCount", "perCol"]) {
        assert(same(actual?.[field], expected[field]), { type: "新增物理候选", sku: name, cabinet: segmentKey, field, expected: expected[field], actual: actual?.[field] }, "新增断言");
      }
      for (const tuple of expected.expected) {
        const [displayCols, fullDisplay, triggerInventory, triggerAvailable, externalUnits, staticExternalL, avgExternalL, directCase] = tuple;
        const metrics = calculateSkuInventoryMetrics({
          perCol: expected.perCol,
          displayCols,
          cartonQty: poolByBarcode.get(skuKey)?.carton,
          triggerRate: baseline.triggerRate,
          unitVolumeL: poolByBarcode.get(skuKey)?.volume,
          dailyQty: poolByBarcode.get(skuKey)?.dailyQty,
          faceWidth: expected.faceWidth
        });
        for (const [field, expectedValue] of Object.entries({ fullDisplay, triggerInventory, triggerAvailable, externalUnits, staticExternalL, avgExternalL, directCase })) {
          assert(same(metrics[field], expectedValue), { type: "新增容量算术", sku: name, cabinet: segmentKey, displayCols, field, expected: expectedValue, actual: metrics[field] }, "新增断言");
        }
      }
      assert(expected.faceWidth <= cabinetLength && expected.orientedDepth <= cabinetDepth && expected.orientedHeight <= cabinetHeight,
        { type: "新增物理合法性", sku: name, cabinet: segmentKey, field: "尺寸适配", expected: "合法", actual: `${expected.faceWidth}/${cabinetLength},${expected.orientedDepth}/${cabinetDepth},${expected.orientedHeight}/${cabinetHeight}` }, "新增断言");
    }
    assert(storeKey === "和县生活馆" && ["vertical", "chest", "ice"].includes(cabinetClass), { type: "新增样本来源", sku: name, cabinet: segmentKey, field: "门店与柜型", expected: "和县真实柜段", actual: `${storeKey}/${cabinetClass}` }, "新增断言");
  }

  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const originalAssertions = assertions.filter(item => item.group === "原597条");
  const newAssertions = assertions.filter(item => item.group === "新增断言");
  const result = {
    ok: failures.length === 0,
    status: failures.length === 0 ? "通过" : "失败",
    assertionCount: assertions.length,
    consistentCount: assertions.length - failures.length,
    failureCount: failures.length,
    failures,
    originalAssertionCount: originalAssertions.length,
    originalPassedCount: originalAssertions.filter(item => item.ok).length,
    originalFailureCount: originalAssertions.filter(item => !item.ok).length,
    newAssertionCount: newAssertions.length,
    newPassedCount: newAssertions.filter(item => item.ok).length,
    newFailureCount: newAssertions.filter(item => !item.ok).length,
    currentPhysicalCandidateCount: phase1?.allCandidates.length || 0,
    elapsedMs
  };
  if (print) {
    console.log(`黄金样本：${baseline.skuSamples.length} 个SKU、${baseline.cabinetSamples.length} 个真实柜段`);
    console.log(`原597条断言：通过${result.originalPassedCount}；失败${result.originalFailureCount}`);
    console.log(`新增断言：${result.newAssertionCount}；通过${result.newPassedCount}；失败${result.newFailureCount}`);
    console.log(`黄金测试总计：${result.assertionCount}；通过${result.consistentCount}；失败${result.failureCount}`);
    for (const failure of failures) {
      console.log(`黄金基准不一致：商品=${failure.sku || "-"}；柜段=${failure.cabinet || "-"}；字段=${failure.field}；黄金值=${failure.expected}；当前程序值=${failure.actual}`);
    }
    console.log(`测试耗时：${elapsedMs}毫秒`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runGoldenBaseline();
  if (!result.ok) {
    console.error("基础容量口径校验未通过，已停止后续排柜计算。");
    process.exitCode = 1;
  }
}
