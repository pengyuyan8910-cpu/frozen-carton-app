(() => {
  "use strict";

  const STORAGE_KEY = "frozen_product_lifecycle_management_v2";
  const VERSION = 2;
  const FORMAL_DATA_ERROR = "正式底表加载失败，请检查 GitHub Actions。";
  let dataRef = null;
  let stateRef = null;
  let initialized = false;

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
    if (source) frame.setAttribute("src", source);
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

  function readLocalState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch (error) {
      console.warn("产品生命周期管理：本地状态读取失败", error);
      return blankState();
    }
  }

  function writeState(next) {
    stateRef = normalizeState(clone(next));
    stateRef.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef));
    } catch (error) {
      console.error("产品生命周期管理：本地状态保存失败", error);
    }
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
        row.lifecycleTaskId === patch.row?.lifecycleTaskId &&
        row.lifecycleTaskRowId === patch.row?.lifecycleTaskRowId
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
    const match = item => String(item?.barcode || item?.name || "") === String(patch.matchKey);
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
    writeState(state);
    window.dispatchEvent(new CustomEvent("product-lifecycle:product-updated", { detail: { matchKey, changes: clone(changes) } }));
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
    const local = readLocalState();
    const state = embedded
      ? normalizeState(embedded)
      : local;
    stateRef = state;
    applyCommittedPatches(dataRef, stateRef);
    writeState(stateRef);
    loadLifecycleFrame();
    return true;
  }

function syncData(data) {
    if (!isFormalData(data)) return false;
    dataRef = data;
    dataRef.lifecycle = clone(stateRef || blankState());
    return true;
  }

  // A cloud pull is authoritative: replace this browser's cached lifecycle state.
  function hydrateState(next, data) {
    stateRef = normalizeState(clone(next || blankState()));
    if (isFormalData(data)) dataRef = data;
    if (dataRef) {
      dataRef.lifecycle = clone(stateRef);
      applyCommittedPatches(dataRef, stateRef);
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef)); } catch (error) {
      console.error("产品生命周期管理：云端状态写入失败", error);
    }
    window.dispatchEvent(new CustomEvent("product-lifecycle:state-hydrated", { detail: clone(stateRef) }));
    return clone(stateRef);
  }
  function getProduct(task) {
    if (!dataRef) return {};
    const pool = Array.isArray(dataRef.productPool) ? dataRef.productPool : [];
    const byPool = pool.find(item =>
      String(item.barcode || item.name || "") === String(task.productKey || "") ||
      item.name === task.productName
    );
    if (byPool) return byPool;
    return (dataRef.skus || []).find(item =>
      String(item.barcode || item.name || "") === String(task.productKey || "") ||
      item.name === task.productName
    ) || {};
  }

  function buildLaunchRow(task, row, index) {
    const product = getProduct(task);
    return {
      id: `lifecycle_${task.id}_${index}`,
      lifecycleTaskId: task.id,
      lifecycleTaskRowId: row.id || `${task.id}_${index}`,
      lifecycleStatus: "正常在售",
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
          lifecycleStatus: "正常在售",
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
    patchesForTask(task).forEach(patch => {
      if (!existing.has(patch.id)) {
        state.committedPatches.push(patch);
        existing.add(patch.id);
        if (dataRef) applyPatch(dataRef, patch);
      }
    });
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
          const height = Math.max(760, Math.min(30000, number(message.height) + 8));
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
    if (isFormalData(dataRef || window.UNIFIED_CARTON_DATA)) {
      if (!dataRef) prepareData(window.UNIFIED_CARTON_DATA);
      else loadLifecycleFrame();
    }
  }

  function resetState() {
    const blank = blankState();
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) {}
    stateRef = blank;
    if (dataRef) dataRef.lifecycle = clone(blank);
    return blank;
  }

  window.ProductLifecycle = {
    version: VERSION,
    prepareData,
    isFormalData,
    init,
    getData: () => dataRef || window.UNIFIED_CARTON_DATA || null,
    getState: () => clone(stateRef || readLocalState()),
    saveState: writeState,
    resetState,
    commitCompletedTask,
    updateProduct,
    syncData,
    applyCommittedPatches
  };
})();