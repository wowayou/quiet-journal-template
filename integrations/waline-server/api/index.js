'use strict';

const { diagnosticLine } = require('../lib/diagnostics.cjs');
let service;

module.exports = async function comments(req, res) {
  let stage = 'SETTINGS_LOAD';
  try {
    const { mode, settings } = require('../lib/settings.cjs');
    stage = 'MODE';
    if (mode() !== 'locked') {
      if (!service) {
        stage = 'SERVICE_LOAD';
        const { createService } = require('../lib/service.cjs');
        stage = 'SETTINGS';
        const config = settings();
        stage = 'SERVICE_INIT';
        service = createService(config);
      }
      stage = 'REQUEST';
      return await service(req, res);
    }
  } catch (error) {
    console.error(diagnosticLine(stage, error));
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
