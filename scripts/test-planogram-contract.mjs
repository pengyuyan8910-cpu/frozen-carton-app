import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [
  'scripts/test-planogram-module-reconciliation.mjs',
  'scripts/test-planogram-projection.mjs',
  'scripts/test-display-module-state.mjs',
  'scripts/test-planogram-staging-drop.mjs',
  'scripts/test-planogram-staging-dom-filter.mjs',
  'scripts/test-planogram-staging-search.mjs',
  'scripts/test-planogram-staging-input.mjs',
  'scripts/test-planogram-staging-ime.mjs',
  'scripts/test-planogram-shelf-to-staging.mjs',
  'scripts/test-planogram-include-state-consistency.mjs',
  'scripts/test-planogram-include-ui.mjs',
  'scripts/test-new-store-planogram-visibility.mjs',
  'scripts/test-loaded-planogram-capacity.mjs',
  'scripts/test-new-store-capacity-hydration.mjs',
  'scripts/test-loaded-capacity-uses-product-pool.mjs',
  'scripts/test-capacity-source-fallback.mjs',
  'scripts/test-planogram-usage-cache.mjs',
  'scripts/test-view-scroll-preservation.mjs',
  'scripts/test-current-state-preservation.mjs',
  'scripts/test-data-preservation.mjs',
  'scripts/test-state-integrity-guard.mjs',
  'scripts/test-cloud-local-protection.mjs',
  'scripts/test-cloud-state-guard.mjs',
  'scripts/test-cloud-sync-loading.mjs',
  'scripts/test-cloud-request-contract.mjs',
  'scripts/test-cloud-save-safety.mjs',
  'scripts/test-indexeddb-local-store.mjs',
  'scripts/test-durable-local-save.mjs',
  'scripts/test-planogram-excel-export.mjs',
  'scripts/test-planogram-export-ui.mjs'
];

const failures = [];
for (const relativePath of tests) {
  const filePath = path.join(root, relativePath);
  const result = spawnSync(process.execPath, [filePath], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  assert.equal(result.error, undefined, `${relativePath} could not be started`);
  if (result.status !== 0) failures.push(relativePath);
}

assert.deepEqual(failures, [], `planogram contract failed: ${failures.join(', ')}`);
console.log(`planogram contract passed (${tests.length} checks)`);
