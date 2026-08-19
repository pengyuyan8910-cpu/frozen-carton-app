import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(source, /function createCloudRestClient\(/, "云端协作必须有直接 REST 客户端");
assert.match(source, /function cloudRestRequest\(/, "云端协作必须有统一接口请求入口");
assert.match(source, /cloudClient\s*=\s*createCloudRestClient\(\)/, "云端客户端必须直接创建 REST 客户端");
assert.doesNotMatch(source, /loadCloudSdk\(|CLOUD_SDK_SOURCES/, "云端协作不得依赖会卡住的外部 SDK 加载");
assert.match(source, /cloudNote\(['"]['"]\)/, "打开云端协作时必须清除旧的同步错误");
assert.match(source, /Failed to fetch.*无法连接云端服务/s, "Failed to fetch 必须转换成明确的中文提示");

console.log("cloud sync loading regression test passed");
