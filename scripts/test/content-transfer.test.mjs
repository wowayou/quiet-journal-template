import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync, truncateSync, statSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { exportContent, inspectContent, importContent, readSnapshot, validateManifest, validatePath, LIMITS } from "../content-transfer.mjs";
import { clean, jpegWithGps, webpWithGps } from "./fixtures.mjs";

const put = (root, path, data) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
const files = (root) => readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(root, entry.name)).map((path) => `${entry.name}/${path}`) : [entry.name]).sort();
const sourceText = '\uFEFF---\r\ntitle: "保留原样"\r\ndate: 2020-01-01T00:00:00+08:00\r\ndraft: true\r\ncomments: false\r\n---\r\n\r\n![照片](photo.webp)\r\n';
const using = (fn) => {
  const root = mkdtempSync(join(tmpdir(), "qj-transfer-"));
  const source = join(root, "site"), output = join(root, "snapshot"), restored = join(root, "review");
  put(source, "content/posts/fixed-id/index.md", sourceText);
  put(source, "content/posts/fixed-id/photo.webp", clean.webp());
  put(source, "content/关于.md", '---\ntitle: 关于\n---\n正文。');
  put(source, "assets/media/shared.png", clean.png());
  put(source, "data/site.yaml", 'title: 手记\nauthor: Test\n');
  put(source, "data/links.yaml", "[]\n");
  const exp = () => exportContent({ source, output, includePrivate: true });
  try { fn({ root, source, output, restored, exp }); } finally { rmSync(root, { recursive: true, force: true }); }
};
const manifest = (output) => JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
const rewrite = (output, change) => { const value = manifest(output); change(value); put(output, "manifest.json", JSON.stringify(value)); };

test("内容传输：保留字节、路径、草稿、评论开关、中文与图片，排除代码和独立服务配置/备份", () => using(({ source, output, restored, exp }) => {
  const excluded = [".git/config", ".env", "wrangler.jsonc", "static/admin/config.yml", "assets/js/custom.js", "data/widget_extensions.yaml", "data/comments.yaml", "integrations/waline/config.local.json", "integrations/waline-server/.env.local", "integrations/waline-server/.vercel/project.json", "integrations/waline-server/api/index.js", "integrations/waline-server/comments.dump"];
  for (const path of excluded) put(source, path, "MUST_NOT_EXPORT");
  const result = exp();
  assert.equal(result.files, 6);
  assert.equal(inspectContent({ source: output, compare: source }).conflicts, 0);
  assert.deepEqual(files(output), ["manifest.json", ...manifest(output).files.map((entry) => `files/${entry.path}`)].sort());
  assert.ok(!readFileSync(join(output, "manifest.json"), "utf8").includes("MUST_NOT_EXPORT"));
  const imported = importContent({ source: output, output: restored, includePrivate: true });
  assert.equal(imported.files, 6);
  for (const entry of manifest(output).files) assert.deepEqual(readFileSync(join(restored, entry.path)), readFileSync(join(source, entry.path)));
  for (const path of excluded) assert.equal(fs.existsSync(join(restored, path)), false, `${path} must remain outside content import`);
  assert.equal(readFileSync(join(restored, "content/posts/fixed-id/index.md"), "utf8"), sourceText);
  const report = JSON.parse(readFileSync(join(restored, "IMPORT-REPORT.json"), "utf8"));
  assert.equal(report.includesPrivate, true);
  assert.equal(report.filesWritten.length, 6);
  assert.match(report.notice, /原有草稿\/公开标记未改/);
  if (process.platform !== "win32") {
    assert.equal(statSync(output).mode & 0o077, 0);
    assert.equal(statSync(join(output, "manifest.json")).mode & 0o077, 0);
    assert.equal(statSync(restored).mode & 0o077, 0);
  }
}));

test("内容传输：显式确认私有内容；已有目录即使为空也不覆盖", () => using(({ source, output, restored, exp }) => {
  assert.throws(() => exportContent({ source, output }), /include-private/);
  assert.equal(fs.existsSync(output), false);
  exp();
  assert.throws(() => importContent({ source: output, output: restored }), /include-private/);
  assert.equal(fs.existsSync(restored), false);
  assert.throws(exp, /全新目录/);
  mkdirSync(restored);
  assert.throws(() => importContent({ source: output, output: restored, includePrivate: true }), /全新目录/);
  assert.deepEqual(readdirSync(restored), []);
}));

