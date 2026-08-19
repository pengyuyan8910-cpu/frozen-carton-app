const text = value => String(value ?? "").trim();
const number = value => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};
const round = (value, digits = 4) => Number(number(value).toFixed(digits));
const clone = value => JSON.parse(JSON.stringify(value));
const skuKey = row => text(row?.barcode || row?.skuKey || row?.name);

function rowMetrics(row, params) {
  const full = number(row.skuFull || row.rowFull || row.fullCount || Math.round(number(row.displayCols) * number(row.perCol)));
  const trigger = Math.ceil(full * number(params?.triggerRate || 0.1));
  const receivable = Math.max(0, full - trigger);
  const inShelf = Math.min(number(row.carton), receivable);
  const external = row.externalOwner === false ? 0 : row.externalCountOverride !== undefined
    ? number(row.externalCountOverride)
    : Math.max(0, number(row.carton) - inShelf);
  const staticExternalL = row.staticExternalOverride !== undefined
    ? number(row.staticExternalOverride)
    : external * number(row.volume);
  const avgExternalL = row.avgExternalOverride !== undefined
    ? number(row.avgExternalOverride)
    : staticExternalL / 2;
  return { full, trigger, receivable, inShelf, external, staticExternalL, avgExternalL };
}

function updateStoreSummaries(data, draft) {
  const byStore = new Map((draft.results || []).map(result => [text(result.store), result]));
  for (const store of data.stores || []) {
    const result = byStore.get(text(store.store));
    if (!result) continue;
    const summary = result.plan?.summary || result.metrics || {};
    Object.assign(store, {
      skuCount: number(summary.includedSkuCount),
      directSku: number(summary.directCartonSkuCount),
      externalSku: number(summary.externalSkuCount),
      staticExternalL: round(summary.staticExternalL, 1),
      dynamicAvgExternalL: round(summary.dynamicAvgExternalL ?? summary.avgExternalL, 1),
      dynamicP95L: round(summary.dynamicP95ExternalL ?? summary.p95ExternalL, 1),
      suggestedExternalL: number(summary.suggestedExternalL),
      over754: number(summary.suggestedExternalL) > number(data.params?.externalCapL || 754),
      missingSkuCount: number(summary.unplacedSkuCount),
      excludedSku: number(summary.excludedForStoreCount),
      sourceNote: "按当前67SKU产品池与统一严格排柜逻辑全量重排；结果已独立复核"
    });
  }
}

function updateCabinetSummaries(data, draft) {
  const byKey = new Map();
  for (const result of draft.results || []) {
    for (const cabinet of result.plan?.cabinets || []) byKey.set(text(cabinet.key), cabinet);
  }
  for (const cabinet of data.cabinets || []) {
    const next = byKey.get(text(cabinet.key));
    if (!next) continue;
    const itemRows = (data.skus || []).filter(row => row.included !== false && row.cabinetKey === cabinet.key);
    const categories = [...new Set(itemRows.map(row => text(row.category3)).filter(Boolean))];
    Object.assign(cabinet, {
      usedWidth: round(next.usedWidth, 1),
      sourceUsed: round(next.usedWidth, 1),
      leftWidth: round(next.leftWidth, 1),
      sourceLeft: round(next.leftWidth, 1),
      overWidth: Boolean(next.overWidth),
      items: (next.items || []).slice(),
      categoryMix: categories.join("、"),
      itemSummary: itemRows.map(row => `${text(row.name)}(${number(row.displayCols)}列/${number(row.faceWidth)}mm)`).join("；"),
      largeRemainderReason: text(cabinet.largeRemainderReason) || (number(next.usedWidth) > 0 && number(next.leftWidth) > 300
        ? "严格排柜已收敛；当前无可追加且不破坏物理方向、同SKU同柜型及外储约束的SKU，保留空位"
        : "")
    });
  }
}

