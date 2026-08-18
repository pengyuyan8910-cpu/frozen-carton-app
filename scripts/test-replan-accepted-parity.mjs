import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeActiveProductPool,replanAllStores} from './product-pool-replan-core.mjs';

const normalizeStore=name=>String(name??'').replace(/生活馆/g,'').replace(/\s+/g,'').trim();
const live=JSON.parse(fs.readFileSync(new URL('../data/app-data.json',import.meta.url),'utf8'));
const pool=normalizeActiveProductPool(Array.isArray(live.productPool)&&live.productPool.length?live.productPool:(live.skus||[]));

let source=live;
try{
  const mod=await import('./replan-business-optimizer.mjs');
  if(typeof mod.prepareBusinessOptimizedSeed==='function'){
    source=mod.prepareBusinessOptimizedSeed(live,pool,{formalBase:live});
  }
}catch(err){
  if(err?.code!=='ERR_MODULE_NOT_FOUND')throw err;
}

const result=replanAllStores(source,pool,{preserveExisting:true,externalCapL:754});
const planMap=new Map(result.plans.map(p=>[normalizeStore(p.store),p]));

// 这些是 2026-08-17 已人工确认的67SKU版本中新店结果。
// 一键重排允许内部实现变化，但在相同产品池/相同柜体配置下，不得把这些门店重新算成另一套更差的方案。
const accepted=[
  ['蚌埠香榭兰庭mini',64,462.6],
  ['固镇新天地',67,377.6],
  ['合肥包河万达',67,400.3],
  ['淮北大华步行街',67,182.2],
  ['淮北华松国际',65,213.3],
  ['淮北上城国际',67,397.8],
  ['淮南盛港',67,381.7],
  ['宁国津河西路',67,343.7],
  ['宿州国购',67,577.5],
  ['无为鼓楼',64,541.2],
  ['芜湖镜湖万达',67,134.6],
  ['芜湖中御公馆mini',67,412.2],
  ['芜湖左岸mini',67,436.6],
  ['和县',67,614.6],
];

function includedCount(plan){
  const direct=Number(plan?.summary?.includedSkuCount ?? plan?.summary?.includedCount ?? plan?.summary?.skuCount);
  if(Number.isFinite(direct)&&direct>=0)return direct;
  return new Set((plan?.skuDecisions||[])
    .filter(d=>d?.included!==false && (d?.placements?.length||d?.included===true))
    .map(d=>String(d?.barcode||d?.name||'')).filter(Boolean)).size;
}
function recommendedExternal(plan){
  const keys=['recommendedExternalL','suggestedExternalL','recommendedL','suggestedL','externalRecommendedL'];
  for(const key of keys){const n=Number(plan?.summary?.[key]);if(Number.isFinite(n))return n}
  return NaN;
}

const diffs=[];
for(const [store,expectedIncluded,expectedExternal] of accepted){
  const plan=planMap.get(normalizeStore(store));
  if(!plan){diffs.push(`${store}: 未生成方案`);continue}
  const actualIncluded=includedCount(plan);
  const ext=recommendedExternal(plan);
  if(actualIncluded<expectedIncluded)diffs.push(`${store}: SKU覆盖 ${actualIncluded}/${pool.length}，确认版至少 ${expectedIncluded}/${pool.length}`);
  // 外储允许很小的实现差异，但不能明显劣于确认版；同时绝不能超过硬上限。
  if(Number.isFinite(ext)){
    const tolerance=Math.max(20,expectedExternal*0.10);
    if(ext>expectedExternal+tolerance)diffs.push(`${store}: 建议外储 ${ext.toFixed(1)}L，确认版 ${expectedExternal.toFixed(1)}L`);
    if(ext>754+1e-6)diffs.push(`${store}: 建议外储超过754L (${ext.toFixed(1)}L)`);
  }
}

console.log(`accepted parity checked: ${accepted.length} stores; differences=${diffs.length}`);
if(diffs.length)console.log(diffs.join('\n'));
assert.deepEqual(diffs,[],'当前一键重排结果未达到已确认67SKU基准');
console.log('accepted new-store parity tests passed');
