import assert from "node:assert/strict";
import { shouldSkipPlanogramStagingSearchRender } from "./planogram-staging-search.mjs";

assert.equal(
  shouldSkipPlanogramStagingSearchRender({ isComposing: true }, false),
  true,
  "输入法组字期间不应重绘待选区",
);
assert.equal(
  shouldSkipPlanogramStagingSearchRender({ inputType: "insertCompositionText" }, false),
  true,
  "浏览器以 composition inputType 传递组字时不应重绘待选区",
);
assert.equal(
  shouldSkipPlanogramStagingSearchRender({ isComposing: false }, true),
  true,
  "compositionstart 标记仍在时不应重绘待选区",
);
assert.equal(
  shouldSkipPlanogramStagingSearchRender({ isComposing: false }, false),
  false,
  "普通输入应继续触发待选区筛选",
);

console.log("planogram staging IME tests passed");

