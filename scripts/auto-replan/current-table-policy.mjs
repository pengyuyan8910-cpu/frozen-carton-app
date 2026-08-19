import { EPSILON, asNumber, gradeScore, round, stableCompare } from "./common.mjs";
import { calculateSkuInventoryMetrics, summarizeStoreInventoryMetrics } from "./inventory-metrics.mjs";
import { loadAndValidatePhase0 } from "./phase0-input.mjs";
import { calculatePhysicalCandidates } from "./phase1-physical-candidates.mjs";
import { buildSkuPriority } from "./phase2-sku-priority.mjs";
import {
  acceptPlacement,
  canFitPlacement,
  createSegmentState,
  expandPlacementOneColumn,
  releasePlacement,
  validateSegmentWidthLedgers
} from "./segment-width-ledger.mjs";

const SCENE_ORDER = Object.freeze([
  "雪糕冰品",
  "预制主食",
  "预制菜类",
  "火锅食材",
  "冷冻食材"
]);

const STORE_EXCLUSION_REASON = Object.freeze({
  code: "STORE_CAPACITY_PRIORITY",
  text: "门店柜体容量有限，按销售及经营优先级未纳入本店。"
});

function sceneOrder(value) {
  const index = SCENE_ORDER.indexOf(String(value || ""));
  return index < 0 ? SCENE_ORDER.length : index;
}

