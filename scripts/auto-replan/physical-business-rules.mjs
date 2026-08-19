export const PHYSICAL_BUSINESS_RULES = Object.freeze({
  source: "user-confirmed-business-rule",
  orientationRule: "卧柜/冰淇淋柜按长宽水平旋转并堆叠；立柜商品高做纵深、不堆叠",
  capacityRoundingRule: "产品长宽高已预留余量，柜体尺寸除以产品尺寸按四舍五入取整",
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
  return Math.round(Number(cabinetHeight) / Number(orientedHeight));
}
