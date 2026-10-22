import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import { exportContent } from "../content-transfer.mjs";
import { startContentUI } from "../content-ui.mjs";

async function using(fn) {
  const root = mkdtempSync(join(tmpdir(), "qj-ui-"));
  const source = join(root, "site"), folder = join(root, "private");
  mkdirSync(join(source, "content"), { recursive: true }); mkdirSync(folder);
  const text = "---\ntitle: 私人草稿\ndraft: true\n---\n合成内容，不公开。\n";
  writeFileSync(join(source, "content/post.md"), text);
  writeFileSync(join(source, ".env"), "NOT_FOR_EXPORT");
  const app = await startContentUI({ source, folder });
  const auth = { Authorization: `Bearer ${new URL(app.url).hash.slice(1)}` };
  const call = async (data, headers = {}) => {
    const response = await fetch(`${app.origin}/api/action`, { method: "POST", headers: { ...auth, "Content-Type": "application/json", ...headers }, body: JSON.stringify({ id: randomBytes(16).toString('hex'), ...data }) });
    return { status: response.status, body: await response.json() };
  };
  const complete = async (request) => {
    const submitted = await call(request);
    if (submitted.status !== 202) return submitted;
    for (let i = 0; i < 100; i++) {
      await new Promise(done => setTimeout(done, 25));
      const info = await (await fetch(`${app.origin}/api/status`, { headers: auth })).json();
      const task = info.tasks.find(task => task.id === submitted.body.id);
      if (task.status !== 'running') return { status: task.status === 'completed' ? 200 : 400, body: { ...(await (await fetch(`${app.origin}/api/task?id=${task.id}`, { headers: auth })).json()).result, error: task.error, id: task.id } };
    }
    throw new Error('Task timed out');
  };
  const snapshot = join(folder, 'snapshot');
  const exp = () => exportContent({ source, output: snapshot, includePrivate: true });
  try { await fn({ root, source, folder, text, app, auth, call, complete, exp, snapshot }); }
  finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
}

test("本地向导：默认页面无私人数据，API 需独立会话且不允许跨源或 DNS 重绑定", () => using(async ({ app, source, auth, call }) => {
  const page = await fetch(app.origin);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(!html.includes(source)); assert.ok(!html.includes(new URL(app.url).hash.slice(1)));
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self'.*frame-ancestors 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${app.origin}/api/status`)).status, 403);
  assert.equal((await fetch(`${app.origin}/api/status`, { headers: { ...auth, Origin: "https://evil.test" } })).status, 403);
  assert.equal((await call({ action: "export", includePrivate: true }, { Origin: "null" })).status, 403);
  assert.equal((await call({ action: "export", includePrivate: true }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const status = await new Promise((done, reject) => {
    const req = request(`${app.origin}/api/status`, { headers: { ...auth, Host: "evil.test" } }, (res) => { res.resume(); done(res.statusCode); }); req.on("error", reject); req.end();
  });
  assert.equal(status, 403);
  const info = await (await fetch(`${app.origin}/api/status`, { headers: auth })).json();
  assert.equal(info.source, source);
  assert.equal((await fetch(`${app.origin}/../content-ui.mjs`)).status, 403);
}));

test("本地向导：确认、导出、比较、隔离导入完整往返，不写回站点或泄露 .env", () => using(async ({ source, folder, text, app, auth, call, complete, exp, snapshot }) => {
  assert.equal((await call({ action: "export" })).status, 400);
  assert.deepEqual(readdirSync(folder), []);
  const exported = await complete({ action: "export", includePrivate: true, format: "directory" });
  assert.equal(exported.status, 200); assert.equal(exported.body.files, 1);
  exp();
  assert.equal((await call({ action: "import", includePrivate: true })).status, 409);
  writeFileSync(join(source, "content/post.md"), "Changed only locally");
  const checked = await complete({ action: "inspect", snapshot });
  assert.equal(checked.status, 200); assert.equal(checked.body.conflicts, 1);
  assert.equal(checked.body.comparison[0].status, "conflict");
  assert.equal((await call({ action: "import", reviewId: checked.body.id })).status, 400);
  const restored = await complete({ action: "import", reviewId: checked.body.id, includePrivate: true });
  assert.equal(restored.status, 200);
  assert.equal(readFileSync(join(restored.body.output, "content/post.md"), "utf8"), text);
  assert.equal(readFileSync(join(source, "content/post.md"), "utf8"), "Changed only locally");
  assert.deepEqual(readdirSync(restored.body.output).sort(), ["IMPORT-REPORT.json", "content"]);
  const second = await complete({ action: "export", includePrivate: true, format: "directory" });
  assert.equal(second.status, 200); assert.notEqual(second.body.output, exported.body.output);
}));

test("本地向导：参数白名单、路径越界、符号链接、损坏包与超长请求明确失败", () => using(async ({ root, folder, auth, app, call, complete, exp, snapshot }) => {
  for (const snapshot of ["..", "../site", "a/b", "a\\b", ".hidden"]) assert.equal((await call({ action: "inspect", snapshot })).status, 400);
  assert.equal((await call({ action: "export", includePrivate: true, output: "/tmp/override" })).status, 400);
  assert.equal((await call({ action: "delete" })).status, 400);
  const raw = await fetch(`${app.origin}/api/action`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "x".repeat(5000) });
  assert.equal(raw.status, 413);
  const invalid = await fetch(`${app.origin}/api/action`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{" });
  assert.equal(invalid.status, 400);
  exp();
  if (process.platform !== "win32") {
    symlinkSync(snapshot, join(folder, "alias"));
    assert.equal((await call({ action: "inspect", snapshot: "alias" })).status, 400);
  }
  const checked = await complete({ action: "inspect", snapshot });
  assert.equal(checked.status, 200);
  writeFileSync(join(snapshot, "files/content/post.md"), "TAMPERED");
  assert.equal((await complete({ action: "import", reviewId: checked.body.id, includePrivate: true })).status, 400);
  assert.equal(readdirSync(folder).filter((name) => name.startsWith("journal-import-")).length, 0);
}));
