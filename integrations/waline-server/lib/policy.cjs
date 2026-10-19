'use strict';

const { timingSafeEqual } = require('node:crypto');
const MAX_BODY = 12288;
const MAX_RESPONSE = 1048576;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const ID = /^[1-9]\d{0,9}$/;
const KEY = /^\/posts\/[\p{L}\p{N}_-]+\/$/u;
const MANAGEMENT = new Set(['/ui', '/ui/user', '/ui/profile']);
const articleKey = (value) => typeof value === 'string' && KEY.test(value) && [...value].length <= 255;

function reject(ctx, status, message) {
  ctx.status = status;
  ctx.body = { errno: status, errmsg: message };
}

function setupAuthorized(header, password) {
  if (typeof header !== 'string' || header.length > 512 || !header.startsWith('Basic ')) return false;
  const encoded = header.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const expected = Buffer.from(`setup:${password}`);
  const received = Buffer.from(encoded, 'base64');
  return received.toString('base64') === encoded && expected.length === received.length && timingSafeEqual(expected, received);
}

function routeAllowed(path, method, access) {
  if (['/', '/robots.txt', '/admin.js', '/admin-config.js', '/admin.css', '/avatar.svg', '/LICENSE-waline-admin.txt', '/LICENSE-quiet-journal.txt', '/SOURCE-waline-admin.tar.gz', '/SOURCE-waline-server.tar.gz'].includes(path)) return ['GET', 'HEAD'].includes(method);
  const ui = path.replace(/\/$/, '');
  if (MANAGEMENT.has(ui) || ui === '/ui/login' || (ui === '/ui/register' && access === 'bootstrap')) return ['GET', 'HEAD'].includes(method);
  if (path === '/api/comment') return ['GET', 'POST'].includes(method);
  if (/^\/api\/comment\/[1-9]\d{0,9}$/.test(path)) return ['PUT', 'DELETE'].includes(method);
  if (path === '/api/token') return ['GET', 'POST', 'DELETE'].includes(method);
  if (path === '/api/token/2fa') return ['GET', 'POST'].includes(method);
  if (path === '/api/user') return ['GET', 'PUT'].includes(method) || (method === 'POST' && access === 'bootstrap');
  if (/^\/api\/user\/[1-9]\d{0,9}$/.test(path)) return ['PUT', 'DELETE'].includes(method);
  return false;
}

