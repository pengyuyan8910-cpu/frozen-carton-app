import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('./product-pool-replan-ui.mjs',import.meta.url),'utf8');
for(const label of ['导出当前产品池','按当前产品池重新排柜','人工复核','导出最新版底表'])assert.ok(src.includes(label),`缺少按钮：${label}`);
assert.ok(src.includes('柜1-4第1-5层均参与冻品排柜'), 'UI必须显示当前柜4规则');
assert.ok(src.includes('DRAFT_STORAGE_KEY'), 'UI必须只写运营草稿');
assert.equal(src.includes('PUBLISHED_STORAGE_KEY'),false,'UI模块不得引用发布状态键');
assert.equal(src.includes('app-data.json'),false,'UI不得直接改正式app-data');
console.log('product pool replan ui contract tests passed');
