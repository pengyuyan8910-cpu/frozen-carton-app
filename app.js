const 初始数据=window.UNIFIED_CARTON_DATA;
const 复核报告=window.UNIFIED_CARTON_REPORT||{};
const 统一状态保存键="frozen_carton_unified_scene_state_v2";
const 旧草稿保存键="frozen_carton_unified_scene_draft_v1";
const 旧发布保存键="frozen_carton_unified_scene_published_v1";
const 数据签名=[初始数据?.meta?.source,初始数据?.meta?.generatedAt,初始数据?.meta?.version].join("|");
function 清理计算缓存(state){const next=structuredClone(state);for(const r of next.skus||[]){delete r.widthOverride;delete r._baseIncluded;delete r._baseCabinetKey;delete r._baseDisplayCols;delete r._baseFaceWidth;delete r._baseWidth}delete next._baselineReady;return next}
function 清理交互痕迹(state){const next=清理计算缓存(state);for(const r of next.skus||[]){delete r.selected;delete r.modifiedFields;delete r.changeNote}delete next._dataSignature;return next}
const 文=v=>String(v??"").trim();
const 数=v=>{if(typeof v==="number")return Number.isFinite(v)?v:0;
const n=Number(String(v??"").replace(/,/g,"").replace(/[^\d.-]/g,""));
return Number.isFinite(n)?n:0};

function 产品键(r){return String(r?.barcode??"").trim()||String(r?.name??"").trim()}
function 生成产品池(skus=初始数据.skus||[]){const map=new Map();for(const r of skus){const key=产品键(r);if(!key||map.has(key))continue;map.set(key,{id:"pool_"+key,active:true,name:r.name,barcode:r.barcode,grade:r.grade,rank:r.rank,category2:r.category2,category3:r.category3,category4:r.category4,length:r.length,width:r.width,height:r.height,volume:r.volume,carton:r.carton,dailyQty:r.dailyQty,dailySales:r.dailySales,moq:r.moq,moqDays:r.moqDays})}return [...map.values()]}
function 确保产品池(state){if(!state.productPool||!Array.isArray(state.productPool)||!state.productPool.length)state.productPool=生成产品池(state.skus);return state.productPool}
function 产品池有效(){return window.ProductLifecycle?.getActiveProducts?.()||确保产品池(状态).filter(p=>p.active!==false&&!['淘汰完成','已淘汰'].includes(p.lifecycleStatus))}
function 产品转SKU(p,store){return{id:"poolsku_"+Date.now()+"_"+Math.random().toString(36).slice(2),store,included:true,status:"产品池新增",grade:p.grade||"未评级",rank:数(p.rank)||9999,category2:p.category2||"",category3:p.category3||"",category4:p.category4||"",name:p.name||"新品",barcode:p.barcode||"",length:数(p.length),width:数(p.width),height:数(p.height),volume:数(p.volume)||数(p.length)*数(p.width)*数(p.height)/1e6,carton:Math.max(1,数(p.carton)||1),dailyQty:数(p.dailyQty),dailySales:数(p.dailySales),moq:数(p.moq),moqDays:数(p.moqDays),cabinetKey:"",cabinetLabel:"",position:"",displayCols:1,perCol:1,faceWidth:0,placements:[],customPlacement:true,currentStock:"",planCartons:1,sourceAdvice:"产品池新增",sourceAction:"待排柜",note:"产品池新增"}}

