(() => {
  "use strict";

  const lifecycleApi = window.ProductLifecycle;
  const rawGetData = lifecycleApi?.getData
    ? lifecycleApi.getData.bind(lifecycleApi)
    : () => window.UNIFIED_CARTON_DATA || null;

  let parentRefreshQueued = false;
  let childRefreshQueued = false;
  let parentBindingsInstalled = false;
  let childBindingsInstalled = false;

  const BARCODE_RE = /^\d{6,18}$/;
  const text = value => String(value ?? "").trim();
  const normalizeName = value => text(value).replace(/\s+/g, "").toLowerCase();
  const escapeHtml = value => text(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatNumber = (value, digits = 0) => number(value).toFixed(digits).replace(/\.0+$/, "");

  // 只生成统一读取身份，不回写 name、barcode 或任何业务数组。
  // 同时兼容历史异常记录：name=条码、barcode=商品名。
  const canonicalIdentity = product => {
    const rawName = text(product?.name);
    const rawBarcode = text(product?.barcode);
    const nameIsBarcode = BARCODE_RE.test(rawName);
    const barcodeIsBarcode = BARCODE_RE.test(rawBarcode);

    let barcode = "";
    let name = "";

    if (barcodeIsBarcode) {
      barcode = rawBarcode;
      name = nameIsBarcode ? "" : rawName;
    } else if (nameIsBarcode && rawBarcode && !barcodeIsBarcode) {
      barcode = rawName;
      name = rawBarcode;
    } else if (nameIsBarcode) {
      barcode = rawName;
      name = "";
    } else {
      name = rawName || rawBarcode;
    }

    return {
      barcode,
      name,
      normalizedName: normalizeName(name)
    };
  };

  const productKey = product => {
    const identity = canonicalIdentity(product);
    return identity.barcode || identity.name;
  };

  const sameProduct = (left, right) => {
    const a = canonicalIdentity(left);
    const b = canonicalIdentity(right);
    if (a.barcode && b.barcode) return a.barcode === b.barcode;
    return Boolean(a.normalizedName && b.normalizedName && a.normalizedName === b.normalizedName);
  };

  const taskProduct = task => ({
    name: text(task?.productName),
    barcode: text(task?.productKey)
  });

  const getData = () => rawGetData() || window.UNIFIED_CARTON_DATA || null;
  const getLifecycleState = () => lifecycleApi?.getState?.() || getData()?.lifecycle || {
    draftProducts: [], tasks: [], slots: [], committedPatches: [], productPatches: []
  };

  const rawActiveRows = (data = getData()) => (data?.skus || []).filter(row =>
    row &&
    row.included !== false &&
    row.active !== false &&
    row.lifecycleStatus !== "已淘汰"
  );

  const matchingTasks = (product, state = getLifecycleState()) => (state?.tasks || []).filter(task =>
    sameProduct(taskProduct(task), product)
  );

  // 商品状态只使用“完成结果”。任务是否待执行、部分完成由任务中心单独显示。
  const latestCompletedTask = (product, state = getLifecycleState()) => matchingTasks(product, state).find(task =>
    task?.status === "已完成"
  ) || null;

  const latestTask = (product, state = getLifecycleState()) => matchingTasks(product, state).find(task =>
    !["已撤销", "部分撤销", "已撤回", "部分撤回"].includes(task?.status)
  ) || null;

  const canonicalStatus = (product, data = getData(), state = getLifecycleState()) => {
    if (!productKey(product)) return "淘汰完成";

    const completed = latestCompletedTask(product, state);
    if (completed?.type === "上新") return "上新完成";
    if (completed?.type === "淘汰") return "淘汰完成";
    if (completed?.type === "恢复") return "恢复完成";

    const isDraft = (state?.draftProducts || []).some(item => sameProduct(item, product));
    const isActive = rawActiveRows(data).some(row => sameProduct(row, product));

    if (isActive) return "正常在售";
    if (isDraft) return "新品草稿";
    if (product?.active === false || product?.included === false || product?.lifecycleStatus === "已淘汰") {
      return "淘汰完成";
    }
    return "正常在售";
  };

  const sourcePriority = source => ({ productPool: 30, sku: 20, draft: 10 }[source] || 0);
  const completenessScore = record => {
    const item = record?.item || {};
    const identity = canonicalIdentity(item);
    const dimensions = [item.length, item.width, item.height].filter(value => number(value) > 0).length;
    return sourcePriority(record?.source) * 1000 +
      (identity.barcode ? 100 : 0) +
      (identity.name ? 30 : 0) +
      dimensions * 12 +
      (number(item.carton) > 0 ? 8 : 0) +
      (text(item.category3) ? 6 : 0) +
      (text(item.category4) ? 6 : 0) +
      (text(item.grade) ? 4 : 0) +
      (item.imageData ? 3 : 0);
  };

  const mergeViewGroup = group => {
    const preferredRecord = group.records.reduce((best, record) =>
      completenessScore(record) > completenessScore(best) ? record : best
    , group.records[0] || { item: {}, source: "" });
    const merged = { ...(preferredRecord.item || {}) };
    const fields = [
      "id", "grade", "rank", "category2", "category3", "category4", "scene",
      "length", "width", "height", "volume", "carton", "dailyQty", "dailySales",
      "moq", "moqDays", "faceWidth", "imageData", "active"
    ];

    group.records
      .slice()
      .sort((a, b) => completenessScore(b) - completenessScore(a))
      .forEach(record => {
        const item = record.item || {};
        fields.forEach(field => {
          const current = merged[field];
          const incoming = item[field];
          const currentMissing = current === undefined || current === null || current === "" || current === 0;
          const incomingValid = incoming !== undefined && incoming !== null && incoming !== "" && incoming !== 0;
          if (currentMissing && incomingValid) merged[field] = incoming;
        });
      });

    merged.name = [...group.names][0] || canonicalIdentity(preferredRecord.item).name || text(merged.name);
    merged.barcode = [...group.barcodes][0] || canonicalIdentity(preferredRecord.item).barcode || "";
    merged.__identityBarcodes = [...group.barcodes];
    merged.__identityNames = [...group.normalizedNames];
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
      const identity = canonicalIdentity(record.item);
      if (identity.barcode) {
        if (!barcodeGroups.has(identity.barcode)) {
          barcodeGroups.set(identity.barcode, {
            records: [], barcodes: new Set(), names: new Set(), normalizedNames: new Set()
          });
        }
        const group = barcodeGroups.get(identity.barcode);
        group.records.push(record);
        group.barcodes.add(identity.barcode);
        if (identity.name) group.names.add(identity.name);
        if (identity.normalizedName) group.normalizedNames.add(identity.normalizedName);
      } else if (identity.normalizedName) {
        if (!noBarcodeGroups.has(identity.normalizedName)) noBarcodeGroups.set(identity.normalizedName, []);
        noBarcodeGroups.get(identity.normalizedName).push(record);
      }
    });

    const groups = [...barcodeGroups.values()];
    const barcodeGroupsByName = new Map();
    groups.forEach(group => group.normalizedNames.forEach(name => {
      if (!barcodeGroupsByName.has(name)) barcodeGroupsByName.set(name, []);
      barcodeGroupsByName.get(name).push(group);
    }));

    noBarcodeGroups.forEach((nameRecords, normalizedName) => {
      const candidates = barcodeGroupsByName.get(normalizedName) || [];
      if (candidates.length === 1) {
        const group = candidates[0];
        group.records.push(...nameRecords);
        nameRecords.forEach(record => {
          const identity = canonicalIdentity(record.item);
          if (identity.name) group.names.add(identity.name);
          if (identity.normalizedName) group.normalizedNames.add(identity.normalizedName);
        });
      } else {
        const names = new Set();
        nameRecords.forEach(record => {
          const identity = canonicalIdentity(record.item);
          if (identity.name) names.add(identity.name);
        });
        groups.push({
          records: nameRecords,
          barcodes: new Set(),
          names,
          normalizedNames: new Set([normalizedName])
        });
      }
    });

    return groups.map(mergeViewGroup);
  };

  const logicalActiveRows = (data = getData(), state = getLifecycleState()) => rawActiveRows(data).filter(row =>
    canonicalStatus(row, data, state) !== "淘汰完成"
  );

  const effectiveProducts = () => {
    const data = getData();
    const state = getLifecycleState();
    const active = logicalActiveRows(data, state);
    return allProducts({ includeDrafts: false }).filter(product => {
      const status = canonicalStatus(product, data, state);
      if (["淘汰完成", "新品草稿"].includes(status)) return false;
      return active.some(row => sameProduct(row, product)) || product.active !== false;
    });
  };

  const coverageCount = product => {
    const stores = new Set();
    logicalActiveRows().forEach(row => {
      if (sameProduct(row, product) && row.store) stores.add(row.store);
    });
    return stores.size;
  };

  const service = {
    canonicalIdentity,
    productKey,
    sameProduct,
    getData,
    getLifecycleState,
    getActiveRows: logicalActiveRows,
    getRawActiveRows: rawActiveRows,
    getStatus: canonicalStatus,
    getLatestTask: latestTask,
    getLatestCompletedTask: latestCompletedTask,
    getAllProducts: allProducts,
    getEffectiveProducts: effectiveProducts,
    getCoverageCount: coverageCount
  };

  window.FrozenUnifiedProductState = service;

  // iframe 和扩展只读取快照。这里不授权任何原始数据清理、合并或迁移。
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

    // 老板块与生命周期板块共用同一个只读唯一键和有效池。
    window.SKU键 = row => service.productKey(row) || text(row?.id);
    window.产品键 = row => service.productKey(row);
    window.唯一SKU数 = rows => new Set((rows || []).map(service.productKey).filter(Boolean)).size;
    window.有效SKU池 = () => service.getEffectiveProducts();
    window.产品池有效 = () => service.getEffectiveProducts();
    if (typeof window.产品展示名 === "function") {
      window.产品展示名 = row => service.canonicalIdentity(row).name || text(row?.name) || service.productKey(row);
    }

    parentBindingsInstalled = true;
    return true;
  };

  const displayStatus = status => ({
    "待上新": "上新任务执行中",
    "待淘汰": "淘汰任务执行中",
    "恢复中": "恢复任务执行中",
    "已淘汰": "淘汰完成"
  })[status] || status;

  const statusClass = status => ({
    "正常在售": "status-normal",
    "新品草稿": "status-launch",
    "上新完成": "status-normal",
    "淘汰完成": "status-archived",
    "恢复完成": "status-restore",
    "上新任务执行中": "status-launch",
    "淘汰任务执行中": "status-retire",
    "恢复任务执行中": "status-restore"
  })[displayStatus(status)] || "status-archived";

  const statusTag = status => {
    const label = displayStatus(status);
    return `<span class="tag ${statusClass(label)}">${escapeHtml(label)}</span>`;
  };
  const gradeTag = grade => `<span class="tag ${text(grade).toLowerCase()}">${escapeHtml(grade || "未评级")}</span>`;
  const metric = (label, value, sub = "", cls = "") =>
    `<div class="metric ${cls}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;

  const updatePoolStatusFilter = child => {
    const select = child?.document?.getElementById("poolStatusFilter");
    if (!select || select.dataset.unifiedStatuses === "1") return;
    const current = select.value;
    const statuses = ["", "正常在售", "新品草稿", "上新完成", "淘汰完成", "恢复完成"];
    select.innerHTML = statuses.map(status =>
      `<option value="${escapeHtml(status)}">${status ? escapeHtml(status) : "全部状态"}</option>`
    ).join("");
    if (statuses.includes(current)) select.value = current;
    select.dataset.unifiedStatuses = "1";
  };

  const openTaskInChild = (child, product) => {
    const task = service.getLatestTask(product) || service.getLatestCompletedTask(product);
    if (!task) {
      child.alert("没有找到对应任务。");
      return;
    }
    child.switchView?.("tasks");
    child.showTask?.(task.id);
  };

  const poolActionHtml = (product, status) => {
    const key = encodeURIComponent(service.productKey(product));
    if (status === "新品草稿") {
      return `<button class="mini-btn primary" data-action="launch" data-key="${key}">上新</button>`;
    }
    if (status === "淘汰完成") {
      return `<div class="mini-actions"><button class="mini-btn" data-action="task" data-key="${key}">查看任务</button><button class="mini-btn primary" data-action="restore" data-key="${key}">恢复在售</button></div>`;
    }
    if (status === "上新完成" || status === "恢复完成") {
      return `<div class="mini-actions"><button class="mini-btn" data-action="task" data-key="${key}">查看任务</button><button class="mini-btn danger" data-action="retire" data-key="${key}">淘汰</button></div>`;
    }
    return `<button class="mini-btn danger" data-action="retire" data-key="${key}">淘汰</button>`;
  };

  const bindPoolActions = child => {
    const table = child?.document?.getElementById("poolTable");
    if (!table) return;
    table.querySelectorAll("button[data-action]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        const key = decodeURIComponent(button.dataset.key || "");
        const product = service.getAllProducts({ includeDrafts: true }).find(item => service.productKey(item) === key);
        if (!product) return;
        if (button.dataset.action === "launch") child.prefillLaunch?.(key);
        if (button.dataset.action === "retire") child.prefillRetire?.(key);
        if (button.dataset.action === "restore") child.prefillRestore?.(key);
        if (button.dataset.action === "task") openTaskInChild(child, product);
      });
    });
  };

  const normalizeLifecycleLabels = child => {
    const document = child?.document;
    if (!document) return;
    const replacements = new Map([
      ["待上新", "上新任务执行中"],
      ["待淘汰", "淘汰任务执行中"],
      ["恢复中", "恢复任务执行中"],
      ["待淘汰/替换", "淘汰/替换任务"],
      ["待上新商品", "上新任务商品"]
    ]);
    document.querySelectorAll(".planogram-legend .legend-chip, #planogramMetrics .label, .sku-block small, .monitor-grid dd, .monitor-note").forEach(element => {
      let value = element.textContent || "";
      replacements.forEach((next, previous) => { value = value.replaceAll(previous, next); });
      if (value !== element.textContent) element.textContent = value;
    });
  };

  const installUnifiedPlanogramLabels = child => {
    if (!child || child.__unifiedPlanogramLabelsInstalled || typeof child.renderPlanogram !== "function") return;
    const originalRenderPlanogram = child.renderPlanogram.bind(child);
    child.renderPlanogram = (...args) => {
      const result = originalRenderPlanogram(...args);
      normalizeLifecycleLabels(child);
      return result;
    };
    if (typeof child.showMonitor === "function") {
      const originalShowMonitor = child.showMonitor.bind(child);
      child.showMonitor = (...args) => {
        const result = originalShowMonitor(...args);
        normalizeLifecycleLabels(child);
        return result;
      };
    }
    child.__unifiedPlanogramLabelsInstalled = true;
  };

  const installUnifiedPoolRenderer = child => {
    if (!child || child.__unifiedPoolRendererInstalled) return;

    child.statusTag = statusTag;
    child.renderPool = () => {
      updatePoolStatusFilter(child);
      const document = child.document;
      const all = service.getAllProducts({ includeDrafts: true });
      const effective = service.getEffectiveProducts();
      const state = service.getLifecycleState();
      const totalStores = (service.getData()?.stores || []).length;
      const statuses = all.map(product => service.getStatus(product));

      const metrics = document.getElementById("poolMetrics");
      if (metrics) {
        metrics.innerHTML = [
          metric("有效SKU", effective.length, "与门店执行使用同一统一SKU口径"),
          metric("正常在售", effective.filter(product => service.getStatus(product) === "正常在售").length, "未发生已完成生命周期变更", "good"),
          metric("新品草稿", statuses.filter(status => status === "新品草稿").length, "尚未完成上新，不计入有效SKU"),
          metric("上新完成", statuses.filter(status => status === "上新完成").length, "已完成任务并纳入有效SKU", "good"),
          metric("淘汰完成", statuses.filter(status => status === "淘汰完成").length, "已完成淘汰，不计入有效SKU", "warn"),
          metric("恢复完成", statuses.filter(status => status === "恢复完成").length, "已完成恢复并重新纳入有效SKU"),
          metric("坑位资源", (state.slots || []).length, "释放与预留位置"),
          metric("进行中任务", (state.tasks || []).filter(task => !["已完成", "已撤销", "已撤回"].includes(task.status)).length, "任务状态只在任务中心展示")
        ].join("");
      }

      const search = text(document.getElementById("poolSearch")?.value);
      const statusFilter = text(document.getElementById("poolStatusFilter")?.value);
      const rows = all
        .filter(product => {
          const haystack = [product.name, product.barcode, product.category3, product.category4].map(text).join(" ");
          const status = service.getStatus(product);
          return (!search || haystack.includes(search)) && (!statusFilter || status === statusFilter);
        })
        .sort((a, b) => number(a.rank || 9999) - number(b.rank || 9999));

      const table = document.getElementById("poolTable");
      if (!table) return;
      if (!rows.length) {
        table.innerHTML = '<div class="empty">没有匹配数据。</div>';
        return;
      }

      table.innerHTML = `<table><thead><tr>
        <th>商品</th><th>等级</th><th>三级/四级类目</th><th>尺寸</th><th>箱规</th><th>门店覆盖</th><th>生命周期</th><th>操作</th>
      </tr></thead><tbody>${rows.map(product => {
        const status = service.getStatus(product);
        const coverage = service.getCoverageCount(product);
        const percentage = totalStores ? Math.round(coverage / totalStores * 100) : 0;
        return `<tr>
          <td class="name"><strong>${escapeHtml(product.name || service.productKey(product))}</strong><br><small>${escapeHtml(product.barcode || "暂无条码")}</small></td>
          <td>${gradeTag(product.grade)}</td>
          <td>${escapeHtml(product.category3 || "-")} / ${escapeHtml(product.category4 || "-")}</td>
          <td>${formatNumber(product.length)}×${formatNumber(product.width)}×${formatNumber(product.height)}mm</td>
          <td>${formatNumber(product.carton)}</td>
          <td><div class="coverage"><div class="coverage-bar"><i style="width:${percentage}%"></i></div><span>${coverage}/${totalStores}</span></div></td>
          <td>${statusTag(status)}</td>
          <td>${poolActionHtml(product, status)}</td>
        </tr>`;
      }).join("")}</tbody></table>`;

      bindPoolActions(child);
    };

    ["poolSearch", "poolStatusFilter"].forEach(id => {
      const element = child.document.getElementById(id);
      if (element) element.oninput = child.renderPool;
    });
    child.__unifiedPoolRendererInstalled = true;
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
    const frame = document.getElementById("productLifecycleFrame");
    const child = frame?.contentWindow;
    if (!child || typeof child.renderAll !== "function") return false;

    child.productStatus = product => service.getStatus(product);
    child.allProducts = () => service.getAllProducts({ includeDrafts: true }).map(item => {
      const copy = { ...item };
      delete copy.__unifiedSource;
      delete copy.__identityBarcodes;
      delete copy.__identityNames;
      delete copy.__draftOnly;
      return copy;
    });
    installUnifiedPoolRenderer(child);
    installUnifiedPlanogramLabels(child);
    installDraftDuplicateGuard(child);

    if (!child.__unifiedProductStateInstalled) {
      child.__unifiedProductStateInstalled = true;
      child.renderAll();
      normalizeLifecycleLabels(child);
    } else {
      child.renderPool();
      child.renderTasks?.();
      child.renderProductCards?.();
      child.renderPlanogram?.();
      normalizeLifecycleLabels(child);
    }

    childBindingsInstalled = true;
    return true;
  };

  const refreshChild = () => {
    if (childRefreshQueued) return;
    childRefreshQueued = true;
    requestAnimationFrame(() => {
      childRefreshQueued = false;
      installChildBindings();
      const frame = document.getElementById("productLifecycleFrame");
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

  const lifecycleFrame = document.getElementById("productLifecycleFrame");
  lifecycleFrame?.addEventListener("load", () => setTimeout(() => {
    installChildBindings();
    refreshChild();
  }, 0));

  window.addEventListener("load", () => {
    installParentBindings();
    installChildBindings();
    refreshParentAndChild();
  }, { once: true });

  window.addEventListener("message", event => {
    if (event.data?.type === "plm:product-image-updated") {
      window.dispatchEvent(new CustomEvent("product-image:updated", { detail: event.data }));
    }
  });

  window.addEventListener("product-lifecycle:state-changed", refreshParentAndChild);
  window.addEventListener("product-lifecycle:data-committed", refreshParentAndChild);
  window.addEventListener("product-lifecycle:state-hydrated", refreshParentAndChild);
  window.addEventListener("product-lifecycle:product-updated", event => {
    if (event.detail?.changes?.imageData) return;
    refreshParentAndChild();
  });

  syncLifecycleHostMode();
  setTimeout(installParentBindings, 0);
})();
