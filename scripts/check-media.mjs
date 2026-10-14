#!/usr/bin/env node
// check-media：发布前的媒体隐私检查（失败即关闭）。无第三方依赖，Node >= 18。
//
// 用法：
//   node scripts/check-media.mjs                 检查仓库源文件（content/ assets/ static/）
//   node scripts/check-media.mjs --public public 额外检查构建产物
//   node scripts/check-media.mjs --root <dir>    指定站点根目录
//
// 拒绝（FAIL，退出码 1）：
//   - 图片内含 EXIF / XMP / IPTC / 文本块 / 时间块（JPEG、PNG、WebP 逐块解析）
//   - 动图（GIF、动画 WebP/PNG）、HEIC/HEIF、AVIF、TIFF、视频（MOV/MP4 等）
//   - 扩展名与实际格式不符、无法识别的二进制、超过 25 MiB
//   - content/ 中的 SVG；含脚本或编辑器元数据的 SVG
// 提示（WARN）：文件名像相机原始命名或含日期/邮箱/中文、文件偏大。
//
// 说明：这里只检查「文件元数据」。照片画面里的门牌、车牌、人脸等无法自动检查。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024;
const HARD_LIMIT = 25 * MiB; // Cloudflare Pages 单文件上限
const SOFT_LIMIT = 1.5 * MiB;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const BLOCKED_EXT = new Set([
  ".gif", ".heic", ".heif", ".avif", ".tif", ".tiff", ".bmp", ".dng", ".raw", ".cr2", ".nef", ".arw",
  ".mov", ".mp4", ".m4v", ".3gp", ".avi", ".mkv", ".webm", ".livephoto",
]);
const TEXT_EXT = new Set([".md", ".markdown", ".yaml", ".yml", ".toml", ".json", ".txt", ".html", ".css", ".js", ".mjs", ".xml"]);
const FONT_EXT = new Set([".woff", ".woff2"]);

// ---------- 格式识别 ----------

export function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) return "gif";
  if (buf.length >= 4 && (buf.toString("ascii", 0, 4) === "II*\0" || buf.toString("ascii", 0, 4) === "MM\0*")) return "tiff";
  if (buf.length >= 2 && buf.toString("ascii", 0, 2) === "BM") return "bmp";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heif";
    if (/^(avif|avis)$/.test(brand)) return "avif";
    return "video"; // qt / isom / mp4x / M4V / 3gp…
  }
  return "unknown";
}

// 原始字节中出现这些签名即视为含元数据（与具体容器无关的兜底检查）
const SIGNATURES = [
  ["EXIF", Buffer.from("Exif\0\0", "latin1")],
  ["XMP", Buffer.from("http://ns.adobe.com/xap/1.0/", "latin1")],
  ["XMP", Buffer.from("<x:xmpmeta", "latin1")],
  ["IPTC/Photoshop", Buffer.from("Photoshop 3.0\0", "latin1")],
];

function scanSignatures(buf) {
  const found = [];
  for (const [name, sig] of SIGNATURES) if (buf.indexOf(sig) !== -1 && !found.includes(name)) found.push(name);
  return found;
}

// ---------- 逐格式解析 ----------

function inspectJpeg(buf) {
  const problems = [];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { problems.push(`JPEG 结构异常（偏移 ${i}）`); break; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd9) break; // EOI
    if (marker === 0xda) break; // SOS：之后是图像数据
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i + 4, i + 2 + len);
    if (marker >= 0xe0 && marker <= 0xef) {
      const id = seg.toString("latin1", 0, Math.min(seg.length, 32));
      const n = marker - 0xe0;
      if (n === 0 && /^JF(IF|XX)\0/.test(id)) { /* 正常 */ }
      else if (n === 2 && id.startsWith("ICC_PROFILE\0")) { /* 色彩配置，允许 */ }
      else if (n === 14 && id.startsWith("Adobe")) { /* 颜色变换标记，允许 */ }
      else if (n === 1 && id.startsWith("Exif\0")) problems.push("含 EXIF（APP1）");
      else if (n === 1 && id.includes("ns.adobe.com/xap")) problems.push("含 XMP（APP1）");
      else if (n === 13) problems.push("含 IPTC/Photoshop（APP13）");
      else if (n === 2 && id.startsWith("MPF\0")) problems.push("含 MPF 多图附加数据（APP2）");
      else problems.push(`含未知 APP${n} 段`);
    } else if (marker === 0xfe) {
      problems.push("含 JPEG 注释（COM）");
    }
    i += 2 + len;
  }
  // EOI 之后的附加数据（如动态照片的视频片段）
  const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (eoi !== -1 && buf.length - (eoi + 2) > 16) problems.push(`文件结尾后附加了 ${buf.length - eoi - 2} 字节数据`);
  return problems;
}

