'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

// A fresh process must exercise the actual Vercel entrypoint, not just mode().
// No third-party server, socket, database or cloud resource is needed here.
function invoke(env) {
  const script = `
    const handler = require(${JSON.stringify(join(__dirname, '../api/index.js'))});
    const response = {
      headersSent: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
      end(body) { this.body = body; },
    };
    handler({ method: 'POST', url: '/api/user', headers: {} }, response).then(() => {
      process.stdout.write(JSON.stringify({
        status: response.status, headers: response.headers, body: JSON.parse(response.body),
        loadedServer: Object.keys(require.cache).some((path) => path.includes('/node_modules/@waline/')),
        loadedWrapper: Object.keys(require.cache).some((path) => path.endsWith('/lib/service.cjs')),
      }));
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout), stderr: result.stderr };
}

function unavailable(result) {
  assert.equal(result.status, 503);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(result.body.errno, 503);
  assert.match(result.body.errmsg, /may already have been saved.*do not automatically retry/);
  assert.equal(result.loadedServer, false);
}

test('the real default-locked entrypoint refuses registration without loading Waline or requiring credentials', () => {
  for (const env of [{}, { WALINE_MODE: 'locked', WALINE_DATABASE_URL: 'PRIVATE_LOCKED_SENTINEL' }]) {
    const result = invoke(env);
    unavailable(result);
    assert.equal(result.loadedWrapper, false);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_LOCKED_SENTINEL/);
  }
});

test('invalid mode or active settings fail closed before Waline loads, with redacted diagnostics', () => {
  for (const env of [
    { WALINE_MODE: 'PRIVATE_INVALID_MODE' },
    { WALINE_MODE: 'public', WALINE_DATABASE_URL: 'PRIVATE_DB_SENTINEL' },
    { WALINE_MODE: 'bootstrap', SMTP_PASS: 'PRIVATE_MAIL_SENTINEL' },
    { WALINE_MODE: 'public', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  ]) {
    const result = invoke(env);
    unavailable(result);
    assert.match(result.stderr, /configuration or initialization failed; details suppressed/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_(?:INVALID_MODE|DB_SENTINEL|MAIL_SENTINEL)/);
  }
});
