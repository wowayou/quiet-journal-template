import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, put, read, build } from "./site-fixture.mjs";
import { describeStatus, fetchStatus } from "../../static/admin/site-status.js";

test("网站状态：显示生成时间与被跳过的设置；读不到或格式不对时明确说明，不假报上线", () => {
  const now = Date.parse("2026-10-26T12:10:00Z");
  const ok = describeStatus({ format: "quiet-journal-status", version: 1, built: "2026-10-26T12:07:00Z", warnings: [] }, now);
  assert.equal(ok.ok, true); assert.equal(ok.ago, "3 分钟前"); assert.match(ok.headline, /网站当前版本生成于/); assert.deepEqual(ok.warnings, []);
  assert.equal(describeStatus({ format: "quiet-journal-status", built: "2026-10-26T12:09:50Z", warnings: [] }, now).ago, "刚刚");
  assert.equal(describeStatus({ format: "quiet-journal-status", built: "2026-10-26T09:10:00Z", warnings: [] }, now).ago, "3 小时前");
  assert.equal(describeStatus({ format: "quiet-journal-status", built: "2026-10-20T12:10:00Z", warnings: [] }, now).ago, "6 天前");
  const warned = describeStatus({ format: "quiet-journal-status", built: "2026-10-26T12:00:00Z", warnings: ["导航 A 已隐藏", 5, "挂件 B 已跳过"] }, now);
  assert.deepEqual(warned.warnings, ["导航 A 已隐藏", "挂件 B 已跳过"]);
  for (const bad of [null, {}, { format: "other", built: "x", warnings: [] }, { format: "quiet-journal-status", built: 1, warnings: [] }, { format: "quiet-journal-status", built: "x", warnings: [] }]) {
    const result = describeStatus(bad, now);
    assert.equal(result.ok, false); assert.match(result.headline, /读不到|无效/); assert.deepEqual(result.warnings, []);
  }
});

test("网站状态：只发一次不缓存的同源请求；失败、非 200 或坏 JSON 都返回空而不抛错", async () => {
  const calls = [];
  const good = await fetchStatus("https://blog.example/build.json", async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => ({ a: 1 }) }; });
  assert.deepEqual(good, { a: 1 });
  assert.deepEqual(calls, [["https://blog.example/build.json", { cache: "no-store", credentials: "omit" }]]);
  assert.equal(await fetchStatus("u", async () => ({ ok: false, json: async () => ({}) })), null);
  assert.equal(await fetchStatus("u", async () => { throw new Error("offline"); }), null);
  assert.equal(await fetchStatus("u", async () => ({ ok: true, json: async () => { throw new SyntaxError("bad"); } })), null);
});

test("构建写出 /build.json；订阅或评论开启但未填账号、地址时保持关闭并提示，已填但格式错误仍失败", () => {
  const f = fixture();
  try {
    let result = build(f.root); assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(read(f.root, "public/build.json"));
    assert.equal(status.format, "quiet-journal-status"); assert.deepEqual(status.warnings, []);
    assert.ok(Math.abs(Date.now() - Date.parse(status.built)) < 10 * 60000);
    assert.deepEqual(Object.keys(status).sort(), ["built", "format", "version", "warnings"]); // Public facts only.
    put(f.root, "data/newsletter.yaml", JSON.stringify({ enabled: true, username: "" }));
    put(f.root, "data/comments.yaml", JSON.stringify({ enabled: true, origin: "" }));
    result = build(f.root); assert.equal(result.status, 0, result.stderr);
    const html = read(f.root, "public/posts/a/index.html");
    assert.ok(!html.includes("newsletter__form") && !html.includes("data-comments"));
    const warnings = JSON.parse(read(f.root, "public/build.json")).warnings.join("\n");
    assert.match(warnings, /邮件订阅已开启但没有填写 Buttondown 用户名/);
    assert.match(warnings, /评论入口已开启但没有填写隔离面板的源/);
    put(f.root, "data/comments.yaml", JSON.stringify({ enabled: true, origin: "http://not-https.example" }));
    assert.notEqual(build(f.root).status, 0);
  } finally { f.cleanup(); }
});
