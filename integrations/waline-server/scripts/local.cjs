'use strict';

// Local inspection only: no public interface, cloud deployment or browser launch.
const http = require('node:http');
const handler = require('../api/index.js');
const server = http.createServer(handler);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(0, '127.0.0.1', () => {
  console.log(`Local Waline: http://127.0.0.1:${server.address().port}`);
  console.log('Production origins remain configured; this command does not validate a cloud deployment.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
