import { DRAFT_STORAGE_KEY, normalizeActiveProductPool, replanAllStores } from './product-pool-replan-core.mjs';
import { applyReplanPatch, buildCompactAppDraftPatch, replanSelectedStores } from './product-pool-replan-ops.mjs';
import { prepareReplanSource } from './replan-baseline.mjs';
import { prepareBusinessOptimizedSeed } from './replan-business-optimizer.mjs';
import { downloadProductPool, downloadFormalWorkbook } from './replan-workbook.mjs';

const REVIEW_MARKER='frozen_carton_open_replan_review_v1';
const REVIEW_STORE_MARKER='frozen_carton_open_replan_review_store_v1';
const text=v=>String(v??'').trim();
const clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
const base=window.UNIFIED_CARTON_DATA;
const signature=[base?.meta?.source,base?.meta?.generatedAt,base?.meta?.version].join('|');
let latestResult=null;
let latestTargetStore='';

function setStatus(message,type='normal'){
  const el=document.getElementById('productPoolReplanStatus');
  if(!el)return;
  el.textContent=message;
  el.dataset.type=type;
  el.style.color=type==='error'?'#b42318':type==='ok'?'#167a5a':'#52615b';
}

function readPatch(){
  try{
    const raw=localStorage.getItem(DRAFT_STORAGE_KEY); if(!raw)return null;
    const patch=JSON.parse(raw);
    if(!patch||patch._dataSignature!==signature)return null;
    return patch;
  }catch(err){console.warn('读取产品池重排草稿失败',err);return null}
}
function currentData(){const patch=readPatch();return patch?applyReplanPatch(base,patch):clone(base)}
function activeProducts(){
  const lifecycle=window.ProductLifecycle?.getActiveProducts?.();
  const source=Array.isArray(lifecycle)&&lifecycle.length?lifecycle:(currentData().productPool||[]);
  return normalizeActiveProductPool(source);
}
function currentLifecycle(){return window.ProductLifecycle?.getState?.()||currentData().lifecycle||null}
function availableStores(){
  const data=currentData();
  const names=new Set((data.stores||[]).map(s=>text(s.store)).filter(Boolean));
  for(const c of data.cabinets||[])if(text(c.store))names.add(text(c.store));
  return [...names].sort((a,b)=>a.localeCompare(b,'zh-CN'));
}

function populateStoreSelect(){
  const select=document.getElementById('productPoolReplanStoreSelect');
  if(!select)return;
  const previous=select.value;
  select.innerHTML='<option value="">请选择门店</option>';
  for(const store of availableStores()){
    const option=document.createElement('option');
    option.value=store; option.textContent=store; select.appendChild(option);
  }
  if(previous&&[...select.options].some(o=>o.value===previous))select.value=previous;
}

function injectPanel(){
  const host=document.querySelector('#io .panel')||document.getElementById('io');
  if(!host||document.getElementById('productPoolReplanPanel'))return;
  const panel=document.createElement('section');
  panel.id='productPoolReplanPanel';
  panel.className='panel';
  panel.style.marginTop='18px';
  panel.innerHTML=`
    <div class="panel-title"><div><h2>产品池重排</h2><p>统一处理产品池变化和新增门店。立柜柜1-4第1-5层均参与冻品排柜，第6层为存储位。</p></div></div>
    <div class="help">流程：完成上新/淘汰 → 导出当前产品池 → 全部门店或指定门店重新排柜 → 人工复核 → 导出最新版底表。已有门店始终以正式方案作为重排基准；新店先按SKU覆盖优先、冰品物理容量、余量扩陈和外储优化生成业务种子，再由同一严格排柜引擎复核。</div>
    <div class="toolbar" style="padding:16px 20px;gap:10px;flex-wrap:wrap;align-items:center">
      <button id="exportCurrentProductPoolBtn" type="button">导出当前产品池</button>
      <button id="runProductPoolReplanBtn" type="button">全部门店重新排柜</button>
      <select id="productPoolReplanStoreSelect" aria-label="选择需要重排的门店" style="min-width:220px;padding:8px 10px;border:1px solid #cfd8e3;border-radius:8px;background:#fff"></select>
      <button id="runSelectedStoreReplanBtn" type="button">重排指定门店</button>
      <button id="reviewProductPoolReplanBtn" type="button">人工复核</button>
      <button id="exportLatestWorkbookBtn" type="button">导出最新版底表</button>
    </div>
    <div id="productPoolReplanStatus" style="padding:0 20px 18px;color:#52615b;line-height:1.7">尚未生成新的排柜草稿。</div>`;
  host.appendChild(panel);
  populateStoreSelect();
  document.getElementById('exportCurrentProductPoolBtn')?.addEventListener('click',exportPool);
  document.getElementById('runProductPoolReplanBtn')?.addEventListener('click',runReplan);
  document.getElementById('runSelectedStoreReplanBtn')?.addEventListener('click',runSelectedStoreReplan);
  document.getElementById('reviewProductPoolReplanBtn')?.addEventListener('click',openReview);
  document.getElementById('exportLatestWorkbookBtn')?.addEventListener('click',exportWorkbook);
}

