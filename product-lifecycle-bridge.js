(() => {
  "use strict";

  const STORAGE_KEY = "frozen_product_lifecycle_management_v2";
  const VERSION = 2;
  const FORMAL_DATA_ERROR = "正式底表加载失败，请检查 GitHub Actions。";
  let dataRef = null;
  let stateRef = null;
  let initialized = false;
  let productIndex = new Map();
  let formalCache = [];
  let activeCache = [];
  let activeAliasCache = new Set();

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function isFormalData(data) {
    return Boolean(
      data &&
      Array.isArray(data.stores) &&
      Array.isArray(data.skus) &&
      Array.isArray(data.cabinets)
    );
  }

  function showFormalDataError() {
    const view = document.getElementById("lifecycle");
    if (!view) return;
    let message = view.querySelector(".lifecycle-load-error");
    if (!message) {
      message = document.createElement("div");
      message.className = "lifecycle-load-error";
      message.setAttribute("role", "alert");
      message.style.cssText = "margin:24px;padding:20px;border:1px solid #dc2626;border-radius:8px;background:#fef2f2;color:#991b1b;font-weight:700;";
      view.prepend(message);
    }
    message.textContent = FORMAL_DATA_ERROR;
  }

  function loadLifecycleFrame() {
    const frame = document.getElementById("productLifecycleFrame");
    if (!frame || frame.getAttribute("src")) return;
    const source = frame.dataset.lifecycleSrc;
    if (source) {
      const separator = source.includes("?") ? "&" : "?";
      frame.setAttribute("src", `${source}${separator}build=20260811_planogram_reclaim_v4`);
    }
  }

  function blankState() {
    return {
      version: VERSION,
      draftProducts: [],
      tasks: [],
      slots: [],
      committedPatches: [],
      productPatches: [],
      updatedAt: ""
    };
  }

  function normalizeState(input) {
    const state = input && typeof input === "object" ? input : blankState();
    state.version = VERSION;
    state.draftProducts = Array.isArray(state.draftProducts) ? state.draftProducts : [];
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    state.slots = Array.isArray(state.slots) ? state.slots : [];
    state.committedPatches = Array.isArray(state.committedPatches) ? state.committedPatches : [];
    state.productPatches = Array.isArray(state.productPatches) ? state.productPatches : [];
    return state;
  }

  // 生命周期状态只允许嵌套在主文档中，避免运营端与店员端各持一份状态。
  function readLocalState() { return blankState(); }

  function writeState(next) {
    stateRef = normalizeState(clone(next));
    stateRef.updatedAt = new Date().toISOString();

    if (dataRef) dataRef.lifecycle = clone(stateRef);
    window.dispatchEvent(new CustomEvent("product-lifecycle:state-changed", { detail: clone(stateRef) }));
    return stateRef;
  }

  function skuIdentity(row) {
    return [
      row?.store || "",
      row?.barcode || "",
      row?.name || "",
      row?.cabinetKey || "",
      row?.position || ""
    ].join("||");
  }

  function findSku(data, patch) {
    if (!data || !Array.isArray(data.skus)) return null;
    if (patch.skuId) {
      const byId = data.skus.find(row => String(row.id) === String(patch.skuId));
      if (byId) return byId;
    }
    if (patch.identity) {
      const byIdentity = data.skus.find(row => skuIdentity(row) === patch.identity);
      if (byIdentity) return byIdentity;
    }
    const match = patch.match || {};
    return data.skus.find(row =>
      (!match.store || row.store === match.store) &&
      (!match.barcode || row.barcode === match.barcode) &&
      (!match.name || row.name === match.name) &&
      (!match.cabinetKey || row.cabinetKey === match.cabinetKey)
    ) || null;
  }

  function applyPatch(data, patch) {
    if (!data || !patch || !patch.type) return;
    data.skus = Array.isArray(data.skus) ? data.skus : [];

    if (patch.type === "addSku") {
      const exists = data.skus.some(row =>
        (row.lifecycleTaskId === patch.row?.lifecycleTaskId && row.lifecycleTaskRowId === patch.row?.lifecycleTaskRowId) ||
        (row.store === patch.row?.store && row.included !== false && itemsMatch(row, patch.row))
      );
      if (!exists && patch.row) data.skus.push(clone(patch.row));
      return;
    }

    const row = findSku(data, patch);
    if (!row) return;

    if (patch.type === "updateSku") {
      Object.assign(row, clone(patch.changes || {}));
    } else if (patch.type === "excludeSku") {
      row.included = false;
      row.lifecycleStatus = "已淘汰";
      row.lifecycleTaskId = patch.taskId || row.lifecycleTaskId;
    }
  }

  function applyProductPatch(data, patch) {
    if (!data || !patch?.matchKey) return;
    const match = item => identityValues(item).has(clean(patch.matchKey));
    const changes = clone(patch.changes || {});
    const skuChanges = clone(changes);
    delete skuChanges.imageData;
    (data.productPool || []).filter(match).forEach(item => Object.assign(item, changes));
    (data.skus || []).filter(match).forEach(item => Object.assign(item, skuChanges));
  }

  function applyCommittedPatches(data, state) {
    (state.productPatches || []).forEach(patch => applyProductPatch(data, patch));
    (state.committedPatches || []).forEach(patch => applyPatch(data, patch));
    data.lifecycle = clone(state);
    return data;
  }

  function updateProduct(matchKey, changes) {
    if (!dataRef || !matchKey || !changes || typeof changes !== "object") return false;
    const state = normalizeState(stateRef || blankState());
    const existing = state.productPatches.find(item => item.matchKey === matchKey);
    if (existing) Object.assign(existing.changes, clone(changes));
    else state.productPatches.push({ matchKey, changes: clone(changes), updatedAt: new Date().toISOString() });
    applyProductPatch(dataRef, { matchKey, changes });
    rebuildProductCache();
    writeState(state);
    window.dispatchEvent(new CustomEvent("product-lifecycle:product-updated", { detail: { matchKey, changes: clone(changes) } }));
    if (Object.prototype.hasOwnProperty.call(changes, "imageData")) window.dispatchEvent(new CustomEvent("product-image:updated", { detail: { matchKey } }));
    return true;
  }

  function prepareData(data) {
    if (!isFormalData(data)) {
      dataRef = null;
      showFormalDataError();
      return false;
    }
    dataRef = data;
    const embedded = data.lifecycle && typeof data.lifecycle === "object" ? data.lifecycle : null;
    const state = embedded ? normalizeState(embedded) : blankState();
    stateRef = state;
    reconcileLifecycleData(dataRef, stateRef);
    return true;
  }

  function notifyLifecycleFrame(type = "plm:data-refreshed") {
    const frame = document.getElementById("productLifecycleFrame");
    frame?.contentWindow?.postMessage({ type }, "*");
  }
  function syncData(data) {
    if (!isFormalData(data)) return false;
    if (data === dataRef) {
      if (stateRef) data.lifecycle = clone(stateRef);
      return true;
    }
    dataRef = data;
    reconcileLifecycleData(dataRef, stateRef || blankState());
    dataRef.lifecycle = clone(stateRef || blankState());
    notifyLifecycleFrame();
    return true;
  }

  // A cloud pull is authoritative: replace this browser's cached lifecycle state.
  function hydrateState(next, data) {
    stateRef = normalizeState(clone(next || blankState()));
    if (isFormalData(data)) dataRef = data;
    if (dataRef) {
      reconcileLifecycleData(dataRef, stateRef);
      dataRef.lifecycle = clone(stateRef);
    }

    window.dispatchEvent(new CustomEvent("product-lifecycle:state-hydrated", { detail: clone(stateRef) }));
    notifyLifecycleFrame("plm:state-hydrated");
    return clone(stateRef);
  }
  function persistStateCache() {

    if (dataRef) dataRef.lifecycle = clone(stateRef || blankState());
  }
  function getProduct(task) {
    if (!dataRef) return {};
const pool = Array.isArray(dataRef.productPool) ? dataRef.productPool : [];
    const byPool = pool.find(item => itemsMatch(item, task));
    if (byPool) return byPool;
    const byDraft = (stateRef?.draftProducts || []).find(item => itemsMatch(item, task));
    if (byDraft) return byDraft;
    return (dataRef.skus || []).find(item => itemsMatch(item, task)) || {};
  }

  function buildLaunchRow(task, row, index) {
    const product = getProduct(task);
    return {
      id: `lifecycle_${task.id}_${index}`,
      lifecycleTaskId: task.id,
      lifecycleTaskRowId: row.id || `${task.id}_${index}`,
      lifecycleStatus: "上新完成",
      store: row.store,
      included: true,
      active: true,
      name: row.productName || task.productName || product.name,
      barcode: row.barcode || product.barcode || "",
      grade: row.grade || product.grade || "B",
      rank: number(row.rank || product.rank || 9999),
      category3: row.category3 || product.category3 || "",
      category4: row.category4 || product.category4 || "",
      scene: row.scene || product.scene || "",
      length: number(row.length || product.length),
      width: number(row.width || product.width),
      height: number(row.height || product.height),
      volume: number(row.volume || product.volume),
      carton: number(row.carton || product.carton || 1),
      dailyQty: number(row.dailyQty || product.dailyQty),
      cabinetKey: row.cabinetKey,
      cabinetLabel: row.cabinetLabel,
      position: row.position,
      displayCols: Math.max(1, number(row.displayCols || 1)),
      perCol: Math.max(1, number(row.perCol || 1)),
      faceWidth: Math.max(1, number(row.faceWidth || (number(row.needWidth) / Math.max(1, number(row.displayCols || 1))))),
      source: "产品生命周期管理"
    };
  }

  function patchesForTask(task) {
    const patches = [];
    const rows = Array.isArray(task.rows) ? task.rows : [];

    if (task.type === "上新") {
      rows.forEach((row, index) => {
        if (row.status === "位置冲突已撤销") return;
        patches.push({
          id: `${task.id}:add:${row.id || index}`,
          type: "addSku",
          taskId: task.id,
          row: buildLaunchRow(task, row, index)
        });
      });
    }

    if (task.type === "淘汰") {
      rows.forEach((row, index) => {
        patches.push({
          id: `${task.id}:exclude:${row.skuId || index}`,
          type: "excludeSku",
          taskId: task.id,
          skuId: row.skuId,
          match: {
            store: row.store,
            name: row.productName || task.productName,
            cabinetKey: row.cabinetKey
          }
        });
      });
    }

    if (task.type === "恢复") {
      rows.forEach((row, index) => {
        if (row.restoreMethod === "skip") return;
        const changes = {
          included: true,
          active: true,
          lifecycleStatus: "在售SKU",
          lifecycleTaskId: task.id
        };
        if (row.restoreMethod === "replan") {
          Object.assign(changes, {
            cabinetKey: row.cabinetKey,
            cabinetLabel: row.cabinetLabel,
            position: row.position,
            displayCols: Math.max(1, number(row.displayCols || 1)),
            perCol: Math.max(1, number(row.perCol || 1)),
            faceWidth: Math.max(1, number(row.faceWidth || (number(row.needWidth) / Math.max(1, number(row.displayCols || 1)))))
          });
        }
        patches.push({
          id: `${task.id}:restore:${row.skuId || index}`,
          type: "updateSku",
          taskId: task.id,
          skuId: row.skuId,
          match: {
            store: row.store,
            name: row.productName || task.productName
          },
          changes
        });
      });
    }

    return patches;
  }

  function commitCompletedTask(task, nextState) {
    if (!task || task.status !== "已完成") return false;
    const state = normalizeState(nextState || stateRef || blankState());
    const existing = new Set((state.committedPatches || []).map(item => item.id));
    if (dataRef) applyLifecycleTaskToMaster(dataRef, state, task);
    patchesForTask(task).forEach(patch => {
      if (!existing.has(patch.id)) {
        state.committedPatches.push(patch);
        existing.add(patch.id);
        if (dataRef) applyPatch(dataRef, patch);
      }
    });
    rebuildProductCache();
    writeState(state);
    if (dataRef) dataRef.lifecycle = clone(stateRef);
    window.dispatchEvent(new CustomEvent("product-lifecycle:data-committed", {
      detail: { taskId: task.id, type: task.type }
    }));
    return true;
  }

  function syncSelectedStoreToFrame() {
    const frame = document.getElementById("productLifecycleFrame");
    const storeSelect = document.getElementById("storeSelect");
    if (!frame?.contentWindow || !storeSelect?.value) return;
    frame.contentWindow.postMessage({ type: "plm:set-store", store: storeSelect.value }, "*");
  }

  function bindHostNavigation() {
    const tab = document.querySelector('.tabs button[data-view="lifecycle"]');
    const view = document.getElementById("lifecycle");
    if (!tab || !view) return;

    tab.addEventListener("click", () => {
      loadLifecycleFrame();
      document.querySelectorAll(".tabs button").forEach(button => button.classList.toggle("active", button === tab));
      document.querySelectorAll("main > .view").forEach(section => section.classList.toggle("active", section === view));
      syncSelectedStoreToFrame();
    });

    document.getElementById("storeSelect")?.addEventListener("change", syncSelectedStoreToFrame);
  }

  function bindFrameMessages() {
    window.addEventListener("message", event => {
      const message = event.data || {};
      if (message.type === "plm:resize") {
        const frame = document.getElementById("productLifecycleFrame");
        if (frame) {
          // 空状态页按真实内容收缩；保留少量安全高度，避免 iframe 出现大块空白.
          const height = Math.max(360, Math.min(30000, number(message.height) + 8));
          frame.style.height = `${height}px`;
        }
      }
      if (message.type === "plm:select-store" && message.store) {
        const select = document.getElementById("storeSelect");
        if (select && [...select.options].some(option => option.value === message.store)) {
          select.value = message.store;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bindHostNavigation();
    bindFrameMessages();
    const frame = document.getElementById("productLifecycleFrame");
    frame?.addEventListener("load", syncSelectedStoreToFrame);
    if (isFormalData(dataRef || window.UNIFIED_CARTON_DATA) && !dataRef) prepareData(window.UNIFIED_CARTON_DATA);
  }

  function resetState() {
    const blank = blankState();
    stateRef = blank;
    if (dataRef) dataRef.lifecycle = clone(blank);
    return blank;
  }

  // Canonical lifecycle rule shared by every module.
  function clean(value) {
    return String(value || "").trim();
  }
  function looksLikeBarcode(value) {
    return /^\d{8,18}$/.test(clean(value));
  }
  function identityValues(item) {
    return new Set([item?.barcode, item?.name, item?.productKey, item?.productName]
      .map(clean).filter(Boolean));
  }
  function itemsMatch(left, right) {
    const leftValues = identityValues(left);
    return [...identityValues(right)].some(value => leftValues.has(value));
  }
  function canonicalKey(item) {
    const values = [...identityValues(item)];
    return values.find(looksLikeBarcode) || values[0] || "";
  }
  function canonicalProductFields(source, task) {
    const values = [...new Set([...identityValues(source), ...identityValues(task)])];
    const barcode = values.find(looksLikeBarcode) || clean(source?.barcode);
    const name = values.find(value => !looksLikeBarcode(value)) || clean(source?.name);
    return { ...clone(source || {}), name, barcode };
  }
  const PRODUCT_POOL_FIELDS = [
    "id", "name", "barcode", "grade", "rank", "category2", "category3", "category4",
    "length", "width", "height", "volume", "carton", "dailyQty", "dailySales", "moq",
    "moqDays", "faceWidth", "imageData", "imageUrl"
  ];
  function productPoolSource(data, state, task) {
    const draft = (state?.draftProducts || []).find(product => itemsMatch(product, task));
    if (draft) return draft;
    return (data?.skus || []).find(row => row?.lifecycleTaskId === task?.id && itemsMatch(row, task)) ||
      (data?.skus || []).find(row => itemsMatch(row, task)) || null;
  }
  function toProductPoolRecord(source, task) {
    const canonical = canonicalProductFields(source || {}, task);
    if (!canonical.name || !canonical.barcode) return null;
    const product = {};
    PRODUCT_POOL_FIELDS.forEach(field => {
      if (source && Object.prototype.hasOwnProperty.call(source, field)) product[field] = clone(source[field]);
    });
    product.name = canonical.name;
    product.barcode = canonical.barcode;
    return product;
  }
  function taskTime(task) {
    const value = task?.completedAt || task?.updatedAt || task?.createdAt || "";
    let time = Date.parse(value);
    if (!Number.isFinite(time)) time = Date.parse(clean(value).replace(/[年月]/g, "/").replace(/日/g, ""));
    if (!Number.isFinite(time)) {
      const idTime = clean(task?.id).match(/(\d{11,14})/);
      time = idTime ? Number(idTime[1]) : 0;
    }
    return Number.isFinite(time) ? time : 0;
  }
  function latestCompletedTaskFor(product, state = stateRef) {
    let latest = null;
    (state?.tasks || []).forEach((task, index) => {
      if (task?.status !== "已完成" || !itemsMatch(product, task)) return;
      const candidate = { task, time: taskTime(task), index };
      if (!latest || candidate.time > latest.time || (candidate.time === latest.time && candidate.index < latest.index)) latest = candidate;
    });
    return latest?.task || null;
  }
  function productStatusForState(product) {
    if (!product) return "在售SKU";
    // 任务是状态事实，读取时只推导展示，不得反写产品池、SKU 行或门店排柜。
    const latestTask = latestCompletedTaskFor(product);
    if (latestTask?.type === "淘汰") return "淘汰完成";
    if (latestTask?.type === "上新") return "上新完成";
    if (latestTask?.type === "恢复") return "在售SKU";
    if (product.active === false || ["淘汰完成", "已淘汰"].includes(product.lifecycleStatus)) return "淘汰完成";
    if (product.lifecycleStatus === "上新完成") return "上新完成";
    return "在售SKU";
  }
  function rebuildProductCache() {
    productIndex = new Map();
    formalCache = [];
    activeCache = [];
    activeAliasCache = new Set();
    const seen = new Set();
    for (const product of (dataRef?.productPool || [])) {
      const productKey = canonicalKey(product);
      if (!productKey || seen.has(productKey)) continue;
      seen.add(productKey);
      formalCache.push(product);
      for (const value of identityValues(product)) productIndex.set(value, product);
      if (productStatusForState(product) !== "淘汰完成") {
        activeCache.push(product);
        for (const value of identityValues(product)) activeAliasCache.add(value);
      }
    }
  }
  function resolveFormalProduct(item) {
    for (const value of identityValues(item)) {
      const found = productIndex.get(value);
      if (found) return found;
    }
    return (dataRef?.productPool || []).find(product => itemsMatch(product, item)) || null;
  }
  function promoteCompletedLaunchTask(data, state, task) {
    if (!task || task.status !== "已完成" || task.type !== "上新") return { product: null, created: false, reason: "任务未完成或不是上新任务" };
    data.productPool = Array.isArray(data.productPool) ? data.productPool : [];
    state.draftProducts = Array.isArray(state.draftProducts) ? state.draftProducts : [];
    let product = data.productPool.find(item => itemsMatch(item, task));
    if (product) return { product, created: false, reason: "产品已在总池" };
    const source = productPoolSource(data, state, task);
    const record = toProductPoolRecord(source, task);
    if (!record) return { product: null, created: false, reason: "缺少可核对的商品主数据，未自动建池" };
    record.id = record.id && !String(record.id).startsWith("draft_") ? record.id : `pool_${task.id}`;
    product = {
      ...record,
      active: true,
      lifecycleStatus: "上新完成",
      lifecycleTaskId: task.id,
      lifecycleChangedAt: task.completedAt || task.updatedAt || task.createdAt || ""
    };
    data.productPool.push(product);
    state.draftProducts = state.draftProducts.filter(item => !itemsMatch(item, task));
    return { product, created: true, reason: "已从任务对应主数据纳入产品总池" };
  }
  function applyLifecycleTaskToMaster(data, state, task) {
    if (!task || task.status !== "已完成") return null;
    data.productPool = Array.isArray(data.productPool) ? data.productPool : [];
    state.draftProducts = Array.isArray(state.draftProducts) ? state.draftProducts : [];
    let formal = data.productPool.find(product => itemsMatch(product, task));
    if (task.type === "上新") {
      formal = promoteCompletedLaunchTask(data, state, task).product;
      if (!formal) return null;
      Object.assign(formal, {
        ...canonicalProductFields(formal, task),
        active: true,
        lifecycleStatus: "上新完成",
        lifecycleTaskId: task.id,
        lifecycleChangedAt: task.completedAt || task.updatedAt || task.createdAt || ""
      });
    } else if (formal && task.type === "淘汰") {
      Object.assign(formal, {
        active: false,
        lifecycleStatus: "淘汰完成",
        lifecycleTaskId: task.id,
        lifecycleChangedAt: task.completedAt || task.updatedAt || task.createdAt || ""
      });
    } else if (formal && task.type === "恢复") {
      Object.assign(formal, {
        active: true,
        lifecycleStatus: "在售SKU",
        lifecycleTaskId: task.id,
        lifecycleChangedAt: task.completedAt || task.updatedAt || task.createdAt || ""
      });
    }
    return formal;
  }
  function repairCompletedLaunchTasks() {
    if (!dataRef) return { ok: false, promoted: [], skipped: [], message: "统一数据尚未加载" };
    const state = normalizeState(clone(stateRef || blankState()));
    const promoted = [];
    const skipped = [];
    (state.tasks || [])
      .filter(task => task?.type === "上新" && task?.status === "已完成")
      .sort((a, b) => taskTime(a) - taskTime(b))
      .forEach(task => {
        const before = (dataRef.productPool || []).find(product => itemsMatch(product, task));
        if (before) return;
        const result = promoteCompletedLaunchTask(dataRef, state, task);
        if (result.created) promoted.push({ taskId: task.id, barcode: result.product.barcode, name: result.product.name });
        else skipped.push({ taskId: task.id, barcode: task.productName, name: task.productKey, reason: result.reason });
      });
    rebuildProductCache();
    if (promoted.length) {
      writeState(state);
      const frame = document.getElementById("productLifecycleFrame");
      frame?.contentWindow?.postMessage({ type: "plm:products-repaired", promoted }, "*");
      window.dispatchEvent(new CustomEvent("product-lifecycle:data-committed", { detail: { type: "上新入池修复", promoted } }));
    }
    return { ok: true, promoted, skipped, message: promoted.length ? `已将 ${promoted.length} 个已完成上新SKU纳入产品总池` : "没有可补齐的已完成上新SKU" };
  }
  function migrateCompletedTasksToMaster(data, state) {
    // 历史任务只用于读取时推导状态；禁止在加载、拉取或页面刷新时改写业务数据。
    return data;
  }
  function dedupeLifecycleRows(data) {
    const taskRows = new Set();
    const baseRows = new Set((data.skus || []).filter(row => !row?.lifecycleTaskId).map(row => [row.store, canonicalKey(row)].join("||")));
    const generatedProducts = new Set();
    data.skus = (data.skus || []).filter((row, index) => {
      if (!row?.lifecycleTaskId) return true;
      const taskKey = [row.lifecycleTaskId, row.lifecycleTaskRowId || row.id || index].join("||");
      const productKey = [row.store, canonicalKey(row)].join("||");
      if (taskRows.has(taskKey) || baseRows.has(productKey) || generatedProducts.has(productKey)) return false;
      taskRows.add(taskKey);
      generatedProducts.add(productKey);
      return true;
    });
  }
  const MASTER_FIELDS = ["name", "barcode", "grade", "category2", "category3", "category4", "length", "width", "height", "volume", "carton", "dailyQty", "dailySales", "faceWidth"];
  function syncProductMasterFields(data) {
    (data.skus || []).forEach(row => {
      if (Object.prototype.hasOwnProperty.call(row, "imageData")) delete row.imageData;
      const product = resolveFormalProduct(row);
      if (!product) return;
      MASTER_FIELDS.forEach(field => {
        if (product[field] !== undefined && product[field] !== "") row[field] = clone(product[field]);
      });
    });
  }
  function rowWidth(row) {
    return Math.max(0, number(row?.displayCols) * number(row?.faceWidth));
  }
  function updateTaskPlacement(state, row) {
    const task = (state.tasks || []).find(item => item.id === row.lifecycleTaskId);
    if (!task) return;
    const taskRow = (task.rows || []).find(item => String(item.id || "") === String(row.lifecycleTaskRowId || "")) ||
      (task.rows || []).find(item => item.store === row.store && itemsMatch(item, row));
    if (!taskRow) return;
    Object.assign(taskRow, {
      cabinetKey: row.cabinetKey,
      cabinetLabel: row.cabinetLabel,
      position: row.position,
      placementStatus: row.placementStatus || "\u5df2\u6821\u9a8c"
    });
  }
  function repairLifecyclePlacements(data, state) { return []; }
  function reconcileLifecycleData(data, state) {
    if (!data || !state) return data;
    // 只建立主数据索引：不回放任务、不应用旧补丁、不去重/增删 SKU、不同步字段、不调柜。
    rebuildProductCache();
    return data;
  }
  function formalProducts() {
    return formalCache;
  }
  function productStatus(product) {
    return productStatusForState(resolveFormalProduct(product) || product);
  }
  function activeProducts() {
    return activeCache;
  }
  function isActiveProduct(item) {
    return [...identityValues(item)].some(value => activeAliasCache.has(value));
  }
  function validateTaskCompletion(task) {
    if (!task || task.type !== "\u4e0a\u65b0") return { ok: true, errors: [] };
    const cabinets = new Map((dataRef?.cabinets || []).map(cabinet => [cabinet.key, { ...cabinet, used: 0 }]));
    const taskRows = Array.isArray(task.rows) ? task.rows : [];
    const sourceById = new Map((dataRef?.skus || []).map(row => [String(row.id), row]));
    const removedIds = new Set();
    const shrinkRows = new Map();
    const moveRows = new Map();
    taskRows.forEach(row => {
      if (row.sourceSkuId) removedIds.add(String(row.sourceSkuId));
      if (row.originalSkuId) removedIds.add(String(row.originalSkuId));
      if (row.sourceSlotId) {
        const slot = (stateRef?.slots || []).find(item => String(item.id) === String(row.sourceSlotId));
        if (slot?.originalSkuId) removedIds.add(String(slot.originalSkuId));
      }
      if (row.replaceSkuId) removedIds.add(String(row.replaceSkuId));
      if (row.shrinkSkuId) {
        const source = sourceById.get(String(row.shrinkSkuId));
        if (source) shrinkRows.set(String(row.shrinkSkuId), { source, row });
      }
      if (row.moveSkuId) {
        const source = sourceById.get(String(row.moveSkuId));
        if (source) moveRows.set(String(row.moveSkuId), { source, row });
      }
    });
    // 先扣除本次方案会释放、替换、压缩或移位的原排面，再验证新品写入后的柜段容量。
    (dataRef?.skus || []).filter(row => row.included !== false && productStatus(row) !== "\u6dd8\u6c70\u5b8c\u6210" && !removedIds.has(String(row.id)) && !shrinkRows.has(String(row.id)) && !moveRows.has(String(row.id))).forEach(row => {
      const cabinet = cabinets.get(row.cabinetKey);
      if (cabinet) cabinet.used += rowWidth(row);
    });
    shrinkRows.forEach(({ source, row }) => {
      const cabinet = cabinets.get(source.cabinetKey);
      const cols = Math.max(0, number(row.shrinkToCols || row.displayCols || source.displayCols));
      if (cabinet) cabinet.used += cols * Math.max(1, number(row.shrinkFaceWidth || source.faceWidth));
    });
    moveRows.forEach(({ source, row }) => {
      const target = cabinets.get(row.moveToKey || row.moveToCabinetKey);
      if (target) target.used += rowWidth({ displayCols: row.moveToCols || source.displayCols, faceWidth: row.moveToFaceWidth || source.faceWidth });
    });
    const errors = [];
    taskRows.forEach(row => {
      const alreadyExists = (dataRef?.skus || []).some(item => item.lifecycleTaskId === task.id && String(item.lifecycleTaskRowId) === String(row.id));
      if (alreadyExists) return;
      const cabinet = cabinets.get(row.cabinetKey);
      const width = Math.max(0, number(row.needWidth) || number(row.displayCols) * number(row.faceWidth));
      if (!cabinet || cabinet.used + width > number(cabinet.length) + 0.5) {
        errors.push({ store: row.store, cabinet: row.cabinetLabel || row.cabinetKey, need: width, left: cabinet ? number(cabinet.length) - cabinet.used : 0 });
        return;
      }
      cabinet.used += width;
    });
    return { ok: errors.length === 0, errors };
  }  // 仅用于用户主动“保存至云端”时，将已完成任务这一既有事实写回产品池状态。
  // 仅可从对应草稿/任务主数据补齐“已完成上新”且缺失的产品池记录；不删除商品，不触碰 SKU 行、门店、柜段、陈列位置、图片或任何经营字段。
  function buildPersistenceCopy(data) {
    const copy = clone(data || {});
    const persistedState = normalizeState(clone(copy.lifecycle || stateRef || blankState()));
    // 只在用户明确点击“保存至云端”时补齐历史已完成上新任务；拉取、刷新和读取不会改写原数据。
    (persistedState.tasks || [])
      .filter(task => task?.type === "上新" && task?.status === "已完成")
      .sort((a, b) => taskTime(a) - taskTime(b))
      .forEach(task => { promoteCompletedLaunchTask(copy, persistedState, task); });
    copy.lifecycle = clone(persistedState);
    (copy.productPool || []).forEach(product => {
      const latestTask = latestCompletedTaskFor(product, persistedState);
      if (!latestTask) return;
      const changedAt = latestTask.completedAt || latestTask.updatedAt || latestTask.createdAt || "";
      if (latestTask.type === "淘汰") {
        Object.assign(product, { active: false, lifecycleStatus: "淘汰完成", lifecycleTaskId: latestTask.id, lifecycleChangedAt: changedAt });
      } else if (latestTask.type === "上新") {
        Object.assign(product, { active: true, lifecycleStatus: "上新完成", lifecycleTaskId: latestTask.id, lifecycleChangedAt: changedAt });
      } else if (latestTask.type === "恢复") {
        Object.assign(product, { active: true, lifecycleStatus: "在售SKU", lifecycleTaskId: latestTask.id, lifecycleChangedAt: changedAt });
      }
    });
    return copy;
  }
  window.ProductLifecycle = {
    version: VERSION,
    prepareData,
    isFormalData,
    init,
    getData: () => dataRef || window.UNIFIED_CARTON_DATA || null,
    getFormalProducts: () => formalProducts(),
    getActiveProducts: () => activeProducts(),
    getActiveProductKeys: () => activeAliasCache,
    getCanonicalProductKey: item => canonicalKey(resolveFormalProduct(item) || item),
    isActiveProduct,
    getProductStatus: product => productStatus(product),
    findProduct: item => resolveFormalProduct(item),
    validateTaskCompletion,
    getState: () => clone(stateRef || blankState()),
    saveState: writeState,
    resetState,
    hydrateState,
    commitCompletedTask,
    updateProduct,
    syncData,
    applyCommittedPatches,
    buildPersistenceCopy,
    repairCompletedLaunchTasks
  };
})();
