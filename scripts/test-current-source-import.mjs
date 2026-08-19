import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sourceToAppData} from './source-to-app-data-preserve-face.mjs';
import {verifyAppData} from './verify-app-data.mjs';

const source=path.resolve('data/source/整箱到店数据测算_当前版.xlsx');
const oldData=JSON.parse(fs.readFileSync(path.resolve('data/app-data.json'),'utf8').replace(/^\uFEFF/,''));
const data=await sourceToAppData(source,oldData);
for(const row of data.skus||[]){
  if(row.externalOwner!==false)continue;
  row.externalCountOverride=0;row.staticExternalOverride=0;row.avgExternalOverride=0;
}
const report=verifyAppData(data);
console.log(JSON.stringify({stores:data.stores.length,pool:data.productPool?.length,over:report.metrics?.overCabinetCount,large:report.metrics?.largeUsedLeftCount,errors:report.errors},null,2));
assert.equal(data.stores.length,32,'当前上传底表应生成32家门店');
assert.ok(data.stores.some(s=>s.store==='三山星悦广场生活馆'),'缺少三山星悦广场生活馆');
assert.ok(data.stores.some(s=>s.store==='芜湖凤凰城生活馆'),'缺少芜湖凤凰城生活馆');
assert.equal(report.metrics?.overCabinetCount,0,'当前上传底表不得出现柜段超宽');
assert.equal(report.passed,true,`当前上传底表必须通过发布校验：${(report.errors||[]).join('；')}`);
console.log('current uploaded workbook end-to-end import passed');
