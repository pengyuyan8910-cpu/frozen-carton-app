import assert from 'node:assert/strict';
import {normalizeActiveProductPool,replanAllStores,buildAppDraftPatch,applyAppStatePatch,buildReferencePlacements} from './product-pool-replan-core.mjs';

const products=[
 {barcode:'1',name:'在售水饺',lifecycleStatus:'在售SKU',grade:'A',rank:1,category3:'主食',category4:'水饺',length:100,width:100,height:50,volume:.5,carton:10,dailyQty:1},
 {barcode:'2',name:'上新包子',lifecycleStatus:'上新完成',grade:'B',rank:2,category3:'主食',category4:'包子',length:100,width:100,height:50,volume:.5,carton:10,dailyQty:1},
 {barcode:'3',name:'淘汰商品',lifecycleStatus:'淘汰完成',grade:'D',rank:99,category3:'主食',category4:'水饺',length:100,width:100,height:50,volume:.5,carton:10,dailyQty:1},
];
const pool=normalizeActiveProductPool(products);
assert.deepEqual(pool.map(p=>p.barcode),['1','2']);

const base={
 meta:{source:'x',generatedAt:'g',version:'v'},params:{triggerRate:.1,externalCapL:754,p95Factor:1.2,externalSafetyFactor:1.2},
 stores:[{store:'店A',type:'老店',p95Factor:1.2}],
 cabinets:[
  {store:'店A',key:'a1',label:'立柜3m-柜4',position:'第1层',kind:'立柜',length:710,depth:534,height:250,status:'正常'},
  {store:'店A',key:'a6',label:'立柜3m-柜4',position:'第6层',kind:'立柜',length:710,depth:534,height:250,status:'存储位'},
 ],
 skus:[{id:'old1',store:'店A',included:true,barcode:'1',name:'在售水饺',cabinetKey:'a1',displayCols:1,perCol:5,faceWidth:100}],
 productPool:products
};
const result=replanAllStores(base,products);
assert.equal(result.pool.length,2);
assert.equal(result.plans.length,1);
assert.equal(result.validation.ok,true);
assert.equal(result.draft.skus.some(r=>r.barcode==='3'),false,'淘汰商品不得进入新草稿');
const old=result.plans[0].skuDecisions.find(d=>d.barcode==='1');
assert.equal(old.placements[0].segmentKey,'a1','合法老品位置应优先保留');
const patch=buildAppDraftPatch(base,result.draft,{tasks:[]});
assert.ok(patch.deletedIds.includes('old1'));
assert.ok(patch.newSkus.length>=2);
assert.equal(patch._dataSignature,'x|g|v');
const current=applyAppStatePatch(base,{_patchVersion:2,deletedIds:[],skus:[],newSkus:[],newStores:[{store:'店B',type:'新店'}],newCabinets:[],productPool:products});
assert.ok(current.stores.some(s=>s.store==='店B'));

{
 const referenceData={...base,
  stores:[{store:'参考店',type:'老店',p95Factor:1.2},{store:'全新店',type:'新店',p95Factor:1.2}],
  cabinets:[
   {store:'参考店',key:'r1',label:'立柜3m-柜1',position:'第1层',kind:'立柜',length:710,depth:534,height:250,status:'正常'},
   {store:'全新店',key:'n1',label:'立柜3m-柜1',position:'第1层',kind:'立柜',length:710,depth:534,height:250,status:'正常'},
  ],
  skus:[{id:'ref1',store:'参考店',included:true,barcode:'1',name:'在售水饺',cabinetKey:'r1',displayCols:1,perCol:5,faceWidth:100,widthUsed:100}],
 };
 const ref=buildReferencePlacements(referenceData,'全新店',pool);
 assert.equal(ref.referenceStore,'参考店');
 assert.equal(ref.preferences[0].segmentKey,'n1','新增门店应把同配置参考店位置映射到自身柜段');
 const rr=replanAllStores(referenceData,products);
 const newPlan=rr.plans.find(p=>p.store==='全新店');
 assert.equal(newPlan.referenceStore,'参考店');
 assert.equal(newPlan.skuDecisions.find(x=>x.barcode==='1').placements[0].segmentKey,'n1');
}

console.log('product pool replan tests passed');
