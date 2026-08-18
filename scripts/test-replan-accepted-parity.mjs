import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandAcceptedBaselinePayload} from './accepted-baseline-loader.mjs';
import {buildFormalReuseResult} from './replan-idempotency.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const live=JSON.parse(fs.readFileSync(path.join(root,'data','app-data.json'),'utf8').replace(/^\uFEFF/,''));
const parts=fs.readdirSync(path.join(root,'data','baseline')).filter(name=>/^accepted67\.part\d+\.txt$/.test(name)).sort();
assert.equal(parts.length,6,'确认版基准分片必须完整');
const payload=parts.map(name=>fs.readFileSync(path.join(root,'data','baseline',name),'utf8').trim()).join('');
const formal=expandAcceptedBaselinePayload(payload,live);
assert.equal(formal.productPool.length,67,'确认版有效产品池必须是67SKU');

// 固定规则：相同产品池、相同正式柜体时，不得再次跑优化器；必须直接复用正式确认版。
const result=buildFormalReuseResult(formal,formal,formal.productPool,null);
assert.ok(result?.reusedFormal,'相同产品池/同柜体必须直接复用正式确认版');

const normalizeStore=name=>String(name??'').replace(/生活馆/g,'').replace(/\s+/g,'').trim();
const planMap=new Map(result.plans.map(p=>[normalizeStore(p.store),p]));
const accepted=[
  ['蚌埠香榭兰庭mini',64,462.6],['固镇新天地',67,377.6],['合肥包河万达',67,400.3],
  ['淮北大华步行街',67,182.2],['淮北华松国际',65,213.3],['淮北上城国际',67,397.8],
  ['淮南盛港',67,381.7],['宁国津河西路',67,343.7],['宿州国购',67,577.5],
  ['无为鼓楼',64,541.2],['芜湖镜湖万达',67,134.6],['芜湖中御公馆mini',67,412.2],
  ['芜湖左岸mini',67,436.6],['和县',67,614.6],
];
const diffs=[];
for(const [store,expectedIncluded,expectedExternal] of accepted){
  const plan=planMap.get(normalizeStore(store));
  if(!plan){diffs.push(`${store}: 正式确认版缺少方案`);continue}
  const actualIncluded=Number(plan.summary?.placedSkuCount);
  const ext=Number(plan.summary?.suggestedExternalL);
  if(actualIncluded!==expectedIncluded)diffs.push(`${store}: SKU覆盖 ${actualIncluded}/67，确认版 ${expectedIncluded}/67`);
  if(Math.abs(ext-expectedExternal)>0.05)diffs.push(`${store}: 建议外储 ${ext.toFixed(1)}L，确认版 ${expectedExternal.toFixed(1)}L`);
  if(ext>754+1e-6)diffs.push(`${store}: 建议外储超过754L (${ext.toFixed(1)}L)`);
}
console.log(`accepted formal baseline parity checked: ${accepted.length} stores; differences=${diffs.length}`);
if(diffs.length)console.log(diffs.join('\n'));
assert.deepEqual(diffs,[],'正式确认版复用结果发生漂移');
console.log('accepted formal baseline parity tests passed');
