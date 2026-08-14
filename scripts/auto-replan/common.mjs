export const EPSILON = 0.0001;
export const INVALID_PHYSICAL_SOURCES = new Set(["default", "fallback", "inferred"]);

export function asText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(asNumber(value) * factor) / factor;
}

export function stableCompare(left, right) {
  return asText(left).localeCompare(asText(right), "zh-CN", { numeric: true });
}

export function stableSkuKey(product) {
  return asText(product?.barcode) || asText(product?.skuKey) || asText(product?.id) || asText(product?.name);
}

export function gradeScore(value) {
  return ({ A: 4, B: 3, C: 2, D: 1 }[asText(value).toUpperCase()] ?? 0);
}

export function explicitTrue(value) {
  return value === true || value === 1 || ["true", "是", "允许"].includes(asText(value).toLowerCase());
}

export function isIceProduct(product) {
  if (typeof product?.ice === "boolean") return product.ice;
  return /冰淇淋|冰激凌|雪糕/.test([
    product?.category2,
    product?.category3,
    product?.category4,
    product?.name
  ].map(asText).join("|"));
}

export function cabinetClass(cabinet) {
  const source = [cabinet?.kind, cabinet?.type, cabinet?.label].map(asText).join("|");
  if (/冰淇淋|冰激凌|冰品柜/.test(source)) return "ice";
  if (/立柜/.test(source)) return "vertical";
  if (/卧柜|冰箱/.test(source)) return "chest";
  return "other";
}

export function isLayer6(cabinet) {
  return cabinetClass(cabinet) === "vertical" && /第\s*6\s*层/.test(asText(cabinet?.position));
}

export function cabinetIdentity(store, label, position) {
  return `${asText(store)}__${asText(label)}__${asText(position)}`;
}

export function isExplicitlyRetired(product) {
  if (product?.active === false) return true;
  const state = [product?.status, product?.lifecycleStatus, product?.lifecycleState]
    .map(asText)
    .join("|");
  return /淘汰完成|已淘汰|retired/i.test(state);
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
