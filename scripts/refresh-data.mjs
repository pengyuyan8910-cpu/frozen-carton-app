import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { sourceToAppData } from "./source-to-app-data.mjs";
import { verifyAppData } from "./verify-app-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "data", "source");
const appDataPath = path.join(root, "data", "app-data.json");
const reportPath = path.join(root, "data", "verify-report.json");
const versionPath = path.join(root, "data", "version.json");

function sourceTime(file) {
  try {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", rel], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (out) return Number(out) * 1000;
  } catch (_) {}
  return fs.statSync(file).mtimeMs;
}

function latestSource() {
  const files = fs.existsSync(sourceDir)
    ? fs.readdirSync(sourceDir)
      .filter(f => /\.(xlsx|json)$/i.test(f) && !f.startsWith("~$"))
      .map(f => path.join(sourceDir, f))
      .sort((a, b) => sourceTime(b) - sourceTime(a))
    : [];
  if (!files.length) throw new Error(`没有找到底表来源文件：${sourceDir}`);
  return files[0];
}

async function readLegacyData() {
  if (fs.existsSync(appDataPath)) {
    try { return JSON.parse(fs.readFileSync(appDataPath, "utf8").replace(/^\uFEFF/, "")); } catch (_) {}
  }
  return {};
}

async function main() {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourcePath = latestSource();
  const oldData = await readLegacyData();
  const data = await sourceToAppData(sourcePath, oldData);
  const report = verifyAppData(data);
  const version = {
    sourceName: path.basename(sourcePath),
    sourcePath: path.relative(root, sourcePath).replace(/\\/g, "/"),
    generatedAt: new Date().toISOString(),
    appVersion: data.meta?.version || "10%触发-当前版",
    verifyPassed: report.passed,
    verifyErrorCount: report.errors.length,
    verifyWarningCount: report.warnings.length
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(versionPath, JSON.stringify(version, null, 2), "utf8");
  if (!report.passed) {
    console.error("底表复核失败，已停止更新 app-data.json：");
    console.error(report.errors.join("\n"));
    process.exit(1);
  }
  fs.writeFileSync(appDataPath, JSON.stringify(data, null, 2), "utf8");
  console.log("数据刷新完成：");
  console.log(JSON.stringify({ source: version.sourceName, ...report.metrics }, null, 2));
}

main().catch(err => {
  console.error(err?.stack || err);
  process.exit(1);
});



