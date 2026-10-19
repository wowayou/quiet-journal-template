'use strict';

const { spawn } = require('node:child_process');
const { existsSync, statSync, openSync, closeSync, fsyncSync, unlinkSync, realpathSync, readSync, fstatSync } = require('node:fs');
const { resolve, dirname, parse, basename, join } = require('node:path');
const { databaseOptions } = require('../lib/settings.cjs');

async function backup({ url, output, executable = 'pg_dump', env = process.env }) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Global TLS bypass is forbidden.');
  const db = databaseOptions(url);
  if (db.host.toLowerCase().includes('-pooler.')) throw new Error('Backups require the direct Neon host, not the pooled host.');
  if (!output) throw new Error('Supply a new backup filename outside all Git repositories.');
  const parent = realpathSync(dirname(resolve(output)));
  const file = join(parent, basename(output));
  for (let dir = parent; ; dir = dirname(dir)) {
    if (existsSync(resolve(dir, '.git'))) throw new Error('Backups must not be stored inside a Git repository.');
    if (dir === parse(dir).root) break;
  }
  const directory = statSync(parent);
  if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error('Use an existing private backup directory (mode 700).');
  const ca = env.WALINE_BACKUP_CA_FILE || ['/etc/ssl/certs/ca-certificates.crt', '/etc/ssl/cert.pem', '/etc/pki/tls/certs/ca-bundle.crt'].find(existsSync);
  if (!ca || !statSync(ca).isFile()) throw new Error('Set WALINE_BACKUP_CA_FILE to a trusted system CA bundle.');
  const fd = openSync(file, 'wx+', 0o600);
  let complete = false;
  try {
    const result = await new Promise((done) => {
      let diagnostics = '';
      const inherited = Object.fromEntries(Object.entries(env).filter(([name]) => !/^(?:PG|WALINE_)/.test(name)));
      const child = spawn(executable, ['--format=custom', '--no-owner', '--no-privileges', '--no-password'], {
        env: {
          ...inherited, PGHOST: db.host, PGPORT: String(db.port), PGUSER: db.user,
          PGPASSWORD: db.password, PGDATABASE: db.database,
          PGSSLMODE: 'verify-full', PGSSLROOTCERT: ca, PGCHANNELBINDING: 'require',
          PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c statement_timeout=60000',
        },
        stdio: ['ignore', fd, 'pipe'], timeout: 120000,
      });
      // Keep enough diagnostics to report the failure category, not private row
      // details or credentials. Drain stderr even after the diagnostic cap.
      child.stderr.on('data', (chunk) => { if (diagnostics.length < 8192) diagnostics += chunk.toString().slice(0, 8192 - diagnostics.length); });
      child.once('error', (error) => done({ error: error.code || 'SPAWN_FAILED' }));
      child.once('close', (code, signal) => done({ code, signal, diagnostics }));
    });
    if (result.error || result.code !== 0 || result.signal) {
      const reason = /channel binding/i.test(result.diagnostics || '') ? 'channel binding'
        : /certificate|SSL|TLS/i.test(result.diagnostics || '') ? 'TLS verification'
        : /authenticat/i.test(result.diagnostics || '') ? 'authentication'
        : /permission denied/i.test(result.diagnostics || '') ? 'database privileges'
        : /version.*mismatch|server version/i.test(result.diagnostics || '') ? 'client/server version'
        : 'client or connection error';
      throw new Error(`pg_dump failed (${result.error || result.signal || result.code}; ${reason}); no backup kept. No automatic retry.`);
    }
    const magic = Buffer.alloc(5);
    if (fstatSync(fd).size <= 5 || readSync(fd, magic, 0, 5, 0) !== 5 || magic.toString() !== 'PGDMP') throw new Error('pg_dump did not produce a custom-format archive; no backup kept.');
    fsyncSync(fd);
    complete = true;
  } finally {
    closeSync(fd);
    if (!complete) unlinkSync(file); // Only the file created exclusively by this run.
  }
  return file;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('Usage: node --env-file=/private/backup.env scripts/backup.cjs --output /private/backups/new.dump');
    process.exitCode = 1;
  } else {
    backup({ url: process.env.WALINE_BACKUP_DATABASE_URL, output: args[1] }).then(
      (file) => console.log(`Backup written: ${file}. Restore verification is still required.`),
      (error) => { console.error(error.message); process.exitCode = 1; },
    );
  }
}

module.exports = { backup };
