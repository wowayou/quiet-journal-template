import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, createWriteStream, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { exportContent, readSnapshot, LIMITS } from '../content-transfer.mjs';
import { packSnapshot, unpackSnapshot } from '../content-zip.mjs';

async function using(fn) {
  const root = mkdtempSync(join(tmpdir(), 'qj-zip-boundary-')), source = join(root, 'site'), snapshot = join(root, 'snapshot');
  mkdirSync(join(source, 'content'), { recursive: true });
  writeFileSync(join(source, 'content/a.md'), '---\ntitle: Synthetic\ndraft: true\n---\nSynthetic only.');
  exportContent({ source, output: snapshot, includePrivate: true });
  const entries = [{ name: 'manifest.json', bytes: readFileSync(join(snapshot, 'manifest.json')) }, { name: 'files/content/a.md', bytes: readFileSync(join(snapshot, 'files/content/a.md')) }];
  const archive = async (name, items = entries) => {
    const zip = new yazl.ZipFile(), output = join(root, name);
    for (const item of items) {
      const options = { mode: item.mode ?? 0o100600, compress: item.compress ?? false };
      if (item.name.endsWith('/')) zip.addEmptyDirectory(item.name, { mode: 0o40700 });
      else zip.addBuffer(item.bytes ?? Buffer.from('Synthetic'), item.name, options);
    }
    const writing = pipeline(zip.outputStream, createWriteStream(output)); zip.end(); await writing; return output;
  };
  const rejected = async (zip, reason, suffix = 'out') => {
    const output = join(root, suffix);
    await assert.rejects(() => unpackSnapshot(zip, output), reason);
    assert.equal(existsSync(output), false, 'failed extraction must clean only its new output');
  };
  try { await fn({ root, source, snapshot, entries, archive, rejected }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
// Mutate central-directory metadata in a library-generated valid package; not a ZIP implementation.
function central(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = bytes.readUInt32LE(end + 16); const entries = [];
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50); entries.push(offset);
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return { end, entries };
}

test('ZIP：stored 与 deflate、显式目录、中文和路径空格可安全往返', () => using(async ({ root, source, snapshot, archive }) => {
  rmSync(snapshot, { recursive: true }); mkdirSync(join(source, 'content/中文 目录'));
  writeFileSync(join(source, 'content/中文 目录/index.md'), '---\ntitle: 中文\n---\n合成正文');
  exportContent({ source, output: snapshot, includePrivate: true });
  const manifest = readSnapshot(snapshot).manifest;
  const items = [{ name: 'files/' }, { name: 'files/content/' }, { name: 'files/content/中文 目录/' }, { name: 'manifest.json', bytes: readFileSync(join(snapshot, 'manifest.json')), compress: true }, ...manifest.files.map(entry => ({ name: `files/${entry.path}`, bytes: readFileSync(join(snapshot, 'files', entry.path)), compress: true }))];
  const zip = await archive('deflate.zip', items), output = await unpackSnapshot(zip, join(root, 'unpacked'));
  assert.deepEqual(readSnapshot(output).manifest, manifest);
  for (const entry of manifest.files) assert.deepEqual(readFileSync(join(output, 'files', entry.path)), readFileSync(join(source, entry.path)));
}));

test('ZIP：从有效包构造的 CRC、加密、压缩方法和实际大小错误逐项拒绝', () => using(async ({ root, archive, rejected }) => {
  const valid = readFileSync(await archive('valid.zip'));
  for (const [name, change, reason] of [
    ['crc', (bytes, offset) => bytes.writeUInt32LE(0, offset + 16), /CRC/],
    ['encrypted', (bytes, offset) => { bytes.writeUInt16LE(8, offset + 10); bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | 1, offset + 8); }, /加密/],
    ['method', (bytes, offset) => bytes.writeUInt16LE(99, offset + 10), /压缩方法/],
    ['size', (bytes, offset) => bytes.writeUInt32LE(bytes.readUInt32LE(offset + 24) + 1, offset + 24), /size|大小/i],
    ['symlink', (bytes, offset) => bytes.writeUInt32LE((0o120777 * 65536) >>> 0, offset + 38), /特殊文件/],
    ['device', (bytes, offset) => bytes.writeUInt32LE((0o020600 * 65536) >>> 0, offset + 38), /特殊文件/],
  ]) {
    const bytes = Buffer.from(valid), offset = central(bytes).entries[1]; change(bytes, offset);
    const zip = join(root, `${name}.zip`); writeFileSync(zip, bytes); await rejected(zip, reason, `out-${name}`);
  }
}));

test('ZIP：真正的上级路径、大小写、Unicode、目录文件冲突及嵌套包不能绕过清单', () => using(async ({ root, entries, archive, rejected }) => {
  const valid = readFileSync(await archive('valid.zip')), bytes = Buffer.from(valid);
  const offset = central(bytes).entries[1] + 46;
  // Same byte length as files/content/a.md; central-directory validation must reject it.
  Buffer.from('files/../cret/a.md').copy(bytes, offset);
  const traversal = join(root, 'traversal.zip'); writeFileSync(traversal, bytes); await rejected(traversal, /relative|\.\.|路径/i, 'out-traversal');
  for (const [index, extra] of [
    [{ name: 'files/content/A.md' }],
    [{ name: 'files/content/é.md' }, { name: 'files/content/e\u0301.md' }],
    [{ name: 'files/content/a.md/' }],
    [{ name: 'files/content/nested.zip' }],
    [{ name: 'files/content/unexpected.md' }],
    [{ name: 'files/content/unused/' }],
    [{ name: 'files/content/' }, { name: 'files/content/' }],
  ].entries()) await rejected(await archive(`paths-${index}.zip`, [...entries, ...extra]), /冲突|重复|白名单|额外|多余/, `out-paths-${index}`);
}));

test('ZIP：条目/单文件上限在解包前拒绝，伪造小大小仍检查实际解压字节', () => using(async ({ root, archive, entries, rejected }) => {
  const valid = readFileSync(await archive('valid.zip'));
  const tooLarge = Buffer.from(valid), largeEntry = central(tooLarge).entries[1];
  tooLarge.writeUInt16LE(8, largeEntry + 10); tooLarge.writeUInt32LE(LIMITS.fileBytes + 1, largeEntry + 24);
  const largeZip = join(root, 'large.zip'); writeFileSync(largeZip, tooLarge); await rejected(largeZip, /上限/, 'out-large');
  const tooMany = Buffer.from(valid), end = central(tooMany).end;
  tooMany.writeUInt16LE(LIMITS.files * 3 + 11, end + 8); tooMany.writeUInt16LE(LIMITS.files * 3 + 11, end + 10);
  const manyZip = join(root, 'many.zip'); writeFileSync(manyZip, tooMany); await rejected(manyZip, /条目过多/, 'out-many');
  const deflate = readFileSync(await archive('actual-size.zip', [entries[0], { name: entries[1].name, bytes: randomBytes(512 * 1024), compress: true }]));
  deflate.writeUInt32LE(1, central(deflate).entries[1] + 24);
  const actual = join(root, 'forged-size.zip'); writeFileSync(actual, deflate); await rejected(actual, /too many bytes in the stream|大小/, 'out-forged');
}));

test('ZIP：解压中途取消有检查点，打包中途失败清理输出；既有目标保持不变', () => using(async ({ root, snapshot, archive, entries }) => {
  const zip = await archive('chunks.zip', [entries[0], { name: entries[1].name, bytes: randomBytes(512 * 1024), compress: true }]);
  let checkpoints = 0; const output = join(root, 'cancelled');
  await assert.rejects(() => unpackSnapshot(zip, output, state => { if (state.path === entries[1].name && ++checkpoints === 2) throw new Error('synthetic cancellation'); }), /synthetic cancellation/);
  assert.equal(checkpoints, 2); assert.equal(existsSync(output), false);
  const packed = join(root, 'failed.zip');
  await assert.rejects(() => packSnapshot(snapshot, packed, state => { if (state.stage === 'packing') throw new Error('synthetic packing failure'); }), /synthetic packing failure/);
  assert.equal(existsSync(packed), false);
  const existing = join(root, 'existing'); mkdirSync(existing); writeFileSync(join(existing, 'keep'), 'preserve');
  await assert.rejects(() => unpackSnapshot(zip, existing), /全新/);
  assert.deepEqual(readdirSync(existing), ['keep']); assert.equal(readFileSync(join(existing, 'keep'), 'utf8'), 'preserve');
}));
