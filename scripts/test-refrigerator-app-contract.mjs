import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const index = fs.readFileSync(new URL('index.html', root), 'utf8');
const app = fs.readFileSync(new URL('app.js', root), 'utf8');

assert.match(index, /data-view="refrigerator"/, '页面必须提供冰箱管理入口');
assert.match(index, /id="refrigeratorTable"/, '页面必须提供冰箱尺寸编辑容器');
assert.match(index, /id="refrigeratorStoreFilter"/, '冰箱模块必须支持门店筛选');
assert.match(index, /id="refrigeratorSearch"/, '冰箱模块必须支持冰箱搜索');
assert.match(app, /data-fridge-dimension/, '冰箱模块必须提供分区/层尺寸编辑字段');
assert.match(app, /data-fridge-new-dimension/, '冰箱模块必须提供新增分区尺寸编辑字段');
assert.match(app, /添加冰箱分区/, '冰箱模块必须提供新增分区入口');
assert.match(app, /createRefrigeratorSection/, '冰箱模块必须调用新增分区创建逻辑');
assert.match(app, /function 渲染冰箱模块\(\)/, '程序必须渲染冰箱模块');
assert.match(app, /应用冰箱尺寸/, '程序必须提供尺寸保存入口');
assert.match(app, /cabinetUpdates/, '本地状态补丁必须持久化已有柜体尺寸修改');

console.log('refrigerator app contract checks passed');

