import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

assert.match(app, /function SKU已纳入\(r\)\{return r\?\.included!==false\}/, "陈列图必须有统一的已纳入口径");

const poolStart = app.indexOf("function 陈列图池SKU(store)");
const poolEnd = app.indexOf("function 陈列图池列表(store)", poolStart);
assert.ok(poolStart >= 0 && poolEnd > poolStart, "未找到陈列图商品池筛选逻辑");
assert.match(app.slice(poolStart, poolEnd), /!SKU已纳入\(r\)/, "未纳入筛选必须与纳入操作使用同一口径");

const listStart = app.indexOf("const listHtml=", poolEnd);
const listEnd = app.indexOf("const stageHost=q('#displayStagingHost')", listStart);
assert.ok(listEnd > listStart, "未找到陈列图商品池列表逻辑");
const listSource = app.slice(listStart, listEnd);
assert.match(listSource, /const included=SKU已纳入\(r\)/, "商品状态显示必须使用统一纳入口径");
assert.doesNotMatch(listSource, /!r\.included|r\.included\?|\(r\.included\?/, "商品池列表不能再使用与核心逻辑不同的 included 真假判断");

console.log("planogram include state consistency: PASS");
