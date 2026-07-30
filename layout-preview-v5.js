/* Preview-only enhancements: stable selected-SKU details and reliable planogram location. */
(function () {
  function text(node) { return (node && node.textContent || '').trim(); }

  function selectedSku(card) {
    const meta = text(card.querySelector('.selection-meta'));
    const barcode = (meta.split(/[｜|]/)[0] || '').trim();
    const name = text(card.querySelector('.selection-head strong'));
    const rows = window.UNIFIED_CARTON_DATA && window.UNIFIED_CARTON_DATA.skus || [];
    return rows.find(r => String(r.barcode || '') === barcode) || rows.find(r => r.name === name) || null;
  }

  function enhanceSelectedCard() {
    const card = document.querySelector('#displayMapMonitor .selection-card-active');
    if (!card) return;
    const sku = selectedSku(card);
    if (!sku) return;
    const key = [sku.id, sku.carton, sku.faceWidth].join('|');
    const existing = card.querySelector('.selection-basic-info');
    if (existing && existing.dataset.previewKey === key) return;
    if (existing) existing.remove();
    const info = document.createElement('div');
    info.className = 'selection-basic-info';
    info.dataset.previewKey = key;
    info.innerHTML = '<div><span>箱规</span><strong>' + (Number(sku.carton) || 0) + ' 件/箱</strong></div>' +
      '<div><span>单列占宽</span><strong>' + (Number(sku.faceWidth) || 0) + ' mm</strong></div>';
    const actions = card.querySelector('.selection-actions');
    if (actions) actions.insertAdjacentElement('afterend', info);
    else card.appendChild(info);
  }

  function findSkuElement(id) {
    return document.querySelector('#displaymap .map-item[data-sku-id="' + CSS.escape(id) + '"]');
  }

  function locateItem(id, attempt) {
    const item = findSkuElement(id);
    if (!item) {
      if ((attempt || 0) < 10) setTimeout(function () { locateItem(id, (attempt || 0) + 1); }, 120);
      return;
    }
    item.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    item.classList.remove('map-locate');
    void item.offsetWidth;
    item.classList.add('map-locate');
    setTimeout(function () { item.classList.remove('map-locate'); }, 3600);
  }

  function watch() {
    const target = document.getElementById('displayMapMonitor');
    if (!target) return setTimeout(watch, 120);
    new MutationObserver(enhanceSelectedCard).observe(target, { childList: true, subtree: true });
    enhanceSelectedCard();
  }

  document.addEventListener('click', function (event) {
    const btn = event.target.closest('[data-map-locate]');
    if (!btn) return;
    const id = btn.getAttribute('data-map-locate');
    setTimeout(function () { locateItem(id, 0); }, 100);
  }, true);

  watch();
})();
