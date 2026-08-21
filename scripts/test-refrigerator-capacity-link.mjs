import assert from 'node:assert/strict';
import { recalculateLoadedPlanogram } from './live-planogram-capacity.mjs';

function createState(depth) {
  const cabinet = {
    key: 'test-store__卧柜2505-柜1__分区1',
    store: 'test-store',
    label: '卧柜2505-柜1',
    position: '分区1',
    kind: '卧柜',
    type: '卧柜',
    length: 1988,
    depth,
    height: 460,
  };
  return {
    params: { triggerRate: 0.1 },
    cabinets: [cabinet],
    skus: [{
      id: 'sku-beef-roll',
      store: 'test-store',
      name: '澳洲谷饲肥牛卷450g',
      barcode: '6937506895813',
      length: 235,
      width: 176,
      height: 49,
      carton: 30,
      displayCols: 1,
      faceOrientation: 'width',
      faceWidth: 176,
      perCol: 0,
      rowFull: 0,
      included: true,
      cabinetKey: cabinet.key,
      cabinetLabel: cabinet.label,
      position: cabinet.position,
      placements: [{ cabinetKey: cabinet.key, displayCols: 1, orientation: 'width-face' }],
    }],
  };
}

const current = createState(697);
recalculateLoadedPlanogram(current);
assert.equal(current.skus[0].perCol, 18, '卧柜应按柜体宽度697÷235取2行，再按460÷49取9层，单列满陈18');
assert.equal(current.skus[0].rowFull, 18, '尺寸联动后的满陈必须使用物理容量');

const changed = createState(400);
recalculateLoadedPlanogram(changed);
assert.equal(changed.skus[0].perCol, 9, '修改冰箱柜体宽度后，满陈必须随纵深数量变化');
assert.equal(changed.skus[0].rowFull, 9, '修改冰箱尺寸后不得保留旧满陈');

console.log('refrigerator capacity link checks passed');
