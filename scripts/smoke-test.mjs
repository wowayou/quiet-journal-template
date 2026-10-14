#!/usr/bin/env node
// 端到端冒烟测试：复制站点到临时目录，注入测试内容，真实运行 Hugo 构建并检查产物。
// 不修改仓库本身。需要 hugo（可用环境变量 HUGO 指定路径）；有 exiftool 时额外做元数据交叉验证。
//
//   node scripts/smoke-test.mjs
//
// 覆盖：必需页面、草稿正文与草稿图片隔离、未引用图片不发布、未来日期文章不发布、
//       带 GPS 原图经 Hugo 输出后无元数据、源文件检查失败关闭、改标题不改 URL、
//       R2 provider 地址拼接、local provider 缺图时构建失败、无第三方脚本、img 有 alt/尺寸。

import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkDir } from "./check-media.mjs";
import { clean, jpegWithGps, webpWithGps, FAKE } from "./test/fixtures.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const HUGO = process.env.HUGO || "hugo";
const SKIP = new Set(["public", "resources", "node_modules", ".git", ".hugo_build.lock"]);

let passed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failures.push(name); console.log(`  ✖ ${name}${detail ? `\n      ${detail}` : ""}`); }
}

function write(root, rel, data) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

function hugo(root, extra = []) {
  rmSync(join(root, "public"), { recursive: true, force: true });
  return spawnSync(HUGO, ["--gc", "--minify", "--source", root, ...extra], { encoding: "utf8" });
}

function files(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : out.push(p); } };
  walk(dir);
  return out;
}