function exportPool(){
  const pool=activeProducts();
  if(!pool.length){setStatus('当前没有可导出的有效产品。请先确认生命周期中存在“在售SKU”或“上新完成”的商品。','error');return}
  downloadProductPool(pool);
  setStatus(`已导出 产品池_当前版.xlsx，共 ${pool.length} 个有效SKU。`,'ok');
}

function saveReplanResult(result,label,targetStore=''){
  if(!result.plans.length)throw new Error('没有找到可执行排柜的门店');
  const patch=buildCompactAppDraftPatch(base,result.draft,currentLifecycle());
  const payload=JSON.stringify(patch);
  try{
    localStorage.setItem(DRAFT_STORAGE_KEY,payload);
  }catch(err){
    const sizeKb=Math.ceil(new Blob([payload]).size/1024);
    const error=new Error(`浏览器草稿空间不足，当前增量草稿约 ${sizeKb}KB，未覆盖原草稿。请刷新页面后重试；若仍出现请联系运营。`);
    error.cause=err; throw error;
  }
  latestResult=result;
  latestTargetStore=targetStore;
  try{
    if(targetStore)sessionStorage.setItem(REVIEW_STORE_MARKER,targetStore);
    else sessionStorage.removeItem(REVIEW_STORE_MARKER);
  }catch(_){/* no-op */}
  const failed=result.plans.filter(p=>p.status==='failed').length;
  const review=result.plans.filter(p=>p.status==='review_required').length;
  const passed=result.plans.length-failed-review;
  const unplaced=result.plans.reduce((s,p)=>s+(p.summary?.unplacedSkuCount||0),0);
  const sizeKb=Math.max(1,Math.ceil(new Blob([payload]).size/1024));
  const prefix=result.validation.ok?'排柜草稿已生成':'排柜草稿已生成，但存在必须复核的问题';
  const errorPreview=failed&&result.validation?.errors?.length?`｜硬规则原因：${result.validation.errors.slice(0,3).join('；')}${result.validation.errors.length>3?'…':''}`:'';
  setStatus(`${prefix}：${label}｜${result.plans.length}家门店｜通过${passed}｜需复核${review}｜硬规则失败${failed}｜未纳入SKU记录（跨门店累计）${unplaced}｜增量草稿约${sizeKb}KB${errorPreview}。草稿尚未影响店员端正式方案。`,result.validation.ok?'ok':'error');
}

function prepareSelectedSeed(data,pool,store){
  const optimized=prepareBusinessOptimizedSeed(data,pool,{formalBase:base});
  const selected=text(store);
  const untouched=(data.skus||[]).filter(r=>text(r.store)!==selected).map(clone);
  const selectedRows=(optimized.skus||[]).filter(r=>text(r.store)===selected).map(clone);
  return {...optimized,skus:[...untouched,...selectedRows]};
}

