import assert from 'node:assert/strict';
import { allocateStore } from './strict-allocation-engine.mjs';

const product = (overrides={}) => ({
  active:true, lifecycleStatus:'在售SKU', name:'测试水饺', barcode:'1001', grade:'A', rank:1,
  category2:'预制主食', category3:'面点', category4:'水饺馄饨', length:100,width:200,height:50,volume:1,carton:10,dailyQty:1,
  ...overrides,
});
const cab = (key,label,position,kind='立柜',length=710,depth=534,height=250,status='正常') => ({
  store:'测试店', key,label,position,kind,length,depth,height,status,
});
const input=(products,cabinets,preferredPlacements=[])=>({store:'测试店',type:'新店',productPool:products,cabinets,preferredPlacements,params:{triggerRate:.1,externalCapL:754,p95Factor:1.2,externalSafetyFactor:1.2}});

{
  const p=product();
  const cabinets=[cab('c4l1','立柜3m-柜4','第1层'),cab('c4l6','立柜3m-柜4','第6层')];
  const plan=allocateStore(input([p],cabinets,[{skuKey:'1001',segmentKey:'c4l1',displayCols:1}]));
  const d=plan.skuDecisions.find(x=>x.barcode==='1001');
  assert.equal(d.included,true,'柜4第1层应可用于冻品');
  assert.equal(d.placements[0].segmentKey,'c4l1','合法偏好应保留柜4第1层');
  assert.ok(!plan.skus.some(r=>r.cabinetKey==='c4l6'),'第6层不得参与陈列');
}

{
  const ice=product({name:'测试冰淇淋',barcode:'ice1',category2:'雪糕冰品',category3:'雪糕冰品',category4:'雪糕冰淇淋'});
  const cabinets=[cab('upright','立柜3m-柜1','第1层'),cab('ice','冰淇淋柜1900-柜1','分区1','冰淇淋柜',1400,697,447)];
  const plan=allocateStore(input([ice],cabinets,[{skuKey:'ice1',segmentKey:'upright'}]));
  const d=plan.skuDecisions.find(x=>x.barcode==='ice1');
  assert.equal(d.included,true);
  assert.equal(d.placements[0].cabinetType,'冰淇淋柜','非法老位置偏好必须回退到冰淇淋柜');
}

{
  const p=product({barcode:'p2'});
  const cabinets=[cab('a','立柜3m-柜1','第1层'),cab('b','立柜3m-柜2','第1层')];
  const plan=allocateStore(input([p],cabinets,[{skuKey:'p2',segmentKey:'b',displayCols:2}]));
  const d=plan.skuDecisions.find(x=>x.barcode==='p2');
  assert.equal(d.placements[0].segmentKey,'b');
  assert.ok(d.placements[0].displayCols>=2,'合法偏好列数应作为起点保留');
}

{
  const p=product({barcode:'noflip',length:500,width:100,height:300,category2:'预制主食'});
  const cabinets=[cab('low','立柜3m-柜1','第1层','立柜',710,250,250)];
  const plan=allocateStore(input([p],cabinets,[]));
  assert.equal(plan.summary.placedSkuCount,0,'商品高度不得通过翻转进入低于商品高度的柜段');
}
{
  const old=product({barcode:'old',grade:'D',carton:20,volume:10});
  const fresh=product({barcode:'new',grade:'B',carton:20,volume:10});
  const cabinets=[cab('c1','立柜3m-柜1','第1层','立柜',710,534,250),cab('c2','立柜3m-柜2','第1层','立柜',710,534,250)];
  const plan=allocateStore({store:'测试店',type:'老店',productPool:[old,fresh],cabinets,preferredPlacements:[{skuKey:'old',segmentKey:'c1',displayCols:1,faceWidth:100,perCol:5,widthUsed:100}],params:{triggerRate:.1,externalCapL:10,p95Factor:1,externalSafetyFactor:1}});
  assert.equal(plan.skuDecisions.find(x=>x.barcode==='old').included,true,'外储回调必须优先保留已验证老品');
  assert.equal(plan.skuDecisions.find(x=>x.barcode==='new').included,false,'外储回调应先撤回本轮新增SKU');
}

console.log('strict replan engine tests passed');
