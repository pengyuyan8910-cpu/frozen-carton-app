(() => {
  "use strict";

  let refreshQueued = false;

  const productKey = product => String(product?.barcode || product?.name || "").trim();

  const actualInSaleRows = () => {
    const data = window.ProductLifecycle?.getData?.();
    return (data?.skus || []).filter(row =>
      row &&
      row.included !== false &&
      row.active !== false &&
      row.lifecycleStatus !== "已淘汰"
    );
  };

  const actualInSaleKeys = () => new Set(actualInSaleRows().map(productKey).filter(Boolean));

  const syncLifecycleHostMode = () => {
    const activeView = document.querySelector('.tabs button.active')?.dataset.view;
    document.body.classList.toggle('lifecycle-host-mode', activeView === 'lifecycle');
  };

  const installPoolCountFix = () => {
    const frame = document.getElementById('productLifecycleFrame');
    const child = frame?.contentWindow;
    const childDoc = frame?.contentDocument;
    if (!child || !childDoc || typeof child.renderPool !== 'function' || typeof child.productStatus !== 'function') return;
    if (child.__actualInSaleCountFixInstalled) return;

    const originalProductStatus = child.productStatus;
    const originalRenderPool = child.renderPool;

    const correctedStatus = product => {
      const status = originalProductStatus(product);
      const key = productKey(product);
      if (key && actualInSaleKeys().has(key) && status === '已淘汰') return '正常在售';
      return status;
    };

    child.productStatus = correctedStatus;

    const correctMetrics = () => {
      const rows = actualInSaleRows();
      const keys = new Set(rows.map(productKey).filter(Boolean));
      const products = typeof child.allProducts === 'function' ? child.allProducts() : [];
      const productMap = new Map(products.map(product => [productKey(product), product]));
      const rowMap = new Map(rows.map(row => [productKey(row), row]));
      const statuses = [...keys].map(key => correctedStatus(productMap.get(key) || rowMap.get(key) || { name: key }));
      const metrics = childDoc.querySelectorAll('#poolMetrics .metric');

      const setMetric = (index, value, subtext) => {
        const metric = metrics[index];
        if (!metric) return;
        const valueNode = metric.querySelector('.value');
        const subNode = metric.querySelector('.sub');
        if (valueNode) valueNode.textContent = String(value);
        if (subNode && subtext) subNode.textContent = subtext;
      };

      setMetric(0, keys.size, '当前运营数据中实际在售的唯一SKU');
      setMetric(1, statuses.filter(status => status === '正常在售').length, '实际在售SKU中未进入变更任务');
      setMetric(2, statuses.filter(status => status === '待上新').length);
      setMetric(3, statuses.filter(status => status === '待淘汰').length);
      setMetric(4, statuses.filter(status => status === '恢复中').length);
    };

    child.renderPool = function (...args) {
      const result = originalRenderPool.apply(this, args);
      correctMetrics();
      return result;
    };

    child.__actualInSaleCountFixInstalled = true;
    child.renderPool();
  };

  const refreshCurrentViewWithoutReload = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      try {
        const activeTab = document.querySelector('.tabs button.active');
        if (activeTab) activeTab.click();
        syncLifecycleHostMode();
        installPoolCountFix();
      } finally {
        refreshQueued = false;
      }
    });
  };

  document.querySelectorAll('.tabs button').forEach(button => {
    button.addEventListener('click', () => setTimeout(() => {
      syncLifecycleHostMode();
      installPoolCountFix();
    }, 0));
  });

  const lifecycleFrame = document.getElementById('productLifecycleFrame');
  lifecycleFrame?.addEventListener('load', () => setTimeout(installPoolCountFix, 0));

  syncLifecycleHostMode();
  installPoolCountFix();

  window.addEventListener('message', event => {
    if (event.data?.type === 'plm:product-image-updated') {
      window.dispatchEvent(new CustomEvent('product-image:updated', { detail: event.data }));
    }
  });

  // 生命周期任务提交后只刷新当前页面，不再整页 reload。
  // 整页 reload 会把 opsMode 恢复为默认关闭状态，从而自动回到店员端。
  window.addEventListener('product-lifecycle:data-committed', refreshCurrentViewWithoutReload);

  window.addEventListener('product-lifecycle:product-updated', event => {
    if (event.detail?.changes?.imageData) return;
    refreshCurrentViewWithoutReload();
  });
})();