test("内容传输：禁止向源目录及任意 Git/Hugo 工作区输出，源内容不变", () => using(({ source, output, root, exp }) => {
  const before = readFileSync(join(source, "content/posts/fixed-id/index.md"));
  assert.throws(() => exportContent({ source, output: join(source, "snapshot"), includePrivate: true }), /全新目录/);
  exp();
  for (const marker of [".git/config", "config/_default/hugo.toml", "hugo.yaml", "config.toml", "config/_default/hugo.json"]) {
    const target = join(root, `target-${marker.replaceAll("/", "-")}`);
    put(target, marker, "fixture");
    assert.throws(() => importContent({ source: output, output: join(target, "review"), includePrivate: true }), /工作区/);
    assert.equal(fs.existsSync(join(target, "review")), false);
  }
  assert.throws(() => importContent({ source: output, output: join(output, "review"), includePrivate: true }), /全新目录/);
  assert.deepEqual(readFileSync(join(source, "content/posts/fixed-id/index.md")), before);
}));

test("内容传输：清单拒绝路径越界、隐藏文件、代码、设备名和不可移植名称", () => {
  for (const path of ["/content/x.md", "../x.md", "content/../../x.md", "content/./x.md", "content//x.md", "content/.env", "content/.hidden/x.md", "content/../x.md", "content/%2e%2e/x.md", "content/x\\y.md", "content/C:/x.md", "content/nul.md", "content/a./x.md", "content/x\n.md", "content/x\u202e.md", "static/admin/x.js", "assets/media/x.svg", "assets/media/x.gif", "data/unknown.yaml", "data/comments.yaml", "integrations/waline/config.local.json", "integrations/waline-server/.env.local", "integrations/waline-server/comments.dump", "content/x.html", "content/x.js"]) assert.throws(() => validatePath(path), Error, path);
  for (const path of ["content/posts/_index.md", "content/posts/固定-id/index.md", "assets/media/a-b.webp", "data/site.yaml"]) assert.equal(validatePath(path), path);
});

test("内容传输：版本、字段、数量、单文件/总量与重复路径都须先验证", () => using(({ output, exp }) => {
  exp();
  for (const change of [
    (m) => { m.version = 2; }, (m) => { m.includesPrivate = false; }, (m) => { m.createdAt = "bad"; },
    (m) => { m.unrecognized = true; }, (m) => { m.files = []; },
    (m) => { m.files[0].bytes = -1; }, (m) => { m.files[0].bytes = LIMITS.fileBytes + 1; },
    (m) => { m.files[0].sha256 = "bad"; }, (m) => { m.files[0].execute = "bad"; },
    (m) => { m.files.push(m.files[0]); },
    (m) => { m.files = Array.from({ length: LIMITS.files + 1 }, () => m.files[0]); },
    (m) => { m.files = Array.from({ length: 43 }, (_, i) => ({ path: `content/${i}.md`, bytes: LIMITS.fileBytes, sha256: "a".repeat(64) })); },
  ]) { const value = manifest(output); change(value); assert.throws(() => validateManifest(value)); }
  for (const paths of [["content/A/x.md", "content/a/y.md"], ["content/é.md", "content/e\u0301.md"], ["content/a.md", "content/a.md/x.md"]]) {
    const value = manifest(output); value.files = paths.map((path) => ({ path, bytes: 0, sha256: "a".repeat(64) }));
    assert.throws(() => validateManifest(value), /冲突|重复/);
  }
}));

test("内容传输：篡改/缺失/额外文件和超大清单拒绝，不能只信任 manifest", () => using(({ output, root, exp }) => {
  exp();
  const original = readFileSync(join(output, "manifest.json"));
  const path = "files/content/posts/fixed-id/index.md";
  put(output, path, "changed"); assert.throws(() => readSnapshot(output), /校验失败/);
  put(output, path, sourceText);
  rewrite(output, (m) => { m.files.find((f) => f.path.endsWith("index.md")).bytes++; });
  assert.throws(() => readSnapshot(output), /校验失败/); put(output, "manifest.json", original);
  put(output, "files/content/extra.md", "extra"); assert.throws(() => readSnapshot(output), /额外或缺失/);
  rmSync(join(output, "files/content/extra.md"));
  rmSync(join(output, path)); assert.throws(() => readSnapshot(output), /额外或缺失/); put(output, path, sourceText);
  put(output, "unexpected.txt", "extra"); assert.throws(() => readSnapshot(output), /根目录/); rmSync(join(output, "unexpected.txt"));
  put(output, "files/content/plugin.js", "extra"); assert.throws(() => readSnapshot(output), /白名单/); rmSync(join(output, "files/content/plugin.js"));
  truncateSync(join(output, "manifest.json"), LIMITS.manifestBytes + 1);
  assert.throws(() => readSnapshot(output), /体积上限/);
  assert.deepEqual(readdirSync(root).sort(), ["site", "snapshot"]);
}));

