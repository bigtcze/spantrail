import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraceContext, injectContext, validContext } from './context.js';

test('creates fresh valid W3C identifiers', () => {
  const first = createTraceContext();
  const second = createTraceContext();
  assert.equal(validContext(first), true);
  assert.equal(validContext(second), true);
  assert.notEqual(first.traceId, second.traceId);
});

test('rejects malformed, uppercase, wrong-length, and zero identifiers', () => {
  const good = { traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef' };
  for (const invalid of [
    { ...good, traceId: '0'.repeat(32) }, { ...good, spanId: '0'.repeat(16) },
    { ...good, traceId: 'A234567890abcdef1234567890abcdef' },
    { ...good, spanId: 'A234567890abcdef' }, { ...good, traceId: good.traceId.slice(1) },
    { ...good, spanId: good.spanId.slice(1) }, { traceId: null, spanId: good.spanId },
  ]) assert.equal(validContext(invalid), false);
});

test('inject scope requires the exact origin and API path', () => {
  const origin = 'http://127.0.0.1:4567';
  assert.equal(injectContext('/api/action', origin, '/api/action').href, `${origin}/api/action`);
  for (const input of ['/api/action/extra', '/api/action?x=1', '/api/action#hash', '/api/control', 'http://example.test/api/action', 'http://127.0.0.1.evil/api/action', 'http://127.0.0.1:4568/api/action', 'http://user:pass@127.0.0.1:4567/api/action', 'http://[broken']) {
    assert.equal(injectContext(input, origin, '/api/action'), null, input);
  }
  assert.equal(injectContext('/api/action', 'http://user@127.0.0.1:4567', '/api/action'), null);
});
