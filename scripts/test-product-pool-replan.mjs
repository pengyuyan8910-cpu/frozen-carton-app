import { strict as assert } from "node:assert";
import {
  applyProductPoolChanges,
  publishProductPoolChanges,
  productPoolRevision,
  generateReplanDraft,
  applyReplanDraftToOperationalState
} from "./product-pool-replan-service.mjs";
import { planSignature } from "./strict-allocation-adapter.mjs";

const store = { store: "TEST店", type: "生活馆", p95Factor: 1.2, p95Source: "store-config:TEST店" };
const products = [
  { id: "p1", barcode: "TEST-1", name: "测试火锅料", category3: "冷冻食材", category4: "火锅食材", grade: "A", rank: 1, length: 100, width: 50, height: 50, carton: 10, dailyQty: 2, active: true },
  { id: "p2", barcode: "TEST-2", name: "测试冰品", category3: "雪糕冰品", category4: "雪糕冰淇淋", grade: "B", rank: 2, length: 100, width: 50, height: 50, carton: 10, dailyQty: 1, active: true }
];
const cabinets = [
  { key: "TEST店__立柜1__第1层", store: store.store, label: "立柜1", position: "第1层", kind: "立柜", type: "立柜", length: 300, depth: 534, height: 250, physicalSource: "app-data" },
  { key: "TEST店__立柜1__第6层", store: store.store, label: "立柜1", position: "第6层", kind: "立柜", type: "立柜", length: 300, depth: 534, height: 250, physicalSource: "app-data" },
  { key: "TEST店__冰淇淋柜1900-柜1__分区1", store: store.store, label: "冰淇淋柜1900-柜1", position: "分区1", kind: "冰淇淋柜", type: "冰淇淋柜", length: 300, depth: 697, height: 447, physicalSource: "app-data", iceOnly: true }
];

function run() {
  return generateReplanDraft({ productPool: products, stores: [store], cabinets, params: { triggerRate: 0.1, externalSafetyFactor: 1.2, externalCapL: 754 }, scope: [store.store] });
}

const first = run();
const second = run();
assert.equal(first.summary.storeCount, 1);
assert.equal(first.results[0].planSignature, second.results[0].planSignature, "相同输入重排签名必须一致");
assert.equal(first.results[0].validation.checks.overWidthCount, 0);
assert.equal(first.results[0].validation.checks.layer6SalesCount, 0);
assert.equal(first.results[0].validation.checks.iceWrongCount, 0);
assert.equal(first.results[0].validation.checks.skuConservation, true);
const vertical = first.results[0].plan.rows.find(row => row.skuKey === "TEST-1");
assert.equal(vertical.placements[0].stackCount, 1, "立柜销售层不得堆叠，商品高只用于纵深计算");

const lifecycle = applyProductPoolChanges(products, [{ type: "retire", barcode: "TEST-2", name: "测试冰品" }], { batchId: "TEST-BATCH" });
assert.equal(lifecycle.ok, true);
assert.equal(lifecycle.activeProductCount, 1);
assert.equal(productPoolRevision(lifecycle.productPool), lifecycle.revision);
const published = publishProductPoolChanges({ productPool: products, lifecycle: { tasks: [] } }, [{ type: "restore", barcode: "TEST-2", name: "测试冰品" }], { batchId: "TEST-RESTORE" });
assert.equal(published.ok, true);
assert.equal(published.state.lifecycle.tasks[0].type, "恢复");

const operational = applyReplanDraftToOperationalState({ productPool: products, stores: [store], cabinets, skus: [] }, first);
assert.equal(operational.skus.length, 2);
assert.equal(operational.frozen_carton_replan_draft_v2.key, "frozen_carton_replan_draft_v2");
const skipped = applyReplanDraftToOperationalState({ productPool: products, stores: [store], cabinets, skus: [] }, first, [store], []);
assert.equal(skipped.skus.length, 0, "未选门店不得应用重排草稿");

console.log(JSON.stringify({
  pass: true,
  deterministic: first.results[0].planSignature === second.results[0].planSignature,
  lifecycleRevision: lifecycle.revision,
  draftKey: operational.frozen_carton_replan_draft_v2.key,
  summary: first.summary
}, null, 2));
