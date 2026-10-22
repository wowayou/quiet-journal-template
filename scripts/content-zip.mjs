// Bounded ZIP transport around the same content snapshot, never a general-purpose extractor.
import { createWriteStream, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import yauzl from "yauzl";
import yazl from "yazl";
import crc32 from "buffer-crc32";
import { createHash } from "node:crypto";
import { readSnapshot, readBounded, contentBytes, writeNew, newOutput, checkedFile, fingerprint } from "./content-transfer.mjs";
import { LIMITS, validatePath, validatePaths } from "./content-transfer.mjs";
export const ZIP_LIMITS = Object.freeze({ bytes: LIMITS.totalBytes + 8 * 1024 ** 2, ratio: 200, milliseconds: 120000 });
const fail = (text) => { throw new Error(text); };

export async function unpackSnapshot(source, output, progress = () => {}) {
  if (statSync(source).size > ZIP_LIMITS.bytes) fail("ZIP 超过压缩输入上限。");
  const start = Date.now(), target = newOutput(output, source);
  const archive = await yauzl.openPromise(source, { autoClose: true, strictFileNames: true, validateEntrySizes: true });
  if (archive.entryCount > LIMITS.files * 3 + 10) { archive.close(); fail("ZIP 条目过多。"); }
  let created = false, total = 0, count = 0;
  const directories = [], paths = [], occupied = new Map(), pathIndex = new Map();
  try {
    mkdirSync(target, { mode: 0o700 }); created = true;
    for await (const entry of archive.eachEntry()) {
      if (Date.now() - start > ZIP_LIMITS.milliseconds) fail("ZIP 解包超时。");
      const name = entry.fileName, isDirectory = name.endsWith("/");
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || (mode && mode !== (isDirectory ? 0x4000 : 0x8000))) fail("ZIP 不接受加密、特殊文件或此压缩方法。");
      if (entry.generalPurposeBitFlag & 0x20) fail("ZIP 不接受补丁条目。");
      if (isDirectory) {
        const path = name.slice(0, -1);
        if (!['files', 'files/content', 'files/assets', 'files/assets/media', 'files/data'].includes(path)) {
          if (!path.startsWith('files/')) fail(`不安全的 ZIP 目录：${name}`);
          validatePath(`${path.slice(6)}/${path.startsWith('files/content/') ? '_directory.md' : '_directory.png'}`);
        }
        const key = path.normalize("NFC").toLowerCase();
        if (occupied.has(key)) fail(`ZIP 重复或冲突路径：${name}`);
        occupied.set(key, "directory"); directories.push(path);
        if (entry.uncompressedSize) fail("ZIP 目录不得携带内容。");
        continue;
      }
      if (name !== "manifest.json") {
        if (!name.startsWith("files/")) fail(`ZIP 只接受 manifest.json 和 files/：${name}`);
        const path = validatePath(name.slice(6));
        validatePaths([path], pathIndex); paths.push(path);
      }
      const key = name.normalize("NFC").toLowerCase();
      if (occupied.has(key)) fail(`ZIP 重复或冲突路径：${name}`);
      occupied.set(key, "file");
      const limit = name === "manifest.json" ? LIMITS.manifestBytes : LIMITS.fileBytes;
      if (entry.uncompressedSize > limit || ++count > LIMITS.files + 1) fail("ZIP 文件数量或单文件超过上限。");
      if (entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * ZIP_LIMITS.ratio)) fail("ZIP 压缩比过高，请用普通目录格式。");
      progress({ stage: "unpacking", current: count, total: archive.entryCount, path: name });
      const stream = await archive.openReadStreamPromise(entry), chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        progress({ stage: "unpacking", current: count, total: archive.entryCount, path: name });
        size += chunk.length; total += chunk.length;
        if (size > limit || total > LIMITS.totalBytes + LIMITS.manifestBytes || Date.now() - start > ZIP_LIMITS.milliseconds) { stream.destroy(); fail("ZIP 解压体积或耗时超过上限。"); }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (size !== entry.uncompressedSize || crc32.unsigned(bytes) !== entry.crc32) fail(`ZIP 大小或 CRC 校验失败：${name}`);
      writeNew(target, name, bytes);
    }
    const allowedDirectories = new Set(['files']);
    for (const path of paths) {
      const parts = `files/${path}`.split('/');
      for (let i=1;i<parts.length;i++) allowedDirectories.add(parts.slice(0,i).join('/'));
    }
    for (const path of directories) if (!allowedDirectories.has(path)) fail(`ZIP 多余或冲突目录：${path}`);
    readSnapshot(target, progress); // Media and SHA-256 checks also cover archives with forged manifests.
    return target;
  } catch (error) {
    archive.close();
    try { if (created) rmSync(target, { recursive: true, force: true }); }
    catch (cleanup) { throw new Error(`${error.message}；临时解包清理失败：${cleanup.message}，请检查 ${target}`); }
    throw error;
  }
}

export async function packSnapshot(source, output, progress = () => {}) {
  const snapshot = readSnapshot(source, progress), target = newOutput(output, snapshot.root);
  const zip = new yazl.ZipFile();
  const timestamp = new Date("2000-01-01T00:00:00Z");
  const manifestBytes = readBounded(checkedFile(snapshot.root, "manifest.json"), LIMITS.manifestBytes);
  if (fingerprint(JSON.parse(manifestBytes)) !== fingerprint(snapshot.manifest)) fail("清单在打包期间改变。");
  zip.addBuffer(manifestBytes, "manifest.json", { mtime: timestamp, mode: 0o100600, forceDosTimestamp: true, compress: false });
  for (const entry of snapshot.manifest.files) {
    zip.addReadStreamLazy(`files/${entry.path}`, { size: entry.bytes, mode: 0o100600, mtime: timestamp, forceDosTimestamp: true, compress: false }, (done) => {
      try {
        progress({ stage: "packing", path: entry.path });
        const bytes = contentBytes(snapshot.payload, entry.path);
        // readSnapshot validates each entry; copy may not use a changed payload.
        if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) done(new Error("内容包在打包期间改变。"));
        else done(null, Readable.from([bytes]));
      } catch (error) { done(error); }
    });
  }
  let size = 0;
  const bounded = new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > ZIP_LIMITS.bytes ? new Error("ZIP 输出超过上限。") : null, chunk); } });
  let created = false;
  const destination = createWriteStream(target, { flags: "wx", mode: 0o600 });
  destination.on("open", () => { created = true; });
  const result = pipeline(zip.outputStream, bounded, destination);
  zip.on("error", (error) => zip.outputStream.destroy(error));
  zip.end();
  try {
    await result;
    if (fingerprint(readSnapshot(source, progress).manifest) !== fingerprint(snapshot.manifest)) fail("内容包在打包期间改变。");
    return { output: target, bytes: size };
  } catch (error) { if (created) { try { rmSync(target, { force: true }); } catch (cleanup) { throw new Error(`${error.message}；清理失败 ${cleanup.message}`); } } throw error; }
}
