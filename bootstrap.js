(async function loadFrozenCartonData(){
  const DATA_VERSION = "20260825_authorized_removal_v7";
  const RULE_VERSION = "20260902_product_dimensions_v2";
  const APP_VERSION = "20260902_product_dimensions_v3";
  const note = document.getElementById("dataNote");
  const setNote = msg => { if (note) note.textContent = msg; };
  const loadJson = async file => {
    const res = await fetch(`${file}?v=${DATA_VERSION}`, { cache: "default" });
    if (!res.ok) throw new Error(`${file} load failed (${res.status})`);
    return res.json();
  };
  try {
    setNote("正在读取最新底表数据…");
    const localStateModule = await import(`./scripts/local-state-store.mjs?v=${DATA_VERSION}`);
    window.FrozenCartonLocalStore = localStateModule.createLocalStateStore();
    await window.FrozenCartonLocalStore.preload([
      "frozen_carton_unified_scene_state_v2",
      "frozen_carton_unified_scene_draft_v1",
      "frozen_carton_unified_scene_published_v1",
      "frozen_carton_cloud_baseline_v1",
      "frozen_carton_cloud_session_v1",
      "frozen_carton_cloud_rollback_v1",
    ]);
    const [data, report, version] = await Promise.all([
      loadJson("data/app-data.json"),
      loadJson("data/verify-report.json").catch(() => ({})),
      loadJson("data/version.json").catch(() => ({}))
    ]);
    if (!data || !Array.isArray(data.stores) || !Array.isArray(data.skus) || !Array.isArray(data.cabinets)) {
      throw new Error("app-data.json 缺少门店、SKU或柜段数据");
    }
    window.UNIFIED_CARTON_DATA = data;
    window.UNIFIED_CARTON_REPORT = report || {};
    window.UNIFIED_CARTON_VERSION = version || {};
    window.DisplayModuleState = await import(`./scripts/display-module-state.mjs?v=${DATA_VERSION}`);
    window.PlanogramExcelExport = await import(`./scripts/planogram-excel-export.mjs?v=${DATA_VERSION}`);
    window.PlanogramStagingSearch = await import(`./scripts/planogram-staging-search.mjs?v=${DATA_VERSION}`);
    window.RefrigeratorModule = await import(`./scripts/refrigerator-module.mjs?v=${DATA_VERSION}`);
    window.LivePlanogramCapacity = await import(`./scripts/live-planogram-capacity.mjs?v=${RULE_VERSION}`);
    window.PlanogramProjection = await import(`./scripts/planogram-projection.mjs?v=${RULE_VERSION}`);
    window.StateIntegrityGuard = await import(`./scripts/state-integrity-guard.mjs?v=${RULE_VERSION}`);
    await import(`./scripts/strict-allocation-adapter.mjs?v=${RULE_VERSION}`);
    window.UnifiedStateMigration = await import(`./scripts/unified-state-migration.mjs?v=${DATA_VERSION}`);
    window.CloudStateGuard = await import(`./scripts/cloud-state-guard.mjs?v=${DATA_VERSION}`);
    const status = report?.passed === false ? "复核失败" : "复核通过";
    setNote(`${data.meta?.version || "当前版本"}｜底表：${version?.sourceName || data.meta?.source || "当前版"}｜${status}｜生成：${data.meta?.generatedAt || version?.generatedAt || ""}`);
    const app = document.createElement("script");
    app.src = `app.js?v=${APP_VERSION}`;
    app.onload = () => { window.ProductLifecycle?.init?.(); };
    app.onerror = () => setNote("程序加载失败，请联系运营");
    document.body.appendChild(app);
  } catch (err) {
    console.error(err);
    setNote("数据加载失败，请检查 GitHub Actions 复核结果");
    const main = document.querySelector("main");
    if (main) main.innerHTML = `<section class="panel load-error"><h2>数据加载失败</h2><p>小程序没有读取到已复核通过的最新数据，请确认 data/app-data.json 存在。</p><pre>${String(err.message || err)}</pre></section>`;
  }
})();


