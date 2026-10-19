'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boundary, MAX_BODY, MAX_RESPONSE } = require('../lib/policy.cjs');
const config = {
  mode: 'public', blogOrigin: 'https://blog.example.test',
  panelOrigin: 'https://panel.example.test', apiOrigin: 'https://api.example.test',
};
const resources = { admin: Buffer.from('pinned-admin'), css: 'local styles', avatar: '<svg/>', license: 'upstream license', ownLicense: 'wrapper license', adminSource: Buffer.from('admin source'), serverSource: Buffer.from('server source') };
function context(url, method = 'GET', headers = {}, query) {
  const parsed = new URL(url, config.apiOrigin);
  const response = new Map();
  return {
    path: parsed.pathname, method, query: query || Object.fromEntries(parsed.searchParams),
    req: { url, headers }, request: {}, state: {}, status: 200, response,
    get: (name) => headers[name.toLowerCase()] || '',
    set: (name, value) => response.set(name.toLowerCase(), value),
    remove: (name) => response.delete(name.toLowerCase()), vary: () => {},
  };
}
const denied = () => assert.fail('Denied request reached upstream');

test('default locked boundary and all responses isolate the management opener', async () => {
  const ctx = context('/ui');
  await boundary({ ...config, mode: 'locked' }, resources)(ctx, denied);
  assert.equal(ctx.status, 503);
  assert.equal(ctx.response.get('cache-control'), 'no-store');
  assert.equal(ctx.response.get('cross-origin-opener-policy'), 'same-origin');
  assert.match(ctx.response.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('exact CORS origins remain anonymous and upstream cannot re-enable credentials', async () => {
  const handle = boundary(config, resources);
  for (const origin of [config.blogOrigin, 'https://panel.example.test:444', 'null']) {
    const ctx = context('/api/comment', 'GET', { origin });
    await handle(ctx, denied);
    assert.equal(ctx.status, 403);
    assert.equal(ctx.response.get('access-control-allow-origin'), undefined);
  }
  for (const credentials of [{ authorization: 'Bearer FAKE' }, { cookie: 'FAKE=1' }]) {
    const ctx = context('/api/comment', 'GET', { origin: config.panelOrigin, ...credentials });
    await handle(ctx, denied); assert.equal(ctx.status, 403);
  }
  const ctx = context('/api/comment', 'GET', { origin: config.panelOrigin });
  await handle(ctx, () => { ctx.body = { errno: 0 }; ctx.set('Access-Control-Allow-Origin', '*'); ctx.set('Access-Control-Allow-Credentials', 'true'); });
  assert.equal(ctx.response.get('access-control-allow-origin'), config.panelOrigin);
  assert.equal(ctx.response.get('access-control-allow-credentials'), undefined);
});

test('management redirect and URL token channels cannot send credentials to another site', async () => {
  const handle = boundary(config, resources);
  for (const url of ['/ui/login?redirect=https%3A%2F%2Fattacker.example.test%2Fcapture', '/ui/login?redirect=%2F%2Fattacker.example.test', '/ui/login?redirect=%2Fui%3Ftoken%3Dsecret', '/ui/login?token=secret', '/ui/login?STATE=secret', '/api/comment?method=delete']) {
    const ctx = context(url); await handle(ctx, denied);
    assert.equal(ctx.status, 400, url);
  }
  const duplicate = context('/ui/login', 'GET', {}, { redirect: ['/ui', '/ui/profile'] });
  await handle(duplicate, denied); assert.equal(duplicate.status, 400);
  const internal = context('/ui/login?redirect=%2Fui%2Fprofile');
  await handle(internal, denied);
  assert.equal(internal.status, 200); assert.equal(internal.type, 'html');
});

test('bootstrap protects static files and strips only the temporary Basic credential', async () => {
  const password = 'b'.repeat(64);
  const handle = boundary({ ...config, mode: 'bootstrap', setupPassword: password }, resources);
  const blocked = context('/admin.js'); await handle(blocked, denied);
  assert.equal(blocked.status, 401); assert.match(blocked.response.get('www-authenticate'), /^Basic /);
  const headers = { authorization: 'Basic ' + Buffer.from(`setup:${password}`).toString('base64') };
  const allowed = context('/api/user', 'POST', { ...headers, 'content-type': 'application/json' });
  let count = 0;
  await handle(allowed, () => { count++; assert.equal(allowed.req.headers.authorization, undefined); });
  assert.equal(count, 1);
});

test('local management resources use the isolated shell without unavailable mail or migration pages', async () => {
  const handle = boundary(config, resources);
  const html = context('/ui/login'); await handle(html, denied);
  assert.match(html.body, /href="\/admin\.css"/);
  assert.match(html.body, /href="\/avatar\.svg"/);
  assert.doesNotMatch(html.body, /https:\/\/|<script>/);
  for (const [url, value] of [['/SOURCE-waline-admin.tar.gz', resources.adminSource], ['/SOURCE-waline-server.tar.gz', resources.serverSource]]) {
    assert.ok(html.body.includes(`href="${url}"`));
    const ctx = context(url); await handle(ctx, denied);
    assert.equal(ctx.body, value); assert.equal(ctx.type, 'application/gzip');
    assert.match(ctx.response.get('content-disposition'), /^attachment;/);
    const mutation = context(url, 'POST'); await handle(mutation, denied); assert.equal(mutation.status, 403);
  }
  for (const [url, value] of [['/admin.css', resources.css], ['/avatar.svg', resources.avatar], ['/LICENSE-quiet-journal.txt', resources.ownLicense]]) {
    const ctx = context(url); await handle(ctx, denied); assert.equal(ctx.body, value);
  }
  for (const url of ['/ui/register', '/ui/forgot', '/ui/migration', '/api/db', '/api/article', '/api/oauth', '/api/user/password']) {
    const ctx = context(url); await handle(ctx, denied); assert.equal(ctx.status, 403, url);
  }
});

test('preflights, content type, encoding and declared payload limits are checked before parsing', async () => {
  const handle = boundary(config, resources);
  const preflight = context('/api/comment', 'OPTIONS', { origin: config.panelOrigin, 'access-control-request-method': 'POST' });
  await handle(preflight, denied); assert.equal(preflight.status, 204);
  for (const [headers, status] of [[{ 'content-type': 'text/plain' }, 415], [{ 'content-type': 'application/json', 'content-encoding': 'gzip' }, 415], [{ 'content-type': 'application/json', 'content-length': String(MAX_BODY + 1) }, 413]]) {
    const ctx = context('/api/comment', 'POST', headers); await handle(ctx, denied); assert.equal(ctx.status, status);
  }
});

test('upstream failure and oversized responses do not leak diagnostics or encourage retrying writes', async () => {
  const handle = boundary(config, resources);
  for (const [status, body, expected] of [[500, 'PRIVATE_SQL_MARKER', 503], [200, 'x'.repeat(MAX_RESPONSE + 1), 502]]) {
    const ctx = context('/api/comment');
    await handle(ctx, () => { ctx.status = status; ctx.body = body; });
    assert.equal(ctx.status, expected);
    assert.doesNotMatch(JSON.stringify(ctx.body), /PRIVATE_SQL_MARKER/);
    assert.match(ctx.body.errmsg, /may already have been saved/);
  }
});
