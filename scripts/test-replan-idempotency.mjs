import assert from 'node:assert/strict';
import { sameEffectivePool, buildFormalReuseResult } from './replan-idempotency.mjs';

const formal={
  meta:{source:'accepted-67',version:'v67'},
  params:{externalCapL:754},
  productPool:[
    {barcode:'A',name:'商品A',active:true,lifecycleStatus:'在售SKU'},
    {barcode:'B',name:'商品B',active:true,lifecycleStatus:'上新完成'},
  ],
  stores:[
    {store:'宁国津河西路生活馆',type:'新店',skuCount:2,directSku:1,externalSku:1,staticExternalL:402.8,dynamicAvgExternalL:201.4,dynamicP95L:286.5,suggestedExternalL:343.7},
    {store:'其他店',type:'老店',skuCount:1,directSku:1,externalSku:0,staticExternalL:0,dynamicAvgExternalL:0,dynamicP95L:0,suggestedExternalL:0},
  ],
  cabinets:[
    {store:'宁国津河西路生活馆',key:'n1',label:'立柜1',position:'第1层',kind:'立柜',length:1000,depth:500,height:250},
    {store:'其他店',key:'o1',label:'立柜1',position:'第1层',kind:'立柜',length:1000,depth:500,height:250},
  ],
  skus:[
    {id:'n-a',store:'宁国津河西路生活馆',barcode:'A',name:'商品A',included:true,cabinetKey:'n1',displayCols:2,perCol:4,faceWidth:100},
    {id:'n-b',store:'宁国津河西路生活馆',barcode:'B',name:'商品B',included:true,cabinetKey:'n1',displayCols:1,perCol:3,faceWidth:120},
    {id:'o-a',store:'其他店',barcode:'A',name:'商品A',included:true,cabinetKey:'o1',displayCols:1,perCol:4,faceWidth:100},
  ],
  excluded:[{store:'其他店',barcode:'B',name:'商品B',reason:'容量限制'}],
};

const samePool=[formal.productPool[1],formal.productPool[0]];
assert.equal(sameEffectivePool(formal,samePool),true,'相同有效产品池即使顺序变化也必须识别为同一正式版本');
assert.equal(sameEffectivePool(formal,[...samePool,{barcode:'C',name:'商品C',active:true,lifecycleStatus:'上新完成'}]),false,'新增SKU后不能复用旧正式方案');

const working=structuredClone(formal);
working.skus.find(r=>r.id==='n-a').displayCols=9;
working.stores.find(s=>s.store==='宁国津河西路生活馆').suggestedExternalL=1442;
working.skus.find(r=>r.id==='o-a').displayCols=7;

const selected=buildFormalReuseResult(formal,working,samePool,['宁国津河西路生活馆']);
assert.ok(selected?.reusedFormal,'相同产品池下指定正式门店必须直接复用正式基准');
assert.equal(selected.plans[0].summary.placedSkuCount,2);
assert.equal(selected.plans[0].summary.suggestedExternalL,343.7,'宁国建议外储必须原样复现正式基准343.7L');
assert.equal(selected.draft.skus.find(r=>r.id==='n-a').displayCols,2,'所选门店必须恢复正式柜位/列数，而不是再次优化');
assert.equal(selected.draft.skus.find(r=>r.id==='o-a').displayCols,7,'指定门店重排不得覆盖其他门店当前草稿');

const allWorking=structuredClone(formal);
allWorking.skus.find(r=>r.id==='n-a').displayCols=9;
allWorking.skus.find(r=>r.id==='o-a').displayCols=7;
const all=buildFormalReuseResult(formal,allWorking,samePool,null);
assert.ok(all?.reusedFormal,'相同产品池且没有新增门店时，全店重排必须直接复用正式基准');
assert.equal(all.draft.skus.find(r=>r.id==='n-a').displayCols,2);
assert.equal(all.draft.skus.find(r=>r.id==='o-a').displayCols,1);
assert.equal(all.plans.length,2);

const withNewStore=structuredClone(formal);
withNewStore.stores.push({store:'新增门店C',type:'新店'});
withNewStore.cabinets.push({store:'新增门店C',key:'c1',label:'立柜1',position:'第1层',kind:'立柜',length:1000,depth:500,height:250});
assert.equal(buildFormalReuseResult(formal,withNewStore,samePool,null),null,'存在尚未正式发布的新门店时，全店重排仍需进入增量算法处理新门店');
assert.equal(buildFormalReuseResult(formal,formal,[...samePool,{barcode:'C',active:true,lifecycleStatus:'上新完成'}],null),null,'产品池发生变化时必须进入增量算法');

console.log('replan idempotency tests passed');
