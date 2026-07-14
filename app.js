const 初始数据=window.UNIFIED_CARTON_DATA;
const 复核报告=window.UNIFIED_CARTON_REPORT||{};
const 草稿保存键="frozen_carton_unified_scene_draft_v1";
const 发布保存键="frozen_carton_unified_scene_published_v1";
const 数据签名=[初始数据?.meta?.source,初始数据?.meta?.generatedAt,初始数据?.meta?.version].join("|");
const 运营模式密码="5871";
function 清理计算缓存(state){const next=structuredClone(state);for(const r of next.skus||[]){delete r.widthOverride;delete r._baseIncluded;delete r._baseCabinetKey;delete r._baseDisplayCols;delete r._baseFaceWidth;delete r._baseWidth}delete next._baselineReady;return next}
function 清理交互痕迹(state){const next=清理计算缓存(state);for(const r of next.skus||[]){delete r.selected;delete r.modifiedFields;delete r.changeNote}delete next._dataSignature;return next}

function 产品键(r){return String(r?.barcode??"").trim()||String(r?.name??"").trim()}
function 生成产品池(skus=初始数据.skus||[]){const map=new Map();for(const r of skus){const key=产品键(r);if(!key||map.has(key))continue;map.set(key,{id:"pool_"+key,active:true,name:r.name,barcode:r.barcode,grade:r.grade,rank:r.rank,category2:r.category2,category3:r.category3,category4:r.category4,length:r.length,width:r.width,height:r.height,volume:r.volume,carton:r.carton,dailyQty:r.dailyQty,dailySales:r.dailySales,moq:r.moq,moqDays:r.moqDays})}return [...map.values()]}
function 确保产品池(state){if(!state.productPool||!Array.isArray(state.productPool)||!state.productPool.length)state.productPool=生成产品池(state.skus);return state.productPool}
function 产品池有效(){return 确保产品池(状态).filter(p=>p.active!==false)}
function 产品转SKU(p,store){return{id:"poolsku_"+Date.now()+"_"+Math.random().toString(36).slice(2),store,included:true,status:"产品池新增",grade:p.grade||"未评级",rank:数(p.rank)||9999,category2:p.category2||"",category3:p.category3||"",category4:p.category4||"",name:p.name||"新品",barcode:p.barcode||"",length:数(p.length),width:数(p.width),height:数(p.height),volume:数(p.volume)||数(p.length)*数(p.width)*数(p.height)/1e6,carton:Math.max(1,数(p.carton)||1),dailyQty:数(p.dailyQty),dailySales:数(p.dailySales),moq:数(p.moq),moqDays:数(p.moqDays),cabinetKey:"",cabinetLabel:"",position:"",displayCols:1,perCol:1,faceWidth:0,placements:[],customPlacement:true,currentStock:"",planCartons:1,sourceAdvice:"产品池新增",sourceAction:"待排柜",note:"产品池新增"}}

