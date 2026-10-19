#!/usr/bin/env node
// Offline, bounded content transfer. Never runs Git/Hugo, fetches URLs, or writes into a site.
import {
  constants, openSync, closeSync, fstatSync, readSync, lstatSync, readdirSync,
  realpathSync, mkdirSync, writeFileSync, rmSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { inspect } from "./check-media.mjs";

export const LIMITS = Object.freeze({ files: 10000, fileBytes: 25 * 1024 ** 2, totalBytes: 1024 ** 3, manifestBytes: 4 * 1024 ** 2, depth: 16 });
const FORMAT = "quiet-journal-content";
const DATA_FILES = ["data/site.yaml", "data/links.yaml", "data/widgets.yaml", "data/answers.yaml"];
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true });
const fail = (message) => { throw new Error(message); };
const portableKey = (path) => path.normalize("NFC").toLowerCase();
const inside = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`);

function statIfPresent(path) {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
function rootDirectory(path) {
  const root = resolve(path);
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("源/比较目标必须是普通目录，不能是符号链接。");
  return realpathSync(root);
}

export function validatePath(path) {
  if (typeof path !== "string" || !path || Buffer.byteLength(path) > 1024 || /[\\<>:"|?*%\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(path)) fail(`不安全或不可移植的路径：${JSON.stringify(path)}`);
  const parts = path.split("/");
  if (parts.length > LIMITS.depth || parts.some((part) => !part || part.startsWith(".") || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail(`不安全或不可移植的路径：${JSON.stringify(path)}`);
  const ext = extname(path).toLowerCase();
  const allowed = DATA_FILES.includes(path)
    || (path.startsWith("content/") && (ext === ".md" || IMAGE_EXTENSIONS.has(ext)))
    || (path.startsWith("assets/media/") && IMAGE_EXTENSIONS.has(ext));
  if (!allowed) fail(`不在内容传输白名单：${path}`);
  return path;
}

function validatePaths(paths) {
  const prefixes = new Map();
  for (const path of paths) {
    validatePath(path);
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const key = portableKey(prefix);
      const directory = i < parts.length;
      const previous = prefixes.get(key);
      if (previous && (previous.path !== prefix || previous.directory !== directory || !directory)) fail(`重复或大小写/Unicode/目录冲突：${path}`);
      prefixes.set(key, { path: prefix, directory });
    }
  }
  return prefixes;
}

// Check ancestors too: a valid-looking file must not be reached through a symlink directory.
function checkedFile(root, path) {
  let current = root;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) fail(`拒绝符号链接或非普通文件：${path}`);
  }
  return current;
}

// A file that grows while being read cannot cause an unbounded allocation.
function readBounded(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limit) fail(`文件不是普通文件或超过体积上限：${basename(path)}`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!read) fail(`读取期间文件改变：${basename(path)}`);
      offset += read;
    }
    const extra = readSync(fd, Buffer.alloc(1), 0, 1, null);
    const after = fstatSync(fd);
    if (extra || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail(`读取期间文件改变：${basename(path)}`);
    return bytes;
  } finally { closeSync(fd); }
}

function scan(root, starts, directoryPaths) {
  const paths = [];
  let directories = 0;
  function visit(path, depth) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`拒绝符号链接：${path}`);
    if (stat.isDirectory()) {
      if (depth > LIMITS.depth || ++directories > LIMITS.files * 2) fail("目录层级或数量超过传输上限。");
      directoryPaths?.push(path);
      for (const entry of readdirSync(absolute)) visit(path ? `${path}/${entry}` : entry, depth + 1);
    } else if (stat.isFile()) {
      if (paths.length >= LIMITS.files) fail("文件数量超过传输上限。");
      paths.push(path);
    } else fail(`拒绝非普通文件：${path}`);
  }
  for (const path of starts) visit(path, 0);
  paths.sort();
  validatePaths(paths);
  return paths;
}

function sourcePaths(root, directoryPaths) {
  const content = statIfPresent(join(root, "content"));
  if (!content?.isDirectory() || content.isSymbolicLink()) fail("源目录缺少普通 content/ 目录。");
  const starts = ["content"];
  // Validate the intermediate assets directory even if only media is selected.
  const assets = statIfPresent(join(root, "assets"));
  if (assets && (assets.isSymbolicLink() || !assets.isDirectory())) fail("assets 不能是符号链接或文件。");
  if (statIfPresent(join(root, "assets/media"))) starts.push("assets/media");
  const data = statIfPresent(join(root, "data"));
  if (data && (data.isSymbolicLink() || !data.isDirectory())) fail("data 不能是符号链接或文件。");
  for (const path of DATA_FILES) if (statIfPresent(join(root, path))) starts.push(path);
  return scan(root, starts, directoryPaths);
}

function contentBytes(root, path) {
  const bytes = readBounded(checkedFile(root, path), LIMITS.fileBytes);
  if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
    const result = inspect(bytes, path);
    if (result.problems.length) fail(`${path}：媒体检查失败（${result.problems.join("；")}）`);
  } else {
    try { utf8.decode(bytes); } catch { fail(`${path}：文本不是有效 UTF-8。`); }
  }
  return bytes;
}

function entriesFor(root, paths) {
  let total = 0;
  const files = paths.map((path) => {
    const bytes = contentBytes(root, path);
    total += bytes.length;
    if (total > LIMITS.totalBytes) fail("内容总量超过 1 GiB 上限，请分批处理或另行规划迁移。");
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  if (!files.length) fail("没有可传输的内容文件。");
  return files;
}

function requirePrivateConsent(consent) {
  if (consent !== true) fail("内容含草稿、未引用图片及个人设置；确认不会公开上传后，显式添加 --include-private。");
}

function newOutput(path, sourceRoot) {
  const absolute = resolve(path);
  const parent = realpathSync(dirname(absolute)); // Parent must exist; never create a path implicitly.
  const output = join(parent, basename(absolute));
  if (inside(sourceRoot, output) || statIfPresent(output)) fail("输出必须是源目录之外的全新目录；既有目录（包括空目录）一律不覆盖。");
  let ancestor = parent;
  while (true) {
    if ([".git", "hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json", "config.toml", "config.yaml", "config.yml", "config.json", "config/_default/hugo.toml", "config/_default/hugo.yaml", "config/_default/hugo.yml", "config/_default/hugo.json"].some((name) => statIfPresent(join(ancestor, name)))) fail("输出不能放在 Git/Hugo 工作区内，尤其不能放到 public/、static/ 或 content/。");
    const next = dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  return output;
}

function createOutput(output, populate) {
  mkdirSync(output, { mode: 0o700 }); // Atomic no-clobber check, including concurrent invocations.
  try { return populate(); }
  catch (error) {
    try { rmSync(output, { recursive: true, force: true }); }
    catch (cleanupError) { throw new Error(`操作失败：${error.message}；清理也失败：${cleanupError.message}。不完整目录需人工检查：${output}`, { cause: error }); }
    throw error;
  }
}

function writeNew(root, path, bytes) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
}

function verifiedCopy(source, output, files, prefix = "") {
  for (const entry of files) {
    const bytes = contentBytes(source, entry.path);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail(`源文件已改变或校验失败：${entry.path}。请暂停编辑后重新操作。`);
    writeNew(output, `${prefix}${entry.path}`, bytes);
  }
}

const summary = (files) => ({ files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), includesPrivate: true });

export function exportContent({ source, output, includePrivate = false }) {
  requirePrivateConsent(includePrivate);
  const root = rootDirectory(source);
  const target = newOutput(output, root);
  const files = entriesFor(root, sourcePaths(root));
  const manifest = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), includesPrivate: true, files };
  const json = JSON.stringify(manifest, null, 2) + "\n";
  if (Buffer.byteLength(json) > LIMITS.manifestBytes) fail("清单超过 4 MiB 上限。");
  return createOutput(target, () => {
    verifiedCopy(root, target, files, "files/");
    // Detect additions, deletions and changes made while the snapshot was being copied.
    if (JSON.stringify(entriesFor(root, sourcePaths(root))) !== JSON.stringify(files)) fail("导出期间源目录改变；已取消，请暂停编辑后重试。");
    writeNew(target, "manifest.json", json); // Completeness marker is written last.
    return { operation: "export", output: target, ...summary(files) };
  });
}

export function validateManifest(manifest) {
  if (!manifest || Array.isArray(manifest) || manifest.format !== FORMAT || manifest.version !== 1 || manifest.includesPrivate !== true) fail("不支持的内容包格式/版本或缺少私有内容声明。");
  if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) fail("内容包缺少有效的创建时间。");
  if (Object.keys(manifest).some((key) => !["format", "version", "createdAt", "includesPrivate", "files"].includes(key))) fail("内容清单包含未知字段。");
  const { files } = manifest;
  if (!Array.isArray(files) || !files.length || files.length > LIMITS.files) fail("内容包文件数量无效或超过上限。");
  let total = 0;
  for (const entry of files) {
    if (!entry || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "bytes,path,sha256" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > LIMITS.fileBytes || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail("文件清单中的大小、校验值或字段无效。");
    total += entry.bytes;
    if (total > LIMITS.totalBytes) fail("内容总量超过 1 GiB 上限。");
  }
  validatePaths(files.map((file) => file.path));
  return manifest;
}

export function readSnapshot(source) {
  const root = rootDirectory(source);
  if (readdirSync(root).sort().join(",") !== "files,manifest.json") fail("内容包根目录只能包含 manifest.json 和 files/，不能夹带其他文件。");
  const manifest = validateManifest(JSON.parse(utf8.decode(readBounded(checkedFile(root, "manifest.json"), LIMITS.manifestBytes))));
  const payload = join(root, "files");
  const payloadStat = lstatSync(payload);
  if (payloadStat.isSymbolicLink() || !payloadStat.isDirectory()) fail("files/ 必须是普通目录。");
  const paths = scan(payload, [""]);
  const expected = manifest.files.map((entry) => entry.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(expected)) fail("内容包有额外或缺失文件。");
  const actual = entriesFor(payload, paths);
  const entries = new Map(manifest.files.map((entry) => [entry.path, entry]));
  for (const entry of actual) {
    const wanted = entries.get(entry.path);
    if (entry.bytes !== wanted.bytes || entry.sha256 !== wanted.sha256) fail(`内容包大小或 SHA-256 校验失败：${entry.path}`);
  }
  return { root, payload, manifest };
}

export function inspectContent({ source, compare }) {
  const snapshot = readSnapshot(source);
  const result = { operation: "inspect", ...summary(snapshot.manifest.files) };
  if (compare) {
    const target = rootDirectory(compare);
    const directories = [];
    const targetPaths = sourcePaths(target, directories);
    const current = validatePaths(targetPaths);
    // Empty directories occupy paths too, even though snapshots contain only files.
    for (const path of directories) {
      const key = portableKey(path);
      const existing = current.get(key);
      if (existing && (existing.path !== path || !existing.directory)) fail(`比较目标存在大小写/Unicode/目录冲突：${path}`);
      current.set(key, { path, directory: true });
    }
    result.comparison = snapshot.manifest.files.map((entry) => {
      const parts = entry.path.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join("/");
        const existing = current.get(portableKey(prefix));
        if (existing && (existing.path !== prefix || existing.directory !== (i < parts.length))) return { path: entry.path, status: "conflict", reason: "大小写/Unicode 或文件与目录冲突" };
      }
      const existing = current.get(portableKey(entry.path));
      if (!existing) return { path: entry.path, status: "add" };
      const bytes = readBounded(checkedFile(target, existing.path), LIMITS.fileBytes);
      return { path: entry.path, status: bytes.length === entry.bytes && sha256(bytes) === entry.sha256 ? "same" : "conflict" };
    });
    result.conflicts = result.comparison.filter((item) => item.status === "conflict").length;
    const incoming = new Set(snapshot.manifest.files.map((entry) => portableKey(entry.path)));
    result.targetOnly = targetPaths.filter((path) => !incoming.has(portableKey(path))).length;
  }
  return result;
}

export function importContent({ source, output, includePrivate = false }) {
  requirePrivateConsent(includePrivate);
  const snapshot = readSnapshot(source);
  const target = newOutput(output, snapshot.root);
  const result = { operation: "import", output: target, ...summary(snapshot.manifest.files), filesWritten: snapshot.manifest.files, notice: "仅恢复到隔离目录。原有草稿/公开标记未改；先审查、合并配置与构建，再决定发布。不是完整站点或 Git 历史备份。" };
  return createOutput(target, () => {
    verifiedCopy(snapshot.payload, target, snapshot.manifest.files);
    writeNew(target, "IMPORT-REPORT.json", JSON.stringify(result, null, 2) + "\n");
    return { ...result, filesWritten: undefined };
  });
}

const HELP = `用法（所有写操作仅支持站点之外的全新目录）：
  node scripts/content-transfer.mjs export --source . --output ../journal-content --include-private
  node scripts/content-transfer.mjs inspect --source ../journal-content [--compare .]
  node scripts/content-transfer.mjs import --source ../journal-content --output ../journal-review --include-private

