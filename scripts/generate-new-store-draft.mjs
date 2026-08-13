import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allocateStore } from "./strict-allocation-engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataPath = path.join(root, "data", "app-data.json");
const defaultConfigPath = path.join(root, "data", "new-store", "新增门店配置.json");
const configPath = process.env.NEW_STORE_CONFIG_PATH ? path.resolve(root, process.env.NEW_STORE_CONFIG_PATH) : defaultConfigPath;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function number(value) {
  const match = text(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function dimensions(value) {
  return text(value).split("+").map(part => part.split("*").map(number)).filter(values => values.length === 3 && values.every(value => value > 0));
}

function cabinetKey(store, label, position) {
  return `${store}__${label}__${position}`;
}

function buildCabinets(config) {
  const cabinets = [];
  const counters = new Map();
  const nextNumber = key => {
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    return next;
  };
  for (const row of config.cabinets || []) {
    const kind = text(row.type);
    const model = text(row.model) || kind;
    const quantity = Math.max(1, Math.floor(number(row.quantity) || 1));
    if (/立柜/.test(kind)) {
      const doors = Math.max(1, Math.floor(number(row.doors) || 1));
      const layers = Math.max(1, Math.floor(number(row.layers) || 1));
      if (!(number(row.length) > 0 && number(row.depth) > 0 && number(row.height) > 0)) throw new Error(`柜体物理尺寸缺失：${kind}-${model}`);
      for (let quantityIndex = 0; quantityIndex < quantity; quantityIndex += 1) {
        for (let door = 0; door < doors; door += 1) {
          const label = `${kind}${model}-${"柜"}${nextNumber(`${kind}|${model}`)}`;
          for (let layer = 1; layer <= layers; layer += 1) {
            const position = `第${layer}层`;
            cabinets.push({ store: config.name, key: cabinetKey(config.name, label, position), kind, type: kind, label, position, length: number(row.length), depth: number(row.depth), height: number(row.height) });
          }
        }
      }
      continue;
    }
    const groups = dimensions(row.dimensions);
    if (!groups.length) throw new Error(`柜体物理尺寸缺失或格式错误：${kind}-${model}`);
    for (let quantityIndex = 0; quantityIndex < quantity; quantityIndex += 1) {
      const label = `${kind}${model}-${"柜"}${nextNumber(`${kind}|${model}`)}`;
      groups.forEach((group, index) => {
        const position = `分区${index + 1}`;
        cabinets.push({ store: config.name, key: cabinetKey(config.name, label, position), kind, type: kind, label, position, length: group[0], depth: group[1], height: group[2] });
      });
    }
  }
  return cabinets;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function main() {
  if (path.extname(configPath).toLowerCase() !== ".json") throw new Error("当前正式引擎CLI只接受已确认的JSON柜体配置，不执行Excel读写。");
  const base = readJson(appDataPath);
  const config = readJson(configPath);
  const plan = allocateStore({
    store: text(config.name),
    type: text(config.type) || "新店",
    productPool: base.productPool,
    cabinets: buildCabinets(config),
    params: { ...(base.params || {}), externalCapL: number(config.externalCapL) || 754 }
  }, { maxIterations: 12, maxExpansions: 180 });
  console.log(JSON.stringify({ store: plan.store, status: plan.status, summary: plan.summary, validation: plan.validation, unplacedSkus: plan.unplacedSkus, evidence: plan.evidence }, null, 2));
  if (plan.status === "failed") process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
