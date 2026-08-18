import zlib from 'node:zlib';

const text=v=>String(v??'').trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const keyOf=r=>text(r?.barcode)||text(r?.name);
const cabKey=(store,label,pos)=>`${text(store)}__${text(label)}__${text(pos)}`;

export function decodeAcceptedBaselineWrapper(wrapper){
  if(wrapper?.encoding!=='gzip-base64'||wrapper?.format!=='accepted-replan-baseline-compact-v1'||!wrapper?.payload)return null;
  return JSON.parse(zlib.gunzipSync(Buffer.from(wrapper.payload,'base64')).toString('utf8'));
}

export function expandAcceptedBaseline(wrapper,oldData={}){
  const f=decodeAcceptedBaselineWrapper(wrapper);if(!f)return null;
  const oldProducts=new Map((oldData.productPool||[]).map(p=>[keyOf(p),p]));
  const oldStores=new Map((oldData.stores||[]).map(s=>[text(s.store),s]));
  const oldCabs=new Map((oldData.cabinets||[]).map(c=>[text(c.key),c]));
  const oldRowsByExact=new Map();
  const oldRowsByProduct=new Map();
  for(const row of oldData.skus||[]){
    const pk=keyOf(row),exact=`${text(row.store)}|${pk}|${text(row.cabinetKey)}`;
    if(!oldRowsByExact.has(exact))oldRowsByExact.set(exact,[]);oldRowsByExact.get(exact).push(row);
    const sp=`${text(row.store)}|${pk}`;if(!oldRowsByProduct.has(sp))oldRowsByProduct.set(sp,[]);oldRowsByProduct.get(sp).push(row);
  }
  const usedIds=new Set();
  const products=f.products.map((p,i)=>{
    const [name,barcode,grade,rank,category3,sceneGroup,familyGroup,category4,length,width,height,volume,carton,dailyQty,dailySales,moq,moqDays,lifecycleStatus]=p;
    const old=oldProducts.get(text(barcode)||text(name))||{};
    return {...clone(old),id:old.id||`pool_accepted_${i+1}`,active:true,name,barcode,grade,rank,category2:old.category2||'',category3,category4,sceneGroup,familyGroup,length,width,height,volume,carton,dailyQty,dailySales,moq,moqDays,lifecycleStatus,status:lifecycleStatus};
  });
  const stores=f.summaries.map(s=>{
    const [si,type,skuCount,missingSkuCount,directSku,externalSku,staticExternalL,dynamicAvgExternalL,dynamicP95L,suggestedExternalL,vertical,chest,ice,sourceNote]=s;
    const store=f.stores[si],old=oldStores.get(store)||{};
    return {...clone(old),store,type,vertical,chest,ice,sourceNote,skuCount,missingSkuCount,excludedSku:missingSkuCount,directSku,externalSku,staticExternalL,dynamicAvgExternalL,dynamicP95L,suggestedExternalL,over754:num(suggestedExternalL)>754,p95Factor:num(dynamicAvgExternalL)>0?num(dynamicP95L)/num(dynamicAvgExternalL):(num(old.p95Factor)||num(oldData.params?.p95Factor)||1.241748)};
  });
  const cabinets=f.cabinets.map((c,i)=>{
    const [si,kind,label,position,sceneGroup,categoryMix,length,depth,height,sourceUsed,sourceLeft,status]=c;
    const store=f.stores[si],key=cabKey(store,label,position),old=oldCabs.get(key)||{};
    return {...clone(old),id:old.id||`cab_accepted_${i+1}`,store,key,label,position,kind,type:kind,length,depth:depth||old.depth||0,height:height||old.height||0,sourceUsed,sourceLeft,sceneGroup,categoryMix,status,rawNo:old.rawNo||((label.match(/柜(\d+)/)||[])[1]||''),rawPosition:old.rawPosition||((position.match(/第(\d+)层|分区(\d+)/)||[]).slice(1).find(Boolean)||position)};
  });
  const skus=f.skus.map((r,i)=>{
    const [si,pi,ci,displayRole,mainSecondary,displayCols,faceWidth,perCol,rowFull,skuFull,externalCount,staticExternal,avgExternal,shelfDays,externalDays,risk,externalOwner,optNote]=r;
    const store=f.stores[si],p=products[pi],c=cabinets[ci],pk=keyOf(p),exact=`${store}|${pk}|${c.key}`;
    let old=(oldRowsByExact.get(exact)||[]).find(x=>!usedIds.has(x.id));
    if(!old)old=(oldRowsByProduct.get(`${store}|${pk}`)||[]).find(x=>!usedIds.has(x.id));
    const id=old?.id||`accepted_sku_${i+1}`;usedIds.add(id);
    return {...clone(old||{}),id,store,included:true,status:num(externalCount)>0?'纳入-动态外储承接':'纳入-陈列位整箱',grade:p.grade,rank:p.rank,category2:p.category2||'',category3:p.category3,category4:p.category4,sceneGroup:p.sceneGroup,familyGroup:p.familyGroup,name:p.name,barcode:p.barcode,length:p.length,width:p.width,height:p.height,volume:p.volume,carton:p.carton,dailyQty:p.dailyQty,dailySales:p.dailySales,moq:p.moq,moqDays:p.moqDays,cabinetKey:c.key,cabinetLabel:c.label,position:c.position,displayRole,mainSecondary,displayCols,faceWidth,perCol,rowFull,skuFull,externalOwner:text(externalOwner)!=='否',externalCountOverride:num(externalCount),staticExternalOverride:num(staticExternal),avgExternalOverride:num(avgExternal),shelfDays,externalDays,risk,customPlacement:false,placements:[],currentStock:'',planCartons:1,sourceAdvice:'67SKU确认版正式基准',sourceAction:'确认版固定陈列',note:optNote||'2026-08-17确认版'};
  });
  const excluded=f.excluded.map((x,i)=>{const [si,pi,status,reason,grade,rank,category3,type]=x,p=products[pi];return{id:`accepted_excluded_${i+1}`,store:f.stores[si],included:false,status:status||'暂不纳入',reason,note:reason,grade:grade||p.grade,rank:rank||p.rank,category2:p.category2||'',category3:category3||p.category3,category4:p.category4,name:p.name,barcode:p.barcode,type};});
  return {
    ...clone(oldData),
    meta:{...(oldData.meta||{}),baselineVersion:'67SKU确认版-20260817',baselineSource:f.source||'整箱到店数据测算_最新产品池_20260817.xlsx'},
    params:{...(oldData.params||{}),triggerRate:0.1,externalCapL:754,externalSafetyFactor:1.2},
    stores,cabinets,skus,excluded,productPool:products,
    lifecycle:clone(oldData.lifecycle||null),physicalRecords:clone(oldData.physicalRecords||[]),
  };
}

export default {decodeAcceptedBaselineWrapper,expandAcceptedBaseline};
