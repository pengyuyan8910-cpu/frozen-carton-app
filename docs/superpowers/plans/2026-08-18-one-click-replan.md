# 一键产品池重排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验收严格排柜核心接入当前 frozen-carton-app，并提供产品池导出、一键重排草稿、人工复核、正式底表导出的一键闭环。

**Architecture:** 保持 app.js 主体不动，以 `bootstrap.js` 作为唯一装载入口，新增纯函数 replan core + 轻量 xlsx writer + UI addon。严格排柜 engine 是唯一算法；产品池变化通过 preferredPlacements 优先保留老品合法原位置，新门店无偏好时走同一完整算法。草稿写入现有 `frozen_carton_unified_scene_draft_v1`，发布状态不改。

**Tech Stack:** 原生浏览器 JavaScript ES modules、Node 20、现有 `xlsx` Node 依赖、GitHub Actions、静态 GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-08-18-one-click-replan-design.md`

## Global Constraints

- 只修改 frozen-carton-app 产品池重排链路，不扩大到其他项目或无关页面。
- 不重构 app.js 主业务。
- 不改变产品生命周期流程和店员端正式数据流程。
- 不创建第二套排柜算法。
- 立柜柜4第1–5层正常参与冻品排柜；第6层存储。
- 用户可见提示全部中文。
- 建议外储硬上限 754L。
- 未排入 SKU 不自动删除。

---

### Task 1: 接回唯一严格排柜核心并增加老品位置偏好

**Files:**
- Create: `scripts/strict-allocation-engine.mjs`
- Create: `scripts/strict-allocation-adapter.mjs`
- Create: `scripts/test-strict-replan-engine.mjs`

**Interfaces:**
- Consumes: `{store,type,productPool,cabinets,params,p95Factor,preferredPlacements}`
- Produces: `allocateStore()`, `validatePlan()`, `planSignature()`, app-compatible `plan.skus/cabinets/summary`.

- [ ] 先写失败测试：柜4可用、第6层不可用、冰品隔离、老品合法位置优先保留、无效偏好自动回退。
- [ ] 运行测试确认因模块/偏好功能缺失失败。
- [ ] 放入已验收 deterministic core，不修改既有硬规则。
- [ ] 增加 `preferredPlacements` seed：仅当 SKU 当前有效、候选方向合法、柜段存在且不超宽时先放1列；否则回退正常候选算法。
- [ ] 运行测试确认通过。

### Task 2: 构建统一产品池重排纯函数

**Files:**
- Create: `scripts/product-pool-replan-core.mjs`
- Create: `scripts/test-product-pool-replan.mjs`

**Interfaces:**
- `normalizeActiveProductPool(products)`
- `buildPreferredPlacements(data, store, pool)`
- `replanAllStores(data, products, options)`
- `buildReplanDraft(data, products, result)`
- `validateReplanResult(result)`

- [ ] 先写失败测试：淘汰商品退出、在售/上新完成保留、全部门店生成、未排入商品保留原因、草稿结构兼容 app。
- [ ] 运行失败测试。
- [ ] 实现最小纯函数。
- [ ] 运行测试并补充确定性签名测试。

### Task 3: 浏览器端真实 XLSX 输出

**Files:**
- Create: `scripts/xlsx-lite.mjs`
- Create: `scripts/replan-workbook.mjs`
- Create: `scripts/test-replan-workbook.mjs`

**Interfaces:**
- `buildProductPoolSheets(pool)`
- `buildFormalWorkbookSheets(draft)`
- `writeXlsx(sheets)` -> `Uint8Array`
- `downloadXlsx(filename, sheets)` browser helper.

- [ ] 先写失败测试：输出 ZIP/OOXML 签名、Sheet 名称完整、动态池不写死71。
- [ ] 实现无 CDN 的 minimal OOXML writer（store ZIP entries + shared inline strings）。
- [ ] 实现产品池和正式底表 sheet 映射，字段与现有 `source-to-app-data.mjs` 对齐。
- [ ] 用 Python openpyxl 验证生成文件能打开且9张表名称/关键表头正确。

### Task 4: 产品池重排运营外挂 UI

**Files:**
- Create: `scripts/product-pool-replan-ui.mjs`
- Modify: `bootstrap.js`

**Interfaces:**
- UI 在现有 `#io` 运营页面插入 `#productPoolReplanPanel`。
- 四按钮：`导出当前产品池`、`按当前产品池重新排柜`、`人工复核`、`导出最新版底表`。

- [ ] 写 DOM contract 测试/静态字符串测试，确认四按钮和中文提示存在。
- [ ] UI 从 `window.ProductLifecycle.getActiveProducts()` 读取最新池，回退 `window.UNIFIED_CARTON_DATA.productPool`。
- [ ] 重排后完整草稿写入现有草稿 localStorage key，不写发布 key。
- [ ] 人工复核按钮设置一次性标记并刷新；模块重新加载后进入运营模式/排柜调整页面。
- [ ] bootstrap 仅新增 module loader，不改变 app.js 加载顺序和原初始化。

### Task 5: GitHub 自动校验与命令入口

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/update-data.yml`（仅在需要增加明确校验/summary 时）

**Interfaces:**
- `npm run test:replan`
- `npm run check` 包含新模块 syntax check。

- [ ] 增加测试命令并执行全部 replan 定向测试。
- [ ] `npm run check` 验证所有新增 JS/MJS 语法。
- [ ] 确认现有 workflow 对 `data/source/*.xlsx` 的失败行为不会覆盖旧 app-data。
- [ ] 如 workflow 缺少清晰失败说明，增加 `GITHUB_STEP_SUMMARY` 中文结果，不改变成功提交逻辑。

### Task 6: 全链路验收

**Files:**
- Test only; no unrelated modifications.

- [ ] 运行 strict engine tests。
- [ ] 运行 product-pool replan tests。
- [ ] 生成测试 `产品池_当前版.xlsx` 并用 openpyxl 打开。
- [ ] 生成测试 `整箱到店数据测算_当前版.xlsx` 并验证必需 Sheet/字段。
- [ ] 验证草稿 localStorage key 与发布 key 隔离。
- [ ] 搜索新增代码确认不存在“柜4第1-4层预留”行为。
- [ ] 对比分支与 master，确认未修改 app.js、生命周期页面和店员端逻辑。
- [ ] 创建 Draft PR，列出完成项、测试结果、剩余人工浏览器验收点。
