import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(app, /function 保存视图滚动位置\(/, '必须提供按视图保存滚动位置的函数');
assert.match(app, /function 恢复视图滚动位置\(/, '必须提供按视图恢复滚动位置的函数');
assert.match(app, /let 待恢复视图滚动位置=null/, '必须区分切换页面时待恢复的目标位置');
assert.match(app, /function 切换\(id\)\{[\s\S]*?保存视图滚动位置\(当前\.页面\)[\s\S]*?当前\.页面=id/, '切换视图前必须先保存当前页面位置');
assert.match(app, /function 渲染全部\(\)\{[\s\S]*?const restorePage=待恢复视图滚动位置\|\|当前\.页面[\s\S]*?恢复视图滚动位置\(restorePage\)/, '重建视图后必须恢复目标页面位置');
assert.match(app, /window\.scrollTo\(/, '恢复页面位置必须实际调用窗口滚动定位');
assert.match(bootstrap, /const APP_VERSION\s*=\s*"20260902_product_dimensions_v1"/, '页面脚本更新必须使用新的 app.js 缓存版本');
assert.match(index, /bootstrap\.js\?v=20260902_product_dimensions_v1/, '页面脚本更新必须使用新的 bootstrap.js 缓存版本');

console.log('view scroll preservation contract passed');
