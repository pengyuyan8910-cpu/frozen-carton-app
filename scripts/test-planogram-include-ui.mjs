import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

assert.match(app, /function 陈列图纳入SKU\\(id\\)/, "陈列图必须提供当前门店SKU纳入入口");
assert.match(app, /data-map-include=/, "未纳入SKU列表必须渲染纳入按钮");
assert.match(app, /\\[data-map-include\\]/, "纳入按钮必须绑定点击事件");
assert.match(app, /includePlanogramSku/, "纳入操作必须复用独立状态变更函数");

console.log("planogram include UI tests passed");
