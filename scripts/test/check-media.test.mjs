// check-media 单元测试：node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect, sniff, checkDir, filenameWarnings } from "../check-media.mjs";
import { clean, jpegWithGps, webpWithGps, pngWithText, fakeHeic, fakeMov, fakeGif, animatedWebp } from "./fixtures.mjs";

const ok = (r) => assert.deepEqual(r.problems, [], `应无问题，实际：${r.problems.join("; ")}`);
const has = (r, re) => assert.ok(r.problems.some((p) => re.test(p)), `应报告 ${re}，实际：${r.problems.join("; ")}`);

test("干净的 JPEG / PNG / WebP 通过", () => {
  ok(inspect(clean.jpeg(), "a.jpg"));
  ok(inspect(clean.png(), "a.png"));
  ok(inspect(clean.webp(), "a.webp"));
});

test("带模拟 GPS 的 JPEG 被拒绝", () => has(inspect(jpegWithGps(), "a.jpg"), /EXIF/));
test("带模拟 GPS 的 WebP 被拒绝", () => has(inspect(webpWithGps(), "a.webp"), /EXIF/));
test("PNG 文本块被拒绝", () => has(inspect(pngWithText(), "a.png"), /tEXt/));

test("HEIC 原图被拒绝（含伪装成 .jpg 的情况）", () => {
  assert.equal(sniff(fakeHeic()), "heif");
  has(inspect(fakeHeic(), "a.heic"), /HEIC/);
  has(inspect(fakeHeic(), "IMG_0001.jpg"), /HEIC/);
});

test("视频、GIF、动画 WebP 被拒绝", () => {
  has(inspect(fakeMov(), "a.mov"), /视频/);
  has(inspect(fakeGif(), "a.gif"), /GIF/);
  has(inspect(animatedWebp(), "a.webp"), /动画/);
});

test("扩展名与格式不符被拒绝", () => has(inspect(clean.jpeg(), "a.webp"), /不符/));
test("无法识别的内容失败关闭", () => has(inspect(Buffer.from("not an image"), "a.png"), /无法识别/));

test("SVG：脚本与编辑器元数据被拒绝，简单图标通过", () => {
  ok(inspect(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'), "i.svg"));
  has(inspect(Buffer.from("<svg><script>alert(1)</script></svg>"), "i.svg"), /script/);
  has(inspect(Buffer.from('<svg xmlns:inkscape="x"><metadata/></svg>'), "i.svg"), /元数据/);
});

test("文件名提示", () => {
  assert.ok(filenameWarnings("IMG_20261013_123456.jpg").length >= 2);
  assert.ok(filenameWarnings("张三家门口.webp").some((w) => /非 ASCII/.test(w)));
  assert.deepEqual(filenameWarnings("evening-hills.webp"), []);
});

test("目录扫描：content 中的 GPS 图、SVG、未知类型都失败；干净图通过", () => {
  const root = mkdtempSync(join(tmpdir(), "qj-cm-"));
  try {
    const post = join(root, "content/posts/x");
    mkdirSync(post, { recursive: true });
    writeFileSync(join(post, "index.md"), "---\ntitle: x\n---\n");
    writeFileSync(join(post, "ok.webp"), clean.webp());
    writeFileSync(join(post, "gps.jpg"), jpegWithGps());
    writeFileSync(join(post, "logo.svg"), "<svg/>");
    writeFileSync(join(post, "notes.pdf"), "%PDF-1.4");
    const r = checkDir(join(root, "content"), "content", root);
    const failed = r.filter((x) => x.level === "FAIL").map((x) => x.file).sort();
    assert.deepEqual(failed, ["content/posts/x/gps.jpg", "content/posts/x/logo.svg", "content/posts/x/notes.pdf"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
