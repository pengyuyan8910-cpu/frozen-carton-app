function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sectionOrder(section) {
  const match = text(section?.position).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function refrigeratorId(cabinet) {
  return `${text(cabinet?.store)}::${text(cabinet?.label)}`;
}

export function groupRefrigerators(cabinets = [], store = '') {
  const groups = new Map();
  for (const cabinet of Array.isArray(cabinets) ? cabinets : []) {
    if (store && text(cabinet?.store) !== text(store)) continue;
    const id = refrigeratorId(cabinet);
    if (!id || id === '::') continue;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        store: text(cabinet.store),
        label: text(cabinet.label),
        kind: text(cabinet.kind) || text(cabinet.type),
        type: text(cabinet.type) || text(cabinet.kind),
        rawNo: text(cabinet.rawNo),
        sections: [],
      });
    }
    groups.get(id).sections.push({
      key: text(cabinet.key),
      position: text(cabinet.position),
      length: number(cabinet.length),
      depth: number(cabinet.depth),
      height: number(cabinet.height),
    });
  }
  return [...groups.values()]
    .map(group => ({ ...group, sections: group.sections.sort((a, b) => sectionOrder(a) - sectionOrder(b)) }))
    .sort((a, b) => text(a.store).localeCompare(text(b.store), 'zh-CN', { numeric: true })
      || text(a.label).localeCompare(text(b.label), 'zh-CN', { numeric: true }));
}

export function validateDimensionUpdates(updates = []) {
  const errors = [];
  for (const update of Array.isArray(updates) ? updates : []) {
    const key = text(update?.key);
    if (!key) {
      errors.push('缺少柜段标识');
      continue;
    }
    if (!(number(update.length) > 0 && number(update.depth) > 0 && number(update.height) > 0)) {
      errors.push(`${key}：长、宽/深、高必须大于0`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function applyDimensionUpdates(cabinets = [], updates = []) {
  const changes = new Map((Array.isArray(updates) ? updates : []).map(update => [text(update?.key), update]));
  return (Array.isArray(cabinets) ? cabinets : []).map(cabinet => {
    const update = changes.get(text(cabinet?.key));
    if (!update) return { ...cabinet };
    return {
      ...cabinet,
      length: number(update.length),
      depth: number(update.depth),
      height: number(update.height),
    };
  });
}

export function validateNewSection(draft = {}) {
  const position = text(draft?.position);
  if (!position || !(number(draft?.length) > 0 && number(draft?.depth) > 0 && number(draft?.height) > 0)) {
    return { ok: false, errors: [`${position || '新增分区'}：分区名称、长、宽/深、高必须大于0`] };
  }
  return { ok: true, errors: [] };
}

export function createRefrigeratorSection(group = {}, draft = {}, existingCabinets = [], template = {}) {
  const valid = validateNewSection(draft);
  if (!valid.ok) return valid;
  const store = text(group?.store);
  const label = text(group?.label);
  const position = text(draft.position);
  const baseKey = `${store}__${label}__${position}`;
  const usedKeys = new Set((Array.isArray(existingCabinets) ? existingCabinets : []).map(cabinet => text(cabinet?.key)));
  let key = baseKey;
  let suffix = 2;
  while (usedKeys.has(key)) key = `${baseKey}__${suffix++}`;
  const base = template && typeof template === 'object' ? template : {};
  const length = number(draft.length);
  const depth = number(draft.depth);
  const height = number(draft.height);
  const cabinet = {
    ...base,
    id: `new_cab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    store,
    key,
    label,
    position,
    rawPosition: text(draft.rawPosition) || position,
    rawNo: text(group?.rawNo) || text(base.rawNo),
    kind: text(group?.kind) || text(base.kind),
    type: text(group?.type) || text(base.type),
    length,
    depth,
    height,
    sourceUsed: 0,
    sourceLeft: length,
    used: 0,
    over: false,
    left: length,
    leftWidth: length,
    usedWidth: 0,
    items: [],
    itemSummary: [],
  };
  return { ok: true, cabinet };
}

export default {
  refrigeratorId,
  groupRefrigerators,
  validateDimensionUpdates,
  applyDimensionUpdates,
  validateNewSection,
  createRefrigeratorSection,
};

