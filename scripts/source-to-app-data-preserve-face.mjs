import path from 'node:path';
import {sourceToAppData as sourceToAppDataBase} from './source-to-app-data.mjs';

const text=v=>String(v??'').trim();
const num=v=>{const n=Number(String(v??'').replace(/,/g,'').replace(/[^\d.-]/g,''));return Number.isFinite(n)?n:0};
const keyOf=(store,barcode,name,cabinet,position)=>[text(store),text(barcode)||text(name),text(cabinet),text(position)].join('__');

export function applyWorkbookFaceWidths(data, rows=[]){
  const map=new Map();
  for(const row of rows){
    const face=num(row?.['单列占宽mm'] ?? row?.['单列占宽毫米'] ?? row?.['占宽mm']);
    if(!(face>0)) continue;
    const key=keyOf(row?.['门店'],row?.['条码']??row?.['商品条码'],row?.['商品名称']??row?.['商品'],row?.['优化后陈列柜']??row?.['陈列柜'],row?.['优化后具体位置']??row?.['具体位置']);
    map.set(key,face);
  }
  for(const sku of data?.skus||[]){
    const key=keyOf(sku.store,sku.barcode,sku.name,sku.cabinetLabel||sku.sourceCabinet,sku.position||sku.sourcePosition);
    const face=map.get(key);
    if(!(face>0)) continue;
    sku.faceWidth=face;
    if(Array.isArray(sku.placements)) sku.placements=sku.placements.map(p=>({...p,width:face,faceWidth:face}));
    const cols=Math.max(0,num(sku.displayCols));
    sku.sourceCapacityNote=`占宽=${Number((cols*face).toFixed(1))}mm；单列容量=${num(sku.perCol)}`;
  }
  return data;
}

async function workbookSkuRows(sourcePath){
  if(!/\.xlsx$/i.test(sourcePath)) return [];
  const xlsxModule=await import('xlsx');
  const xlsx=xlsxModule.default||xlsxModule;
  const wb=xlsx.readFile(sourcePath,{cellDates:false});
  const sheet=wb.Sheets['10%触发_SKU明细'];
  return sheet?xlsx.utils.sheet_to_json(sheet,{defval:''}):[];
}

export async function sourceToAppData(sourcePath, oldData={}){
  const data=await sourceToAppDataBase(sourcePath,oldData);
  if(!/\.xlsx$/i.test(sourcePath)) return data;
  const rows=await workbookSkuRows(sourcePath);
  return applyWorkbookFaceWidths(data,rows);
}

export default {sourceToAppData,applyWorkbookFaceWidths};