function 横向占宽(r){const length=数(r?.length),width=数(r?.width),face=数(r?.faceWidth);if(!(length>0&&width>0))return 0;if(Math.abs(face-length)<0.0001)return length;if(Math.abs(face-width)<0.0001)return width;return Math.min(length,width)}
function 同步横向占宽(state){for(const r of state?.skus||[]){const face=横向占宽(r);if(!(face>0))continue;r.faceWidth=face;for(const placement of r.placements||[]){placement.width=face;placement.faceWidth=face}}return state}
function 初始状态(){const st=清理交互痕迹(初始数据);同步横向占宽(st);确保产品池(st);return st}
let 草稿状态=null;
let 发布状态=null;
let 状态=初始状态();
let 当前={门店:"",页面:"goods",定位SKU:"",陈列图选中SKU:"",陈列图筛选:"all",陈列图四级:"",陈列图缩放:100};
let 同步请求中=false;
const 格=(v,d=1)=>{const n=数(v);
return Number.isFinite(n)?n.toFixed(d).replace(/\.0$/,""):"0"};
const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const 包含=(r,k)=>!k||Object.values(r).some(v=>文(v).includes(k));
const 逃=v=>文(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const 本地保存字段=["included","status","grade","rank","category2","category3","category4","name","barcode","length","width","height","volume","carton","dailyQty","dailySales","moq","moqDays","cabinetKey","cabinetLabel","position","planogramOrder","displayCols","perCol","faceWidth","faceOrientation","currentStock","planCartons","sourceAdvice","sourceAction","note","customPlacement","placements","modifiedFields","changeNote","selected","rowFull","skuFull","externalOwner","externalCountOverride","staticExternalOverride","avgExternalOverride","inStaging","stagingCabinetType","stagingIce","stagingFrom","placementCloneOf","placementCloneType"];
const 本地保存柜体字段=["length","depth","height"];
function 值相同(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null)}
function 状态补丁(state){
const init=初始状态();
const initSkuMap=new Map((init.skus||[]).map(r=>[r.id,r]));
const currentIds=new Set((state.skus||[]).map(r=>r.id));
const deletedIds=[...(init.skus||[])].filter(r=>!currentIds.has(r.id)).map(r=>r.id);
const skus=[];const newSkus=[];
for(const r of state.skus||[]){const base=initSkuMap.get(r.id);if(!base){newSkus.push(清理计算缓存({skus:[r]}).skus[0]);continue}const values={};for(const f of 本地保存字段){if(!值相同(r[f],base[f]))values[f]=r[f]}if(Object.keys(values).length)skus.push({id:r.id,values})}
const initStores=new Set((init.stores||[]).map(x=>x.store));
const newStores=(state.stores||[]).filter(x=>!initStores.has(x.store));
const initCabs=new Set((init.cabinets||[]).map(x=>x.key));
const newCabinets=(state.cabinets||[]).filter(x=>!initCabs.has(x.key));
const initCabinetMap=new Map((init.cabinets||[]).map(x=>[x.key,x]));
const cabinetUpdates=[];
for(const cabinet of state.cabinets||[]){const base=initCabinetMap.get(cabinet.key);if(!base)continue;const values={};for(const field of 本地保存柜体字段){if(!值相同(cabinet[field],base[field]))values[field]=cabinet[field]}if(Object.keys(values).length)cabinetUpdates.push({key:cabinet.key,values})}
const productPool=确保产品池(state);
const lifecycle=state.lifecycle&&typeof state.lifecycle==="object"?JSON.parse(JSON.stringify(state.lifecycle)):null;
return {_patchVersion:4,_dataSignature:数据签名,skus,newSkus,deletedIds,newStores,newCabinets,cabinetUpdates,productPool,lifecycle,
  productPoolRevision:state.productPoolRevision||"",productPoolChangeLog:state.productPoolChangeLog||[],productPoolStaging:state.productPoolStaging||[],
  frozen_carton_replan_draft_v2:state.frozen_carton_replan_draft_v2||null};
}
function 应用状态补丁(patch){
if(!patch||patch._dataSignature!==数据签名)return null;
if(!patch._patchVersion)return patch;
const state=初始状态();
const del=new Set(patch.deletedIds||[]);
state.skus=(state.skus||[]).filter(r=>!del.has(r.id));
state.stores=[...(state.stores||[]),...(patch.newStores||[])];
state.cabinets=[...(state.cabinets||[]),...(patch.newCabinets||[])];
const cabinetMap=new Map((state.cabinets||[]).map(c=>[c.key,c]));
for(const item of patch.cabinetUpdates||[]){const cabinet=cabinetMap.get(item.key);if(cabinet&&item.values)Object.assign(cabinet,item.values)}
const map=new Map(state.skus.map(r=>[r.id,r]));
for(const p of patch.skus||[]){const r=map.get(p.id);if(!r)continue;const values=p.values||{};const base=state.skus.find(x=>x.id===r.id);const baseCabinetKey=base?.cabinetKey;Object.assign(r,values);if(values.inStaging===undefined&&values.cabinetKey===""&&values.cabinetLabel==="待选区"&&values.position==="待选区"&&values.customPlacement===true){const source=state.cabinets.find(c=>c.key===baseCabinetKey);const typeText=文(source?.kind)+" "+文(source?.label)+" "+文(source?.key);const type=/冰淇淋|雪糕|冰品/.test(typeText)?"冰淇淋柜":/立柜/.test(typeText)?"立柜":/卧柜/.test(typeText)?"卧柜":文(source?.kind);r.inStaging=true;r.stagingCabinetType=type;r.stagingIce=type==="冰淇淋柜";r.stagingFrom=source?{key:source.key,label:source.label,position:source.position}:null}}
for(const r of patch.newSkus||[])state.skus.push(r);
if(Array.isArray(patch.productPool))state.productPool=patch.productPool;
if(patch.lifecycle&&typeof patch.lifecycle==="object")state.lifecycle=JSON.parse(JSON.stringify(patch.lifecycle));
if(Object.prototype.hasOwnProperty.call(patch,"productPoolRevision"))state.productPoolRevision=patch.productPoolRevision||"";
if(Array.isArray(patch.productPoolChangeLog))state.productPoolChangeLog=structuredClone(patch.productPoolChangeLog);
if(Array.isArray(patch.productPoolStaging))state.productPoolStaging=structuredClone(patch.productPoolStaging);
if(patch.frozen_carton_replan_draft_v2)state.frozen_carton_replan_draft_v2=structuredClone(patch.frozen_carton_replan_draft_v2);
确保产品池(state);同步横向占宽(state);
return state;
}
function 状态可用(st){return !!(st&&st.meta&&Array.isArray(st.stores)&&st.stores.length&&Array.isArray(st.skus)&&st.skus.length&&Array.isArray(st.cabinets)&&st.cabinets.length)}
function 读取本地(key){try{const raw=localStorage.getItem(key);if(!raw)return null;const st=应用状态补丁(JSON.parse(raw));if(!状态可用(st)){localStorage.removeItem(key);console.warn("本地方案无效，已自动恢复初始数据",key);return null}return st}catch(e){console.warn("读取本地方案失败",e);try{localStorage.removeItem(key)}catch(_){}return null}}
function 安全保存本地(key,state){try{localStorage.setItem(key,JSON.stringify(状态补丁(state)));return true}catch(e){console.warn("本地保存失败，已保留当前页面内存状态",e);window.__storageWarnings=(window.__storageWarnings||[]).concat(String(e));return false}}
function 刷新已加载陈列容量(state){const helper=window.LivePlanogramCapacity?.recalculateLoadedPlanogram;if(typeof helper==='function')helper(state);return state}
function 刷新单SKU陈列容量(row){if(!row)return;刷新已加载陈列容量({params:状态.params,cabinets:状态.cabinets,skus:[row]})}
function 初始化统一状态(){const initial=初始状态();const unified=读取本地(统一状态保存键);const draft=unified||读取本地(旧草稿保存键);const published=unified?null:读取本地(旧发布保存键);const result=window.UnifiedStateMigration?.migrateUnifiedState?.({initial,draft,published,signature:数据签名})||{source:unified?'unified':'initial',state:unified||initial};状态=清理计算缓存(result.state||initial);if((!状态.lifecycle||!Array.isArray(状态.lifecycle.tasks)||状态.lifecycle.tasks.length===0)&&初始数据?.lifecycle?.tasks?.length)状态.lifecycle=structuredClone(初始数据.lifecycle);刷新已加载陈列容量(状态);草稿状态=状态;发布状态=状态;建立基准(状态);安全保存本地(统一状态保存键,状态);return result}
function 保存草稿(){安全保存本地(统一状态保存键,状态)}
function 保存发布(){安全保存本地(统一状态保存键,状态)}
function 可编辑模式(){return true}
function 切换数据源(){草稿状态=状态;发布状态=状态;window.ProductLifecycle?.syncData?.(状态);清空业务快照()}
function 保存(){清空业务快照();草稿状态=状态;发布状态=状态;安全保存本地(统一状态保存键,状态);window.ProductLifecycle?.syncData?.(状态)}
function 标记待同步(){}
初始化统一状态();
window.ProductLifecycle?.hydrateState?.(状态.lifecycle||null,状态);window.ProductLifecycle?.syncData?.(状态);
function 门店严格记录(store, state=状态){return (state.stores||[]).find(item=>item.store===store)||null}
function 门店严格参数(store, state=状态){const record=门店严格记录(store,state);const override=window.__newStoreP95Override&&window.__newStoreP95Override.store===store?window.__newStoreP95Override:null;const hasRecord=!!record;return {...(state.params||{}),p95Factor:override?.p95Factor??(hasRecord?record?.p95Factor:state.params?.p95Factor),p95Source:override?.p95Source||(hasRecord?record?.p95Source||`store-record:${store}`:state.params?.p95Source||`store-config:${store}`)}}
window.FrozenCartonApp={
  getState:()=>状态,
  getDraftState:()=>草稿状态,
  getPublishedState:()=>发布状态,
  getActiveProducts:()=>structuredClone(产品池有效()),
  getStoreRecord:store=>structuredClone(门店严格记录(store)),
  getStoreParams:store=>structuredClone(门店严格参数(store)),
  saveDraftState:next=>{草稿状态=清理计算缓存(structuredClone(next));if(可编辑模式())状态=草稿状态;保存草稿();window.ProductLifecycle?.hydrateState?.(草稿状态.lifecycle||null,草稿状态);清空业务快照();渲染全部();return true},
  saveActiveState:next=>{状态=清理计算缓存(structuredClone(next));草稿状态=状态;保存草稿();window.ProductLifecycle?.hydrateState?.(状态.lifecycle||null,状态);清空业务快照();渲染全部();return true},
  render:()=>渲染全部()
};
// Lifecycle edits are part of the same shared document, not a separate browser-only cache.
window.addEventListener("product-lifecycle:state-changed", event=>{
  if(!状态||!event.detail)return;
  清空业务快照();
  状态.lifecycle=structuredClone(event.detail);
  if(可编辑模式()){草稿状态=状态;保存草稿();}
  else{发布状态=状态;保存发布();}
});
["product-lifecycle:product-updated","product-lifecycle:data-committed","product-lifecycle:state-hydrated"].forEach(type=>window.addEventListener(type,()=>清空业务快照()));
// Keep the planogram and the allocation table on the same live state.
function 刷新陈列联动(){
  if(!q("#displayMapCanvas"))return;
  requestAnimationFrame(()=>{
    切换数据源();
    建立基准(状态);
    渲染陈列图();
  });
}
let 业务快照缓存=null;
function 清空业务快照(){业务快照缓存=null}
function SKU键(r){const values=[文(r?.barcode),文(r?.name),文(r?.productKey),文(r?.productName)].filter(Boolean);return values.find(v=>/^\d{8,18}$/.test(v))||values[0]||""}
function 产品主键(item){return window.ProductLifecycle?.getCanonicalProductKey?.(item)||SKU键(item)}
function 创建业务快照(){
 const bridge=window.ProductLifecycle;
 const products=bridge?.getActiveProducts?.()||确保产品池(状态).filter(p=>p.active!==false&&!['淘汰完成','已淘汰'].includes(p.lifecycleStatus));
 const activeKeys=bridge?.getActiveProductKeys?.()||new Set(products.flatMap(p=>[文(p.barcode),文(p.name)].filter(Boolean)));
 const storeRows=new Map(),includedRows=new Map();
 for(const row of 状态.skus||[]){
  if(!storeRows.has(row.store))storeRows.set(row.store,[]);storeRows.get(row.store).push(row);
  const active=bridge?.isActiveProduct?.(row)??[文(row.barcode),文(row.name)].some(value=>activeKeys.has(value));
  if(row.included!==false&&active){if(!includedRows.has(row.store))includedRows.set(row.store,[]);includedRows.get(row.store).push(row)}
 }
 return{state:状态,products,activeKeys,storeRows,includedRows,summaries:new Map()}
}
function 业务快照(){if(!业务快照缓存||业务快照缓存.state!==状态)业务快照缓存=创建业务快照();return 业务快照缓存}
function 门店名(){return 当前.门店||q("#storeSelect").value||状态.stores[0]?.store||""}
function 门店SKU(store=门店名()){return 业务快照().storeRows.get(store)||[]}
function 产品已淘汰完成(item){return !(window.ProductLifecycle?.isActiveProduct?.(item)??业务快照().activeKeys.has(产品主键(item)))}
function 纳入SKU(store=门店名()){return 业务快照().includedRows.get(store)||[]}
function 在售SKU池(){return 业务快照().products}
function 门店已纳入键集合(store=门店名()){const set=new Set();for(const r of 纳入SKU(store)){const key=产品主键(r);if(key)set.add(key)}return set}
function 门店未纳入SKU(store=门店名()){const set=门店已纳入键集合(store);return 在售SKU池().filter(r=>!set.has(产品主键(r)))}
function 唯一SKU数(rows){const set=new Set();for(const r of rows){const key=产品主键(r);if(key)set.add(key)}return set.size}
function 分级(g){const t=文(g).toUpperCase();
return t==="A"?"a":t==="B"?"b":t==="C"?"c":t==="D"?"d":""}
function 风险类(v){const t=文(v);
return t.includes("极高")?"risk-top":t.includes("高")?"risk-high":""}
function 等级分(g){return {A:4,B:3,C:2,D:1}[文(g).toUpperCase()]||0}
function 单品体积(r){return 数(r.volume)||数(r.length)*数(r.width)*数(r.height)/1e6}
function 满陈(r){return Math.max(0,Math.floor(数(r.displayCols)*数(r.perCol)))}
function 同步同SKU满陈(r){
  if(!r||!r.store)return;
  const key=SKU键(r);if(!key)return;
  const same=状态.skus.filter(x=>x.store===r.store&&x.included&&SKU键(x)===key);
  for(const x of same){if(x===r||x.customPlacement||x.modifiedFields?.includes("陈列列数")||x.modifiedFields?.includes("单列容量"))x.rowFull=满陈(x)}
  const total=same.reduce((sum,x)=>sum+(数(x.rowFull)||满陈(x)),0);
  for(const x of same){x.skuFull=total;delete x.externalCountOverride;delete x.staticExternalOverride;delete x.avgExternalOverride}
}
function 计算SKU(r){const rowFull=数(r.rowFull)||满陈(r);
const full=rowFull;
const skuFull=数(r.skuFull)||rowFull;
const trigger=Math.ceil(skuFull*数(状态.params.triggerRate));
const receivable=Math.max(0,skuFull-trigger);
const inShelf=Math.min(数(r.carton),receivable);
const totalExternal=Math.max(0,数(r.carton)-inShelf);
const external=r.externalOwner===false?0:(r.externalCountOverride!==undefined?数(r.externalCountOverride):totalExternal);
const vol=单品体积(r);
const staticVol=r.staticExternalOverride!==undefined?数(r.staticExternalOverride):external*vol;
const avgVol=r.avgExternalOverride!==undefined?数(r.avgExternalOverride):staticVol/2;
const externalDays=数(r.dailyQty)>0?external/数(r.dailyQty):0;
const shelfDays=数(r.dailyQty)>0?skuFull/数(r.dailyQty):0;
const risk=external<=0?"无外储":externalDays<=15?"低风险":externalDays<=45?"中风险":externalDays<=90?"高风险":"极高风险";
return{full,rowFull,skuFull,trigger,receivable,inShelf,afterStock:trigger+inShelf,external,vol,staticVol,avgVol,externalDays,shelfDays,risk}}
function 原始列数(r){const ps=Array.isArray(r.placements)?r.placements:[];return ps.length||数(r.displayCols)}
function 本柜列数(r,cabKey=r.cabinetKey){return r.cabinetKey===cabKey?数(r.displayCols):0}
function 本柜占宽(r,cabKey=r.cabinetKey){return r.cabinetKey===cabKey?SKU占用宽度(r):0}
function 基准宽度(r){return r._baseWidth!==undefined?数(r._baseWidth):SKU占用宽度(r)}
function 初始SKU行(id){return (初始数据.skus||[]).find(x=>x.id===id)}
function 初始SKU宽度(r){return Math.max(0,数(r.displayCols)*数(r.faceWidth))}
function 建立基准(state){if(!state)return;for(const r of state.skus||[]){const b=初始SKU行(r.id);r._baseIncluded=b?!!b.included:false;r._baseCabinetKey=b?b.cabinetKey:r.cabinetKey;r._baseDisplayCols=b?数(b.displayCols):0;r._baseFaceWidth=b?数(b.faceWidth):数(r.faceWidth);r._baseWidth=b?初始SKU宽度(b):0}state._baselineReady=true}
function 柜段占用明细(r){const out=new Map();const baseKey=r._baseCabinetKey||r.cabinetKey;const baseWidth=基准宽度(r);const newWidth=r.included?SKU占用宽度(r):0;if(r._baseIncluded!==false&&baseKey)out.set(baseKey,(out.get(baseKey)||0)-baseWidth);if(r.included&&r.cabinetKey)out.set(r.cabinetKey,(out.get(r.cabinetKey)||0)+newWidth);return out}
function 柜段使用(){const map=new Map(状态.cabinets.map(c=>[c.key,{...c,used:0,items:[]}]));const seen=new Set();for(const r of 状态.skus){if(r.included===false||产品已淘汰完成(r))continue;const duplicateKey=r.lifecycleTaskId?[r.lifecycleTaskId,r.lifecycleTaskRowId||r.id].join("||"):"";if(duplicateKey&&seen.has(duplicateKey))continue;if(duplicateKey)seen.add(duplicateKey);const c=map.get(r.cabinetKey);if(!c)continue;const used=SKU占用宽度(r);c.used+=used;c.items.push({id:r.id,name:r.name,used,cols:数(r.displayCols)})}for(const c of map.values()){c.used=Number(Math.max(0,c.used).toFixed(1));c.left=Number((数(c.length)-c.used).toFixed(1));c.over=c.left<-.5}return[...map.values()]}function 门店汇总(store){
 const snapshot=业务快照();if(snapshot.summaries.has(store))return snapshot.summaries.get(store);
 const rows=纳入SKU(store),groups=new Map();
 for(const row of rows){const key=产品主键(row);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
 const productRows=[...groups.values()].map(group=>{const first=group[0],skuFull=group.reduce((sum,row)=>sum+(数(row.rowFull)||满陈(row)),0);return{...first,skuFull}});
 const calcs=productRows.map(计算SKU),ext=calcs.filter(c=>c.external>0);
 const directSkuCount=calcs.filter(c=>c.external<=0).length,externalSkuCount=ext.length;
 const avg=ext.reduce((sum,c)=>sum+c.avgVol,0),storeInfo=状态.stores.find(x=>x.store===store)||{};
 const p95=avg*数(storeInfo.p95Factor||状态.params.p95Factor),suggested=Math.ceil(p95*数(状态.params.externalSafetyFactor));
 const poolCount=在售SKU池().length,includedUnique=groups.size,missingSkuCount=Math.max(0,poolCount-includedUnique);
 const result={store,skuCount:includedUnique,rowCount:rows.length,poolCount,includedUnique,missingSkuCount,direct:directSkuCount,extSku:externalSkuCount,directRows:directSkuCount,externalRows:externalSkuCount,staticVol:ext.reduce((sum,c)=>sum+c.staticVol,0),avgVol:avg,p95,suggested,ok:suggested<=数(状态.params.externalCapL),high:calcs.filter(c=>c.risk==="高风险").length,extreme:calcs.filter(c=>c.risk==="极高风险").length};
 snapshot.summaries.set(store,result);return result
}
function 全部门店汇总(){return 状态.stores.map(s=>({...s,...门店汇总(s.store)}))}
function 表格(id,cols,rows,empty="没有匹配数据"){const el=q(id);
if(!rows.length){el.innerHTML='<div class="empty">'+empty+"</div>";
return}
const h="<table><thead><tr>"+cols.map(c=>"<th>"+逃(c.name)+"</th>").join("")+"</tr></thead><tbody>"+rows.map((r,i)=>'<tr class="'+(r.__rowClass||'')+'">'+cols.map(c=>{const v=c.value?c.value(r,i):r[c.key];
return'<td class="'+(c.cls?c.cls(r,v):typeof v==="number"?"num":"")+'">'+(c.html?v:逃(v))+"</td>"}).join("")+"</tr>").join("")+"</tbody></table>";
el.innerHTML=h;
requestAnimationFrame(顶部滚动)}
function 顶部滚动(){qa(".table-wrap").forEach(wrap=>{const table=wrap.querySelector("table");
if(!table)return;
const old=wrap.previousElementSibling;
if(old&&old.classList.contains("top-scrollbar"))old.remove();
const top=document.createElement("div");
top.className="top-scrollbar";
top.innerHTML="<div></div>";
wrap.parentNode.insertBefore(top,wrap);
const sync=()=>top.firstElementChild.style.width=table.scrollWidth+"px";
sync();
top.scrollLeft=wrap.scrollLeft;
top.addEventListener("scroll",()=>wrap.scrollLeft=top.scrollLeft);
wrap.addEventListener("scroll",()=>top.scrollLeft=wrap.scrollLeft)})}
function 标签(v){return'<span class="tag '+分级(v)+'">'+逃(v)+"</span>"}
function 风险标签(v){return'<span class="tag '+风险类(v)+'">'+逃(v)+"</span>"}
function 输入(v,on,type="number",cls=""){
const m=String(on).match(/改SKU\('([^']+)'\s*,\s*'([^']+)'\s*,\s*this\.value\)/);
const data=m?' data-sku-id="'+逃(m[1])+'" data-sku-field="'+逃(m[2])+'"':'';
return '<input class="'+cls+'" type="'+type+'" value="'+逃(v)+'" onchange="'+on+'"'+data+'>'
}
function 选择柜(r){const list=状态.cabinets.filter(c=>c.store===r.store);
return'<select class="w-wide" onchange="改SKU(\''+r.id+'\',\'cabinetKey\',this.value)">'+list.map(c=>'<option value="'+逃(c.key)+'" '+(c.key===r.cabinetKey?"selected":"")+'>'+逃(c.label+" "+c.position)+"</option>").join("")+"</select>"}
function 选择陈列面方向(r){const value=陈列面方向值(r);return'<select onchange="改SKU(\''+r.id+'\',\'faceOrientation\',this.value)"><option value="length" '+(value==="length"?"selected":"")+'>长做陈列面</option><option value="width" '+(value==="width"?"selected":"")+'>宽做陈列面</option></select>'}
function 标记变更(r,字段,原因){r.modifiedFields=Array.from(new Set([...(r.modifiedFields||[]),字段].filter(Boolean)));
r.changeNote=原因||r.changeNote||"手动修改"}
function 校验SKU排柜变更(r,k,v){
 if(!["included","cabinetKey","displayCols","faceWidth","faceOrientation"].includes(k))return true;
 const nextIncluded=k==="included"?!!v:r.included!==false;
 if(!nextIncluded||产品已淘汰完成(r))return true;
 if(k==="faceOrientation"&&r.inStaging&&!r.cabinetKey)return true;
 const nextCabinetKey=k==="cabinetKey"?String(v):r.cabinetKey;
 const cabinet=状态.cabinets.find(c=>c.key===nextCabinetKey);
 if(!cabinet){alert("未找到目标柜段，修改未保存。");return false}
  if(k==="cabinetKey"&&r.inStaging){
  const sameSegment=同SKU同柜段已有模块(r,nextCabinetKey);
  if(sameSegment){alert("修改未保存：该SKU已在同一物理柜段中，不能再次新增到该柜段。");return false}
 }
 const nextCols=k==="displayCols"?Math.max(0,数(v)):Math.max(0,数(r.displayCols));
 const nextLayout=(k==="cabinetKey"||k==="faceOrientation")?目标柜型参数(r,cabinet,k==="faceOrientation"?v:陈列面方向值(r),k==="faceOrientation"):null;
 if((k==="cabinetKey"||k==="faceOrientation")&&!nextLayout){alert("修改未保存：该商品的长宽高没有一种水平摆法能放入目标柜段。");return false}
 const nextFace=k==="faceWidth"?Math.max(0,数(v)):nextLayout?.faceWidth??Math.max(0,数(r.faceWidth));
 const others=状态.skus.reduce((sum,row)=>{
  if(row===r||row.included===false||row.cabinetKey!==nextCabinetKey||产品已淘汰完成(row))return sum;
  return sum+SKU占用宽度(row);
 },0);
 const projected=others+nextCols*nextFace;
 const currentSame=r.cabinetKey===nextCabinetKey&&r.included!==false?others+SKU占用宽度(r):others;
 if(projected>数(cabinet.length)+0.5&&projected>=currentSame-0.001){
  alert("修改未保存："+cabinet.label+" "+cabinet.position+" 容量 "+格(cabinet.length,0)+"mm，修改后将占用 "+格(projected,0)+"mm，现实中无法放入。请先释放空间或选择其他柜段。");
  return false;
 }
 return true;
}
function 变更标签(r){if(!(r.modifiedFields&&r.modifiedFields.length)&&!r.changeNote)return "";
return '<span class="tag risk-high">已修改</span> '+逃(r.changeNote||"")+'：'+逃((r.modifiedFields||[]).join("、"))}
function 完成提示(msg){const banner=q("#modeBanner");if(banner){banner.textContent=msg;banner.classList.remove("sync-flash");void banner.offsetWidth;banner.classList.add("sync-flash")}setTimeout(()=>alert(msg),0)}
function 可编辑文本(v,id,k,cls="w-mid"){return '<input class="'+cls+'" type="text" value="'+逃(v)+'" onchange="改SKU(\''+id+'\',\''+k+'\',this.value)">'}
function 写入SKU不重绘(id,k,v,原因="手动修改"){
const r=状态.skus.find(x=>x.id===id);
 if(!r)return false;
 if(["displayCols","perCol","faceWidth","currentStock","planCartons","carton","dailyQty","volume","length","width","height"].includes(k))v=数(v);
 if(k==="included"||k==="selected")v=!!v;
 if(k==="faceOrientation")v=规范陈列面方向(v);
 if(k==="included"&&v===false)当前.建议柜段=r.cabinetKey;
 if(!校验SKU排柜变更(r,k,v)){requestAnimationFrame(()=>渲染全部());return false}
 const targetCabinet=(k==="cabinetKey"||k==="faceOrientation")?状态.cabinets.find(c=>c.key===(k==="cabinetKey"?v:r.cabinetKey)):null;
 const targetLayout=targetCabinet?目标柜型参数(r,targetCabinet,k==="faceOrientation"?v:陈列面方向值(r),k==="faceOrientation"):null;
 if((k==="cabinetKey"||k==="faceOrientation")&&targetCabinet&&!targetLayout){requestAnimationFrame(()=>渲染全部());return false}
 r[k]=v;
 if(k==="cabinetKey"){const cabinet=targetCabinet;if(cabinet){r.cabinetLabel=cabinet.label;r.position=cabinet.position;Object.assign(r,targetLayout);if(r.inStaging)清除待选标记(r)}}
 if(k==="faceOrientation"&&targetLayout)Object.assign(r,targetLayout);
 if(k==="faceOrientation"&&!targetCabinet){r.faceWidth=v==="length"?数(r.length):数(r.width)}
 if(["cabinetKey","faceOrientation"].includes(k))刷新单SKU陈列容量(r);
 if(["cabinetKey","faceOrientation","faceWidth","displayCols","perCol"].includes(k)){r.customPlacement=true;delete r.widthOverride}
 if(["cabinetKey","faceOrientation","displayCols","perCol"].includes(k))同步同SKU满陈(r)
 const 名={included:"纳入状态",selected:"选中标色",cabinetKey:"陈列柜段",faceOrientation:"陈列面方向",displayCols:"陈列列数",perCol:"单列容量",faceWidth:"单列占宽",currentStock:"当前库存",planCartons:"计划补货",name:"商品名称",barcode:"条码",grade:"等级",category3:"三级类目",carton:"箱规",dailyQty:"日销",volume:"体积"}[k]||k;
标记变更(r,名,原因);
保存();
刷新陈列联动();
return true;
}
function 提交当前编辑(){
const el=document.activeElement;
if(!el||!el.dataset||!el.dataset.skuId||!el.dataset.skuField)return false;
return 写入SKU不重绘(el.dataset.skuId,el.dataset.skuField,el.value,"同步前提交当前输入");
}
window.改SKU=(id,k,v)=>{const r=状态.skus.find(x=>x.id===id);
if(!r)return;
if(["displayCols","perCol","faceWidth","currentStock","planCartons","carton","dailyQty","volume","length","width","height"].includes(k))v=数(v);
if(k==="included"||k==="selected")v=!!v;
if(k==="faceOrientation")v=规范陈列面方向(v);
if(k==="included"&&v===false)当前.建议柜段=r.cabinetKey;
if(!校验SKU排柜变更(r,k,v)){requestAnimationFrame(()=>渲染全部());return false}
const targetCabinet=(k==="cabinetKey"||k==="faceOrientation")?状态.cabinets.find(c=>c.key===(k==="cabinetKey"?v:r.cabinetKey)):null;
const targetLayout=targetCabinet?目标柜型参数(r,targetCabinet,k==="faceOrientation"?v:陈列面方向值(r),k==="faceOrientation"):null;
if((k==="cabinetKey"||k==="faceOrientation")&&targetCabinet&&!targetLayout){requestAnimationFrame(()=>渲染全部());return false}
r[k]=v;
if(k==="cabinetKey"){const cabinet=targetCabinet;if(cabinet){r.cabinetLabel=cabinet.label;r.position=cabinet.position;Object.assign(r,targetLayout)}}
if(k==="faceOrientation"&&targetLayout)Object.assign(r,targetLayout);
if(k==="faceOrientation"&&!targetCabinet){r.faceWidth=v==="length"?数(r.length):数(r.width)}
if(["cabinetKey","faceOrientation"].includes(k))刷新单SKU陈列容量(r);
if(["cabinetKey","faceOrientation","faceWidth","displayCols","perCol"].includes(k)){r.customPlacement=true;delete r.widthOverride}
if(["cabinetKey","faceOrientation","displayCols","perCol"].includes(k))同步同SKU满陈(r)
const 名={included:"纳入状态",selected:"选中标色",cabinetKey:"陈列柜段",faceOrientation:"陈列面方向",displayCols:"陈列列数",perCol:"单列容量",faceWidth:"单列占宽",currentStock:"当前库存",planCartons:"计划补货",name:"商品名称",barcode:"条码",grade:"等级",category3:"三级类目",carton:"箱规",dailyQty:"日销",volume:"体积"}[k]||k;
标记变更(r,名,"手动修改");
保存();
刷新陈列联动();
渲染全部()};
window.应用扩陈=(id,cabKey,moveFlag)=>{const r=状态.skus.find(x=>x.id===id);
if(!r)return;
const cabs=柜段使用();
const target=cabs.find(c=>c.key===(cabKey||r.cabinetKey));
if(!target){alert("未找到目标柜段");
return}
const oldWidth=moveFlag?0:当前柜段占宽(r,target.key);
const newWidth=扩陈后占宽(r,target.key,1,!!moveFlag);
const delta=newWidth-oldWidth;
if(delta>Math.max(0,数(target.left))+0.001){alert("当前柜段剩余"+格(target.left,0)+"mm，本次落地实际还需要"+格(delta,0)+"mm，执行后会超宽，已拦截。请先释放空间或选择移位方案。");
return}r.displayCols=数(r.displayCols)+1;
delete r.widthOverride;
r.customPlacement=true;
if(cabKey)r.cabinetKey=cabKey;
标记变更(r,"陈列列数","空位建议-"+(moveFlag?"移位扩陈1列":"扩陈1列"));
保存();
渲染全部();
切换("allocation");
完成提示("扩陈已应用：排柜、柜段余量和外储测算已更新。")};
window.应用新品=(exId,cabKey)=>{const ex=状态.excluded.find(x=>x.id===exId);
const cab=状态.cabinets.find(c=>c.key===cabKey);
if(!ex||!cab)return;
状态.skus.push({id:"sku_new_"+Date.now(),store:cab.store,included:true,status:"新增纳入",grade:ex.grade,rank:ex.rank,category2:ex.category2,category3:ex.category3,category4:ex.category4,name:ex.name,barcode:ex.barcode,length:ex.length,width:ex.width,height:ex.height,volume:ex.volume,carton:ex.carton,dailyQty:ex.dailyQty,dailySales:0,moq:0,moqDays:0,cabinetKey:cab.key,cabinetLabel:cab.label,position:cab.position,displayCols:1,perCol:估算单列容量(ex,cab),faceWidth:估算陈列面(ex,cab),currentStock:"",planCartons:1,sourceAdvice:"新增SKU",customPlacement:true,placements:[],modifiedFields:["新增SKU","陈列柜段","陈列列数","单列容量","单列占宽"],changeNote:"空位建议-新增SKU",note:"从空位建议纳入"});
状态.excluded=状态.excluded.filter(x=>x.id!==exId);
保存();
渲染全部();
切换("allocation");
完成提示("新增SKU已纳入当前柜段，排柜和柜段余量已更新。")};
window.手动新增SKU=()=>{const cab=柜段使用().find(c=>c.key===q("#suggestCabinet").value)||柜段使用().find(c=>c.store===门店名());
if(!cab){alert("请先选择一个柜段");
return}状态.skus.push({id:"sku_manual_"+Date.now(),store:cab.store,included:true,status:"手动新增",grade:"未评级",rank:9999,category2:"",category3:"待填写",category4:"",name:"新增SKU-请修改",barcode:"",length:0,width:0,height:0,volume:1,carton:1,dailyQty:0,dailySales:0,moq:0,moqDays:0,cabinetKey:cab.key,cabinetLabel:cab.label,position:cab.position,displayCols:1,perCol:1,faceWidth:Math.min(100,Math.max(0,数(cab.left)||100)),currentStock:"",planCartons:1,sourceAdvice:"手动新增",customPlacement:true,placements:[],modifiedFields:["手动新增SKU","陈列柜段"],changeNote:"手动新增SKU",note:"手动新增"});
保存();
渲染全部();
切换("allocation");
完成提示("手动新增SKU已创建，请继续完善商品信息和尺寸数据。")};
function 冰柜类型(c){const t=文(c?.kind)+" "+文(c?.label);
if(/冰淇淋|雪糕|冰品/.test(t))return "冰淇淋柜";
if(/立柜/.test(t))return "立柜";
if(/卧柜/.test(t))return "卧柜";
return 文(c?.kind)||"其他"}
function 柜号(c){const label=文(c?.label);if(label)return label;const t=文(c?.key);const ms=[...t.matchAll(/柜\d+/g)].map(m=>m[0]);return ms.length?ms[ms.length-1]:((t.match(/门\d+/)||[""])[0])}
function 陈列面方向(r){const f=数(r.faceWidth);const dims=[["长做陈列面",数(r.length)],["宽做陈列面",数(r.width)]].filter(x=>x[1]>0);if(!dims.length||!f)return "";dims.sort((a,b)=>Math.abs(a[1]-f)-Math.abs(b[1]-f));return dims[0][0]}
function 规范陈列面方向(v){const t=文(v);if(t==="长做陈列面"||t==="length"||t==="长")return "length";if(t==="宽做陈列面"||t==="width"||t==="宽")return "width";return ""}
function 陈列面方向值(r){return 规范陈列面方向(r?.faceOrientation)||(陈列面方向(r)==="长做陈列面"?"length":"width")}
function 场景分区(r){const t=文(r.sceneGroup||r.scene||r.category3||r.category2||r.name);if(/雪糕|冰品|冰淇淋|冰激凌|蛋筒|甜筒|冰棒/.test(t))return "雪糕冰品";if(/火锅/.test(t))return "火锅食材";if(/冷冻食材|肉|鱼|虾|牛|羊|鸡|鸭|丸|肠/.test(t)&&!/预制|主食/.test(t))return "冷冻食材";if(/预制菜|菜类|炸物|小吃|披萨|卷/.test(t))return "预制菜类";if(/主食|包子|馒头|烧麦|水饺|馄饨|面|饼|饭|汤圆/.test(t))return "预制主食";return 文(r.category3)||"其他"}
function 是否冰品柜段(c){const t=文(c?.kind)+" "+文(c?.label)+" "+文(c?.position)+" "+文(c?.key);
return /冰淇淋|雪糕|冰品/.test(t)}
function 是否补位陈列行(r){const t=[r?.placementRole,r?.sourceAdvice,r?.sourceAction,r?.note,r?.status,r?.changeNote].map(文).join(" ");
return /补位/.test(t)}
function 柜段含补位(cabKey,store=门店名()){return 门店SKU(store).some(r=>r.included&&r.cabinetKey===cabKey&&是否补位陈列行(r))}
function 柜段补位优先值(c,selectedKey=""){return (selectedKey&&c.key===selectedKey?0:1)+(柜段含补位(c.key,c.store)?0:2)}
function 是否冰品SKU(r){const t=文(r?.category2)+" "+文(r?.category3)+" "+文(r?.category4)+" "+文(r?.name)+" "+文(柜名(r))+" "+文(柜位(r));
return /雪糕|冰品|冰淇淋|冰激凌|冰棒|老冰棍|蛋筒|甜筒|冰沙/.test(t)}
function SKU占用宽度(r){return Math.max(0,数(r.displayCols)*数(r.faceWidth))}
function 当前柜段占宽(r,cabKey){return 本柜占宽(r,cabKey)}
function 扩陈后占宽(r,cabKey,colsAdd=1,move=false){const base=move?(当前柜段占宽(r,r.cabinetKey)||SKU占用宽度(r)):当前柜段占宽(r,cabKey);
return base+colsAdd*数(r.faceWidth)}
function 扩陈真实增量(r,cabKey,colsAdd=1,move=false){const old=move?0:当前柜段占宽(r,cabKey);
return 扩陈后占宽(r,cabKey,colsAdd,move)-old}
function 读取新品试算(){const t={name:文(q("#newSkuName")?.value)||"新增SKU",barcode:文(q("#newSkuBarcode")?.value),grade:文(q("#newSkuGrade")?.value)||"未评级",category3:文(q("#newSkuCategory")?.value)||"待分类",length:数(q("#newSkuLength")?.value),width:数(q("#newSkuWidth")?.value),height:数(q("#newSkuHeight")?.value),volume:数(q("#newSkuVolume")?.value),carton:Math.max(1,数(q("#newSkuCarton")?.value)||1),dailyQty:数(q("#newSkuDaily")?.value),displayCols:Math.max(1,数(q("#newSkuCols")?.value)||1),perCol:数(q("#newSkuPerCol")?.value)};
if(!t.volume&&t.length&&t.width&&t.height)t.volume=t.length*t.width*t.height/1e6;
return t}
function 新品基础完整(t){return t.length>0&&t.width>0&&t.height>0&&t.carton>0}
function 新品记录(t,cab,face,per){return{id:"sku_trial_"+Date.now()+"_"+Math.floor(Math.random()*10000),store:cab.store,included:true,status:"新品试算纳入",grade:t.grade,rank:9999,category2:"",category3:t.category3,category4:"",name:t.name,barcode:t.barcode,length:t.length,width:t.width,height:t.height,volume:t.volume||单品体积(t),carton:t.carton,dailyQty:t.dailyQty,dailySales:0,moq:0,moqDays:0,cabinetKey:cab.key,cabinetLabel:cab.label,position:cab.position,displayCols:t.displayCols,perCol:per,faceWidth:face,currentStock:"",planCartons:1,sourceAdvice:"新品试算",customPlacement:true,placements:[],modifiedFields:["新品试算","陈列柜段","陈列列数","单列容量","单列占宽"],changeNote:"新品试算-放入推荐柜段",note:"通过新品试算纳入"}}
function 模拟门店外储(store,colsChange={},newSku=null){const rows=纳入SKU(store).map(r=>colsChange[r.id]?{...r,displayCols:colsChange[r.id]}:r);
if(newSku)rows.push(newSku);
const calcs=rows.map(计算SKU);
const ext=calcs.filter(c=>c.external>0);
const avg=ext.reduce((a,c)=>a+c.avgVol,0);
const info=状态.stores.find(x=>x.store===store)||{};
const p95=avg*数(info.p95Factor||状态.params.p95Factor);
return{avg,p95,suggested:Math.ceil(p95*数(状态.params.externalSafetyFactor)),extSku:ext.length}}
function 调位排序(a,b){const order={D:1,C:2,B:3,A:4};
return (order[文(a.grade).toUpperCase()]||0)-(order[文(b.grade).toUpperCase()]||0)||数(a.dailyQty)-数(b.dailyQty)||数(b.faceWidth)-数(a.faceWidth)}
function 新品试算方案(t){const plans=[];
const store=门店名();
const cap=数(状态.params.externalCapL);
const selectedKey=文(q("#suggestCabinet")?.value);
const cabs=柜段使用().filter(c=>c.store===store).sort((a,b)=>柜段补位优先值(a,selectedKey)-柜段补位优先值(b,selectedKey)||数(a.left)-数(b.left));
for(const cab of cabs){const face=估算陈列面(t,cab);
const per=t.perCol>0?t.perCol:估算单列容量(t,cab);
const need=face*t.displayCols;
if(!(face>0&&need>0))continue;
const directNew=新品记录(t,cab,face,per);
const directSim=模拟门店外储(store,{},directNew);
if(need<=数(cab.left)+0.001&&directSim.suggested<=cap){plans.push({type:"直接放入",cab,face,per,need,after:数(cab.left)-need,reducers:[],newSku:directNew,sim:directSim,score:100000-柜段补位优先值(cab,selectedKey)*10000-数(cab.left)+need});
continue}
const gap=need-数(cab.left);
if(gap<=0)continue;
let freed=0;
const reducers=[];
const changes={};
const items=纳入SKU(store).filter(r=>r.cabinetKey===cab.key&&数(r.displayCols)>1).sort(调位排序);
for(const r of items){if(reducers.length>=3||freed>=gap)break;
const oldCols=数(r.displayCols);
const newCols=oldCols-1;
if(newCols<1)continue;
const current=当前柜段占宽(r,cab.key);
const next=Math.max(0,current-数(r.faceWidth));
const free=Math.max(0,current-next);
if(free<=0)continue;
reducers.push({id:r.id,name:r.name,grade:r.grade,oldCols,newCols,free});
changes[r.id]=newCols;
freed+=free}if(freed+数(cab.left)+0.001>=need&&reducers.length){const adjNew=新品记录(t,cab,face,per);
const sim=模拟门店外储(store,changes,adjNew);
if(sim.suggested<=cap){plans.push({type:"调位放入",cab,face,per,need,after:数(cab.left)+freed-need,reducers,newSku:adjNew,sim,score:50000-柜段补位优先值(cab,selectedKey)*10000-reducers.length*1000-freed})}}}return plans.sort((a,b)=>b.score-a.score)}
window.新品试算方案缓存={};
window.试算新品位置=()=>{const t=读取新品试算();
if(!新品基础完整(t)){q("#newSkuPositionSuggestions").innerHTML='<div class="empty">请先填写新品长、宽、高和箱规，系统才能测算可放位置。</div>';
return}
const rows=新品试算方案(t).slice(0,30);
window.新品试算方案缓存={};
rows.forEach((x,i)=>window.新品试算方案缓存["p"+i]=x);
表格("#newSkuPositionSuggestions",[{name:"方案",value:(x,i)=>x.type},{name:"推荐柜段",value:x=>x.cab.label+" "+x.cab.position,cls:()=>"name"},{name:"预计占宽",value:x=>格(x.need,0)+"mm"},{name:"腾位动作",value:x=>x.reducers.length?x.reducers.map(r=>r.name+"："+r.oldCols+"列→"+r.newCols+"列，释放"+格(r.free,0)+"mm").join("；"):"无需腾位",cls:()=>"name"},{name:"放入后剩余",value:x=>格(x.after,0)+"mm",cls:x=>x.after<0?"bad":"ok"},{name:"预估满陈",value:x=>格(x.per*t.displayCols,0)},{name:"预估需外储",value:x=>计算SKU(x.newSku).external},{name:"建议外储容量",value:x=>格(x.sim.suggested,0)+"L",cls:x=>x.sim.suggested<=数(状态.params.externalCapL)?"ok":"bad"},{name:"操作",value:(x,i)=>'<button onclick="应用新品试算方案(\'p'+i+'\')">应用方案</button>',html:true}],rows,"没有找到满足空间与754L外储上限的方案。可以尝试减少陈列列数、降低箱规或先释放低等级SKU。")};
window.应用新品试算方案=(planId)=>{const p=window.新品试算方案缓存?.[planId];
if(!p){alert("方案已过期，请重新试算");
return}
const cabNow=柜段使用().find(c=>c.key===p.cab.key);
const stillNeed=数(p.need);
let stillFreed=0;
for(const red of p.reducers){const r=状态.skus.find(x=>x.id===red.id);
if(r)stillFreed+=Math.max(0,当前柜段占宽(r,p.cab.key)-Math.max(0,当前柜段占宽(r,p.cab.key)-数(r.faceWidth)))}if(!cabNow||数(cabNow.left)+stillFreed+0.001<stillNeed){alert("当前柜段空间已变化，应用后会超宽。请重新试算。");
return}for(const red of p.reducers){const r=状态.skus.find(x=>x.id===red.id);
if(r){r.displayCols=red.newCols;
delete r.widthOverride;
r.customPlacement=true;
标记变更(r,"陈列列数","新品试算-为新品腾位")}}状态.skus.push(p.newSku);
保存();
渲染全部();
切换("allocation");
完成提示("新品试算方案已应用：排柜、柜段余量和外储测算已更新。")};
window.空位方案缓存={};
function 柜段内SKU(store,cabKey){const seen=new Set();return 纳入SKU(store).filter(r=>{if(r.cabinetKey!==cabKey)return false;const k=r.lifecycleTaskId?[r.lifecycleTaskId,r.lifecycleTaskRowId||r.id].join("||"):"";if(k&&seen.has(k))return false;if(k)seen.add(k);return true})}
function 缩减候选(store,cabKey,excludeId,gap){let freed=0;
const reducers=[];
const items=柜段内SKU(store,cabKey).filter(r=>r.id!==excludeId&&数(r.displayCols)>1).sort((a,b)=>等级分(a.grade)-等级分(b.grade)||数(a.dailyQty)-数(b.dailyQty));
for(const r of items){if(freed>=gap||reducers.length>=2)break;
const cur=当前柜段占宽(r,cabKey);
const nw=Math.max(0,cur-数(r.faceWidth));
if(cur-nw<=0)continue;
reducers.push({id:r.id,name:r.name,oldCols:数(r.displayCols),newCols:数(r.displayCols)-1,oldWidth:cur,free:cur-nw});
freed+=cur-nw}return{reducers,freed}}
function 原位置补位建议(r){const cab=柜段使用().find(c=>c.key===r.cabinetKey);
if(!cab)return "";
const rows=柜段内SKU(r.store,r.cabinetKey).filter(x=>x.id!==r.id&&是否冰品SKU(x)===是否冰品柜段(cab)).map(x=>({x,delta:数(x.faceWidth),score:等级分(x.grade)*1000+数(x.dailyQty)*100})).filter(o=>o.delta>0).sort((a,b)=>b.score-a.score);
return rows[0]?"原位置释放后，优先可扩陈："+rows[0].x.name:"原位置释放后，可人工复核该层是否需要扩陈"}
function 生成空位方案(targetCab){const store=targetCab.store;
const left=数(targetCab.left);
const cap=数(状态.params.externalCapL);
const plans=[];
if(left<=0)return plans;
const targetIce=是否冰品柜段(targetCab);
for(const r of 纳入SKU(store)){if(是否冰品SKU(r)!==targetIce)continue;
const grade=文(r.grade).toUpperCase();
if(!["A","B","C"].includes(grade))continue;
const same=r.cabinetKey===targetCab.key;
const old=计算SKU(r);
if(same){const cur=当前柜段占宽(r,targetCab.key);
const newWidth=cur+数(r.faceWidth);
const need=newWidth-cur;
if(need<=left+0.001){const temp={...r,displayCols:数(r.displayCols)+1};
const after=计算SKU(temp);
plans.push({type:"原位扩陈",r,targetCab,old,after,targetWidth:newWidth,need,reducers:[],note:"同一柜段直接增加1列",score:9000+等级分(r.grade)*1000+数(r.dailyQty)*100})}continue}
const curOrigin=当前柜段占宽(r,r.cabinetKey)||SKU占用宽度(r);
for(const add of [1,0]){const newCols=数(r.displayCols)+add;
const targetWidth=curOrigin+add*数(r.faceWidth);
const need=targetWidth;
const gap=need-left;
let reducers=[];
let freed=0;
if(gap>0){const red=缩减候选(store,targetCab.key,r.id,gap);
reducers=red.reducers;
freed=red.freed}if(need<=left+freed+0.001){const colsChange={};
reducers.forEach(x=>colsChange[x.id]=x.newCols);
colsChange[r.id]=newCols;
const sim=模拟门店外储(store,colsChange,null);
if(sim.suggested<=cap){const after=计算SKU({...r,displayCols:newCols});
plans.push({type:add?"移位扩陈":"移位移入",r,targetCab,old,after,targetWidth,need,reducers,note:(reducers.length?"需先缩减目标层其他品：":"")+(reducers.map(x=>x.name+" "+x.oldCols+"列→"+x.newCols+"列").join("；")||"直接移入目标空位")+"；"+原位置补位建议(r),score:(add?7000:6000)+(柜段含补位(targetCab.key,targetCab.store)?800:0)+等级分(r.grade)*1000+数(r.dailyQty)*100-reducers.length*500})}}}}
return plans.sort((a,b)=>b.score-a.score)}
window.应用空位方案=(pid)=>{const p=window.空位方案缓存?.[pid];
if(!p){alert("方案已过期，请重新测算");
return}
const cab=柜段使用().find(c=>c.key===p.targetCab.key);
if(!cab){alert("目标柜段不存在");
return}
let freed=0;
for(const red of p.reducers){const rr=状态.skus.find(x=>x.id===red.id);
if(rr)freed+=Math.max(0,red.free||数(rr.faceWidth))}
const currentInTarget=p.r.cabinetKey===p.targetCab.key?当前柜段占宽(状态.skus.find(x=>x.id===p.r.id),p.targetCab.key):0;
const need=p.targetWidth-currentInTarget;
if(need>数(cab.left)+freed+0.001){alert("当前空间已变化，应用后会超宽，请重新测算。");
return}for(const red of p.reducers){const rr=状态.skus.find(x=>x.id===red.id);
if(rr){rr.displayCols=red.newCols;
delete rr.widthOverride;
rr.customPlacement=true;
标记变更(rr,"陈列列数","空位方案-为移位腾位")}}
const r=状态.skus.find(x=>x.id===p.r.id);
if(r){r.displayCols=p.after.full?数(p.r.displayCols)+(p.type.includes("扩陈")?1:0):数(p.r.displayCols);
delete r.widthOverride;
r.cabinetKey=p.targetCab.key;
r.cabinetLabel=p.targetCab.label;
r.position=p.targetCab.position;
r.customPlacement=true;
标记变更(r,"陈列柜段、陈列列数","空位建议-"+p.type)}保存();
渲染全部();
切换("allocation");
完成提示("空位方案已应用：排柜、柜段余量和外储测算已更新。")};
function 柜型摆法(r,c,preferred="",strict=false){
  // 业务口径：卧柜/冰淇淋柜的纵深数量使用柜体宽度字段 c.depth，不使用柜体长度或柜体深。
  const L=数(r?.length),W=数(r?.width),H=数(r?.height),D=数(c?.depth),CH=数(c?.height);
  const upright=/立柜/.test(文(c?.kind)+" "+文(c?.type)+" "+文(c?.label));
  if(!(L>0&&W>0&&H>0&&D>0&&CH>0))return null;
  const raw=upright
    ?[{faceOrientation:"length",face:L,depth:H,h:W},{faceOrientation:"width",face:W,depth:H,h:L}]
    :[{faceOrientation:"length",face:L,depth:W,h:H},{faceOrientation:"width",face:W,depth:L,h:H}];
  // 卧柜/冰淇淋柜默认"长做陈列面"（可堆叠），立柜默认取面宽较小者（能放更多列）
  const wanted=规范陈列面方向(preferred)||陈列面方向值(r)||(upright?"width":"length");
  const feasible=raw.filter(o=>o.face>0&&o.depth>0&&o.h>0&&o.depth<=D+0.001&&o.h<=CH+(upright?50:0)+0.001).map(o=>({
    ...o,
    per:Math.floor(D/o.depth)*(upright?1:Math.floor(CH/o.h))
  })).filter(o=>o.per>0);
  if(strict)return feasible.find(o=>o.faceOrientation===wanted)||null;
  return feasible.find(o=>o.faceOrientation===wanted)||feasible.sort((a,b)=>b.per-a.per||a.face-b.face)[0]||null
}
function 目标柜型参数(r,c,preferred="",strict=false){
  const best=柜型摆法(r,c,preferred,strict);
  return best?{faceOrientation:best.faceOrientation,faceWidth:best.face,perCol:best.per}:null
}
function 应用目标柜型参数(r,c,preferred=""){
  const layout=目标柜型参数(r,c,preferred);
  if(!layout)return false;
  r.faceOrientation=layout.faceOrientation;r.faceWidth=layout.faceWidth;r.perCol=layout.perCol;
  return true
}
function 估算陈列面(r,c){return 目标柜型参数(r,c)?.faceWidth||0}
function 估算单列容量(r,c){return 目标柜型参数(r,c)?.perCol||0}
function 选项初始化(){const stores=状态.stores.map(s=>s.store).sort((a,b)=>a.localeCompare(b,"zh-CN"));
q("#storeSelect").innerHTML=stores.map(s=>'<option value="'+逃(s)+'">'+逃(s)+"</option>").join("");
当前.门店=当前.门店||stores[0]||"";
q("#storeSelect").value=当前.门店;
const levels=[...new Set(状态.skus.map(r=>r.grade).filter(Boolean))].sort();
q("#levelFilter").innerHTML='<option value="">全部等级</option>'+levels.map(x=>'<option>'+逃(x)+"</option>").join("");
const risks=["无外储","低风险","中风险","高风险","极高风险"];
q("#riskFilter").innerHTML='<option value="">全部风险</option>'+risks.map(x=>'<option>'+x+"</option>").join("");
刷新排柜筛选();
刷新柜段下拉()}
function 刷新排柜筛选(){const store=门店名();
const cabs=状态.cabinets.filter(c=>c.store===store);
const fill=(id,arr,label)=>{const el=q("#"+id);
if(!el)return;
const old=el.value;
const counts=new Map();
arr.map(文).filter(Boolean).forEach(v=>counts.set(v,(counts.get(v)||0)+1));
const vals=[...counts.keys()].sort((a,b)=>文(a).localeCompare(文(b),"zh-CN"));
el.innerHTML='<option value="">'+label+'（'+vals.length+'项）</option>'+vals.map(v=>'<option value="'+逃(v)+'">'+逃(v)+'（'+counts.get(v)+'）</option>').join("");
if(vals.includes(old))el.value=old};
fill("allocationTypeFilter",cabs.map(冰柜类型),"全部冰柜类型");
fill("allocationCabNoFilter",cabs.map(柜号),"全部陈列柜");
fill("allocationPosFilter",cabs.map(c=>c.position),"全部位置");
fill("allocationSceneFilter",门店SKU(store).map(场景分区),"全部场景") }
function 刷新柜段下拉(){const el=q("#suggestCabinet");if(!el)return;const store=门店名();
const cabs=柜段使用().filter(c=>c.store===store).sort((a,b)=>b.left-a.left);
q("#suggestCabinet").innerHTML=cabs.map(c=>'<option value="'+逃(c.key)+'">'+逃(c.label+" "+c.position+" 剩余"+格(c.left,0)+"mm")+"</option>").join("");
if(当前.建议柜段&&cabs.some(c=>c.key===当前.建议柜段))q("#suggestCabinet").value=当前.建议柜段}
function 渲染总览(){const rows=全部门店汇总();
const directNoExternal=rows.filter(r=>r.extSku===0&&r.skuCount>0).length;
const maxSug=Math.max(0,...rows.map(r=>r.suggested));
const poolCount=在售SKU池().length;
const totalMissing=rows.reduce((s,r)=>s+r.missingSkuCount,0);
const items=[["门店数",rows.length],["在售SKU",poolCount],["直接整箱无需外储",directNoExternal],["需配置外储门店",rows.filter(r=>r.extSku>0).length],["未纳入SKU合计",totalMissing,totalMissing?"warning":""],["最大建议外储",格(maxSug,0)+"L",maxSug>754?"danger":""],["超754L门店",rows.filter(r=>!r.ok).length,rows.some(r=>!r.ok)?"danger":""],["高/极高风险",rows.reduce((s,r)=>s+r.high,0)+"/"+rows.reduce((s,r)=>s+r.extreme,0),"warning"]];
q("#metricGrid").innerHTML=items.map(([l,v,c=""])=>'<div class="metric '+c+'"><div class="label">'+l+'</div><div class="value">'+v+"</div></div>").join("");
const kw=文(q("#overviewSearch").value);
表格("#storeRank",[{name:"门店",value:r=>r.store,cls:()=>"name"},{name:"类型",value:r=>r.type},{name:"在售SKU",value:r=>r.poolCount},{name:"已纳入SKU",value:r=>r.skuCount},{name:"未纳入SKU",value:r=>r.missingSkuCount,cls:r=>r.missingSkuCount?"warning":"ok"},{name:"直接整箱到店SKU数",value:r=>r.direct},{name:"需外储SKU数",value:r=>r.extSku},{name:"静态满载L",value:r=>格(r.staticVol)},{name:"动态P95L",value:r=>格(r.p95)},{name:"建议外储L",value:r=>格(r.suggested,0),cls:r=>r.ok?"ok":"bad"},{name:"高风险",value:r=>r.high},{name:"极高风险",value:r=>r.extreme},{name:"冰柜资源",value:r=>"立柜："+(r.vertical||"-")+"；卧柜："+(r.chest||"-")+"；冰淇淋："+(r.ice||"-"),cls:()=>"name"}],rows.filter(r=>包含(r,kw)).sort((a,b)=>b.suggested-a.suggested))}
function 商品列(){return[{name:"商品",value:r=>r.name,cls:()=>"name"},{name:"等级",value:r=>标签(r.grade),html:true},{name:"三级类目",value:r=>r.category3},{name:"场景分区",value:r=>场景分区(r)},{name:"长×宽×高mm",value:r=>格(r.length,0)+"×"+格(r.width,0)+"×"+格(r.height,0)+"mm"},{name:"陈列柜",value:r=>柜名(r),cls:()=>"name"},{name:"具体位置",value:r=>柜位(r)},{name:"推荐摆法",value:r=>陈列面方向(r)},{name:"占宽mm",value:r=>格(r.faceWidth,0)},{name:"列数",value:r=>格(r.displayCols,0)},{name:"单列容量",value:r=>格(r.perCol,1)},{name:"满陈",value:r=>计算SKU(r).full},{name:"箱规",value:r=>格(r.carton,0)},{name:"触发库存",value:r=>计算SKU(r).trigger},{name:"可入柜",value:r=>计算SKU(r).receivable},{name:"需外储",value:r=>计算SKU(r).external},{name:"静态外储L",value:r=>格(计算SKU(r).staticVol)},{name:"风险",value:r=>风险标签(计算SKU(r).risk),html:true},{name:"起订量周转",value:r=>r.moqDays?格(r.moqDays):""}]}
function 柜名(r){return 状态.cabinets.find(c=>c.key===r.cabinetKey)?.label||r.cabinetLabel||""}
function 柜位(r){return 状态.cabinets.find(c=>c.key===r.cabinetKey)?.position||r.position||""}
function 渲染门店(){const store=门店名();
const s=门店汇总(store);
q("#storeHeader").innerHTML=[["门店",store],["在售SKU",s.poolCount],["已纳入SKU",s.skuCount],["未纳入SKU",s.missingSkuCount],["直接整箱到店SKU数",s.direct],["需外储SKU数",s.extSku],["动态P95",格(s.p95)+"L"],["建议外储",格(s.suggested,0)+"L"]].map(([a,b])=>'<div class="summary-cell"><span>'+a+"</span><strong>"+b+"</strong></div>").join("");
const kw=文(q("#storeSearch").value);
const includedRows=纳入SKU(store).filter(r=>包含(r,kw));
const allRows=门店SKU(store).filter(r=>包含(r,kw));
if(kw&&includedRows.length===0&&allRows.length>0){q("#storeDetail").innerHTML='<div class="empty">排柜调整中有匹配商品，但当前未纳入门店执行。请到排柜调整查看该商品的“纳入”勾选状态。</div>';
return}表格("#storeDetail",商品列().concat([{name:"补货动作",value:r=>动作文案(r),cls:()=>"name"}]),includedRows)}
function 动作文案(r){const c=计算SKU(r);
return"库存≤"+c.trigger+"件触发；补1箱/"+格(r.carton,0)+"件；可入柜"+格(c.inShelf,0)+"件，进外储"+格(c.external,0)+"件"}
function 渲染商品(){const kw=文(q("#goodsSearch").value),level=文(q("#levelFilter").value);
const store=门店名();let rows=纳入SKU(store).filter(r=>!level||r.grade===level).filter(r=>包含(r,kw));rows=[...new Map(rows.map(r=>[产品主键(r)||r.id,r])).values()];
表格("#goodsTable",[{name:"门店",value:r=>r.store}].concat(商品列()),rows)}
function 渲染风险(){const kw=文(q("#riskSearch").value),risk=文(q("#riskFilter").value),store=门店名();
const target=当前.定位SKU;const rows=门店SKU(store).map(r=>({r,c:计算SKU(r),__rowClass:target&&(r.name===target||r.barcode===target)?"selected-row":""})).filter(x=>x.c.external>0||(target&&(x.r.name===target||x.r.barcode===target))).filter(x=>!risk||x.c.risk===risk||(target&&(x.r.name===target||x.r.barcode===target))).filter(x=>包含(x.r,kw)).sort((a,b)=>b.c.externalDays-a.c.externalDays);
表格("#riskTable",[{name:"商品",value:x=>x.r.name,cls:()=>"name"},{name:"等级",value:x=>标签(x.r.grade),html:true},{name:"三级类目",value:x=>x.r.category3},{name:"日销",value:x=>格(x.r.dailyQty,3)},{name:"箱规",value:x=>格(x.r.carton,0)},{name:"需外储",value:x=>x.c.external},{name:"静态体积L",value:x=>格(x.c.staticVol)},{name:"外储天",value:x=>格(x.c.externalDays)},{name:"风险",value:x=>风险标签(x.c.risk),html:true}],rows)}
function 渲染补货(){const store=门店名();
const extUsed=数(q("#currentExternalL").value);
const s=门店汇总(store);
q("#replenishCards").innerHTML=[["当前建议外储",格(s.suggested,0)+"L",s.ok?"":"danger"],["当前外储已占用",格(extUsed,0)+"L"],["外储剩余额度",格(Math.max(0,状态.params.externalCapL-extUsed),0)+"L"],["需外储SKU数",s.extSku],["高风险",s.high,"warning"],["极高风险",s.extreme,"danger"]].map(([l,v,c=""])=>'<div class="metric '+c+'"><div class="label">'+l+'</div><div class="value">'+v+"</div></div>").join("");
const kw=文(q("#replenishSearch").value);
const rows=纳入SKU(store).filter(r=>包含(r,kw));
表格("#replenishTable",[{name:"商品",value:r=>r.name,cls:()=>"name"},{name:"箱规",value:r=>格(r.carton,0)},{name:"满陈",value:r=>计算SKU(r).full},{name:"当前在架库存",value:r=>输入(r.currentStock,"改SKU('"+r.id+"','currentStock',this.value)") ,html:true},{name:"计划补货箱数",value:r=>输入(r.planCartons,"改SKU('"+r.id+"','planCartons',this.value)"),html:true},{name:"最多可补箱数",value:r=>补货测算(r,extUsed).maxCartons,cls:r=>补货测算(r,extUsed).maxCartons>0?"ok":"bad"},{name:"本次入柜",value:r=>补货测算(r,extUsed).inShelf},{name:"本次进外储",value:r=>补货测算(r,extUsed).external},{name:"补后外储L",value:r=>格(补货测算(r,extUsed).afterExternalL)},{name:"判断",value:r=>补货测算(r,extUsed).status,cls:r=>补货测算(r,extUsed).ok?"ok":"bad"}],rows)}
function 补货测算(r,extUsed){const c=计算SKU(r);
const stock=r.currentStock===""?c.trigger:数(r.currentStock);
const shelfSpace=Math.max(0,c.full-stock);
const externalUnits=Math.floor(Math.max(0,状态.params.externalCapL-extUsed)/Math.max(0.0001,c.vol));
const maxCartons=Math.floor((shelfSpace+externalUnits)/Math.max(1,数(r.carton)));
const plan=Math.max(0,数(r.planCartons));
const total=plan*数(r.carton);
const inShelf=Math.min(total,shelfSpace);
const external=Math.max(0,total-inShelf);
const afterExternalL=extUsed+external*c.vol;
const ok=plan<=maxCartons&&afterExternalL<=状态.params.externalCapL;
return{stock,shelfSpace,maxCartons,inShelf,external,afterExternalL,ok,status:ok?(plan>0?"可补":"未计划"):"超出可补上限"}}
function 陈列位置组(r){
const cab=状态.cabinets.find(c=>c.key===r.cabinetKey)||{};
const label=柜名(r), position=柜位(r);
return [{cabinetKey:r.cabinetKey,label,position,fullLabel:(label+" "+position).trim(),width:SKU占用宽度(r),cap:满陈(r),cols:数(r.displayCols),kind:冰柜类型(cab)}]
}
function 同柜型拆分提示(r){const gs=陈列位置组(r);const byKind=new Map();for(const g of gs){if(!g.kind)continue;const s=byKind.get(g.kind)||new Set();s.add(g.label);byKind.set(g.kind,s)}const bad=[...byKind.entries()].filter(([k,s])=>s.size>1).map(([k,s])=>k+"拆分"+s.size+"柜");return bad.join("；")}
function 陈列筛选命中(r,typeKw,noKw,posKw,cabKw=""){const gs=陈列位置组(r);return gs.some(g=>(!typeKw||g.kind===typeKw)&&(!noKw||g.label===noKw)&&(!posKw||g.position===posKw)&&(!cabKw||文(g.fullLabel+" "+g.cabinetKey).includes(cabKw)))}function 陈列位置明细(r){return 陈列位置组(r).map(g=>'<div class="placement-line">'+逃(g.fullLabel)+'：'+格(g.cols,0)+'列，'+格(g.width,0)+'mm，'+格(g.cap,0)+'件</div>').join("")}function 陈列位置文本(r){return 陈列位置组(r).map(g=>g.fullLabel+" "+g.cabinetKey).join(" ")}function 渲染排柜(){const store=门店名();
const kw=文(q("#allocationSearch")?.value);
const cabKw=文(q("#allocationCabinetSearch")?.value);
const typeKw=文(q("#allocationTypeFilter")?.value);
const noKw=文(q("#allocationCabNoFilter")?.value);
const posKw=文(q("#allocationPosFilter")?.value);
const sceneKw=文(q("#allocationSceneFilter")?.value);
const target=当前.定位SKU;const rows=门店SKU(store).filter(r=>包含(r,kw)).filter(r=>!sceneKw||场景分区(r)===sceneKw).filter(r=>陈列筛选命中(r,typeKw,noKw,posKw,cabKw)).map(r=>({...r,__rowClass:(r.selected||(target&&(r.name===target||r.barcode===target)))?"selected-row":""}));
 表格("#allocationTable",[{name:"变更",value:r=>变更标签(r),html:true,cls:()=>"name"},{name:"商品",value:r=>r.name,cls:()=>"name"},{name:"等级",value:r=>标签(r.grade),html:true},{name:"三级类目",value:r=>r.category3},{name:"场景分区",value:r=>场景分区(r)},{name:"条码",value:r=>r.barcode},{name:"长×宽×高mm",value:r=>格(r.length,0)+"×"+格(r.width,0)+"×"+格(r.height,0)+"mm"},{name:"陈列面方向（可修改）",value:r=>选择陈列面方向(r),html:true},{name:"箱规",value:r=>格(r.carton,0)},{name:"日销",value:r=>格(r.dailyQty,3)},{name:"单列占宽mm",value:r=>格(r.faceWidth,0)},{name:"陈列柜（可修改）",value:r=>选择柜(r),html:true},{name:"具体位置",value:r=>柜位(r)},{name:"陈列列数（可修改）",value:r=>输入(r.displayCols,"改SKU('"+r.id+"','displayCols',this.value)"),html:true},{name:"单列容量（可修改）",value:r=>输入(r.perCol,"改SKU('"+r.id+"','perCol',this.value)"),html:true},{name:"本柜占宽",value:r=>格(本柜占宽(r),0)+"mm"},{name:"总占宽",value:r=>格(SKU占用宽度(r),0)+"mm"},{name:"满陈",value:r=>计算SKU(r).full},{name:"触发库存",value:r=>计算SKU(r).trigger},{name:"需外储",value:r=>计算SKU(r).external},{name:"外储L",value:r=>格(计算SKU(r).staticVol)},{name:"柜段剩余",value:r=>{const c=柜段使用().find(x=>x.key===r.cabinetKey);return c?格(c.left,0)+"mm":""},cls:r=>{const c=柜段使用().find(x=>x.key===r.cabinetKey);return c&&c.left<0?"bad":""}}],rows)}
function 渲染柜段(){const kw=文(q("#cabinetSearch").value);
const store=门店名();
const rows=柜段使用().filter(c=>c.store===store).filter(c=>包含(c,kw));
表格("#cabinetTable",[{name:"柜段",value:c=>c.label+" "+c.position,cls:()=>"name"},{name:"柜型",value:c=>c.kind},{name:"长",value:c=>格(c.length,0)},{name:"深",value:c=>格(c.depth,0)},{name:"高",value:c=>格(c.height,0)},{name:"已用宽度",value:c=>格(c.used,0)},{name:"剩余宽度",value:c=>格(c.left,0),cls:c=>c.left<0?"bad":"ok"},{name:"状态",value:c=>c.over?"超宽":"正常",cls:c=>c.over?"bad":"ok"},{name:"占用SKU",value:c=>c.items.map(x=>x.name+"("+格(x.used,0)+"mm)").join("；"),cls:()=>"name"}],rows)}
function 刷新在售建议选择(){
 const storeEl=q("#suggestStore"),productEl=q("#suggestProduct");
 if(!storeEl||!productEl)return;
 const stores=(状态.stores||[]).map(s=>s.store).filter(Boolean);
 const oldStore=storeEl.value||当前.门店||stores[0]||"";
 storeEl.innerHTML=stores.map(s=>'<option value="'+逃(s)+'">'+逃(s)+"</option>").join("");
 storeEl.value=stores.includes(oldStore)?oldStore:(stores[0]||"");
 const products=[...在售SKU池()].sort((a,b)=>数(a.rank)-数(b.rank)||文(a.name).localeCompare(文(b.name),"zh-CN"));
 const oldProduct=productEl.value;
 productEl.innerHTML=products.map(p=>'<option value="'+逃(产品主键(p))+'">'+逃(p.name||p.barcode||"未命名商品")+'｜'+逃(p.barcode||"无条码")+'</option>').join("");
 if(products.some(p=>产品主键(p)===oldProduct))productEl.value=oldProduct;
 else if(products[0])productEl.value=产品主键(products[0]);
}
function 读取在售建议商品(){const key=文(q("#suggestProduct")?.value);return 在售SKU池().find(p=>产品主键(p)===key)||null}
function 现有商品行(store,key){return 纳入SKU(store).filter(r=>产品主键(r)===key)}
function 在售商品建议行(store,product){
 const key=产品主键(product),existing=现有商品行(store,key),baseRow=existing[0]||product;
 const sameFace=数(baseRow.faceWidth)>0?数(baseRow.faceWidth):0;
 const desiredCols=Math.max(1,...existing.map(r=>数(r.displayCols)||1));
 const candidates=[];
 for(const cab of 柜段使用().filter(c=>c.store===store&&柜段可陈列(c)&&!c.over)){
  if(是否冰品SKU(product)!==是否冰品柜段(cab))continue;
  const face=sameFace||估算陈列面(product,cab);if(!(face>0))continue;
  const cols=Math.max(1,desiredCols),need=face*cols,left=数(cab.left);
  if(existing.some(r=>r.cabinetKey===cab.key))continue;
  const candidate={...产品转SKU(product,store),id:"suggestion",cabinetKey:cab.key,cabinetLabel:cab.label,position:cab.position,displayCols:cols,perCol:existing[0]?.perCol||估算单列容量(product,cab),faceWidth:face};
  const projected=existing.length?模拟门店外储(store,{},null):模拟门店外储(store,{},candidate);
  const direct=left+0.001>=need;
  if(direct&&projected.suggested<=数(状态.params.externalCapL))candidates.push({product,cab,type:existing.length?"移位到空位":"直接补位",face,cols,need,after:left-need,reducers:[],projected,source:existing[0]?.cabinetLabel?existing[0].cabinetLabel+" "+existing[0].position:"未纳入当前门店",score:100000-left});
  if(direct)continue;
  let freed=0;const reducers=[];
  const targetRows=纳入SKU(store).filter(r=>r.cabinetKey===cab.key&&产品主键(r)!==key&&数(r.displayCols)>1).sort((a,b)=>等级分(a.grade)-等级分(b.grade)||数(a.dailyQty)-数(b.dailyQty));
  for(const row of targetRows){if(freed+left+0.001>=need||reducers.length>=4)break;const free=Math.max(0,数(row.faceWidth));if(!(free>0))continue;reducers.push({name:row.name,oldCols:数(row.displayCols),newCols:Math.max(1,数(row.displayCols)-1),free});freed+=free}
  if(freed+left+0.001>=need){const projectedShrink=existing.length?模拟门店外储(store,Object.fromEntries(reducers.map(x=>[targetRows.find(r=>r.name===x.name)?.id||"",x.newCols]))):模拟门店外储(store,Object.fromEntries(reducers.map(x=>[targetRows.find(r=>r.name===x.name)?.id||"",x.newCols])),candidate);if(projectedShrink.suggested<=数(状态.params.externalCapL))candidates.push({product,cab,type:"压缩腾位后移入",face,cols,need,after:left+freed-need,reducers,projected:projectedShrink,source:existing[0]?.cabinetLabel?existing[0].cabinetLabel+" "+existing[0].position:"未纳入当前门店",score:50000-reducers.length*1000-left})}
 }
 return candidates.sort((a,b)=>b.score-a.score).slice(0,30)
}
window.空位在售建议缓存={};
window.定位空位建议=id=>{const p=window.空位在售建议缓存[id];if(!p)return;当前.门店=p.store;当前.定位SKU=p.product.name||p.product.barcode;const sel=q("#storeSelect");if(sel)sel.value=p.store;渲染全部();切换("allocation");完成提示("已定位到"+p.store+"的"+当前.定位SKU+"，未修改任何数据。")};
function 渲染建议(){刷新柜段下拉();刷新在售建议选择();const store=q("#suggestStore")?.value||门店名();const product=读取在售建议商品();const out=q("#expandSuggestions"),summary=q("#suggestSummary");if(!out)return;if(!product){out.innerHTML='<div class="empty">当前没有可用的在售SKU。</div>';return}const rows=在售商品建议行(store,product);window.空位在售建议缓存={};rows.forEach((p,i)=>{p.store=store;window.空位在售建议缓存["s"+i]=p});if(summary)summary.innerHTML='<div class="metric"><div class="label">选择商品</div><div class="value">'+逃(product.name||product.barcode||"未命名商品")+'</div><div class="sub">在售SKU池：'+格(在售SKU池().length,0)+' 个｜当前门店已陈列：'+格(现有商品行(store,产品主键(product)).length,0)+' 行</div></div><div class="metric"><div class="label">建议数量</div><div class="value">'+格(rows.length,0)+'</div><div class="sub">只读测算，不会改动产品池、门店SKU或排柜</div></div>';
 表格("#expandSuggestions",[{name:"产品",value:p=>p.product.name||p.product.barcode,cls:()=>"name"},{name:"方案",value:p=>p.type},{name:"推荐柜段",value:p=>p.cab.label+" "+p.cab.position,cls:()=>"name"},{name:"来源位置",value:p=>p.source,cls:()=>"name"},{name:"陈列列数",value:p=>格(p.cols,0)},{name:"单列占宽",value:p=>格(p.face,0)+"mm"},{name:"预计占宽",value:p=>格(p.need,0)+"mm"},{name:"放入后剩余",value:p=>格(p.after,0)+"mm",cls:p=>p.after<0?"bad":"ok"},{name:"腾位动作",value:p=>p.reducers.length?p.reducers.map(r=>r.name+" "+r.oldCols+"→"+r.newCols+"列").join("；"):"无需腾位",cls:()=>"name"},{name:"外储建议",value:p=>格(p.projected.suggested,0)+"L"},{name:"操作",value:(p,i)=>'<button type="button" onclick="定位空位建议(\'s'+i+'\')">定位排柜</button>',html:true}],rows,"当前门店没有满足同柜别、柜段不超宽且外储不超过上限的方案；请先在排柜中释放空间。")}

window.新增门店测算缓存=null;
function 新店配置示例(){return ["卧柜,2500,3,1988*697*459+360*697*199","卧柜,2000,1,1488*697*459+360*697*199","冰淇淋柜,1900,1,1386*697.5*424+325*697.5*164","立柜,3m,1,门数=4,层数=5,710*534*250"].join("\n")}
function 解析尺寸组(spec){const groups=[];文(spec).split("+").forEach((part,i)=>{const nums=(part.match(/[\d.]+/g)||[]).map(Number);if(nums.length>=3)groups.push({length:nums[0],depth:nums[1],height:nums[2],position:"分区"+(i+1),rawPosition:String(i+1)});});return groups}
function 解析立柜参数(model,spec){const nums=(文(spec).match(/[\d.]+/g)||[]).map(Number);let doors=0,layers=5,length=710,depth=534,height=250;if(/门数\s*=\s*(\d+)/.test(spec))doors=Number(spec.match(/门数\s*=\s*(\d+)/)[1]);if(/层数\s*=\s*(\d+)/.test(spec))layers=Number(spec.match(/层数\s*=\s*(\d+)/)[1]);if(!doors){if(/7\.5/.test(model))doors=10;else if(/3/.test(model))doors=4;else if(/2\.5/.test(model))doors=3;else doors=1}if(nums.length>=3){const last=nums.slice(-3);length=last[0];depth=last[1];height=last[2]}return{doors,layers:Math.min(5,Math.max(1,layers)),length,depth,height}}
function 解析新增门店柜段(store,txt){const cabs=[];const errors=[];let seq=1;const lines=文(txt).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);for(const line of lines){const parts=line.split(/[,，|\t]/).map(x=>x.trim()).filter(Boolean);if(parts.length<4){errors.push(line+"：字段不足");continue}const kind=parts[0],model=parts[1],count=Math.max(1,Math.floor(数(parts[2])||1)),spec=parts.slice(3).join(",");if(/立柜/.test(kind)){const cfg=解析立柜参数(model,spec);for(let n=1;n<=count;n++){for(let d=1;d<=cfg.doors;d++){const no=cabs.filter(c=>c.kind==="立柜").map(c=>数(c.rawNo)).reduce((a,b)=>Math.max(a,b),0)+1;for(let l=1;l<=cfg.layers;l++){const label="立柜"+model+"-柜"+no;const pos="第"+l+"层";cabs.push({id:"new_cab_"+seq++,store,key:store+"__"+label+"__"+pos,label,position:pos,rawNo:String(no),rawPosition:String(l),kind:"立柜",type:model,length:cfg.length,depth:cfg.depth,height:cfg.height,sourceUsed:0,sourceLeft:cfg.length})}}}}else{const groups=解析尺寸组(spec);if(!groups.length){errors.push(line+"：尺寸无法识别");continue}for(let n=1;n<=count;n++){const no=cabs.filter(c=>c.kind===kind).map(c=>数(c.rawNo)).reduce((a,b)=>Math.max(a,b),0)+1;for(const g of groups){const label=kind+model+"-柜"+no;cabs.push({id:"new_cab_"+seq++,store,key:store+"__"+label+"__"+g.position,label,position:g.position,rawNo:String(no),rawPosition:g.rawPosition,kind,type:model,length:g.length,depth:g.depth,height:g.height,sourceUsed:0,sourceLeft:g.length})}}}}return{cabs,errors}}
function 新店SKU池(){return 产品池有效().map(p=>产品转SKU(p,"__模板门店__")).sort((a,b)=>是否冰品SKU(b)-是否冰品SKU(a)||场景分区(a).localeCompare(场景分区(b),"zh-CN")||文(a.category4).localeCompare(文(b.category4),"zh-CN")||数(a.rank)-数(b.rank)||等级分(b.grade)-等级分(a.grade))}
function 新店场景排序值(r){const order={"雪糕冰品":0,"预制主食":1,"预制菜类":2,"火锅食材":3,"冷冻食材":4};return order[场景分区(r)]??9}
function 新店柜段排序值(c){if(是否冰品柜段(c))return 0;if(文(c.kind).includes("卧柜"))return 1;return 2}
function 更新新店柜段用量(use){for(const c of use){c.sourceUsed=Number(数(c.used).toFixed(1));c.sourceLeft=Number((数(c.length)-数(c.used)).toFixed(1));c.left=c.sourceLeft;c.over=c.sourceLeft<0}}
function 新店SKU外储压力(r){const c=计算SKU(r);return c.external*单品体积(r)}
function 新店扩陈得分(r,c){const before=新店SKU外储压力(r);const oldCols=数(r.displayCols);r.displayCols=oldCols+1;const after=新店SKU外储压力(r);r.displayCols=oldCols;const grade=等级分(r.grade)*100000;const reduce=Math.max(0,before-after)*1000;const cat=c.items.some(x=>文(x.category4)&&文(x.category4)===文(r.category4))?5000:0;const scene=c.items.some(x=>场景分区(x)===场景分区(r))?2000:0;return grade+reduce+cat+scene+数(r.dailyQty)*100-数(r.rank)}
function 严格扩陈新增门店(use,skus){let changed=true,round=0;while(changed&&round<3000){changed=false;round++;let best=null;for(const r of skus){const c=use.find(x=>x.key===r.cabinetKey);if(!c)continue;const add=数(r.faceWidth);if(add<=0||add>数(c.left)+0.001)continue;const score=新店扩陈得分(r,c);if(!best||score>best.score)best={r,c,add,score}}if(best){best.r.displayCols=数(best.r.displayCols)+1;best.c.used=数(best.c.used)+best.add;best.c.left=Number((数(best.c.length)-数(best.c.used)).toFixed(1));changed=true}}更新新店柜段用量(use)}
function 严格复核新增门店(pre){const errors=[];const warnings=[];const summary=新店汇总(pre);const cabs=pre.cabinets.map(c=>({...c,left:数(c.sourceLeft),used:数(c.sourceUsed),over:数(c.sourceLeft)<-0.001}));if(summary.suggested>数(状态.params.externalCapL))errors.push('建议外储容量 '+summary.suggested+'L 超过 '+状态.params.externalCapL+'L');const over=cabs.filter(c=>c.over);if(over.length)errors.push('柜段超宽 '+over.length+' 个');const layer6Used=cabs.filter(c=>/立柜/.test(c.kind)&&/第6层/.test(c.position)&&数(c.sourceUsed)>0);if(layer6Used.length)errors.push('立柜第6层参与陈列 '+layer6Used.length+' 个');const iceWrong=pre.included.filter(r=>是否冰品SKU(r)!==是否冰品柜段(pre.cabinets.find(c=>c.key===r.cabinetKey)||{}));if(iceWrong.length)errors.push('冰品/非冰品柜别错误 '+iceWrong.length+' 个');const split=new Map();for(const r of pre.included){const cab=pre.cabinets.find(c=>c.key===r.cabinetKey)||{};const kind=是否冰品柜段(cab)?'冰淇淋柜':(/立柜/.test(cab.kind||cab.label)?'立柜':'卧柜');const k=pre.store+'|'+SKU键(r)+'|'+kind;if(!split.has(k))split.set(k,new Set());split.get(k).add((cab.label||r.cabinetLabel||'')+' '+(cab.position||r.position||''))}const splitBad=[...split.values()].filter(v=>v.size>1).length;if(splitBad)errors.push('同SKU同柜型拆分 '+splitBad+' 个');const ordinaryLarge=cabs.filter(c=>!是否冰品柜段(c)&&数(c.left)>300);if(ordinaryLarge.length)warnings.push('普通柜段剩余大于300mm '+ordinaryLarge.length+' 个，请人工关注是否还有可补位商品');if(pre.missing.length&&ordinaryLarge.length)errors.push('存在未纳入SKU且普通柜段仍有大余量，需要继续调柜');return{ok:errors.length===0,errors,warnings,summary}}function 预排新增门店(store,type,cabs){const use=cabs.map(c=>({...c,used:0,left:数(c.length),items:[]}));const skus=[];const missing=[];const pool=新店SKU池().sort((a,b)=>新店场景排序值(a)-新店场景排序值(b)||文(a.category4).localeCompare(文(b.category4),'zh-CN')||数(a.rank)-数(b.rank));const chooseCab=(sku)=>{const ice=是否冰品SKU(sku);const candidates=use.filter(c=>是否冰品柜段(c)===ice).sort((a,b)=>新店柜段排序值(a)-新店柜段排序值(b)||文(a.label).localeCompare(文(b.label),'zh-CN')||文(a.position).localeCompare(文(b.position),'zh-CN'));let best=null;for(const c of candidates){const face=估算陈列面(sku,c),per=估算单列容量(sku,c);if(face>0&&per>0&&face<=c.left+0.001){const cat4Same=c.items.some(x=>文(x.category4)&&文(x.category4)===文(sku.category4));const sceneSame=c.items.some(x=>场景分区(x)===场景分区(sku));const empty=c.items.length?0:1;const score=(cat4Same?100000:0)+(sceneSame?20000:0)+empty*3000+等级分(sku.grade)*500+数(sku.dailyQty)*100-数(sku.rank)-数(c.left)/10;if(!best||score>best.score)best={c,face,per,score}}}return best};for(const base of pool){const pick=chooseCab(base);if(!pick){missing.push(base);continue}const r={...base,id:'new_sku_'+skus.length+'_'+(文(base.barcode)||文(base.name)),store,included:true,status:'新增门店严格测算-纳入',cabinetKey:pick.c.key,cabinetLabel:pick.c.label,position:pick.c.position,displayCols:1,perCol:pick.per,faceWidth:pick.face,placements:[],customPlacement:false,currentStock:'',planCartons:1,sourceAdvice:'新增门店严格测算',sourceAction:'严格测算纳入',note:'新增门店严格测算生成',cabinetTypeFilter:pick.c.kind,cabinetNoFilter:pick.c.label,positionFilter:pick.c.position};skus.push(r);pick.c.used+=SKU占用宽度(r);pick.c.left=Number((数(pick.c.length)-pick.c.used).toFixed(1));pick.c.items.push(r)}严格扩陈新增门店(use,skus);const missRows=missing.map((base,i)=>({...base,id:'new_missing_'+i+'_'+(文(base.barcode)||文(base.name)),store,included:false,status:'新增门店严格测算-未纳入',cabinetKey:'',cabinetLabel:'',position:'',displayCols:0,perCol:0,faceWidth:0,placements:[],customPlacement:false,sourceAdvice:'新增门店严格测算',sourceAction:'空间不足未纳入',note:'新增门店严格测算未排入'}));const pre={store,type,cabinets:use,skus:[...skus,...missRows],included:skus,missing:missRows,strict:true,validation:null};pre.validation=严格复核新增门店(pre);return pre}function 新店汇总(pre){const old={stores:状态.stores,cabinets:状态.cabinets,skus:状态.skus};状态.stores=[...状态.stores,{store:pre.store,type:pre.type}];状态.cabinets=[...状态.cabinets,...pre.cabinets];状态.skus=[...状态.skus,...pre.skus];清空业务快照();const s=门店汇总(pre.store);状态.stores=old.stores;状态.cabinets=old.cabinets;状态.skus=old.skus;清空业务快照();return s}
function 渲染新增门店(){if(!q("#newStoreSummary"))return;const pre=window.新增门店测算缓存;if(!pre){q("#newStoreSummary").innerHTML="";q("#newStoreCabinetPreview").innerHTML='<div class="empty">请先录入门店名称和冰柜配置后测算。</div>';q("#newStoreSkuPreview").innerHTML='<div class="empty">暂无严格测算结果。</div>';return}const s=新店汇总(pre);const v=pre.validation||严格复核新增门店(pre);const status=v.ok?"通过":"不通过";q("#newStoreSummary").innerHTML=[["已纳入SKU",s.skuCount],["未纳入SKU",s.missingSkuCount],["直接整箱到店SKU数",s.direct],["需外储SKU数",s.extSku],["建议外储",格(s.suggested,0)+"L"],["严格复核",status]].map(([a,b])=>'<div class="metric '+(a.includes("复核")&&!v.ok?"danger":a.includes("复核")?"":"")+'"><div class="label">'+a+'</div><div class="value">'+b+'</div></div>').join("")+(v.errors.length||v.warnings.length?'<div class="help strict-check"><strong>严格复核说明：</strong>'+[...v.errors.map(x=>"错误："+x),...v.warnings.map(x=>"提示："+x)].map(逃).join("；")+'</div>':'<div class="help strict-check"><strong>严格复核通过：</strong>柜段不超宽、外储不超754L、立柜第6层未参与陈列、冰品/非冰品柜别正确。</div>');表格("#newStoreCabinetPreview",[{name:"冰柜类型",value:c=>c.kind},{name:"陈列柜",value:c=>c.label,cls:()=>"name"},{name:"具体位置",value:c=>c.position},{name:"长",value:c=>格(c.length,0)},{name:"深",value:c=>格(c.depth,0)},{name:"高",value:c=>格(c.height,0)},{name:"已用",value:c=>格(c.sourceUsed,0)},{name:"剩余",value:c=>格(c.sourceLeft,0),cls:c=>c.sourceLeft<0?"bad":c.sourceLeft>300?"warn":"ok"},{name:"SKU数",value:c=>c.items?.length||0}],pre.cabinets);表格("#newStoreSkuPreview",商品列(),pre.included.slice(0,160),"没有纳入SKU")}
window.测算新增门店=()=>{const store=文(q("#newStoreName")?.value);const type=文(q("#newStoreType")?.value)||"新店";const txt=文(q("#newStoreCabinetConfig")?.value);if(!store){alert("请填写门店名称");return}if(状态.stores.some(s=>s.store===store)){alert("门店已存在，请换一个新门店名称");return}const parsed=解析新增门店柜段(store,txt);if(parsed.errors.length){alert("冰柜配置存在无法识别的行：\n"+parsed.errors.join("\n"));return}if(!parsed.cabs.length){alert("请至少录入一个冰柜配置");return}window.新增门店测算缓存=预排新增门店(store,type,parsed.cabs);渲染新增门店();完成提示("新增门店严格测算完成：请先查看严格复核说明，复核通过后再追加到当前页面。")}
window.追加新增门店=()=>{const pre=window.新增门店测算缓存;if(!pre){alert("请先测算新增门店");return}if(状态.stores.some(s=>s.store===pre.store)){alert("门店已存在，不能重复追加");return}const v=pre.validation||严格复核新增门店(pre);if(!v.ok){alert("严格复核不通过，不能追加：\\n"+v.errors.join("\\n"));return}状态.stores.push({store:pre.store,type:pre.type,vertical:pre.cabinets.filter(c=>c.kind==="立柜").length?"自定义":"",chest:pre.cabinets.filter(c=>c.kind==="卧柜").length?"自定义":"",ice:pre.cabinets.filter(c=>c.kind.includes("冰淇淋")).length?"自定义":""});状态.cabinets.push(...pre.cabinets.map(c=>{const x={...c};delete x.items;delete x.used;delete x.left;return x}));状态.skus.push(...pre.skus);当前.门店=pre.store;保存();渲染全部();切换("displaymap");完成提示("新增门店已追加到当前页面，请在陈列图中继续手动调整。")}