test("内容传输：源媒体隐私、文件大小、无效 UTF-8 和代码文件拦截", () => using(({ source, output, exp }) => {
  put(source, "content/posts/fixed-id/bad.jpg", jpegWithGps()); assert.throws(exp, /媒体检查失败/); rmSync(join(source, "content/posts/fixed-id/bad.jpg"));
  put(source, "content/posts/fixed-id/raw.heic", "not allowed"); assert.throws(exp, /白名单/); rmSync(join(source, "content/posts/fixed-id/raw.heic"));
  put(source, "content/binary.md", Buffer.from([0xff])); assert.throws(exp, /UTF-8/); rmSync(join(source, "content/binary.md"));
  put(source, "content/plugin.js", "not allowed"); assert.throws(exp, /白名单/); rmSync(join(source, "content/plugin.js"));
  put(source, "content/large.md", ""); truncateSync(join(source, "content/large.md"), LIMITS.fileBytes + 1); assert.throws(exp, /体积上限/);
  assert.equal(fs.existsSync(output), false);
}));

test("内容传输：重算清单也不能把含元数据图片当成安全文件导入", () => using(({ output, restored, exp }) => {
  exp();
  const path = "content/posts/fixed-id/photo.webp";
  const bytes = webpWithGps(); put(output, `files/${path}`, bytes);
  rewrite(output, (m) => { const entry = m.files.find((f) => f.path === path); entry.bytes = bytes.length; entry.sha256 = createHash("sha256").update(bytes).digest("hex"); });
  assert.throws(() => importContent({ source: output, output: restored, includePrivate: true }), /媒体检查失败/);
  assert.equal(fs.existsSync(restored), false);
}));

test("内容传输：拒绝根目录、父目录和文件的符号链接，不读取外部文件", { skip: process.platform === "win32" && "Windows symlink privilege differs" }, () => using(({ source, output, root, restored, exp }) => {
  put(root, "outside/private.md", "DO_NOT_READ");
  symlinkSync(join(root, "outside"), join(source, "content/linked"), "dir"); assert.throws(exp, /符号链接/); rmSync(join(source, "content/linked"));
  symlinkSync(join(root, "outside/private.md"), join(source, "content/private.md")); assert.throws(exp, /符号链接/); rmSync(join(source, "content/private.md"));
  symlinkSync(source, join(root, "source-link"), "dir"); assert.throws(() => exportContent({ source: join(root, "source-link"), output, includePrivate: true }), /符号链接/);
  exp();
  rmSync(join(output, "files/content/posts/fixed-id/index.md"));
  symlinkSync(join(root, "outside/private.md"), join(output, "files/content/posts/fixed-id/index.md"));
  assert.throws(() => importContent({ source: output, output: restored, includePrivate: true }), /符号链接/);
  assert.equal(fs.existsSync(restored), false);
  assert.equal(readFileSync(join(root, "outside/private.md"), "utf8"), "DO_NOT_READ");
}));

test("内容传输：比较只报告新增/相同/冲突，包含文件与目录及大小写冲突，不改目标", () => using(({ source, output, root, exp }) => {
  exp();
  const target = join(root, "other-site");
  put(target, "content/posts/fixed-id/index.md", "different");
  put(target, "content/关于.md/nested.md", "directory conflict");
  put(target, "assets/media/shared.png", clean.png());
  put(target, "data/site.yaml", readFileSync(join(source, "data/site.yaml")));
  put(target, "content/target-only.md", "keep");
  const before = files(target).map((path) => [path, readFileSync(join(target, path)).toString("base64")]);
  const report = inspectContent({ source: output, compare: target });
  const status = Object.fromEntries(report.comparison.map((file) => [file.path, file.status]));
  assert.equal(status["content/posts/fixed-id/index.md"], "conflict");
  assert.equal(status["content/关于.md"], "conflict");
  assert.equal(status["data/site.yaml"], "same");
  assert.equal(status["data/links.yaml"], "add");
  assert.equal(report.conflicts, 2);
  assert.equal(report.targetOnly, 2);
  assert.deepEqual(files(target).map((path) => [path, readFileSync(join(target, path)).toString("base64")]), before);
  rmSync(join(target, "content/posts"), { recursive: true });
  put(target, "content/Posts/fixed-id/another.md", "case conflict");
  assert.equal(inspectContent({ source: output, compare: target }).comparison.find((file) => file.path === "content/posts/fixed-id/index.md").status, "conflict");
}));

