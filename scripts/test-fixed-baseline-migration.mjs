import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandAcceptedBaselinePayload} from './accepted-baseline-loader.mjs';
import {buildFormalReuseResult} from './replan-idempotency.mjs';
import {verifyAppData} from './verify-app-data.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appDataPath=path.join(root,'data','app-data.json');
const oldData=JSON.parse(fs.readFileSync(appDataPath,'utf8').replace(/^\uFEFF/,''));
const baselineDir=path.join(root,'data','baseline');
let data=oldData;
if(fs.existsSync(baselineDir)){
  const parts=fs.readdirSync(baselineDir).filter(x=>/^accepted67\.part\d+\.txt$/.test(x)).sort();
  if(parts.length){
    assert.equal(parts.length,6,'确认版基准分片若存在必须完整');
    const payload=parts.map(x=>fs.readFileSync(path.join(baselineDir,x),'utf8').trim()).join('');
    data=expandAcceptedBaselinePayload(payload,oldData);
  }
}
assert.ok(Array.isArray(data.productPool)&&data.productPool.length>0,'正式有效产品池不能为空');
assert.ok(Array.isArray(data.stores)&&data.stores.length>0,'正式门店不能为空');
assert.equal(data.stores.filter(s=>Number(s.suggestedExternalL)>754).length,0,'正式方案不得出现外储超过754L');
const v=verifyAppData(data);assert.equal(v.passed,true,`正式数据必须通过发布校验：${(v.errors||[]).join('；')}`);
const sampleStore=data.stores.find(s=>Number(s.skuCount)>0)?.store;
assert.ok(sampleStore,'至少需要一个有正式陈列的门店');
const reused=buildFormalReuseResult(data,data,data.productPool,[sampleStore]);
assert.equal(reused?.reusedFormal,true,'同产品池指定门店必须复用正式基准');
console.log(`fixed baseline state tests passed: ${data.productPool.length} SKU, ${data.stores.length} stores, sample=${sampleStore}`);
