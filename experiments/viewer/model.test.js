import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArtifact, buildTrails } from './model.js';

const trace = 'a'.repeat(32), actionSpan = 'b'.repeat(16), parent = 'c'.repeat(16), child = 'd'.repeat(16);
const base = { actions: [{ traceId: trace, spanId: actionSpan, secret: 'drop' }], spans: [
  { name: 'child', kind: 0, path: null, traceId: trace, spanId: child, parentSpanId: parent, durationMs: 1, source: { status: 'unknown' }, statusCode: 0, secret: 'drop' },
  { name: 'root', kind: 1, path: '/api', traceId: trace, spanId: parent, parentSpanId: actionSpan, durationMs: 2, source: { status: 'mapped', file: 'src/app.ts', line: 1, column: 2 }, statusCode: 1 },
  { name: 'control', kind: 1, path: '/', traceId: 'e'.repeat(32), spanId: 'f'.repeat(16), parentSpanId: null, durationMs: 0, source: { status: 'unknown' }, statusCode: 0 }
] };

test('sanitizes evidence and builds shuffled action-rooted trees without controls or synthetic action spans', () => {
  const parsed = parseArtifact(JSON.stringify(base));
  assert.equal('secret' in parsed.actions[0], false);
  assert.equal('secret' in parsed.spans[0], false);
  assert.equal(parsed.spans.length, 3);
  const [trail] = buildTrails(parsed);
  assert.equal(trail.spanId, actionSpan); assert.equal(trail.spanCount, 2);
  assert.deepEqual(trail.children[0].span.spanId, parent);
  assert.equal(trail.children[0].children[0].span.spanId, child);
  assert.equal(parseArtifact({ actions: [], spans: [] }).spans.length, 0);
});

test('rejects malformed identities, data, graph and source paths with bounded errors', () => {
  const badCases = [
    value => { value.actions[0].traceId = '0'.repeat(32); },
    value => { value.spans[0].kind = 5; },
    value => { value.spans[0].durationMs = Infinity; },
    value => { value.spans[1].spanId = value.spans[0].spanId; },
    value => { value.spans[1].parentSpanId = child; value.spans[0].parentSpanId = parent; },
    value => { value.spans[1].parentSpanId = '9'.repeat(16); },
    value => { value.spans[1].source = { status: 'mapped', file: '../secret', line: 1, column: 1 }; },
    value => { value.spans[1].source.file = 'https://host/a'; }
  ];
  for (const mutate of badCases) { const value = structuredClone(base); mutate(value); assert.throws(() => parseArtifact(value), { message: 'Invalid artifact' }); }
  assert.throws(() => parseArtifact('x'.repeat(1024 * 1024 + 1)), { message: 'Invalid artifact' });
  const tooDeep = { actions: [{ traceId: trace, spanId: actionSpan }], spans: [] };
  for (let i = 0; i < 66; i++) tooDeep.spans.push({ name: 'x', kind: 0, path: null, traceId: trace, spanId: (i + 1).toString(16).padStart(16, '0'), parentSpanId: i ? i.toString(16).padStart(16, '0') : actionSpan, durationMs: 0, source: { status: 'unknown' }, statusCode: 0 });
  assert.throws(() => parseArtifact(tooDeep), { message: 'Invalid artifact' });
});

test('identity fields require strings and observed-node depth is consistent through building', () => {
  for (const bad of [0, [], null]) {
    for (const field of ['traceId', 'spanId']) { const v = structuredClone(base); v.actions[0][field] = bad; assert.throws(() => parseArtifact(v), { message: 'Invalid artifact' }); }
    const v = structuredClone(base); v.spans[0].parentSpanId = bad; assert.throws(() => parseArtifact(v), { message: 'Invalid artifact' });
  }
  const chain = depth => ({ actions: [{ traceId: trace, spanId: actionSpan }], spans: Array.from({ length: depth }, (_, i) => ({ name: 'x', kind: 0, path: null, traceId: trace, spanId: (i + 1).toString(16).padStart(16, '0'), parentSpanId: i ? i.toString(16).padStart(16, '0') : actionSpan, durationMs: 0, source: { status: 'unknown' }, statusCode: 0 })) });
  for (const depth of [63, 64]) assert.equal(buildTrails(chain(depth))[0].spanCount, depth);
  assert.throws(() => buildTrails(chain(65)), { message: 'Invalid artifact' });
  for (const ids of [[actionSpan], ['1'.repeat(16), actionSpan]]) {
    const v = structuredClone(base); v.spans = v.spans.filter(s => s.traceId === trace).slice(0, ids.length).map((s, i) => ({ ...s, spanId: ids[i], parentSpanId: i ? ids[i - 1] : actionSpan }));
    assert.throws(() => buildTrails(v), { message: 'Invalid artifact' });
  }
});