const post = (fm, body = "") => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${body}\n`;

// ---------- 准备临时站点 ----------
const root = mkdtempSync(join(tmpdir(), "qj-smoke-"));
cpSync(repo, root, { recursive: true, filter: (src) => !SKIP.has(relative(repo, src).split(/[\\/]/)[0]) });

// 草稿：正文标记 + 文章内图片 + 只被草稿引用的全站图片
write(root, "content/posts/20991231-drft/index.md", post(
  { title: "DRAFT_TITLE_MARKER", date: "2026-10-01T10:00:00+08:00", kind: "photo", draft: true },
  "DRAFT_BODY_MARKER\n\n![x](draft-secret-marker.webp)\n\n![y](/media/draft-only-marker.webp)",
));
write(root, "content/posts/20991231-drft/draft-secret-marker.webp", clean.webp());
write(root, "assets/media/draft-only-marker.webp", clean.webp());
// 未被任何文章引用的图片
write(root, "assets/media/orphan-marker.webp", clean.webp());
write(root, "content/posts/20261012-h5c1/unreferenced-marker.webp", clean.webp());
// 未来日期文章（buildFuture=false）
write(root, "content/posts/20991231-futr/index.md", post({ title: "FUTURE_MARKER", date: "2099-12-31T10:00:00+08:00", draft: false }, "FUTURE_MARKER"));
// 已发布文章引用带模拟 GPS 的原图（模拟「CMS 未能清除」的最坏情况）
write(root, "content/posts/20261001-gpst/index.md", post(
  { title: "GPS 测试", date: "2026-10-01T10:00:00+08:00", kind: "photo", draft: false },
  "![a](gps-test.jpg)\n\n![b](gps-test.webp)",
));
write(root, "content/posts/20261001-gpst/gps-test.jpg", jpegWithGps());
write(root, "content/posts/20261001-gpst/gps-test.webp", webpWithGps());

console.log(`临时站点：${root}`);

// ---------- 1. 源文件检查应失败关闭 ----------
console.log("\n[1] 源文件媒体检查");
{
  const r = checkDir(join(root, "content"), "content", root).filter((x) => x.level === "FAIL").map((x) => x.file);
  check("带 GPS 的源图被 check-media 拒绝", r.includes("content/posts/20261001-gpst/gps-test.jpg") && r.includes("content/posts/20261001-gpst/gps-test.webp"), r.join(", "));
  check("干净的示例图未被误报", !r.some((f) => f.includes("20261012-h5c1")), r.join(", "));
}

// ---------- 2. 生产构建 ----------
console.log("\n[2] 生产构建（local provider）");
const b = hugo(root);
check("hugo 构建成功", b.status === 0, b.stderr.trim());
if (b.status !== 0) finish();
const pub = join(root, "public");
const all = files(pub);
const rel = all.map((f) => relative(pub, f).replaceAll("\\", "/"));
const text = all.filter((f) => [".html", ".xml", ".css", ".js", ".txt"].includes(extname(f))).map((f) => [relative(pub, f), readFileSync(f, "utf8")]);

for (const p of ["index.html", "archive/index.html", "about/index.html", "links/index.html", "credits/index.html", "404.html", "index.xml", "posts/index.html",
  "posts/20261003-k3m9/index.html", "posts/20261008-p2w6/index.html", "posts/20261012-h5c1/index.html", "posts/20261010-s8q4/index.html", "posts/20261001-gpst/index.html"]) {
  check(`页面存在：/${p}`, rel.includes(p));
}

console.log("\n[3] 草稿与未发布内容隔离");
check("草稿文章目录不存在", !rel.some((f) => f.includes("20991231-drft")));
check("未来日期文章不存在", !rel.some((f) => f.includes("20991231-futr")));
for (const m of ["DRAFT_TITLE_MARKER", "DRAFT_BODY_MARKER", "FUTURE_MARKER", "20991231"]) {
  const hit = text.filter(([, t]) => t.includes(m)).map(([f]) => f);
  check(`产物中无 ${m}`, hit.length === 0, hit.join(", "));
}
const markerFiles = rel.filter((f) => /marker/i.test(f));
check("草稿图片、未引用图片均未发布（文件名含 marker 的 0 个）", markerFiles.length === 0, markerFiles.join(", "));
const originals = rel.filter((f) => /\.(webp|jpe?g|png)$/.test(f) && !/_hu_/.test(f));
check("文章原图不直接发布（只发布 Hugo 重新编码的版本）", originals.length === 0, originals.join(", "));

console.log("\n[4] 图片元数据");
const images = all.filter((f) => /\.(webp|jpe?g|png|gif|svg)$/i.test(f));
const gpsOut = rel.filter((f) => f.startsWith("posts/20261001-gpst/") && /\.webp$/.test(f));
check("GPS 测试图已输出为 WebP", gpsOut.length > 0 && gpsOut.every((f) => f.endsWith(".webp")), gpsOut.join(", "));
const pubFails = checkDir(pub, "public", root).filter((x) => x.level === "FAIL");
check(`check-media 检查 ${images.length} 个产物图片：无元数据`, pubFails.length === 0, pubFails.map((x) => `${x.file}: ${x.messages}`).join("; "));
const bin = all.filter((f) => /\.(webp|jpe?g|png)$/.test(f)).map((f) => readFileSync(f, "latin1")).join("");
check("产物字节中无模拟设备名/厂商", !bin.includes(FAKE.model) && !bin.includes(FAKE.make));
const et = spawnSync("exiftool", ["-j", "-a", "-G1", "-EXIF:all", "-XMP:all", "-IPTC:all", "-GPS:all", ...images.filter((f) => !f.endsWith(".svg"))], { encoding: "utf8" });
if (et.error) console.log("  - 未找到 exiftool，跳过交叉验证（未测试）");
else {
  const leaked = JSON.parse(et.stdout).filter((o) => Object.keys(o).some((k) => k !== "SourceFile"));
  check("exiftool 交叉验证：产物图片无 EXIF/XMP/IPTC/GPS", leaked.length === 0, JSON.stringify(leaked).slice(0, 300));
}

console.log("\n[5] 页面质量");
// /admin/ 是写作界面（只有作者本人打开，从 unpkg 加载固定版本的 CMS），不计入访客页面检查
const html = text.filter(([f]) => f.endsWith(".html") && !f.replaceAll("\\", "/").startsWith("admin/"));
const imgs = html.flatMap(([f, t]) => (t.match(/<img\b[^>]*>/g) || []).map((tag) => [f, tag]));
// minify 会把装饰性图片的 alt="" 压缩成裸属性 alt，仍是合法的空 alt
check(`所有 <img> 有 alt（${imgs.length} 个）`, imgs.every(([, t]) => /\salt(=|[\s>])/.test(t)));
check("所有本地 <img> 有 width/height", imgs.every(([, t]) => /\bwidth=/.test(t) && /\bheight=/.test(t)));
const ext = html.filter(([, t]) => /<(script|link)\b[^>]*(src|href)=["']?https?:\/\//i.test(t.replace(/<link[^>]*rel=["']?(canonical|alternate)[^>]*>/gi, "")));
check("访客页面无第三方脚本/样式", ext.length === 0, ext.map(([f]) => f).join(", "));
const referenced = new Set(text.flatMap(([, t]) => [...t.matchAll(/\/[^\s"'(),]+?\.(?:webp|svg|png|jpe?g)/g)].map((m) => m[0].replace(/^https?:\/\/[^/]+/, ""))));
const unref = rel.filter((f) => /\.(webp|png|jpe?g)$/.test(f) && ![...referenced].some((r) => r.endsWith("/" + f)));
check("每个发布的图片都被页面引用", unref.length === 0, unref.join(", "));
const rss = readFileSync(join(pub, "index.xml"), "utf8");
check("/admin/ 写作入口存在且固定版本、带 SRI", (() => { const a = readFileSync(join(pub, "admin/index.html"), "utf8"); return /@sveltia\/cms@\d+\.\d+\.\d+\//.test(a) && /integrity="sha384-/.test(a); })());
check("robots.txt 禁止抓取 /admin/", /Disallow: \/admin\//.test(readFileSync(join(pub, "robots.txt"), "utf8")));
check("CMS 配置未包含真实仓库名（模板占位）", readFileSync(join(pub, "admin/config.yml"), "utf8").includes("repo: OWNER/REPO") || process.env.QJ_INSTANCE === "1");
check("_headers 已输出", rel.includes("_headers"));
check("RSS 含 5 篇已发布文章", (rss.match(/<item>/g) || []).length === 5, `实际 ${(rss.match(/<item>/g) || []).length}`);

console.log("\n[5b] 页面结构与交互");
const page = (p) => readFileSync(join(pub, p), "utf8");
const home = page("index.html");
check("theme.js 同步加载、lightbox.js 延迟加载，均带 SRI", /<script[^>]+theme\.min\.[0-9a-f]+\.js[^>]+integrity=/.test(home) && /<script[^>]+lightbox\.min\.[0-9a-f]+\.js[^>]+integrity=[^>]+defer/.test(home));
check("首页：大标题、精选、最近、文章列表", /class="?hero"?/.test(home) && /id="?featured-title/.test(home) && (home.match(/class="?post-item"?/g) || []).length >= 5);
check("<html> 带强调色 data-accent=orange", /<html[^>]+data-accent="?orange/.test(home));
check("页头有菜单按钮（aria-controls 指向导航）", /aria-controls="?site-nav/.test(home));
check("页面中没有 id=top（回到顶部按规范滚到页首，不被吸顶页头吞掉）", !/id="?top"?[\s>]/.test(home) && /href="?#top"?/.test(home));
check("只发布 2 个拉丁字体分片", rel.filter((f) => f.endsWith(".woff2")).length === 2);
const ph = page("posts/20261012-h5c1/index.html");
const zooms = [...ph.matchAll(/<a class="?media__zoom"? href="?([^" >]+)/g)].map((m) => m[1]);
check("文章图片包放大链接，指向已发布的重新编码图片", zooms.length === 3 && zooms.every((h) => rel.includes(h.replace(/^\//, "")) && /_hu_/.test(h)), zooms.join(", "));
check("随笔（≥3 个小标题）有目录", /class="?toc"?/.test(page("posts/20261008-p2w6/index.html")));
const hdr = readFileSync(join(pub, "_headers"), "utf8");
check("_headers：访客页面 CSP 禁止第三方脚本", /\/\*\n\s+Content-Security-Policy: default-src 'self'; script-src 'self';/.test(hdr));
check("_headers：/admin/ 先移除全站 CSP 再设置 CMS 专用 CSP", /\/admin\/\*\n\s+! Content-Security-Policy\n\s+! Referrer-Policy\n\s+Content-Security-Policy:[^\n]*script-src 'self' https:\/\/unpkg\.com;[^\n]*https:\/\/api\.github\.com/.test(hdr));

check("图文文章有分享卡片图片（og:image，已重新编码）", /<meta property="?og:image"? content="?https?:\/\/[^" >]+_hu_[0-9a-f]+\.jpg/.test(ph));

console.log("\n[5c] 不绑定编辑器：删除 static/admin/ 仍可构建");
{
  const adm = join(root, "static/admin");
  const bak = join(root, ".admin-bak");
  cpSync(adm, bak, { recursive: true }); rmSync(adm, { recursive: true, force: true });
  const r = hugo(root);
  check("没有 CMS 时构建成功且页面完整", r.status === 0 && existsSync(join(root, "public/index.html")) && !existsSync(join(root, "public/admin")), r.stderr.trim());
  cpSync(bak, adm, { recursive: true }); rmSync(bak, { recursive: true, force: true });
}

console.log("\n[6] 改标题不改 URL");
{
  const f = join(root, "content/posts/20261008-p2w6/index.md");
  writeFileSync(f, readFileSync(f, "utf8").replace("title: 下雨天的书店", "title: 完全不同的新标题"));
  const r = hugo(root);
  const page = join(root, "public/posts/20261008-p2w6/index.html");
  check("改标题后 /posts/20261008-p2w6/ 仍存在且显示新标题", r.status === 0 && existsSync(page) && readFileSync(page, "utf8").includes("完全不同的新标题"));
}

console.log("\n[7] 媒体 provider");
write(root, "content/posts/20261002-r2ts/index.md", post(
  { title: "R2 测试", date: "2026-10-02T10:00:00+08:00", draft: false },
  "![a](r2-only.webp)\n\n![b](/media/r2-global.webp)\n\n![c](/media/rainy-street.webp)",
));
{
  const r = hugo(root);
  check("local：引用不存在的图片时构建失败", r.status !== 0 && /找不到图片/.test(r.stderr + r.stdout));
}
write(root, "config/r2test/hugo.toml", '[params.media]\n  provider = "r2"\n  [params.media.r2]\n    baseURL = "https://media.example.test/"\n    prefix = "/journal/"\n');
{
  const r = hugo(root, ["--environment", "r2test"]);
  check("r2：构建成功", r.status === 0, r.stderr.trim());
  const page = existsSync(join(root, "public/posts/20261002-r2ts/index.html")) ? readFileSync(join(root, "public/posts/20261002-r2ts/index.html"), "utf8") : "";
  check("r2：文章内图片 → <base>/<prefix>/posts/<id>/<文件>", page.includes("https://media.example.test/journal/posts/20261002-r2ts/r2-only.webp"));
  check("r2：全站图片 → <base>/<prefix>/media/<文件>", page.includes("https://media.example.test/journal/media/r2-global.webp"));
  check("r2：本地已有的图片仍走本地（旧链接不受影响）", /\/media\/rainy-street_hu_[^"\s]+\.webp/.test(page));
}

finish();

function finish() {
  rmSync(root, { recursive: true, force: true });
  console.log(`\n冒烟测试：${passed} 项通过，${failures.length} 项失败`);
  if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
  process.exit(failures.length ? 1 : 0);
}
