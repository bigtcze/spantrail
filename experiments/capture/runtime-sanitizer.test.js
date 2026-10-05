import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { sanitizeSpan } = createRequire(import.meta.url)('./runtime-sanitizer.cjs');
const secret = 'SQL_SECRET db-secret.example.com password=xyz arbitrary-secret';
function span({ kind = 2, scope = '@opentelemetry/instrumentation-pg', attributes = {}, statusCode = 0, name = secret } = {}) {
  return { name, kind, attributes: { 'db.system.name': 'postgresql', 'db.query.text': secret, 'db.namespace': secret, 'server.address': secret, 'pg.values': [secret], ...attributes }, instrumentationScope: { name: scope }, duration: [1, 250000000], status: { code: statusCode, message: secret }, events: [{ name: secret, attributes: { secret } }], spanContext: () => ({ traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef' }), parentSpanContext: { spanId: 'abcdef0123456789' } };
}

test('only trusted pg CLIENT spans with postgres system attributes classify as the fixed safe name', () => {
  const record = sanitizeSpan(span());
  assert.equal(record.name, 'PostgreSQL');
  assert.equal(record.kind, 2);
  assert.equal(record.path, null);
  assert.deepEqual(record.source, { status: 'unknown' });
  assert.equal(record.statusCode, 0);
  assert.doesNotMatch(JSON.stringify(record), /SQL_SECRET|db-secret|password|arbitrary-secret/);
  for (const candidate of [
    span({ scope: 'attacker' }),
    span({ attributes: { 'db.system.name': 'mysql' } }),
    span({ attributes: { 'db.system.name': undefined, 'db.system': 'mysql' } }),
    span({ kind: 1 }),
    span({ kind: 0 }),
    span({ scope: 'attacker', kind: 2 }),
  ]) assert.notEqual(sanitizeSpan(candidate).name, 'PostgreSQL');
});

test('failure status and arbitrary span payload remain private for pg query spans', () => {
  const record = sanitizeSpan(span({ statusCode: 2 }));
  assert.equal(record.statusCode, 2);
  assert.deepEqual(Object.keys(record).sort(), ['durationMs', 'kind', 'name', 'parentSpanId', 'path', 'source', 'spanId', 'statusCode', 'traceId']);
  assert.doesNotMatch(JSON.stringify(record), /SQL_SECRET|db-secret|password|arbitrary-secret/);
});

test('generic span names remain unchanged and cannot spoof PostgreSQL on other kinds', () => {
  const generic = sanitizeSpan(span({ kind: 2, scope: 'app', name: 'my-client-operation' }));
  assert.equal(generic.name, 'CLIENT');
  const internal = sanitizeSpan(span({ kind: 0, scope: '@opentelemetry/instrumentation-pg', name: 'PostgreSQL' }));
  assert.equal(internal.name, 'INTERNAL');
});