const PNG_OK = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "mDCV", "cLLI", "bKGD", "hIST", "pHYs", "sPLT"]);
function inspectPng(buf) {
  const problems = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    if (type === "eXIf") problems.push("含 EXIF（eXIf）");
    else if (type === "tEXt" || type === "zTXt" || type === "iTXt") problems.push(`含文本元数据（${type}）`);
    else if (type === "tIME") problems.push("含修改时间（tIME）");
    else if (type === "acTL" || type === "fcTL" || type === "fdAT") { problems.push("动画 PNG 不允许"); }
    else if (!PNG_OK.has(type)) problems.push(`含未知数据块 ${type}`);
    if (type === "IEND") break;
    i += 12 + len;
  }
  return [...new Set(problems)];
}

function inspectWebp(buf) {
  const problems = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const fourcc = buf.toString("latin1", i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    if (fourcc === "EXIF") problems.push("含 EXIF");
    else if (fourcc === "XMP ") problems.push("含 XMP");
    else if (fourcc === "ANIM" || fourcc === "ANMF") problems.push("动画 WebP 不允许");
    else if (!["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP"].includes(fourcc)) problems.push(`含未知数据块 ${fourcc.trim()}`);
    i += 8 + len + (len % 2);
  }
  return [...new Set(problems)];
}

