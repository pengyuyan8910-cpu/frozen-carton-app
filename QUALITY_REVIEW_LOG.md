# Quality Review Log

## 2026-07-21 New-store automatic planning entry

- Issue found: moving a SKU to fill an empty display position could increase external storage beyond the configured cap.
- Fix: every placement, move and expansion now recalculates trigger stock, external storage and cabinet width. The change is reverted automatically if the cap cannot be preserved.
- Guardrails: a draft is rejected unless cabinet 4 layers 1-4 remain reserved, layer 6 stays storage-only, every other usable frozen position is occupied, width is within limit, ice products are in ice cabinets, and suggested external storage is within cap.


## 2026-07-31 Release-blocking remote mismatch handling

- Issue found: when the local working tree was behind `origin/master`, work stopped after reporting the mismatch even though the requested outcome was to repair and publish.
- Required response: treat a remote mismatch as a reconciliation step, not as the end of the task. Inspect the remote change scope, preserve the newest remote version, merge the requested repair into that baseline, run targeted checks, and publish only after verifying the staged scope.
- Guardrail: stop only when reconciliation would overwrite unrelated remote work, create a true conflict that cannot be resolved from the confirmed requirements, or requires a decision that materially changes business data. In those cases, clearly state the exact decision needed.
