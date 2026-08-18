import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandAcceptedBaselinePayload} from './accepted-baseline-loader.mjs';
import {buildFormalReuseResult} from './replan-idempotency.mjs';
import {verifyAppData} from './verify-app-data.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const parts=fs.readdirSync(path.join(root,'data','baseline')).filter(x=>/^accepted67\.part\d+\.txt$/.test(x)).sort();
assert.equal(parts.length,6,'确认版基准必须由6个完整分片组成');
const payload=parts.map(x=>fs.readFileSync(path.join(root,'data','baseline',x),'utf8').trim()).join('');
const oldData=JSON.parse(fs.readFileSync(path.join(root,'data','app-data.json'),'utf8').replace(/^\uFEFF/,''));
const data=expandAcceptedBaselinePayload(payload,oldData);
assert.equal(data.productPool.length,67,'正式有效产品池必须是67');
const byStore=new Map(data.stores.map(s=>[s.store,s]));
for(const [store,count,suggested] of [
 ['宁国津河西路生活馆',67,343.7],
 ['和县生活馆',67,614.6],
 ['无为鼓楼小区生活馆',64,541.2],
]){
 const s=byStore.get(store);assert.ok(s,`缺少确认版门店：${store}`);assert.equal(s.skuCount,count,`${store} 纳入SKU必须复现确认版`);assert.equal(s.suggestedExternalL,suggested,`${store} 建议外储必须复现确认版`);
}
assert.equal(data.stores.filter(s=>Number(s.suggestedExternalL)>754).length,0,'确认版不得出现外储超过754L');
const v=verifyAppData(data);assert.equal(v.passed,true,`确认版必须通过正式发布校验：${(v.errors||[]).join('；')}`);
const ningguo=buildFormalReuseResult(data,data,data.productPool,['宁国津河西路生活馆']);
assert.equal(ningguo?.reusedFormal,true,'同产品池指定门店必须复用正式基准');
assert.equal(ningguo.plans[0].summary.placedSkuCount,67);assert.equal(ningguo.plans[0].summary.suggestedExternalL,343.7);
console.log('fixed baseline migration tests passed: 67 SKU, 宁国67/67 343.7L, 和县67/67 614.6L, 无为64/67 541.2L');
