import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareReplanSource} from './replan-baseline.mjs';
import {normalizeActiveProductPool,replanAllStores} from './product-pool-replan-core.mjs';

const base={
  meta:{source:'formal',generatedAt:'g',version:'v'},
  stores:[{store:'店A',type:'老店'},{store:'店B',type:'老店'}],
  cabinets:[
    {store:'店A',key:'a1',label:'立柜A',position:'第1层'},
    {store:'店B',key:'b1',label:'立柜B',position:'第1层'},
  ],
  skus:[
    {id:'a-formal',store:'店A',barcode:'A',cabinetKey:'a1',displayCols:1,note:'正式A'},
    {id:'b-formal',store:'店B',barcode:'B',cabinetKey:'b1',displayCols:1,note:'正式B'},
  ],
  productPool:[],params:{}
};
const current={
  ...structuredClone(base),
  stores:[...structuredClone(base.stores),{store:'新店C',type:'新店'}],
  cabinets:[...structuredClone(base.cabinets),{store:'新店C',key:'c1',label:'立柜C',position:'第1层'}],
  skus:[
    {...structuredClone(base.skus[0]),displayCols:9,note:'旧草稿A'},
    {...structuredClone(base.skus[1]),displayCols:8,note:'旧草稿B'},
    {id:'c-draft',store:'新店C',barcode:'C',cabinetKey:'c1',displayCols:1,note:'新增门店草稿'},
  ]
};

const allSource=prepareReplanSource(base,current,null);
assert.equal(allSource.skus.find(r=>r.store==='店A')?.displayCols,1,'全部门店重排必须以正式方案作为已有门店基准，不能继续叠加旧草稿');
assert.equal(allSource.skus.find(r=>r.store==='店B')?.displayCols,1,'全部门店重排必须重置所有已有门店到正式方案基准');
assert.equal(allSource.skus.find(r=>r.store==='新店C')?.note,'新增门店草稿','尚未正式发布的新增门店必须保留，不能因回到正式基准而丢失');

const selectedSource=prepareReplanSource(base,current,['店A']);
assert.equal(selectedSource.skus.find(r=>r.store==='店A')?.displayCols,1,'指定门店重排必须让所选已有门店从正式方案重新计算');
assert.equal(selectedSource.skus.find(r=>r.store==='店B')?.displayCols,8,'指定门店重排不得覆盖未选择门店的当前草稿');
assert.equal(selectedSource.skus.find(r=>r.store==='新店C')?.note,'新增门店草稿','指定门店重排不得删除新增门店草稿');

{
  const live=JSON.parse(fs.readFileSync(new URL('../data/app-data.json',import.meta.url),'utf8'));
  const livePool=Array.isArray(live.productPool)&&live.productPool.length?live.productPool:normalizeActiveProductPool(live.skus||[]);
  const clean=prepareReplanSource(live,live,null);
  const result=replanAllStores(clean,livePool,{preserveExisting:true,externalCapL:754});
  const failed=result.plans.filter(p=>p.status==='failed');
  assert.equal(failed.length,0,`正式底表基准下不应出现硬规则失败门店：${failed.map(p=>p.store).join('、')}`);
  console.log(`formal baseline hard failures: ${failed.length}/${result.plans.length}`);
}

console.log('replan baseline and review mode tests passed');
