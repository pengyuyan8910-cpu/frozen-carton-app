(() => {
  "use strict";

  const api = window.ProductLifecycle;
  const rawGetData = api?.getData ? api.getData.bind(api) : () => window.UNIFIED_CARTON_DATA || null;
  const clone = value => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const txt = value => String(value ?? "").trim();
  const nameKey = value => txt(value).replace(/\s+/g, "").toLowerCase();
  const barcode = value => { const code = txt(value); return code && code !== "—" && code !== "-" ? code : ""; };
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  let identityCache = null;
  let parentBound = false;
  let parentQueued = false;
  let childQueued = false;

  const data = () => rawGetData() || window.UNIFIED_CARTON_DATA || null;
  const lifecycle = () => api?.getState?.() || data()?.lifecycle || { draftProducts: [], tasks: [], slots: [] };
  const invalidate = () => { identityCache = null; };

  function buildIdentity() {
    const state = lifecycle();
    const items = [
      ...(data()?.productPool || []),
      ...(data()?.skus || []),
      ...(state.draftProducts || []),
      ...(state.tasks || []).map(task => ({
        barcode: /^\d{6,}$/.test(txt(task.productKey)) ? txt(task.productKey) : "",
        name: task.productName || (!/^\d{6,}$/.test(txt(task.productKey)) ? task.productKey : "")
      }))
    ];
    const groups = new Map();
    items.forEach(item => {
      const name = nameKey(item?.name);
      if (!name) return;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    });
    const names = new Map();
    const codes = new Map();
    for (const [name, group] of groups) {
      const values = [...new Set(group.map(item => barcode(item?.barcode)).filter(Boolean))];
      if (values.length === 1) names.set(name, values[0]);
      else names.set(name, `name:${name}`);
      values.forEach(code => codes.set(code, code));
    }
    return item => {
      const code = barcode(item?.barcode);
      if (code) return codes.get(code) || code;
      const name = nameKey(item?.name);
      if (name) return names.get(name) || `name:${name}`;
      const raw = txt(item?.productKey);
      if (!raw) return "";
      return /^\d{6,}$/.test(raw) ? (codes.get(raw) || raw) : (names.get(nameKey(raw)) || `name:${nameKey(raw)}`);
    };
  }

  const key = item => (identityCache || (identityCache = buildIdentity()))(item);
  const keyFromValue = value => /^\d{6,}$/.test(txt(value)) ? key({ barcode: value }) : key({ name: value });
  const taskKey = task => key({
    barcode: /^\d{6,}$/.test(txt(task?.productKey)) ? task.productKey : "",
    name: task?.productName || (!/^\d{6,}$/.test(txt(task?.productKey)) ? task?.productKey : "")
  });

  const score = item =>
    (barcode(item?.barcode) ? 50 : 0) + (txt(item?.name) ? 20 : 0) +
    (num(item?.length) > 0 ? 8 : 0) + (num(item?.width) > 0 ? 8 : 0) +
    (num(item?.height) > 0 ? 8 : 0) + (num(item?.carton) > 0 ? 5 : 0) +
    (txt(item?.cabinetKey) ? 4 : 0);

  function mergeProduct(target, source) {
    const result = { ...target };
    const fields = ["id","name","barcode","grade","rank","category2","category3","category4","length","width","height","volume","carton","dailyQty","dailySales","moq","moqDays","imageData","active"];
    const prefer = score(source) > score(target);
    fields.forEach(field => {
      const incoming = source?.[field];
      if (incoming === undefined || incoming === null || incoming === "") return;
      if (prefer || result[field] === undefined || result[field] === null || result[field] === "" || result[field] === 0) result[field] = incoming;
    });
    return result;
  }

  function products(includeDrafts = true) {
    const state = lifecycle();
    const map = new Map();
    const add = item => { const id = key(item); if (id) map.set(id, map.has(id) ? mergeProduct(map.get(id), item) : { ...item }); };
    (data()?.skus || []).forEach(add);
    (data()?.productPool || []).forEach(add);
    (state.tasks || []).forEach(task => {
      const row = task.rows?.[0] || {};
      add({ ...row, name: row.productName || task.productName, barcode: row.barcode || (/^\d{6,}$/.test(txt(task.productKey)) ? task.productKey : "") });
    });
    if (includeDrafts) (state.draftProducts || []).forEach(add);
    return [...map.entries()].map(([authorityKey, product]) => ({ ...product, __authorityKey: authorityKey }));
  }

  function latestTask(product) {
    const id = typeof product === "string" ? product : key(product);
    const ignored = new Set(["已撤销", "部分撤销"]);
    return (lifecycle().tasks || []).find(task => taskKey(task) === id && !ignored.has(task.status)) || null;
  }

  function status(product) {
    const id = typeof product === "string" ? product : key(product);
    if (!id) return "已淘汰";
    const task = latestTask(id);
    if (task?.type === "恢复") return task.status === "已完成" ? "正常在售" : "恢复中";
    if (task?.type === "淘汰") {
      if (task.status === "已撤回") return "正常在售";
      if (task.status === "部分撤回") return "恢复中";
      return task.status === "已完成" ? "已淘汰" : "待淘汰";
    }
    if (task?.type === "上新") return task.status === "已完成" ? "正常在售" : "待上新";
    if ((lifecycle().draftProducts || []).some(item => key(item) === id)) return "待上新";
    const live = (data()?.skus || []).some(row => key(row) === id && row.included !== false && row.active !== false && row.lifecycleStatus !== "已淘汰");
    if (live) return "正常在售";
    if (product?.active === false) return "已淘汰";
    return "正常在售";
  }

  const effectiveProducts = () => products(false).filter(product => ["正常在售", "待淘汰", "恢复中"].includes(status(product)));
  const placeholder = row => {
    const generated = /^(lifecycle_|poolsku_|sku_new_|sku_trial_)/.test(txt(row?.id)) || /产品生命周期|产品池新增|新品草稿|待上新/.test([row?.source,row?.status,row?.sourceAdvice,row?.sourceAction,row?.note].map(txt).join(" "));
    return generated && (!barcode(row?.barcode) || (num(row?.length) <= 0 && num(row?.width) <= 0 && num(row?.height) <= 0) || (!txt(row?.cabinetKey) && !txt(row?.position)));
  };

  function launchRows(store) {
    const master = new Map(products(true).map(product => [product.__authorityKey, product]));
    return (lifecycle().tasks || []).filter(task => task.type === "上新" && task.status === "已完成").flatMap(task => {
      const product = master.get(taskKey(task)) || {};
      return (task.rows || []).filter(row => row.store === store && row.status !== "位置冲突已撤销").map((row, index) => ({
        id: `authority_${task.id}_${row.id || index}`, store, included: true, active: true, lifecycleStatus: "正常在售",
        name: row.productName || task.productName || product.name || "", barcode: row.barcode || product.barcode || "",
        grade: row.grade || product.grade || "B", rank: num(row.rank || product.rank || 9999),
        category2: row.category2 || product.category2 || "", category3: row.category3 || product.category3 || "", category4: row.category4 || product.category4 || "",
        length: num(row.length || product.length), width: num(row.width || product.width), height: num(row.height || product.height), volume: num(row.volume || product.volume),
        carton: Math.max(1, num(row.carton || product.carton || 1)), dailyQty: num(row.dailyQty || product.dailyQty),
        cabinetKey: row.cabinetKey || "", cabinetLabel: row.cabinetLabel || "", position: row.position || "",
        displayCols: Math.max(1, num(row.displayCols || 1)), perCol: Math.max(1, num(row.perCol || 1)),
        faceWidth: Math.max(0, num(row.faceWidth || num(row.needWidth) / Math.max(1, num(row.displayCols || 1)))), source: "产品生命周期管理"
      }));
    });
  }

  function storeRows(store, activeOnly = false) {
    const raw = (data()?.skus || []).filter(row => row.store === store);
    const completeKeys = new Set(raw.filter(row => row.included !== false && !placeholder(row)).map(key));
    const combined = [...raw, ...launchRows(store).filter(row => !completeKeys.has(key(row)))];
    const groups = new Map();
    combined.forEach(row => { const id = key(row); if (id) { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(row); } });
    const output = [];
    for (const group of groups.values()) {
      const complete = group.filter(row => !placeholder(row));
      const candidates = complete.length ? complete : group;
      const placements = new Map();
      candidates.forEach(row => {
        const id = [txt(row.cabinetKey), txt(row.position), key(row)].join("||");
        if (!placements.has(id) || score(row) > score(placements.get(id))) placements.set(id, row);
      });
      placements.forEach(row => {
        const state = status(row);
        if (state === "已淘汰") output.push({ ...row, included: false, lifecycleStatus: "已淘汰" });
        else if (state === "待上新") output.push({ ...row, included: false, lifecycleStatus: "待上新" });
        else if (state === "正常在售" && row.included !== false && row.lifecycleStatus !== "已淘汰") output.push(row);
        else output.push({ ...row, included: true, active: true, lifecycleStatus: state });
      });
    }
    return activeOnly ? output.filter(row => row.included !== false) : output;
  }

  const allRows = () => (data()?.stores || []).map(item => typeof item === "string" ? item : item.store).filter(Boolean).flatMap(store => storeRows(store));
  const findProduct = value => { const id = typeof value === "string" ? keyFromValue(value) : key(value); return products(true).find(product => product.__authorityKey === id) || null; };

  const authority = { getData: data, getLifecycleState: lifecycle, getKey: key, getStatus: status, getProducts: products, getEffectiveProducts: effectiveProducts, getStoreRows: storeRows, getAllRows: allRows, findProduct };
  window.FrozenLifecycleAuthority = authority;

  // iframe 是生命周期操作入口；它只读快照，所有修改必须通过父页面 ProductLifecycle Bridge 写入。
  if (api?.getData && !api.__authoritySnapshotInstalled) {
    api.getData = () => { const value = rawGetData(); return value ? clone(value) : value; };
    api.__authoritySnapshotInstalled = true;
  }

  function bindParent() {
    try {
      if (parentBound || typeof 有效SKU池 !== "function" || typeof 门店SKU !== "function") return parentBound;
      产品键 = item => key(item); SKU键 = item => key(item);
      产品池有效 = () => effectiveProducts(); 有效SKU池 = () => effectiveProducts();
      门店SKU = (store = 门店名()) => storeRows(store); 纳入SKU = (store = 门店名()) => storeRows(store, true);
      渲染商品 = () => {
        const keyword = 文(q("#goodsSearch").value), level = 文(q("#levelFilter").value);
        const rows = allRows().filter(row => !level || row.grade === level).filter(row => 包含(row, keyword));
        表格("#goodsTable", [{ name: "门店", value: row => row.store }].concat(商品列()), rows);
      };
      parentBound = true;
      return true;
    } catch (error) { console.warn("生命周期统管尚未完成挂载", error); return false; }
  }

  function bindChild() {
    const frame = document.getElementById("productLifecycleFrame"), child = frame?.contentWindow;
    if (!child || typeof child.renderAll !== "function") return false;
    child.allProducts = () => products(true).map(product => { const copy = { ...product }; delete copy.__authorityKey; return copy; });
    child.productStatus = product => status(product);
    child.productByKey = value => findProduct(value);
    child.rowsForProduct = value => { const id = keyFromValue(value); return allRows().filter(row => key(row) === id); };
    child.currentStoreRows = store => {
      const removed = new Set((lifecycle().slots || []).filter(slot => slot.store === store && ["已释放未分配", "已预留给新品"].includes(slot.status)).map(slot => slot.originalSkuId));
      return storeRows(store, true).filter(row => !removed.has(row.id));
    };
    child.__lifecycleAuthorityInstalled = true;
    child.renderAll();
    return true;
  }

  const refreshChild = () => {
    if (childQueued) return; childQueued = true;
    requestAnimationFrame(() => { childQueued = false; bindChild(); document.getElementById("productLifecycleFrame")?.contentWindow?.postMessage({ type: "plm:refresh-data" }, "*"); });
  };
  const refreshAll = () => {
    invalidate();
    if (parentQueued) return; parentQueued = true;
    requestAnimationFrame(() => {
      try { bindParent(); if (typeof 渲染全部 === "function") 渲染全部(); bindChild(); refreshChild(); }
      catch (error) { console.error("生命周期统管刷新失败", error); }
      finally { parentQueued = false; }
    });
  };

  if (api?.syncData && !api.__authoritySyncWrapped) {
    const original = api.syncData.bind(api);
    api.syncData = value => { const result = original(value); invalidate(); bindParent(); refreshChild(); return result; };
    api.__authoritySyncWrapped = true;
  }

  document.getElementById("productLifecycleFrame")?.addEventListener("load", () => setTimeout(() => { bindChild(); refreshChild(); }, 0));
  window.addEventListener("load", refreshAll, { once: true });
  window.addEventListener("product-lifecycle:state-changed", refreshAll);
  window.addEventListener("product-lifecycle:data-committed", refreshAll);
  window.addEventListener("product-lifecycle:state-hydrated", refreshAll);
  window.addEventListener("product-lifecycle:product-updated", event => { if (event.detail?.changes?.imageData === undefined) refreshAll(); });
  window.addEventListener("message", event => { if (event.data?.type === "plm:product-image-updated") window.dispatchEvent(new CustomEvent("product-image:updated", { detail: event.data })); });
})();
