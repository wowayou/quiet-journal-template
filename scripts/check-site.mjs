#!/usr/bin/env node
// Check generated files offline. No network crawler or API calls in the build.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDir } from "./check-media.mjs";

export function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, code) => {
    if (code[0] !== "#") return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[code.toLowerCase()];
    const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return value <= 0x10ffff ? String.fromCodePoint(value) : match;
  });
}

// This is an output checker, not an HTML sanitizer. Input is Hugo's generated HTML.
export function tags(html) {
  return [...html.matchAll(/<([a-z][a-z\d:-]*)(?:"[^"]*"|'[^']*'|[^'">])*?>/gi)].map(([raw, name]) => {
    const attrs = Object.create(null);
    const inner = raw.slice(name.length + 1, -1);
    for (const match of inner.matchAll(/([^\s=\/<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    return { name: name.toLowerCase(), attrs };
  });
}

export function validTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

export function checkedURL(value, base) {
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value) || value.startsWith("//")) throw new Error("空链接、空白/控制字符或协议相对链接");
  const url = new URL(value, base);
  if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol) || url.username || url.password) throw new Error("不安全的协议或带凭证网址");
  return url;
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}

export function checkSite(destination) {
  const root = resolve(destination);
  const failures = [];
  const fail = (file, message) => failures.push(`${relative(root, file)}: ${message}`);
  const homeFile = join(root, "index.html");
  if (!existsSync(homeFile)) return ["缺少 public/index.html；先运行 Hugo 构建。"];
  const home = tags(readFileSync(homeFile, "utf8"));
  const base = home.find((tag) => tag.name === "link" && tag.attrs.rel === "canonical")?.attrs.href;
  if (!base) return ["首页缺少 canonical，无法检查站内地址。"];
  const siteURL = new URL(base);
  const basePath = siteURL.pathname.replace(/\/$/, "");
  const all = files(root);
  const htmlFiles = all.filter((file) => file.endsWith(".html") && !relative(root, file).startsWith(`admin${sep}`));
  const parsed = new Map(htmlFiles.map((file) => [file, tags(readFileSync(file, "utf8"))]));

  function localTarget(url) {
    const pathname = decodeURIComponent(url.pathname);
    if (basePath && !pathname.startsWith(`${basePath}/`) && pathname !== basePath) return null;
    const path = pathname.slice(basePath.length).replace(/^\/+/, "");
    const candidates = [join(root, path), join(root, path, "index.html"), join(root, `${path}.html`)];
    return candidates.find((candidate) => candidate.startsWith(`${root}${sep}`) && existsSync(candidate) && statSync(candidate).isFile());
  }

  for (const [file, elements] of parsed) {
    const html = readFileSync(file, "utf8");
    if (html.includes("ZgotmplZ")) fail(file, "Hugo 拒绝了不安全的模板值（ZgotmplZ）");
    const canonical = elements.find((t) => t.name === "link" && t.attrs.rel === "canonical")?.attrs.href;
    const documentURL = canonical || new URL(relative(root, file).replaceAll(sep, "/"), siteURL).href;
    const ids = elements.map((t) => t.attrs.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) fail(file, "重复的 HTML id（检查挂件 ID 或标题锚点）");
    for (const { name, attrs } of elements) {
      if (name === "time" && !validTimestamp(attrs.datetime || "")) fail(file, `time 缺少带时区的完整时间：${attrs.datetime}`);
      if (name === "meta" && ["article:published_time", "article:modified_time"].includes(attrs.property) && !validTimestamp(attrs.content)) fail(file, `无效 ${attrs.property}`);
      if (name === "a" && attrs.target === "_blank" && !["noopener", "noreferrer"].every((value) => (attrs.rel || "").split(/\s+/).includes(value))) fail(file, "新标签页链接缺少 noopener/noreferrer");
      if (name === "img" && (!("alt" in attrs) || !(Number(attrs.width) > 0 && Number(attrs.height) > 0))) {
        if (!/^https?:\/\//.test(attrs.src || "")) fail(file, "本地图片缺少 alt 或尺寸");
      }
      const value = ["a", "link"].includes(name) ? attrs.href : ["img", "script"].includes(name) ? attrs.src : name === "meta" && ["og:image", "twitter:image"].includes(attrs.property || attrs.name) ? attrs.content : undefined;
      if (value === undefined) continue;
      let url;
      try { url = checkedURL(value, documentURL); } catch (error) { fail(file, `无效地址 ${JSON.stringify(value)}：${error.message}`); continue; }
      if (url.origin !== siteURL.origin || !["http:", "https:"].includes(url.protocol)) continue;
      let target;
      try { target = localTarget(url); } catch { fail(file, `无法解码地址 ${value}`); continue; }
      if (!target) { fail(file, `站内目标不存在：${value}`); continue; }
      if (name === "a" && url.hash && url.hash !== "#top" && parsed.has(target)) {
        let id;
        try { id = decodeURIComponent(url.hash.slice(1)); } catch { fail(file, `无效锚点：${value}`); continue; }
        if (!parsed.get(target).some((t) => t.attrs.id === id || (t.name === "a" && t.attrs.name === id))) fail(file, `站内锚点不存在：${value}`);
      }
    }
    for (const [, attrs, content] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/type=["']?application\/ld\+json/.test(attrs)) continue;
      try {
        const data = JSON.parse(content);
        for (const key of ["datePublished", "dateModified"]) if (data[key] && !validTimestamp(data[key])) fail(file, `JSON-LD ${key} 无效`);
        if (data.datePublished && data.dateModified && Date.parse(data.dateModified) < Date.parse(data.datePublished)) fail(file, "JSON-LD 更新时间早于发布");
      } catch { fail(file, "JSON-LD 不是有效 JSON"); }
    }
  }
  for (const result of checkDir(root, "public", root).filter((item) => item.level === "FAIL")) failures.push(`${result.file}: ${result.messages.join("；")}`);
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkSite(process.argv[2] || "public");
  for (const error of errors) console.error(`FAIL ${error}`);
  console.log(`check-site：站内链接/锚点、时间格式、新标签安全属性和产物媒体，${errors.length} 个失败（不请求外部网站）`);
  process.exitCode = errors.length ? 1 : 0;
}
