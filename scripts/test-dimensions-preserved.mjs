import assert from 'node:assert/strict';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync(new URL('../data/app-data.json', import.meta.url), 'utf8'));
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const rows = data.skus || [];

assert.ok(rows.length > 0, 'app-data.json 必须包含 SKU');
assert.equal(rows.filter(row => Number(row.length) > 0 && Number(row.width) > 0 && Number(row.height) > 0).length, rows.length, '所有 SKU 必须保留长宽高');
const target = rows.find(row => String(row.barcode) === '6977480891210');
assert.deepEqual(
  { length: target?.length, width: target?.width, height: target?.height },
  { length: 270, width: 220, height: 70 },
  '示例 SKU 的原始尺寸不得改变',
);

const productColumns = app.slice(app.indexOf('function 商品列()'), app.indexOf('function 柜名'));
const allocationColumns = app.slice(app.indexOf('function 渲染排柜()'), app.indexOf('function 渲染柜段'));
assert.match(productColumns, /name:"长×宽×高mm"/, '商品明细必须显示长×宽×高');
assert.match(allocationColumns, /name:"长×宽×高mm"/, '排柜调整必须显示长×宽×高');

console.log(`dimension preservation checks passed: ${rows.length} SKU rows`);
