import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { startChild, stopChild } from '../correlation/run.js';

const dir = dirname(fileURLToPath(import.meta.url));
const entry = resolve(dir, 'entry.cjs');
const preload = resolve(dir, '../runtime/local-tracing.cjs');

 test('Express preserves incoming context, records awaited app spans, recovers after failure, and shuts down cleanly', async () => {
  const child = startChild({ childProgram: entry, preload });
  let port;
  try {
    ({ port } = await child.ready);
    const origin = `http://127.0.0.1:${port}`;
    const traceId = '1234567890abcdef1234567890abcdef';
    const parentSpanId = '1234567890abcdef';
    const success = await fetch(`${origin}/success`, { headers: { traceparent: `00-${traceId}-${parentSpanId}-01` } });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { ok: true });
    const failure = await fetch(`${origin}/failure`);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: 'request failed' });
    const recovered = await fetch(`${origin}/success`);
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), { ok: true });
    const spans = await (await fetch(`${origin}/__spans`)).json();
    const successfulServer = spans.find(span => span.kind === 1 && span.path === '/success' && span.traceId === traceId);
    const failedServer = spans.find(span => span.kind === 1 && span.path === '/failure');
    const services = spans.filter(span => span.name === 'app.service');
    const nested = spans.filter(span => span.name === 'app.after-await');
    const failedApp = spans.find(span => span.name === 'app.failure');
    assert.ok(successfulServer && failedServer && failedApp);
    assert.equal(successfulServer.name, 'GET');
    assert.equal(failedServer.name, 'GET');
    assert.equal(services.length, 2);
    assert.equal(nested.length, 2);
    const recoveredServer = spans.find(span => span.kind === 1 && span.path === '/success' && span.traceId !== traceId);
    assert.ok(recoveredServer);
    const serviceByTrace = new Map(services.map(span => [span.traceId, span]));
    const nestedByTrace = new Map(nested.map(span => [span.traceId, span]));
    assert.equal(serviceByTrace.get(traceId)?.parentSpanId, successfulServer.spanId);
    assert.equal(nestedByTrace.get(traceId)?.parentSpanId, serviceByTrace.get(traceId)?.spanId);
    assert.equal(serviceByTrace.get(recoveredServer.traceId)?.parentSpanId, recoveredServer.spanId);
    assert.equal(nestedByTrace.get(recoveredServer.traceId)?.parentSpanId, serviceByTrace.get(recoveredServer.traceId)?.spanId);
    assert.equal(failedApp.parentSpanId, failedServer.spanId);
    assert.equal(failedServer.statusCode, 2);
    assert.equal(failedApp.statusCode, 2);
    assert.notEqual(services[0].traceId, failedApp.traceId);
    assert.notEqual(services[0].traceId, services[1].traceId);
    assert.ok(spans.every(span => span.source?.status === 'unknown'));
    assert.ok(spans.filter(span => span.name === 'app.service' || span.name === 'app.after-await').every(span => span.durationMs > 0));
    assert.doesNotMatch(JSON.stringify(spans), /private failure detail/);
    for (const [path, contentType] of [['/', 'text/html'], ['/browser.js', 'text/javascript'], ['/context.js', 'text/javascript']]) {
      const asset = await fetch(`${origin}${path}`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('content-type'), new RegExp(`^${contentType.replace('/', '\\\/')}`));
    }
  } finally {
    await stopChild(child);
  }
  const exit = await child.exit;
  assert.deepEqual(exit, { type: 'exit', value: { code: 0, signal: null } });
  await new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error('Express port remained open after shutdown')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
});
