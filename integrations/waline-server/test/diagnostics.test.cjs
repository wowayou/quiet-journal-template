'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { diagnosticLine, failure, atStage } = require('../lib/diagnostics.cjs');

const base = join(__dirname, '..');
const environment = () => ({
  NODE_ENV: 'production', WALINE_MODE: 'bootstrap',
  WALINE_BLOG_ORIGIN: 'https://blog.example.test', WALINE_PANEL_ORIGIN: 'https://panel.example.test',
  WALINE_API_ORIGIN: 'https://api.example.test', WALINE_JWT_TOKEN: 'a'.repeat(64),
  WALINE_SETUP_PASSWORD: 'b'.repeat(64),
  WALINE_DATABASE_URL: 'postgresql://waline_app:SYNTHETIC_NOT_REAL@localhost:1/waline?sslmode=verify-full',
});

// No inherited environment, real secret, socket, database, server or cloud call.
// Faults exercise the real entrypoint/settings/vendor/service boundaries; only
// the upstream Waline handler is replaced to keep this unit fixture offline.
function invoke({ env = {}, fault = '', committed = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'qj-diagnostic-test-'));
  const script = `
    const base = ${JSON.stringify(base)};
    const Module = require('node:module');
    const original = Module._load;
    const fs = require('node:fs');
    let networkAttempts = 0, databaseAttempts = 0, childProcessAttempts = 0;
    const blocked = () => { networkAttempts++; throw new Error('No network in synthetic fixture'); };
    require('node:net').Socket.prototype.connect = blocked;
    require('node:tls').connect = blocked;
    require('node:dgram').createSocket = blocked;
    global.fetch = blocked;
    const cp = require('node:child_process');
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
      cp[name] = () => { childProcessAttempts++; throw new Error('No subprocess in fixture'); };
    }
    const pg = require(require.resolve('pg', { paths: [base] }));
    for (const target of [pg.Client.prototype, pg.Pool.prototype]) {
      target.connect = () => { databaseAttempts++; throw new Error('No DB in synthetic fixture'); };
    }
    const secretError = (code) => Object.assign(new Error('postgresql://u:PRIVATE_SENTINEL@private.example/db'), {
      code, stack: 'PRIVATE_STACK_SENTINEL', cause: { secret: 'PRIVATE_CAUSE_SENTINEL' },
    });
    const middleware = ['fetch-oauth-service', 'dashboard', 'version', 'meta', 'payload', 'trace'].map(handle => ({ handle }));
    Module._load = function(request, ...args) {
      ${fault}
      if (request === '@waline/vercel') return () => async (req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Waline setup", charset="UTF-8"' });
        res.end(JSON.stringify({ errno: 401 }));
      };
      if (request === '@waline/vercel/src/config/middleware.js') return middleware;
      return original.call(this, request, ...args);
    };
    const handler = require(base + '/api/index.js');
    const response = {
      headersSent: ${committed}, ended: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
      end(body) { this.body = body; this.ended = true; },
    };
    handler({ method: 'GET', url: '/', headers: {} }, response).then(() => {
      process.stdout.write(JSON.stringify({ status: response.status, headers: response.headers,
        body: response.body ? JSON.parse(response.body) : null, ended: response.ended,
        networkAttempts, databaseAttempts, childProcessAttempts }));
    }).catch(() => { process.exitCode = 2; });
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...environment(), HOME: temp, TMPDIR: temp, ...env }, encoding: 'utf8', timeout: 7000, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|SYNTHETIC_NOT_REAL|postgresql:\/\//);
    const response = JSON.parse(result.stdout);
    assert.equal(response.networkAttempts, 0);
    assert.equal(response.databaseAttempts, 0);
    assert.equal(response.childProcessAttempts, 0);
    return { ...response, log: result.stderr };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

function unavailable(result, stage, reason) {
  assert.equal(result.status, 503);
  assert.equal(result.ended, true);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(result.headers['X-Robots-Tag'], 'noindex, nofollow, noarchive');
  assert.deepEqual(result.body, { errno: 503, errmsg: 'Comment service is locked or unavailable. A previous write may already have been saved; do not automatically retry.' });
  const expected = `[waline] service configuration or initialization failed; details suppressed. stage=${stage} reason=${reason}\n`;
  assert.equal(result.log, expected);
  assert.doesNotMatch(result.body.errmsg, /stage=|reason=/);
}

test('only fixed diagnostic vocabulary can be logged, including hostile exception objects', () => {
  const unknown = '[waline] service configuration or initialization failed; details suppressed. stage=UNKNOWN reason=UNKNOWN';
  for (const value of [null, undefined, 'PRIVATE_SENTINEL', new Error('PRIVATE_SENTINEL'),
    { stage: 'MODE', reason: 'JWT_FORMAT', message: 'PRIVATE_SENTINEL' },
    { get code() { throw new Error('PRIVATE_SENTINEL'); } },
    new Proxy({}, { get() { throw new Error('PRIVATE_SENTINEL'); } })]) {
    assert.equal(diagnosticLine('PRIVATE_STAGE\nINJECTION', value), unknown);
  }
  assert.equal(diagnosticLine('PRIVATE_STAGE', failure('PRIVATE_STAGE', 'PRIVATE_REASON', 'PRIVATE_SENTINEL')), unknown);
  assert.match(diagnosticLine('REQUEST', { code: 'PRIVATE_SENTINEL' }), /stage=REQUEST reason=UNKNOWN$/);
  for (const [code, reason] of [['MODULE_NOT_FOUND', 'MODULE_MISSING'], ['ERR_MODULE_NOT_FOUND', 'MODULE_MISSING'], ['ENOENT', 'FILE_MISSING'], ['EPERM', 'FILE_DENIED'], ['EACCES', 'FILE_DENIED']]) {
    assert.match(diagnosticLine('VENDOR', { code }), new RegExp(`stage=VENDOR reason=${reason}$`));
  }
});

test('nested stages preserve the trusted inner reason without exposing exception data', () => {
  const tagged = Object.freeze(failure('SETTINGS', 'JWT_FORMAT', 'PRIVATE_SENTINEL'));
  assert.throws(() => atStage('SERVICE_INIT', () => { throw tagged; }), error => error === tagged);
  assert.match(diagnosticLine('REQUEST', tagged), /stage=SETTINGS reason=JWT_FORMAT$/);
  const external = Object.freeze(Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'ENOENT' }));
  assert.throws(() => atStage('SERVICE_INIT', () => atStage('ADMIN_ASSETS', () => { throw external; })), error => error === external);
  assert.match(diagnosticLine('REQUEST', external), /stage=ADMIN_ASSETS reason=FILE_MISSING$/);
  assert.throws(() => atStage('VENDOR', () => { throw 'PRIVATE_SENTINEL'; }), error => diagnosticLine('REQUEST', error).endsWith('stage=VENDOR reason=UNKNOWN'));
  assert.equal(atStage('VENDOR', () => 42), 42);
});

test('default and explicit locked mode remain quiet and do not load the service', () => {
  for (const mode of ['', 'locked']) {
    const result = invoke({ env: { WALINE_MODE: mode }, fault: "if (request === '../lib/service.cjs') throw secretError();" });
    assert.equal(result.status, 503);
    assert.equal(result.log, '');
  }
});

test('valid bootstrap reaches the unchanged setup authentication response in the offline fixture', () => {
  const result = invoke();
  assert.equal(result.status, 401);
  assert.equal(result.headers['WWW-Authenticate'], 'Basic realm="Waline setup", charset="UTF-8"');
  assert.equal(result.log, '');
});

test('configuration failures have specific fixed reasons, never values or arbitrary variable names', async (t) => {
  const cases = [
    ['mode', { WALINE_MODE: 'PRIVATE_SENTINEL' }, 'MODE', 'MODE_INVALID'],
    ['tls', { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, 'SETTINGS', 'TLS_BYPASS'],
    ['conflict', { SMTP_PRIVATE_SENTINEL: 'PRIVATE_SENTINEL' }, 'SETTINGS', 'CONFIG_CONFLICT'],
    ['blog', { WALINE_BLOG_ORIGIN: 'PRIVATE_SENTINEL' }, 'SETTINGS', 'BLOG_ORIGIN_INVALID'],
    ['panel', { WALINE_PANEL_ORIGIN: 'https://u:PRIVATE_SENTINEL@panel.example.test' }, 'SETTINGS', 'PANEL_ORIGIN_INVALID'],
    ['api', { WALINE_API_ORIGIN: 'https://api.example.test/' }, 'SETTINGS', 'API_ORIGIN_INVALID'],
    ['origins', { WALINE_API_ORIGIN: 'https://panel.example.test' }, 'SETTINGS', 'ORIGINS_NOT_DISTINCT'],
    ['jwt', { WALINE_JWT_TOKEN: 'PRIVATE_SENTINEL' }, 'SETTINGS', 'JWT_FORMAT'],
    ['setup', { WALINE_SETUP_PASSWORD: 'PRIVATE_SENTINEL' }, 'SETTINGS', 'SETUP_FORMAT'],
    ['reuse', { WALINE_SETUP_PASSWORD: 'a'.repeat(64) }, 'SETTINGS', 'SECRET_REUSE'],
    ['public setup', { WALINE_MODE: 'public' }, 'SETTINGS', 'SETUP_PRESENT_IN_PUBLIC'],
    ['database URL', { WALINE_DATABASE_URL: 'PRIVATE_SENTINEL' }, 'SETTINGS', 'DATABASE_URL_INVALID'],
    ['database incomplete', { WALINE_DATABASE_URL: 'postgresql://waline_app:PRIVATE_SENTINEL@localhost/' }, 'SETTINGS', 'DATABASE_URL_INCOMPLETE'],
    ['database TLS options', { WALINE_DATABASE_URL: 'postgresql://waline_app:PRIVATE_SENTINEL@localhost/waline?sslmode=require&channel_binding=require' }, 'SETTINGS', 'DATABASE_TLS_OPTIONS'],
  ];
  for (const [name, env, stage, reason] of cases) await t.test(name, () => unavailable(invoke({ env }), stage, reason));
});

test('real loading, integrity and initialization boundaries distinguish safe failure stages', async (t) => {
  const cases = [
    ['settings module', "if (request === '../lib/settings.cjs') throw secretError('MODULE_NOT_FOUND');", 'SETTINGS_LOAD', 'MODULE_MISSING'],
    ['service module', "if (request === '../lib/service.cjs') throw secretError('MODULE_NOT_FOUND');", 'SERVICE_LOAD', 'MODULE_MISSING'],
    ['vendor file', "if (request === 'node:fs') return { ...fs, readFileSync(path, ...rest) { if (String(path).endsWith('/vendor/vendor-lock.json')) throw secretError('ENOENT'); return fs.readFileSync(path, ...rest); } };", 'VENDOR', 'FILE_MISSING'],
    ['vendor manifest', "if (request === 'node:fs') return { ...fs, readFileSync(path, ...rest) { if (String(path).endsWith('/vendor/vendor-lock.json')) return '{}'; return fs.readFileSync(path, ...rest); } };", 'VENDOR', 'VENDOR_MANIFEST'],
    ['vendor size', "if (request === 'node:fs') return { ...fs, lstatSync() { return { isFile: () => true, size: 0 }; } };", 'VENDOR', 'VENDOR_FILE_METADATA'],
    ['vendor hash', "if (request === 'node:fs') return { ...fs, readFileSync(path, ...rest) { const bytes = fs.readFileSync(path, ...rest); if (String(path).endsWith('/vendor/waline-admin-source-0.36.0.tar.gz')) { const corrupt = Buffer.from(bytes); corrupt[20] ^= 1; return corrupt; } return bytes; } };", 'VENDOR', 'VENDOR_INTEGRITY'],
    ['server metadata', "if (request === '@waline/vercel/package.json') return {};", 'SERVER_PACKAGE', 'SERVER_CONTRACT'],
    ['server loading', "if (request === '@waline/vercel') throw secretError('MODULE_NOT_FOUND');", 'SERVER_LOAD', 'MODULE_MISSING'],
    ['middleware contract', "if (request === '@waline/vercel/src/config/middleware.js') return [];", 'MIDDLEWARE', 'MIDDLEWARE_CONTRACT'],
    ['middleware shape', "if (request === '@waline/vercel/src/config/middleware.js') return {};", 'MIDDLEWARE', 'MIDDLEWARE_CONTRACT'],
    ['admin file', "if (request === 'node:fs') return { ...fs, readFileSync(path, ...rest) { if (String(path).endsWith('/admin/package.json')) throw secretError('EACCES'); return fs.readFileSync(path, ...rest); } };", 'ADMIN_ASSETS', 'FILE_DENIED'],
    ['admin integrity', "if (request === 'node:fs') return { ...fs, readFileSync(path, ...rest) { if (String(path).endsWith('/admin/package.json')) return '{}'; return fs.readFileSync(path, ...rest); } };", 'ADMIN_ASSETS', 'ADMIN_INTEGRITY'],
    ['initialization', "if (request === '@waline/vercel') return () => { throw secretError(); };", 'SERVICE_INIT', 'UNKNOWN'],
    ['request rejection', "if (request === '@waline/vercel') return () => async () => { throw secretError(); };", 'REQUEST', 'UNKNOWN'],
  ];
  for (const [name, fault, stage, reason] of cases) await t.test(name, () => unavailable(invoke({ fault }), stage, reason));
});

test('an already-started response is ended without rewriting headers or leaking diagnostics into its body', () => {
  const result = invoke({ env: { WALINE_MODE: 'PRIVATE_SENTINEL' }, committed: true });
  assert.equal(result.ended, true);
  assert.equal(result.status, undefined);
  assert.equal(result.headers, undefined);
  assert.equal(result.body, null);
  assert.match(result.log, /stage=MODE reason=MODE_INVALID\n$/);
});