function 产品池字段(){return["active","name","barcode","grade","rank","category2","category3","category4","length","width","height","volume","carton","dailyQty","dailySales","moq"]}
window.改产品池=(idx,k,v)=>{const pool=确保产品池(状态);const p=pool[idx];if(!p)return;if(["rank","length","width","height","volume","carton","dailyQty","dailySales","moq"].includes(k))v=数(v);if(k==="active")v=!!v;p[k]=v;if(!数(p.volume)&&数(p.length)&&数(p.width)&&数(p.height))p.volume=数(p.length)*数(p.width)*数(p.height)/1e6;保存();渲染全部();标记待同步()}
function 产品池输入(v,idx,k,type="text"){return '<input type="'+type+'" value="'+逃(v)+'" onchange="改产品池('+idx+',\''+k+'\',this.value)">'}
function 渲染产品池(){if(!q("#poolTable"))return;const kw=文(q("#poolSearch")?.value);const rows=确保产品池(状态).map((p,i)=>({...p,__idx:i})).filter(p=>包含(p,kw));表格("#poolTable",[{name:"启用",value:p=>'<input type="checkbox" '+(p.active!==false?"checked":"")+' onchange="改产品池('+p.__idx+',\'active\',this.checked)">',html:true},{name:"商品",value:p=>产品池输入(p.name,p.__idx,"name"),html:true,cls:()=>"name"},{name:"条码",value:p=>产品池输入(p.barcode,p.__idx,"barcode"),html:true},{name:"等级",value:p=>产品池输入(p.grade,p.__idx,"grade"),html:true},{name:"排名",value:p=>产品池输入(p.rank,p.__idx,"rank","number"),html:true},{name:"二级类目",value:p=>产品池输入(p.category2,p.__idx,"category2"),html:true},{name:"三级类目",value:p=>产品池输入(p.category3,p.__idx,"category3"),html:true},{name:"四级类目",value:p=>产品池输入(p.category4,p.__idx,"category4"),html:true},{name:"长",value:p=>产品池输入(p.length,p.__idx,"length","number"),html:true},{name:"宽",value:p=>产品池输入(p.width,p.__idx,"width","number"),html:true},{name:"高",value:p=>产品池输入(p.height,p.__idx,"height","number"),html:true},{name:"体积L",value:p=>产品池输入(p.volume,p.__idx,"volume","number"),html:true},{name:"箱规",value:p=>产品池输入(p.carton,p.__idx,"carton","number"),html:true},{name:"日销",value:p=>产品池输入(p.dailyQty,p.__idx,"dailyQty","number"),html:true},{name:"日销额",value:p=>产品池输入(p.dailySales,p.__idx,"dailySales","number"),html:true},{name:"起订量",value:p=>产品池输入(p.moq,p.__idx,"moq","number"),html:true}],rows,"产品池暂无数据")}
function 标准产品池对象(){return{id:"pool_manual_"+Date.now(),active:true,name:"新增SKU-请修改",barcode:"",grade:"未评级",rank:9999,category2:"",category3:"待填写",category4:"待填写",length:0,width:0,height:0,volume:0,carton:1,dailyQty:0,dailySales:0,moq:0,moqDays:0}}
function 导入产品池文本(txt){const lines=文(txt).split(/\r?\n/).filter(Boolean);if(!lines.length)return 0;const split=x=>x.split(/\t|,|，/).map(v=>v.trim());const header=split(lines[0]);const known={"商品名称":"name","商品":"name","条码":"barcode","商品条码":"barcode","等级":"grade","综合排名":"rank","排名":"rank","二级类目":"category2","二级品类名称":"category2","三级类目":"category3","三级品类名称":"category3","四级类目":"category4","四级品类名称":"category4","长":"length","长mm":"length","宽":"width","宽mm":"width","高":"height","高mm":"height","体积":"volume","体积L":"volume","箱规":"carton","日销":"dailyQty","标准化单店日销件":"dailyQty","日销额":"dailySales","标准化单店日销额":"dailySales","起订量":"moq"};let fields=header.map(h=>known[h]||"");let start=1;if(!fields.some(Boolean)){fields=["name","barcode","grade","rank","category2","category3","category4","length","width","height","volume","carton","dailyQty","dailySales","moq"];start=0}const pool=确保产品池(状态);let count=0;for(let i=start;i<lines.length;i++){const vals=split(lines[i]);if(!vals.some(Boolean))continue;const p=标准产品池对象();fields.forEach((f,j)=>{if(f)p[f]=vals[j]??p[f]});for(const f of ["rank","length","width","height","volume","carton","dailyQty","dailySales","moq"])p[f]=数(p[f]);if(!p.volume&&p.length&&p.width&&p.height)p.volume=p.length*p.width*p.height/1e6;p.id="pool_import_"+Date.now()+"_"+i;pool.push(p);count++}return count}
function 全店新品记录(t,basePlan){const p={active:true,name:t.name,barcode:t.barcode,grade:t.grade,rank:9999,category2:"",category3:t.category3,category4:t.category4||t.category3,length:t.length,width:t.width,height:t.height,volume:t.volume,carton:t.carton,dailyQty:t.dailyQty,dailySales:0,moq:0};return p}
window.全店上新缓存={};
window.试算全店上新=()=>{const t=读取新品试算();if(!新品基础完整(t)){alert("请先填写新品长、宽、高和箱规");return}window.全店上新缓存={};const oldStore=当前.门店;const rows=[];for(const st of 状态.stores){当前.门店=st.store;const plans=新品试算方案(t);const best=plans[0];if(best){const id="all_"+rows.length;window.全店上新缓存[id]=best;rows.push({id,store:st.store,type:best.type,cab:best.cab.label+" "+best.cab.position,need:best.need,after:best.after,external:计算SKU(best.newSku).external,suggested:best.sim.suggested,ok:true})}else{rows.push({id:"",store:st.store,type:"暂不可执行",cab:"",need:0,after:"",external:"",suggested:"",ok:false})}}当前.门店=oldStore;表格("#allStoreSkuSuggestions",[{name:"应用",value:r=>r.ok?'<input type="checkbox" checked data-allstore="'+r.id+'">':"",html:true},{name:"门店",value:r=>r.store,cls:()=>"name"},{name:"结果",value:r=>r.type,cls:r=>r.ok?"ok":"bad"},{name:"推荐位置",value:r=>r.cab,cls:()=>"name"},{name:"占宽",value:r=>r.need?格(r.need,0)+"mm":""},{name:"放入后剩余",value:r=>r.after!==""?格(r.after,0)+"mm":""},{name:"需外储",value:r=>r.external},{name:"建议外储",value:r=>r.suggested?格(r.suggested,0)+"L":""}],rows,"暂无全店上新方案");完成提示("全店上新测算完成：请勾选要应用的门店，再点击应用勾选门店方案。")}
window.应用全店上新=()=>{const ids=qa('input[data-allstore]:checked').map(x=>x.getAttribute('data-allstore'));if(!ids.length){alert("请先勾选可应用门店");return}let applied=0;for(const id of ids){const p=window.全店上新缓存[id];if(!p)continue;const cabNow=柜段使用().find(c=>c.key===p.cab.key);let freed=0;for(const red of p.reducers){const r=状态.skus.find(x=>x.id===red.id);if(r)freed+=Math.max(0,red.free||数(r.faceWidth))}if(!cabNow||数(cabNow.left)+freed+0.001<数(p.need))continue;for(const red of p.reducers){const r=状态.skus.find(x=>x.id===red.id);if(r){r.displayCols=red.newCols;r.customPlacement=true;标记变更(r,"陈列列数","全店上新-为新品腾位")}}状态.skus.push({...p.newSku,id:"allstore_sku_"+Date.now()+"_"+applied,changeNote:"全店上新应用",modifiedFields:["全店上新"]});applied++}保存();渲染全部();完成提示("全店上新应用完成：已应用 "+applied+" 家门店，门店执行和柜段余量已联动。")}
function 陈列图颜色(cat){const colors={"雪糕冰品":"#dbeafe","预制主食":"#dcfce7","预制菜类":"#fef3c7","火锅食材":"#fee2e2","冷冻食材":"#e0e7ff"};return colors[cat]||"#f3f4f6"}
function 陈列图商品标签(r){const c=计算SKU(r);const direction=陈列面方向值(r)==="length"?"长做陈列面":"宽做陈列面";return 逃(r.name)+' <small>'+格(r.displayCols,0)+'列 / 满陈'+格(c.full,0)+'件</small><small>陈列面：'+direction+'</small>'}
function 陈列图商品样式(r){const w=Math.max(70,Math.min(260,数(SKU占用宽度(r))*0.45));return 'background:'+陈列图颜色(场景分区(r))+';flex:0 0 '+格(w,0)+'px'}
function 陈列图顺序值(r){const raw=r?.planogramOrder;if(raw===undefined||raw===null||文(raw)==="")return Number.POSITIVE_INFINITY;const value=Number(raw);return Number.isFinite(value)?value:Number.POSITIVE_INFINITY}
function 陈列图排序(rows){return rows.map((r,i)=>({r,i})).sort((a,b)=>陈列图顺序值(a.r)-陈列图顺序值(b.r)||a.i-b.i).map(x=>x.r)}
function 交换同柜陈列顺序(r,occupant){
  if(!r||!occupant||r.store!==occupant.store||!r.cabinetKey||r.cabinetKey!==occupant.cabinetKey)return false;
  const rows=状态.skus.filter(x=>x.store===r.store&&x.included!==false&&!x.inStaging&&x.cabinetKey===r.cabinetKey);
  const ordered=陈列图排序(rows);if(ordered.length<2)return false;
  ordered.forEach((x,i)=>{x.planogramOrder=i});
  const rIndex=ordered.indexOf(r),oIndex=ordered.indexOf(occupant);if(rIndex<0||oIndex<0)return false;
  const order=ordered[rIndex].planogramOrder;ordered[rIndex].planogramOrder=ordered[oIndex].planogramOrder;ordered[oIndex].planogramOrder=order;return true;
}
function 移动同柜陈列位置(r,occupant){
  const helper=window.DisplayModuleState?.movePlanogramModule;
  if(!helper)return false;
  const result=helper(状态,{sourceId:r?.id,targetId:occupant?.id});
  if(!result.ok)return false;
  状态.skus=result.state.skus;
  标记变更(状态.skus.find(x=>x.id===r.id),"同柜陈列顺序","陈列图同柜任意移动");
  标记变更(状态.skus.find(x=>x.id===occupant.id),"同柜陈列顺序","陈列图同柜任意移动");
  return true;
}
function 柜段可陈列(c){
  const status=文(c?.status);
  return !!c&&!/第6层|存储位/.test(文(c.position))&&!/其他品类预留|预留|存储/.test(status)
}
function 待选SKU(store=门店名()){return 纳入SKU(store).filter(r=>r.inStaging)}
function 陈列图来源柜段(r){return 状态.cabinets.find(c=>c.key===r?.cabinetKey)}
function 同SKU同柜段已有模块(r,targetKey){
 const helper=window.DisplayModuleState?.sameStoreSkuCabinetSegment;
 if(helper)return helper(状态,r,targetKey,{keyOf:x=>产品主键(x)||SKU键(x)});
 const key=产品主键(r)||SKU键(r);
 return 状态.skus.some(x=>x.id!==r?.id&&x.included!==false&&!x.inStaging&&x.store===r?.store&&x.cabinetKey===targetKey&&(产品主键(x)||SKU键(x))===key);
}
function 陈列图基础校验(r,targetKey,allowSameCabinet=false){
  const source=陈列图来源柜段(r);
  const target=柜段使用().find(c=>c.key===targetKey);
  if(!r||!target)return {ok:false,reason:"未找到商品或目标柜段"};
  if(!allowSameCabinet&&!r.inStaging&&targetKey===r.cabinetKey)return {ok:false,reason:"商品已在该柜段"};
  if(r.store!==target.store)return {ok:false,reason:"只能在当前门店内移动"};
  if(!柜段可陈列(target))return {ok:false,reason:"目标为存储位或其他品类预留位"};
  const sourceType=source?冰柜类型(source):文(r.stagingCabinetType);
  const sourceIce=source?是否冰品柜段(source):!!r.stagingIce;
  if(!sourceType)return {ok:false,reason:"待选商品缺少原冰柜类型信息"};
  if(sourceIce!==是否冰品柜段(target))return {ok:false,reason:"冰品与普通冻品不能混放"};
  if(r.inStaging&&同SKU同柜段已有模块(r,targetKey))return {ok:false,reason:"该SKU已在同一物理柜段中，不能再次新增到该柜段"};
  const layout=目标柜型参数(r,target,陈列面方向值(r));
  if(!layout)return {ok:false,reason:"该商品的长宽高没有一种水平摆法能放入目标柜段"};
  return {ok:true,source,target,layout,need:数(r.displayCols)*layout.faceWidth}
}
function 陈列图目标校验(r,targetKey){
  const base=陈列图基础校验(r,targetKey);
  if(!base.ok)return base;
  if(数(base.target.left)+0.001<base.need)return {...base,ok:false,reason:"目标余量不足，需要 "+格(base.need,0)+"mm，当前仅余 "+格(base.target.left,0)+"mm"};
  return base
}
 
