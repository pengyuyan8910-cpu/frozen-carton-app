import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(source, /CLOUD_SDK_SOURCES\s*=\s*\[/, "云端 SDK 必须有可切换的加载地址");
assert.match(source, /https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2['"]/, "云端 SDK 必须使用官方 CDN 包根地址");
assert.match(source, /https:\/\/unpkg\.com\/@supabase\/supabase-js@2['"]/, "云端 SDK 必须包含备用 CDN 包根地址");
assert.match(source, /setTimeout\(/, "云端 SDK 加载必须有超时");
assert.match(source, /cloudNote\(['"]['"]\)/, "打开云端协作时必须清除旧的同步错误");
assert.match(source, /Failed to fetch.*无法连接云端服务/s, "Failed to fetch 必须转换成明确的中文提示");

console.log("cloud sync loading regression test passed");
