# Quality Review Log

## 2026-07-21 New-store automatic planning entry

- Issue found: moving a SKU to fill an empty display position could increase external storage beyond the configured cap.
- Fix: every placement, move and expansion now recalculates trigger stock, external storage and cabinet width. The change is reverted automatically if the cap cannot be preserved.
- Guardrails: a draft is rejected unless cabinet 4 layers 1-4 remain reserved, layer 6 stays storage-only, every other usable frozen position is occupied, width is within limit, ice products are in ice cabinets, and suggested external storage is within cap.