function boundary(config, resources) {
  const origins = new Set([config.apiOrigin, config.panelOrigin]);
  return async function isolatedWaline(ctx, next) {
    ctx.set('Cache-Control', 'no-store');
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('Referrer-Policy', 'no-referrer');
    // Upstream admin sends tokens to window.opener. Keep cross-origin openers out
    // of its browsing context group; frame-ancestors alone does not do this.
    ctx.set('Cross-Origin-Opener-Policy', 'same-origin');
    ctx.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    ctx.set('Content-Security-Policy', CSP);
    ctx.state.oauthServices = [];
    const origin = ctx.get('origin');
    const cors = () => {
      ctx.remove('Access-Control-Allow-Credentials');
      ctx.remove('Access-Control-Allow-Origin');
      ctx.vary('Origin');
      if (origins.has(origin)) ctx.set('Access-Control-Allow-Origin', origin);
    };
    cors();
    if (config.mode === 'locked') return reject(ctx, 503, 'Comment service is not open.');
    if (origin && !origins.has(origin)) return reject(ctx, 403, 'Origin not allowed.');
    if (origin === config.panelOrigin && (ctx.get('authorization') || ctx.get('cookie'))) return reject(ctx, 403, 'The reader panel must be anonymous.');
    const rawPath = ctx.req.url.split('?')[0];
    if (ctx.req.url.length > 4096 || rawPath !== ctx.path || /[%\\]/.test(rawPath) || Object.keys(ctx.query).some((key) => ['method', 'state', 'token'].includes(key.toLowerCase())) || ctx.get('x-http-method-override')) return reject(ctx, 400, 'Non-canonical route or token/method query rejected.');
    // The upstream login redirect can append a token to a referrer-matching URL.
    // Only its own management paths are needed; never accept external redirects.
    if (Object.hasOwn(ctx.query, 'redirect') && !MANAGEMENT.has(ctx.query.redirect)) return reject(ctx, 400, 'Only same-service management redirects are supported.');
    if (ctx.method === 'OPTIONS') {
      if (!origin || !routeAllowed(ctx.path, ctx.get('access-control-request-method'), config.mode)) return reject(ctx, 403, 'Preflight not allowed.');
      ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      ctx.status = 204;
      return;
    }
    if (config.mode === 'bootstrap') {
      if (!setupAuthorized(ctx.get('authorization'), config.setupPassword)) {
        ctx.set('WWW-Authenticate', 'Basic realm="Waline setup", charset="UTF-8"');
        return reject(ctx, 401, 'Protected setup: use the separate setup credential.');
      }
      // This temporary HTTP credential is not a Waline login token.
      delete ctx.req.headers.authorization;
    }
    if (!routeAllowed(ctx.path, ctx.method, config.mode)) return reject(ctx, 403, 'Endpoint disabled. Public registration, OAuth, mail recovery and statistics are not available.');
    if (['POST', 'PUT'].includes(ctx.method)) {
      if (!/^application\/json(?:\s*;|$)/i.test(ctx.get('content-type')) || (ctx.get('content-encoding') && ctx.get('content-encoding') !== 'identity')) return reject(ctx, 415, 'Only uncompressed JSON is accepted.');
      const length = ctx.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return reject(ctx, 413, 'Request exceeds 12 KiB.');
    }
    if (ctx.path === '/') { ctx.type = 'text'; ctx.body = 'Independent Waline comment service.'; return; }
    if (ctx.path === '/robots.txt') { ctx.type = 'text'; ctx.body = 'User-agent: *\nDisallow: /\n'; return; }
    if (ctx.path === '/admin.js') { ctx.type = 'application/javascript'; ctx.body = resources.admin; return; }
    if (ctx.path === '/admin.css') { ctx.type = 'text/css'; ctx.body = resources.css; return; }
    if (ctx.path === '/avatar.svg') { ctx.type = 'image/svg+xml'; ctx.body = resources.avatar; return; }
    if (ctx.path === '/LICENSE-waline-admin.txt') { ctx.type = 'text'; ctx.body = resources.license; return; }
    if (ctx.path === '/LICENSE-quiet-journal.txt') { ctx.type = 'text'; ctx.body = resources.ownLicense; return; }
    if (ctx.path === '/SOURCE-waline-admin.tar.gz' || ctx.path === '/SOURCE-waline-server.tar.gz') {
      const admin = ctx.path === '/SOURCE-waline-admin.tar.gz';
      ctx.type = 'application/gzip';
      ctx.set('Content-Disposition', `attachment; filename="waline-${admin ? 'admin-0.36.0' : 'server-1.43.4'}-source.tar.gz"`);
      ctx.body = admin ? resources.adminSource : resources.serverSource;
      return;
    }
    if (ctx.path === '/admin-config.js') {
      ctx.type = 'application/javascript';
      const values = { SITE_URL: config.blogOrigin, SITE_NAME: 'Journal', serverURL: `${config.apiOrigin}/api/`, oauthServices: [] };
      ctx.body = Object.entries(values).map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`).join('\n');
      return;
    }
    if (ctx.path.startsWith('/ui')) {
      ctx.type = 'html';
      const notice = config.mode === 'bootstrap'
        ? '受保护的初始化：只注册一个作者账号。完成后关闭本窗口，再按部署说明切换模式。'
        : '作者管理端：未启用邮件找回密码，数据库备份使用本地工具。';
      ctx.body = `<!doctype html><html lang="zh-CN" data-mode="${config.mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Waline 管理</title><link rel="icon" href="/avatar.svg" type="image/svg+xml"><link rel="stylesheet" href="/admin.css"></head><body><p class="qj-admin-notice">${notice}</p><p class="qj-admin-license"><a href="/LICENSE-waline-admin.txt" rel="license">Waline · GPL-2.0</a> · <a href="/SOURCE-waline-admin.tar.gz">管理端源码</a> · <a href="/SOURCE-waline-server.tar.gz">服务端源码</a> · <a href="/LICENSE-quiet-journal.txt" rel="license">包装代码 MIT</a></p><script src="/admin-config.js"></script><script src="/admin.js"></script></body></html>`;
      return;
    }
    await next();
    cors();
    if (ctx.status >= 500) return reject(ctx, 503, 'Comment service failed. A write may already have been saved; do not automatically retry.');
    if (ctx.body != null && Buffer.byteLength(typeof ctx.body === 'object' && !Buffer.isBuffer(ctx.body) ? JSON.stringify(ctx.body) : ctx.body) > MAX_RESPONSE) return reject(ctx, 502, 'Response exceeds 1 MiB. A write may already have been saved; do not automatically retry.');
  };
}

