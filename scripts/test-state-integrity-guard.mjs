import assert from "node:assert/strict";
import { createStateIntegrityGuard } from "./state-integrity-guard.mjs";

const base = {
  stores: [{ store: "门店A" }, { store: "门店B" }, { store: "门店C" }],
  cabinets: [
    { key: "cab-a", store: "门店A", label: "卧柜A", position: "分区1" },
    { key: "cab-b", store: "门店B", label: "卧柜B", position: "分区1" },
  ],
  skus: [
    { id: "sku-1", store: "门店A", barcode: "690000000001" },
    { id: "sku-2", store: "门店B", barcode: "690000000002" },
  ],
  productPool: [{ barcode: "690000000001" }, { barcode: "690000000002" }],
};

const guard = createStateIntegrityGuard(base);

const expanded = {
  ...structuredClone(base),
  stores: [...base.stores, { store: "新增门店" }],
  cabinets: [...base.cabinets, { key: "cab-new", store: "新增门店", label: "新柜", position: "分区1" }],
  skus: [...base.skus, { id: "sku-new", store: "新增门店", barcode: "690000000003" }],
};
assert.equal(expanded.stores.length, 4, "模拟当前页面保留新增门店");
assert.equal(guard.validate(expanded).ok, true, "新增门店和增量记录必须允许");
assert.equal(guard.validate(base, { referenceState: expanded }).ok, false, "旧底表不得覆盖当前已有新增门店");

const missingStore = structuredClone(base);
missingStore.stores.pop();
assert.equal(guard.validate(missingStore).ok, false, "未授权删除门店必须拦截");

const missingCabinet = structuredClone(base);
missingCabinet.cabinets.pop();
assert.equal(guard.validate(missingCabinet).ok, false, "未授权删除柜体必须拦截");

const missingSku = structuredClone(base);
missingSku.skus = [missingSku.skus[0]];
assert.equal(guard.validate(missingSku).ok, false, "未授权删除底层SKU必须拦截");
assert.equal(guard.validate(missingSku, { allowedRemovedSkuIds: ["sku-2"] }).ok, true, "显式删除模块必须允许");

const duplicateSku = structuredClone(base);
duplicateSku.skus.push({ id: "sku-1", store: "门店A", barcode: "690000000004" });
assert.equal(guard.validate(duplicateSku).ok, false, "重复SKU主键必须拦截");

const missingPool = structuredClone(base);
missingPool.productPool.pop();
assert.equal(guard.validate(missingPool).ok, false, "正式产品池记录不得静默消失");

console.log("state-integrity-guard: passed");
