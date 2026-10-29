'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const { runInNewContext } = require('node:vm');
const { PROFILE, digest, readVendor } = require('../lib/vendor.cjs');
const root = join(__dirname, '../vendor');

// Test reader for the deterministic USTAR archives created by prepare-vendor.py.
function unpack(bytes) {
  const tar = gunzipSync(bytes), files = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, '');
    const prefix = text(345, 500), name = (prefix ? prefix + '/' : '') + text(0, 100);
    const size = Number.parseInt(text(124, 136).trim(), 8);
    assert.equal(text(156, 157), '0');
    assert.ok(!files.has(name) && !name.startsWith('/') && !name.split('/').includes('..'));
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const serverFiles = () => unpack(readFileSync(join(root, 'waline-vercel-1.43.4-qj.1.tgz')));

test('reviewed vendor inputs and installed admin match their source-linked hashes', () => {
  const vendor = readVendor();
  assert.equal(vendor.profile, PROFILE);
  const server = require('@waline/vercel/package.json');
  assert.equal(server.version, '1.43.4');
  assert.equal(server.quietJournalProfile, PROFILE);
  assert.equal(digest(readFileSync(require.resolve('@waline/admin'))), vendor.adminSha256);
  const lock = JSON.parse(readFileSync(join(__dirname, '../package-lock.json')));
  for (const name of Object.keys(lock.packages)) assert.doesNotMatch(name, /(?:@cloudbase\/|leancloud|node_modules\/(?:akismet|request|protobufjs|lodash\.(?:set|unset)|ua-parser-js)(?:\/|$))/);
});

test('the profile removes real unused adapters, preserving all unmodified upstream files', () => {
  const files = serverFiles(), profile = JSON.parse(files.get('package/QJ-PROFILE.json'));
  const metadata = JSON.parse(files.get('package/package.json'));
  assert.deepEqual(profile.removedDependencies, ['@cloudbase/node-sdk', 'leancloud-storage', 'akismet', 'ua-parser-js']);
  for (const name of profile.removedDependencies) assert.equal(metadata.dependencies[name], undefined);
  for (const name of profile.removedFiles) assert.equal(files.has('package/' + name), false);
  const edited = new Set([...profile.modifiedFiles, ...profile.removedFiles]);
  for (const [name, hash] of Object.entries(profile.originalFiles)) {
    if (!edited.has(name)) assert.equal(digest(files.get('package/' + name)), hash, name);
  }
  for (const [name, relative] of [['src/service/core.js', './disabled-user-agent.js'], ['src/extend/think.js', '../service/disabled-user-agent.js']]) {
    const patched = `// Quiet Journal profile, modified 2026-10-16: device parsing is disabled.\nconst parser = require('${relative}');`;
    const original = files.get('package/' + name).toString().replace(patched, "const parser = require('ua-parser-js');");
    assert.equal(digest(Buffer.from(original)), profile.originalFiles[name], 'Only the dependency selection changed: ' + name);
  }
});

test('disabled UA keeps the required empty serialization shape and cannot be enabled silently', () => {
  const source = serverFiles().get('package/src/service/disabled-user-agent.js').toString();
  const env = { DISABLE_USERAGENT: 'true' }, module = { exports: {} };
  runInNewContext(source, { module, process: { env } });
  assert.deepEqual(JSON.parse(JSON.stringify(module.exports('PRIVATE_DEVICE_MARKER'))), { browser: {}, cpu: {}, device: {}, engine: {}, os: {} });
  delete env.DISABLE_USERAGENT;
  assert.throws(() => module.exports('anything'), /not available/);
});

test('source archives include preferred source, locked rebuild inputs and third-party licenses, not private service settings', () => {
  const vendor = readVendor(), admin = unpack(vendor.adminSource), server = unpack(vendor.serverSource);
  assert.ok(server.has('waline-server-source/upstream-build/packages/core/src/core.ts'));
  assert.deepEqual(server.get('waline-server-source/prepare-vendor.py'), readFileSync(join(__dirname, '../scripts/prepare-vendor.py')));
  assert.match(server.get('waline-server-source/server/LICENSE').toString(), /GNU GENERAL PUBLIC LICENSE/);
  assert.ok(admin.has('waline-admin-source/admin/src/index.jsx'));
  const buildPackage = JSON.parse(admin.get('waline-admin-source/admin/package.json'));
  const buildLock = JSON.parse(admin.get('waline-admin-source/admin/package-lock.json'));
  assert.equal(buildPackage.devDependencies.vite, '8.2.4');
  assert.equal(buildLock.packages['node_modules/vite'].version, '8.2.4');
  assert.match(admin.get('waline-admin-source/admin/vite.config.ts').toString(), /sourcemap: 'hidden'/);
  assert.match(admin.get('waline-admin-source/admin/LICENSE').toString(), /GNU GENERAL PUBLIC LICENSE/);
  assert.ok(admin.has('waline-admin-source/third-party/react/LICENSE'));
  const map = JSON.parse(admin.get('waline-admin-source/admin/dist/admin.js.map'));
  assert.equal(map.sources.length, map.sourcesContent.length);
  assert.ok(map.sourcesContent.every((source) => typeof source === 'string'));
  for (const path of [...admin.keys(), ...server.keys()]) assert.doesNotMatch(path, /(?:^|\/)(?:\.env(?:\.|$)|\.vercel|\.git|content)(?:\/|$)|\.(?:dump|pem|key)$/);
  assert.doesNotMatch(readFileSync(require.resolve('@waline/admin'), 'utf8'), /sourceMappingURL=/);
});

test('missing, extra or tampered vendor inputs fail closed instead of serving mismatched code or source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qj-vendor-'));
  try {
    cpSync(root, directory, { recursive: true });
    const file = join(directory, 'waline-admin-source-0.36.0.tar.gz');
    const bytes = readFileSync(file); bytes[20] ^= 1; writeFileSync(file, bytes);
    assert.throws(() => readVendor(directory), /integrity mismatch/);
    cpSync(root, directory, { recursive: true });
    const lockFile = join(directory, 'vendor-lock.json'), lock = JSON.parse(readFileSync(lockFile));
    lock.files['../private.env'] = { bytes: 0, sha256: '0'.repeat(64) };
    writeFileSync(lockFile, JSON.stringify(lock));
    assert.throws(() => readVendor(directory), /manifest/);
    cpSync(root, directory, { recursive: true });
    rmSync(join(directory, 'waline-server-source-1.43.4.tar.gz'));
    assert.throws(() => readVendor(directory), /ENOENT/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