function validation(config) {
  return async function validateWalineInput(ctx, next) {
    const admin = ctx.state.userInfo?.type === 'administrator';
    const create = ctx.path === '/api/comment' && ctx.method === 'POST';
    if (['POST', 'PUT'].includes(ctx.method)) {
      const data = ctx.request.body?.post;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > MAX_BODY || Object.hasOwn(data, 'method')) return reject(ctx, 400, 'Invalid JSON object.');
    }
    if (create) {
      const data = ctx.request.body.post;
      if (!articleKey(data.url) || typeof data.comment !== 'string' || !data.comment.trim() || [...data.comment].length > 2000 || (!admin && (typeof data.nick !== 'string' || !data.nick.trim() || [...data.nick].length > 60))) return reject(ctx, 400, 'Invalid article key, nickname or comment (maximum 2000 characters).');
      if ((data.pid || data.rid) && (![data.pid, data.rid].every((id) => ID.test(String(id))))) return reject(ctx, 400, 'Invalid reply target.');
      if (!admin && (data.mail || data.link || data.ua)) return reject(ctx, 400, 'Anonymous comments must not include email, URL or device details.');
      // Select the official fields instead of forwarding status/user_id or other identity claims.
      ctx.request.body.post = Object.fromEntries(['url', 'comment', 'nick', 'pid', 'rid'].filter((name) => data[name] !== undefined).map((name) => [name, data[name]]));
      Object.assign(ctx.request.body.post, { mail: '', link: '', ua: '' });
    } else if (ctx.path === '/api/comment' && ctx.method === 'GET' && !admin) {
      if (Object.keys(ctx.query).some((name) => !['path', 'page', 'pageSize', 'lang', 'sortBy'].includes(name)) || Object.values(ctx.query).some((value) => typeof value !== 'string') || !articleKey(ctx.query.path) || !/^[1-9]\d{0,3}$/.test(ctx.query.page || '') || !/^(?:[1-9]|10)$/.test(ctx.query.pageSize || '') || (ctx.query.sortBy && ctx.query.sortBy !== 'insertedAt_desc')) return reject(ctx, 400, 'Anonymous reads require a single article and bounded pagination.');
    } else if (ctx.path === '/api/user' && ctx.method === 'POST' && config.mode === 'bootstrap') {
      const users = ctx.app.think.service('storage/postgresql', 'Users');
      // Use the same strict model factory as every Waline request.
      users.model = (name) => ctx.model(name.toLowerCase(), { type: 'postgresql', postgresql: config.database });
      if (await users.count()) return reject(ctx, 409, 'An account already exists. Setup registration is closed.');
      const data = ctx.request.body.post;
      if (typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254 || typeof data.password !== 'string' || data.password.length < 16 || data.password.length > 128 || typeof data.display_name !== 'string' || !data.display_name.trim() || [...data.display_name].length > 60) return reject(ctx, 400, 'Use an administrator email identifier, name and password of 16–128 characters. No email is sent.');
      ctx.request.body.post = { email: data.email, password: data.password, display_name: data.display_name };
    } else if (!ctx.path.startsWith('/api/token') && !admin) return reject(ctx, 401, 'Administrator login required.');
    await next();
  };
}

async function validateReply(comment) {
  if (!comment.pid && !comment.rid) return;
  const [parent] = await this.getModel('Comment').select({ objectId: comment.pid });
  const admin = this.ctx.state.userInfo?.type === 'administrator';
  if (!parent || parent.url !== comment.url || String(parent.rid || parent.objectId) !== String(comment.rid) || (!admin && parent.status !== 'approved')) return 'Reply target is not an accessible comment in this article.';
}

module.exports = { MAX_BODY, MAX_RESPONSE, CSP, setupAuthorized, routeAllowed, boundary, validation, validateReply };
