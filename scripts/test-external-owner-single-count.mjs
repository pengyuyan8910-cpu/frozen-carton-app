import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('./refresh-data.mjs',import.meta.url),'utf8');
assert.ok(src.includes('if (row.externalOwner !== false) continue;'),'发布前必须识别非外储归属行');
for(const field of ['externalCountOverride = 0','staticExternalOverride = 0','avgExternalOverride = 0'])assert.ok(src.includes(field),`非外储归属行必须归零：${field}`);
assert.ok(src.includes('enforceSingleExternalOwner(data);'),'正式数据在校验前必须执行外储单归属清洗');
console.log('external owner single-count contract tests passed');
