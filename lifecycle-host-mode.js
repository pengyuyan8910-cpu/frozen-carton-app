(() => {
  "use strict";

  const lifecycleApi = window.ProductLifecycle;
  const rawGetData = lifecycleApi?.getData ? lifecycleApi.getData.bind(lifecycleApi) : () => window.UNIFIED_CARTON_DATA || null;
  let parentRefreshQueued = false;
  let childRefreshQueued = false;
  let parentBindingsInstalled = false;
  let childBindingsInstalled = false;

  const text = value => String(value ?? "").trim();
  const barcodeOf = product => {
    const value = text(product?.barcode);
    return value && value !== "—" && value !== "-" ? value : "";
  };
  const normalizedName = product => text(product?.name).replace(/\s+/g, "").toLowerCase();
  const productKey = product => barcodeOf(product) || text(product?.name);
  const taskProduct = task => {
    const rawKey = text(task?.productKey);
    const keyIsBarcode = /^\d{6,}$/.test(rawKey);
    return {
      barcode: keyIsBarcode ? rawKey : "",
      name: text(task?.productName) || (keyIsBarcode ? "" : rawKey)
    };
  };
  const sameProduct = (left, right) => {
    const leftBarcode = barcodeOf(left);
    const rightBarcode = barcodeOf(right);
    if (leftBarcode && rightBarcode) return leftBarcode === rightBarcode;
    const leftName = normalizedName(left);
    const rightName = normalizedName(right);
    return Boolean(leftName && rightName && leftName === rightName);
  };

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

  const latestTask = (product, state = getLifecycleState()) => {
    const ignored = new Set(["已撤销", "部分撤销"]);
    return (state?.tasks || []).find(task =>
      sameProduct(taskProduct(task), product) &&
      !ignored.has(task?.status)
    ) || null;
  };

  const canonicalStatus = (product, data = getData(), state = getLifecycleState()) => {
    if (!productKey(product)) return "已淘汰";

    const isActive = activeRows(data).some(row => sameProduct(row, product));
    const task = latestTask(product, state);

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

    if ((state?.draftProducts || []).some(item => sameProduct(item, product))) return "待上新";
    if (isActive) return "正常在售";
    if (product?.active === false) return "已淘汰";
    return "正常在售";
  };

  const completenessScore = item => {
    const dimensions = [item?.length, item?.width, item?.height].filter(value => Number(value) > 0).length;
    return (barcodeOf(item) ? 100 : 0) +
      (text(item?.name) ? 20 : 0) +
      dimensions * 12 +
      (Number(item?.carton) > 0 ? 8 : 0) +
      (text(item?.category3) ? 6 : 0) +
      (text(item?.category4) ? 6 : 0) +
      (text(item?.grade) ? 4 : 0) +
      (item?.imageData ? 3 : 0);
  };

  const mergeViewGroup = group => {
    const records = group.records.map(record => record.item);
    const preferred = records.reduce((best, item) =>
      completenessScore(item) > completenessScore(best) ? item : best
    , records[0] || {});
    const merged = { ...preferred };
    const fields = [
      "id", "name", "barcode", "grade", "rank", "category2", "category3", "category4",
      "length", "width", "height", "volume", "carton", "dailyQty", "dailySales", "moq",
      "moqDays", "faceWidth", "imageData", "active"
    ];
    records.forEach(item => {
      fields.forEach(field => {
        const current = merged[field];
        const incoming = item?.[field];
        const currentMissing = current === undefined || current === null || current === "" || current === 0;
        const incomingValid = incoming !== undefined && incoming !== null && incoming !== "" && incoming !== 0;
        if (currentMissing && incomingValid) merged[field] = incoming;
      });
    });
    merged.__identityBarcodes = [...group.barcodes];
    merged.__identityNames = [...group.names];
    merged.__draftOnly = group.records.every(record => record.source === "draft");
    merged.__unifiedSource = group.records.some(record => record.source === "productPool")
      ? "productPool"
      : group.records.some(record => record.source === "sku")
        ? "sku"
        : "draft";
    return merged;
  };

  const allProducts = ({ includeDrafts = true } = {}) => {
    const data = getData();
    const state = getLifecycleState();
    const records = [];
    const addRecords = (items, source) => (items || []).forEach(item => {
      if (item && productKey(item)) records.push({ item, source });
    });

    addRecords(data?.skus, "sku");
    addRecords(data?.productPool, "productPool");
    if (includeDrafts) addRecords(state?.draftProducts, "draft");

    const barcodeGroups = new Map();
    const noBarcodeGroups = new Map();

    records.forEach(record => {
      const item = record.item;
      const barcode = barcodeOf(item);
      const name = normalizedName(item);
      if (barcode) {
        if (!barcodeGroups.has(barcode)) {
          barcodeGroups.set(barcode, { records: [], barcodes: new Set(), names: new Set() });
        }
        const group = barcodeGroups.get(barcode);
        group.records.push(record);
        group.barcodes.add(barcode);
        if (name) group.names.add(name);
      } else if (name) {
        if (!noBarcodeGroups.has(name)) noBarcodeGroups.set(name, []);
        noBarcodeGroups.get(name).push(record);
      }
    });

    const groups = [...barcodeGroups.values()];
    const barcodeGroupsByName = new Map();
    groups.forEach(group => group.names.forEach(name => {
      if (!barcodeGroupsByName.has(name)) barcodeGroupsByName.set(name, []);
      barcodeGroupsByName.get(name).push(group);
    }));

    noBarcodeGroups.forEach((nameRecords, name) => {
      const candidates = barcodeGroupsByName.get(name) || [];
      if (candidates.length === 1) {
        const group = candidates[0];
        group.records.push(...nameRecords);
        group.names.add(name);
      } else {
        groups.push({ records: nameRecords, barcodes: new Set(), names: new Set([name]) });
      }
    });

    return groups.map(mergeViewGroup);
  };

  const effectiveProducts = () => {
    const data = getData();
    const state = getLifecycleState();
    return allProducts({ includeDrafts: false }).filter(product =>
      activeRows(data).some(row => sameProduct(row, product)) ||
      (product.active !== false && canonicalStatus(product, data, state) !== "已淘汰")
    );
  };

  const service = {
    productKey,
    sameProduct,
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

  const installDraftDuplicateGuard = child => {
    const form = child?.document?.getElementById("draftProductForm");
    if (!form || form.dataset.identityGuardInstalled === "1") return;
    form.dataset.identityGuardInstalled = "1";
    form.addEventListener("submit", event => {
      const formData = new child.FormData(form);
      const candidate = {
        name: text(formData.get("name")),
        barcode: text(formData.get("barcode"))
      };
      const duplicate = service.getAllProducts({ includeDrafts: true }).find(product =>
        service.sameProduct(product, candidate)
      );
      if (!duplicate) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      child.alert(`产品总池已存在“${duplicate.name || candidate.name}”，本次未重复创建。`);
    }, true);
  };

  const installChildBindings = () => {
    const frame = document.getElementById('productLifecycleFrame');
    const child = frame?.contentWindow;
    if (!child || typeof child.renderAll !== "function") return false;
    if (child.__unifiedProductStateInstalled) {
      installDraftDuplicateGuard(child);
      childBindingsInstalled = true;
      return true;
    }

    child.productStatus = product => service.getStatus(product);
    child.allProducts = () => service.getAllProducts({ includeDrafts: true }).map(item => {
      const copy = { ...item };
      delete copy.__unifiedSource;
      delete copy.__identityBarcodes;
      delete copy.__identityNames;
      delete copy.__draftOnly;
      return copy;
    });
    installDraftDuplicateGuard(child);
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
