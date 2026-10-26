#!/usr/bin/env node
// Explicit core ownership, three-way upgrade preview, and conflict-free apply. No Git operations or network.
import { readFileSync, readdirSync, lstatSync, existsSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const GENERATED = new Set(["static/admin/config.yml"]);
const INTEGRATION_INPUTS = new Set([
  "integrations/waline/config.local.json", "integrations/waline-server/.env",
]);
const CORE_DOTFILES = new Set([".gitignore", ".vercelignore", ".env.example"]);
const CORE_CONFIG = new Set(['frontmatter', 'markup', 'cascade', 'permalinks', 'module', 'outputs', 'pagination'].map(name => `config/_default/${name}.toml`));
export function ownership(path, extensions = new Set()) {
  if (extensions.has(path) || path.startsWith('config/') && !CORE_CONFIG.has(path)) return "instance";
  if (GENERATED.has(path) || /(?:^|\/)core-manifest\.json$/.test(path) || /^(public|resources|node_modules|\.git|\.wrangler)\//.test(path) || /^integrations\/[^/]+\/(?:dist|coverage|node_modules|\.vercel)\//.test(path)) return "generated";
  if (INTEGRATION_INPUTS.has(path) || /^integrations\/[^/]+\/(?:.*\/)?(?:\.env(?:\.(?!example$)[^/]+)?|[^/]+\.(?:local(?:\.json)?|dump|backup|sql\.gz|pem|key))$/.test(path)) return "instance";
  if (path === 'data/widget_types.yaml') return 'core';
  if (/^(content|data|assets\/media)\//.test(path) || ["assets/css/overrides.css", "assets/js/custom.js", "config/_default/hugo.toml", "config/_default/params.toml", "wrangler.jsonc", "README.md"].includes(path) || path.startsWith("layouts/_partials/extensions/")) return "instance";
  if (/^(layouts|assets|scripts|docs|integrations|config)\//.test(path) || ["package.json", "package-lock.json", "LICENSE", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", ".gitignore"].includes(path) || path.startsWith("static/")) return "core";
  return "instance";
}
function declaredExtensions(root) {
  const load = (path) => {
    const file = join(root, path);
    if (!existsSync(file)) return {};
    let current = resolve(root);
    for (const part of path.split('/')) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error(`扩展声明不能经过符号链接：${path}`);
    }
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error(`扩展声明必须是有限大小的普通文件：${path}`);
    const doc = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true, schema: 'core' });
    if (doc.errors.length) throw new Error(`扩展声明无效：${path}`);
    const data = doc.toJS({ maxAliasCount: 50 }) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`扩展声明必须是映射：${path}`);
    return data;
  };
  const builtins = load('data/widget_types.yaml'), definitions = load('data/widget_extensions.yaml');
  const fields = { partial: ['layouts/_partials/', '.html'], style: ['assets/', '.css'], script: ['assets/', '.js'] };
  const builtinPaths = new Set(Object.values(builtins).flatMap(definition => Object.entries(fields).flatMap(([key, [prefix]]) => definition?.[key] ? [prefix + definition[key]] : [])));
  const paths = new Set();
  for (const [name, definition] of Object.entries(definitions)) {
    if (Object.hasOwn(builtins, name) || !definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error(`个人扩展类型无效或与核心重复：${name}`);
    for (const [key, [prefix, extension]] of Object.entries(fields)) {
      const path = definition[key];
      if (path === undefined) continue;
      if (typeof path !== 'string' || path.length > 512 || !/^[A-Za-z0-9_./-]+$/.test(path) || !path.endsWith(extension) || path.split('/').some(part => !part || part.startsWith('.'))) throw new Error(`个人扩展 ${name}.${key} 路径无效。`);
      const fullPath = prefix + path;
      if (builtinPaths.has(fullPath)) throw new Error(`个人扩展不能把内建源码声明为实例文件：${fullPath}`);
      paths.add(fullPath);
    }
  }
  return paths;
}
function walk(root, path = "", extensions = new Set()) {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) => {
    const p = path ? `${path}/${entry.name}` : entry.name;
    if ([".git", "node_modules", "public", "resources", ".wrangler", ".vercel", "coverage", "dist"].includes(entry.name) || entry.name.startsWith(".") && path.startsWith("integrations/") && !CORE_DOTFILES.has(entry.name)) return [];
    if (/^(content|assets\/media)$/.test(p)) return [];
    const coreWidgetTypes = join(root,'data/widget_types.yaml');
    if (p === 'data') {
      if (!existsSync(coreWidgetTypes)) return [];
      const stat = lstatSync(coreWidgetTypes);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('核心挂件白名单必须是普通文件。');
      return ['data/widget_types.yaml'];
    }
    if (entry.isSymbolicLink()) throw new Error(`核心源码不能含符号链接：${p}`);
    return entry.isDirectory() ? walk(root, p, extensions) : ownership(p, extensions) === "core" ? [p] : [];
  });
}
export function coreManifest(root, version) {
  if (!/^[a-zA-Z0-9][\w.-]{0,63}$/.test(version)) throw new Error("核心版本必须是明确发行标识。");
  const extensions = declaredExtensions(root);
  return { format: "quiet-journal-core", version, files: Object.fromEntries(walk(root, '', extensions).sort().map((path) => [path, hash(join(root, path))])) };
}
function validate(manifest) {
  if (manifest?.format !== "quiet-journal-core" || !/^[a-zA-Z0-9][\w.-]{0,63}$/.test(manifest.version || "") || !manifest.files || Array.isArray(manifest.files) || Object.keys(manifest.files).length > 10000) throw new Error("核心清单格式错误。");
  for (const [path, value] of Object.entries(manifest.files)) {
    const parts = path.split('/');
    if (parts.some(part=>!part||part==='.'||part==='..') || path.includes("..") || /[\\\x00-\x1f]/.test(path) || path.startsWith("/") || ownership(path) !== "core" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`无效核心路径/哈希：${path}`);
  }
  return manifest;
}
export function previewUpgrade({ current, upstream, previous }) {
  const before = validate(previous), next = validate(JSON.parse(readFileSync(join(upstream, "core-manifest.json"), "utf8")));
  const extensions = declaredExtensions(current);
  const readCore = (root, path) => {
    let current = resolve(root); const parts = path.split('/');
    for (const [index, part] of parts.entries()) {
      current = join(current, part); const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error(`核心文件不是普通文件：${path}`);
    }
    return hash(current);
  };
  const previousFingerprint = createHash('sha256').update(JSON.stringify(before)).digest('hex');
  const nextFingerprint = createHash('sha256').update(JSON.stringify(next)).digest('hex');
  const result = [];
  for (const path of new Set([...Object.keys(before.files), ...Object.keys(next.files)])) {
    const file = join(current, path), remote = join(upstream, path);
    if (next.files[path] && (!existsSync(remote) || readCore(upstream, path) !== next.files[path])) throw new Error(`发行文件不匹配清单：${path}`);
    const local = existsSync(file) ? readCore(current, path) : undefined;
    const status = extensions.has(path) ? "protected" : local === next.files[path] ? "same" : local !== before.files[path] ? "conflict" : next.files[path] ? "update" : "remove";
    result.push({ path, status, currentSHA256: local });
  }
  for (const entry of result) {
    const file = join(current, entry.path);
    const initial = entry.currentSHA256;
    if ((existsSync(file) ? readCore(current, entry.path) : undefined) !== initial) throw new Error('比较期间实例核心改变，请重新预览。');
    if (next.files[entry.path] && readCore(upstream, entry.path) !== next.files[entry.path]) throw new Error('比较期间发行核心改变，请重新预览。');
  }
  if (JSON.stringify([...declaredExtensions(current)].sort()) !== JSON.stringify([...extensions].sort())) throw new Error('比较期间个人扩展声明改变，请重新预览。');
  if (createHash('sha256').update(JSON.stringify(JSON.parse(readFileSync(join(upstream,'core-manifest.json'),'utf8')))).digest('hex') !== nextFingerprint) throw new Error('发行清单在比较期间改变。');
  return { operation: "preview-only", previousFingerprint, nextFingerprint, from: before.version, to: next.version, files: result, conflicts: result.filter((e) => e.status === "conflict").length, notice: "仅比较受管核心，不应用、删除、提交或部署。实例文件保持不变。" };
}
// Apply only when the preview is clean: no conflicts, and no core change on a path the instance
// declared as its own. Copies update/add files, removes core files the release dropped (only when
// still identical to the old baseline), then writes the new manifest last so an interrupted run
// is simply re-run. Never touches content, data, media, personal styles or declared extensions.
export function applyUpgrade({ current, upstream, previous }) {
  const plan = previewUpgrade({ current, upstream, previous });
  const blocked = plan.files.filter((entry) => entry.status === "conflict" || (entry.status === "protected" && previous.files[entry.path] !== JSON.parse(readFileSync(join(upstream, "core-manifest.json"), "utf8")).files[entry.path]));
  if (blocked.length) throw new Error(`有 ${blocked.length} 个文件需要先人工合并，未做任何修改：${blocked.slice(0, 5).map((e) => e.path).join("、")}${blocked.length > 5 ? " 等" : ""}`);
  const next = JSON.parse(readFileSync(join(upstream, "core-manifest.json"), "utf8"));
  const root = resolve(current), done = { updated: [], removed: [] };
  const safeTarget = (path) => {
    // Refuse to write through a symlinked or non-directory parent inside the instance.
    let at = root;
    for (const part of path.split("/").slice(0, -1)) {
      at = join(at, part);
      if (existsSync(at)) { const stat = lstatSync(at); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`目标目录不是普通目录：${path}`); }
    }
    return join(root, path);
  };
  for (const entry of plan.files) {
    if (entry.status === "update") {
      const target = safeTarget(entry.path), temp = `${target}.qj-upgrade`;
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(upstream, entry.path), temp); renameSync(temp, target);
      if (hash(target) !== next.files[entry.path]) throw new Error(`写入后校验失败：${entry.path}`);
      done.updated.push(entry.path);
    } else if (entry.status === "remove" && entry.currentSHA256 !== undefined) {
      unlinkSync(safeTarget(entry.path)); done.removed.push(entry.path);
    }
  }
  writeFileSync(join(root, "core-manifest.json"), JSON.stringify(next, null, 2) + "\n");
  const after = previewUpgrade({ current, upstream, previous: next });
  if (after.files.some((entry) => !["same", "protected"].includes(entry.status))) throw new Error("应用后复核不一致，请检查工作区（未提交、未部署）。");
  return { operation: "applied", from: plan.from, to: plan.to, updated: done.updated, removed: done.removed, notice: "只改受管核心文件与核心清单；未提交、未推送、未部署。请先运行测试和构建再提交。" };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "manifest" && args.length === 1) {
      if (existsSync("core-manifest.json")) throw new Error("已有核心清单；更新发行版本时请显式审查后重新生成，不自动覆盖。");
      writeFileSync("core-manifest.json", JSON.stringify(coreManifest(".", args[0]), null, 2) + "\n", { flag: "wx" });
    } else if (command === "preview" && args.length === 2) console.log(JSON.stringify(previewUpgrade({ current: ".", upstream: resolve(args[0]), previous: JSON.parse(readFileSync(args[1], "utf8")) }), null, 2));
    else if (command === "apply" && args.length >= 1 && args.length <= 2) {
      // The instance's own core-manifest.json is the old baseline by default; read it before it is replaced.
      const previous = JSON.parse(readFileSync(args[1] ?? "core-manifest.json", "utf8"));
      const result = applyUpgrade({ current: ".", upstream: resolve(args[0]), previous });
      console.log(`核心 ${result.from} → ${result.to}：更新 ${result.updated.length} 个、删除 ${result.removed.length} 个文件。${result.notice}`);
      for (const path of result.updated) console.log(`  更新 ${path}`);
      for (const path of result.removed) console.log(`  删除 ${path}`);
    }
    else throw new Error("用法：node scripts/core-upgrade.mjs manifest <固定版本> | preview <新核心目录> <旧核心清单> | apply <新核心目录> [旧核心清单]");
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
