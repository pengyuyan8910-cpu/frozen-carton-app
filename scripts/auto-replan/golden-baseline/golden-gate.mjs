import { pathToFileURL } from "node:url";
import { runGoldenBaseline } from "./golden-baseline-test.mjs";

export function assertGoldenBaseline() {
  const result = runGoldenBaseline({ print: true });
  if (!result.ok) {
    throw new Error("基础容量口径校验未通过，已停止后续排柜计算。");
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertGoldenBaseline();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
