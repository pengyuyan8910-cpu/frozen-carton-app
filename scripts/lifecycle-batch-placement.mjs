const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));
const text = value => String(value ?? '').trim();
const number = value => {
  const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const positiveInteger = (value, fallback = 1) => Math.max(1, Math.floor(number(value) || fallback));

function identityValues(item) {
  return [item?.productKey, item?.productName, item?.barcode, item?.name]
    .map(text).filter(Boolean);
}

function sameProduct(a, b) {
  const right = new Set(identityValues(b));
  return identityValues(a).some(value => right.has(value));
}

function isIceProduct(product) {
  if (typeof product?.ice === 'boolean') return product.ice;
  if (typeof product?.isIce === 'boolean') return product.isIce;
  return /雪糕|冰品|冰淇淋|甜筒|冰棒|冰杯/.test([product?.name, product?.category3, product?.category4].join(' '));
}

function isIceCabinet(cabinet) {
  if (typeof cabinet?.iceOnly === 'boolean') return cabinet.iceOnly;
  if (typeof cabinet?.isIceCabinet === 'boolean') return cabinet.isIceCabinet;
  return /雪糕|冰品|冰淇淋/.test([cabinet?.kind, cabinet?.label].join(' '));
}

function saleEligible(cabinet) {
  const position = text(cabinet?.position);
  const status = text(cabinet?.status);
  return Boolean(cabinet) && number(cabinet.length) > 0 &&
    !/第6层|存储位/.test(position) && !/其他品类预留|预留|存储/.test(status);
}

function orientations(product, cabinet) {
  const length = number(product?.length);
  const width = number(product?.width);
  const height = number(product?.height);
  const vertical = /立柜/.test(`${cabinet?.kind || ''}${cabinet?.label || ''}`);
  const raw = vertical
    ? [
      { face: length, depth: height, stack: width, label: '长做陈列面' },
      { face: width, depth: height, stack: length, label: '宽做陈列面' },
    ]
    : [
      { face: length, depth: width, stack: height, label: '长做陈列面' },
      { face: width, depth: length, stack: height, label: '宽做陈列面' },
    ];
  return raw.filter(option => option.face > 0 && option.depth > 0 && option.stack > 0)
    .filter(option => !cabinet.depth || option.depth <= number(cabinet.depth) + 0.1)
    .filter(option => !cabinet.height || option.stack <= number(cabinet.height) + 0.1)
    .map(option => ({
      ...option,
      per: Math.floor(number(cabinet.depth || option.depth) / option.depth) *
        (vertical ? 1 : Math.floor(number(cabinet.height || option.stack) / option.stack)),
    }))
    .filter(option => option.per > 0)
    .sort((a, b) => b.per - a.per || a.face - b.face || a.depth - b.depth);
}

function rowWidth(row) {
  const cols = number(row?.displayCols);
  const face = number(row?.faceWidth);
  if (cols > 0 && face > 0) return cols * face;
  return Math.max(0, number(row?.needWidth));
}

function resolveProduct(row, source) {
  const products = [...(source?.productPool || []), ...(source?.products || []), ...(source?.draftProducts || [])];
  return products.find(product => sameProduct(product, row)) || row || {};
}

function initialUsage(source, cabinets) {
  const hasUsageSnapshot = source?.usageByCabinet && typeof source.usageByCabinet === 'object';
  const hasSkuRows = Array.isArray(source?.skus) && source.skus.length > 0;
  const usage = new Map(cabinets.map(cabinet => [
    text(cabinet.key),
    hasUsageSnapshot || hasSkuRows ? 0 : Math.max(0, number(cabinet.used)),
  ]));
  if (hasUsageSnapshot) {
    for (const [key, used] of Object.entries(source.usageByCabinet)) {
      if (usage.has(text(key))) usage.set(text(key), Math.max(0, number(used)));
    }
  }
  const rows = Array.isArray(source?.skus) ? source.skus : [];
  if (!hasUsageSnapshot && hasSkuRows) rows.forEach(row => {
    if (row?.included === false) return;
    const key = text(row?.cabinetKey);
    if (!usage.has(key)) return;
    usage.set(key, usage.get(key) + rowWidth(row));
  });
  (source?.pendingRows || []).forEach(row => {
    if (row?.status === '位置冲突已撤销' || row?.taskId === source?.taskId) return;
    const key = text(row?.cabinetKey);
    if (!usage.has(key)) return;
    usage.set(key, usage.get(key) + rowWidth(row));
  });
  return usage;
}

function requestedPlacement(row, product, cabinet, left, allowTemporary = false) {
  const options = orientations(product, cabinet);
  const preferred = text(row?.orientation || row?.faceOrientation || row?.displayOrientation);
  options.sort((a, b) => (preferred && a.label === preferred ? -1 : 0) - (preferred && b.label === preferred ? -1 : 0) || b.per - a.per || a.face - b.face);
  const requestedCols = positiveInteger(row?.displayCols, 1);
  const requestedWidth = Math.max(0, number(row?.needWidth) || requestedCols * number(row?.faceWidth));

  for (const option of options) {
    const requestedFaceMatches = !number(row?.faceWidth) || Math.abs(number(row.faceWidth) - option.face) < 0.1;
    const requestedNeed = option.face * requestedCols;
    if (requestedWidth > 0 && requestedFaceMatches && requestedNeed <= left + 0.5) {
      return { ...option, displayCols: requestedCols, needWidth: option.face * requestedCols };
    }
  }
  // A batch launch only needs a temporary legal module. If the requested
  // multi-column facing cannot fit, reserve one column and let the user adjust
  // it later; never displace or compress an existing product automatically.
  for (const option of options) {
    if (option.face <= left + 0.5) return { ...option, displayCols: 1, needWidth: option.face };
  }
  if (allowTemporary && options.length) {
    const option = options[0];
    return {
      ...option,
      displayCols: 1,
      needWidth: option.face,
      temporary: true,
      overflowWidth: Math.max(0, option.face - left),
    };
  }
  return null;
}

function candidateCabinets(row, product, cabinets, usage) {
  const store = text(row?.store);
  const targetKey = text(row?.cabinetKey);
  return cabinets
    .filter(cabinet => text(cabinet.store) === store && saleEligible(cabinet) && isIceCabinet(cabinet) === isIceProduct(product))
    .map((cabinet, index) => ({ cabinet, index, left: number(cabinet.length) - number(usage.get(text(cabinet.key))), preferred: text(cabinet.key) === targetKey }))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.left - a.left || a.index - b.index);
}

