const text=v=>String(v??'').trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));

function productKey(row){return text(row?.barcode)||text(row?.name)}
function gradeScore(row){return ({A:4,B:3,C:2,D:1}[text(row?.grade).toUpperCase()]||0)}
function rankValue(row){const n=num(row?.rank);return n>0?n:999999}
function categoryKey(row){return text(row?.category4)||text(row?.category3)||text(row?.category2)}
function isLayer6(row){return /第?6层|六层|存储/.test(`${text(row?.position)} ${text(row?.status)}`)}
function isIceCabinet(row){return /冰淇淋|冰品|雪糕/.test(`${text(row?.kind)} ${text(row?.label)} ${text(row?.cabinetLabel)}`)}
function isIceProduct(row){return /冰淇淋|冰品|雪糕|棒冰|甜筒|冰棒|冰棍/.test(`${text(row?.category2)} ${text(row?.category3)} ${text(row?.category4)} ${text(row?.name)}`)}
function isUpright(row){return /立柜/.test(`${text(row?.kind)} ${text(row?.label)} ${text(row?.cabinetLabel)}`)}
function usableCabinet(row){return row&&num(row.length)>0&&num(row.depth)>0&&num(row.height)>0&&!isLayer6(row)}
function rowWidth(row){return Math.max(0,num(row?.displayCols)||1)*Math.max(0,num(row?.faceWidth))}
function itemVolumeL(row){return num(row?.volume)||num(row?.length)*num(row?.width)*num(row?.height)/1e6}
function safeId(value){return text(value).replace(/[^\w\u4e00-\u9fa5-]+/g,'_').slice(0,80)}

function orientationCandidates(product,cabinet){
  const l=num(product?.length),w=num(product?.width),h=num(product?.height);
  const cw=num(cabinet?.length),depth=num(cabinet?.depth),height=num(cabinet?.height);
  if(!(l>0&&w>0&&h>0&&cw>0&&depth>0&&height>0)||h>height+1e-6)return [];
  const stack=!isUpright(cabinet);
  const out=[];
  for(const [face,d] of [[l,w],[w,l]]){
    if(face>cw+1e-6||d>depth+1e-6)continue;
    const deep=Math.max(1,Math.floor((depth+1e-6)/d));
    const high=stack?Math.max(1,Math.floor((height+1e-6)/h)):1;
    out.push({face,depth:d,perCol:Math.max(1,deep*high),deep,high});
  }
  // 同容量时优先更窄正面，给更多SKU留下横向空间。
  out.sort((a,b)=>(b.perCol/a.face)-(a.perCol/b.face)||a.face-b.face||b.perCol-a.perCol);
  return out;
}

function sameProductSet(pool=[]){
  const map=new Map();
  for(const p of pool||[]){const key=productKey(p);if(key&&!map.has(key))map.set(key,p)}
  return map;
}

function buildSegmentState(data,store){
  const cabinets=(data?.cabinets||[]).filter(c=>text(c.store)===store&&usableCabinet(c));
  const segments=new Map();
  for(const cab of cabinets){
    segments.set(text(cab.key),{cab,used:0,rows:[],categoryCounts:new Map()});
  }
  return segments;
}

function addUsage(segment,row){
  const width=rowWidth(row);
  segment.used+=width;
  segment.rows.push(row);
  const cat=categoryKey(row); if(cat)segment.categoryCounts.set(cat,(segment.categoryCounts.get(cat)||0)+1);
}

function rowPhysicallyValid(row,product,segment){
  if(!segment||!usableCabinet(segment.cab))return false;
  if(isIceProduct(product)!==isIceCabinet(segment.cab))return false;
  const face=num(row?.faceWidth),per=num(row?.perCol),cols=Math.max(1,num(row?.displayCols)||1);
  if(!(face>0&&per>0))return false;
  const orientations=orientationCandidates(product,segment.cab);
  if(!orientations.some(o=>Math.abs(o.face-face)<1e-6&&o.perCol===per))return false;
  return segment.used+face*cols<=num(segment.cab.length)+1e-6;
}

