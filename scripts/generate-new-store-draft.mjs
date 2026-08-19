import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceToAppData} from './source-to-app-data-preserve-face.mjs';
import {writeAppDataWorkbook} from './app-data-to-workbook.mjs';
import {allocateStore} from './strict-allocation-engine.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'data','source','整箱到店数据测算_当前版.xlsx');
const cfgXlsx=path.join(root,'data','new-store','新增门店配置.xlsx');
const selectedConfig=process.env.NEW_STORE_CONFIG_PATH?path.resolve(root,process.env.NEW_STORE_CONFIG_PATH):cfgXlsx;
const cfgJson=path.join(root,'data','new-store','新增门店配置.json');
const outDir=path.join(root,'data','drafts');
const U={
  store:'门店名称',storeType:'门店类型',cap:'外储上限L',kind:'冰柜类型',model:'型号/名称',qty:'数量',dim:'内径尺寸',doors:'门数',layers:'层数',length:'单层长mm',depth:'单层深mm',height:'单层高mm',
  vertical:'立柜',storage:'存储位',included:'纳入',missing:'暂不纳入',draft:'自动严格排柜草稿',layer:'第',floor:'层',zone:'分区',cab:'柜'
};
const n=v=>{const x=Number(String(v??'').replace(/,/g,'').replace(/[^\d.-]/g,''));return Number.isFinite(x)?x:0};
const s=v=>String(v??'').trim();
const ckey=(store,label,pos)=>`${store}__${label}__${pos}`;

async function getXlsx(){const m=await import('xlsx');return m.default||m}
function dimensions(v){
  const parts=s(v).split('+').filter(Boolean).map(x=>x.trim().split('*').map(n)).filter(x=>x.length===3&&x.every(y=>y>0));
  if(s(v)&&!parts.length)throw Error('invalid cabinet dimensions');
  return parts;
}
async function config(){
  if(fs.existsSync(selectedConfig)&&path.extname(selectedConfig).toLowerCase()==='.json')return JSON.parse(fs.readFileSync(selectedConfig,'utf8').replace(/^\uFEFF/,''));
  if(fs.existsSync(selectedConfig)){
    const x=await getXlsx();
    const wb=x.readFile(selectedConfig);
    const ws=wb.Sheets['门店配置'];
    if(!ws)throw Error('config workbook is missing store configuration sheet');
    const rows=x.utils.sheet_to_json(ws,{defval:''}).filter(r=>s(r[U.store])&&s(r[U.kind]));
    if(!rows.length)throw Error('config workbook has no usable cabinet rows');
    const stores=[...new Set(rows.map(r=>s(r[U.store])))];
    if(stores.length!==1)throw Error('only one store is allowed per draft');
    return{
      name:stores[0],type:s(rows[0][U.storeType])||'新店',cap:Math.max(1,n(rows[0][U.cap])||754),
      cabinets:rows.map(r=>({type:s(r[U.kind]),model:s(r[U.model])||s(r[U.kind]),quantity:n(r[U.qty])||1,dimensions:s(r[U.dim]),doors:n(r[U.doors]),layers:n(r[U.layers]),length:n(r[U.length]),depth:n(r[U.depth]),height:n(r[U.height])}))
    };
  }
  if(process.env.NEW_STORE_CONFIG_PATH)throw Error('selected new-store configuration file not found');
  if(!fs.existsSync(cfgJson))throw Error('new-store configuration file not found');
  return JSON.parse(fs.readFileSync(cfgJson,'utf8').replace(/^\uFEFF/,''));
}
function normModel(v){const x=s(v).replace(/mm/ig,'').replace(/\s+/g,'');return x==='2500'?'2505':x}
function buildCabinets(cfg){
  const out=[],counters=new Map();
  const next=(kind,model)=>{const k=`${kind}|${model}`,v=(counters.get(k)||0)+1;counters.set(k,v);return v};
  for(const row of cfg.cabinets||[]){
    const qty=Math.max(1,Math.floor(n(row.quantity)||1)),kind=s(row.type),model=normModel(row.model||row.type);
    if(kind.includes(U.vertical)){
      const doors=Math.max(1,Math.floor(n(row.doors)||(/2\.5/.test(model)?3:/3/.test(model)?4:1)));
      const layers=Math.max(6,Math.floor(n(row.layers)||6));
      if(!(n(row.length)&&n(row.depth)&&n(row.height)))throw Error('vertical cabinet requires shelf length, depth and height');
      for(let q=0;q<qty;q++)for(let d=0;d<doors;d++){
        const label=`${U.vertical}${model}-${U.cab}${next(U.vertical,model)}`;
        for(let l=1;l<=layers;l++){
          const position=`${U.layer}${l}${U.floor}`;
          out.push({id:`draft_cab_${out.length+1}`,store:cfg.name,kind:U.vertical,label,position,key:ckey(cfg.name,label,position),length:n(row.length),depth:n(row.depth),height:n(row.height),status:l===6?U.storage:'正常'});
        }
      }
      continue;
    }
    const parts=dimensions(row.dimensions);
    if(!parts.length)throw Error('chest/ice cabinet requires dimensions');
    for(let q=0;q<qty;q++){
      const label=`${kind}${model}-${U.cab}${next(kind,model)}`;
      parts.forEach((d,i)=>{const position=`${U.zone}${i+1}`;out.push({id:`draft_cab_${out.length+1}`,store:cfg.name,kind,label,position,key:ckey(cfg.name,label,position),length:d[0],depth:d[1],height:d[2],status:'正常'})});
    }
  }
  return out;
}

