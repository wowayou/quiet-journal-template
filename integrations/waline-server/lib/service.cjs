'use strict';

const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { boundary, validation, validateReply } = require('./policy.cjs');
const { readVendor, digest } = require('./vendor.cjs');
let initialized = false;

function strictModel(database) {
  return (name, controller) => {
    // Reuse Waline's PostgreSQL storage, including ID/date mapping and all CRUD.
    // Waline({ model: {...} }) is NOT an adapter override in 1.43.4: it is a
    // custom-model factory. Supplying the strict options at model creation
    // avoids the upstream rejectUnauthorized:false and connection-string log.
    const storage = controller.service('storage/postgresql', name);
    storage.model = (table) => controller.model(table.toLowerCase(), { type: 'postgresql', postgresql: database });
    return storage;
  };
}

function createService(config) {
  if (initialized) throw new Error('Run only one isolated Waline instance per process.');
  const vendor = readVendor();
  const serverPackage = require('@waline/vercel/package.json');
  if (serverPackage.version !== '1.43.4' || serverPackage.quietJournalProfile !== vendor.profile) throw new Error('Unexpected Waline server version/profile.');
  // The loader persists its initial env-derived config in /tmp/runtime.
  // Only a public selector is given to that loader; credentials are supplied
  // through the custom model and jwtKey, not PG_PASSWORD or JWT_TOKEN.
  process.umask(0o077);
  Object.assign(process.env, {
    PG_DB: 'waline', SITE_URL: config.blogOrigin, SERVER_URL: config.apiOrigin,
    SITE_NAME: 'Journal', IPQPS: '60', LOGIN: 'disable',
    COMMENT_AUDIT: 'true', DISABLE_AUTHOR_NOTIFY: 'true', AKISMET_KEY: 'false',
    DISABLE_USERAGENT: 'true', DISABLE_REGION: 'true',
    MARKDOWN_TEX: 'false', MARKDOWN_HIGHLIGHT: 'false',
  });
  const Waline = require('@waline/vercel');
  const middleware = require('@waline/vercel/src/config/middleware.js');
  // Deliberate, version-bound middleware configuration, before Waline loads it.
  // Do not silently continue if an upstream upgrade changes these boundaries.
  for (const name of ['fetch-oauth-service', 'dashboard', 'version', 'meta', 'payload', 'trace']) {
    if (middleware.filter((item) => item?.handle === name).length !== 1) throw new Error('Waline middleware contract changed.');
  }
  for (const item of middleware) {
    // The version header triggers an automatic npm-registry fetch in admin.
    // Versions are pinned and reviewed manually; do not fake a latest response.
    if (['fetch-oauth-service', 'dashboard', 'version'].includes(item?.handle)) item.enable = false;
    if (item?.handle === 'payload') item.options = { ...item.options, limit: '12kb' };
    // This module is inspected before Waline selects its production environment.
    // Do not retain the loader's development request logging (URLs contain PII).
    if (item?.handle === 'meta') item.options = { ...item.options, logRequest: false, sendPowerBy: false, sendResponseTime: false };
    if (item?.handle === 'trace') item.options = {
      ...item.options, debug: false,
      error(error) {
        if (global.think.isPrevent(error)) return false;
        const code = /^[A-Z0-9_]{1,40}$/.test(error?.code || '') ? error.code : 'REQUEST_FAILED';
        console.error(`[waline] ${code}`); // No SQL, connection string, body or stack.
      },
    };
  }
  const adminEntry = require.resolve('@waline/admin');
  const adminRoot = dirname(dirname(adminEntry));
  const adminPackage = JSON.parse(readFileSync(join(adminRoot, 'package.json'), 'utf8'));
  const admin = readFileSync(adminEntry);
  if (adminPackage.version !== '0.36.0' || adminPackage.quietJournalBuild?.sha256 !== vendor.adminSha256 || digest(admin) !== vendor.adminSha256) throw new Error('Unexpected Waline admin build.');
  middleware.unshift({ handle: () => boundary(config, {
    admin, license: readFileSync(join(adminRoot, 'LICENSE'), 'utf8'),
    adminSource: vendor.adminSource, serverSource: vendor.serverSource,
    css: readFileSync(join(__dirname, '../assets/admin.css'), 'utf8'),
    avatar: readFileSync(join(__dirname, '../assets/avatar.svg'), 'utf8'),
    ownLicense: readFileSync(join(__dirname, '../LICENSE'), 'utf8'),
  }) });
  const handler = Waline({
    jwtKey: config.jwtKey, model: strictModel(config.database),
    audit: true, disableUserAgent: true, disableRegion: true,
    // boundary() owns exact-origin CORS and authenticated administration.
    // The upstream host-only referrer check rejects legitimate no-referrer GETs
    // (browsers do not send Origin on same-origin reads). It is not authentication.
    secureDomains: null,
    // An empty string triggers Waline's remote-avatar fallback.
    avatarUrl: () => `${config.apiOrigin}/avatar.svg`,
    plugins: [{ middlewares: [validation(config)] }],
    preSave: validateReply,
  });
  initialized = true;
  return handler;
}

module.exports = { createService, strictModel };
