import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.doesNotMatch(html, /id="cloudInitializeBtn"/, "页面不应再要求协作者点击初始化第1版");
assert.doesNotMatch(app, /on\('cloudInitializeBtn'/, "云端事件不应再绑定初始化按钮");
assert.doesNotMatch(app, /async function initializeCloudFromCurrent/, "初始化应由首次保存处理，不保留单独入口");
assert.match(app, /async function readCloudDocument\(/, "拉取和保存必须共用云端文档读取");
assert.match(app, /if \(!cloudBaseline\?\.initialized\)[\s\S]*readCloudDocument/, "无本地基线保存前必须先核对云端是否已有文档");

console.log("cloud collaboration flow contract passed");
