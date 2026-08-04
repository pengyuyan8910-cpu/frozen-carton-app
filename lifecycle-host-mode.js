(() => {
  "use strict";

  let refreshQueued = false;

  const syncLifecycleHostMode = () => {
    const activeView = document.querySelector('.tabs button.active')?.dataset.view;
    document.body.classList.toggle('lifecycle-host-mode', activeView === 'lifecycle');
  };

  const refreshCurrentViewWithoutReload = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      try {
        const activeTab = document.querySelector('.tabs button.active');
        if (activeTab) activeTab.click();
        syncLifecycleHostMode();
      } finally {
        refreshQueued = false;
      }
    });
  };

  document.querySelectorAll('.tabs button').forEach(button => {
    button.addEventListener('click', () => setTimeout(syncLifecycleHostMode, 0));
  });

  syncLifecycleHostMode();

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