function runReplan(){
  try{
    const current=currentData();
    const data=prepareReplanSource(base,current,null);
    const pool=activeProducts();
    if(!pool.length)throw new Error('最新有效产品池为空');
    setStatus(`正在按 ${pool.length} 个有效SKU对全部门店生成“覆盖优先+外储优化”严格排柜草稿…`);
    const optimized=prepareBusinessOptimizedSeed(data,pool,{formalBase:base});
    const result=replanAllStores(optimized,pool,{preserveExisting:true,externalCapL:754});
    saveReplanResult(result,'全部门店','');
  }catch(err){console.error(err);setStatus(`生成排柜草稿失败：${err.message||err}`,'error')}
}

function runSelectedStoreReplan(){
  try{
    const select=document.getElementById('productPoolReplanStoreSelect');
    const store=text(select?.value);
    if(!store)throw new Error('请先选择需要重排的门店');
    const current=currentData();
    const data=prepareReplanSource(base,current,[store]);
    const pool=activeProducts();
    if(!pool.length)throw new Error('最新有效产品池为空');
    setStatus(`正在按 ${pool.length} 个有效SKU重排：${store}…`);
    const optimized=prepareSelectedSeed(data,pool,store);
    const result=replanSelectedStores(optimized,pool,[store],{preserveExisting:true,externalCapL:754});
    saveReplanResult(result,`指定门店：${store}`,store);
  }catch(err){console.error(err);setStatus(`指定门店重排失败：${err.message||err}`,'error')}
}

function openReview(){
  if(!readPatch()){setStatus('当前没有可复核的产品池重排草稿，请先生成排柜草稿。','error');return}
  try{
    sessionStorage.setItem(REVIEW_MARKER,'1');
    if(latestTargetStore)sessionStorage.setItem(REVIEW_STORE_MARKER,latestTargetStore);
  }catch(_){/* no-op */}
  location.reload();
}

function restoreReviewView(){
  let open=false,store='';
  try{
    open=sessionStorage.getItem(REVIEW_MARKER)==='1';
    store=text(sessionStorage.getItem(REVIEW_STORE_MARKER));
    if(open)sessionStorage.removeItem(REVIEW_MARKER);
    if(store)sessionStorage.removeItem(REVIEW_STORE_MARKER);
  }catch(_){/* no-op */}
  if(!open)return;

  const ops=document.getElementById('opsMode');
  if(ops&&!ops.checked)ops.checked=true;
  document.body.classList.add('ops');

  if(store){
    const storeSelect=document.getElementById('storeSelect');
    if(storeSelect&&[...storeSelect.options].some(o=>o.value===store)){
      storeSelect.value=store;
      storeSelect.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  const tab=document.querySelector('[data-view="allocation"]'); if(tab)tab.click();
  setTimeout(()=>{
    const host=document.getElementById('allocation');
    if(host){const note=document.createElement('div');note.className='help';note.textContent=store?`当前显示的是“${store}”的产品池重排运营草稿，其他门店保持原方案。你可以继续人工修改；未正式上传并通过GitHub复核前，不会改变店员端正式方案。`:'当前显示的是产品池重排运营草稿。你可以在排柜调整和陈列图中人工修改；未正式上传并通过GitHub复核前，不会改变店员端正式方案。';host.prepend(note)}
  },50);
}

function exportWorkbook(){
  try{
    const data=currentData();
    if(!data?.skus?.length)throw new Error('当前运营草稿没有可导出的排柜数据');
    downloadFormalWorkbook(data);
    setStatus('已导出 整箱到店数据测算_当前版.xlsx。指定门店重排时，未选择门店仍保持原方案。请人工确认后上传到 GitHub 的 data/source/。','ok');
  }catch(err){setStatus(`导出最新版底表失败：${err.message||err}`,'error')}
}

function init(){injectPanel();restoreReviewView()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.ProductPoolReplan={activeProducts,currentData,runReplan,runSelectedStoreReplan,exportPool,exportWorkbook,openReview,getLatestResult:()=>latestResult};
export default window.ProductPoolReplan;
