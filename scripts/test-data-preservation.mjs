import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/app-data.json'), 'utf8'));
const versionHash = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'data/version.json')))
  .digest('hex').toUpperCase();
assert.equal(versionHash, '1347FEF7896799362CBF5E3FCAC28F67B6E253CB28E40C55C098D90DE45364A4', '版本来源记录不得被容量重算改写');
const structuralProjection = {
  stores: (data.stores || []).map(store => ({ store: store.store, type: store.type, vertical: store.vertical, chest: store.chest, ice: store.ice })),
  cabinets: (data.cabinets || []).map(cabinet => ({
    id: cabinet.id, store: cabinet.store, key: cabinet.key, label: cabinet.label, position: cabinet.position,
    kind: cabinet.kind, type: cabinet.type, length: cabinet.length, depth: cabinet.depth, height: cabinet.height
  })),
  skus: (data.skus || []).map(row => ({
    id: row.id, store: row.store, included: row.included, status: row.status, grade: row.grade, rank: row.rank,
    category2: row.category2, category3: row.category3, category4: row.category4, sceneGroup: row.sceneGroup,
    familyGroup: row.familyGroup, name: row.name, barcode: row.barcode, length: row.length, width: row.width,
    height: row.height, volume: row.volume, carton: row.carton, dailyQty: row.dailyQty, dailySales: row.dailySales,
    moq: row.moq, moqDays: row.moqDays, cabinetKey: row.cabinetKey, cabinetLabel: row.cabinetLabel,
    position: row.position, displayCols: row.displayCols, faceOrientation: row.faceOrientation, faceWidth: row.faceWidth,
    customPlacement: row.customPlacement, placementRole: row.placementRole, externalOwner: row.externalOwner,
    inStaging: row.inStaging, stagingCabinetType: row.stagingCabinetType, stagingIce: row.stagingIce,
    stagingFrom: row.stagingFrom, placementCloneOf: row.placementCloneOf, placementCloneType: row.placementCloneType,
    placements: (row.placements || []).map(placement => ({
      skuKey: placement.skuKey, cabinetKey: placement.cabinetKey, cabinetLabel: placement.cabinetLabel,
      section: placement.section, zone: placement.zone, position: placement.position, layer: placement.layer,
      orientation: placement.orientation, faceWidth: placement.faceWidth, displayCols: placement.displayCols
    }))
  }))
};
const structuralHash = crypto.createHash('sha256').update(JSON.stringify(structuralProjection)).digest('hex').toUpperCase();
assert.equal(structuralHash, '0950D733CA348CC8103DB5499FD9E627D0AF1B5E14C196D457D909FEFDB6746A', '容量重算不得改变现有门店、柜体、SKU尺寸、位置、方向、列数或模块结构');
assert.equal(data.stores?.length, 32, '现有门店数据必须保留');
assert.equal(data.cabinets?.length, 848, '现有柜体数据必须保留');
assert.equal(data.skus?.length, 2212, '现有SKU数据必须保留');
console.log(`data preservation passed: ${data.stores.length} stores, ${data.skus.length} SKU rows, ${data.cabinets.length} cabinet rows`);