test("内容传输：比较识别空目录的文件占用和大小写冲突，不误报可新增", () => using(({ output, root, exp }) => {
  exp();
  const target = join(root, "empty-directory-target");
  for (const path of ["content/关于.md", "content/Posts/fixed-id", "data/site.yaml"]) mkdirSync(join(target, path), { recursive: true });
  const report = inspectContent({ source: output, compare: target });
  const status = Object.fromEntries(report.comparison.map((file) => [file.path, file.status]));
  assert.equal(status["content/关于.md"], "conflict");
  assert.equal(status["content/posts/fixed-id/index.md"], "conflict");
  assert.equal(status["content/posts/fixed-id/photo.webp"], "conflict");
  assert.equal(status["data/site.yaml"], "conflict");
  assert.equal(status["data/links.yaml"], "add");
  assert.equal(report.conflicts, 4);
  assert.equal(report.targetOnly, 0);
  assert.deepEqual(files(target), []);
  for (const path of ["content/关于.md", "content/Posts/fixed-id", "data/site.yaml"]) assert.ok(statSync(join(target, path)).isDirectory());
}));

test("内容传输：写入中途失败清理本次输出，源文件与既有目录不动", () => using(({ source, output, restored, exp }) => {
  exp();
  const original = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (path, ...args) => {
    if (String(path).startsWith(restored) && ++writes === 2) throw new Error("simulated disk failure");
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => importContent({ source: output, output: restored, includePrivate: true }), /simulated disk failure/); }
  finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
  assert.equal(fs.existsSync(restored), false);
  assert.equal(readFileSync(join(source, "content/posts/fixed-id/index.md"), "utf8"), sourceText);
  assert.equal(readSnapshot(output).manifest.files.length, 6);
}));

test("内容传输：清理失败必须同时报告原始错误和残留目录，不伪装成功", () => using(({ output, restored, exp }) => {
  exp();
  const originalWrite = fs.writeFileSync, originalRemove = fs.rmSync;
  fs.writeFileSync = (path, ...args) => {
    if (String(path).startsWith(restored)) throw new Error("write failed");
    return originalWrite(path, ...args);
  };
  fs.rmSync = (path, ...args) => {
    if (String(path) === restored) throw new Error("cleanup failed");
    return originalRemove(path, ...args);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => importContent({ source: output, output: restored, includePrivate: true }), /write failed.*cleanup failed.*人工检查/); }
  finally { fs.writeFileSync = originalWrite; fs.rmSync = originalRemove; syncBuiltinESMExports(); }
  assert.equal(fs.existsSync(restored), true);
  assert.equal(fs.existsSync(join(restored, "IMPORT-REPORT.json")), false);
}));

test("内容传输 CLI：帮助、参数拒绝、实际导出/检查/导入与比较冲突退出码", () => using(({ source, output, restored, root }) => {
  const script = fileURLToPath(new URL("../content-transfer.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.equal(run("--help").status, 0);
  for (const args of [["unknown"], ["export", "--source"], ["export", "--source", source, "--output", output], ["inspect", "--source", output, "--source", output], ["inspect", "--source", output, "--output", restored]]) assert.equal(run(...args).status, 1);
  assert.equal(run("export", "--source", source, "--output", output, "--include-private").status, 0);
  assert.equal(run("inspect", "--source", output, "--compare", source).status, 0);
  put(source, "data/site.yaml", "title: changed");
  assert.equal(run("inspect", "--source", output, "--compare", source).status, 2);
  assert.equal(run("import", "--source", output, "--output", restored, "--include-private").status, 0);
  assert.equal(run("import", "--source", output, "--output", restored, "--include-private").status, 1);
  assert.deepEqual(readdirSync(root).sort(), ["review", "site", "snapshot"]);
}));
