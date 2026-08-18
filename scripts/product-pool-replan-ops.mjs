import {
  applyAppStatePatch,
  buildPreferredPlacements,
  buildReferencePlacements,
  buildReplanDraft,
  normalizeActiveProductPool,
  productKey,
  validateReplanResult,
} from './product-pool-replan-core.mjs';
import { allocateStore, planSignature } from './strict-allocation-engine.mjs';

const text=v=>String(v??'').trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);

const EXISTING_PATCH_FIELDS=[
  'included','grade','rank','category2','category3','category4','name','barcode',
  'length','width','height','volume','carton','dailyQty','dailySales','moq','moqDays',
  'cabinetKey','cabinetLabel','position','displayCols','perCol','faceWidth',
  'currentStock','planCartons','customPlacement','rowFull','skuFull','externalOwner',
  'externalCountOverride','staticExternalOverride','avgExternalOverride',
  'placementCloneOf','placementCloneType','placementRole'
];
const NEW_ROW_FIELDS=[
  ...EXISTING_PATCH_FIELDS,'status','sourceAdvice','sourceAction','note','modifiedFields','changeNote'
];
const STORE_PATCH_FIELDS=[
  'type','skuCount','directSku','externalSku','staticExternalL','dynamicAvgExternalL',
  'dynamicP95L','suggestedExternalL','over754','missingSkuCount','excludedSku','p95Factor'
];

