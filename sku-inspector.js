(() => {
  const host=document.getElementById('skuInspector'), tableHost=document.getElementById('goodsTable'); if(!host||!tableHost)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); const norm=v=>String(v||'').toLowerCase().replace(/\.[^.]+$/,'').replace(/[\s\-_()（）【】\[\]·]+/g,'');
  const db=()=>new Promise((resolve,reject)=>{const req=indexedDB.open('frozen-carton-product-images',1);req.onupgradeneeded=()=>req.result.createObjectStore('images',{keyPath:'key'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  const getImage=async key=>{const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('images').objectStore('images').get(key);r.onsuccess=()=>resolve(r.result?.file||null);r.onerror=()=>reject(r.error)})}; const putImage=async(key,file)=>{const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('images','readwrite').objectStore('images').put({key,file,updatedAt:Date.now()});r.onsuccess=resolve;r.onerror=()=>reject(r.error)})};
  const rows=()=>[...tableHost.querySelectorAll('tbody tr')].map(tr=>{const h=[...tr.closest('table').querySelectorAll('thead th')].map(x=>x.textContent.trim()),c=[...tr.children].map(x=>x.textContent.trim()),get=n=>c[h.findIndex(x=>x===n)]||'—';return{tr,store:get('门店'),name:get('商品'),barcode:get('条码'),grade:get('等级'),category:get('三级类目'),carton:get('箱规'),cabinet:get('陈列柜'),position:get('具体位置'),trigger:get('触发库存'),shelf:get('可入柜'),external:get('需外储'),volume:get('静态外储L'),risk:get('风险')}}).filter(x=>x.name&&x.name!=='—');

  /* ---- unified product key: barcode preferred, '—' treated as empty ---- */
  const productKey=item=>{const bc=String(item?.barcode||'').trim();return bc&&bc!=='—'?bc:String(item?.name||'').trim()};
  const keyOf=item=>`product::${productKey(item)}`;

  /* ---- cloud image: look up imageData from the shared product pool ---- */
  const cloudImage=item=>{
    const data=window.ProductLifecycle?.getData?.();
    if(!data||!Array.isArray(data.productPool))return '';
    const key=productKey(item); if(!key)return '';
    let product=data.productPool.find(p=>productKey(p)===key);
    if(!product){const name=String(item?.name||'').trim();if(name)product=data.productPool.find(p=>String(p.name||'').trim()===name)}
    return product?.imageData||'';
  };

  /* ---- convert File to compressed base64 JPEG for cloud sync ---- */
  const toCloudImage=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>{const img=new Image();img.onerror=()=>resolve(reader.result);img.onload=()=>{const max=360,ratio=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*ratio));canvas.height=Math.max(1,Math.round(img.height*ratio));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.70))};img.src=reader.result};reader.readAsDataURL(file)});

  /* ---- sync image: save to IndexedDB + write imageData into product pool ---- */
  const syncImage=async(item,file)=>{
    const imageData=await toCloudImage(file);
    await putImage(keyOf(item),file);
    const key=productKey(item);
    if(key&&window.ProductLifecycle?.updateProduct){
      const saved=window.ProductLifecycle.updateProduct(key,{imageData});
      if(!saved)throw new Error('图片未写入产品总池');
    }
    window.dispatchEvent(new CustomEvent('product-image:updated',{detail:{key}}));
    return imageData;
  };

  /* ---- backward-compatible image lookup: tries new key, then old store::name key, auto-migrates ---- */
  const getImageCompat=async item=>{
    let f=await getImage(keyOf(item)); if(f)return f;
    const oldKey=`${item.store}::${item.name}`;
    if(item.store&&item.store!=='—'){
      f=await getImage(oldKey);
      if(f){await putImage(keyOf(item),f);try{const imageData=await toCloudImage(f);const pk=productKey(item);if(pk&&window.ProductLifecycle?.updateProduct)window.ProductLifecycle.updateProduct(pk,{imageData})}catch{}return f}
    }
    if(item.name&&String(item.name).trim()){f=await getImage(`product::${item.name}`);if(f){await putImage(keyOf(item),f);return f}}
    return null;
  };

  /* ---- one-time bulk migration: re-key all old store::name entries to product::barcode ---- */
  const migrateOldImages=async()=>{
    if(localStorage.getItem('fc-image-migrated-v3'))return;
    const allRows=rows(); if(!allRows.length)return;
    const nameToItem=new Map(); allRows.forEach(r=>nameToItem.set(String(r.name).trim(),r));
    let migrated=0;
    try{
      const d=await db();
      const keys=await new Promise((res,rej)=>{const r=d.transaction('images').objectStore('images').getAllKeys();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)});
      for(const ok of keys){
        const s=String(ok); if(s.startsWith('product::'))continue;
        const idx=s.indexOf('::'); if(idx<0)continue;
        const name=s.slice(idx+2).trim();
        const item=nameToItem.get(name); if(!item)continue;
        const file=await getImage(s); if(!file)continue;
        await putImage(keyOf(item),file);
        try{const imageData=await toCloudImage(file);const pk=productKey(item);if(pk&&window.ProductLifecycle?.updateProduct)window.ProductLifecycle.updateProduct(pk,{imageData})}catch{}
        migrated++;
      }
      localStorage.setItem('fc-image-migrated-v3','1');
      if(migrated>0){window.dispatchEvent(new CustomEvent('product-image:updated'));console.log('[image-migration] migrated '+migrated+' old images')}
    }catch(e){console.error('[image-migration]',e)}
  };

  let current=null; const picker=document.createElement('input'); picker.type='file';picker.accept='image/*';picker.hidden=true;document.body.appendChild(picker);

  const renderImage=async item=>{
    const slot=host.querySelector('#skuImageSlot'); if(!slot)return;
    try{
      const shared=cloudImage(item);
      if(shared){
        slot.innerHTML=`<button type="button" class="sku-image-button" id="replaceSkuImage" title="更换商品图片"><img src="${esc(shared)}" alt="${esc(item.name)} 商品图片"><span>更换图片</span></button>`;
        slot.querySelector('#replaceSkuImage').onclick=()=>picker.click();
        return;
      }
      const f=await getImageCompat(item);
      if(f){
        const url=URL.createObjectURL(f);
        slot.innerHTML=`<button type="button" class="sku-image-button" id="replaceSkuImage" title="更换商品图片"><img src="${url}" alt="${esc(item.name)} 商品图片"><span>更换图片</span></button>`;
        slot.querySelector('#replaceSkuImage').onclick=()=>picker.click();
      }else{
        slot.innerHTML='<button type="button" class="sku-image-empty" id="uploadSkuImage">上传商品图片</button>';
        slot.querySelector('#uploadSkuImage').onclick=()=>picker.click();
      }
    }catch{slot.innerHTML='<div class="sku-image-empty">图片功能暂不可用</div>'}
  };

  const show=async item=>{current=item;host.innerHTML=`<div class="sku-drawer-head"><div class="sku-title-row"><div class="sku-image-slot" id="skuImageSlot"></div><div><h3>${esc(item.name)}</h3><p class="sku-kicker">${esc(item.store)} · 已选择商品</p></div></div><button type="button" class="sku-close" id="closeInspector">关闭</button></div><section class="sku-section"><h4>商品信息</h4><dl class="sku-detail-list"><div><dt>等级</dt><dd>${esc(item.grade)}</dd></div><div><dt>三级类目</dt><dd>${esc(item.category)}</dd></div><div><dt>箱规</dt><dd>${esc(item.carton)}</dd></div><div><dt>当前柜段</dt><dd>${esc(item.cabinet)}</dd></div><div><dt>具体位置</dt><dd>${esc(item.position)}</dd></div></dl></section><section class="sku-section"><h4>补货与库存</h4><dl class="sku-detail-list"><div><dt>触发库存</dt><dd>${esc(item.trigger)}</dd></div><div><dt>可入柜</dt><dd>${esc(item.shelf)}</dd></div><div><dt>需外储</dt><dd>${esc(item.external)}</dd></div><div><dt>静态外储</dt><dd>${esc(item.volume)}</dd></div></dl></section><section class="sku-section"><h4>风险评估</h4><span class="sku-risk">${esc(item.risk)}</span></section><div class="sku-actions"><button type="button" id="skuRisk">查看风险</button><button type="button" id="skuPlace">排柜调整</button></div>`;document.querySelectorAll('#goodsTable tbody tr').forEach(x=>x.classList.toggle('sku-selected',x===item.tr));host.querySelector('#closeInspector').onclick=()=>{host.innerHTML='<div class="sku-empty">选择一行商品，查看补货、外储、排柜与商品图片。</div>';current=null};host.querySelector('#skuRisk').onclick=()=>document.querySelector('[data-view="risk"]')?.click();host.querySelector('#skuPlace').onclick=()=>document.querySelector('[data-view="allocation"]')?.click();await renderImage(item)};

  picker.onchange=async()=>{
    const f=picker.files?.[0]; if(!f||!current)return;
    if(!f.type.startsWith('image/'))return alert('请选择图片文件。');
    try{
      await syncImage(current,f);
      picker.value='';
      await renderImage(current);
      alert('图片已绑定到当前产品总池。请到"云端协作"手动点击"保存至云端"后，再由伙伴手动拉取。');
    }catch(e){console.error(e);alert('图片保存失败，请重试。');}
  };

  const match=(f,items)=>{const n=norm(f.name);return items.find(x=>n===norm(x.name))||items.find(x=>n.includes(norm(x.name))||norm(x.name).includes(n))||null};
  const openQueue=files=>{
    const products=rows(),overlay=document.createElement('div');
    overlay.className='image-upload-modal';
    overlay.innerHTML=`<div class="image-upload-dialog"><div class="image-upload-title"><div><h3>批量上传商品图片</h3><p>系统已按文件名尝试匹配商品，请确认后保存。</p></div><button type="button" id="closeImageQueue">关闭</button></div><div class="image-upload-list">${files.map((f,i)=>{const m=match(f,products);return `<label class="image-upload-row"><span>${esc(f.name)}</span><select data-file="${i}"><option value="">选择商品</option>${products.map((p,j)=>`<option value="${j}" ${p===m?'selected':''}>${esc(p.store)} · ${esc(p.name)}</option>`).join('')}</select></label>`}).join('')}</div><div class="image-upload-footer"><span>${files.length} 张图片</span><button type="button" id="saveImageQueue">保存图片</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#closeImageQueue').onclick=()=>overlay.remove();
    overlay.querySelector('#saveImageQueue').onclick=async()=>{
      const selected=[...overlay.querySelectorAll('select')].map(s=>({file:files[Number(s.dataset.file)],item:products[Number(s.value)]})).filter(x=>x.item);
      if(!selected.length)return alert('请至少为一张图片选择商品。');
      let ok=0;
      for(const x of selected){
        try{await syncImage(x.item,x.file);ok++}catch(e){console.error(e)}
      }
      overlay.remove();
      if(current)await renderImage(current);
      alert(`已保存 ${ok} 张商品图片。请到"云端协作"手动点击"保存至云端"后，再由伙伴手动拉取。`);
    };
  };
  const openBatch=()=>{const p=document.createElement('input');p.type='file';p.accept='image/*';p.multiple=true;p.onchange=()=>{const fs=[...p.files].filter(x=>x.type.startsWith('image/'));if(fs.length)openQueue(fs)};p.click()};

  /* refresh image when the product pool changes (e.g. cloud pull) */
  window.addEventListener('product-image:updated',()=>{if(current)renderImage(current)});

  const bind=()=>{const all=rows();if(!all.length)return;all.forEach(x=>x.tr.onclick=()=>show(x));const bulk=document.getElementById('bulkImageUploadBtn');if(bulk)bulk.onclick=openBatch;if(!host.innerHTML)host.innerHTML='<div class="sku-empty">选择一行商品，查看补货、外储、排柜与商品图片。</div>';migrateOldImages()};
  new MutationObserver(()=>requestAnimationFrame(bind)).observe(tableHost,{childList:true,subtree:true});bind();
})();
