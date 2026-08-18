const text=v=>String(v??'').trim();
const clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));

function storeNames(data){
  const set=new Set();
  for(const s of data?.stores||[])if(text(s?.store))set.add(text(s.store));
  for(const c of data?.cabinets||[])if(text(c?.store))set.add(text(c.store));
  for(const r of data?.skus||[])if(text(r?.store))set.add(text(r.store));
  return set;
}

function replaceTargetRows(currentRows,baseRows,targets){
  const kept=(currentRows||[]).filter(row=>!targets.has(text(row?.store))).map(clone);
  const formal=(baseRows||[]).filter(row=>targets.has(text(row?.store))).map(clone);
  return [...kept,...formal];
}

/**
 * 重排的已有门店必须以正式方案为老品保位基准，不能把上一次运营草稿继续叠加。
 * 尚未进入正式底表的新门店没有正式基准，因此继续保留当前草稿中的门店/柜段/SKU数据。
 * targetStores 为空时代表全部门店；指定时只重置被选中的已有正式门店。
 */
export function prepareReplanSource(base,current,targetStores=null){
  const formal=clone(base||{});
  const working=clone(current||base||{});
  const formalNames=storeNames(formal);
  const requested=Array.isArray(targetStores)&&targetStores.length
    ?new Set(targetStores.map(text).filter(Boolean))
    :storeNames(working);
  const resetTargets=new Set([...requested].filter(store=>formalNames.has(store)));
  if(!resetTargets.size)return working;

  working.stores=replaceTargetRows(working.stores,formal.stores,resetTargets);
  working.cabinets=replaceTargetRows(working.cabinets,formal.cabinets,resetTargets);
  working.skus=replaceTargetRows(working.skus,formal.skus,resetTargets);

  // 正式参数是重排硬口径；新增门店数据仍由 working 中的门店/柜段承载。
  if(formal.params)working.params=clone(formal.params);
  return working;
}

export default {prepareReplanSource};