function allocationOrder(products, candidatesBySku) {
  const groups = new Map();
  for (const product of products) {
    const key = `${product.sceneGroup}\u0000${product.category4}`;
    const group = groups.get(key) || [];
    group.push(product);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(group => group.sort((left, right) => {
      const leftWidth = Math.min(...(candidatesBySku?.get(left.skuKey) || []).map(item => item.faceWidth));
      const rightWidth = Math.min(...(candidatesBySku?.get(right.skuKey) || []).map(item => item.faceWidth));
      return rightWidth - leftWidth
      || left.priorityOrder - right.priorityOrder
      || stableCompare(left.skuKey, right.skuKey);
    }))
    .sort((left, right) => sceneOrder(left[0]?.sceneGroup) - sceneOrder(right[0]?.sceneGroup)
      || left[0].priorityOrder - right[0].priorityOrder
      || stableCompare(left[0]?.category4, right[0]?.category4))
    .flat();
}

function aggregateInventory(product, rows, params) {
  const fullDisplay = rows.reduce((sum, row) => sum + row.perCol * row.displayCols, 0);
  const metrics = calculateSkuInventoryMetrics({
    perCol: fullDisplay,
    displayCols: fullDisplay > 0 ? 1 : 0,
    cartonQty: product.carton,
    triggerRate: params.triggerRate,
    unitVolumeL: product.volume,
    dailyQty: product.dailyQty,
    faceWidth: 0
  });
  return Object.freeze({
    ...metrics,
    fullDisplay,
    perCol: rows.length === 1 ? rows[0].perCol : null,
    displayCols: rows.reduce((sum, row) => sum + row.displayCols, 0),
    usedWidth: round(rows.reduce((sum, row) => sum + row.faceWidth * row.displayCols, 0))
  });
}

function refreshSkuMetrics(stage, skuKey) {
  const product = stage.productBySku.get(skuKey);
  const rows = stage.placements.filter(row => row.skuKey === skuKey);
  const metrics = aggregateInventory(product, rows, stage.params);
  stage.skuMetrics.set(skuKey, metrics);
  for (const row of rows) row.skuMetrics = metrics;
  return metrics;
}

function inventorySummary(stage) {
  return summarizeStoreInventoryMetrics([...stage.skuMetrics.values()], stage.params);
}

function categoryPresence(stage, candidate, product, field) {
  const value = product[field];
  if (!value) return 0;
  return stage.placements.filter(row => row[field] === value && row.cabinetLabel === candidate.cabinetLabel).length;
}

function chooseCoverageCandidate(stage, product) {
  const candidates = (stage.candidatesBySku.get(product.skuKey) || [])
    .filter(candidate => {
      const segment = stage.segmentStates.get(candidate.cabinetKey);
      return segment && canFitPlacement(segment, candidate.faceWidth);
    })
    .map(candidate => {
      const segment = stage.segmentStates.get(candidate.cabinetKey);
      return {
        candidate,
        exactScene: Boolean(segment.sceneGroup && segment.sceneGroup === product.sceneGroup),
        category4Count: categoryPresence(stage, candidate, product, "category4"),
        category3Count: categoryPresence(stage, candidate, product, "category3"),
        efficiency: candidate.perCol / candidate.faceWidth,
        remainingAfter: segment.remainingWidth - candidate.faceWidth
      };
    });
  candidates.sort((left, right) => Number(right.exactScene) - Number(left.exactScene)
    || right.category4Count - left.category4Count
    || right.category3Count - left.category3Count
    || right.efficiency - left.efficiency
    || right.candidate.perCol - left.candidate.perCol
    || left.remainingAfter - right.remainingAfter
    || left.candidate.faceWidth - right.candidate.faceWidth
    || stableCompare(left.candidate.cabinetKey, right.candidate.cabinetKey)
    || stableCompare(left.candidate.orientation, right.candidate.orientation));
  return candidates[0]?.candidate || null;
}

function createPlacement(stage, product, candidate, role = "PRIMARY", displayCols = 1) {
  const segment = stage.segmentStates.get(candidate.cabinetKey);
  const row = {
    skuKey: product.skuKey,
    name: product.name,
    sceneGroup: product.sceneGroup,
    category3: product.category3,
    category4: product.category4,
    grade: product.grade,
    rank: product.rank,
    dailyQty: product.dailyQty,
    businessPriority: product.businessPriority,
    highValueProtected: product.highValueProtected,
    priorityOrder: product.priorityOrder,
    cabinetKey: candidate.cabinetKey,
    segmentKey: candidate.cabinetKey,
    cabinetLabel: candidate.cabinetLabel,
    cabinetNo: candidate.cabinetLabel,
    cabinetType: segment.kind || segment.type,
    position: candidate.position,
    cabinetClass: candidate.cabinetClass,
    orientation: candidate.orientation,
    faceWidth: candidate.faceWidth,
    orientedDepth: candidate.orientedDepth,
    orientedHeight: candidate.orientedHeight,
    depthCount: candidate.depthCount,
    stackCount: candidate.stackCount,
    perCol: candidate.perCol,
    displayCols,
    physicalSource: candidate.physicalSource,
    ice: product.ice,
    role
  };
  acceptPlacement(segment, row);
  stage.placements.push(row);
  refreshSkuMetrics(stage, product.skuKey);
  return row;
}

function buildCoverage(phase2, excludedSkuKeys) {
  const saleSegments = phase2.cabinets.filter(cabinet => cabinet.saleEligible);
  const includedProducts = phase2.rankedSkus.filter(product => !excludedSkuKeys.has(product.skuKey));
  const stage = {
    policy: "CURRENT_TABLE_POLICY",
    store: phase2.store,
    params: phase2.params,
    rankedSkus: phase2.rankedSkus,
    candidatesBySku: phase2.candidatesBySku,
    productBySku: new Map(phase2.rankedSkus.map(product => [product.skuKey, product])),
    segmentStates: new Map(saleSegments.map(segment => [segment.key, createSegmentState(segment)])),
    placements: [],
    skuMetrics: new Map(),
    pendingSkus: [],
    actions: []
  };
  for (const product of allocationOrder(includedProducts, phase2.candidatesBySku)) {
    const candidate = chooseCoverageCandidate(stage, product);
    if (!candidate) {
      stage.pendingSkus.push({
        skuKey: product.skuKey,
        name: product.name,
        reasonCode: (stage.candidatesBySku.get(product.skuKey) || []).length
          ? "NO_REMAINING_WIDTH"
          : "NO_LEGAL_PHYSICAL_CANDIDATE",
        reason: (stage.candidatesBySku.get(product.skuKey) || []).length
          ? "当前合法柜段没有足够连续宽度。"
          : "现有柜体物理尺寸无法合法陈列。"
      });
      continue;
    }
    const row = createPlacement(stage, product, candidate);
    stage.actions.push({ type: "基础覆盖", skuKey: product.skuKey, segmentKey: row.segmentKey });
  }
  return stage;
}

function expansionBenefit(stage, product, addedCapacity) {
  const before = stage.skuMetrics.get(product.skuKey);
  const currentRows = stage.placements.filter(row => row.skuKey === product.skuKey);
  const fullDisplay = currentRows.reduce((sum, row) => sum + row.perCol * row.displayCols, 0) + addedCapacity;
  const after = calculateSkuInventoryMetrics({
    perCol: fullDisplay,
    displayCols: 1,
    cartonQty: product.carton,
    triggerRate: stage.params.triggerRate,
    unitVolumeL: product.volume,
    dailyQty: product.dailyQty,
    faceWidth: 0
  });
  return {
    before,
    after,
    directTransition: !before.directCase && after.directCase,
    externalUnitReduction: before.externalUnits - after.externalUnits,
    staticReductionL: round(before.staticExternalL - after.staticExternalL)
  };
}

function actionPriority(action) {
  return [
    action.abProtected ? 1 : 0,
    action.directTransition ? 1 : 0,
    action.staticReductionL,
    action.externalUnitReduction,
    action.layoutPriority || 0,
    action.gradeScore,
    -action.rank,
    action.dailyQty,
    action.staticReductionL / action.requiredWidth
  ];
}

function compareExpansion(left, right) {
  const a = actionPriority(left);
  const b = actionPriority(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return stableCompare(left.stableKey, right.stableKey);
}

function expansionActions(stage) {
  const actions = [];
  for (const row of stage.placements) {
    const segment = stage.segmentStates.get(row.segmentKey);
    if (!segment || !canFitPlacement(segment, row.faceWidth)) continue;
    const product = stage.productBySku.get(row.skuKey);
    const benefit = expansionBenefit(stage, product, row.perCol);
    if (!(benefit.externalUnitReduction > 0)) continue;
    actions.push({
      type: "EXPAND_EXISTING",
      row,
      segment,
      product,
      requiredWidth: row.faceWidth,
      addedCapacity: row.perCol,
      abProtected: gradeScore(product.grade) >= gradeScore("B"),
      gradeScore: gradeScore(product.grade),
      rank: product.rank,
      dailyQty: product.dailyQty,
      stableKey: `0|${row.skuKey}|${row.segmentKey}`,
      layoutPriority: 0,
      ...benefit
    });
  }
  for (const product of stage.rankedSkus) {
    if (gradeScore(product.grade) < gradeScore("B")) continue;
    const rows = stage.placements.filter(row => row.skuKey === product.skuKey);
    if (!rows.length || stage.skuMetrics.get(product.skuKey)?.directCase) continue;
    const occupiedClasses = new Set(rows.map(row => row.cabinetClass));
    const candidates = (stage.candidatesBySku.get(product.skuKey) || [])
      .filter(candidate => !occupiedClasses.has(candidate.cabinetClass))
      .filter(candidate => {
        const segment = stage.segmentStates.get(candidate.cabinetKey);
        return segment && canFitPlacement(segment, candidate.faceWidth);
      });
    for (const candidate of candidates) {
      const segment = stage.segmentStates.get(candidate.cabinetKey);
      const benefit = expansionBenefit(stage, product, candidate.perCol);
      if (!(benefit.externalUnitReduction > 0)) continue;
      actions.push({
        type: "ADD_SECONDARY_TYPE",
        candidate,
        segment,
        product,
        requiredWidth: candidate.faceWidth,
        addedCapacity: candidate.perCol,
        abProtected: true,
        gradeScore: gradeScore(product.grade),
        rank: product.rank,
        dailyQty: product.dailyQty,
        stableKey: `1|${product.skuKey}|${candidate.cabinetKey}|${candidate.orientation}`,
        layoutPriority: 0,
        ...benefit
      });
    }
  }
  return actions.sort(compareExpansion);
}

function applyExpansion(stage, action) {
  if (action.type === "EXPAND_EXISTING") {
    const nextRowMetrics = calculateSkuInventoryMetrics({
      perCol: action.row.perCol,
      displayCols: action.row.displayCols + 1,
      cartonQty: action.product.carton,
      triggerRate: stage.params.triggerRate,
      unitVolumeL: action.product.volume,
      dailyQty: action.product.dailyQty,
      faceWidth: action.row.faceWidth
    });
    const result = expandPlacementOneColumn(action.segment, action.row, nextRowMetrics);
    if (!result.accepted) return false;
    refreshSkuMetrics(stage, action.row.skuKey);
  } else {
    createPlacement(stage, action.product, action.candidate, "SECONDARY_CABINET_TYPE");
  }
  stage.actions.push({
    type: action.type === "EXPAND_EXISTING" ? "定向扩陈" : "跨柜型补充陈列",
    skuKey: action.product.skuKey,
    segmentKey: action.segment.key,
    reducedStaticExternalL: action.staticReductionL,
    directCaseTransition: action.directTransition
  });
  return true;
}

function relocationActions(stage) {
  const actions = [];
  for (const row of stage.placements) {
    const product = stage.productBySku.get(row.skuKey);
    const before = stage.skuMetrics.get(row.skuKey);
    if (!before || before.directCase) continue;
    const currentCapacity = row.perCol * row.displayCols;
    for (const candidate of stage.candidatesBySku.get(row.skuKey) || []) {
      if (candidate.cabinetClass !== row.cabinetClass || candidate.cabinetKey === row.segmentKey) continue;
      const target = stage.segmentStates.get(candidate.cabinetKey);
      const nextColumns = row.displayCols + 1;
      const requiredWidth = candidate.faceWidth * nextColumns;
      if (!target || !canFitPlacement(target, requiredWidth)) continue;
      const rows = stage.placements.filter(item => item.skuKey === row.skuKey);
      const nextFullDisplay = rows.reduce((sum, item) => sum + item.perCol * item.displayCols, 0)
        - currentCapacity + candidate.perCol * nextColumns;
      const after = calculateSkuInventoryMetrics({
        perCol: nextFullDisplay,
        displayCols: 1,
        cartonQty: product.carton,
        triggerRate: stage.params.triggerRate,
        unitVolumeL: product.volume,
        dailyQty: product.dailyQty,
        faceWidth: 0
      });
      const externalUnitReduction = before.externalUnits - after.externalUnits;
      if (!(externalUnitReduction > 0)) continue;
      actions.push({
        type: "RELOCATE_AND_EXPAND",
        row,
        product,
        candidate,
        source: stage.segmentStates.get(row.segmentKey),
        target,
        nextColumns,
        requiredWidth,
        addedCapacity: nextFullDisplay - (nextFullDisplay - candidate.perCol * nextColumns + currentCapacity),
        abProtected: gradeScore(product.grade) >= gradeScore("B"),
        gradeScore: gradeScore(product.grade),
        rank: product.rank,
        dailyQty: product.dailyQty,
        before,
        after,
        directTransition: !before.directCase && after.directCase,
        externalUnitReduction,
        staticReductionL: round(before.staticExternalL - after.staticExternalL),
        stableKey: `2|${row.skuKey}|${row.segmentKey}|${candidate.cabinetKey}|${candidate.orientation}`
        ,layoutPriority: 1
      });
    }
  }
  return actions.sort(compareExpansion);
}

function applyRelocation(stage, action) {
  releasePlacement(action.source, action.row);
  Object.assign(action.row, {
    cabinetKey: action.candidate.cabinetKey,
    segmentKey: action.candidate.cabinetKey,
    cabinetLabel: action.candidate.cabinetLabel,
    cabinetNo: action.candidate.cabinetLabel,
    cabinetType: action.target.kind || action.target.type,
    position: action.candidate.position,
    cabinetClass: action.candidate.cabinetClass,
    orientation: action.candidate.orientation,
    faceWidth: action.candidate.faceWidth,
    orientedDepth: action.candidate.orientedDepth,
    orientedHeight: action.candidate.orientedHeight,
    depthCount: action.candidate.depthCount,
    stackCount: action.candidate.stackCount,
    perCol: action.candidate.perCol,
    displayCols: action.nextColumns,
    physicalSource: action.candidate.physicalSource
  });
  acceptPlacement(action.target, action.row);
  refreshSkuMetrics(stage, action.row.skuKey);
  stage.actions.push({
    type: "移动后扩陈",
    skuKey: action.row.skuKey,
    fromSegmentKey: action.source.key,
    segmentKey: action.target.key,
    reducedStaticExternalL: action.staticReductionL,
    directCaseTransition: action.directTransition
  });
  return true;
}

function optimizeColumns(stage) {
  while (true) {
    const action = [...expansionActions(stage), ...relocationActions(stage)].sort(compareExpansion)[0];
    if (!action) break;
    if (action.type === "RELOCATE_AND_EXPAND") {
      if (!applyRelocation(stage, action)) break;
    } else if (!applyExpansion(stage, action)) break;
  }
  return stage;
}

function prepareLargeSegments(stage) {
  const movedSkuKeys = new Set();
  const processedSegmentKeys = new Set();
  while (true) {
    const target = [...stage.segmentStates.values()]
      .filter(segment => segment.remainingWidth > 300 + EPSILON && !processedSegmentKeys.has(segment.key))
      .sort((left, right) => right.remainingWidth - left.remainingWidth || stableCompare(left.key, right.key))[0];
    if (!target) break;
    processedSegmentKeys.add(target.key);
    const actions = [];
    for (const row of stage.placements) {
      if (movedSkuKeys.has(row.skuKey) || row.segmentKey === target.key) continue;
      const source = stage.segmentStates.get(row.segmentKey);
      const product = stage.productBySku.get(row.skuKey);
      const metrics = stage.skuMetrics.get(row.skuKey);
      if (!source || !metrics || metrics.directCase) continue;
      if (!(source.placements.length > 1 || source.remainingWidth < row.faceWidth - EPSILON)) continue;
      for (const candidate of stage.candidatesBySku.get(row.skuKey) || []) {
        if (candidate.cabinetKey !== target.key || candidate.cabinetClass !== row.cabinetClass) continue;
        if (!canFitPlacement(target, candidate.faceWidth * row.displayCols)) continue;
        actions.push({
          row,
          product,
          source,
          target,
          candidate,
          exactScene: Boolean(target.sceneGroup && target.sceneGroup === product.sceneGroup),
          abProtected: gradeScore(product.grade) >= gradeScore("B"),
          gradeScore: gradeScore(product.grade),
          rank: product.rank,
          dailyQty: product.dailyQty,
          efficiency: candidate.perCol / candidate.faceWidth,
          stableKey: `${row.skuKey}|${target.key}|${candidate.orientation}`
        });
      }
    }
    actions.sort((left, right) => Number(right.exactScene) - Number(left.exactScene)
      || Number(right.abProtected) - Number(left.abProtected)
      || right.gradeScore - left.gradeScore
      || left.rank - right.rank
      || right.dailyQty - left.dailyQty
      || right.efficiency - left.efficiency
      || stableCompare(left.stableKey, right.stableKey));
    const action = actions[0];
    if (!action) continue;
    releasePlacement(action.source, action.row);
    Object.assign(action.row, {
      cabinetKey: action.candidate.cabinetKey,
      segmentKey: action.candidate.cabinetKey,
      cabinetLabel: action.candidate.cabinetLabel,
      cabinetNo: action.candidate.cabinetLabel,
      cabinetType: action.target.kind || action.target.type,
      position: action.candidate.position,
      cabinetClass: action.candidate.cabinetClass,
      orientation: action.candidate.orientation,
      faceWidth: action.candidate.faceWidth,
      orientedDepth: action.candidate.orientedDepth,
      orientedHeight: action.candidate.orientedHeight,
      depthCount: action.candidate.depthCount,
      stackCount: action.candidate.stackCount,
      perCol: action.candidate.perCol,
      physicalSource: action.candidate.physicalSource
    });
    acceptPlacement(action.target, action.row);
    refreshSkuMetrics(stage, action.row.skuKey);
    movedSkuKeys.add(action.row.skuKey);
    processedSegmentKeys.delete(action.source.key);
    stage.actions.push({
      type: "大余量柜段补位",
      skuKey: action.row.skuKey,
      fromSegmentKey: action.source.key,
      segmentKey: action.target.key
    });
  }
  return stage;
}

function metricsAfterRowCandidate(stage, row, candidate) {
  const product = stage.productBySku.get(row.skuKey);
  const rows = stage.placements.filter(item => item.skuKey === row.skuKey);
  const fullDisplay = rows.reduce((sum, item) => sum + item.perCol * item.displayCols, 0)
    - row.perCol * row.displayCols + candidate.perCol * row.displayCols;
  return calculateSkuInventoryMetrics({
    perCol: fullDisplay,
    displayCols: 1,
    cartonQty: product.carton,
    triggerRate: stage.params.triggerRate,
    unitVolumeL: product.volume,
    dailyQty: product.dailyQty,
    faceWidth: 0
  });
}

function candidateForSegment(stage, row, segmentKey) {
  return (stage.candidatesBySku.get(row.skuKey) || [])
    .filter(candidate => candidate.cabinetKey === segmentKey)
    .sort((left, right) => right.perCol - left.perCol
      || left.faceWidth - right.faceWidth
      || stableCompare(left.orientation, right.orientation))[0] || null;
}

function assignCandidate(row, candidate, segment) {
  Object.assign(row, {
    cabinetKey: candidate.cabinetKey,
    segmentKey: candidate.cabinetKey,
    cabinetLabel: candidate.cabinetLabel,
    cabinetNo: candidate.cabinetLabel,
    cabinetType: segment.kind || segment.type,
    position: candidate.position,
    cabinetClass: candidate.cabinetClass,
    orientation: candidate.orientation,
    faceWidth: candidate.faceWidth,
    orientedDepth: candidate.orientedDepth,
    orientedHeight: candidate.orientedHeight,
    depthCount: candidate.depthCount,
    stackCount: candidate.stackCount,
    perCol: candidate.perCol,
    physicalSource: candidate.physicalSource
  });
}

function improveBySwaps(stage) {
  while (true) {
    const actions = [];
    for (let leftIndex = 0; leftIndex < stage.placements.length; leftIndex += 1) {
      const left = stage.placements[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < stage.placements.length; rightIndex += 1) {
        const right = stage.placements[rightIndex];
        if (left.skuKey === right.skuKey || left.segmentKey === right.segmentKey) continue;
        const leftTarget = stage.segmentStates.get(right.segmentKey);
        const rightTarget = stage.segmentStates.get(left.segmentKey);
        const leftCandidate = candidateForSegment(stage, left, right.segmentKey);
        const rightCandidate = candidateForSegment(stage, right, left.segmentKey);
        if (!leftCandidate || !rightCandidate) continue;
        const leftOtherClasses = new Set(stage.placements.filter(row => row.skuKey === left.skuKey && row !== left).map(row => row.cabinetClass));
        const rightOtherClasses = new Set(stage.placements.filter(row => row.skuKey === right.skuKey && row !== right).map(row => row.cabinetClass));
        if (leftOtherClasses.has(leftCandidate.cabinetClass) || rightOtherClasses.has(rightCandidate.cabinetClass)) continue;
        const leftAvailable = leftTarget.remainingWidth + right.faceWidth * right.displayCols;
        const rightAvailable = rightTarget.remainingWidth + left.faceWidth * left.displayCols;
        if (leftCandidate.faceWidth * left.displayCols > leftAvailable + EPSILON
          || rightCandidate.faceWidth * right.displayCols > rightAvailable + EPSILON) continue;
        const before = stage.skuMetrics.get(left.skuKey).staticExternalL + stage.skuMetrics.get(right.skuKey).staticExternalL;
        const leftAfter = metricsAfterRowCandidate(stage, left, leftCandidate);
        const rightAfter = metricsAfterRowCandidate(stage, right, rightCandidate);
        const reduction = round(before - leftAfter.staticExternalL - rightAfter.staticExternalL);
        if (!(reduction > EPSILON)) continue;
        actions.push({
          left,
          right,
          leftCandidate,
          rightCandidate,
          leftSource: stage.segmentStates.get(left.segmentKey),
          rightSource: stage.segmentStates.get(right.segmentKey),
          reduction,
          directGain: Number(leftAfter.directCase) + Number(rightAfter.directCase)
            - Number(stage.skuMetrics.get(left.skuKey).directCase) - Number(stage.skuMetrics.get(right.skuKey).directCase),
          stableKey: `${left.skuKey}|${right.skuKey}|${left.segmentKey}|${right.segmentKey}`
        });
      }
    }
    actions.sort((left, right) => right.directGain - left.directGain
      || right.reduction - left.reduction
      || stableCompare(left.stableKey, right.stableKey));
    const action = actions[0];
    if (!action) break;
    releasePlacement(action.leftSource, action.left);
    releasePlacement(action.rightSource, action.right);
    assignCandidate(action.left, action.leftCandidate, action.rightSource);
    assignCandidate(action.right, action.rightCandidate, action.leftSource);
    acceptPlacement(action.rightSource, action.left);
    acceptPlacement(action.leftSource, action.right);
    refreshSkuMetrics(stage, action.left.skuKey);
    refreshSkuMetrics(stage, action.right.skuKey);
    stage.actions.push({ type: "柜位互换", leftSkuKey: action.left.skuKey, rightSkuKey: action.right.skuKey, reducedStaticExternalL: action.reduction });
  }
  return stage;
}

function exclusionOrder(stage) {
  return stage.rankedSkus.slice().sort((left, right) => gradeScore(left.grade) - gradeScore(right.grade)
    || right.rank - left.rank
    || left.dailyQty - right.dailyQty
    || left.businessPriority - right.businessPriority
    || stableCompare(right.skuKey, left.skuKey));
}

function summarizePolicy(stage, allProducts, excluded) {
  const widthValidation = validateSegmentWidthLedgers(stage.segmentStates);
  const inventory = inventorySummary(stage);
  const segments = [...stage.segmentStates.values()];
  const placementBySku = new Map();
  for (const row of stage.placements) {
    const list = placementBySku.get(row.skuKey) || [];
    list.push(row);
    placementBySku.set(row.skuKey, list);
  }
  const sameTypeSplitCount = [...placementBySku.values()].filter(rows => {
    const byClass = new Map();
    for (const row of rows) {
      const positions = byClass.get(row.cabinetClass) || new Set();
      positions.add(row.segmentKey);
      byClass.set(row.cabinetClass, positions);
    }
    return [...byClass.values()].some(positions => positions.size > 1);
  }).length;
  const categoryCabinets = new Map();
  for (const row of stage.placements) {
    const cabinets = categoryCabinets.get(row.category4) || new Set();
    cabinets.add(row.cabinetLabel);
    categoryCabinets.set(row.category4, cabinets);
  }
  const validation = {
    ok: widthValidation.ok
      && stage.pendingSkus.every(item => item.reason)
      && allProducts.length === placementBySku.size + excluded.length + stage.pendingSkus.length
      && sameTypeSplitCount === 0
      && inventory.suggestedExternalL <= stage.params.externalCapL,
    overWidthCount: widthValidation.overWidthCount,
    widthLedgerMismatchCount: widthValidation.ledgerMismatchCount,
    layer6SalesCount: stage.placements.filter(row => /第\s*6\s*层/.test(row.position)).length,
    iceMismatchCount: stage.placements.filter(row => Boolean(row.ice) !== Boolean(stage.segmentStates.get(row.segmentKey)?.iceOnly)).length,
    sameTypeSplitCount,
    skuConservation: allProducts.length === placementBySku.size + excluded.length + stage.pendingSkus.length,
    inventoryMetricErrorCount: [...stage.skuMetrics.values()].filter(metrics => Object.values(metrics).some(value => typeof value === "number" && !Number.isFinite(value))).length,
    widthLedger: widthValidation
  };
  validation.ok = validation.ok
    && validation.layer6SalesCount === 0
    && validation.iceMismatchCount === 0
    && validation.inventoryMetricErrorCount === 0;
  return {
    ...inventory,
    candidateSkuCount: allProducts.length,
    includedSkuCount: placementBySku.size,
    excludedForStoreCount: excluded.length + stage.pendingSkus.length,
    totalDisplayColumns: stage.placements.reduce((sum, row) => sum + row.displayCols, 0),
    totalSalesWidth: round(segments.reduce((sum, segment) => sum + segment.length, 0)),
    usedWidth: round(segments.reduce((sum, segment) => sum + segment.usedWidth, 0)),
    remainingWidth: round(segments.reduce((sum, segment) => sum + Math.max(0, segment.remainingWidth), 0)),
    largeRemainingSegmentCount: segments.filter(segment => segment.remainingWidth > 300 + EPSILON).length,
    sameTypeSplitCount,
    category4SingleCabinetCount: [...categoryCabinets.values()].filter(cabinets => cabinets.size === 1).length,
    category4TwoCabinetCount: [...categoryCabinets.values()].filter(cabinets => cabinets.size <= 2).length,
    category4ThreePlusCount: [...categoryCabinets.values()].filter(cabinets => cabinets.size >= 3).length,
    validation
  };
}

function solveWithExclusions(phase2, excludedSkuKeys) {
  let stage = buildCoverage(phase2, excludedSkuKeys);
  stage = prepareLargeSegments(stage);
  stage = optimizeColumns(stage);
  stage = improveBySwaps(stage);
  stage = prepareLargeSegments(stage);
  stage = optimizeColumns(stage);
  return improveBySwaps(stage);
}

export function runCurrentTablePolicy(input) {
  const phase0 = loadAndValidatePhase0(input);
  if (!phase0.ok) return { ok: false, policy: "CURRENT_TABLE_POLICY", errors: phase0.errors, phase0 };
  const phase1 = calculatePhysicalCandidates(phase0);
  const phase2 = buildSkuPriority(phase1);
  const excludedSkuKeys = new Set();
  const excludedForStore = [];
  const exclusionTrace = [];
  let stage = solveWithExclusions(phase2, excludedSkuKeys);
  const order = exclusionOrder(stage);
  let cursor = 0;
  while (inventorySummary(stage).suggestedExternalL > phase2.params.externalCapL && cursor < order.length) {
    exclusionTrace.push({
      beforeExcludedSkuCount: excludedSkuKeys.size,
      ...inventorySummary(stage)
    });
    const product = order[cursor];
    cursor += 1;
    excludedSkuKeys.add(product.skuKey);
    excludedForStore.push({
      skuKey: product.skuKey,
      name: product.name,
      category3: product.category3,
      category4: product.category4,
      grade: product.grade,
      rank: product.rank,
      dailyQty: product.dailyQty,
      reasonCode: STORE_EXCLUSION_REASON.code,
      reason: STORE_EXCLUSION_REASON.text
    });
    stage = solveWithExclusions(phase2, excludedSkuKeys);
  }
  const summary = summarizePolicy(stage, phase2.rankedSkus, excludedForStore);
  const pendingAsExcluded = stage.pendingSkus.map(item => ({ ...item }));
  const allExcluded = [...excludedForStore, ...pendingAsExcluded];
  const status = summary.validation.ok ? "passed" : "failed";
  return {
    ok: summary.validation.ok,
    policy: "CURRENT_TABLE_POLICY",
    store: phase2.store,
    status,
    phase0,
    phase1,
    phase2,
    placements: stage.placements,
    segmentStates: stage.segmentStates,
    excludedForStore: allExcluded,
    actions: stage.actions,
    optimizationEvidence: {
      exclusionTrace
    },
    summary,
    validation: summary.validation,
    message: summary.validation.ok ? "当前版逻辑回归通过" : "当前版逻辑尚未复现"
  };
}
