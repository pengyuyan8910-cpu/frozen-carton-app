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
assert.equal(patch.deletedIds.includes('old1'),false,'已有老SKU不应整行删除后重建');
assert.equal(patch.newSkus.some(r=>r.barcode==='1'),false,'已有老SKU不得重复写入newSkus');
assert.ok(patch.skus.some(r=>r.id==='old1'),'老SKU应复用原ID，仅记录变化字段');
assert.ok(patch.newSkus.some(r=>r.barcode==='2'),'真正新增SKU才进入newSkus');
assert.equal(patch._dataSignature,'x|g|v');
const patched=applyAppStatePatch(base,patch);
assert.equal(patched.skus.some(r=>r.id==='old1'&&r.barcode==='1'),true,'应用增量补丁后应保留老SKU原ID');
assert.equal(patched.skus.some(r=>r.barcode==='2'),true,'应用增量补丁后应包含新品');
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

{
 const twoStore={...base,
  stores:[{store:'店A',type:'老店',p95Factor:1.2},{store:'店B',type:'老店',p95Factor:1.2}],
  cabinets:[
   {store:'店A',key:'a1',label:'立柜3m-柜1',position:'第1层',kind:'立柜',length:710,depth:534,height:250,status:'正常'},
   {store:'店B',key:'b1',label:'立柜3m-柜1',position:'第1层',kind:'立柜',length:710,depth:534,height:250,status:'正常'},
  ],
  skus:[
   {id:'a-old',store:'店A',included:true,barcode:'1',name:'在售水饺',cabinetKey:'a1',cabinetLabel:'立柜3m-柜1',position:'第1层',displayCols:1,perCol:5,faceWidth:100},
   {id:'b-old',store:'店B',included:true,barcode:'1',name:'在售水饺',cabinetKey:'b1',cabinetLabel:'立柜3m-柜1',position:'第1层',displayCols:1,perCol:5,faceWidth:100,note:'店B原方案'},
  ],
 };
 const onlyA=replanAllStores(twoStore,products,{stores:['店A']});
 assert.deepEqual(onlyA.plans.map(p=>p.store),['店A'],'指定门店重排只应运行被选中的门店');
 const untouchedB=onlyA.draft.skus.find(r=>r.id==='b-old');
 assert.ok(untouchedB,'未选择的门店SKU必须完整保留在草稿');
 assert.equal(untouchedB.note,'店B原方案','未选择门店的数据不得被重排覆盖');
 const singlePatch=buildAppDraftPatch(twoStore,onlyA.draft,{tasks:[]});
 const after=applyAppStatePatch(twoStore,singlePatch);
 assert.equal(after.skus.find(r=>r.id==='b-old')?.note,'店B原方案','指定门店补丁应用后其他门店仍应保持原样');
}

{
 const manyBase={meta:{source:'large',generatedAt:'g',version:'v'},stores:[{store:'大店'}],cabinets:[],productPool:[],skus:[]};
 const manyDraft={...manyBase,skus:[]};
 for(let i=0;i<2000;i++){
  manyBase.skus.push({id:`old-${i}`,store:'大店',barcode:`B${i}`,name:`商品${i}`,included:true,cabinetKey:`C${Math.floor(i/100)}`,cabinetLabel:'立柜',position:'第1层',displayCols:1,perCol:4,faceWidth:100});
  manyDraft.skus.push({id:`replan-${i}`,store:'大店',barcode:`B${i}`,name:`商品${i}`,included:true,cabinetKey:`C${Math.floor(i/100)}`,cabinetLabel:'立柜',position:'第1层',displayCols:i<10?2:1,perCol:4,faceWidth:100,status:'产品池重排-纳入',sourceAdvice:'产品池一键重排',note:'产品池一键重排生成'});
 }
 const compact=buildAppDraftPatch(manyBase,manyDraft,null);
 assert.equal(compact.deletedIds.length,0,'大草稿不应删除已有2000行SKU');
 assert.equal(compact.newSkus.length,0,'大草稿不应把已有2000行SKU重新写入newSkus');
 assert.equal(compact.skus.length,10,'只应记录真正发生陈列变化的10行');
 assert.ok(JSON.stringify(compact).length<50000,'增量草稿应远小于localStorage常见配额');
}

console.log('product pool replan tests passed');
