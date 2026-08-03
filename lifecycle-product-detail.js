(() => {
  const pool = document.getElementById('poolTable');
  const section = document.getElementById('pool');
  if (!pool || !section) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const productKey = p => String(p.barcode || p.name || '').trim();
  const numeric = new Set(['carton','dailyQty','faceWidth']);
  const products = () => typeof allProducts === 'function' ? allProducts() : [];
  const findProduct = name => products().find(p => p.name === name);
  const db = () => new Promise((resolve, reject) => { const r = indexedDB.open('frozen-carton-product-images', 1); r.onupgradeneeded = () => r.result.createObjectStore('images', { keyPath:'key' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const getImage = async key => { try { const d = await db(); return await new Promise((resolve, reject) => { const r = d.transaction('images').objectStore('images').get(key); r.onsuccess = () => resolve(r.result?.file || null); r.onerror = () => reject(r.error); }); } catch { return null; } };
const putImage = async (key, file) => { const d = await db(); return new Promise((resolve, reject) => { const r = d.transaction('images','readwrite').objectStore('images').put({ key, file, updatedAt:Date.now() }); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); };
  const toCloudImage = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => { const img = new Image(); img.onerror = () => resolve(reader.result); img.onload = () => { const max = 720, ratio = Math.min(1, max / Math.max(img.width, img.height)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * ratio)); canvas.height = Math.max(1, Math.round(img.height * ratio)); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', .82)); }; img.src = reader.result; }; reader.readAsDataURL(file); });
  const syncImage = async (product, file, notify = true) => { const imageData = await toCloudImage(file); await putImage(`product::${product.name}`, file); const saved = window.parent?.ProductLifecycle?.updateProduct?.(productKey(product), { imageData }); if (!saved) throw new Error('图片未写入产品总池'); if (notify) window.parent?.postMessage({ type:'plm:product-image-updated', product:product.name }, '*'); };
  let selected = null;
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true; document.body.appendChild(picker);

async function renderImage(p) {
    const slot = document.querySelector('#plmProductInspector .plm-image'); if (!slot) return;
    const file = p.imageData ? null : await getImage(`product::${p.name}`);
if (file && !p.imageData) {
      // Migrate an existing browser-only image the first time it is opened.
      syncImage(p, file).then(() => renderImage(p)).catch(error => console.error('旧图片迁移失败', error));
    }
    const src = p.imageData || (file ? URL.createObjectURL(file) : '');
    slot.innerHTML = src ? `<button id="plmReplaceImage" type="button"><img src="${esc(src)}" alt="${esc(p.name)}"><span>更换图片</span></button>` : `<button id="plmUploadImage" type="button">上传商品图片</button>`;
    slot.querySelector('button').onclick = () => picker.click();
  }
  function field(label, name, value, type='text') { return `<label class="plm-edit-field"><span>${label}</span><input data-field="${name}" type="${type}" value="${esc(value ?? '')}"></label>`; }
  async function show(p, rowEl) {
    selected = p;
    let aside = document.getElementById('plmProductInspector');
    if (!aside) { aside = document.createElement('aside'); aside.id = 'plmProductInspector'; section.appendChild(aside); section.classList.add('plm-detail-open'); }
    const panel = section.querySelector('.panel');
    const rowTop = rowEl ? rowEl.getBoundingClientRect().top - section.getBoundingClientRect().top : 300;
    const panelTop = panel ? panel.getBoundingClientRect().top - section.getBoundingClientRect().top : 300;
    // 详情卡片以选中行作为锚点，但让标题略高于行，避免卡片像从该行向下坠落。
    const detailTop = Math.max(panelTop + 58, rowTop - 88);
    aside.style.top = Math.round(detailTop) + 'px';
    const coverage = typeof coverageCount === 'function' ? coverageCount(productKey(p)) : '—';
    const row = typeof rowsForProduct === 'function' ? rowsForProduct(productKey(p))[0] : null;
    const faceWidth = p.faceWidth ?? row?.faceWidth ?? 0;
    aside.innerHTML = `<div class="plm-detail-head"><div class="plm-image"></div><div><h3>${esc(p.name)}</h3><p>${esc(p.barcode || '暂无条码')}</p><span>产品总池 · 统一维护</span></div><button id="plmCloseDetail" type="button">关闭</button></div>
      <section><h4>商品资料（修改后同步所有模块）</h4><div class="plm-edit-grid">
      ${field('产品名称','name',p.name)}${field('等级','grade',p.grade)}${field('条码','barcode',p.barcode)}${field('三级类目','category3',p.category3)}${field('箱规','carton',p.carton,'number')}${field('日均销量','dailyQty',p.dailyQty,'number')}${field('单列占宽 mm','faceWidth',faceWidth,'number')}</div>
      <button id="plmSaveProduct" class="plm-save-product" type="button">保存并同步全部门店 / 陈列图</button></section>
      <section><h4>覆盖信息</h4><dl><div><dt>尺寸</dt><dd>${esc(p.length)}×${esc(p.width)}×${esc(p.height)}mm</dd></div><div><dt>门店覆盖</dt><dd>${esc(coverage)}</dd></div></dl><p>风险和排柜调整请在“商品明细”中按具体门店执行。</p></section>`;
// 内容渲染完成后，用实际卡片高度让“信息栏中部”与被点击 SKU 行对齐。
    requestAnimationFrame(() => {
      const rowCenter = rowTop + (rowEl?.getBoundingClientRect().height || 44) / 2;
      const minTop = panelTop + 58;
      aside.style.top = Math.round(Math.max(minTop, rowCenter - aside.offsetHeight / 2)) + 'px';
    });    aside.querySelector('#plmCloseDetail').onclick = () => { aside.remove(); section.classList.remove('plm-detail-open'); };
    aside.querySelector('#plmSaveProduct').onclick = () => {
      const changes = {}; aside.querySelectorAll('[data-field]').forEach(input => { const name = input.dataset.field; changes[name] = numeric.has(name) ? Number(input.value || 0) : input.value.trim(); });
      const originalKey = productKey(p);
      if (!changes.name) return alert('产品名称不能为空。');
      if (window.parent?.ProductLifecycle?.updateProduct?.(originalKey, changes)) {
        window.parent.postMessage({ type:'plm:product-updated', product:changes.name }, '*');
      } else alert('商品资料暂时无法保存，请刷新后重试。');
    };
    await renderImage(p);
  }
picker.onchange = async () => { const file = picker.files?.[0]; if (!file || !selected) return; if (!file.type.startsWith('image/')) return alert('请选择图片文件。'); try { await syncImage(selected, file); picker.value = ''; await renderImage(selected); } catch (error) { alert('图片同步失败，请重试。'); console.error(error); } };
  function openBatch() { const input = document.createElement('input'); input.type='file'; input.accept='image/*'; input.multiple=true; input.onchange=async()=>{ const files=[...input.files].filter(file=>file.type.startsWith('image/')); let count=0; for (const file of files) { const p=products().find(item=>file.name.includes(item.name)); if (p) { await syncImage(p,file,false); count++; } } if(count) window.parent?.postMessage({type:'plm:product-image-updated'},'*'); if(selected) renderImage(selected); if(files.length&&!count) alert('未按文件名匹配到商品，请以商品名称命名图片后重试。'); }; input.click(); }
  function bind() { [...pool.querySelectorAll('tbody tr')].forEach(tr => { const name=tr.querySelector('td:first-child strong')?.textContent.trim() || ''; const p=findProduct(name); if(!p) return; tr.classList.add('plm-product-row'); tr.onclick=e=>{ if(!e.target.closest('button')) show(p, tr); }; }); const toolbar=document.querySelector('#pool .toolbar'); if(toolbar&&!document.getElementById('plmBatchImages')) { const b=document.createElement('button'); b.id='plmBatchImages'; b.className='btn'; b.type='button'; b.textContent='批量上传图片'; b.onclick=openBatch; toolbar.appendChild(b); } }
  new MutationObserver(() => requestAnimationFrame(bind)).observe(pool,{childList:true,subtree:true}); bind();
})();