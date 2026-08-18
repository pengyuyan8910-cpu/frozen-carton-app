import { allocateStore, validatePlan, planSignature } from './strict-allocation-engine.mjs';

const text=v=>String(v??'').trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
export const DRAFT_STORAGE_KEY='frozen_carton_unified_scene_draft_v1';
export const PUBLISHED_STORAGE_KEY='frozen_carton_unified_scene_published_v1';

export function productKey(row){return text(row?.barcode)||text(row?.name)||text(row?.skuKey)||text(row?.id)}

export function normalizeActiveProductPool(products=[]){
  const seen=new Set(), out=[];
  for(const raw of products||[]){
    if(!raw)continue;
    const status=text(raw.lifecycleStatus||raw.status||raw.productStatus);
    const active=raw.active!==false;
    const explicitLifecycle=!!status;
    const allowedLifecycle=/^(在售SKU|上新完成)$/.test(status);
    if(!active)continue;
    if(explicitLifecycle && !allowedLifecycle)continue;
    if(/淘汰完成|已淘汰|停售/.test(status))continue;
    const key=productKey(raw); if(!key||seen.has(key))continue; seen.add(key);
    out.push({...clone(raw),active:true,skuKey:key,lifecycleStatus:status||raw.lifecycleStatus||''});
  }
  return out.sort((a,b)=>(num(a.rank)||999999)-(num(b.rank)||999999)||productKey(a).localeCompare(productKey(b),'zh-CN'));
}

export function applyAppStatePatch(base,patch){
  if(!patch||!patch._patchVersion)return clone(base);
  const state=clone(base);
  const del=new Set(patch.deletedIds||[]);
  state.skus=(state.skus||[]).filter(r=>!del.has(r.id));
  state.stores=[...(state.stores||[]),...(patch.newStores||[])];
  state.cabinets=[...(state.cabinets||[]),...(patch.newCabinets||[])];
  const map=new Map((state.skus||[]).map(r=>[r.id,r]));
  for(const p of patch.skus||[]){const r=map.get(p.id);if(r)Object.assign(r,p.values||{})}
  for(const r of patch.newSkus||[])state.skus.push(clone(r));
  if(Array.isArray(patch.productPool))state.productPool=clone(patch.productPool);
  if(patch.lifecycle&&typeof patch.lifecycle==='object')state.lifecycle=clone(patch.lifecycle);
  return state;
}

export function buildPreferredPlacements(data,store,pool){
  const activeKeys=new Set(pool.map(productKey));
  const seenType=new Set();
  const preferences=[];
  const cabinetMap=new Map((data.cabinets||[]).filter(c=>text(c.store)===text(store)).map(c=>[text(c.key),c]));
  for(const row of (data.skus||[]).filter(r=>text(r.store)===text(store)&&r.included!==false)){
    const key=productKey(row); if(!activeKeys.has(key))continue;
    const cab=cabinetMap.get(text(row.cabinetKey)); if(!cab)continue;
    const type=text(cab.kind||cab.type||row.cabinetTypeFilter);
    const uniqueness=`${key}|${type}`; if(seenType.has(uniqueness))continue; seenType.add(uniqueness);
    preferences.push({skuKey:key,segmentKey:text(row.cabinetKey),cabinetType:type,displayCols:Math.max(1,Math.floor(num(row.displayCols)||1))});
  }
  return preferences;
}

function storeNames(data){
  const set=new Set((data.stores||[]).map(s=>text(s.store)).filter(Boolean));
  for(const c of data.cabinets||[])if(text(c.store))set.add(text(c.store));
  return [...set];
}

function storeSummaryFromPlan(storeConfig,plan,poolCount){
  const s=plan.summary||{};
  return {
    ...clone(storeConfig||{}),
    store:plan.store,
    type:plan.type||storeConfig?.type||'门店',
    skuCount:s.placedSkuCount||0,
    directSku:s.directSkuCount||0,
    externalSku:s.externalSkuCount||0,
    staticExternalL:s.staticExternalL||0,
    dynamicAvgExternalL:s.avgExternalL||0,
    dynamicP95L:s.p95ExternalL||0,
    suggestedExternalL:s.suggestedExternalL||0,
    over754:num(s.suggestedExternalL)>num(s.externalCapL||754),
    missingSkuCount:Math.max(0,poolCount-(s.placedSkuCount||0)),
    excludedSku:Math.max(0,poolCount-(s.placedSkuCount||0)),
  };
}

