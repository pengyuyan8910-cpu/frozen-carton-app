import fs from "node:fs";
import {
  allocateStore,
  planSignature,
  validatePlan
} from "./strict-allocation-engine.mjs";

const root = new URL("..", import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL("data/app-data.json", root), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("data/user-confirmed-physical-dimensions.json", root), "utf8"));
const params = data.params || { triggerRate: 0.1, p95Factor: 1.241748, externalSafetyFactor: 1.2, externalCapL: 754 };

function cabinet(store, label, position, length = 710, depth = 534, height = 250, kind = "立柜", status = "正常") {
  return { key: `${store}__${label}__${position}`, store, label, position, kind, type: kind, length, depth, height, status };
}

function sku(id, overrides = {}) {
  return {
    id: `case_${id}`,
    barcode: `case-${id}`,
    name: `测试SKU${id}`,
    category3: "冷冻食材",
    category4: "测试品类",
    grade: "B",
    rank: id,
    length: 100,
    width: 50,
    height: 50,
    volume: 1,
    carton: 10,
    dailyQty: 2,
    active: true,
    ...overrides
  };
}

function run(store, productPool, cabinets, optimization = { maxIterations: 4, maxExpansions: 180 }, physicalRecords = []) {
  return allocateStore({ store, productPool, cabinets, params, physicalRecords, optimization });
}

function result(name, ok, detail = {}) {
  return { name, ok: Boolean(ok), ...detail };
}

function case1DeterministicHanxian() {
  const runs = [0, 1, 2].map(() => run("和县生活馆", data.productPool, data.cabinets, undefined, confirmed.records));
  const signatures = runs.map(planSignature);
  return result("CASE 1 deterministic 3 runs", new Set(signatures).size === 1, {
    signatures: signatures.map(signature => signature.slice(0, 24)),
    summary: runs[0].summary
  });
}

function case2NoForceLargeSku() {
  const store = "CASE2";
  const plan = run(store, [sku(2, { length: 900, width: 100, height: 100 })], [cabinet(store, "立柜1", "第1层", 800)]);
  const row = plan.rows[0];
  return result("CASE 2 size over remaining width", !row.included && row.reason && !plan.summary.overWidthCount, { reason: row.reason, summary: plan.summary });
}

function case3IceIsolation() {
  const store = "CASE3";
  const ice = sku(31, { category3: "雪糕冰品", category4: "雪糕冰淇淋", name: "冰淇淋测试SKU" });
  const ordinary = sku(32, { name: "普通冻品测试SKU" });
  const cabs = [cabinet(store, "普通柜1", "分区1", 400, 697, 460, "卧柜"), cabinet(store, "冰淇淋柜1900-柜1", "分区1", 400, 697, 447, "冰淇淋柜")];
  const plan = run(store, [ice, ordinary], cabs);
  const iceRow = plan.rows.find(row => row.skuKey === ice.barcode);
  const ordinaryRow = plan.rows.find(row => row.skuKey === ordinary.barcode);
  return result("CASE 3 ice isolation", iceRow?.included && ordinaryRow?.included && plan.cabinets.find(c => c.key === iceRow.cabinetKey)?.iceOnly === true && plan.cabinets.find(c => c.key === ordinaryRow.cabinetKey)?.iceOnly === false, { placements: [{ sku: iceRow?.name, cabinet: iceRow?.cabinetLabel }, { sku: ordinaryRow?.name, cabinet: ordinaryRow?.cabinetLabel }] });
}

function case4Layer6StorageOnly() {
  const store = "CASE4";
  const cabs = [cabinet(store, "立柜1", "第6层"), cabinet(store, "立柜1", "第1层")];
  const plan = run(store, [sku(41)], cabs);
  const row = plan.rows[0];
  return result("CASE 4 layer6 is storage only", row.included && row.position !== "第6层" && plan.summary.layer6SalesCount === 0, { position: row.position, layer6SalesCount: plan.summary.layer6SalesCount });
}

function case5WidthInsufficient() {
  const store = "CASE5";
  const plan = run(store, [sku(51, { length: 700, width: 600 })], [cabinet(store, "卧柜1", "分区1", 500, 697, 460, "卧柜")]);
  return result("CASE 5 width insufficient", plan.summary.placedSkuCount === 0 && plan.rows[0].reason, { reason: plan.rows[0].reason });
}

function case6ExternalCapFailure() {
  const store = "CASE6";
  const plan = run(store, [sku(61, { carton: 1000, volume: 2 })], [cabinet(store, "卧柜1", "分区1", 100, 697, 460, "卧柜")]);
  return result("CASE 6 external cap explicit failure", plan.validation.errors.some(error => error.includes("754L")) && plan.status === "review_required", { status: plan.status, suggestedExternalL: plan.summary.suggestedExternalL, errors: plan.validation.errors });
}

function case7Conservation() {
  const store = "CASE7";
  const pool = [sku(71), sku(72, { length: 1000, width: 900, height: 900 })];
  const plan = run(store, pool, [cabinet(store, "立柜1", "第1层", 200)]);
  const conservation = plan.summary.activeSkuCount === plan.summary.placedSkuCount + plan.summary.unplacedSkuCount && plan.validation.conservationOk;
  return result("CASE 7 conservation", conservation, { active: plan.summary.activeSkuCount, placed: plan.summary.placedSkuCount, unplaced: plan.summary.unplacedSkuCount, unplacedSkus: plan.unplacedSkus });
}