function rowGroupKey(row){return `${text(row?.store)}\u0000${productKey(row)}`}
function groupRows(rows=[]){
  const map=new Map();
  for(const row of rows||[]){
    const key=rowGroupKey(row); if(!productKey(row))continue;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return map;
}
function hash32(value){
  let h=2166136261;
  for(const ch of String(value)){h^=ch.codePointAt(0);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}
function compactNewRow(row,index=0){
  const out={id:`replan_${hash32([row?.store,productKey(row),row?.cabinetKey,row?.position,index].map(text).join('|'))}`,store:text(row?.store)};
  for(const field of NEW_ROW_FIELDS)if(row?.[field]!==undefined)out[field]=clone(row[field]);
  return out;
}
function changedValues(baseRow,draftRow){
  const values={};
  for(const field of EXISTING_PATCH_FIELDS){
    if(!same(baseRow?.[field],draftRow?.[field]))values[field]=clone(draftRow?.[field]);
  }
  if(draftRow?.included===false&&baseRow?.included!==false){
    for(const field of ['status','sourceAction','note'])if(draftRow?.[field]!==undefined)values[field]=clone(draftRow[field]);
  }
  return values;
}
function pairRows(baseRows=[],draftRows=[]){
  const usedBase=new Set(),pairs=[],unmatchedDraft=[];
  for(const draftRow of draftRows){
    let index=baseRows.findIndex((row,i)=>!usedBase.has(i)&&text(row?.cabinetKey)&&text(row?.cabinetKey)===text(draftRow?.cabinetKey));
    if(index<0)index=baseRows.findIndex((_,i)=>!usedBase.has(i));
    if(index<0){unmatchedDraft.push(draftRow);continue}
    usedBase.add(index);pairs.push([baseRows[index],draftRow]);
  }
  const unmatchedBase=baseRows.filter((_,i)=>!usedBase.has(i));
  return {pairs,unmatchedBase,unmatchedDraft};
}

export function buildCompactAppDraftPatch(base,draft,lifecycle=null){
  const signature=[base?.meta?.source,base?.meta?.generatedAt,base?.meta?.version].join('|');
  const baseGroups=groupRows(base?.skus||[]),draftGroups=groupRows(draft?.skus||[]);
  const keys=new Set([...baseGroups.keys(),...draftGroups.keys()]);
  const skus=[],newSkus=[],deletedIds=[];
  let newIndex=0;
  for(const key of keys){
    const {pairs,unmatchedBase,unmatchedDraft}=pairRows(baseGroups.get(key)||[],draftGroups.get(key)||[]);
    for(const [baseRow,draftRow] of pairs){
      const values=changedValues(baseRow,draftRow);
      if(baseRow?.id&&Object.keys(values).length)skus.push({id:baseRow.id,values});
    }
    for(const row of unmatchedBase)if(row?.id)deletedIds.push(row.id);
    for(const row of unmatchedDraft)newSkus.push(compactNewRow(row,newIndex++));
  }

  const baseStoreMap=new Map((base?.stores||[]).map(s=>[text(s.store),s]));
  const storeValues=[];
  for(const store of draft?.stores||[]){
    const before=baseStoreMap.get(text(store?.store)); if(!before)continue;
    const values={};
    for(const field of STORE_PATCH_FIELDS)if(!same(before?.[field],store?.[field]))values[field]=clone(store?.[field]);
    if(Object.keys(values).length)storeValues.push({store:text(store.store),values});
  }

  const baseStore=new Set((base?.stores||[]).map(s=>text(s.store)));
  const baseCab=new Set((base?.cabinets||[]).map(c=>text(c.key)));
  return {
    _patchVersion:2,_dataSignature:signature,
    skus,newSkus,deletedIds,storeValues,
    newStores:(draft?.stores||[]).filter(s=>!baseStore.has(text(s.store))).map(clone),
    newCabinets:(draft?.cabinets||[]).filter(c=>!baseCab.has(text(c.key))).map(clone),
    productPool:clone(draft?.productPool||[]),
    lifecycle:lifecycle?clone(lifecycle):(draft?.lifecycle?clone(draft.lifecycle):null),
    excluded:clone(draft?.excluded||[]),
    replanMeta:draft?.replanMeta?clone(draft.replanMeta):null,
  };
}

export function applyReplanPatch(base,patch){
  const state=applyAppStatePatch(base,patch);
  const storeMap=new Map((state.stores||[]).map(s=>[text(s.store),s]));
  for(const item of patch?.storeValues||[]){const row=storeMap.get(text(item.store));if(row)Object.assign(row,clone(item.values||{}))}
  if(Array.isArray(patch?.excluded))state.excluded=clone(patch.excluded);
  if(patch?.replanMeta)state.replanMeta=clone(patch.replanMeta);
  return state;
}

export function replanSelectedStores(data,products,stores,options={}){
  const pool=normalizeActiveProductPool(products);
  const requested=[...new Set((stores||[]).map(text).filter(Boolean))];
  const plans=[],errors=[];
  for(const store of requested){
    const config=(data?.stores||[]).find(s=>text(s.store)===store)||{store,type:'门店'};
    const cabinets=(data?.cabinets||[]).filter(c=>text(c.store)===store);
    if(!cabinets.length){errors.push(`${store}：没有可用冰柜配置`);continue}
    let preferredPlacements=options.preserveExisting===false?[]:buildPreferredPlacements(data,store,pool);
    let referenceStore='';
    if(!preferredPlacements.length&&options.useReferenceStore!==false){
      const reference=buildReferencePlacements(data,store,pool);
      preferredPlacements=reference.preferences;
      referenceStore=reference.referenceStore;
    }
    const plan=allocateStore({
      store,type:config.type,storeConfig:config,stores:data?.stores||[],productPool:pool,cabinets,
      params:{...(data?.params||{}),externalCapL:num(options.externalCapL)||num(data?.params?.externalCapL)||754},
      p95Factor:config.p95Factor||data?.params?.p95Factor,physicalRecords:data?.physicalRecords||[],preferredPlacements,
    });
    if(referenceStore)plan.referenceStore=referenceStore;
    plans.push(plan);
  }

  const plannedStores=new Set(plans.map(p=>text(p.store)));
  const scopedDraft=buildReplanDraft(data,pool,plans);
  const untouchedSkus=(data?.skus||[]).filter(r=>!plannedStores.has(text(r.store))).map(clone);
  const untouchedExcluded=(data?.excluded||[]).filter(r=>!plannedStores.has(text(r.store))).map(clone);
  const draft={
    ...scopedDraft,
    skus:[...untouchedSkus,...(scopedDraft.skus||[])],
    excluded:[...untouchedExcluded,...(scopedDraft.excluded||[])],
    replanMeta:{...(scopedDraft.replanMeta||{}),mode:'selected-store',selectedStores:[...plannedStores]},
  };
  const validation=validateReplanResult({pool,plans,draft,errors});
  return {pool,plans,draft,errors,validation,signature:plans.map(p=>`${p.store}:${planSignature(p)}`).join('\n')};
}

export default {buildCompactAppDraftPatch,applyReplanPatch,replanSelectedStores};