function strictSolve(base,cfg){
  const params={...(base.params||{}),triggerRate:.1,p95Factor:n(base.params?.p95Factor)||1.241748,externalSafetyFactor:1.2,externalCapL:n(cfg.externalCapL)||n(cfg.cap)||754};
  const enginePlan=allocateStore({store:cfg.name,type:cfg.type||'新店',productPool:base.productPool||[],cabinets:buildCabinets(cfg),params,physicalRecords:[]});
  const skus=(enginePlan.skus||[]).map(r=>({...r,status:r.included?U.included:U.missing,reason:r.reason||r.unplacedReason||(!r.included?'严格引擎未找到合法陈列位':''),rowFull:r.fullCount||0,skuFull:r.fullCount||0,displayCols:r.displayCols||0,perCol:r.perCol||0,faceWidth:r.faceWidth||0}));
  const cabinets=(enginePlan.cabinets||[]).map(c=>{const used=c.used??c.sourceUsed??0,left=c.left??c.sourceLeft??Math.max(0,n(c.length)-n(used));return{...c,used,sourceUsed:used,sourceLeft:left}});
  return{store:enginePlan.store,type:enginePlan.type,cap:enginePlan.params.externalCapL,factor:enginePlan.params.p95Factor,cabinets,skus,included:skus.filter(r=>r.included),missing:skus.filter(r=>!r.included),enginePlan,strict:true};
}
function strictVerify(p){
  const validation=p.enginePlan.validation,summary=p.enginePlan.summary;
  return{passed:validation.ok,errors:[...validation.errors],warnings:[...validation.warnings],metrics:{skuCount:summary.placedSkuCount,missingSkuCount:summary.unplacedSkuCount,directSku:summary.directSkuCount,externalSku:summary.externalSkuCount,staticExternalL:summary.staticExternalL,dynamicAvgExternalL:summary.avgExternalL,dynamicP95L:summary.p95ExternalL,suggestedExternalL:summary.suggestedExternalL}};
}
let solve=strictSolve;
let verify=strictVerify;

function draft(base,p){
  const validation=verify(p),m=validation.metrics;
  return{
    meta:{source:U.draft,configFile:path.relative(root,selectedConfig),version:'10%触发-新增门店严格草稿',generatedAt:new Date().toLocaleString('zh-CN',{hour12:false})},
    params:{...(base.params||{}),triggerRate:.1,externalCapL:p.cap,externalSafetyFactor:1.2},
    productPool:base.productPool,
    stores:[{store:p.store,type:p.type,vertical:'自定义配置',chest:'自定义配置',ice:'自定义配置',p95Factor:p.factor,...m,over754:m.suggestedExternalL>p.cap,sourceNote:'自动严格排柜草稿，须人工确认后并入正式底表'}],
    cabinets:p.cabinets.map(({placements,items,...c})=>c),
    skus:p.skus,
    excluded:p.missing.map(r=>({store:p.store,trigger:'小于等于10%触发',status:U.missing,reason:r.reason||'空间或外储约束',grade:r.grade,rank:r.rank,category2:r.category2,category3:r.category3,category4:r.category4,name:r.name,barcode:r.barcode})),
    rules:[{'规则':U.draft,'说明':'按10%触发、754L外储约束、四级品类集中、冰品专柜、立柜第6层仅存储、柜段不超宽生成；所有正常销售柜段按统一规则参与排柜，仅作草稿，不覆盖正式底表。'}],
    validation
  };
}
async function main(){
  if(!fs.existsSync(source))throw Error('official workbook not found');
  const cfg=await config(),base=await sourceToAppData(source,{}),p=solve(base,cfg),data=draft(base,p);
  if(!data.validation.passed)throw Error(`strict planning failed: ${data.validation.errors.join('; ')}`);
  fs.mkdirSync(outDir,{recursive:true});
  await writeAppDataWorkbook(data,path.join(outDir,'新增门店_严格排柜结果.xlsx'),{formulaDriven:true});
  fs.writeFileSync(path.join(outDir,'新增门店_严格排柜结果.json'),JSON.stringify(data,null,2),'utf8');
  fs.writeFileSync(path.join(outDir,'新增门店_严格排柜复核报告.json'),JSON.stringify(data.validation,null,2),'utf8');
  console.log(JSON.stringify({store:cfg.name,...data.validation.metrics,warnings:data.validation.warnings},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exit(1)});
