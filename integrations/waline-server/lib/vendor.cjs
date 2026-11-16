'use strict';

const { readFileSync, lstatSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { failure } = require('./diagnostics.cjs');

const PROFILE = 'postgres-no-external-v1';
const FILES = [
  'waline-vercel-1.43.4-qj.1.tgz', 'waline-admin-0.36.0-qj.1.tgz',
  'waline-server-source-1.43.4.tar.gz', 'waline-admin-source-0.36.0.tar.gz',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readVendor(root = join(__dirname, '../vendor')) {
  const lock = JSON.parse(readFileSync(join(root, 'vendor-lock.json'), 'utf8'));
  if (lock.version !== 1 || lock.profile !== PROFILE || !/^[a-f0-9]{64}$/.test(lock.adminSha256 || '') || !lock.files || Object.keys(lock.files).length !== FILES.length || FILES.some((name) => !Object.hasOwn(lock.files, name))) throw failure('VENDOR', 'VENDOR_MANIFEST', 'Unexpected vendor manifest.');
  const files = {};
  for (const name of FILES) {
    const file = join(root, name), actual = lstatSync(file), expected = lock.files[name];
    if (!actual.isFile() || actual.size > 4 * 1024 * 1024 || actual.size !== expected.bytes) throw failure('VENDOR', 'VENDOR_FILE_METADATA', `Vendor size/type mismatch: ${name}`);
    const bytes = readFileSync(file);
    if (digest(bytes) !== expected.sha256) throw failure('VENDOR', 'VENDOR_INTEGRITY', `Vendor integrity mismatch: ${name}`);
    files[name] = bytes;
  }
  return {
    profile: PROFILE, adminSha256: lock.adminSha256,
    adminSource: files['waline-admin-source-0.36.0.tar.gz'],
    serverSource: files['waline-server-source-1.43.4.tar.gz'],
  };
}

module.exports = { PROFILE, FILES, digest, readVendor };
