import assert from "node:assert/strict";
import { preservePlanogramStagingSearchFocus } from "./planogram-staging-search.mjs";

const currentInput = { selectionStart: 2, selectionEnd: 3 };
let rendered = false;
const nextInput = {
  focused: false,
  selection: null,
  focus() { this.focused = true; },
  setSelectionRange(start, end) { this.selection = [start, end]; },
};

preservePlanogramStagingSearchFocus(
  currentInput,
  () => { rendered = true; },
  () => nextInput,
);

assert.equal(rendered, true, "应先执行待选区重绘");
assert.equal(nextInput.focused, true, "重绘后搜索框应恢复焦点");
assert.deepEqual(nextInput.selection, [2, 3], "重绘后应恢复光标选区");

console.log("planogram staging input tests passed");
