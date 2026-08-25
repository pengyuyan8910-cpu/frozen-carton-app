import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const dragStart = app.slice(app.indexOf("function 绑定陈列图拖拽()"));

assert.ok(
  app.includes("data-sku-id=\"'+逃(r.sourceRowId||r.id)+'\" data-cab-key=\"'+逃(r.cabinetKey||'')+'\""),
  "货架商品卡必须携带实际来源柜段，才能移入待选区",
);
assert.match(
  app,
  /function 陈列图拖动行\(id,store=门店名\(\)\)/,
  "拖拽源必须按当前门店解析，而不是只按全局SKU ID解析",
);
assert.match(
  dragStart,
  /stage\.classList\.add\("drag-over"\)/,
  "货架商品拖到待选区时，待选区必须进入可放置状态",
);
assert.match(
  dragStart,
  /移至待选区\(id,"陈列图手动移入待选区",门店名\(\),window\.__陈列图拖动源柜段\)/,
  "待选区放置必须传递货架商品实际来源柜段",
);

console.log("planogram shelf-to-staging tests passed");