function inspectSvg(text) {
  const problems = [];
  if (/<script[\s>]/i.test(text)) problems.push("SVG 含 <script>");
  if (/\son\w+\s*=/i.test(text)) problems.push("SVG 含事件处理属性");
  if (/<metadata[\s>]|xmlns:(sodipodi|inkscape|rdf|dc)=/i.test(text)) problems.push("SVG 含编辑器元数据");
  if (/(href|src)\s*=\s*["']\s*(https?:|data:)/i.test(text)) problems.push("SVG 引用外部或内嵌资源");
  return problems;
}

/** 检查单个文件的内容。返回 { format, problems[] }。 */
export function inspect(buf, name = "") {
  const ext = extname(name).toLowerCase();
  if (ext === ".svg") {
    return { format: "svg", problems: inspectSvg(buf.toString("utf8")) };
  }
  const format = sniff(buf);
  const problems = [];
  switch (format) {
    case "jpeg": problems.push(...inspectJpeg(buf)); break;
    case "png": problems.push(...inspectPng(buf)); break;
    case "webp": problems.push(...inspectWebp(buf)); break;
    case "gif": problems.push("GIF（可能为动图）不允许，请转为静态 WebP"); break;
    case "heif": problems.push("HEIC/HEIF 原图不允许（应在上传时转为 WebP）"); break;
    case "avif": problems.push("AVIF 暂不支持元数据检查"); break;
    case "tiff": case "bmp": problems.push(`${format.toUpperCase()} 不允许`); break;
    case "video": problems.push("视频文件不允许（第一版不支持视频）"); break;
    default: problems.push("无法识别的文件格式"); break;
  }
  if (["jpeg", "png", "webp"].includes(format)) {
    const expect = { ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp" }[ext];
    if (expect && expect !== format) problems.push(`扩展名 ${ext} 与实际格式 ${format} 不符`);
    if (!expect && ext) problems.push(`扩展名 ${ext} 与实际格式 ${format} 不符`);
    for (const s of scanSignatures(buf)) {
      if (!problems.some((p) => p.includes(s.split("/")[0]))) problems.push(`字节中发现 ${s} 签名`);
    }
  }
  return { format, problems };
}

export function filenameWarnings(name) {
  const base = basename(name);
  const w = [];
  if (/^(IMG|DSC|DSCF|DSCN|PXL|MVIMG|VID|P\d{3,}|Screenshot|截屏|微信图片|mmexport)[_\-\s]?\d*/i.test(base)) w.push("文件名像相机/手机原始命名");
  if (/(19|20)\d{2}[-_.]?(0[1-9]|1[0-2])[-_.]?([0-2]\d|3[01])[-_ T]?\d{0,6}/.test(base)) w.push("文件名含日期，可能暴露拍摄时间");
  if (/@/.test(base) || /\d{11}/.test(base)) w.push("文件名疑似含邮箱或手机号");
  if (/[^\x00-\x7f]/.test(base)) w.push("文件名含非 ASCII 字符（如中文地名/人名）");
  return w;
}

// ---------- 目录扫描 ----------

const SKIP_DIRS = new Set([".git", "node_modules", "public", "resources", ".hugo_build.lock"]);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

/**
 * 检查一个目录。area: "content" | "assets" | "static" | "public"
 * 返回 [{ file, level: "FAIL"|"WARN", messages[] }]
 */
export const stats = { files: 0, images: 0 };

export function checkDir(dir, area, root = dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const file of walk(dir)) {
    stats.files++;
    const rel = relative(root, file);
    const ext = extname(file).toLowerCase();
    const size = statSync(file).size;
    const fail = [];
    const warn = [];

    if (TEXT_EXT.has(ext) || ext === "") {
      const known = ["_headers", "_redirects", ".assetsignore"].includes(basename(file));
      if (ext === "" && !known && area !== "public") warn.push("没有扩展名的文件");
      if (size > HARD_LIMIT) fail.push("超过 25 MiB");
      if (fail.length || warn.length) results.push(...report(rel, fail, warn));
      continue;
    }
    if (FONT_EXT.has(ext) && area !== "content") continue;

    const isImage = IMAGE_EXT.has(ext) || ext === ".svg";
    if (!isImage && !BLOCKED_EXT.has(ext)) {
      // 不认识的文件类型：public 以外一律拒绝，避免夹带
      if (ext === ".ico" && area !== "content") continue;
      fail.push(`不允许的文件类型 ${ext}`);
      results.push(...report(rel, fail, warn));
      continue;
    }
    if (ext === ".svg" && area === "content") fail.push("文章中不允许上传 SVG（仅模板作者维护的图标可放在 static/ 或 assets/）");

    stats.images++;
    const { problems } = inspect(readFileSync(file), file);
    fail.push(...problems);
    if (size > HARD_LIMIT) fail.push("超过 25 MiB");
    else if (size > SOFT_LIMIT) warn.push(`文件较大（${(size / MiB).toFixed(1)} MiB）`);
    if (area !== "public") warn.push(...filenameWarnings(file));
    results.push(...report(rel, fail, warn));
  }
  return results;
}

function report(file, fail, warn) {
  const out = [];
  if (fail.length) out.push({ file, level: "FAIL", messages: fail });
  if (warn.length) out.push({ file, level: "WARN", messages: warn });
  return out;
}

// ---------- CLI ----------

function main(argv) {
  const args = { root: process.cwd(), public: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = resolve(argv[++i]);
    else if (argv[i] === "--public") args.public = resolve(argv[++i]);
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("用法：node scripts/check-media.mjs [--root 站点目录] [--public 构建产物目录]");
      return 0;
    } else {
      console.error(`未知参数：${argv[i]}`);
      return 2;
    }
  }
  const results = [];
  for (const area of ["content", "assets", "static"]) results.push(...checkDir(join(args.root, area), area, args.root));
  if (args.public) results.push(...checkDir(args.public, "public", args.root));

  for (const r of results) console.log(`${r.level}  ${r.file}\n      ${r.messages.join("\n      ")}`);
  const fails = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "WARN").length;
  console.log(`check-media：检查 ${stats.files} 个文件（图片 ${stats.images}），${fails} 个失败，${warns} 个提示${args.public ? "（含构建产物）" : ""}`);
  return fails ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
