export const STATUS_TEXT = Object.freeze({
  passed: "已通过",
  review_required: "需要人工复核",
  failed: "排柜校验失败",
  blocked: "暂时无法生成可靠排柜草稿"
});

export const IMPACT_REASON_TEXT = Object.freeze({
  PRODUCT_ADDED_RELEVANT: "新品符合本店经营条件，需要重新排柜",
  PRODUCT_REMOVED_FROM_STORE: "本店正在经营的商品已淘汰，需要调整陈列",
  PRODUCT_DIMENSION_CHANGED: "本店经营商品的尺寸发生变化，需要重新验证陈列",
  PRODUCT_CARTON_CHANGED: "本店经营商品的箱规发生变化，需要重新计算陈列",
  PRODUCT_PRIORITY_CHANGED: "商品经营优先级发生明显变化，需要重新评估本店陈列",
  CABINET_CHANGED: "门店柜体配置发生变化，需要重新排柜",
  MANUAL_STORE_REPLAN: "用户要求重新计算本门店排柜草稿",
  FULL_REPLAN_REQUESTED: "用户要求重新计算全部门店排柜草稿",
  NO_IMPACT: "本次产品池变化不影响当前门店陈列"
});

export const PENDING_REASON_TEXT = Object.freeze({
  NO_LEGAL_PHYSICAL_CANDIDATE: "当前没有符合物理规则的销售柜位，等待后续阶段处理",
  NO_REMAINING_WIDTH: "当前销售柜段剩余宽度不足，等待后续空间优化"
});

export const EXCLUSION_REASON_TEXT = Object.freeze({
  STORE_CAPACITY_PRIORITY: "门店柜体容量有限，按经营优先级暂不纳入本店",
  ICE_CABINET_CAPACITY: "冰淇淋柜容量有限，按经营优先级暂不纳入本店",
  PHYSICAL_FIT: "现有柜体尺寸无法合法陈列该商品",
  HIGHER_VALUE_REPLACEMENT: "为优先保留经营价值更高的商品，本店暂不纳入该商品",
  EXTERNAL_CAP_PRIORITY: "为满足门店外储容量要求，按经营优先级暂不纳入本店"
});

export function chineseText(code, maps = [STATUS_TEXT, IMPACT_REASON_TEXT, PENDING_REASON_TEXT, EXCLUSION_REASON_TEXT]) {
  for (const map of maps) if (map[code]) return map[code];
  return "需要查看详细复核信息";
}
