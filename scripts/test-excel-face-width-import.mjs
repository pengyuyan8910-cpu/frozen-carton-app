import assert from 'node:assert/strict';
import {applyWorkbookFaceWidths} from './source-to-app-data-preserve-face.mjs';

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
console.log('excel face width import tests passed');
