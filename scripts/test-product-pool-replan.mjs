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
 skus:[{id:'old1',store:'店A',included:true,barcode:'1',name:'在售水饺',cabinetKey:'a1',cabinetLabel:'立柜3m-柜4',position:'第1层',displayCols:1,perCol:5,faceWidth:100,status:'正常'}],
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
assert.equal(patch.deletedIds.includes('old1'),false,'已有老SKU不应整行删除后重建');
assert.equal(patch.newSkus.some(r=>r.barcode==='1'),false,'已有老SKU不应复制进newSkus');
assert.ok(patch.skus.some(r=>r.id==='old1'),'已有老SKU变化应通过增量字段补丁保存');
assert.ok(patch.newSkus.some(r=>r.barcode==='2'),'真正新品应保留为newSkus');
assert.equal(patch._dataSignature,'x|g|v');
const restored=applyAppStatePatch(base,patch);
assert.equal(restored.skus.filter(r=>r.barcode==='1').length,1,'应用补丁后老SKU不能重复');
assert.equal(restored.skus.some(r=>r.id==='old1'&&r.barcode==='1'),true,'应用补丁后必须保留老SKU原ID');
assert.equal(restored.skus.some(r=>r.barcode==='2'),true,'应用补丁后必须包含新品');

{
 const count=1800;
 const largeBase={meta:{source:'large',generatedAt:'g',version:'v'},stores:[{store:'压测店'}],cabinets:[],productPool:[],skus:[]};
 const largeDraft={...largeBase,skus:[]};
 for(let i=0;i<count;i++){
  const row={id:`old_${i}`,store:'压测店',included:true,barcode:`B${i}`,name:`商品${i}`,grade:i%2?'A':'B',rank:i+1,category2:'冻品',category3:'压测三级类目',category4:'压测四级类目',length:100,width:80,height:60,volume:.48,carton:12,dailyQty:1,cabinetKey:`cab_${i%30}`,cabinetLabel:`柜${i%30}`,position:`第${i%5+1}层`,displayCols:1,perCol:5,faceWidth:80,status:'正常',note:'基线商品'.repeat(4)};
  largeBase.skus.push(row);
  largeDraft.skus.push({...row,id:`replan_${i}`,displayCols:i%7===0?2:1,status:'产品池重排-纳入',sourceAction:'自动排柜纳入'});
 }
 const compact=buildAppDraftPatch(largeBase,largeDraft,null);
 const compactBytes=JSON.stringify(compact).length;
 const wholesaleBytes=JSON.stringify({deletedIds:largeBase.skus.map(r=>r.id),newSkus:largeDraft.skus}).length;
 assert.equal(compact.deletedIds.length,0,'大草稿中匹配到的老SKU不应被批量删除');
 assert.equal(compact.newSkus.length,0,'大草稿中匹配到的老SKU不应被批量复制');
 assert.ok(compactBytes<wholesaleBytes*0.35,`增量草稿应显著小于整表替换：${compactBytes}/${wholesaleBytes}`);
}

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
