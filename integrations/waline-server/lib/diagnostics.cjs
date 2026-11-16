'use strict';

// Only fixed vocabulary reaches the platform log. Never serialize an exception,
// its message/stack/cause, a path, a URL, or an environment variable value.
const STAGES = new Set(['SETTINGS_LOAD', 'MODE', 'SETTINGS', 'SERVICE_LOAD', 'VENDOR', 'SERVER_PACKAGE', 'SERVER_LOAD', 'MIDDLEWARE', 'ADMIN_ASSETS', 'SERVICE_INIT', 'REQUEST']);
const REASONS = new Set(['UNKNOWN', 'MODE_INVALID', 'TLS_BYPASS', 'CONFIG_CONFLICT', 'BLOG_ORIGIN_INVALID', 'PANEL_ORIGIN_INVALID', 'API_ORIGIN_INVALID', 'ORIGINS_NOT_DISTINCT', 'JWT_FORMAT', 'SETUP_FORMAT', 'SECRET_REUSE', 'SETUP_PRESENT_IN_PUBLIC', 'DATABASE_URL_INVALID', 'DATABASE_URL_INCOMPLETE', 'DATABASE_TLS_OPTIONS', 'VENDOR_MANIFEST', 'VENDOR_FILE_METADATA', 'VENDOR_INTEGRITY', 'SERVER_CONTRACT', 'MIDDLEWARE_CONTRACT', 'ADMIN_INTEGRITY', 'ALREADY_INITIALIZED', 'MODULE_MISSING', 'FILE_MISSING', 'FILE_DENIED']);
const details = new WeakMap();
const object = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');
const stageName = (stage) => STAGES.has(stage) ? stage : 'UNKNOWN';
const reasonName = (reason) => REASONS.has(reason) ? reason : 'UNKNOWN';

function failure(stage, reason, message) {
  const error = new Error(message);
  details.set(error, { stage: stageName(stage), reason: reasonName(reason) });
  return error;
}

function externalReason(error) {
  // Even an exception's code can be hostile or have a throwing getter.
  try {
    switch (error?.code) {
      case 'MODULE_NOT_FOUND': case 'ERR_MODULE_NOT_FOUND': return 'MODULE_MISSING';
      case 'ENOENT': return 'FILE_MISSING';
      case 'EACCES': case 'EPERM': return 'FILE_DENIED';
      default: return 'UNKNOWN';
    }
  } catch { return 'UNKNOWN'; }
}

// Synchronous resource/initialization boundaries only. The entrypoint owns the
// asynchronous request boundary. Preserve the innermost trusted classification.
function atStage(stage, action) {
  try { return action(); }
  catch (error) {
    if (!object(error)) throw failure(stage, 'UNKNOWN', 'Service operation failed (details hidden).');
    if (!details.has(error)) details.set(error, { stage: stageName(stage), reason: externalReason(error) });
    throw error;
  }
}

function diagnosticLine(stage, error) {
  const detail = object(error) && details.has(error)
    ? details.get(error)
    : { stage: stageName(stage), reason: externalReason(error) };
  return `[waline] service configuration or initialization failed; details suppressed. stage=${detail.stage} reason=${detail.reason}`;
}

module.exports = { failure, atStage, diagnosticLine };
