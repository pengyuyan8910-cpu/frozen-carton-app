import assert from 'node:assert/strict';
import {applyWorkbookFaceWidths,preserveFormalStoresWhenOnlyAddingStores} from './source-to-app-data-preserve-face.mjs';

const data={skus:[{
  store:'蚌埠香榭兰庭生活馆mini',barcode:'A',name:'澳洲西冷牛排400g',cabinetLabel:'立柜3m-柜1',position:'第3层',displayCols:1,perCol:10,faceWidth:176,placements:[{width:176,faceWidth:176}]
}]};
const rows=[{
  门店:'蚌埠香榭兰庭生活馆mini',条码:'A',商品名称:'澳洲西冷牛排400g',优化后陈列柜:'立柜3m-柜1',优化后具体位置:'第3层',单列占宽mm:49
}];
applyWorkbookFaceWidths(data,rows);
assert.equal(data.skus[0].faceWidth,49);
assert.equal(data.skus[0].placements[0].width,49);
assert.match(data.skus[0].sourceCapacityNote,/占宽=49mm/);

const pool=[{barcode:'A',active:true},{barcode:'B',active:true}];
const formal={productPool:pool,stores:[{store:'老店',marker:'formal'}],cabinets:[{store:'老店',key:'old',length:710}],skus:[{store:'老店',barcode:'A',faceWidth:49,displayCols:1}],excluded:[]};
const incoming={productPool:pool,stores:[{store:'老店',marker:'wrong-excel-drift'},{store:'新店',marker:'incoming'}],cabinets:[{store:'老店',key:'old',length:710},{store:'新店',key:'new',length:710}],skus:[{store:'老店',barcode:'A',faceWidth:176,displayCols:9},{store:'新店',barcode:'A',faceWidth:49,displayCols:1}],excluded:[{store:'新店',barcode:'B'}],meta:{}};
const merged=preserveFormalStoresWhenOnlyAddingStores(incoming,formal);
assert.equal(merged.stores.find(s=>s.store==='老店').marker,'formal','只新增门店时老店正式数据必须原样保留');
assert.equal(merged.skus.find(s=>s.store==='老店').faceWidth,49,'只新增门店时不得采用Excel里意外漂移的老店占宽');
assert.equal(merged.stores.find(s=>s.store==='新店').marker,'incoming','新增门店必须从新Excel导入');
assert.equal(merged.skus.find(s=>s.store==='新店').faceWidth,49);
assert.deepEqual(merged.meta.addedStores,['新店']);
console.log('excel face width + incremental store import tests passed');
