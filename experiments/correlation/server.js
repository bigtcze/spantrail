import { trace, SpanKind } from '@opentelemetry/api';
import { createRequire } from 'node:module';

const tracer = trace.getTracer('spantrail-correlation-proof');
const allowedPaths = new Set(['/', '/browser.js', '/context.js', '/api/action', '/api/control']);
const delayMs = Math.min(5000, Math.max(0, Number.parseInt(process.env.SPANTRAIL_CONTROL_DELAY_MS ?? '0', 10) || 0));
function safePath(value) {
  if (!value) return null;
  try { const path = new URL(value, 'http://localhost').pathname; return allowedPaths.has(path) ? path : 'other'; }
  catch { return 'other'; }
}

export async function startServer(exporter) {
  const { createServer } = createRequire(import.meta.url)('node:http');
  const server = createServer(async (request, response) => {
    if (request.url === '/api/action') {
      await tracer.startActiveSpan('action.service', { kind: SpanKind.INTERNAL }, async span => {
        try {
          await new Promise(resolve => setTimeout(resolve, 5));
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ traceId: span.spanContext().traceId }));
        } finally { span.end(); }
      });
      return;
    }
    if (request.url === '/api/control') {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    if (request.url === '/__spans') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(exporter.getFinishedSpans().map(span => ({
        name: span.name, kind: span.kind, path: safePath(span.attributes['http.target'] ?? span.attributes['url.path'] ?? ''), traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId, parentSpanId: span.parentSpanContext?.spanId ?? null,
        durationMs: (span.duration[0] * 1000) + span.duration[1] / 1e6,
      }))));
      return;
    }
    if (request.url === '/') {
      try {
        const body = await (await import('node:fs/promises')).readFile(new URL('./fixture.html', import.meta.url), 'utf8');
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(body);
      } catch { response.writeHead(500).end(); }
      return;
    }
    if (request.url === '/browser.js') {
      try {
        const body = await (await import('node:fs/promises')).readFile(new URL('./browser.js', import.meta.url), 'utf8');
        response.writeHead(200, { 'content-type': 'text/javascript' });
        response.end(body);
      } catch { response.writeHead(500).end(); }
      return;
    }
    if (request.url === '/context.js') {
      try {
        const body = await (await import('node:fs/promises')).readFile(new URL('./context.js', import.meta.url), 'utf8');
        response.writeHead(200, { 'content-type': 'text/javascript' });
        response.end(body);
      } catch { response.writeHead(500).end(); }
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
