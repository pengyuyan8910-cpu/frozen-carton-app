(() => {
  "use strict";

  const BARCODE_RE = /^\d{6,18}$/;
  const text = value => String(value ?? "").trim();
  const normalizedName = value => text(value).replace(/\s+/g, "").toLowerCase();
  const escapeHtml = value => text(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const toNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const format = value => String(Math.round(toNumber(value) * 100) / 100);
  const readData = () => window.ProductLifecycle?.getData?.() || window.UNIFIED_CARTON_DATA || {};
  const readState = () => window.ProductLifecycle?.getState?.() || {};

  function identity(item) {
    const rawName = text(item?.name);
    const rawBarcode = text(item?.barcode);
    const nameIsBarcode = BARCODE_RE.test(rawName);
    const barcodeIsBarcode = BARCODE_RE.test(rawBarcode);

    if (barcodeIsBarcode) {
      return { name: nameIsBarcode ? "" : rawName, barcode: rawBarcode };
    }
    if (nameIsBarcode && rawBarcode && !barcodeIsBarcode) {
      return { name: rawBarcode, barcode: rawName };
    }
    if (nameIsBarcode) {
      return { name: "", barcode: rawName };
    }
    return { name: rawName || rawBarcode, barcode: "" };
  }

  function productKey(item) {
    const value = identity(item);
    return value.barcode || value.name;
  }

  function displayName(item) {
    const value = identity(item);
    return value.name || text(item?.name) || value.barcode;
  }

  function sameProduct(left, right) {
    const a = identity(left);
    const b = identity(right);
    if (a.barcode && b.barcode) return a.barcode === b.barcode;
    return Boolean(a.name && b.name && normalizedName(a.name) === normalizedName(b.name));
  }

  function mergedProduct(existing, incoming) {
    if (!existing) {
      const normalized = identity(incoming);
      return { ...incoming, name: normalized.name || text(incoming?.name), barcode: normalized.barcode };
    }
    const current = { ...existing };
    const normalized = identity(incoming);
    const fields = [
      "grade", "rank", "category2", "category3", "category4", "length", "width", "height",
      "volume", "carton", "dailyQty", "dailySales", "moq", "moqDays", "faceWidth", "imageData", "active"
    ];
    if (!current.name && normalized.name) current.name = normalized.name;
    if (!current.barcode && normalized.barcode) current.barcode = normalized.barcode;
    for (const field of fields) {
      const currentMissing = current[field] === undefined || current[field] === null || current[field] === "" || current[field] === 0;
      const incomingValue = incoming?.[field];
      const incomingValid = incomingValue !== undefined && incomingValue !== null && incomingValue !== "" && incomingValue !== 0;
      if (currentMissing && incomingValid) current[field] = incomingValue;
    }
    return current;
  }

  function patchParent() {
    if (window.__lifecycleConsistencyParentInstalled) return;
    if (typeof window.唯一SKU数 !== "function" || typeof window.SKU键 !== "function") return;

    window.产品键 = productKey;
    window.SKU键 = productKey;
    window.唯一SKU数 = rows => new Set((rows || []).map(productKey).filter(Boolean)).size;
    if (typeof window.产品展示名 === "function") window.产品展示名 = displayName;

    patchGoodsRenderer();
    requestAnimationFrame(updateGoodsSummaryCount);
    window.__lifecycleConsistencyParentInstalled = true;
  }

  function currentStoreUniqueCount() {
    const store = document.getElementById("storeSelect")?.value || "";
    if (!store || typeof window.纳入SKU !== "function") return 0;
    const rows = window.纳入SKU(store);
    return new Set((Array.isArray(rows) ? rows : []).map(productKey).filter(Boolean)).size;
  }

  function updateGoodsSummaryCount() {
    const summary = document.getElementById("storeGoodsSummary");
    if (!summary) return;
    const cards = summary.querySelectorAll(".store-goods-card");
    if (cards.length < 2) return;
    const value = cards[1].querySelector("strong");
    if (value) value.textContent = String(currentStoreUniqueCount());
  }

  function patchGoodsRenderer() {
    if (window.__lifecycleConsistencyGoodsPatched) return;
    if (typeof window.渲染商品 === "function") {
      const original = window.渲染商品.bind(window);
      window.渲染商品 = (...args) => {
        const result = original(...args);
        requestAnimationFrame(updateGoodsSummaryCount);
        return result;
      };
    }
    document.getElementById("storeSelect")?.addEventListener("change", () => requestAnimationFrame(updateGoodsSummaryCount));
    window.__lifecycleConsistencyGoodsPatched = true;
  }

  function latestCompletedTask(child, product) {
    return (readState().tasks || []).find(task => task?.status === "已完成" && sameProduct({
      name: task.productName,
      barcode: BARCODE_RE.test(text(task.productKey)) ? task.productKey : ""
    }, product)) || null;
  }

  function lifecycleStatus(child, product) {
    const completed = latestCompletedTask(child, product);
    if (completed?.type === "上新") return "上新完成";
    if (completed?.type === "淘汰") return "淘汰完成";
    if (completed?.type === "恢复") return "恢复完成";

    const active = (readData().skus || []).some(row =>
      row?.included !== false &&
      row?.active !== false &&
      row?.lifecycleStatus !== "已淘汰" &&
      sameProduct(row, product)
    );
    if (active) return "正常在售";
    const draft = (readState().draftProducts || []).some(item => sameProduct(item, product));
    if (draft) return "新品草稿";
    if (product?.active === false || product?.included === false || product?.lifecycleStatus === "已淘汰") return "淘汰完成";
    return "正常在售";
  }

  function childProducts(child) {
    const map = new Map();
    const source = [
      ...(readData().productPool || []),
      ...(readData().skus || []),
      ...(readState().draftProducts || [])
    ];
    for (const item of source) {
      const key = productKey(item);
      if (!key) continue;
      map.set(key, mergedProduct(map.get(key), item));
    }
    return [...map.values()];
  }

  function coverageMap(child) {
    const result = new Map();
    for (const row of readData().skus || []) {
      if (row?.included === false || row?.active === false || row?.lifecycleStatus === "已淘汰") continue;
      const key = productKey(row);
      if (!key || !row.store) continue;
      if (!result.has(key)) result.set(key, new Set());
      result.get(key).add(row.store);
    }
    return result;
  }

  function statusTag(child, status) {
    const classes = {
      "正常在售": "status-normal",
      "新品草稿": "status-launch",
      "上新完成": "status-normal",
      "淘汰完成": "status-archived",
      "恢复完成": "status-restore"
    };
    return `<span class="tag ${classes[status] || "status-archived"}">${escapeHtml(status)}</span>`;
  }

  function replaceStatusOptions(child) {
    const select = child.document.getElementById("poolStatusFilter");
    if (!select || select.dataset.lifecycleConsistency === "1") return;
    const current = select.value;
    const values = ["", "正常在售", "新品草稿", "上新完成", "淘汰完成", "恢复完成"];
    select.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${value || "全部状态"}</option>`).join("");
    if (values.includes(current)) select.value = current;
    select.dataset.lifecycleConsistency = "1";
  }

  function patchChildPool(child) {
    child.allProducts = () => childProducts(child);
    child.productStatus = product => lifecycleStatus(child, product);
    child.productByKey = key => childProducts(child).find(product => productKey(product) === key);
    child.rowsForProduct = key => (readData().skus || []).filter(row => productKey(row) === key);
    child.taskProductStatus = task => {
      const product = childProducts(child).find(item => sameProduct(item, {
        name: task.productName,
        barcode: BARCODE_RE.test(text(task.productKey)) ? task.productKey : ""
      }));
      return product ? lifecycleStatus(child, product) : task.status === "已完成"
        ? task.type === "上新" ? "上新完成" : task.type === "淘汰" ? "淘汰完成" : task.type === "恢复" ? "恢复完成" : "-"
        : "-";
    };
    child.statusTag = status => statusTag(child, status);

    child.renderPool = () => {
      replaceStatusOptions(child);
      const products = childProducts(child);
      const statuses = products.map(product => lifecycleStatus(child, product));
      const effective = products.filter(product => ["正常在售", "上新完成", "恢复完成"].includes(lifecycleStatus(child, product)));
      const stores = (readData().stores || []).map(store => typeof store === "string" ? store : store.store).filter(Boolean);
      const coverages = coverageMap(child);

      child.document.getElementById("poolMetrics").innerHTML = [
        child.metric("有效SKU", effective.length, "与门店执行使用同一SKU唯一键"),
        child.metric("正常在售", statuses.filter(value => value === "正常在售").length, "未发生已完成生命周期变更", "good"),
        child.metric("新品草稿", statuses.filter(value => value === "新品草稿").length, "尚未完成上新，不计入有效SKU"),
        child.metric("上新完成", statuses.filter(value => value === "上新完成").length, "已完成上新并计入有效SKU", "good"),
        child.metric("淘汰完成", statuses.filter(value => value === "淘汰完成").length, "已完成淘汰，不计入有效SKU", "warn"),
        child.metric("恢复完成", statuses.filter(value => value === "恢复完成").length, "已完成恢复并计入有效SKU"),
        child.metric("坑位资源", readState().slots?.length || 0, "释放与预留位置"),
        child.metric("进行中任务", (readState().tasks || []).filter(task => !["已完成", "已撤销", "已撤回"].includes(task.status)).length, "仅在任务中心显示执行状态")
      ].join("");

      const query = text(child.document.getElementById("poolSearch")?.value);
      const filter = text(child.document.getElementById("poolStatusFilter")?.value);
      const rows = products.filter(product => {
        const status = lifecycleStatus(child, product);
        const haystack = [displayName(product), identity(product).barcode, product.category3, product.category4].map(text).join(" ");
        return (!query || haystack.includes(query)) && (!filter || status === filter);
      }).sort((a, b) => toNumber(a.rank || 9999) - toNumber(b.rank || 9999));

      child.document.getElementById("poolTable").innerHTML = child.table([
        { name: "商品", cls: "name", render: product => `<strong>${escapeHtml(displayName(product))}</strong><br><small>${escapeHtml(identity(product).barcode || "暂无条码")}</small>` },
        { name: "等级", render: product => child.gradeTag(product.grade) },
        { name: "三级/四级类目", render: product => `${escapeHtml(product.category3 || "-")} / ${escapeHtml(product.category4 || "-")}` },
        { name: "尺寸", render: product => `${format(product.length)}×${format(product.width)}×${format(product.height)}mm` },
        { name: "箱规", render: product => format(product.carton) },
        { name: "门店覆盖", render: product => {
          const count = coverages.get(productKey(product))?.size || 0;
          const percentage = stores.length ? Math.round(count / stores.length * 100) : 0;
          return `<div class="coverage"><div class="coverage-bar"><i style="width:${percentage}%"></i></div><span>${count}/${stores.length}</span></div>`;
        } },
        { name: "生命周期", render: product => statusTag(child, lifecycleStatus(child, product)) },
        { name: "操作", render: product => {
          const status = lifecycleStatus(child, product);
          const key = escapeHtml(productKey(product));
          if (status === "新品草稿") return `<button class="mini-btn primary" onclick="prefillLaunch('${key}')">上新</button>`;
          if (status === "淘汰完成") return `<div class="mini-actions"><button class="mini-btn" onclick="openProductTask('${key}','淘汰')">查看任务</button><button class="mini-btn primary" onclick="prefillRestore('${key}')">恢复在售</button></div>`;
          return `<div class="mini-actions"><button class="mini-btn danger" onclick="prefillRetire('${key}')">淘汰</button></div>`;
        } }
      ], rows);
    };

    const search = child.document.getElementById("poolSearch");
    const filter = child.document.getElementById("poolStatusFilter");
    if (search) search.oninput = child.renderPool;
    if (filter) filter.onchange = child.renderPool;
  }

  function patchPlanogramLabels(child) {
    const apply = () => {
      const nodes = child.document.querySelectorAll(".planogram-legend .legend-chip, .sku-block small, .monitor-grid dd, .monitor-note");
      nodes.forEach(node => {
        let value = node.textContent || "";
        value = value.replaceAll("待上新", "上新任务执行中")
          .replaceAll("待淘汰", "淘汰任务执行中")
          .replaceAll("恢复中", "恢复任务执行中");
        if (value !== node.textContent) node.textContent = value;
      });
    };
    if (!child.__lifecycleConsistencyPlanogramPatched && typeof child.renderPlanogram === "function") {
      const original = child.renderPlanogram.bind(child);
      child.renderPlanogram = (...args) => {
        const result = original(...args);
        apply();
        return result;
      };
      child.__lifecycleConsistencyPlanogramPatched = true;
    }
    apply();
  }

  function patchChild() {
    const frame = document.getElementById("productLifecycleFrame");
    const child = frame?.contentWindow;
    if (!child || typeof child.renderPool !== "function") return false;
    const source = readData();
    if (!Array.isArray(source.skus) || !Array.isArray(source.stores)) return false;
    if (!child.__lifecycleConsistencyInstalled) {
      patchChildPool(child);
      patchPlanogramLabels(child);
      child.__lifecycleConsistencyInstalled = true;
    }
    child.renderPool();
    child.renderTasks?.();
    return true;
  }

  let refreshQueued = false;
  function refreshVisiblePanels() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      patchParent();
      document.querySelector(".tabs button.active")?.click();
      requestAnimationFrame(updateGoodsSummaryCount);
      patchChild();
    });
  }

  function install() {
    patchParent();
    const frame = document.getElementById("productLifecycleFrame");
    frame?.addEventListener("load", () => setTimeout(patchChild, 0));
    setTimeout(patchChild, 0);
    window.addEventListener("product-lifecycle:data-committed", refreshVisiblePanels);
    window.addEventListener("product-lifecycle:state-changed", refreshVisiblePanels);
  }

  window.FrozenLifecycleConsistency = { identity, productKey, sameProduct, lifecycleStatus };
  install();
})();