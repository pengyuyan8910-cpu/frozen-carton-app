import { DRAFT_STORAGE_KEY, normalizeActiveProductPool, applyAppStatePatch, replanAllStores, buildAppDraftPatch } from './product-pool-replan-core.mjs';
import { downloadProductPool, downloadFormalWorkbook } from './replan-workbook.mjs';

const REVIEW_MARKER='frozen_carton_open_replan_review_v1';
const text=v=>String(v??'').trim();
const clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
const base=window.UNIFIED_CARTON_DATA;
const signature=[base?.meta?.source,base?.meta?.generatedAt,base?.meta?.version].join('|');
let latestResult=null;

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
function currentData(){const patch=readPatch();return patch?applyAppStatePatch(base,patch):clone(base)}
function activeProducts(){
  const lifecycle=window.ProductLifecycle?.getActiveProducts?.();
  const source=Array.isArray(lifecycle)&&lifecycle.length?lifecycle:(currentData().productPool||[]);
  return normalizeActiveProductPool(source);
}
function currentLifecycle(){return window.ProductLifecycle?.getState?.()||currentData().lifecycle||null}

function injectPanel(){
  const host=document.querySelector('#io .panel')||document.getElementById('io');
  if(!host||document.getElementById('productPoolReplanPanel'))return;
  const panel=document.createElement('section');
  panel.id='productPoolReplanPanel';
  panel.className='panel';
  panel.style.marginTop='18px';
  panel.innerHTML=`
    <div class="panel-title"><div><h2>产品池重排</h2><p>统一处理产品池变化和新增门店。立柜柜1-4第1-5层均参与冻品排柜，第6层为存储位。</p></div></div>
    <div class="help">流程：完成上新/淘汰 → 导出当前产品池 → 按当前产品池重新排柜 → 人工复核 → 导出最新版底表。重排只写运营草稿，不会自动覆盖店员端正式方案。</div>
    <div class="toolbar" style="padding:16px 20px;gap:10px;flex-wrap:wrap">
      <button id="exportCurrentProductPoolBtn" type="button">导出当前产品池</button>
      <button id="runProductPoolReplanBtn" type="button">按当前产品池重新排柜</button>
      <button id="reviewProductPoolReplanBtn" type="button">人工复核</button>
      <button id="exportLatestWorkbookBtn" type="button">导出最新版底表</button>
    </div>
    <div id="productPoolReplanStatus" style="padding:0 20px 18px;color:#52615b;line-height:1.7">尚未生成新的排柜草稿。</div>`;
  host.appendChild(panel);
  document.getElementById('exportCurrentProductPoolBtn')?.addEventListener('click',exportPool);
  document.getElementById('runProductPoolReplanBtn')?.addEventListener('click',runReplan);
  document.getElementById('reviewProductPoolReplanBtn')?.addEventListener('click',openReview);
  document.getElementById('exportLatestWorkbookBtn')?.addEventListener('click',exportWorkbook);
}

function exportPool(){
  const pool=activeProducts();
  if(!pool.length){setStatus('当前没有可导出的有效产品。请先确认生命周期中存在“在售SKU”或“上新完成”的商品。','error');return}
  downloadProductPool(pool);
  setStatus(`已导出 产品池_当前版.xlsx，共 ${pool.length} 个有效SKU。`,'ok');
}

function runReplan(){
  try{
    const data=currentData();
    const pool=activeProducts();
    if(!pool.length)throw new Error('最新有效产品池为空');
    setStatus(`正在按 ${pool.length} 个有效SKU对全部门店生成严格排柜草稿…`);
    const result=replanAllStores(data,pool,{preserveExisting:true,externalCapL:754});
    if(!result.plans.length)throw new Error('没有找到可执行排柜的门店');
    const patch=buildAppDraftPatch(base,result.draft,currentLifecycle());
    localStorage.setItem(DRAFT_STORAGE_KEY,JSON.stringify(patch));
    latestResult=result;
    const failed=result.plans.filter(p=>p.status==='failed').length;
    const review=result.plans.filter(p=>p.status==='review_required').length;
    const passed=result.plans.length-failed-review;
    const unplaced=result.plans.reduce((s,p)=>s+(p.summary?.unplacedSkuCount||0),0);
    const prefix=result.validation.ok?'排柜草稿已生成':'排柜草稿已生成，但存在必须复核的问题';
    setStatus(`${prefix}：${result.plans.length}家门店｜通过${passed}｜需复核${review}｜失败${failed}｜未排入SKU记录${unplaced}。草稿尚未影响店员端正式方案。`,result.validation.ok?'ok':'error');
  }catch(err){console.error(err);setStatus(`生成排柜草稿失败：${err.message||err}`,'error')}
}

function openReview(){
  if(!readPatch()){setStatus('当前没有可复核的产品池重排草稿，请先点击“按当前产品池重新排柜”。','error');return}
  try{sessionStorage.setItem(REVIEW_MARKER,'1')}catch(_){/* no-op */}
  location.reload();
}

function restoreReviewView(){
  let open=false;
  try{open=sessionStorage.getItem(REVIEW_MARKER)==='1';if(open)sessionStorage.removeItem(REVIEW_MARKER)}catch(_){/* no-op */}
  if(!open)return;
  const ops=document.getElementById('opsMode'); if(ops&&!ops.checked){ops.checked=true;ops.dispatchEvent(new Event('change',{bubbles:true}))}
  const tab=document.querySelector('[data-view="allocation"]'); if(tab)tab.click();
  setTimeout(()=>{
    const host=document.getElementById('allocation');
    if(host){const note=document.createElement('div');note.className='help';note.textContent='当前显示的是产品池重排运营草稿。你可以在排柜调整和陈列图中人工修改；未正式上传并通过GitHub复核前，不会改变店员端正式方案。';host.prepend(note)}
  },50);
}

function exportWorkbook(){
  try{
    const data=currentData();
    if(!data?.skus?.length)throw new Error('当前运营草稿没有可导出的排柜数据');
    downloadFormalWorkbook(data);
    setStatus('已导出 整箱到店数据测算_当前版.xlsx。请人工确认后上传到 GitHub 的 data/source/。','ok');
  }catch(err){setStatus(`导出最新版底表失败：${err.message||err}`,'error')}
}

function init(){injectPanel();restoreReviewView()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.ProductPoolReplan={activeProducts,currentData,runReplan,exportPool,exportWorkbook,openReview,getLatestResult:()=>latestResult};
export default window.ProductPoolReplan;