function 陈列图互换校验(r,occupant){
  const targetKey=occupant?.cabinetKey;
  const sameCabinet=!!r&&!!occupant&&r.cabinetKey===occupant.cabinetKey;
  const first=陈列图基础校验(r,targetKey,sameCabinet);
  const source=陈列图来源柜段(r);
  const target=陈列图来源柜段(occupant);
  if(!first.ok||!source||!target||occupant.inStaging)return {ok:false,reason:first.reason||"无法定位互换柜段"};
  const back=陈列图基础校验(occupant,source.key,sameCabinet);
  if(!back.ok)return {ok:false,reason:"被替换商品无法回到原位置："+back.reason};
  const usage=new Map(柜段使用().map(c=>[c.key,c]));
  const sourceAfter=数(usage.get(source.key)?.left)+SKU占用宽度(r);
  const targetAfter=数(usage.get(target.key)?.left)+SKU占用宽度(occupant);
  if(targetAfter+0.001<first.need)return {ok:false,reason:"替换后目标柜段仍无足够空间"};
  if(sourceAfter+0.001<back.need)return {ok:false,reason:"被替换商品放回原位置会超宽"};
  return {ok:true,source,target,layout:first.layout,occupantLayout:back.layout,need:first.need}
}
function 陈列图落位策略(r,targetKey,targetSkuId=""){
  const occupant=状态.skus.find(x=>x.id===targetSkuId);
  if(r&&occupant&&!r.inStaging&&!occupant.inStaging&&r.cabinetKey===targetKey&&occupant.cabinetKey===targetKey){
    const source=陈列图来源柜段(r),target=陈列图来源柜段(occupant);
    if(source&&target)return {ok:true,mode:"reorder",occupant,source,target};
  }
  const direct=陈列图目标校验(r,targetKey);
  if(direct.ok)return {ok:true,mode:"move",...direct};
  if(!occupant||occupant.cabinetKey!==targetKey)return {ok:false,mode:"blocked",reason:direct.reason+"；请先把目标柜段中需移出的商品拖入待选区。"};
  const swap=陈列图互换校验(r,occupant);
  if(swap.ok)return {ok:true,mode:"swap",occupant,...swap};
  const base=陈列图基础校验(r,targetKey);
  if(!base.ok)return {ok:false,mode:"blocked",reason:base.reason};
  const spaceAfterStage=数(base.target.left)+SKU占用宽度(occupant);
  if(spaceAfterStage+0.001>=base.need)return {ok:true,mode:"stage",occupant,...base};
  return {ok:false,mode:"blocked",reason:"直接互换不可行，且仅移出"+occupant.name+"后目标仍不足。请先将多个商品拖入待选区后再调整。"}
}
function 清除陈列图拖放样式(){
  qa(".map-layer.drop-ok,.map-layer.drop-bad").forEach(x=>x.classList.remove("drop-ok","drop-bad"));
  qa(".monitor-card.drag-ok,.monitor-card.drag-bad").forEach(x=>x.classList.remove("drag-ok","drag-bad"));
  qa(".map-item.swap-ok,.map-item.reorder-ok,.map-item.stage-ok,.map-item.drop-bad").forEach(x=>x.classList.remove("swap-ok","reorder-ok","stage-ok","drop-bad"));
}
function 标示陈列图可放位置(r){
  清除陈列图拖放样式();
  if(!r)return;
  qa(".map-layer[data-cab-key]").forEach(layer=>{
    const check=陈列图目标校验(r,layer.dataset.cabKey);
    if(layer.dataset.cabKey!==r.cabinetKey)layer.classList.add(check.ok?"drop-ok":"drop-bad");
  });
  qa(".monitor-card[data-cab-key]").forEach(card=>{
    const check=陈列图目标校验(r,card.dataset.cabKey);
    if(card.dataset.cabKey!==r.cabinetKey)card.classList.add(check.ok?"drag-ok":"drag-bad");
  });
  qa(".map-item[data-sku-id]").forEach(card=>{
    const occupant=状态.skus.find(x=>x.id===card.dataset.skuId);
    if(!occupant||occupant.id===r.id||occupant.inStaging)return;
    const plan=陈列图落位策略(r,occupant.cabinetKey,occupant.id);
    card.classList.add(plan.ok?(plan.mode==="reorder"?"reorder-ok":plan.mode==="swap"?"swap-ok":plan.mode==="stage"?"stage-ok":"drop-ok"):"drop-bad");
  });
}
function 清除待选标记(r){delete r.inStaging;delete r.stagingCabinetType;delete r.stagingIce;delete r.stagingFrom}
function 移至待选区(skuId,reason="手动移入待选区"){
  const r=状态.skus.find(x=>x.id===skuId);const source=陈列图来源柜段(r);
  if(!r||r.inStaging)return false;
  if(!source){alert("无法识别该商品原柜段");return false}
  r.inStaging=true;r.stagingCabinetType=冰柜类型(source);r.stagingIce=是否冰品柜段(source);r.stagingFrom={key:source.key,label:source.label,position:source.position};
  r.cabinetKey="";r.cabinetLabel="待选区";r.position="待选区";r.customPlacement=true;
  标记变更(r,"陈列柜段",reason);保存();return true
}
function 放入陈列柜段(r,target){
  const preferred=陈列面方向值(r);
  if(!应用目标柜型参数(r,target,preferred))return false;
  r.cabinetKey=target.key;r.cabinetLabel=target.label;r.position=target.position;r.customPlacement=true;清除待选标记(r);刷新单SKU陈列容量(r);同步同SKU满陈(r);标记变更(r,"陈列柜段、陈列面方向、单列容量、单列占宽","陈列图单品移动");return true
}
function 执行陈列图互换(r,occupant,source,target){
  const rSource={key:source.key,label:source.label,position:source.position};
  const oSource={key:target.key,label:target.label,position:target.position};
  const rLayout=目标柜型参数(r,target,陈列面方向值(r));
  const occupantLayout=目标柜型参数(occupant,source,陈列面方向值(occupant));
  if(!rLayout||!occupantLayout)return false;
  const sameCabinet=source.key===target.key;
  Object.assign(r,rLayout);Object.assign(occupant,occupantLayout);
  r.cabinetKey=oSource.key;r.cabinetLabel=oSource.label;r.position=oSource.position;r.customPlacement=true;清除待选标记(r);
  occupant.cabinetKey=rSource.key;occupant.cabinetLabel=rSource.label;occupant.position=rSource.position;occupant.customPlacement=true;清除待选标记(occupant);
  刷新单SKU陈列容量(r);刷新单SKU陈列容量(occupant);
  if(sameCabinet)交换同柜陈列顺序(r,occupant);
  同步同SKU满陈(r);同步同SKU满陈(occupant);
  const fields="陈列柜段、陈列面方向、单列容量、单列占宽"+(sameCabinet?"、同柜陈列顺序":"");
  标记变更(r,fields,"陈列图直接互换");标记变更(occupant,fields,"陈列图直接互换");return true;
}
function 处理陈列图拖放(skuId,targetKey,targetSkuId=""){
  const r=状态.skus.find(x=>x.id===skuId);const plan=陈列图落位策略(r,targetKey,targetSkuId);
  if(!plan.ok){alert("无法移动："+plan.reason);return}
  if(plan.mode==="reorder"&&!移动同柜陈列位置(r,plan.occupant)){alert("无法移动：同柜位置更新失败，请刷新后重试");return}
  if(plan.mode==="move"&&!放入陈列柜段(r,plan.target)){alert("无法移动：目标柜段没有可行的长宽摆法");return}
  if(plan.mode==="swap"&&!执行陈列图互换(r,plan.occupant,plan.source,plan.target)){alert("无法互换：目标柜段没有可行的长宽摆法");return}
  if(plan.mode==="stage"){移至待选区(plan.occupant.id,"陈列图替换：进入待选区");if(!放入陈列柜段(r,plan.target)){alert("无法移动：目标柜段没有可行的长宽摆法");return}}
  当前.陈列图选中柜段=targetKey;保存();渲染全部();
  const text=plan.mode==="reorder"?"已移动到目标商品前面":plan.mode==="move"?"移动完成":plan.mode==="swap"?"直接互换完成":"替换完成：原商品已进入待选区";
  完成提示(text+"。柜段余量和排柜位置已联动；待选区商品需重新分配后才能同步到门店页面。")
}
function 同SKU陈列模块(r){
  const helper=window.DisplayModuleState?.sameStoreSkuModules;
  if(helper)return helper(状态,r,{keyOf:x=>产品主键(x)||SKU键(x)});
  const key=产品主键(r)||SKU键(r);
  return 状态.skus.filter(x=>x.store===r?.store&&x.included!==false&&(产品主键(x)||SKU键(x))===key);
}
function 分身SKU到陈列图(id){
  if(!可编辑模式()){alert("新增模块需要先进入当前页面。");return}
  const source=状态.skus.find(x=>x.id===id);
  if(!source||source.included===false||source.inStaging){alert("只能从当前已陈列模块新增模块。");return}
  const helper=window.DisplayModuleState?.clonePlanogramModule;
  if(!helper){alert("新增模块功能尚未加载，请刷新页面后重试。");return}
  const result=helper(状态,{sourceId:source.id,keyOf:x=>产品主键(x)||SKU键(x),idFactory:()=>"sku_module_"+Date.now()+"_"+Math.random().toString(36).slice(2,8)});
  if(!result.ok){alert("无法新增模块："+result.reason);return}
  状态.skus=result.state.skus;
  const nextSource=状态.skus.find(x=>x.id===source.id),clone=状态.skus.find(x=>x.id===result.row.id);
  同步同SKU满陈(nextSource);标记变更(nextSource,"分身陈列","同商品新增待选模块");标记变更(clone,"分身陈列","同商品新增待选模块");
  当前.陈列图选中SKU=clone.id;保存();渲染全部();
  完成提示("已新增同SKU模块，已放入待选区。请手动迁移到目标柜段；同一物理柜段内已有该SKU时不能再次放入。");
}
function 删除陈列模块(id){
  if(!可编辑模式()){alert("删除陈列模块需要先进入当前页面。");return}
  const row=状态.skus.find(x=>x.id===id),modules=同SKU陈列模块(row);
  if(!row||modules.length<=1){alert("该SKU只有一个陈列模块，不能删除唯一模块。");return}
  if(!confirm("确认删除“"+(row.name||row.barcode||row.id)+"”的当前陈列模块？\n\n只删除本门店这一条陈列模块，不会删除产品池、其他门店或其他模块。"))return;
  const helper=window.DisplayModuleState?.deletePlanogramModule;
  const result=helper?helper(状态,{id,keyOf:x=>产品主键(x)||SKU键(x)}):{ok:false,reason:"删除模块功能尚未加载"};
  if(!result.ok){alert("无法删除："+result.reason);return}
  状态.skus=result.state.skus;
  const remaining=同SKU陈列模块(row).filter(x=>x.id!==id);if(remaining[0])同步同SKU满陈(remaining[0]);
  当前.陈列图选中SKU=remaining[0]?.id||"";保存();渲染全部();
  完成提示("已删除当前陈列模块；产品池和其他门店数据保持不变。");
}
function 绑定陈列图拖拽(){
  const ops=可编辑模式();
  qa(".map-item[data-sku-id]").forEach(item=>{
    item.draggable=ops;
    item.addEventListener("click",e=>{if(e.target.closest("input,button"))return;当前.陈列图选中SKU=item.dataset.skuId;渲染陈列图右侧()});
    if(!ops)return;
    item.addEventListener("dragstart",e=>{const r=状态.skus.find(x=>x.id===item.dataset.skuId);if(!r){e.preventDefault();return}window.__陈列图拖动SKU=r.id;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",r.id);item.classList.add("dragging");标示陈列图可放位置(r)});
    item.addEventListener("dragend",()=>{item.classList.remove("dragging");window.__陈列图拖动SKU="";清除陈列图拖放样式()});
    item.addEventListener("dragover",e=>{const id=window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain");if(!id||id===item.dataset.skuId)return;const r=状态.skus.find(x=>x.id===id);const target=状态.skus.find(x=>x.id===item.dataset.skuId);if(!r||!target||target.inStaging)return;const plan=陈列图落位策略(r,target.cabinetKey,target.id);if(plan.ok){e.preventDefault();e.dataTransfer.dropEffect="move"}});
    item.addEventListener("drop",e=>{const id=window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain");if(!id||id===item.dataset.skuId)return;const target=状态.skus.find(x=>x.id===item.dataset.skuId);if(!target||target.inStaging)return;e.preventDefault();e.stopPropagation();处理陈列图拖放(id,target.cabinetKey,target.id)});
  });
  qa(".map-layer[data-cab-key]").forEach(layer=>{
    layer.addEventListener("dragover",e=>{const id=window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain");const r=状态.skus.find(x=>x.id===id);const check=陈列图目标校验(r,layer.dataset.cabKey);if(check.ok){e.preventDefault();e.dataTransfer.dropEffect="move"}});
    layer.addEventListener("drop",e=>{e.preventDefault();处理陈列图拖放(window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain"),layer.dataset.cabKey)});
    layer.addEventListener("click",()=>{当前.陈列图选中柜段=layer.dataset.cabKey;渲染陈列余量监控()});
  });
  qa(".monitor-card[data-cab-key]").forEach(card=>{
    card.addEventListener("dragover",e=>{const id=window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain");const r=状态.skus.find(x=>x.id===id);const check=陈列图目标校验(r,card.dataset.cabKey);if(check.ok){e.preventDefault();e.dataTransfer.dropEffect="move"}});
    card.addEventListener("drop",e=>{e.preventDefault();处理陈列图拖放(window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain"),card.dataset.cabKey)});
    card.addEventListener("click",()=>{当前.陈列图选中柜段=card.dataset.cabKey;qa(".map-layer").forEach(x=>x.classList.toggle("monitor-selected",x.dataset.cabKey===card.dataset.cabKey));渲染陈列余量监控()});
  });
  const stage=q("#displayStagingZone");
  if(stage&&ops){stage.addEventListener("dragover",e=>{const id=window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain");const r=状态.skus.find(x=>x.id===id);if(r&&!r.inStaging&&r.store===门店名()){e.preventDefault();e.dataTransfer.dropEffect="move"}});stage.addEventListener("drop",e=>{e.preventDefault();const id=window.__陈列图拖动SKU||e.dataTransfer.getData("text/plain");if(移至待选区(id,"陈列图手动移入待选区")){保存();渲染全部();完成提示("已移入待选区：原柜段余量已释放。请将待选商品拖到新的可用柜段后再同步门店页面。")}})}
}
function 定位到陈列图商品(id){
  const canvas=q("#displayMapCanvas");
  const target=canvas?.querySelector('.map-item[data-sku-id="'+CSS.escape(id)+'"]');
  if(!target)return false;
  qa("#displayMapCanvas .map-item.map-locate").forEach(x=>x.classList.remove("map-locate"));
  target.classList.add("map-locate");
  target.scrollIntoView({behavior:"smooth",block:"center",inline:"center"});
  return true;
}
function 选中陈列图SKU(id){
  const r=状态.skus.find(x=>x.id===id);
  if(!r)return;
  当前.陈列图选中SKU=id;
  当前.陈列图四级=文(r.category4)||当前.陈列图四级;
  切换("displaymap");
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(!定位到陈列图商品(id))完成提示("该商品当前不在可见陈列图中，无法定位。");
  }));
}
function 陈列图池SKU(store){
  const rows=门店SKU(store);
  const type=当前.陈列图筛选||"all";
  if(type==="unplaced")return rows.filter(r=>!r.included&&!文(r.status).includes("淘汰"));
  if(type==="eliminated")return rows.filter(r=>文(r.status).includes("淘汰"));
  if(type==="staging")return rows.filter(r=>r.inStaging);
  return rows;
}
function 陈列图池列表(store){
  const filter=文(q("#displayMapPoolSearch")?.value);
  return 陈列图池SKU(store).filter(r=>!filter||[r.name,r.barcode,r.category2,r.category3,r.category4].some(v=>文(v).includes(filter))).sort((a,b)=>等级分(b.grade)-等级分(a.grade)||数(a.rank)-数(b.rank)||文(a.name).localeCompare(文(b.name),"zh-CN"));
}
function 陈列图下架SKU(id){
  const r=状态.skus.find(x=>x.id===id);if(!r)return;
  r.included=false;r.inStaging=false;r.customPlacement=true;标记变更(r,"纳入状态","陈列图下架SKU");保存();当前.陈列图选中SKU="";渲染全部();完成提示("已下架SKU：柜段余量和门店外储容量已同步更新。");
}
function 陈列图纳入SKU(id){
  const row=状态.skus.find(x=>x.id===id&&x.store===门店名());
  const helper=window.DisplayModuleState?.includePlanogramSku;
  if(!row||!helper){alert("未找到可纳入的当前门店SKU，请刷新页面后重试。");return}
  const result=helper(状态,{id});
  if(!result.ok){alert("无法纳入："+result.reason);return}
  状态.skus=result.state.skus;
  当前.陈列图筛选="staging";
  当前.陈列图选中SKU=result.row.id;
  保存();渲染全部();
  完成提示("SKU已纳入当前门店，并进入待选区。请手动拖到可用柜段后再保存。");
}
function 渲染陈列图右侧(){
  const el=q("#displayMapMonitor");if(!el)return;
  const store=门店名(),summary=门店汇总(store),stagedRows=待选SKU(store),stagedQuery=文(q("#displayStagingSearch")?.value);
  const staged=stagedRows;
  const selected=状态.skus.find(r=>r.id===当前.陈列图选中SKU&&r.store===store)||null;
  const tabs=[['all','全部商品'],['unplaced','未纳入SKU'],['eliminated','淘汰SKU'],['staging','待选区']];
  const tabsHtml='<div class="pool-tabs">'+tabs.map(([k,t])=>'<button type="button" class="'+((当前.陈列图筛选||"all")===k?'active':'')+'" data-map-pool="'+k+'">'+t+'</button>').join('')+'</div>';
  let selectedHtml='<section class="selection-card empty-selection"><div class="selection-topline"><span>当前选中 SKU</span><em>请点击陈列图商品</em></div><p>选中商品后，可在这里查看其陈列、满陈、触发库存及外储变化。</p></section>';
  if(selected){
    const c=计算SKU(selected),externalCls=summary.suggested>数(状态.params.externalCapL)?' bad':' ok';
    const location=selected.inStaging?'待选区':柜名(selected)+' · '+柜位(selected);
    const modules=同SKU陈列模块(selected),moduleIndex=Math.max(0,modules.findIndex(x=>x.id===selected.id))+1;
    const moduleRows=modules.map((m,i)=>'<div class="module-row '+(m.id===selected.id?'active':'')+'"><span>模块'+(i+1)+' · '+逃(冰柜类型(陈列图来源柜段(m)))+' · '+逃(m.inStaging?'待选区':柜名(m)+' '+柜位(m))+'</span>'+(可编辑模式()&&modules.length>1?'<button type="button" class="module-delete" data-map-delete-module="'+逃(m.id)+'">删除</button>':'')+'</div>').join('');
    const cloneButton=可编辑模式()&&!selected.inStaging?'<button type="button" class="clone-mini" data-map-clone="'+逃(selected.id)+'">新增模块</button>':'';
    const moduleHtml='<div class="module-management"><div class="module-title"><b>当前SKU陈列模块 '+modules.length+' 个</b><small>当前为模块'+moduleIndex+'</small></div>'+moduleRows+(cloneButton?'<div class="module-clone-options"><span>新增后进入待选区，请手动迁移到目标柜段</span>'+cloneButton+'</div>':'')+'</div>';
    selectedHtml='<section class="selection-card selection-card-active"><div class="selection-topline"><span>当前选中 SKU</span><em>陈列图已选中</em></div><div class="selection-head"><span class="tag '+分级(selected.grade)+'">'+逃(selected.grade||'未评级')+'</span><strong>'+逃(selected.name)+'</strong></div><p class="selection-meta">'+逃(selected.barcode||'无条码')+'｜'+逃(selected.category3||'未分类')+' / '+逃(selected.category4||'未分组')+'</p><p class="selection-location">当前位置：'+逃(location)+'</p>'+moduleHtml+'<div class="selection-actions"><button type="button" data-map-locate="'+逃(selected.id)+'">定位陈列图</button>'+(可编辑模式()&&modules.length>1?'<button type="button" class="danger-mini" data-map-delete-module="'+逃(selected.id)+'">删除当前模块</button>':'')+(可编辑模式()?'<button type="button" class="danger-mini" data-map-down="'+逃(selected.id)+'">下架SKU</button>':'')+'</div>'+(可编辑模式()?'<div class="selection-editor"><label>陈列柜段'+选择柜(selected)+'</label><label>陈列面方向'+选择陈列面方向(selected)+'</label><label>陈列列数<input type="number" min="0" step="1" value="'+格(selected.displayCols,0)+'" onchange="改SKU(\''+selected.id+'\',\'displayCols\',this.value)"></label><label>单列容量<input type="number" min="0" step="0.1" value="'+格(selected.perCol,1)+'" onchange="改SKU(\''+selected.id+'\',\'perCol\',this.value)"></label><label>单列占宽mm<input type="number" min="0" step="0.1" value="'+格(selected.faceWidth,1)+'" onchange="改SKU(\''+selected.id+'\',\'faceWidth\',this.value)"></label></div>':'')+'<div class="frozen-metrics"><div><span>箱规</span><b>'+格(selected.carton,0)+'件/箱</b></div><div><span>满陈</span><b>'+格(c.full,0)+'件</b></div><div><span>触发库存</span><b>'+格(c.trigger,0)+'件</b></div><div><span>需外储</span><b>'+格(c.external,0)+'件</b></div><div><span>静态外储</span><b>'+格(c.staticVol,1)+'L</b></div></div><div class="external-watch'+externalCls+'"><b>本店外储联动</b><span>动态P95 '+格(summary.p95,1)+'L</span><span>建议外储 '+格(summary.suggested,0)+'L / 上限 '+格(状态.params.externalCapL,0)+'L</span></div></section>';
  }
  const stagedItemsHtml=staged.map(r=>'<span class="map-item staging-item" data-sku-id="'+逃(r.id)+'" style="'+陈列图商品样式(r)+'">'+陈列图商品标签(r)+'</span>').join('');
  const stagedHtml='<section id="displayStagingZone" class="staging-zone"><h3>待选区</h3><div class="pool-search staging-search"><input id="displayStagingSearch" type="search" value="'+逃(stagedQuery)+'" placeholder="搜索品名、条码、类目"></div><p>临时释放原柜段空间。待选商品拖回可用柜段并清空待选区后，才能完成保存。</p><div class="staging-items">'+(stagedItemsHtml||'<span class="map-empty">暂无待分配商品</span>')+(stagedItemsHtml?'<span class="map-empty staging-search-empty" hidden>没有匹配的待选SKU</span>':'')+'</div></section>';
  const list=陈列图池列表(store);
  const listHtml='<div class="pool-search"><input id="displayMapPoolSearch" type="search" placeholder="搜索品名、条码、二级/三级类目"></div><div class="pool-list">'+(list.map(r=>{const location=r.inStaging?'待选区':(r.included?柜名(r)+' '+柜位(r):'未纳入'),moduleCount=同SKU陈列模块(r).length;const status=r.inStaging?'待分配':(r.included?(moduleCount>1?'架内模块 '+moduleCount+' 个':'架内'):'未纳入');return '<article class="pool-item '+(r.id===当前.陈列图选中SKU?'selected':'')+'"><button type="button" class="pool-item-main" data-map-select="'+逃(r.id)+'"><span>'+逃(r.name)+'</span><small>'+逃(r.barcode||'无条码')+' ｜ '+逃(r.category4||r.category3)+'</small><small class="pool-location">'+逃(location)+'</small></button><div class="pool-item-side"><span class="tag '+分级(r.grade)+'">'+逃(r.grade||'')+'</span><em>'+status+'</em></div>'+(可编辑模式()&&!r.included&&!文(r.status).includes("淘汰")?'<button type="button" class="pool-locate pool-include" data-map-include="'+逃(r.id)+'">纳入</button>':'')+(r.included?'<button type="button" class="pool-locate" data-map-locate="'+逃(r.id)+'">定位</button>':'')+(moduleCount>1?'<button type="button" class="pool-delete danger-mini" data-map-delete-module="'+逃(r.id)+'">删除模块</button>':'')+'</article>'}).join('')||'<div class="empty">没有匹配的SKU</div>')+'</div>';
  const stageHost=q('#displayStagingHost'); if(stageHost)stageHost.innerHTML='';
  el.innerHTML=selectedHtml+stagedHtml+'<section class="side-summary external-summary-card"><div class="side-card-title"><span>外储空间监测</span><small>随陈列数据实时联动</small></div><div class="external-summary-grid"><div><span>动态P95</span><strong>'+格(summary.p95,1)+'L</strong></div><div><span>建议外储</span><strong class="'+(summary.suggested>数(状态.params.externalCapL)?'bad':'ok')+'">'+格(summary.suggested,0)+'L</strong></div><div><span>容量上限</span><strong>'+格(状态.params.externalCapL,0)+'L</strong></div></div></section><section class="side-pool"><div class="side-card-title"><span>商品信息栏</span><small>点击商品后在上方查看</small></div>'+tabsHtml+listHtml+'</section>';
  qa("[data-map-pool]").forEach(b=>b.onclick=()=>{当前.陈列图筛选=b.dataset.mapPool;渲染陈列图右侧()});
  qa("[data-map-select]").forEach(b=>b.onclick=()=>选中陈列图SKU(b.dataset.mapSelect));
  qa("[data-map-locate]").forEach(b=>b.onclick=()=>选中陈列图SKU(b.dataset.mapLocate));
  qa("[data-map-delete-module]").forEach(b=>b.onclick=e=>{e.stopPropagation();删除陈列模块(b.dataset.mapDeleteModule)});
  qa("[data-map-clone]").forEach(b=>b.onclick=e=>{e.stopPropagation();分身SKU到陈列图(b.dataset.mapClone)});
  qa("[data-map-down]").forEach(b=>b.onclick=()=>陈列图下架SKU(b.dataset.mapDown));
  qa("[data-map-include]").forEach(b=>b.onclick=e=>{e.stopPropagation();陈列图纳入SKU(b.dataset.mapInclude)});
  const search=q("#displayMapPoolSearch");if(search)search.oninput=()=>渲染陈列图右侧();
  const stagingSearch=q("#displayStagingSearch");if(stagingSearch){
    const applyStagingSearch=()=>{
      const helper=window.PlanogramStagingSearch?.applyPlanogramStagingSearch;
      if(helper)helper(qa("#displayStagingZone .staging-item"),q("#displayStagingZone .staging-search-empty"),stagedRows,stagingSearch.value);
    };
    stagingSearch.oninput=applyStagingSearch;
    applyStagingSearch();
  }
}
function 陈列图柜段监控(seg,use,isStorage=false,disabled=false){
  if(isStorage)return '<div class="layer-monitor layer-storage-monitor"><strong>第6层 存储位</strong><span>不参与冻品陈列</span></div>';
  if(!seg)return '<div class="layer-monitor"><strong>未配置柜段</strong></div>';
  if(disabled)return '<div class="layer-monitor layer-reserved-monitor"><strong>'+逃(seg.position)+' 其他品类预留</strong><span>不参与冻品陈列</span></div>';
  const c=use.get(seg.key)||{length:数(seg.length),used:0,left:数(seg.length),items:[]};
  const capacity=数(c.length),used=Math.max(0,数(c.used)),left=数(c.left),skuCount=(c.items||[]).length;
  const rate=capacity?Math.min(100,Math.max(0,used/capacity*100)):0;
  const leftCls=left<0?'bad':left>300?'warn':'ok';
  return '<div class="layer-monitor" data-layer-monitor="'+逃(seg.key)+'"><div class="layer-monitor-title"><strong>'+逃(seg.position)+'</strong><span>'+skuCount+'个SKU</span></div><div class="layer-monitor-stats"><span>容量 <b>'+格(capacity,0)+'mm</b></span><span>已用 <b>'+格(used,0)+'mm</b></span><span class="'+leftCls+'">余量 <b>'+格(left,0)+'mm</b></span></div><div class="layer-monitor-bar"><i style="width:'+rate.toFixed(1)+'%"></i></div></div>';
}
function 渲染陈列余量监控(){渲染陈列图();}
function 渲染陈列图(){
  if(!q('#displayMapCanvas'))return;
  const store=门店名(),type4=当前.陈列图四级||"";
  const rows=陈列图排序(纳入SKU(store).filter(r=>!r.inStaging&&(!type4||文(r.category4)===type4)));
  const cabs=状态.cabinets.filter(c=>c.store===store);
  const usage=new Map(柜段使用().filter(c=>c.store===store).map(c=>[c.key,c]));
  const byLabel=new Map();for(const c of cabs){if(!byLabel.has(c.label))byLabel.set(c.label,[]);byLabel.get(c.label).push(c)}
  const filter=q('#displayMapCategoryFilter');
  if(filter){const categories=[...new Set(纳入SKU(store).map(r=>文(r.category4)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));filter.innerHTML='<option value="">全部四级品类</option>'+categories.map(v=>'<option value="'+逃(v)+'" '+(v===type4?'selected':'')+'>'+逃(v)+'</option>').join('')}
  const zoom=q('#displayMapZoom'),scale=数(zoom?.value||当前.陈列图缩放||100);当前.陈列图缩放=scale;
  let html='<div class="map-store-title">'+逃(store)+(type4?' · '+逃(type4):'')+'</div>';
  for(const [label,segments] of byLabel){
    const kind=文(segments[0]?.kind);
    html+='<div class="map-cabinet"><h3>'+逃(label)+' <span>'+逃(kind)+'</span></h3><div class="map-grid '+(kind.includes("立柜")?"vertical":"chest")+'">';
    const 生成商品卡=r=>'<span class="map-item '+(r.id===当前.陈列图选中SKU?'map-selected':'')+' '+((r.modifiedFields&&r.modifiedFields.length)?'data-changed':'')+'" data-sku-id="'+逃(r.id)+'" style="'+陈列图商品样式(r)+'" title="点击查看信息；当前页面可直接拖动">'+陈列图商品标签(r)+'</span>';
    if(kind.includes("立柜")){
      for(let i=1;i<=6;i++){
        const pos='第'+i+'层',seg=segments.find(c=>c.position===pos),items=i===6?[]:陈列图排序(rows.filter(r=>柜名(r)===label&&柜位(r)===pos)),disabled=!柜段可陈列(seg);
        const layerClass='map-layer'+(i===6?' storage-true':'')+(disabled&&i!==6?' reserved-true':'');
        html+='<div class="'+layerClass+'"'+(seg&&i!==6?' data-cab-key="'+逃(seg.key)+'" title="'+(disabled?'其他品类预留位，不可放入冻品':'当前页面可编辑时可拖放单个商品')+'"':'')+'>'+陈列图柜段监控(seg,usage,i===6,disabled)+'<div class="layer-products">';
        if(i===6)html+='<span class="map-item storage">存储位，不陈列SKU</span>';
        else html+=items.map(生成商品卡).join('')||(disabled?'<span class="map-empty">其他品类预留</span>':'<span class="map-empty">空</span>');
        html+='</div></div>';
      }
    }else{
      for(const seg of segments.sort((a,b)=>文(a.position).localeCompare(文(b.position),'zh-CN'))){
        const items=陈列图排序(rows.filter(r=>柜名(r)===label&&柜位(r)===seg.position)),disabled=!柜段可陈列(seg);
        html+='<div class="map-layer'+(disabled?' reserved-true':'')+'" data-cab-key="'+逃(seg.key)+'" title="'+(disabled?'预留位，不可放入冻品':'当前页面可编辑时可拖放单个商品')+'">'+陈列图柜段监控(seg,usage,false,disabled)+'<div class="layer-products">'+(items.map(生成商品卡).join('')||(disabled?'<span class="map-empty">预留</span>':'<span class="map-empty">空</span>'))+'</div></div>';
      }
    }
    html+='</div></div>';
  }
  const canvas=q('#displayMapCanvas');canvas.style.setProperty('--planogram-scale',String(scale/100));canvas.innerHTML=html;渲染陈列图右侧();绑定陈列图拖拽();
}function 导出陈列图(){
const el=q("#displayMapCanvas");
if(!el||!el.innerText.trim()){alert("请先生成陈列图");return}
const width=Math.max(1200,Math.ceil(el.scrollWidth||el.clientWidth||1200));
const height=Math.max(1200,Math.ceil(el.scrollHeight||el.clientHeight||1200));
const style='<style>body{margin:0;font-family:Microsoft YaHei,Arial,sans-serif;background:#fff}.map-store-title{font-size:20px;font-weight:900;margin:0 0 8px}.map-cabinet{border:1px solid #ccc;margin:10px;padding:10px;border-radius:8px;background:#fff}.map-cabinet h3{display:flex;justify-content:space-between;gap:8px;margin:0 0 10px}.map-cabinet h3 span{font-size:12px;color:#666}.map-grid{display:grid;gap:8px}.map-grid.vertical{grid-template-columns:1fr}.map-grid.chest{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.map-layer{border:1px solid #ddd;margin:6px 0;padding:8px;border-radius:6px;background:#fdfdfd;min-height:56px}.map-layer b{display:block;margin-bottom:6px;color:#34423d}.map-item{display:inline-flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;margin:3px 4px 3px 0;padding:5px 7px;border-radius:5px;border:1px solid rgba(0,0,0,.08);font-size:12px;line-height:1.35;white-space:normal;word-break:break-all}.map-item small{display:block;font-size:11px;color:#33423d;font-weight:700;margin-top:2px}.map-item.storage{background:#e5e7eb}.map-empty{color:#9ca3af}</style>';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:'+width+'px;height:'+height+'px;overflow:visible;">'+style+el.outerHTML+'</div></foreignObject></svg>';
导出("门店陈列图_"+门店名()+".svg",svg,"image/svg+xml;charset=utf-8");
完成提示("陈列图已导出为图片文件。")
}
function 导出陈列图Excel(){
  const store=门店名();
  const rows=纳入SKU(store).filter(r=>r.included!==false&&!r.inStaging);
  const exporter=window.PlanogramExcelExport;
  if(!rows.length){alert("当前门店没有可导出的陈列商品");return}
  if(!exporter?.buildPlanogramExportData||!exporter?.toExcelXmlWorkbook){alert("Excel导出模块尚未加载，请刷新页面后重试");return}
  const output=exporter.buildPlanogramExportData({
    store,
    rows,
    productKey:r=>产品主键(r)||SKU键(r)||r.id,
    cabinetInfo:r=>{const c=陈列图来源柜段(r)||{};return{kind:c.kind||c.type||c.cabinetType||r.cabinetType||"",label:柜名(r),position:柜位(r)}},
    calculate:r=>计算SKU(r),
    productVolume:r=>单品体积(r),
    displayDirection:r=>陈列面方向值(r)==="length"?"长做陈列面":"宽做陈列面",
  });
  const xml=exporter.toExcelXmlWorkbook([
    {name:"商品汇总",rows:output.summaryRows},
    {name:"陈列模块明细",rows:output.moduleRows},
  ]);
  const fileStore=文(store).replace(/[\\/:*?"<>|]/g,"_")||"当前门店";
  导出("冻品陈列导入_"+fileStore+"_"+new Date().toISOString().slice(0,10)+".xls",xml,"application/vnd.ms-excel;charset=utf-8");
  完成提示("Excel导出完成：商品汇总"+output.summaryRows.length+"条，陈列模块明细"+output.moduleRows.length+"条。未导出待选区和未纳入SKU。");
}
function 清空新品试算(){["newSkuName","newSkuBarcode","newSkuGrade","newSkuCategory","newSkuLength","newSkuWidth","newSkuHeight","newSkuVolume","newSkuCarton","newSkuDaily","newSkuCols","newSkuPerCol"].forEach(id=>{const el=q("#"+id);if(!el)return;el.value=""});const grade=q("#newSkuGrade");if(grade)grade.value="A";const carton=q("#newSkuCarton");if(carton)carton.value="1";const daily=q("#newSkuDaily");if(daily)daily.value="0";const cols=q("#newSkuCols");if(cols)cols.value="1";const box=q("#newSkuPositionSuggestions");if(box)box.innerHTML='<div class="empty">新品试算区已清空，请重新填写新品尺寸后试算。</div>';window.新品试算方案缓存={}}function 渲染逻辑(){q("#logicRules").innerHTML=(状态.rules.length?状态.rules.map(r=>"<p>"+Object.values(r).filter(Boolean).map(逃).join("：")+"</p>").join(""):"<p>当前版本采用10%触发，外储容量上限754L。</p>")}
let 冰箱尺寸预览=null;
let 冰箱新增分区草稿=[];
function 冰箱尺寸更新(){
  const updates=[];
  qa("[data-fridge-dimension]").forEach(el=>{
    const key=el.dataset.cabinetKey,field=el.dataset.fridgeDimension;
    if(!key||!["length","depth","height"].includes(field))return;
    const cabinet=状态.cabinets.find(c=>c.key===key);
    if(cabinet&&数(el.value)!==数(cabinet[field])){
      const found=updates.find(x=>x.key===key);
      if(found)found[field]=数(el.value);
      else updates.push({key,length:数(cabinet.length),depth:数(cabinet.depth),height:数(cabinet.height),[field]:数(el.value)});
    }
  });
  return updates;
}
function 冰箱组(groupId){return window.RefrigeratorModule.groupRefrigerators(状态.cabinets).find(group=>group.id===groupId)||null}
function 冰箱默认新增分区(group){
  const last=group?.sections?.[group.sections.length-1]||{};
  const vertical=/立柜/.test([group?.kind,group?.type,group?.label].map(文).join(" "));
  return{groupId:group.id,position:vertical?"第"+(group.sections.length+1)+"层":"分区"+(group.sections.length+1),length:数(last.length),depth:数(last.depth),height:数(last.height)};
}
function 冰箱新增分区更新(){
  return 冰箱新增分区草稿.map(item=>{
    const read=(field,fallback)=>{const selector=field==="position"?"[data-fridge-new-position]":"[data-fridge-new-dimension='"+field+"']";const el=qa(selector).find(x=>x.dataset.fridgeNewGroup===item.groupId);return el?(field==="position"?文(el.value):数(el.value)):fallback};
    return{...item,position:read("position",item.position),length:read("length",item.length),depth:read("depth",item.depth),height:read("height",item.height)};
  });
}
window.添加冰箱分区=groupId=>{
  const group=冰箱组(groupId);if(!group)return;
  冰箱新增分区草稿=冰箱新增分区更新();
  if(!冰箱新增分区草稿.some(item=>item.groupId===groupId))冰箱新增分区草稿.push(冰箱默认新增分区(group));
  冰箱尺寸预览=null;渲染冰箱模块();
  setTimeout(()=>qa("[data-fridge-new-position]").find(el=>el.dataset.fridgeNewGroup===groupId)?.focus(),0);
};
window.取消冰箱分区=groupId=>{冰箱新增分区草稿=冰箱新增分区草稿.filter(item=>item.groupId!==groupId);冰箱尺寸预览=null;渲染冰箱模块()};
function 冰箱新增分区结果(){
  const drafts=冰箱新增分区更新(),sections=[],errors=[];
  for(const draft of drafts){
    const group=冰箱组(draft.groupId);
    if(!group){errors.push("未找到新增分区所属冰箱");continue}
    const valid=window.RefrigeratorModule.validateNewSection(draft);
    if(!valid.ok){errors.push(...valid.errors);continue}
    const template=状态.cabinets.find(c=>c.key===group.sections[0]?.key)||{};
    const created=window.RefrigeratorModule.createRefrigeratorSection(group,draft,状态.cabinets,template);
    if(created.ok)sections.push(created.cabinet);else errors.push(...created.errors);
  }
  return{drafts,sections,errors};
}
function 冰箱尺寸受影响行(updates){
  const keys=new Set(updates.map(x=>x.key));
  return 状态.skus.filter(row=>keys.has(row.cabinetKey)||(row.placements||[]).some(p=>keys.has(p.cabinetKey)));
}
function 冰箱尺寸联动结果(updates){
  const nextCabinets=window.RefrigeratorModule.applyDimensionUpdates(状态.cabinets,updates);
  const rows=冰箱尺寸受影响行(updates).map(row=>{
    const cabinet=nextCabinets.find(c=>c.key===row.cabinetKey)||(row.placements||[]).map(p=>nextCabinets.find(c=>c.key===p.cabinetKey)).find(Boolean);
    const before=满陈(row),preferred=陈列面方向值(row),layout=cabinet?柜型摆法(row,cabinet,preferred,true):null;
    const after=layout?Math.max(0,Math.floor(数(row.displayCols)||1)*layout.per):0;
    return{row,cabinet,before,after,layout,issue:layout?"":"当前陈列面方向无法适配新尺寸，请切换长/宽陈列面"};
  });
  return{updates,nextCabinets,rows};
}
function 渲染冰箱联动结果(result){
  const el=q("#refrigeratorImpact");if(!el)return;
  if(!result){el.innerHTML='<div class="help">修改尺寸或添加分区后点击“预览联动”，系统会只检查受影响商品。</div>';return}
  const issues=result.rows.filter(x=>x.issue),changes=result.rows.filter(x=>x.before!==x.after),lines=[];
  if(!result.updates.length&&!result.newSections?.length)lines.push("当前没有检测到尺寸变化或新增分区。");
  else if(result.newSections?.length)lines.push("待新增 "+result.newSections.length+" 个分区；"+(result.updates.length?"已检测 "+result.updates.length+" 个分区尺寸变化，":"")+"受影响陈列行 "+result.rows.length+" 条。保存后不会移动柜段、顺序、列数或陈列方向。");
  else lines.push("已检测 "+result.updates.length+" 个分区尺寸变化，受影响陈列行 "+result.rows.length+" 条。保存后不会移动柜段、顺序、列数或陈列方向。");
  if(changes.length)lines.push("满陈变化："+changes.slice(0,12).map(x=>逃(x.row.name||x.row.barcode)+" "+x.before+"→"+x.after).join("；")+(changes.length>12?"；其余 "+(changes.length-12)+" 条":""));
  if(result.newSections?.length)lines.push("新增分区："+result.newSections.map(c=>逃(c.store+" / "+c.label+" / "+c.position)).join("；"));
  if(issues.length)lines.push("不适配："+issues.slice(0,8).map(x=>逃(x.row.name||x.row.barcode)+"（"+x.issue+"）").join("；"));
  el.className="refrigerator-impact "+(issues.length?"bad":"ok");el.innerHTML=lines.map(x=>"<div>"+x+"</div>").join("");
}
window.预览冰箱尺寸=()=>{
  const updates=冰箱尺寸更新(),invalid=window.RefrigeratorModule.validateDimensionUpdates(updates),newResult=冰箱新增分区结果();
  const errors=[...(invalid.ok?[]:invalid.errors),...newResult.errors];
  if(errors.length){冰箱尺寸预览={updates,nextCabinets:状态.cabinets,rows:[],newSections:[],errors};const el=q("#refrigeratorImpact");if(el){el.className="refrigerator-impact bad";el.innerHTML=errors.map(x=>"<div>"+逃(x)+"</div>").join("")}return false}
  冰箱尺寸预览=冰箱尺寸联动结果(updates);冰箱尺寸预览.newDrafts=newResult.drafts;冰箱尺寸预览.newSections=newResult.sections;渲染冰箱联动结果(冰箱尺寸预览);return true;
};
window.应用冰箱尺寸=()=>{
  if(!window.预览冰箱尺寸())return;
  const result=冰箱尺寸预览;if(!result||(!result.updates.length&&!result.newSections?.length)){完成提示("没有需要保存的冰箱尺寸或新增分区变化。");return}
  状态.cabinets=window.RefrigeratorModule.applyDimensionUpdates(状态.cabinets,result.updates);
  if(result.newSections?.length)状态.cabinets.push(...result.newSections);
  刷新已加载陈列容量(状态);
  for(const item of result.rows){const live=状态.skus.find(x=>x.id===item.row.id);if(!live)continue;if(item.issue){live.perCol=0;live.rowFull=0;live.capacityStatus="冰箱尺寸不适配";live.capacityIssue=item.issue}else{delete live.capacityStatus;delete live.capacityIssue}}
  冰箱新增分区草稿=[];冰箱尺寸预览=null;保存();当前.页面="refrigerator";渲染全部();完成提示(result.newSections?.length?"冰箱尺寸已保存，并已新增分区；现有陈列位置和顺序未改变。":"冰箱尺寸已保存，并已联动重算受影响SKU满陈；现有陈列位置和顺序未改变。");
};
function 渲染冰箱模块(){
  const host=q("#refrigeratorTable");if(!host)return;
  const storeEl=q("#refrigeratorStoreFilter"),searchEl=q("#refrigeratorSearch"),oldStore=storeEl?.value||当前.门店||"",search=文(searchEl?.value).toLowerCase();
  const stores=[...new Set(状态.cabinets.map(c=>c.store).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  if(storeEl){storeEl.innerHTML='<option value="">全部门店</option>'+stores.map(s=>'<option value="'+逃(s)+'">'+逃(s)+"</option>").join("");storeEl.value=stores.includes(oldStore)?oldStore:""}
  const selected=storeEl?.value||"";let groups=window.RefrigeratorModule.groupRefrigerators(状态.cabinets,selected);
  if(search)groups=groups.filter(g=>(g.label+" "+g.store+" "+g.id+" "+g.sections.map(s=>s.position).join(" ")).toLowerCase().includes(search));
  if(!groups.length){host.innerHTML='<div class="empty">没有匹配的冰箱分区数据。</div>';return}
  const usage=new Map(柜段使用().map(c=>[c.key,c]));
  host.innerHTML=groups.map(g=>{
    const drafts=冰箱新增分区草稿.filter(item=>item.groupId===g.id);
    const rows=g.sections.map(s=>{const c=usage.get(s.key)||s;return'<tr><td>'+逃(s.position)+'</td><td><input data-fridge-dimension="length" data-cabinet-key="'+逃(s.key)+'" type="number" min="1" step="0.1" value="'+逃(s.length)+'"></td><td><input data-fridge-dimension="depth" data-cabinet-key="'+逃(s.key)+'" type="number" min="1" step="0.1" value="'+逃(s.depth)+'"></td><td><input data-fridge-dimension="height" data-cabinet-key="'+逃(s.key)+'" type="number" min="1" step="0.1" value="'+逃(s.height)+'"></td><td>'+格(c.used,1)+'mm</td><td class="'+(c.left<0?"bad":"")+'">'+格(c.left,1)+'mm</td></tr>'}).join("");
    const newRows=drafts.map(d=>'<tr class="refrigerator-new-section"><td><input data-fridge-new-group="'+逃(d.groupId)+'" data-fridge-new-position type="text" value="'+逃(d.position)+'" aria-label="新增分区名称"></td><td><input data-fridge-new-group="'+逃(d.groupId)+'" data-fridge-new-dimension="length" type="number" min="1" step="0.1" value="'+逃(d.length)+'" aria-label="新增分区长度"></td><td><input data-fridge-new-group="'+逃(d.groupId)+'" data-fridge-new-dimension="depth" type="number" min="1" step="0.1" value="'+逃(d.depth)+'" aria-label="新增分区宽度或深度"></td><td><input data-fridge-new-group="'+逃(d.groupId)+'" data-fridge-new-dimension="height" type="number" min="1" step="0.1" value="'+逃(d.height)+'" aria-label="新增分区高度"></td><td colspan="2"><button type="button" data-cancel-refrigerator-section="'+逃(d.groupId)+'">取消新增</button></td></tr>').join("");
    return'<article class="refrigerator-card"><div class="refrigerator-card-head"><div><h3>'+逃(g.label)+'</h3><p>'+逃(g.store)+' · '+(g.sections.length+drafts.length)+' 个分区/层'+(drafts.length?'（含待新增）':'')+'</p></div><div class="refrigerator-card-actions"><button type="button" data-add-refrigerator-section="'+逃(g.id)+'">添加分区</button><button type="button" onclick="预览冰箱尺寸()">预览联动</button><button type="button" class="primary" onclick="应用冰箱尺寸()">保存并联动</button></div></div><div class="refrigerator-sections"><table><thead><tr><th>分区/层</th><th>长 mm</th><th>宽/深 mm</th><th>高 mm</th><th>已用宽度</th><th>剩余宽度</th></tr></thead><tbody>'+rows+newRows+'</tbody></table></div></article>';
  }).join("");
  qa("[data-add-refrigerator-section]").forEach(btn=>btn.addEventListener("click",()=>window.添加冰箱分区(btn.dataset.addRefrigeratorSection)));
  qa("[data-cancel-refrigerator-section]").forEach(btn=>btn.addEventListener("click",()=>window.取消冰箱分区(btn.dataset.cancelRefrigeratorSection)));
  if(!q("#refrigeratorImpact"))host.insertAdjacentHTML("beforebegin",'<div id="refrigeratorImpact" class="refrigerator-impact"></div>');渲染冰箱联动结果(冰箱尺寸预览);
}
function 切换(id){提交当前编辑();当前.页面=id;
qa(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
qa(".view").forEach(v=>v.classList.toggle("active",v.id===id));
渲染全部()}
function 渲染全部(){切换数据源();清空业务快照();建立基准(状态);选项初始化();
 document.body.classList.add("ops");
 const banner=q("#modeBanner");if(banner)banner.textContent="当前页面可直接编辑，修改会实时保存到本机。";
 const 当前版本=window.UNIFIED_CARTON_VERSION||{},当前报告=window.UNIFIED_CARTON_REPORT||{};q("#dataNote").textContent=(状态.meta.version||"10%触发")+"｜底表："+(当前版本.sourceName||状态.meta.source||"当前版")+"｜"+(当前报告.passed===false?"复核失败":"复核通过")+"｜生成："+(状态.meta.generatedAt||当前版本.generatedAt||"");
 const renderers={overview:渲染总览,goods:渲染商品,risk:渲染风险,replenish:渲染补货,allocation:渲染排柜,refrigerator:渲染冰箱模块,displaymap:渲染陈列图,newstore:渲染新增门店,logic:渲染逻辑};
 renderers[当前.页面]?.();
 qa(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.view===当前.页面));qa(".view").forEach(v=>v.classList.toggle("active",v.id===当前.页面))
}
function 导出(name,content,type){const b=new Blob([content],{type});
const a=document.createElement("a");
a.href=URL.createObjectURL(b);
a.download=name;
a.click();
URL.revokeObjectURL(a.href)}q("#storeSelect").onchange=e=>{提交当前编辑();当前.门店=e.target.value;
渲染全部()};
qa(".tabs button").forEach(b=>b.onclick=()=>切换(b.dataset.view));
window.addEventListener("store-sku:action",e=>{const d=e.detail||{};if(!d.store||!d.name)return;const select=q("#storeSelect");if(select&&[...select.options].some(o=>o.value===d.store))select.value=d.store;当前.门店=d.store;当前.定位SKU=d.name;切换(d.view);setTimeout(()=>q(d.view==="risk"?"#riskTable tr.selected-row":"#allocationTable tr.selected-row")?.scrollIntoView({block:"center",behavior:"smooth"}),60)});
["overviewSearch","storeSearch","goodsSearch","riskSearch","cabinetSearch","levelFilter","riskFilter","suggestCabinet","suggestStore","suggestProduct","allocationSearch","allocationCabinetSearch","allocationTypeFilter","allocationCabNoFilter","allocationPosFilter","allocationSceneFilter"].forEach(id=>{const el=q("#"+id);
if(el)el.addEventListener("input",渲染全部),el.addEventListener("change",渲染全部)});
q("#displayMapCategoryFilter")?.addEventListener("change",e=>{当前.陈列图四级=e.target.value;渲染陈列图()});
q("#displayMapZoom")?.addEventListener("change",e=>{当前.陈列图缩放=数(e.target.value)||100;渲染陈列图()});
q("#refrigeratorStoreFilter")?.addEventListener("change",()=>{冰箱新增分区草稿=冰箱新增分区更新();冰箱尺寸预览=null;渲染冰箱模块()});
q("#refrigeratorSearch")?.addEventListener("input",()=>{冰箱新增分区草稿=冰箱新增分区更新();渲染冰箱模块()});
if(q("#manualAddSkuBtn"))q("#manualAddSkuBtn").onclick=()=>手动新增SKU();
if(q("#generateSuggestBtn"))q("#generateSuggestBtn").onclick=()=>渲染建议();
if(q("#trialNewSkuBtn"))q("#trialNewSkuBtn").onclick=()=>试算新品位置();
if(q("#allStoreTrialBtn"))q("#allStoreTrialBtn").onclick=()=>试算全店上新();
if(q("#applyAllStoreSkuBtn"))q("#applyAllStoreSkuBtn").onclick=()=>应用全店上新();
if(q("#addPoolSkuBtn"))q("#addPoolSkuBtn").onclick=()=>{确保产品池(状态).push(标准产品池对象({name:"新增SKU-请修改",grade:"未评级",category3:"待填写",category4:"待填写",carton:1,daily:0,active:true}));保存();渲染全部();完成提示("产品池新增完成：已添加一条空白SKU，请补全商品资料。")};
if(q("#importPoolBtn"))q("#importPoolBtn").onclick=()=>导入产品池文本();
if(q("#deleteDisabledPoolBtn"))q("#deleteDisabledPoolBtn").onclick=()=>完成提示("为保护历史数据，已禁用删除淘汰SKU。淘汰记录将保留在产品池中。");
if(q("#loadStoreExampleBtn"))q("#loadStoreExampleBtn").onclick=()=>{const box=q("#newStoreCabinetConfig");if(box){box.value="卧柜,2500mm,3,1988*697*459+360*697*199\n卧柜,2000mm,1,1488*697*459+360*697*199\n冰淇淋柜,1900mm,1,1386*697.5*424+325*697.5*164\n立柜,3m,1,门数=4,层数=6,710*534*250"}完成提示("示例已填入：立柜会按1-5层陈列，第6层仅作为陈列图存储位。")};
if(q("#trialStoreBtn"))q("#trialStoreBtn").onclick=()=>测算新增门店();
if(q("#applyStoreBtn"))q("#applyStoreBtn").onclick=()=>追加新增门店();
if(q("#syncDisplayMapBtn"))q("#syncDisplayMapBtn").onclick=()=>{渲染陈列图();完成提示("陈列图同步完成：已刷新当前门店的商品陈列图与余量监控。")};
if(q("#exportDisplayMapBtn"))q("#exportDisplayMapBtn").onclick=()=>导出陈列图();
if(q("#exportDisplayMapExcelBtn"))q("#exportDisplayMapExcelBtn").onclick=()=>导出陈列图Excel();
q("#removeExcludedBtn").onclick=()=>完成提示("为保护历史数据，已禁用删除未纳入SKU。请保留记录并通过生命周期任务管理状态。");

q("#exportJsonBtn").onclick=()=>{导出("整箱到店数据测算_当前版.json",JSON.stringify(状态,null,2),"application/json;charset=utf-8");完成提示("导出完成：回传底表JSON已生成，可上传到 GitHub 的 data/source/整箱到店数据测算_当前版.json。")};
q("#exportCsvBtn").onclick=()=>{const heads=["门店","商品","条码","等级","三级类目","陈列柜","陈列位","列数","单列容量","满陈","箱规","需外储","外储L","风险"];
const lines=[heads.join(",")];
状态.skus.forEach(r=>{const c=计算SKU(r);
const vals=[r.store,r.name,r.barcode,r.grade,r.category3,柜名(r),柜位(r),r.displayCols,r.perCol,c.full,r.carton,c.external,格(c.staticVol),c.risk];
lines.push(vals.map(v=>'"'+文(v).replace(/"/g,'""')+'"').join(","))});
导出("冻品整箱到店排柜测算.csv","\ufeff"+lines.join("\n"),"text/csv;charset=utf-8");完成提示("导出完成：排柜CSV已生成。")};
q("#importJsonBtn").onclick=()=>{try{const incoming=JSON.parse(q("#importBox").value);
if(!incoming.skus||!incoming.cabinets)throw new Error("缺少必要数据");
状态=清理计算缓存(incoming);
建立基准(状态);
保存();
渲染全部();
完成提示("导入完成：方案已载入并重新计算。")}catch(e){alert("导入失败："+e.message)}};
q("#restoreBtn").onclick=()=>{if(confirm("确认恢复初始数据？当前本地修改会被清空。")){localStorage.removeItem(统一状态保存键);状态=初始状态();草稿状态=状态;发布状态=状态;
建立基准(状态);当前.页面="goods";清空新品试算();window.全店上新缓存={};window.新增门店测算缓存=null;渲染全部();完成提示("恢复完成：已清除本地修改、产品池临时导入、新门店草稿、新品全店方案、标色和同步草稿，并退出到绿色门店页面。")}};

// === 2026-07-09 严格新增门店 + 陈列图可移动补强 ===
function 新店重算用量(pre){
  const use=pre.cabinets.map(c=>({...c,used:0,left:数(c.length),items:[]}));
  const map=new Map(use.map(c=>[c.key,c]));
  for(const r of pre.skus){
    if(!r.included)continue;
    const c=map.get(r.cabinetKey);
    if(!c)continue;
    const w=SKU占用宽度(r);
    c.used+=w;
    c.left=Number((数(c.length)-数(c.used)).toFixed(1));
    c.items.push(r);
  }
  更新新店柜段用量(use);
  pre.cabinets=use;
  pre.included=pre.skus.filter(r=>r.included);
  pre.missing=pre.skus.filter(r=>!r.included);
  if(pre.strictEngine&&pre.enginePlan&&globalThis.StrictAllocationAdapter?.recalculatePlan){
    pre.enginePlan.rows=pre.skus;
    pre.enginePlan.cabinets=pre.cabinets;
    globalThis.StrictAllocationAdapter.recalculatePlan(pre.enginePlan,{productPool:产品池有效(),externalCapL:pre.enginePlan.params.externalCapL});
    pre.validation=pre.enginePlan.validation;
  }else{
    pre.validation=严格复核新增门店(pre);
  }
  return pre;
}
function 新店剔除分(r){
  const grade={A:0,B:1,C:3,D:5}[文(r.grade).toUpperCase()]??4;
  const c=计算SKU(r);
  return grade*100000 + c.staticVol*1000 + c.externalDays*20 - 数(r.dailyQty)*100 - (1000-数(r.rank));
}
function 新店压缩到可执行(pre){
  新店重算用量(pre);
  let guard=0;
  while((新店汇总(pre).suggested>数(状态.params.externalCapL) || pre.cabinets.some(c=>数(c.sourceLeft)<-0.001)) && guard<80){
    guard++;
    const candidates=pre.included
      .filter(r=>!['A','B'].includes(文(r.grade).toUpperCase()) || 计算SKU(r).external>0)
      .sort((a,b)=>新店剔除分(b)-新店剔除分(a));
    const hit=candidates[0];
    if(!hit)break;
    hit.included=false;
    hit.status='新增门店严格测算-暂不纳入';
    hit.sourceAction='为满足754L外储或柜段不超宽，自动转入暂不纳入清单';
    hit.note='新增门店严格测算自动优化：低优先级SKU暂不纳入';
    hit.cabinetKey='';hit.cabinetLabel='';hit.position='';hit.displayCols=0;hit.perCol=0;hit.faceWidth=0;
    新店重算用量(pre);
  }
  return pre;
}
严格复核新增门店=function(pre){
  const errors=[];const warnings=[];const summary=新店汇总(pre);
  const cabs=pre.cabinets.map(c=>({...c,left:数(c.sourceLeft),used:数(c.sourceUsed),over:数(c.sourceLeft)<-0.001}));
  if(summary.suggested>数(状态.params.externalCapL))errors.push('建议外储容量 '+summary.suggested+'L 超过 '+状态.params.externalCapL+'L');
  const over=cabs.filter(c=>c.over);if(over.length)errors.push('柜段超宽 '+over.length+' 个');
  const layer6Used=cabs.filter(c=>/立柜/.test(c.kind)&&/第6层/.test(c.position)&&数(c.sourceUsed)>0);if(layer6Used.length)errors.push('立柜第6层参与陈列 '+layer6Used.length+' 个');
  const iceWrong=pre.included.filter(r=>是否冰品SKU(r)!==是否冰品柜段(pre.cabinets.find(c=>c.key===r.cabinetKey)||{}));if(iceWrong.length)errors.push('冰品/非冰品柜别错误 '+iceWrong.length+' 个');
  const split=new Map();for(const r of pre.included){const cab=pre.cabinets.find(c=>c.key===r.cabinetKey)||{};const kind=是否冰品柜段(cab)?'冰淇淋柜':(/立柜/.test(cab.kind||cab.label)?'立柜':'卧柜');const k=pre.store+'|'+SKU键(r)+'|'+kind;if(!split.has(k))split.set(k,new Set());split.get(k).add((cab.label||r.cabinetLabel||'')+' '+(cab.position||r.position||''))}
  const splitBad=[...split.values()].filter(v=>v.size>1).length;if(splitBad)errors.push('同SKU同柜型拆分 '+splitBad+' 个');
  const ordinaryLarge=cabs.filter(c=>!是否冰品柜段(c)&&数(c.left)>300);if(ordinaryLarge.length)warnings.push('普通柜段剩余大于300mm '+ordinaryLarge.length+' 个，请人工关注是否还有可补位商品');
  if(pre.missing.length)warnings.push('暂不纳入SKU '+pre.missing.length+' 个，已作为解决方案输出，不再让门店自行处理超库容');
  return{ok:errors.length===0,errors,warnings,summary};
}
预排新增门店=function(store,type,cabs){
  const adapter=globalThis.StrictAllocationAdapter;
  if(adapter?.allocateStore){
    const plan=adapter.allocateStore({store,type,productPool:产品池有效(),cabinets:cabs,params:门店严格参数(store),storeRecord:门店严格记录(store),physicalRecords:[]},{maxIterations:12,maxExpansions:180});
    const sourceRows=plan.rows||plan.skus||[];
    const rows=sourceRows.map(r=>({...r,store,included:!!r.included,status:r.included?'新增门店严格测算-纳入':'新增门店严格测算-未排入',sourceAdvice:'新增门店严格测算',sourceAction:r.included?'严格测算纳入':`未排入：${r.reason||r.unplacedReason||'严格引擎未找到合法陈列位'}`,note:r.included?'严格自动排柜生成':(r.reason||r.unplacedReason||'严格引擎未找到合法陈列位')}));
    const cabinets=(plan.cabinets||[]).map(c=>{const used=c.usedWidth??c.used??c.sourceUsed??0;const left=c.leftWidth??c.left??c.sourceLeft??(数(c.length)-数(used));return{...c,used,left,sourceUsed:used,sourceLeft:left,items:rows.filter(r=>r.included&&(r.cabinetKey===c.key||r.cabinetKey===c.segmentKey))}});
    return {...plan,cabinets,skus:rows,included:rows.filter(r=>r.included),missing:rows.filter(r=>!r.included),strict:true,strictEngine:true,enginePlan:plan,validation:plan.validation};
  }
  throw new Error('严格自动排柜适配层尚未加载，未执行旧版兜底排柜。');
};
window.改新增门店SKU=(id,k,v)=>{
  const pre=window.新增门店测算缓存;if(!pre)return;
  const r=pre.skus.find(x=>x.id===id);if(!r)return;
  if(['displayCols','perCol','faceWidth','carton','dailyQty','volume'].includes(k))v=数(v);
  if(k==='included')v=!!v;
  r[k]=v;
  if(k==='included'&&v===false){r.status='新增门店严格测算-手动暂不纳入';r.cabinetKey='';r.cabinetLabel='';r.position='';}
  if(['displayCols','perCol','faceWidth'].includes(k))r.customPlacement=true;
  新店重算用量(pre);
  渲染新增门店();
};
渲染新增门店=function(){
  if(!q('#newStoreSummary'))return;
  const pre=window.新增门店测算缓存;
  if(!pre){q('#newStoreSummary').innerHTML='';q('#newStoreCabinetPreview').innerHTML='<div class="empty">请先录入门店名称和冰柜配置后测算。</div>';q('#newStoreSkuPreview').innerHTML='<div class="empty">暂无严格测算结果。</div>';return}
  新店重算用量(pre);
  const s=新店汇总(pre);const v=pre.validation||严格复核新增门店(pre);const status=v.ok?'通过':'不通过';
  q('#newStoreSummary').innerHTML=[['纳入SKU',s.skuCount],['暂不纳入SKU',s.missingSkuCount],['直接整箱到店SKU数',s.direct],['需外储SKU数',s.extSku],['建议外储',格(s.suggested,0)+'L'],['严格复核',status]].map(([a,b])=>'<div class="metric '+(a.includes('复核')&&!v.ok?'danger':a.includes('复核')?'':'')+'"><div class="label">'+a+'</div><div class="value">'+b+'</div></div>').join('')+(v.errors.length||v.warnings.length?'<div class="help strict-check"><strong>严格复核说明：</strong>'+[...v.errors.map(x=>'错误：'+x),...v.warnings.map(x=>'提示：'+x)].map(逃).join('；')+'</div>':'<div class="help strict-check"><strong>严格复核通过：</strong>已给出可执行陈列方案：柜段不超宽、外储不超754L、立柜第6层未参与陈列、冰品/非冰品柜别正确。</div>');
  表格('#newStoreCabinetPreview',[{name:'冰柜类型',value:c=>c.kind},{name:'陈列柜',value:c=>c.label,cls:()=> 'name'},{name:'具体位置',value:c=>c.position},{name:'长',value:c=>格(c.length,0)},{name:'已用',value:c=>格(c.sourceUsed,0)},{name:'剩余',value:c=>格(c.sourceLeft,0),cls:c=>c.sourceLeft<0?'bad':c.sourceLeft>300?'warn':'ok'},{name:'SKU数',value:c=>c.items?.length||0},{name:'占用品',value:c=>(c.items||[]).map(x=>x.name+' '+格(x.displayCols,0)+'列').join('；'),cls:()=> 'name'}],pre.cabinets);
  const rows=pre.skus.slice(0,220);
  表格('#newStoreSkuPreview',[{name:'纳入',value:r=>'<input type="checkbox" '+(r.included?'checked':'')+' onchange="改新增门店SKU(\''+r.id+'\',\'included\',this.checked)">',html:true},{name:'执行状态',value:r=>r.included?'已纳入':'暂不纳入'},{name:'未纳入原因',value:r=>r.included?'':(r.sourceAction||r.reason||r.unplacedReason||'严格引擎未找到合法陈列位'),cls:()=> 'name'},{name:'商品',value:r=>r.name,cls:()=> 'name'},{name:'等级',value:r=>标签(r.grade),html:true},{name:'四级类目',value:r=>r.category4||r.category3},{name:'陈列柜',value:r=>柜名(r)||r.cabinetLabel,cls:()=> 'name'},{name:'具体位置',value:r=>柜位(r)||r.position},{name:'陈列列数',value:r=>输入(r.displayCols,"改新增门店SKU('"+r.id+"','displayCols',this.value)"),html:true},{name:'单列容量',value:r=>输入(r.perCol,"改新增门店SKU('"+r.id+"','perCol',this.value)"),html:true},{name:'单列占宽mm',value:r=>输入(r.faceWidth,"改新增门店SKU('"+r.id+"','faceWidth',this.value)"),html:true},{name:'总占宽',value:r=>格(SKU占用宽度(r),0)+'mm'},{name:'满陈',value:r=>计算SKU(r).full},{name:'箱规',value:r=>r.carton},{name:'需外储',value:r=>计算SKU(r).external},{name:'外储L',value:r=>格(计算SKU(r).staticVol)}],rows,'没有纳入SKU');
}
建立基准(草稿状态);建立基准(发布状态);

渲染全部();

/* ==================== Supabase 云端多人协作 ====================
 * 配置说明：创建 Supabase 项目后，将以下两个占位符替换为实际值
 *   SUPABASE_URL: 项目 URL (Settings → API → Project URL)
 *   SUPABASE_ANON_KEY: 匿名公钥 (Settings → API → anon/public key)
 * ================================================================= */
const SUPABASE_URL = 'https://pdlxrolyftdolkwmdwrg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ehwIMLAALRzB4VRZwQ4quA_yS7Yh7Gg';

let cloudClient = null;
let docRevision = 0;
let cloudBaseData = null;
const CLOUD_BASELINE_KEY = 'frozen_carton_cloud_baseline_v1';
const CLOUD_ROLLBACK_KEY = 'frozen_carton_cloud_rollback_v1';
const 云端基线保护说明 = '旧云端数据不得覆盖当前页面';
let cloudBaseline = null;
try { cloudBaseline = JSON.parse(localStorage.getItem(CLOUD_BASELINE_KEY) || 'null'); } catch (_) { cloudBaseline = null; }
if (cloudBaseline?.cloudRevision) docRevision = Number(cloudBaseline.cloudRevision) || 0;
const CLOUD_SESSION_KEY = 'frozen_carton_cloud_session_v1';
const CLOUD_REQUEST_TIMEOUT_MS = 30000;
const CLOUD_REQUEST_RETRIES = 1;

function cloudReadSession() {
  try {
    const raw = localStorage.getItem(CLOUD_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function cloudWriteSession(data) {
  if (!data?.access_token) return null;
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    token_type: data.token_type || 'bearer',
    expires_in: data.expires_in || 3600,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    user: data.user || null,
  };
  try { localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
  return session;
}

async function cloudRestRequest(path, options = {}) {
  const headers = { apikey: SUPABASE_ANON_KEY, Accept: 'application/json', ...(options.headers || {}) };
  const session = cloudReadSession();
  if (session?.access_token && !options.skipAuth) headers.Authorization = `Bearer ${session.access_token}`;
  let body = options.body;
  if (body !== undefined && body !== null && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const isReadRequest = String(options.method || 'GET').toUpperCase() === 'GET';
  const maxAttempts = isReadRequest ? 1 + CLOUD_REQUEST_RETRIES : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS) : null;
    try {
      const request = { ...options, headers, body };
      if (controller) request.signal = controller.signal;
      const response = await fetch(`${SUPABASE_URL}${path}`, request);
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
      if (!response.ok) {
        const error = { code: data?.code || data?.error_code || String(response.status), message: data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${response.status}` };
        if (isReadRequest && attempt < maxAttempts - 1 && response.status >= 500) {
          await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
          continue;
        }
        return { data: null, error };
      }
      return { data, error: null };
    } catch (error) {
      const normalized = { code: error?.name === 'AbortError' ? 'CLOUD_TIMEOUT' : 'FETCH_FAILED', message: error?.name === 'AbortError' ? 'Cloud request timeout' : (error?.message || 'Failed to fetch') };
      if (isReadRequest && attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      return { data: null, error: normalized };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  return { data: null, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } };
}

function createCloudRestQuery(table) {
  const state = { method: 'GET', select: '*', filters: [], payload: null };
  const query = {
    select(fields = '*') { state.select = fields; return query; },
    eq(field, value) { state.filters.push(`${encodeURIComponent(field)}=eq.${encodeURIComponent(value)}`); return query; },
    update(payload) { state.method = 'PATCH'; state.payload = payload; return query; },
    insert(payload) { state.method = 'POST'; state.payload = payload; return query; },
    maybeSingle() { return executeQuery(false); },
    single() { return executeQuery(true); },
  };
  async function executeQuery(requireSingle) {
    const params = [`select=${encodeURIComponent(state.select)}`, ...state.filters].join('&');
    const result = await cloudRestRequest(`/rest/v1/${encodeURIComponent(table)}?${params}`, {
      method: state.method,
      body: state.payload,
      headers: state.method === 'GET' ? {} : { Prefer: 'return=representation' },
    });
    if (result.error) return result;
    const rows = Array.isArray(result.data) ? result.data : (result.data ? [result.data] : []);
    if (requireSingle && rows.length !== 1) return { data: null, error: { message: `Expected one row, got ${rows.length}` } };
    return { data: requireSingle || rows.length > 1 ? rows[0] : (rows[0] || null), error: null };
  }
  return query;
}

function createCloudRestClient() {
  return {
    auth: {
      async getSession() { return { data: { session: cloudReadSession() }, error: null }; },
      async getUser() {
        const session = cloudReadSession();
        if (!session?.access_token) return { data: { user: null }, error: null };
        const result = await cloudRestRequest('/auth/v1/user', { method: 'GET' });
        return result.error ? result : { data: { user: result.data }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const result = await cloudRestRequest('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, skipAuth: true });
        if (!result.error) result.data = cloudWriteSession(result.data);
        return result;
      },
      async signUp({ email, password }) {
        const redirect = encodeURIComponent(window.location.origin + window.location.pathname);
        const result = await cloudRestRequest(`/auth/v1/signup?redirect_to=${redirect}`, { method: 'POST', body: { email, password }, skipAuth: true });
        if (!result.error && result.data?.access_token) result.data = cloudWriteSession(result.data);
        return result;
      },
      async resend({ type, email }) {
        return cloudRestRequest('/auth/v1/resend', { method: 'POST', body: { type, email }, skipAuth: true });
      },
      async signOut() {
        const result = await cloudRestRequest('/auth/v1/logout', { method: 'POST' });
        try { localStorage.removeItem(CLOUD_SESSION_KEY); } catch (_) {}
        return result;
      },
    },
    from(table) { return createCloudRestQuery(table); },
  };
}

async function withCloudSdk(action) {
  cloudAccountNote('正在连接云端服务…');
  cloudNote('');
  if (!ensureCloudClient()) {
    const message = '云端配置不可用。';
    cloudAccountNote(message, true);
    cloudNote(message, true);
    return null;
  }
  try {
    return await action();
  } catch (error) {
    const message = translateCloudError(error?.message || 'Failed to fetch');
    cloudAccountNote(message, true);
    cloudNote(message, true);
    return null;
  }
}

function ensureCloudClient() {
  if (cloudClient) return cloudClient;
  if (SUPABASE_URL !== '__SUPABASE_URL__' && SUPABASE_URL.length > 10 && SUPABASE_ANON_KEY !== '__SUPABASE_ANON_KEY__') {
    cloudClient = createCloudRestClient();
  }
  return cloudClient;
}

function cloudNote(msg, isError) {
  const el = document.getElementById('cloudSyncStatus');
  if (el) { el.textContent = msg; el.className = 'admin-note' + (isError ? ' error' : ''); }
  const account = document.getElementById('cloudAccountStatus');
  if (isError && msg && account?.textContent?.includes('正在连接云端服务')) cloudAccountNote(msg, true);
}
function cloudAccountNote(msg, isError) {
  const el = document.getElementById('cloudAccountStatus');
  if (el) { el.textContent = msg; el.className = 'admin-note' + (isError ? ' error' : ''); }
}
function translateCloudError(msg) {
  if (!msg || typeof msg !== 'string') return '发生未知错误，请稍后重试。';
  const map = {
    'Invalid login credentials': '邮箱或密码错误，请检查后重试。',
    'Email not confirmed': '邮箱尚未验证，请查收验证邮件后登录。',
    'User already registered': '该邮箱已注册，请直接登录。',
    'Password should be at least 6 characters': '密码长度不足，请至少输入6位。',
    'Unable to validate email address: invalid format': '邮箱格式不正确，请检查后重试。',
    'Signup requires a valid password': '请输入有效的密码。',
    'Email rate limit exceeded': '操作过于频繁，请稍后再试。',
    'User not found': '用户不存在，请检查邮箱或注册新账号。',
    'JWT expired': '登录已过期，请重新登录。',
    'Failed to fetch': '无法连接云端服务，请检查网络后重试。',
    'Cloud request timeout': '云端请求超时，请检查网络后重试。',
    'column carton_documents.revision does not exist': '数据库配置异常，请刷新页面后重试。',
    'CONFLICT:': '数据版本冲突，系统将自动合并。',
  };
  for (const key in map) {
    if (msg.includes(key) || msg.toLowerCase().includes(key.toLowerCase())) return map[key];
  }
  return msg;
}

async function refreshCloudAccount() {
  if (!ensureCloudClient()) { cloudAccountNote('云端组件未配置。请先创建 Supabase 项目，然后将 URL 和 Key 填入 app.js 中的 SUPABASE_URL 和 SUPABASE_ANON_KEY。', true); return null; }
  try {
    const { data: { session } } = await cloudClient.auth.getSession();
    if (!session || !session.user) { cloudAccountNote('尚未登录云端协作账号。'); return null; }
    const verified = await cloudClient.auth.getUser();
    if (verified.error) {
      const message = translateCloudError(verified.error.message);
      if (String(verified.error.code) === '401' || String(verified.error.code) === '403' || message.includes('登录已过期')) {
        try { localStorage.removeItem(CLOUD_SESSION_KEY); } catch (_) {}
      }
      cloudAccountNote(message, true);
      return null;
    }
    const user = verified.data?.user || session.user;
    cloudAccountNote('已登录：' + (user.email || session.user.email || '当前账号') + '。');
    return { ...session, user };
  } catch (e) { cloudAccountNote('云端连接失败：' + (e.message || '未知错误'), true); return null; }
}

async function cloudSignUp() {
  const email = q('#cloudEmail').value.trim(), pwd = q('#cloudPassword').value;
  if (!email || pwd.length < 8) return cloudNote('请填写邮箱和至少 8 位密码。', true);
  const { error } = await cloudClient.auth.signUp({ email, password: pwd, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  if (error) return cloudNote(translateCloudError(error.message), true);
  cloudNote('注册成功，请前往邮箱完成验证后再登录。');
}
async function cloudResendVerification() {
  const email = q('#cloudEmail').value.trim();
  if (!email) return cloudNote('请先填写邮箱。', true);
  const { error } = await cloudClient.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  if (error) return cloudNote(translateCloudError(error.message), true);
  cloudNote('验证邮件已重新发送，请查收邮箱和垃圾邮件夹。');
}
async function cloudSignIn() {
  const email = q('#cloudEmail').value.trim(), pwd = q('#cloudPassword').value;
  const { error } = await cloudClient.auth.signInWithPassword({ email, password: pwd });
  if (error) return cloudNote(translateCloudError(error.message), true);
  const verified = await refreshCloudAccount();
  if (!verified) return cloudNote('登录凭证已保存，但当前无法验证云端连接；请稍后重试。', true);
  cloudNote('登录成功。负责人首次直接保存，其他协作者请先拉取云端数据。');
}
async function cloudSignOut() {
  await cloudClient.auth.signOut();
  docRevision = 0; cloudBaseData = null;
  await refreshCloudAccount();
  cloudNote('已退出云端账号。');
}
async function requireCloudSession() {
  const session = await refreshCloudAccount();
  if (!session) { cloudNote('请先登录云端协作账号。', true); return null; }
  return session;
}

async function readCloudDocument() {
  return cloudClient.from('carton_documents')
    .select('payload,doc_revision,updated_at')
    .eq('id', 'main')
    .maybeSingle();
}

/* --- 拉取云端数据 --- */
async function pullCloudData() {
  if (!ensureCloudClient()) return cloudNote('云端组件加载失败，请刷新页面后重试。', true);
  if (!await requireCloudSession()) return;
  cloudNote('正在读取云端版本...');
  const { data, error } = await readCloudDocument();
  if (error) return cloudNote(translateCloudError(error.message), true);
  if (!data) return cloudNote('云端尚未建立，请由负责人先保存当前页面。');
  const decision = window.CloudStateGuard?.evaluateCloudPull?.({ baseline: cloudBaseline, remote: data }) || { action: cloudBaseline?.initialized ? 'confirm-required' : 'first-pull' };
  if (decision.action === 'stale-rejected') return cloudNote(云端基线保护说明 + '。云端版本早于当前页面基线，本次未覆盖。', true);
  if (decision.action === 'unavailable') return cloudNote('无法读取云端版本，本次未改变当前页面。', true);
  if (decision.action === 'unchanged') { docRevision = data.doc_revision; return cloudNote('云端与当前页面一致，无需拉取。'); }
  if (!data.payload || !Array.isArray(data.payload.skus) || !data.payload.skus.length) return cloudNote('云端数据结构异常，本次未改变当前页面。', true);
  const ok = decision.action === 'first-pull' || window.confirm('检测到云端第 ' + data.doc_revision + ' 版与当前页面不同。确认后才会应用云端数据，是否继续？');
  if (!ok) return cloudNote('已取消拉取，当前页面未改变。');
  const cloudState = 清理计算缓存(structuredClone(data.payload));
  确保产品池(cloudState);
  window.ProductLifecycle?.hydrateState?.(cloudState.lifecycle || null, cloudState);
  状态 = cloudState;
  草稿状态 = 状态;
  发布状态 = 状态;
  安全保存本地(统一状态保存键, 状态);
  window.ProductLifecycle?.syncData?.(状态);
  docRevision = Number(data.doc_revision) || 0;
  cloudBaseData = structuredClone(cloudState);
  cloudBaseline = window.CloudStateGuard?.createCloudBaseline?.(cloudState, docRevision) || { initialized: true, cloudRevision: docRevision };
  try { localStorage.setItem(CLOUD_BASELINE_KEY, JSON.stringify(cloudBaseline)); } catch (_) {}
  渲染全部();
  cloudNote((decision.action === 'first-pull' ? '已拉取云端最新第 ' : '已确认并应用云端第 ') + docRevision + ' 版。');
}

/* --- 保存至云端 --- */
const cloudSame = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function cloudCopyState(st) {
  // 云端保存只序列化用户当前的主文档；生命周期状态仅由已完成任务事实校正。
  // 不改 SKU 行、门店、柜段、陈列位置或图片。
  const stable = window.ProductLifecycle?.buildPersistenceCopy?.(st) || structuredClone(st);
  return JSON.parse(JSON.stringify(stable));
}

function cloudRevisionConflict() {
  return { code: 'P0001', message: 'CONFLICT: cloud data changed; merge the latest revision first.' };
}

async function saveCloudDocument(payload, expectedRevision) {
  const expected = Math.max(0, Math.trunc(Number(expectedRevision) || 0));
  const nextRevision = expected + 1;
  const updatedAt = new Date().toISOString();
  const { data, error } = await cloudClient
    .from('carton_documents')
    .update({ payload, doc_revision: nextRevision, updated_at: updatedAt })
    .eq('id', 'main')
    .eq('doc_revision', expected)
    .select('doc_revision,updated_at')
    .maybeSingle();
  if (error) return { data: null, error };
  if (data) return { data, error: null };
  if (expected !== 0) return { data: null, error: cloudRevisionConflict() };

  const { data: existing, error: readError } = await cloudClient
    .from('carton_documents')
    .select('doc_revision')
    .eq('id', 'main')
    .maybeSingle();
  if (readError) return { data: null, error: readError };
  if (existing) return { data: null, error: cloudRevisionConflict() };

  const { data: inserted, error: insertError } = await cloudClient
    .from('carton_documents')
    .insert({ id: 'main', payload, doc_revision: 1, updated_at: updatedAt })
    .select('doc_revision,updated_at')
    .single();
  return { data: inserted || null, error: insertError || null };
}

async function pushCloudData() {
  if (!await requireCloudSession()) return;
  if (!cloudBaseline?.initialized) {
    const remote = await readCloudDocument();
    if (remote.error) return cloudNote(translateCloudError(remote.error.message), true);
    if (remote.data) return cloudNote('当前页面尚未拉取云端最新版本，请先点击“拉取云端数据”。', true);
  }
  cloudNote('正在保存至云端...');
  保存();
  const payload = cloudCopyState(状态);
  const lifecycle = window.ProductLifecycle?.getState?.();
  if (lifecycle && !payload.lifecycle) payload.lifecycle = structuredClone(lifecycle);
  确保产品池(payload);
  const expectedRevision = Number(cloudBaseline?.cloudRevision || docRevision || 0);
  const { data, error } = await saveCloudDocument(payload, expectedRevision);
  if (error) { if (error.code === 'P0001') return cloudNote('云端版本已更新，本次没有写入。请先拉取并确认差异。', true); return cloudNote(translateCloudError(error.message), true); }
  const row = Array.isArray(data) ? data[0] : data;
  docRevision = Number(row?.doc_revision || expectedRevision + 1);
  cloudBaseData = structuredClone(payload);
  cloudBaseline = window.CloudStateGuard?.createCloudBaseline?.(payload, docRevision) || { initialized: true, cloudRevision: docRevision };
  try { localStorage.setItem(CLOUD_BASELINE_KEY, JSON.stringify(cloudBaseline)); } catch (_) {}
  安全保存本地(统一状态保存键, 状态);
  window.ProductLifecycle?.syncData?.(状态);
  cloudNote('已保存当前页面至云端第 ' + docRevision + ' 版。');
}

/* --- 冲突自动合并 --- */
function mergeRecord(base, local, remote, label, conflicts) {
  if (cloudSame(local, base)) return remote;
  if (cloudSame(remote, base)) return local;
  if (cloudSame(local, remote)) return local;
  if (!base || !local || !remote || typeof base !== 'object' || Array.isArray(base)) { conflicts.push(label); return remote; }
  const merged = { ...remote };
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    if (k === 'id' || k === 'key' || k === 'store') continue;
    const bv = base[k], lv = local[k], rv = remote[k];
    if (cloudSame(lv, bv)) continue;
    if (cloudSame(rv, bv) || cloudSame(lv, rv)) { merged[k] = lv; continue; }
    conflicts.push(label + '.' + k);
  }
  return merged;
}

function mergeListByKey(baseList, localList, remoteList, keyField, label, conflicts) {
  const idx = list => { const m = new Map(); for (const x of (list || [])) { const k = x[keyField]; if (k != null) m.set(k, x); } return m; };
  const bm = idx(baseList), lm = idx(localList), rm = idx(remoteList);
  const allKeys = [...new Set([...rm.keys(), ...lm.keys()])];
  return allKeys.map(k => {
    const b = bm.get(k), l = lm.get(k), r = rm.get(k);
    if (!l && r) return r;
    if (l && !r) return l;
    if (!l && !r) return null;
    return mergeRecord(b, l, r, label + '#' + k, conflicts);
  }).filter(Boolean);
}

/* --- 事件绑定（延迟等待 DOM 就绪） --- */
(function bindCloudEvents() {
  var tries = 0;
  function tryBind() {
    var cloudBtn = document.getElementById('cloudBtn');
    if (!cloudBtn) { if (++tries < 30) setTimeout(tryBind, 100); return; }
    function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
    on('cloudBtn', function () { document.getElementById('cloudDialog').showModal(); cloudNote(''); withCloudSdk(refreshCloudAccount); });
    on('closeCloudBtn', function () { document.getElementById('cloudDialog').close(); });
    on('cloudSignUpBtn', function(){ withCloudSdk(cloudSignUp); });
    on('cloudResendBtn', function(){ withCloudSdk(cloudResendVerification); });
    on('cloudSignInBtn', function(){ withCloudSdk(cloudSignIn); });
    on('cloudSignOutBtn', function(){ withCloudSdk(cloudSignOut); });
    on('cloudPullBtn', function(){ withCloudSdk(pullCloudData); });
    on('cloudPushBtn', function(){ withCloudSdk(pushCloudData); });
    var dialog = document.getElementById('cloudDialog');
    if (dialog) dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  }
  tryBind();
})();

