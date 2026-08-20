import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = {
  'data/app-data.json': '5F187BC457D54872C63C938685D56228D515DB5AF3D2FF5D73F1C5B5DFECD792',
  'data/version.json': '1347FEF7896799362CBF5E3FCAC28F67B6E253CB28E40C55C098D90DE45364A4',
};

for (const [relative, hash] of Object.entries(expected)) {
  const file = path.join(root, relative);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
  assert.equal(actual, hash, `${relative} 不应被功能收敛改造改写`);
}

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/app-data.json'), 'utf8'));
assert.ok(Array.isArray(data.stores) && data.stores.length > 0, '现有门店数据必须保留');
assert.ok(Array.isArray(data.cabinets) && data.cabinets.length > 0, '现有柜体数据必须保留');
assert.ok(Array.isArray(data.skus) && data.skus.length > 0, '现有SKU数据必须保留');
console.log(`data preservation passed: ${data.stores.length} stores, ${data.skus.length} SKU rows, ${data.cabinets.length} cabinet rows`);
