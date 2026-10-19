#!/usr/bin/env node
// Standalone static panel builder. Never runs Hugo, Git, a deployment, or a network request.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { dirname, join, resolve, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateConfig } from "./src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(readFileSync(join(here, "vendor-lock.json"), "utf8"));
const sources = ["index.html", "app.js", "config.js", "transport.js", "panel.css"];
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function panelHeaders(config) {
  return `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${config.apiOrigin}; img-src 'none'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors ${config.blogOrigin}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
  X-DNS-Prefetch-Control: off
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Cache-Control: public, max-age=0, must-revalidate, no-transform
/vendor/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable, no-transform
`;
}
export function buildPanel({ config, output, vendorDirectory = join(here, "node_modules/@waline/client") }) {
  config = validateConfig(config);
  if (!output) throw new Error("必须指定面板输出目录。");
  const absolute = resolve(output);
  const target = join(realpathSync(dirname(absolute)), basename(absolute));
  if (existsSync(target)) throw new Error("面板输出必须是全新目录；已有目录不覆盖。dist 是生成物，确认后可自行清理再构建。");
  if (inside(join(here, "src"), target) || inside(join(here, "node_modules"), target)) throw new Error("不能将面板产物放入源码或依赖目录。");
  for (let ancestor = dirname(target); ; ancestor = dirname(ancestor)) {
    if (existsSync(join(ancestor, "config/_default/hugo.toml")) && ["public", "static", "content", "assets"].some((dir) => inside(join(ancestor, dir), target))) throw new Error("评论面板必须独立部署，不能输出到博客的公开/内容/资源目录。");
    if (dirname(ancestor) === ancestor) break;
  }
  const pkg = JSON.parse(readFileSync(join(vendorDirectory, "package.json"), "utf8"));
  if (pkg.name !== lock.package || pkg.version !== lock.version) throw new Error("Waline 客户端版本不匹配；需要固定的 @waline/client 3.16.1。");
  const files = new Map(sources.map((name) => [name, readFileSync(join(here, "src", name))]));
  files.set("LICENSE-quiet-journal.txt", readFileSync(join(here, "LICENSE")));
  for (const [path, digest] of Object.entries(lock.files)) {
    const file = join(vendorDirectory, path);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 1048576) throw new Error(`客户端文件类型或大小异常：${path}`);
    const bytes = readFileSync(file);
    if (sha256(bytes) !== digest) throw new Error(`客户端完整性校验失败：${path}`);
    files.set(path === "LICENSE" ? "LICENSE-waline.txt" : `vendor/waline-${lock.version}.${path.endsWith(".css") ? "css" : "js"}`, bytes);
  }
  files.set("panel-config.json", JSON.stringify(config, null, 2) + "\n");
  files.set("_headers", panelHeaders(config));
  files.set("robots.txt", "User-agent: *\nDisallow: /\n");
  mkdirSync(target);
  try {
    for (const [path, bytes] of files) {
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), bytes, { flag: "wx" });
    }
  } catch (error) {
    try { rmSync(target, { recursive: true, force: true }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], `构建与清理失败，请检查不完整面板目录：${target}`); }
    throw error;
  }
  return { output: target, files: files.size, client: lock.version };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--config", "--output"].includes(args[i]) || options[args[i]] || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("用法：node build.mjs [--config config.local.json] [--output dist]；仅本地构建。");
      options[args[i]] = args[i + 1];
    }
    const config = JSON.parse(readFileSync(resolve(options["--config"] || join(here, "config.local.json")), "utf8"));
    console.log(JSON.stringify(buildPanel({ config, output: options["--output"] || join(here, "dist") }), null, 2));
  } catch (error) { console.error(`comments-panel：${error.message}`); process.exitCode = 1; }
}
