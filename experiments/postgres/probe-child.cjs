'use strict';

const mode = process.env.SPANTRAIL_POSTGRES_PROBE;
if (mode === 'reject-shutdown' || mode === 'shutdown-http') {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const originalShutdown = NodeSDK.prototype.shutdown;
  NodeSDK.prototype.shutdown = function() {
    if (mode === 'reject-shutdown') {
      process.send?.({ type: 'probe-shutdown-rejected' });
      return Promise.reject(new Error('probe SDK shutdown rejected'));
    }
    const http = require('node:http');
    const request = http.request('http://127.0.0.1:4318/shutdown-export');
    request.on('error', () => {});
    request.destroy();
    process.stdout.write('SPANTRAIL_PROBE shutdown-http-attempt\n');
    return originalShutdown.apply(this, arguments);
  };
}

if (mode === 'abort-http-after-snapshot') {
  process.on('message', message => {
    if (message?.type !== 'probe-abort-export') return;
    const request = require('node:http').request('http://127.0.0.1:4318/aborted-export');
    request.on('error', () => {});
    request.destroy();
    process.stdout.write('SPANTRAIL_PROBE http-aborted-after-snapshot\\n');
  });
}

if (mode === 'signal-active-request') {
  const Module = require('node:module');
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const appPath = resolve(process.cwd(), 'experiments/postgres/app.cjs');
  const original = Module._extensions['.cjs'] ?? Module._extensions['.js'];
  Module._extensions['.cjs'] = function(module, filename) {
    if (resolve(filename) !== appPath) return original(module, filename);
    const source = readFileSync(filename, 'utf8');
    const anchor = "app.post('/api/action', async (request, response) => {";
    if (!source.includes(anchor)) throw new Error('PostgreSQL probe source anchor missing: active request');
    module._compile(source.replace(anchor, `${anchor}\n  console.log('SPANTRAIL_PROBE active-request PID=' + process.pid + ' PORT=' + server.address().port);\n  await new Promise(resolveDelay => setTimeout(resolveDelay, 3000));`), filename);
  };
}