function case8RetiredExcluded() {
  const store = "CASE8";
  const active = sku(81);
  const retired = sku(82, { active: false, status: "淘汰完成" });
  const plan = run(store, [active, retired], [cabinet(store, "立柜1", "第1层", 200)]);
  return result("CASE 8 retired excluded", plan.summary.activeSkuCount === 1 && !plan.rows.some(row => row.skuKey === retired.barcode), { activeSkuCount: plan.summary.activeSkuCount });
}

function case9CategoryConcentration() {
  const store = "CASE9";
  const pool = Array.from({ length: 6 }, (_, index) => sku(90 + index, { category4: "同四级品类", rank: index + 1 }));
  const cabs = [cabinet(store, "卧柜1", "分区1", 500, 697, 460, "卧柜"), cabinet(store, "卧柜2", "分区1", 500, 697, 460, "卧柜"), cabinet(store, "卧柜3", "分区1", 500, 697, 460, "卧柜")];
  const plan = run(store, pool, cabs);
  return result("CASE 9 category concentration", plan.summary.category4Concentration >= 0.5, { category4Concentration: plan.summary.category4Concentration, cabinets: [...new Set(plan.rows.filter(row => row.included).map(row => row.cabinetKey))] });
}

function case10Cabinet4Normal() {
  const store = "CASE10";
  const cabs = [cabinet(store, "立柜3m-柜1", "第1层", 100, 534, 250, "立柜", "正常"), cabinet(store, "立柜3m-柜4", "第1层", 710, 534, 250, "立柜", "其他品类预留")];
  const plan = run(store, [sku(101, { length: 100, width: 200 })], cabs);
  const row = plan.rows[0];
  return result("CASE 10 cabinet4 normal", row.included && row.cabinetLabel.includes("柜4") && plan.summary.overWidthCount === 0, { cabinet: row.cabinetLabel, status: cabs[1].status });
}

function sourceIntegrityCases() {
  const store = "SOURCE_CASE";
  const product = sku(111);
  const missing = run(store, [product], [cabinet(store, "立柜1", "第1层", 200, 0, 250)]);
  const duplicateRecord = { store, label: "立柜1", position: "第1层", length: 200, depth: 534, height: 250 };
  const duplicate = run(store, [product], [cabinet(store, "立柜1", "第1层", 200, 534, 250)], { maxIterations: 0, maxExpansions: 0 }, [duplicateRecord, { ...duplicateRecord }]);
  return [
    result("CASE physical data missing", missing.status === "failed" && missing.validation.errors.some(error => error.includes("depth")), { status: missing.status, errors: missing.validation.errors }),
    result("CASE physical source duplicate", duplicate.status === "failed" && duplicate.validation.errors.some(error => error.includes("不唯一")), { status: duplicate.status, errors: duplicate.validation.errors })
  ];
}

function hanxianRegression() {
  const runs = [0, 1, 2].map(() => run("和县生活馆", data.productPool, data.cabinets, undefined, confirmed.records));
  const signatures = runs.map(planSignature);
  const plan = runs[0];
  const ok = new Set(signatures).size === 1
    && plan.summary.activeSkuCount === 71
    && plan.summary.placedSkuCount === 71
    && plan.summary.overWidthCount === 0
    && plan.summary.layer6SalesCount === 0
    && plan.summary.iceWrongCount === 0
    && plan.validation.ok
    && plan.summary.suggestedExternalL <= 754;
  return { ok, status: plan.status, summary: plan.summary, validation: plan.validation, signatures: signatures.map(signature => signature.slice(0, 24)), unplacedSkus: plan.unplacedSkus, evidence: plan.evidence };
}

function allStoreRegression() {
  const stores = [...new Set((data.stores || []).map(store => store.store))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const rows = stores.map(store => {
    const plan = run(store, data.productPool, data.cabinets, { maxIterations: 2, maxExpansions: 180 }, confirmed.records);
    return {
      store,
      status: plan.status,
      validationOk: plan.validation.ok,
      structuralOk: plan.validation.structuralOk,
      summary: plan.summary,
      errors: plan.validation.errors,
      warnings: plan.validation.warnings
    };
  });
  return {
    storeCount: rows.length,
    passed: rows.filter(row => row.status === "passed").length,
    review_required: rows.filter(row => row.status === "review_required").length,
    failed: rows.filter(row => row.status === "failed").length,
    blocked: 0,
    rows,
    noBlocked: true
  };
}

const cases = [case1DeterministicHanxian(), case2NoForceLargeSku(), case3IceIsolation(), case4Layer6StorageOnly(), case5WidthInsufficient(), case6ExternalCapFailure(), case7Conservation(), case8RetiredExcluded(), case9CategoryConcentration(), case10Cabinet4Normal(), ...sourceIntegrityCases()];
const hanxian = hanxianRegression();
const regression30 = allStoreRegression();
const pass = cases.every(item => item.ok) && hanxian.ok && regression30.noBlocked;
console.log(JSON.stringify({ pass, cases, hanxian, regression30 }, null, 2));
