(async function loadFrozenCartonData(){
  const DATA_VERSION = "20260810_lifecycle_v4";
  const note = document.getElementById("dataNote");
  const setNote = msg => { if (note) note.textContent = msg; };
  const loadJson = async file => {
    const res = await fetch(`${file}?v=${DATA_VERSION}`, { cache: "default" });
    if (!res.ok) throw new Error(`${file} load failed (${res.status})`);
    return res.json();
  };
  try {
    setNote("姝ｅ湪璇诲彇鏈€鏂板簳琛ㄦ暟鎹€?);
    const [data, report, version] = await Promise.all([
      loadJson("data/app-data.json"),
      loadJson("data/verify-report.json").catch(() => ({})),
      loadJson("data/version.json").catch(() => ({}))
    ]);
    if (!data || !Array.isArray(data.stores) || !Array.isArray(data.skus) || !Array.isArray(data.cabinets)) {
      throw new Error("app-data.json 缂哄皯闂ㄥ簵銆丼KU鎴栨煖娈垫暟鎹?);
    }
    window.UNIFIED_CARTON_DATA = data;
    window.UNIFIED_CARTON_REPORT = report || {};
    window.UNIFIED_CARTON_VERSION = version || {};
    const status = report?.passed === false ? "澶嶆牳澶辫触" : "澶嶆牳閫氳繃";
    setNote(`${data.meta?.version || "褰撳墠鐗堟湰"}锝滃簳琛細${version?.sourceName || data.meta?.source || "褰撳墠鐗?}锝?{status}锝滅敓鎴愶細${data.meta?.generatedAt || version?.generatedAt || ""}`);
    const app = document.createElement("script");
    app.src = `app.js?v=${DATA_VERSION}`;
    app.onload = () => window.ProductLifecycle?.init?.();
    app.onerror = () => setNote("绋嬪簭鍔犺浇澶辫触锛岃鑱旂郴杩愯惀");
    document.body.appendChild(app);
  } catch (err) {
    console.error(err);
    setNote("鏁版嵁鍔犺浇澶辫触锛岃妫€鏌?GitHub Actions 澶嶆牳缁撴灉");
    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `<section class="panel load-error"><h2>鏁版嵁鍔犺浇澶辫触</h2><p>灏忕▼搴忔病鏈夎鍙栧埌宸插鏍搁€氳繃鐨勬渶鏂版暟鎹紝璇风‘璁?data/app-data.json 瀛樺湪銆?/p><pre>${String(err.message || err)}</pre></section>`;
    }
  }
})();

