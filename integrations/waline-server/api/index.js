'use strict';

const { mode, settings } = require('../lib/settings.cjs');
let service;

module.exports = async function comments(req, res) {
  try {
    if (mode() !== 'locked') {
      if (!service) service = require('../lib/service.cjs').createService(settings());
      return await service(req, res);
    }
  } catch {
    console.error('[waline] service configuration or initialization failed; details suppressed.');
  }
  if (res.headersSent) { res.end(); return; }
  res.writeHead(503, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });
  res.end(JSON.stringify({ errno: 503, errmsg: 'Comment service is locked or unavailable. A previous write may already have been saved; do not automatically retry.' }));
};
