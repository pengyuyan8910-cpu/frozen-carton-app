import fs from "node:fs";
import { verifyAppData } from "./verify-app-data.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../data/app-data.json", import.meta.url), "utf8"));
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;
const legalFace = row => {
  const face = Number(row.faceWidth);
  return face > 0 && (close(face, row.length) || close(face, row.width));
};
const invalidRows = data.skus.filter(row => !legalFace(row));
const invalidPlacements = data.skus.flatMap(row => (row.placements || []).map(placement => ({ row, placement }))).filter(({ row, placement }) => {
  const face = Number(placement.faceWidth ?? placement.width);
  return !(face > 0 && (close(face, row.length) || close(face, row.width)));
});
const report = verifyAppData(data);
if (data.stores.length !== 30) throw new Error(`门店数应为30，实际${data.stores.length}`);
if ((data.productPool || []).filter(row => row.active !== false).length !== 67) throw new Error("有效产品池应为67SKU");
if (invalidRows.length || invalidPlacements.length) throw new Error(`存在非法横向占宽：SKU行${invalidRows.length}，陈列位${invalidPlacements.length}`);
if (!report.passed) throw new Error(report.errors.join("；"));
console.log(JSON.stringify({ stores: data.stores.length, activeProductPool: 67, invalidRows: 0, invalidPlacements: 0, warnings: report.warnings.length }, null, 2));