function 初始状态(){const st=清理交互痕迹(初始数据);确保产品池(st);return st}
let 草稿状态=清理计算缓存(读取本地(草稿保存键)||初始状态());
let 发布状态=清理计算缓存(读取本地(发布保存键)||初始状态());
let 状态=发布状态;
let 当前={门店:"",页面:"overview"};
let 同步请求中=false;
const 文=v=>String(v??"").trim();
const 数=v=>{if(typeof v==="number")return Number.isFinite(v)?v:0;
const n=Number(String(v??"").replace(/,/g,"").replace(/[^\d.-]/g,""));
return Number.isFinite(n)?n:0};
const 格=(v,d=1)=>{const n=数(v);
return Number.isFinite(n)?n.toFixed(d).replace(/\.0$/,""):"0"};
const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const 包含=(r,k)=>!k||Object.values(r).some(v=>文(v).includes(k));
const 逃=v=>文(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const 本地保存字段=["included","status","grade","rank","category2","category3","category4","name","barcode","length","width","height","volume","carton","dailyQty","dailySales","moq","moqDays","cabinetKey","cabinetLabel","position","displayCols","perCol","faceWidth","currentStock","planCartons","sourceAdvice","sourceAction","note","customPlacement","placements","modifiedFields","changeNote","selected","rowFull","skuFull","externalOwner","externalCountOverride","staticExternalOverride","avgExternalOverride"];
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
const productPool=确保产品池(state);
return {_patchVersion:2,_dataSignature:数据签名,skus,newSkus,deletedIds,newStores,newCabinets,productPool};
}
function 应用状态补丁(patch){
if(!patch||patch._dataSignature!==数据签名)return null;
if(!patch._patchVersion)return patch;
const state=初始状态();
const del=new Set(patch.deletedIds||[]);
state.skus=(state.skus||[]).filter(r=>!del.has(r.id));
state.stores=[...(state.stores||[]),...(patch.newStores||[])];
state.cabinets=[...(state.cabinets||[]),...(patch.newCabinets||[])];
const map=new Map(state.skus.map(r=>[r.id,r]));
for(const p of patch.skus||[]){const r=map.get(p.id);if(r)Object.assign(r,p.values||{})}
for(const r of patch.newSkus||[])state.skus.push(r);
if(Array.isArray(patch.productPool))state.productPool=patch.productPool;
确保产品池(state);
return state;
}
function 状态可用(st){return !!(st&&st.meta&&Array.isArray(st.stores)&&st.stores.length&&Array.isArray(st.skus)&&st.skus.length&&Array.isArray(st.cabinets)&&st.cabinets.length)}
function 读取本地(key){try{const raw=localStorage.getItem(key);if(!raw)return null;const st=应用状态补丁(JSON.parse(raw));if(!状态可用(st)){localStorage.removeItem(key);console.warn("本地方案无效，已自动恢复初始数据",key);return null}return st}catch(e){console.warn("读取本地方案失败",e);try{localStorage.removeItem(key)}catch(_){}return null}}
function 安全保存本地(key,state){try{localStorage.setItem(key,JSON.stringify(状态补丁(state)));return true}catch(e){console.warn("本地保存失败，已保留当前页面内存状态",e);window.__storageWarnings=(window.__storageWarnings||[]).concat(String(e));return false}}
function 保存草稿(){安全保存本地(草稿保存键,草稿状态)}
function 保存发布(){安全保存本地(发布保存键,发布状态)}function 当前是否运营(){return !!q("#opsMode")?.checked}
function 切换数据源(){状态=当前是否运营()?草稿状态:发布状态}
function 保存(){if(当前是否运营()){草稿状态=状态;保存草稿()}else{发布状态=状态;保存发布()}}
function 门店名(){return 当前.门店||q("#storeSelect").value||状态.stores[0]?.store||""}
function 门店SKU(store=门店名()){return 状态.skus.filter(r=>r.store===store)}
function 纳入SKU(store=门店名()){return 门店SKU(store).filter(r=>r.included)}
function SKU键(r){return 文(r.barcode)||文(r.name)}
function 有效SKU池(){const map=new Map();for(const r of 状态.skus){const key=SKU键(r);if(key&&!map.has(key))map.set(key,r)}return[...map.values()]}
function 门店已纳入键集合(store=门店名()){const set=new Set();for(const r of 纳入SKU(store)){const key=SKU键(r);if(key)set.add(key)}return set}
function 门店未纳入SKU(store=门店名()){const set=门店已纳入键集合(store);return 有效SKU池().filter(r=>!set.has(SKU键(r)))}
function 唯一SKU数(rows){const set=new Set();for(const r of rows){const key=SKU键(r);if(key)set.add(key)}return set.size}
function 分级(g){const t=文(g).toUpperCase();
return t==="A"?"a":t==="B"?"b":t==="C"?"c":t==="D"?"d":""}
function 风险类(v){const t=文(v);
return t.includes("极高")?"risk-top":t.includes("高")?"risk-high":""}
function 等级分(g){return {A:4,B:3,C:2,D:1}[文(g).toUpperCase()]||0}
function 单品体积(r){return 数(r.volume)||数(r.length)*数(r.width)*数(r.height)/1e6}
function 满陈(r){return Math.max(0,Math.round(数(r.displayCols)*数(r.perCol)))}
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
function 柜段使用(){const map=new Map(状态.cabinets.map(c=>[c.key,{...c,used:数(c.sourceUsed),items:[]}]));for(const r of 状态.skus){const changed=!!(r.customPlacement||(r.modifiedFields&&r.modifiedFields.length)||r._baseIncluded!==!!r.included||r._baseCabinetKey!==r.cabinetKey||数(r._baseDisplayCols)!==数(r.displayCols)||数(r._baseFaceWidth)!==数(r.faceWidth));if(!changed)continue;const detail=柜段占用明细(r);for(const [cabKey,delta] of detail){const c=map.get(cabKey);if(c)c.used+=delta}}for(const r of 状态.skus){if(!r.included)continue;const c=map.get(r.cabinetKey);if(c)c.items.push({id:r.id,name:r.name,used:SKU占用宽度(r),cols:数(r.displayCols)})}for(const c of map.values()){c.used=Number(Math.max(0,c.used).toFixed(1));c.left=Number((数(c.length)-c.used).toFixed(1));c.over=c.left<0}return[...map.values()]}function 门店汇总(store){const rows=纳入SKU(store);
const calcs=rows.map(计算SKU);
const ext=calcs.filter(c=>c.external>0);
const skuExternalMap=new Map();
rows.forEach((r,i)=>{const key=SKU键(r);if(!key)return;if(!skuExternalMap.has(key))skuExternalMap.set(key,false);if(calcs[i].external>0)skuExternalMap.set(key,true)});
let directSkuCount=0;let externalSkuCount=0;
skuExternalMap.forEach(v=>{if(v)externalSkuCount++;else directSkuCount++});
const avg=ext.reduce((s,c)=>s+c.avgVol,0);
const storeInfo=状态.stores.find(x=>x.store===store)||{};
const p95=avg*数(storeInfo.p95Factor||状态.params.p95Factor);
const suggested=Math.ceil(p95*数(状态.params.externalSafetyFactor));
const poolCount=有效SKU池().length;
const includedUnique=唯一SKU数(rows);
const missingSkuCount=Math.max(0,poolCount-includedUnique);
return{store,skuCount:includedUnique,rowCount:rows.length,poolCount,includedUnique,missingSkuCount,direct:directSkuCount,extSku:externalSkuCount,directRows:calcs.filter(c=>c.external<=0).length,externalRows:ext.length,staticVol:ext.reduce((s,c)=>s+c.staticVol,0),avgVol:avg,p95,suggested,ok:suggested<=数(状态.params.externalCapL),high:calcs.filter(c=>c.risk==="高风险").length,extreme:calcs.filter(c=>c.risk==="极高风险").length}}
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
function 标记待同步(){const banner=q("#modeBanner");if(banner&&q("#opsMode")?.checked)banner.textContent="有未确认修改：数据已实时联动，可点击“同步至店员端”确认门店执行页展示。"}
function 标记变更(r,字段,原因){r.modifiedFields=Array.from(new Set([...(r.modifiedFields||[]),字段].filter(Boolean)));
r.changeNote=原因||r.changeNote||"手动修改"}
function 变更标签(r){if(!(r.modifiedFields&&r.modifiedFields.length)&&!r.changeNote)return "";
return '<span class="tag risk-high">已修改</span> '+逃(r.changeNote||"")+'：'+逃((r.modifiedFields||[]).join("、"))}
function 完成提示(msg){const banner=q("#modeBanner");if(banner){banner.textContent=msg;banner.classList.remove("sync-flash");void banner.offsetWidth;banner.classList.add("sync-flash")}setTimeout(()=>alert(msg),0)}
function 可编辑文本(v,id,k,cls="w-mid"){return '<input class="'+cls+'" type="text" value="'+逃(v)+'" onchange="改SKU(\''+id+'\',\''+k+'\',this.value)">'}
function 写入SKU不重绘(id,k,v,原因="手动修改"){
const r=状态.skus.find(x=>x.id===id);
if(!r)return false;
if(["displayCols","perCol","faceWidth","currentStock","planCartons","carton","dailyQty","volume","length","width","height"].includes(k))v=数(v);
if(k==="included"||k==="selected")v=!!v;
if(k==="included"&&v===false)当前.建议柜段=r.cabinetKey;
r[k]=v;
if(["cabinetKey","faceWidth","displayCols","perCol"].includes(k)){r.customPlacement=true;delete r.widthOverride}
const 名={included:"纳入状态",selected:"选中标色",cabinetKey:"陈列柜段",displayCols:"陈列列数",perCol:"单列容量",faceWidth:"单列占宽",currentStock:"当前库存",planCartons:"计划补货",name:"商品名称",barcode:"条码",grade:"等级",category3:"三级类目",carton:"箱规",dailyQty:"日销",volume:"体积"}[k]||k;
标记变更(r,名,原因);
保存();
return true;
}
function 提交当前编辑(){
const el=document.activeElement;
if(!el||!el.dataset||!el.dataset.skuId||!el.dataset.skuField)return false;
return 写入SKU不重绘(el.dataset.skuId,el.dataset.skuField,el.value,"同步前提交当前输入");
}
function 请求同步至店员端(e){
if(e){e.preventDefault();e.stopPropagation()}
if(同步请求中)return;
同步请求中=true;
提交当前编辑();
同步至店员端();
setTimeout(()=>同步请求中=false,1200);
}
window.改SKU=(id,k,v)=>{const r=状态.skus.find(x=>x.id===id);
if(!r)return;
if(["displayCols","perCol","faceWidth","currentStock","planCartons","carton","dailyQty","volume","length","width","height"].includes(k))v=数(v);
if(k==="included"||k==="selected")v=!!v;
if(k==="included"&&v===false)当前.建议柜段=r.cabinetKey;
r[k]=v;
if(["cabinetKey","faceWidth","displayCols","perCol"].includes(k)){r.customPlacement=true;delete r.widthOverride}
const 名={included:"纳入状态",selected:"选中标色",cabinetKey:"陈列柜段",displayCols:"陈列列数",perCol:"单列容量",faceWidth:"单列占宽",currentStock:"当前库存",planCartons:"计划补货",name:"商品名称",barcode:"条码",grade:"等级",category3:"三级类目",carton:"箱规",dailyQty:"日销",volume:"体积"}[k]||k;
标记变更(r,名,"手动修改");
保存();
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
function 陈列面方向(r){const f=数(r.faceWidth);const dims=[["长做陈列面",数(r.length)],["宽做陈列面",数(r.width)],["高做陈列面",数(r.height)]].filter(x=>x[1]>0);if(!dims.length||!f)return "";dims.sort((a,b)=>Math.abs(a[1]-f)-Math.abs(b[1]-f));return dims[0][0]}
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
function 柜段内SKU(store,cabKey){return 门店SKU(store).filter(r=>r.included&&r.cabinetKey===cabKey)}
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
function 估算陈列面(r,c){const dims=[数(r.length),数(r.width),数(r.height)].filter(x=>x>0);
return dims.length?Math.min(...dims):0}
function 估算单列容量(r,c){const dims=[{face:数(r.width),depth:数(r.length),h:数(r.height)},{face:数(r.length),depth:数(r.width),h:数(r.height)},{face:数(r.height),depth:数(r.width),h:数(r.length)}].filter(o=>o.face>0&&o.depth<=数(c.depth)&&o.h<=数(c.height));
const best=dims.map(o=>{let per=Math.max(1,Math.floor(数(c.depth)/Math.max(1,o.depth)));
if(!文(c.kind).includes("立柜"))per*=Math.max(1,Math.floor(数(c.height)/Math.max(1,o.h)));
return{...o,per}}).sort((a,b)=>b.per-a.per)[0];
return best?best.per:1}
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
function 刷新柜段下拉(){const store=门店名();
const cabs=柜段使用().filter(c=>c.store===store).sort((a,b)=>b.left-a.left);
q("#suggestCabinet").innerHTML=cabs.map(c=>'<option value="'+逃(c.key)+'">'+逃(c.label+" "+c.position+" 剩余"+格(c.left,0)+"mm")+"</option>").join("");
if(当前.建议柜段&&cabs.some(c=>c.key===当前.建议柜段))q("#suggestCabinet").value=当前.建议柜段}
function 渲染总览(){const rows=全部门店汇总();
const directNoExternal=rows.filter(r=>r.extSku===0&&r.skuCount>0).length;
const maxSug=Math.max(0,...rows.map(r=>r.suggested));
const poolCount=有效SKU池().length;
const totalMissing=rows.reduce((s,r)=>s+r.missingSkuCount,0);
const items=[["门店数",rows.length],["有效SKU池",poolCount],["直接整箱无需外储",directNoExternal],["需配置外储门店",rows.filter(r=>r.extSku>0).length],["未纳入SKU合计",totalMissing,totalMissing?"warning":""],["最大建议外储",格(maxSug,0)+"L",maxSug>754?"danger":""],["超754L门店",rows.filter(r=>!r.ok).length,rows.some(r=>!r.ok)?"danger":""],["高/极高风险",rows.reduce((s,r)=>s+r.high,0)+"/"+rows.reduce((s,r)=>s+r.extreme,0),"warning"]];
q("#metricGrid").innerHTML=items.map(([l,v,c=""])=>'<div class="metric '+c+'"><div class="label">'+l+'</div><div class="value">'+v+"</div></div>").join("");
const kw=文(q("#overviewSearch").value);
表格("#storeRank",[{name:"门店",value:r=>r.store,cls:()=>"name"},{name:"类型",value:r=>r.type},{name:"有效SKU池",value:r=>r.poolCount},{name:"纳入SKU",value:r=>r.skuCount},{name:"未纳入SKU",value:r=>r.missingSkuCount,cls:r=>r.missingSkuCount?"warning":"ok"},{name:"直接整箱到店SKU数",value:r=>r.direct},{name:"需外储SKU数",value:r=>r.extSku},{name:"静态满载L",value:r=>格(r.staticVol)},{name:"动态P95L",value:r=>格(r.p95)},{name:"建议外储L",value:r=>格(r.suggested,0),cls:r=>r.ok?"ok":"bad"},{name:"高风险",value:r=>r.high},{name:"极高风险",value:r=>r.extreme},{name:"冰柜资源",value:r=>"立柜："+(r.vertical||"-")+"；卧柜："+(r.chest||"-")+"；冰淇淋："+(r.ice||"-"),cls:()=>"name"}],rows.filter(r=>包含(r,kw)).sort((a,b)=>b.suggested-a.suggested))}
function 商品列(){return[{name:"商品",value:r=>r.name,cls:()=>"name"},{name:"等级",value:r=>标签(r.grade),html:true},{name:"三级类目",value:r=>r.category3},{name:"场景分区",value:r=>场景分区(r)},{name:"陈列柜",value:r=>柜名(r),cls:()=>"name"},{name:"具体位置",value:r=>柜位(r)},{name:"推荐摆法",value:r=>陈列面方向(r)},{name:"占宽mm",value:r=>格(r.faceWidth,0)},{name:"列数",value:r=>格(r.displayCols,0)},{name:"单列容量",value:r=>格(r.perCol,1)},{name:"满陈",value:r=>计算SKU(r).full},{name:"箱规",value:r=>格(r.carton,0)},{name:"触发库存",value:r=>计算SKU(r).trigger},{name:"可入柜",value:r=>计算SKU(r).receivable},{name:"需外储",value:r=>计算SKU(r).external},{name:"静态外储L",value:r=>格(计算SKU(r).staticVol)},{name:"风险",value:r=>风险标签(计算SKU(r).risk),html:true},{name:"起订量周转",value:r=>r.moqDays?格(r.moqDays):""}]}
function 柜名(r){return 状态.cabinets.find(c=>c.key===r.cabinetKey)?.label||r.cabinetLabel||""}
function 柜位(r){return 状态.cabinets.find(c=>c.key===r.cabinetKey)?.position||r.position||""}
function 渲染门店(){const store=门店名();
const s=门店汇总(store);
q("#storeHeader").innerHTML=[["门店",store],["有效SKU池",s.poolCount],["纳入SKU",s.skuCount],["未纳入SKU",s.missingSkuCount],["直接整箱到店SKU数",s.direct],["需外储SKU数",s.extSku],["动态P95",格(s.p95)+"L"],["建议外储",格(s.suggested,0)+"L"]].map(([a,b])=>'<div class="summary-cell"><span>'+a+"</span><strong>"+b+"</strong></div>").join("");
const kw=文(q("#storeSearch").value);
const includedRows=纳入SKU(store).filter(r=>包含(r,kw));
const allRows=门店SKU(store).filter(r=>包含(r,kw));
if(kw&&includedRows.length===0&&allRows.length>0){q("#storeDetail").innerHTML='<div class="empty">排柜调整中有匹配商品，但当前未纳入门店执行。请到排柜调整查看该商品的“纳入”勾选状态。</div>';
return}表格("#storeDetail",商品列().concat([{name:"补货动作",value:r=>动作文案(r),cls:()=>"name"}]),includedRows)}
function 动作文案(r){const c=计算SKU(r);
return"库存≤"+c.trigger+"件触发；补1箱/"+格(r.carton,0)+"件；可入柜"+格(c.inShelf,0)+"件，进外储"+格(c.external,0)+"件"}
function 渲染商品(){const kw=文(q("#goodsSearch").value),level=文(q("#levelFilter").value);
let rows=状态.skus.filter(r=>!level||r.grade===level).filter(r=>包含(r,kw));
表格("#goodsTable",[{name:"门店",value:r=>r.store}].concat(商品列()),rows)}
function 渲染风险(){const kw=文(q("#riskSearch").value),risk=文(q("#riskFilter").value),store=门店名();
const rows=门店SKU(store).map(r=>({r,c:计算SKU(r)})).filter(x=>x.c.external>0).filter(x=>!risk||x.c.risk===risk).filter(x=>包含(x.r,kw)).sort((a,b)=>b.c.externalDays-a.c.externalDays);
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
const rows=门店SKU(store).filter(r=>包含(r,kw)).filter(r=>!sceneKw||场景分区(r)===sceneKw).filter(r=>陈列筛选命中(r,typeKw,noKw,posKw,cabKw)).map(r=>({...r,__rowClass:r.selected?"selected-row":""}));
表格("#allocationTable",[{name:"标色",value:r=>'<input type="checkbox" '+(r.selected?"checked":"")+' onchange="改SKU(\''+r.id+'\',\'selected\',this.checked)">',html:true},{name:"变更",value:r=>变更标签(r),html:true,cls:()=>"name"},{name:"纳入",value:r=>'<input type="checkbox" '+(r.included?"checked":"")+' onchange="改SKU(\''+r.id+'\',\'included\',this.checked)">',html:true},{name:"商品",value:r=>可编辑文本(r.name,r.id,"name","w-name"),html:true,cls:()=>"name"},{name:"等级",value:r=>可编辑文本(r.grade,r.id,"grade"),html:true},{name:"三级类目",value:r=>可编辑文本(r.category3,r.id,"category3"),html:true},{name:"场景分区",value:r=>场景分区(r)},{name:"条码",value:r=>可编辑文本(r.barcode,r.id,"barcode"),html:true},{name:"箱规",value:r=>输入(r.carton,"改SKU('"+r.id+"','carton',this.value)"),html:true},{name:"日销",value:r=>输入(r.dailyQty,"改SKU('"+r.id+"','dailyQty',this.value)"),html:true},{name:"体积L",value:r=>输入(r.volume,"改SKU('"+r.id+"','volume',this.value)"),html:true},{name:"陈列柜",value:r=>选择柜(r),html:true},{name:"具体位置",value:r=>柜位(r)},{name:"陈列列数（可修改）",value:r=>输入(r.displayCols,"改SKU('"+r.id+"','displayCols',this.value)"),html:true},{name:"单列容量",value:r=>输入(r.perCol,"改SKU('"+r.id+"','perCol',this.value)"),html:true},{name:"单列占宽mm",value:r=>输入(r.faceWidth,"改SKU('"+r.id+"','faceWidth',this.value)"),html:true},{name:"本柜占宽",value:r=>格(本柜占宽(r),0)+"mm"},{name:"总占宽",value:r=>格(SKU占用宽度(r),0)+"mm"},{name:"满陈",value:r=>计算SKU(r).full},{name:"触发库存",value:r=>计算SKU(r).trigger},{name:"需外储",value:r=>计算SKU(r).external},{name:"外储L",value:r=>格(计算SKU(r).staticVol)},{name:"柜段剩余",value:r=>{const c=柜段使用().find(x=>x.key===r.cabinetKey);return c?格(c.left,0)+"mm":""},cls:r=>{const c=柜段使用().find(x=>x.key===r.cabinetKey);return c&&c.left<0?"bad":""}}],rows)}
function 渲染柜段(){const kw=文(q("#cabinetSearch").value);
const store=门店名();
const rows=柜段使用().filter(c=>c.store===store).filter(c=>包含(c,kw));
表格("#cabinetTable",[{name:"柜段",value:c=>c.label+" "+c.position,cls:()=>"name"},{name:"柜型",value:c=>c.kind},{name:"长",value:c=>格(c.length,0)},{name:"深",value:c=>格(c.depth,0)},{name:"高",value:c=>格(c.height,0)},{name:"已用宽度",value:c=>格(c.used,0)},{name:"剩余宽度",value:c=>格(c.left,0),cls:c=>c.left<0?"bad":"ok"},{name:"状态",value:c=>c.over?"超宽":"正常",cls:c=>c.over?"bad":"ok"},{name:"占用SKU",value:c=>c.items.map(x=>x.name+"("+格(x.used,0)+"mm)").join("；"),cls:()=>"name"}],rows)}
function 渲染建议(){刷新柜段下拉();
const cabs=柜段使用().filter(c=>c.store===门店名());
const target=柜段使用().find(c=>c.key===q("#suggestCabinet").value)||cabs[0];
if(!target){q("#expandSuggestions").innerHTML='<div class="empty">没有可用柜段</div>';
return}
const plans=生成空位方案(target).slice(0,30);
window.空位方案缓存={};
plans.forEach((p,i)=>window.空位方案缓存["v"+i]=p);
表格("#expandSuggestions",[{name:"商品",value:p=>p.r.name,cls:()=>"name"},{name:"方案",value:p=>p.type},{name:"目标空位",value:p=>p.targetCab.label+" "+p.targetCab.position,cls:()=>"name"},{name:"原位置",value:p=>柜名(p.r)+" "+柜位(p.r),cls:()=>"name"},{name:"柜别",value:p=>是否冰品柜段(p.targetCab)?"雪糕冰品":"普通冻品"},{name:"等级",value:p=>标签(p.r.grade),html:true},{name:"日销",value:p=>格(p.r.dailyQty,3)},{name:"目标剩余",value:p=>格(p.targetCab.left,0)+"mm"},{name:"目标占宽",value:p=>格(p.targetWidth,0)+"mm"},{name:"满陈变化",value:p=>p.old.full+"→"+p.after.full},{name:"外储变化",value:p=>p.old.external+"→"+p.after.external},{name:"调整说明",value:p=>p.note,cls:()=>"name"},{name:"操作",value:(p,i)=>'<button onclick="应用空位方案(\'v'+i+'\')">应用方案</button>',html:true}],plans,"当前目标柜段没有满足条件的空位方案：需同柜别、A/B/C等级、目标空位可承接，且应用后不超宽。")}

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
function 严格复核新增门店(pre){const errors=[];const warnings=[];const summary=新店汇总(pre);const cabs=pre.cabinets.map(c=>({...c,left:数(c.sourceLeft),used:数(c.sourceUsed),over:数(c.sourceLeft)<-0.001}));if(summary.suggested>数(状态.params.externalCapL))errors.push('建议外储容量 '+summary.suggested+'L 超过 '+状态.params.externalCapL+'L');const over=cabs.filter(c=>c.over);if(over.length)errors.push('柜段超宽 '+over.length+' 个');const layer6Used=cabs.filter(c=>/立柜/.test(c.kind)&&/第6层/.test(c.position)&&数(c.sourceUsed)>0);if(layer6Used.length)errors.push('立柜第6层参与陈列 '+layer6Used.length+' 个');const iceWrong=pre.included.filter(r=>是否冰品SKU(r)!==是否冰品柜段(pre.cabinets.find(c=>c.key===r.cabinetKey)||{}));if(iceWrong.length)errors.push('冰品/非冰品柜别错误 '+iceWrong.length+' 个');const split=new Map();for(const r of pre.included){const cab=pre.cabinets.find(c=>c.key===r.cabinetKey)||{};const kind=是否冰品柜段(cab)?'冰淇淋柜':(/立柜/.test(cab.kind||cab.label)?'立柜':'卧柜');const k=pre.store+'|'+SKU键(r)+'|'+kind;if(!split.has(k))split.set(k,new Set());split.get(k).add((cab.label||r.cabinetLabel||'')+' '+(cab.position||r.position||''))}const splitBad=[...split.values()].filter(v=>v.size>1).length;if(splitBad)errors.push('同SKU同柜型拆分 '+splitBad+' 个');const ordinaryLarge=cabs.filter(c=>!是否冰品柜段(c)&&数(c.left)>300);if(ordinaryLarge.length)warnings.push('普通柜段剩余大于300mm '+ordinaryLarge.length+' 个，请人工关注是否还有可补位商品');if(pre.missing.length&&ordinaryLarge.length)errors.push('存在未纳入SKU且普通柜段仍有大余量，需要继续调柜');return{ok:errors.length===0,errors,warnings,summary}}function 预排新增门店(store,type,cabs){const use=cabs.map(c=>({...c,used:0,left:数(c.length),items:[]}));const skus=[];const missing=[];const pool=新店SKU池().sort((a,b)=>新店场景排序值(a)-新店场景排序值(b)||文(a.category4).localeCompare(文(b.category4),'zh-CN')||数(a.rank)-数(b.rank));const chooseCab=(sku)=>{const ice=是否冰品SKU(sku);const candidates=use.filter(c=>是否冰品柜段(c)===ice).sort((a,b)=>新店柜段排序值(a)-新店柜段排序值(b)||文(a.label).localeCompare(文(b.label),'zh-CN')||文(a.position).localeCompare(文(b.position),'zh-CN'));let best=null;for(const c of candidates){const face=估算陈列面(sku,c),per=估算单列容量(sku,c);if(face>0&&per>0&&face<=c.left+0.001){const cat4Same=c.items.some(x=>文(x.category4)&&文(x.category4)===文(sku.category4));const sceneSame=c.items.some(x=>场景分区(x)===场景分区(sku));const empty=c.items.length?0:1;const score=(cat4Same?100000:0)+(sceneSame?20000:0)+empty*3000+等级分(sku.grade)*500+数(sku.dailyQty)*100-数(sku.rank)-数(c.left)/10;if(!best||score>best.score)best={c,face,per,score}}}return best};for(const base of pool){const pick=chooseCab(base);if(!pick){missing.push(base);continue}const r={...base,id:'new_sku_'+skus.length+'_'+(文(base.barcode)||文(base.name)),store,included:true,status:'新增门店严格测算-纳入',cabinetKey:pick.c.key,cabinetLabel:pick.c.label,position:pick.c.position,displayCols:1,perCol:pick.per,faceWidth:pick.face,placements:[],customPlacement:false,currentStock:'',planCartons:1,sourceAdvice:'新增门店严格测算',sourceAction:'严格测算纳入',note:'新增门店严格测算生成',cabinetTypeFilter:pick.c.kind,cabinetNoFilter:pick.c.label,positionFilter:pick.c.position};skus.push(r);pick.c.used+=SKU占用宽度(r);pick.c.left=Number((数(pick.c.length)-pick.c.used).toFixed(1));pick.c.items.push(r)}严格扩陈新增门店(use,skus);const missRows=missing.map((base,i)=>({...base,id:'new_missing_'+i+'_'+(文(base.barcode)||文(base.name)),store,included:false,status:'新增门店严格测算-未纳入',cabinetKey:'',cabinetLabel:'',position:'',displayCols:0,perCol:0,faceWidth:0,placements:[],customPlacement:false,sourceAdvice:'新增门店严格测算',sourceAction:'空间不足未纳入',note:'新增门店严格测算未排入'}));const pre={store,type,cabinets:use,skus:[...skus,...missRows],included:skus,missing:missRows,strict:true,validation:null};pre.validation=严格复核新增门店(pre);return pre}function 新店汇总(pre){const old={stores:状态.stores,cabinets:状态.cabinets,skus:状态.skus};状态.stores=[...状态.stores,{store:pre.store,type:pre.type}];状态.cabinets=[...状态.cabinets,...pre.cabinets];状态.skus=[...状态.skus,...pre.skus];const s=门店汇总(pre.store);状态.stores=old.stores;状态.cabinets=old.cabinets;状态.skus=old.skus;return s}
function 渲染新增门店(){if(!q("#newStoreSummary"))return;const pre=window.新增门店测算缓存;if(!pre){q("#newStoreSummary").innerHTML="";q("#newStoreCabinetPreview").innerHTML='<div class="empty">请先录入门店名称和冰柜配置后测算。</div>';q("#newStoreSkuPreview").innerHTML='<div class="empty">暂无严格测算结果。</div>';return}const s=新店汇总(pre);const v=pre.validation||严格复核新增门店(pre);const status=v.ok?"通过":"不通过";q("#newStoreSummary").innerHTML=[["纳入SKU",s.skuCount],["未纳入SKU",s.missingSkuCount],["直接整箱到店SKU数",s.direct],["需外储SKU数",s.extSku],["建议外储",格(s.suggested,0)+"L"],["严格复核",status]].map(([a,b])=>'<div class="metric '+(a.includes("复核")&&!v.ok?"danger":a.includes("复核")?"":"")+'"><div class="label">'+a+'</div><div class="value">'+b+'</div></div>').join("")+(v.errors.length||v.warnings.length?'<div class="help strict-check"><strong>严格复核说明：</strong>'+[...v.errors.map(x=>"错误："+x),...v.warnings.map(x=>"提示："+x)].map(逃).join("；")+'</div>':'<div class="help strict-check"><strong>严格复核通过：</strong>柜段不超宽、外储不超754L、立柜第6层未参与陈列、冰品/非冰品柜别正确。</div>');表格("#newStoreCabinetPreview",[{name:"冰柜类型",value:c=>c.kind},{name:"陈列柜",value:c=>c.label,cls:()=>"name"},{name:"具体位置",value:c=>c.position},{name:"长",value:c=>格(c.length,0)},{name:"深",value:c=>格(c.depth,0)},{name:"高",value:c=>格(c.height,0)},{name:"已用",value:c=>格(c.sourceUsed,0)},{name:"剩余",value:c=>格(c.sourceLeft,0),cls:c=>c.sourceLeft<0?"bad":c.sourceLeft>300?"warn":"ok"},{name:"SKU数",value:c=>c.items?.length||0}],pre.cabinets);表格("#newStoreSkuPreview",商品列(),pre.included.slice(0,160),"没有纳入SKU")}
window.测算新增门店=()=>{const store=文(q("#newStoreName")?.value);const type=文(q("#newStoreType")?.value)||"新店";const txt=文(q("#newStoreCabinetConfig")?.value);if(!store){alert("请填写门店名称");return}if(状态.stores.some(s=>s.store===store)){alert("门店已存在，请换一个新门店名称");return}const parsed=解析新增门店柜段(store,txt);if(parsed.errors.length){alert("冰柜配置存在无法识别的行：\n"+parsed.errors.join("\n"));return}if(!parsed.cabs.length){alert("请至少录入一个冰柜配置");return}window.新增门店测算缓存=预排新增门店(store,type,parsed.cabs);渲染新增门店();完成提示("新增门店严格测算完成：请先查看严格复核说明，复核通过后才可追加为运营草稿。")}
window.追加新增门店=()=>{const pre=window.新增门店测算缓存;if(!pre){alert("请先测算新增门店");return}if(状态.stores.some(s=>s.store===pre.store)){alert("门店已存在，不能重复追加");return}const v=pre.validation||严格复核新增门店(pre);if(!v.ok){alert("严格复核不通过，不能追加：\\n"+v.errors.join("\\n"));return}状态.stores.push({store:pre.store,type:pre.type,vertical:pre.cabinets.filter(c=>c.kind==="立柜").length?"自定义":"",chest:pre.cabinets.filter(c=>c.kind==="卧柜").length?"自定义":"",ice:pre.cabinets.filter(c=>c.kind.includes("冰淇淋")).length?"自定义":""});状态.cabinets.push(...pre.cabinets.map(c=>{const x={...c};delete x.items;delete x.used;delete x.left;return x}));状态.skus.push(...pre.skus);当前.门店=pre.store;保存();渲染全部();切换("store");完成提示("新增门店已追加到运营草稿。请复核门店执行和柜段余量后，再点击同步并退出到店员端。")}


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
function 陈列图商品标签(r){const c=计算SKU(r);return 逃(r.name)+' <small>'+格(r.displayCols,0)+'列 / 满陈'+格(c.full,0)+'件</small>'}
function 陈列图商品样式(r){const w=Math.max(70,Math.min(260,数(SKU占用宽度(r))*0.45));return 'background:'+陈列图颜色(场景分区(r))+';flex:0 0 '+格(w,0)+'px'}
function 绑定陈列图拖拽(){
if(!当前是否运营())return;
qa('.map-layer[data-cab-key]').forEach(layer=>{
layer.draggable=true;
layer.addEventListener('dragstart',e=>{
e.dataTransfer.setData('text/plain',layer.dataset.cabKey);
layer.classList.add('dragging')
});
layer.addEventListener('dragend',()=>layer.classList.remove('dragging'));
layer.addEventListener('dragover',e=>e.preventDefault());
layer.addEventListener('drop',e=>{
e.preventDefault();
const sourceKey=e.dataTransfer.getData('text/plain');
移动陈列图整层(sourceKey,layer.dataset.cabKey)
})
})
}
function 移动陈列图整层(sourceKey,targetKey){
const source=状态.cabinets.find(c=>c.key===sourceKey);
const target=柜段使用().find(c=>c.key===targetKey);
if(!source||!target)return;
if(sourceKey===targetKey){完成提示('陈列图同步完成：层位没有变化。');return}
if(source.store!==target.store||冰柜类型(source)!==冰柜类型(target)||文(source.label)!==文(target.label)){
alert('只能在同一陈列柜内整层移动，已拦截。');
return
}
const sourceRows=状态.skus.filter(r=>r.included&&r.cabinetKey===sourceKey);
const targetRows=状态.skus.filter(r=>r.included&&r.cabinetKey===targetKey);
for(const r of sourceRows){
r.cabinetKey=targetKey;
r.cabinetLabel=target.label;
r.position=target.position;
r.customPlacement=true;
标记变更(r,'陈列柜段','陈列图整层移动')
}
for(const r of targetRows){
r.cabinetKey=sourceKey;
r.cabinetLabel=source.label;
r.position=source.position;
r.customPlacement=true;
标记变更(r,'陈列柜段','陈列图整层移动')
}
保存();
渲染全部();
完成提示('陈列图同步完成：已按整层交换，门店执行和柜段余量已联动。')
}
function 渲染陈列图(){
if(!q('#displayMapCanvas'))return;
const store=门店名();
const rows=纳入SKU(store);
const cabs=状态.cabinets.filter(c=>c.store===store);
const byLabel=new Map();
for(const c of cabs){if(!byLabel.has(c.label))byLabel.set(c.label,[]);byLabel.get(c.label).push(c)}
let html='<div class="map-store-title">'+逃(store)+'</div>';
for(const [label,segments] of byLabel){
const kind=文(segments[0]?.kind);
html+='<div class="map-cabinet"><h3>'+逃(label)+' <span>'+逃(kind)+'</span></h3><div class="map-grid '+(kind.includes("立柜")?"vertical":"chest")+'">';
if(kind.includes("立柜")){
for(let i=1;i<=6;i++){
const pos='第'+i+'层';
const seg=segments.find(c=>c.position===pos);
const items=i===6?[]:rows.filter(r=>柜名(r)===label&&柜位(r)===pos);
const layerClass='map-layer'+(i===6?' storage-true':'');
html+='<div class="'+layerClass+'"'+(seg&&i!==6?' data-cab-key="'+逃(seg.key)+'" title="拖动整层进行交换"':'')+'><b>'+pos+(i===6?' 存储位':'')+'</b><div>';
if(i===6){html+='<span class="map-item storage">存储位，不陈列SKU</span>'}
else{html+=items.map(r=>'<span class="map-item" style="'+陈列图商品样式(r)+'">'+陈列图商品标签(r)+'</span>').join('')||'<span class="map-empty">空</span>'}
html+='</div></div>'
}
}else{
for(const seg of segments.sort((a,b)=>文(a.position).localeCompare(文(b.position),'zh-CN'))){
const items=rows.filter(r=>柜名(r)===label&&柜位(r)===seg.position);
html+='<div class="map-layer" data-cab-key="'+逃(seg.key)+'" title="拖动整层进行交换"><b>'+逃(seg.position)+'</b><div>'+(items.map(r=>'<span class="map-item" style="'+陈列图商品样式(r)+'">'+陈列图商品标签(r)+'</span>').join('')||'<span class="map-empty">空</span>')+'</div></div>'
}
}
html+='</div></div>'
}
q('#displayMapCanvas').innerHTML=html;
绑定陈列图拖拽()
}
function 导出陈列图(){
const el=q("#displayMapCanvas");
if(!el||!el.innerText.trim()){alert("请先生成陈列图");return}
const width=Math.max(1200,Math.ceil(el.scrollWidth||el.clientWidth||1200));
const height=Math.max(1200,Math.ceil(el.scrollHeight||el.clientHeight||1200));
const style='<style>body{margin:0;font-family:Microsoft YaHei,Arial,sans-serif;background:#fff}.map-store-title{font-size:20px;font-weight:900;margin:0 0 8px}.map-cabinet{border:1px solid #ccc;margin:10px;padding:10px;border-radius:8px;background:#fff}.map-cabinet h3{display:flex;justify-content:space-between;gap:8px;margin:0 0 10px}.map-cabinet h3 span{font-size:12px;color:#666}.map-grid{display:grid;gap:8px}.map-grid.vertical{grid-template-columns:1fr}.map-grid.chest{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.map-layer{border:1px solid #ddd;margin:6px 0;padding:8px;border-radius:6px;background:#fdfdfd;min-height:56px}.map-layer b{display:block;margin-bottom:6px;color:#34423d}.map-item{display:inline-flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;margin:3px 4px 3px 0;padding:5px 7px;border-radius:5px;border:1px solid rgba(0,0,0,.08);font-size:12px;line-height:1.35;white-space:normal;word-break:break-all}.map-item small{display:block;font-size:11px;color:#33423d;font-weight:700;margin-top:2px}.map-item.storage{background:#e5e7eb}.map-empty{color:#9ca3af}</style>';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:'+width+'px;height:'+height+'px;overflow:visible;">'+style+el.outerHTML+'</div></foreignObject></svg>';
导出("门店陈列图_"+门店名()+".svg",svg,"image/svg+xml;charset=utf-8");
完成提示("陈列图已导出为图片文件。")
}
function 清空新品试算(){["newSkuName","newSkuBarcode","newSkuGrade","newSkuCategory","newSkuLength","newSkuWidth","newSkuHeight","newSkuVolume","newSkuCarton","newSkuDaily","newSkuCols","newSkuPerCol"].forEach(id=>{const el=q("#"+id);if(!el)return;el.value=""});const grade=q("#newSkuGrade");if(grade)grade.value="A";const carton=q("#newSkuCarton");if(carton)carton.value="1";const daily=q("#newSkuDaily");if(daily)daily.value="0";const cols=q("#newSkuCols");if(cols)cols.value="1";const box=q("#newSkuPositionSuggestions");if(box)box.innerHTML='<div class="empty">新品试算区已清空，请重新填写新品尺寸后试算。</div>';window.新品试算方案缓存={}}function 渲染逻辑(){q("#logicRules").innerHTML=(状态.rules.length?状态.rules.map(r=>"<p>"+Object.values(r).filter(Boolean).map(逃).join("：")+"</p>").join(""):"<p>当前版本采用10%触发，外储容量上限754L。</p>")}
function 切换(id){当前.页面=id;
qa(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
qa(".view").forEach(v=>v.classList.toggle("active",v.id===id));
渲染全部()}
function 渲染全部(){切换数据源();建立基准(状态);选项初始化();
const isOps=q("#opsMode").checked;
document.body.classList.toggle("ops",isOps);
const opsViews=new Set(["replenish","allocation","cabinets","suggestions","newstore","productpool","io"]);
if(!isOps&&opsViews.has(当前.页面)){当前.页面="store"}
const banner=q("#modeBanner");
if(banner)banner.textContent=isOps?"当前为运营模式：排柜调整、补货测算、柜段余量、空位建议可编辑；点击“同步至店员端”后，门店执行页按当前方案展示。":"";
const 当前版本=window.UNIFIED_CARTON_VERSION||{};const 当前报告=window.UNIFIED_CARTON_REPORT||{};q("#dataNote").textContent=(状态.meta.version||"10%触发")+"｜底表："+(当前版本.sourceName||状态.meta.source||"当前版")+"｜"+(当前报告.passed===false?"复核失败":"复核通过")+"｜生成："+(状态.meta.generatedAt||当前版本.generatedAt||"");
渲染总览();
渲染门店();
渲染商品();
渲染风险();
渲染补货();
渲染排柜();
渲染柜段();
渲染建议();
渲染产品池();
渲染陈列图();
if(当前.页面==="newstore")渲染新增门店();
渲染逻辑();
qa(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.view===当前.页面));
qa(".view").forEach(v=>v.classList.toggle("active",v.id===当前.页面))}
function 退出运营到店员端(msg="已退出运营模式，当前为绿色店员端视图。"){
const ops=q("#opsMode");
if(ops)ops.checked=false;
document.body.classList.remove("ops");
状态=发布状态;
当前.页面="store";
渲染全部();
const banner=q("#modeBanner");
if(banner){banner.textContent=msg;banner.classList.remove("sync-flash");void banner.offsetWidth;banner.classList.add("sync-flash")}
qa(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.view===当前.页面));
qa(".view").forEach(v=>v.classList.toggle("active",v.id===当前.页面));
}
function 执行同步至店员端(){
// 这里必须发布“运营草稿”，然后立刻切换到非运营绿色店员端；不能只刷新运营模式下的门店执行页。
草稿状态=structuredClone(状态);
建立基准(草稿状态);
保存草稿();
发布状态=structuredClone(草稿状态);
建立基准(发布状态);
保存发布();
退出运营到店员端("同步完成：已发布到非运营模式的绿色店员端，当前页面就是店员看到的数据。");
const btn=q("#syncStoreViewBtn");
if(btn){btn.textContent="已同步";setTimeout(()=>btn.textContent="同步并退出到店员端",1200)}
完成提示("同步完成：店员端已更新为当前运营方案，并自动退出到绿色店员端。")
}
function 同步至店员端(){
提交当前编辑();
if(document.activeElement&&typeof document.activeElement.blur==="function")document.activeElement.blur();
setTimeout(()=>执行同步至店员端(),0);
}function 导出(name,content,type){const b=new Blob([content],{type});
const a=document.createElement("a");
a.href=URL.createObjectURL(b);
a.download=name;
a.click();
URL.revokeObjectURL(a.href)}function 校验运营密码(){return new Promise(resolve=>{let mask=q("#opsPasswordMask");if(mask)mask.remove();mask=document.createElement("div");mask.id="opsPasswordMask";mask.className="ops-password-mask";mask.innerHTML='<div class="ops-password-box"><h3>进入运营模式</h3><p>请输入运营密码</p><input id="opsPasswordInput" type="password" autocomplete="current-password" placeholder="运营密码"><div class="ops-password-actions"><button id="opsPasswordCancel" type="button">取消</button><button id="opsPasswordOk" type="button">确认</button></div><div id="opsPasswordError" class="ops-password-error"></div></div>';document.body.appendChild(mask);const input=q("#opsPasswordInput"),err=q("#opsPasswordError");const close=ok=>{mask.remove();resolve(ok)};q("#opsPasswordCancel").onclick=()=>close(false);q("#opsPasswordOk").onclick=()=>{if(input.value===运营模式密码)close(true);else{err.textContent="密码不正确";input.value="";input.focus()}};input.onkeydown=e=>{if(e.key==="Enter")q("#opsPasswordOk").click();if(e.key==="Escape")close(false)};setTimeout(()=>input.focus(),0)})}
q("#storeSelect").onchange=e=>{当前.门店=e.target.value;
渲染全部()};
q("#opsMode").onchange=async e=>{if(e.target.checked){e.target.checked=false;document.body.classList.remove("ops");渲染全部();const ok=await 校验运营密码();if(!ok){document.body.classList.remove("ops");渲染全部();return}e.target.checked=true}else{e.target.checked=false}渲染全部()};
qa(".tabs button").forEach(b=>b.onclick=()=>切换(b.dataset.view));
["overviewSearch","storeSearch","goodsSearch","riskSearch","replenishSearch","cabinetSearch","currentExternalL","levelFilter","riskFilter","suggestCabinet","allocationSearch","allocationCabinetSearch","allocationTypeFilter","allocationCabNoFilter","allocationPosFilter","allocationSceneFilter","poolSearch"].forEach(id=>{const el=q("#"+id);
if(el)el.addEventListener("input",渲染全部),el.addEventListener("change",渲染全部)});
q("#manualAddSkuBtn").onclick=()=>手动新增SKU();
if(q("#trialNewSkuBtn"))q("#trialNewSkuBtn").onclick=()=>试算新品位置();
if(q("#allStoreTrialBtn"))q("#allStoreTrialBtn").onclick=()=>试算全店上新();
if(q("#applyAllStoreSkuBtn"))q("#applyAllStoreSkuBtn").onclick=()=>应用全店上新();
if(q("#addPoolSkuBtn"))q("#addPoolSkuBtn").onclick=()=>{确保产品池(状态).push(标准产品池对象({name:"新增SKU-请修改",grade:"未评级",category3:"待填写",category4:"待填写",carton:1,daily:0,active:true}));保存();渲染全部();完成提示("产品池新增完成：已添加一条空白SKU，请补全商品资料。")};
if(q("#importPoolBtn"))q("#importPoolBtn").onclick=()=>导入产品池文本();
if(q("#deleteDisabledPoolBtn"))q("#deleteDisabledPoolBtn").onclick=()=>{const pool=确保产品池(状态);const before=pool.length;状态.productPool=pool.filter(p=>p.active!==false);const removed=before-状态.productPool.length;保存();渲染全部();完成提示(removed>0?"删除完成：已清理未启用SKU "+removed+" 条。":"删除完成：当前没有未启用SKU可清理。")};
if(q("#loadStoreExampleBtn"))q("#loadStoreExampleBtn").onclick=()=>{const box=q("#newStoreCabinetConfig");if(box){box.value="卧柜,2500mm,3,1988*697*459+360*697*199\n卧柜,2000mm,1,1488*697*459+360*697*199\n冰淇淋柜,1900mm,1,1386*697.5*424+325*697.5*164\n立柜,3m,1,门数=4,层数=6,710*534*250"}完成提示("示例已填入：立柜会按1-5层陈列，第6层仅作为陈列图存储位。")};
if(q("#trialStoreBtn"))q("#trialStoreBtn").onclick=()=>测算新增门店();
if(q("#applyStoreBtn"))q("#applyStoreBtn").onclick=()=>追加新增门店();
if(q("#syncDisplayMapBtn"))q("#syncDisplayMapBtn").onclick=()=>{渲染陈列图();完成提示("陈列图同步完成：已刷新当前门店的整层陈列图。")};
if(q("#exportDisplayMapBtn"))q("#exportDisplayMapBtn").onclick=()=>导出陈列图();
if(q("#syncStoreViewBtn")){q("#syncStoreViewBtn").onmousedown=e=>请求同步至店员端(e);q("#syncStoreViewBtn").onclick=e=>请求同步至店员端(e)}
q("#resetFilterBtn").onclick=()=>{["overviewSearch","storeSearch","goodsSearch","riskSearch","replenishSearch","cabinetSearch","allocationSearch","allocationCabinetSearch","allocationTypeFilter","allocationCabNoFilter","allocationPosFilter","allocationSceneFilter"].forEach(id=>{const el=q("#"+id);if(el)el.value=""});清空新品试算();window.全店上新缓存={};window.新增门店测算缓存=null;渲染全部();完成提示("筛选已重置：搜索条件、新品试算、全店上新方案和新增门店草稿已清空。")};
q("#removeExcludedBtn").onclick=()=>{const before=状态.skus.length;const beforeCurrent=门店SKU().length;状态.skus=状态.skus.filter(r=>r.included);const removed=before-状态.skus.length;const removedCurrent=beforeCurrent-门店SKU().length;保存();渲染全部();完成提示(removed>0?"删除完成：已删除未纳入SKU "+removed+" 行，其中当前门店 "+removedCurrent+" 行。":"删除完成：当前没有未纳入SKU可删除。")};

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
q("#restoreBtn").onclick=()=>{if(confirm("确认恢复初始数据？当前本地修改会被清空。")){localStorage.removeItem(草稿保存键);localStorage.removeItem(发布保存键);草稿状态=初始状态();发布状态=初始状态();
建立基准(草稿状态);建立基准(发布状态);const ops=q("#opsMode");if(ops)ops.checked=false;document.body.classList.remove("ops");状态=发布状态;当前.页面="store";清空新品试算();window.全店上新缓存={};window.新增门店测算缓存=null;渲染全部();完成提示("恢复完成：已清除本地修改、产品池临时导入、新门店草稿、新品全店方案、标色和同步草稿，并退出到绿色店员端。")}};

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
  pre.validation=严格复核新增门店(pre);
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
const 原预排新增门店_严格版=预排新增门店;
预排新增门店=function(store,type,cabs){
  const pre=原预排新增门店_严格版(store,type,cabs);
  新店压缩到可执行(pre);
  return pre;
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
  const rows=pre.skus.filter(r=>r.included).slice(0,220);
  表格('#newStoreSkuPreview',[{name:'纳入',value:r=>'<input type="checkbox" '+(r.included?'checked':'')+' onchange="改新增门店SKU(\''+r.id+'\',\'included\',this.checked)">',html:true},{name:'商品',value:r=>r.name,cls:()=> 'name'},{name:'等级',value:r=>标签(r.grade),html:true},{name:'四级类目',value:r=>r.category4||r.category3},{name:'陈列柜',value:r=>柜名(r)||r.cabinetLabel,cls:()=> 'name'},{name:'具体位置',value:r=>柜位(r)||r.position},{name:'陈列列数',value:r=>输入(r.displayCols,"改新增门店SKU('"+r.id+"','displayCols',this.value)"),html:true},{name:'单列容量',value:r=>输入(r.perCol,"改新增门店SKU('"+r.id+"','perCol',this.value)"),html:true},{name:'单列占宽mm',value:r=>输入(r.faceWidth,"改新增门店SKU('"+r.id+"','faceWidth',this.value)"),html:true},{name:'总占宽',value:r=>格(SKU占用宽度(r),0)+'mm'},{name:'满陈',value:r=>计算SKU(r).full},{name:'箱规',value:r=>r.carton},{name:'需外储',value:r=>计算SKU(r).external},{name:'外储L',value:r=>格(计算SKU(r).staticVol)}],rows,'没有纳入SKU');
}
建立基准(草稿状态);建立基准(发布状态);

if(q("#opsMode"))q("#opsMode").checked=false; // 初始强制店员模式，密码通过前不显示运营端
渲染全部();

