function chooseCandidate(product,segments){
  const ice=isIceProduct(product),cat=categoryKey(product);
  let best=null;
  for(const segment of segments.values()){
    if(isIceCabinet(segment.cab)!==ice)continue;
    const remain=num(segment.cab.length)-segment.used;
    if(remain<=0)continue;
    for(const o of orientationCandidates(product,segment.cab)){
      if(o.face>remain+1e-6)continue;
      const adjacency=cat?(segment.categoryCounts.get(cat)||0):0;
      const residual=remain-o.face;
      // 先保证同品类集中，其次单位宽度容量，最后减少碎片。
      const score=adjacency*1e9+(o.perCol/o.face)*1e6-residual;
      if(!best||score>best.score)best={segment,o,score};
    }
  }
  return best;
}

function seedRow(product,store,segment,o,index){
  return {
    ...clone(product),
    id:`bizseed_${safeId(store)}_${safeId(productKey(product))}_${index}`,
    store,
    included:true,
    status:'产品池业务优化种子',
    cabinetKey:text(segment.cab.key),
    cabinetLabel:text(segment.cab.label),
    position:text(segment.cab.position),
    displayCols:1,
    perCol:o.perCol,
    faceWidth:o.face,
    customPlacement:true,
    sourceAdvice:'SKU覆盖优先+外储优化',
    sourceAction:'业务优化后交严格引擎复核',
    note:'产品池重排业务优化种子',
  };
}

function fullCapacity(rows,key){
  return rows.filter(r=>productKey(r)===key&&r.included!==false).reduce((s,r)=>s+Math.max(0,num(r.displayCols))*Math.max(0,num(r.perCol)),0);
}
function externalPieces(product,rows){
  const full=fullCapacity(rows,productKey(product));
  const trigger=Math.ceil(full*.10);
  const receive=Math.max(0,full-trigger);
  return Math.max(0,Math.max(1,num(product?.carton)||1)-Math.min(Math.max(1,num(product?.carton)||1),receive));
}
function marginalExternalReduction(product,row,rows){
  const before=externalPieces(product,rows);
  const afterRows=rows.map(r=>r===row?{...r,displayCols:Math.max(1,num(r.displayCols)||1)+1}:r);
  const after=externalPieces(product,afterRows);
  return Math.max(0,before-after)*itemVolumeL(product);
}

function expandFacings(rows,poolMap,segments){
  // 先按“每1mm宽度能减少多少外储L”扩陈；这是确认版中压外储的关键步骤。
  for(let guard=0;guard<20000;guard++){
    let best=null;
    for(const row of rows){
      if(row.included===false)continue;
      const segment=segments.get(text(row.cabinetKey)); if(!segment)continue;
      const remain=num(segment.cab.length)-segment.used;
      const face=num(row.faceWidth); if(!(face>0)||face>remain+1e-6)continue;
      const product=poolMap.get(productKey(row))||row;
      const reduction=marginalExternalReduction(product,row,rows);
      if(reduction<=0)continue;
      const grade=gradeScore(product);
      const score=(reduction/face)*1e9+grade*1e4-rankValue(product);
      if(!best||score>best.score)best={row,segment,face,score};
    }
    if(!best)break;
    best.row.displayCols=Math.max(1,num(best.row.displayCols)||1)+1;
    best.segment.used+=best.face;
  }

  // 再把>300mm的正常销售层余量用于高等级商品扩陈，避免确认版已消除的大片空位重新出现。
  for(const segment of segments.values()){
    if(isIceCabinet(segment.cab))continue;
    let guard=0;
    while(num(segment.cab.length)-segment.used>300+1e-6&&guard++<1000){
      const candidates=segment.rows
        .filter(r=>num(r.faceWidth)>0&&num(r.faceWidth)<=num(segment.cab.length)-segment.used+1e-6)
        .sort((a,b)=>gradeScore(poolMap.get(productKey(b))||b)-gradeScore(poolMap.get(productKey(a))||a)||rankValue(poolMap.get(productKey(a))||a)-rankValue(poolMap.get(productKey(b))||b)||num(a.faceWidth)-num(b.faceWidth));
      if(!candidates.length)break;
      const row=candidates[0]; row.displayCols=Math.max(1,num(row.displayCols)||1)+1; segment.used+=num(row.faceWidth);
    }
  }
}

