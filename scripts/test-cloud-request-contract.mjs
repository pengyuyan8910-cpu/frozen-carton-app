import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(source, /const CLOUD_READ_TIMEOUT_MS = 30000;/, "云端读取请求应给冷启动留出30秒");
assert.match(source, /const CLOUD_WRITE_TIMEOUT_MS = 120000;/, "云端写入请求应给大文档留出更长时间");
assert.match(source, /async getUser\(\)/, "云端协作必须提供远程用户校验");
assert.match(source, /cloudClient\.auth\.getUser\(\)/, "显示已登录前必须实际校验云端会话");
assert.match(source, /CLOUD_REQUEST_RETRIES/, "云端请求必须有有限重试配置");
assert.match(source, /isReadRequest/, "自动重试只能用于读取请求，避免写请求重复提交");
assert.match(source, /if \(!verified\) return cloudNote\('登录凭证已保存/, "登录校验失败时不能继续提示登录成功");

console.log("cloud request contract passed");

