'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settings, mode, databaseOptions } = require('../lib/settings.cjs');
const { strictModel } = require('../lib/service.cjs');
const { setupAuthorized, routeAllowed, validation, validateReply } = require('../lib/policy.cjs');
const environment = () => ({
  WALINE_MODE: 'public', WALINE_DATABASE_URL: 'postgresql://runtime:secret-pass@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=verify-full',
  WALINE_JWT_TOKEN: 'a'.repeat(64), WALINE_BLOG_ORIGIN: 'https://blog.example.test',
  WALINE_PANEL_ORIGIN: 'https://panel.example.test', WALINE_API_ORIGIN: 'https://api.example.test',
});

test('configuration is locked by default and uses three separate HTTPS origins', () => {
  assert.equal(mode({}), 'locked');
  assert.throws(() => mode({ WALINE_MODE: 'on' }));
  assert.equal(settings(environment()).mode, 'public');
  for (const value of ['http://api.example.test', 'https://api.example.test/path', 'https://u:secret@api.example.test', 'https://panel.example.test']) assert.throws(() => settings({ ...environment(), WALINE_API_ORIGIN: value }));
});

test('PostgreSQL TLS verification cannot be replaced by URL options or global bypass', () => {
  const db = settings(environment()).database;
  assert.deepEqual(db.ssl, { rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  assert.equal(db.connectionString, undefined);
  assert.equal(db.max, 1);
  assert.equal(db.logSql, false);
  assert.equal(db.logConnect, false);
  assert.equal(db.enableChannelBinding, true);
  for (const suffix of ['', '?sslmode=require', '?sslmode=disable', '?sslmode=verify-ca', '?sslmode=verify-full&sslmode=disable', '?sslmode=verify-full&sslrootcert=evil', '?sslmode=verify-full&channel_binding=require', '?sslmode=verify-full&options=-c+statement_timeout=0']) assert.throws(() => databaseOptions('postgresql://u:hidden@localhost/db' + suffix));
  for (const bad of ['not a url SECRET_MARKER', 'postgresql://u:SECRET_MARKER@localhost/', 'postgresql://u:SECRET_MARKER@localhost/db?sslmode=verify-full#token']) {
    assert.throws(() => databaseOptions(bad), (error) => !error.message.includes('SECRET_MARKER'));
  }
  assert.throws(() => settings({ ...environment(), NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /bypass/);
});

test('no email, webhook, OAuth, unexpected storage configuration or reused setup secret', () => {
  for (const name of ['SMTP_HOST', 'SMTP_PASS', 'WEBHOOK', 'OAUTH_URL', 'TG_BOT_TOKEN', 'SC_KEY', 'GITHUB_TOKEN', 'PG_PASSWORD', 'POSTGRES_URL', 'MONGO_DB', 'TURNSTILE_SECRET', 'LOGIN', 'COMMENT_AUDIT', 'IPQPS', 'MARKDOWN_CONFIG', 'MARKDOWN_MATHJAX', 'MAIL_TEMPLATE', 'SQLITE_PATH', 'TENCENTCLOUD_SECRETKEY', 'AVATAR_PROXY', 'GRAVATAR_STR', 'SECURE_DOMAINS', 'WALINE_BACKUP_DATABASE_URL']) {
    assert.throws(() => settings({ ...environment(), [name]: 'DO_NOT_PRINT_SECRET' }), (error) => error.message.includes(name) && !error.message.includes('DO_NOT_PRINT_SECRET'));
  }
  assert.throws(() => settings({ ...environment(), WALINE_MODE: 'bootstrap' }), /setup|SETUP/);
  assert.throws(() => settings({ ...environment(), WALINE_MODE: 'bootstrap', WALINE_SETUP_PASSWORD: 'a'.repeat(64) }), /different/);
  assert.throws(() => settings({ ...environment(), WALINE_SETUP_PASSWORD: 'b'.repeat(64) }), /Remove/);
  assert.equal(settings({ ...environment(), WALINE_MODE: 'bootstrap', WALINE_SETUP_PASSWORD: 'b'.repeat(64) }).setupPassword, 'b'.repeat(64));
});

test('official custom-model hook reuses storage and supplies strict options to every model', () => {
  const calls = [], database = settings(environment()).database;
  const controller = {
    service(type, name) { calls.push([type, name]); return {}; },
    model(name, config) { calls.push([name, config]); return 'strict-model'; },
  };
  const storage = strictModel(database)('Comment', controller);
  assert.equal(storage.model('Comment'), 'strict-model');
  assert.deepEqual(calls, [['storage/postgresql', 'Comment'], ['comment', { type: 'postgresql', postgresql: database }]]);
  const { parseAdapterConfig } = require('think-helper');
  const effective = parseAdapterConfig({ type: 'postgresql', postgresql: { host: 'wrong', ssl: { rejectUnauthorized: false }, logSql: true, logConnect: true } }, calls[1][1]);
  assert.equal(effective.host, database.host);
  assert.equal(effective.ssl.rejectUnauthorized, true);
  assert.equal(effective.logSql, false);
  assert.equal(effective.logConnect, false);
});

test('setup uses its own Basic credential; normal public registration and alternate routes are closed', () => {
  const password = 'b'.repeat(64), basic = 'Basic ' + Buffer.from(`setup:${password}`).toString('base64');
  assert.equal(setupAuthorized(basic, password), true);
  for (const header of [undefined, '', basic + 'bad', 'Bearer ' + password, 'Basic ' + Buffer.from(`wrong:${password}`).toString('base64')]) assert.equal(setupAuthorized(header, password), false);
  assert.equal(routeAllowed('/api/user', 'POST', 'bootstrap'), true);
  assert.equal(routeAllowed('/api/user', 'POST', 'public'), false);
  assert.equal(routeAllowed('/ui/register/', 'GET', 'public'), false);
  assert.equal(routeAllowed('/api/token/2fa', 'GET', 'public'), true);
  for (const path of ['/user', '/api/User', '/api/user/', '/api/user/123', '/api/%75ser', '/api/oauth', '/api/token/password', '/api/verification', '/api/db', '/api/article', '/api/comment/rss']) assert.equal(routeAllowed(path, 'POST', 'public'), false);
});

function context(path, method, data, admin = false) {
  return { path, method, query: {}, state: { userInfo: admin ? { type: 'administrator' } : {} }, request: { body: { post: data } } };
}

test('server validates anonymous text and identities rather than trusting the isolated client', async () => {
  const check = validation(settings(environment()));
  let calls = 0;
  const raw = { url: '/posts/fixed-id/', nick: 'reader', comment: 'Hello', mail: '', role: 'administrator', user_id: 1, status: 'approved' };
  const valid = context('/api/comment', 'POST', raw);
  await check(valid, () => { calls++; });
  assert.equal(calls, 1);
  assert.deepEqual(valid.request.body.post, { url: raw.url, nick: 'reader', comment: 'Hello', mail: '', link: '', ua: '' });
  for (const change of [{ url: '/posts/../' }, { comment: 'x'.repeat(2001) }, { nick: 'x'.repeat(61) }, { mail: 'not-accepted@example.test' }, { pid: '1' }, { rid: '1;sql', pid: '1' }]) {
    const ctx = context('/api/comment', 'POST', { ...raw, ...change });
    await check(ctx, () => assert.fail('Invalid request reached Waline controller'));
    assert.equal(ctx.status, 400);
  }
});

test('anonymous pagination is bounded and admin mutation requires verified admin state', async () => {
  const check = validation(settings(environment()));
  for (const query of [{ type: 'list' }, { path: '/posts/a/', page: '1', pageSize: '100' }, { path: '/posts/a/', page: ['1', '2'], pageSize: '10' }, { path: ['/posts/a/'], page: '1', pageSize: '10' }, { path: '/posts/a/', page: ['1'], pageSize: '10' }, { path: '/posts/' + 'a'.repeat(256) + '/', page: '1', pageSize: '10' }]) {
    const ctx = { ...context('/api/comment', 'GET'), query };
    await check(ctx, () => assert.fail('Unbounded query reached controller'));
    assert.equal(ctx.status, 400);
  }
  const edit = context('/api/comment/1', 'PUT', { status: 'approved' });
  await check(edit, () => assert.fail('Unauthenticated edit reached controller'));
  assert.equal(edit.status, 401);
});

test('reply hook rejects cross-article, missing or unapproved parents and wrong root IDs', async () => {
  const comment = { url: '/posts/a/', pid: '7', rid: '5' };
  const parent = { objectId: '7', rid: '5', url: '/posts/a/', status: 'approved' };
  const call = (value, admin = false) => validateReply.call({ getModel: () => ({ select: async () => value ? [value] : [] }), ctx: { state: { userInfo: admin ? { type: 'administrator' } : {} } } }, comment);
  assert.equal(await call(parent), undefined);
  for (const value of [null, { ...parent, url: '/posts/b/' }, { ...parent, rid: '8' }, { ...parent, status: 'waiting' }]) assert.equal(typeof await call(value), 'string');
  assert.equal(await call({ ...parent, status: 'waiting' }, true), undefined);
});