function updateExcludedAndExternalRows(data) {
  const excluded = [];
  const externalRows = [];
  for (const row of data.skus || []) {
    const metrics = rowMetrics(row, data.params);
    if (row.included === false) {
      excluded.push({
        store: row.store,
        trigger: "小于等于10%触发",
        status: "暂不纳入",
        reason: row.reason || "门店柜体容量有限，按严格排柜优先级未纳入本店。",
        reasonCode: row.reasonCode || "STORE_CAPACITY_PRIORITY",
        grade: row.grade,
        rank: row.rank,
        category2: row.category2,
        category3: row.category3,
        category4: row.category4,
        name: row.name,
        barcode: row.barcode
      });
    }
    if (row.included !== false && metrics.external > 0) {
      externalRows.push({
        store: row.store,
        name: row.name,
        barcode: row.barcode,
        grade: row.grade,
        rank: row.rank,
        category3: row.category3,
        sceneGroup: row.sceneGroup,
        category4: row.category4,
        cabinetType: row.cabinetType,
        cabinetLabel: row.cabinetLabel,
        position: row.position,
        carton: row.carton,
        skuFull: metrics.full,
        trigger: metrics.trigger,
        receivable: metrics.receivable,
        inShelf: metrics.inShelf,
        external: metrics.external,
        staticExternalL: round(metrics.staticExternalL),
        avgExternalL: round(metrics.avgExternalL),
        volume: row.volume
      });
    }
  }
  data.excluded = excluded;
  data.externalRows = externalRows;
}

function applyPlansAsPlacementRows(data, draft) {
  const selectedStores = new Set((draft.results || []).map(result => text(result.store)));
  const templates = new Map();
  for (const row of data.skus || []) {
    const key = `${text(row.store)}|${skuKey(row)}`;
    if (!templates.has(key)) templates.set(key, row);
  }
  const nextRows = (data.skus || []).filter(row => !selectedStores.has(text(row.store)));
  for (const result of draft.results || []) {
    const plan = result.plan || {};
    for (const planRow of plan.rows || []) {
      const key = text(planRow.skuKey || planRow.barcode || planRow.name);
      const template = templates.get(`${text(result.store)}|${key}`) || {};
      const placements = planRow.included !== false && Array.isArray(planRow.placements) ? planRow.placements : [];
      if (!placements.length) {
        nextRows.push({
          ...clone(template),
          ...clone(planRow),
          id: template.id || `strict_${text(result.store)}_${key}`,
          store: result.store,
          included: false,
          status: "产品池重排-本店未纳入",
          cabinetKey: "",
          cabinetLabel: "",
          position: "",
          cabinetType: "",
          orientation: "",
          displayCols: 0,
          totalDisplayCols: 0,
          perCol: 0,
          faceWidth: 0,
          placements: [],
          rowFull: 0,
          skuFull: 0,
          fullCount: 0,
          usedWidth: 0,
          widthUsed: 0,
          externalOwner: true,
          externalCountOverride: 0,
          staticExternalOverride: 0,
          avgExternalOverride: 0,
          externalQty: 0,
          staticExternalL: 0,
          reasonCode: planRow.reasonCode || "STORE_CAPACITY_PRIORITY",
          reason: planRow.reason || planRow.excludeReason || "门店柜体容量有限，按严格排柜优先级未纳入本店。"
        });
        continue;
      }
      placements.forEach((placement, index) => {
        const p = clone(placement);
        const perPlacementId = index === 0 && template.id
          ? template.id
          : `strict_${text(result.store)}_${key}_${index + 1}`;
        const rowMetricsValue = {
          displayCols: number(p.displayCols),
          full: number(p.fullCount),
          trigger: Math.ceil(number(p.fullCount) * number(data.params?.triggerRate || 0.1)),
          receivable: Math.max(0, number(p.fullCount) - Math.ceil(number(p.fullCount) * number(data.params?.triggerRate || 0.1))),
          carton: number(planRow.carton),
          externalQty: number(p.externalQty),
          staticExternalL: number(p.staticExternalL),
          avgExternalL: number(p.staticExternalL) / 2,
          usedWidth: number(p.widthUsed),
          perCol: number(p.perCol),
          faceWidth: number(p.faceWidth),
          columns: number(p.displayCols)
        };
        nextRows.push({
          ...clone(template),
          ...clone(planRow),
          id: perPlacementId,
          store: result.store,
          included: true,
          status: "纳入-严格重排",
          cabinetKey: p.cabinetKey,
          cabinetLabel: p.cabinetLabel,
          position: p.position,
          cabinetType: p.cabinetType,
          cabinetTypeFilter: p.cabinetKind || p.cabinetType,
          orientation: p.orientation,
          displayCols: number(p.displayCols),
          totalDisplayCols: number(p.displayCols),
          perCol: number(p.perCol),
          faceWidth: number(p.faceWidth),
          placements: [p],
          placementRole: placements.length > 1 ? "分陈列" : (template.placementRole || "单陈列"),
          rowFull: number(p.fullCount),
          skuFull: number(p.fullCount),
          fullCount: number(p.fullCount),
          usedWidth: number(p.widthUsed),
          widthUsed: number(p.widthUsed),
          externalOwner: true,
          externalCountOverride: number(p.externalQty),
          staticExternalOverride: number(p.staticExternalL),
          avgExternalOverride: number(p.staticExternalL) / 2,
          externalQty: number(p.externalQty),
          staticExternalL: number(p.staticExternalL),
          metrics: rowMetricsValue,
          sourceAdvice: "统一严格排柜",
          sourceAction: "长宽横向占宽；卧柜堆叠/立柜不堆叠；除法四舍五入"
        });
      });
    }
  }
  data.skus = nextRows;
}

