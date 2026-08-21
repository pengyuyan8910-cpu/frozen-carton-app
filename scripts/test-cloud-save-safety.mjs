import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const pushStart = source.indexOf("async function pushCloudData()");
const pushEnd = source.indexOf("/* --- 冲突自动合并 --- */", pushStart);
assert.ok(pushStart >= 0 && pushEnd > pushStart, "必须存在可检查的云端保存流程");
const pushSource = source.slice(pushStart, pushEnd);

assert.match(source, /const CLOUD_READ_TIMEOUT_MS = 30000;/, "读取请求应保留30秒超时");
assert.match(source, /const CLOUD_WRITE_TIMEOUT_MS = 120000;/, "大文档写入应使用更长的超时");
assert.match(source, /timeoutMs\s*=\s*options\.timeoutMs\s*\?\?\s*\(isReadRequest\s*\?\s*CLOUD_READ_TIMEOUT_MS\s*:\s*CLOUD_WRITE_TIMEOUT_MS\)/, "请求超时必须按读写类型区分");
assert.match(source, /function cloudProtectCurrentPage\(/, "云端保存前必须创建本地保护快照");
assert.match(source, /localStorage\.setItem\(CLOUD_ROLLBACK_KEY/, "本地保护快照必须写入回退存储");
assert.match(source, /async function readCloudDocumentMeta\(/, "保存前只读取云端版本元数据，不能先下载整份云端文档");
assert.match(pushSource, /readCloudDocumentMeta\(\)/, "首次保存必须读取云端版本元数据");
assert.match(pushSource, /覆盖云端.*不会拉取或改动当前页面/, "覆盖云端前必须明确提示不会改动当前页面");
assert.ok(pushSource.indexOf("cloudProtectCurrentPage()") < pushSource.indexOf("requireCloudSession()"), "云端登录前必须先保护当前页面数据");
assert.match(source, /当前页面数据已安全保存到本机/, "云端失败提示必须明确本地数据仍被保留");
assert.doesNotMatch(source, /decision\.action === 'first-pull'\s*\|\|\s*window\.confirm/, "首次拉取也必须确认，不能直接覆盖当前页面");

console.log("cloud save safety regression test passed");

