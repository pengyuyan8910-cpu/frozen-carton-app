import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceToAppData } from "./source-to-app-data.mjs";
import { verifyAppData } from "./verify-app-data.mjs";
import { writeAppDataWorkbook } from "./app-data-to-workbook.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "data", "source");
const inboxDir = path.join(root, "data", "inbox");
const sourceXlsx = path.join(sourceDir, "整箱到店数据测算_当前版.xlsx");
const inboxJson = path.join(inboxDir, "整箱到店数据测算_程序回传.json");
const appDataPath = path.join(root, "data", "app-data.json");
const reportPath = path.join(root, "data", "verify-report.json");
const versionPath = path.join(root, "data", "version.json");

async function readLegacyData() {
  try { return JSON.parse(fs.readFileSync(appDataPath, "utf8").replace(/^\uFEFF/, "")); } catch (_) { return {}; }
}
function addSourceErrors(report, data) {
  const errors = Array.isArray(data.meta?.sourceErrors) ? data.meta.sourceErrors : [];
  if (errors.length) { report.errors.push(...errors); report.passed = false; }
  return report;
}
function writeFailureSummary(errors) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 底表复核未通过\n\n${errors.map(error => `- ${error}`).join("\n")}\n\n未覆盖当前已发布的小程序数据。\n`, "utf8");
}
async function main() {
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(inboxDir, { recursive: true });
  const fromProgram = fs.existsSync(inboxJson);
  if (!fromProgram && !fs.existsSync(sourceXlsx)) throw new Error("未找到标准底表。请上传 data/source/整箱到店数据测算_当前版.xlsx。");
  const oldData = await readLegacyData();
  const data = await sourceToAppData(fromProgram ? inboxJson : sourceXlsx, oldData);
  let report = addSourceErrors(verifyAppData(data), data);
  if (!report.passed) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    writeFailureSummary(report.errors);
    console.error("底表复核失败，已停止更新 app-data.json：\n" + report.errors.join("\n"));
    process.exit(1);
  }
  if (fromProgram) {
    const tempWorkbook = path.join(sourceDir, ".程序回传底表待复核.xlsx");
    await writeAppDataWorkbook(data, tempWorkbook);
    const roundTripData = await sourceToAppData(tempWorkbook, data);
    const roundTripReport = addSourceErrors(verifyAppData(roundTripData), roundTripData);
    if (!roundTripReport.passed) {
      fs.unlinkSync(tempWorkbook);
      fs.writeFileSync(reportPath, JSON.stringify(roundTripReport, null, 2), "utf8");
      writeFailureSummary(roundTripReport.errors);
      console.error("程序回传无法生成可继续使用的Excel底表：\n" + roundTripReport.errors.join("\n"));
      process.exit(1);
    }
    fs.copyFileSync(tempWorkbook, sourceXlsx);
    fs.unlinkSync(tempWorkbook);
    fs.unlinkSync(inboxJson);
    data.meta.source = "整箱到店数据测算_当前版.xlsx（由小程序回传更新）";
  }
  const version = {
    sourceName: path.basename(sourceXlsx), sourcePath: "data/source/整箱到店数据测算_当前版.xlsx",
    sourceMode: fromProgram ? "小程序回传并自动回写Excel" : "手工Excel底表上传",
    generatedAt: new Date().toISOString(), appVersion: data.meta?.version || "10%触发-当前版",
    verifyPassed: true, verifyErrorCount: 0, verifyWarningCount: report.warnings.length
  };
  fs.writeFileSync(appDataPath, JSON.stringify(data, null, 2), "utf8");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(versionPath, JSON.stringify(version, null, 2), "utf8");
  console.log(JSON.stringify({ mode: version.sourceMode, source: version.sourceName, ...report.metrics }, null, 2));
}
main().catch(error => { console.error(error?.stack || error); process.exit(1); });
