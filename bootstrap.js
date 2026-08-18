(async function loadFrozenCartonData(){
  const DATA_VERSION = "20260818_one_click_replan_v1";
  const REVIEW_MARKER = "frozen_carton_open_replan_review_v1";
  const note = document.getElementById("dataNote");
  const setNote = msg => { if (note) note.textContent = msg; };
  const loadJson = async file => {
    const res = await fetch(`${file}?v=${DATA_VERSION}`, { cache: "default" });
    if (!res.ok) throw new Error(`${file} load failed (${res.status})`);
    return res.json();
  };
  try {
    setNote("正在读取最新底表数据…");
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
    const status = report?.passed === false ? "复核失败" : "复核通过";
    setNote(`${data.meta?.version || "当前版本"}｜底表：${version?.sourceName || data.meta?.source || "当前版"}｜${status}｜生成：${data.meta?.generatedAt || version?.generatedAt || ""}`);

    // 人工复核入口必须在 app.js 初始化前切到运营草稿，避免先加载发布状态再切换。
    try {
      if (sessionStorage.getItem(REVIEW_MARKER) === "1") {
        const ops = document.getElementById("opsMode");
        if (ops) ops.checked = true;
      }
    } catch (_) {}

    const app = document.createElement("script");
    app.src = `app.js?v=${DATA_VERSION}`;
    app.onload = async () => {
      window.ProductLifecycle?.init?.();
      try {
        await import(`./scripts/product-pool-replan-ui.mjs?v=${DATA_VERSION}`);
      } catch (replanError) {
        console.error("产品池重排模块加载失败", replanError);
      }
    };
    app.onerror = () => setNote("程序加载失败，请联系运营");
    document.body.appendChild(app);
  } catch (err) {
    console.error(err);
    setNote("数据加载失败，请检查 GitHub Actions 复核结果");
    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `<section class="panel load-error"><h2>数据加载失败</h2><p>小程序没有读取到已复核通过的最新数据，请确认 data/app-data.json 存在。</p><pre>${String(err.message || err)}</pre></section>`;
    }
  }
})();