导出包含草稿、未引用图片与个人内容设置，不含主题/后台/部署配置、令牌或 Git 历史。
仅支持本站文件契约，不解包 ZIP、不抓远程图片、不转换 WordPress/Notion、不覆盖在用站点。
上限：10,000 文件、单文件 25 MiB、总量 1 GiB、清单 4 MiB。路径、SHA-256 和媒体检查失败即停止。
inspect --compare 只读；存在冲突返回 2，验证失败返回 1。导入后仍须人工审查与构建。
`;
export function main(args) {
  if (!args.length || args.includes("--help") || args.includes("-h")) { console.log(HELP); return 0; }
  try {
    const [command, ...rest] = args;
    if (!["export", "inspect", "import"].includes(command)) fail(`未知操作：${command}`);
    const options = {};
    for (let i = 0; i < rest.length; i++) {
      const name = rest[i];
      const key = { "--source": "source", "--output": "output", "--compare": "compare", "--include-private": "includePrivate" }[name];
      if (!key || key in options) fail(`未知或重复参数：${name}`);
      if (key === "includePrivate") options[key] = true;
      else {
        const value = rest[++i];
        if (!value || value.startsWith("--")) fail(`${name} 缺少参数。`);
        options[key] = value;
      }
    }
    if (!options.source || (command !== "inspect" && !options.output)) fail("必须显式提供 --source，以及写操作的 --output。");
    if (command === "inspect" ? (options.output || options.includePrivate) : options.compare) fail("此操作不支持给出的参数组合。");
    const result = ({ export: exportContent, inspect: inspectContent, import: importContent })[command](options);
    console.log(JSON.stringify(result, null, 2));
    return result.conflicts ? 2 : 0;
  } catch (error) { console.error(`content-transfer：${error.message}`); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
