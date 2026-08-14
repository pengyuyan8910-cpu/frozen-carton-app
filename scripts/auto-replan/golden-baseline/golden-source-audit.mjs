import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PHYSICAL_BUSINESS_RULES } from "../physical-business-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function classifyCabinet(cabinet) {
  const text = `${cabinet.kind || ""}|${cabinet.type || ""}|${cabinet.label || ""}`;
  if (text.includes("冰淇淋")) return "冰淇淋柜";
  if (text.includes("立柜")) return "立柜";
  if (text.includes("卧柜") || text.includes("冰箱")) return "卧柜";
  return "其他";
}

function presenceStats(rows, field) {
  return {
    trueCount: rows.filter(row => row[field] === true).length,
    falseCount: rows.filter(row => row[field] === false).length,
    missingCount: rows.filter(row => row[field] === undefined || row[field] === null).length
  };
}

export function runGoldenSourceAudit() {
  const data = readJson("data/app-data.json");
  const physical = readJson("data/user-confirmed-physical-dimensions.json");
  const baseline = readJson("scripts/auto-replan/golden-baseline/golden-baseline.json");
  const pool = Array.isArray(data.productPool) ? data.productPool : [];
  const cabinets = Array.isArray(data.cabinets) ? data.cabinets : [];
  const cabinetGroups = Object.fromEntries(["立柜", "卧柜", "冰淇淋柜"].map(type => {
    const rows = cabinets.filter(cabinet => classifyCabinet(cabinet) === type);
    return [type, {
      count: rows.length,
      allowStack: presenceStats(rows, "allowStack"),
      allowVerticalStack: presenceStats(rows, "allowVerticalStack")
    }];
  }));
  const orientationConfigured = pool.filter(product => Array.isArray(product.allowedOrientations)
    && product.allowedOrientations.length > 0).length;
  const sampledProducts = baseline.skuSamples.map(sample => pool.find(product => String(product.barcode) === sample.skuKey));
  const physicalRecords = Array.isArray(physical.records) ? physical.records : [];
  const physicalDuplicates = [];
  const physicalIndex = new Map();
  for (const record of physicalRecords) {
    const key = `${record.store}__${record.label}__${record.position}`;
    physicalIndex.set(key, [...(physicalIndex.get(key) || []), record]);
  }
  for (const [key, rows] of physicalIndex) if (rows.length !== 1) physicalDuplicates.push({ key, count: rows.length });
  return {
    productPoolCount: pool.length,
    cabinetCount: cabinets.length,
    productFieldNames: [...new Set(pool.flatMap(product => Object.keys(product)))].sort(),
    cabinetFieldNames: [...new Set(cabinets.flatMap(cabinet => Object.keys(cabinet)))].sort(),
    orientationConfigured,
    orientationMissing: pool.length - orientationConfigured,
    cabinetGroups,
    physicalRecordCount: physicalRecords.length,
    physicalDuplicates,
    sampledProductMissing: baseline.skuSamples.filter((sample, index) => !sampledProducts[index]).map(sample => sample.skuKey),
    resolvedPhysicalRules: {
      source: PHYSICAL_BUSINESS_RULES.source,
      orientationRule: PHYSICAL_BUSINESS_RULES.orientationRule,
      verticalStack: PHYSICAL_BUSINESS_RULES.stackRules.vertical.description,
      chestStack: PHYSICAL_BUSINESS_RULES.stackRules.chest.description,
      iceStack: PHYSICAL_BUSINESS_RULES.stackRules.ice.description
    },
    ambiguities: [
      !pool.some(product => Object.hasOwn(product, "businessPriority"))
        ? "businessPriority 在当前正式产品池中无实际字段值" : null
    ].filter(Boolean)
  };
}

function printAudit(audit) {
  console.log("自动排柜基础数据来源审计");
  console.log(`正式候选产品池：${audit.productPoolCount} 个SKU`);
  console.log(`正式柜段：${audit.cabinetCount} 个`);
  console.log(`明确配置摆放方向：${audit.orientationConfigured} 个；缺失：${audit.orientationMissing} 个`);
  console.log(`正式物理规则来源：${audit.resolvedPhysicalRules.source}`);
  console.log(`正式摆放方向：${audit.resolvedPhysicalRules.orientationRule}`);
  for (const [type, group] of Object.entries(audit.cabinetGroups)) {
    console.log(`${type}：${group.count} 个；allowStack 真/假/缺失 = ${group.allowStack.trueCount}/${group.allowStack.falseCount}/${group.allowStack.missingCount}；allowVerticalStack 真/假/缺失 = ${group.allowVerticalStack.trueCount}/${group.allowVerticalStack.falseCount}/${group.allowVerticalStack.missingCount}`);
  }
  console.log(`${audit.resolvedPhysicalRules.verticalStack}；${audit.resolvedPhysicalRules.chestStack}；${audit.resolvedPhysicalRules.iceStack}`);
  audit.ambiguities.forEach(item => console.log(`需要人工确认：${item}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printAudit(runGoldenSourceAudit());
