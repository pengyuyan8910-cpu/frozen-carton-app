import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.equal(index.includes('id="opsMode"'), false, '统一模式不应再有运营模式开关');
assert.equal(index.includes('id="syncStoreViewBtn"'), false, '统一模式不应再有同步退出按钮');
for (const label of ['门店执行', '柜段余量', '空位建议']) {
  assert.equal(index.includes(`>${label}<`), false, `不应再显示${label}入口`);
}
assert.equal(index.includes('id="productpool"'), false, '产品池重排页面应移除');
assert.equal(index.includes('product-pool-replan'), false, '页面不应再加载产品池重排UI');
assert.equal(index.includes('运营模式下'), false, '陈列图说明不应再依赖运营模式');
assert.equal(index.includes('追加到当前页面'), true, '新增门店应提供追加到当前页面入口');
assert.equal(bootstrap.includes('product-pool-replan-ui'), false, '启动器不应动态加载产品池重排UI');
assert.equal(app.includes('当前是否运营'), false, '运行逻辑不应再按运营模式分流');
assert.equal(app.includes('校验运营密码'), false, '统一模式不应再校验运营密码');
assert.equal(app.includes('旧云端数据不得覆盖当前页面'), true, '云端流程应包含基线保护说明');
const pullStart = app.indexOf('async function pullCloudData()');
const pullConfirm = app.indexOf('window.confirm(', pullStart);
const pullApply = app.indexOf('状态 = cloudState;', pullStart);
assert.ok(pullStart >= 0 && pullConfirm > pullStart && pullConfirm < pullApply, '云端拉取必须先确认，再写入当前页面');
assert.equal(app.includes("if (!cloudBaseline?.initialized)"), true, '云端保存前必须先完成当前页面基线初始化');

console.log('simplification contract passed');

