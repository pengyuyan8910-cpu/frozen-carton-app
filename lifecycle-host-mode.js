(() => {
  "use strict";

  const lifecycleApi = window.ProductLifecycle;
  const rawGetData = lifecycleApi?.getData ? lifecycleApi.getData.bind(lifecycleApi) : () => window.UNIFIED_CARTON_DATA || null;
  let parentRefreshQueued = false;
  let childRefreshQueued = false;
  let parentBindingsInstalled = false;
  let childBindingsInstalled = false;

  const productKey = product => String(product?.barcode || product?.name || "").trim();

  const getData = () => rawGetData() || window.UNIFIED_CARTON_DATA || null;
  const getLifecycleState = () => lifecycleApi?.getState?.() || getData()?.lifecycle || {
    draftProducts: [], tasks: [], slots: [], committedPatches: [], productPatches: []
  };

  const activeRows = (data = getData()) => (data?.skus || []).filter(row =>
    row &&
    row.included !== false &&
    row.active !== false &&
    row.lifecycleStatus !== "已淘汰"
  );

  const activeKeys = (data = getData()) => new Set(activeRows(data).map(productKey).filter(Boolean));

  const latestTask = (key, state = getLifecycleState()) => {
    const ignored = new Set(["已撤销", "部分撤销"]);
    return (state?.tasks || []).find(task =>
      productKey({ barcode: task?.productKey, name: task?.productName }) === key &&
      !ignored.has(task?.status)
    ) || null;
  };

  const canonicalStatus = (product, data = getData(), state = getLifecycleState()) => {
    const key = productKey(product);
    if (!key) return "已淘汰";

    const isActive = activeKeys(data).has(key);
    const task = latestTask(key, state);

    if (task?.type === "恢复") {
      return task.status === "已完成" ? "正常在售" : "恢复中";
    }

    if (task?.type === "淘汰") {
      if (["已撤回", "部分撤回"].includes(task.status)) {
        return task.status === "已撤回" || isActive ? "正常在售" : "恢复中";
      }
      if (task.status === "已完成") return isActive ? "正常在售" : "已淘汰";
      return "待淘汰";
    }

    if (task?.type === "上新") {
      return task.status === "已完成" && isActive ? "正常在售" : "待上新";
    }

    if ((state?.draftProducts || []).some(item => productKey(item) === key)) return "待上新";
    if (isActive) return "正常在售";
    if (product?.active === false) return "已淘汰";
    return "正常在售";
  };

  const allProducts = ({ includeDrafts = true } = {}) => {
    const data = getData();
    const state = getLifecycleState();
    const map = new Map();

    const add = (item, source) => {
      const key = productKey(item);
      if (!key) return;
      if (!map.has(key)) map.set(key, { ...item, __unifiedSource: source });
      else if (source === "productPool") Object.assign(map.get(key), item, { __unifiedSource: source });
    };

    (data?.skus || []).forEach(item => add(item, "sku"));
    (data?.productPool || []).forEach(item => add(item, "productPool"));
    if (includeDrafts) (state?.draftProducts || []).forEach(item => add(item, "draft"));

    return [...map.values()];
  };

  const effectiveProducts = () => {
    const data = getData();
    const state = getLifecycleState();
    const liveKeys = activeKeys(data);
    return allProducts({ includeDrafts: false }).filter(product => {
      const key = productKey(product);
      return liveKeys.has(key) || (product.active !== false && canonicalStatus(product, data, state) !== "已淘汰");
    });
  };

  const service = {
    productKey,
    getData,
    getLifecycleState,
    getActiveRows: activeRows,
    getActiveKeys: activeKeys,
    getStatus: canonicalStatus,
    getAllProducts: allProducts,
    getEffectiveProducts: effectiveProducts
  };

  window.FrozenUnifiedProductState = service;

  // iframe 和其他扩展只能读取数据快照，禁止直接改写主应用状态。
  // 主应用、生命周期任务提交和云端同步仍通过 bridge 内部的 dataRef 写入同一份正式状态。
  if (lifecycleApi?.getData && !lifecycleApi.__snapshotReadInstalled) {
    lifecycleApi.getData = () => {
      const value = rawGetData();
      if (!value) return value;
      return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
    };
    lifecycleApi.__snapshotReadInstalled = true;
  }

  const syncLifecycleHostMode = () => {
    const activeView = document.querySelector('.tabs button.active')?.dataset.view;
    document.body.classList.toggle('lifecycle-host-mode', activeView === 'lifecycle');
  };

  const installParentBindings = () => {
    if (typeof window.有效SKU池 !== "function" || typeof window.产品池有效 !== "function") return false;
    if (parentBindingsInstalled) return true;

    window.有效SKU池 = () => service.getEffectiveProducts();
    window.产品池有效 = () => service.getEffectiveProducts();
    parentBindingsInstalled = true;
    return true;
  };

  const installChildBindings = () => {
    const frame = document.getElementById('productLifecycleFrame');
    const child = frame?.contentWindow;
    if (!child || typeof child.renderAll !== "function") return false;
    if (child.__unifiedProductStateInstalled) {
      childBindingsInstalled = true;
      return true;
    }

    child.productStatus = product => service.getStatus(product);
    child.allProducts = () => service.getAllProducts({ includeDrafts: true }).map(item => {
      const copy = { ...item };
      delete copy.__unifiedSource;
      return copy;
    });
    child.__unifiedProductStateInstalled = true;
    childBindingsInstalled = true;
    child.renderAll();
    return true;
  };

  const refreshChild = () => {
    if (childRefreshQueued) return;
    childRefreshQueued = true;
    requestAnimationFrame(() => {
      childRefreshQueued = false;
      installChildBindings();
      const frame = document.getElementById('productLifecycleFrame');
      try {
        frame?.contentWindow?.postMessage({ type: "plm:refresh-data" }, "*");
      } catch (error) {
        console.warn("生命周期页面刷新失败", error);
      }
    });
  };

  const refreshParentAndChild = () => {
    if (parentRefreshQueued) return;
    parentRefreshQueued = true;
    requestAnimationFrame(() => {
      try {
        installParentBindings();
        if (typeof window.渲染全部 === "function") window.渲染全部();
        else document.querySelector('.tabs button.active')?.click();
        syncLifecycleHostMode();
        installChildBindings();
        refreshChild();
      } finally {
        parentRefreshQueued = false;
      }
    });
  };

  if (lifecycleApi?.syncData && !lifecycleApi.__unifiedSyncWrapped) {
    const originalSyncData = lifecycleApi.syncData.bind(lifecycleApi);
    lifecycleApi.syncData = data => {
      const result = originalSyncData(data);
      installParentBindings();
      refreshChild();
      return result;
    };
    lifecycleApi.__unifiedSyncWrapped = true;
  }

  document.querySelectorAll('.tabs button').forEach(button => {
    button.addEventListener('click', () => setTimeout(() => {
      syncLifecycleHostMode();
      installParentBindings();
      installChildBindings();
    }, 0));
  });

  const lifecycleFrame = document.getElementById('productLifecycleFrame');
  lifecycleFrame?.addEventListener('load', () => setTimeout(() => {
    installChildBindings();
    refreshChild();
  }, 0));

  window.addEventListener('load', () => {
    installParentBindings();
    installChildBindings();
    refreshParentAndChild();
  }, { once: true });

  window.addEventListener('message', event => {
    if (event.data?.type === 'plm:product-image-updated') {
      window.dispatchEvent(new CustomEvent('product-image:updated', { detail: event.data }));
    }
  });

  window.addEventListener('product-lifecycle:state-changed', refreshParentAndChild);
  window.addEventListener('product-lifecycle:data-committed', refreshParentAndChild);
  window.addEventListener('product-lifecycle:state-hydrated', refreshParentAndChild);
  window.addEventListener('product-lifecycle:product-updated', event => {
    if (event.detail?.changes?.imageData) return;
    refreshParentAndChild();
  });

  syncLifecycleHostMode();
  setTimeout(installParentBindings, 0);
})();