function assignRow(row, product, cabinets, usage) {
  const candidates = candidateCabinets(row, product, cabinets, usage);
  for (const candidate of candidates) {
    const placement = requestedPlacement(row, product, candidate.cabinet, candidate.left);
    if (!placement) continue;
    return applyPlacement(row, candidate, placement, usage);
  }
  // 新品上新不能因某个柜段或整店当前排面不足而被拒绝；没有完整单列空位时，
  // 先在同店合法柜段预留一个临时单列，后续由用户手动调整既有排面。
  for (const candidate of [...candidates].sort((a, b) => b.left - a.left || Number(b.preferred) - Number(a.preferred) || a.index - b.index)) {
    const placement = requestedPlacement(row, product, candidate.cabinet, candidate.left, true);
    if (!placement?.temporary) continue;
    return applyPlacement(row, candidate, placement, usage);
  }
  return null;
}

function applyPlacement(row, candidate, placement, usage) {
    const cabinet = candidate.cabinet;
    const used = number(usage.get(text(cabinet.key))) + placement.needWidth;
    usage.set(text(cabinet.key), used);
    const moved = text(row.cabinetKey) && text(row.cabinetKey) !== text(cabinet.key);
    const temporary = Boolean(placement.temporary);
    return {
      ...row,
      cabinetKey: cabinet.key,
      cabinetLabel: cabinet.label,
      position: cabinet.position,
      displayCols: placement.displayCols,
      perCol: placement.per,
      faceWidth: placement.face,
      needWidth: placement.needWidth,
      orientation: placement.label,
      method: 'natural',
      scheme: temporary ? '自动寻找同店柜段（待手动调整）' : (moved ? '自动寻找同店空位' : (row.scheme || '利用柜段自然余量')),
      status: temporary ? '需手动调整后上新' : '可直接上新',
      adjustment: temporary ? '需手动调整现有排面' : '无需移动已有商品',
      placementStatus: temporary ? '待手动调整' : '已校验',
      overflowWidth: temporary ? placement.overflowWidth : 0,
      reason: moved
        ? `原指定柜段空位不足，已自动放入同店${cabinet.label || '可用柜段'} ${cabinet.position || ''}，后续可手动调整陈列`
        : temporary
          ? `本店暂无完整单列空位，已先预留${cabinet.label || '可用柜段'} ${cabinet.position || ''} 的临时单列，需手动调整现有排面释放${placement.overflowWidth}mm`
        : (row.reason || `柜段当前剩余${candidate.left}mm，已预留${placement.needWidth}mm临时陈列位`),
    };
}

export function placeBatchLaunchRows(task, source = {}) {
  const nextTask = clone(task || {});
  const cabinets = (source.cabinets || []).map(cabinet => ({ ...cabinet }));
  const usage = initialUsage(source, cabinets);
  const errors = [];
  nextTask.rows = (nextTask.rows || []).map(row => {
    if (row?.status === '位置冲突已撤销') return row;
    const product = resolveProduct(row, source);
    const assigned = assignRow(row, product, cabinets, usage);
    if (assigned) return assigned;
    errors.push({
      store: row?.store,
      cabinet: row?.cabinetLabel || row?.cabinetKey,
      need: Math.max(0, number(row?.needWidth) || number(row?.faceWidth)),
      left: 0,
      reason: '该门店没有满足冰品类型、销售层和横向空位约束的可用柜段',
    });
    return row;
  });
  return { ok: errors.length === 0, task: nextTask, errors };
}

export function findBatchLaunchPlacement(product, row, cabinets, usedByCabinet = new Map()) {
  const usage = usedByCabinet && typeof usedByCabinet.get === 'function'
    ? new Map(usedByCabinet)
    : new Map(Object.entries(usedByCabinet || {}));
  const assigned = assignRow({ ...(row || {}), store: row?.store || product?.store }, product || {}, cabinets || [], usage);
  return assigned ? { ok: true, row: assigned, usedByCabinet: usage } : { ok: false, row: row || null, usedByCabinet: usage };
}

const api = { placeBatchLaunchRows, findBatchLaunchPlacement };
if (typeof window !== 'undefined') window.LifecycleBatchPlacement = api;
