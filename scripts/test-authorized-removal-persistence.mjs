import assert from "node:assert/strict";
import fs from "node:fs";
import { createStateIntegrityGuard } from "./state-integrity-guard.mjs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const data = JSON.parse(fs.readFileSync(new URL("../data/app-data.json", import.meta.url), "utf8"));

assert.match(app, /allowedRemovedSkuIds/, "状态补丁必须持久化已授权删除SKU清单");
assert.match(app, /_allowedRemovedSkuIds/, "加载后的状态必须保留已授权删除SKU清单");
assert.match(app, /patch\.allowedRemovedSkuIds/, "应用状态补丁必须恢复已授权删除SKU清单");
assert.match(app, /patch\.deletedIds\|\|\[\]/, "缺少授权字段的旧版补丁必须把已保存的删除清单迁移为授权清单");
assert.match(app, /迁移旧版完整状态/, "旧版完整状态必须把已缺失的正式SKU登记为授权删除");

const removedIds = ["sku_1808", "sku_1793", "sku_1801", "sku_1772", "strict_和县生活馆_6978001637805_2"];
const current = structuredClone(data);
current.skus = current.skus.filter(row => !removedIds.includes(row.id));
current.stores.push({ store: "新增门店1", type: "新店" });
current.stores.push({ store: "新增门店2", type: "新店" });
current.stores.push({ store: "新增门店3", type: "新店" });
const guard = createStateIntegrityGuard(data);

assert.equal(
  guard.validate(current, { allowedRemovedSkuIds: removedIds }).ok,
  true,
  "历史明确删除的陈列模块在新增门店后仍必须允许保存"
);
assert.equal(
  guard.validate(current).ok,
  false,
  "没有授权记录的真实SKU缺失仍必须被拦截"
);

console.log("authorized-removal-persistence: passed");
