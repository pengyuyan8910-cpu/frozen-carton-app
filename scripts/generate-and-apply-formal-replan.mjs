import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateReplanDraft, previousPlanFromStoreState } from "./product-pool-replan-service.mjs";
import { applyStrictDraftToFormalData } from "./apply-formal-replan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(root, process.argv[2] || "data/app-data.json");
const outputPath = path.resolve(root, process.argv[3] || "data/staging/app-data.strict-replan-20260820.json");
const draftPath = path.resolve(root, process.argv[4] || "data/staging/full-replan-draft-20260820.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function applyKnownPhysicalDimensions(data) {
  const store = "三山星悦广场生活馆";
  const target = (data.cabinets || []).filter(cabinet => {
    if (cabinet.store !== store) return false;
    const label = String(cabinet.label || "");
    return /卧柜2505|卧柜2000|冰淇淋柜2000/.test(label);
  });
  if (!target.length) return;
  if (target.length !== 14) {
    throw new Error(`三山星悦广场卧柜/冰淇淋柜分区数应为14，实际为${target.length}`);
  }
  for (const cabinet of target) {
    cabinet.depth = 697;
    cabinet.height = /分区2/.test(String(cabinet.position || "")) ? 204 : 460;
  }
}

function buildDraft(data) {
  const previousPlans = Object.fromEntries((data.stores || []).map(store => [
    store.store,
    previousPlanFromStoreState(data, store.store)
  ]));
  const physicalPath = path.join(root, "data", "user-confirmed-physical-dimensions.json");
  const physicalSource = fs.existsSync(physicalPath) ? readJson(physicalPath) : [];
  const physicalRecords = Array.isArray(physicalSource)
    ? physicalSource
    : Array.isArray(physicalSource.records) ? physicalSource.records : [];
  const originalLog = console.log;
  let draft;
  try {
    console.log = () => {};
    draft = generateReplanDraft({
      productPool: data.productPool,
      stores: data.stores,
      cabinets: data.cabinets,
      params: data.params,
      previousPlans,
      scope: data.stores.map(store => store.store),
      physicalRecords,
      generatedAt: new Date().toISOString()
    });
  } finally {
    console.log = originalLog;
  }
  return { draft, physicalRecords };
}

export function rebuildFormalData(data) {
  applyKnownPhysicalDimensions(data);
  const { draft, physicalRecords } = buildDraft(data);
  const next = applyStrictDraftToFormalData(data, draft, physicalRecords);
  delete next.frozen_carton_replan_draft_v2;
  return { next, draft };
}

function main() {
  const data = readJson(inputPath);
  const { next, draft } = rebuildFormalData(data);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    outputPath,
    draftPath,
    summary: draft.summary,
    audit: next.replanAudit
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
