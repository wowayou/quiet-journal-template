import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { inspectIconSvg } from "../svg.mjs";
import { inspect } from "../check-media.mjs";
import { exportContent, importContent } from "../content-transfer.mjs";
import { fixture, put, read, build } from "./site-fixture.mjs";
import { tags, checkSite } from "../check-site.mjs";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 5 90 90"><defs><style>.cls-1 { fill: #feb005; } .cls-2 { fill: #efefef; }</style></defs><circle class="cls-2" cx="50" cy="50" r="45"/><path class="cls-1" d="M10 20h30v40Z"/></svg>';
test("SVG 被动图标白名单：dashboard-icons 简单样式通过，主动内容与编码绕过拒绝", () => {
  assert.deepEqual(inspectIconSvg(svg), []);
  assert.deepEqual(inspectIconSvg('<?xml version="1.0" encoding="UTF-8"?>' + svg), []);
  for (const value of [
    '<svg><script/></svg>', '<svg><s:script xmlns:s="http://www.w3.org/2000/svg"/></svg>',
    '<svg onload="x"/>', '<svg><image href="https://e.test/x"/></svg>', '<svg><foreignObject/></svg>',
    '<svg><use href="#x"/></svg>', '<svg><animate/></svg>', '<svg><style>@import "https://e.test/x";</style></svg>',
    '<svg><style>.x{fill:url(https://e.test/x)}</style></svg>', '<svg><style>.x{fill:u\\72l(x)}</style></svg>',
    '<svg><path fill="url&#40;x&#41;"/></svg>', '<svg><path style="fill:red"/></svg>',
    '<!DOCTYPE svg><svg/>', '<svg/><svg/>', '<svg><path></svg>', '<svg id="x" id="y"/>',
    '<svg xmlns="https://evil.test"/>', '<svg><metadata/></svg>', '<html/>', '', '<svg>' + ' '.repeat(256 * 1024) + '</svg>',
  ]) assert.ok(inspectIconSvg(value).length, value.slice(0, 100));
});

test("自定义图标：外部 HTTPS SVG/WebP 原址输出且不在构建抓取；本地 SVG 为指纹 img", () => {
  const f = fixture();
  try {
    put(f.root, "assets/media/custom.svg", svg);
    f.site.nav[0].icon_image = "/media/custom.svg";
    f.site.social = [
      { label: "Linuxdo SVG", url: "https://linux.do/u/test/summary", icon_image: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/linuxdo.svg" },
      { label: "Linuxdo WebP", url: "https://linux.do/u/test/summary", icon: "link", icon_image: "https://unreachable.invalid/linuxdo.webp?v=1&x=2" },
    ]; f.saveSite();
    const built = build(f.root); assert.equal(built.status, 0, built.stderr);
    assert.deepEqual(checkSite(join(f.root, "public")), []);
    const elements = tags(read(f.root, "public/index.html"));
    const images = elements.filter((tag) => tag.name === "img" && tag.attrs.class.includes("icon--uploaded"));
    assert.equal(images.filter((image) => image.attrs.src.startsWith("https://")).length, 4); // Header + footer social links.
    const local = images.find((image) => image.attrs.src.startsWith("/media/custom."));
    assert.ok(local); assert.match(local.attrs.src, /\.[a-f\d]{64}\.svg$/);
    assert.equal(readFileSync(join(f.root, "public", local.attrs.src), "utf8"), svg);
    for (const image of images) { assert.equal(image.attrs.referrerpolicy, "no-referrer"); assert.equal(image.attrs.width, "20"); }
    assert.ok(!elements.some((tag) => tag.name === "circle" && tag.attrs.r === "45")); // Never inline uploaded content.
    for (const src of ["http://e.test/x.svg", "//e.test/x.svg", "https://user:pass@e.test/x.svg", "https://e.test/profile", "https://e.test/x.svg#part", "/media/../x.svg", "/media/missing.svg", "data:image/svg+xml,x"]) {
      f.site.nav[0].icon_image = src; f.saveSite();
      assert.notEqual(build(f.root).status, 0, src);
    }
  } finally { f.cleanup(); }
});

test("内容传输保留本地 SVG 图标字节，但重新计算清单也不能带入主动 SVG", () => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), "qj-svg-transfer-"));
  try {
    put(f.root, "assets/media/custom.svg", svg);
    const output = join(root, "snapshot"), restored = join(root, "review");
    exportContent({ source: f.root, output, includePrivate: true });
    importContent({ source: output, output: restored, includePrivate: true });
    assert.equal(read(restored, "assets/media/custom.svg"), svg);
    const active = '<svg onload="alert(1)"/>';
    put(f.root, "assets/media/unsafe.svg", active);
    assert.throws(() => exportContent({ source: f.root, output: join(root, "bad"), includePrivate: true }), /媒体检查失败/);
    const manifest = JSON.parse(read(output, "manifest.json"));
    const entry = manifest.files.find((file) => file.path === "assets/media/custom.svg");
    entry.bytes = Buffer.byteLength(active); entry.sha256 = createHash("sha256").update(active).digest("hex");
    put(output, "files/assets/media/custom.svg", active); put(output, "manifest.json", JSON.stringify(manifest));
    assert.throws(() => importContent({ source: output, output: join(root, "unsafe-import"), includePrivate: true }), /媒体检查失败/);
    assert.ok(inspect(Buffer.from('<svg><script/></svg>'), "x.svg").problems.length);
  } finally { f.cleanup(); rmSync(root, { recursive: true, force: true }); }
});
