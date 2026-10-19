'use strict';

// Opt-in only. Requires a cached official PostgreSQL image and a separately
// downloaded, hash-checked upstream schema. Does not pull images or use a cloud.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, fork } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, writeFileSync, chmodSync, mkdirSync, rmSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { Client } = require('pg');
const { backup } = require('../scripts/backup.cjs');
const { databaseOptions } = require('../lib/settings.cjs');
const IMAGE = 'postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const SCHEMA_SHA = '76320860ee6205465a5868b9a0a535fc6a8061257ab80a6521e009423db6c5f2';
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const browserRequested = process.argv.includes('--browser');
if (process.argv.slice(2).some((arg) => arg !== '--browser')) throw new Error('Only --browser is supported.');
if (browserRequested && !process.env.QJ_CHROMIUM) throw new Error('Set QJ_CHROMIUM for the opt-in admin browser regression.');

function command(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${file} failed (${result.error?.code || result.status}): ${String(result.stderr || '').slice(-1800)}`);
  return result.stdout;
}

async function serve(env) {
  const child = fork(join(__dirname, 'serve.cjs'), { env: { ...process.env, ...env }, silent: true });
  const state = { child, logs: '', outbound: 0 };
  child.stdout.on('data', (data) => { state.logs += data; });
  child.stderr.on('data', (data) => { state.logs += data; });
  state.stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timer);
  };
  try {
    state.port = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Local server did not start')), 10000);
      child.on('message', (message) => {
        if (message.unexpectedFetch) state.outbound++;
        if (message.port) { clearTimeout(timer); done(message.port); }
      });
      child.once('error', (error) => { clearTimeout(timer); fail(error); });
      child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Local server exited (${code}): ${state.logs.slice(-1200)}`)); });
    });
  } catch (error) { await state.stop(); throw error; }
  state.request = async (path, { method = 'GET', data, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${state.port}${path}`, {
      method, headers: { Origin: env.WALINE_PANEL_ORIGIN, 'X-Forwarded-For': '198.51.100.10', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, headers: response.headers, body };
  };
  return state;
}

test('real Waline + local PostgreSQL: TLS, protected setup, moderation, reply, rate limit and restore', { timeout: 240000 }, async (t) => {
  const schemaPath = process.env.QJ_WALINE_SCHEMA;
  assert.ok(schemaPath && existsSync(schemaPath), 'Set QJ_WALINE_SCHEMA to the pinned upstream waline.pgsql (see README).');
  const schema = readFileSync(schemaPath);
  assert.equal(createHash('sha256').update(schema).digest('hex'), SCHEMA_SHA, 'Upstream schema hash mismatch');
  command('docker', ['image', 'inspect', IMAGE]); // Never silently pull a new image.
  const dir = mkdtempSync(join(tmpdir(), 'qj-waline-pg-'));
  const name = `qj-waline-test-${randomBytes(5).toString('hex')}`;
  const ownerPass = randomBytes(24).toString('hex'), runtimePass = randomBytes(24).toString('hex');
  const setupPassword = randomBytes(32).toString('hex'), jwt = randomBytes(32).toString('hex');
  const adminPassword = randomBytes(24).toString('hex');
  const servers = [];
  let started = false, client;
  const docker = (args, input) => command('docker', args, { input });
  const sql = (query, database = 'waline') => docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'qj_owner', '-d', database, '-At'], query);
  try {
    command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=QJ-local-test-CA', '-keyout', join(dir, 'ca.key'), '-out', join(dir, 'ca.crt')]);
    command('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', join(dir, 'server.key'), '-out', join(dir, 'server.csr')]);
    writeFileSync(join(dir, 'extensions'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
    command('openssl', ['x509', '-req', '-in', join(dir, 'server.csr'), '-CA', join(dir, 'ca.crt'), '-CAkey', join(dir, 'ca.key'), '-CAcreateserial', '-days', '1', '-extfile', join(dir, 'extensions'), '-out', join(dir, 'server.crt')]);
    const envFile = join(dir, 'postgres.env');
    writeFileSync(envFile, `POSTGRES_USER=qj_owner\nPOSTGRES_PASSWORD=${ownerPass}\nPOSTGRES_DB=waline\nPOSTGRES_HOST_AUTH_METHOD=scram-sha-256\nPOSTGRES_INITDB_ARGS=--auth-host=scram-sha-256\n`, { mode: 0o600 });
    docker(['run', '-d', '--rm', '--name', name, '--label', 'quiet-journal.test=waline', '--user', '70:70', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1', '--pids-limit', '128', '--tmpfs', '/var/lib/postgresql/data:rw,size=192m,uid=70,gid=70,mode=700', '--tmpfs', '/var/run/postgresql:rw,size=4m,uid=70,gid=70,mode=775', '--tmpfs', '/tmp:rw,size=8m,mode=1777', '--env-file', envFile, '-p', '127.0.0.1::5432', IMAGE]);
    started = true;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const result = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'qj_owner', '-d', 'waline'], { stdio: 'ignore', timeout: 5000 });
      if (result.status === 0) { ready = true; break; }
      await delay(250);
    }
    assert.ok(ready, 'Local PostgreSQL did not become ready');
    for (const file of ['ca.crt', 'server.crt', 'server.key']) docker(['exec', '-i', name, 'sh', '-c', `umask 077; dd of=/tmp/${file} status=none`], readFileSync(join(dir, file)));
    sql("ALTER SYSTEM SET ssl = on;\nALTER SYSTEM SET ssl_cert_file = '/tmp/server.crt';\nALTER SYSTEM SET ssl_key_file = '/tmp/server.key';\nSELECT pg_reload_conf();\n");
    sql(schema);
    sql(`CREATE ROLE waline_app LOGIN PASSWORD '${runtimePass}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;`);
    sql(readFileSync(join(__dirname, '../sql/indexes.sql')));
    sql(readFileSync(join(__dirname, '../sql/runtime-role.sql')));
    const port = Number(docker(['inspect', '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', name]).trim());
    const url = `postgresql://waline_app:${runtimePass}@localhost:${port}/waline?sslmode=verify-full`;
    const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
    const options = databaseOptions(url);
    client = new Client({ ...options, ssl: { ...options.ssl, ca } });
    await client.connect();
    const baseEnv = {
      WALINE_MODE: 'public', WALINE_DATABASE_URL: url, WALINE_JWT_TOKEN: jwt,
      WALINE_BLOG_ORIGIN: 'https://blog.example.test', WALINE_PANEL_ORIGIN: 'https://panel.example.test', WALINE_API_ORIGIN: 'https://api.example.test',
      NODE_EXTRA_CA_CERTS: join(dir, 'ca.crt'), TMPDIR: dir,
    };
    const start = async (env) => { const server = await serve({ ...baseEnv, ...env }); servers.push(server); return server; };
    const listPath = '/api/comment?path=%2Fposts%2Ffixed-id%2F&page=1&pageSize=10&sortBy=insertedAt_desc';
    const draft = { url: '/posts/fixed-id/', nick: 'Reader', comment: 'COMMENT_PRIVATE_MARKER <script>alert(1)</script>', mail: '', link: '', ua: '' };
    await t.test('runtime role is non-owner and cannot change schema', async () => {
      const check = await client.query('SELECT current_user, ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
      assert.equal(check.rows[0].current_user, 'waline_app');
      assert.equal(check.rows[0].ssl, true);
      await assert.rejects(() => client.query('DROP TABLE public.wl_comment'), { code: '42501' });
    });
    await t.test('untrusted certificate and wrong hostname fail through actual Waline driver', async () => {
      for (const env of [{ NODE_EXTRA_CA_CERTS: '' }, { WALINE_DATABASE_URL: url.replace('@localhost:', '@127.0.0.1:') }]) {
        const server = await start(env);
        assert.equal((await server.request('/SOURCE-waline-server.tar.gz')).status, 200, 'The service must initialize before a TLS-negative result counts as a driver rejection');
        const response = await server.request(listPath);
        assert.equal(response.status, 503, JSON.stringify(response.body) + server.logs.slice(-1800));
        assert.doesNotMatch(JSON.stringify(response.body), /stack|password|postgresql:\/\//i);
        await server.stop();
      }
    });
    const setup = await start({ WALINE_MODE: 'bootstrap', WALINE_SETUP_PASSWORD: setupPassword });
    const setupHeaders = { Origin: baseEnv.WALINE_API_ORIGIN, Authorization: 'Basic ' + Buffer.from(`setup:${setupPassword}`).toString('base64') };
    await t.test('setup is protected, concurrent initialization creates only one administrator, and later registration is refused', async () => {
      assert.equal((await setup.request('/api/user', { method: 'POST', data: {} })).status, 401);
      const data = { email: 'owner@example.invalid', password: adminPassword, display_name: 'Author' };
      const attempts = await Promise.all(Array.from({ length: 2 }, () => setup.request('/api/user', { method: 'POST', data, headers: setupHeaders })));
      const users = (await client.query('SELECT type FROM wl_users')).rows;
      assert.deepEqual(users, [{ type: 'administrator' }], 'Initialization must be single-account even across concurrent requests');
      assert.equal(attempts.filter((response) => response.body.errno === 0).length, 1);
      assert.equal(attempts.find((response) => response.body.errno === 0).body.data.verify, false);
      assert.equal((await setup.request('/api/user', { method: 'POST', data: { ...data, email: 'other@example.invalid' }, headers: setupHeaders })).status, 409);
    });
    await setup.stop();
    const server = await start({ WALINE_SETUP_PASSWORD: '' });
    let commentId, token;
    await t.test('no-referrer same-origin reads work without Origin; management windows and redirects stay isolated', async () => {
      const session = await server.request('/api/token?lang=en-US', { headers: { Origin: '' } });
      assert.equal(session.status, 200, 'Browsers omit Origin on same-origin GET');
      assert.equal(session.body.errno, 0);
      assert.equal(session.headers.get('cross-origin-opener-policy'), 'same-origin');
      assert.equal(session.headers.get('x-waline-version'), null, 'The optional version header triggers an unwanted automatic admin update check');
      assert.equal((await server.request('/ui/login?redirect=https%3A%2F%2Fother.example.test')).status, 400);
    });
    await t.test('corresponding source downloads are same-origin, bounded and independent of account data', async () => {
      const { readVendor, digest } = require('../lib/vendor.cjs');
      const vendor = readVendor();
      for (const [path, expected] of [['/SOURCE-waline-admin.tar.gz', vendor.adminSource], ['/SOURCE-waline-server.tar.gz', vendor.serverSource]]) {
        const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /application\/gzip/);
        assert.match(response.headers.get('content-disposition'), /^attachment;/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(digest(bytes), digest(expected));
        assert.ok(bytes.length <= 4 * 1024 * 1024);
      }
    });
    await t.test('public registration, origin spoofing, query-method bypass, non-JSON and oversized input are rejected', async () => {
      for (const path of ['/api/user', '/user', '/api/user/', '/api/%75ser', '/api/oauth', '/api/token/password']) assert.notEqual((await server.request(path, { method: 'POST', data: {} })).status, 200);
      assert.equal((await server.request('/api/comment?method=DELETE', { method: 'POST', data: draft })).status, 400);
      assert.equal((await server.request(listPath, { headers: { Origin: 'https://evil.example.test' } })).status, 403);
      assert.equal((await server.request('/api/comment', { method: 'POST', data: draft, headers: { 'Content-Type': 'text/plain' } })).status, 415);
      assert.equal((await server.request('/api/comment', { method: 'POST', data: { ...draft, comment: 'x'.repeat(13000) } })).status, 413);
    });
    await t.test('anonymous submission is waiting, invisible publicly, and serial per-IP throttling rejects the next write', async () => {
      const response = await server.request('/api/comment', { method: 'POST', data: { ...draft, status: 'approved', user_id: 1 } });
      assert.equal(response.body.errno, 0, JSON.stringify(response.body) + server.logs.slice(-1800));
      commentId = String(response.body.data.objectId);
      assert.equal(response.body.data.status, 'waiting');
      assert.equal((await server.request(listPath)).body.data.count, 0);
      const tooFast = await server.request('/api/comment', { method: 'POST', data: { ...draft, comment: 'Second comment' } });
      assert.notEqual(tooFast.body.errno, 0);
      assert.equal(Number((await client.query('SELECT count(*) FROM wl_comment')).rows[0].count), 1);
      const denied = await server.request('/api/comment/' + commentId, { method: 'PUT', data: { status: 'approved' } });
      assert.equal(denied.status, 401);
    });
    await t.test('author login, approval and reply use real upstream permissions; Markdown is sanitized', async () => {
      const login = await server.request('/api/token', { method: 'POST', data: { email: 'owner@example.invalid', password: adminPassword }, headers: { Origin: baseEnv.WALINE_API_ORIGIN } });
      assert.equal(login.body.errno, 0, JSON.stringify(login.body) + server.logs.slice(-1200));
      token = login.body.data.token;
      assert.ok(token);
      const headers = { Origin: baseEnv.WALINE_API_ORIGIN, Authorization: `Bearer ${token}` };
      assert.equal((await server.request('/api/comment/' + commentId, { method: 'PUT', data: { status: 'approved' }, headers })).body.errno, 0);
      const list = await server.request(listPath);
      assert.equal(list.body.data.count, 1);
      assert.doesNotMatch(list.body.data.data[0].comment, /<script/i);
      assert.equal(list.body.data.data[0].avatar, `${baseEnv.WALINE_API_ORIGIN}/avatar.svg`);
      const reply = await server.request('/api/comment', { method: 'POST', data: { url: draft.url, comment: 'Author reply', pid: commentId, rid: commentId }, headers });
      assert.equal(reply.body.errno, 0, JSON.stringify(reply.body) + server.logs.slice(-1200));
      assert.equal(reply.body.data.status, 'approved');
      assert.equal(reply.body.data.type, 'administrator');
      assert.equal((await server.request(listPath)).body.data.data[0].children.length, 1);
      const other = await server.request('/api/comment', { method: 'POST', data: { ...draft, url: '/posts/other/', comment: 'Cross-article reply', pid: commentId, rid: commentId }, headers: { 'X-Forwarded-For': '198.51.100.21' } });
      assert.notEqual(other.body.errno, 0);
    });
    await t.test('manual archive restores into an empty independent database, preserving moderation and relationships', async () => {
      assert.equal((await server.request('/api/comment', { method: 'POST', data: { ...draft, comment: 'Still waiting' }, headers: { 'X-Forwarded-For': '198.51.100.22' } })).body.errno, 0);
      const executable = join(dir, 'pg-dump-container');
      writeFileSync(executable, `#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process'); const r=spawnSync('docker',['exec','--env','PGHOST=localhost','--env','PGPORT=5432','--env','PGUSER','--env','PGPASSWORD','--env','PGDATABASE','--env','PGSSLMODE','--env','PGCHANNELBINDING','--env','PGSSLROOTCERT=/tmp/ca.crt',${JSON.stringify(name)},'pg_dump',...process.argv.slice(2)],{stdio:'inherit'}); process.exit(r.status === null ? 1 : r.status);\n`, { mode: 0o700 });
      const file = join(dir, 'comments.dump');
      await backup({ url: `postgresql://qj_owner:${ownerPass}@localhost/waline?sslmode=verify-full`, output: file, executable, env: { ...process.env, WALINE_BACKUP_CA_FILE: join(dir, 'ca.crt') } });
      sql('CREATE DATABASE waline_restore;', 'postgres');
      docker(['exec', '-i', name, 'pg_restore', '-U', 'qj_owner', '-d', 'waline_restore', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error'], readFileSync(file));
      const snapshot = "SELECT json_build_object('comments', (SELECT json_agg(c ORDER BY id) FROM wl_comment c), 'users', (SELECT json_agg(u ORDER BY id) FROM wl_users u), 'counter', (SELECT json_agg(n ORDER BY id) FROM wl_counter n));";
      assert.deepEqual(JSON.parse(sql(snapshot, 'waline_restore')), JSON.parse(sql(snapshot)));
      const duplicate = spawnSync('docker', ['exec', '-i', name, 'pg_restore', '-U', 'qj_owner', '-d', 'waline_restore', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error'], { input: readFileSync(file), stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
      assert.notEqual(duplicate.status, 0, 'Restoring onto existing tables must fail instead of overwriting');
      assert.deepEqual(JSON.parse(sql(snapshot, 'waline_restore')), JSON.parse(sql(snapshot)));
    });
    if (browserRequested) await t.test('fixed admin in a real browser: registration, opener isolation, login, moderation and reply', { timeout: 100000 }, async () => {
      const { checkAdmin } = await import('./admin-browser.mjs');
      sql('CREATE DATABASE waline_browser;', 'postgres');
      for (const source of [schema, readFileSync(join(__dirname, '../sql/indexes.sql')), readFileSync(join(__dirname, '../sql/runtime-role.sql'))]) sql(source, 'waline_browser');
      const browserURL = new URL(url); browserURL.pathname = '/waline_browser';
      await checkAdmin({
        tls: { key: readFileSync(join(dir, 'server.key')), cert: readFileSync(join(dir, 'server.crt')) },
        start, databaseURL: browserURL.href, email: 'browser-owner@example.invalid', password: adminPassword, setupPassword,
      });
      assert.equal(sql("SELECT count(*) FROM wl_users WHERE type = 'administrator';", 'waline_browser').trim(), '1');
    });
    await t.test('no external fetch, raw database connection/password logs or persisted startup secrets', async () => {
      for (const service of servers) {
        assert.equal(service.outbound, 0);
        for (const secret of [runtimePass, ownerPass, jwt, setupPassword, adminPassword, 'COMMENT_PRIVATE_MARKER']) assert.ok(!service.logs.includes(secret), 'Sensitive value leaked into server log');
        assert.doesNotMatch(service.logs, /SQL:|postgresql:\/\/|GET \/api\/|POST \/api\//);
      }
      const persisted = readFileSync(join(dir, 'runtime/config/vercel.json'), 'utf8');
      for (const secret of [runtimePass, ownerPass, jwt, setupPassword]) assert.ok(!persisted.includes(secret));
    });
  } finally {
    for (const server of servers) await server.stop();
    if (client) await client.end();
    if (started) {
      const result = spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 20000 });
      if (result.status !== 0 && !/No such container/.test(result.stderr || '')) throw new Error(`Cleanup incomplete: remove local test container ${name}`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
