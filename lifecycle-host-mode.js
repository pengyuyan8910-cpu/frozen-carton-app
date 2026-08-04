(() => {
  "use strict";

  let refreshQueued = false;
  let reconciling = false;

  const text = value => String(value ?? "").trim();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const productKey = item => {
    const barcode = text(item?.barcode);
    return barcode && barcode !== "—" ? barcode : text(item?.name);
  };
  const isEmpty = value => value === undefined || value === null || value === "" || value === 0;

  const taskMatches = (task, item) => {
    if (!item) return false;
    const taskKey = text(task?.productKey);
    const taskName = text(task?.productName);
    const itemBarcode = text(item?.barcode);
    if (taskKey && productKey(item) === taskKey) return true;
    if (/^\d{6,}$/.test(taskKey) && itemBarcode && itemBarcode !== taskKey) return false;
    return Boolean(taskName && text(item.name) === taskName);
  };

  const completeness = item => [
    text(item?.name), text(item?.barcode), text(item?.grade), text(item?.category2),
    text(item?.category3), text(item?.category4), number(item?.length), number(item?.width),
    number(item?.height), number(item?.volume), number(item?.carton), number(item?.dailyQty)
  ].reduce((sum, value) => sum + (value ? 1 : 0), 0);

  const copyMissing = (target, source, fields) => {
    fields.forEach(field => {
      if (isEmpty(target[field]) && !isEmpty(source?.[field])) target[field] = structuredClone(source[field]);
    });
  };

  const productFields = [
    "name", "barcode", "grade", "rank", "category2", "category3", "category4", "scene",
    "length", "width", "height", "volume", "carton", "dailyQty", "dailySales", "moq", "moqDays", "imageData"
  ];

  const skuFields = productFields.filter(field => field !== "imageData");

  function reconcileCompletedLaunches() {
    if (reconciling) return false;
    const api = window.ProductLifecycle;
    const data = api?.getData?.();
    const state = api?.getState?.();
    if (!data || !state || !Array.isArray(data.productPool) || !Array.isArray(data.skus) || !Array.isArray(state.tasks)) return false;

    reconciling = true;
    let changed = false;
    try {
      state.tasks.filter(task => task.type === "上新" && task.status === "已完成").forEach(task => {
        const candidates = [
          ...(state.draftProducts || []).filter(item => taskMatches(task, item)),
          ...data.productPool.filter(item => taskMatches(task, item)),
          ...data.skus.filter(item => taskMatches(task, item)),
          ...(task.rows || []).filter(row => text(row.productName) === text(task.productName))
        ].sort((a, b) => completeness(b) - completeness(a));

        const master = candidates[0] || { name: task.productName };
        let poolItem = data.productPool.find(item => taskMatches(task, item));
        if (!poolItem) {
          poolItem = { id: `pool_${productKey(master) || text(task.productName)}`, active: true, name: task.productName };
          copyMissing(poolItem, master, productFields);
          data.productPool.push(poolItem);
          changed = true;
        } else {
          const before = JSON.stringify(poolItem);
          copyMissing(poolItem, master, productFields);
          poolItem.active = true;
          if (JSON.stringify(poolItem) !== before) changed = true;
        }

        const oldKey = text(task.productKey);
        const canonicalKey = productKey(poolItem) || oldKey || text(task.productName);
        if (canonicalKey && task.productKey !== canonicalKey) {
          task.productKey = canonicalKey;
          changed = true;
        }

        (task.rows || []).forEach(row => {
          if (canonicalKey && row.productKey !== canonicalKey) { row.productKey = canonicalKey; changed = true; }
          if (!text(row.barcode) && text(poolItem.barcode)) { row.barcode = poolItem.barcode; changed = true; }
          const before = JSON.stringify(row);
          copyMissing(row, poolItem, skuFields);
          if (JSON.stringify(row) !== before) changed = true;
        });

        const draftCount = (state.draftProducts || []).length;
        state.draftProducts = (state.draftProducts || []).filter(item => !taskMatches(task, item));
        if (state.draftProducts.length !== draftCount) changed = true;

        (state.slots || []).forEach(slot => {
          if (slot.taskId === task.id && canonicalKey && (!slot.targetProductKey || slot.targetProductKey === oldKey)) {
            slot.targetProductKey = canonicalKey;
            changed = true;
          }
        });

        const taskRows = new Map((task.rows || []).map(row => [text(row.id), row]));
        data.skus.filter(row => row.lifecycleTaskId === task.id).forEach(row => {
          const source = taskRows.get(text(row.lifecycleTaskRowId)) || poolItem;
          const before = JSON.stringify(row);
          copyMissing(row, poolItem, skuFields);
          copyMissing(row, source, skuFields);
          row.included = true;
          row.active = true;
          row.lifecycleStatus = "正常在售";
          if (JSON.stringify(row) !== before) changed = true;
        });

        (state.committedPatches || []).filter(patch => patch.taskId === task.id && patch.type === "addSku" && patch.row).forEach(patch => {
          const source = taskRows.get(text(patch.row.lifecycleTaskRowId)) || poolItem;
          const before = JSON.stringify(patch.row);
          copyMissing(patch.row, poolItem, skuFields);
          copyMissing(patch.row, source, skuFields);
          patch.row.included = true;
          patch.row.active = true;
          patch.row.lifecycleStatus = "正常在售";
          if (JSON.stringify(patch.row) !== before) changed = true;
        });
      });

      if (changed) {
        data.lifecycle = structuredClone(state);
        api.saveState(state);
      }
      return changed;
    } finally {
      reconciling = false;
    }
  }

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
        document.getElementById("productLifecycleFrame")?.contentWindow?.postMessage({ type: "plm:refresh-data" }, "*");
      } finally {
        refreshQueued = false;
      }
    });
  };

  const reconcileAndRefresh = () => {
    reconcileCompletedLaunches();
    refreshCurrentViewWithoutReload();
  };

  document.querySelectorAll('.tabs button').forEach(button => {
    button.addEventListener('click', () => setTimeout(syncLifecycleHostMode, 0));
  });

  syncLifecycleHostMode();

  window.addEventListener('load', () => {
    if (reconcileCompletedLaunches()) refreshCurrentViewWithoutReload();
  }, { once: true });

  window.addEventListener('message', event => {
    if (event.data?.type === 'plm:product-image-updated') {
      window.dispatchEvent(new CustomEvent('product-image:updated', { detail: event.data }));
    }
  });

  window.addEventListener('product-lifecycle:data-committed', reconcileAndRefresh);
  window.addEventListener('product-lifecycle:state-hydrated', reconcileAndRefresh);

  window.addEventListener('product-lifecycle:product-updated', event => {
    if (event.detail?.changes?.imageData) return;
    refreshCurrentViewWithoutReload();
  });
})();
