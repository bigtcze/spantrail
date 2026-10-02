const MAX_ACTIONS = 100;
const MAX_SPANS = 1000;
const MAX_DEPTH = 64;
const MAX_TEXT = 256;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

function invalid() { throw new Error('Invalid artifact'); }
function validId(value, regex) { return typeof value === 'string' && regex.test(value) && !/^0+$/.test(value); }
function text(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value;
}
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function sourceOf(value) {
  if (!plainObject(value)) invalid();
  if (value.status === 'unknown' && Object.keys(value).length === 1) return { status: 'unknown' };
  if (value.status !== 'mapped' || typeof value.file !== 'string' || value.file.length === 0 || value.file.length > MAX_TEXT || !/^[A-Za-z0-9._/-]+$/.test(value.file) || value.file.startsWith('/') || value.file.split('/').some(p => !p || p === '.' || p === '..') || !Number.isSafeInteger(value.line) || value.line <= 0 || !Number.isSafeInteger(value.column) || value.column <= 0) invalid();
  return { status: 'mapped', file: value.file, line: value.line, column: value.column };
}

export function parseArtifact(input) {
  let data = input;
  try { if (typeof input === 'string') { if (input.length > 1024 * 1024) invalid(); data = JSON.parse(input); } } catch { invalid(); }
  if (!plainObject(data) || !Array.isArray(data.actions) || !Array.isArray(data.spans) || data.actions.length > MAX_ACTIONS || data.spans.length > MAX_SPANS) invalid();
  const actions = [], traces = new Set();
  for (const action of data.actions) {
    if (!plainObject(action) || !validId(action.traceId, TRACE_ID) || !validId(action.spanId, SPAN_ID) || traces.has(action.traceId)) invalid();
    traces.add(action.traceId); actions.push({ traceId: action.traceId, spanId: action.spanId });
  }
  const identities = new Set(), spans = [];
  for (const span of data.spans) {
    if (!plainObject(span) || !validId(span.traceId, TRACE_ID) || !validId(span.spanId, SPAN_ID) || !(span.parentSpanId === null || validId(span.parentSpanId, SPAN_ID)) || !Number.isInteger(span.kind) || span.kind < 0 || span.kind > 4 || !Number.isInteger(span.statusCode) || span.statusCode < 0 || span.statusCode > 2 || typeof span.durationMs !== 'number' || !Number.isFinite(span.durationMs) || span.durationMs < 0) invalid();
    const identity = `${span.traceId}:${span.spanId}`;
    if (identities.has(identity)) invalid(); identities.add(identity);
    spans.push({ name: text(span.name), kind: span.kind, path: text(span.path, true), traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId, durationMs: span.durationMs, source: sourceOf(span.source), statusCode: span.statusCode });
  }
  for (const action of actions) {
    const own = spans.filter(span => span.traceId === action.traceId), byId = new Map(own.map(span => [span.spanId, span]));
    if (!byId.size) invalid();
    if (byId.has(action.spanId)) invalid();
    for (const span of own) if (span.parentSpanId !== action.spanId && !byId.has(span.parentSpanId)) invalid();
    for (const span of own) {
      let cursor = span, depth = 1;
      while (cursor.parentSpanId !== action.spanId) { cursor = byId.get(cursor.parentSpanId); if (!cursor || ++depth > MAX_DEPTH) invalid(); }
    }
  }
  return { actions, spans };
}

export function buildTrails(artifact) {
  const { actions, spans } = parseArtifact(artifact);
  return actions.map(action => {
    const own = spans.filter(span => span.traceId === action.traceId), byParent = new Map();
    for (const span of own) { const parent = span.parentSpanId; if (!byParent.has(parent)) byParent.set(parent, []); byParent.get(parent).push(span); }
    let count = 0;
    function children(parent, depth) {
      return (byParent.get(parent) || []).map(span => { if (depth > MAX_DEPTH) invalid(); count++; return { span, children: children(span.spanId, depth + 1) }; });
    }
    const tree = children(action.spanId, 1);
    if (count !== own.length) invalid();
    return { traceId: action.traceId, spanId: action.spanId, children: tree, spanCount: count };
  });
}
