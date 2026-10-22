// One worker per active task, one at a time. Parent keeps responsive status and cancellation.
import { parentPort, workerData } from "node:worker_threads";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportContent, inspectContent, importContent, inventoryContent } from "./content-transfer.mjs";
import { unpackSnapshot, packSnapshot } from "./content-zip.mjs";

const { action, source, incoming, root, review, includeSettings = true, includePrivate, format } = workerData;
const cancelled = new Int32Array(workerData.cancel);
let last = 0;
const progress = (state) => {
  if (Atomics.load(cancelled, 0)) throw new Error("操作已取消。");
  if (Date.now() - last > 100 || !state.path) { parentPort.postMessage({ type: "progress", ...state }); last = Date.now(); }
};
try {
  progress({ stage: "checking" });
  let result;
  if (action === "inventory") result = { ...inventoryContent({ source, includeSettings, progress }), includeSettings };
  else if (action === "export") {
    result = exportContent({ source, output: join(root, "content"), includePrivate, includeSettings, progress });
    if (format === "zip") {
      const zip = await packSnapshot(result.output, join(root, "journal-content.zip"), progress);
      rmSync(result.output, { recursive: true });
      result = { ...result, output: zip.output, archiveBytes: zip.bytes, format: "zip" };
    } else result.format = "directory";
  } else if (["inspect", "upload"].includes(action)) {
    const snapshot = action === "upload" ? await unpackSnapshot(incoming, join(root, "snapshot"), progress) : incoming;
    result = { ...inspectContent({ source: snapshot, compare: source, progress }), snapshot };
    if (action === "upload") rmSync(incoming, { force: true });
  } else if (action === "import") {
    result = importContent({ source: incoming, output: join(root, "review"), compare: source, review, includePrivate, progress });
    // Preserve the review as a separate human-readable completeness report in our private task root.
    writeFileSync(join(root, "COMPARISON.json"), JSON.stringify(review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } else throw new Error("未知内容操作。");
  if (['inventory', 'inspect'].includes(action)) rmSync(root, { recursive: true, force: true });
  // Completion is authoritative even if cancellation raced just after the final file was committed.
  parentPort.postMessage({ type: "complete", result });
} catch (error) {
  let cleanup = "";
  try { rmSync(root, { recursive: true, force: true }); }
  catch (e) { cleanup = ` 清理未完成：${e.message}，请检查 ${root}`; }
  parentPort.postMessage({ type: "failed", error: `${error.message}${cleanup}`, cancelled: Boolean(Atomics.load(cancelled, 0)) });
}
