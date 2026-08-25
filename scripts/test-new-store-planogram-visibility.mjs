import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

const selectedSkuStart = appSource.indexOf("function 选中陈列图SKU(id)");
const selectedSkuEnd = appSource.indexOf("function 陈列图下架SKU", selectedSkuStart);
assert.ok(selectedSkuStart >= 0 && selectedSkuEnd > selectedSkuStart, "未找到陈列图选中SKU链路");
const selectedSkuSource = appSource.slice(selectedSkuStart, selectedSkuEnd);
assert.doesNotMatch(selectedSkuSource, /当前\.陈列图四级=文\(r\.category4\)/, "选中SKU不能把陈列图锁定到单一品类，避免其他柜段看起来为空");

assert.match(appSource, /function 新店柜段预览项目\(c,rows\)/, "新增门店预览必须从SKU行解析柜段占用品");
assert.match(appSource, /previewItems:新店柜段预览项目\(c,pre\.skus\)/, "新增门店预览必须使用可解析的SKU对象，而不是引擎内部字符串items");
assert.doesNotMatch(appSource, /\(c\.items\|\|\[\]\)\.map\(x=>x\.name\+/, "不能直接把严格引擎的字符串items当作SKU对象渲染");

console.log("new-store planogram visibility and preview mapping: PASS");