test('rejects zero IDs and non-string format-looking identities without graph confounds', () => {
  const validNearby = structuredClone(base); validNearby.actions[0].traceId = `0${'0'.repeat(30)}1`; validNearby.spans.filter(s => s.traceId === trace).forEach(s => { s.traceId = validNearby.actions[0].traceId; });
  assert.equal(parseArtifact(validNearby).actions[0].traceId.endsWith('1'), true);
  for (const makeBad of [
    v => { v.actions[0].traceId = '0'.repeat(32); v.spans.filter(s => s.traceId === trace).forEach(s => { s.traceId = '0'.repeat(32); }); },
    v => { v.actions[0].spanId = '0'.repeat(16); },
    v => { v.actions[0].spanId = '0'.repeat(16); v.spans[1].parentSpanId = '0'.repeat(16); },
    v => { v.spans[0].spanId = '0'.repeat(16); },
    v => { v.spans[2].spanId = '0'.repeat(16); },
    v => { v.spans[2].traceId = '0'.repeat(32); },
    v => { v.actions[0].traceId = Array(32).fill('a'); },
    v => { v.actions[0].spanId = Array(16).fill('b'); },
    v => { v.spans[1].parentSpanId = Array(16).fill('b'); }
  ]) { const value = structuredClone(base); makeBad(value); assert.throws(() => parseArtifact(value), { message: 'Invalid artifact' }); }
});

test('enforces action and span count bounds, duplicate traces, and rejects unknown source extras', () => {
  const action = { traceId: trace, spanId: actionSpan };
  const hundredActions = Array.from({ length: 100 }, (_, i) => ({ ...action, traceId: (i + 1).toString(16).padStart(32, '0') }));
  const actionSpans = hundredActions.map(item => ({ name: 'x', kind: 0, path: null, traceId: item.traceId, spanId: '1'.padStart(16, '0'), parentSpanId: item.spanId, durationMs: 0, source: { status: 'unknown' }, statusCode: 0 }));
  assert.equal(parseArtifact({ actions: hundredActions, spans: actionSpans }).actions.length, 100);
  assert.throws(() => parseArtifact({ actions: Array.from({ length: 101 }, (_, i) => ({ ...action, traceId: `${i.toString(16).padStart(31, '0')}1` })), spans: [] }), { message: 'Invalid artifact' });
  assert.throws(() => parseArtifact({ actions: [{ ...action }, { ...action }], spans: [] }), { message: 'Invalid artifact' });
  const withinLimit = { actions: [], spans: Array.from({ length: 1000 }, (_, i) => ({ name: 'x', kind: 0, path: null, traceId: (i + 1).toString(16).padStart(32, '0'), spanId: '1'.padStart(16, '0'), parentSpanId: null, durationMs: 0, source: { status: 'unknown' }, statusCode: 0 })) };
  assert.equal(parseArtifact(withinLimit).spans.length, 1000);
  const unknownExtra = structuredClone(withinLimit); unknownExtra.spans[0].source.extra = true;
  assert.throws(() => parseArtifact(unknownExtra), { message: 'Invalid artifact' });
  assert.throws(() => parseArtifact({ actions: [], spans: Array.from({ length: 1001 }, (_, i) => ({ name: 'x', kind: 0, path: null, traceId: (i + 1).toString(16).padStart(32, '0'), spanId: '1'.padStart(16, '0'), parentSpanId: null, durationMs: 0, source: { status: 'unknown' }, statusCode: 0 })) }), { message: 'Invalid artifact' });
});

test('mapped source paths are strings bounded to 256 safe relative characters', () => {
  for (const file of [0, [], 'x'.repeat(257), '/absolute', '../escape', 'https://host/a', 'a\\b']) { const v = structuredClone(base); v.spans[1].source.file = file; assert.throws(() => parseArtifact(v), { message: 'Invalid artifact' }); }
  const v = structuredClone(base); v.spans[1].source.file = `a${'b'.repeat(255)}`; assert.equal(parseArtifact(v).spans[1].source.file.length, 256);
});
