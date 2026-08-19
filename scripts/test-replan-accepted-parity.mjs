import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFormalReuseResult} from './replan-idempotency.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const formal=JSON.parse(fs.readFileSync(path.join(root,'data','app-data.json'),'utf8').replace(/^\uFEFF/,''));
assert.ok(Array.isArray(formal.productPool)&&formal.productPool.length>0,'正式产品池不能为空');
const result=buildFormalReuseResult(formal,formal,formal.productPool,null);
assert.ok(result?.reusedFormal,'相同产品池/同柜体必须直接复用正式方案');
for(const plan of result.plans){
  assert.ok(Number(plan.summary?.suggestedExternalL||0)<=754+1e-6,`${plan.store} 正式方案建议外储不得超过754L`);
}
console.log(`formal baseline reuse checked: ${result.plans.length} stores`);
console.log('accepted formal baseline reuse tests passed');
