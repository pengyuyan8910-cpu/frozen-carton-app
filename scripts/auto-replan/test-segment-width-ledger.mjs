import fs from "node:fs";
import { runPhase0To4 } from "./index.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../../data/app-data.json", import.meta.url), "utf8"));
const confirmed = JSON.parse(fs.readFileSync(new URL("../../data/user-confirmed-physical-dimensions.json", import.meta.url), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runStore(store) {
  const result = runPhase0To4({
    store,
    productPool: data.productPool,
    cabinets: data.cabinets,
    params: data.params,
    physicalRecords: confirmed.records
  }, { maxRuntimeMs: 120000 });
  assert(result.ok, `${store}柜段级物理宽度账测试未通过`);
  const phase4 = result.phase4;
  const validation = phase4.stageValidation;
  assert(validation.overWidthCount === 0, `${store}存在柜段超宽`);
  assert(validation.widthLedgerMismatchCount === 0, `${store}存在柜段宽度账不一致`);
  assert(validation.placementSyncErrorCount === 0, `${store}存在陈列列数与柜段占宽不同步`);
  const segments = validation.widthLedger.segments.map(segment => {
    const state = phase4.cabinetStates.get(segment.segmentKey);
    return {
      柜型: segment.cabinetType,
      柜号: segment.cabinetNo,
      位置: segment.position,
      柜段标识: segment.segmentKey,
      允许宽度mm: segment.length,
      实际使用宽度mm: segment.usedWidth,
      剩余宽度mm: segment.remainingWidth,
      商品数: segment.skuCount,
      商品陈列: state.placements.map(placement => ({
        商品: placement.name,
        faceWidth_mm: placement.faceWidth,
        displayCols: placement.displayCols,
        占用宽度mm: placement.usedWidth
      })),
      商品占宽合计mm: segment.calculatedUsedWidth,
      宽度账闭合: Math.abs(segment.calculatedUsedWidth - segment.usedWidth) < 0.0001
        && Math.abs(segment.usedWidth + segment.remainingWidth - segment.length) < 0.0001
    };
  });
  return {
    门店: store,
    销售柜段数: segments.length,
    柜段超宽数量: validation.overWidthCount,
    宽度账不一致数量: validation.widthLedgerMismatchCount,
    陈列列数与占宽不同步数量: validation.placementSyncErrorCount,
    柜段明细: segments
  };
}

const startedAt = Date.now();
const ningguo = runStore("宁国津河西路生活馆");
console.log(JSON.stringify({
  测试顺序: "第一步",
  结果: "宁国津河柜段级宽度账通过",
  ...ningguo
}, null, 2));

const hanxian = runStore("和县生活馆");
console.log(JSON.stringify({
  测试顺序: "第二步",
  结果: "和县柜段级宽度账通过",
  ...hanxian,
  总耗时ms: Date.now() - startedAt,
  是否运行其他门店: "否",
  是否写入正式数据: "否"
}, null, 2));
