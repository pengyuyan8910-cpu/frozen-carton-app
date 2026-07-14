(async function 启动数据加载(){
  const note = document.getElementById("dataNote");
  const setNote = msg => { if (note) note.textContent = msg; };
  const loadJson = async file => {
    const res = await fetch(`${file}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${file} 加载失败：${res.status}`);
    return res.json();
  };
  try {
    setNote("正在读取最新底表数据...");
    const [data, report, version] = await Promise.all([
      loadJson("data/app-data.json"),
      loadJson("data/verify-report.json").catch(() => ({})),
      loadJson("data/version.json").catch(() => ({}))
    ]);
    if (!data || !Array.isArray(data.stores) || !Array.isArray(data.skus) || !Array.isArray(data.cabinets)) {
      throw new Error("app-data.json 缺少门店/SKU/柜段数据");
    }
    window.UNIFIED_CARTON_DATA = data;
    window.UNIFIED_CARTON_REPORT = report || {};
    window.UNIFIED_CARTON_VERSION = version || {};
    const status = report?.passed === false ? "复核失败" : "复核通过";
    setNote(`${data.meta?.version || "10%触发"}｜底表：${version?.sourceName || data.meta?.source || "当前版"}｜${status}｜生成：${data.meta?.generatedAt || version?.generatedAt || ""}`);
    const app = document.createElement("script");
    app.src = `app.js?v=${Date.now()}`;
    app.onerror = () => setNote("程序加载失败，请联系运营");
    document.body.appendChild(app);
  } catch (err) {
    console.error(err);
    setNote("数据加载失败：请检查 GitHub Actions 复核是否通过");
    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `<section class="panel load-error"><h2>数据加载失败</h2><p>小程序没有读取到已复核通过的最新数据。请先检查 GitHub Actions 是否成功，或确认 data/app-data.json 是否存在。</p><pre>${String(err.message || err)}</pre></section>`;
    }
  }
})();
