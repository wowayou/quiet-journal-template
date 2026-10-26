import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cmsOptions, loadQuality, saveQuality, QUALITY_KEY, QUALITIES } from "../../static/admin/editor.js";

test("CMS 质量：默认遵循配置，预设只覆盖 quality，不改集合、权限、尺寸或格式", () => {
  assert.deepEqual(cmsOptions("site"), {});
  for (const [profile, quality] of [["compact", 75], ["balanced", 85], ["high", 92]]) {
    assert.deepEqual(cmsOptions(profile), { config: { media_libraries: { default: { config: { transformations: { raster_image: { quality } } } } } } });
    assert.equal(QUALITIES[profile].quality, quality);
  }
  for (const profile of ["unknown", "__proto__", "constructor", null, "100"]) assert.throws(() => cmsOptions(profile), /未知/);
});

test("CMS 质量：只存预设键，存储被禁用或值非法时明确告知，不假装保存成功", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(loadQuality(storage), { profile: "site", message: "" });
  assert.equal(saveQuality("high", storage).saved, true);
  assert.deepEqual([...values], [[QUALITY_KEY, "high"]]);
  assert.deepEqual(loadQuality(storage), { profile: "high", message: "" });
  values.set(QUALITY_KEY, '{"quality":100,"backend":"unsafe"}');
  assert.equal(loadQuality(storage).profile, "site");
  assert.match(loadQuality(storage).message, /无效/);
  const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.match(loadQuality(denied).message, /无法读取/);
  assert.equal(saveQuality("compact", denied).saved, false);
  assert.match(saveQuality("compact", denied).message, /当前质量不变/);
  assert.throws(() => saveQuality("__proto__", storage), /未知/);
});

test("CMS 入口：先禁止自动初始化，保持固定 SRI、自定义挂载和无内联脚本", () => {
  const html = readFileSync(new URL("../../static/admin/index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('./manual-init.js') < html.indexOf('https://unpkg.com/@sveltia/cms@0.235.1/'));
  assert.ok(html.indexOf('./editor-components.js') < html.indexOf('./editor.js'));
  assert.match(html, /id="nc-root"/);
  assert.match(html, /id="qj-status-open"[^>]*title="保存到仓库不等于网站上线"/);
  assert.match(html, /<dialog id="qj-status-dialog"[\s\S]*href="\.\/publishing\.html" target="_blank" rel="noopener noreferrer"[\s\S]*<\/dialog>/);
  assert.match(html, /integrity="sha384-0buNFRS4cnwrZfClZMgBYxOTaefGGJltRCRnsKTgLl\+q0sOGWcd8sgJpgwr1oKUl"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]+?<\/script>/);
  const flags = readFileSync(new URL("../../static/admin/manual-init.js", import.meta.url), "utf8");
  assert.match(flags, /window.CMS_MANUAL_INIT = true/);
});

test("发布说明：纯静态、明确保存与上线边界，不读取令牌或假报实际发布状态", () => {
  const html = readFileSync(new URL("../../static/admin/publishing.html", import.meta.url), "utf8");
  assert.match(html, /保存到仓库不等于网站已上线/);
  assert.match(html, /不会因为部署失败而消失/);
  assert.match(html, /未保存的输入/);
  assert.match(html, /这个页面不读取云端状态/);
  assert.match(html, /网站状态/);
  assert.match(html, /publish:fallback -- --check/);
  assert.match(html, /Cloudflare Deployments/);
  assert.doesNotMatch(html, /<script|<iframe|<form|localStorage|Authorization|https:\/\/api\./i);
});
