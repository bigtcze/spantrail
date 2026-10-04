for (const key of Object.keys(process.env)) if (key.startsWith('OTEL_')) delete process.env[key];

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { sourceFromSpan } = require('../source-attribution/source.cjs');

const MAX_FINISHED_SPANS = 1000;
let overflowed = false;
const exporter = new InMemorySpanExporter();
const recordSpan = exporter.export.bind(exporter);
exporter.export = (spans, callback) => {
  if (overflowed || spans.length > MAX_FINISHED_SPANS - exporter.getFinishedSpans().length) {
    overflowed = true;
    callback({ code: 1, error: new Error('local trace span limit exceeded') });
    return;
  }
  recordSpan(spans, callback);
};
const sdk = new NodeSDK({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  metricReaders: [],
  logRecordProcessors: [],
  autoDetectResources: false,
  instrumentations: [new HttpInstrumentation({ ignoreIncomingRequestHook: request => request.url?.startsWith('/__') ?? false })],
});
const ready = Promise.resolve(sdk.start());
const allowedPaths = new Set(['/', '/browser.js', '/context.js', '/api/action', '/api/failure', '/api/control', '/success', '/failure']);
const allowedNames = new Set(['action.service', 'action.after-await', 'app.service', 'app.after-await', 'app.failure']);
function snapshot() {
  if (overflowed) throw new Error('local trace span limit exceeded; artifact is incomplete');
  return exporter.getFinishedSpans().map(span => {
    let path = null;
    try {
      const value = span.attributes['http.target'] ?? span.attributes['url.path'] ?? '';
      if (value) { const candidate = new URL(value, 'http://localhost').pathname; path = allowedPaths.has(candidate) ? candidate : 'other'; }
    } catch { path = 'other'; }
    const kind = span.kind;
    const method = span.attributes['http.request.method'] ?? span.attributes['http.method'];
    const name = kind === 1 && typeof method === 'string' && /^[A-Z]+$/.test(method.toUpperCase()) && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'].includes(method.toUpperCase())
      ? method.toUpperCase()
      : allowedNames.has(span.name) ? span.name : kind === 2 ? 'CLIENT' : kind === 1 ? 'SERVER' : 'INTERNAL';
    return {
      name, kind, path, traceId: span.spanContext().traceId, spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanContext?.spanId ?? null,
      durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
      statusCode: span.status.code, source: sourceFromSpan(span),
    };
  });
}
async function shutdown() { await sdk.shutdown(); }
module.exports = { ready, snapshot, shutdown };
