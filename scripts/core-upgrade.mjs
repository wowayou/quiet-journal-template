#!/usr/bin/env node
// Explicit core ownership, three-way upgrade preview, and conflict-free apply. No Git operations or network.
import { readFileSync, readdirSync, lstatSync, existsSync, writeFileSync, mkdirSync, unlinkSync, renameSync, openSync, writeSync, fsyncSync, closeSync, rmSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
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
// declared as its own. Everything is checked before the first write. New files are written to
// exclusively created temp files (never through an existing name or symlink), verified, then renamed
// over the target; rename replaces a symlinked target instead of following it. Removals only delete
// regular files still identical to the old baseline. The manifest is replaced last the same way, so
// an interrupted or failed run leaves the old manifest and can simply be re-run.
// Never touches content, data, media, personal styles or declared extensions.
export function applyUpgrade({ current, upstream, previous }) {
  const plan = previewUpgrade({ current, upstream, previous });
  const nextText = readFileSync(join(upstream, "core-manifest.json"));
  if (createHash("sha256").update(JSON.stringify(JSON.parse(nextText))).digest("hex") !== plan.nextFingerprint) throw new Error("发行清单在预览后改变，未做任何修改。");
  const next = JSON.parse(nextText);
  const blocked = plan.files.filter((entry) => entry.status === "conflict" || (entry.status === "protected" && previous.files[entry.path] !== next.files[entry.path]));
  if (blocked.length) throw new Error(`有 ${blocked.length} 个文件需要先人工合并，未做任何修改：${blocked.slice(0, 5).map((e) => e.path).join("、")}${blocked.length > 5 ? " 等" : ""}`);
  const root = resolve(current), done = { updated: [], removed: [] };
  // Every existing parent inside the instance must be a real directory (not a symlink).
  const checkParents = (path) => {
    let at = root;
    for (const part of path.split("/").slice(0, -1)) {
      at = join(at, part);
      if (existsSync(at) || isLink(at)) { const stat = lstatSync(at); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`目标目录不是普通目录，未做任何修改：${path}`); }
    }
    return join(root, path);
  };
  const manifestPath = checkParents("core-manifest.json");
  if (isLink(manifestPath) || (existsSync(manifestPath) && !lstatSync(manifestPath).isFile())) throw new Error("核心清单不是普通文件，未做任何修改。");
  const updates = plan.files.filter((entry) => entry.status === "update");
  const removals = plan.files.filter((entry) => entry.status === "remove" && entry.currentSHA256 !== undefined);
  for (const entry of [...updates, ...removals]) checkParents(entry.path);
  // Stage: write every new file to its own exclusive temp file and verify it before touching any target.
  const staged = [];
  const stage = (target, bytes) => {
    const temp = `${target}.qj-upgrade-${process.pid}-${randomBytes(6).toString("hex")}`;
    const fd = openSync(temp, "wx", 0o644); // O_CREAT|O_EXCL: fails instead of following an existing name.
    staged.push(temp);
    try { writeSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    return temp;
  };
  try {
    for (const entry of updates) {
      const target = join(root, entry.path), bytes = readFileSync(join(upstream, entry.path));
      if (createHash("sha256").update(bytes).digest("hex") !== next.files[entry.path]) throw new Error(`发行文件不匹配清单，未做任何修改：${entry.path}`);
      mkdirSync(dirname(target), { recursive: true });
      checkParents(entry.path); // Re-check after creating directories.
      const temp = stage(target, bytes);
      if (hash(temp) !== next.files[entry.path]) throw new Error(`暂存文件校验失败，未做任何修改：${entry.path}`);
      entry.temp = temp;
    }
    const manifestTemp = stage(manifestPath, JSON.stringify(next, null, 2) + "\n");
    // Commit: rename staged files into place, then remove dropped files, then the manifest last.
    for (const entry of updates) { renameSync(entry.temp, join(root, entry.path)); staged.splice(staged.indexOf(entry.temp), 1); done.updated.push(entry.path); }
    for (const entry of removals) {
      const target = join(root, entry.path);
      if (isLink(target) || !lstatSync(target).isFile() || hash(target) !== entry.currentSHA256) throw new Error(`待删除文件在应用期间改变：${entry.path}。清单未更新，请检查后重新运行。`);
      unlinkSync(target); done.removed.push(entry.path);
    }
    renameSync(manifestTemp, manifestPath); staged.splice(staged.indexOf(manifestTemp), 1);
  } finally {
    for (const temp of staged) rmSync(temp, { force: true }); // Only our own exclusive temp files.
  }
  const after = previewUpgrade({ current, upstream, previous: next });
  if (after.files.some((entry) => !["same", "protected"].includes(entry.status))) throw new Error("应用后复核不一致，请检查工作区（未提交、未部署）。");
  return { operation: "applied", from: plan.from, to: plan.to, updated: done.updated, removed: done.removed, notice: "只改受管核心文件与核心清单；未提交、未推送、未部署。请先运行测试和构建再提交。" };
}
function isLink(path) { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } }
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