export function replanAllStores(data,products,options={}){
  const pool=normalizeActiveProductPool(products);
  const plans=[]; const errors=[];
  for(const store of storeNames(data)){
    const config=(data.stores||[]).find(s=>text(s.store)===store)||{store,type:'门店'};
    const cabinets=(data.cabinets||[]).filter(c=>text(c.store)===store);
    if(!cabinets.length){errors.push(`${store}：没有可用冰柜配置`);continue}
    const preferredPlacements=options.preserveExisting===false?[]:buildPreferredPlacements(data,store,pool);
    const plan=allocateStore({
      store,type:config.type,storeConfig:config,stores:data.stores||[],productPool:pool,cabinets,
      params:{...(data.params||{}),externalCapL:num(options.externalCapL)||num(data.params?.externalCapL)||754},
      p95Factor:config.p95Factor||data.params?.p95Factor,physicalRecords:data.physicalRecords||[],preferredPlacements,
    });
    plans.push(plan);
  }
  const draft=buildReplanDraft(data,pool,plans);
  const validation=validateReplanResult({pool,plans,draft,errors});
  return {pool,plans,draft,errors,validation,signature:plans.map(p=>`${p.store}:${planSignature(p)}`).join('\n')};
}

export function buildReplanDraft(sourceData,pool,plans){
  const storeByName=new Map((sourceData.stores||[]).map(s=>[text(s.store),s]));
  const stores=[]; const skus=[]; const excluded=[];
  const plannedCabinets=new Map();
  for(const plan of plans){
    stores.push(storeSummaryFromPlan(storeByName.get(plan.store),plan,pool.length));
    for(const c of plan.cabinets||[])plannedCabinets.set(text(c.key),c);
    for(const r of plan.skus||[]){
      skus.push({...clone(r),store:plan.store,sourceAdvice:'产品池一键重排',note:r.included===false?(r.reason||r.unplacedReason||'严格排柜未纳入'):'产品池一键重排生成'});
    }
    for(const d of plan.skuDecisions||[]){if(!d.included)excluded.push({store:plan.store,status:'暂不纳入',reason:d.reason||d.unplacedReason||'严格排柜未纳入',grade:d.grade,rank:d.rank,category2:d.category2,category3:d.category3,category4:d.category4,name:d.name,barcode:d.barcode});}
  }
  const plannedStores=new Set(stores.map(s=>s.store));
  for(const s of sourceData.stores||[])if(!plannedStores.has(text(s.store)))stores.push(clone(s));
  const cabinets=(sourceData.cabinets||[]).map(c=>plannedCabinets.has(text(c.key))?{...clone(c),sourceUsed:plannedCabinets.get(text(c.key)).sourceUsed??plannedCabinets.get(text(c.key)).used,sourceLeft:plannedCabinets.get(text(c.key)).sourceLeft??plannedCabinets.get(text(c.key)).left,status:plannedCabinets.get(text(c.key)).status||c.status}:clone(c));
  return {
    ...clone(sourceData),
    stores,skus,cabinets,productPool:clone(pool),excluded,
    meta:{...(sourceData.meta||{}),version:'产品池一键重排草稿',generatedAt:new Date().toLocaleString('zh-CN',{hour12:false})},
    replanMeta:{generatedAt:new Date().toISOString(),engine:'unified-strict-v1',poolCount:pool.length,storeCount:plans.length}
  };
}

export function validateReplanResult(result){
  const errors=[...(result.errors||[])], warnings=[];
  const pool=result.pool||[];
  for(const plan of result.plans||[]){
    const v=validatePlan(plan,{externalCapL:754});
    if(!v.ok)for(const e of v.errors||[])errors.push(`${plan.store}：${e}`);
    for(const w of plan.validation?.warnings||[])warnings.push(`${plan.store}：${w}`);
    const decisions=plan.skuDecisions||[];
    if(decisions.length!==pool.length)errors.push(`${plan.store}：SKU守恒失败（${decisions.length}/${pool.length}）`);
    const missing=decisions.filter(d=>!d.included&&!text(d.reason||d.unplacedReason));
    if(missing.length)errors.push(`${plan.store}：存在${missing.length}个未排入SKU缺少原因`);
  }
  return {ok:errors.length===0,passed:errors.length===0,errors,warnings,storeCount:(result.plans||[]).length,poolCount:pool.length};
}

export function buildAppDraftPatch(base,draft,lifecycle=null){
  const signature=[base?.meta?.source,base?.meta?.generatedAt,base?.meta?.version].join('|');
  const baseStore=new Set((base.stores||[]).map(s=>text(s.store)));
  const baseCab=new Set((base.cabinets||[]).map(c=>text(c.key)));
  return {
    _patchVersion:2,_dataSignature:signature,
    skus:[],
    newSkus:clone(draft.skus||[]),
    deletedIds:(base.skus||[]).map(r=>r.id).filter(Boolean),
    newStores:(draft.stores||[]).filter(s=>!baseStore.has(text(s.store))).map(clone),
    newCabinets:(draft.cabinets||[]).filter(c=>!baseCab.has(text(c.key))).map(clone),
    productPool:clone(draft.productPool||[]),
    lifecycle:lifecycle?clone(lifecycle):(draft.lifecycle?clone(draft.lifecycle):null),
  };
}

export default {normalizeActiveProductPool,applyAppStatePatch,buildPreferredPlacements,replanAllStores,buildReplanDraft,validateReplanResult,buildAppDraftPatch};