function optimizeStore(data,poolMap,store,{fullCoverage=false,newProductKeys=new Set()}={}){
  const segments=buildSegmentState(data,store);
  if(!segments.size)return null;
  const current=(data?.skus||[]).filter(r=>text(r.store)===store&&r.included!==false&&poolMap.has(productKey(r)));
  const rows=[];
  const represented=new Set();

  // 合法的历史位置原样保留。业务优化层不会为了“重新算一套更漂亮的”去搬老品。
  for(const old of current){
    const product=poolMap.get(productKey(old)); const segment=segments.get(text(old.cabinetKey));
    const candidate={...clone(old),included:true};
    if(!rowPhysicallyValid(candidate,product,segment))continue;
    rows.push(candidate); represented.add(productKey(product)); addUsage(segment,candidate);
  }

  let targets=[...poolMap.values()].filter(p=>!represented.has(productKey(p))&&(fullCoverage||newProductKeys.has(productKey(p))));
  targets.sort((a,b)=>{
    const ai=isIceProduct(a),bi=isIceProduct(b); if(ai!==bi)return ai?1:-1;
    return gradeScore(b)-gradeScore(a)||rankValue(a)-rankValue(b)||itemVolumeL(a)-itemVolumeL(b)||productKey(a).localeCompare(productKey(b),'zh-CN');
  });
  let index=0;
  for(const product of targets){
    const best=chooseCandidate(product,segments); if(!best)continue;
    const row=seedRow(product,store,best.segment,best.o,index++);
    rows.push(row); represented.add(productKey(product)); addUsage(best.segment,row);
  }

  expandFacings(rows,poolMap,segments);
  return rows;
}

function storeTypeMap(data){return new Map((data?.stores||[]).map(s=>[text(s.store),text(s.type)]))}
function activeBaseKeys(base){
  const map=sameProductSet(base?.productPool||[]);
  if(map.size)return new Set(map.keys());
  return new Set((base?.skus||[]).map(productKey).filter(Boolean));
}

/**
 * 只负责建立“业务优化种子”，严格排柜引擎仍是唯一最终校验器。
 * - 老店：合法历史陈列锁定，只处理真正新增SKU；
 * - 新店/无历史SKU门店：按覆盖优先完整建立种子，再扩陈降低外储；
 * - 不使用高度翻转；立柜第6层不参与；冰品严格隔离。
 */
export function prepareBusinessOptimizedSeed(data,pool,{formalBase=data}={}){
  const working=clone(data||{}),poolMap=sameProductSet(pool||[]),types=storeTypeMap(working);
  const baseKeys=activeBaseKeys(formalBase||{});
  const newProductKeys=new Set([...poolMap.keys()].filter(k=>!baseKeys.has(k)));
  const stores=new Set((working.stores||[]).map(s=>text(s.store)).filter(Boolean));
  for(const c of working.cabinets||[])if(text(c.store))stores.add(text(c.store));

  const replacements=new Map();
  for(const store of stores){
    const currentIncluded=(working.skus||[]).filter(r=>text(r.store)===store&&r.included!==false&&poolMap.has(productKey(r))).length;
    const fullCoverage=/新/.test(types.get(store)||'')||currentIncluded===0;
    if(!fullCoverage&&!newProductKeys.size)continue;
    const optimized=optimizeStore(working,poolMap,store,{fullCoverage,newProductKeys});
    if(optimized)replacements.set(store,optimized);
  }
  if(!replacements.size)return working;
  const untouched=(working.skus||[]).filter(r=>!replacements.has(text(r.store)));
  working.skus=[...untouched,...[...replacements.values()].flat()];
  working.replanSeedMeta={mode:'coverage-first-business-optimizer',optimizedStores:[...replacements.keys()]};
  return working;
}

export default {prepareBusinessOptimizedSeed};
