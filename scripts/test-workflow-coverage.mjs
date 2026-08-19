import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
const updateData = read('update-data.yml');
const newStore = read('generate-new-store-draft.yml');
const replan = read('replan-ci.yml');

assert.match(updateData, /scripts\/source-to-app-data-preserve-face\.mjs/, '正式底表刷新依赖 preserve-face 导入器，workflow 必须在该文件变化时触发');
assert.match(updateData, /\.github\/workflows\/update-data\.yml/, '正式底表刷新 workflow 自身变化必须触发一次验证');
assert.match(updateData, /if \[ -d "data\/baseline" \]; then[\s\S]*git add -A data\/baseline/, '可选 baseline 目录必须条件提交，不能再次触发 pathspec 失败');

assert.match(newStore, /scripts\/strict-allocation-engine\.mjs/, '新增门店草稿依赖严格引擎，workflow 必须在严格引擎变化时触发');
assert.match(newStore, /scripts\/source-to-app-data-preserve-face\.mjs/, '新增门店草稿依赖 preserve-face 导入器，workflow 必须在该文件变化时触发');
assert.match(newStore, /scripts\/generate-new-store-draft\.mjs/, '新增门店草稿脚本变化必须触发 workflow');

assert.match(replan, /npm run test:new-store-routing/, '主回归 CI 必须执行新增门店统一严格引擎回归测试');
assert.match(replan, /npm run test:replan/, '主回归 CI 必须执行产品池重排回归测试');
assert.match(replan, /npm run test:workflow/, '主回归 CI 必须执行 workflow 依赖覆盖测试');

for (const [name, source] of [['update-data.yml', updateData], ['generate-new-store-draft.yml', newStore], ['replan-ci.yml', replan]]) {
  assert.match(source, /actions\/checkout@v5/, `${name} 应使用 Node 24 运行时兼容的 checkout@v5`);
  assert.match(source, /actions\/setup-node@v5/, `${name} 应使用 Node 24 运行时兼容的 setup-node@v5`);
}

console.log('workflow coverage guard passed');
