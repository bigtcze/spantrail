'use strict';

function sanitizeSpan(span) {
  try {
    const method = span.attributes?.['http.request.method'] ?? span.attributes?.['http.method'];
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'];
    const kind = span.kind;
    if (!Number.isInteger(kind) || kind < 0 || kind > 4) throw new Error();
    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;
    const parentSpanId = span.parentSpanContext?.spanId ?? null;
    if (typeof traceId !== 'string' || !/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId) || typeof spanId !== 'string' || !/^[0-9a-f]{16}$/.test(spanId) || /^0+$/.test(spanId) || (parentSpanId !== null && (typeof parentSpanId !== 'string' || !/^[0-9a-f]{16}$/.test(parentSpanId) || /^0+$/.test(parentSpanId)))) throw new Error();
    const durationMs = span.duration[0] * 1000 + span.duration[1] / 1e6;
    const statusCode = span.status.code;
    if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isInteger(statusCode) || statusCode < 0 || statusCode > 2) throw new Error();
    const attributes = span.attributes ?? {};
    const scopeName = span.instrumentationScope?.name ?? span.instrumentationLibrary?.name;
    const databaseSystem = attributes['db.system.name'] ?? attributes['db.system'];
    const isPgQuery = scopeName === '@opentelemetry/instrumentation-pg' && kind === 2 && (databaseSystem === 'postgresql' || databaseSystem === 'postgres');
    const name = isPgQuery ? 'PostgreSQL' : kind === 1 && typeof method === 'string' && methods.includes(method.toUpperCase()) ? method.toUpperCase() : kind === 2 ? 'CLIENT' : kind === 1 ? 'SERVER' : 'INTERNAL';
    return { name, kind, path: null, traceId, spanId, parentSpanId, durationMs, source: { status: 'unknown' }, statusCode };
  } catch { throw new Error('invalid-span'); }
}

module.exports = { sanitizeSpan };
