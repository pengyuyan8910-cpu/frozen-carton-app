export const PHYSICAL_BUSINESS_RULES = Object.freeze({
  source: "user-confirmed-business-rule",
  orientationRule: "商品允许水平旋转90°，长宽可互换，高度不翻转",
  allowedOrientations: Object.freeze(["length-face", "width-face"]),
  stackRules: Object.freeze({
    vertical: Object.freeze({ allowStack: false, description: "立柜销售层不允许上下堆叠" }),
    chest: Object.freeze({ allowStack: true, description: "卧柜允许上下堆叠" }),
    ice: Object.freeze({ allowStack: true, description: "冰淇淋柜允许上下堆叠" })
  })
});

export function allowedPhysicalOrientations() {
  return [...PHYSICAL_BUSINESS_RULES.allowedOrientations];
}
export function physicalStackRule(cabinetClass) {
  return PHYSICAL_BUSINESS_RULES.stackRules[cabinetClass] || Object.freeze({
    allowStack: false,
    description: "未识别柜型不启用堆叠"
  });
}

export function calculatePhysicalStackCount(cabinetClass, cabinetHeight, orientedHeight) {
  if (cabinetClass === "vertical") return 1;
  const rule = physicalStackRule(cabinetClass);
  if (!rule.allowStack) return 1;
  return Math.floor(Number(cabinetHeight) / Number(orientedHeight));
}
