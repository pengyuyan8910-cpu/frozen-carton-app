import assert from 'node:assert/strict';
import { normalizeActiveProductPool, replanAllStores, buildAppDraftPatch, applyAppStatePatch, DRAFT_STORAGE_KEY, PUBLISHED_STORAGE_KEY } from './product-pool-replan-core.mjs';
const products=[
 {name:'老品A',barcode:'A',lifecycleStatus:'在售SKU',grade:'A',rank:1,category3:'水饺',category4:'水饺馄饨',length:100,width:100,height:100,volume:1,carton:5,dailyQty:1},
 {name:'新品B',barcode:'B',lifecycleStatus:'上新完成',grade:'B',rank:2,category3:'水饺',category4:'水饺馄饨',length:100,width:100,height:100,volume:1,carton:5,dailyQty:1},
 {name:'淘汰C',barcode:'C',lifecycleStatus:'淘汰完成',grade:'C',rank:3,category3:'水饺',category4:'水饺馄饨',length:100,width:100,height:100,volume:1,carton:5,dailyQty:1}
];
const cab=(store,label,position)=>({store,key:`${store}__${label}__${position}`,label,position,kind:'立柜',length:710,depth:534,height:250});
const base={meta:{source:'base.xlsx',generatedAt:'2026-08-18',version:'v1'},params:{triggerRate:.1,externalCapL:754},stores:[{store:'店1',type:'老店',p95Factor:1.2},{store:'店2',type:'新店',p95Factor:1.2}],cabinets:[cab('店1','立柜3m-柜4','第1层'),cab('店1','立柜3m-柜1','第1层'),cab('店2','立柜3m-柜1','第1层')],skus:[{id:'old-a',store:'店1',included:true,name:'老品A',barcode:'A',cabinetKey:'店1__立柜3m-柜4__第1层',cabinetLabel:'立柜3m-柜4',position:'第1层',displayCols:1,perCol:5,faceWidth:100}],productPool:products};
const pool=normalizeActiveProductPool(products);
assert.deepEqual(pool.map(x=>x.barcode).sort(),['A','B'],'有效池仅保留在售SKU和上新完成');
const result=replanAllStores(base,pool,{preserveExisting:true,externalCapL:754});
assert.equal(result.plans.length,2,'全部门店都应进入统一重排');
assert.equal(result.plans[0].skuDecisions.length,2,'SKU守恒应使用最新有效池');
const old=result.plans.find(p=>p.store==='店1').skuDecisions.find(d=>d.barcode==='A');
assert.equal(old.placements[0].segmentKey,'店1__立柜3m-柜4__第1层','合法老品位置应优先保留');
for(const p of result.plans){for(const d of p.skuDecisions.filter(x=>!x.included))assert.ok(d.reason||d.unplacedReason,'未排入SKU必须有中文原因')}
const patch=buildAppDraftPatch(base,result.draft,{tasks:[]});
assert.equal(patch._patchVersion,2);
assert.equal(patch.deletedIds.includes('old-a'),true,'重排草稿应替换原SKU行');
assert.equal(patch.productPool.length,2);
const applied=applyAppStatePatch(base,patch);
assert.equal(applied.productPool.length,2);
assert.equal(applied.skus.some(r=>r.barcode==='C'),false,'淘汰商品不得回到排柜草稿');
assert.notEqual(DRAFT_STORAGE_KEY,PUBLISHED_STORAGE_KEY,'草稿键与发布键必须隔离');
console.log('product pool replan tests passed');
