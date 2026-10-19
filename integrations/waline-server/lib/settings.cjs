'use strict';

const MODES = new Set(['locked', 'bootstrap', 'public']);
const SECRET = /^[A-Za-z0-9_-]{43,128}$/;
const FORBIDDEN = /^(?:SMTP_|PG_|POSTGRES_|MYSQL_|MONGO_|SQLITE_|TIDB_|TCB_|TENCENTCLOUD_|LEAN_|QYWX_|QMSG_|TG_|PUSH_PLUS_|DISCORD_|LARK_|RECAPTCHA_|TURNSTILE_|MARKDOWN_|MAIL_)/;
const OTHER_CONFIG = new Set(['JWT_TOKEN', 'DATABASE_URL', 'GITHUB_TOKEN', 'SC_KEY', 'WEBHOOK', 'OAUTH_URL', 'LOGIN', 'COMMENT_AUDIT', 'IPQPS', 'AKISMET_KEY', 'SECURE_DOMAINS', 'GRAVATAR_STR', 'AVATAR_PROXY', 'WALINE_ADMIN_MODULE_ASSET_URL', 'WALINE_BACKUP_DATABASE_URL', 'WALINE_BACKUP_CA_FILE']);

function mode(env = process.env) {
  const value = env.WALINE_MODE || 'locked';
  if (!MODES.has(value)) throw new Error('WALINE_MODE must be locked, bootstrap or public.');
  return value;
}

function origin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin.`); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new Error(`${name} must be an HTTPS origin without a path or credentials.`);
  return url.origin;
}

function databaseOptions(value) {
  let url, user, password, database;
  try {
    url = new URL(value);
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { throw new Error('Invalid PostgreSQL connection URL (value hidden).'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !user || !password || !database || /[\0\r\n/]/.test(database) || url.hash) throw new Error('Incomplete PostgreSQL connection URL (value hidden).');
  const params = [...url.searchParams.keys()];
  if (new Set(params).size !== params.length || params.some((key) => key !== 'sslmode') || url.searchParams.get('sslmode') !== 'verify-full') throw new Error('Use only sslmode=verify-full in the URL. Channel binding is enabled when available, not a driver-enforced require mode.');
  // Do not forward connectionString: pg's URL SSL options can replace an explicit ssl object.
  return {
    host: url.hostname, port: Number(url.port || 5432), user, password, database,
    prefix: 'wl_', ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    enableChannelBinding: true,
    max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    statement_timeout: 5000, query_timeout: 7000,
    logSql: false, logConnect: false,
  };
}

function settings(env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Global TLS certificate bypass is forbidden.');
  for (const [name, value] of Object.entries(env)) {
    if (value && (FORBIDDEN.test(name) || OTHER_CONFIG.has(name))) throw new Error(`Remove conflicting or external-service setting: ${name} (value hidden).`);
  }
  const access = mode(env);
  const blogOrigin = origin(env.WALINE_BLOG_ORIGIN, 'WALINE_BLOG_ORIGIN');
  const panelOrigin = origin(env.WALINE_PANEL_ORIGIN, 'WALINE_PANEL_ORIGIN');
  const apiOrigin = origin(env.WALINE_API_ORIGIN, 'WALINE_API_ORIGIN');
  if (new Set([blogOrigin, panelOrigin, apiOrigin]).size !== 3) throw new Error('Blog, panel and API origins must be different.');
  if (!SECRET.test(env.WALINE_JWT_TOKEN || '')) throw new Error('WALINE_JWT_TOKEN needs an independently generated 256-bit secret (for example 64 hex characters).');
  if (access === 'bootstrap' && !SECRET.test(env.WALINE_SETUP_PASSWORD || '')) throw new Error('Bootstrap mode requires a separate random WALINE_SETUP_PASSWORD.');
  if (access === 'bootstrap' && env.WALINE_SETUP_PASSWORD === env.WALINE_JWT_TOKEN) throw new Error('Setup password and JWT secret must be different.');
  if (access === 'public' && env.WALINE_SETUP_PASSWORD) throw new Error('Remove WALINE_SETUP_PASSWORD before public mode.');
  return {
    mode: access, blogOrigin, panelOrigin, apiOrigin,
    database: databaseOptions(env.WALINE_DATABASE_URL),
    jwtKey: env.WALINE_JWT_TOKEN,
    setupPassword: access === 'bootstrap' ? env.WALINE_SETUP_PASSWORD : undefined,
  };
}

module.exports = { mode, settings, databaseOptions };
