import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fixture, put, read, build, document } from "./site-fixture.mjs";
import { checkSite } from "../check-site.mjs";

test("共享日期契约：只有 lastmod 的页面显示更新、不虚构发布时间，结构化数据一致", () => {
  const f = fixture();
  try {
    for (const [id, layout] of [["about", "page"], ["archive", "archive"]]) put(f.root, `content/${id}.md`, document({ title: id, layout, lastmod: "2024-01-02T08:00:00Z" }, "合成内容。"));
    const result = build(f.root); assert.equal(result.status, 0, result.stderr);
    for (const id of ["about", "archive"]) {
      const html = read(f.root, `public/${id}/index.html`);
      assert.match(html, /更新于/); assert.doesNotMatch(html, /发布于|0001-/);
      const structured = JSON.parse(html.match(/<script type=["']?application\/ld\+json["']?>([\s\S]*?)<\/script>/)[1]);
      assert.equal(structured.dateModified, "2024-01-02T08:00:00Z");
      assert.equal(structured.datePublished, undefined);
    }
    assert.deepEqual(checkSite(join(f.root, "public")), []);
  } finally { f.cleanup(); }
});

test("共享页面契约：保留的系统资源 ID 不能用作普通页面", () => {
  const f = fixture();
  try {
    for (const id of ["admin", "media", "search", "page"]) {
      put(f.root, `content/${id}.md`, document({ title: id }));
      const result = build(f.root); assert.notEqual(result.status, 0, id);
      assert.match(result.stderr + result.stdout, /系统|保留|路由/);
      rmSync(join(f.root, `content/${id}.md`));
    }
  } finally { f.cleanup(); }
});
