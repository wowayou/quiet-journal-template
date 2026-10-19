'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, chmodSync, readFileSync, statSync, existsSync, mkdirSync, rmSync, symlinkSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { backup } = require('../scripts/backup.cjs');
const url = 'postgresql://owner:NEVER_ON_COMMAND_LINE@localhost/comments?sslmode=verify-full';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qj-waline-backup-'));
  const executable = join(dir, 'pg-dump-fixture');
  const setup = (source) => { writeFileSync(executable, '#!/usr/bin/env node\n' + source); chmodSync(executable, 0o700); };
  return { dir, executable, setup, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('manual backup passes credentials via environment, enforces TLS and uses a private exclusive file', async () => {
  const f = fixture();
  try {
    f.setup(`const assert = require('node:assert/strict');
assert.ok(!process.argv.join(' ').includes('NEVER_ON_COMMAND_LINE'));
assert.equal(process.env.PGPASSWORD, 'NEVER_ON_COMMAND_LINE');
assert.equal(process.env.PGSSLMODE, 'verify-full');
assert.equal(process.env.PGCHANNELBINDING, 'require');
assert.equal(process.env.PGSERVICE, undefined);
assert.equal(process.env.WALINE_BACKUP_DATABASE_URL, undefined);
assert.ok(process.env.PGSSLROOTCERT);
process.stdout.write('PGDMP_SYNTHETIC_BACKUP');`);
    const output = join(f.dir, 'first.dump');
    assert.equal(await backup({ url, output, executable: f.executable, env: { ...process.env, PGSERVICE: 'unexpected-service', PGSSLMODE: 'disable', WALINE_BACKUP_DATABASE_URL: url } }), output);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(readFileSync(output, 'utf8'), 'PGDMP_SYNTHETIC_BACKUP');
    await assert.rejects(() => backup({ url, output, executable: f.executable }), /EEXIST/);
    assert.equal(readFileSync(output, 'utf8'), 'PGDMP_SYNTHETIC_BACKUP');
  } finally { f.cleanup(); }
});

test('failed backup removes only its own output, does not retry or expose tool diagnostics', async () => {
  const f = fixture();
  try {
    const count = join(f.dir, 'calls');
    f.setup(`require('node:fs').appendFileSync(${JSON.stringify(count)}, '1'); process.stdout.write('PARTIAL'); process.stderr.write('NEVER_ON_COMMAND_LINE'); process.exit(2);`);
    const output = join(f.dir, 'failed.dump');
    await assert.rejects(() => backup({ url, output, executable: f.executable }), (error) => /pg_dump failed/.test(error.message) && !error.message.includes('NEVER_ON_COMMAND_LINE'));
    assert.equal(existsSync(output), false);
    assert.equal(readFileSync(count, 'utf8'), '1');
  } finally { f.cleanup(); }
});

test('backup refuses a zero-exit malformed archive and a symlink into a repository', async () => {
  const f = fixture();
  try {
    f.setup("process.stdout.write('NOT_A_BACKUP');");
    const output = join(f.dir, 'invalid.dump');
    await assert.rejects(() => backup({ url, output, executable: f.executable }), /custom-format/);
    assert.equal(existsSync(output), false);
    const repo = join(f.dir, 'repo'), nested = join(repo, 'private');
    mkdirSync(repo, { mode: 0o700 }); mkdirSync(join(repo, '.git')); mkdirSync(nested, { mode: 0o700 });
    symlinkSync(nested, join(f.dir, 'alias'));
    await assert.rejects(() => backup({ url, output: join(f.dir, 'alias', 'hidden.dump'), executable: f.executable }), /Git/);
    assert.equal(existsSync(join(nested, 'hidden.dump')), false);
  } finally { f.cleanup(); }
});

test('backup refuses pooled hosts, Git repositories and non-private directories', async () => {
  const f = fixture();
  try {
    f.setup("process.stdout.write('SHOULD_NOT_RUN');");
    const output = join(f.dir, 'forbidden.dump');
    await assert.rejects(() => backup({ url: url.replace('localhost', 'ep-test-pooler.us-east-2.aws.neon.tech'), output, executable: f.executable }), /direct/);
    chmodSync(f.dir, 0o755);
    await assert.rejects(() => backup({ url, output, executable: f.executable }), /private/);
    chmodSync(f.dir, 0o700); mkdirSync(join(f.dir, '.git'));
    await assert.rejects(() => backup({ url, output, executable: f.executable }), /Git/);
    assert.equal(existsSync(output), false);
  } finally { f.cleanup(); }
});
