'use strict';

// Child process for the opt-in local PostgreSQL regression. Never a cloud entry.
const http = require('node:http');
global.fetch = async () => {
  process.send?.({ unexpectedFetch: true });
  throw new Error('Unexpected outbound fetch in local Waline regression');
};
const server = http.createServer(require('../api/index.js'));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(0, '127.0.0.1', () => process.send?.({ port: server.address().port }));
process.once('SIGTERM', () => server.close(() => process.exit(0)));
