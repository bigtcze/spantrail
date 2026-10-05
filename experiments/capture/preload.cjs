'use strict';

for (const key of Object.keys(process.env)) if (key.startsWith('OTEL_')) delete process.env[key];

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');

const { sanitizeSpan } = require('./runtime-sanitizer.cjs');

const MAX_SPANS = 1000;
const MAX_MESSAGE = 1024 * 1024;
const PROTOCOL = 'spantrail-capture-v1';
let captureError = null;
let records = [];
let stopping = false;
let operation = Promise.resolve();

const processor = new SimpleSpanProcessor({
  export(spans, callback) {
    try {
      if (captureError) throw captureError;
      if (!Array.isArray(spans) || spans.length > MAX_SPANS - records.length) throw new Error('span-limit');
      const batch = spans.map(sanitizeSpan);
      records.push(...batch);
      callback({ code: 0 });
    } catch (error) {
      if (!captureError) captureError = error?.message === 'span-limit' ? new Error('span-limit') : new Error('invalid-span');
      callback({ code: 1, error: captureError });
    }
  },
  forceFlush() { return Promise.resolve(); },
  shutdown() { return Promise.resolve(); },
});
const sdk = new NodeSDK({ spanProcessors: [processor], metricReaders: [], logRecordProcessors: [], autoDetectResources: false, instrumentations: [new HttpInstrumentation(), new PgInstrumentation({ enhancedDatabaseReporting: false, ignoreConnectSpans: true, addSqlCommenterCommentToQueries: false })] });
let readyError = null;
try { sdk.start(); } catch { readyError = new Error('startup-failed'); }
const ready = readyError ? Promise.reject(readyError) : Promise.resolve();
ready.catch(() => {});
function send(message) {
  try {
    if (!process.send || !process.connected) return;
    const text = JSON.stringify(message);
    if (Buffer.byteLength(text) > MAX_MESSAGE) return;
    process.send(message, () => {});
  } catch { /* IPC is best effort; never crash the application. */ }
}
function reply(id, ok, fields = {}) { send({ protocol: PROTOCOL, id, ok, ...fields }); }
process.on('message', message => {
  if (!message || message.protocol !== PROTOCOL || typeof message.id !== 'string') return;
  operation = operation.then(async () => {
    if (message.type === 'snapshot') {
      if (stopping) { reply(message.id, false, { error: 'snapshot-unavailable' }); return; }
      await ready;
      await processor.forceFlush();
      if (captureError) { reply(message.id, false, { error: 'snapshot-unavailable' }); return; }
      const body = JSON.stringify(records);
      if (Buffer.byteLength(body) > MAX_MESSAGE) { reply(message.id, false, { error: 'snapshot-unavailable' }); return; }
      reply(message.id, true, { spans: records });
    } else if (message.type === 'shutdown') {
      stopping = true;
      await ready;
      await processor.forceFlush();
      await sdk.shutdown();
      reply(message.id, true);
      setImmediate(() => process.disconnect?.());
    }
  }).catch(error => {
    const allowed = error?.message === 'invalid-span' ? 'invalid-span' : message.type === 'snapshot' ? 'snapshot-failed' : message.type === 'shutdown' ? 'shutdown-failed' : 'startup-failed';
    reply(message.id, false, { error: allowed });
  });
});
ready.then(() => send({ protocol: PROTOCOL, type: 'ready' }), () => send({ protocol: PROTOCOL, type: 'startup-error', error: 'startup-failed' }));
process.channel?.unref();
