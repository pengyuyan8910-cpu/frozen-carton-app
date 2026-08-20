import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layout = await readFile(new URL("../layout-preview-v5.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");

const visualStart = layout.indexOf("function createPlanogramSheet");
const detailStart = layout.indexOf("function createDetailSheet", visualStart);
assert.ok(visualStart >= 0 && detailStart > visualStart, "必须能定位Excel陈列图主视觉生成函数");
const visual = layout.slice(visualStart, detailStart);

assert.match(visual, /陈列面：/, "Excel陈列图商品块必须显示摆放方向");
assert.match(visual, /displayDirection\(row\)/, "Excel陈列图商品块必须按SKU方向显示");
assert.doesNotMatch(visual, /row\.category3|row\.category4/, "Excel陈列图主视觉不应再显示产品分类");
assert.doesNotMatch(visual, /最多['"]\s*\+\s*maxBoxes/, "Excel陈列图主视觉不应再显示最多可放箱数");

assert.match(index, /id="exportDisplayMapPdfBtn"/, "陈列图页面必须提供PDF导出按钮");
assert.match(layout, /function exportPdfPlanogram\(\)/, "必须提供PDF陈列图导出函数");
assert.match(layout, /displayMapCanvas/, "PDF必须基于当前陈列图画布");
assert.match(layout, /printWindow\.print\(\)/, "PDF导出必须打开浏览器打印/另存为PDF流程");

assert.match(layout, /#displayMapCanvas\{display:block!important;width:100%!important;min-width:0!important/, "PDF打印副本必须关闭陈列图多列布局");
assert.match(layout, /\.pdf-cabinet-page\{[^}]*break-after:page/, "PDF必须让每个柜子从新页面开始");
assert.match(layout, /pdf-cabinet-page/, "PDF必须为每个柜子建立独立页面容器");
assert.match(layout, /fitPrintPages/, "PDF必须由主页面在打印布局完成后缩放整柜内容");
assert.match(layout, /pdf-cabinet-content/, "PDF缩放必须作用于完整柜子内容，不能裁掉后续层位");
assert.match(layout, /height:194mm/, "PDF页面容器必须使用稳定的横向页面高度");
assert.match(layout, /\.pdf-cabinet-content>\.map-cabinet\{[^}]*break-inside:avoid/, "PDF必须尽量保持同一个柜子不被拆页");
assert.match(layout, /\.pdf-cabinet-page:last-child\{break-after:auto/, "PDF最后一页不能继续强制分页");

console.log("planogram Excel/PDF export UI tests passed");

