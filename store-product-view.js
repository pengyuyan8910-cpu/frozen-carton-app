(() => {
 const tableHost=document.getElementById('goodsTable'),drawer=document.getElementById('skuInspector'),storeSelect=document.getElementById('storeSelect'),summary=document.getElementById('storeGoodsSummary');if(!tableHost||!drawer||!storeSelect||!summary)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const num=v=>Number(String(v||'').replace(/[^\d.-]/g,''))||0;
 const image=async key=>{try{const d=await new Promise((resolve,reject)=>{const r=indexedDB.open('frozen-carton-product-images',1);r.onupgradeneeded=()=>r.result.createObjectStore('images',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return await new Promise((resolve,reject)=>{const r=d.transaction('images').objectStore('images').get(key);r.onsuccess=()=>resolve(r.result?.file||null);r.onerror=()=>reject(r.error)})}catch{return null}};
 const imageCompat=async item=>{let f=await image(`product::${productKey(item)}`);if(f)return f;if(item.store&&item.store!=='—'){f=await image(`${item.store}::${item.name}`);if(f)return f}if(item.name){f=await image(`product::${item.name}`);if(f)return f}return null};
 const cloudImage=item=>{const data=window.ProductLifecycle?.getData?.();if(!data||!Array.isArray(data.productPool))return '';const key=productKey(item);if(!key)return '';let product=data.productPool.find(p=>productKey(p)===key);if(!product){const name=String(item?.name||'').trim();if(name)product=data.productPool.find(p=>String(p.name||'').trim()===name)}return product?.imageData||''};
 const records=()=>[...tableHost.querySelectorAll('tbody tr')].map(tr=>{const heads=[...tr.closest('table').querySelectorAll('thead th')].map(x=>x.textContent.trim()),cells=[...tr.children].map(x=>x.textContent.trim()),get=n=>cells[heads.findIndex(x=>x===n)]||'—';return{tr,store:get('门店'),name:get('商品'),barcode:get('条码'),grade:get('等级'),category:get('三级类目'),carton:get('箱规'),cabinet:get('陈列柜'),position:get('具体位置'),trigger:get('触发库存'),shelf:get('可入柜'),external:get('需外储'),volume:get('静态外储L'),risk:get('风险')}}).filter(x=>x.name&&x.name!=='—');
 const productKey=item=>{const barcode=String(item?.barcode||'').trim();return barcode&&barcode!=='—'?barcode:String(item?.name||'').trim()};
 const uniqueItems=items=>{const seen=new Set();return items.filter(item=>{const k=productKey(item);if(!k||seen.has(k))return false;seen.add(k);return true})};
 const authoritativeStoreRows=()=>{
  const store=storeSelect.value;
  try{
   if(typeof window.纳入SKU==='function'){
    const rows=window.纳入SKU(store);
    if(Array.isArray(rows))return rows;
   }
  }catch(error){console.warn('商品明细读取门店在售SKU失败，使用底表回退',error)}
  const data=window.ProductLifecycle?.getData?.()||window.UNIFIED_CARTON_DATA||{};
  const lifecycle=window.ProductLifecycle?.getState?.()||{};
  const retired=new Set((lifecycle.tasks||[]).filter(task=>task.type==='淘汰'&&task.status==='已完成').map(task=>String(task.productKey||'').trim()));
  return (Array.isArray(data.skus)?data.skus:[]).filter(row=>
   row.store===store&&
   row.included!==false&&
   row.active!==false&&
   row.lifecycleStatus!=='已淘汰'&&
   !retired.has(productKey(row))
  );
 };
 const renderSummary=items=>{
  const unique=uniqueItems(items);
  const saleCount=uniqueItems(authoritativeStoreRows()).length;
  const a=unique.filter(item=>item.grade==='A').length;
  const external=unique.filter(item=>num(item.external)>0).length;
  const total=unique.reduce((sum,item)=>sum+num(item.volume),0);
  summary.innerHTML=`<div class="store-goods-card"><span>当前门店</span><strong>${esc(storeSelect.value||'—')}</strong><small>店员商品池</small></div><div class="store-goods-card"><span>可售商品</span><strong>${saleCount}</strong><small>与门店执行使用同一在售SKU口径</small></div><div class="store-goods-card"><span>A 级商品</span><strong>${a}</strong><small>重点保障品</small></div><div class="store-goods-card"><span>需外储商品</span><strong>${external}</strong><small>请按门店补货计划执行</small></div><div class="store-goods-card"><span>静态外储</span><strong>${Math.round(total)}L</strong><small>仅供门店核对</small></div>`
 };
 const show=async item=>{current=item;drawer.innerHTML=`<div class="sku-drawer-head"><div class="sku-title-row"><div class="sku-image-slot" id="storeImage"></div><div><h3>${esc(item.name)}</h3><p class="sku-kicker">${esc(item.store)} · 门店商品详情</p></div></div><button type="button" class="sku-close" id="closeInspector">关闭</button></div><section class="sku-section"><h4>商品信息</h4><dl class="sku-detail-list"><div><dt>等级</dt><dd>${esc(item.grade)}</dd></div><div><dt>三级类目</dt><dd>${esc(item.category)}</dd></div><div><dt>箱规</dt><dd>${esc(item.carton)}</dd></div><div><dt>当前柜段</dt><dd>${esc(item.cabinet)}</dd></div><div><dt>具体位置</dt><dd>${esc(item.position)}</dd></div></dl></section><section class="sku-section"><h4>补货与库存</h4><dl class="sku-detail-list"><div><dt>触发库存</dt><dd>${esc(item.trigger)}</dd></div><div><dt>可入柜</dt><dd>${esc(item.shelf)}</dd></div><div><dt>需外储</dt><dd>${esc(item.external)}</dd></div><div><dt>静态外储</dt><dd>${esc(item.volume)}</dd></div></dl></section><section class="sku-section sku-store-actions"><h4>门店执行</h4><div class="sku-detail-actions"><button id="storeRiskAction" type="button">查看风险</button><button id="storeAllocationAction" type="button">排柜调整</button></div><p class="store-readonly-note">风险与排柜均按当前门店和当前 SKU 定位；商品资料与图片请在“产品生命周期管理”统一维护。</p></section>`;drawer.querySelector('#closeInspector').onclick=()=>drawer.innerHTML='<div class="sku-empty">选择一行商品，查看门店商品、补货与陈列信息。</div>';drawer.querySelector('#storeRiskAction').onclick=()=>window.dispatchEvent(new CustomEvent('store-sku:action',{detail:{view:'risk',store:item.store,name:item.name}}));drawer.querySelector('#storeAllocationAction').onclick=()=>window.dispatchEvent(new CustomEvent('store-sku:action',{detail:{view:'allocation',store:item.store,name:item.name}}));document.querySelectorAll('#goodsTable tbody tr').forEach(x=>x.classList.toggle('sku-selected',x===item.tr));const slot=drawer.querySelector('#storeImage'),shared=cloudImage(item),file=shared?null:(await imageCompat(item));slot.innerHTML=shared?`<img src="${esc(shared)}" alt="${esc(item.name)} 商品图片">`:file?`<img src="${URL.createObjectURL(file)}" alt="${esc(item.name)} 商品图片">`:'<div class="sku-image-empty">暂无商品图片</div>'};
 let current=null;
 const apply=()=>{const activeStore=storeSelect.value,all=records(),visible=all.filter(x=>!activeStore||x.store===activeStore);all.forEach(x=>x.tr.hidden=Boolean(activeStore&&x.store!==activeStore));renderSummary(visible);visible.forEach(x=>x.tr.onclick=()=>show(x));if(!drawer.innerHTML)drawer.innerHTML='<div class="sku-empty">选择一行商品，查看门店商品、补货与陈列信息。</div>'};
 new MutationObserver(()=>requestAnimationFrame(apply)).observe(tableHost,{childList:true,subtree:true});
 storeSelect.addEventListener('change',()=>setTimeout(apply,0));
 ['product-lifecycle:state-changed','product-lifecycle:data-committed','product-lifecycle:state-hydrated'].forEach(name=>window.addEventListener(name,()=>requestAnimationFrame(apply)));
 window.addEventListener('product-image:updated',()=>{if(current)show(current)});
 apply();
})();