function overlayPhysicalRecords(data, records = []) {
  const byKey = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = text(record.key) || `${text(record.store)}__${text(record.label)}__${text(record.position)}`;
    if (key) byKey.set(key, record);
  }
  for (const cabinet of data.cabinets || []) {
    const record = byKey.get(text(cabinet.key));
    if (!record) continue;
    Object.assign(cabinet, {
      length: number(record.length),
      depth: number(record.depth),
      height: number(record.height),
      physicalSource: text(record.source) || "user-confirmed-physical-dimensions",
      sourceCabinetKey: text(record.sourceCabinetKey) || cabinet.key
    });
  }
}

export function applyStrictDraftToFormalData(source, draft, physicalRecords = []) {
  if (!source || !Array.isArray(source.productPool) || !Array.isArray(source.stores) || !Array.isArray(source.skus) || !Array.isArray(source.cabinets)) {
    throw new Error("正式数据缺少 productPool/stores/skus/cabinets，拒绝写回");
  }
  if (!draft || !Array.isArray(draft.results) || draft.results.length !== source.stores.length) {
    throw new Error("全量重排结果不完整，拒绝写回");
  }
  const failed = draft.results.filter(result => result.validation?.ok !== true);
  if (failed.length) throw new Error(`重排校验未通过：${failed.map(result => result.store).join("、")}`);

  const originalPoolKeys = source.productPool.map(skuKey).sort();
  const next = clone(source);
  overlayPhysicalRecords(next, physicalRecords);
  applyPlansAsPlacementRows(next, draft);
  const nextPoolKeys = next.productPool.map(skuKey).sort();
  if (JSON.stringify(originalPoolKeys) !== JSON.stringify(nextPoolKeys)) throw new Error("正式产品池发生非预期变化，拒绝写回");

  updateStoreSummaries(next, draft);
  updateCabinetSummaries(next, draft);
  updateExcludedAndExternalRows(next);
  next.meta = {
    ...(next.meta || {}),
    version: "10%触发-最新67SKU-长宽占宽-严格重排-20260820",
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    source: "当前67SKU正式产品池 + 统一严格排柜全量重排"
  };
  next.replanAudit = {
    generatedAt: draft.generatedAt,
    productPoolRevision: draft.productPoolRevision,
    storeCount: draft.summary.storeCount,
    validationPassed: failed.length === 0,
    appliedMode: "全量严格重排写回正式底表"
  };
  return next;
}
